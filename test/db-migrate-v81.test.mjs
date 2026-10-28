// test/db-migrate-v81.test.mjs — workflow tests, Part 3a (plans/workflow-tests-part3a-plan.md Task 2): an example's project
// and start point, and what a project try records.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { migrate, SCHEMA_VERSION } from '../src/core/db.mjs';

const cols = (db, t) => db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);
const stamp = (db) => db.prepare('PRAGMA user_version').get().user_version;
const PROJECTS = ['example_id', 'project_key', 'start_sha', 'start_ref', 'start_at', 'start_commit', 'changes', 'changes_sha256',
  'setup_cmd', 'updated_at'];
const TRY_NEW = ['start_commit', 'disk_bytes', 'setup', 'changes'];

test('fresh DB: the example projects table and the try columns exist', () => {
  const db = new DatabaseSync(':memory:');
  migrate(db);
  assert.ok(SCHEMA_VERSION >= 81);
  assert.deepEqual(cols(db, 'wf_test_example_projects'), PROJECTS);
  for (const c of TRY_NEW) assert.ok(cols(db, 'wf_test_tries').includes(c), c);
});

test('a DB stamped 80 without them gets them and is stamped current', () => {
  const db = new DatabaseSync(':memory:');
  migrate(db);
  db.exec(`DROP TABLE wf_test_example_projects;
    ${TRY_NEW.map((c) => `ALTER TABLE wf_test_tries DROP COLUMN ${c};`).join('\n')}
    PRAGMA user_version = 80`);
  migrate(db);
  assert.equal(stamp(db), SCHEMA_VERSION);
  assert.deepEqual(cols(db, 'wf_test_example_projects'), PROJECTS);
  for (const c of TRY_NEW) assert.ok(cols(db, 'wf_test_tries').includes(c), c);
});

test('a DB from before the tests tables (stamped 77) gets the try columns too', () => {
  const db = new DatabaseSync(':memory:');
  migrate(db);
  db.exec('DROP TABLE wf_test_example_projects; DROP TABLE wf_test_tries; PRAGMA user_version = 77');
  migrate(db);
  for (const c of TRY_NEW) assert.ok(cols(db, 'wf_test_tries').includes(c), c);
});
