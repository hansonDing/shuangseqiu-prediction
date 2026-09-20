import { NextResponse } from 'next/server';
import { getSimulationStatus } from '@/storage/database/simulation-repository';

export async function GET() {
  try {
    return NextResponse.json(await getSimulationStatus());
  } catch (error) {
    const message = error instanceof Error ? error.message : '未知错误';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
