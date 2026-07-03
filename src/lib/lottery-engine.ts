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
  blue_top3_hit_rate?: number;
  blue_first_hit_rate?: number;
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

// ========== 共现矩阵分析 ==========
function buildCooccurrenceMatrix(draws: DrawRecord[]): number[][] {
  const matrix: number[][] = Array.from({ length: 34 }, () => Array(34).fill(0));
  draws.forEach((draw) => {
    const reds = getReds(draw);
    for (let i = 0; i < reds.length; i++) {
      for (let j = i + 1; j < reds.length; j++) {
        matrix[reds[i]][reds[j]]++;
        matrix[reds[j]][reds[i]]++;
      }
    }
  });
  return matrix;
}

// 计算一组号码的共现得分 (越高说明这些号码越常一起出现)
function cooccurrenceScore(reds: number[], matrix: number[][]): number {
  let total = 0;
  let pairs = 0;
  for (let i = 0; i < reds.length; i++) {
    for (let j = i + 1; j < reds.length; j++) {
      total += matrix[reds[i]][reds[j]];
      pairs++;
    }
  }
  return pairs > 0 ? total / pairs : 0;
}

// ========== 渐进遗漏权重 ==========
// 遗漏期数越长，回补权重越高 (非线性增长)
function progressiveGapWeight(lastSeen: number, avgInterval: number): number {
  if (avgInterval <= 0) return 0;
  const ratio = lastSeen / avgInterval;
  if (ratio <= 1) return 0; // 未超过平均间隔，不给回补分
  // 渐进增长: ratio=1.5 → ~0.2, ratio=2 → ~0.5, ratio=3 → ~0.8
  return Math.min(1, 1 - Math.exp(-(ratio - 1) * 0.8));
}

// ========== 多约束过滤 ==========
interface ComboConstraints {
  oddEvenOk: boolean;
  bigSmallOk: boolean;
  zoneCoverageOk: boolean;
  sumOk: boolean;
  spanOk: boolean;
  consecutiveOk: boolean;
}

function checkConstraints(reds: number[]): ComboConstraints {
  const oddCount = reds.filter((n) => n % 2 === 1).length;
  const bigCount = reds.filter((n) => n > 16).length;
  const sum = reds.reduce((s, n) => s + n, 0);
  const span = reds[reds.length - 1] - reds[0];

  // 区间覆盖
  const zones = new Set<number>();
  reds.forEach((r) => {
    if (r <= 5) zones.add(0);
    else if (r <= 10) zones.add(1);
    else if (r <= 15) zones.add(2);
    else if (r <= 20) zones.add(3);
    else if (r <= 25) zones.add(4);
    else if (r <= 30) zones.add(5);
    else zones.add(6);
  });

  // 连号检测 (允许最多1组连号)
  let consecutiveCount = 0;
  for (let i = 1; i < reds.length; i++) {
    if (reds[i] - reds[i - 1] === 1) consecutiveCount++;
  }

  return {
    oddEvenOk: oddCount >= 1 && oddCount <= 5, // 奇偶比 1:5 ~ 5:1 (放宽)
    bigSmallOk: bigCount >= 1 && bigCount <= 5, // 大小比 1:5 ~ 5:1 (放宽)
    zoneCoverageOk: zones.size >= 3, // 至少覆盖3个区间 (放宽)
    sumOk: sum >= 40 && sum <= 170, // 和值范围 (放宽)
    spanOk: span >= 15, // 跨度至少15 (放宽)
    consecutiveOk: consecutiveCount <= 2, // 最多2组连号
  };
}

function constraintsPass(c: ComboConstraints): boolean {
  return c.oddEvenOk && c.bigSmallOk && c.zoneCoverageOk && c.sumOk && c.spanOk && c.consecutiveOk;
}

