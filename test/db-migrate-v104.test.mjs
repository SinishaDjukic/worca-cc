// test/db-migrate-v104.test.mjs — workflow tests, Part 3a (plans/workflow-tests-part3a-plan.md Task 2): an example's project
// and start point, and what a project try records. This rung was v81 on feat/workflow-tests-part3 until dev took 79–83
// (run_groups.name_source, requirements export, the guardrail default, automations, ask_messages.engine) and Parts 1 and 2
// moved to 84 and 85, then v86 until dev took 84 (config_workflow_nodes.roles, test/db-migrate-v84.test.mjs) and Parts 1
// and 2 moved to 85 and 86, then v87 until dev took 85 and 86 (the freeform chat tables, req_features.early_start_reason,
// test/db-migrate-v85.test.mjs, and chat_conversations.header_new_off) and Parts 1 and 2 moved to 87 and 88, then v89 until
// dev took 87 and 88 (the PR-when-done columns, test/db-migrate-v87.test.mjs, and A6.1's req_export_links.origin /
// req_attachments.fetch_json, test/db-migrate-v88.test.mjs) and Parts 1 and 2 moved to 89 and 90, then v91 until dev took 89
// (the Requirements 9c columns, test/db-migrate-v89.test.mjs) and Parts 1 and 2 moved to 90 and 91, then v92 until dev took
// 90–95 (90 and 91 reserved, the Design tables and columns 92–95: test/db-migrate-v92.test.mjs to test/db-migrate-v95.test.mjs)
// and Parts 1 and 2 moved to 96 and 97, then v98 until dev took 96–100 (req_starts.note / note_overrides, tool_tabs,
// designs.origin_thread_id, the design chats reset, pipelines.finished_at / credit_key: test/db-migrate-v96.test.mjs to
// test/db-migrate-v100.test.mjs) and Parts 1 and 2 moved to 101 and 102, then v103 until dev took 101
// (ask_messages.superseded_by, test/db-migrate-v101.test.mjs) and Parts 1 and 2 moved to 102 and 103
// (test/db-migrate-v102.test.mjs, test/db-migrate-v103.test.mjs). No DB these branches stamped before 96 has dev's Design
// tables, none they stamped before 100 has dev's 96–100, and none has dev's 101; one this branch stamped 92 also skips dev's
// v92 rung, so the hoisted repair must make them.
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
// dev's rung 89 (Requirements 9c) that every DB these branches stamped before it took 89 never ran.
const DEV89 = 'ALTER TABLE req_features DROP COLUMN model_json; ALTER TABLE req_briefs DROP COLUMN engine; '
  + 'ALTER TABLE req_briefs DROP COLUMN made_cost_usd; ALTER TABLE req_briefs DROP COLUMN made_cost_kind; '
  + 'ALTER TABLE req_cost_ledger DROP COLUMN engine; ALTER TABLE req_cost_ledger DROP COLUMN step; '
  + 'ALTER TABLE req_cost_ledger DROP COLUMN cost_kind; ALTER TABLE req_cost_ledger DROP COLUMN input_tokens; '
  + 'ALTER TABLE req_cost_ledger DROP COLUMN output_tokens; ALTER TABLE req_turns DROP COLUMN engine; '
  + 'ALTER TABLE req_turns DROP COLUMN notices_json; ALTER TABLE req_helper_messages DROP COLUMN engine; '
  + 'ALTER TABLE req_helper_messages DROP COLUMN notices_json; ALTER TABLE req_attachments DROP COLUMN read_engine;';
// dev's rungs 92–95 (Design: designs with models_json / pictures / sound_json, design_builds, design_agents, design_cost_ledger,
// design_pictures; 90 and 91 are reserved) that a DB at dev's 91 or below, and every DB these branches stamped, never ran.
const DEV92_95 = 'DROP TABLE IF EXISTS design_pictures; DROP TABLE IF EXISTS design_cost_ledger; DROP TABLE IF EXISTS design_agents; '
  + 'DROP TABLE IF EXISTS design_builds; DROP TABLE IF EXISTS designs;';
