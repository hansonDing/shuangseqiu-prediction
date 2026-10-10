# 双色球预测 · 云部署指南

> 对应文件：`Dockerfile` · `.dockerignore` · `docker/entrypoint.sh` · `docker-compose.yml` · `.gitattributes`

## 0. 结论

可以上云，但**只能用「长驻容器 + 单实例 + 持久化磁盘」这一类服务**，不能部署到 Serverless（Vercel / Netlify / 云函数 / Workers）。

## 1. 为什么不能用 Serverless

| 项目特征 | 代码位置 | 与 Serverless 的冲突 |
| --- | --- | --- |
| 自定义 Node 服务器 | `src/server.ts` → 打包为 `dist/server.js`，由 `node` 常驻 | Serverless 只接受框架约定的入口，无法常驻进程 |
| DuckDB 文件型数据库 | `src/storage/database/duckdb.ts`，落盘 `data/lottery.duckdb` | Serverless 文件系统为临时目录，冷启动即丢数据 |
| 进程内定时任务 | `src/instrumentation.ts`，`setInterval` 每 60 秒轮询 | 进程随时被回收，定时任务不会持续运行 |
| 原生模块 | `next.config.ts` 中 `serverExternalPackages: ['duckdb']` | 原生二进制在 Serverless 打包链路中难以保证可用 |

## 2. 三条部署红线（必须满足）

1. **单实例运行（副本数 = 1）**
   DuckDB 是文件锁 + 单写者模型（代码中 `serialize()` 串行化写队列）。多副本会互相锁冲突、数据错乱。**不要开自动扩缩容。**
   换用 CloudBase PG 后文件锁问题虽消失，但进程内定时任务与串行写队列仍要求单实例。

2. **持久化磁盘挂载到 `/app/data`**（仅 DuckDB 驱动需要）
   应用默认把库文件写在 `process.cwd()/data/`，容器工作目录是 `/app`，即 `/app/data`。把持久卷挂在这个路径上，数据才能跨重启保留。不要额外设置 `LOTTERY_DB_PATH`（一旦设置，内置的 JSON 迁移会被跳过）。
   **若改用 CloudBase PG 存储（`STORAGE_DRIVER=cloudbase`），数据存在云数据库里，这条红线与持久卷都不再需要**，见第 8.2 节。

3. **时区 `TZ=Asia/Shanghai`**
   定时任务用本地时间判断（周一/三/五 22:00 更新，周二/四/日 19:30 买入）。容器默认 UTC 会让任务在错误时间触发。镜像已内置 `TZ` 与 `tzdata`，平台侧如覆盖环境变量请保留该值。

## 3. 镜像构建

镜像在生产模式下运行，关键设置：

- `COZE_PROJECT_ENV=PROD` —— `src/server.ts` 以 `COZE_PROJECT_ENV !== 'PROD'` 判断是否 dev 模式。**不设置会让容器以开发模式跑 Next（慢、占内存）**，项目自带的 `scripts/start.sh` 未设置它（平台上由平台注入），因此镜像内显式固定。
- `NODE_VERSION=24` —— 与 `.coze` 中 `requires = ["nodejs-24"]` 对齐。
- duckdb 原生模块：已确认 Node 24（ABI 137）在 Linux x64 有官方预编译包 `https://npm.duckdb.org/duckdb/duckdb-v1.4.4-node-v137-linux-x64.tar.gz`，构建时会直接下载，不会触发源码编译。镜像内仍安装了 `python3/make/g++` 作为兜底。
- 依赖安装使用 `registry.npmmirror.com`（沿用项目 `.npmrc`），国内构建更快。

```bash
docker build -t shuangseqiu-prediction:latest .
```

## 4. 本地 / 单机运行

```bash
# 方式一：compose（推荐，含数据卷与健康检查）
docker compose up -d --build

# 方式二：docker run
docker run -d --name shuangseqiu \
  -p 5000:5000 \
  -e TZ=Asia/Shanghai \
  -e UPDATE_TOKEN=<你的强随机令牌> \
  -v shuangseqiu-data:/app/data \
  --restart unless-stopped \
  shuangseqiu-prediction:latest
```

访问 `http://localhost:5000`。

验证：

