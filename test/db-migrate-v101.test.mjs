// test/db-migrate-v101.test.mjs — ask_messages.superseded_by (a voice merge hides the turn it replaces, docs/speech.md).
// A comment-only rung: the column comes from INCREMENTAL_COLUMNS, added by the hoisted repairSchemaGaps. First written as v89, then v96, v97 and v100 (Requirements 9c took 89; the Requirements run note took 96; the tool panel and design chats took 97–99; Levels took 100).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { migrate, SCHEMA_VERSION } from '../src/core/db.mjs';

const cols = (db, t) => db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);
const version = (db) => db.prepare('PRAGMA user_version').get().user_version;

test('fresh DB: ask_messages.superseded_by exists', () => {
  const db = new DatabaseSync(':memory:');
  migrate(db);
  assert.ok(SCHEMA_VERSION >= 101);
  assert.ok(cols(db, 'ask_messages').includes('superseded_by'));
});

test('a DB stamped 100 without it gets it, keeps its rows (shown: NULL), and is stamped current', () => {
  const db = new DatabaseSync(':memory:');
  migrate(db);
  assert.ok(SCHEMA_VERSION >= 101);
  db.exec('ALTER TABLE ask_messages DROP COLUMN superseded_by; PRAGMA user_version = 100');
  db.exec("INSERT INTO ask_threads (id, created_at, updated_at) VALUES ('ask_00000001', 't', 't')");
  db.exec("INSERT INTO ask_messages (id, thread_id, seq, role, created_at) VALUES ('askm_00000001', 'ask_00000001', 1, 'user', 't')");
  migrate(db);
  assert.equal(version(db), SCHEMA_VERSION);
  assert.ok(cols(db, 'ask_messages').includes('superseded_by'));
  assert.equal(db.prepare('SELECT superseded_by FROM ask_messages').get().superseded_by, null);
});

test('a DB stamped 100 (superseded_by already there) is stamped current and keeps the column', () => {
  const db = new DatabaseSync(':memory:');
  migrate(db);
  assert.ok(SCHEMA_VERSION >= 101);
  db.exec('PRAGMA user_version = 100');
  migrate(db);
  assert.equal(version(db), SCHEMA_VERSION);
  assert.ok(cols(db, 'ask_messages').includes('superseded_by'));
});

test('stamped current without it: healed on open, the stamp untouched', () => {
  const db = new DatabaseSync(':memory:');
  migrate(db);
  db.exec('ALTER TABLE ask_messages DROP COLUMN superseded_by');
  migrate(db);
  assert.ok(cols(db, 'ask_messages').includes('superseded_by'));
  assert.equal(version(db), SCHEMA_VERSION);
});
