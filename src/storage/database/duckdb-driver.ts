/**
 * DuckDB 存储驱动：本地 / 自建服务器默认后端
 *
 * 复用 duckdb.ts 的低层 SQL 原语（连接单例 + 串行写队列），
 * 把仓库层需要的语义操作翻译成 SQL。三个原子提交用 BEGIN / COMMIT 事务实现。
 */
import { initDatabase, all, run, serialize } from './duckdb';
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

const ACCOUNT_COLS = 'initial_capital, cash, total_invested, total_prize';
const DRAW_COLS =
  'period, draw_date, red1, red2, red3, red4, red5, red6, blue';
const BET_COLS = 'id, reds, blue, cost';

async function readAccount(): Promise<AccountRow> {
  const rows = await all<AccountRow>(
    `SELECT ${ACCOUNT_COLS} FROM account WHERE id = 1`
  );
  return rows[0];
}

/** 多步写入的事务包装（DuckDB 支持 BEGIN / COMMIT / ROLLBACK） */
async function tx<T>(fn: () => Promise<T>): Promise<T> {
  await run('BEGIN TRANSACTION');
  try {
    const result = await fn();
    await run('COMMIT');
    return result;
  } catch (err) {
    try {
      await run('ROLLBACK');
    } catch {
      // 回滚失败不掩盖原始错误
    }
    throw err;
  }
}

function insertOperationLog(
  type: string,
  message: string,
  detail: string | null
): Promise<void> {
  return run(
    `INSERT INTO operation_log (id, type, message, detail)
     VALUES (nextval('seq_global'), ?, ?, ?)`,
    type,
    message,
    detail
  ).then(() => undefined);
}

function ensureAccount(initialCapital: number): Promise<AccountRow> {
  return (async () => {
    await initDatabase();
    const rows = await all<AccountRow>(
      `SELECT ${ACCOUNT_COLS} FROM account WHERE id = 1`
    );
    if (rows.length > 0) return rows[0];
    await run(
      `INSERT INTO account (id, initial_capital, cash, total_invested, total_prize)
       VALUES (1, ?, ?, 0, 0)`,
      initialCapital,
      initialCapital
    );
    return readAccount();
  })();
}

