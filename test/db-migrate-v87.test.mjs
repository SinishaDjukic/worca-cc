// test/db-migrate-v87.test.mjs — req_export_links.origin and req_attachments.fetch_json (plans/requirements-a61-design.md §3, D13).
// A3 took v78, dev v79 (run_groups.name_source), A6 v80, security #854 v81 (guardrail default), dev's automations #711 v82,
// #943 v83 (ask_messages.engine), #990 v84 (config_workflow_nodes.roles), #1145 and freeform chat #1142 v85
// (req_features.early_start_reason, the chat tables) and #1142 v86 (chat_conversations.header_new_off), so A6.1, first written as v80,
// then v81, v82, v84, v85 and v86, is v87: a fresh DB, one at 86 (#1142), one stamped 86 or 85 by A6.1's previous numberings, one at
// 85 (#1145), 84 (#990), one stamped 84 by an earlier A6.1 numbering, 83 (#943), 82 (#711), one stamped 82 or 81 by A6.1's earlier
// numberings, 81 (#854), 80 (A6), one stamped 80 by A6.1's early numbering, 79 (dev), 78 (A3 only), 77 (A8), and upstream's 76–74
// and 71–70 reach 87 with both columns, 'export' and NULL on the rows already there.
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
const DEV83 = 'ALTER TABLE ask_messages DROP COLUMN engine;';
const DEV82 = 'DROP TABLE automation_rules; DROP TABLE automation_events; DROP TABLE automation_cursors; DROP TABLE automation_deliveries;';
const DEV84 = 'ALTER TABLE config_workflow_nodes DROP COLUMN roles;';
const DEV85 = 'ALTER TABLE req_features DROP COLUMN early_start_reason;';
const DEV86 = 'ALTER TABLE chat_conversations DROP COLUMN header_new_off;';
/** What a DB stamped at or below 81 lacks of dev's v82–v86 (the chat tables heal as INCREMENTAL_TABLES either way). */
const DEV = `${DEV82} ${DEV83} ${DEV84} ${DEV85} ${DEV86}`;
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
  assert.ok(SCHEMA_VERSION >= 87);
  assertComplete(db);
});

for (const [stamp, label, gone] of [[86, '#1142', ''], [85, '#1145', DEV86], [84, '#990', `${DEV85} ${DEV86}`],
  [83, '#943', `${DEV84} ${DEV85} ${DEV86}`], [82, 'automations #711', `${DEV83} ${DEV84} ${DEV85} ${DEV86}`],
  [81, 'security #854', DEV], [80, 'A6', DEV]]) {
  test(`a DB at ${stamp} (${label}) gets both columns; its link rows read 'export', its files NULL`, () => {
    const seed = `INSERT INTO req_export_links (feature_seq, plugin, source_id, tracker_project, ticket_key, updated_at)
        VALUES (7, 'jira-source', 'jira', 'SHOP', 'SHOP-123', 't');
      INSERT INTO req_attachments (id, owner_type, owner_id, name, kind, mime, bytes, sha256, status, created_at, updated_at)
        VALUES ('ratt_0123456789ab', 'feature', 7, 'a.md', 'text', 'text/markdown', 1, 'x', 'done', 't', 't');`;
    const db = fromStamp(`${A61} ${gone}`, stamp, seed);
    assertComplete(db);
    assert.equal(db.prepare('SELECT origin FROM req_export_links WHERE feature_seq = 7').get().origin, 'export');
    assert.equal(db.prepare("SELECT fetch_json FROM req_attachments WHERE id = 'ratt_0123456789ab'").get().fetch_json, null);
  });
}

test("a DB stamped 86 by A6.1's previous numbering (both columns, no #1142 header_new_off) reaches the current version complete", () => {
  const seed = `INSERT INTO req_export_links (feature_seq, plugin, source_id, tracker_project, ticket_key, updated_at, origin)
      VALUES (8, 'jira-source', 'jira', 'SHOP', 'SHOP-124', 't', 'import');
    INSERT INTO req_attachments (id, owner_type, owner_id, name, kind, mime, bytes, sha256, status, created_at, updated_at, fetch_json)
      VALUES ('ratt_0123456789ab', 'feature', 8, 'a.png', 'image', 'image/png', 1, 'x', 'downloading', 't', 't', '{"key":"SHOP-124"}');`;
  const db = fromStamp(DEV86, 86, seed);
  assertComplete(db);
  assert.ok(cols(db, 'chat_conversations').includes('header_new_off'), "#1142's v86 column");
  assert.equal(db.prepare('SELECT origin FROM req_export_links WHERE feature_seq = 8').get().origin, 'import', "A6.1's link kept");
  assert.equal(db.prepare("SELECT fetch_json FROM req_attachments WHERE id = 'ratt_0123456789ab'").get().fetch_json, '{"key":"SHOP-124"}');
});

