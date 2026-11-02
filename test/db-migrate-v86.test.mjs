// test/db-migrate-v86.test.mjs — workflow tests, Part 3a (plans/workflow-tests-part3a-plan.md Task 2): an example's project
// and start point, and what a project try records. This rung was v81 on feat/workflow-tests-part3 until dev took 79–83
// (run_groups.name_source, requirements export, the guardrail default, automations, ask_messages.engine) and Parts 1 and 2
// moved to 84 and 85 (test/db-migrate-v84.test.mjs, test/db-migrate-v85.test.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { migrate, SCHEMA_VERSION } from '../src/core/db.mjs';

const cols = (db, t) => db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);
const stamp = (db) => db.prepare('PRAGMA user_version').get().user_version;
const PROJECTS = ['example_id', 'project_key', 'start_sha', 'start_ref', 'start_at', 'start_commit', 'changes', 'changes_sha256',
  'setup_cmd', 'updated_at', 'project_name'];
const TRY_NEW = ['start_commit', 'disk_bytes', 'setup', 'changes'];

/** Every table with its columns (sorted: a repaired column is appended, not in DDL order) and every index name. */
function shape(db) {
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
  const out = {};
  for (const { name } of tables) out[name] = cols(db, name).sort();
  out['#indexes'] = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all().map((r) => r.name);
  return out;
}
const FRESH = (() => { const db = new DatabaseSync(':memory:'); migrate(db); return shape(db); })();
// dev's rungs 79–83 that a DB feat/workflow-tests-part3 stamped 81 never ran (v81 writes a row only, no DDL).
const DEV79_83 = ['ALTER TABLE run_groups DROP COLUMN name_source;',
  'DROP TABLE req_export_setups; DROP TABLE req_export_links;',
  'DROP TABLE automation_rules; DROP TABLE automation_events; DROP TABLE automation_cursors; DROP TABLE automation_deliveries;',
  'ALTER TABLE ask_messages DROP COLUMN engine;'].join(' ');

test('fresh DB: the example projects table and the try columns exist', () => {
  const db = new DatabaseSync(':memory:');
  migrate(db);
  assert.ok(SCHEMA_VERSION >= 86);
  assert.deepEqual(cols(db, 'wf_test_example_projects'), PROJECTS);
  for (const c of TRY_NEW) assert.ok(cols(db, 'wf_test_tries').includes(c), c);
});

test("a DB at Part 2's 85 without them gets them and is stamped current", () => {
  const db = new DatabaseSync(':memory:');
  migrate(db);
  db.exec(`DROP TABLE wf_test_example_projects;
    ${TRY_NEW.map((c) => `ALTER TABLE wf_test_tries DROP COLUMN ${c};`).join('\n')}
    PRAGMA user_version = 85`);
  migrate(db);
  assert.equal(stamp(db), SCHEMA_VERSION);
  assert.deepEqual(cols(db, 'wf_test_example_projects'), PROJECTS);
  for (const c of TRY_NEW) assert.ok(cols(db, 'wf_test_tries').includes(c), c);
});

test('a DB stamped current whose example projects table has no project_name gets it (3a Task 8 review)', () => {
  const db = new DatabaseSync(':memory:');
  migrate(db);
  db.exec(`ALTER TABLE wf_test_example_projects DROP COLUMN project_name; PRAGMA user_version = ${SCHEMA_VERSION}`);
  assert.ok(!cols(db, 'wf_test_example_projects').includes('project_name'));
  migrate(db);
  assert.deepEqual(cols(db, 'wf_test_example_projects'), PROJECTS);
});

test("a DB feat/workflow-tests-part3 stamped 81 (its tables, none of dev's 79–83) reaches the current version complete", () => {
  const db = new DatabaseSync(':memory:');
  migrate(db);
  db.prepare(`INSERT INTO wf_test_example_projects (example_id, project_key, start_sha, start_at, start_commit, updated_at)
    VALUES (1, 'p', 'abc', '2026-10-30T00:00:00Z', 'abc', '2026-10-30T00:00:00Z')`).run();
  db.exec(`ALTER TABLE wf_test_example_projects DROP COLUMN project_name; ${DEV79_83} PRAGMA user_version = 81`);
  migrate(db);
  assert.equal(stamp(db), SCHEMA_VERSION);
  assert.deepEqual(shape(db), FRESH, 'every table, column and index a fresh DB has');
  assert.deepEqual(db.prepare('SELECT example_id, project_key FROM wf_test_example_projects').all().map((r) => ({ ...r })),
    [{ example_id: 1, project_key: 'p' }], 'the pinned starts it already had are kept');
});

test('a DB from before the tests tables (stamped 77) gets the try columns too', () => {
  const db = new DatabaseSync(':memory:');
  migrate(db);
  db.exec('DROP TABLE wf_test_example_projects; DROP TABLE wf_test_tries; PRAGMA user_version = 77');
  migrate(db);
  for (const c of TRY_NEW) assert.ok(cols(db, 'wf_test_tries').includes(c), c);
});
