// test/db-migrate-v96.test.mjs — prompt_kind_corrections (the prompt check chip's kind corrections, ids only).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { migrate, SCHEMA_VERSION } from '../src/core/db.mjs';

const cols = (db, t) => db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);
const version = (db) => db.prepare('PRAGMA user_version').get().user_version;
const indexes = (db) => db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'prompt_kind_corrections'").all().map((r) => r.name);
const COLS = ['id', 'surface', 'thread_id', 'card_id', 'run_id', 'proposed_kind', 'chosen_kind', 'at'];

test('fresh DB: the table has exactly its 8 columns (no text), and an index on thread_id and on run_id', () => {
  const db = new DatabaseSync(':memory:');
  migrate(db);
  assert.ok(SCHEMA_VERSION >= 96);
  assert.equal(version(db), SCHEMA_VERSION);
  assert.deepEqual(cols(db, 'prompt_kind_corrections'), COLS);
  assert.deepEqual(indexes(db).sort(), ['idx_prompt_kind_corrections_run', 'idx_prompt_kind_corrections_thread']);
});

test('a DB stamped 91 without the table gains it and is stamped current', () => {
  const db = new DatabaseSync(':memory:');
  migrate(db);
  db.exec('DROP TABLE prompt_kind_corrections; PRAGMA user_version = 91');
  migrate(db);
  assert.equal(version(db), SCHEMA_VERSION);
  assert.deepEqual(cols(db, 'prompt_kind_corrections'), COLS);
});

test('a divergent DB stamped current with the table dropped heals on open, and keeps rows on a re-open', () => {
  const db = new DatabaseSync(':memory:');
  migrate(db);
  db.exec('DROP TABLE prompt_kind_corrections');
  migrate(db);
  assert.deepEqual(cols(db, 'prompt_kind_corrections'), COLS);
  db.prepare("INSERT INTO prompt_kind_corrections (surface, thread_id, proposed_kind, chosen_kind, at) VALUES ('chat', 't', 'bug', 'idea', 'x')").run();
  migrate(db);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM prompt_kind_corrections').get().n, 1);
  assert.equal(version(db), SCHEMA_VERSION);
});
