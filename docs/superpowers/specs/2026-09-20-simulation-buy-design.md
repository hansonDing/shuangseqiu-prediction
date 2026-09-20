# 双色球预测系统 · 模拟买入功能设计文档

- 日期：2026-09-20
- 状态：已获需求方批准，待实施
- 背景项目：Next.js 16 + shadcn/ui 的双色球分析预测系统（本地单机运行）

## 1. 需求概述

在现有系统上增加**模拟买入（模拟盘）**功能：

1. 每周二、四、日 **19:30**（开奖日前，开奖时间为 21:15）自动执行预测并**买入 10 注**（每注 2 元，每次投入 20 元）
2. **初始资金 10 万元**，资金不足时不买入并记录原因
3. 每次开奖结果入库后，按实际开奖号对未结算持仓**自动结算**，计算收益
4. 前端提供"模拟盘"页面展示资金、持仓、历史结算与收益曲线
5. 全部数据使用 **DuckDB** 本地数据库存储

### 已确认的决策

| 议题 | 决策 |
|---|---|
| 浮动奖（一、二等奖）结算 | 固定估算值：一等奖 500 万、二等奖 20 万，环境变量 `SIMULATE_PRIZE_FIRST` / `SIMULATE_PRIZE_SECOND` 可调，按下单时 snapshot 计入 |
| 10 注来源 | `predict()` 引擎参数化（注数可调），模拟盘独立生成 10 注，不影响页面展示的 8 注 |
| 错过定时任务（如关机） | **只补结算、不补买**：下次数据更新时按已入库的历史开奖号自动补结；错过的期数不追买 |
| 回测结果存档 | 暂不做（YAGNI），未来需要调参对比时再加 `backtest_runs` |

## 2. 总体架构

沿用现有"本地单机 + 进程内调度"架构，新增/修改的组件：

```
src/
├── lib/
│   ├── lottery-engine.ts        # 修改：predict() 增加注数参数（默认 8，向后兼容）
│   └── simulation-engine.ts     # 新增：纯函数结算引擎（奖级判定、奖金计算）
├── storage/database/
│   ├── duckdb.ts                # 新增：DuckDB 连接单例 + 建表 + JSON 迁移
│   ├── draw-repository.ts       # 新增：替代 local-store.ts，对上层暴露同名接口
│   └── simulation-repository.ts # 新增：模拟盘全部读写（买入/结算/查询/重置）
├── app/api/
│   ├── simulation/route.ts      # 新增：GET 状态查询
│   ├── simulation/buy/route.ts  # 新增：POST 触发买入（定时器调用）
│   └── simulation/reset/route.ts# 新增：POST 重置账本
└── instrumentation.ts           # 修改：调度器扩展为多任务表，新增 19:30 买入任务
```

**方案选型**：本地 DuckDB 嵌入式存储（`duckdb` npm 官方包，预编译二进制）。
未选：Supabase/远程库（YAGNI，单机场景无必要）；JSON 账本（无法 SQL 聚合分析，违背本次存储升级目的）。

## 3. 数据库设计（DuckDB）

数据文件：`data/lottery.duckdb`。启动时 `CREATE TABLE IF NOT EXISTS`，首次若 `draws` 为空且 `data/lottery_draws.json` 存在则自动导入迁移（JSON 文件保留不删，作天然备份）。

### 3.1 表清单（8 张表 + 说明）

| # | 表名 | 用途 |
|---|---|---|
| 1 | `draws` | 历史开奖（替代 JSON 存储） |
| 2 | `prediction_runs` | 每期预测记录（权重、10 注、浮动奖估算快照） |
| 3 | `bets` | 每注买入记录 |
| 4 | `settlements` | 结算表，一注一条 |
| 5 | `equity_snapshots` | 每期结算后资金快照（收益曲线数据源） |
| 6 | `account` | 资金账户单行表（缓存 + 初始资金配置） |
| 7 | `fund_transactions` | 资金流水（买入扣款/中奖入账/重置） |
| 8 | `operation_log` | 操作日志（调度决策、跳过原因、错误） |

### 3.2 建表语句

