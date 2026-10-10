import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  TASKS,
  classifyStatus,
  decideTask,
  envInt,
  localDateStr,
  type ScheduledTask,
} from '../src/lib/cron-schedule';

const at = (h: number, m: number) => h * 60 + m;

const buy = TASKS.find((t) => t.name === 'sim-buy') as ScheduledTask;
const update = TASKS.find((t) => t.name === 'data-update') as ScheduledTask;

// 2026-10-08 是周四；周二=2，周三=3，周日=0
const TUE = 2;
const WED = 3;
const THU = 4;
const SUN = 0;

test('任务表：买入周二/四/日 19:30，更新周一/三/五 22:00', () => {
  assert.deepEqual(buy.days, [2, 4, 0]);
  assert.deepEqual([buy.hour, buy.minute], [19, 30]);
  assert.equal(buy.path, '/api/simulation/buy');
  assert.deepEqual(update.days, [1, 3, 5]);
  assert.deepEqual([update.hour, update.minute], [22, 0]);
  assert.equal(update.path, '/api/update');
});

test('准时窗口内触发，且不算补跑', () => {
  assert.deepEqual(decideTask(buy, TUE, at(19, 30), 60), { run: true, isCatchUp: false });
  assert.deepEqual(decideTask(update, WED, at(22, 0), 60), { run: true, isCatchUp: false });
});

test('未到点不触发', () => {
  assert.equal(decideTask(buy, TUE, at(19, 29), 60).run, false);
  assert.equal(decideTask(update, WED, at(21, 59), 60).run, false);
});

test('非触发日不触发', () => {
  // 买入日为周二/四/日，因此周三不触发；更新日为周一/三/五，因此周四不触发
  assert.equal(decideTask(buy, WED, at(19, 30), 60).run, false);
  assert.equal(decideTask(update, THU, at(22, 0), 60).run, false);
});

test('周日（0）属于买入日', () => {
  assert.equal(decideTask(buy, SUN, at(19, 30), 60).run, true);
});

test('过了准点仍在宽限窗口内 → 补跑', () => {
  assert.deepEqual(decideTask(buy, TUE, at(19, 31), 60), { run: true, isCatchUp: true });
  assert.deepEqual(decideTask(buy, TUE, at(20, 0), 60), { run: true, isCatchUp: true });
  // 边界：窗口末端（含）
  assert.deepEqual(decideTask(buy, TUE, at(20, 30), 60), { run: true, isCatchUp: true });
});

test('超出宽限窗口不补跑', () => {
  assert.equal(decideTask(buy, TUE, at(20, 31), 60).run, false);
  assert.equal(decideTask(update, WED, at(23, 1), 60).run, false);
});

test('补跑窗口设为 0 时只认准点', () => {
  assert.equal(decideTask(buy, TUE, at(19, 31), 0).run, false);
  assert.equal(decideTask(buy, TUE, at(20, 0), 0).run, false);
  assert.equal(decideTask(buy, TUE, at(19, 30), 0).run, true);
});

test('宽限窗口可自定义', () => {
  // 19:30 + 120 分钟 = 21:30 为窗口末端（含）
  assert.equal(decideTask(buy, TUE, at(21, 0), 120).run, true);
  assert.equal(decideTask(buy, TUE, at(21, 30), 120).run, true);
  assert.equal(decideTask(buy, TUE, at(21, 31), 120).run, false);
});

test('classifyStatus：2xx 成功、409 跳过、401/403 致命、其余重试', () => {
  assert.equal(classifyStatus(200), 'ok');
  assert.equal(classifyStatus(204), 'ok');
  assert.equal(classifyStatus(409), 'skip');
  assert.equal(classifyStatus(401), 'fatal');
  assert.equal(classifyStatus(403), 'fatal');
  assert.equal(classifyStatus(422), 'retry');
  assert.equal(classifyStatus(500), 'retry');
  assert.equal(classifyStatus(503), 'retry');
});

test('localDateStr 补零正确', () => {
  assert.equal(localDateStr(new Date(2026, 9, 8)), '2026-10-08');
  assert.equal(localDateStr(new Date(2026, 0, 1)), '2026-01-01');
  assert.equal(localDateStr(new Date(2026, 11, 31)), '2026-12-31');
});

test('envInt：缺失/空/非法回退默认值，0 与正常值生效', () => {
  delete process.env.CRON_TEST_VAR;
  assert.equal(envInt('CRON_TEST_VAR', 60), 60);

  process.env.CRON_TEST_VAR = '';
  assert.equal(envInt('CRON_TEST_VAR', 60), 60);

  process.env.CRON_TEST_VAR = '   ';
  assert.equal(envInt('CRON_TEST_VAR', 60), 60);

  process.env.CRON_TEST_VAR = 'abc';
  assert.equal(envInt('CRON_TEST_VAR', 60), 60);

  process.env.CRON_TEST_VAR = '-5';
  assert.equal(envInt('CRON_TEST_VAR', 60), 60);

  process.env.CRON_TEST_VAR = '0';
  assert.equal(envInt('CRON_TEST_VAR', 60), 0);

  process.env.CRON_TEST_VAR = '30';
  assert.equal(envInt('CRON_TEST_VAR', 30), 30);

  delete process.env.CRON_TEST_VAR;
});
