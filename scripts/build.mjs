/**
 * Windows 版构建脚本（scripts/build.sh 的跨平台等价实现）
 *
 * 注意：生产构建有两处必要处理，改动前请先读下面两段注释，否则构建必然失败。
 */
import { spawnSync } from 'node:child_process';
import { existsSync, renameSync } from 'node:fs';

function run(cmd, args) {
  console.log(`> ${cmd} ${args.join(' ')}`);
  const result = spawnSync(cmd, args, { stdio: 'inherit', shell: process.platform === 'win32' });
  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }
  if (result.status !== 0) process.exit(result.status ?? 1);
}

const BABELRC = '.babelrc';
const BABELRC_BAK = '.babelrc.build-bak';

/**
 * 构建期间移开 .babelrc，结束后还原。
 *
 * .babelrc 把 preset-react 的 development 固定为 true，会让 babel 在生产构建里
 * 注入 jsxDEV，预渲染 /_not-found 时抛 "jsxDEV is not a function" 而构建失败。
 * 该文件只是 react-dev-inspector 的开发期调试配置（见 src/app/layout.tsx），
 * 开发模式仍需保留，因此这里只在构建期临时移开。
 */
function hideBabelrc() {
  if (existsSync(BABELRC)) renameSync(BABELRC, BABELRC_BAK);
}
function restoreBabelrc() {
  if (existsSync(BABELRC_BAK)) renameSync(BABELRC_BAK, BABELRC);
}

try {
  console.log('Installing dependencies...');
  run('pnpm', ['install', '--prefer-frozen-lockfile', '--prefer-offline']);

  hideBabelrc();

  /**
   * --webpack 不可省略：Next 16 默认使用 Turbopack 构建，而 Turbopack 在解析
   * duckdb 包的 package.json 时，会对 node-pre-gyp 的 "binary" 字段做反序列化
   * 并要求 `napi_versions`，duckdb 未提供该字段即 panic：
   *   TurbopackInternalError: missing field `napi_versions`
   *   （堆栈指向 <NodePreGypConfigReference>::resolve_reference）
   * 这是 Turbopack 自身缺陷，与本项目代码无关，切到 webpack 即规避。
   */
  console.log('Building the Next.js project...');
  run('pnpm', ['next', 'build', '--webpack']);

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
} finally {
  restoreBabelrc();
}
