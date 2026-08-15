import { NextResponse } from 'next/server';
import { fetchLatestDraws, syncDrawsToDatabase, getLatestPeriodInDb } from '@/lib/lottery-fetcher';

interface UpdateResult {
  success: boolean;
  fetched_count: number;
  inserted_count: number;
  skipped_count: number;
  latest_period: string | null;
  message: string;
  updated_at: string;
}

// 全局状态存储 (进程内)
let lastUpdateResult: UpdateResult | null = null;

export function getLastUpdateResult(): UpdateResult | null {
  return lastUpdateResult;
}

/**
 * POST /api/update
 * 手动触发数据更新
 */
export async function POST(): Promise<NextResponse<UpdateResult>> {
  try {
    // 获取当前数据库最新期号
    const currentLatest = await getLatestPeriodInDb();

    // 抓取最新 30 期数据
    const draws = await fetchLatestDraws(30);

    if (draws.length === 0) {
      const result: UpdateResult = {
        success: false,
        fetched_count: 0,
        inserted_count: 0,
        skipped_count: 0,
        latest_period: currentLatest,
        message: '未解析到有效的开奖数据，数据源格式可能已变更',
        updated_at: new Date().toISOString(),
      };
      lastUpdateResult = result;
      return NextResponse.json(result, { status: 422 });
    }

    // 同步到数据库
    const syncResult = await syncDrawsToDatabase(draws);

    // 获取更新后的最新期号
    const newLatest = await getLatestPeriodInDb();

    const message = syncResult.inserted > 0
      ? `成功更新 ${syncResult.inserted} 期新数据 (最新: ${newLatest})`
      : `数据已是最新，无需更新 (当前: ${currentLatest})`;

    const result: UpdateResult = {
      success: true,
      fetched_count: draws.length,
      inserted_count: syncResult.inserted,
      skipped_count: syncResult.skipped,
      latest_period: newLatest,
      message,
      updated_at: new Date().toISOString(),
    };

    lastUpdateResult = result;
    return NextResponse.json(result);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : '未知错误';
    const result: UpdateResult = {
      success: false,
      fetched_count: 0,
      inserted_count: 0,
      skipped_count: 0,
      latest_period: null,
      message: `更新失败: ${errorMessage}`,
      updated_at: new Date().toISOString(),
    };
    lastUpdateResult = result;
    return NextResponse.json(result, { status: 500 });
  }
}

/**
 * GET /api/update
 * 查询最近更新状态
 */
export async function GET(): Promise<NextResponse> {
  if (lastUpdateResult) {
    return NextResponse.json(lastUpdateResult);
  }

  try {
    const latestPeriod = await getLatestPeriodInDb();
    return NextResponse.json({
      success: true,
      message: '尚未执行过更新',
      latest_period: latestPeriod,
      updated_at: null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : '未知错误';
    return NextResponse.json({ success: false, message: `查询失败: ${message}` }, { status: 500 });
  }
}
