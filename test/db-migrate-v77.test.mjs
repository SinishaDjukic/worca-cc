// test/db-migrate-v77.test.mjs — req_attachments, req_cost_ledger.attachment_id and req_starts.files_json
// (plans/requirements-a8-design.md §3). Upstream took v75 (ask_threads.archived_at / pinned_at) and v76
// (ask_chat_groups + ask_threads.group_id) while A8 was in review, so A8's rung is v77; an early A8 checkout
// stamped its DB 75 without upstream's v75/v76 additions, and those reach 77 complete too.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { migrate, SCHEMA_VERSION } from '../src/core/db.mjs';

const cols = (db, t) => db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);
const COLS = ['id', 'owner_type', 'owner_id', 'name', 'kind', 'mime', 'bytes', 'sha256', 'status', 'error_json', 'summary',
  'summary_edited', 'asks_json', 'history_json', 'send_with_run', 'cost_usd', 'read_cost_usd', 'read_model', 'read_at',
  'created_by', 'created_at', 'updated_by', 'updated_at'];
const version = (db) => db.prepare('PRAGMA user_version').get().user_version;
const hasIndex = (db, name) => db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type='index' AND name=?").get(name).n === 1;

/** Every table with its columns (as a sorted set: a repaired column is appended, not in DDL order) and every index name. */
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
  assert.deepEqual(cols(db, 'req_attachments'), COLS);
  assert.ok(cols(db, 'req_cost_ledger').includes('brief_id'), 'req_cost_ledger.brief_id (v74)');
  assert.ok(cols(db, 'req_cost_ledger').includes('attachment_id'), 'req_cost_ledger.attachment_id');
  assert.ok(cols(db, 'req_starts').includes('files_json'), 'req_starts.files_json');
  for (const i of ['req_attachments_owner', 'req_attachments_sha']) assert.ok(hasIndex(db, i), `index ${i}`);
  for (const t of ['req_features', 'req_turns', 'req_contexts', 'req_starts', 'req_briefs']) assert.ok(cols(db, t).length, `${t} exists`);
  for (const c of ['archived_at', 'pinned_at', 'group_id']) assert.ok(cols(db, 'ask_threads').includes(c), `ask_threads.${c} (v75/v76)`);
  assert.ok(cols(db, 'ask_chat_groups').length, 'ask_chat_groups (v76)');
  assert.deepEqual(shape(db), FRESH, 'every table, column and index a fresh DB has');
}

test('fresh DB has req_attachments and both columns', () => {
  const db = new DatabaseSync(':memory:');
  migrate(db);
  assert.ok(SCHEMA_VERSION >= 77);
  assertComplete(db);
});

test('a DB stamped 74 gets the table and both columns', () => {
  const db = new DatabaseSync(':memory:');
  migrate(db);
  db.exec(`DROP TABLE req_attachments; ALTER TABLE req_cost_ledger DROP COLUMN attachment_id;
    ALTER TABLE req_starts DROP COLUMN files_json; ALTER TABLE ask_threads DROP COLUMN group_id; DROP TABLE ask_chat_groups;
    ALTER TABLE ask_threads DROP COLUMN pinned_at; ALTER TABLE ask_threads DROP COLUMN archived_at; PRAGMA user_version = 74`);
  migrate(db);
  assertComplete(db);
});

test('a DB at upstream 75 (chat archive and pin, no topic groups, no A8) reaches 77 with every table', () => {
  const db = new DatabaseSync(':memory:');
  migrate(db);
  db.exec(`DROP TABLE req_attachments; ALTER TABLE req_cost_ledger DROP COLUMN attachment_id;
    ALTER TABLE req_starts DROP COLUMN files_json; ALTER TABLE ask_threads DROP COLUMN group_id; DROP TABLE ask_chat_groups;
    PRAGMA user_version = 75`);
  migrate(db);
  assertComplete(db);
});

test('a DB at upstream 76 (topic groups, no A8) reaches 77 with every table', () => {
  const db = new DatabaseSync(':memory:');
  migrate(db);
  db.exec(`DROP TABLE req_attachments; ALTER TABLE req_cost_ledger DROP COLUMN attachment_id;
    ALTER TABLE req_starts DROP COLUMN files_json; PRAGMA user_version = 76`);
  migrate(db);
  assertComplete(db);
});

test('a DB stamped 75 by the early A8 numbering (A8 tables, no upstream v75/v76) reaches 77 with every table', () => {
  const db = new DatabaseSync(':memory:');
  migrate(db);
  db.prepare(`INSERT INTO req_attachments (id, owner_type, owner_id, name, kind, mime, bytes, sha256, status,
    created_at, updated_at) VALUES ('ratt_000000000001', 'feature', 1, 'a.md', 'text', 'text/markdown', 1, 'abc', 'done', 't', 't')`).run();
  db.exec(`ALTER TABLE ask_threads DROP COLUMN group_id; DROP TABLE ask_chat_groups;
    ALTER TABLE ask_threads DROP COLUMN pinned_at; ALTER TABLE ask_threads DROP COLUMN archived_at; PRAGMA user_version = 75`);
  migrate(db);
  assertComplete(db);
  assert.equal(db.prepare('SELECT name FROM req_attachments').get().name, 'a.md', 'the early rows survive');
});

test('a DB from below 72 (upstream 70 or 71: no requirements tables) reaches the current version with all of it', () => {
  for (const [stamp, extra] of [[70, ' DROP TABLE utility_cost_ledger;'], [71, '']]) {
    const db = new DatabaseSync(':memory:');
    migrate(db);
    db.exec(`DROP TABLE req_attachments; DROP TABLE req_briefs; DROP TABLE req_starts; DROP TABLE req_cost_ledger;
      DROP TABLE req_contexts; DROP TABLE req_turns; DROP TABLE req_features;${extra} PRAGMA user_version = ${stamp}`);
    migrate(db);
    assertComplete(db);
  }
});

test('a DB stamped past this version without the table is repaired', () => {
  const db = new DatabaseSync(':memory:');
  migrate(db);
  db.exec(`DROP TABLE req_attachments; PRAGMA user_version = ${SCHEMA_VERSION + 1}`);
  migrate(db);
  assert.deepEqual(cols(db, 'req_attachments'), COLS);
});

test('one content per owner; a start row without files has "[]"', () => {
  const db = new DatabaseSync(':memory:');
  migrate(db);
  const ins = (owner) => db.prepare(`INSERT INTO req_attachments (id, owner_type, owner_id, name, kind, mime, bytes, sha256, status,
    created_at, updated_at) VALUES (?, 'feature', ?, 'a.md', 'text', 'text/markdown', 1, 'abc', 'reading', 't', 't')`).run(`ratt_${owner}00000000000`, owner);
  ins(1);
  assert.throws(() => db.prepare(`INSERT INTO req_attachments (id, owner_type, owner_id, name, kind, mime, bytes, sha256, status,
    created_at, updated_at) VALUES ('ratt_100000000009', 'feature', 1, 'b.md', 'text', 'text/markdown', 1, 'abc', 'reading', 't', 't')`).run(), /UNIQUE/);
  ins(2);
  db.prepare(`INSERT INTO req_starts (feature_seq, version, run_id, spec_json, title, ready, started_at)
    VALUES (1, 1, 'r1', '{}', 't', 1, 't')`).run();
  assert.equal(db.prepare('SELECT files_json FROM req_starts').get().files_json, '[]');
});
