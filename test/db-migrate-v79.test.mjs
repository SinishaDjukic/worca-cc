// test/db-migrate-v79.test.mjs — workflow history + named versions (plans/workflow-tests-plan.md Task 1, #721).
// This rung was v78 on feat/workflow-tests until dev took 78 for req_helper_messages (test/db-migrate-v78.test.mjs).
// A DB at dev's 78, at 77, a DB that branch already stamped 78 (workflow_revisions, no req_helper_messages), or a fresh
// one reaches the current version complete.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { migrate, SCHEMA_VERSION } from '../src/core/db.mjs';

const cols = (db, t) => db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);
const version = (db) => db.prepare('PRAGMA user_version').get().user_version;
const hasIndex = (db, name) => db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type='index' AND name=?").get(name).n === 1;
const REV_COLS = ['id', 'workflow_id', 'version_no', 'note', 'name', 'domain', 'graph', 'fingerprint', 'parts', 'source', 'made_by', 'created_at'];

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
  assert.ok(version(db) >= 79);
  assert.equal(version(db), SCHEMA_VERSION);
  assert.deepEqual(cols(db, 'workflow_revisions'), REV_COLS);
  assert.ok(hasIndex(db, 'idx_workflow_revisions_wf'), 'index idx_workflow_revisions_wf');
  assert.ok(hasIndex(db, 'idx_workflow_revisions_version'), 'index idx_workflow_revisions_version');
  assert.ok(cols(db, 'workflows').includes('live_version_no'), 'workflows.live_version_no');
  assert.ok(cols(db, 'req_helper_messages').length, 'req_helper_messages (v78)');
  assert.ok(cols(db, 'req_cost_ledger').includes('helper_message_id'), 'req_cost_ledger.helper_message_id (v78)');
  assert.deepEqual(shape(db), FRESH, 'every table, column and index a fresh DB has');
}
const WF = 'ALTER TABLE workflows DROP COLUMN live_version_no; DROP TABLE workflow_revisions;';
const A3 = 'DROP TABLE req_helper_messages; ALTER TABLE req_cost_ledger DROP COLUMN helper_message_id;';
const fromStamp = (sql, stamp) => {
  const db = new DatabaseSync(':memory:');
  migrate(db);
  db.exec(`${sql} PRAGMA user_version = ${stamp}`);
  migrate(db);
  return db;
};

test('fresh DB: workflow_revisions exists and workflows has live_version_no', () => {
  const db = new DatabaseSync(':memory:');
  migrate(db);
  assert.ok(SCHEMA_VERSION >= 79);
  assertComplete(db);
});

test("a DB at dev's 78 (req_helper_messages, no workflow revisions) gets both and is stamped current", () => {
  assertComplete(fromStamp(WF, 78));
});

test('a DB stamped 77 without either gets both and is stamped current', () => {
  assertComplete(fromStamp(`${WF} ${A3}`, 77));
});

test("a DB feat/workflow-tests stamped 78 (workflow_revisions, no req_helper_messages) reaches the current version complete", () => {
  const db = new DatabaseSync(':memory:');
  migrate(db);
  db.prepare(`INSERT INTO workflow_revisions (workflow_id, version_no, name, graph, fingerprint, source, created_at)
    VALUES ('wf_a', 1, 'W', '{}', 'f', 'version', '2026-10-25T00:00:00Z')`).run();
  db.exec(`${A3} PRAGMA user_version = 78`);
  migrate(db);
  assertComplete(db);
  const kept = db.prepare('SELECT workflow_id, version_no FROM workflow_revisions').all().map((r) => ({ ...r }));
  assert.deepEqual(kept, [{ workflow_id: 'wf_a', version_no: 1 }], 'the revisions it already had are kept');
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
