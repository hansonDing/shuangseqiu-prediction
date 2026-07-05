// 智能选股引擎 - A股周K线趋势筛选

export interface StockInfo {
  code: string;
  symbol: string;
  name: string;
  price: number;
  change: number;
  changePercent: number;
  volume: number;
  amount: number;
  turnover: number;
  pe: number;
  pb: number;
  marketCap: number;
}

export interface WeeklyKline {
  date: string;
  open: number;
  close: number;
  high: number;
  low: number;
  volume: number;
}

export interface ScreenedStock extends StockInfo {
  weeklyKlines: WeeklyKline[];
  ma20: number;
  trend: 'strong_up' | 'up' | 'neutral' | 'down';
  weeksAboveMA20: number;
  threeWeekGain: number;
  score: number;
}

// 新浪财经API获取A股列表
export async function fetchAShareList(): Promise<StockInfo[]> {
  const stocks: StockInfo[] = [];
  const totalPages = 100; // 每页80条，最多取8000条

  for (let page = 1; page <= totalPages; page++) {
    const url = `https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/Market_Center.getHQNodeData?page=${page}&num=80&sort=changepercent&asc=0&node=hs_a&symbol=&_s_r_a=auto`;

    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Referer': 'https://finance.sina.com.cn/',
        },
      });

      if (!response.ok) break;

      const text = await response.text();
      if (!text || text === 'null' || text === '[]') break;

      let data: Array<{
        symbol: string;
        code: string;
        name: string;
        trade: string;
        pricechange: number;
        changepercent: number;
        volume: number;
        amount: number;
        turnoverratio: number;
        per: number;
        pb: number;
        mktcap: number;
        nmc: number;
      }>;

      try {
        data = JSON.parse(text);
      } catch {
        break;
      }

      if (!data || data.length === 0) break;

      for (const item of data) {
        const code = item.code;
        const name = item.name;

        // 排除创业板(300开头)和科创板(688开头)
        if (code.startsWith('300') || code.startsWith('688')) {
          continue;
        }

        // 排除北交所(8开头、9开头、4开头)
        if (code.startsWith('8') || code.startsWith('9') || code.startsWith('4')) {
          continue;
        }

        // 排除ST股票
        if (name.includes('ST') || name.includes('*ST')) {
          continue;
        }

        // 排除价格为0或无效
        const price = parseFloat(item.trade);
        if (!price || price <= 0) continue;

        stocks.push({
          code,
          symbol: item.symbol,
          name,
          price,
          change: item.pricechange || 0,
          changePercent: item.changepercent || 0,
          volume: item.volume || 0,
          amount: item.amount || 0,
          turnover: item.turnoverratio || 0,
          pe: item.per || 0,
          pb: item.pb || 0,
          marketCap: item.mktcap || 0,
        });
      }

      // 如果返回数据少于80条，说明已经是最后一页
      if (data.length < 80) break;
    } catch (error) {
      console.error(`Error fetching page ${page}:`, error);
      break;
    }
  }

  return stocks;
}

// 腾讯API获取周K线数据
export async function fetchWeeklyKline(symbol: string, weeks: number = 30): Promise<WeeklyKline[]> {
  const url = `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${symbol},week,,,${weeks},qfq`;

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
    });

    if (!response.ok) return [];

    const data = await response.json();
    if (!data.data) return [];

    // 找到对应的K线数据
    const stockData = data.data[symbol];
    if (!stockData) return [];

    // 优先使用qfqweek(前复权周K线)，否则使用week
    const klines = stockData.qfqweek || stockData.week;
    if (!klines || !Array.isArray(klines)) return [];

    return klines.map((k: (string | number | object)[]) => ({
      date: String(k[0]),
      open: parseFloat(String(k[1])),
      close: parseFloat(String(k[2])),
      high: parseFloat(String(k[3])),
      low: parseFloat(String(k[4])),
      volume: parseFloat(String(k[5])),
    })).filter((k: WeeklyKline) => !isNaN(k.close) && k.close > 0);
  } catch {
    return [];
  }
}

// 计算20周均线
export function calculateMA20(klines: WeeklyKline[]): number {
  if (klines.length < 20) return 0;
  const last20 = klines.slice(-20);
  const sum = last20.reduce((acc, k) => acc + k.close, 0);
  return sum / 20;
}

