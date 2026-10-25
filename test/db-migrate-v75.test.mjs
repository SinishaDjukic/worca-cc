// test/db-migrate-v75.test.mjs — ask_threads.archived_at / pinned_at (issue #948 slice 2, the Chats column).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { migrate, SCHEMA_VERSION } from '../src/core/db.mjs';

const cols = (db, t) => db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);
const version = (db) => db.prepare('PRAGMA user_version').get().user_version;

test('fresh DB: ask_threads has archived_at and pinned_at, last', () => {
  const db = new DatabaseSync(':memory:');
  migrate(db);
  assert.ok(SCHEMA_VERSION >= 75);
  assert.deepEqual(cols(db, 'ask_threads').slice(-2), ['archived_at', 'pinned_at']);
});

test('a DB stamped 74 without the columns gets both and is stamped current', () => {
  const db = new DatabaseSync(':memory:');
  migrate(db);
  db.exec('ALTER TABLE ask_threads DROP COLUMN pinned_at; ALTER TABLE ask_threads DROP COLUMN archived_at; PRAGMA user_version = 74');
  migrate(db);
  assert.equal(version(db), SCHEMA_VERSION);
  assert.ok(cols(db, 'ask_threads').includes('archived_at'));
  assert.ok(cols(db, 'ask_threads').includes('pinned_at'));
});
