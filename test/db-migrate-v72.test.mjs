// test/db-migrate-v72.test.mjs — req_starts (plans/requirements-a2-design.md §3).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { migrate, SCHEMA_VERSION } from '../src/core/db.mjs';

const cols = (db, t) => db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);
const COLS = ['id', 'feature_seq', 'version', 'run_id', 'pipeline_id', 'spec_json', 'title', 'ready', 'failing_json',
  'reason', 'workflow_id', 'source_branch', 'started_by', 'started_at'];
const version = (db) => db.prepare('PRAGMA user_version').get().user_version;

test('fresh DB has req_starts', () => {
  const db = new DatabaseSync(':memory:');
  migrate(db);
  assert.ok(SCHEMA_VERSION >= 72);
  assert.deepEqual(cols(db, 'req_starts'), COLS);
});

test('a DB stamped 71 gets req_starts', () => {
  const db = new DatabaseSync(':memory:');
  migrate(db);
  db.exec('DROP TABLE req_starts; PRAGMA user_version = 71');
  migrate(db);
  assert.deepEqual(cols(db, 'req_starts'), COLS);
  assert.equal(version(db), SCHEMA_VERSION);
});

test('a DB stamped past this version without the table is repaired', () => {
  const db = new DatabaseSync(':memory:');
  migrate(db);
  db.exec(`DROP TABLE req_starts; PRAGMA user_version = ${SCHEMA_VERSION + 1}`);
  migrate(db);
  assert.deepEqual(cols(db, 'req_starts'), COLS);
});

const hasIndex = (db, name) => db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type='index' AND name=?").get(name).n === 1;

test('req_starts has an index on pipeline_id (startByPipelineId), fresh and on a DB already at this version', () => {
  const db = new DatabaseSync(':memory:');
  migrate(db);
  assert.ok(hasIndex(db, 'req_starts_pipeline'), 'a fresh DB');
  const plan = db.prepare("EXPLAIN QUERY PLAN SELECT * FROM req_starts WHERE pipeline_id = 'x'").all().map((r) => r.detail).join(' ');
  assert.match(plan, /req_starts_pipeline/);
  // a dev DB that got req_starts before the index existed: the reconcile path adds it
  db.exec('DROP INDEX req_starts_pipeline');
  migrate(db);
  assert.ok(hasIndex(db, 'req_starts_pipeline'), 'reconciled on a DB stamped current');
});
