/**
 * 定时任务调度规则（纯函数，便于单测）
 * 运行时接线（定时器、HTTP 调用、日志）在 src/instrumentation.ts
 */

/** 单次轮询间隔 */
export const CHECK_INTERVAL_MS = 60 * 1000;

export interface ScheduledTask {
  name: string;
  /** 触发日，0=周日 */
  days: number[];
  hour: number;
  minute: number;
  /** 本机触发路径 */
  path: string;
}

/** 任务表（本地时区） */
export const TASKS: readonly ScheduledTask[] = [
  { name: 'data-update', days: [1, 3, 5], hour: 22, minute: 0, path: '/api/update' },
  { name: 'sim-buy', days: [2, 4, 0], hour: 19, minute: 30, path: '/api/simulation/buy' },
];

export type TaskOutcome = 'ok' | 'skip' | 'retry' | 'fatal';

/**
 * 按 HTTP 状态码判定任务结果：
 * - 2xx      成功
 * - 409      业务跳过（如已有未结算持仓），不算故障
 * - 401/403  鉴权配置问题，重试无意义
 * - 其余     可重试
 */
export function classifyStatus(status: number): TaskOutcome {
  if (status >= 200 && status < 300) return 'ok';
  if (status === 409) return 'skip';
  if (status === 401 || status === 403) return 'fatal';
  return 'retry';
}

export interface TaskDecision {
  /** 此刻是否应触发 */
  run: boolean;
  /** true 表示错过了准点窗口，属于补跑 */
  isCatchUp: boolean;
}

/**
 * 判断任务此刻是否应触发。
 *
 * @param weekday      当前本地星期（0=周日）
 * @param minutes      当前本地时间的当日分钟数（getHours()*60 + getMinutes()）
 * @param graceMinutes 补跑宽限窗口（分钟）；0 表示只认准点、不补跑
 */
export function decideTask(
  task: ScheduledTask,
  weekday: number,
  minutes: number,
  graceMinutes: number
): TaskDecision {
  if (!task.days.includes(weekday)) return { run: false, isCatchUp: false };

  const target = task.hour * 60 + task.minute;
  // 准时窗口：目标时刻起一个检查间隔内
  const onTime = minutes >= target && minutes < target + CHECK_INTERVAL_MS / 60000;
  if (onTime) return { run: true, isCatchUp: false };

  // 补跑窗口：已经过点，但仍在宽限范围内（容器重启 / 短暂宕机后追平）
  const catchUp = graceMinutes > 0 && minutes > target && minutes <= target + graceMinutes;
  return { run: catchUp, isCatchUp: catchUp };
}

/** 本地日期字符串（与 getDay/getHours 保持同一时区口径） */
export function localDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** 读取非负整数环境变量，缺失或非法时回退默认值 */
export function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}
