/**
 * 模拟盘数据访问层：买入 / 结算 / 重置 / 状态查询
 *
 * 业务计算（走势预测、中奖判定）全部留在本层；
 * 持久化与事务性下沉到 StorageDriver 的原子提交方法。
 * 所有写路径经 driver.serialize() 串行，避免单写者竞争。
 */
import { predict } from '../../lib/lottery-engine';
import {
  judgeTicket,
  nextDrawPeriod,
  getPrizeConfig,
  TIER_NAMES,
} from '../../lib/simulation-engine';
import { ensureDrawsLoaded, getAllDraws } from './draw-repository';
import { getStorage } from './index';

const BET_COUNT = Number(process.env.SIMULATE_BET_COUNT) || 10;
const BET_COST = Number(process.env.SIMULATE_BET_COST) || 2;
const INITIAL_CAPITAL = Number(process.env.SIMULATE_INITIAL_CAPITAL) || 100000;

export interface BuyResult {
  ok: boolean;
  message: string;
  runId?: number;
}

const round2 = (x: number) => Math.round(x * 100) / 100;

/** 定时买入：已有未结算持仓 / 资金不足时跳过并记日志 */
export async function buyPredictions(weights: {
  frequency: number;
  recency: number;
  balance: number;
}): Promise<BuyResult> {
  const storage = getStorage();
  await ensureDrawsLoaded();
  return storage.serialize(async () => {
    const pending = await storage.listPendingPeriods();
    if (pending.length > 0) {
      const msg = `已有未结算持仓（目标期 ${pending[0]}），跳过本期买入`;
      await storage.logOperation('skip', msg, null);
      return { ok: false, message: msg };
    }
    const account = await storage.ensureAccount(INITIAL_CAPITAL);
    const totalCost = BET_COUNT * BET_COST;
    if (account.cash < totalCost) {
      const msg = `资金不足（余额 ${round2(account.cash)} 元），跳过本期买入`;
      await storage.logOperation('skip', msg, null);
      return { ok: false, message: msg };
    }
    const draws = getAllDraws();
    const target = nextDrawPeriod(draws[draws.length - 1]);
    const cfg = getPrizeConfig();
    const combos = predict(draws, weights, BET_COUNT);
    const runId = await storage.commitBuy({
      period: target,
      weights: JSON.stringify(weights),
      combos,
      betCost: BET_COST,
      prizeFirst: cfg.first,
      prizeSecond: cfg.second,
      totalCost,
      txnNote: `买入 ${BET_COUNT} 注 @ ${target}`,
      logMessage: `已买入 ${BET_COUNT} 注，目标期 ${target}`,
    });
    return {
      ok: true,
      message: `已买入 ${BET_COUNT} 注（目标期 ${target}），投入 ${totalCost} 元`,
      runId,
    };
  });
}

/** 状态查询（settlements/equity/logs 在结算任务中补全） */
export async function getSimulationStatus() {
  const storage = getStorage();
  await ensureDrawsLoaded();
  const account = await storage.ensureAccount(INITIAL_CAPITAL);

  const pendingRun = await storage.findLatestPendingRun();
  let pending: {
    period: string;
    bought_at: string;
    bets: { reds: number[]; blue: number; cost: number }[];
  } | null = null;
  if (pendingRun) {
    const bets = await storage.listBetsOfRun(pendingRun.id);
    pending = {
      period: pendingRun.period,
      bought_at: pendingRun.created_at,
      bets: bets.map((b) => ({
        reds: JSON.parse(b.reds) as number[],
        blue: b.blue,
        cost: b.cost,
      })),
    };
  }

  const settlements = await storage.listSettlements(50);
  const equity = await storage.listEquitySnapshots();
  const logs = await storage.listOperationLogs(20);

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
export async function settlePendingDraws(): Promise<{
  settled: number;
  pending: number;
}> {
  const storage = getStorage();
  await ensureDrawsLoaded();
  return storage.serialize(async () => {
    const periods = await storage.listPendingPeriods();
    const byPeriod = new Map(getAllDraws().map((d) => [d.period, d]));
    let settled = 0;
    for (const period of periods) {
      const draw = byPeriod.get(period);
      if (!draw) {
        await storage.logOperation(
          'skip',
          `期号 ${period} 开奖数据未入库，持仓继续挂起`,
          null
        );
        continue;
      }
      const cfg = getPrizeConfig();
      const bets = await storage.listPendingBets(period);
      const results = [];
      let periodPrize = 0;
      let periodCost = 0;
      for (const b of bets) {
        const res = judgeTicket(JSON.parse(b.reds) as number[], b.blue, draw, cfg);
        results.push({
          betId: b.id,
          redHits: res.redHits,
          blueHit: res.blueHit,
          tier: res.tier,
          prize: res.prize,
          profit: res.prize - b.cost,
          prizeNote: `期号 ${period} 中${TIER_NAMES[res.tier]} ${round2(res.prize)} 元`,
        });
        periodPrize += res.prize;
        periodCost += b.cost;
      }
      await storage.commitSettlement({
        period,
        results,
        periodPrize,
        logMessage:
          `期号 ${period} 结算完成：${bets.length} 注，` +
          `奖金 ${round2(periodPrize)} 元，投入 ${round2(periodCost)} 元`,
      });
      settled++;
    }
    return { settled, pending: periods.length - settled };
  });
}

/** 重置账本：清空所有模拟数据，资金恢复初始资本 */
export async function resetSimulation(): Promise<{ initial: number }> {
  const storage = getStorage();
  const initial = Number(process.env.SIMULATE_INITIAL_CAPITAL) || 100000;
  return storage.serialize(async () => {
    await storage.resetLedger(initial);
    return { initial };
  });
}
