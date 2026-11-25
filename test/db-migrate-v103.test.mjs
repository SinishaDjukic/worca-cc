// test/db-migrate-v103.test.mjs — workflow tests, Part 2 (plans/workflow-tests-part2-plan.md Task 2): five tables + pipelines.is_test.
// This rung was v78 on feat/workflow-tests-part2 until dev took 77 / 78 (req_attachments, req_helper_messages) and Part 1's
// workflow revisions moved to 79, then v80 until dev took 79–83 (run_groups.name_source, requirements export, the guardrail
// default, automations, ask_messages.engine) and Part 1's revisions moved to 84, then v85 until dev took 84
// (config_workflow_nodes.roles, test/db-migrate-v84.test.mjs) and Part 1's revisions moved to 85, then v86 until dev took 85
// and 86 (the freeform chat tables, req_features.early_start_reason, test/db-migrate-v85.test.mjs, and
// chat_conversations.header_new_off) and Part 1's revisions moved to 87, then v88 until dev took 87 and 88 (the PR-when-done
// columns, test/db-migrate-v87.test.mjs, and A6.1's req_export_links.origin / req_attachments.fetch_json,
// test/db-migrate-v88.test.mjs) and Part 1's revisions moved to 89, then v90 until dev took 89 (the Requirements 9c columns,
// test/db-migrate-v89.test.mjs) and Part 1's revisions moved to 90, then v91 until dev took 90–95 (90 and 91 reserved, the
// Design tables and columns 92–95: test/db-migrate-v92.test.mjs to test/db-migrate-v95.test.mjs) and Part 1's revisions
// moved to 96, then v97 until dev took 96–100 (req_starts.note / note_overrides, tool_tabs, designs.origin_thread_id, the
// design chats reset, pipelines.finished_at / credit_key: test/db-migrate-v96.test.mjs to test/db-migrate-v100.test.mjs) and
// Part 1's revisions moved to 101, then v102 until dev took 101 (ask_messages.superseded_by, test/db-migrate-v101.test.mjs)
// and Part 1's revisions moved to 102 (test/db-migrate-v102.test.mjs). No DB these branches stamped before 96 has dev's
// Design tables, none they stamped before 100 has dev's 96–100, and none has dev's 101. A fresh DB, a DB at Part 1's 101,
// 90, 89, 87, 85, 84, 83 or 79, one at dev's 101, 100, 95, 89, 88, 87, 86, 85, 84 or 83, one at 77, one that branch already
// stamped 102, 97, 91, 90, 88, 86, 85, 80 or 78 (revisions + wf_test_* tables, without dev's later rungs), or one at Part 1's
// earlier 77 reaches the current version complete.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { migrate, SCHEMA_VERSION } from '../src/core/db.mjs';

const cols = (db, t) => db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);
const stamp = (db) => db.prepare('PRAGMA user_version').get().user_version;
const TABLES = {
  wf_test_examples: ['id', 'workflow_id', 'name', 'request', 'answers', 'otherwise', 'basics', 'checks', 'tries', 'note',
    'from_pipeline', 'from_use', 'from_verdict', 'created_by', 'created_at', 'updated_at',
    'criteria', 'judge'],   // the last two are v105 (workflow tests Part 4)
  wf_test_example_files: ['example_id', 'name', 'data', 'sha256', 'size'],
  wf_test_runs: ['id', 'workflow_id', 'kind', 'a_use', 'b_use', 'a_fp', 'b_fp', 'example_ids', 'tries', 'quick', 'cap_usd',
    'connectors', 'status', 'stop_reason', 'stop_detail', 'started_by', 'created_at', 'finished_at'],
  wf_test_tries: ['id', 'run_id', 'workflow_id', 'example_id', 'use_ref', 'fp', 'example_fp', 'try_no', 'mock', 'connectors', 'status',
    'run_key', 'pipeline_id', 'verdict', 'cost_usd', 'started_at', 'finished_at',
    'start_commit', 'disk_bytes', 'setup', 'changes'],   // the last four are v104 (workflow tests 3a)
  wf_test_run_tries: ['run_id', 'try_id', 'side'],
};
const CHAT = ['chat_conversations', 'chat_controls', 'chat_deliveries', 'chat_inbound_seen'];
const DESIGN = ['designs', 'design_builds', 'design_agents', 'design_cost_ledger', 'design_pictures'];

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