```bash
docker logs -f shuangseqiu
# 期望看到：Server listening at http://...:5000 as PROD
#          [LotteryCron] 定时服务已启动...
#          [DuckDB] 已从 lottery_draws.json 迁移 N 期数据

curl -s -o /dev/null -w "%{http_code}\n" http://localhost:5000        # 期望 200
docker exec shuangseqiu ls -l /app/data                               # 期望有 lottery.duckdb
```

## 5. 环境变量

| 变量 | 必填 | 默认 | 说明 |
| --- | --- | --- | --- |
| `PORT` | 否 | `5000` | 监听端口，多数平台会自动注入 |
| `TZ` | 建议 | `Asia/Shanghai` | 镜像已设置；影响定时任务触发时刻 |
| `COZE_PROJECT_ENV` | 建议 | `PROD` | 镜像已设置；非 `PROD` 会以开发模式运行 |
| `UPDATE_TOKEN` | **生产必填** | 空 | 写接口（`/api/update`、`/api/simulation/buy`、`/api/simulation/reset`）的 Bearer 令牌。为空时仅放行回环地址，经反向代理后外部调用会被拒。**不会下发到前端**；页面按钮走 `/api/update/ui` 由服务端代持转发（见 7.1） |
| `UI_UPDATE_COOLDOWN_SECONDS` | 否 | `30` | 站内「立即更新数据」按钮的冷却秒数；`0` 表示只做单飞不限频（见 7.1） |
| `LOTTERY_DB_PATH` | 否 | `<cwd>/data/lottery.duckdb` | 覆盖库路径。**一旦设置，内置 JSON 迁移会被跳过** |
| `LOTTERY_DATA_DIR` | 否 | `/app/data` | 仅 `entrypoint.sh` 使用，需与持久卷挂载点一致 |
| `STORAGE_DRIVER` | 否 | `duckdb` | 存储驱动：`duckdb`（容器内文件库）或 `cloudbase`（CloudBase PostgreSQL）。见第 8.2 节 |
| `CLOUDBASE_ENV_ID` | `cloudbase` 时必填 | 空 | CloudBase 环境 ID，如 `xingxingyingyu-xxxxxxxx` |
| `CLOUDBASE_API_KEY` | `cloudbase` 时必填 | 空 | 云开发 API Key，映射 PG 的 `service_role`（具备 `BYPASSRLS`）。**等同数据库权限，只能放服务端**，切勿提交进仓库或暴露给前端 |
| `CLOUDBASE_API_BASE` | 否 | 按 `CLOUDBASE_ENV_ID` 推导 | 覆盖 PostgREST 网关基址，用于内网 / 代理场景 |
| `ENABLE_INTERNAL_CRON` | 否 | `true` | 进程内定时调度开关；设为 `false` 改由平台定时触发器驱动（见第 7 节） |
| `CRON_GRACE_MINUTES` | 否 | `60` | 补跑宽限窗口（分钟）；`0` 表示只认准点、不补跑 |
| `CRON_MAX_ATTEMPTS` | 否 | `5` | 单个任务单日最大尝试次数 |
| `SIMULATE_INITIAL_CAPITAL` | 否 | `100000` | 模拟盘初始资金 |
| `SIMULATE_BET_COUNT` | 否 | `10` | 每次买入注数 |
| `SIMULATE_BET_COST` | 否 | `2` | 单注金额 |
| `SIMULATE_PRIZE_FIRST` | 否 | `5000000` | 一等奖估算奖金 |
| `SIMULATE_PRIZE_SECOND` | 否 | `200000` | 二等奖估算奖金 |

## 6. 首次启动的数据初始化

持久卷首次挂载为空。`docker/entrypoint.sh` 会按以下顺序处理：

1. 库文件 `lottery.duckdb` 已存在 → 直接启动，不动数据；
2. 目录内已有 `lottery_draws.json` → 交给应用迁移；
3. 两者都没有 → 把镜像内置种子（`/app/seed/lottery_draws.json`）复制到数据目录，应用启动时自动迁移历史开奖数据；
4. 目录不可写 → 打日志告警，以空库启动。

**空库补救方式**：手动触发一次数据抓取（会从 500.com 拉取并入库）：

```bash
curl -X POST -H "Authorization: Bearer <UPDATE_TOKEN>" http://<你的域名>/api/update
```

## 7. 定时任务

调度方式有两种，**任选其一，也可以先用进程内调度、之后平滑切换**。

### 方式 A：进程内调度（默认，无需额外配置）

`src/instrumentation.ts` 常驻轮询，到点后 `POST` 本机对应接口。只要容器常驻即可工作。

