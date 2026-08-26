// test/cost-budget.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { seedPipeline } from './helpers/db-seed.mjs';
import {
  costWindowStart, costWindowEnd, recordCostDelta, windowedSpendUsd,
  allTimeTotals, readCostCapOverride, setCostCapOverride, budgetStatus, roundUsd,
  recordAskCostDelta, askWindowedSpendUsd, totalWindowSpendUsd,
} from '../src/core/cost-budget.mjs';
import { setTotalCostLimitUsd, setPipelineCostLimitUsd, setCostLimitResetPeriod }
  from '../src/core/settings.mjs';
import { getDb } from '../src/core/db.mjs';

useTempHome(after); // DB sandbox (WORCA_HOME)

// settings sandbox: settingsFile() resolves under HOME, not WORCA_HOME.
// WORCA_HOME (set by useTempHome / npm test) is deliberately left untouched
// so the DB stays pinned to the temp home for the whole suite.
let sandboxHome;
const prevEnv = {};
before(async () => {
  sandboxHome = await mkdtemp(join(tmpdir(), 'worca-cost-'));
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

const local = (y, m, d, hh = 0, mm = 0) => new Date(y, m - 1, d, hh, mm);

test('costWindowStart weekly: Monday 00:00 local, Sunday belongs to the prior Monday', () => {
  // Thu 2026-08-06 -> Mon 2026-08-03
  assert.equal(+costWindowStart(local(2026, 8, 6, 15, 30), 'weekly'), +local(2026, 8, 3));
  // Mon itself -> same Monday
  assert.equal(+costWindowStart(local(2026, 8, 3, 0, 0), 'weekly'), +local(2026, 8, 3));
  // Sun 2026-08-09 -> Mon 2026-08-03
  assert.equal(+costWindowStart(local(2026, 8, 9, 23, 59), 'weekly'), +local(2026, 8, 3));
  // Week spanning a month boundary: Tue 2026-09-01 -> Mon 2026-08-31
  assert.equal(+costWindowStart(local(2026, 9, 1), 'weekly'), +local(2026, 8, 31));
  // Year rollover: Fri 2027-01-01 -> Mon 2026-12-28
  assert.equal(+costWindowStart(local(2027, 1, 1), 'weekly'), +local(2026, 12, 28));
});

test('costWindowStart monthly: the 1st 00:00 local; leap Feb; year rollover end', () => {
  assert.equal(+costWindowStart(local(2026, 8, 31, 23, 59), 'monthly'), +local(2026, 8, 1));
  assert.equal(+costWindowStart(local(2028, 2, 29), 'monthly'), +local(2028, 2, 1)); // leap
  assert.equal(+costWindowEnd(local(2026, 12, 15), 'monthly').getTime(), +local(2027, 1, 1));
});

test('costWindowEnd weekly: next Monday; DST-week length is calendar-correct', () => {
  assert.equal(+costWindowEnd(local(2026, 8, 6), 'weekly'), +local(2026, 8, 10));
  // DST transition weeks still start/end at local midnight (calendar constructors)
  const s = costWindowStart(local(2026, 3, 12), 'weekly');   // week of 2026-03-09
  const e = costWindowEnd(local(2026, 3, 12), 'weekly');
  assert.equal(s.getHours(), 0); assert.equal(e.getHours(), 0);
  assert.equal(e.getDate() - s.getDate() === 7 || e.getMonth() !== s.getMonth(), true);
});

test('recordCostDelta appends raw rows; skips non-positive and missing pipelineId', () => {
  recordCostDelta({ pipelineId: 'p1', stepKey: 'plan', amountUsd: 0.123456, tsMs: 1000 });
  recordCostDelta({ pipelineId: 'p1', amountUsd: 0, tsMs: 1001 });        // skipped
  recordCostDelta({ pipelineId: 'p1', amountUsd: -1, tsMs: 1002 });       // skipped
  recordCostDelta({ pipelineId: '', amountUsd: 5, tsMs: 1003 });          // skipped
  const rows = getDb().prepare('SELECT * FROM cost_ledger ORDER BY id').all();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].pipeline_id, 'p1');
  assert.equal(rows[0].step_key, 'plan');
  assert.equal(rows[0].amount_usd, 0.123456); // raw, unrounded
  assert.equal(rows[0].ts, 1000);
});

