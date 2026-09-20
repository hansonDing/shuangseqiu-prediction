/**
 * 双色球开奖数据抓取模块
 * 数据源：500.com (datachart.500.com/ssq)
 */
import { upsertDraws, getLatestPeriod, ensureDrawsLoaded } from '../storage/database/draw-repository';

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
  const malformedPeriods: string[] = [];

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

  let match;
  while ((match = rowPattern.exec(html)) !== null) {
    let period = match[1];
    // 补全期号：26073 -> 2026073；非 7 位的畸形期号记录下来并跳过，避免脏数据
    if (period.length === 5) {
      period = '20' + period;
    }
    if (period.length !== 7) {
      malformedPeriods.push(period);
      continue;
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
    // 日期与该行绑定：在本行结束后的有限窗口内查找最近日期，
    // 避免全局顺序消费导致页面其他日期文本引起整体错位
    const afterRow = html.slice(match.index + match[0].length, match.index + match[0].length + 400);
    const drawDate = afterRow.match(/\d{4}-\d{2}-\d{2}/)?.[0] || '';

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

  if (malformedPeriods.length > 0) {
    console.warn(
      `[LotteryFetcher] 跳过 ${malformedPeriods.length} 条畸形期号数据: ${malformedPeriods.slice(0, 5).join(', ')}${malformedPeriods.length > 5 ? ' ...' : ''}`
    );
  }

  return draws;
}

/**
 * 将抓取的数据同步到本地存储
 */
export async function syncDrawsToDatabase(draws: LotteryDraw[]): Promise<{
  inserted: number;
  skipped: number;
  latestPeriod: string | null;
}> {
  const { inserted, skipped } = await upsertDraws(draws);

  await ensureDrawsLoaded();
  const latestPeriod = getLatestPeriod();
  return { inserted, skipped, latestPeriod };
}

/**
 * 获取存储中最新一期数据
 */
export async function getLatestPeriodInDb(): Promise<string | null> {
  await ensureDrawsLoaded();
  return getLatestPeriod();
}
