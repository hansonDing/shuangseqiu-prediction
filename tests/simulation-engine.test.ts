import { test } from 'node:test';
import assert from 'node:assert/strict';
import { judgeTicket, nextDrawPeriod } from '../src/lib/simulation-engine';
import type { DrawRecord } from '../src/lib/lottery-engine';

const actual: DrawRecord = {
  id: 1, period: '2026101', draw_date: '2026-09-01',
  red1: 1, red2: 5, red3: 9, red4: 17, red5: 24, red6: 33, blue: 4,
};
const A = [1, 5, 9, 17, 24, 33];
const cfg = { first: 5_000_000, second: 200_000 };

test('一等奖 6红+蓝', () => {
  const r = judgeTicket(A, 4, actual, cfg);
  assert.deepEqual(r, { redHits: 6, blueHit: true, tier: 1, prize: 5_000_000 });
});

test('二等奖 6红无蓝', () => {
  const r = judgeTicket(A, 1, actual, cfg);
  assert.equal(r.tier, 2);
  assert.equal(r.prize, 200_000);
});

test('三等奖 5红+蓝', () => {
  const r = judgeTicket([1, 5, 9, 17, 24], 4, actual, cfg);
  assert.equal(r.tier, 3);
  assert.equal(r.prize, 3000);
});

test('四等奖 5红无蓝 / 4红+蓝', () => {
  assert.equal(judgeTicket([1, 5, 9, 17, 24], 1, actual, cfg).prize, 200);
  assert.equal(judgeTicket([1, 5, 9, 17, 2, 3], 4, actual, cfg).prize, 200);
});

test('五等奖 4红无蓝 / 3红+蓝', () => {
  assert.equal(judgeTicket([1, 5, 9, 17, 2, 3], 1, actual, cfg).prize, 10);
  assert.equal(judgeTicket([1, 5, 9, 2, 3, 4], 4, actual, cfg).prize, 10);
});

test('六等奖 蓝命中（0/1/2 红）', () => {
  assert.equal(judgeTicket([2, 3, 4, 6, 7, 8], 4, actual, cfg).prize, 5);
  assert.equal(judgeTicket([5, 3, 4, 6, 7, 8], 4, actual, cfg).prize, 5);
  assert.equal(judgeTicket([2, 3, 4, 6, 7, 10], 4, actual, cfg).prize, 5);
});

test('未中奖', () => {
  const r = judgeTicket([2, 3, 4, 6, 7, 8], 1, actual, cfg);
  assert.equal(r.tier, 0);
  assert.equal(r.prize, 0);
});

test('nextDrawPeriod 同年顺延 +1', () => {
  // 2026-09-15 是周二，下一期周四 09-17，同年
  const latest: DrawRecord = {
    id: 1, period: '2026108', draw_date: '2026-09-15',
    red1: 1, red2: 2, red3: 3, red4: 4, red5: 5, red6: 6, blue: 1,
  };
  assert.equal(nextDrawPeriod(latest), '2026109');
});

test('nextDrawPeriod 跨年重置为 <新年>001', () => {
  // 2026-12-31 是周四，下一期周日 2027-01-03
  const latest: DrawRecord = {
    id: 1, period: '2026153', draw_date: '2026-12-31',
    red1: 1, red2: 2, red3: 3, red4: 4, red5: 5, red6: 6, blue: 1,
  };
  assert.equal(nextDrawPeriod(latest), '2027001');
});