```sql
CREATE TABLE IF NOT EXISTS draws (
  period      VARCHAR PRIMARY KEY,          -- 7 位期号，如 '2026108'
  draw_date   VARCHAR,                      -- 官方开奖日 'YYYY-MM-DD'
  red1 SMALLINT, red2 SMALLINT, red3 SMALLINT,
  red4 SMALLINT, red5 SMALLINT, red6 SMALLINT,
  blue SMALLINT,
  created_at  TIMESTAMP DEFAULT now()       -- 本系统入库时间（区别于官方开奖日）
);

CREATE TABLE IF NOT EXISTS prediction_runs (
  id           BIGINT PRIMARY KEY,          -- 自增
  period       VARCHAR NOT NULL,            -- 目标期号（当晚开奖的那期）
  weights      VARCHAR NOT NULL,            -- JSON：{frequency, recency, balance}
  combos       VARCHAR NOT NULL,            -- JSON：[{reds:[..6..], blue, score, reason}]
  prize_first  BIGINT NOT NULL,             -- 下单时一等奖估算值（结算口径快照）
  prize_second BIGINT NOT NULL,             -- 下单时二等奖估算值
  created_at   TIMESTAMP DEFAULT now()
);

CREATE TABLE IF NOT EXISTS bets (
  id         BIGINT PRIMARY KEY,
  run_id     BIGINT NOT NULL REFERENCES prediction_runs(id),
  period     VARCHAR NOT NULL,              -- 目标期号
  reds       VARCHAR NOT NULL,              -- JSON：[1..33] 6 个，升序
  blue       SMALLINT NOT NULL,
  cost       DECIMAL(10,2) NOT NULL,        -- 固定 2.00
  status     VARCHAR NOT NULL DEFAULT 'pending',  -- pending / settled
  created_at TIMESTAMP DEFAULT now()
);

CREATE TABLE IF NOT EXISTS settlements (
  id         BIGINT PRIMARY KEY,
  bet_id     BIGINT NOT NULL REFERENCES bets(id),
  period     VARCHAR NOT NULL,
  red_hits   SMALLINT NOT NULL,             -- 命中红球数 0-6
  blue_hit   BOOLEAN NOT NULL,
  prize_tier SMALLINT NOT NULL,             -- 0=未中, 1..6=一..六等奖
  prize      DECIMAL(12,2) NOT NULL,        -- 奖金（0 表示未中）
  profit     DECIMAL(12,2) NOT NULL,        -- prize - cost
  settled_at TIMESTAMP DEFAULT now()
);

CREATE TABLE IF NOT EXISTS equity_snapshots (
  period        VARCHAR PRIMARY KEY,        -- 已结算的期号（一期一行）
  cash          DECIMAL(14,2) NOT NULL,
  total_invested DECIMAL(14,2) NOT NULL,
  total_prize   DECIMAL(14,2) NOT NULL,
  cum_profit    DECIMAL(14,2) NOT NULL,
  roi           DOUBLE NOT NULL,            -- cum_profit / total_invested
  created_at    TIMESTAMP DEFAULT now()
);

CREATE TABLE IF NOT EXISTS account (
  id              SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),  -- 单行约束
  initial_capital DECIMAL(14,2) NOT NULL,   -- 100000.00
  cash            DECIMAL(14,2) NOT NULL,
  total_invested  DECIMAL(14,2) NOT NULL,
  total_prize     DECIMAL(14,2) NOT NULL,
  updated_at      TIMESTAMP DEFAULT now()
);

CREATE TABLE IF NOT EXISTS fund_transactions (
  id            BIGINT PRIMARY KEY,
  type          VARCHAR NOT NULL,           -- buy / prize / reset
  amount        DECIMAL(12,2) NOT NULL,     -- 带符号：buy 为负，prize 为正
  balance_after DECIMAL(14,2) NOT NULL,
  ref_id        BIGINT,                     -- 关联 bet_id 或 settlement_id
  note          VARCHAR,
  created_at    TIMESTAMP DEFAULT now()
);

CREATE TABLE IF NOT EXISTS operation_log (
  id         BIGINT PRIMARY KEY,
  type       VARCHAR NOT NULL,              -- buy / settle / reset / skip / error
  message    VARCHAR NOT NULL,
  detail     VARCHAR,                       -- JSON 附加信息
  created_at TIMESTAMP DEFAULT now()
);
```

## 4. 结算规则（simulation-engine.ts，纯函数）

单注奖级判定（与官方规则一致）：

| 奖级 | 条件 | 奖金 |
|---|---|---|
| 一等奖 | 6 红 + 蓝 | `prize_first`（默认 5,000,000，环境变量可调） |
| 二等奖 | 6 红 + 无蓝 | `prize_second`（默认 200,000） |
| 三等奖 | 5 红 + 蓝 | 3,000 |
| 四等奖 | 5 红 或 4 红 + 蓝 | 200 |
| 五等奖 | 4 红 或 3 红 + 蓝 | 10 |
| 六等奖 | 蓝（含 0/1/2 红 + 蓝） | 5 |
| 未中 | 其他 | 0 |

判定优先级自上而下。`judgeTicket(reds, blue, actualReds, actualBlue) → { tier, prize }`。
`settleHolding(runId, actualDraw)` 逐注结算并汇总：`{ totalPrize, totalCost, profit, details }`。

## 5. 核心流程

### 5.1 定时买入（周二/四/日 19:30）

