import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NextResponse } from 'next/server';
import { internalUrl, runInternalPost } from '../src/lib/internal-proxy';
import type { UiUpdateState } from '../src/lib/ui-update-gate';

/** 只为校验 header / url 判定，不必构造真实的 Request 实例 */
function req(url: string, headers: Record<string, string> = {}): Request {
  return { url, headers: new Headers(headers) } as unknown as Request;
}

const PUBLIC = 'https://shuangseqiu-325640-12-1349832365.sh.run.tcloudbase.com';

const failure = (status: number, message: string) => NextResponse.json({ message }, { status });

/** 临时改环境变量的工具 */
function withEnv(key: string, value: string | undefined, fn: () => void): void {
  const had = Object.prototype.hasOwnProperty.call(process.env, key);
  const old = process.env[key];
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
  try {
    fn();
  } finally {
    if (had) process.env[key] = old as string;
    else delete process.env[key];
  }
}

// ---------- 回环地址拼装 ----------

test('配置 PORT 时用 PORT 拼回环地址（不依赖 Host）', () => {
  withEnv('PORT', '5000', () => {
    assert.equal(
      internalUrl(req(`${PUBLIC}/api/simulation/buy/ui`), '/api/simulation/buy'),
      'http://127.0.0.1:5000/api/simulation/buy'
    );
  });
});

test('无 PORT 时回退到 request.url 的端口', () => {
  withEnv('PORT', undefined, () => {
    assert.equal(
      internalUrl(req('http://127.0.0.1:4321/x'), '/api/update'),
      'http://127.0.0.1:4321/api/update'
    );
  });
});

test('无 PORT、url 也无端口时回退 5000', () => {
  withEnv('PORT', undefined, () => {
    assert.equal(internalUrl(req('http://localhost/x'), '/api/update'), 'http://127.0.0.1:5000/api/update');
  });
});

// ---------- 转发行为 ----------

test('跨站请求在转发前即被 403 挡下，不发起回环调用', async () => {
  let forwarded = false;
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    forwarded = true;
    return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  try {
    const gate: UiUpdateState = { inFlight: false, lastFinishedAt: 0 };
    const res = await runInternalPost(
      // 真实 CSRF 场景：Host 是本站，Origin 是攻击者站点
      req(`${PUBLIC}/api/update/ui`, {
        host: 'shuangseqiu-325640-12-1349832365.sh.run.tcloudbase.com',
        origin: 'https://evil.example.com',
      }),
      { targetPath: '/api/update', subject: '更新', cooldownSeconds: 30, gate, failure }
    );
    assert.equal(res.status, 403);
    assert.equal(forwarded, false);
    assert.equal(gate.lastFinishedAt, 0, '被闸门拒绝时不应更新 lastFinishedAt');
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('单飞中的请求被 409 挡下', async () => {
  const gate: UiUpdateState = { inFlight: true, lastFinishedAt: 0 };
  const res = await runInternalPost(
    req(`${PUBLIC}/api/update/ui`, { 'sec-fetch-site': 'same-origin' }),
    { targetPath: '/api/update', subject: '更新', cooldownSeconds: 30, gate, failure }
  );
  assert.equal(res.status, 409);
});

test('放行时把令牌补进 Authorization 并转发到目标路径', async () => {
  const realFetch = globalThis.fetch;
  let seenUrl = '';
  let seenAuth: string | null = null;
  globalThis.fetch = (async (input: unknown, init?: { headers?: Record<string, string> }) => {
    seenUrl = String(input);
    seenAuth = init?.headers?.authorization ?? null;
    return new Response(JSON.stringify({ ok: true, message: 'done' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;

  const hadToken = Object.prototype.hasOwnProperty.call(process.env, 'UPDATE_TOKEN');
  const oldToken = process.env.UPDATE_TOKEN;
  process.env.UPDATE_TOKEN = 'secret-token';
  const hadPort = Object.prototype.hasOwnProperty.call(process.env, 'PORT');
  const oldPort = process.env.PORT;
  process.env.PORT = '5000';

  try {
    const gate: UiUpdateState = { inFlight: false, lastFinishedAt: 0 };
    const res = await runInternalPost(
      req(`${PUBLIC}/api/simulation/buy/ui`, { 'sec-fetch-site': 'same-origin' }),
      { targetPath: '/api/simulation/buy', subject: '买入', cooldownSeconds: 10, gate, failure }
    );
    assert.equal(res.status, 200);
    assert.equal(seenUrl, 'http://127.0.0.1:5000/api/simulation/buy');
    assert.equal(seenAuth, 'Bearer secret-token');
    assert.equal(gate.inFlight, false, '转发结束后应释放单飞');
    assert.ok(gate.lastFinishedAt > 0, '转发结束后应记录冷却起点');
  } finally {
    globalThis.fetch = realFetch;
    if (hadToken) process.env.UPDATE_TOKEN = oldToken as string;
    else delete process.env.UPDATE_TOKEN;
    if (hadPort) process.env.PORT = oldPort as string;
    else delete process.env.PORT;
  }
});

test('内部接口返回非 JSON 时降级为 502', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response('<html>oops</html>', { status: 500 })) as typeof fetch;
  try {
    const gate: UiUpdateState = { inFlight: false, lastFinishedAt: 0 };
    const res = await runInternalPost(
      req(`${PUBLIC}/api/simulation/reset/ui`, { 'sec-fetch-site': 'same-origin' }),
      { targetPath: '/api/simulation/reset', subject: '重置', cooldownSeconds: 10, gate, failure }
    );
    assert.equal(res.status, 502);
  } finally {
    globalThis.fetch = realFetch;
  }
});
