/**
 * 存储驱动语义接口
 *
 * 设计原则：仓库层（draw-repository / simulation-repository）只依赖本接口，不写任何 SQL。
 * 这样同一套业务逻辑可以跑在两种后端上：
 *   - duckdb   ：本地 / 自建服务器，文件型数据库
 *   - cloudbase：腾讯云 CloudBase PostgreSQL（云托管），服务端经 PostgREST 访问
 *
 * 业务计算（走势预测 predict、中奖判定 judgeTicket）一律留在 JS 侧，驱动只管持久化。
 * 三个「原子提交」方法承担多步写入的事务性：
 *   - DuckDB     用 BEGIN / COMMIT 事务实现
 *   - CloudBase  用 PostgreSQL 函数（RPC）实现，一次调用即一个事务
 */

export type StorageKind = 'duckdb' | 'cloudbase';

/** draws 表一行（与 DB 列同名，字段含义见 lottery-engine 的 DrawRecord） */
export interface DrawRow {
  period: string;
  draw_date: string;
  red1: number;
  red2: number;
  red3: number;
  red4: number;
  red5: number;
  red6: number;
  blue: number;
}

export interface AccountRow {
  initial_capital: number;
  cash: number;
  total_invested: number;
  total_prize: number;
}

export interface PendingRunRow {
  id: number;
  period: string;
  created_at: string;
}

export interface BetRow {
  id: number;
  /** JSON 数组文本，如 "[1,2,3,4,5,6]" */
  reds: string;
  blue: number;
  cost: number;
}

export interface SettlementRow {
  period: string;
  red_hits: number;
  blue_hit: boolean;
  prize_tier: number;
  prize: number;
  profit: number;
  settled_at: string;
}

export interface EquityRow {
  period: string;
  cash: number;
  cum_profit: number;
  roi: number;
}

export interface OperationLogRow {
  type: string;
  message: string;
  created_at: string;
}

/** 买入的原子提交载荷：期号与注单已由 JS 算好，驱动只负责一次性落库 */
export interface BuyCommit {
  period: string;
  /** 权重快照（JSON 文本） */
  weights: string;
  combos: { reds: number[]; blue: number }[];
  betCost: number;
  prizeFirst: number;
  prizeSecond: number;
  /** 本轮总投入，用于扣减现金 */
  totalCost: number;
  /** 写入 fund_transactions 的备注 */
  txnNote: string;
  /**
   * 写入 operation_log 的消息。
   * 日志明细由驱动组装为 `{"runId": <新批次 id>, "cost": <totalCost>}`，
   * 因为 runId 只有在落库之后才会产生。
   */
  logMessage: string;
}

/** 单期结算的原子提交载荷 */
export interface SettlementCommit {
  period: string;
  results: {
    betId: number;
    redHits: number;
    blueHit: boolean;
    tier: number;
    prize: number;
    profit: number;
    /** 中奖时写入 fund_transactions 的备注（未中奖不会写流水） */
    prizeNote: string;
  }[];
  /** 本期奖金合计 */
  periodPrize: number;
  logMessage: string;
}

export interface StorageDriver {
  readonly kind: StorageKind;

  /** 幂等初始化（建表 / 校验连通性） */
  init(): Promise<void>;

  /**
   * 单写者串行队列：仓库层的复合写路径必须包在这里。
   * 注意：驱动内部的原子提交方法不得再调用它，否则会造成队列自锁。
   */
  serialize<T>(fn: () => Promise<T>): Promise<T>;

  // ---------- 开奖数据 ----------
  listDraws(): Promise<DrawRow[]>;
  countDraws(): Promise<number>;
  /** 插入开奖数据，已存在的期号自动跳过；返回实际插入条数 */
  insertDraws(rows: Omit<DrawRow, 'id'>[]): Promise<number>;

  // ---------- 模拟盘：读 ----------
  /** 取账户行，不存在则按初始资本创建 */
  ensureAccount(initialCapital: number): Promise<AccountRow>;
  /** 有未结算持仓的期号（升序） */
  listPendingPeriods(): Promise<string[]>;
  /** 最近一次仍有未结算持仓的预测批次 */
  findLatestPendingRun(): Promise<PendingRunRow | null>;
  listBetsOfRun(runId: number): Promise<BetRow[]>;
  listPendingBets(period: string): Promise<BetRow[]>;
  listSettlements(limit: number): Promise<SettlementRow[]>;
  listEquitySnapshots(): Promise<EquityRow[]>;
  listOperationLogs(limit: number): Promise<OperationLogRow[]>;

  // ---------- 模拟盘：写 ----------
  logOperation(type: string, message: string, detail: string | null): Promise<void>;

  /** 原子：写入预测批次 + 全部注单 + 扣款 + 资金流水 + 操作日志；返回 runId */
  commitBuy(payload: BuyCommit): Promise<number>;

  /** 原子：写入本期结算 + 标记注单已结算 + 入账奖金 + 资金流水 + 净值快照 + 操作日志 */
  commitSettlement(payload: SettlementCommit): Promise<void>;

  /** 原子：清空全部模拟盘数据并把资金恢复为初始资本 */
  resetLedger(initialCapital: number): Promise<void>;
}
