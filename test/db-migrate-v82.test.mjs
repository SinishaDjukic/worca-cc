// test/db-migrate-v82.test.mjs — req_export_links.origin and req_attachments.fetch_json (plans/requirements-a61-design.md §3, D13).
// A3 took v78, dev v79 (run_groups.name_source), A6 v80 and security #854 v81 (guardrail default), so A6.1, first written as
// v80 and then v81, is v82: a fresh DB, one at 81 (#854), one stamped 81 by A6.1's previous numbering, one at 80 (A6), one
// stamped 80 by A6.1's early numbering, 79 (dev), 78 (A3 only), 77 (A8), and upstream's 76–74 and 71–70 reach 82 with
// both columns, 'export' and NULL on the rows already there.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { migrate, SCHEMA_VERSION } from '../src/core/db.mjs';

const cols = (db, t) => db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);
const version = (db) => db.prepare('PRAGMA user_version').get().user_version;
/** Every table with its columns (sorted: a repaired column is appended, not in DDL order) and every index name. */
function shape(db) {
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
  const out = {};
  for (const { name } of tables) out[name] = cols(db, name).sort();
  out['#indexes'] = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map((r) => r.name);
  return out;
}
const FRESH = (() => { const db = new DatabaseSync(':memory:'); migrate(db); return shape(db); })();
function assertComplete(db) {
  assert.equal(version(db), SCHEMA_VERSION);
  assert.ok(cols(db, 'req_export_links').includes('origin'), 'req_export_links.origin');
  assert.ok(cols(db, 'req_attachments').includes('fetch_json'), 'req_attachments.fetch_json');
  assert.deepEqual(shape(db), FRESH, 'every table, column and index a fresh DB has');
}
const A61 = 'ALTER TABLE req_export_links DROP COLUMN origin; ALTER TABLE req_attachments DROP COLUMN fetch_json;';
const A6 = 'DROP TABLE req_export_setups; DROP TABLE req_export_links;';
const A3 = 'DROP TABLE req_helper_messages; ALTER TABLE req_cost_ledger DROP COLUMN helper_message_id;';
const A8 = 'DROP TABLE req_attachments; ALTER TABLE req_cost_ledger DROP COLUMN attachment_id; ALTER TABLE req_starts DROP COLUMN files_json;';
const FETCH = 'ALTER TABLE req_attachments DROP COLUMN fetch_json;';
const DEV79 = 'ALTER TABLE run_groups DROP COLUMN name_source;';
const UP76 = 'ALTER TABLE ask_threads DROP COLUMN group_id; DROP TABLE ask_chat_groups;';
const UP75 = 'ALTER TABLE ask_threads DROP COLUMN pinned_at; ALTER TABLE ask_threads DROP COLUMN archived_at;';
const fromStamp = (sql, stamp, seed = '') => {
  const db = new DatabaseSync(':memory:');
  migrate(db);
  db.exec(`${sql} ${seed} PRAGMA user_version = ${stamp}`);
  migrate(db);
  return db;
};

test('a fresh DB has both columns', () => {
  const db = new DatabaseSync(':memory:');
  migrate(db);
  assert.ok(SCHEMA_VERSION >= 82);
  assertComplete(db);
});

for (const [stamp, label] of [[81, 'security #854'], [80, 'A6']]) {
  test(`a DB at ${stamp} (${label}) gets both columns; its link rows read 'export', its files NULL`, () => {
    const seed = `INSERT INTO req_export_links (feature_seq, plugin, source_id, tracker_project, ticket_key, updated_at)
        VALUES (7, 'jira-source', 'jira', 'SHOP', 'SHOP-123', 't');
      INSERT INTO req_attachments (id, owner_type, owner_id, name, kind, mime, bytes, sha256, status, created_at, updated_at)
        VALUES ('ratt_0123456789ab', 'feature', 7, 'a.md', 'text', 'text/markdown', 1, 'x', 'done', 't', 't');`;
    const db = fromStamp(A61, stamp, seed);
    assertComplete(db);
    assert.equal(db.prepare('SELECT origin FROM req_export_links WHERE feature_seq = 7').get().origin, 'export');
    assert.equal(db.prepare("SELECT fetch_json FROM req_attachments WHERE id = 'ratt_0123456789ab'").get().fetch_json, null);
  });
}

