import { NextResponse } from 'next/server';
import { screenStocks } from '@/lib/stock-screener';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET() {
  try {
    const startTime = Date.now();
    const results = await screenStocks();
    const duration = ((Date.now() - startTime) / 1000).toFixed(1);

    // 限制输出Top 50，减少响应大小
    const topResults = results.slice(0, 50).map(stock => ({
      ...stock,
      weeklyKlines: stock.weeklyKlines.slice(-3), // 只保留最近3周K线
    }));

    return NextResponse.json({
      success: true,
      data: topResults,
      total: results.length,
      shown: topResults.length,
      duration: `${duration}s`,
      timestamp: new Date().toISOString(),
      criteria: {
        description: '周K线趋势选股',
        conditions: [
          '排除创业板(300开头)和科创板(688开头)',
          '排除ST股票',
          '最近3周周K线收盘价均在20周均线以上',
          '最近3周呈上涨趋势(每周收盘价递增)',
        ],
      },
    });
  } catch (error) {
    console.error('Screening error:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : '筛选失败',
      },
      { status: 500 }
    );
  }
}
