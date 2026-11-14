// test/db-migrate-v90.test.mjs — ask_threads.labels (Stillhet chat labels).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { migrate, SCHEMA_VERSION } from '../src/core/db.mjs';

const cols = (db, t) => db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);

test('a DB stamped 89 without ask_threads.labels gains it, keeps its chats (labels NULL) and is stamped current', () => {
  const db = new DatabaseSync(':memory:');
  migrate(db);
  db.exec("ALTER TABLE ask_threads DROP COLUMN labels; PRAGMA user_version = 89");
  db.prepare("INSERT INTO ask_threads (id, created_at, updated_at) VALUES ('ask_00000001', 'x', 'x')").run();
  migrate(db);
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION);
  assert.equal(cols(db, 'ask_threads').at(-1), 'labels');
  assert.equal(db.prepare("SELECT labels FROM ask_threads WHERE id = 'ask_00000001'").get().labels, null);
});
