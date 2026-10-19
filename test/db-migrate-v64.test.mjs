// test/db-migrate-v64.test.mjs — v64: ask_attachments.source_path, the real path a show_files copy came from (Show in
// folder, docs/show-files.md). An INCREMENTAL_COLUMNS entry added by the hoisted repairSchemaGaps (a comment rung only).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { migrate, SCHEMA_VERSION } from '../src/core/db.mjs';

const cols = (db, table) => db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);

test('fresh DB is at v64 or later with ask_attachments.source_path', () => {
  const db = new DatabaseSync(':memory:');
  migrate(db);
  assert.ok(SCHEMA_VERSION >= 64);
  assert.ok(cols(db, 'ask_attachments').includes('source_path'));
});

test('a v63 DB gains the column, its rows keep NULL, and it reaches the current version', () => {
  const db = new DatabaseSync(':memory:');
  migrate(db);
  db.exec(`ALTER TABLE ask_attachments DROP COLUMN source_path; PRAGMA user_version = 63`);
  db.exec(`INSERT INTO ask_threads (id, created_at, updated_at) VALUES ('ask_00000001', 'x', 'x')`);
  db.exec(`INSERT INTO ask_attachments (id, thread_id, message_id, name, bytes, created_at) VALUES ('att_00000001', 'ask_00000001', 'm', 'a.txt', 1, 'x')`);
  migrate(db);
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION);
  assert.ok(cols(db, 'ask_attachments').includes('source_path'));
  assert.equal(db.prepare("SELECT source_path FROM ask_attachments WHERE id = 'att_00000001'").get().source_path, null);
});
