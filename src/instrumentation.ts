/**
 * Next.js Instrumentation
 * 服务启动时自动初始化定时任务：
 * - data-update: 每周一/三/五 22:00 抓取开奖数据并触发结算
 * - sim-buy:     每周二/四/日 19:30 预测并买入
 */

const CHECK_INTERVAL_MS = 60 * 1000; // 每分钟检查一次

interface ScheduledTask {
  name: string;
  days: number[]; // 0=周日
  hour: number;
  minute: number;
  path: string;
}

const TASKS: ScheduledTask[] = [
  { name: 'data-update', days: [1, 3, 5], hour: 22, minute: 0, path: '/api/update' },
  { name: 'sim-buy', days: [2, 4, 0], hour: 19, minute: 30, path: '/api/simulation/buy' },
];

const lastExecuted: Record<string, string> = {};
let cronStarted = false;

// 本地日期字符串（与 getDay/getHours 保持同一时区口径）
function localDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

async function runTask(task: ScheduledTask): Promise<void> {
  // 与 server.ts 保持一致：优先使用 PORT，其次 DEPLOY_RUN_PORT
  const port = process.env.PORT || process.env.DEPLOY_RUN_PORT || '5000';
  const url = `http://localhost:${port}${task.path}`;
  console.log(`[LotteryCron ${new Date().toISOString()}] 执行任务 ${task.name} -> ${url}`);
  try {
    const response = await fetch(url, {
      method: 'POST',
      signal: AbortSignal.timeout(60000),
    });
    const result = await response.json().catch(() => ({}));
    const msg = result.message ?? (result.ok === false ? result.message : '已触发');
    console.log(`[LotteryCron] ${task.name} 完成: HTTP ${response.status} ${msg ?? ''}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : '未知错误';
    console.error(`[LotteryCron] ${task.name} 异常: ${message}`);
  }
}

function checkTasks(now: Date): void {
  const day = now.getDay();
  const minutes = now.getHours() * 60 + now.getMinutes();
  const today = localDateStr(now);
  for (const task of TASKS) {
    if (!task.days.includes(day)) continue;
    const target = task.hour * 60 + task.minute;
    // 执行窗口：目标时刻起一个检查间隔内，每天最多一次
    if (minutes < target || minutes >= target + CHECK_INTERVAL_MS / 60000) continue;
    if (lastExecuted[task.name] === today) continue;
    lastExecuted[task.name] = today;
    void runTask(task);
  }
}

function startCronScheduler(): void {
  if (cronStarted) return;
  cronStarted = true;
  console.log('[LotteryCron] 定时服务已启动（周一/三/五 22:00 更新，周二/四/日 19:30 买入）');
  setInterval(() => checkTasks(new Date()), CHECK_INTERVAL_MS);
}

export async function register(): Promise<void> {
  // 仅在 Node.js 运行时启动 (排除 Edge Runtime)
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    startCronScheduler();
  }
}
