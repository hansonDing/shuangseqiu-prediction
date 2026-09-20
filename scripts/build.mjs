/**
 * Windows 版构建脚本（scripts/build.sh 的跨平台等价实现）
 */
import { spawnSync } from 'node:child_process';

function run(cmd, args) {
  console.log(`> ${cmd} ${args.join(' ')}`);
  const result = spawnSync(cmd, args, { stdio: 'inherit', shell: process.platform === 'win32' });
  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }
  if (result.status !== 0) process.exit(result.status ?? 1);
}

console.log('Installing dependencies...');
run('pnpm', ['install', '--prefer-frozen-lockfile', '--prefer-offline']);

console.log('Building the Next.js project...');
run('pnpm', ['next', 'build']);

console.log('Bundling server with tsup...');
run('pnpm', [
  'tsup', 'src/server.ts',
  '--format', 'cjs',
  '--platform', 'node',
  '--target', 'node20',
  '--outDir', 'dist',
  '--no-splitting',
  '--no-minify',
]);

console.log('Build completed successfully!');
