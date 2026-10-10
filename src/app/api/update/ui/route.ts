import { NextResponse } from 'next/server';
import { runInternalPost } from '@/lib/internal-proxy';
import type { UiUpdateState } from '@/lib/ui-update-gate';
import { envInt } from '@/lib/cron-schedule';

/**
 * POST /api/update/ui
 * 站内「立即更新数据」按钮的入口。
 *
 * 为什么不直接让前端调 /api/update：
 *   那个接口面向程序化调用方（平台定时触发器、运维脚本），只认
 *   `Authorization: Bearer <UPDATE_TOKEN>` 或回环地址。浏览器里的按钮拿不到
 *   也不该拿到 token（写进前端即等于公开），公网部署后必然 401。
 *   因此这里做一层服务端转发：令牌由服务端从环境变量取出补上，
 *   令牌不进浏览器，更新流程依旧只有 /api/update 一份实现。
 *
 * 本接口自身用两道约束兜住（它是公网可达的）：
 *   1. 同源校验 —— 拒绝第三方站点借访客浏览器触发；
 *   2. 单飞 + 冷却 —— 见 src/lib/ui-update-gate.ts。
 *
 * 骨架逻辑（同源校验 + 单飞 + 冷却 + 回环转发 + 令牌代持）在 src/lib/internal-proxy.ts，
 * 与模拟盘的 /api/simulation/buy/ui、/api/simulation/reset/ui 共用。
 */

/** 冷却秒数，0 表示只做单飞不限频（默认 30 秒） */
const COOLDOWN_SECONDS = envInt('UI_UPDATE_COOLDOWN_SECONDS', 30);

/** 进程内闸门状态：单实例部署，无需跨进程协调 */
const gate: UiUpdateState = { inFlight: false, lastFinishedAt: 0 };

/** 与 /api/update 的 UpdateResult 保持同一形状，前端无需分支处理 */
function failure(status: number, message: string): NextResponse {
  return NextResponse.json(
    {
      success: false,
      fetched_count: 0,
      inserted_count: 0,
      skipped_count: 0,
      latest_period: null,
      message,
      updated_at: new Date().toISOString(),
      settled_count: 0,
    },
    { status }
  );
}

export async function POST(request: Request): Promise<NextResponse> {
  return runInternalPost(request, {
    targetPath: '/api/update',
    subject: '更新',
    cooldownSeconds: COOLDOWN_SECONDS,
    gate,
    failure,
  });
}