test('windowedSpendUsd sums ts >= windowStart inclusive, rounded to 4dp', () => {
  getDb().exec('DELETE FROM cost_ledger');
  recordCostDelta({ pipelineId: 'a', amountUsd: 0.00004, tsMs: 5000 }); // at boundary
  recordCostDelta({ pipelineId: 'b', amountUsd: 1.00003, tsMs: 6000 });
  recordCostDelta({ pipelineId: 'c', amountUsd: 9,       tsMs: 4999 }); // before boundary
  assert.equal(windowedSpendUsd(5000), 1.0001); // 1.00007 -> 4dp
});

test('override read/write', async () => {
  const { id } = await seedPipeline('/tmp/proj-a', { status: 'done' });
  assert.equal(readCostCapOverride(id), false);
  setCostCapOverride(id);
  assert.equal(readCostCapOverride(id), true);
  assert.equal(readCostCapOverride('nope'), false);
});

test('budgetStatus: unset limits -> not blocked, nulls; set -> thresholds at/over', async () => {
  getDb().exec('DELETE FROM cost_ledger');
  let b = budgetStatus(local(2026, 8, 6));
  assert.equal(b.totalLimitUsd, null);
  assert.equal(b.blocked, false);
  assert.equal(b.remainingUsd, null);
  assert.equal(b.resetPeriod, 'monthly');
  assert.equal(b.windowStartMs, +local(2026, 8, 1));
  assert.equal(b.windowEndMs, +local(2026, 9, 1));
  assert.equal(b.msUntilReset, +local(2026, 9, 1) - +local(2026, 8, 6));

  await setTotalCostLimitUsd(10);
  await setPipelineCostLimitUsd(3);
  await setCostLimitResetPeriod('weekly');
  recordCostDelta({ pipelineId: 'x', amountUsd: 9.5, tsMs: +local(2026, 8, 4) });
  b = budgetStatus(local(2026, 8, 6));
  assert.equal(b.pipelineLimitUsd, 3);
  assert.equal(b.resetPeriod, 'weekly');
  assert.equal(b.windowStartMs, +local(2026, 8, 3));
  assert.equal(b.windowSpendUsd, 9.5);
  assert.equal(b.remainingUsd, 0.5);
  assert.equal(b.blocked, false);
  recordCostDelta({ pipelineId: 'x', amountUsd: 0.5, tsMs: +local(2026, 8, 5) });
  b = budgetStatus(local(2026, 8, 6));
  assert.equal(b.blocked, true);   // at the limit counts as reached
  assert.equal(b.remainingUsd, 0);
  // spend before the weekly window start does not count
  recordCostDelta({ pipelineId: 'x', amountUsd: 100, tsMs: +local(2026, 8, 2) });
  assert.equal(budgetStatus(local(2026, 8, 6)).windowSpendUsd, 10);
  await setTotalCostLimitUsd('');  await setPipelineCostLimitUsd('');
  await setCostLimitResetPeriod('');
});

test('allTimeTotals: fallback-aware over pipelines (+archived later tasks)', async () => {
  // seedPipeline persists total_cost_usd/total_active_ms via writeState's UPDATE arm
  await seedPipeline('/tmp/proj-a', { status: 'done', totalCostUsd: 1.25, totalActiveMs: 60000 });
  const t = allTimeTotals();
  assert.ok(t.spendUsd >= 1.25);
  assert.ok(t.activeMs >= 60000);
});

// The CASE arm that reads pipeline_steps fires only when the ROW total is 0 —
// a run interrupted before its rollup, or a legacy import. Asserted as a DELTA
// because earlier tests in this suite leave rows behind.
test('allTimeTotals falls back to per-step sums when the row totals are 0', async () => {
  const before = allTimeTotals();
  await seedPipeline('/tmp/proj-fallback', {
    status: 'interrupted', totalCostUsd: 0, totalActiveMs: 0,
    steps: [
      { key: 'plan', costUsd: 0.5, activeMs: 1000 },
      { key: 'code', costUsd: 0.25, activeMs: 2000 },
    ],
  });
  const after = allTimeTotals();
  assert.equal(roundUsd(after.spendUsd - before.spendUsd), 0.75, 'step costs stand in for a $0 row');
  assert.equal(after.activeMs - before.activeMs, 3000, 'step active time stands in too');
});

