// test/db-migrate-v76.test.mjs — ask_threads.group_id + ask_chat_groups (issue #948 slice 3, topic groups).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { migrate, SCHEMA_VERSION } from '../src/core/db.mjs';

const cols = (db, t) => db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);
const version = (db) => db.prepare('PRAGMA user_version').get().user_version;

test('fresh DB: ask_threads.group_id is last and ask_chat_groups exists', () => {
  const db = new DatabaseSync(':memory:');
  migrate(db);
  assert.ok(SCHEMA_VERSION >= 76);
  assert.equal(cols(db, 'ask_threads').at(-1), 'group_id');
  assert.deepEqual(cols(db, 'ask_chat_groups'), ['id', 'name', 'name_source', 'created_by', 'created_at', 'updated_at']);
});

test('a DB stamped 75 without them gets both and is stamped current', () => {
  const db = new DatabaseSync(':memory:');
  migrate(db);
  db.exec('ALTER TABLE ask_threads DROP COLUMN group_id; DROP TABLE ask_chat_groups; PRAGMA user_version = 75');
  migrate(db);
  assert.equal(version(db), SCHEMA_VERSION);
  assert.ok(cols(db, 'ask_threads').includes('group_id'));
  assert.ok(cols(db, 'ask_chat_groups').includes('name_source'));
});