// 判断趋势
export function analyzeTrend(klines: WeeklyKline[]): 'strong_up' | 'up' | 'neutral' | 'down' {
  if (klines.length < 3) return 'neutral';

  const last3 = klines.slice(-3);
  const closes = last3.map(k => k.close);

  // 连续3周上涨
  const isUpTrend = closes[1] > closes[0] && closes[2] > closes[1];
  const isStrongUp = isUpTrend && (closes[2] - closes[0]) / closes[0] > 0.05;

  if (isStrongUp) return 'strong_up';
  if (isUpTrend) return 'up';

  // 连续3周下跌
  const isDownTrend = closes[1] < closes[0] && closes[2] < closes[1];
  if (isDownTrend) return 'down';

  return 'neutral';
}

// 计算最近3周是否在20日均线以上
export function checkWeeksAboveMA20(klines: WeeklyKline[], ma20: number): number {
  if (klines.length < 3 || ma20 === 0) return 0;

  const last3 = klines.slice(-3);
  let count = 0;
  for (const k of last3) {
    if (k.close > ma20) {
      count++;
    }
  }
  return count;
}

// 计算3周涨幅
export function calculateThreeWeekGain(klines: WeeklyKline[]): number {
  if (klines.length < 3) return 0;
  const last3 = klines.slice(-3);
  return (last3[2].close - last3[0].open) / last3[0].open;
}

// 计算综合评分
export function calculateScore(
  stock: StockInfo,
  klines: WeeklyKline[],
  ma20: number,
  trend: string,
  weeksAboveMA20: number,
  threeWeekGain: number
): number {
  let score = 0;

  // 趋势评分 (0-40)
  if (trend === 'strong_up') score += 40;
  else if (trend === 'up') score += 30;
  else if (trend === 'neutral') score += 10;

  // 均线以上周数评分 (0-30)
  score += weeksAboveMA20 * 10;

  // 涨幅评分 (0-15) - 最近3周涨幅适中为佳
  if (threeWeekGain > 0 && threeWeekGain < 0.15) score += 15;
  else if (threeWeekGain >= 0.15 && threeWeekGain < 0.25) score += 10;
  else if (threeWeekGain >= 0.25) score += 5;

  // 换手率评分 (0-10) - 适中换手率为佳
  if (stock.turnover > 0 && stock.turnover < 10) score += 10;
  else if (stock.turnover >= 10 && stock.turnover < 20) score += 5;

  // 市盈率评分 (0-5) - 合理PE为佳
  if (stock.pe > 0 && stock.pe < 30) score += 5;
  else if (stock.pe >= 30 && stock.pe < 50) score += 3;

  return score;
}

// 主筛选函数
export async function screenStocks(
  onProgress?: (current: number, total: number, message: string) => void
): Promise<ScreenedStock[]> {
  // 1. 获取A股列表
  onProgress?.(0, 0, '正在获取A股列表...');
  const allStocks = await fetchAShareList();
  console.log(`获取到 ${allStocks.length} 只A股 (已排除创业板、科创板和ST股)`);

  if (allStocks.length === 0) {
    throw new Error('无法获取股票数据，请稍后重试');
  }

  const results: ScreenedStock[] = [];
  const batchSize = 10;
  const total = allStocks.length;

  // 2. 分批获取周K线并筛选
  for (let i = 0; i < total; i += batchSize) {
    const batch = allStocks.slice(i, i + batchSize);

    onProgress?.(i, total, `正在分析 ${i}/${total}...`);

    const batchResults = await Promise.all(
      batch.map(async (stock) => {
        const klines = await fetchWeeklyKline(stock.symbol, 30);
        if (klines.length < 20) return null;

        const ma20 = calculateMA20(klines);
        if (ma20 === 0) return null;

        const trend = analyzeTrend(klines);
        const weeksAboveMA20 = checkWeeksAboveMA20(klines, ma20);

        // 核心筛选条件: 最近3周都在20日均线以上 且 上涨趋势
        if (weeksAboveMA20 < 3) return null;
        if (trend !== 'up' && trend !== 'strong_up') return null;

        const threeWeekGain = calculateThreeWeekGain(klines);
        const score = calculateScore(stock, klines, ma20, trend, weeksAboveMA20, threeWeekGain);

        return {
          ...stock,
          weeklyKlines: klines.slice(-5),
          ma20,
          trend,
          weeksAboveMA20,
          threeWeekGain,
          score,
        } as ScreenedStock;
      })
    );

    results.push(...batchResults.filter((r): r is ScreenedStock => r !== null));
  }

  // 3. 按评分排序
  results.sort((a, b) => b.score - a.score);

  console.log(`筛选完成: ${results.length} 只股票符合条件`);
  return results;
}
