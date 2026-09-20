# 模拟买入功能（DuckDB 存储）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为双色球预测系统增加模拟盘：周二/四/日 19:30 自动预测并买入 10 注，开奖数据入库后自动结算，前端"模拟盘"Tab 展示资金/持仓/收益曲线，全部数据存 DuckDB。

**Architecture:** 沿用现有 Next.js 16 自定义服务器架构。新增 DuckDB 数据层（单例连接 + 串行写队列）替代 JSON 存储；结算引擎为纯函数便于单测；进程内调度器扩展为多任务表；前端以独立组件 `SimulationPanel` 挂入现有 Tabs。

**Tech Stack:** Next.js 16.1.1 (App Router)、TypeScript 5、`duckdb` npm 官方包（预编译二进制）、node:test（经 tsx 运行）、recharts、shadcn/ui。

**Spec:** `docs/superpowers/specs/2026-09-20-simulation-buy-design.md`（本计划对 spec 的唯一偏离：金额列用 DOUBLE 而非 DECIMAL，因为 duckdb Node 驱动将 DECIMAL 返回为字符串，DOUBLE 可避免全链路类型转换；显示时保留 2 位小数）

## Global Constraints

- 包管理器必须 pnpm（`preinstall` 有 only-allow 校验）
- 所有平台特定脚本必须同时支持 Windows（.mjs）与 Linux（.sh 经 run.mjs 分发）
- 测试运行器：`node --import tsx --test tests/`（node:test + tsx，不新增 vitest/jest）
- 金额一律 DOUBLE 列；接口返回前 `Math.round(x * 100) / 100`
- 界面文案使用中文，与现有页面风格一致（Card + shadcn 组件）
- 每个 Task 结束必须有一次 git commit
- `data/lottery.duckdb` 必须被 .gitignore 忽略（核对，不重复添加）
- DB 写操作一律经过 `serialize()` 串行队列；多步写入必须包在 `tx()` 事务里
- 环境变量默认值：初始资金 100000、10 注、单注 2 元、一等奖 500 万、二等奖 20 万

## 文件结构

| 文件 | 责任 | 动作 |
|---|---|---|
| `next.config.ts` | 加 `serverExternalPackages: ['duckdb']` | 修改 |
| `src/storage/database/duckdb.ts` | DuckDB 连接单例、串行队列、建表、JSON 迁移 | 新建 |
| `src/storage/database/draw-repository.ts` | 开奖数据读写（对上层暴露 `ensureDrawsLoaded/getAllDraws/getLatestPeriod/upsertDraws`） | 新建 |
| `src/storage/database/local-store.ts` | 旧 JSON 存储 | 删除 |
| `src/lib/lottery-fetcher.ts` | 改从 draw-repository 导入 | 修改 |
| `src/app/api/{predict,analysis,draws,backtest}/route.ts` | `await ensureDrawsLoaded()` 后取数 | 修改 |
| `src/lib/lottery-engine.ts` | `predict()` 增加注数参数；导出 `DrawRecord`（已有） | 修改 |
| `src/lib/simulation-engine.ts` | `judgeTicket` 奖级判定、`nextDrawPeriod` 目标期推算、`getPrizeConfig` | 新建 |
| `src/lib/request-auth.ts` | 抽取 `isAuthorized(request)`（回环/UPDATE_TOKEN） | 新建 |
| `src/app/api/update/route.ts` | 改用 request-auth；同步后调用 `settlePendingDraws()` | 修改 |
| `src/storage/database/simulation-repository.ts` | 买入/结算/重置/状态查询全部 SQL | 新建 |
| `src/app/api/simulation/route.ts` | GET 状态 | 新建 |
| `src/app/api/simulation/buy/route.ts` | POST 买入 | 新建 |
| `src/app/api/simulation/reset/route.ts` | POST 重置 | 新建 |
| `src/instrumentation.ts` | 多任务调度表（数据更新 + 模拟买入） | 修改 |
| `src/components/simulation-panel.tsx` | 模拟盘前端面板 | 新建 |
| `src/app/page.tsx` | 新增"模拟盘" Tab | 修改 |
| `scripts/smoke-preview.mjs` | 增加 `/api/simulation` 检查 | 修改 |
| `tests/helpers/make-draws.ts` | 构造确定性测试用开奖数据 | 新建 |
| `tests/simulation-engine.test.ts` | 奖级判定 + 目标期推算单测 | 新建 |
| `tests/predict-count.test.ts` | predict 注数参数单测 | 新建 |
| `tests/simulation-repository.test.ts` | 买入→结算→对账→重置集成测试 | 新建 |
| `package.json` | 加 `duckdb` 依赖与 `test` 脚本 | 修改 |

---

### Task 1: DuckDB 依赖与连接模块

**Files:**
- Modify: `next.config.ts`
- Modify: `package.json`
- Create: `src/storage/database/duckdb.ts`
- Test: `tests/duckdb.test.ts`

**Interfaces:**
- Consumes: 无
- Produces: `initDatabase(dbPath?: string): Promise<void>`、`run(sql: string, ...params: unknown[]): Promise<void>`、`all<T>(sql: string, ...params: unknown[]): Promise<T[]>`、`serialize<T>(fn: () => Promise<T>): Promise<T>`。表：`draws, prediction_runs, bets, settlements, equity_snapshots, account, fund_transactions, operation_log`，全局序列 `seq_global`。

- [ ] **Step 1: 安装依赖并配置 Next.js**

```bash
pnpm add duckdb
```

`next.config.ts` 修改（在 `const nextConfig: NextConfig = {` 后第一行加入）：

```ts
const nextConfig: NextConfig = {
  serverExternalPackages: ['duckdb'],
  allowedDevOrigins: ['*.dev.coze.site'],
  // ...其余保持不动
```

`package.json` 的 scripts 中加入：

```json
"test": "node --import tsx --test tests/",
```

- [ ] **Step 2: 写失败测试**

`tests/duckdb.test.ts`：

```ts
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

process.env.LOTTERY_DB_PATH = path.join(
  os.tmpdir(),
  `duckdb-test-${process.pid}.duckdb`
);

let db: typeof import('../src/storage/database/duckdb');

before(async () => {
  db = await import('../src/storage/database/duckdb');
  await db.initDatabase();
});

test('建表成功：核心表可查询', async () => {
  const tables = await db.all<{ name: string }>(
    `SELECT table_name AS name FROM information_schema.tables WHERE table_schema = 'main' ORDER BY table_name`
  );
  const names = tables.map((t) => t.name);
  for (const expected of [
    'draws', 'prediction_runs', 'bets', 'settlements',
    'equity_snapshots', 'account', 'fund_transactions', 'operation_log',
  ]) {
    assert.ok(names.includes(expected), `缺少表 ${expected}`);
  }
});

test('serialize 串行执行且返回结果', async () => {
  const results: number[] = [];
  await Promise.all([
    db.serialize(async () => { results.push(1); return 1; }),
    db.serialize(async () => { results.push(2); return 2; }),
  ]);
  assert.deepEqual(results.sort(), [1, 2]);
});

test('run/all 参数绑定', async () => {
  await db.run(
    `INSERT INTO draws (period, draw_date, red1, red2, red3, red4, red5, red6, blue)
     VALUES (?, ?, 1, 2, 3, 4, 5, 6, 7)`,
    '2099001', '2099-01-01'
  );
  const rows = await db.all<{ period: string; blue: number }>(
    `SELECT period, blue FROM draws WHERE period = ?`, '2099001'
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].blue, 7);
  fs.rmSync(process.env.LOTTERY_DB_PATH!, { force: true });
});
```

- [ ] **Step 3: 运行测试确认失败**

```bash
pnpm test
```

预期：FAIL，`Cannot find module '../src/storage/database/duckdb'`。

- [ ] **Step 4: 实现 duckdb.ts**

`src/storage/database/duckdb.ts`：

```ts
/**
 * DuckDB 连接管理：单例 + 串行写队列
 * 数据文件 data/lottery.duckdb，可用 LOTTERY_DB_PATH 覆盖（测试用临时文件）
 */
import duckdb from 'duckdb';
import fs from 'fs';
import path from 'path';

const DEFAULT_DB_PATH =
  process.env.LOTTERY_DB_PATH || path.join(process.cwd(), 'data', 'lottery.duckdb');

let instance: duckdb.Database | null = null;
let connection: duckdb.Connection | null = null;
let queue: Promise<unknown> = Promise.resolve();
let initPromise: Promise<void> | null = null;

/** 串行化写操作（DuckDB 单写者），所有 repository 写路径都必须经过它 */
export function serialize<T>(fn: () => Promise<T>): Promise<T> {
  const result = queue.then(fn, fn);
  queue = result.then(
    () => undefined,
    () => undefined
  );
  return result;
}

function conn(): duckdb.Connection {
  if (!connection) throw new Error('数据库未初始化，请先调用 initDatabase()');
  return connection;
}

export function run(sql: string, ...params: unknown[]): Promise<void> {
  return new Promise((resolve, reject) => {
    (conn().run as (...args: unknown[]) => void)(sql, ...params, (err: Error | null) =>
      err ? reject(err) : resolve()
    );
  });
}

export function all<T = Record<string, unknown>>(
  sql: string,
  ...params: unknown[]
): Promise<T[]> {
  return new Promise((resolve, reject) => {
    (conn().all as (...args: unknown[]) => void)(
      sql,
      ...params,
      (err: Error | null, rows: T[]) => (err ? reject(err) : resolve(rows))
    );
  });
}

const SCHEMA = `
CREATE SEQUENCE IF NOT EXISTS seq_global START 1;