// dev's rung 101 (ask_messages.superseded_by, a voice merge) that a DB at dev's 100 or below, and every DB these branches
// stamped, never ran.
const DEV101 = 'ALTER TABLE ask_messages DROP COLUMN superseded_by;';
// dev's rungs 96–101 (req_starts.note / note_overrides, tool_tabs, designs.origin_thread_id, pipelines.finished_at / credit_key,
// with the run clock pipelines.elapsed_ms / elapsed_since, which have no rung of their own; v99 is a data step; and
// ask_messages.superseded_by) that a DB at dev's 95 or below, and every DB these branches stamped below 100, never ran. Every
// set that drops designs puts this first.
const DEV96_101 = 'ALTER TABLE req_starts DROP COLUMN note; ALTER TABLE req_starts DROP COLUMN note_overrides; DROP TABLE tool_tabs; '
  + 'ALTER TABLE designs DROP COLUMN origin_thread_id; ALTER TABLE pipelines DROP COLUMN finished_at; '
  + `ALTER TABLE pipelines DROP COLUMN credit_key; ALTER TABLE pipelines DROP COLUMN elapsed_ms; ALTER TABLE pipelines DROP COLUMN elapsed_since; ${DEV101}`;
// The v105 rung (workflow tests Part 4): five tables, and wf_test_examples.criteria / judge. Put it before NO_WORKFLOW_TESTS.
const PART4 = 'DROP TABLE wf_test_judgements; DROP TABLE wf_test_judge_answers; DROP TABLE wf_test_checker_rounds; DROP TABLE wf_test_liked; '
  + 'DROP TABLE wf_test_judge_ledger; ALTER TABLE wf_test_examples DROP COLUMN criteria; ALTER TABLE wf_test_examples DROP COLUMN judge;';
// Every workflow-tests table and column (v102–v104), which a DB at dev's 95, 100 or 101 never had.
const NO_WORKFLOW_TESTS = 'DROP TABLE wf_test_example_projects; DROP TABLE wf_test_run_tries; DROP TABLE wf_test_tries; DROP TABLE wf_test_runs; '
  + 'DROP TABLE wf_test_example_files; DROP TABLE wf_test_examples; ALTER TABLE pipelines DROP COLUMN is_test; '
  + 'DROP TABLE workflow_revisions; ALTER TABLE workflows DROP COLUMN live_version_no;';
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
  assert.ok(SCHEMA_VERSION >= 104);
  assert.deepEqual(cols(db, 'wf_test_example_projects'), PROJECTS);
  for (const c of TRY_NEW) assert.ok(cols(db, 'wf_test_tries').includes(c), c);
});

test("a DB this branch stamped 92 (every workflow-tests table and row, dev's 89, none of dev's 90–95) reaches the current version complete", () => {
  const db = new DatabaseSync(':memory:');
  migrate(db);
  db.prepare(`INSERT INTO workflow_revisions (workflow_id, version_no, name, graph, fingerprint, source, created_at)
    VALUES ('wf_a', 1, 'W', '{}', 'f', 'version', '2026-11-13T00:00:00Z')`).run();
  db.prepare(`INSERT INTO wf_test_examples (workflow_id, name, created_at, updated_at)
    VALUES ('wf_a', 'Example one', '2026-11-13T00:00:00Z', '2026-11-13T00:00:00Z')`).run();
  pinStart(db);
  db.exec(`${DEV96_101} ${DEV92_95} PRAGMA user_version = 92`);
  migrate(db);
  assert.equal(stamp(db), SCHEMA_VERSION);
  for (const t of ['designs', 'design_builds', 'design_agents', 'design_cost_ledger', 'design_pictures']) assert.ok(cols(db, t).length, t);
  for (const c of ['models_json', 'pictures', 'sound_json']) assert.ok(cols(db, 'designs').includes(c), `designs.${c}`);
  assert.deepEqual(shape(db), FRESH, 'every table, column and index a fresh DB has');
  assert.deepEqual(keptStarts(db), [{ example_id: 1, project_key: 'p' }], 'the pinned starts it already had are kept');
  assert.deepEqual(db.prepare('SELECT workflow_id, name FROM wf_test_examples').all().map((r) => ({ ...r })), [{ workflow_id: 'wf_a', name: 'Example one' }]);
  assert.deepEqual(db.prepare('SELECT workflow_id, version_no FROM workflow_revisions').all().map((r) => ({ ...r })), [{ workflow_id: 'wf_a', version_no: 1 }]);
});