function assertComplete(db) {
  assert.ok(stamp(db) >= 103);
  assert.equal(stamp(db), SCHEMA_VERSION);
  for (const [t, want] of Object.entries(TABLES)) assert.deepEqual(cols(db, t), want, t);
  assert.ok(cols(db, 'pipelines').includes('is_test'), 'pipelines.is_test');
  assert.ok(cols(db, 'workflow_revisions').length, 'workflow_revisions (v102)');
  assert.ok(cols(db, 'workflows').includes('live_version_no'), 'workflows.live_version_no (v102)');
  assert.ok(cols(db, 'req_export_links').includes('origin'), 'req_export_links.origin (v88)');
  assert.ok(cols(db, 'req_attachments').includes('fetch_json'), 'req_attachments.fetch_json (v88)');
  assert.ok(cols(db, 'pipelines').includes('pr_auto'), 'pipelines.pr_auto (v87)');
  assert.ok(cols(db, 'workspaces').includes('settings_json'), 'workspaces.settings_json (v87)');
  for (const c of ['pr_open', 'pr_slices', 'pr_source', 'pr_outcome']) assert.ok(cols(db, 'shape_features').includes(c), `shape_features.${c} (v87)`);
  for (const t of CHAT) assert.ok(cols(db, t).length, `${t} (v85)`);
  assert.ok(cols(db, 'req_features').includes('early_start_reason'), 'req_features.early_start_reason (v85)');
  assert.ok(cols(db, 'chat_conversations').includes('header_new_off'), 'chat_conversations.header_new_off (v86)');
  assert.ok(cols(db, 'config_workflow_nodes').includes('roles'), 'config_workflow_nodes.roles (v84)');
  assert.ok(cols(db, 'pipelines').includes('review_stats'), 'pipelines.review_stats (with v84)');
  assert.ok(cols(db, 'ask_messages').includes('engine'), 'ask_messages.engine (v83)');
  assert.ok(cols(db, 'automation_rules').length && cols(db, 'automation_events').length, 'automation_* (v82)');
  assert.ok(cols(db, 'req_export_setups').length && cols(db, 'req_export_links').length, 'req_export_* (v80)');
  assert.ok(cols(db, 'run_groups').includes('name_source'), 'run_groups.name_source (v79)');
  assert.ok(cols(db, 'req_helper_messages').length, 'req_helper_messages (v78)');
  assert.ok(cols(db, 'req_cost_ledger').includes('helper_message_id'), 'req_cost_ledger.helper_message_id (v78)');
  assert.ok(cols(db, 'req_attachments').length, 'req_attachments (v77)');
  assert.ok(cols(db, 'req_cost_ledger').includes('attachment_id'), 'req_cost_ledger.attachment_id (v77)');
  assert.ok(cols(db, 'req_starts').includes('files_json'), 'req_starts.files_json (v77)');
  for (const t of DESIGN) assert.ok(cols(db, t).length, `${t} (v92, v94)`);
  for (const c of ['models_json', 'pictures', 'sound_json']) assert.ok(cols(db, 'designs').includes(c), `designs.${c} (v93–v95)`);
  for (const c of ['note', 'note_overrides']) assert.ok(cols(db, 'req_starts').includes(c), `req_starts.${c} (v96)`);
  assert.ok(cols(db, 'tool_tabs').length, 'tool_tabs (v97)');
  assert.ok(cols(db, 'designs').includes('origin_thread_id'), 'designs.origin_thread_id (v98)');
  for (const c of ['finished_at', 'credit_key']) assert.ok(cols(db, 'pipelines').includes(c), `pipelines.${c} (v100)`);
  assert.ok(cols(db, 'ask_messages').includes('superseded_by'), 'ask_messages.superseded_by (v101)');
  assert.deepEqual(shape(db), FRESH, 'every table, column and index a fresh DB has');
}
const WT = `ALTER TABLE pipelines DROP COLUMN is_test; ${Object.keys(TABLES).map((t) => `DROP TABLE ${t};`).join(' ')}`;
const WF = 'ALTER TABLE workflows DROP COLUMN live_version_no; DROP TABLE workflow_revisions;';
const A3 = 'DROP TABLE req_helper_messages; ALTER TABLE req_cost_ledger DROP COLUMN helper_message_id;';
const A8 = 'DROP TABLE req_attachments; ALTER TABLE req_cost_ledger DROP COLUMN attachment_id; ALTER TABLE req_starts DROP COLUMN files_json;';
// dev's rung 88 (A6.1) that a DB at dev's 87 never ran.
const DEV88 = 'ALTER TABLE req_export_links DROP COLUMN origin; ALTER TABLE req_attachments DROP COLUMN fetch_json;';
// dev's rungs 87 (PR-when-done) and 88 (A6.1) that a DB at dev's 86, or one these branches stamped 88 or below, never ran.
// Every set below that drops req_export_links or req_attachments puts this first (it drops a column of each).
const DEV87_88 = 'ALTER TABLE pipelines DROP COLUMN pr_auto; ALTER TABLE workspaces DROP COLUMN settings_json; '
  + 'ALTER TABLE shape_features DROP COLUMN pr_open; ALTER TABLE shape_features DROP COLUMN pr_slices; '
  + `ALTER TABLE shape_features DROP COLUMN pr_source; ALTER TABLE shape_features DROP COLUMN pr_outcome; ${DEV88}`;
