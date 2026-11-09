// test/db-migrate-v91.test.mjs — workflow tests, Part 3a (plans/workflow-tests-part3a-plan.md Task 2): an example's project
// and start point, and what a project try records. This rung was v81 on feat/workflow-tests-part3 until dev took 79–83
// (run_groups.name_source, requirements export, the guardrail default, automations, ask_messages.engine) and Parts 1 and 2
// moved to 84 and 85, then v86 until dev took 84 (config_workflow_nodes.roles, test/db-migrate-v84.test.mjs) and Parts 1
// and 2 moved to 85 and 86, then v87 until dev took 85 and 86 (the freeform chat tables, req_features.early_start_reason,
// test/db-migrate-v85.test.mjs, and chat_conversations.header_new_off) and Parts 1 and 2 moved to 87 and 88, then v89 until
// dev took 87 and 88 (the PR-when-done columns, test/db-migrate-v87.test.mjs, and A6.1's req_export_links.origin /
// req_attachments.fetch_json, test/db-migrate-v88.test.mjs) and Parts 1 and 2 moved to 89 and 90
// (test/db-migrate-v89.test.mjs, test/db-migrate-v90.test.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { migrate, SCHEMA_VERSION } from '../src/core/db.mjs';

const cols = (db, t) => db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);
const stamp = (db) => db.prepare('PRAGMA user_version').get().user_version;
const PROJECTS = ['example_id', 'project_key', 'start_sha', 'start_ref', 'start_at', 'start_commit', 'changes', 'changes_sha256',
  'setup_cmd', 'updated_at', 'project_name'];
const TRY_NEW = ['start_commit', 'disk_bytes', 'setup', 'changes'];
const CHAT = ['chat_conversations', 'chat_controls', 'chat_deliveries', 'chat_inbound_seen'];

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
// dev's rungs 87 (PR-when-done) and 88 (A6.1) that a DB this branch stamped 89 or below never ran. Every set below that
// drops req_export_links puts this first (it drops a column of it).
const DEV87_88 = 'ALTER TABLE pipelines DROP COLUMN pr_auto; ALTER TABLE workspaces DROP COLUMN settings_json; '
  + 'ALTER TABLE shape_features DROP COLUMN pr_open; ALTER TABLE shape_features DROP COLUMN pr_slices; '
  + 'ALTER TABLE shape_features DROP COLUMN pr_source; ALTER TABLE shape_features DROP COLUMN pr_outcome; '
  + 'ALTER TABLE req_export_links DROP COLUMN origin; ALTER TABLE req_attachments DROP COLUMN fetch_json;';
// dev's rungs 85 and 86 (the freeform chat tables, with header_new_off, and req_features.early_start_reason) that a DB this
// branch stamped 87 or below never ran.
const DEV85_86 = 'DROP TABLE chat_controls; DROP TABLE chat_deliveries; DROP TABLE chat_inbound_seen; DROP TABLE chat_conversations; '
  + 'ALTER TABLE req_features DROP COLUMN early_start_reason;';
// dev's rung 84 (#990, with pipelines.review_stats, which has no rung of its own) that a DB this branch stamped 86 or below
// never ran.
const DEV84 = 'ALTER TABLE config_workflow_nodes DROP COLUMN roles; ALTER TABLE pipelines DROP COLUMN review_stats;';
// dev's rungs 79–88 that a DB feat/workflow-tests-part3 stamped 81 never ran (v81 writes a row only, no DDL).
const DEV79_88 = [DEV87_88, 'ALTER TABLE run_groups DROP COLUMN name_source;',
  'DROP TABLE req_export_setups; DROP TABLE req_export_links;',
  'DROP TABLE automation_rules; DROP TABLE automation_events; DROP TABLE automation_cursors; DROP TABLE automation_deliveries;',
  'ALTER TABLE ask_messages DROP COLUMN engine;', DEV84, DEV85_86].join(' ');
