/**
 * 双色球开奖数据抓取模块
 * 数据源：500.com (datachart.500.com/ssq)
 */
import { getSupabaseClient } from '../storage/database/supabase-client';

interface LotteryDraw {
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

/**
 * 从 500.com 抓取最新开奖数据
 * @param count 获取期数
 */
export async function fetchLatestDraws(count: number = 30): Promise<LotteryDraw[]> {
  const url = `https://datachart.500.com/ssq/history/newinc/history.php?start=00001&end=99999&limit=${count}`;

  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    },
    signal: AbortSignal.timeout(15000),
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  const html = await response.text();
  return parseHtml(html);
}

/**
 * 解析 HTML 表格提取开奖数据
 */
function parseHtml(html: string): LotteryDraw[] {
  const draws: LotteryDraw[] = [];

  // 500.com 的数据格式：
  // <td>2</td> (类型标识)
  // <td>26073</td> (期号，需要补全为 2026073)
  // <td class="t_cfont2">09</td> ... (6个红球)
  // <td class="t_cfont4">08</td> (蓝球)
  // ...
  // <td>2026-06-28</td> (日期)

  // 使用正则匹配每一行数据
  // 匹配模式：期号 + 6个红球 + 1个蓝球 + 日期
  const rowPattern = /<td>(\d{5,7})<\/td>\s*<td class="t_cfont2">(\d{2})<\/td>\s*<td class="t_cfont2">(\d{2})<\/td>\s*<td class="t_cfont2">(\d{2})<\/td>\s*<td class="t_cfont2">(\d{2})<\/td>\s*<td class="t_cfont2">(\d{2})<\/td>\s*<td class="t_cfont2">(\d{2})<\/td>\s*<td class="t_cfont4">(\d{2})<\/td>/g;

  // 日期模式
  const datePattern = /(\d{4}-\d{2}-\d{2})/g;
  const dates: string[] = [];
  let dateMatch;
  while ((dateMatch = datePattern.exec(html)) !== null) {
    dates.push(dateMatch[1]);
  }

  let match;
  let dateIndex = 0;
  while ((match = rowPattern.exec(html)) !== null) {
    let period = match[1];
    // 补全期号：26073 -> 2026073
    if (period.length === 5) {
      period = '20' + period;
    } else if (period.length === 6) {
      period = '20' + period;
    }

    const reds = [
      parseInt(match[2], 10),
      parseInt(match[3], 10),
      parseInt(match[4], 10),
      parseInt(match[5], 10),
      parseInt(match[6], 10),
      parseInt(match[7], 10),
    ].sort((a, b) => a - b);

    const blue = parseInt(match[8], 10);
    const drawDate = dates[dateIndex] || '';
    dateIndex++;

    // 验证数据有效性
    if (reds.every((r) => r >= 1 && r <= 33) && blue >= 1 && blue <= 16) {
      draws.push({
        period,
        draw_date: drawDate,
        red1: reds[0],
        red2: reds[1],
        red3: reds[2],
        red4: reds[3],
        red5: reds[4],
        red6: reds[5],
        blue,
      });
    }
  }

  return draws;
}

/**
 * 将抓取的数据同步到数据库
 */
export async function syncDrawsToDatabase(draws: LotteryDraw[]): Promise<{
  inserted: number;
  skipped: number;
  latestPeriod: string | null;
}> {
  const client = getSupabaseClient();
  let inserted = 0;
  let skipped = 0;

  for (const draw of draws) {
    // 检查是否已存在
    const { data: existing } = await client
      .from('lottery_draws')
      .select('id')
      .eq('period', draw.period)
      .maybeSingle();

    if (existing) {
      skipped++;
      continue;
    }

    // 插入新数据
    const { error } = await client.from('lottery_draws').insert(draw);
    if (error) {
      console.error(`插入期号 ${draw.period} 失败:`, error.message);
      continue;
    }
    inserted++;
  }

  const latestPeriod = draws.length > 0 ? draws[0].period : null;
  return { inserted, skipped, latestPeriod };
}

/**
 * 获取数据库中最新一期数据
 */
export async function getLatestPeriodInDb(): Promise<string | null> {
  const client = getSupabaseClient();
  const { data } = await client
    .from('lottery_draws')
    .select('period')
    .order('period', { ascending: false })
    .limit(1)
    .maybeSingle();

  return data?.period || null;
}
