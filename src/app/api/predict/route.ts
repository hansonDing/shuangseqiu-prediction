import { NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { predict } from '@/lib/lottery-engine';
import type { DrawRecord } from '@/lib/lottery-engine';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const freqWeight = parseFloat(searchParams.get('frequency') || '0.4');
  const recencyWeight = parseFloat(searchParams.get('recency') || '0.35');
  const balanceWeight = parseFloat(searchParams.get('balance') || '0.25');

  const client = getSupabaseClient();
  const allDraws: DrawRecord[] = [];
  let page = 0;
  const pageSize = 1000;

  while (true) {
    const { data, error } = await client
      .from('lottery_draws')
      .select('id, period, draw_date, red1, red2, red3, red4, red5, red6, blue')
      .order('period', { ascending: true })
      .range(page * pageSize, (page + 1) * pageSize - 1);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (!data?.length) break;
    allDraws.push(...(data as DrawRecord[]));
    if (data.length < pageSize) break;
    page++;
  }

  if (allDraws.length < 10) {
    return NextResponse.json({ error: '历史数据不足，无法生成预测' }, { status: 400 });
  }

  const predictions = predict(allDraws, {
    frequency: freqWeight,
    recency: recencyWeight,
    balance: balanceWeight,
  });

  return NextResponse.json({ predictions, total_draws: allDraws.length });
}
