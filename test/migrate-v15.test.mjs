// test/migrate-v15.test.mjs
//
// v15 adds the cost-limits / archive / PR-persistence storage (spec 2026-08-07):
//   cost_ledger table                       -- append-only per-event spend, NO FK on pipeline_id
//                                              (spend is a permanent financial fact; it must
//                                              survive any row surgery on pipelines)
//   idx_cost_ledger_ts                      -- window sums are ts-ranged reads
//   pipelines.archived_at TEXT              -- soft delete replacing the hard history delete
//   pipelines.cost_cap_override INTEGER     -- per-run "ignore the cap" flag (NOT NULL DEFAULT 0)
//   pipelines.pr_url/pr_number/pr_state/pr_checked_at  -- persisted PR facts
// Like v12-v14 the step is a CONDITIONAL repair (applySchemaV15 = repairSchemaGaps), not a
// plain DDL string: the six columns live in INCREMENTAL_COLUMNS and the table in the
// schemaGaps flags, so an earlier heal on a ladder pass from <12 has ALREADY added them.
// Structure mirrors test/migrate-v14.test.mjs; the self-heal test here drives the real
// on-disk singleton (DROP COLUMN + reopen) rather than an in-memory stamped seed.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { useTempHome } from './helpers/temp-home.mjs';
import { seedPipeline } from './helpers/db-seed.mjs';
import { getDb, _resetForTests } from '../src/core/db.mjs';

useTempHome(after);

const cols = (db, table) =>
  db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);

test('fresh DB lands on user_version 20 with cost_ledger and the six new pipelines columns', () => {
  const db = getDb();
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, 20);
  const ledger = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='cost_ledger'").get();
  assert.ok(ledger, 'cost_ledger exists');
  assert.deepEqual(cols(db, 'cost_ledger'), ['id', 'pipeline_id', 'step_key', 'amount_usd', 'ts']);
  const idx = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='index' AND name='idx_cost_ledger_ts'").get();
  assert.ok(idx, 'idx_cost_ledger_ts exists');
  for (const c of ['archived_at', 'cost_cap_override', 'pr_url', 'pr_number', 'pr_state', 'pr_checked_at']) {
    assert.ok(cols(db, 'pipelines').includes(c), `pipelines.${c} exists`);
  }
});

test('cost_cap_override defaults to 0 and archived_at to NULL on new rows', async () => {
  const { id } = await seedPipeline('/tmp/proj-a', { status: 'done' });
  const row = getDb().prepare(
    'SELECT archived_at, cost_cap_override FROM pipelines WHERE id = ?').get(id);
  assert.equal(row.archived_at, null);
  assert.equal(row.cost_cap_override, 0);
});

test('self-heal: a dropped new column is re-added on reopen (divergent-stamp repair)', () => {
  let db = getDb();
  db.exec('ALTER TABLE pipelines DROP COLUMN pr_checked_at');
  _resetForTests();
  db = getDb();
  assert.ok(cols(db, 'pipelines').includes('pr_checked_at'));
});

test('idempotent double-open: no error, version stays 20', () => {
  getDb();
  _resetForTests();
  const db = getDb();
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, 20);
});
