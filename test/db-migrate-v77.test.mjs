// test/db-migrate-v77.test.mjs — ask_messages.engine (issue #943, a chat that switches engines).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { migrate, SCHEMA_VERSION } from '../src/core/db.mjs';

const cols = (db, t) => db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);
const version = (db) => db.prepare('PRAGMA user_version').get().user_version;

test('fresh DB: ask_messages.engine is last', () => {
  const db = new DatabaseSync(':memory:');
  migrate(db);
  assert.ok(SCHEMA_VERSION >= 77);
  assert.equal(cols(db, 'ask_messages').at(-1), 'engine');
});

test('a DB stamped 76 without it gets it, keeps its rows, and is stamped current', () => {
  const db = new DatabaseSync(':memory:');
  migrate(db);
  db.exec('ALTER TABLE ask_messages DROP COLUMN engine; PRAGMA user_version = 76');
  db.exec("INSERT INTO ask_threads (id, created_at, updated_at) VALUES ('ask_00000001', 't', 't')");
  db.exec("INSERT INTO ask_messages (id, thread_id, seq, role, created_at) VALUES ('askm_00000001', 'ask_00000001', 1, 'user', 't')");
  migrate(db);
  assert.equal(version(db), SCHEMA_VERSION);
  assert.ok(cols(db, 'ask_messages').includes('engine'));
  assert.equal(db.prepare('SELECT engine FROM ask_messages').get().engine, null);
});
