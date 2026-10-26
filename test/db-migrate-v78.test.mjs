// test/db-migrate-v78.test.mjs — workflow tests, Part 2 (plans/workflow-tests-part2-plan.md Task 2): five tables + pipelines.is_test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { migrate, SCHEMA_VERSION } from '../src/core/db.mjs';

const cols = (db, t) => db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);
const stamp = (db) => db.prepare('PRAGMA user_version').get().user_version;
const TABLES = {
  wf_test_examples: ['id', 'workflow_id', 'name', 'request', 'answers', 'otherwise', 'basics', 'checks', 'tries', 'note',
    'from_pipeline', 'from_use', 'from_verdict', 'created_by', 'created_at', 'updated_at'],
  wf_test_example_files: ['example_id', 'name', 'data', 'sha256', 'size'],
  wf_test_runs: ['id', 'workflow_id', 'kind', 'a_use', 'b_use', 'a_fp', 'b_fp', 'example_ids', 'tries', 'quick', 'cap_usd',
    'connectors', 'status', 'stop_reason', 'stop_detail', 'started_by', 'created_at', 'finished_at'],
  wf_test_tries: ['id', 'run_id', 'workflow_id', 'example_id', 'use_ref', 'fp', 'example_fp', 'try_no', 'mock', 'connectors', 'status',
    'run_key', 'pipeline_id', 'verdict', 'cost_usd', 'started_at', 'finished_at'],
  wf_test_run_tries: ['run_id', 'try_id', 'side'],
};

test('fresh DB: the workflow test tables exist and pipelines has is_test', () => {
  const db = new DatabaseSync(':memory:');
  migrate(db);
  assert.ok(SCHEMA_VERSION >= 78);
  for (const [t, want] of Object.entries(TABLES)) assert.deepEqual(cols(db, t), want, t);
  assert.ok(cols(db, 'pipelines').includes('is_test'));
});

test('a DB stamped 77 without them gets them all and is stamped current', () => {
  const db = new DatabaseSync(':memory:');
  migrate(db);
  db.exec(`ALTER TABLE pipelines DROP COLUMN is_test;
    ${Object.keys(TABLES).map((t) => `DROP TABLE ${t};`).join('\n')}
    PRAGMA user_version = 77`);
  migrate(db);
  assert.equal(stamp(db), SCHEMA_VERSION);
  for (const [t, want] of Object.entries(TABLES)) assert.deepEqual(cols(db, t), want, t);
  assert.ok(cols(db, 'pipelines').includes('is_test'));
});

test('a try is linked to a run at most once', () => {
  const db = new DatabaseSync(':memory:');
  migrate(db);
  const link = db.prepare("INSERT INTO wf_test_run_tries (run_id, try_id, side) VALUES (1, 7, 'b')");
  link.run();
  assert.throws(() => link.run(), /UNIQUE|PRIMARY/);
});
