// test/budget-savings.test.mjs
// budgetWindowSavings(): the sidebar's "Saved this month/week" figure. It must agree with the
// Statistics "Saved" tile for the matching range (same cohort, same rate, same spend), count
// archived runs like every other stat, and follow the developer rate setting.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { seedPipeline } from './helpers/db-seed.mjs';
import { getDb } from '../src/core/db.mjs';
import { getStats, budgetWindowSavings } from '../src/core/stats.mjs';
import {
  budgetStatus, recordCostDelta, recordAskCostDelta, costWindowStart, costWindowEnd,
  totalWindowSpendUsd,
} from '../src/core/cost-budget.mjs';
import { setHumanRateUsdPerHour } from '../src/core/settings.mjs';

useTempHome(after); // DB sandbox (WORCA_HOME)

// settings sandbox: settingsFile() resolves under HOME, not WORCA_HOME — so the stored rate
// starts unset (effective rate = DEFAULT_HUMAN_RATE_USD, 35) and never touches the real one.
let sandboxHome;
const prevEnv = {};
before(async () => {
  sandboxHome = await mkdtemp(join(tmpdir(), 'worca-savings-'));
  for (const k of ['HOME', 'USERPROFILE']) prevEnv[k] = process.env[k];
  process.env.HOME = sandboxHome;
  process.env.USERPROFILE = sandboxHome;
});
after(async () => {
  for (const k of ['HOME', 'USERPROFILE']) {
    if (prevEnv[k] === undefined) delete process.env[k]; else process.env[k] = prevEnv[k];
  }
  await rm(sandboxHome, { recursive: true, force: true });
});

const NOW = new Date(2026, 7, 6, 15, 0);          // Thu 2026-08-06 local; month = Aug, week = Mon Aug 3
const iso = (y, m, d, hh = 12) => new Date(y, m - 1, d, hh).toISOString();
const setStarted = (id, isoTs) =>
  getDb().prepare('UPDATE pipelines SET started_at = ? WHERE id = ?').run(isoTs, id);
const archive = (id) => getDb().prepare(
  'UPDATE pipelines SET archived_at = ? WHERE id = ?').run(new Date().toISOString(), id);

before(async () => {
  // August: 12.5 h (archived — stats count archived rows) + 3.25 h, one of them this week.
  const { id: a } = await seedPipeline('/tmp/p', { status: 'done', humanHours: 12.5 });
  setStarted(a, iso(2026, 8, 4)); archive(a);
  const { id: b } = await seedPipeline('/tmp/p', { status: 'done', humanHours: 3.25 });
  setStarted(b, iso(2026, 8, 1));
  // July: outside both windows — its hours must not count.
  const { id: c } = await seedPipeline('/tmp/p', { status: 'done', humanHours: 40 });
  setStarted(c, iso(2026, 7, 20));
  recordCostDelta({ pipelineId: a, amountUsd: 4.5, tsMs: +new Date(2026, 7, 4, 10) });
  recordCostDelta({ pipelineId: b, amountUsd: 1.25, tsMs: +new Date(2026, 7, 1, 10) });
  recordCostDelta({ pipelineId: c, amountUsd: 9, tsMs: +new Date(2026, 6, 20, 10) });
  recordAskCostDelta({ threadId: 'ask_aaaaaaaa', messageId: 'askm_00000001', amountUsd: 0.75,
    tokens: 100, model: 'claude-opus-5-5', tsMs: +new Date(2026, 7, 5, 11) });
});

test('monthly window: hours × default rate − window spend, equal to the Statistics month tile', () => {
  const budget = budgetStatus(NOW);
  assert.equal(budget.resetPeriod, 'monthly');
  const s = budgetWindowSavings(budget);
  assert.equal(s.windowHumanHours, 15.75, '12.5 (archived) + 3.25; July\'s 40 h stay out');
  assert.equal(budget.windowSpendUsd, 6.5);                   // 4.5 + 1.25 pipeline + 0.75 ask
  assert.equal(s.windowSavedUsd, 544.75);                     // 15.75 × 35 − 6.5
  const tile = getStats({ range: 'month', now: NOW }).totals;
  assert.equal(s.windowHumanHours, tile.humanHours);
  assert.equal(s.windowSavedUsd, tile.savedUsd, 'the sidebar and the Statistics tile must never disagree');
});

test('weekly window: same parity with the Statistics week tile', () => {
  const windowStartMs = costWindowStart(NOW, 'weekly').getTime();
  const budget = { windowStartMs, windowEndMs: costWindowEnd(NOW, 'weekly').getTime(),
    windowSpendUsd: totalWindowSpendUsd(windowStartMs) };
  const s = budgetWindowSavings(budget);
  assert.equal(s.windowHumanHours, 12.5, 'Aug 1 is the week before Mon Aug 3');
  const tile = getStats({ range: 'week', now: NOW }).totals;
  assert.equal(s.windowSavedUsd, tile.savedUsd);
  assert.equal(s.windowSavedUsd, 432.25);                     // 12.5 × 35 − (4.5 + 0.75)
});

test('the stored developer rate prices the hours; an empty window is an honest negative', async () => {
  await setHumanRateUsdPerHour(100);
  try {
    const budget = budgetStatus(NOW);
    assert.equal(budgetWindowSavings(budget).windowSavedUsd, 1568.5);   // 15.75 × 100 − 6.5
    const empty = budgetWindowSavings({ windowStartMs: +new Date(2026, 5, 1),
      windowEndMs: +new Date(2026, 6, 1), windowSpendUsd: 2 });
    assert.deepEqual(empty, { windowHumanHours: 0, windowSavedUsd: -2 });
  } finally {
    await setHumanRateUsdPerHour('');
  }
});
