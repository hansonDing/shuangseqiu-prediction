import { NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { analyze } from '@/lib/lottery-engine';
import type { DrawRecord } from '@/lib/lottery-engine';

export async function GET() {
  const client = getSupabaseClient();

  // 获取所有历史数据进行分析
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

  if (allDraws.length === 0) {
    return NextResponse.json({ error: '暂无历史数据' }, { status: 404 });
  }

  const result = analyze(allDraws);
  return NextResponse.json(result);
}
