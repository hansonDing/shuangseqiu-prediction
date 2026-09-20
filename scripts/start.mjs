/**
 * Windows 版生产启动脚本（scripts/start.sh 的跨平台等价实现）
 */
import { spawn } from 'node:child_process';

const PORT = process.env.DEPLOY_RUN_PORT || process.env.PORT || '5000';

console.log(`Starting HTTP service on port ${PORT} for deploy...`);

const child = spawn('node', ['dist/server.js'], {
  stdio: 'inherit',
  env: { ...process.env, PORT },
});
child.on('error', (err) => {
  console.error(`启动失败: ${err.message}`);
  process.exit(1);
});
child.on('exit', (code) => process.exit(code ?? 1));
