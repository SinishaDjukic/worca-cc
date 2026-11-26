// test/db-migrate-v105.test.mjs — workflow tests, Part 4 (plans/workflow-tests-part4-plan.md Task 1): your criteria, checked by
// Worca. Five tables (judgements, answers, Check the checker rounds, the result you liked, the judge ledger) and the example's
// criteria and checking model. This rung was v99 on feat/workflow-tests-part4 until dev took 96–100 (req_starts.note /
// note_overrides, tool_tabs, designs.origin_thread_id, the design chats reset, pipelines.finished_at / credit_key:
// test/db-migrate-v96.test.mjs to test/db-migrate-v100.test.mjs) and Parts 1 to 3 moved to 101 to 103, then v104 until dev
// took 101 (ask_messages.superseded_by, test/db-migrate-v101.test.mjs) and Parts 1 to 3 moved to 102 to 104. A DB that branch
// stamped 99 has every workflow-tests table but none of dev's 96–101 and skips dev's v99 reset's old gate (`current < 99`). A
// DB it stamped 104 has every workflow-tests table and dev's 96–100 but not dev's 101. A DB stamped by any earlier state
// reaches the current version complete.
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
const NO_105 = `${NEW_TABLES.map((t) => `DROP TABLE ${t};`).join(' ')}
  ALTER TABLE wf_test_examples DROP COLUMN criteria; ALTER TABLE wf_test_examples DROP COLUMN judge;`;
const NO_WORKFLOW_TESTS = 'DROP TABLE wf_test_example_projects; DROP TABLE wf_test_run_tries; DROP TABLE wf_test_tries; DROP TABLE wf_test_runs; '
  + 'DROP TABLE wf_test_example_files; DROP TABLE wf_test_examples; ALTER TABLE pipelines DROP COLUMN is_test; '
  + 'DROP TABLE workflow_revisions; ALTER TABLE workflows DROP COLUMN live_version_no;';
// dev's rung 101 (ask_messages.superseded_by, a voice merge) that a DB at dev's 100 or below, and every DB these branches
// stamped, never ran.
const DEV101 = 'ALTER TABLE ask_messages DROP COLUMN superseded_by;';
// dev's rungs 96–101 (req_starts.note / note_overrides, tool_tabs, designs.origin_thread_id, pipelines.finished_at / credit_key,
// with the run clock pipelines.elapsed_ms / elapsed_since, which have no rung of their own; v99 is a data step; and
// ask_messages.superseded_by) that a DB at dev's 95 or below, and every DB these branches stamped below 100, never ran.
const DEV96_101 = 'ALTER TABLE req_starts DROP COLUMN note; ALTER TABLE req_starts DROP COLUMN note_overrides; DROP TABLE tool_tabs; '
  + 'ALTER TABLE designs DROP COLUMN origin_thread_id; ALTER TABLE pipelines DROP COLUMN finished_at; '
  + `ALTER TABLE pipelines DROP COLUMN credit_key; ALTER TABLE pipelines DROP COLUMN elapsed_ms; ALTER TABLE pipelines DROP COLUMN elapsed_since; ${DEV101}`;
const addExample = (db) => db.prepare(`INSERT INTO wf_test_examples (workflow_id, name, created_at, updated_at)
  VALUES ('wf_a', 'Example one', '2026-11-19T00:00:00Z', '2026-11-19T00:00:00Z')`).run();

