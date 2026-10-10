# syntax=docker/dockerfile:1
#
# 双色球预测 · 生产镜像
#
# 架构前提（决定了本镜像只能用于「长驻容器」，不能用于 Serverless）：
#   1. 自定义 Node 服务器：src/server.ts 经 tsup 打包为 dist/server.js，由 node 常驻运行；
#   2. DuckDB 文件型数据库：数据落在 data/lottery.duckdb，必须挂载持久化磁盘；
#   3. 进程内定时任务：src/instrumentation.ts 常驻轮询，依赖进程存活。
#
# 运行要求：单实例（DuckDB 文件锁 + 单写者队列，多副本会锁冲突）、挂载 /app/data、设置 TZ。

ARG NODE_VERSION=24

# ============================================================
# 1) 依赖安装层
# ============================================================
FROM node:${NODE_VERSION}-bookworm-slim AS deps
WORKDIR /app

ENV PNPM_HOME=/pnpm \
    PATH=/pnpm/bin:$PATH \
    npm_config_registry=https://registry.npmmirror.com \
    NEXT_TELEMETRY_DISABLED=1

# pnpm 安装到独立前缀，避免与基础镜像自带的 corepack shim 冲突。
# python3/make/g++ 仅作为 duckdb 原生模块「预编译包下载失败时源码编译」的兜底；
# 正常路径会直接下载预编译二进制（Node 24 → ABI 137，已确认 Linux x64 有包），不会触发编译。
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && npm i -g --prefix=/pnpm pnpm@9

COPY package.json pnpm-lock.yaml .npmrc ./
RUN pnpm install --frozen-lockfile

# ============================================================
# 2) 构建层
# ============================================================
FROM deps AS builder
WORKDIR /app
COPY . .

# Next 构建 + tsup 打包自定义服务器。
#
# 与原 scripts/build.sh 相比有两处必须的偏差（已本地实测验证）：
#
#   1) --webpack：Next 16 默认用 Turbopack 构建，而 Turbopack 在解析 duckdb 包的
#      package.json 时，会对 node-pre-gyp 的 "binary" 字段做反序列化并要求
#      `napi_versions`，而 duckdb 未提供该字段 →
#      TurbopackInternalError: missing field `napi_versions`
#      （堆栈指向 <NodePreGypConfigReference>::resolve_reference）。
#      这是 Turbopack 自身的缺陷，与本项目代码无关，切到 webpack 即规避。
#
#   2) .babelrc 已在 .dockerignore 中排除：该文件把 preset-react 的
#      development 固定为 true，会让生产构建注入 jsxDEV，导致预渲染
#      /_not-found 时抛 "jsxDEV is not a function" 而构建失败。
#      它只是 react-dev-inspector 的开发期调试配置，生产环境不需要。
RUN pnpm next build --webpack \
 && pnpm tsup src/server.ts \
      --format cjs --platform node --target node20 \
      --outDir dist --no-splitting --no-minify

# ============================================================
# 3) 运行层
# ============================================================
FROM node:${NODE_VERSION}-bookworm-slim AS runner
WORKDIR /app

# 注意：此处刻意先不设 NODE_ENV，原因见下面安装依赖处。
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm/bin:$PATH \
    npm_config_registry=https://registry.npmmirror.com \
    NEXT_TELEMETRY_DISABLED=1

# tzdata：定时任务按本地时间判断，缺 tzdata 时 TZ=Asia/Shanghai 不生效
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates tzdata \
 && rm -rf /var/lib/apt/lists/* \
 && npm i -g --prefix=/pnpm pnpm@9

# 安装完整依赖（含 devDependencies）。
# 与 Coze 平台 build.sh → start.sh 的既有可用路径保持一致：
# next.config.ts 是 TS 配置，运行期需要 typescript 才能加载，裁剪 devDependencies 会失败。
#
# ⚠ 这段必须在 NODE_ENV=production 之前执行：
#   pnpm 会读取 NODE_ENV，若安装时已是 production，devDependencies 会被整体跳过，
#   typescript 随之缺失；Next 启动时发现 next.config.ts 是 TS 配置却没有 typescript，
#   会在容器内联网现装 TypeScript，内存暴涨后被 CGroup OOM 杀掉，端口从未监听。
#   --prod=false 是显式兜底，防止构建环境里预先存在 NODE_ENV=production 时被静默裁剪。
COPY package.json pnpm-lock.yaml .npmrc ./
RUN NODE_ENV=development pnpm install --frozen-lockfile --prod=false \
 && pnpm store prune || true

# 依赖装完之后，再切到生产模式
ENV NODE_ENV=production \
    PORT=5000 \
    TZ=Asia/Shanghai \
    COZE_PROJECT_ENV=PROD

COPY --from=builder /app/.next           ./.next
COPY --from=builder /app/public          ./public
COPY --from=builder /app/dist            ./dist
COPY --from=builder /app/next.config.ts  ./next.config.ts
COPY --from=builder /app/tsconfig.json   ./tsconfig.json

# 种子数据：首次启动且数据目录为空时，由 entrypoint 复制到数据目录，
# 触发应用内置的 JSON → DuckDB 迁移，避免首次部署页面空白。
COPY --from=builder /app/data/lottery_draws.json /app/seed/lottery_draws.json

COPY docker/entrypoint.sh /usr/local/bin/entrypoint.sh
# sed 兜底：防止 Windows 检出的 CRLF 导致 sh 脚本在容器内执行失败
RUN sed -i 's/\r$//' /usr/local/bin/entrypoint.sh \
 && chmod +x /usr/local/bin/entrypoint.sh \
 && mkdir -p /app/data

EXPOSE 5000

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["node", "dist/server.js"]
