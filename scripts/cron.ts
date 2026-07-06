/**
 * 双色球数据定时更新 Cron 服务
 *
 * 调度策略：每周一、三、五 22:00 自动抓取最新开奖数据
 * (双色球开奖日为周二、四、日，次日抓取确保数据已发布)
 *
 * 运行方式：作为后台进程持续运行
 */

const UPDATE_HOUR = 22; // 22:00 执行更新
const CHECK_INTERVAL_MS = 60 * 1000; // 每分钟检查一次
const TARGET_DAYS = [1, 3, 5]; // 周一=1, 周三=3, 周五=5

let lastExecutedDate: string | null = null;

function getPort(): number {
  return parseInt(process.env.DEPLOY_RUN_PORT || '5000', 10);
}

function shouldRunNow(): boolean {
  const now = new Date();
  const day = now.getDay(); // 0=周日, 1=周一, ...
  const hour = now.getHours();
  const today = now.toISOString().split('T')[0];

  // 检查是否是目标日、目标小时，且今天尚未执行过
  return TARGET_DAYS.includes(day)
    && hour === UPDATE_HOUR
    && lastExecutedDate !== today;
}

async function triggerUpdate(): Promise<void> {
  const port = getPort();
  const url = `http://localhost:${port}/api/update`;
  const today = new Date().toISOString().split('T')[0];

  console.log(`[Cron ${new Date().toISOString()}] 开始执行数据更新...`);

  try {
    const response = await fetch(url, {
      method: 'POST',
      signal: AbortSignal.timeout(30000),
    });

    const result = await response.json();

    if (result.success) {
      console.log(`[Cron] 更新成功: ${result.message}`);
      console.log(`[Cron] 抓取 ${result.fetched_count} 期, 新增 ${result.inserted_count} 期, 跳过 ${result.skipped_count} 期`);
    } else {
      console.error(`[Cron] 更新失败: ${result.message}`);
    }

    lastExecutedDate = today;
  } catch (err) {
    const message = err instanceof Error ? err.message : '未知错误';
    console.error(`[Cron] 更新请求异常: ${message}`);
  }
}

function startScheduler(): void {
  console.log(`[Cron] 定时更新服务已启动`);
  console.log(`[Cron] 调度策略: 每周一、三、五 ${UPDATE_HOUR}:00 自动更新`);
  console.log(`[Cron] 检查间隔: ${CHECK_INTERVAL_MS / 1000}s`);

  setInterval(async () => {
    if (shouldRunNow()) {
      await triggerUpdate();
    }
  }, CHECK_INTERVAL_MS);
}

startScheduler();