test('fresh DB: the Part 4 tables and the example columns exist', () => {
  const db = new DatabaseSync(':memory:');
  migrate(db);
  assert.ok(SCHEMA_VERSION >= 105);
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

test('a DB at 104 (Part 3b) gains the Part 4 tables and columns, keeps its examples and is stamped current', () => {
  const db = new DatabaseSync(':memory:');
  migrate(db);
  addExample(db);
  db.exec(`${NO_105} PRAGMA user_version = 104`);
  migrate(db);
  assert.equal(stamp(db), SCHEMA_VERSION);
  assert.deepEqual(shape(db), FRESH, 'every table, column and index a fresh DB has');
  assert.deepEqual({ ...db.prepare('SELECT name, criteria FROM wf_test_examples').get() }, { name: 'Example one', criteria: '[]' });
});

test("a DB this branch stamped 103 (Part 3b: no Part 4, dev's 96–100, no dev's 101) gains them all, keeps its examples and is stamped current", () => {
  const db = new DatabaseSync(':memory:');
  migrate(db);
  addExample(db);
  db.exec(`${DEV101} ${NO_105} PRAGMA user_version = 103`);
  migrate(db);
  assert.equal(stamp(db), SCHEMA_VERSION);
  assert.deepEqual(shape(db), FRESH, 'every table, column and index a fresh DB has');
  assert.deepEqual({ ...db.prepare('SELECT name, criteria FROM wf_test_examples').get() }, { name: 'Example one', criteria: '[]' });
});

test("a DB this branch stamped 104 (Part 4, dev's 96–100, no dev's 101) reaches the current version complete, its rows kept", () => {
  const db = new DatabaseSync(':memory:');
  migrate(db);
  addExample(db);
  db.prepare(`INSERT INTO wf_test_judgements (workflow_id, example_id, criterion_fp, model, purpose, try_id, met, created_at)
    VALUES ('wf_a', 1, 'fp', 'm', 'try', 7, 1, '2026-11-22T00:00:00Z')`).run();
  db.exec("INSERT INTO ask_threads (id, created_at, updated_at) VALUES ('ask_00000001', 't', 't')");
  db.exec("INSERT INTO ask_messages (id, thread_id, seq, role, created_at) VALUES ('askm_00000001', 'ask_00000001', 1, 'user', 't')");
  db.exec(`${DEV101} PRAGMA user_version = 104`);
  migrate(db);
  assert.equal(stamp(db), SCHEMA_VERSION);
  assert.ok(cols(db, 'ask_messages').includes('superseded_by'), 'ask_messages.superseded_by (v101)');
  assert.deepEqual(shape(db), FRESH, 'every table, column and index a fresh DB has');
  assert.equal(db.prepare('SELECT superseded_by FROM ask_messages').get().superseded_by, null, 'its messages stay shown');
  assert.deepEqual({ ...db.prepare('SELECT name, criteria FROM wf_test_examples').get() }, { name: 'Example one', criteria: '[]' });
  assert.deepEqual({ ...db.prepare('SELECT try_id, met FROM wf_test_judgements').get() }, { try_id: 7, met: 1 });
});

test("a DB this branch stamped 98 (Part 3b: no Part 4, none of dev's 96–101) gains them all, keeps its examples and is stamped current", () => {
  const db = new DatabaseSync(':memory:');
  migrate(db);
  addExample(db);
  db.exec(`${DEV96_101} ${NO_105} PRAGMA user_version = 98`);
  migrate(db);
  assert.equal(stamp(db), SCHEMA_VERSION);
  assert.deepEqual(shape(db), FRESH, 'every table, column and index a fresh DB has');
  assert.deepEqual({ ...db.prepare('SELECT name, criteria FROM wf_test_examples').get() }, { name: 'Example one', criteria: '[]' });
});

test("a DB this branch stamped 99 (Part 4, none of dev's 96–101) reaches the current version complete: rows kept, a design chat becomes a plain chat", () => {
  const db = new DatabaseSync(':memory:');
  migrate(db);
  addExample(db);
  db.prepare(`INSERT INTO wf_test_judgements (workflow_id, example_id, criterion_fp, model, purpose, try_id, met, created_at)
    VALUES ('wf_a', 1, 'fp', 'm', 'try', 7, 1, '2026-11-20T00:00:00Z')`).run();
  const thread = (id, mode) => db.prepare("INSERT INTO ask_threads (id, title, mode, created_at, updated_at) VALUES (?, 'x', ?, 'x', 'x')").run(id, mode);
  thread('ask_0000000a', 'design'); thread('ask_0000000b', 'composer');
  db.prepare("INSERT INTO designs (id, title, kind, thread_id, created_at, updated_at) VALUES ('d_000000000001', 'T', 'web', 'ask_0000000a', 'x', 'x')").run();
  db.exec(`${DEV96_101} ALTER TABLE wf_test_judgements DROP COLUMN test_run_id; PRAGMA user_version = 99`);
  migrate(db);
  assert.equal(stamp(db), SCHEMA_VERSION);
  assert.deepEqual(shape(db), FRESH, 'every table, column and index a fresh DB has');
  assert.deepEqual({ ...db.prepare('SELECT name, criteria FROM wf_test_examples').get() }, { name: 'Example one', criteria: '[]' });
  assert.deepEqual({ ...db.prepare('SELECT try_id, met, test_run_id FROM wf_test_judgements').get() }, { try_id: 7, met: 1, test_run_id: null });
  const modes = Object.fromEntries(db.prepare('SELECT id, mode FROM ask_threads ORDER BY id').all().map((r) => [r.id, r.mode]));
  assert.deepEqual(modes, { ask_0000000a: null, ask_0000000b: 'composer' }, "dev's v99: the design chat is a plain chat");
  assert.equal(db.prepare("SELECT thread_id FROM designs WHERE id = 'd_000000000001'").get().thread_id, 'ask_0000000a');
});

test("a DB at dev's 101 (no workflow tests at all) reaches the current version complete", () => {
  const db = new DatabaseSync(':memory:');
  migrate(db);
  db.exec(`${NO_105} ${NO_WORKFLOW_TESTS} PRAGMA user_version = 101`);
  migrate(db);
  assert.equal(stamp(db), SCHEMA_VERSION);
  assert.deepEqual(shape(db), FRESH);
});

test("a DB at dev's 100 (no workflow tests at all, no dev's 101) reaches the current version complete, its other rows untouched", () => {
  const db = new DatabaseSync(':memory:');
  migrate(db);
  db.exec(`${DEV101} ${NO_105} ${NO_WORKFLOW_TESTS} PRAGMA user_version = 100`);
  db.prepare("INSERT INTO ask_threads (id, title, mode, created_at, updated_at) VALUES ('ask_0000000c', 'x', 'composer', 'x', 'x')").run();
  migrate(db);
  assert.equal(stamp(db), SCHEMA_VERSION);
  assert.deepEqual(shape(db), FRESH);
  assert.equal(db.prepare("SELECT mode FROM ask_threads WHERE id = 'ask_0000000c'").get().mode, 'composer');
});

test("a DB at dev's 95 (no workflow tests at all, none of dev's 96–101) reaches the current version complete", () => {
  const db = new DatabaseSync(':memory:');
  migrate(db);
  db.exec(`${DEV96_101} ${NO_105} ${NO_WORKFLOW_TESTS} PRAGMA user_version = 95`);
  migrate(db);
  assert.equal(stamp(db), SCHEMA_VERSION);
  assert.deepEqual(shape(db), FRESH);
});

test('a DB at 104 missing one v105 table and one column after a partial cut is repaired', () => {
  const db = new DatabaseSync(':memory:');
  migrate(db);
  db.exec('DROP TABLE wf_test_liked; ALTER TABLE wf_test_examples DROP COLUMN judge; PRAGMA user_version = 104');
  migrate(db);
  assert.deepEqual(shape(db), FRESH);
});

test('a DB already stamped 105 but missing a v105 table and a column (a divergent ladder) is repaired on the fast path', () => {
  const db = new DatabaseSync(':memory:');
  migrate(db);
  db.exec('DROP TABLE wf_test_judge_ledger; ALTER TABLE wf_test_examples DROP COLUMN criteria');
  assert.equal(stamp(db), SCHEMA_VERSION);
  migrate(db);   // db.mjs migrate(): user_version >= SCHEMA_VERSION → reconcileSchema only
  assert.deepEqual(shape(db), FRESH);
});

test('fix round 3: a DB stamped current before wf_test_judgements.test_run_id gains the column on the fast path, rows kept', () => {
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
