import { NextResponse } from 'next/server';
import { getAllDraws, ensureDrawsLoaded } from '@/storage/database/draw-repository';
import { analyze } from '@/lib/lottery-engine';

export async function GET() {
  try {
    // 获取全部历史数据进行分析（按期号升序）
    await ensureDrawsLoaded();
    const allDraws = getAllDraws();

    if (allDraws.length === 0) {
      return NextResponse.json({ error: '暂无历史数据，请先在数据管理页点击“立即更新数据”' }, { status: 404 });
    }

    const result = analyze(allDraws);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : '未知错误';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
