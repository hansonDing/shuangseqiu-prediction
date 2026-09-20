import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';

process.env.LOTTERY_DB_PATH = path.join(
  os.tmpdir(),
  `draw-repo-test-${process.pid}.duckdb`
);

let drawRepo: typeof import('../src/storage/database/draw-repository');

before(async () => {
  drawRepo = await import('../src/storage/database/draw-repository');
  await drawRepo.ensureDrawsLoaded();
});

test('upsertDraws 插入与跳过', async () => {
  const draws = Array.from({ length: 5 }, (_, i) => ({
    period: `2026${String(i + 1).padStart(3, '0')}`,
    draw_date: '2026-01-01',
    red1: 1, red2: 2, red3: 3, red4: 4, red5: 5, red6: 6,
    blue: 7,
  }));
  const r1 = await drawRepo.upsertDraws(draws);
  assert.deepEqual(r1, { inserted: 5, skipped: 0 });
  const r2 = await drawRepo.upsertDraws(draws);
  assert.deepEqual(r2, { inserted: 0, skipped: 5 });
  assert.equal(drawRepo.getAllDraws().length, 5);
  assert.equal(drawRepo.getLatestPeriod(), '2026005');
});
