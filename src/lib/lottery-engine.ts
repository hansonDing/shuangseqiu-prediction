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

  // === 蓝球得分 (v3: 多策略融合 + 周期分析) ===
  const blueScores: Record<number, number> = {};
  const maxBlueCount = Math.max(...freq.blue.map((f) => f.count), 1);

  // 策略A: 频率 + 渐进遗漏 (降低权重)
  for (let i = 1; i <= 16; i++) {
    const item = freq.blue.find((f) => f.number === i);
    const freqScore = item ? item.count / maxBlueCount : 0;
    const gapScore = item ? progressiveGapWeight(item.last_seen, item.avg_interval) : 0;
    blueScores[i] = freqScore * 0.2 + gapScore * 0.25;
  }

  // 策略B: 时间衰减近期热度
  const recentBlueDecay: Record<number, number> = {};
  for (let i = 1; i <= 16; i++) recentBlueDecay[i] = 0;
  recent.forEach((draw, idx) => {
    const weight = (recent.length - idx) / recent.length;
    recentBlueDecay[draw.blue] += weight;
  });
  const maxBlueDecay = Math.max(...Object.values(recentBlueDecay), 0.01);
  for (let i = 1; i <= 16; i++) {
    blueScores[i] += (recentBlueDecay[i] / maxBlueDecay) * 0.15;
  }

  // 策略C: 奇偶/大小周期分析 (改进版)
  const last10 = sorted.slice(-10);
  const blueHistory = last10.map((d) => d.blue);

  // 奇偶模式: 分析最近5期的奇偶变化趋势
  const last5OddEven = blueHistory.slice(-5).map((b) => b % 2);
  const lastBlueOddEven = last5OddEven[last5OddEven.length - 1];
  // 计算奇偶连续次数
  let consecutiveSame = 1;
  for (let i = last5OddEven.length - 2; i >= 0; i--) {
    if (last5OddEven[i] === last5OddEven[i + 1]) consecutiveSame++;
    else break;
  }
  // 连续同奇偶越多，下期变化概率越高
  const changeProb = Math.min(0.8, 0.3 + consecutiveSame * 0.15);
  const predictedOddEven = changeProb > 0.5 ? 1 - lastBlueOddEven : lastBlueOddEven;

  // 大小模式: 同样分析连续变化
  const last5BigSmall = blueHistory.slice(-5).map((b) => b > 8 ? 1 : 0);
  const lastBlueBigSmall = last5BigSmall[last5BigSmall.length - 1];
  let bsConsecutive = 1;
  for (let i = last5BigSmall.length - 2; i >= 0; i--) {
    if (last5BigSmall[i] === last5BigSmall[i + 1]) bsConsecutive++;
    else break;
  }
  const bsChangeProb = Math.min(0.8, 0.3 + bsConsecutive * 0.15);
  const predictedBigSmall = bsChangeProb > 0.5 ? 1 - lastBlueBigSmall : lastBlueBigSmall;

  // 给符合模式的蓝球加分 (降低权重避免过度影响)
  for (let i = 1; i <= 16; i++) {
    const isOdd = i % 2 === 1;
    const isBig = i > 8;
    let patternBonus = 0;
    if (isOdd === (predictedOddEven === 1)) patternBonus += 0.08;
    if (isBig === (predictedBigSmall === 1)) patternBonus += 0.08;
    blueScores[i] += patternBonus;
  }

  // 策略D: 遗漏周期分析 (新增)
  // 蓝球平均遗漏周期约16期，超过平均周期的号码有回补倾向
  for (let i = 1; i <= 16; i++) {
    const item = freq.blue.find((f) => f.number === i);
    if (item && item.last_seen > 12) {
      // 超过12期未出现，给予额外回补分
      const overdueBonus = Math.min(0.15, (item.last_seen - 12) * 0.02);
      blueScores[i] += overdueBonus;
    }
  }

  // 策略E: 红蓝关联分析
  const highFreqReds = new Set(
    freq.red
      .sort((a, b) => b.count - a.count)
      .slice(0, 12)
      .map((f) => f.number)
  );
  const blueRedCorrelation: Record<number, number> = {};
  for (let i = 1; i <= 16; i++) blueRedCorrelation[i] = 0;
  recent.forEach((draw) => {
    const drawReds = [draw.red1, draw.red2, draw.red3, draw.red4, draw.red5, draw.red6];
    const overlap = drawReds.filter((r) => highFreqReds.has(r)).length;
    if (overlap >= 2) {
      blueRedCorrelation[draw.blue] += overlap / 6;
    }
  });
  const maxCorrelation = Math.max(...Object.values(blueRedCorrelation), 0.01);
  for (let i = 1; i <= 16; i++) {
    blueScores[i] += (blueRedCorrelation[i] / maxCorrelation) * 0.08;
  }

  // === 确定性组合生成 ===
  // 按综合得分排序，选出 Top 18 候选
  const redCandidates = Object.entries(redScores)
    .map(([num, score]) => ({ number: parseInt(num), score }))
    .sort((a, b) => b.score - a.score);
  const topReds = redCandidates.slice(0, 18).map((c) => c.number);

  const blueCandidates = Object.entries(blueScores)
    .map(([num, score]) => ({ number: parseInt(num), score }))
    .sort((a, b) => b.score - a.score);
  const topBlues = blueCandidates.slice(0, 8); // 扩大到 Top 8 增加多样性

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
        blue: topBlues[finalCombos.length % topBlues.length].number,
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
          blue: topBlues[finalCombos.length % topBlues.length].number,
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
