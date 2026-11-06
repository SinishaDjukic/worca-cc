// test/db-migrate-v87.test.mjs — workflow history + named versions (plans/workflow-tests-plan.md Task 1, #721).
// This rung was v78 on feat/workflow-tests until dev took 78 for req_helper_messages (test/db-migrate-v78.test.mjs),
// then v79 until dev took 79–82 (run_groups.name_source, requirements export, the guardrail default, automations),
// then v83 until dev took 83 for ask_messages.engine (test/db-migrate-v83.test.mjs), then v84 until dev took 84 for
// config_workflow_nodes.roles (test/db-migrate-v84.test.mjs), then v85 until dev took 85 and 86 for the freeform chat
// tables, req_features.early_start_reason (test/db-migrate-v85.test.mjs) and chat_conversations.header_new_off.
// A DB at dev's 86, 85, 84, 83 or 82, at 77, a DB that branch already stamped 78, 79, 83, 84 or 85 (workflow_revisions,
// without dev's later rungs), or a fresh one reaches the current version complete.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { migrate, SCHEMA_VERSION } from '../src/core/db.mjs';

const cols = (db, t) => db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);
const version = (db) => db.prepare('PRAGMA user_version').get().user_version;
const hasIndex = (db, name) => db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type='index' AND name=?").get(name).n === 1;
const REV_COLS = ['id', 'workflow_id', 'version_no', 'note', 'name', 'domain', 'graph', 'fingerprint', 'parts', 'source', 'made_by', 'created_at'];
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

function assertComplete(db) {
  assert.ok(version(db) >= 87);
  assert.equal(version(db), SCHEMA_VERSION);
  assert.deepEqual(cols(db, 'workflow_revisions'), REV_COLS);
  assert.ok(hasIndex(db, 'idx_workflow_revisions_wf'), 'index idx_workflow_revisions_wf');
  assert.ok(hasIndex(db, 'idx_workflow_revisions_version'), 'index idx_workflow_revisions_version');
  assert.ok(cols(db, 'workflows').includes('live_version_no'), 'workflows.live_version_no');
  assert.ok(cols(db, 'req_helper_messages').length, 'req_helper_messages (v78)');
  assert.ok(cols(db, 'req_cost_ledger').includes('helper_message_id'), 'req_cost_ledger.helper_message_id (v78)');
  assert.ok(cols(db, 'run_groups').includes('name_source'), 'run_groups.name_source (v79)');
  assert.ok(cols(db, 'req_export_setups').length && cols(db, 'req_export_links').length, 'req_export_* (v80)');
  assert.ok(cols(db, 'automation_rules').length && cols(db, 'automation_events').length, 'automation_* (v82)');
  assert.ok(cols(db, 'ask_messages').includes('engine'), 'ask_messages.engine (v83)');
  assert.ok(cols(db, 'config_workflow_nodes').includes('roles'), 'config_workflow_nodes.roles (v84)');
  assert.ok(cols(db, 'pipelines').includes('review_stats'), 'pipelines.review_stats (with v84)');
  for (const t of CHAT) assert.ok(cols(db, t).length, `${t} (v85)`);
  assert.ok(cols(db, 'req_features').includes('early_start_reason'), 'req_features.early_start_reason (v85)');
  assert.ok(cols(db, 'chat_conversations').includes('header_new_off'), 'chat_conversations.header_new_off (v86)');
  assert.deepEqual(shape(db), FRESH, 'every table, column and index a fresh DB has');
}
const WF = 'ALTER TABLE workflows DROP COLUMN live_version_no; DROP TABLE workflow_revisions;';
const A3 = 'DROP TABLE req_helper_messages; ALTER TABLE req_cost_ledger DROP COLUMN helper_message_id;';
// dev's rung 86 that a DB at dev's 85 never ran.
const DEV86 = 'ALTER TABLE chat_conversations DROP COLUMN header_new_off;';
// dev's rungs 85 and 86 (the freeform chat tables, with header_new_off, and req_features.early_start_reason) that a DB
// feat/workflow-tests stamped 85 (or earlier) never ran.
const DEV85_86 = 'DROP TABLE chat_controls; DROP TABLE chat_deliveries; DROP TABLE chat_inbound_seen; DROP TABLE chat_conversations; '
  + 'ALTER TABLE req_features DROP COLUMN early_start_reason;';
// dev's rung 84 (#990, with pipelines.review_stats, which has no rung of its own) that a DB feat/workflow-tests stamped 84
// (or earlier) never ran.
const DEV84 = 'ALTER TABLE config_workflow_nodes DROP COLUMN roles; ALTER TABLE pipelines DROP COLUMN review_stats;';
// dev's rung 83 that a DB feat/workflow-tests stamped 83 (or earlier) never ran.
const DEV83 = 'ALTER TABLE ask_messages DROP COLUMN engine;';
// dev's rungs 79–86 that a DB feat/workflow-tests stamped 78 or 79 never ran (v81 writes a row only, no DDL).
const DEV79_86 = ['ALTER TABLE run_groups DROP COLUMN name_source;',
  'DROP TABLE req_export_setups; DROP TABLE req_export_links;',
  'DROP TABLE automation_rules; DROP TABLE automation_events; DROP TABLE automation_cursors; DROP TABLE automation_deliveries;',
  DEV83, DEV84, DEV85_86].join(' ');
