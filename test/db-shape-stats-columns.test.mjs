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
