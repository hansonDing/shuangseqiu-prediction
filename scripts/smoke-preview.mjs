/**
 * 预览冒烟测试：以前台方式启动 dev 服务器，验证页面与 API 后自动结束进程树
 * 用法: node scripts/smoke-preview.mjs [port]   （默认 5123）
 */
import { spawn } from 'node:child_process';

const PORT = process.argv[2] || '5123';
const BASE = `http://127.0.0.1:${PORT}`;

const child = spawn(
  process.execPath,
  ['scripts/run.mjs', 'dev', '--port', PORT, '--host', '127.0.0.1'],
  { stdio: ['ignore', 'pipe', 'pipe'] }
);
child.stdout.on('data', (d) => process.stdout.write(d));
child.stderr.on('data', (d) => process.stderr.write(d));

function killTree() {
  if (process.platform === 'win32') {
    try {
      spawn('taskkill', ['/F', '/T', '/PID', String(child.pid)], { stdio: 'ignore' });
    } catch { /* ignore */ }
  } else {
    child.kill('SIGKILL');
  }
}

async function waitReady(timeoutMs = 150000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const r = await fetch(`${BASE}/api/draws?limit=1`);
      if (r.ok) return true;
    } catch { /* not ready yet */ }
    await new Promise((r) => setTimeout(r, 1500));
  }
  return false;
}

let exitCode = 0;
try {
  if (!(await waitReady())) {
    console.error('✗ 服务器 150s 内未就绪');
    exitCode = 1;
  } else {
    const home = await fetch(`${BASE}/`);
    const html = await home.text();
    const hasMarker = html.includes('__next') || html.includes('self.__next_f');
    console.log(`✓ 首页: HTTP ${home.status}, ${html.length} bytes, 页面标记=${hasMarker}`);
    if (!hasMarker) exitCode = 1;

    for (const p of ['/api/analysis', '/api/predict']) {
      const r = await fetch(`${BASE}${p}`);
      const body = JSON.stringify(await r.json()).slice(0, 120);
      console.log(`✓ ${p} -> HTTP ${r.status} | ${body}`);
      if (!r.ok) exitCode = 1;
    }
    console.log(exitCode === 0 ? 'SMOKE OK' : 'SMOKE FAIL');
  }
} catch (err) {
  console.error('✗ 冒烟测试异常:', err.message);
  exitCode = 1;
} finally {
  killTree();
  // 给 taskkill 留 2 秒收尾，确保进程树完全退出
  setTimeout(() => process.exit(exitCode), 2000).unref?.();
}
