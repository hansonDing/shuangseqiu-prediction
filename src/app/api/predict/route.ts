import { NextResponse } from 'next/server';
import { getAllDraws } from '@/storage/database/local-store';
import { predict } from '@/lib/lottery-engine';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const freqWeight = parseFloat(searchParams.get('frequency') || '0.4');
  const recencyWeight = parseFloat(searchParams.get('recency') || '0.35');
  const balanceWeight = parseFloat(searchParams.get('balance') || '0.25');

  try {
    const allDraws = getAllDraws();

    if (allDraws.length < 10) {
      return NextResponse.json({ error: '历史数据不足，无法生成预测，请先在数据管理页点击“立即更新数据”' }, { status: 400 });
    }

    const predictions = predict(allDraws, {
      frequency: freqWeight,
      recency: recencyWeight,
      balance: balanceWeight,
    });

    return NextResponse.json({ predictions, total_draws: allDraws.length });
  } catch (error) {
    const message = error instanceof Error ? error.message : '未知错误';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
