/**
 * 跨平台脚本分发器
 * - Windows: 走 Node 实现 scripts/<task>.mjs（不依赖 bash / ss 等 Linux 工具）
 * - 其他平台: 走原 bash 脚本 scripts/<task>.sh（兼容 Coze 部署环境）
 *
 * 用法: node scripts/run.mjs <dev|build|start|validate>
 */
import { spawn } from 'node:child_process';
import { platform } from 'node:os';

const task = process.argv[2];
const allowed = ['dev', 'build', 'start', 'validate'];

if (!task || !allowed.includes(task)) {
  console.error(`用法: node scripts/run.mjs <${allowed.join('|')}>`);
  process.exit(1);
}

const isWindows = platform() === 'win32';
const command = isWindows ? process.execPath : 'bash';
// 透传 CLI 参数（如 --port / --host），供预览宿主注入
const args = isWindows
  ? [`scripts/${task}.mjs`, ...process.argv.slice(3)]
  : [`scripts/${task}.sh`, ...process.argv.slice(3)];

const child = spawn(command, args, { stdio: 'inherit', env: process.env });
child.on('error', (err) => {
  console.error(
    isWindows
      ? `启动失败: ${err.message}`
      : `启动失败（非 Windows 平台需要 bash，请安装 Git Bash 或检查 PATH）: ${err.message}`
  );
  process.exit(1);
});
child.on('exit', (code) => process.exit(code ?? 1));
