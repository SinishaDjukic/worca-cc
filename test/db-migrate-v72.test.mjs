// test/db-migrate-v72.test.mjs — req_starts (plans/requirements-a2-design.md §3).
// Was v58 before the merge with dev (upstream's own v58 is Shaper's); renumbered to v72.
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

test('a DB stamped 58 by the pre-merge numbering (requirements + req_starts, no Shaper) reaches the current version with both', () => {
  const db = new DatabaseSync(':memory:');
  migrate(db);
  // the old local v58 had the requirements tables and req_starts, and none of upstream's 57+ (Shaper, run tags, ...)
  db.exec(`DROP TABLE shape_feature_notes; DROP TABLE shape_plans; DROP TABLE shape_feature_slices; DROP TABLE shape_features;
    DROP TABLE run_tag_events; DROP TABLE run_tags; PRAGMA user_version = 58`);
  db.prepare(`INSERT INTO req_starts (feature_seq, version, run_id, spec_json, title, ready, started_at)
    VALUES (1, 1, 'r1', '{}', 'kept', 1, 'now')`).run();
  migrate(db);
  assert.equal(version(db), SCHEMA_VERSION);
  assert.deepEqual(cols(db, 'req_starts'), COLS);
  for (const t of ['req_features', 'shape_features', 'shape_feature_slices', 'shape_plans', 'shape_feature_notes', 'run_tags', 'run_tag_events']) {
    assert.ok(cols(db, t).length, `${t} exists`);
  }
  assert.ok(cols(db, 'shape_feature_slices').includes('draft_pr_url'), 'the Shaper v58 column');
  assert.equal(db.prepare('SELECT title FROM req_starts').get().title, 'kept');
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