- `CRON_GRACE_MINUTES`（默认 60）为**补跑窗口**：到点后若容器正好在重启 / 短暂宕机，仍会在窗口内追平当天错过的任务，而不是直接跳过。设为 `0` 可恢复「只认准点那一分钟」的严格行为。
- 失败会按 `CRON_MAX_ATTEMPTS`（默认 5）在窗口内重试；鉴权失败（401/403）不重试。
- 启动后延迟 15 秒做首次检查，确保 HTTP 服务已就绪。

### 方式 B：平台定时触发器（更可靠）

由平台的定时任务直接请求接口，不依赖应用进程存活。**配置后请设置 `ENABLE_INTERNAL_CRON=false`**，关闭进程内调度，避免重复触发。

| 任务 | 建议时间（Asia/Shanghai） | 方法 | 地址 |
| --- | --- | --- | --- |
| 开奖数据更新 | 周一/三/五 22:00 | `POST` | `/api/update` |
| 模拟盘买入 | 周二/四/日 19:30 | `POST` | `/api/simulation/buy` |

对应的 cron 表达式：

```cron
# 开奖数据更新：周一/三/五 22:00
0 22 * * 1,3,5
# 模拟盘买入：周二/四/日 19:30
30 19 * * 2,4,0
```

请求头必须携带令牌（否则经网关后会被判为未授权）：

```
Authorization: Bearer <UPDATE_TOKEN>
```

配置要点：

1. 平台定时任务的**时区要选 `Asia/Shanghai`**（UTC 会错时）；
2. 方法选 `POST`（这两个接口不接受 GET 触发；GET `/api/update` 只用于查询上次更新状态）；
3. `UPDATE_TOKEN` 必须是同一个值；
4. 平台侧超时建议 ≥ 60 秒（数据抓取含外部请求）。

### 关于重复触发是否安全

两个接口都是幂等或带守卫的，所以迁移过程中「进程内调度 + 平台触发」短暂并存也不会出问题：

- `/api/update`：已入库的期号会跳过（`upsertDraws` 按 period 去重）；
- `/api/simulation/buy`：检测到存在未结算持仓即跳过，且整个写入包在事务内（`serialize()` + `tx()`）。

因此可以先用方式 A 上线，再逐步切到方式 B，中间无需停机。

### 7.1 站内「立即更新数据」按钮：UI 通道

页面上的「立即更新数据」按钮**不能**直接调 `/api/update`。

原因：该接口只认 `Authorization: Bearer <UPDATE_TOKEN>` 或回环地址。浏览器里的按钮既拿不到也不该拿到令牌 —— 令牌写进前端等于公开。所以本地能点、一部署到公网就必然 401：

```
未授权：请从本机触发，或配置 UPDATE_TOKEN 后携带 Bearer token
```

因此站内按钮走 `POST /api/update/ui` 这条独立通道，它的做法是**服务端转发**：

```
浏览器 → /api/update/ui（无令牌）→ 服务端补上 Bearer → /api/update → 抓取并入库
```

好处是令牌不进浏览器，而更新流程仍然只有 `/api/update` 一份实现（`GET /api/update` 的最近更新状态也照常反映，不会出现两套状态）。

这条通道是公网可达的，所以内建两道约束：

| 约束 | 行为 |
| --- | --- |
| **同源校验** | 优先看 `Sec-Fetch-Site`（浏览器生成、脚本无法伪造、不受反代改写 Host 影响），只有 `same-origin` 放行；该头缺省时回退比对 `Origin`/`Referer` 与 `Host`。跨站调用返回 `403 拒绝跨站调用` |
| **单飞 + 冷却** | 已有任务在执行 → `409`；冷却期内重复点击 → `429 操作过于频繁，请 N 秒后再试`。冷却秒数由 `UI_UPDATE_COOLDOWN_SECONDS` 控制，`0` 表示只做单飞不限频 |

**边界**：站内共三条同构通道，写法与约束完全一致，只是目标不同：

| 按钮 | 站内通道 | 转发到 | 冷却变量（默认） |
| --- | --- | --- | --- |
| 立即更新数据 | `POST /api/update/ui` | `/api/update` | `UI_UPDATE_COOLDOWN_SECONDS`（30s） |
| 立即买入 | `POST /api/simulation/buy/ui` | `/api/simulation/buy` | `UI_BUY_COOLDOWN_SECONDS`（10s） |
| 重置账本 | `POST /api/simulation/reset/ui` | `/api/simulation/reset` | `UI_RESET_COOLDOWN_SECONDS`（10s） |

