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
