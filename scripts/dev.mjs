/**
 * Windows 版开发启动脚本（scripts/dev.sh 的跨平台等价实现）
 * 1. 清理占用端口的旧进程（netstat + taskkill）
 * 2. 以 tsx watch 模式启动自定义 Next.js 服务器
 */
import { spawn, execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function argValue(flag) {
  const i = process.argv.indexOf(flag);
  return i > 0 ? process.argv[i + 1] : undefined;
}

// 支持 CLI 参数（--port / --host）与环境变量，CLI 优先，供预览宿主注入
const cliPort = argValue('--port');
const cliHost = argValue('--host') || argValue('--hostname');
const PORT = cliPort || process.env.DEPLOY_RUN_PORT || process.env.PORT || '5000';

function killPortIfListening(port) {
  try {
    const out = execSync('netstat -ano -p tcp', { encoding: 'utf-8' });
    const pids = new Set();
    for (const line of out.split(/\r?\n/)) {
      if (!/LISTENING/.test(line)) continue;
      const parts = line.trim().split(/\s+/);
      const local = parts[1] || '';
      if (!local.endsWith(':' + port)) continue;
      const pid = parts[parts.length - 1];
      if (pid && pid !== '0') pids.add(pid);
    }
    if (pids.size === 0) {
      console.log(`Port ${port} is free.`);
      return;
    }
    for (const pid of pids) {
      console.log(`Port ${port} in use by PID ${pid}, killing...`);
      try {
        execSync(`taskkill /F /PID ${pid}`, { stdio: 'ignore' });
      } catch {
        console.warn(`Warning: failed to kill PID ${pid}`);
      }
    }
  } catch (err) {
    console.warn(`Warning: 端口检查失败，继续启动 (${err.message})`);
  }
}

console.log(`Clearing port ${PORT} before start.`);
killPortIfListening(PORT);
console.log(`Starting HTTP service on port ${PORT} for dev...`);

// 直接用项目自带的 tsx CLI 启动，不依赖全局 pnpm（预览宿主环境通常没有 pnpm）
const tsxCli = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'node_modules',
  'tsx',
  'dist',
  'cli.mjs'
);

const child = spawn(process.execPath, [tsxCli, 'watch', 'src/server.ts'], {
  stdio: 'inherit',
  env: { ...process.env, PORT, ...(cliHost ? { HOSTNAME: cliHost } : {}) },
});
child.on('error', (err) => {
  console.error(`启动失败: ${err.message}`);
  process.exit(1);
});
child.on('exit', (code) => process.exit(code ?? 1));
