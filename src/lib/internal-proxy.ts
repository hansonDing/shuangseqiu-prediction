/**
 * 站内写接口的转发骨架。
 *
 * 背景：面向浏览器页面的按钮不可能安全地持有 `UPDATE_TOKEN`（写进前端即等于公开），
 * 公网部署后直接调 `/api/update`、`/api/simulation/buy` 这类写接口必然 401。
 * 因此站内操作统一走 `/api/<x>/ui` 这层服务端代理：令牌由服务端从环境变量取出补上，
 * 再回环转发到真正的写接口 —— 写实现仍只有一份，令牌不进浏览器。
 *
 * 代理自身是公网可达的，故入口放两道闸：
 *   1. 同源校验 —— 拒绝第三方站点借访客浏览器触发（见 request-auth.isSameOrigin）；
 *   2. 单飞 + 冷却 —— 见 ui-update-gate.decideUiTrigger，防重复点击把 0.25C/0.5G
 *      小规格容器的内存与额度打满。
 *
 * 三个路由（update / simulation.buy / simulation.reset）共用本骨架，
 * 各自只提供「目标路径 + 冷却秒数 + 闸门状态 + 失败响应形状」。
 */
import { NextResponse } from 'next/server';
import { isSameOrigin } from '@/lib/request-auth';
import { decideUiTrigger, type UiUpdateState } from '@/lib/ui-update-gate';

export interface InternalProxyOptions {
  /** 内部真实写接口路径，如 `/api/update`、`/api/simulation/buy` */
  targetPath: string;
  /** 操作的中文名，仅用于拼装用户可见的提示语（如「更新」「买入」「重置」） */
  subject: string;
  /** 冷却秒数，0 表示只做单飞不限频 */
  cooldownSeconds: number;
  /** 进程内闸门状态（由各路由模块级持有；单实例部署无需跨进程协调） */
  gate: UiUpdateState;
  /** 拒绝 / 异常时构造响应体，各接口沿用各自原有的响应形状 */
  failure: (status: number, message: string) => NextResponse;
}

/**
 * 回环转发地址：不依赖 Host / x-forwarded-host（反代可能改写它们），
 * 自定义服务器就监听着本机端口，127.0.0.1 一定可达。
 */
export function internalUrl(request: Request, targetPath: string): string {
  const fromEnv = process.env.PORT;
  if (fromEnv && /^\d+$/.test(fromEnv)) {
    return `http://127.0.0.1:${fromEnv}${targetPath}`;
  }
  try {
    const port = new URL(request.url).port || '5000';
    return `http://127.0.0.1:${port}${targetPath}`;
  } catch {
    return `http://127.0.0.1:5000${targetPath}`;
  }
}

/** 执行一次站内代理转发：同源校验 → 单飞/冷却 → 回环转发（代持令牌） */
export async function runInternalPost(
  request: Request,
  options: InternalProxyOptions
): Promise<NextResponse> {
  const { targetPath, subject, cooldownSeconds, gate, failure } = options;

  if (!isSameOrigin(request)) {
    return failure(403, '拒绝跨站调用：该接口仅供站内页面使用');
  }

  const decision = decideUiTrigger(gate, Date.now(), cooldownSeconds);
  if (!decision.allow) {
    return failure(decision.status, decision.message);
  }

  gate.inFlight = true;
  try {
    const token = process.env.UPDATE_TOKEN;
    const res = await fetch(internalUrl(request, targetPath), {
      method: 'POST',
      cache: 'no-store',
      headers: token ? { authorization: `Bearer ${token}` } : {},
    });

    const body: unknown = await res.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return failure(502, `${subject}接口返回异常 (HTTP ${res.status})`);
    }
    return NextResponse.json(body, { status: res.status });
  } catch (error) {
    const message = error instanceof Error ? error.message : '未知错误';
    return failure(502, `${subject}请求失败: ${message}`);
  } finally {
    gate.inFlight = false;
    gate.lastFinishedAt = Date.now();
  }
}