三者共用骨架 `src/lib/internal-proxy.ts`（同源校验 + 单飞 + 冷却 + 回环转发 + 令牌代持），各路由只声明「目标路径 + 冷却秒数 + 失败响应形状」。

买入另有业务自身的兜底：`buyPredictions` 检测到已有未结算持仓即跳过，且写入包在事务里，重复触发不会重复下单。重置是破坏性操作，前端保留 `window.confirm` 二次确认。

写接口本身（`/api/update`、`/api/simulation/buy`、`/api/simulation/reset`）**仍是严格 token-only** —— 平台定时触发器与运维脚本继续直接调用它们，`/ui` 只是给浏览器按钮加的一层代理。

> 注意：该通道按设计无法区分「同一个人点第二次」与「另一个人点第一次」，所以它是节流而不是鉴权。若你希望按钮也受凭证保护，把 `UI_UPDATE_COOLDOWN_SECONDS` 调大、或在前置网关对该路径加访问控制即可。

## 8. 平台适配

需同时满足：**长驻容器 + 持久卷挂载 + 单副本**。

- 可用：腾讯云 TKE / ECS、阿里云 ECS / SAE（需挂 NAS）、CloudBase 云托管（需支持挂载文件存储）、Railway（Volume）、Render（Disk）、Zeabur（Volume）、Fly.io（Volume）、自建 VPS + Docker。
- 不可用：Vercel、Netlify、云函数 SCF、Cloudflare Workers。

部署通用四步：

1. 构建并推送镜像到平台镜像仓库（或用平台「源码构建」直接指向仓库根目录的 `Dockerfile`）；
2. 配置持久卷挂载到 `/app/data`；
3. 配置环境变量 `TZ`、`UPDATE_TOKEN`、`COZE_PROJECT_ENV=PROD`，副本数固定 1；
4. 开放 5000 端口并配置域名（HTTPS 由平台网关终止）。

> 平台是否支持持久卷以其当前能力为准。若目标平台无持久卷，备选方案是把数据层从 DuckDB 换成托管数据库（需改 `src/storage/database/`），或定期把 `/app/data` 备份到对象存储。

### 8.1 腾讯云专项

腾讯云上有三类产品能跑本文档这套镜像，区别核心在于**数据最终落在什么存储上**。

| 方案 | 持久化存储类型 | 适配度 | 说明 |
| --- | --- | --- | --- |
| 轻量应用服务器 Lighthouse / CVM 云服务器 | 系统盘 / 云硬盘（块存储） | **推荐** | 直接 `docker compose up -d --build`。单机天然单实例，磁盘持久，时区与端口完全自控 |
| 容器服务 TKE | 云硬盘 CBS（PVC，ReadWriteOnce） | 推荐 | 单副本 StatefulSet + PVC。块存储符合 DuckDB 要求，代价是要维护集群 |
| CloudBase 云托管（CloudBase Run） | 文件存储 CFS（NFS） | **谨慎** | 容器化最省事，但 CFS 是 NFS，与 DuckDB 官方建议冲突 |

#### 为什么不首选「云托管 + CFS」

DuckDB 官方文档（Environment 一节）明确警告：

> Avoid running DuckDB in read-write mode on network-attached storage. These setups include NFS...

原文说明，在 NAS/NFS 上以**读写**模式运行 DuckDB 会出现「性能缓慢且不可预测」以及「由底层文件系统引起的异常错误」。而云托管的持久化方案 CFS 正是 NFS 协议（挂载点允许 `/app/data`，禁挂目录仅为 `/`、`/proc`、`/sys`、`/dev`、`/var/run`、`/app/cert`，所以**技术上挂得上，但不建议**）。

结论：若坚持用云托管，建议先把数据层从 DuckDB 换成托管数据库（改 `src/storage/database/`），否则数据可靠性没有保障。本项目数据量小、可重建，属可接受风险，但需自行承担。

#### 若仍要部署到云托管

官方文档明确的硬约束：