// dev's rung 86 that a DB at dev's 85 never ran.
const DEV86 = 'ALTER TABLE chat_conversations DROP COLUMN header_new_off;';
// dev's rungs 85 and 86 (the freeform chat tables, with header_new_off, and req_features.early_start_reason) that a DB
// these branches stamped 86 or below never ran.
const DEV85_86 = 'DROP TABLE chat_controls; DROP TABLE chat_deliveries; DROP TABLE chat_inbound_seen; DROP TABLE chat_conversations; '
  + 'ALTER TABLE req_features DROP COLUMN early_start_reason;';
// dev's rung 84 (#990, with pipelines.review_stats, which has no rung of its own) that a DB these branches stamped 85 or
// below never ran.
const DEV84 = 'ALTER TABLE config_workflow_nodes DROP COLUMN roles; ALTER TABLE pipelines DROP COLUMN review_stats;';
// dev's rung 83 that a DB Part 1 stamped 83 never ran.
const DEV83 = 'ALTER TABLE ask_messages DROP COLUMN engine;';
// dev's rungs 79–88 that a DB stamped 80 or below by these branches never ran (v81 writes a row only, no DDL).
const DEV79_88 = [DEV87_88, 'ALTER TABLE run_groups DROP COLUMN name_source;',
  'DROP TABLE req_export_setups; DROP TABLE req_export_links;',
  'DROP TABLE automation_rules; DROP TABLE automation_events; DROP TABLE automation_cursors; DROP TABLE automation_deliveries;',
  DEV83, DEV84, DEV85_86].join(' ');
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
// dev's rungs 96–100 (req_starts.note / note_overrides, tool_tabs, designs.origin_thread_id, pipelines.finished_at / credit_key,
// with the run clock pipelines.elapsed_ms / elapsed_since, which have no rung of their own; v99 is a data step) that a DB at
// dev's 95 or below, and every DB these branches stamped, never ran. Every set that drops designs puts this first.
const DEV96_100 = 'ALTER TABLE req_starts DROP COLUMN note; ALTER TABLE req_starts DROP COLUMN note_overrides; DROP TABLE tool_tabs; '
  + 'ALTER TABLE designs DROP COLUMN origin_thread_id; ALTER TABLE pipelines DROP COLUMN finished_at; '
  + 'ALTER TABLE pipelines DROP COLUMN credit_key; ALTER TABLE pipelines DROP COLUMN elapsed_ms; ALTER TABLE pipelines DROP COLUMN elapsed_since;';