const fromStamp = (sql, stamp) => {
  const db = new DatabaseSync(':memory:');
  migrate(db);
  db.exec(`${sql} PRAGMA user_version = ${stamp}`);
  migrate(db);
  return db;
};
/** A DB feat/workflow-tests stamped `stamp` (78, 79, 83, 84 or 85): it has workflow_revisions with a version, and lacks `sql`. */
function fromBranchStamp(sql, stamp) {
  const db = new DatabaseSync(':memory:');
  migrate(db);
  db.prepare(`INSERT INTO workflow_revisions (workflow_id, version_no, name, graph, fingerprint, source, created_at)
    VALUES ('wf_a', 1, 'W', '{}', 'f', 'version', '2026-10-25T00:00:00Z')`).run();
  db.exec(`${sql} PRAGMA user_version = ${stamp}`);
  migrate(db);
  return db;
}
const keptRevisions = (db) => db.prepare('SELECT workflow_id, version_no FROM workflow_revisions').all().map((r) => ({ ...r }));

test('fresh DB: workflow_revisions exists and workflows has live_version_no', () => {
  const db = new DatabaseSync(':memory:');
  migrate(db);
  assert.ok(SCHEMA_VERSION >= 87);
  assertComplete(db);
});

test("a DB at dev's 86 (no workflow revisions) gets them and is stamped current", () => {
  assertComplete(fromStamp(WF, 86));
});

test("a DB at dev's 85 (no workflow revisions, no chat_conversations.header_new_off) gets them and is stamped current", () => {
  assertComplete(fromStamp(`${WF} ${DEV86}`, 85));
});

test("a DB at dev's 84 (no workflow revisions, no chat tables, no early_start_reason) gets them and is stamped current", () => {
  assertComplete(fromStamp(`${WF} ${DEV85_86}`, 84));
});

test("a DB at dev's 83 (no workflow revisions, no config_workflow_nodes.roles, none of dev's 85–86) gets them and is stamped current", () => {
  assertComplete(fromStamp(`${WF} ${DEV84} ${DEV85_86}`, 83));
});

test("a DB at dev's 82 (no workflow revisions, no ask_messages.engine, no roles, none of dev's 85–86) gets them and is stamped current", () => {
  assertComplete(fromStamp(`${WF} ${DEV83} ${DEV84} ${DEV85_86}`, 82));
});

test('a DB stamped 77 without any of 78–87 gets them all and is stamped current', () => {
  assertComplete(fromStamp(`${WF} ${A3} ${DEV79_86}`, 77));
});

test("a DB feat/workflow-tests stamped 85 (workflow_revisions, none of dev's 85 and 86) reaches the current version complete", () => {
  const db = fromBranchStamp(DEV85_86, 85);
  assertComplete(db);
  assert.deepEqual(keptRevisions(db), [{ workflow_id: 'wf_a', version_no: 1 }], 'the revisions it already had are kept');
});

test("a DB feat/workflow-tests stamped 84 (workflow_revisions, none of dev's 84–86) reaches the current version complete", () => {
  const db = fromBranchStamp(`${DEV84} ${DEV85_86}`, 84);
  assertComplete(db);
  assert.deepEqual(keptRevisions(db), [{ workflow_id: 'wf_a', version_no: 1 }], 'the revisions it already had are kept');
});

test("a DB feat/workflow-tests stamped 83 (workflow_revisions, no ask_messages.engine, no roles, none of dev's 85–86) reaches the current version complete", () => {
  const db = fromBranchStamp(`${DEV83} ${DEV84} ${DEV85_86}`, 83);
  assertComplete(db);
  assert.deepEqual(keptRevisions(db), [{ workflow_id: 'wf_a', version_no: 1 }], 'the revisions it already had are kept');
});

test("a DB feat/workflow-tests stamped 79 (workflow_revisions, none of dev's 79–86) reaches the current version complete", () => {
  const db = fromBranchStamp(DEV79_86, 79);
  assertComplete(db);
  assert.deepEqual(keptRevisions(db), [{ workflow_id: 'wf_a', version_no: 1 }], 'the revisions it already had are kept');
});

test('a DB feat/workflow-tests stamped 78 (workflow_revisions, no req_helper_messages) reaches the current version complete', () => {
  const db = fromBranchStamp(`${A3} ${DEV79_86}`, 78);
  assertComplete(db);
  assert.deepEqual(keptRevisions(db), [{ workflow_id: 'wf_a', version_no: 1 }], 'the revisions it already had are kept');
});

test('a DB stamped past this version without the table or the column is repaired', () => {
  const db = fromStamp(WF, SCHEMA_VERSION + 1);
  assert.deepEqual(cols(db, 'workflow_revisions'), REV_COLS);
  assert.ok(cols(db, 'workflows').includes('live_version_no'));
});

test('a named version number is unique per workflow; automatic snapshots (NULL) repeat freely', () => {
  const db = new DatabaseSync(':memory:');
  migrate(db);
  const ins = db.prepare(`INSERT INTO workflow_revisions (workflow_id, version_no, name, graph, fingerprint, source, created_at)
    VALUES (?, ?, 'W', '{}', 'f', 'save', '2026-10-25T00:00:00Z')`);
  ins.run('wf_a', null); ins.run('wf_a', null); ins.run('wf_a', 1); ins.run('wf_b', 1);
  assert.throws(() => ins.run('wf_a', 1), /UNIQUE/);
});
