// test/migrate-v16.test.mjs
//
// v16 backfills the v15 spend ledger from pre-ledger history. v15 created
// cost_ledger empty and only the live orchestrator writes it, so every run that
// finished before the upgrade shows $0 in windowed spend (stats week/month,
// sidebar budget) while History shows its pipelines.total_cost_usd. The step
// inserts ONE synthetic row per costed pipeline that has NO ledger rows at all
// (live-recorded runs would double-count), amount = the same fallback-aware
// figure the stats read (row total, else step sum), ts = the run's start
// (cohort semantics: same week/month bucket as the run), step_key NULL.
// Structure mirrors test/migrate-v15.test.mjs: seed at current version through
// the production writers, stamp user_version back to 15, reopen — the ladder
// runs only the v16 step.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { useTempHome } from './helpers/temp-home.mjs';
import { seedPipeline } from './helpers/db-seed.mjs';
import { getDb, _resetForTests } from '../src/core/db.mjs';
import { getStats } from '../src/core/stats.mjs';

useTempHome(after);

const A_START = '2026-03-10T12:00:00.000Z'; // row-total pipeline
const B_START = '2026-03-11T09:00:00.000Z'; // step-sum fallback pipeline
const D_LEDGER_TS = Date.parse('2026-03-01T12:00:00.000Z'); // pre-existing live row
const E_UPDATED = '2026-03-12T08:00:00.000Z'; // started_at NULL → updated_at fallback

const ids = {};

test('v15 -> v16 backfills cost_ledger from pre-ledger pipeline costs', async () => {
  const db = getDb();

  ids.a = (await seedPipeline('/tmp/proj-bf-a', {
    title: 'row total', status: 'stopped', totalCostUsd: 548.2092,
  })).id;
  ids.b = (await seedPipeline('/tmp/proj-bf-b', {
    title: 'step sum fallback', status: 'stopped', totalCostUsd: 0,
    steps: [
      { key: 'plan', status: 'done', costUsd: 2.5 },
      { key: 'implement#1', status: 'done', costUsd: 1.25 },
    ],
  })).id;
  ids.c = (await seedPipeline('/tmp/proj-bf-c', {
    title: 'zero cost mock', status: 'stopped', totalCostUsd: 0,
  })).id;
  ids.d = (await seedPipeline('/tmp/proj-bf-d', {
    title: 'already live-recorded', status: 'stopped', totalCostUsd: 99,
  })).id;
  ids.e = (await seedPipeline('/tmp/proj-bf-e', {
    title: 'legacy import without started_at', status: 'stopped', totalCostUsd: 13.6688,
  })).id;

  const setTimes = db.prepare('UPDATE pipelines SET started_at = ?, updated_at = ? WHERE id = ?');
  setTimes.run(A_START, A_START, ids.a);
  setTimes.run(B_START, B_START, ids.b);
  setTimes.run(B_START, B_START, ids.c);
  setTimes.run(A_START, A_START, ids.d);
  setTimes.run(null, E_UPDATED, ids.e);

  // D already has a live-recorded ledger row — backfill must not touch it.
  db.prepare('INSERT INTO cost_ledger (pipeline_id, step_key, amount_usd, ts) VALUES (?, ?, ?, ?)')
    .run(ids.d, 'plan', 5, D_LEDGER_TS);

  // Rewind the stamp: the reopened ladder must run exactly the v16 step.
  db.exec('PRAGMA user_version = 15');
  _resetForTests();
  const db2 = getDb();

  assert.equal(db2.prepare('PRAGMA user_version').get().user_version, 21);

  const rowsFor = db2.prepare(
    'SELECT step_key, amount_usd, ts FROM cost_ledger WHERE pipeline_id = ? ORDER BY id');

  const a = rowsFor.all(ids.a);
  assert.equal(a.length, 1, 'one synthetic row for the row-total pipeline');
  assert.deepEqual({ ...a[0] }, { step_key: null, amount_usd: 548.2092, ts: Date.parse(A_START) });

  const b = rowsFor.all(ids.b);
  assert.equal(b.length, 1, 'one synthetic row from the per-step sum');
  assert.deepEqual({ ...b[0] }, { step_key: null, amount_usd: 3.75, ts: Date.parse(B_START) });

  assert.equal(rowsFor.all(ids.c).length, 0, 'zero-cost run gets no ledger row');

  const d = rowsFor.all(ids.d);
  assert.equal(d.length, 1, 'live-recorded pipeline is left untouched (no double count)');
  assert.deepEqual({ ...d[0] }, { step_key: 'plan', amount_usd: 5, ts: D_LEDGER_TS });

  const e = rowsFor.all(ids.e);
  assert.equal(e.length, 1, 'started_at NULL falls back to updated_at');
  assert.deepEqual({ ...e[0] }, { step_key: null, amount_usd: 13.6688, ts: Date.parse(E_UPDATED) });
});

test('reopen after backfill is a no-op: no duplicate synthetic rows', () => {
  _resetForTests();
  const db = getDb();
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, 21);
  const { n } = db.prepare('SELECT COUNT(*) AS n FROM cost_ledger').get();
  assert.equal(n, 4, 'still exactly A + B + E + D’s pre-existing row');
});

test('windowed stats see the backfilled spend', () => {
  // Local March 2026 window contains every fixture ts for any UTC offset.
  const now = new Date(2026, 2, 20, 12, 0, 0);
  const { totals } = getStats({ range: 'month', now });
  assert.equal(totals.spentUsd, 570.628, 'A 548.2092 + B 3.75 + E 13.6688 + D 5');
});