const NO_3A = `DROP TABLE wf_test_example_projects;
    ${TRY_NEW.map((c) => `ALTER TABLE wf_test_tries DROP COLUMN ${c};`).join('\n')}`;
const pinStart = (db) => db.prepare(`INSERT INTO wf_test_example_projects (example_id, project_key, start_sha, start_at, start_commit, updated_at)
    VALUES (1, 'p', 'abc', '2026-10-30T00:00:00Z', 'abc', '2026-10-30T00:00:00Z')`).run();
const keptStarts = (db) => db.prepare('SELECT example_id, project_key FROM wf_test_example_projects').all().map((r) => ({ ...r }));
function assertDev85To86(db) {
  for (const t of CHAT) assert.ok(cols(db, t).length, `${t} (v85)`);
  assert.ok(cols(db, 'req_features').includes('early_start_reason'), 'req_features.early_start_reason (v85)');
  assert.ok(cols(db, 'chat_conversations').includes('header_new_off'), 'chat_conversations.header_new_off (v86)');
}
function assertDev87To88(db) {
  assert.ok(cols(db, 'pipelines').includes('pr_auto'), 'pipelines.pr_auto (v87)');
  assert.ok(cols(db, 'workspaces').includes('settings_json'), 'workspaces.settings_json (v87)');
  for (const c of ['pr_open', 'pr_slices', 'pr_source', 'pr_outcome']) assert.ok(cols(db, 'shape_features').includes(c), `shape_features.${c} (v87)`);
  assert.ok(cols(db, 'req_export_links').includes('origin'), 'req_export_links.origin (v88)');
  assert.ok(cols(db, 'req_attachments').includes('fetch_json'), 'req_attachments.fetch_json (v88)');
}

test('fresh DB: the example projects table and the try columns exist', () => {
  const db = new DatabaseSync(':memory:');
  migrate(db);
  assert.ok(SCHEMA_VERSION >= 91);
  assert.deepEqual(cols(db, 'wf_test_example_projects'), PROJECTS);
  for (const c of TRY_NEW) assert.ok(cols(db, 'wf_test_tries').includes(c), c);
});

test("a DB at Part 2's 90 without them gets them and is stamped current", () => {
  const db = new DatabaseSync(':memory:');
  migrate(db);
  db.exec(`${NO_3A}
    PRAGMA user_version = 90`);
  migrate(db);
  assert.equal(stamp(db), SCHEMA_VERSION);
  assert.deepEqual(cols(db, 'wf_test_example_projects'), PROJECTS);
  for (const c of TRY_NEW) assert.ok(cols(db, 'wf_test_tries').includes(c), c);
});

test("a DB at Part 2's 88 (none of dev's 87–88, no 3a tables or columns) reaches the current version complete", () => {
  const db = new DatabaseSync(':memory:');
  migrate(db);
  db.exec(`${NO_3A}
    ${DEV87_88} PRAGMA user_version = 88`);
  migrate(db);
  assert.equal(stamp(db), SCHEMA_VERSION);
  assertDev87To88(db);
  assert.deepEqual(shape(db), FRESH, 'every table, column and index a fresh DB has');
});

test("a DB at Part 2's 86 (none of dev's 85–88, no 3a tables or columns) reaches the current version complete", () => {
  const db = new DatabaseSync(':memory:');
  migrate(db);
  db.exec(`${NO_3A}
    ${DEV87_88} ${DEV85_86} PRAGMA user_version = 86`);
  migrate(db);
  assert.equal(stamp(db), SCHEMA_VERSION);
  assertDev85To86(db);
  assertDev87To88(db);
  assert.deepEqual(shape(db), FRESH, 'every table, column and index a fresh DB has');
});

test("a DB at Part 2's 85 (none of dev's 84–88, no 3a tables or columns) reaches the current version complete", () => {
  const db = new DatabaseSync(':memory:');
  migrate(db);
  db.exec(`${NO_3A}
    ${DEV87_88} ${DEV84} ${DEV85_86} PRAGMA user_version = 85`);
  migrate(db);
  assert.equal(stamp(db), SCHEMA_VERSION);
  assert.deepEqual(shape(db), FRESH, 'every table, column and index a fresh DB has');
});

