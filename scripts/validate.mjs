/**
 * Windows 版校验脚本（scripts/validate.sh 的跨平台等价实现）
 */
import { spawnSync } from 'node:child_process';

console.log('🔍 Running validate...');
const result = spawnSync('pnpm', ['validate'], { stdio: 'inherit', shell: process.platform === 'win32' });
if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}
if (result.status !== 0) process.exit(result.status ?? 1);
console.log('✅ Validate passed!');
