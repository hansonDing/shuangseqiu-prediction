/**
 * PostgREST 请求构造单测
 *
 * 为什么要测这一层：CloudBase 的服务端通道需要 API Key 才能真实调用，
 * 在缺少密钥的环境里无法端到端验证。因此把 URL / 查询串 / 响应解析
 * 全部抽成纯函数，用单测锁住契约，避免「拼错路径」这类问题被带到线上。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildRpcUrl,
  buildTableUrl,
  inExpr,
  restBaseUrl,
  toRows,
  toScalar,
} from '../src/storage/database/postgrest';

test('restBaseUrl 按 envId 推导默认网关', () => {
  assert.equal(
    restBaseUrl('env-abc'),
    'https://env-abc.api.tcloudbasegateway.com/v1/rdb/rest'
  );
});

test('restBaseUrl 支持自定义网关并自动补齐路径', () => {
  assert.equal(
    restBaseUrl('env-abc', 'https://inner.example.com'),
    'https://inner.example.com/v1/rdb/rest'
  );
  assert.equal(
    restBaseUrl('env-abc', 'https://inner.example.com/'),
    'https://inner.example.com/v1/rdb/rest'
  );
  // 已经带路径时不重复追加
  assert.equal(
    restBaseUrl('env-abc', 'https://inner.example.com/v1/rdb/rest'),
    'https://inner.example.com/v1/rdb/rest'
  );
});

test('buildTableUrl 无选项时只拼表名', () => {
  assert.equal(
    buildTableUrl('https://x/v1/rdb/rest', 'lottery_draws'),
    'https://x/v1/rdb/rest/lottery_draws'
  );
});

test('buildTableUrl 拼装 select / filter / order / limit', () => {
  assert.equal(
    buildTableUrl('https://x/v1/rdb/rest', 'lottery_bets', {
      select: 'id, period',
      filters: { status: 'eq.pending', run_id: 'eq.3' },
      order: 'id.desc',
      limit: 10,
    }),
    'https://x/v1/rdb/rest/lottery_bets' +
      '?select=id%2C%20period&status=eq.pending&run_id=eq.3&order=id.desc&limit=10'
  );
});

test('buildTableUrl 跳过空过滤值', () => {
  assert.equal(
    buildTableUrl('https://x/v1/rdb/rest', 'lottery_bets', {
      filters: { status: 'eq.pending', run_id: '' },
    }),
    'https://x/v1/rdb/rest/lottery_bets?status=eq.pending&run_id='
  );
});

test('buildRpcUrl 指向 rpc 子路径', () => {
  assert.equal(
    buildRpcUrl('https://x/v1/rdb/rest', 'lottery_commit_buy'),
    'https://x/v1/rdb/rest/rpc/lottery_commit_buy'
  );
});

test('inExpr 生成 PostgREST 的 in 表达式', () => {
  assert.equal(inExpr([1, 2, 3]), 'in.(1,2,3)');
  assert.equal(inExpr(['a']), 'in.(a)');
});

test('toRows 接受数组、容忍空值、拒绝对象', () => {
  assert.deepEqual(toRows<{ a: number }>([{ a: 1 }], 'draws'), [{ a: 1 }]);
  assert.deepEqual(toRows(null, 'draws'), []);
  assert.deepEqual(toRows(undefined, 'draws'), []);
  // 错误响应体是对象，必须报错而不是被当成行列表
  assert.throws(() => toRows({ message: 'boom' }, 'draws'), /期望数组响应/);
});

test('toScalar 解析数字与数字字符串，其余返回 null', () => {
  assert.equal(toScalar(7), 7);
  assert.equal(toScalar('7'), 7);
  assert.equal(toScalar(null), null);
  assert.equal(toScalar('abc'), null);
  assert.equal(toScalar(''), null);
});
