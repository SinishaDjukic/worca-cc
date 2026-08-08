// test/stats-today.test.mjs
// The "Today" stats range: hourly buckets, active-run attribution (lifespan
// overlap on started_at/updated_at), and a yesterday prev window. Money stays
// exact by cost_ledger.ts.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { useTempHome } from './helpers/temp-home.mjs';
import { seedPipeline } from './helpers/db-seed.mjs';
import { getDb } from '../src/core/db.mjs';
import { getStats } from '../src/core/stats.mjs';
import { recordCostDelta } from '../src/core/cost-budget.mjs';

useTempHome(after);

const NOW = new Date(2026, 7, 6, 15, 0); // Thu 2026-08-06 15:00 local
const iso = (y, m, d, hh = 12, mm = 0) => new Date(y, m - 1, d, hh, mm).toISOString();
// Set BOTH timestamps last: seeding goes through writeState, which stamps
// updated_at with the wall clock.
const setTimes = (id, startedIso, updatedIso) => getDb()
  .prepare('UPDATE pipelines SET started_at = ?, updated_at = ? WHERE id = ?')
  .run(startedIso, updatedIso, id);

let seeded = false;
async function seedDay() {
  if (seeded) return;
  seeded = true;
  // f: started AND finished this morning — plain today run, lands in the 09:00 bar
  const { id: f } = await seedPipeline('/tmp/p', { status: 'done', totalCostUsd: 1, totalActiveMs: 60000 });
  setTimes(f, iso(2026, 8, 6, 9, 0), iso(2026, 8, 6, 9, 30));
  // g: started last night, finished 00:30 today — active BOTH yesterday and today
  const { id: g } = await seedPipeline('/tmp/p', { status: 'done' });
  setTimes(g, iso(2026, 8, 5, 23, 0), iso(2026, 8, 6, 0, 30));
  // h: started 14:00 today, still running — counts in totals, no bar (non-terminal)
  const { id: h } = await seedPipeline('/tmp/p', { status: 'running' });
  setTimes(h, iso(2026, 8, 6, 14, 0), iso(2026, 8, 6, 14, 5));
  // i: started Monday, finished YESTERDAY morning — yesterday only, never today
  const { id: i } = await seedPipeline('/tmp/p', { status: 'done' });
  setTimes(i, iso(2026, 8, 3, 8, 0), iso(2026, 8, 5, 10, 0));
  // ledger: money is exact by event timestamp (ledger-only writes; safe after setTimes)
  recordCostDelta({ pipelineId: f, amountUsd: 0.4, tsMs: +new Date(2026, 7, 6, 9, 15) });
  recordCostDelta({ pipelineId: g, amountUsd: 0.1, tsMs: +new Date(2026, 7, 6, 0, 10) });
  recordCostDelta({ pipelineId: i, amountUsd: 1,   tsMs: +new Date(2026, 7, 5, 10, 0) });
}

test('range=today: hour buckets through now, active attribution, yesterday prev', async () => {
  await seedDay();
  const s = getStats({ range: 'today', now: NOW });
  assert.equal(s.range, 'today');
  assert.equal(s.bucket, 'hour');
  assert.equal(s.windowStartMs, +new Date(2026, 7, 6));
  assert.equal(s.windowEndMs, +new Date(2026, 7, 7));

  // totals: f, g, h were active today; i finished yesterday and stays out
  assert.equal(s.totals.runs, 3);
  assert.equal(s.totals.finished, 2);      // f + g
  assert.equal(s.totals.running, 1);       // h
  assert.equal(s.totals.workedMs, 60000);  // only f carries active ms
  assert.equal(s.totals.spentUsd, 0.5);    // ledger: 0.4 + 0.1 landed today

  // prev = yesterday, same active shape: g (ran through midnight) + i
  assert.equal(s.prev.runs, 2);
  assert.equal(s.prev.finished, 2);
  assert.equal(s.prev.spentUsd, 1);        // i's ledger row; g's $0.10 landed today

  // series: hourly, zero-filled, 00:00 .. 15:00 local inclusive (current partial hour)
  assert.equal(s.series.length, 16);
  assert.equal(s.series[0].bucketStartMs, +new Date(2026, 7, 6, 0));
  assert.equal(s.series[15].bucketStartMs, +new Date(2026, 7, 6, 15));
  // terminal runs land in the hour of their terminal write (updated_at)
  assert.equal(s.series[0].finished, 1);   // g finished 00:30
  assert.equal(s.series[0].spentUsd, 0.1);
  assert.equal(s.series[9].finished, 1);   // f finished 09:30
  assert.equal(s.series[9].spentUsd, 0.4);
  assert.equal(s.series[14].finished, 0);  // h is running: outcomes only in the bars
  // bars reconcile with the KPI tile (D4 invariant)
  assert.equal(s.series.reduce((n, p) => n + p.finished, 0), s.totals.finished);
});

test('today is a valid range; junk still throws RangeError', () => {
  assert.doesNotThrow(() => getStats({ range: 'today', now: NOW }));
  assert.throws(() => getStats({ range: 'yesterday', now: NOW }), RangeError);
});