CREATE TABLE IF NOT EXISTS draws (
  period    VARCHAR PRIMARY KEY,
  draw_date VARCHAR,
  red1 SMALLINT, red2 SMALLINT, red3 SMALLINT,
  red4 SMALLINT, red5 SMALLINT, red6 SMALLINT,
  blue SMALLINT,
  created_at TIMESTAMP DEFAULT now()
);

CREATE TABLE IF NOT EXISTS prediction_runs (
  id           BIGINT PRIMARY KEY,
  period       VARCHAR NOT NULL,
  weights      VARCHAR NOT NULL,
  combos       VARCHAR NOT NULL,
  prize_first  DOUBLE NOT NULL,
  prize_second DOUBLE NOT NULL,
  created_at   TIMESTAMP DEFAULT now()
);

CREATE TABLE IF NOT EXISTS bets (
  id         BIGINT PRIMARY KEY,
  run_id     BIGINT NOT NULL,
  period     VARCHAR NOT NULL,
  reds       VARCHAR NOT NULL,
  blue       SMALLINT NOT NULL,
  cost       DOUBLE NOT NULL,
  status     VARCHAR NOT NULL DEFAULT 'pending',
  created_at TIMESTAMP DEFAULT now()
);

CREATE TABLE IF NOT EXISTS settlements (
  id         BIGINT PRIMARY KEY,
  bet_id     BIGINT NOT NULL,
  period     VARCHAR NOT NULL,
  red_hits   SMALLINT NOT NULL,
  blue_hit   BOOLEAN NOT NULL,
  prize_tier SMALLINT NOT NULL,
  prize      DOUBLE NOT NULL,
  profit     DOUBLE NOT NULL,
  settled_at TIMESTAMP DEFAULT now()
);

CREATE TABLE IF NOT EXISTS equity_snapshots (
  period         VARCHAR PRIMARY KEY,
  cash           DOUBLE NOT NULL,
  total_invested DOUBLE NOT NULL,
  total_prize    DOUBLE NOT NULL,
  cum_profit     DOUBLE NOT NULL,
  roi            DOUBLE NOT NULL,
  created_at     TIMESTAMP DEFAULT now()
);

CREATE TABLE IF NOT EXISTS account (
  id              SMALLINT PRIMARY KEY,
  initial_capital DOUBLE NOT NULL,
  cash            DOUBLE NOT NULL,
  total_invested  DOUBLE NOT NULL,
  total_prize     DOUBLE NOT NULL,
  updated_at      TIMESTAMP DEFAULT now()
);

CREATE TABLE IF NOT EXISTS fund_transactions (
  id            BIGINT PRIMARY KEY,
  type          VARCHAR NOT NULL,
  amount        DOUBLE NOT NULL,
  balance_after DOUBLE NOT NULL,
  ref_id        BIGINT,
  note          VARCHAR,
  created_at    TIMESTAMP DEFAULT now()
);

CREATE TABLE IF NOT EXISTS operation_log (
  id         BIGINT PRIMARY KEY,
  type       VARCHAR NOT NULL,
  message    VARCHAR NOT NULL,
  detail     VARCHAR,
  created_at TIMESTAMP DEFAULT now()
);
`;

export function initDatabase(dbPath: string = DEFAULT_DB_PATH): Promise<void> {
  if (!initPromise) {
    initPromise = (async () => {
      if (dbPath !== ':memory:') {
        fs.mkdirSync(path.dirname(dbPath), { recursive: true });
      }
      instance = new duckdb.Database(dbPath);
      connection = instance.connect();
      await run(SCHEMA);
      await migrateFromJson();
    })();
  }
  return initPromise;
}

/** 首次启动：draws 表为空且 data/lottery_draws.json 存在时自动迁移（JSON 保留作备份） */
async function migrateFromJson(): Promise<void> {
  const { count } = await all<{ count: number }>(
    'SELECT count(*)::INT AS count FROM draws'
  );
  if (count > 0) return;
  const jsonFile = path.join(process.cwd(), 'data', 'lottery_draws.json');
  if (!fs.existsSync(jsonFile)) return;
  try {
    const parsed = JSON.parse(fs.readFileSync(jsonFile, 'utf-8')) as {
      draws?: Record<string, unknown>[];
    };
    const draws = Array.isArray(parsed.draws) ? parsed.draws : [];
    for (const d of draws) {
      await run(
        `INSERT INTO draws (period, draw_date, red1, red2, red3, red4, red5, red6, blue)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        String(d.period),
        String(d.draw_date ?? ''),
        d.red1, d.red2, d.red3, d.red4, d.red5, d.red6, d.blue
      );
    }
    if (draws.length > 0) {
      console.log(`[DuckDB] 已从 lottery_draws.json 迁移 ${draws.length} 期数据`);
    }
  } catch (err) {
    console.error('[DuckDB] JSON 迁移失败（忽略，继续使用空库）:', err);
  }
}
```

若 `import duckdb from 'duckdb'` 报缺类型，创建 `src/types/duckdb.d.ts`：

```ts
declare module 'duckdb' {
  export class Connection {
    all(sql: string, ...args: unknown[]): void;
    run(sql: string, ...args: unknown[]): void;
  }
  export class Database {
    constructor(path: string);
    connect(): Connection;
  }
}
```

- [ ] **Step 5: 运行测试确认通过**

```bash
pnpm test
```

预期：3 个测试 PASS。

- [ ] **Step 6: 核对 .gitignore 并提交**

```bash
grep -q "lottery.duckdb" .gitignore || echo "data/lottery.duckdb" >> .gitignore
git add -A
git commit -m "feat: 引入 DuckDB 存储层（连接单例 + 8 张表 + JSON 迁移）"
```

---

### Task 2: draw-repository 替换 local-store

**Files:**
- Create: `src/storage/database/draw-repository.ts`
- Delete: `src/storage/database/local-store.ts`
- Modify: `src/lib/lottery-fetcher.ts`
- Modify: `src/app/api/predict/route.ts`、`src/app/api/analysis/route.ts`、`src/app/api/draws/route.ts`、`src/app/api/backtest/route.ts`
- Test: `tests/draw-repository.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `initDatabase/all/run/serialize`
- Produces: `ensureDrawsLoaded(): Promise<void>`、`getAllDraws(): DrawRecord[]`（同步，要求先 ensureDrawsLoaded）、`getLatestPeriod(): string | null`（同步）、`upsertDraws(draws: Omit<DrawRecord,'id'>[]): Promise<{inserted:number; skipped:number}>`。`DrawRecord` 来自 `@/lib/lottery-engine`。

- [ ] **Step 1: 写失败测试**

`tests/draw-repository.test.ts`：

```ts
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';

process.env.LOTTERY_DB_PATH = path.join(
  os.tmpdir(),
  `draw-repo-test-${process.pid}.duckdb`
);

let drawRepo: typeof import('../src/storage/database/draw-repository');

before(async () => {
  drawRepo = await import('../src/storage/database/draw-repository');
  await drawRepo.ensureDrawsLoaded();
});

test('upsertDraws 插入与跳过', async () => {
  const draws = Array.from({ length: 5 }, (_, i) => ({
    period: `20260${String(i + 1).padStart(3, '0')}`,
    draw_date: '2026-01-01',
    red1: 1, red2: 2, red3: 3, red4: 4, red5: 5, red6: 6,
    blue: 7,
  }));
  const r1 = await drawRepo.upsertDraws(draws);
  assert.deepEqual(r1, { inserted: 5, skipped: 0 });
  const r2 = await drawRepo.upsertDraws(draws);
  assert.deepEqual(r2, { inserted: 0, skipped: 5 });
  assert.equal(drawRepo.getAllDraws().length, 5);
  assert.equal(drawRepo.getLatestPeriod(), '2026005');
});
```

- [ ] **Step 2: 运行确认失败**

```bash
pnpm test
```

预期：FAIL，模块不存在。

- [ ] **Step 3: 实现 draw-repository.ts 并切换调用方**

`src/storage/database/draw-repository.ts`：