1. **必须锁死实例数为 1**。不要用「低成本模式」——它连续 30 分钟无流量即缩容到 0，定时任务会随之消失。官方对「用云托管处理定时任务」的要求是：放弃自动扩缩容，最小与最大实例数都设为 1。
2. **需要持久化时配置 CFS 挂载**：先启用私有网络，在**上海地域**（云开发环境所在地域）准备 VPC、子网与 CFS 文件系统，再把实例挂载路径设为 `/app/data`。
3. **套餐门槛**：套餐能力表中「云托管 · 连接腾讯云 VPC」个人版不支持、标准版起支持，而挂载 CFS 依赖私有网络，因此该组合通常需**标准版**及以上；下单前请在控制台确认。
4. **额度提醒**：免费体验版每月仅 3,000 资源点（约合 ¥3），且不支持资源包与按量付费。云托管常驻 1 个实例的按量计费基本会超出此额度，需升级付费套餐。同一环境的资源点由该环境内所有业务共用，建议为本项目**单独开环境**，不要与已有业务混用。
5. **监听端口**：镜像默认 `PORT=5000`，应用读取该变量。把云托管服务端口设为 5000，或交由平台注入 `PORT`，两者取其一即可。
6. **定时任务建议保持方式 A（进程内调度）**：云托管没有内置 cron，云函数定时触发器当前仍为内测能力。锁死 1 实例后，`instrumentation.ts` 的补跑窗口正好能覆盖实例重建期间错过的任务。

#### 镜像仓库

云托管的镜像走 **TCR 个人版，无额外费用**：创建服务时系统自动创建同名仓库（命名空间以 `tcb` 开头，格式为 `环境id_服务名`），无需自行准备仓库，推送地址形如 `ccr.ccs.tencentyun.com/tcb-xxx/xxx:tag`。若控制台报「镜像仓库数量超限」，去 TCR 控制台「广州地域 → 个人版共享实例」清理无用仓库。

#### 最省事的路径（有云服务器时）

```bash
# 在 Lighthouse / CVM 上
git clone <你的仓库地址> && cd shuangseqiu-prediction
docker compose up -d --build
docker logs -f shuangseqiu
```

系统盘即持久化，无需额外挂载；安全组放行 5000，或前置 Nginx / Caddy 反代到 443（此时 `UPDATE_TOKEN` 必须设置，理由见第 5 节）。

### 8.2 数据层选型：DuckDB 还是 CloudBase PostgreSQL

存储层已抽象为驱动接口（`src/storage/database/driver.ts`），仓库层不写 SQL，同一套业务逻辑可跑在两种后端上，用 `STORAGE_DRIVER` 切换：

| | `duckdb`（默认） | `cloudbase` |
| --- | --- | --- |
| 数据位置 | 容器内文件 `data/lottery.duckdb` | CloudBase PostgreSQL 的 `public.lottery_*` 表 |
| 持久化 | 必须挂持久卷到 `/app/data` | 无需持久卷，容器可无状态 |
| 事务实现 | `BEGIN` / `COMMIT` | PostgreSQL 函数（RPC），一次调用一个事务 |
| 适用场景 | 本地开发、单机 / CVM 部署 | 云托管等无状态容器平台 |

**切换方式**：设置 `STORAGE_DRIVER=cloudbase` 并提供 `CLOUDBASE_ENV_ID` 与 `CLOUDBASE_API_KEY` 即可，业务代码无需改动。

#### 为什么事务要下沉到数据库函数

CloudBase PG 的服务端访问通道是 PostgREST HTTP API，而它是「一次一表」的无状态接口，**跨请求没有事务边界**。买入（写批次 + 注单 + 扣款 + 资金流水 + 日志）与结算都是多步写入，中途失败会留下「注单写了但没扣款」这类脏状态。因此把事务性下沉为三个 PostgreSQL 函数，一次 RPC 调用即一个事务：

| 函数 | 作用 |
| --- | --- |
| `lottery_commit_buy(jsonb)` | 写预测批次 + 全部注单 + 扣款 + 资金流水 + 操作日志，返回 `runId`；事务内复核「已有未结算持仓」守卫，违反则整体回滚 |
| `lottery_commit_settlement(jsonb)` | 写结算明细 + 标记注单已结算 + 入账奖金 + 资金流水 + 净值快照 + 操作日志 |
| `lottery_reset_ledger(jsonb)` | 清空模拟盘全部数据并把资金恢复初始资本 |

业务计算（走势预测 `predict`、中奖判定 `judgeTicket`）仍留在 JS 侧，函数只负责持久化与一致性。