test("a DB at dev's 101 (the Design tables and dev's 96–101, none of the workflow-tests tables) gets them and is stamped current", () => {
  const db = new DatabaseSync(':memory:');
  migrate(db);
  db.exec(`${PART4} ${NO_WORKFLOW_TESTS} PRAGMA user_version = 101`);
  migrate(db);
  assert.equal(stamp(db), SCHEMA_VERSION);
  assert.deepEqual(cols(db, 'wf_test_example_projects'), PROJECTS);
  for (const c of TRY_NEW) assert.ok(cols(db, 'wf_test_tries').includes(c), c);
  assert.deepEqual(shape(db), FRESH, 'every table, column and index a fresh DB has');
});

test("a DB this branch stamped 103 (every workflow-tests table and row through 3a, dev's 89–100, no dev's 101, no Part 4) reaches the current version complete", () => {
  const db = new DatabaseSync(':memory:');
  migrate(db);
  db.prepare(`INSERT INTO workflow_revisions (workflow_id, version_no, name, graph, fingerprint, source, created_at)
    VALUES ('wf_a', 1, 'W', '{}', 'f', 'version', '2026-11-21T00:00:00Z')`).run();
  db.prepare(`INSERT INTO wf_test_examples (workflow_id, name, created_at, updated_at)
    VALUES ('wf_a', 'Example one', '2026-11-21T00:00:00Z', '2026-11-21T00:00:00Z')`).run();
  pinStart(db);
  db.exec(`${DEV101} ${PART4} PRAGMA user_version = 103`);
  migrate(db);
  assert.equal(stamp(db), SCHEMA_VERSION);
  assert.ok(cols(db, 'ask_messages').includes('superseded_by'), 'ask_messages.superseded_by (v101)');
  assert.deepEqual(shape(db), FRESH, 'every table, column and index a fresh DB has');
  assert.deepEqual(keptStarts(db), [{ example_id: 1, project_key: 'p' }], 'the pinned starts it already had are kept');
  assert.deepEqual(db.prepare('SELECT workflow_id, name, criteria FROM wf_test_examples').all().map((r) => ({ ...r })),
    [{ workflow_id: 'wf_a', name: 'Example one', criteria: '[]' }]);
  assert.deepEqual(db.prepare('SELECT workflow_id, version_no FROM workflow_revisions').all().map((r) => ({ ...r })), [{ workflow_id: 'wf_a', version_no: 1 }]);
});

test("a DB at Part 2's 102 (dev's 96–100, no dev's 101, no 3a tables or columns) reaches the current version complete", () => {
  const db = new DatabaseSync(':memory:');
  migrate(db);
  db.exec(`${DEV101} ${PART4} ${NO_3A} PRAGMA user_version = 102`);
  migrate(db);
  assert.equal(stamp(db), SCHEMA_VERSION);
  assert.deepEqual(cols(db, 'wf_test_example_projects'), PROJECTS);
  for (const c of TRY_NEW) assert.ok(cols(db, 'wf_test_tries').includes(c), c);
  assert.deepEqual(shape(db), FRESH, 'every table, column and index a fresh DB has');
});

test("a DB at dev's 100 (the Design tables and dev's 96–100, none of the workflow-tests tables, no dev's 101) gets them, keeps its designs and is stamped current", () => {
  const db = new DatabaseSync(':memory:');
  migrate(db);
  db.exec(`${DEV101} ${PART4} ${NO_WORKFLOW_TESTS} PRAGMA user_version = 100`);
  db.prepare("INSERT INTO designs (id, title, kind, origin_thread_id, created_at, updated_at) VALUES ('d_0', 't', 'web', 'ask_1', 'now', 'now')").run();
  migrate(db);
  assert.equal(stamp(db), SCHEMA_VERSION);
  assert.deepEqual(cols(db, 'wf_test_example_projects'), PROJECTS);
  for (const c of TRY_NEW) assert.ok(cols(db, 'wf_test_tries').includes(c), c);
  assert.deepEqual(shape(db), FRESH, 'every table, column and index a fresh DB has');
  assert.deepEqual({ ...db.prepare('SELECT title, origin_thread_id FROM designs').get() }, { title: 't', origin_thread_id: 'ask_1' });
});

