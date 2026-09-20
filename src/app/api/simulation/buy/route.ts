import { NextResponse } from 'next/server';
import { isAuthorized } from '@/lib/request-auth';
import { parseWeight } from '@/lib/parse-params';
import { buyPredictions } from '@/storage/database/simulation-repository';

export async function POST(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: '未授权：请从本机触发，或配置 UPDATE_TOKEN 后携带 Bearer token' }, { status: 401 });
  }
  try {
    const { searchParams } = new URL(request.url);
    const weights = {
      frequency: parseWeight(searchParams.get('frequency'), 0.4),
      recency: parseWeight(searchParams.get('recency'), 0.35),
      balance: parseWeight(searchParams.get('balance'), 0.25),
    };
    const result = await buyPredictions(weights);
    return NextResponse.json(result, { status: result.ok ? 200 : 409 });
  } catch (error) {
    const message = error instanceof Error ? error.message : '未知错误';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