test("a DB stamped 85 by an earlier A6.1 numbering (both columns, no #1145 or #1142 column) reaches the current version complete", () => {
  const seed = `INSERT INTO req_export_links (feature_seq, plugin, source_id, tracker_project, ticket_key, updated_at, origin)
      VALUES (8, 'jira-source', 'jira', 'SHOP', 'SHOP-124', 't', 'import');
    INSERT INTO req_attachments (id, owner_type, owner_id, name, kind, mime, bytes, sha256, status, created_at, updated_at, fetch_json)
      VALUES ('ratt_0123456789ab', 'feature', 8, 'a.png', 'image', 'image/png', 1, 'x', 'downloading', 't', 't', '{"key":"SHOP-124"}');`;
  const db = fromStamp(`${DEV85} ${DEV86}`, 85, seed);
  assertComplete(db);
  assert.ok(cols(db, 'req_features').includes('early_start_reason'), "#1145's v85 column");
  assert.equal(db.prepare('SELECT origin FROM req_export_links WHERE feature_seq = 8').get().origin, 'import', "A6.1's link kept");
  assert.equal(db.prepare("SELECT fetch_json FROM req_attachments WHERE id = 'ratt_0123456789ab'").get().fetch_json, '{"key":"SHOP-124"}');
});

test("a DB stamped 84 by an earlier A6.1 numbering (both columns, no #990, #1145 or #1142 column) reaches the current version complete", () => {
  const seed = `INSERT INTO req_export_links (feature_seq, plugin, source_id, tracker_project, ticket_key, updated_at, origin)
      VALUES (8, 'jira-source', 'jira', 'SHOP', 'SHOP-124', 't', 'import');
    INSERT INTO req_attachments (id, owner_type, owner_id, name, kind, mime, bytes, sha256, status, created_at, updated_at, fetch_json)
      VALUES ('ratt_0123456789ab', 'feature', 8, 'a.png', 'image', 'image/png', 1, 'x', 'downloading', 't', 't', '{"key":"SHOP-124"}');`;
  const db = fromStamp(`${DEV84} ${DEV85} ${DEV86}`, 84, seed);
  assertComplete(db);
  assert.ok(cols(db, 'config_workflow_nodes').includes('roles'), "#990's v84 column");
  assert.equal(db.prepare('SELECT origin FROM req_export_links WHERE feature_seq = 8').get().origin, 'import', "A6.1's link kept");
  assert.equal(db.prepare("SELECT fetch_json FROM req_attachments WHERE id = 'ratt_0123456789ab'").get().fetch_json, '{"key":"SHOP-124"}');
});

test("a DB stamped 82 by an earlier A6.1 numbering (both columns, none of dev's v82 tables or v83–v86 columns) reaches the current version complete", () => {
  const seed = `INSERT INTO req_export_links (feature_seq, plugin, source_id, tracker_project, ticket_key, updated_at, origin)
      VALUES (8, 'jira-source', 'jira', 'SHOP', 'SHOP-124', 't', 'import');
    INSERT INTO req_attachments (id, owner_type, owner_id, name, kind, mime, bytes, sha256, status, created_at, updated_at, fetch_json)
      VALUES ('ratt_0123456789ab', 'feature', 8, 'a.png', 'image', 'image/png', 1, 'x', 'downloading', 't', 't', '{"key":"SHOP-124"}');`;
  const db = fromStamp(DEV, 82, seed);
  assertComplete(db);
  assert.ok(cols(db, 'automation_rules').length, "dev's v82 automation_rules");
  assert.ok(cols(db, 'ask_messages').includes('engine'), "dev's v83 column");
  assert.equal(db.prepare('SELECT origin FROM req_export_links WHERE feature_seq = 8').get().origin, 'import', "A6.1's link kept");
  assert.equal(db.prepare("SELECT fetch_json FROM req_attachments WHERE id = 'ratt_0123456789ab'").get().fetch_json, '{"key":"SHOP-124"}');
});