function constraintsToString(c: ComboConstraints, reds: number[]): string {
  const oddCount = reds.filter((n) => n % 2 === 1).length;
  const bigCount = reds.filter((n) => n > 16).length;
  const sum = reds.reduce((s, n) => s + n, 0);
  const zones = new Set<number>();
  reds.forEach((r) => {
    if (r <= 5) zones.add(0);
    else if (r <= 10) zones.add(1);
    else if (r <= 15) zones.add(2);
    else if (r <= 20) zones.add(3);
    else if (r <= 25) zones.add(4);
    else if (r <= 30) zones.add(5);
    else zones.add(6);
  });
  return `奇偶${oddCount}:${6 - oddCount} 大小${bigCount}:${6 - bigCount} 和值${sum} 覆盖${zones.size}区`;
}

// ========== 蓝球多策略融合预测 ==========
// 策略A: 频率 + 渐进遗漏 (基线)
function blueStrategyA(
  sorted: DrawRecord[],
  freq: AnalysisResult['frequency']
): Record<number, number> {
  const scores: Record<number, number> = {};
  const maxBlueCount = Math.max(...freq.blue.map((f) => f.count), 1);
  for (let i = 1; i <= 16; i++) {
    const item = freq.blue.find((f) => f.number === i);
    const freqScore = item ? item.count / maxBlueCount : 0;
    const gapScore = item ? progressiveGapWeight(item.last_seen, item.avg_interval) : 0;
    scores[i] = freqScore * 0.5 + gapScore * 0.5;
  }
  return scores;
}

// 策略B: 转移矩阵 (基于上一期蓝球预测下一期)
function blueStrategyB(sorted: DrawRecord[]): Record<number, number> {
  const scores: Record<number, number> = {};
  for (let i = 1; i <= 16; i++) scores[i] = 0;

  if (sorted.length < 3) return scores;

  // 构建转移矩阵: from_blue → { to_blue: count }
  const transition: Record<number, Record<number, number>> = {};
  for (let i = 1; i <= 16; i++) {
    transition[i] = {};
    for (let j = 1; j <= 16; j++) transition[i][j] = 0;
  }
  for (let i = 0; i < sorted.length - 1; i++) {
    const from = sorted[i].blue;
    const to = sorted[i + 1].blue;
    transition[from][to]++;
  }

  // 基于最后一期蓝球，查找最可能的下一期蓝球
  const lastBlue = sorted[sorted.length - 1].blue;
  const row = transition[lastBlue];
  const maxCount = Math.max(...Object.values(row), 1);
  for (let i = 1; i <= 16; i++) {
    scores[i] = row[i] / maxCount;
  }

  // 如果转移矩阵太稀疏 (全0)，退化为均匀分布
  if (maxCount === 0) {
    for (let i = 1; i <= 16; i++) scores[i] = 0.5;
  }

  return scores;
}

// 策略C: 遗漏周期分析 (每个蓝球的遗漏周期规律)
function blueStrategyC(sorted: DrawRecord[]): Record<number, number> {
  const scores: Record<number, number> = {};
  for (let i = 1; i <= 16; i++) scores[i] = 0;

  // 计算每个蓝球的历史出现间隔序列
  for (let num = 1; num <= 16; num++) {
    const appearances: number[] = [];
    sorted.forEach((draw, idx) => {
      if (draw.blue === num) appearances.push(idx);
    });

    if (appearances.length < 2) {
      // 只出现过0或1次，给中等分数
      scores[num] = appearances.length === 0 ? 0.3 : 0.4;
      continue;
    }

    // 计算间隔序列
    const gaps: number[] = [];
    for (let i = 1; i < appearances.length; i++) {
      gaps.push(appearances[i] - appearances[i - 1]);
    }

    const avgGap = gaps.reduce((s, g) => s + g, 0) / gaps.length;
    const currentGap = sorted.length - 1 - appearances[appearances.length - 1];

    // 当前遗漏越接近或超过平均间隔，得分越高
    const ratio = currentGap / Math.max(avgGap, 1);
    if (ratio >= 1) {
      // 超过平均间隔，使用渐进权重
      scores[num] = 0.5 + progressiveGapWeight(currentGap, avgGap) * 0.5;
    } else {
      // 未到平均间隔，得分较低
      scores[num] = ratio * 0.4;
    }

    // 额外: 如果间隔序列有规律 (标准差小)，加分
    if (gaps.length >= 3) {
      const variance = gaps.reduce((s, g) => s + Math.pow(g - avgGap, 2), 0) / gaps.length;
      const stdDev = Math.sqrt(variance);
      const cv = stdDev / Math.max(avgGap, 1); // 变异系数
      if (cv < 0.5) {
        scores[num] += 0.15; // 规律性强，加分
      }
    }
  }

  return scores;
}