export const duckdbDriver: StorageDriver = {
  kind: 'duckdb',

  init: () => initDatabase(),

  serialize,

  listDraws(): Promise<DrawRow[]> {
    return (async () => {
      await initDatabase();
      return all<DrawRow>(`SELECT ${DRAW_COLS} FROM draws ORDER BY period`);
    })();
  },

  countDraws(): Promise<number> {
    return (async () => {
      await initDatabase();
      const rows = await all<{ count: number }>(
        'SELECT count(*)::INT AS count FROM draws'
      );
      return rows[0].count;
    })();
  },

  insertDraws(rows): Promise<number> {
    return (async () => {
      await initDatabase();
      let inserted = 0;
      for (const d of rows) {
        // ON CONFLICT DO NOTHING + RETURNING：重复期号返回 0 行，据此统计真实插入数
        const hit = await all<{ period: string }>(
          `INSERT INTO draws (period, draw_date, red1, red2, red3, red4, red5, red6, blue)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT (period) DO NOTHING
           RETURNING period`,
          d.period,
          d.draw_date,
          d.red1,
          d.red2,
          d.red3,
          d.red4,
          d.red5,
          d.red6,
          d.blue
        );
        inserted += hit.length;
      }
      return inserted;
    })();
  },

  ensureAccount,

  listPendingPeriods(): Promise<string[]> {
    return (async () => {
      await initDatabase();
      const rows = await all<{ period: string }>(
        `SELECT DISTINCT period FROM bets WHERE status = 'pending' ORDER BY period`
      );
      return rows.map((r) => r.period);
    })();
  },

  findLatestPendingRun(): Promise<PendingRunRow | null> {
    return (async () => {
      await initDatabase();
      const rows = await all<PendingRunRow>(
        `SELECT id, period, created_at FROM prediction_runs
         WHERE id IN (SELECT DISTINCT run_id FROM bets WHERE status = 'pending')
         ORDER BY id DESC LIMIT 1`
      );
      return rows.length > 0 ? rows[0] : null;
    })();
  },

  listBetsOfRun(runId): Promise<BetRow[]> {
    return (async () => {
      await initDatabase();
      return all<BetRow>(
        `SELECT ${BET_COLS} FROM bets WHERE run_id = ? ORDER BY id`,
        runId
      );
    })();
  },

  listPendingBets(period): Promise<BetRow[]> {
    return (async () => {
      await initDatabase();
      return all<BetRow>(
        `SELECT ${BET_COLS} FROM bets WHERE period = ? AND status = 'pending' ORDER BY id`,
        period
      );
    })();
  },

  listSettlements(limit): Promise<SettlementRow[]> {
    return (async () => {
      await initDatabase();
      return all<SettlementRow>(
        `SELECT period, red_hits, blue_hit, prize_tier, prize, profit, settled_at
         FROM settlements ORDER BY settled_at DESC, id DESC LIMIT ?`,
        limit
      );
    })();
  },

  listEquitySnapshots(): Promise<EquityRow[]> {
    return (async () => {
      await initDatabase();
      return all<EquityRow>(
        `SELECT period, cash, cum_profit, roi FROM equity_snapshots ORDER BY period ASC`
      );
    })();
  },

  listOperationLogs(limit): Promise<OperationLogRow[]> {
    return (async () => {
      await initDatabase();
      return all<OperationLogRow>(
        `SELECT type, message, created_at FROM operation_log ORDER BY id DESC LIMIT ?`,
        limit
      );
    })();
  },

  logOperation(type, message, detail): Promise<void> {
    return (async () => {
      await initDatabase();
      await insertOperationLog(type, message, detail);
    })();
  },

  commitBuy(p: BuyCommit): Promise<number> {
    return (async () => {
      await initDatabase();
      return tx(async () => {
        // 事务内复核守卫：单写者队列之外的最后一道防线
        const pending = await all<{ period: string }>(
          `SELECT DISTINCT period FROM bets WHERE status = 'pending'`
        );
        if (pending.length > 0) {
          throw new Error(
            `已有未结算持仓（目标期 ${pending[0].period}），拒绝重复买入`
          );
        }
        const runRows = await all<{ id: number }>(
          `INSERT INTO prediction_runs (id, period, weights, combos, prize_first, prize_second)
           VALUES (nextval('seq_global'), ?, ?, ?, ?, ?) RETURNING id`,
          p.period,
          p.weights,
          JSON.stringify(p.combos),
          p.prizeFirst,
          p.prizeSecond
        );
        const runId = runRows[0].id;
        for (const c of p.combos) {
          await run(
            `INSERT INTO bets (id, run_id, period, reds, blue, cost)
             VALUES (nextval('seq_global'), ?, ?, ?, ?, ?)`,
            runId,
            p.period,
            JSON.stringify(c.reds),
            c.blue,
            p.betCost
          );
        }
        await run(
          `UPDATE account SET cash = cash - ?, total_invested = total_invested + ?, updated_at = now() WHERE id = 1`,
          p.totalCost,
          p.totalCost
        );
        const acc = await readAccount();
        await run(
          `INSERT INTO fund_transactions (id, type, amount, balance_after, ref_id, note)
           VALUES (nextval('seq_global'), 'buy', ?, ?, ?, ?)`,
          -p.totalCost,
          acc.cash,
          runId,
          p.txnNote
        );
        await run(
          `INSERT INTO operation_log (id, type, message, detail)
           VALUES (nextval('seq_global'), 'buy', ?, ?)`,
          p.logMessage,
          JSON.stringify({ runId, cost: p.totalCost })
        );
        return runId;
      });
    })();
  },

  commitSettlement(p: SettlementCommit): Promise<void> {
    return (async () => {
      await initDatabase();
      await tx(async () => {
        for (const r of p.results) {
          const sRows = await all<{ id: number }>(
            `INSERT INTO settlements (id, bet_id, period, red_hits, blue_hit, prize_tier, prize, profit)
             VALUES (nextval('seq_global'), ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
            r.betId,
            p.period,
            r.redHits,
            r.blueHit,
            r.tier,
            r.prize,
            r.profit
          );
          await run(`UPDATE bets SET status = 'settled' WHERE id = ?`, r.betId);
          if (r.prize > 0) {
            const acc = await readAccount();
            await run(
              `INSERT INTO fund_transactions (id, type, amount, balance_after, ref_id, note)
               VALUES (nextval('seq_global'), 'prize', ?, ?, ?, ?)`,
              r.prize,
              acc.cash,
              sRows[0].id,
              r.prizeNote
            );
          }
        }
        await run(
          `UPDATE account SET cash = cash + ?, total_prize = total_prize + ?, updated_at = now() WHERE id = 1`,
          p.periodPrize,
          p.periodPrize
        );
        const acc = await readAccount();
        const roi =
          acc.total_invested > 0
            ? (acc.total_prize - acc.total_invested) / acc.total_invested
            : 0;
        await run(
          `INSERT OR REPLACE INTO equity_snapshots (period, cash, total_invested, total_prize, cum_profit, roi)
           VALUES (?, ?, ?, ?, ?, ?)`,
          p.period,
          acc.cash,
          acc.total_invested,
          acc.total_prize,
          acc.total_prize - acc.total_invested,
          roi
        );
        await run(
          `INSERT INTO operation_log (id, type, message, detail)
           VALUES (nextval('seq_global'), 'settle', ?, ?)`,
          p.logMessage,
          null
        );
      });
    })();
  },

  resetLedger(initialCapital: number): Promise<void> {
    return (async () => {
      await initDatabase();
      await tx(async () => {
        await run('DELETE FROM settlements');
        await run('DELETE FROM bets');
        await run('DELETE FROM prediction_runs');
        await run('DELETE FROM equity_snapshots');
        await run('DELETE FROM fund_transactions');
        await run('DELETE FROM operation_log');
        await run(
          `INSERT OR REPLACE INTO account (id, initial_capital, cash, total_invested, total_prize)
           VALUES (1, ?, ?, 0, 0)`,
          initialCapital,
          initialCapital
        );
        await run(
          `INSERT INTO fund_transactions (id, type, amount, balance_after, ref_id, note)
           VALUES (nextval('seq_global'), 'reset', 0, ?, NULL, ?)`,
          initialCapital,
          `账本重置，资金恢复 ${initialCapital} 元`
        );
        await run(
          `INSERT INTO operation_log (id, type, message, detail)
           VALUES (nextval('seq_global'), 'reset', ?, ?)`,
          `模拟盘账本已重置，资金恢复 ${initialCapital} 元`,
          null
        );
      });
    })();
  },
};
