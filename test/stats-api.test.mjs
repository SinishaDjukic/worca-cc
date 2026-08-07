// test/stats-api.test.mjs
// Module half of the statistics surface: src/core/stats.mjs. Seeds a small
// world of runs (one archived — stats deliberately include archived rows) plus
// ledger events, then asserts cohort KPIs, ledger money, prev-window deltas and
// the zero-filled series.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { seedPipeline } from './helpers/db-seed.mjs';
import { getDb } from '../src/core/db.mjs';
import { getStats } from '../src/core/stats.mjs';
import { recordCostDelta } from '../src/core/cost-budget.mjs';

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

const NOW = new Date(2026, 7, 6, 15, 0);          // Thu 2026-08-06 local
const iso = (y, m, d, hh = 12) => new Date(y, m - 1, d, hh).toISOString();
const setStarted = (id, isoTs) =>
  getDb().prepare('UPDATE pipelines SET started_at = ? WHERE id = ?').run(isoTs, id);
const setPr = (id, state) => getDb().prepare(
  "UPDATE pipelines SET pr_url = 'https://github.com/o/r/pull/1', pr_state = ? WHERE id = ?")
  .run(state, id);
const archive = (id) => getDb().prepare(
  'UPDATE pipelines SET archived_at = ? WHERE id = ?').run(new Date().toISOString(), id);

async function seedWorld() {
  // Seeds use Date.toISOString() (millisecond precision) — cohort SQL compares
  // started_at strings against toISOString() bounds, so precision matches.
  // this week (Mon 2026-08-03 .. ): 3 runs — done+merged-PR (archived), stopped, error
  const { id: a } = await seedPipeline('/tmp/p', { status: 'done', totalCostUsd: 1, totalActiveMs: 60000 });
  setStarted(a, iso(2026, 8, 3)); setPr(a, 'MERGED'); archive(a);
  const { id: b } = await seedPipeline('/tmp/p', { status: 'stopped' }); setStarted(b, iso(2026, 8, 4));
  const { id: c } = await seedPipeline('/tmp/p', { status: 'error' });   setStarted(c, iso(2026, 8, 5));
  // previous week: 1 done with open PR
  const { id: d } = await seedPipeline('/tmp/p', { status: 'done', totalCostUsd: 2 });
  setStarted(d, iso(2026, 7, 28)); setPr(d, 'OPEN');
  // paused+interrupted grouping
  const { id: e } = await seedPipeline('/tmp/p', { status: 'interrupted' }); setStarted(e, iso(2026, 8, 3));
  // ledger: $0.75 this week, $2 last week
  recordCostDelta({ pipelineId: a, amountUsd: 0.5,  tsMs: +new Date(2026, 7, 3, 10) });
  recordCostDelta({ pipelineId: b, amountUsd: 0.25, tsMs: +new Date(2026, 7, 5, 10) });
  recordCostDelta({ pipelineId: d, amountUsd: 2,    tsMs: +new Date(2026, 6, 28, 10) });
}

test('range=week: cohort totals incl. archived; ledger money; prev window; daily zero-filled series', async () => {
  await seedWorld();
  const s = getStats({ range: 'week', now: NOW });
  assert.equal(s.bucket, 'day');
  assert.equal(s.windowStartMs, +new Date(2026, 7, 3));
  assert.equal(s.totals.runs, 4);                     // a (archived!), b, c, e
  assert.equal(s.totals.finished, 1);
  assert.equal(s.totals.stopped, 1);
  assert.equal(s.totals.failed, 1);
  assert.equal(s.totals.paused, 1);                   // interrupted groups into paused
  assert.equal(s.totals.prsOpened, 1);                // a
  assert.equal(s.totals.prsMerged, 1);
  assert.equal(s.totals.spentUsd, 0.75);              // ledger this week
  assert.equal(s.prev.runs, 1);                       // d
  assert.equal(s.prev.spentUsd, 2);
  assert.equal(s.prev.prsOpened, 1);
  // series: Mon..Thu (through the current bucket), zero-filled
  assert.equal(s.series.length, 4);
  assert.equal(s.series[0].bucketStartMs, +new Date(2026, 7, 3));
  assert.equal(s.series[0].spentUsd, 0.5);
  assert.equal(s.series[0].finished, 1);
  assert.equal(s.series[1].finished, 0);              // Tue: stopped only
  assert.equal(s.series[1].stopped, 1);
  assert.equal(s.series[2].spentUsd, 0.25);
  assert.ok('budget' in s);
});

test('range=month: daily buckets from the 1st; range=all: monthly buckets + fallback-aware totals', () => {
  const m = getStats({ range: 'month', now: NOW });
  assert.equal(m.bucket, 'day');
  assert.equal(m.windowStartMs, +new Date(2026, 7, 1));
  assert.equal(m.series.length, 6);                   // Aug 1..6
  const all = getStats({ range: 'all', now: NOW });
  assert.equal(all.bucket, 'month');
  assert.equal(all.prev, null);
  assert.equal(all.totals.runs, 5);
  assert.ok(all.totals.spentUsd >= 3);                // pipelines fallback sums (a:1 + d:2)
  assert.ok(all.series.length >= 2);                  // Jul + Aug buckets present
});

test('unknown range throws RangeError', () => {
  assert.throws(() => getStats({ range: 'year', now: NOW }), RangeError);
});