#### 迁移（表结构与函数）

迁移文件位于 `cloudbase/migrations/`，用 CloudBase CLI 或 MCP 应用：

```bash
tcb db pg migration up
```

| 版本 | 内容 |
| --- | --- |
| `20261008134000_lottery_schema` | 8 张表 + 索引，并开启 RLS（不建策略） |
| `20261008134100_lottery_functions` | 3 个事务函数 + 授予 `service_role` 执行权限 |

**表名带 `lottery_` 前缀**：CloudBase PG 的 `public` schema 由同一环境内所有业务共用，`account` / `draws` 这类通用名容易与其他业务撞车。DuckDB 驱动沿用无前缀表名（独立文件库无冲突可能），差异由驱动层吸收。

**权限模型**：只允许服务端访问。表已 `ENABLE ROW LEVEL SECURITY` 且**刻意不建任何策略** —— `anon` / `authenticated` 一律被拒；`service_role`（API Key 映射）具备 `BYPASSRLS`，不受影响。

#### 已知限制：PG 协议直连尚未开放

CloudBase 文档描述了「服务端直连」（`pg` 驱动 + `PGHOST`/`PGUSER` 等）能力，但**控制台目前尚未提供这组连接参数**（社区 issue #1297、#1237 中官方回复「直连能力等待后续功能更新」）。因此当前实现走 PostgREST + RPC 通道 —— 好处是不依赖 VPC，从云托管、CVM 乃至本地都能访问；代价是每次查询一次 HTTP 往返。

待直连开放后，可新增一个 `pg` 驱动（SQL 与原 DuckDB 实现几乎一致），驱动接口无需变动。

#### 迁移文件路径须知

CloudBase CLI 与 MCP 按**当前工作目录**解析 `cloudbase/migrations/`。本会话的工作目录是工作区根（`D:\DN\workspace\shuangseqiu`），而 git 仓库根是其下的 `shuangseqiu-prediction`，故同一份迁移会存在两处副本。**两处必须保持字节一致**，否则再次应用会因校验和不匹配而失败（`LOCAL_MIGRATION_FILE_MISMATCH`）。仓库内的副本随代码发布、作为源，应用后用 `cp` 同步到工作区根。

### 8.3 CloudBase 云托管实操（无需本地 Docker）

云托管支持**源码构建**：把代码目录打包上传，平台侧构建镜像。因此本机没装 Docker 也能部署。

**关键：不能直接上传项目根目录。** `node_modules` 有 757 MB、`.next` 有 361 MB，上传会非常慢。先做一个干净暂存目录（源码约 1.6 MB）：

```bash
SRC=".../shuangseqiu-prediction"; DST=".../cloudrun"
rm -rf "$DST"; mkdir -p "$DST"
cd "$SRC"
tar -cf - \
  --exclude=node_modules --exclude=.next --exclude=dist --exclude=.git \
  --exclude='data/*.duckdb' --exclude='*.log' --exclude=.babelrc \
  . | ( cd "$DST" && tar -xf - )
```

> `.babelrc` 必须排除，原因见下面第 2 条。

部署参数（本项目实际使用的值）：

| 项 | 值 | 说明 |
| --- | --- | --- |
| 服务名 | `shuangseqiu` | 决定默认域名前缀 |
| 上传目录 | 上面的 `cloudrun` | 含 `Dockerfile` |
| 端口 | `5000` | 必须与 `PORT` 一致，否则健康检查永远失败 |
| 实例数 | `MinNum=1` / `MaxNum=1` | 进程内定时任务依赖常驻进程；**不要开自动扩缩容** |
| 规格 | `Cpu=0.25` / `Mem=0.5`（GB） | 内存必须为 CPU 的 2 倍 |
| 访问 | `OpenAccessTypes=["PUBLIC"]` | 分配公网域名 |
| 健康检查延迟 | `InitialDelaySeconds=90` | 给 Next 启动留时间 |

环境变量（`EnvParams`）：`STORAGE_DRIVER=cloudbase`、`CLOUDBASE_ENV_ID`、`CLOUDBASE_API_KEY`、`UPDATE_TOKEN`、`COZE_PROJECT_ENV=PROD`、`ENABLE_INTERNAL_CRON=true`、`CRON_GRACE_MINUTES=60`。

