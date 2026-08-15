/**
 * Next.js Instrumentation
 * 服务启动时自动初始化定时任务
 */

const UPDATE_HOUR = 22;
const CHECK_INTERVAL_MS = 60 * 1000;
const TARGET_DAYS = [1, 3, 5]; // 周一、周三、周五

let lastExecutedDate: string | null = null;
let cronStarted = false;

// 本地日期字符串（与 getDay/getHours 保持同一时区口径，避免混用 UTC 日期）
function localDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function shouldRunNow(): boolean {
  const now = new Date();
  const day = now.getDay();
  const hour = now.getHours();
  const today = localDateStr(now);

  return TARGET_DAYS.includes(day)
    && hour === UPDATE_HOUR
    && lastExecutedDate !== today;
}

async function triggerUpdate(): Promise<void> {
  // 与 server.ts 保持一致：优先使用 PORT，其次 DEPLOY_RUN_PORT
  const port = process.env.PORT || process.env.DEPLOY_RUN_PORT || '5000';
  const url = `http://localhost:${port}/api/update`;
  const today = localDateStr(new Date());

  console.log(`[LotteryCron ${new Date().toISOString()}] 开始执行数据更新...`);

  try {
    const response = await fetch(url, {
      method: 'POST',
      signal: AbortSignal.timeout(30000),
    });

    const result = await response.json();

    if (result.success) {
      console.log(`[LotteryCron] 更新成功: ${result.message}`);
    } else {
      console.error(`[LotteryCron] 更新失败: ${result.message}`);
    }

    lastExecutedDate = today;
  } catch (err) {
    const message = err instanceof Error ? err.message : '未知错误';
    console.error(`[LotteryCron] 更新请求异常: ${message}`);
  }
}

function startCronScheduler(): void {
  if (cronStarted) return;
  cronStarted = true;

  console.log('[LotteryCron] 定时更新服务已启动 (每周一/三/五 22:00)');

  setInterval(async () => {
    if (shouldRunNow()) {
      await triggerUpdate();
    }
  }, CHECK_INTERVAL_MS);
}

export async function register(): Promise<void> {
  // 仅在 Node.js 运行时启动 (排除 Edge Runtime)
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    startCronScheduler();
  }
}