test("a DB this branch stamped 89 (its tables, none of dev's 87–88) reaches the current version complete", () => {
  const db = new DatabaseSync(':memory:');
  migrate(db);
  pinStart(db);
  db.exec(`${DEV87_88} PRAGMA user_version = 89`);
  migrate(db);
  assert.equal(stamp(db), SCHEMA_VERSION);
  assertDev87To88(db);
  assert.deepEqual(shape(db), FRESH, 'every table, column and index a fresh DB has');
  assert.deepEqual(keptStarts(db), [{ example_id: 1, project_key: 'p' }], 'the pinned starts it already had are kept');
});

test("a DB this branch stamped 87 (its tables, none of dev's 85–88) reaches the current version complete", () => {
  const db = new DatabaseSync(':memory:');
  migrate(db);
  pinStart(db);
  db.exec(`${DEV87_88} ${DEV85_86} PRAGMA user_version = 87`);
  migrate(db);
  assert.equal(stamp(db), SCHEMA_VERSION);
  assertDev85To86(db);
  assertDev87To88(db);
  assert.deepEqual(shape(db), FRESH, 'every table, column and index a fresh DB has');
  assert.deepEqual(keptStarts(db), [{ example_id: 1, project_key: 'p' }], 'the pinned starts it already had are kept');
});

test("a DB this branch stamped 86 (its tables, none of dev's 84–88) reaches the current version complete", () => {
  const db = new DatabaseSync(':memory:');
  migrate(db);
  pinStart(db);
  db.exec(`${DEV87_88} ${DEV84} ${DEV85_86} PRAGMA user_version = 86`);
  migrate(db);
  assert.equal(stamp(db), SCHEMA_VERSION);
  assert.ok(cols(db, 'config_workflow_nodes').includes('roles'), 'config_workflow_nodes.roles (v84)');
  assert.ok(cols(db, 'pipelines').includes('review_stats'), 'pipelines.review_stats (with v84)');
  assertDev85To86(db);
  assertDev87To88(db);
  assert.deepEqual(shape(db), FRESH, 'every table, column and index a fresh DB has');
  assert.deepEqual(keptStarts(db), [{ example_id: 1, project_key: 'p' }], 'the pinned starts it already had are kept');
});

test('a DB stamped current whose example projects table has no project_name gets it (3a Task 8 review)', () => {
  const db = new DatabaseSync(':memory:');
  migrate(db);
  db.exec(`ALTER TABLE wf_test_example_projects DROP COLUMN project_name; PRAGMA user_version = ${SCHEMA_VERSION}`);
  assert.ok(!cols(db, 'wf_test_example_projects').includes('project_name'));
  migrate(db);
  assert.deepEqual(cols(db, 'wf_test_example_projects'), PROJECTS);
});

test("a DB feat/workflow-tests-part3 stamped 81 (its tables, none of dev's 79–88) reaches the current version complete", () => {
  const db = new DatabaseSync(':memory:');
  migrate(db);
  pinStart(db);
  db.exec(`ALTER TABLE wf_test_example_projects DROP COLUMN project_name; ${DEV79_88} PRAGMA user_version = 81`);
  migrate(db);
  assert.equal(stamp(db), SCHEMA_VERSION);
  assert.deepEqual(shape(db), FRESH, 'every table, column and index a fresh DB has');
  assert.deepEqual(keptStarts(db), [{ example_id: 1, project_key: 'p' }], 'the pinned starts it already had are kept');
});

test('a DB from before the tests tables (stamped 77) gets the try columns too', () => {
  const db = new DatabaseSync(':memory:');
  migrate(db);
  db.exec('DROP TABLE wf_test_example_projects; DROP TABLE wf_test_tries; PRAGMA user_version = 77');
  migrate(db);
  for (const c of TRY_NEW) assert.ok(cols(db, 'wf_test_tries').includes(c), c);
});
