import { NextResponse } from 'next/server';
import { runInternalPost } from '@/lib/internal-proxy';
import type { UiUpdateState } from '@/lib/ui-update-gate';
import { envInt } from '@/lib/cron-schedule';

/**
 * POST /api/simulation/reset/ui
 * 模拟盘「重置账本」按钮的站内通道。
 *
 * 重置是破坏性操作（清空买入 / 结算记录，资金恢复初始值），所以：
 *   - 前端保留 window.confirm 二次确认；
 *   - 这里同样走同源校验，第三方站点借访客浏览器触发会被 403 挡下；
 *   - 单飞 + 冷却防误触连点。
 *
 * 骨架逻辑见 src/lib/internal-proxy.ts。
 */

/** 冷却秒数，0 表示只做单飞不限频（默认 10 秒） */
const COOLDOWN_SECONDS = envInt('UI_RESET_COOLDOWN_SECONDS', 10);

/** 进程内闸门状态：单实例部署，无需跨进程协调 */
const gate: UiUpdateState = { inFlight: false, lastFinishedAt: 0 };

/** 重置接口的既有错误形状是 { error }，此处保持一致 */
function failure(status: number, message: string): NextResponse {
  return NextResponse.json({ error: message, message }, { status });
}

export async function POST(request: Request): Promise<NextResponse> {
  return runInternalPost(request, {
    targetPath: '/api/simulation/reset',
    subject: '重置',
    cooldownSeconds: COOLDOWN_SECONDS,
    gate,
    failure,
  });
}
