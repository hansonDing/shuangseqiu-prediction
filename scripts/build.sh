#!/bin/bash
set -Eeuo pipefail

COZE_WORKSPACE_PATH="${COZE_WORKSPACE_PATH:-$(pwd)}"

cd "${COZE_WORKSPACE_PATH}"

echo "Installing dependencies..."
pnpm install --prefer-frozen-lockfile --prefer-offline --loglevel debug --reporter=append-only

# 构建期间移开 .babelrc，构建结束后由 trap 还原。
#
# .babelrc 把 preset-react 的 development 固定为 true，会让 babel 在生产构建里
# 注入 jsxDEV，预渲染 /_not-found 时抛 "jsxDEV is not a function" 而构建失败。
# 该文件只是 react-dev-inspector 的开发期调试配置，开发模式仍需保留，故只临时移开。
BABELRC_MOVED=0
if [ -f .babelrc ]; then
  mv .babelrc .babelrc.build-bak
  BABELRC_MOVED=1
fi
restore_babelrc() {
  if [ "${BABELRC_MOVED}" = "1" ] && [ -f .babelrc.build-bak ]; then
    mv .babelrc.build-bak .babelrc
  fi
}
trap restore_babelrc EXIT

echo "Building the Next.js project..."
# --webpack 不可省略：Next 16 默认使用 Turbopack 构建，而 Turbopack 解析 duckdb 的
# package.json 时，会在 node-pre-gyp 的 "binary" 字段上 panic
# （TurbopackInternalError: missing field `napi_versions`）。属 Turbopack 缺陷，
# 与本项目代码无关，切到 webpack 即规避。
pnpm next build --webpack

echo "Bundling server with tsup..."
pnpm tsup src/server.ts --format cjs --platform node --target node20 --outDir dist --no-splitting --no-minify

echo "Build completed successfully!"