```ts
/**
 * 开奖数据访问层（DuckDB 实现）
 * 对上层暴露的接口与旧 local-store 保持一致，读取走进程内缓存
 */
import type { DrawRecord } from '../../lib/lottery-engine';
import { initDatabase, all, run, serialize } from './duckdb';

let cache: DrawRecord[] | null = null;
let loading: Promise<void> | null = null;

type DrawRow = {
  period: string; draw_date: string;
  red1: number; red2: number; red3: number;
  red4: number; red5: number; red6: number;
  blue: number;
};

const SELECT_COLS =
  'period, draw_date, red1, red2, red3, red4, red5, red6, blue FROM draws ORDER BY period';

function toDrawRecord(r: DrawRow, id: number): DrawRecord {
  return {
    id,
    period: r.period,
    draw_date: r.draw_date,
    red1: r.red1, red2: r.red2, red3: r.red3,
    red4: r.red4, red5: r.red5, red6: r.red6,
    blue: r.blue,
  };
}

export function ensureDrawsLoaded(): Promise<void> {
  if (cache) return Promise.resolve();
  if (!loading) {
    loading = (async () => {
      await initDatabase();
      const rows = await all<DrawRow>(`SELECT ${SELECT_COLS}`);
      cache = rows.map((r, i) => toDrawRecord(r, i + 1));
    })();
  }
  return loading;
}

export function getAllDraws(): DrawRecord[] {
  if (!cache) throw new Error('开奖数据未加载，请先 await ensureDrawsLoaded()');
  return [...cache];
}

export function getLatestPeriod(): string | null {
  if (!cache || cache.length === 0) return null;
  return cache[cache.length - 1].period;
}

export function upsertDraws(
  draws: Omit<DrawRecord, 'id'>[]
): Promise<{ inserted: number; skipped: number }> {
  return serialize(async () => {
    await ensureDrawsLoaded();
    const existing = new Set((cache ?? []).map((d) => d.period));
    let inserted = 0;
    let skipped = 0;
    for (const d of draws) {
      if (existing.has(d.period)) {
        skipped++;
        continue;
      }
      await run(
        `INSERT INTO draws (period, draw_date, red1, red2, red3, red4, red5, red6, blue)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        d.period, d.draw_date,
        d.red1, d.red2, d.red3, d.red4, d.red5, d.red6, d.blue
      );
      inserted++;
    }
    if (inserted > 0) {
      const rows = await all<DrawRow>(`SELECT ${SELECT_COLS}`);
      cache = rows.map((r, i) => toDrawRecord(r, i + 1));
    }
    return { inserted, skipped };
  });
}
```

调用方切换：

1. 删除 `src/storage/database/local-store.ts`
2. `src/lib/lottery-fetcher.ts`：把
   `import { upsertDraws, getLatestPeriod } from '../storage/database/local-store';`
   改为
   `import { upsertDraws, getLatestPeriod, ensureDrawsLoaded } from '../storage/database/draw-repository';`
   `syncDrawsToDatabase` 中 `const latestPeriod = getLatestPeriod();` 改为：
   ```ts
   await ensureDrawsLoaded();
   const latestPeriod = getLatestPeriod();
   ```
   `getLatestPeriodInDb` 改为：
   ```ts
   export async function getLatestPeriodInDb(): Promise<string | null> {
     await ensureDrawsLoaded();
     return getLatestPeriod();
   }
   ```
3. 四个 API 路由（predict/analysis/draws/backtest）统一：import 改为
   `import { getAllDraws, ensureDrawsLoaded } from '@/storage/database/draw-repository';`
   并在 `try` 内第一行加 `await ensureDrawsLoaded();`（`getAllDraws()` 调用前）。

- [ ] **Step 4: 运行测试 + 全量校验**

```bash
pnpm test
pnpm validate
```

预期：全部 PASS；tsc 无 `local-store` 残留报错。

- [ ] **Step 5: 提交**

```bash
git add -A
git commit -m "refactor: 开奖数据存储从 JSON 迁移到 DuckDB（接口不变）"
```

---

### Task 3: predict() 注数参数

**Files:**
- Modify: `src/lib/lottery-engine.ts`（`predict` 函数 651 行附近）
- Test: `tests/predict-count.test.ts`、`tests/helpers/make-draws.ts`

**Interfaces:**
- Consumes: `DrawRecord`
- Produces: `predict(draws, weights?, count?: number): PredictionCombo[]`，`count` 默认 8，范围钳制 1–20。

- [ ] **Step 1: 写测试辅助与失败测试**

`tests/helpers/make-draws.ts`：

```ts
import type { DrawRecord } from '../../src/lib/lottery-engine';