test("a DB stamped 81 by an earlier A6.1 numbering (both columns already there) reaches the current version complete", () => {
  const seed = `INSERT INTO req_export_links (feature_seq, plugin, source_id, tracker_project, ticket_key, updated_at, origin)
      VALUES (8, 'jira-source', 'jira', 'SHOP', 'SHOP-124', 't', 'import');
    INSERT INTO req_attachments (id, owner_type, owner_id, name, kind, mime, bytes, sha256, status, created_at, updated_at, fetch_json)
      VALUES ('ratt_0123456789ab', 'feature', 8, 'a.png', 'image', 'image/png', 1, 'x', 'downloading', 't', 't', '{"key":"SHOP-124"}');`;
  const db = fromStamp(DEV, 81, seed);
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
  const db = fromStamp(`${DEV79} ${DEV}`, 80, seed);
  assertComplete(db);
  assert.equal(db.prepare("SELECT name_source FROM run_groups WHERE id = 'grp_1'").get().name_source, 'user', "dev's v79 column");
  assert.equal(db.prepare('SELECT origin FROM req_export_links WHERE feature_seq = 8').get().origin, 'import', "A6.1's link kept");
  assert.equal(db.prepare("SELECT fetch_json FROM req_attachments WHERE id = 'ratt_0123456789ab'").get().fetch_json, '{"key":"SHOP-124"}');
});

test("a DB stamped 80 with A6.1's fetch_json but none of A6's v80 tables gets A6's tables and the origin column", () => {
  const seed = `INSERT INTO req_attachments (id, owner_type, owner_id, name, kind, mime, bytes, sha256, status, created_at, updated_at, fetch_json)
      VALUES ('ratt_0123456789ab', 'feature', 8, 'a.png', 'image', 'image/png', 1, 'x', 'downloading', 't', 't', '{"key":"SHOP-124"}');`;
  const db = fromStamp(`${A6} ${DEV79} ${DEV}`, 80, seed);
  assertComplete(db);
  assert.ok(cols(db, 'req_export_setups').length, "A6's req_export_setups");
  assert.ok(cols(db, 'run_groups').includes('name_source'), "dev's v79 column");
  assert.equal(db.prepare("SELECT fetch_json FROM req_attachments WHERE id = 'ratt_0123456789ab'").get().fetch_json, '{"key":"SHOP-124"}');
});

test('a DB at 79 (dev: no A6 tables) reaches the current version complete', () => {
  assertComplete(fromStamp(`${A6} ${FETCH} ${DEV}`, 79));
});

test('a DB at 78 (A3, no A6 tables) and at 77 (A8) reach the current version complete', () => {
  assertComplete(fromStamp(`${A6} ${DEV79} ${FETCH} ${DEV}`, 78));
  assertComplete(fromStamp(`${A6} ${A3} ${DEV79} ${FETCH} ${DEV}`, 77));
});

test("a DB at upstream's 76, 75 or 74 (no A8, A3, A6) reaches the current version complete", () => {
  assertComplete(fromStamp(`${A6} ${A3} ${A8} ${DEV}`, 76));
  assertComplete(fromStamp(`${A6} ${A3} ${A8} ${UP76} ${DEV}`, 75));
  assertComplete(fromStamp(`${A6} ${A3} ${A8} ${UP76} ${UP75} ${DEV}`, 74));
});

test('a DB from below 72 (upstream 70 or 71: no requirements tables) reaches the current version complete', () => {
  for (const [stamp, extra] of [[70, ' DROP TABLE utility_cost_ledger;'], [71, '']]) {
    assertComplete(fromStamp(`${DEV} ${A6} DROP TABLE req_helper_messages; DROP TABLE req_attachments; DROP TABLE req_briefs; DROP TABLE req_starts;
      DROP TABLE req_cost_ledger; DROP TABLE req_contexts; DROP TABLE req_turns; DROP TABLE req_features;${extra}`, stamp));
  }
});

test('a DB stamped past this version without the columns is repaired', () => {
  const db = fromStamp(A61, SCHEMA_VERSION + 1);
  assert.ok(cols(db, 'req_export_links').includes('origin'));
  assert.ok(cols(db, 'req_attachments').includes('fetch_json'));
});