**域名格式**：`https://<服务名>-<随机串>-<appid>.sh.run.tcloudbase.com/`，另有 `https://<服务名>-<环境ID>-<appid>.ap-shanghai.run.wxcloudrun.com/`。创建服务时自动分配，无需备案即可访问。

#### 三个会让部署失败的坑（均已修复）

**1) Turbopack 无法构建本项目 → 必须 `--webpack`**

Next 16 默认用 Turbopack 构建。Turbopack 解析 duckdb 包的 `package.json` 时，会对 node-pre-gyp 的 `binary` 字段做反序列化并要求 `napi_versions`，而 duckdb 未提供该字段：

```
TurbopackInternalError: missing field `napi_versions` at line 17 column 3
  at binary  → "binary": { ... } at package.json:13-17
Execution of <NodePreGypConfigReference as ModuleReference>::resolve_reference failed
```

这是 Turbopack 自身缺陷，与本项目代码无关（移开 `.babelrc` 后同样 panic）。改用 `pnpm next build --webpack` 即规避。

**2) `.babelrc` 必须排除出生产构建**

该文件把 `preset-react.development` 固定为 `true`，会让 babel 在生产构建里注入 `jsxDEV`：

```
Error occurred prerendering page "/_not-found"
TypeError: (0 , e.jsxDEV) is not a function
```

它只服务于 `react-dev-inspector` 的开发期调试（见 `src/app/layout.tsx`），生产不需要。镜像侧已通过 `.dockerignore` 排除且不再 `COPY`；`scripts/build.mjs` / `build.sh` 则在构建期临时移开、结束后还原，开发模式不受影响。

**3) `NODE_ENV=production` 不能出现在 `pnpm install` 之前**

pnpm 会读取 `NODE_ENV`，若安装时已是 `production` 就**整体跳过 devDependencies**，而 `typescript` 恰在其列。缺了它，Next 启动时发现 `next.config.ts` 是 TS 配置却没有编译器，会**在容器里联网现装 TypeScript**：

```
⚠ Installing TypeScript as it was not found while loading "next.config.ts".
Installing devDependencies (pnpm): - typescript
```

后果是内存暴涨、被 CGroup OOM 杀掉、端口从未监听：

```
CGroup OOM encountered, victim process: MainThread, pid: 1735, 2089, 2312, ...
Liveness probe failed: dial tcp 10.23.16.70:5000: connect: connection refused
```

Dockerfile 已把依赖安装提到 `NODE_ENV=production` 之前，并加 `--prod=false` 显式兜底。

#### 部署状态判读

`queryCloudRun(action="getDeployRecords")` 的状态含义：

| 状态 | 含义 |
| --- | --- |
| `creating` | 构建中（依赖安装 + Next 构建 + 打镜像，约 5 分钟） |
| `build_failed` | 镜像没构建出来，看 `getDeployLog`（构建日志） |
| `deploy_failed` | **镜像构建成功**，但容器启动/健康检查失败，看 `getProcessLog`（运行日志） |
| `success` | 部署完成且已分配流量 |

区分 `build_failed` 与 `deploy_failed` 很关键：前者查构建日志，后者查运行日志，能直接定位到是「代码构建问题」还是「启动/资源问题」。

#### 重新部署

改完代码后，重新生成暂存目录并再次触发部署即可（服务配置会被读取后合并保留，不会丢失环境变量）：

```bash
# 重新打包到 cloudrun，然后调用 manageCloudRun(action="deploy", serverName="shuangseqiu", targetPath=".../cloudrun")
```

## 9. 常见问题

