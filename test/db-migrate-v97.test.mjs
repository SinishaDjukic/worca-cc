// test/db-migrate-v97.test.mjs — ask_messages.superseded_by (a voice merge hides the turn it replaces, docs/speech.md).
// A comment-only rung: the column comes from INCREMENTAL_COLUMNS, added by the hoisted repairSchemaGaps. First written as v89, then v96 (prompt check s2 took 96; dev later reverted it, #1278, so v96 has no step).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { migrate, SCHEMA_VERSION } from '../src/core/db.mjs';

const cols = (db, t) => db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);
const version = (db) => db.prepare('PRAGMA user_version').get().user_version;

test('fresh DB: ask_messages.superseded_by exists', () => {
  const db = new DatabaseSync(':memory:');
  migrate(db);
  assert.ok(SCHEMA_VERSION >= 97);
  assert.ok(cols(db, 'ask_messages').includes('superseded_by'));
});

test('a DB stamped 96 without it gets it, keeps its rows (shown: NULL), and is stamped current', () => {
  const db = new DatabaseSync(':memory:');
  migrate(db);
  assert.ok(SCHEMA_VERSION >= 97);
  db.exec('ALTER TABLE ask_messages DROP COLUMN superseded_by; PRAGMA user_version = 96');
  db.exec("INSERT INTO ask_threads (id, created_at, updated_at) VALUES ('ask_00000001', 't', 't')");
  db.exec("INSERT INTO ask_messages (id, thread_id, seq, role, created_at) VALUES ('askm_00000001', 'ask_00000001', 1, 'user', 't')");
  migrate(db);
  assert.equal(version(db), SCHEMA_VERSION);
  assert.ok(cols(db, 'ask_messages').includes('superseded_by'));
  assert.equal(db.prepare('SELECT superseded_by FROM ask_messages').get().superseded_by, null);
});

test('a DB this branch stamped 96 (superseded_by already there) is stamped current and keeps the column', () => {
  const db = new DatabaseSync(':memory:');
  migrate(db);
  assert.ok(SCHEMA_VERSION >= 97);
  db.exec('PRAGMA user_version = 96');
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