/** 确定性伪随机，保证测试可复现 */
function mulberry(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 构造 n 期确定性开奖数据，期号从 startPeriod 连续，日期每 3 天一期 */
export function makeDraws(n: number, startPeriod = 2026001, startDate = '2026-01-01'): DrawRecord[] {
  const rng = mulberry(42);
  const picks = new Set<number>();
  const draws: DrawRecord[] = [];
  const base = new Date(startDate + 'T00:00:00');
  for (let i = 0; i < n; i++) {
    const reds: number[] = [];
    while (reds.length < 6) {
      const r = 1 + Math.floor(rng() * 33);
      if (!reds.includes(r)) reds.push(r);
    }
    reds.sort((a, b) => a - b);
    const d = new Date(base.getTime() + i * 3 * 86400000);
    const ds = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    draws.push({
      id: i + 1,
      period: String(startPeriod + i),
      draw_date: ds,
      red1: reds[0], red2: reds[1], red3: reds[2],
      red4: reds[3], red5: reds[4], red6: reds[5],
      blue: 1 + Math.floor(rng() * 16),
    });
  }
  return draws;
}
```

`tests/predict-count.test.ts`：

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { predict } from '../src/lib/lottery-engine';
import { makeDraws } from './helpers/make-draws';

const draws = makeDraws(60);

test('默认返回 8 注', () => {
  assert.equal(predict(draws).length, 8);
});

test('count=10 返回 10 注，每注 6 红升序且不重复', () => {
  const combos = predict(draws, undefined, 10);
  assert.equal(combos.length, 10);
  for (const c of combos) {
    assert.equal(c.reds.length, 6);
    assert.equal(new Set(c.reds).size, 6);
    const sorted = [...c.reds].sort((a, b) => a - b);
    assert.deepEqual(c.reds, sorted);
    assert.ok(c.blue >= 1 && c.blue <= 16);
  }
});

test('count 越界钳制到 1-20', () => {
  assert.equal(predict(draws, undefined, 0).length, 8);
  assert.equal(predict(draws, undefined, 99).length, 20);
});
```

- [ ] **Step 2: 运行确认失败**（`pnpm test`，第三个用例 FAIL：当前无 count 参数，忽略第三参返回 8）

- [ ] **Step 3: 修改 predict**

`src/lib/lottery-engine.ts` 中 `predict` 签名与两处循环上限：

```ts
export function predict(draws: DrawRecord[], weights?: {
  frequency: number;
  recency: number;
  balance: number;
}, count: number = 8): PredictionCombo[] {
  const comboCount = Math.min(20, Math.max(1, Math.trunc(count) || 8));
  const w = { frequency: 0.35, recency: 0.3, balance: 0.35, ...weights };
  // ...原有逻辑不变...
```

把贪心选择 `for (let i = 1; i < 8; i++)` 改为 `for (let i = 1; i < comboCount; i++)`；
把最终组装 `for (let i = 0; i < selectedCombos.length && i < 8; i++)` 改为 `&& i < comboCount`。

- [ ] **Step 4: 运行测试确认通过 + 提交**

```bash
pnpm test
git add -A
git commit -m "feat: predict() 支持注数参数（默认 8，范围 1-20）"
```

---

### Task 4: 结算引擎（纯函数）

**Files:**
- Create: `src/lib/simulation-engine.ts`
- Test: `tests/simulation-engine.test.ts`

**Interfaces:**
- Consumes: `DrawRecord`（`@/lib/lottery-engine`）
- Produces:
  - `interface PrizeConfig { first: number; second: number }`
  - `interface TicketResult { redHits: number; blueHit: boolean; tier: number; prize: number }`（tier 0=未中, 1..6=一..六等）
  - `judgeTicket(reds: number[], blue: number, actual: DrawRecord, cfg: PrizeConfig): TicketResult`
  - `nextDrawPeriod(latest: DrawRecord): string`
  - `getPrizeConfig(): PrizeConfig`（读 SIMULATE_PRIZE_FIRST/SECOND 环境变量）
  - `TIER_NAMES: string[]`

- [ ] **Step 1: 写失败测试**

`tests/simulation-engine.test.ts`：

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { judgeTicket, nextDrawPeriod } from '../src/lib/simulation-engine';
import type { DrawRecord } from '../src/lib/lottery-engine';

const actual: DrawRecord = {
  id: 1, period: '2026101', draw_date: '2026-09-01',
  red1: 1, red2: 5, red3: 9, red4: 17, red5: 24, red6: 33, blue: 4,
};
const A = [1, 5, 9, 17, 24, 33];
const cfg = { first: 5_000_000, second: 200_000 };

test('一等奖 6红+蓝', () => {
  const r = judgeTicket(A, 4, actual, cfg);
  assert.deepEqual(r, { redHits: 6, blueHit: true, tier: 1, prize: 5_000_000 });
});

test('二等奖 6红无蓝', () => {
  const r = judgeTicket(A, 1, actual, cfg);
  assert.equal(r.tier, 2);
  assert.equal(r.prize, 200_000);
});

test('三等奖 5红+蓝', () => {
  const r = judgeTicket([1, 5, 9, 17, 24], 4, actual, cfg);
  assert.equal(r.tier, 3);
  assert.equal(r.prize, 3000);
});

test('四等奖 5红无蓝 / 4红+蓝', () => {
  assert.equal(judgeTicket([1, 5, 9, 17, 24], 1, actual, cfg).prize, 200);
  assert.equal(judgeTicket([1, 5, 9, 17, 2, 3], 4, actual, cfg).prize, 200);
});

test('五等奖 4红无蓝 / 3红+蓝', () => {
  assert.equal(judgeTicket([1, 5, 9, 17, 2, 3], 1, actual, cfg).prize, 10);
  assert.equal(judgeTicket([1, 5, 9, 2, 3, 4], 4, actual, cfg).prize, 10);
});

test('六等奖 蓝命中（0/1/2 红）', () => {
  assert.equal(judgeTicket([1, 5, 9, 2, 3, 4], 4, actual, cfg).tier >= 5, true);
  assert.equal(judgeTicket([2, 3, 4, 6, 7, 8], 4, actual, cfg).prize, 5);
  assert.equal(judgeTicket([5, 3, 4, 6, 7, 8], 4, actual, cfg).prize, 5);
  assert.equal(judgeTicket([2, 3, 4, 6, 7, 10], 4, actual, cfg).prize, 5);
});

test('未中奖', () => {
  const r = judgeTicket([2, 3, 4, 6, 7, 8], 1, actual, cfg);
  assert.equal(r.tier, 0);
  assert.equal(r.prize, 0);
});

test('nextDrawPeriod 同年顺延 +1', () => {
  // 2026-09-15 是周二，下一期周四 09-17，同年
  const latest: DrawRecord = {
    id: 1, period: '2026108', draw_date: '2026-09-15',
    red1: 1, red2: 2, red3: 3, red4: 4, red5: 5, red6: 6, blue: 1,
  };
  assert.equal(nextDrawPeriod(latest), '2026109');
});

test('nextDrawPeriod 跨年重置为 <新年>001', () => {
  // 2026-12-31 是周四，下一期周日 2027-01-03
  const latest: DrawRecord = {
    id: 1, period: '2026153', draw_date: '2026-12-31',
    red1: 1, red2: 2, red3: 3, red4: 4, red5: 5, red6: 6, blue: 1,
  };
  assert.equal(nextDrawPeriod(latest), '2027001');
});
```

- [ ] **Step 2: 运行确认失败**（`pnpm test`，模块不存在）

- [ ] **Step 3: 实现 simulation-engine.ts**

```ts
/**
 * 模拟盘结算引擎（纯函数，无副作用）
 */
import type { DrawRecord } from './lottery-engine';

export interface PrizeConfig {
  first: number;
  second: number;
}

export interface TicketResult {
  redHits: number;
  blueHit: boolean;
  tier: number; // 0=未中, 1..6=一..六等奖
  prize: number;
}

export const TIER_NAMES = ['未中奖', '一等奖', '二等奖', '三等奖', '四等奖', '五等奖', '六等奖'];

export function getPrizeConfig(): PrizeConfig {
  return {
    first: Number(process.env.SIMULATE_PRIZE_FIRST) || 5_000_000,
    second: Number(process.env.SIMULATE_PRIZE_SECOND) || 200_000,
  };
}

/** 单注奖级判定（与官方规则一致，自上而下优先匹配） */
export function judgeTicket(
  reds: number[],
  blue: number,
  actual: DrawRecord,
  cfg: PrizeConfig
): TicketResult {
  const actualReds = [actual.red1, actual.red2, actual.red3, actual.red4, actual.red5, actual.red6];
  const redHits = reds.filter((r) => actualReds.includes(r)).length;
  const blueHit = blue === actual.blue;
  let tier = 0;
  let prize = 0;
  if (redHits === 6 && blueHit) {
    tier = 1;
    prize = cfg.first;
  } else if (redHits === 6) {
    tier = 2;
    prize = cfg.second;
  } else if (redHits === 5 && blueHit) {
    tier = 3;
    prize = 3000;
  } else if (redHits === 5 || (redHits === 4 && blueHit)) {
    tier = 4;
    prize = 200;
  } else if (redHits === 4 || (redHits === 3 && blueHit)) {
    tier = 5;
    prize = 10;
  } else if (blueHit) {
    tier = 6;
    prize = 5;
  }
  return { redHits, blueHit, tier, prize };
}

/** 由最新一期推算下一期期号：下一个周二/四/日；跨年取 <新年>001 */
export function nextDrawPeriod(latest: DrawRecord): string {
  const date = new Date(latest.draw_date + 'T00:00:00');
  if (Number.isNaN(date.getTime())) {
    throw new Error(`最新一期 draw_date 非法: ${latest.draw_date}`);
  }
  for (let add = 1; add <= 3; add++) {
    const d = new Date(date.getTime() + add * 86400000);
    const day = d.getDay();
    if (day === 2 || day === 4 || day === 0) {
      const year = d.getFullYear();
      const latestYear = parseInt(latest.period.slice(0, 4), 10);
      return year === latestYear ? String(parseInt(latest.period, 10) + 1) : `${year}001`;
    }
  }
  throw new Error(`无法从 ${latest.draw_date} 推算下期开奖日`);
}
```

- [ ] **Step 4: 运行测试确认通过 + 提交**

```bash
pnpm test
git add -A
git commit -m "feat: 模拟盘结算引擎（奖级判定 + 目标期推算，纯函数）"
```

---

### Task 5: request-auth 抽取 + 模拟盘买入

**Files:**
- Create: `src/lib/request-auth.ts`
- Modify: `src/app/api/update/route.ts`（删除本地 isAuthorized，改为 import）
- Create: `src/storage/database/simulation-repository.ts`（本任务只含账户初始化与买入部分）
- Test: `tests/simulation-repository.test.ts`（本任务只跑买入相关用例）

**Interfaces:**
- Consumes: Task 1 `initDatabase/all/run/serialize`；Task 2 `ensureDrawsLoaded/getAllDraws`；Task 3 `predict`；Task 4 `judgeTicket/nextDrawPeriod/getPrizeConfig/TIER_NAMES`
- Produces:
  - `isAuthorized(request: Request): boolean`（`@/lib/request-auth`）
  - `BuyResult { ok: boolean; message: string; runId?: number }`
  - `buyPredictions(weights: { frequency: number; recency: number; balance: number }): Promise<BuyResult>`
  - `getSimulationStatus(): Promise<SimulationStatus>`（本任务提供最小实现：account + pending；Task 6 补 settlements/equity/logs）

- [ ] **Step 1: 抽取 request-auth 并改 update 路由**

`src/lib/request-auth.ts`（从 `src/app/api/update/route.ts` 原样搬运 `isAuthorized` 及注释，加 export）：

```ts
/**
 * 更新/买入/重置等写接口的触发鉴权：
 * 1. 配置了 UPDATE_TOKEN 环境变量时，必须携带 `Authorization: Bearer <token>`
 * 2. 未配置 token 时，仅允许回环地址（127.0.0.1 / ::1 / localhost）触发
 * 注意：Next.js 会自动填充 x-forwarded-for（值为对端 IP），必须解析其 IP 判断回环
 */
export function isLoopback(ip: string): boolean {
  return ip === 'localhost'
    || ip.startsWith('127.')
    || ip === '::1'
    || ip === '0:0:0:0:0:0:0:1'
    || ip.startsWith('::ffff:127.')
    || ip.startsWith('::ffff:7f00:');
}

export function isAuthorized(request: Request): boolean {
  const token = process.env.UPDATE_TOKEN;
  if (token) {
    return request.headers.get('authorization') === `Bearer ${token}`;
  }
  const forwarded = request.headers.get('x-forwarded-for');
  const peer = (forwarded ? forwarded.split(',')[0].trim() : null)
    ?? request.headers.get('x-real-ip');
  if (peer) {
    return isLoopback(peer);
  }
  const hostname = new URL(request.url).hostname;
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]' || hostname === '::1';
}
```

`src/app/api/update/route.ts`：删除本地 `isLoopback`/`isAuthorized` 两个函数，改为
`import { isAuthorized } from '@/lib/request-auth';`，其余不动。

- [ ] **Step 2: 写失败测试（买入流程）**

`tests/simulation-repository.test.ts`（Task 5/6/7 共用此文件，本任务先建骨架 + 买入用例）：

```ts
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';

