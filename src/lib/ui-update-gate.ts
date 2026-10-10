/**
 * 站内「立即更新数据」按钮的触发闸门（纯函数，便于单测）
 * 运行时接线（进程内状态、转发请求）在 src/app/api/update/ui/route.ts
 *
 * 为什么需要它：
 *   `/api/update` 面向程序化调用方（平台定时触发器、运维脚本），用 Bearer token 鉴权。
 *   浏览器里的按钮不可能安全地持有 token —— 写进前端即等于公开。
 *   所以站内 UI 走单独通道，并在通道入口加两道约束：
 *
 *   1. 单飞（single-flight）：一次更新可能要抓取外部站点并写库，
 *      并发重复触发只会浪费单实例小规格容器的内存与额度，直接挡掉。
 *   2. 冷却（cooldown）：更新本身是幂等的，但没有节流时可以被反复点击 / 刷请求，
 *      在 0.25 核 0.5G 的实例上足以把内存打满。
 */

export interface UiUpdateState {
  /** 是否已有一次更新在执行中 */
  inFlight: boolean;
  /** 上次执行结束的时间戳（毫秒）；0 表示从未执行过 */
  lastFinishedAt: number;
}

export interface UiUpdateDecision {
  /** 是否放行本次触发 */
  allow: boolean;
  /** 拒绝时返回给前端的 HTTP 状态码 */
  status: number;
  /** 拒绝原因（前端直接展示） */
  message: string;
}

/**
 * 判断本次站内触发是否放行。
 *
 * @param state           当前闸门状态
 * @param now             当前时间戳（毫秒）
 * @param cooldownSeconds 冷却秒数；0 表示只做单飞、不做冷却
 */
export function decideUiTrigger(
  state: UiUpdateState,
  now: number,
  cooldownSeconds: number
): UiUpdateDecision {
  if (state.inFlight) {
    return { allow: false, status: 409, message: '已有更新任务正在执行，请稍候…' };
  }

  if (cooldownSeconds > 0 && state.lastFinishedAt > 0) {
    const total = cooldownSeconds * 1000;
    const elapsed = now - state.lastFinishedAt;
    // elapsed < 0 说明系统时钟被回拨，此时不拦，避免把功能锁死
    if (elapsed >= 0 && elapsed < total) {
      const wait = Math.ceil((total - elapsed) / 1000);
      return { allow: false, status: 429, message: `操作过于频繁，请 ${wait} 秒后再试` };
    }
  }

  return { allow: true, status: 200, message: '' };
}
