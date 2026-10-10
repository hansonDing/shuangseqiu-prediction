import { NextResponse } from 'next/server';
import { runInternalPost } from '@/lib/internal-proxy';
import type { UiUpdateState } from '@/lib/ui-update-gate';
import { envInt } from '@/lib/cron-schedule';

/**
 * POST /api/simulation/buy/ui
 * 模拟盘「立即买入」按钮的站内通道。
 *
 * 为什么不直接让前端调 /api/simulation/buy：
 *   该接口是资金操作，只认 `Authorization: Bearer <UPDATE_TOKEN>` 或回环地址，
 *   用来给平台定时触发器 / 运维脚本调用。浏览器按钮拿不到也不该拿到 token，
 *   公网部署后直接调必然 401。
 *
 * 复用 internal-proxy 骨架（同源校验 + 单飞 + 冷却 + 回环转发 + 令牌代持）。
 * 额外安全垫（来自业务本身）：buyPredictions 检测到已有未结算持仓即跳过，
 * 且写入包在事务里 —— 重复触发不会重复下单。
 */

/** 冷却秒数，0 表示只做单飞不限频（默认 10 秒） */
const COOLDOWN_SECONDS = envInt('UI_BUY_COOLDOWN_SECONDS', 10);

/** 进程内闸门状态：单实例部署，无需跨进程协调 */
const gate: UiUpdateState = { inFlight: false, lastFinishedAt: 0 };

/** 与 /api/simulation/buy 的 BuyResult 保持同一形状，前端无需分支处理 */
function failure(status: number, message: string): NextResponse {
  return NextResponse.json({ ok: false, message }, { status });
}

export async function POST(request: Request): Promise<NextResponse> {
  return runInternalPost(request, {
    targetPath: '/api/simulation/buy',
    subject: '买入',
    cooldownSeconds: COOLDOWN_SECONDS,
    gate,
    failure,
  });
}
