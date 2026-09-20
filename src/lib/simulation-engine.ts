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