// dev's rung 101 (ask_messages.superseded_by, a voice merge) that a DB at dev's 100 or below, and every DB these branches
// stamped, never ran.
const DEV101 = 'ALTER TABLE ask_messages DROP COLUMN superseded_by;';
// The v105 rung (workflow tests Part 4) that every DB here below it never ran: five tables, and wf_test_examples.criteria /
// judge. Put it before WT (which drops wf_test_examples).
const PART4 = 'DROP TABLE wf_test_judgements; DROP TABLE wf_test_judge_answers; DROP TABLE wf_test_checker_rounds; DROP TABLE wf_test_liked; '
  + 'DROP TABLE wf_test_judge_ledger; ALTER TABLE wf_test_examples DROP COLUMN criteria; ALTER TABLE wf_test_examples DROP COLUMN judge;';
// The v104 rung (tests on a project) that a DB this branch stamped 91, 97 or 102 never ran.
const NO_3A = 'DROP TABLE wf_test_example_projects; ALTER TABLE wf_test_tries DROP COLUMN start_commit; '
  + 'ALTER TABLE wf_test_tries DROP COLUMN disk_bytes; ALTER TABLE wf_test_tries DROP COLUMN setup; ALTER TABLE wf_test_tries DROP COLUMN changes;';
/** A DB at `at` that lacks `sql` (and, below dev's 101, dev's 101; below dev's 96, dev's 96–100; below dev's 92, dev's Design
 *  tables). */
const fromStamp = (sql, at) => {
  const db = new DatabaseSync(':memory:');
  migrate(db);
  db.exec(`${at < 101 ? DEV101 : ''} ${at < 96 ? DEV96_100 : ''} ${sql} ${at < 92 ? DEV92_95 : ''} PRAGMA user_version = ${at}`);
  migrate(db);
  return db;
};

test('fresh DB: the workflow test tables exist and pipelines has is_test', () => {
  const db = new DatabaseSync(':memory:');
  migrate(db);
  assert.ok(SCHEMA_VERSION >= 103);
  assertComplete(db);
});

test("a DB at dev's 101 (no workflow revisions, no workflow tests) gets them all and is stamped current", () => {
  assertComplete(fromStamp(`${PART4} DROP TABLE wf_test_example_projects; ${WT} ${WF}`, 101));
});

test("a DB at dev's 100 (no workflow revisions, no workflow tests, no ask_messages.superseded_by) gets them all and is stamped current", () => {
  assertComplete(fromStamp(`${PART4} DROP TABLE wf_test_example_projects; ${WT} ${WF}`, 100));
});

test("a DB at Part 1's 101 (workflow revisions and dev's 96–100, no dev's 101, no workflow tests) reaches the current version complete", () => {
  assertComplete(fromStamp(`${DEV101} ${PART4} DROP TABLE wf_test_example_projects; ${WT}`, 101));
});

test("a DB at dev's 95 (no workflow revisions, no workflow tests, none of dev's 96–101) gets them all and is stamped current", () => {
  assertComplete(fromStamp(`${PART4} DROP TABLE wf_test_example_projects; ${WT} ${WF}`, 95));
});

test("a DB at Part 1's 90 (workflow revisions and dev's 84–89, none of dev's 92–95, no workflow tests) gets them all and is stamped current", () => {
  assertComplete(fromStamp(WT, 90));
});

test("a DB at dev's 89 (no workflow revisions, no workflow tests) gets them all and is stamped current", () => {
  assertComplete(fromStamp(`${WT} ${WF}`, 89));
});