process.env.LOTTERY_DB_PATH = path.join(
  os.tmpdir(),
  `sim-repo-test-${process.pid}.duckdb`
);

let repo: typeof import('../src/storage/database/simulation-repository');
let drawRepo: typeof import('../src/storage/database/draw-repository');

before(async () => {
  const duckdb = await import('../src/storage/database/duckdb');
  await duckdb.initDatabase();
  drawRepo = await import('../src/storage/database/draw-repository');
  repo = await import('../src/storage/database/simulation-repository');
  await drawRepo.ensureDrawsLoaded();
  const { makeDraws } = await import('./helpers/make-draws');
  await drawRepo.upsertDraws(makeDraws(60));
});

const WEIGHTS = { frequency: 0.4, recency: 0.35, balance: 0.25 };

test('买入 10 注：扣款、生成持仓', async () => {
  const r = await repo.buyPredictions(WEIGHTS);
  assert.equal(r.ok, true);
  const st = await repo.getSimulationStatus();
  assert.equal(st.pending?.bets.length, 10);
  assert.equal(st.account.cash, 100000 - 20);
  assert.equal(st.account.total_invested, 20);
});

test('已有未结算持仓时重复买入被拒', async () => {
  const r = await repo.buyPredictions(WEIGHTS);
  assert.equal(r.ok, false);
  assert.match(r.message, /未结算/);
});
```

- [ ] **Step 3: 运行确认失败**（模块不存在）

- [ ] **Step 4: 实现 simulation-repository.ts（账户 + 买入 + 最小状态查询）**

```ts
/**
 * 模拟盘数据访问层：买入 / 结算 / 重置 / 状态查询
 * 所有写路径经 serialize() 串行，多步写入包在 tx() 事务内
 */
import { predict } from '../../lib/lottery-engine';
import {
  judgeTicket,
  nextDrawPeriod,
  getPrizeConfig,
  TIER_NAMES,
} from '../../lib/simulation-engine';
import { ensureDrawsLoaded, getAllDraws } from './draw-repository';
import { initDatabase, all, run, serialize } from './duckdb';

const BET_COUNT = Number(process.env.SIMULATE_BET_COUNT) || 10;
const BET_COST = Number(process.env.SIMULATE_BET_COST) || 2;
const INITIAL_CAPITAL = Number(process.env.SIMULATE_INITIAL_CAPITAL) || 100000;

export interface BuyResult {
  ok: boolean;
  message: string;
  runId?: number;
}

interface AccountRow {
  initial_capital: number;
  cash: number;
  total_invested: number;
  total_prize: number;
}

const round2 = (x: number) => Math.round(x * 100) / 100;

async function getAccount(): Promise<AccountRow> {
  await initDatabase();
  let rows = await all<AccountRow>(
    `SELECT initial_capital, cash, total_invested, total_prize FROM account WHERE id = 1`
  );
  if (rows.length === 0) {
    await run(
      `INSERT INTO account (id, initial_capital, cash, total_invested, total_prize) VALUES (1, ?, ?, 0, 0)`,
      INITIAL_CAPITAL, INITIAL_CAPITAL
    );
    rows = await all<AccountRow>(
      `SELECT initial_capital, cash, total_invested, total_prize FROM account WHERE id = 1`
    );
  }
  return rows[0];
}

async function logOp(type: string, message: string, detail?: string): Promise<void> {
  await run(
    `INSERT INTO operation_log (id, type, message, detail) VALUES (nextval('seq_global'), ?, ?, ?)`,
    type, message, detail ?? null
  );
}

/** 必须在 updateAccount 之后调用（余额即最新 cash） */
async function addTxn(
  type: string,
  amount: number,
  refId: number | null,
  note: string
): Promise<void> {
  const acc = await getAccount();
  await run(
    `INSERT INTO fund_transactions (id, type, amount, balance_after, ref_id, note)
     VALUES (nextval('seq_global'), ?, ?, ?, ?, ?)`,
    type, amount, acc.cash, refId, note
  );
}

async function updateAccount(dCash: number, dInvested: number, dPrize: number): Promise<void> {
  await run(
    `UPDATE account SET cash = cash + ?, total_invested = total_invested + ?, total_prize = total_prize + ?, updated_at = now() WHERE id = 1`,
    dCash, dInvested, dPrize
  );
}

async function tx<T>(fn: () => Promise<T>): Promise<T> {
  await run('BEGIN TRANSACTION');
  try {
    const r = await fn();
    await run('COMMIT');
    return r;
  } catch (err) {
    try {
      await run('ROLLBACK');
    } catch {
      // 忽略回滚失败
    }
    throw err;
  }
}

/** 定时买入：已有未结算持仓 / 资金不足时跳过并记日志 */
export async function buyPredictions(weights: {
  frequency: number;
  recency: number;
  balance: number;
}): Promise<BuyResult> {
  await ensureDrawsLoaded();
  return serialize(async () =>
    tx(async () => {
      const pending = await all<{ period: string }>(
        `SELECT DISTINCT period FROM bets WHERE status = 'pending'`
      );
      if (pending.length > 0) {
        const msg = `已有未结算持仓（目标期 ${pending[0].period}），跳过本期买入`;
        await logOp('skip', msg);
        return { ok: false, message: msg };
      }
      const account = await getAccount();
      const totalCost = BET_COUNT * BET_COST;
      if (account.cash < totalCost) {
        const msg = `资金不足（余额 ${round2(account.cash)} 元），跳过本期买入`;
        await logOp('skip', msg);
        return { ok: false, message: msg };
      }
      const draws = getAllDraws();
      const target = nextDrawPeriod(draws[draws.length - 1]);
      const cfg = getPrizeConfig();
      const combos = predict(draws, weights, BET_COUNT);
      const runIdRows = await all<{ id: number }>(
        `INSERT INTO prediction_runs (id, period, weights, combos, prize_first, prize_second)
         VALUES (nextval('seq_global'), ?, ?, ?, ?, ?) RETURNING id`,
        target, JSON.stringify(weights), JSON.stringify(combos), cfg.first, cfg.second
      );
      const runId = runIdRows[0].id;
      for (const c of combos) {
        await run(
          `INSERT INTO bets (id, run_id, period, reds, blue, cost) VALUES (nextval('seq_global'), ?, ?, ?, ?, ?)`,
          runId, target, JSON.stringify(c.reds), c.blue, BET_COST
        );
      }
      await updateAccount(-totalCost, totalCost, 0);
      await addTxn('buy', -totalCost, runId, `买入 ${BET_COUNT} 注 @ ${target}`);
      await logOp('buy', `已买入 ${BET_COUNT} 注，目标期 ${target}`, JSON.stringify({ runId, cost: totalCost }));
      return {
        ok: true,
        message: `已买入 ${BET_COUNT} 注（目标期 ${target}），投入 ${totalCost} 元`,
        runId,
      };
    })
  );
}

/** 状态查询（Task 6 会补充 settlements/equity/logs） */
export async function getSimulationStatus() {
  await ensureDrawsLoaded();
  const account = await getAccount();
  const pendingRuns = await all<{ id: number; period: string; created_at: string }>(
    `SELECT id, period, created_at FROM prediction_runs
     WHERE id IN (SELECT DISTINCT run_id FROM bets WHERE status = 'pending')
     ORDER BY id DESC LIMIT 1`
  );
  let pending: {
    period: string;
    bought_at: string;
    bets: { reds: number[]; blue: number; cost: number }[];
  } | null = null;
  if (pendingRuns.length > 0) {
    const r = pendingRuns[0];
    const bets = await all<{ reds: string; blue: number; cost: number }>(
      `SELECT reds, blue, cost FROM bets WHERE run_id = ? ORDER BY id`, r.id
    );
    pending = {
      period: r.period,
      bought_at: r.created_at,
      bets: bets.map((b) => ({ reds: JSON.parse(b.reds), blue: b.blue, cost: b.cost })),
    };
  }
  return {
    account: {
      initial_capital: round2(account.initial_capital),
      cash: round2(account.cash),
      total_invested: round2(account.total_invested),
      total_prize: round2(account.total_prize),
    },
    pending,
    settlements: [] as unknown[],
    equity: [] as unknown[],
    logs: [] as unknown[],
    config: { betCount: BET_COUNT, betCost: BET_COST },
  };
}
```

- [ ] **Step 5: 运行测试确认通过 + 提交**

```bash
pnpm test
pnpm validate
git add -A
git commit -m "feat: 模拟盘买入（账户/持仓/流水/日志，DuckDB 事务）+ 抽取 request-auth"
```

---

### Task 6: 结算 + 资金快照

**Files:**
- Modify: `src/storage/database/simulation-repository.ts`
- Test: `tests/simulation-repository.test.ts`（追加用例）

**Interfaces:**
- Consumes: Task 4 `judgeTicket/getPrizeConfig/TIER_NAMES`
- Produces:
  - `settlePendingDraws(): Promise<{ settled: number; pending: number }>`
  - `getSimulationStatus()` 补全 `settlements / equity / logs` 字段

- [ ] **Step 1: 追加失败测试**

在 `tests/simulation-repository.test.ts` 追加：

```ts
test('开奖号未入库：结算跳过，持仓挂起', async () => {
  const s = await repo.settlePendingDraws();
  assert.equal(s.settled, 0);
  assert.equal(s.pending, 1);
  const st = await repo.getSimulationStatus();
  assert.notEqual(st.pending, null);
});

