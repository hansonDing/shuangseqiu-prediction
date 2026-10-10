/**
 * CloudBase PostgreSQL 存储驱动
 *
 * 面向云托管部署：服务端凭 API Key（映射 PG 的 service_role）经 PostgREST 访问数据库。
 *
 * 为什么事务走 RPC 而不是多条 REST 请求：
 *   PostgREST 是「一次一表」的无状态 HTTP 接口，跨请求没有事务边界。
 *   而买/结算/重置都是多步写入，必须原子。因此把事务性下沉为 PostgreSQL 函数
 *   （见 cloudbase/migrations/ 里的 lottery_commit_buy 等），一次 RPC 调用即一个事务。
 *
 * 环境变量：
 *   CLOUDBASE_ENV_ID   环境 ID（如 xingxingyingyu-d1gyuluzo0255a4fb）
 *   CLOUDBASE_API_KEY  API Key，等同数据库 service_role 权限，**只能放服务端**
 *   CLOUDBASE_API_BASE 可选，覆盖网关基址（内网/代理场景）
 */
import type {
  AccountRow,
  BetRow,
  BuyCommit,
  DrawRow,
  EquityRow,
  OperationLogRow,
  PendingRunRow,
  SettlementCommit,
  SettlementRow,
  StorageDriver,
} from './driver';
import {
  buildRpcUrl,
  buildTableUrl,
  inExpr,
  restBaseUrl,
  toRows,
  toScalar,
} from './postgrest';

const REQUEST_TIMEOUT_MS = 20_000;
const INSERT_CHUNK = 500;

/**
 * 物理表名带 lottery_ 前缀。
 * 原因：CloudBase PG 的 public schema 由同一环境内的所有业务共用，
 * account / draws / logs 这类通用名容易与其他业务撞车，加前缀是低成本的隔离。
 * DuckDB 驱动沿用无前缀表名（独立文件库，无冲突可能），差异由驱动层吸收。
 */
const T = {
  draws: 'lottery_draws',
  runs: 'lottery_prediction_runs',
  bets: 'lottery_bets',
  settlements: 'lottery_settlements',
  equity: 'lottery_equity_snapshots',
  account: 'lottery_account',
  txns: 'lottery_fund_transactions',
  logs: 'lottery_operation_log',
} as const;

const ACCOUNT_COLS = 'initial_capital, cash, total_invested, total_prize';
const DRAW_COLS = 'period, draw_date, red1, red2, red3, red4, red5, red6, blue';
const BET_COLS = 'id, reds, blue, cost';

interface CloudBaseConfig {
  base: string;
  apiKey: string;
}

let config: CloudBaseConfig | null = null;

function loadConfig(): CloudBaseConfig {
  if (config) return config;
  const envId = (process.env.CLOUDBASE_ENV_ID ?? '').trim();
  const override = (process.env.CLOUDBASE_API_BASE ?? '').trim();
  const apiKey = (process.env.CLOUDBASE_API_KEY ?? '').trim();
  if (!envId && !override) {
    throw new Error(
      '[CloudBase] 缺少环境变量 CLOUDBASE_ENV_ID（或用于自定义网关的 CLOUDBASE_API_BASE）'
    );
  }
  if (!apiKey) {
    throw new Error(
      '[CloudBase] 缺少环境变量 CLOUDBASE_API_KEY（在云开发控制台创建 API Key）'
    );
  }
  config = { base: restBaseUrl(envId, override), apiKey };
  return config;
}

async function request(
  url: string,
  init: RequestInit = {}
): Promise<unknown> {
  const { apiKey } = loadConfig();
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(
      `[CloudBase] ${init.method ?? 'GET'} ${url} 失败：HTTP ${res.status} ${text.slice(0, 300)}`
    );
  }
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function select<T>(table: string, cols: string): Promise<T[]> {
  const { base } = loadConfig();
  return request(buildTableUrl(base, table, { select: cols })).then((p) =>
    toRows<T>(p, `select ${table}`)
  );
}

function selectWhere<T>(
  table: string,
  cols: string,
  filters: Record<string, string>,
  opts: { order?: string; limit?: number } = {}
): Promise<T[]> {
  const { base } = loadConfig();
  return request(buildTableUrl(base, table, { select: cols, filters, ...opts })).then(
    (p) => toRows<T>(p, `select ${table}`)
  );
}

async function insertRows(
  table: string,
  rows: Record<string, unknown>[]
): Promise<void> {
  if (rows.length === 0) return;
  const { base } = loadConfig();
  for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
    const chunk = rows.slice(i, i + INSERT_CHUNK);
    await request(buildTableUrl(base, table, {}), {
      method: 'POST',
      body: JSON.stringify(chunk),
    });
  }
}

async function insertRow(
  table: string,
  row: Record<string, unknown>
): Promise<void> {
  const { base } = loadConfig();
  await request(buildTableUrl(base, table, {}), {
    method: 'POST',
    body: JSON.stringify(row),
  });
}

async function callRpc(fn: string, args: Record<string, unknown>): Promise<unknown> {
  const { base } = loadConfig();
  return request(buildRpcUrl(base, fn), {
    method: 'POST',
    body: JSON.stringify(args),
  });
}

