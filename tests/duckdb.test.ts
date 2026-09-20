import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';

process.env.LOTTERY_DB_PATH = path.join(
  os.tmpdir(),
  `duckdb-test-${process.pid}.duckdb`
);

let db: typeof import('../src/storage/database/duckdb');

before(async () => {
  db = await import('../src/storage/database/duckdb');
  await db.initDatabase();
});

test('建表成功：核心表可查询', async () => {
  const tables = await db.all<{ name: string }>(
    `SELECT table_name AS name FROM information_schema.tables WHERE table_schema = 'main' ORDER BY table_name`
  );
  const names = tables.map((t) => t.name);
  for (const expected of [
    'draws', 'prediction_runs', 'bets', 'settlements',
    'equity_snapshots', 'account', 'fund_transactions', 'operation_log',
  ]) {
    assert.ok(names.includes(expected), `缺少表 ${expected}`);
  }
});

test('serialize 串行执行且返回结果', async () => {
  const results: number[] = [];
  await Promise.all([
    db.serialize(async () => { results.push(1); return 1; }),
    db.serialize(async () => { results.push(2); return 2; }),
  ]);
  assert.deepEqual(results.sort(), [1, 2]);
});

test('run/all 参数绑定', async () => {
  await db.run(
    `INSERT INTO draws (period, draw_date, red1, red2, red3, red4, red5, red6, blue)
     VALUES (?, ?, 1, 2, 3, 4, 5, 6, 7)`,
    '2099001', '2099-01-01'
  );
  const rows = await db.all<{ period: string; blue: number }>(
    `SELECT period, blue FROM draws WHERE period = ?`, '2099001'
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].blue, 7);
  // 注意：Windows 下 DuckDB 持有文件句柄，连接未关闭时不能删除文件（临时文件随 PID 命名，无需清理）
});