test("a DB at Part 1's 89 (workflow revisions and dev's 84–88, none of dev's 89, no workflow tests) reaches the current version complete", () => {
  assertComplete(fromStamp(`${WT} ${DEV89}`, 89));
});

test("a DB at Part 1's 87 (workflow revisions and dev's 84–86, none of dev's 87–88, no workflow tests) reaches the current version complete", () => {
  assertComplete(fromStamp(`${WT} ${DEV87_88}`, 87));
});

test("a DB at Part 1's 85 (workflow revisions and dev's 84, none of dev's 85–88, no workflow tests) reaches the current version complete", () => {
  assertComplete(fromStamp(`${WT} ${DEV87_88} ${DEV85_86}`, 85));
});

test("a DB at Part 1's 84 (workflow revisions, none of dev's 84–88, no workflow tests) reaches the current version complete", () => {
  assertComplete(fromStamp(`${WT} ${DEV87_88} ${DEV84} ${DEV85_86}`, 84));
});

test("a DB at Part 1's 83 (workflow revisions, no ask_messages.engine, no workflow tests) reaches the current version complete", () => {
  assertComplete(fromStamp(`${WT} ${DEV87_88} ${DEV83} ${DEV84} ${DEV85_86}`, 83));
});

test("a DB at dev's 88 (no workflow revisions, no workflow tests) gets them all and is stamped current", () => {
  assertComplete(fromStamp(`${WT} ${WF}`, 88));
});

test("a DB at dev's 87 (no workflow revisions, no workflow tests, no A6.1 columns) gets them all and is stamped current", () => {
  assertComplete(fromStamp(`${WT} ${WF} ${DEV88}`, 87));
});

test("a DB at dev's 86 (no workflow revisions, no workflow tests, none of dev's 87–88) gets them all and is stamped current", () => {
  assertComplete(fromStamp(`${WT} ${WF} ${DEV87_88}`, 86));
});

test("a DB at dev's 85 (no workflow revisions, no workflow tests, no header_new_off, none of dev's 87–88) gets them all and is stamped current", () => {
  assertComplete(fromStamp(`${WT} ${WF} ${DEV87_88} ${DEV86}`, 85));
});

test("a DB at dev's 84 (no workflow revisions, no workflow tests, none of dev's 85–88) gets them all and is stamped current", () => {
  assertComplete(fromStamp(`${WT} ${WF} ${DEV87_88} ${DEV85_86}`, 84));
});

test("a DB at dev's 83 (no workflow revisions, no workflow tests, no roles, none of dev's 85–88) gets them all and is stamped current", () => {
  assertComplete(fromStamp(`${WT} ${WF} ${DEV87_88} ${DEV84} ${DEV85_86}`, 83));
});

test("a DB at Part 1's 79 (workflow revisions, none of dev's 79–88, no workflow tests) reaches the current version complete", () => {
  assertComplete(fromStamp(`${WT} ${DEV79_88}`, 79));
});

test('a DB stamped 77 without A3, dev 79–88, workflow revisions or workflow tests gets them all and is stamped current', () => {
  assertComplete(fromStamp(`${WT} ${WF} ${DEV79_88} ${A3}`, 77));
});

/** A DB feat/workflow-tests-part2 stamped `at` (102, 97, 91, 90, 88, 86, 85, 80 or 78): revisions + wf_test_* rows, and it lacks
 *  `sql`, dev's 101 (no stamp of that branch has it), below 100 dev's 96–100 and, below 96, dev's Design tables. */