```
instrumentation 调度器 → POST /api/simulation/buy
  1. 鉴权（回环 / UPDATE_TOKEN，与 /api/update 同一套）
  2. 读取 account；存在 status='pending' 的持仓 → 记 operation_log(skip) 并返回
  3. cash < 20 → 记 operation_log(skip, 资金不足) 并返回
  4. 推算目标期号：由最新一期 draw_date 顺推到下一个周二/四/日（+1/+2/+3 天）得下期开奖日 D；
     若 D 与最新期同年则目标期号 = 最新期号 + 1，否则目标期号 = `<D.year>001`（跨年重置，纯文本 +1 会在跨年处出错）
  5. predict(draws, weights, 10) 生成 10 注
  6. 事务：写 prediction_runs + 10 条 bets + account 扣款 + fund_transactions(buy) + operation_log(buy)
```

### 5.2 自动结算（数据更新后）

```
/api/update 同步到新数据后 → settlePending()
  1. 查 bets status='pending'，逐持仓取其 period
  2. period 对应开奖号已在 draws 表 → 对该 run 的 10 注逐注 judgeTicket
  3. 事务：写 settlements + bets.status='settled' + account 入账
     + fund_transactions(prize) + equity_snapshots(该期) + operation_log(settle)
  4. period 无对应开奖号 → 保持挂起，下次重试（"只补结算"天然实现：
     关机错过的期数，在下次 update 拉齐历史数据后自动补结）
```

### 5.3 重置

`POST /api/simulation/reset`：事务内清 `prediction_runs/bets/settlements/equity_snapshots/fund_transactions/operation_log`，`account` 还原为初始资金，`fund_transactions` 写入一条 `reset` 流水，`operation_log` 写入 `reset` 记录。

## 6. API 设计

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/simulation` | 账户概览、当前持仓、历史 settlements（分页）、equity_snapshots 曲线、最近 operation_log |
| POST | `/api/simulation/buy` | 触发买入（定时器/本机手动），带鉴权 |
| POST | `/api/simulation/reset` | 重置账本，带鉴权 |

响应均 JSON；错误返回 `{ error: message }` 与合适状态码。

## 7. 调度器改造（instrumentation.ts）

从单任务硬编码改为任务表：

```ts
const TASKS = [
  { name: 'data-update', days: [1, 3, 5], hour: 22, minute: 0,  url: '/api/update' },
  { name: 'sim-buy',     days: [2, 4, 0], hour: 19, minute: 30, url: '/api/simulation/buy' },
];
```

- 分钟级精度（`now >= 目标时刻 && now < 目标时刻 + 检查间隔` 窗口内执行一次，`lastExecuted` 按任务名+本地日期去重）
- 继续沿用 `localDateStr()` 本地时区口径
- 结算动作不单独设任务，挂在 `/api/update` 成功后执行

## 8. 前端设计

`page.tsx` 新增"模拟盘" Tab：

- **概览卡片**：当前资金、累计投入、累计奖金、累计盈亏、收益率（大数字）
- **当前持仓**：目标期号 + 10 注号码球（待开奖状态）
- **收益曲线**：recharts 折线图，读 equity_snapshots（资金 / 累计盈亏两条线）
- **历史结算表**：期号、每注红球/蓝球、命中数、奖级、奖金、盈亏（按期号倒序，分页）
- **操作日志小面板**：最近 20 条（类型、信息、时间）

## 9. 错误处理

| 场景 | 行为 |
|---|---|
| DuckDB 文件损坏/打不开 | 启动时显式报错，不静默重置；API 返回 500 |
| 买入时预测引擎抛错 | 不扣款，写 operation_log(error)，持仓不变 |
| 结算时开奖号缺失 | 持仓挂起保持 pending，不写任何结算记录 |
| 结算/买入中途崩溃 | 事务包裹，失败回滚，账户资金不产生半状态 |
| 并发触发买入 | 依赖串行写队列 + pending 持仓唯一性检查，天然幂等 |

## 10. 测试计划

1. **simulation-engine 单测**：每个奖级至少一个边界用例（6+1、6+0、5+1、5+0、4+1、4+0、3+1、2+1、1+1、0+1、0+0）
2. **repository 测试**：买入→结算全流程；重复买入被拒；资金流水与 account 对账一致
3. **迁移测试**：JSON 120 期 → DuckDB 导入，条数与内容一致
4. **冒烟测试**：`smoke-preview.mjs` 增加 `/api/simulation` 与 buy/reset 接口检查

## 11. 配置项

| 环境变量 | 默认 | 说明 |
|---|---|---|
| `SIMULATE_INITIAL_CAPITAL` | 100000 | 初始资金 |
| `SIMULATE_BET_COUNT` | 10 | 每次买入注数 |
| `SIMULATE_BET_COST` | 2 | 单注金额 |
| `SIMULATE_PRIZE_FIRST` | 5000000 | 一等奖估算 |
| `SIMULATE_PRIZE_SECOND` | 200000 | 二等奖估算 |
| `UPDATE_TOKEN` | 无 | buy/reset 接口鉴权（沿用现有变量） |

## 12. 不做的事（YAGNI）

- 回测结果存档（`backtest_runs`）
- 多账户/多策略并行模拟
- 真实奖金手动录入（后续如需，可在 settlements 加列实现）
- 蓝球策略明细存档