/** 进程内单写者串行队列（与 DuckDB 驱动同语义） */
let queue: Promise<unknown> = Promise.resolve();

function serialize<T>(fn: () => Promise<T>): Promise<T> {
  const result = queue.then(fn, fn);
  queue = result.then(
    () => undefined,
    () => undefined
  );
  return result;
}

let initPromise: Promise<void> | null = null;

export const cloudbaseDriver: StorageDriver = {
  kind: 'cloudbase',

  init(): Promise<void> {
    if (!initPromise) {
      initPromise = (async () => {
        // 探针：确认网关可达、密钥有效、表已迁移
        await selectWhere<{ period: string }>(T.draws, 'period', {}, { limit: 1 });
      })().catch((err) => {
        initPromise = null;
        throw err;
      });
    }
    return initPromise;
  },

  serialize,

  async listDraws(): Promise<DrawRow[]> {
    return select<DrawRow>(T.draws, DRAW_COLS);
  },

  async countDraws(): Promise<number> {
    const rows = await selectWhere<{ period: string }>(T.draws, 'period', {});
    return rows.length;
  },

  /**
   * 先取已存在的期号做差集，只 POST 缺失行——不依赖 PostgREST 的
   * resolution=ignore-duplicates 这类可选行为，计数也更确定。
   */
  async insertDraws(rows): Promise<number> {
    if (rows.length === 0) return 0;
    const existing = await selectWhere<{ period: string }>(T.draws, 'period', {});
    const seen = new Set(existing.map((r) => r.period));
    const missing = rows.filter((r) => !seen.has(r.period));
    if (missing.length === 0) return 0;
    await insertRows(
      T.draws,
      missing.map((d) => ({
        period: d.period,
        draw_date: d.draw_date,
        red1: d.red1,
        red2: d.red2,
        red3: d.red3,
        red4: d.red4,
        red5: d.red5,
        red6: d.red6,
        blue: d.blue,
      }))
    );
    return missing.length;
  },

  async ensureAccount(initialCapital): Promise<AccountRow> {
    const rows = await selectWhere<AccountRow>(T.account, ACCOUNT_COLS, {
      id: 'eq.1',
    });
    if (rows.length > 0) return rows[0];
    const created: AccountRow = {
      initial_capital: initialCapital,
      cash: initialCapital,
      total_invested: 0,
      total_prize: 0,
    };
    await insertRow(T.account, { id: 1, ...created });
    return created;
  },

  async listPendingPeriods(): Promise<string[]> {
    const rows = await selectWhere<{ period: string }>(
      T.bets,
      'period',
      { status: 'eq.pending' },
      { order: 'period.asc' }
    );
    return [...new Set(rows.map((r) => r.period))];
  },

  async findLatestPendingRun(): Promise<PendingRunRow | null> {
    const bets = await selectWhere<{ run_id: number }>(T.bets, 'run_id', {
      status: 'eq.pending',
    });
    const runIds = [...new Set(bets.map((b) => b.run_id))];
    if (runIds.length === 0) return null;
    const runs = await selectWhere<PendingRunRow>(
      T.runs,
      'id, period, created_at',
      { id: inExpr(runIds) },
      { order: 'id.desc', limit: 1 }
    );
    return runs.length > 0 ? runs[0] : null;
  },

  listBetsOfRun(runId): Promise<BetRow[]> {
    return selectWhere<BetRow>(
      T.bets,
      BET_COLS,
      { run_id: `eq.${runId}` },
      { order: 'id.asc' }
    );
  },

  listPendingBets(period): Promise<BetRow[]> {
    return selectWhere<BetRow>(
      T.bets,
      BET_COLS,
      { period: `eq.${period}`, status: 'eq.pending' },
      { order: 'id.asc' }
    );
  },

  listSettlements(limit): Promise<SettlementRow[]> {
    return selectWhere<SettlementRow>(
      T.settlements,
      'period, red_hits, blue_hit, prize_tier, prize, profit, settled_at',
      {},
      { order: 'settled_at.desc,id.desc', limit }
    );
  },

  listEquitySnapshots(): Promise<EquityRow[]> {
    return selectWhere<EquityRow>(
      T.equity,
      'period, cash, cum_profit, roi',
      {},
      { order: 'period.asc' }
    );
  },

  listOperationLogs(limit): Promise<OperationLogRow[]> {
    return selectWhere<OperationLogRow>(
      T.logs,
      'type, message, created_at',
      {},
      { order: 'id.desc', limit }
    );
  },

  async logOperation(type, message, detail): Promise<void> {
    await insertRow(T.logs, { type, message, detail });
  },

  async commitBuy(p: BuyCommit): Promise<number> {
    const result = await callRpc('lottery_commit_buy', { p_payload: p });
    const runId = toScalar(result);
    if (runId === null) {
      throw new Error(
        `[CloudBase] lottery_commit_buy 未返回批次 ID，响应：${JSON.stringify(result).slice(0, 200)}`
      );
    }
    return runId;
  },

  async commitSettlement(p: SettlementCommit): Promise<void> {
    await callRpc('lottery_commit_settlement', { p_payload: p });
  },

  async resetLedger(initialCapital: number): Promise<void> {
    await callRpc('lottery_reset_ledger', {
      p_payload: { initialCapital },
    });
  },
};