test('开奖号入库后自动结算，资金对账一致', async () => {
  const st0 = await repo.getSimulationStatus();
  const target = st0.pending!.period;
  // 构造目标期开奖号：红 1-6，蓝 7
  await drawRepo.upsertDraws([{
    period: target, draw_date: '2026-12-31',
    red1: 1, red2: 2, red3: 3, red4: 4, red5: 5, red6: 6, blue: 7,
  }]);
  const s = await repo.settlePendingDraws();
  assert.equal(s.settled, 1);
  assert.equal(s.pending, 0);

  const st = await repo.getSimulationStatus();
  assert.equal(st.pending, null);
  assert.equal(st.settlements.length, 10);
  assert.equal(st.account.total_invested, 40); // 两次买入测试共 40
  assert.equal(st.account.cash, 100000 - 40 + st.account.total_prize);
  assert.equal(st.equity.length >= 1, true);
  assert.equal(st.equity[st.equity.length - 1].period, target);
});
```

注意：此用例依赖前面"重复买入被拒"用例后仍持有第一笔 10 注 pending；结算后再无 pending。

- [ ] **Step 2: 运行确认失败**（settlePendingDraws 不存在）

- [ ] **Step 3: 实现结算并补全 getSimulationStatus**

在 `simulation-repository.ts` 追加：

```ts
/** 结算所有 pending 持仓：开奖号已入库的期数逐注结算，缺失的保持挂起 */
export async function settlePendingDraws(): Promise<{ settled: number; pending: number }> {
  await ensureDrawsLoaded();
  return serialize(async () => {
    const pendings = await all<{ period: string }>(
      `SELECT DISTINCT period FROM bets WHERE status = 'pending' ORDER BY period`
    );
    const byPeriod = new Map(getAllDraws().map((d) => [d.period, d]));
    let settled = 0;
    for (const { period } of pendings) {
      const draw = byPeriod.get(period);
      if (!draw) {
        await tx(() => logOp('skip', `期号 ${period} 开奖数据未入库，持仓继续挂起`));
        continue;
      }
      await tx(async () => {
        const cfg = getPrizeConfig();
        const bets = await all<{ id: number; reds: string; blue: number; cost: number }>(
          `SELECT id, reds, blue, cost FROM bets WHERE period = ? AND status = 'pending'`,
          period
        );
        let periodPrize = 0;
        let periodCost = 0;
        for (const b of bets) {
          const res = judgeTicket(JSON.parse(b.reds), b.blue, draw, cfg);
          const profit = res.prize - b.cost;
          const sRows = await all<{ id: number }>(
            `INSERT INTO settlements (id, bet_id, period, red_hits, blue_hit, prize_tier, prize, profit)
             VALUES (nextval('seq_global'), ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
            b.id, period, res.redHits, res.blueHit, res.tier, res.prize, profit
          );
          await run(`UPDATE bets SET status = 'settled' WHERE id = ?`, b.id);
          periodPrize += res.prize;
          periodCost += b.cost;
          if (res.prize > 0) {
            await addTxn(
              'prize', res.prize, sRows[0].id,
              `期号 ${period} 中${TIER_NAMES[res.tier]} ${round2(res.prize)} 元`
            );
          }
        }
        await updateAccount(periodPrize, 0, periodPrize);
        const acc = await getAccount();
        const roi = acc.total_invested > 0
          ? (acc.total_prize - acc.total_invested) / acc.total_invested
          : 0;
        await run(
          `INSERT OR REPLACE INTO equity_snapshots (period, cash, total_invested, total_prize, cum_profit, roi)
           VALUES (?, ?, ?, ?, ?, ?)`,
          period, acc.cash, acc.total_invested, acc.total_prize,
          acc.total_prize - acc.total_invested, roi
        );
        await logOp(
          'settle',
          `期号 ${period} 结算完成：${bets.length} 注，奖金 ${round2(periodPrize)} 元，投入 ${round2(periodCost)} 元`
        );
      });
      settled++;
    }
    return { settled, pending: pendings.length - settled };
  });
}
```

并把 `getSimulationStatus` 中三个占位字段替换为真实查询：

```ts
  const settlements = await all<{
    period: string; red_hits: number; blue_hit: boolean;
    prize_tier: number; prize: number; profit: number; settled_at: string;
  }>(
    `SELECT period, red_hits, blue_hit, prize_tier, prize, profit, settled_at
     FROM settlements ORDER BY settled_at DESC, id DESC LIMIT 50`
  );
  const equity = await all<{
    period: string; cash: number; cum_profit: number; roi: number;
  }>(
    `SELECT period, cash, cum_profit, roi FROM equity_snapshots ORDER BY period ASC`
  );
  const logs = await all<{ type: string; message: string; created_at: string }>(
    `SELECT type, message, created_at FROM operation_log ORDER BY id DESC LIMIT 20`
  );
```

（settlements 行做 `round2` 映射：`prize: round2(x.prize), profit: round2(x.profit)`；equity 的 `cash/cum_profit` 同样。）

- [ ] **Step 4: 运行测试确认通过 + 提交**

```bash
pnpm test
git add -A
git commit -m "feat: 模拟盘自动结算（settlements/资金快照/中奖流水）"
```

---

### Task 7: 重置

**Files:**
- Modify: `src/storage/database/simulation-repository.ts`
- Test: `tests/simulation-repository.test.ts`（追加）

**Interfaces:**
- Produces: `resetSimulation(): Promise<{ initial: number }>`

- [ ] **Step 1: 追加失败测试**

```ts
test('重置：账本清零，资金恢复初始值', async () => {
  const r = await repo.resetSimulation();
  assert.equal(r.initial, 100000);
  const st = await repo.getSimulationStatus();
  assert.equal(st.account.cash, 100000);
  assert.equal(st.account.total_invested, 0);
  assert.equal(st.settlements.length, 0);
  assert.equal(st.equity.length, 0);
  assert.equal(st.pending, null);
});
```

- [ ] **Step 2: 运行确认失败**

- [ ] **Step 3: 实现 resetSimulation**

```ts
/** 重置账本：清空所有模拟数据，资金恢复初始资本 */
export async function resetSimulation(): Promise<{ initial: number }> {
  return serialize(async () =>
    tx(async () => {
      await run('DELETE FROM settlements');
      await run('DELETE FROM bets');
      await run('DELETE FROM prediction_runs');
      await run('DELETE FROM equity_snapshots');
      await run('DELETE FROM fund_transactions');
      await run('DELETE FROM operation_log');
      const initial = Number(process.env.SIMULATE_INITIAL_CAPITAL) || 100000;
      await run(
        `INSERT OR REPLACE INTO account (id, initial_capital, cash, total_invested, total_prize) VALUES (1, ?, ?, 0, 0)`,
        initial, initial
      );
      await addTxn('reset', 0, null, `账本重置，资金恢复 ${initial} 元`);
      await logOp('reset', `模拟盘账本已重置，资金恢复 ${initial} 元`);
      return { initial };
    })
  );
}
```

- [ ] **Step 4: 运行测试 + 提交**

```bash
pnpm test
git add -A
git commit -m "feat: 模拟盘账本重置"
```

---

### Task 8: 模拟盘 API 路由

**Files:**
- Create: `src/app/api/simulation/route.ts`
- Create: `src/app/api/simulation/buy/route.ts`
- Create: `src/app/api/simulation/reset/route.ts`

**Interfaces:**
- Consumes: Task 5 `isAuthorized`；Task 5/6/7 的 repository 函数；Task 2 的 `parseWeight`（`@/lib/parse-params`）
- Produces:
  - `GET /api/simulation` → `{ account, pending, settlements, equity, logs, config }`
  - `POST /api/simulation/buy` → `BuyResult`（401 未授权 / 409 跳过 / 200 成功）
  - `POST /api/simulation/reset` → `{ initial }`

- [ ] **Step 1: 实现三个路由**

`src/app/api/simulation/route.ts`：

```ts
import { NextResponse } from 'next/server';
import { getSimulationStatus } from '@/storage/database/simulation-repository';

export async function GET() {
  try {
    return NextResponse.json(await getSimulationStatus());
  } catch (error) {
    const message = error instanceof Error ? error.message : '未知错误';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
```

`src/app/api/simulation/buy/route.ts`：

```ts
import { NextResponse } from 'next/server';
import { isAuthorized } from '@/lib/request-auth';
import { parseWeight } from '@/lib/parse-params';
import { buyPredictions } from '@/storage/database/simulation-repository';

export async function POST(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: '未授权：请从本机触发，或配置 UPDATE_TOKEN 后携带 Bearer token' }, { status: 401 });
  }
  try {
    const { searchParams } = new URL(request.url);
    const weights = {
      frequency: parseWeight(searchParams.get('frequency'), 0.4),
      recency: parseWeight(searchParams.get('recency'), 0.35),
      balance: parseWeight(searchParams.get('balance'), 0.25),
    };
    const result = await buyPredictions(weights);
    return NextResponse.json(result, { status: result.ok ? 200 : 409 });
  } catch (error) {
    const message = error instanceof Error ? error.message : '未知错误';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
```

`src/app/api/simulation/reset/route.ts`：

```ts
import { NextResponse } from 'next/server';
import { isAuthorized } from '@/lib/request-auth';
import { resetSimulation } from '@/storage/database/simulation-repository';

export async function POST(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: '未授权' }, { status: 401 });
  }
  try {
    return NextResponse.json(await resetSimulation());
  } catch (error) {
    const message = error instanceof Error ? error.message : '未知错误';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
```

- [ ] **Step 2: 验证**

```bash
pnpm validate
```

然后启动服务器手工冒烟（可用 `node scripts/smoke-preview.mjs` 改造前的版本先确认编译，或直接进入 Task 11 统一冒烟）。本任务先以 `pnpm validate` 为准。

- [ ] **Step 3: 提交**

```bash
git add -A
git commit -m "feat: 模拟盘 API（状态查询/买入/重置，回环+token 鉴权）"
```

---

### Task 9: 调度器多任务 + 结算挂接

**Files:**
- Modify: `src/instrumentation.ts`（整体重写）
- Modify: `src/app/api/update/route.ts`（同步成功后调用结算）

**Interfaces:**
- Consumes: Task 6 `settlePendingDraws`
- Produces: 调度任务表 `[{ name, days, hour, minute, path }]`：数据更新（周一/三/五 22:00 → `/api/update`）、模拟买入（周二/四/日 19:30 → `/api/simulation/buy`）

- [ ] **Step 1: update 路由挂结算**

`src/app/api/update/route.ts` 的 POST 中，`const syncResult = await syncDrawsToDatabase(draws);` 之后加入：

```ts
    // 新数据入库后自动结算未结算持仓（错过的期数在此补结）
    const settleResult = await settlePendingDraws();
```

import 区加：`import { settlePendingDraws } from '@/storage/database/simulation-repository';`

`UpdateResult` 接口与成功/无新数据两个结果对象中加入 `settled_count: settleResult.settled,`。

- [ ] **Step 2: 重写 instrumentation.ts**

```ts
/**
 * Next.js Instrumentation
 * 服务启动时自动初始化定时任务：
 * - data-update: 每周一/三/五 22:00 抓取开奖数据并触发结算
 * - sim-buy:     每周二/四/日 19:30 预测并买入
 */

const CHECK_INTERVAL_MS = 60 * 1000; // 每分钟检查一次

interface ScheduledTask {
  name: string;
  days: number[]; // 0=周日
  hour: number;
  minute: number;
  path: string;
}

const TASKS: ScheduledTask[] = [
  { name: 'data-update', days: [1, 3, 5], hour: 22, minute: 0, path: '/api/update' },
  { name: 'sim-buy', days: [2, 4, 0], hour: 19, minute: 30, path: '/api/simulation/buy' },
];

const lastExecuted: Record<string, string> = {};
let cronStarted = false;

// 本地日期字符串（与 getDay/getHours 保持同一时区口径）
function localDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

async function runTask(task: ScheduledTask): Promise<void> {
  const port = process.env.PORT || process.env.DEPLOY_RUN_PORT || '5000';
  const url = `http://localhost:${port}${task.path}`;
  console.log(`[LotteryCron ${new Date().toISOString()}] 执行任务 ${task.name} -> ${url}`);
  try {
    const response = await fetch(url, {
      method: 'POST',
      signal: AbortSignal.timeout(60000),
    });
    const result = await response.json().catch(() => ({}));
    const msg = result.message ?? (result.ok === false ? result.message : '已触发');
    console.log(`[LotteryCron] ${task.name} 完成: HTTP ${response.status} ${msg ?? ''}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : '未知错误';
    console.error(`[LotteryCron] ${task.name} 异常: ${message}`);
  }
}

function checkTasks(now: Date): void {
  const day = now.getDay();
  const minutes = now.getHours() * 60 + now.getMinutes();
  const today = localDateStr(now);
  for (const task of TASKS) {
    if (!task.days.includes(day)) continue;
    const target = task.hour * 60 + task.minute;
    // 执行窗口：目标时刻起一个检查间隔内，每天最多一次
    if (minutes < target || minutes >= target + CHECK_INTERVAL_MS / 60000) continue;
    if (lastExecuted[task.name] === today) continue;
    lastExecuted[task.name] = today;
    void runTask(task);
  }
}

function startCronScheduler(): void {
  if (cronStarted) return;
  cronStarted = true;
  console.log('[LotteryCron] 定时服务已启动（周一/三/五 22:00 更新，周二/四/日 19:30 买入）');
  setInterval(() => checkTasks(new Date()), CHECK_INTERVAL_MS);
}

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    startCronScheduler();
  }
}
```

- [ ] **Step 3: 验证**

```bash
pnpm validate
```

- [ ] **Step 4: 提交**

```bash
git add -A
git commit -m "feat: 调度器多任务化（周二四日19:30自动买入）+ 数据更新后自动结算"
```

---

### Task 10: 前端"模拟盘" Tab

**Files:**
- Create: `src/components/simulation-panel.tsx`
- Modify: `src/app/page.tsx`（TabsList 加触发器 + TabsContent + import）

**Interfaces:**
- Consumes: `GET /api/simulation`、`POST /api/simulation/buy`、`POST /api/simulation/reset`
- Produces: `SimulationPanel` 组件（无 props）

- [ ] **Step 1: 实现 SimulationPanel**

`src/components/simulation-panel.tsx`：

```tsx
'use client';

import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend,
} from 'recharts';
import {
  Wallet, ShoppingCart, RotateCcw, TrendingUp, TrendingDown, Clock,
} from 'lucide-react';

interface SimStatus {
  account: {
    initial_capital: number;
    cash: number;
    total_invested: number;
    total_prize: number;
  };
  pending: {
    period: string;
    bought_at: string;
    bets: { reds: number[]; blue: number; cost: number }[];
  } | null;
  settlements: {
    period: string; red_hits: number; blue_hit: boolean;
    prize_tier: number; prize: number; profit: number; settled_at: string;
  }[];
  equity: { period: string; cash: number; cum_profit: number; roi: number }[];
  logs: { type: string; message: string; created_at: string }[];
  config: { betCount: number; betCost: number };
}

const TIER_NAMES = ['未中奖', '一等奖', '二等奖', '三等奖', '四等奖', '五等奖', '六等奖'];
const fmt = (n: number) => n.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function RedBall({ n }: { n: number }) {
  return (
    <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-red-600 text-white text-xs font-bold mx-0.5">
      {String(n).padStart(2, '0')}
    </span>
  );
}

function BlueBall({ n }: { n: number }) {
  return (
    <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-blue-600 text-white text-xs font-bold mx-0.5">
      {String(n).padStart(2, '0')}
    </span>
  );
}

export default function SimulationPanel() {
  const [data, setData] = useState<SimStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'buy' | 'reset' | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/simulation');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData(await res.json());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败');
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const act = async (kind: 'buy' | 'reset') => {
    setBusy(kind);
    try {
      const res = await fetch(`/api/simulation/${kind}`, { method: 'POST' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || body.message || `HTTP ${res.status}`);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : '操作失败');
    } finally {
      setBusy(null);
    }
  };

  if (error && !data) {
    return (
      <Card className="bg-card/50 border-border/50">
        <CardContent className="py-12 text-center">
          <p className="text-sm text-muted-foreground">模拟盘加载失败：{error}</p>
          <Button variant="outline" className="mt-4" onClick={refresh}>重试</Button>
        </CardContent>
      </Card>
    );
  }
  if (!data) {
    return <p className="text-sm text-muted-foreground py-12 text-center">加载中...</p>;
  }

  const profit = data.account.total_prize - data.account.total_invested;
  const roi = data.account.total_invested > 0 ? (profit / data.account.total_invested) * 100 : 0;

  return (
    <div className="space-y-6">
      {/* 概览 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="bg-card/50 border-border/50">
          <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Wallet className="w-4 h-4" />当前资金</CardTitle></CardHeader>
          <CardContent><p className="text-2xl font-bold">¥{fmt(data.account.cash)}</p></CardContent>
        </Card>
        <Card className="bg-card/50 border-border/50">
          <CardHeader className="pb-2"><CardTitle className="text-sm">累计投入</CardTitle></CardHeader>
          <CardContent><p className="text-2xl font-bold">¥{fmt(data.account.total_invested)}</p></CardContent>
        </Card>
        <Card className="bg-card/50 border-border/50">
          <CardHeader className="pb-2"><CardTitle className="text-sm">累计奖金</CardTitle></CardHeader>
          <CardContent><p className="text-2xl font-bold">¥{fmt(data.account.total_prize)}</p></CardContent>
        </Card>
        <Card className="bg-card/50 border-border/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              {profit >= 0 ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
              累计盈亏 / 收益率
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className={`text-2xl font-bold ${profit >= 0 ? 'text-red-500' : 'text-green-500'}`}>
              {profit >= 0 ? '+' : ''}{fmt(profit)}
            </p>
            <p className="text-xs text-muted-foreground">ROI {roi.toFixed(2)}%</p>
          </CardContent>
        </Card>
      </div>

      {/* 操作 */}
      <div className="flex items-center gap-3">
        <Button onClick={() => act('buy')} disabled={busy !== null || !!data.pending}>
          <ShoppingCart className="w-4 h-4 mr-1" />
          {busy === 'buy' ? '买入中...' : '立即买入'}
        </Button>
        <Button
          variant="destructive" onClick={() => {
            if (window.confirm('确定重置模拟盘？所有买入与结算记录将被清空，资金恢复初始值。')) act('reset');
          }}
          disabled={busy !== null}
        >
          <RotateCcw className="w-4 h-4 mr-1" />
          {busy === 'reset' ? '重置中...' : '重置账本'}
        </Button>
        {data.pending && (
          <Badge variant="secondary" className="gap-1">
            <Clock className="w-3 h-3" />
            已有持仓待开奖（{data.pending.period}）
          </Badge>
        )}
        {error && <span className="text-xs text-destructive">{error}</span>}
      </div>

      {/* 当前持仓 */}
      {data.pending && (
        <Card className="bg-card/50 border-border/50">
          <CardHeader>
            <CardTitle className="text-base">当前持仓 · 目标期 {data.pending.period}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {data.pending.bets.map((b, i) => (
                <div key={i} className="flex items-center flex-wrap gap-1">
                  <span className="text-xs text-muted-foreground w-8">#{i + 1}</span>
                  {b.reds.map((r) => <RedBall key={r} n={r} />)}
                  <BlueBall n={b.blue} />
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* 收益曲线 */}
      {data.equity.length > 0 && (
        <Card className="bg-card/50 border-border/50">
          <CardHeader><CardTitle className="text-base">收益曲线</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={data.equity} margin={{ top: 4, right: 12, bottom: 0, left: 12 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="period" fontSize={11} />
                <YAxis fontSize={11} />
                <Tooltip
                  formatter={(value: number, name: string) => [
                    name === '资金' ? `¥${fmt(value)}` : `¥${fmt(value)}`, name,
                  ]}
                />
                <Legend />
                <Line type="monotone" dataKey="cash" name="资金" stroke="hsl(var(--primary))" dot={false} strokeWidth={2} />
                <Line type="monotone" dataKey="cum_profit" name="累计盈亏" stroke="#22c55e" dot={false} strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {/* 历史结算 */}
      {data.settlements.length > 0 && (
        <Card className="bg-card/50 border-border/50">
          <CardHeader><CardTitle className="text-base">历史结算（最近 50 注）</CardTitle></CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-muted-foreground border-b border-border/50">
                    <th className="py-2 pr-4">期号</th>
                    <th className="py-2 pr-4">命中</th>
                    <th className="py-2 pr-4">奖级</th>
                    <th className="py-2 pr-4 text-right">奖金</th>
                    <th className="py-2 pr-4 text-right">盈亏</th>
                    <th className="py-2 text-right">结算时间</th>
                  </tr>
                </thead>
                <tbody>
                  {data.settlements.map((s, i) => (
                    <tr key={i} className="border-b border-border/30">
                      <td className="py-2 pr-4 font-mono">{s.period}</td>
                      <td className="py-2 pr-4">{s.red_hits}红{s.blue_hit ? '+蓝' : ''}</td>
                      <td className="py-2 pr-4">{TIER_NAMES[s.prize_tier]}</td>
                      <td className="py-2 pr-4 text-right">{fmt(s.prize)}</td>
                      <td className={`py-2 pr-4 text-right ${s.profit >= 0 ? 'text-red-500' : 'text-muted-foreground'}`}>
                        {s.profit >= 0 ? '+' : ''}{fmt(s.profit)}
                      </td>
                      <td className="py-2 text-right text-xs text-muted-foreground">
                        {new Date(s.settled_at).toLocaleString('zh-CN')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* 操作日志 */}
      {data.logs.length > 0 && (
        <Card className="bg-card/50 border-border/50">
          <CardHeader><CardTitle className="text-base">操作日志</CardTitle></CardHeader>
          <CardContent>
            <ul className="space-y-1 text-xs text-muted-foreground">
              {data.logs.map((l, i) => (
                <li key={i}>
                  <Badge variant="outline" className="mr-2">{l.type}</Badge>
                  {l.message}
                  <span className="ml-2 opacity-60">{new Date(l.created_at).toLocaleString('zh-CN')}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
```

- [ ] **Step 2: 挂入 page.tsx**

1. import 区加入（合并进现有 lucide-react import）：
   `import { SimulationPanel } from '@/components/simulation-panel';`
   注意组件导出改为命名导出：把上面组件定义改为 `export function SimulationPanel()`（去掉 default）。
2. TabsList 中"数据管理"触发器之后加：

```tsx
            <TabsTrigger value="simulation" className="gap-2">
              <Wallet className="w-4 h-4" />
              模拟盘
            </TabsTrigger>
```

3. 最后一个 `</TabsContent>`（数据管理）之后、`</Tabs>` 之前加：

```tsx
          {/* 模拟盘 */}
          <TabsContent value="simulation" className="space-y-6">
            <SimulationPanel />
          </TabsContent>
```

- [ ] **Step 3: 验证 + 提交**

```bash
pnpm validate
git add -A
git commit -m "feat: 前端模拟盘 Tab（资金概览/持仓/收益曲线/结算记录/日志）"
```

---

### Task 11: 冒烟脚本扩展与全量回归

**Files:**
- Modify: `scripts/smoke-preview.mjs`
- Modify: `README.md`（补模拟盘说明，2-3 行）

**Interfaces:**
- Consumes: 全部前述任务

- [ ] **Step 1: 扩展 smoke-preview.mjs**

把接口检查循环改为：

```js
    for (const p of ['/api/analysis', '/api/predict', '/api/simulation']) {
```

（`POST /api/simulation/buy` 会污染真实账本，冒烟只做 GET 只读检查。）

- [ ] **Step 2: README 补充**

在"项目结构"之后追加一节：

```markdown
## 模拟盘

- 每周二/四/日 19:30 自动预测并买入 10 注（单注 2 元），初始资金 10 万元
- 开奖数据入库后自动结算（一等奖按 500 万、二等奖按 20 万估算，可用 SIMULATE_PRIZE_FIRST/SECOND 调整）
- 数据存储于 DuckDB（data/lottery.duckdb），首次启动自动从 lottery_draws.json 迁移
- 环境变量：SIMULATE_INITIAL_CAPITAL / SIMULATE_BET_COUNT / SIMULATE_BET_COST / UPDATE_TOKEN
```

- [ ] **Step 3: 全量回归**

```bash
pnpm test
pnpm validate
node scripts/smoke-preview.mjs 5123
```

预期：全部测试 PASS、校验通过、冒烟输出含 `✓ /api/simulation -> HTTP 200`。

- [ ] **Step 4: 提交**

```bash
git add -A
git commit -m "test: 冒烟脚本覆盖模拟盘接口 + README 补充模拟盘说明"
```

---

## Self-Review 记录

- **Spec 覆盖**：买入（T5）、结算（T6）、重置（T7）、API（T8）、调度（T9）、前端（T10）、存储迁移（T1/T2）、引擎注数（T3）、奖级规则（T4）、配置项（各任务内）均有对应任务；spec 的"回测存档"明确不做。
- **占位符**：无 TBD；所有代码步骤含完整实现。
- **类型一致性**：`buyPredictions/getSimulationStatus/settlePendingDraws/resetSimulation`、`judgeTicket/nextDrawPeriod/getPrizeConfig`、`isAuthorized`、`ensureDrawsLoaded/getAllDraws/upsertDraws` 在各任务间签名一致；`BuyResult` 字段（ok/message/runId）前后一致。
- **已知偏离**：金额列 DOUBLE（见头部说明）；spec 中 `equity_snapshots.roi` 语义为 (prize-invested)/invested，实现一致。