test("a DB this branch stamped 98 (every workflow-tests table and row through 3a, dev's 89–95, none of dev's 96–101, no Part 4) reaches the current version complete", () => {
  const db = new DatabaseSync(':memory:');
  migrate(db);
  db.prepare(`INSERT INTO workflow_revisions (workflow_id, version_no, name, graph, fingerprint, source, created_at)
    VALUES ('wf_a', 1, 'W', '{}', 'f', 'version', '2026-11-19T00:00:00Z')`).run();
  db.prepare(`INSERT INTO wf_test_examples (workflow_id, name, created_at, updated_at)
    VALUES ('wf_a', 'Example one', '2026-11-19T00:00:00Z', '2026-11-19T00:00:00Z')`).run();
  pinStart(db);
  db.prepare("INSERT INTO designs (id, title, kind, created_at, updated_at) VALUES ('d_0', 't', 'web', 'now', 'now')").run();
  db.exec(`${DEV96_101} ${PART4} PRAGMA user_version = 98`);
  migrate(db);
  assert.equal(stamp(db), SCHEMA_VERSION);
  for (const c of ['note', 'note_overrides']) assert.ok(cols(db, 'req_starts').includes(c), `req_starts.${c} (v96)`);
  assert.ok(cols(db, 'tool_tabs').length, 'tool_tabs (v97)');
  assert.ok(cols(db, 'designs').includes('origin_thread_id'), 'designs.origin_thread_id (v98)');
  for (const c of ['finished_at', 'credit_key']) assert.ok(cols(db, 'pipelines').includes(c), `pipelines.${c} (v100)`);
  assert.ok(cols(db, 'ask_messages').includes('superseded_by'), 'ask_messages.superseded_by (v101)');
  assert.deepEqual(shape(db), FRESH, 'every table, column and index a fresh DB has');
  assert.deepEqual(keptStarts(db), [{ example_id: 1, project_key: 'p' }], 'the pinned starts it already had are kept');
  assert.deepEqual(db.prepare('SELECT workflow_id, name, criteria FROM wf_test_examples').all().map((r) => ({ ...r })),
    [{ workflow_id: 'wf_a', name: 'Example one', criteria: '[]' }]);
  assert.deepEqual(db.prepare('SELECT workflow_id, version_no FROM workflow_revisions').all().map((r) => ({ ...r })), [{ workflow_id: 'wf_a', version_no: 1 }]);
  assert.equal(db.prepare('SELECT title FROM designs').get().title, 't', 'the designs it already had are kept');
});

test("a DB at dev's 95 (the Design tables, none of the workflow-tests tables) gets them, keeps its designs and is stamped current", () => {
  const db = new DatabaseSync(':memory:');
  migrate(db);
  db.exec(`${DEV96_101} ${NO_WORKFLOW_TESTS} PRAGMA user_version = 95`);
  db.prepare("INSERT INTO designs (id, title, kind, created_at, updated_at) VALUES ('d_0', 't', 'web', 'now', 'now')").run();
  migrate(db);
  assert.equal(stamp(db), SCHEMA_VERSION);
  assert.deepEqual(cols(db, 'wf_test_example_projects'), PROJECTS);
  for (const c of TRY_NEW) assert.ok(cols(db, 'wf_test_tries').includes(c), c);
  assert.deepEqual(shape(db), FRESH, 'every table, column and index a fresh DB has');
  assert.equal(db.prepare('SELECT title FROM designs').get().title, 't');
});

test("a DB at Part 2's 91 without them gets them and is stamped current", () => {
  const db = new DatabaseSync(':memory:');
  migrate(db);
  db.exec(`${DEV96_101} ${NO_3A}
    ${DEV92_95} PRAGMA user_version = 91`);
  migrate(db);
  assert.equal(stamp(db), SCHEMA_VERSION);
  assert.deepEqual(cols(db, 'wf_test_example_projects'), PROJECTS);
  for (const c of TRY_NEW) assert.ok(cols(db, 'wf_test_tries').includes(c), c);
});

