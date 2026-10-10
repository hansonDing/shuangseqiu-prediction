/**
 * Next.js Instrumentation
 * 服务启动时自动初始化定时任务。
 *
 * 任务（按本地时区，默认 Asia/Shanghai）：
 * - data-update: 每周一/三/五 22:00 抓取开奖数据并触发结算
 * - sim-buy:     每周二/四/日 19:30 预测并买入
 *
 * 部署说明：
 * 本模块是「进程内」调度，作为兜底。若改由平台定时触发器接管（见 docs/deploy/Deploy.md 第 7 节），
 * 设置 ENABLE_INTERNAL_CRON=false 即可关闭本调度，避免重复触发。
 *
 * 关于重复触发：两个目标接口本身是幂等/带守卫的——
 *   /api/update         跳过已入库期号；
 *   /api/simulation/buy 检测到未结算持仓即跳过，且写入包在事务内。
 * 因此即使短暂出现双重触发也不会重复下单，调度方式可以平滑切换。
 *
 * 调度规则（窗口判定、状态码分类）见 src/lib/cron-schedule.ts，便于单测。
 */
import {
  CHECK_INTERVAL_MS,
  TASKS,
  classifyStatus,
  decideTask,
  envInt,
  localDateStr,
  type ScheduledTask,
} from './lib/cron-schedule';

/** 进程内调度开关：设为 false/0/no/off 时关闭 */
const ENABLE_INTERNAL_CRON = !['0', 'false', 'no', 'off'].includes(
  String(process.env.ENABLE_INTERNAL_CRON ?? 'true').trim().toLowerCase()
);

/** 补跑宽限窗口（分钟）：到点后若容器重启 / 短暂宕机导致错过，仍在此窗口内追平。0 表示关闭补跑 */
const GRACE_MINUTES = envInt('CRON_GRACE_MINUTES', 60);

/** 单任务单日最大尝试次数，避免接口持续失败时高频重试 */
const MAX_ATTEMPTS = envInt('CRON_MAX_ATTEMPTS', 5);

/** 启动后延迟首次检查，确保 HTTP 服务已开始监听 */
const STARTUP_DELAY_MS = 15 * 1000;

/** 任务当天的执行状态 */
interface TaskState {
  day: string;
  attempts: number;
  /** 当天已终态（成功 / 业务跳过 / 鉴权失败 / 放弃重试），不再触发 */
  done: boolean;
}

const taskStates: Record<string, TaskState> = {};
let cronStarted = false;

function stateOf(name: string, today: string): TaskState {
  const current = taskStates[name];
  if (!current || current.day !== today) {
    const fresh: TaskState = { day: today, attempts: 0, done: false };
    taskStates[name] = fresh;
    return fresh;
  }
  return current;
}

/** 未达上限时保留重试（下一轮轮询再次触发），达上限则放弃当日 */
function giveUpOrRetry(task: ScheduledTask, state: TaskState): void {
  if (state.attempts >= MAX_ATTEMPTS) {
    state.done = true;
    console.error(`[LotteryCron] ${task.name} 已累计尝试 ${state.attempts} 次，放弃当日剩余重试`);
  }
}

async function runTask(
  task: ScheduledTask,
  attempt: number,
  isCatchUp: boolean,
  state: TaskState
): Promise<void> {
  const prefix =
    attempt > 1
      ? `[LotteryCron 重试#${attempt}]`
      : isCatchUp
        ? '[LotteryCron 补跑]'
        : '[LotteryCron]';

  // 与 server.ts 保持一致：优先使用 PORT，其次 DEPLOY_RUN_PORT
  const port = process.env.PORT || process.env.DEPLOY_RUN_PORT || '5000';
  const url = `http://localhost:${port}${task.path}`;
  console.log(`${prefix} ${new Date().toISOString()} 执行任务 ${task.name} -> ${url}`);

  try {
    const response = await fetch(url, {
      method: 'POST',
      signal: AbortSignal.timeout(60000),
    });
    const body = (await response.json().catch(() => ({}))) as { message?: string; error?: string };
    const detail = body.message ?? body.error ?? '';
    const outcome = classifyStatus(response.status);

    if (outcome === 'ok' || outcome === 'skip') {
      const label = outcome === 'ok' ? '完成' : '跳过（业务无需执行）';
      console.log(`${prefix} ${task.name} ${label}: HTTP ${response.status} ${detail}`.trim());
      state.done = true;
    } else if (outcome === 'fatal') {
      console.error(
        `${prefix} ${task.name} 鉴权失败，请检查 UPDATE_TOKEN 配置: HTTP ${response.status} ${detail}`.trim()
      );
      state.done = true;
    } else {
      console.error(`${prefix} ${task.name} 失败: HTTP ${response.status} ${detail}`.trim());
      giveUpOrRetry(task, state);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : '未知错误';
    console.error(`${prefix} ${task.name} 异常: ${message}`);
    giveUpOrRetry(task, state);
  }
}

function checkTasks(now: Date): void {
  const weekday = now.getDay();
  const minutes = now.getHours() * 60 + now.getMinutes();
  const today = localDateStr(now);

  for (const task of TASKS) {
    const state = stateOf(task.name, today);
    if (state.done) continue;

    const { run, isCatchUp } = decideTask(task, weekday, minutes, GRACE_MINUTES);
    if (!run) continue;

    state.attempts += 1;
    void runTask(task, state.attempts, isCatchUp, state);
  }
}

function startCronScheduler(): void {
  if (cronStarted) return;
  cronStarted = true;

  if (!ENABLE_INTERNAL_CRON) {
    console.log(
      '[LotteryCron] 进程内定时调度已禁用（ENABLE_INTERNAL_CRON=false）；' +
        '请由平台定时触发器调用 /api/update 与 /api/simulation/buy'
    );
    return;
  }

  console.log(
    `[LotteryCron] 定时服务已启动（周一/三/五 22:00 更新，周二/四/日 19:30 买入；补跑窗口 ${GRACE_MINUTES} 分钟）`
  );

  // 等 HTTP 服务就绪后再做首次检查，便于容器重启后追平当天错过的任务
  setTimeout(() => {
    checkTasks(new Date());
    setInterval(() => checkTasks(new Date()), CHECK_INTERVAL_MS);
  }, STARTUP_DELAY_MS);
}

export async function register(): Promise<void> {
  // 仅在 Node.js 运行时启动 (排除 Edge Runtime)
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    startCronScheduler();
  }
}
