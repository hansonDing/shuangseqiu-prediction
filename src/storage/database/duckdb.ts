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
    (conn().run as unknown as (...args: unknown[]) => void)(sql, ...params, (err: Error | null) =>
      err ? reject(err) : resolve()
    );
  });
}

export function all<T = Record<string, unknown>>(
  sql: string,
  ...params: unknown[]
): Promise<T[]> {
  return new Promise((resolve, reject) => {
    (conn().all as unknown as (...args: unknown[]) => void)(
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
  id           INTEGER PRIMARY KEY,
  period       VARCHAR NOT NULL,
  weights      VARCHAR NOT NULL,
  combos       VARCHAR NOT NULL,
  prize_first  DOUBLE NOT NULL,
  prize_second DOUBLE NOT NULL,
  created_at   TIMESTAMP DEFAULT now()
);

CREATE TABLE IF NOT EXISTS bets (
  id         INTEGER PRIMARY KEY,
  run_id     INTEGER NOT NULL,
  period     VARCHAR NOT NULL,
  reds       VARCHAR NOT NULL,
  blue       SMALLINT NOT NULL,
  cost       DOUBLE NOT NULL,
  status     VARCHAR NOT NULL DEFAULT 'pending',
  created_at TIMESTAMP DEFAULT now()
);

CREATE TABLE IF NOT EXISTS settlements (
  id         INTEGER PRIMARY KEY,
  bet_id     INTEGER NOT NULL,
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
  id            INTEGER PRIMARY KEY,
  type          VARCHAR NOT NULL,
  amount        DOUBLE NOT NULL,
  balance_after DOUBLE NOT NULL,
  ref_id        INTEGER,
  note          VARCHAR,
  created_at    TIMESTAMP DEFAULT now()
);

CREATE TABLE IF NOT EXISTS operation_log (
  id         INTEGER PRIMARY KEY,
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
      // JSON 迁移仅在未指定 LOTTERY_DB_PATH（生产默认库）时执行，测试库不迁移
      if (!process.env.LOTTERY_DB_PATH) {
        await migrateFromJson();
      }
    })();
  }
  return initPromise;
}

/** 首次启动：draws 表为空且 data/lottery_draws.json 存在时自动迁移（JSON 保留作备份） */
async function migrateFromJson(): Promise<void> {
  const rows = await all<{ count: number }>(
    'SELECT count(*)::INT AS count FROM draws'
  );
  const { count } = rows[0];
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
