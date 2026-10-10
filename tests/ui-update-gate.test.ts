import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isSameOrigin } from '../src/lib/request-auth';
import { decideUiTrigger, type UiUpdateState } from '../src/lib/ui-update-gate';

/** 只为校验 header 判定，不必构造真实的 Request 实例 */
function req(url: string, headers: Record<string, string> = {}): Request {
  return { url, headers: new Headers(headers) } as unknown as Request;
}

const PUBLIC = 'https://shuangseqiu-325640-12-1349832365.sh.run.tcloudbase.com';
const LOCAL = 'http://localhost:5000';

// ---------- 同源判定 ----------

test('不带 Origin / Referer 时放行（curl、平台定时触发器等非浏览器调用）', () => {
  assert.equal(isSameOrigin(req(`${PUBLIC}/api/update/ui`)), true);
  assert.equal(isSameOrigin(req(`${LOCAL}/api/update/ui`, { host: 'localhost:5000' })), true);
});

test('Origin 与 Host 一致时放行', () => {
  const u = `${PUBLIC}/api/update/ui`;
  assert.equal(isSameOrigin(req(u, { host: 'shuangseqiu-325640-12-1349832365.sh.run.tcloudbase.com', origin: PUBLIC })), true);
});

test('Host 被反代改写时，凭 x-forwarded-host 也能放行', () => {
  assert.equal(
    isSameOrigin(
      req(`${PUBLIC}/api/update/ui`, {
        host: '10.23.16.70:5000',
        'x-forwarded-host': 'shuangseqiu-325640-12-1349832365.sh.run.tcloudbase.com',
        origin: PUBLIC,
      })
    ),
    true
  );
});

test('无 host 头时回退到 request.url 的 host', () => {
  assert.equal(isSameOrigin(req(`${LOCAL}/api/update/ui`, { origin: LOCAL })), true);
});

test('x-forwarded-host 为多级链路时取第一跳', () => {
  assert.equal(
    isSameOrigin(
      req(`${PUBLIC}/api/update/ui`, {
        'x-forwarded-host': 'shuangseqiu-325640-12-1349832365.sh.run.tcloudbase.com, inner.local',
        origin: PUBLIC,
      })
    ),
    true
  );
});

test('Origin 属于其它站点时拒绝（挡 CSRF）', () => {
  assert.equal(
    isSameOrigin(req(`${PUBLIC}/api/update/ui`, { host: 'shuangseqiu-325640-12-1349832365.sh.run.tcloudbase.com', origin: 'https://evil.example.com' })), 
    false
  );
});

test('端口不同即视为跨站', () => {
  assert.equal(
    isSameOrigin(req(`${LOCAL}/api/update/ui`, { host: 'localhost:5000', origin: 'http://localhost:3000' })),
    false
  );
});

test('只有 Referer 时同样参与判定', () => {
  const host = 'shuangseqiu-325640-12-1349832365.sh.run.tcloudbase.com';
  assert.equal(isSameOrigin(req(`${PUBLIC}/api/update/ui`, { host, referer: `${PUBLIC}/` })), true);
  assert.equal(isSameOrigin(req(`${PUBLIC}/api/update/ui`, { host, referer: 'https://evil.example.com/x' })), false);
});

test('Origin 不是合法 URL 时拒绝', () => {
  assert.equal(isSameOrigin(req(`${PUBLIC}/api/update/ui`, { host: 'x', origin: 'not-a-url' })), false);
});

// ---------- Sec-Fetch-Site 优先 ----------

test('Sec-Fetch-Site=same-origin 时放行，且不看 Host（反代改写 Host 也不受影响）', () => {
  assert.equal(
    isSameOrigin(
      req(`${PUBLIC}/api/update/ui`, {
        'sec-fetch-site': 'same-origin',
        host: '10.23.16.70:5000',
        origin: PUBLIC,
      })
    ),
    true
  );
});

test('Sec-Fetch-Site=cross-site / same-site 时拒绝（脚本无法伪造该头）', () => {
  const host = 'shuangseqiu-325640-12-1349832365.sh.run.tcloudbase.com';
  assert.equal(isSameOrigin(req(`${PUBLIC}/api/update/ui`, { 'sec-fetch-site': 'cross-site', host })), false);
  assert.equal(isSameOrigin(req(`${PUBLIC}/api/update/ui`, { 'sec-fetch-site': 'same-site', host })), false);
});

test('Sec-Fetch-Site 缺省时回退到 Origin 比对', () => {
  const host = 'shuangseqiu-325640-12-1349832365.sh.run.tcloudbase.com';
  assert.equal(isSameOrigin(req(`${PUBLIC}/api/update/ui`, { host, origin: PUBLIC })), true);
  assert.equal(isSameOrigin(req(`${PUBLIC}/api/update/ui`, { host, origin: 'https://evil.example.com' })), false);
});

// ---------- 触发闸门 ----------

const idle: UiUpdateState = { inFlight: false, lastFinishedAt: 0 };
const NOW = 1_700_000_000_000;

test('空闲且从未执行过 → 放行', () => {
  assert.deepEqual(decideUiTrigger(idle, NOW, 30), { allow: true, status: 200, message: '' });
});

test('已有任务在执行 → 409 单飞拦截', () => {
  const d = decideUiTrigger({ inFlight: true, lastFinishedAt: 0 }, NOW, 30);
  assert.equal(d.allow, false);
  assert.equal(d.status, 409);
});

test('冷却期内 → 429 并给出剩余秒数', () => {
  const d = decideUiTrigger({ inFlight: false, lastFinishedAt: NOW - 10_000 }, NOW, 30);
  assert.equal(d.allow, false);
  assert.equal(d.status, 429);
  assert.match(d.message, /20 秒/);
});

test('冷却期刚满 → 放行', () => {
  assert.equal(decideUiTrigger({ inFlight: false, lastFinishedAt: NOW - 30_000 }, NOW, 30).allow, true);
});

test('冷却设为 0 时只做单飞、不限频', () => {
  assert.equal(decideUiTrigger({ inFlight: false, lastFinishedAt: NOW - 1 }, NOW, 0).allow, true);
});

test('系统时钟回拨时不把功能锁死', () => {
  assert.equal(decideUiTrigger({ inFlight: false, lastFinishedAt: NOW + 60_000 }, NOW, 30).allow, true);
});