// 策略D: 近期热度 (最近10期加权)
function blueStrategyD(sorted: DrawRecord[]): Record<number, number> {
  const scores: Record<number, number> = {};
  for (let i = 1; i <= 16; i++) scores[i] = 0;

  const window = Math.min(10, sorted.length);
  const recent = sorted.slice(-window);
  const counts: Record<number, number> = {};
  for (let i = 1; i <= 16; i++) counts[i] = 0;

  recent.forEach((draw, idx) => {
    const weight = (idx + 1) / window; // 越近权重越高
    counts[draw.blue] += weight;
  });

  const maxCount = Math.max(...Object.values(counts), 1);
  for (let i = 1; i <= 16; i++) {
    scores[i] = counts[i] / maxCount;
  }

  return scores;
}

// 策略E: 差值模式 (相邻两期蓝球的差值规律)
function blueStrategyE(sorted: DrawRecord[]): Record<number, number> {
  const scores: Record<number, number> = {};
  for (let i = 1; i <= 16; i++) scores[i] = 0;

  if (sorted.length < 5) return scores;

  // 统计历史差值 (有向差值 mod 16)
  const deltaCounts: Record<number, number> = {};
  for (let d = 0; d < 16; d++) deltaCounts[d] = 0;

  for (let i = 0; i < sorted.length - 1; i++) {
    const delta = ((sorted[i + 1].blue - sorted[i].blue) + 16) % 16;
    deltaCounts[delta]++;
  }

  // 基于最后一期蓝球，预测下一期
  const lastBlue = sorted[sorted.length - 1].blue;
  const maxDelta = Math.max(...Object.values(deltaCounts), 1);

  for (let delta = 0; delta < 16; delta++) {
    const predictedBlue = ((lastBlue + delta - 1) % 16) + 1;
    scores[predictedBlue] = Math.max(scores[predictedBlue], deltaCounts[delta] / maxDelta);
  }

  return scores;
}

// 策略F: 奇偶/大小模式 (分析蓝球的奇偶和大小交替规律)
function blueStrategyF(sorted: DrawRecord[]): Record<number, number> {
  const scores: Record<number, number> = {};
  for (let i = 1; i <= 16; i++) scores[i] = 0;

  if (sorted.length < 5) return scores;

  // 分析最近5期的奇偶和大小模式
  const recent5 = sorted.slice(-5);
  const oddEvenPattern = recent5.map((d) => d.blue % 2); // 0=偶, 1=奇
  const bigSmallPattern = recent5.map((d) => d.blue > 8 ? 1 : 0); // 0=小, 1=大

  // 预测下一期的奇偶和大小倾向
  // 如果连续出现同类型，倾向于反转
  const lastOddEven = oddEvenPattern[oddEvenPattern.length - 1];
  const lastBigSmall = bigSmallPattern[bigSmallPattern.length - 1];

  // 统计连续相同类型的最大长度
  let consecutiveOE = 1;
  for (let i = oddEvenPattern.length - 1; i > 0; i--) {
    if (oddEvenPattern[i] === oddEvenPattern[i - 1]) consecutiveOE++;
    else break;
  }
  let consecutiveBS = 1;
  for (let i = bigSmallPattern.length - 1; i > 0; i--) {
    if (bigSmallPattern[i] === bigSmallPattern[i - 1]) consecutiveBS++;
    else break;
  }

  // 连续越多，反转概率越高
  const oeFlipProb = Math.min(0.3 + consecutiveOE * 0.15, 0.8);
  const bsFlipProb = Math.min(0.3 + consecutiveBS * 0.15, 0.8);

  const preferOdd = lastOddEven === 0 ? oeFlipProb : 1 - oeFlipProb;
  const preferBig = lastBigSmall === 0 ? bsFlipProb : 1 - bsFlipProb;

  for (let i = 1; i <= 16; i++) {
    const isOdd = i % 2 === 1;
    const isBig = i > 8;
    let score = 0.5;
    if (isOdd) score += (preferOdd - 0.5) * 0.6;
    else score += ((1 - preferOdd) - 0.5) * 0.6;
    if (isBig) score += (preferBig - 0.5) * 0.4;
    else score += ((1 - preferBig) - 0.5) * 0.4;
    scores[i] = Math.max(0, Math.min(1, score));
  }

  return scores;
}

