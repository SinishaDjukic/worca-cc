// test/db-shape-stats-columns.test.mjs — Shaper D28: pipelines.shape_stats + run_size are INCREMENTAL_COLUMNS,
// healed on every open (no SCHEMA_VERSION of their own).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { migrate, SCHEMA_VERSION } from '../src/core/db.mjs';

const cols = (db) => db.prepare('PRAGMA table_info(pipelines)').all().map((c) => c.name);

test('pipelines has shape_stats and run_size on a fresh DB and on a current DB missing them', () => {
  const fresh = new DatabaseSync(':memory:');
  migrate(fresh);
  assert.ok(cols(fresh).includes('shape_stats') && cols(fresh).includes('run_size'));

  const db = new DatabaseSync(':memory:');
  migrate(db);
  db.exec('ALTER TABLE pipelines DROP COLUMN shape_stats; ALTER TABLE pipelines DROP COLUMN run_size');
  migrate(db);                                   // fast path: reconcileSchema heals the gap
  assert.ok(cols(db).includes('shape_stats') && cols(db).includes('run_size'));
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION);
});

// #990 slice 6: pipelines.review_stats (a run's per-role review counts) is healed the same way, with no version bump
// (#990's own step is v84; #1145 and #1142 took v85, #1142 v86, PR-when-done #1156 v87 and Requirements A6.1 v88 after it,
// and feat/workflow-tests' rungs 89–91 sit above them).
test('pipelines has review_stats on a fresh DB and on a current DB missing it; the stamp stays SCHEMA_VERSION', () => {
  assert.ok(SCHEMA_VERSION >= 84);
  const fresh = new DatabaseSync(':memory:');
  migrate(fresh);
  assert.ok(cols(fresh).includes('review_stats'));

  const db = new DatabaseSync(':memory:');
  migrate(db);
  db.exec('ALTER TABLE pipelines DROP COLUMN review_stats');
  migrate(db);
  assert.ok(cols(db).includes('review_stats'));
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION);
});
