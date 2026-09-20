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
