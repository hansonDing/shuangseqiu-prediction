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
    oddEvenOk: oddCount >= 2 && oddCount <= 4, // 奇偶比 2:4 ~ 4:2
    bigSmallOk: bigCount >= 2 && bigCount <= 4, // 大小比 2:4 ~ 4:2
    zoneCoverageOk: zones.size >= 4, // 至少覆盖4个区间
    sumOk: sum >= 60 && sum <= 150, // 和值范围
    spanOk: span >= 18, // 跨度至少18
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

  // === 确定性组合生成 ===
  // 按综合得分排序，选出 Top 18 候选
  const redCandidates = Object.entries(redScores)
    .map(([num, score]) => ({ number: parseInt(num), score }))
    .sort((a, b) => b.score - a.score);
  const topReds = redCandidates.slice(0, 18).map((c) => c.number);

  const blueCandidates = Object.entries(blueScores)
    .map(([num, score]) => ({ number: parseInt(num), score }))
    .sort((a, b) => b.score - a.score);
  const topBlues = blueCandidates.slice(0, 8); // 取 Top 8 蓝球，确保每组推荐用不同蓝球

  // 从 Top 18 中生成所有 C(18,6) 组合的子集，用贪心策略筛选
  // 为了性能，使用分层采样: 按得分排名分为高/中/低三档，每档取2个
  const tier1 = topReds.slice(0, 6);  // 高得分
  const tier2 = topReds.slice(6, 12); // 中得分
  const tier3 = topReds.slice(12, 18); // 低得分

  const allCombos: { reds: number[]; score: number; coScore: number }[] = [];

  // 生成组合: 从三档中各取2个 (保证覆盖面)
  for (let a = 0; a < tier1.length; a++) {
    for (let b = a + 1; b < tier1.length; b++) {
      for (let c = 0; c < tier2.length; c++) {
        for (let d = c + 1; d < tier2.length; d++) {
          for (let e = 0; e < tier3.length; e++) {
            for (let f = e + 1; f < tier3.length; f++) {
              const reds = [tier1[a], tier1[b], tier2[c], tier2[d], tier3[e], tier3[f]].sort((x, y) => x - y);
              const constraints = checkConstraints(reds);
              if (!constraintsPass(constraints)) continue;

              const avgScore = reds.reduce((sum, n) => sum + redScores[n], 0) / 6;
              const coScore = cooccurrenceScore(reds, coMatrix);
              allCombos.push({ reds, score: avgScore, coScore });
            }
          }
        }
      }
    }
  }

  // 如果分层采样组合太少，补充纯 Top 得分组合
  if (allCombos.length < 20) {
    for (let i = 0; i < topReds.length - 5; i++) {
      for (let j = i + 1; j < topReds.length - 4; j++) {
        for (let k = j + 1; k < topReds.length - 3; k++) {
          for (let l = k + 1; l < topReds.length - 2; l++) {
            for (let m = l + 1; m < topReds.length - 1; m++) {
              for (let n = m + 1; n < topReds.length; n++) {
                const reds = [topReds[i], topReds[j], topReds[k], topReds[l], topReds[m], topReds[n]];
                const constraints = checkConstraints(reds);
                if (!constraintsPass(constraints)) continue;
                const avgScore = reds.reduce((sum, r) => sum + redScores[r], 0) / 6;
                const coScore = cooccurrenceScore(reds, coMatrix);
                allCombos.push({ reds, score: avgScore, coScore });
              }
            }
          }
        }
      }
    }
  }

  // 综合评分 = 号码得分 * 0.6 + 共现得分 * 0.4 (归一化)
  const maxCoScore = Math.max(...allCombos.map((c) => c.coScore), 1);
  allCombos.forEach((c) => {
    c.score = c.score * 0.6 + (c.coScore / maxCoScore) * 0.4;
  });

  // 按综合评分排序，取 Top 8
  allCombos.sort((a, b) => b.score - a.score);
  const top8 = allCombos.slice(0, 8);

  // 去重: 确保推荐组合之间差异足够大 (至少2个号码不同)
  const finalCombos: PredictionCombo[] = [];
  for (const combo of top8) {
    const isDuplicate = finalCombos.some((existing) => {
      const overlap = combo.reds.filter((r) => existing.reds.includes(r)).length;
      return overlap >= 5; // 5个以上号码相同视为重复
    });
    if (!isDuplicate) {
      const constraints = checkConstraints(combo.reds);
      finalCombos.push({
        reds: combo.reds,
        blue: topBlues[Math.min(finalCombos.length, topBlues.length - 1)].number,
        score: Math.round(combo.score * 100) / 100,
        reason: constraintsToString(constraints, combo.reds),
      });
    }
    if (finalCombos.length >= 8) break;
  }

  // 如果去重后不够8组，放宽约束补充
  if (finalCombos.length < 8) {
    for (const combo of allCombos) {
      if (finalCombos.length >= 8) break;
      const isDuplicate = finalCombos.some((existing) => {
        const overlap = combo.reds.filter((r) => existing.reds.includes(r)).length;
        return overlap >= 5;
      });
      if (!isDuplicate) {
        const constraints = checkConstraints(combo.reds);
        finalCombos.push({
          reds: combo.reds,
          blue: topBlues[Math.min(finalCombos.length, topBlues.length - 1)].number,
          score: Math.round(combo.score * 100) / 100,
          reason: constraintsToString(constraints, combo.reds),
        });
      }
    }
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
    const redHits = bestPred.reds.filter((r) => actualReds.includes(r)).length;

    // 蓝球命中评估 (多维度)
    const predictedBlues = [...new Set(predictions.map((p) => p.blue))];
    const blueHit = bestPred.blue === actual.blue;
    const blueTop3Hit = predictedBlues.slice(0, 3).includes(actual.blue);
    const blueEnsembleHit = predictedBlues.includes(actual.blue);

    totalRedHits += redHits;
    if (blueHit) blueHits++;
    if (blueTop3Hit) blueTop3Hits++;
    if (blueEnsembleHit) blueEnsembleHits++;
    redHitDist[redHits]++;

    if (i < 10) {
      recentTests.push({
        period: actual.period,
        predicted_reds: bestPred.reds,
        predicted_blue: bestPred.blue,
        actual_reds: actualReds,
        actual_blue: actual.blue,
        red_hits: redHits,
        blue_hit: blueEnsembleHit, // 使用 ensemble 命中作为展示
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
