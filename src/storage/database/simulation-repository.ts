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

/** 状态查询（settlements/equity/logs 在结算任务中补全） */
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
  const settlements = await all<{
    period: string;
    red_hits: number;
    blue_hit: boolean;
    prize_tier: number;
    prize: number;
    profit: number;
    settled_at: string;
  }>(
    `SELECT period, red_hits, blue_hit, prize_tier, prize, profit, settled_at
     FROM settlements ORDER BY settled_at DESC, id DESC LIMIT 50`
  );
  const equity = await all<{
    period: string;
    cash: number;
    cum_profit: number;
    roi: number;
  }>(
    `SELECT period, cash, cum_profit, roi FROM equity_snapshots ORDER BY period ASC`
  );
  const logs = await all<{ type: string; message: string; created_at: string }>(
    `SELECT type, message, created_at FROM operation_log ORDER BY id DESC LIMIT 20`
  );
  return {
    account: {
      initial_capital: round2(account.initial_capital),
      cash: round2(account.cash),
      total_invested: round2(account.total_invested),
      total_prize: round2(account.total_prize),
    },
    pending,
    settlements: settlements.map((s) => ({
      ...s,
      prize: round2(s.prize),
      profit: round2(s.profit),
    })),
    equity: equity.map((e) => ({
      ...e,
      cash: round2(e.cash),
      cum_profit: round2(e.cum_profit),
    })),
    logs,
    config: { betCount: BET_COUNT, betCost: BET_COST },
  };
}

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
