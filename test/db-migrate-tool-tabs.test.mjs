// test/db-migrate-tool-tabs.test.mjs — v87 (#1064 slice 3; first written as v84): the tool panel's tab mirror. A DB one rung back gains
// tool_tabs and keeps its rows; a DB stamped current without it (another branch's ladder) gains it on the fast path.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { migrate, SCHEMA_VERSION } from '../src/core/db.mjs';

const tables = (db) => db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name);
const cols = (db, t) => db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);

test('a fresh DB has tool_tabs with its columns', () => {
  const db = new DatabaseSync(':memory:'); migrate(db);
  assert.ok(SCHEMA_VERSION >= 87);
  assert.deepEqual(cols(db, 'tool_tabs'), ['owner', 'scope', 'id', 'kind', 'url', 'target', 'opened_by', 'delivered', 'at', 'pos']);
});

test('a DB one rung back gains tool_tabs and keeps its rows', () => {
  const db = new DatabaseSync(':memory:'); migrate(db);
  db.exec(`DROP TABLE tool_tabs; PRAGMA user_version = ${SCHEMA_VERSION - 1}`);
  db.prepare("INSERT INTO store_meta (key, kind, data) VALUES ('k', 'setting', '1')").run();
  migrate(db);
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION);
  assert.ok(tables(db).includes('tool_tabs'));
  assert.equal(db.prepare("SELECT data FROM store_meta WHERE key = 'k'").get().data, '1');
  db.prepare("INSERT INTO tool_tabs (scope, id, kind, at) VALUES ('chat:ask_00000001', 'tab_a', 'files', 1)").run();
  assert.deepEqual({ ...db.prepare('SELECT owner, opened_by, delivered, pos FROM tool_tabs').get() }, { owner: '', opened_by: 'user', delivered: 1, pos: 0 });
});

test('a DB stamped current without tool_tabs gains it (INCREMENTAL_TABLES, the fast path)', () => {
  const db = new DatabaseSync(':memory:'); migrate(db);
  db.exec('DROP TABLE tool_tabs');
  migrate(db);
  assert.ok(tables(db).includes('tool_tabs'));
});

test('a v84 tool_tabs without target gains it (INCREMENTAL_COLUMNS)', () => {
  const db = new DatabaseSync(':memory:'); migrate(db);
  db.exec('ALTER TABLE tool_tabs DROP COLUMN target');
  migrate(db);
  assert.ok(cols(db, 'tool_tabs').includes('target'));
});