test("a DB at Part 2's 88 (none of dev's 87–88, no 3a tables or columns) reaches the current version complete", () => {
  const db = new DatabaseSync(':memory:');
  migrate(db);
  db.exec(`${DEV96_101} ${NO_3A}
    ${DEV87_88} ${DEV92_95} PRAGMA user_version = 88`);
  migrate(db);
  assert.equal(stamp(db), SCHEMA_VERSION);
  assertDev87To88(db);
  assert.deepEqual(shape(db), FRESH, 'every table, column and index a fresh DB has');
});

test("a DB at Part 2's 86 (none of dev's 85–88, no 3a tables or columns) reaches the current version complete", () => {
  const db = new DatabaseSync(':memory:');
  migrate(db);
  db.exec(`${DEV96_101} ${NO_3A}
    ${DEV87_88} ${DEV85_86} ${DEV92_95} PRAGMA user_version = 86`);
  migrate(db);
  assert.equal(stamp(db), SCHEMA_VERSION);
  assertDev85To86(db);
  assertDev87To88(db);
  assert.deepEqual(shape(db), FRESH, 'every table, column and index a fresh DB has');
});

test("a DB at Part 2's 85 (none of dev's 84–88, no 3a tables or columns) reaches the current version complete", () => {
  const db = new DatabaseSync(':memory:');
  migrate(db);
  db.exec(`${DEV96_101} ${NO_3A}
    ${DEV87_88} ${DEV84} ${DEV85_86} ${DEV92_95} PRAGMA user_version = 85`);
  migrate(db);
  assert.equal(stamp(db), SCHEMA_VERSION);
  assert.deepEqual(shape(db), FRESH, 'every table, column and index a fresh DB has');
});

test("a DB this branch stamped 91 before it took 9c (its tables, none of dev's 89–95) reaches the current version complete", () => {
  const db = new DatabaseSync(':memory:');
  migrate(db);
  pinStart(db);
  db.exec(`${DEV96_101} ${DEV89} ${DEV92_95} PRAGMA user_version = 91`);
  migrate(db);
  assert.equal(stamp(db), SCHEMA_VERSION);
  assert.deepEqual(shape(db), FRESH, 'every table, column and index a fresh DB has');
  assert.deepEqual(keptStarts(db), [{ example_id: 1, project_key: 'p' }], 'the pinned starts it already had are kept');
});

test("a DB this branch stamped 89 (its tables, none of dev's 87–89) reaches the current version complete", () => {
  const db = new DatabaseSync(':memory:');
  migrate(db);
  pinStart(db);
  db.exec(`${DEV96_101} ${DEV87_88} ${DEV89} ${DEV92_95} PRAGMA user_version = 89`);
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
  db.exec(`${DEV96_101} ${DEV87_88} ${DEV85_86} ${DEV92_95} PRAGMA user_version = 87`);
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
  db.exec(`${DEV96_101} ${DEV87_88} ${DEV84} ${DEV85_86} ${DEV92_95} PRAGMA user_version = 86`);
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
  db.exec(`${DEV96_101} ALTER TABLE wf_test_example_projects DROP COLUMN project_name; ${DEV79_88} ${DEV92_95} PRAGMA user_version = 81`);
  migrate(db);
  assert.equal(stamp(db), SCHEMA_VERSION);
  assert.deepEqual(shape(db), FRESH, 'every table, column and index a fresh DB has');
  assert.deepEqual(keptStarts(db), [{ example_id: 1, project_key: 'p' }], 'the pinned starts it already had are kept');
});

test('a DB from before the tests tables (stamped 77) gets the try columns too', () => {
  const db = new DatabaseSync(':memory:');
  migrate(db);
  db.exec(`${DEV96_101} DROP TABLE wf_test_example_projects; DROP TABLE wf_test_tries; ${DEV92_95} PRAGMA user_version = 77`);
  migrate(db);
  for (const c of TRY_NEW) assert.ok(cols(db, 'wf_test_tries').includes(c), c);
});
