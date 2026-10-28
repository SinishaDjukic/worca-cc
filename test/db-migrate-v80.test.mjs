// test/db-migrate-v80.test.mjs — workflow tests, Part 2 (plans/workflow-tests-part2-plan.md Task 2): five tables + pipelines.is_test.
// This rung was v78 on feat/workflow-tests-part2 until dev took 77 / 78 (req_attachments, req_helper_messages) and Part 1's
// workflow revisions moved to 79 (test/db-migrate-v79.test.mjs). A fresh DB, a DB at Part 1's 79, one at 77, one that branch
// already stamped 78 (revisions + wf_test_* tables, no A8 / A3), or one at Part 1's earlier 77 reaches the current version complete.
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
    'run_key', 'pipeline_id', 'verdict', 'cost_usd', 'started_at', 'finished_at',
    'start_commit', 'disk_bytes', 'setup', 'changes'],   // the last four are v81 (workflow tests 3a)
  wf_test_run_tries: ['run_id', 'try_id', 'side'],
};

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
  assert.ok(stamp(db) >= 80);
  assert.equal(stamp(db), SCHEMA_VERSION);
  for (const [t, want] of Object.entries(TABLES)) assert.deepEqual(cols(db, t), want, t);
  assert.ok(cols(db, 'pipelines').includes('is_test'), 'pipelines.is_test');
  assert.ok(cols(db, 'workflow_revisions').length, 'workflow_revisions (v79)');
  assert.ok(cols(db, 'workflows').includes('live_version_no'), 'workflows.live_version_no (v79)');
  assert.ok(cols(db, 'req_helper_messages').length, 'req_helper_messages (v78)');
  assert.ok(cols(db, 'req_cost_ledger').includes('helper_message_id'), 'req_cost_ledger.helper_message_id (v78)');
  assert.ok(cols(db, 'req_attachments').length, 'req_attachments (v77)');
  assert.ok(cols(db, 'req_cost_ledger').includes('attachment_id'), 'req_cost_ledger.attachment_id (v77)');
  assert.ok(cols(db, 'req_starts').includes('files_json'), 'req_starts.files_json (v77)');
  assert.deepEqual(shape(db), FRESH, 'every table, column and index a fresh DB has');
}
const WT = `ALTER TABLE pipelines DROP COLUMN is_test; ${Object.keys(TABLES).map((t) => `DROP TABLE ${t};`).join(' ')}`;
const WF = 'ALTER TABLE workflows DROP COLUMN live_version_no; DROP TABLE workflow_revisions;';
const A3 = 'DROP TABLE req_helper_messages; ALTER TABLE req_cost_ledger DROP COLUMN helper_message_id;';
const A8 = 'DROP TABLE req_attachments; ALTER TABLE req_cost_ledger DROP COLUMN attachment_id; ALTER TABLE req_starts DROP COLUMN files_json;';
const fromStamp = (sql, at) => {
  const db = new DatabaseSync(':memory:');
  migrate(db);
  db.exec(`${sql} PRAGMA user_version = ${at}`);
  migrate(db);
  return db;
};

test('fresh DB: the workflow test tables exist and pipelines has is_test', () => {
  const db = new DatabaseSync(':memory:');
  migrate(db);
  assert.ok(SCHEMA_VERSION >= 80);
  assertComplete(db);
});

test("a DB at Part 1's 79 (workflow revisions, no workflow tests) gets them all and is stamped current", () => {
  assertComplete(fromStamp(WT, 79));
});

test('a DB stamped 77 without A3, workflow revisions or workflow tests gets them all and is stamped current', () => {
  assertComplete(fromStamp(`${WT} ${WF} ${A3}`, 77));
});

test('a DB feat/workflow-tests-part2 stamped 78 (revisions + wf_test_*, no A8 / A3) reaches the current version complete', () => {
  const db = new DatabaseSync(':memory:');
  migrate(db);
  db.prepare(`INSERT INTO workflow_revisions (workflow_id, version_no, name, graph, fingerprint, source, created_at)
    VALUES ('wf_a', 1, 'W', '{}', 'f', 'version', '2026-10-25T00:00:00Z')`).run();
  db.prepare(`INSERT INTO wf_test_examples (workflow_id, name, created_at, updated_at)
    VALUES ('wf_a', 'Example one', '2026-10-26T00:00:00Z', '2026-10-26T00:00:00Z')`).run();
  db.exec(`${A8} ${A3} PRAGMA user_version = 78`);
  migrate(db);
  assertComplete(db);
  const revs = db.prepare('SELECT workflow_id, version_no FROM workflow_revisions').all().map((r) => ({ ...r }));
  assert.deepEqual(revs, [{ workflow_id: 'wf_a', version_no: 1 }], 'the revisions it already had are kept');
  const examples = db.prepare('SELECT workflow_id, name FROM wf_test_examples').all().map((r) => ({ ...r }));
  assert.deepEqual(examples, [{ workflow_id: 'wf_a', name: 'Example one' }], 'the examples it already had are kept');
});

test("a DB at Part 1's earlier 77 (workflow revisions, no A8 / A3 / workflow tests) reaches the current version complete", () => {
  assertComplete(fromStamp(`${WT} ${A8} ${A3}`, 77));
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