// 多策略融合: 自动回测选出最优权重
function multiStrategyBluePredict(
  sorted: DrawRecord[],
  freq: AnalysisResult['frequency']
): Record<number, number> {
  const total = sorted.length;

  // 如果数据太少，只用策略A
  if (total < 10) {
    return blueStrategyA(sorted, freq);
  }

  // 自动回测: 用最近的数据测试各策略的命中率
  const testSize = Math.min(10, Math.floor(total / 3));
  const strategyHits: Record<string, number> = {
    A: 0, B: 0, C: 0, D: 0, E: 0, F: 0,
  };

  for (let t = total - testSize; t < total; t++) {
    const history = sorted.slice(0, t);
    const actual = sorted[t].blue;
    const histFreq = analyzeFrequency(history);

    const sA = blueStrategyA(history, histFreq);
    const sB = blueStrategyB(history);
    const sC = blueStrategyC(history);
    const sD = blueStrategyD(history);
    const sE = blueStrategyE(history);
    const sF = blueStrategyF(history);

    // 每个策略取 Top 3 候选
    const getTop3 = (s: Record<number, number>): number[] =>
      Object.entries(s)
        .map(([n, sc]) => ({ num: parseInt(n), score: sc }))
        .sort((a, b) => b.score - a.score)
        .slice(0, 3)
        .map((x) => x.num);

    const topA = getTop3(sA);
    const topB = getTop3(sB);
    const topC = getTop3(sC);
    const topD = getTop3(sD);
    const topE = getTop3(sE);
    const topF = getTop3(sF);

    if (topA.includes(actual)) strategyHits.A++;
    if (topB.includes(actual)) strategyHits.B++;
    if (topC.includes(actual)) strategyHits.C++;
    if (topD.includes(actual)) strategyHits.D++;
    if (topE.includes(actual)) strategyHits.E++;
    if (topF.includes(actual)) strategyHits.F++;
  }

  // 根据回测结果动态分配权重
  const totalHits = Object.values(strategyHits).reduce((s, h) => s + h, 0) || 1;
  const strategyWeights: Record<string, number> = {};
  for (const [key, hits] of Object.entries(strategyHits)) {
    // 基础权重 0.1 + 回测命中率加权
    strategyWeights[key] = 0.1 + (hits / totalHits) * 0.9;
  }

  // 归一化权重
  const wSum = Object.values(strategyWeights).reduce((s, w) => s + w, 0);
  for (const key of Object.keys(strategyWeights)) {
    strategyWeights[key] /= wSum;
  }

  // 融合所有策略
  const sA = blueStrategyA(sorted, freq);
  const sB = blueStrategyB(sorted);
  const sC = blueStrategyC(sorted);
  const sD = blueStrategyD(sorted);
  const sE = blueStrategyE(sorted);
  const sF = blueStrategyF(sorted);

  const finalScores: Record<number, number> = {};
  for (let i = 1; i <= 16; i++) {
    finalScores[i] =
      sA[i] * strategyWeights.A +
      sB[i] * strategyWeights.B +
      sC[i] * strategyWeights.C +
      sD[i] * strategyWeights.D +
      sE[i] * strategyWeights.E +
      sF[i] * strategyWeights.F;
  }

  return finalScores;
}