function fromPart2Stamp(sql, at) {
  const db = new DatabaseSync(':memory:');
  migrate(db);
  db.prepare(`INSERT INTO workflow_revisions (workflow_id, version_no, name, graph, fingerprint, source, created_at)
    VALUES ('wf_a', 1, 'W', '{}', 'f', 'version', '2026-10-25T00:00:00Z')`).run();
  db.prepare(`INSERT INTO wf_test_examples (workflow_id, name, created_at, updated_at)
    VALUES ('wf_a', 'Example one', '2026-10-26T00:00:00Z', '2026-10-26T00:00:00Z')`).run();
  db.exec(`${DEV101} ${at < 100 ? DEV96_100 : ''} ${sql} ${at < 96 ? DEV92_95 : ''} PRAGMA user_version = ${at}`);
  migrate(db);
  return db;
}
function assertKept(db) {
  const revs = db.prepare('SELECT workflow_id, version_no FROM workflow_revisions').all().map((r) => ({ ...r }));
  assert.deepEqual(revs, [{ workflow_id: 'wf_a', version_no: 1 }], 'the revisions it already had are kept');
  const examples = db.prepare('SELECT workflow_id, name FROM wf_test_examples').all().map((r) => ({ ...r }));
  assert.deepEqual(examples, [{ workflow_id: 'wf_a', name: 'Example one' }], 'the examples it already had are kept');
}

test("a DB feat/workflow-tests-part2 stamped 102 (revisions + wf_test_* and dev's 89–100, no dev's 101, no 3a, no Part 4) reaches the current version complete", () => {
  const db = fromPart2Stamp(`${PART4} ${NO_3A}`, 102);
  assertComplete(db);
  assertKept(db);
});

test("a DB feat/workflow-tests-part2 stamped 97 (revisions + wf_test_* and dev's 89–95, none of dev's 96–101, no 3a, no Part 4) reaches the current version complete", () => {
  const db = fromPart2Stamp(`${PART4} ${NO_3A}`, 97);
  assertComplete(db);
  assertKept(db);
});

test("a DB feat/workflow-tests-part2 stamped 91 (revisions + wf_test_* and dev's 89, none of dev's 92–95, no 3a) reaches the current version complete", () => {
  const db = fromPart2Stamp(NO_3A, 91);
  assertComplete(db);
  assertKept(db);
});

test("a DB feat/workflow-tests-part2 stamped 90 (revisions + wf_test_*, none of dev's 89–95) reaches the current version complete", () => {
  const db = fromPart2Stamp(DEV89, 90);
  assertComplete(db);
  assertKept(db);
});

test("a DB feat/workflow-tests-part2 stamped 88 (revisions + wf_test_*, none of dev's 87–88) reaches the current version complete", () => {
  const db = fromPart2Stamp(DEV87_88, 88);
  assertComplete(db);
  assertKept(db);
});

test("a DB feat/workflow-tests-part2 stamped 86 (revisions + wf_test_*, none of dev's 85–88) reaches the current version complete", () => {
  const db = fromPart2Stamp(`${DEV87_88} ${DEV85_86}`, 86);
  assertComplete(db);
  assertKept(db);
});

test("a DB feat/workflow-tests-part2 stamped 85 (revisions + wf_test_*, none of dev's 84–88) reaches the current version complete", () => {
  const db = fromPart2Stamp(`${DEV87_88} ${DEV84} ${DEV85_86}`, 85);
  assertComplete(db);
  assertKept(db);
});

test("a DB feat/workflow-tests-part2 stamped 80 (revisions + wf_test_*, none of dev's 79–88) reaches the current version complete", () => {
  const db = fromPart2Stamp(DEV79_88, 80);
  assertComplete(db);
  assertKept(db);
});

test('a DB feat/workflow-tests-part2 stamped 78 (revisions + wf_test_*, no A8 / A3 / dev 79–88) reaches the current version complete', () => {
  const db = fromPart2Stamp(`${DEV79_88} ${A8} ${A3}`, 78);
  assertComplete(db);
  assertKept(db);
});

test("a DB at Part 1's earlier 77 (workflow revisions, no A8 / A3 / dev 79–88 / workflow tests) reaches the current version complete", () => {
  assertComplete(fromStamp(`${WT} ${DEV79_88} ${A8} ${A3}`, 77));
});

test('a DB stamped past this version without the tables or the column is repaired', () => {
  const db = fromStamp(WT, SCHEMA_VERSION + 1);
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
