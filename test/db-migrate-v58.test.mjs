// test/db-migrate-v58.test.mjs — req_starts (plans/requirements-a2-design.md §3).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { migrate, SCHEMA_VERSION } from '../src/core/db.mjs';

const cols = (db, t) => db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);
const COLS = ['id', 'feature_seq', 'version', 'run_id', 'pipeline_id', 'spec_json', 'title', 'ready', 'failing_json',
  'reason', 'workflow_id', 'source_branch', 'started_by', 'started_at'];

test('fresh DB has req_starts', () => {
  const db = new DatabaseSync(':memory:');
  migrate(db);
  assert.ok(SCHEMA_VERSION >= 58);
  assert.deepEqual(cols(db, 'req_starts'), COLS);
});

test('a DB stamped 57 gets req_starts', () => {
  const db = new DatabaseSync(':memory:');
  migrate(db);
  db.exec('DROP TABLE req_starts; PRAGMA user_version = 57');
  migrate(db);
  assert.deepEqual(cols(db, 'req_starts'), COLS);
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION);
});

test('a DB stamped past this version without the table is repaired', () => {
  const db = new DatabaseSync(':memory:');
  migrate(db);
  db.exec(`DROP TABLE req_starts; PRAGMA user_version = ${SCHEMA_VERSION + 1}`);
  migrate(db);
  assert.deepEqual(cols(db, 'req_starts'), COLS);
});
