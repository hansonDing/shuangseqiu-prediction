/**
 * 本地数据初始化脚本
 * 从 500.com 抓取双色球历史开奖数据，写入本地 JSON 存储
 * 用法：pnpm tsx scripts/seed-local-data.ts [抓取期数，默认 3000]
 */
import { fetchLatestDraws, syncDrawsToDatabase, getLatestPeriodInDb } from '../src/lib/lottery-fetcher';

async function main(): Promise<void> {
  const count = parseInt(process.argv[2] || '3000', 10);

  console.log(`[Seed] 开始从 500.com 抓取最近 ${count} 期开奖数据...`);
  const draws = await fetchLatestDraws(count);
  console.log(`[Seed] 抓取并解析到 ${draws.length} 期数据`);

  if (draws.length === 0) {
    console.error('[Seed] 未解析到有效数据，数据源格式可能已变更');
    process.exit(1);
  }

  const result = await syncDrawsToDatabase(draws);
  const latest = await getLatestPeriodInDb();

  console.log(`[Seed] 完成：新增 ${result.inserted} 期，跳过 ${result.skipped} 期，最新期号 ${latest}`);
}

main().catch((err) => {
  console.error('[Seed] 执行失败:', err);
  process.exit(1);
});