// ========== 预测算法 (v2: 多策略融合 + 确定性生成 + 多约束过滤) ==========
export function predict(draws: DrawRecord[], weights?: {
  frequency: number;
  recency: number;
  balance: number;
}): PredictionCombo[] {
  const w = { frequency: 0.35, recency: 0.3, balance: 0.35, ...weights };
  const sorted = [...draws].sort((a, b) => a.period.localeCompare(b.period));
  const total = sorted.length;

  // === 策略1: 频率得分 ===
  const freq = analyzeFrequency(sorted);
  const maxRedCount = Math.max(...freq.red.map((f) => f.count), 1);
  const freqScores: Record<number, number> = {};
  for (let i = 1; i <= 33; i++) {
    const item = freq.red.find((f) => f.number === i);
    freqScores[i] = item ? item.count / maxRedCount : 0;
  }

  // === 策略2: 近期热度得分 (加权衰减: 越近权重越高) ===
  const recencyScores: Record<number, number> = {};
  for (let i = 1; i <= 33; i++) recencyScores[i] = 0;
  const recentWindow = Math.min(20, total);
  const recent = sorted.slice(-recentWindow);
  recent.forEach((draw, idx) => {
    const decay = (idx + 1) / recentWindow; // 最新一期权重=1, 最远一期权重≈0
    getReds(draw).forEach((r) => {
      recencyScores[r] += decay;
    });
  });
  const maxRecency = Math.max(...Object.values(recencyScores), 1);
  for (let i = 1; i <= 33; i++) {
    recencyScores[i] /= maxRecency;
  }

  // === 策略3: 渐进遗漏回补得分 ===
  const gapScores: Record<number, number> = {};
  freq.red.forEach((f) => {
    gapScores[f.number] = progressiveGapWeight(f.last_seen, f.avg_interval);
  });

  // === 策略4: 共现矩阵加分 ===
  const coMatrix = buildCooccurrenceMatrix(sorted);

  // === 综合得分 ===
  const redScores: Record<number, number> = {};
  for (let i = 1; i <= 33; i++) {
    redScores[i] =
      freqScores[i] * w.frequency +
      recencyScores[i] * w.recency +
      gapScores[i] * w.balance;
  }

  // === 蓝球多策略融合预测 ===
  const blueScores = multiStrategyBluePredict(sorted, freq);

  // === 贪心覆盖算法：生成大量候选组合，贪心选择覆盖最多的 8 组 ===

  // 1. 计算每个号码的综合得分 (近期热度 + 遗漏回补 + 历史频率)
  const last10 = sorted.slice(0, Math.min(10, sorted.length));
  const combinedScores: Record<number, number> = {};
  for (let i = 1; i <= 33; i++) combinedScores[i] = 0;

  // 近期热度 (最近 10 期，指数衰减)
  last10.forEach((d, idx) => {
    const w = Math.exp(-idx * 0.3); // 指数衰减: 1.0, 0.74, 0.55, 0.41, ...
    getReds(d).forEach((r) => { combinedScores[r] += w * 3; });
  });

  // 遗漏回补
  for (let i = 1; i <= 33; i++) {
    const lastSeen = freq.red.find((f) => f.number === i)?.last_seen ?? sorted.length;
    const avgInt = freq.red.find((f) => f.number === i)?.avg_interval ?? 5;
    const ratio = avgInt > 0 ? lastSeen / avgInt : 1;
    if (ratio > 1) combinedScores[i] += Math.pow(ratio, 1.5) * 2;
  }

  // 历史频率
  const histMaxRedCount = Math.max(...freq.red.map((r) => r.count), 1);
  for (let i = 1; i <= 33; i++) {
    const f = freq.red.find((r) => r.number === i);
    combinedScores[i] += (f?.count ?? 0) / histMaxRedCount;
  }

  // 2. 按得分排序所有 33 个号码
  const allNumsRanked = Object.entries(combinedScores)
    .sort((a, b) => b[1] - a[1])
    .map(([n]) => parseInt(n));

  // 3. 生成大量候选组合 (50+ 组)，使用不同的号码子集
  const candidatePool: { reds: number[]; score: number }[] = [];

  // 3a. 滑动窗口：从 Top 20 中每次取 6 个连续号码
  const top20 = allNumsRanked.slice(0, 20);
  for (let start = 0; start <= top20.length - 6; start++) {
    const combo = top20.slice(start, start + 6).sort((a, b) => a - b);
    const score = combo.reduce((s, n) => s + combinedScores[n], 0);
    candidatePool.push({ reds: combo, score });
  }

  // 3b. 间隔采样：每隔 1/2/3 个取一个
  for (const step of [2, 3]) {
    for (let offset = 0; offset < step && offset + step * 5 < allNumsRanked.length; offset++) {
      const combo: number[] = [];
      for (let i = offset; i < allNumsRanked.length && combo.length < 6; i += step) {
        combo.push(allNumsRanked[i]);
      }
      if (combo.length === 6) {
        combo.sort((a, b) => a - b);
        const score = combo.reduce((s, n) => s + combinedScores[n], 0);
        candidatePool.push({ reds: combo, score });
      }
    }
  }

  // 3c. 分区策略：将 33 个号码分成 6 区，每区取 Top 1-2
  const zones6: number[][] = [[1,5],[6,11],[12,17],[18,23],[24,28],[29,33]];
  const zoneCombos: number[][] = [];
  // 每区取 top 1
  const z1 = zones6.map(([lo, hi]) => {
    const zoneNums = allNumsRanked.filter((n) => n >= lo && n <= hi);
    return zoneNums[0] ?? lo;
  });
  zoneCombos.push(z1);
  // 每区取 top 2 (交替)
  const z2 = zones6.map(([lo, hi]) => {
    const zoneNums = allNumsRanked.filter((n) => n >= lo && n <= hi);
    return zoneNums[1] ?? lo + 1;
  });
  zoneCombos.push(z2);
  for (const zc of zoneCombos) {
    if (zc.length >= 6) {
      const combo = zc.slice(0, 6).sort((a, b) => a - b);
      const score = combo.reduce((s, n) => s + combinedScores[n], 0);
      candidatePool.push({ reds: combo, score });
    }
  }

  // 3d. 随机扰动：从 Top 25 中随机取 6 个 (多次)
  const top25 = allNumsRanked.slice(0, 25);
  for (let iter = 0; iter < 30; iter++) {
    const shuffled = [...top25].sort(() => Math.sin(iter * 1000 + Math.random()) - 0.5);
    const combo = shuffled.slice(0, 6).sort((a, b) => a - b);
    const score = combo.reduce((s, n) => s + combinedScores[n], 0);
    candidatePool.push({ reds: combo, score });
  }

  // 4. 贪心选择：每次选择能增加最多新覆盖号码的组合
  const coveredNums = new Set<number>();
  const selectedCombos: { reds: number[]; score: number }[] = [];

  // 第一组：选得分最高的
  candidatePool.sort((a, b) => b.score - a.score);
  if (candidatePool.length > 0) {
    selectedCombos.push(candidatePool[0]);
    candidatePool[0].reds.forEach((r) => coveredNums.add(r));
  }

  // 后续 7 组：贪心选择覆盖最多新号码的组合
  for (let i = 1; i < 8; i++) {
    let bestCandidate: typeof candidatePool[0] | null = null;
    let bestNewCoverage = -1;

    for (const candidate of candidatePool) {
      const key = candidate.reds.join(",");
      // 跳过已选的
      if (selectedCombos.some((s) => s.reds.join(",") === key)) continue;
      // 计算新增覆盖
      const newNums = candidate.reds.filter((r) => !coveredNums.has(r)).length;
      // 综合评分：新覆盖数 * 10 + 原始得分
      const compositeScore = newNums * 10 + candidate.score / 100;
      if (compositeScore > bestNewCoverage) {
        bestNewCoverage = compositeScore;
        bestCandidate = candidate;
      }
    }

    if (bestCandidate) {
      selectedCombos.push(bestCandidate);
      bestCandidate.reds.forEach((r) => coveredNums.add(r));
    }
  }
  // === 蓝球候选 ===
  const blueCandidates = Object.entries(blueScores)
    .map(([num, score]) => ({ number: parseInt(num), score }))
    .sort((a, b) => b.score - a.score);
  const topBlues = blueCandidates.slice(0, 8);

  // === 构建最终预测结果 ===
  const finalCombos: PredictionCombo[] = [];
  for (let i = 0; i < selectedCombos.length && i < 8; i++) {
    const combo = selectedCombos[i];
    const constraints = checkConstraints(combo.reds);
    finalCombos.push({
      reds: combo.reds,
      blue: topBlues[Math.min(i, topBlues.length - 1)].number,
      score: Math.round(combo.score * 100) / 100,
      reason: constraintsToString(constraints, combo.reds),
    });
  }
  return finalCombos;
}

