import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';

process.env.LOTTERY_DB_PATH = path.join(
  os.tmpdir(),
  `sim-repo-test-${process.pid}.duckdb`
);

let repo: typeof import('../src/storage/database/simulation-repository');
let drawRepo: typeof import('../src/storage/database/draw-repository');

before(async () => {
  const duckdb = await import('../src/storage/database/duckdb');
  await duckdb.initDatabase();
  drawRepo = await import('../src/storage/database/draw-repository');
  repo = await import('../src/storage/database/simulation-repository');
  await drawRepo.ensureDrawsLoaded();
  const { makeDraws } = await import('./helpers/make-draws');
  await drawRepo.upsertDraws(makeDraws(60));
});

const WEIGHTS = { frequency: 0.4, recency: 0.35, balance: 0.25 };

test('买入 10 注：扣款、生成持仓', async () => {
  const r = await repo.buyPredictions(WEIGHTS);
  assert.equal(r.ok, true);
  const st = await repo.getSimulationStatus();
  assert.equal(st.pending?.bets.length, 10);
  assert.equal(st.account.cash, 100000 - 20);
  assert.equal(st.account.total_invested, 20);
});

test('已有未结算持仓时重复买入被拒', async () => {
  const r = await repo.buyPredictions(WEIGHTS);
  assert.equal(r.ok, false);
  assert.match(r.message, /未结算/);
});

test('开奖号未入库：结算跳过，持仓挂起', async () => {
  const s = await repo.settlePendingDraws();
  assert.equal(s.settled, 0);
  assert.equal(s.pending, 1);
  const st = await repo.getSimulationStatus();
  assert.notEqual(st.pending, null);
});

test('开奖号入库后自动结算，资金对账一致', async () => {
  const st0 = await repo.getSimulationStatus();
  const target = st0.pending!.period;
  // 构造目标期开奖号：红 1-6，蓝 7
  await drawRepo.upsertDraws([{
    period: target, draw_date: '2026-12-31',
    red1: 1, red2: 2, red3: 3, red4: 4, red5: 5, red6: 6, blue: 7,
  }]);
  const s = await repo.settlePendingDraws();
  assert.equal(s.settled, 1);
  assert.equal(s.pending, 0);

  const st = await repo.getSimulationStatus();
  assert.equal(st.pending, null);
  assert.equal(st.settlements.length, 10);
  assert.equal(st.account.total_invested, 20);
  // 资金对账：cash = 初始 - 投入 + 奖金
  assert.equal(st.account.cash, 100000 - 20 + st.account.total_prize);
  assert.equal(st.equity.length >= 1, true);
  assert.equal(st.equity[st.equity.length - 1].period, target);
  assert.equal(st.logs.length >= 1, true);
});

test('重置：账本清零，资金恢复初始值', async () => {
  const r = await repo.resetSimulation();
  assert.equal(r.initial, 100000);
  const st = await repo.getSimulationStatus();
  assert.equal(st.account.cash, 100000);
  assert.equal(st.account.total_invested, 0);
  assert.equal(st.settlements.length, 0);
  assert.equal(st.equity.length, 0);
  assert.equal(st.pending, null);
});
