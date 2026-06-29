/**
 * 双色球分析引擎
 * 提供频率分析、大小号分析、奇偶分析、区间分析、预测算法和回测功能
 */

export interface DrawRecord {
  id: number;
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

export interface FrequencyItem {
  number: number;
  count: number;
  rate: number;
  last_seen: number;
  avg_interval: number;
}

export interface AnalysisResult {
  frequency: {
    red: FrequencyItem[];
    blue: FrequencyItem[];
  };
  bigSmall: {
    big_count: number;
    small_count: number;
    trend: { period: string; big: number; small: number }[];
  };
  oddEven: {
    odd_count: number;
    even_count: number;
    trend: { period: string; odd: number; even: number }[];
  };
  zones: {
    zone: string;
    count: number;
    rate: number;
  }[];
  recent_draws: DrawRecord[];
}

export interface PredictionCombo {
  reds: number[];
  blue: number;
  score: number;
  reason: string;
}

export interface BacktestResult {
  total_periods: number;
  tested_periods: number;
  avg_red_hits: number;
  avg_blue_hits: number;
  red_hit_distribution: { hits: number; count: number }[];
  blue_hit_rate: number;
  recent_tests: {
    period: string;
    predicted_reds: number[];
    predicted_blue: number;
    actual_reds: number[];
    actual_blue: number;
    red_hits: number;
    blue_hit: boolean;
  }[];
}

function getReds(draw: DrawRecord): number[] {
  return [draw.red1, draw.red2, draw.red3, draw.red4, draw.red5, draw.red6].sort((a, b) => a - b);
}

// 频率分析
function analyzeFrequency(draws: DrawRecord[]): { red: FrequencyItem[]; blue: FrequencyItem[] } {
  const total = draws.length;
  const redCounts: Record<number, number> = {};
  const blueCounts: Record<number, number> = {};
  const redLastSeen: Record<number, number> = {};
  const blueLastSeen: Record<number, number> = {};

  for (let i = 1; i <= 33; i++) { redCounts[i] = 0; redLastSeen[i] = -1; }
  for (let i = 1; i <= 16; i++) { blueCounts[i] = 0; blueLastSeen[i] = -1; }

  draws.forEach((draw, idx) => {
    const reds = getReds(draw);
    reds.forEach((r) => {
      redCounts[r]++;
      redLastSeen[r] = idx;
    });
    blueCounts[draw.blue]++;
    blueLastSeen[draw.blue] = idx;
  });

  const red: FrequencyItem[] = [];
  for (let i = 1; i <= 33; i++) {
    const lastSeen = redLastSeen[i] >= 0 ? total - 1 - redLastSeen[i] : total;
    const avgInterval = redCounts[i] > 0 ? Math.round(total / redCounts[i] * 10) / 10 : 0;
    red.push({
      number: i,
      count: redCounts[i],
      rate: Math.round(redCounts[i] / total * 1000) / 10,
      last_seen: lastSeen,
      avg_interval: avgInterval,
    });
  }

  const blue: FrequencyItem[] = [];
  for (let i = 1; i <= 16; i++) {
    const lastSeen = blueLastSeen[i] >= 0 ? total - 1 - blueLastSeen[i] : total;
    const avgInterval = blueCounts[i] > 0 ? Math.round(total / blueCounts[i] * 10) / 10 : 0;
    blue.push({
      number: i,
      count: blueCounts[i],
      rate: Math.round(blueCounts[i] / total * 1000) / 10,
      last_seen: lastSeen,
      avg_interval: avgInterval,
    });
  }

  return { red, blue };
}

// 大小号分析 (1-16小, 17-33大)
function analyzeBigSmall(draws: DrawRecord[]): AnalysisResult['bigSmall'] {
  let bigCount = 0;
  let smallCount = 0;
  const trend: { period: string; big: number; small: number }[] = [];

  draws.forEach((draw) => {
    const reds = getReds(draw);
    let big = 0;
    let small = 0;
    reds.forEach((r) => {
      if (r <= 16) small++;
      else big++;
    });
    bigCount += big;
    smallCount += small;
    trend.push({ period: draw.period, big, small });
  });

  return { big_count: bigCount, small_count: smallCount, trend: trend.slice(-30) };
}

// 奇偶分析
function analyzeOddEven(draws: DrawRecord[]): AnalysisResult['oddEven'] {
  let oddCount = 0;
  let evenCount = 0;
  const trend: { period: string; odd: number; even: number }[] = [];

  draws.forEach((draw) => {
    const reds = getReds(draw);
    let odd = 0;
    let even = 0;
    reds.forEach((r) => {
      if (r % 2 === 1) odd++;
      else even++;
    });
    oddCount += odd;
    evenCount += even;
    trend.push({ period: draw.period, odd, even });
  });

  return { odd_count: oddCount, even_count: evenCount, trend: trend.slice(-30) };
}

// 区间分析 (7个区间)
function analyzeZones(draws: DrawRecord[]): AnalysisResult['zones'] {
  const zoneLabels = ['01-05', '06-10', '11-15', '16-20', '21-25', '26-30', '31-33'];
  const zoneCounts = [0, 0, 0, 0, 0, 0, 0];
  let total = 0;

  draws.forEach((draw) => {
    const reds = getReds(draw);
    reds.forEach((r) => {
      if (r <= 5) zoneCounts[0]++;
      else if (r <= 10) zoneCounts[1]++;
      else if (r <= 15) zoneCounts[2]++;
      else if (r <= 20) zoneCounts[3]++;
      else if (r <= 25) zoneCounts[4]++;
      else if (r <= 30) zoneCounts[5]++;
      else zoneCounts[6]++;
      total++;
    });
  });

  return zoneLabels.map((zone, i) => ({
    zone,
    count: zoneCounts[i],
    rate: Math.round(zoneCounts[i] / total * 1000) / 10,
  }));
}

// 完整分析
export function analyze(draws: DrawRecord[]): AnalysisResult {
  const sorted = [...draws].sort((a, b) => a.period.localeCompare(b.period));
  return {
    frequency: analyzeFrequency(sorted),
    bigSmall: analyzeBigSmall(sorted),
    oddEven: analyzeOddEven(sorted),
    zones: analyzeZones(sorted),
    recent_draws: sorted.slice(-20).reverse(),
  };
}

// 预测算法
export function predict(draws: DrawRecord[], weights?: {
  frequency: number;
  recency: number;
  balance: number;
}): PredictionCombo[] {
  const w = { frequency: 0.4, recency: 0.35, balance: 0.25, ...weights };
  const sorted = [...draws].sort((a, b) => a.period.localeCompare(b.period));
  const total = sorted.length;

  // 计算每个红球的综合得分
  const redScores: Record<number, number> = {};
  for (let i = 1; i <= 33; i++) redScores[i] = 0;

  // 频率得分
  const freq = analyzeFrequency(sorted);
  const maxRedCount = Math.max(...freq.red.map((f) => f.count));
  freq.red.forEach((f) => {
    redScores[f.number] += (f.count / maxRedCount) * w.frequency;
  });

  // 近期热度得分 (最近20期)
  const recent = sorted.slice(-20);
  const recentCounts: Record<number, number> = {};
  for (let i = 1; i <= 33; i++) recentCounts[i] = 0;
  recent.forEach((draw) => {
    getReds(draw).forEach((r) => { recentCounts[r]++; });
  });
  const maxRecentCount = Math.max(...Object.values(recentCounts), 1);
  for (let i = 1; i <= 33; i++) {
    redScores[i] += (recentCounts[i] / maxRecentCount) * w.recency;
  }

  // 遗漏回补得分 (长期未出现的号码有回补概率)
  freq.red.forEach((f) => {
    if (f.last_seen > f.avg_interval * 1.5) {
      redScores[f.number] += 0.3 * w.balance;
    }
  });

  // 蓝球得分
  const blueScores: Record<number, number> = {};
  for (let i = 1; i <= 16; i++) blueScores[i] = 0;
  const maxBlueCount = Math.max(...freq.blue.map((f) => f.count));
  freq.blue.forEach((f) => {
    blueScores[f.number] += (f.count / maxBlueCount) * w.frequency;
    if (f.last_seen > f.avg_interval * 1.5) {
      blueScores[f.number] += 0.3 * w.balance;
    }
  });
  const recentBlueCounts: Record<number, number> = {};
  for (let i = 1; i <= 16; i++) recentBlueCounts[i] = 0;
  recent.forEach((draw) => { recentBlueCounts[draw.blue]++; });
  const maxRecentBlue = Math.max(...Object.values(recentBlueCounts), 1);
  for (let i = 1; i <= 16; i++) {
    blueScores[i] += (recentBlueCounts[i] / maxRecentBlue) * w.recency;
  }

  // 排序选出候选红球
  const redCandidates = Object.entries(redScores)
    .map(([num, score]) => ({ number: parseInt(num), score }))
    .sort((a, b) => b.score - a.score);

  const blueCandidates = Object.entries(blueScores)
    .map(([num, score]) => ({ number: parseInt(num), score }))
    .sort((a, b) => b.score - a.score);

  // 生成组合 (确保大小号、奇偶平衡)
  const combos: PredictionCombo[] = [];
  const topReds = redCandidates.slice(0, 15).map((c) => c.number);
  const topBlues = blueCandidates.slice(0, 5);

  // 生成8组推荐
  for (let i = 0; i < 8; i++) {
    const selected: number[] = [];
    const pool = [...topReds];

    // 确保大小号平衡 (2-4个大号)
    const targetBig = 2 + Math.floor(Math.random() * 3);
    let bigPicked = 0;

    while (selected.length < 6 && pool.length > 0) {
      const idx = Math.floor(Math.random() * Math.min(pool.length, 8));
      const num = pool[idx];
      const isBig = num > 16;

      if (selected.length >= 4 && bigPicked >= targetBig && isBig) {
        pool.splice(idx, 1);
        continue;
      }
      if (selected.length >= 4 && bigPicked < targetBig - 1 && !isBig && pool.some((n) => n > 16)) {
        pool.splice(idx, 1);
        continue;
      }

      selected.push(num);
      if (isBig) bigPicked++;
      pool.splice(idx, 1);
    }

    selected.sort((a, b) => a - b);
    const blue = topBlues[i % topBlues.length];

    const oddCount = selected.filter((n) => n % 2 === 1).length;
    const bigCount = selected.filter((n) => n > 16).length;
    const avgScore = selected.reduce((sum, n) => sum + redScores[n], 0) / 6;

    combos.push({
      reds: selected,
      blue: blue.number,
      score: Math.round(avgScore * 100) / 100,
      reason: `奇偶比${oddCount}:${6 - oddCount} 大小比${bigCount}:${6 - bigCount} 综合评分${(avgScore * 100).toFixed(1)}`,
    });
  }

  // 按得分排序
  combos.sort((a, b) => b.score - a.score);
  return combos;
}

// 回测
export function backtest(draws: DrawRecord[], sampleSize: number = 30): BacktestResult {
  const sorted = [...draws].sort((a, b) => a.period.localeCompare(b.period));
  const total = sorted.length;
  const testCount = Math.min(sampleSize, total - 50);

  const redHitDist: Record<number, number> = {};
  for (let i = 0; i <= 6; i++) redHitDist[i] = 0;
  let totalRedHits = 0;
  let blueHits = 0;

  const recentTests: BacktestResult['recent_tests'] = [];

  for (let i = 0; i < testCount; i++) {
    const testIdx = total - 1 - i;
    const historyDraws = sorted.slice(0, testIdx);
    const actual = sorted[testIdx];

    const predictions = predict(historyDraws);
    const bestPred = predictions[0];

    const actualReds = getReds(actual);
    const redHits = bestPred.reds.filter((r) => actualReds.includes(r)).length;
    const blueHit = bestPred.blue === actual.blue;

    totalRedHits += redHits;
    if (blueHit) blueHits++;
    redHitDist[redHits]++;

    if (i < 10) {
      recentTests.push({
        period: actual.period,
        predicted_reds: bestPred.reds,
        predicted_blue: bestPred.blue,
        actual_reds: actualReds,
        actual_blue: actual.blue,
        red_hits: redHits,
        blue_hit: blueHit,
      });
    }
  }

  return {
    total_periods: total,
    tested_periods: testCount,
    avg_red_hits: Math.round(totalRedHits / testCount * 100) / 100,
    avg_blue_hits: Math.round(blueHits / testCount * 100) / 100,
    red_hit_distribution: Object.entries(redHitDist).map(([hits, count]) => ({
      hits: parseInt(hits),
      count,
    })),
    blue_hit_rate: Math.round(blueHits / testCount * 1000) / 10,
    recent_tests: recentTests,
  };
}
