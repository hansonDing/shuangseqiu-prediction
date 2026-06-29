import { NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { backtest } from '@/lib/lottery-engine';
import type { DrawRecord } from '@/lib/lottery-engine';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const sampleSize = parseInt(searchParams.get('sample') || '30');

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

  if (allDraws.length < 15) {
    return NextResponse.json({ error: '历史数据不足，无法进行回测' }, { status: 400 });
  }

  const maxSample = Math.min(sampleSize, Math.floor(allDraws.length / 2));
  const result = backtest(allDraws, maxSample);
  return NextResponse.json(result);
}
