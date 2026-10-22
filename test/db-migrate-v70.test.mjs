// test/db-migrate-v70.test.mjs — v70: ask_attachments.source_run_id / source_project_key / source_rel, where a show_files
// copy found under a run or project came from (Show in folder's fallback, docs/show-files.md). INCREMENTAL_COLUMNS
// entries added by the hoisted repairSchemaGaps (a comment rung only).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { migrate, SCHEMA_VERSION } from '../src/core/db.mjs';

const cols = (db, table) => db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
const NEW = ['source_run_id', 'source_project_key', 'source_rel'];

test('fresh DB is at v70 or later with the three source origin columns', () => {
  const db = new DatabaseSync(':memory:');
  migrate(db);
  assert.ok(SCHEMA_VERSION >= 70);
  for (const c of NEW) assert.ok(cols(db, 'ask_attachments').includes(c), c);
});

test('a v69 DB gains the columns, its rows keep NULL (today\'s Show in folder), and it reaches the current version', () => {
  const db = new DatabaseSync(':memory:');
  migrate(db);
  db.exec(`${NEW.map((c) => `ALTER TABLE ask_attachments DROP COLUMN ${c};`).join(' ')} PRAGMA user_version = 69`);
  db.exec(`INSERT INTO ask_threads (id, created_at, updated_at) VALUES ('ask_00000001', 'x', 'x')`);
  db.exec(`INSERT INTO ask_attachments (id, thread_id, message_id, name, bytes, created_at, source_path) VALUES ('att_00000001', 'ask_00000001', NULL, 'a.png', 1, 'x', '/r/a.png')`);
  migrate(db);
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION);
  const row = db.prepare("SELECT source_path, source_run_id, source_project_key, source_rel FROM ask_attachments WHERE id = 'att_00000001'").get();
  assert.deepEqual({ ...row }, { source_path: '/r/a.png', source_run_id: null, source_project_key: null, source_rel: null });
});
