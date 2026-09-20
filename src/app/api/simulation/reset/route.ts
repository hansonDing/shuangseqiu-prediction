import { NextResponse } from 'next/server';
import { isAuthorized } from '@/lib/request-auth';
import { resetSimulation } from '@/storage/database/simulation-repository';

export async function POST(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: '未授权' }, { status: 401 });
  }
  try {
    return NextResponse.json(await resetSimulation());
  } catch (error) {
    const message = error instanceof Error ? error.message : '未知错误';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
