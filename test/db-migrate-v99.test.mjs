// test/db-migrate-v99.test.mjs — workflow tests, Part 4 (plans/workflow-tests-part4-plan.md Task 1): your criteria, checked by
// Worca. Five tables (judgements, answers, Check the checker rounds, the result you liked, the judge ledger) and the example's
// criteria and checking model. A DB stamped by any earlier state reaches the current version complete.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { migrate, SCHEMA_VERSION } from '../src/core/db.mjs';

const cols = (db, t) => db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);
const stamp = (db) => db.prepare('PRAGMA user_version').get().user_version;
function shape(db) {
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
  const out = {};
  for (const { name } of tables) out[name] = cols(db, name).sort();
  out['#indexes'] = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map((r) => r.name);
  return out;
}
const FRESH = (() => { const db = new DatabaseSync(':memory:'); migrate(db); return shape(db); })();
const NEW_TABLES = ['wf_test_judgements', 'wf_test_judge_answers', 'wf_test_checker_rounds', 'wf_test_liked', 'wf_test_judge_ledger'];
const NO_99 = `${NEW_TABLES.map((t) => `DROP TABLE ${t};`).join(' ')}
  ALTER TABLE wf_test_examples DROP COLUMN criteria; ALTER TABLE wf_test_examples DROP COLUMN judge;`;
const NO_WORKFLOW_TESTS = 'DROP TABLE wf_test_example_projects; DROP TABLE wf_test_run_tries; DROP TABLE wf_test_tries; DROP TABLE wf_test_runs; '
  + 'DROP TABLE wf_test_example_files; DROP TABLE wf_test_examples; ALTER TABLE pipelines DROP COLUMN is_test; '
  + 'DROP TABLE workflow_revisions; ALTER TABLE workflows DROP COLUMN live_version_no;';
const addExample = (db) => db.prepare(`INSERT INTO wf_test_examples (workflow_id, name, created_at, updated_at)
  VALUES ('wf_a', 'Example one', '2026-11-19T00:00:00Z', '2026-11-19T00:00:00Z')`).run();

test('fresh DB: the Part 4 tables and the example columns exist', () => {
  const db = new DatabaseSync(':memory:');
  migrate(db);
  assert.equal(SCHEMA_VERSION, 99);
  assert.deepEqual(cols(db, 'wf_test_judgements'), ['id', 'workflow_id', 'example_id', 'criterion_id', 'criterion_fp', 'model', 'purpose',
    'try_id', 'other_try_id', 'round_id', 'card', 'variant', 'subject', 'met', 'winner', 'reason', 'proof', 'proof_found', 'error',
    'cost_usd', 'ms', 'created_at', 'test_run_id']);   // test_run_id: fix round 3 (INCREMENTAL_COLUMNS, added after the table)
  assert.deepEqual(cols(db, 'wf_test_judge_answers'), ['id', 'judgement_id', 'by_key', 'agree', 'created_at']);
  assert.deepEqual(cols(db, 'wf_test_checker_rounds'), ['id', 'workflow_id', 'example_id', 'criterion_id', 'criterion_fp', 'model',
    'source', 'status', 'detail', 'created_by', 'created_at', 'finished_at']);
  assert.deepEqual(cols(db, 'wf_test_liked'), ['example_id', 'kind', 'name', 'data', 'sha256', 'size', 'from_pipeline', 'created_at']);
  assert.deepEqual(cols(db, 'wf_test_judge_ledger'), ['id', 'workflow_id', 'example_id', 'test_run_id', 'round_id', 'purpose', 'model',
    'engine', 'amount_usd', 'cost_kind', 'ts']);
  for (const c of ['criteria', 'judge']) assert.ok(cols(db, 'wf_test_examples').includes(c), c);
  addExample(db);
  assert.equal(db.prepare('SELECT criteria FROM wf_test_examples').get().criteria, '[]', 'criteria default to an empty list');
});

test('a DB at 98 (Part 3b) gains the Part 4 tables and columns, keeps its examples and is stamped current', () => {
  const db = new DatabaseSync(':memory:');
  migrate(db);
  addExample(db);
  db.exec(`${NO_99} PRAGMA user_version = 98`);
  migrate(db);
  assert.equal(stamp(db), SCHEMA_VERSION);
  assert.deepEqual(shape(db), FRESH, 'every table, column and index a fresh DB has');
  assert.deepEqual({ ...db.prepare('SELECT name, criteria FROM wf_test_examples').get() }, { name: 'Example one', criteria: '[]' });
});

test("a DB at dev's 95 (no workflow tests at all) reaches the current version complete", () => {
  const db = new DatabaseSync(':memory:');
  migrate(db);
  db.exec(`${NO_99} ${NO_WORKFLOW_TESTS} PRAGMA user_version = 95`);
  migrate(db);
  assert.equal(stamp(db), SCHEMA_VERSION);
  assert.deepEqual(shape(db), FRESH);
});

test('a DB at 98 missing one v99 table and one column after a partial cut is repaired', () => {
  const db = new DatabaseSync(':memory:');
  migrate(db);
  db.exec('DROP TABLE wf_test_liked; ALTER TABLE wf_test_examples DROP COLUMN judge; PRAGMA user_version = 98');
  migrate(db);
  assert.deepEqual(shape(db), FRESH);
});

test('a DB already stamped 99 but missing a v99 table and a column (a divergent ladder) is repaired on the fast path', () => {
  const db = new DatabaseSync(':memory:');
  migrate(db);
  db.exec('DROP TABLE wf_test_judge_ledger; ALTER TABLE wf_test_examples DROP COLUMN criteria');
  assert.equal(stamp(db), SCHEMA_VERSION);
  migrate(db);   // db.mjs migrate(): user_version >= SCHEMA_VERSION → reconcileSchema only
  assert.deepEqual(shape(db), FRESH);
});

test('fix round 3: a DB this branch stamped 99 before wf_test_judgements.test_run_id gains the column on the fast path, rows kept', () => {
  const db = new DatabaseSync(':memory:');
  migrate(db);
  db.exec(`ALTER TABLE wf_test_judgements DROP COLUMN test_run_id;
    INSERT INTO wf_test_judgements (workflow_id, example_id, criterion_fp, model, purpose, try_id, error, created_at)
    VALUES ('wf_a', 1, 'fp', 'm', 'try', 7, 'cap', '2026-11-20T00:00:00Z')`);
  assert.equal(stamp(db), SCHEMA_VERSION);
  migrate(db);   // reconcileSchema adds the INCREMENTAL_COLUMNS gap whatever the stamp
  assert.deepEqual(shape(db), FRESH);
  assert.deepEqual({ ...db.prepare('SELECT try_id, error, test_run_id FROM wf_test_judgements').get() }, { try_id: 7, error: 'cap', test_run_id: null });
});
