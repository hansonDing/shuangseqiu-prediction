import { NextResponse } from 'next/server';
import { getAllDraws, ensureDrawsLoaded } from '@/storage/database/draw-repository';
import { backtest } from '@/lib/lottery-engine';
import { parseWeight, parsePositiveInt } from '@/lib/parse-params';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const sampleSize = parsePositiveInt(searchParams.get('sample'), 100, 500);

  // 可选权重参数：与实际预测入口保持一致的回测口径
  const frequency = parseWeight(searchParams.get('frequency'), 0.4);
  const recency = parseWeight(searchParams.get('recency'), 0.35);
  const balance = parseWeight(searchParams.get('balance'), 0.25);
  const weights = { frequency, recency, balance };

  try {
    await ensureDrawsLoaded();
    const allDraws = getAllDraws();

    if (allDraws.length < 15) {
      return NextResponse.json({ error: '历史数据不足，无法进行回测，请先在数据管理页点击“立即更新数据”' }, { status: 400 });
    }

    const maxSample = Math.min(sampleSize, Math.floor(allDraws.length / 2));
    const result = backtest(allDraws, maxSample, weights);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : '未知错误';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
