import { NextResponse } from 'next/server';
import { getAllDraws, ensureDrawsLoaded } from '@/storage/database/draw-repository';
import { parsePositiveInt } from '@/lib/parse-params';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const limit = parsePositiveInt(searchParams.get('limit'), 50, 200);
  const offset = Math.max(0, Number(searchParams.get('offset')) || 0);

  try {
    await ensureDrawsLoaded();
    // 接口按期号降序分页（offset=0 为最新一页）
    const allDesc = getAllDraws().reverse();
    const data = allDesc.slice(offset, offset + limit);
    return NextResponse.json({ data, total: allDesc.length });
  } catch (error) {
    const message = error instanceof Error ? error.message : '未知错误';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
