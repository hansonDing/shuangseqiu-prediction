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

/**
 * 更新触发鉴权：
 * 1. 配置了 UPDATE_TOKEN 环境变量时，必须携带 `Authorization: Bearer <token>`
 * 2. 未配置 token 时，仅允许回环地址（127.0.0.1 / ::1 / localhost）触发，
 *    外部请求一律拒绝，防止接口被任意调用
 * 注意：Next.js 会自动填充 x-forwarded-for（值为对端 IP），因此不能
 * 以"该头是否存在"判断外部请求，必须解析其 IP 是否为回环地址
 */
function isLoopback(ip: string): boolean {
  return ip === 'localhost'
    || ip.startsWith('127.')
    || ip === '::1'
    || ip === '0:0:0:0:0:0:0:1'
    || ip.startsWith('::ffff:127.')
    || ip.startsWith('::ffff:7f00:');
}

function isAuthorized(request: Request): boolean {
  const token = process.env.UPDATE_TOKEN;
  if (token) {
    return request.headers.get('authorization') === `Bearer ${token}`;
  }

  const forwarded = request.headers.get('x-forwarded-for');
  const peer = (forwarded ? forwarded.split(',')[0].trim() : null)
    ?? request.headers.get('x-real-ip');
  if (peer) {
    return isLoopback(peer);
  }
  const hostname = new URL(request.url).hostname;
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]' || hostname === '::1';
}

/**
 * POST /api/update
 * 手动触发数据更新
 */
export async function POST(request: Request): Promise<NextResponse<UpdateResult>> {
  if (!isAuthorized(request)) {
    return NextResponse.json(
      {
        success: false,
        fetched_count: 0,
        inserted_count: 0,
        skipped_count: 0,
        latest_period: null,
        message: '未授权：请从本机触发，或配置 UPDATE_TOKEN 后携带 Bearer token',
        updated_at: new Date().toISOString(),
      },
      { status: 401 }
    );
  }

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
    // 出错时不覆盖 lastUpdateResult，保留上一次成功的更新状态供 GET 查询
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