| 现象 | 原因与处理 |
| --- | --- |
| 重启后数据回到初始状态 | 持久卷没挂到 `/app/data`，或挂到了别处。检查 `docker exec <c> ls -l /app/data` |
| 页面能开但没有开奖数据 | 空库且种子未导入。手动 `POST /api/update`，或检查容器日志里的 entrypoint 提示 |
| 点「立即更新数据」提示「未授权：请从本机触发…」 | 按钮还在直连 `/api/update`。前端应改为 `/api/update/ui`，由服务端代持令牌转发（见 7.1）。若确认代码已改，检查是否部署了最新镜像 |
| 点「立即买入」提示「未授权：请从本机触发…」 | 按钮还在直连 `/api/simulation/buy`。前端应改为 `/api/simulation/buy/ui`（见 7.1） |
| 点「重置账本」提示「未授权…」 | 同上，通道为 `/api/simulation/reset/ui`（见 7.1） |
| 点按钮提示「操作过于频繁」 | 命中 UI 通道冷却（默认 30 秒）。等提示的秒数后重试，或把 `UI_UPDATE_COOLDOWN_SECONDS` 调小 / 设为 `0` |
| 点按钮提示「拒绝跨站调用」 | 请求的 `Sec-Fetch-Site` 不是 `same-origin`，或 `Origin`/`Referer` 与 `Host` 不一致。多为反代改写了 Host 且浏览器未发 `Sec-Fetch-Site`（旧版 Safari）；确认代码为最新版本 |
| 写接口返回 401/403 | 未设置 `UPDATE_TOKEN`，且请求来自非回环地址（经网关后 `x-forwarded-for` 不是回环）。设置令牌并用 `Authorization: Bearer <token>` 调用 |
| 定时任务时间不对 | 容器时区为 UTC。确认 `TZ=Asia/Shanghai`，且镜像内已装 `tzdata`（本镜像已装） |
| 构建卡在 duckdb 编译很久 | 预编译包下载失败，走了源码编译兜底。检查构建机能否访问 `npm.duckdb.org`，或用 `--build-arg NODE_VERSION=22`（ABI 127 亦有预编译包） |
| 日志显示 `as development` | `COZE_PROJECT_ENV` 不是 `PROD`，被环境变量覆盖了。恢复为 `PROD` |
| 数据目录权限报错 | 绑定挂载（宿主目录）时，宿主机目录对容器内用户不可写。用命名卷，或 `chown` 宿主目录 |

| 定时任务不执行 | 检查 `ENABLE_INTERNAL_CRON`：若已设为 `false`，必须配好平台定时触发器，否则无人驱动。日志会明确提示采用哪种模式 |
| 容器重启后立刻触发了一次任务 | 正常：`CRON_GRACE_MINUTES` 补跑窗口在追平当天错过的任务。想严格只在准点执行，设为 `0` |
| 日志出现 `鉴权失败，请检查 UPDATE_TOKEN` | 平台触发器未带 `Authorization: Bearer` 头，或令牌与 `UPDATE_TOKEN` 不一致 |
| 云托管部署报 `build_failed` | Next 构建失败。若报 `missing field napi_versions`，是 Turbopack 缺陷，确认用了 `next build --webpack`；若报 `jsxDEV is not a function`，确认 `.babelrc` 已排除出构建（见 8.3） |
| 云托管部署报 `deploy_failed` + `CGroup OOM` | 内存被撑爆。首要排查容器内是否在运行期安装依赖（见 8.3 第 3 条）；若确为正常启动仍 OOM，把规格提到 `Cpu=0.5 / Mem=1` |
| 云托管健康检查一直 `connection refused` | 应用监听的端口与服务平台配置的 `Port` 不一致，或启动即崩溃。核对 `Port=5000`，再看 `getProcessLog` |
| 上传源码包极慢 | 把 `node_modules`（757 MB）/`.next`（361 MB）一起打包了。按 8.3 用排除式打包，源码应约 1.6 MB |

## 10. 上线检查清单

- [ ] 副本数 = 1，未开启自动扩缩容
- [ ] 存储驱动已定：`STORAGE_DRIVER=duckdb` 且持久卷挂到 `/app/data`（重启后数据仍在），**或** `STORAGE_DRIVER=cloudbase` 且迁移已应用、`CLOUDBASE_ENV_ID` 与 `CLOUDBASE_API_KEY` 已配置
- [ ] 若用 CloudBase PG：`public.lottery_*` 迁移已应用，且表为 RLS 开启、策略数 0
- [ ] `TZ=Asia/Shanghai`、`COZE_PROJECT_ENV=PROD` 生效（日志显示 `as PROD`）
- [ ] `UPDATE_TOKEN` 已设置为强随机值
- [ ] 首页返回 200，定时任务日志出现（`[LotteryCron] 定时服务已启动` 或 `已禁用…请由平台定时触发器调用`）
- [ ] 已明确定时任务由谁驱动：进程内调度（保持 `ENABLE_INTERNAL_CRON=true`）**或**平台触发器（设为 `false` 并已配置两个定时任务）
- [ ] 已确认无开奖数据时的手动抓取路径可用（`POST /api/update`）
- [ ] 页面上点「立即更新数据」「立即买入」「重置账本」都能成功（验证三条 UI 通道与服务端令牌转发链路，见 7.1）
