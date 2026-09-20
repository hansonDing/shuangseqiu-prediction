import { test } from 'node:test';
import assert from 'node:assert/strict';
import { predict } from '../src/lib/lottery-engine';
import { makeDraws } from './helpers/make-draws';

const draws = makeDraws(60);

test('默认返回 8 注', () => {
  assert.equal(predict(draws).length, 8);
});

test('count=10 返回 10 注，每注 6 红升序且不重复', () => {
  const combos = predict(draws, undefined, 10);
  assert.equal(combos.length, 10);
  for (const c of combos) {
    assert.equal(c.reds.length, 6);
    assert.equal(new Set(c.reds).size, 6);
    const sorted = [...c.reds].sort((a, b) => a - b);
    assert.deepEqual(c.reds, sorted);
    assert.ok(c.blue >= 1 && c.blue <= 16);
  }
});

test('count 越界钳制到 1-20', () => {
  assert.equal(predict(draws, undefined, 0).length, 8);
  assert.equal(predict(draws, undefined, 99).length, 20);
});