test("a DB stamped 81 by A6.1's previous numbering (both columns already there) reaches the current version complete", () => {
  const seed = `INSERT INTO req_export_links (feature_seq, plugin, source_id, tracker_project, ticket_key, updated_at, origin)
      VALUES (8, 'jira-source', 'jira', 'SHOP', 'SHOP-124', 't', 'import');
    INSERT INTO req_attachments (id, owner_type, owner_id, name, kind, mime, bytes, sha256, status, created_at, updated_at, fetch_json)
      VALUES ('ratt_0123456789ab', 'feature', 8, 'a.png', 'image', 'image/png', 1, 'x', 'downloading', 't', 't', '{"key":"SHOP-124"}');`;
  const db = fromStamp('', 81, seed);
  assertComplete(db);
  assert.equal(db.prepare('SELECT origin FROM req_export_links WHERE feature_seq = 8').get().origin, 'import', "A6.1's link kept");
  assert.equal(db.prepare("SELECT fetch_json FROM req_attachments WHERE id = 'ratt_0123456789ab'").get().fetch_json, '{"key":"SHOP-124"}');
});

test("a DB stamped 80 by A6.1's early numbering (both columns, no run_groups.name_source) reaches the current version complete", () => {
  const seed = `INSERT INTO run_groups (id, title, created_at, updated_at) VALUES ('grp_1', 'A', 'x', 'x');
    INSERT INTO req_export_links (feature_seq, plugin, source_id, tracker_project, ticket_key, updated_at, origin)
      VALUES (8, 'jira-source', 'jira', 'SHOP', 'SHOP-124', 't', 'import');
    INSERT INTO req_attachments (id, owner_type, owner_id, name, kind, mime, bytes, sha256, status, created_at, updated_at, fetch_json)
      VALUES ('ratt_0123456789ab', 'feature', 8, 'a.png', 'image', 'image/png', 1, 'x', 'downloading', 't', 't', '{"key":"SHOP-124"}');`;
  const db = fromStamp(DEV79, 80, seed);
  assertComplete(db);
  assert.equal(db.prepare("SELECT name_source FROM run_groups WHERE id = 'grp_1'").get().name_source, 'user', "dev's v79 column");
  assert.equal(db.prepare('SELECT origin FROM req_export_links WHERE feature_seq = 8').get().origin, 'import', "A6.1's link kept");
  assert.equal(db.prepare("SELECT fetch_json FROM req_attachments WHERE id = 'ratt_0123456789ab'").get().fetch_json, '{"key":"SHOP-124"}');
});

test("a DB stamped 80 with A6.1's fetch_json but none of A6's v80 tables gets A6's tables and the origin column", () => {
  const seed = `INSERT INTO req_attachments (id, owner_type, owner_id, name, kind, mime, bytes, sha256, status, created_at, updated_at, fetch_json)
      VALUES ('ratt_0123456789ab', 'feature', 8, 'a.png', 'image', 'image/png', 1, 'x', 'downloading', 't', 't', '{"key":"SHOP-124"}');`;
  const db = fromStamp(`${A6} ${DEV79}`, 80, seed);
  assertComplete(db);
  assert.ok(cols(db, 'req_export_setups').length, "A6's req_export_setups");
  assert.ok(cols(db, 'run_groups').includes('name_source'), "dev's v79 column");
  assert.equal(db.prepare("SELECT fetch_json FROM req_attachments WHERE id = 'ratt_0123456789ab'").get().fetch_json, '{"key":"SHOP-124"}');
});

test('a DB at 79 (dev: no A6 tables) reaches the current version complete', () => {
  assertComplete(fromStamp(`${A6} ${FETCH}`, 79));
});

test('a DB at 78 (A3, no A6 tables) and at 77 (A8) reach the current version complete', () => {
  assertComplete(fromStamp(`${A6} ${DEV79} ${FETCH}`, 78));
  assertComplete(fromStamp(`${A6} ${A3} ${DEV79} ${FETCH}`, 77));
});

test("a DB at upstream's 76, 75 or 74 (no A8, A3, A6) reaches the current version complete", () => {
  assertComplete(fromStamp(`${A6} ${A3} ${A8}`, 76));
  assertComplete(fromStamp(`${A6} ${A3} ${A8} ${UP76}`, 75));
  assertComplete(fromStamp(`${A6} ${A3} ${A8} ${UP76} ${UP75}`, 74));
});

test('a DB from below 72 (upstream 70 or 71: no requirements tables) reaches the current version complete', () => {
  for (const [stamp, extra] of [[70, ' DROP TABLE utility_cost_ledger;'], [71, '']]) {
    assertComplete(fromStamp(`${A6} DROP TABLE req_helper_messages; DROP TABLE req_attachments; DROP TABLE req_briefs; DROP TABLE req_starts;
      DROP TABLE req_cost_ledger; DROP TABLE req_contexts; DROP TABLE req_turns; DROP TABLE req_features;${extra}`, stamp));
  }
});

test('a DB stamped past this version without the columns is repaired', () => {
  const db = fromStamp(A61, SCHEMA_VERSION + 1);
  assert.ok(cols(db, 'req_export_links').includes('origin'));
  assert.ok(cols(db, 'req_attachments').includes('fetch_json'));
});