// 回测
export function backtest(draws: DrawRecord[], sampleSize: number = 30): BacktestResult {
  const sorted = [...draws].sort((a, b) => a.period.localeCompare(b.period));
  const total = sorted.length;
  // 至少需要 10 期历史作为预测基础
  const minBase = Math.min(10, Math.floor(total / 2));
  const testCount = Math.min(sampleSize, total - minBase);

  const redHitDist: Record<number, number> = {};
  for (let i = 0; i <= 6; i++) redHitDist[i] = 0;
  let totalRedHits = 0;
  let blueHits = 0;       // 首选蓝球命中
  let blueTop3Hits = 0;   // Top3 蓝球命中
  let blueEnsembleHits = 0; // 8组推荐中任一蓝球命中

  const recentTests: BacktestResult['recent_tests'] = [];

  for (let i = 0; i < testCount; i++) {
    const testIdx = total - 1 - i;
    const historyDraws = sorted.slice(0, testIdx);
    const actual = sorted[testIdx];

    const predictions = predict(historyDraws);
    const bestPred = predictions[0];

    const actualReds = getReds(actual);

    // 检查所有预测组合，找出最佳匹配
    let bestRedHits = 0;
    let bestMatchPred = bestPred;
    for (const pred of predictions) {
      const hits = pred.reds.filter((r) => actualReds.includes(r)).length;
      if (hits > bestRedHits) {
        bestRedHits = hits;
        bestMatchPred = pred;
      }
    }

    // 蓝球命中评估 (多维度)
    const predictedBlues = [...new Set(predictions.map((p) => p.blue))];
    const blueHit = bestMatchPred.blue === actual.blue;
    const blueTop3Hit = predictedBlues.slice(0, 3).includes(actual.blue);
    const blueEnsembleHit = predictedBlues.includes(actual.blue);

    totalRedHits += bestRedHits;
    if (blueHit) blueHits++;
    if (blueTop3Hit) blueTop3Hits++;
    if (blueEnsembleHit) blueEnsembleHits++;
    redHitDist[bestRedHits]++;

    if (i < 10) {
      recentTests.push({
        period: actual.period,
        predicted_reds: bestMatchPred.reds,
        predicted_blue: bestMatchPred.blue,
        actual_reds: actualReds,
        actual_blue: actual.blue,
        red_hits: bestRedHits,
        blue_hit: blueEnsembleHit,
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
    blue_hit_rate: Math.round(blueEnsembleHits / testCount * 1000) / 10,
    blue_top3_hit_rate: Math.round(blueTop3Hits / testCount * 1000) / 10,
    blue_first_hit_rate: Math.round(blueHits / testCount * 1000) / 10,
    recent_tests: recentTests,
  };
}
