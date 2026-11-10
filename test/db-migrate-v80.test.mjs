// test/db-migrate-v80.test.mjs — req_export_setups and req_export_links (plans/requirements-a6-design.md §3). A3 took v78
// and dev took v79 (run_groups.name_source), so A6, first written as v79, is v80: a DB at 79 (stamped by A6's early
// numbering, without dev's column), at 77 (A8), at 78 (stamped by A3's numbering, none of A6's tables), at A8's early 75,
// at upstream's 74–76, from below 72, or a fresh one reaches 80 with both tables.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { migrate, SCHEMA_VERSION } from '../src/core/db.mjs';

const cols = (db, t) => db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);
const SETUP_COLS = ['scope_type', 'scope_key', 'plugin', 'source_id', 'profile', 'tracker_project', 'tracker_project_name', 'issue_type',
  'issue_type_name', 'labels_json', 'priority', 'priority_name', 'criteria_json', 'done_status', 'created_by', 'created_at', 'updated_by',
  'updated_at'];
const LINK_COLS = ['feature_seq', 'plugin', 'source_id', 'profile', 'tracker_project', 'ticket_key', 'ticket_url', 'created_at', 'exported_at',
  'spec_json', 'fields_json', 'fingerprint', 'pending_marker', 'pending_at', 'updated_by', 'updated_at', 'origin'];
const version = (db) => db.prepare('PRAGMA user_version').get().user_version;

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
  assert.deepEqual(cols(db, 'req_export_setups'), SETUP_COLS);
  assert.deepEqual(cols(db, 'req_export_links'), LINK_COLS);
  assert.ok(cols(db, 'req_attachments').length, 'req_attachments (v77)');
  assert.deepEqual(shape(db), FRESH, 'every table, column and index a fresh DB has');
}
const A6 = 'DROP TABLE req_export_setups; DROP TABLE req_export_links;';
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

test('a fresh DB has both export tables', () => {
  const db = new DatabaseSync(':memory:');
  migrate(db);
  assert.ok(SCHEMA_VERSION >= 80);
  assertComplete(db);
});

test("a DB stamped 79 by A6's early numbering (A6's tables, no run_groups.name_source) reaches the current version complete", () => {
  const db = fromStamp(`ALTER TABLE run_groups DROP COLUMN name_source;
    INSERT INTO run_groups (id, title, created_at, updated_at) VALUES ('grp_1', 'A', 'x', 'x');
    INSERT INTO req_export_links (feature_seq, plugin, source_id, tracker_project, ticket_key, updated_at)
      VALUES (7, 'jira-source', 'jira', 'SHOP', 'SHOP-1', 't');`, 79);
  assertComplete(db);
  assert.ok(cols(db, 'run_groups').includes('name_source'), "dev's v79 column");
  assert.equal(db.prepare("SELECT name_source FROM run_groups WHERE id = 'grp_1'").get().name_source, 'user');
  assert.equal(db.prepare('SELECT ticket_key FROM req_export_links WHERE feature_seq = 7').get().ticket_key, 'SHOP-1', "A6's link kept");
});

test('a DB at 77 (A8) gets both tables', () => assertComplete(fromStamp(A6, 77)));

test("a DB stamped 78 by A3's numbering (none of A6's tables) gets both tables", () => assertComplete(fromStamp(A6, 78)));

test("a DB at A8's early 75 (A8 tables, no upstream v75/v76) reaches the current version complete", () => {
  assertComplete(fromStamp(`${A6} ${UP76} ${UP75}`, 75));
});

test("a DB at upstream's 76, 75 or 74 (no A8, no A6) reaches the current version complete", () => {
  assertComplete(fromStamp(`${A6} ${A8}`, 76));
  assertComplete(fromStamp(`${A6} ${A8} ${UP76}`, 75));
  assertComplete(fromStamp(`${A6} ${A8} ${UP76} ${UP75}`, 74));
});

test('a DB from below 72 (upstream 70 or 71: no requirements tables) reaches the current version complete', () => {
  for (const [stamp, extra] of [[70, ' DROP TABLE utility_cost_ledger;'], [71, '']]) {
    assertComplete(fromStamp(`${A6} DROP TABLE req_attachments; DROP TABLE req_briefs; DROP TABLE req_starts; DROP TABLE req_cost_ledger;
      DROP TABLE req_contexts; DROP TABLE req_turns; DROP TABLE req_features;${extra}`, stamp));
  }
});

test('a DB stamped past this version without the tables is repaired', () => {
  const db = fromStamp(A6, SCHEMA_VERSION + 1);
  assert.deepEqual(cols(db, 'req_export_setups'), SETUP_COLS);
  assert.deepEqual(cols(db, 'req_export_links'), LINK_COLS);
});

test("a setup row takes its defaults: labels '[\"worca\"]', criteria to the description, no priority", () => {
  const db = new DatabaseSync(':memory:');
  migrate(db);
  db.prepare(`INSERT INTO req_export_setups (scope_type, scope_key, plugin, source_id, tracker_project, tracker_project_name, issue_type,
    issue_type_name, created_at, updated_at) VALUES ('project', 'shop-1', 'jira-source', 'jira', 'SHOP', 'SHOP — Shop web', '10001', 'Story', 't', 't')`).run();
  const r = db.prepare('SELECT * FROM req_export_setups').get();
  assert.deepEqual([r.labels_json, r.criteria_json, r.priority, r.profile, r.done_status], ['["worca"]', '{"target":"description"}', null, null, null]);
  db.prepare("INSERT INTO req_export_links (feature_seq, plugin, source_id, tracker_project, updated_at) VALUES (7, 'jira-source', 'jira', 'SHOP', 't')").run();
  const l = db.prepare('SELECT * FROM req_export_links').get();
  assert.deepEqual([l.ticket_key, l.ticket_url, l.pending_marker, l.fingerprint], [null, null, null, null]);
});