test('recordAskCostDelta appends raw rows; skips null/zero/negative and missing threadId', () => {
  getDb().exec('DELETE FROM ask_cost_ledger');
  recordAskCostDelta({ threadId: 'ask_00000001', messageId: 'askm_00000001',
    amountUsd: 0.123456, tokens: 1500, model: 'claude-opus-5', tsMs: 2000 });
  recordAskCostDelta({ threadId: 'ask_00000001', amountUsd: null, tsMs: 2001 }); // pre-result turn
  recordAskCostDelta({ threadId: 'ask_00000001', amountUsd: 0, tsMs: 2002 });    // mock
  recordAskCostDelta({ threadId: 'ask_00000001', amountUsd: -1, tsMs: 2003 });
  recordAskCostDelta({ threadId: '', amountUsd: 5, tsMs: 2004 });
  const rows = getDb().prepare('SELECT * FROM ask_cost_ledger ORDER BY id').all();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].thread_id, 'ask_00000001');
  assert.equal(rows[0].message_id, 'askm_00000001');
  assert.equal(rows[0].amount_usd, 0.123456); // raw, unrounded
  assert.equal(rows[0].tokens, 1500);
  assert.equal(rows[0].model, 'claude-opus-5');
  assert.equal(rows[0].ts, 2000);
});

test('askWindowedSpendUsd: open-ended and bounded (toMs exclusive), 4dp rounding', () => {
  getDb().exec('DELETE FROM ask_cost_ledger');
  recordAskCostDelta({ threadId: 'ask_a', amountUsd: 0.11111, tsMs: 1000 });
  recordAskCostDelta({ threadId: 'ask_b', amountUsd: 0.2, tsMs: 2000 });
  assert.equal(askWindowedSpendUsd(1000), roundUsd(0.31111));
  assert.equal(askWindowedSpendUsd(1500), 0.2);
  assert.equal(askWindowedSpendUsd(1000, 2000), 0.1111, 'toMs is exclusive');
  assert.equal(askWindowedSpendUsd(3000), 0);
});

test('totalWindowSpendUsd + budgetStatus combine both ledgers; ask growth flips the block', async () => {
  getDb().exec('DELETE FROM cost_ledger');
  getDb().exec('DELETE FROM ask_cost_ledger');
  const now = local(2026, 8, 6, 12);
  await setCostLimitResetPeriod('weekly');
  await setTotalCostLimitUsd(1);
  const winStart = +costWindowStart(now, 'weekly');
  recordCostDelta({ pipelineId: 'p-combined', amountUsd: 0.4, tsMs: winStart + 1000 });
  recordAskCostDelta({ threadId: 'ask_a', amountUsd: 0.3, tsMs: winStart + 2000 });
  recordAskCostDelta({ threadId: 'ask_b', amountUsd: 0.9, tsMs: winStart - 1000 }); // previous window
  assert.equal(totalWindowSpendUsd(winStart), 0.7);
  const b = budgetStatus(now);
  assert.equal(b.windowSpendUsd, 0.7);
  assert.equal(b.blocked, false);
  assert.equal(b.remainingUsd, 0.3);
  recordAskCostDelta({ threadId: 'ask_a', amountUsd: 0.5, tsMs: winStart + 3000 });
  const b2 = budgetStatus(now);
  assert.equal(b2.windowSpendUsd, 1.2);
  assert.equal(b2.blocked, true, 'chat spend counts toward the total-limit block (D3)');
  // allTimeSpendUsd = pipelines-table sums + EVERY ask row (0.3 + 0.9 + 0.5)
  assert.equal(b2.allTimeSpendUsd, roundUsd(allTimeTotals().spendUsd + 1.7),
    'every ask row counts in all-time spend, window or not');
  await setTotalCostLimitUsd('');
  await setCostLimitResetPeriod('');
});
