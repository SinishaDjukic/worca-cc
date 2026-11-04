// test/db-migrate-v78.test.mjs — req_helper_messages and req_cost_ledger.helper_message_id (plans/requirements-a3-design.md §3).
// A database at 77 (A8), at A8's early 75, at upstream's 74–76, from below 72, or a fresh one reaches 78 complete.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { migrate, SCHEMA_VERSION } from '../src/core/db.mjs';

const cols = (db, t) => db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);
const COLS = ['id', 'feature_seq', 'role', 'text', 'focus_json', 'round_turn_id', 'drafts_json', 'proposals_json', 'error_json',
  'cost_usd', 'model', 'created_by', 'created_at', 'updated_by', 'updated_at'];
const version = (db) => db.prepare('PRAGMA user_version').get().user_version;
const hasIndex = (db, name) => db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type='index' AND name=?").get(name).n === 1;

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
  assert.equal(version(db), SCHEMA_VERSION);
  assert.deepEqual(cols(db, 'req_helper_messages'), COLS);
  assert.ok(hasIndex(db, 'req_helper_messages_feature'), 'index req_helper_messages_feature');
  for (const c of ['brief_id', 'attachment_id', 'helper_message_id']) assert.ok(cols(db, 'req_cost_ledger').includes(c), `req_cost_ledger.${c}`);
  assert.ok(cols(db, 'req_attachments').length, 'req_attachments (v77)');
  assert.deepEqual(shape(db), FRESH, 'every table, column and index a fresh DB has');
}
const A3 = 'DROP TABLE req_helper_messages; ALTER TABLE req_cost_ledger DROP COLUMN helper_message_id;';
const A8 = 'DROP TABLE req_attachments; ALTER TABLE req_cost_ledger DROP COLUMN attachment_id; ALTER TABLE req_starts DROP COLUMN files_json;';
const UP76 = 'ALTER TABLE ask_threads DROP COLUMN group_id; DROP TABLE ask_chat_groups;';
const UP75 = 'ALTER TABLE ask_threads DROP COLUMN pinned_at; ALTER TABLE ask_threads DROP COLUMN archived_at;';
const fromStamp = (sql, stamp) => {
  const db = new DatabaseSync(':memory:');
  migrate(db);
  db.exec(`${sql} PRAGMA user_version = ${stamp}`);
  migrate(db);
  return db;
};

test('a fresh DB has req_helper_messages, its index and the ledger column', () => {
  const db = new DatabaseSync(':memory:');
  migrate(db);
  assert.ok(SCHEMA_VERSION >= 78);
  assertComplete(db);
});

test('a DB at 77 (A8) gets the table, its index and the column', () => assertComplete(fromStamp(A3, 77)));

test("a DB at A8's early 75 (A8 tables, no upstream v75/v76) reaches the current version complete", () => {
  assertComplete(fromStamp(`${A3} ${UP76} ${UP75}`, 75));
});

test("a DB at upstream's 76, 75 or 74 (no A8, no A3) reaches the current version complete", () => {
  assertComplete(fromStamp(`${A3} ${A8}`, 76));
  assertComplete(fromStamp(`${A3} ${A8} ${UP76}`, 75));
  assertComplete(fromStamp(`${A3} ${A8} ${UP76} ${UP75}`, 74));
});

test('a DB from below 72 (upstream 70 or 71: no requirements tables) reaches the current version complete', () => {
  for (const [stamp, extra] of [[70, ' DROP TABLE utility_cost_ledger;'], [71, '']]) {
    assertComplete(fromStamp(`DROP TABLE req_helper_messages; DROP TABLE req_attachments; DROP TABLE req_briefs; DROP TABLE req_starts;
      DROP TABLE req_cost_ledger; DROP TABLE req_contexts; DROP TABLE req_turns; DROP TABLE req_features;${extra}`, stamp));
  }
});

test('a DB stamped past this version without the table or the column is repaired', () => {
  const db = fromStamp(A3, SCHEMA_VERSION + 1);
  assert.deepEqual(cols(db, 'req_helper_messages'), COLS);
  assert.ok(cols(db, 'req_cost_ledger').includes('helper_message_id'));
});

test("a row takes its defaults: drafts and proposals '[]', no focus, no error", () => {
  const db = new DatabaseSync(':memory:');
  migrate(db);
  db.prepare("INSERT INTO req_helper_messages (feature_seq, role, created_at, updated_at) VALUES (1, 'po', 't', 't')").run();
  const r = db.prepare('SELECT * FROM req_helper_messages').get();
  assert.deepEqual([r.text, r.drafts_json, r.proposals_json, r.focus_json, r.error_json, r.cost_usd], ['', '[]', '[]', null, null, null]);
});
