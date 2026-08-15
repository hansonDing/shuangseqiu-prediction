import { NextResponse } from 'next/server';
import { getAllDraws } from '@/storage/database/local-store';
import { backtest } from '@/lib/lottery-engine';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const sampleSize = parseInt(searchParams.get('sample') || '100');

  // 可选权重参数：与实际预测入口保持一致的回测口径
  const frequency = parseFloat(searchParams.get('frequency') ?? '');
  const recency = parseFloat(searchParams.get('recency') ?? '');
  const balance = parseFloat(searchParams.get('balance') ?? '');
  const weights = Number.isFinite(frequency) && Number.isFinite(recency) && Number.isFinite(balance)
    ? { frequency, recency, balance }
    : undefined;

  try {
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
