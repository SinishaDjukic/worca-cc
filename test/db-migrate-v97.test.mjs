// test/db-migrate-v97.test.mjs — perspective_choices (proposedPerspectives: the run card's proposed perspectives and
// what the person dropped and added; ids only, never prompt text).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { migrate, SCHEMA_VERSION } from '../src/core/db.mjs';

const cols = (db, t) => db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);
const version = (db) => db.prepare('PRAGMA user_version').get().user_version;
const indexes = (db) => db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'perspective_choices'").all().map((r) => r.name);
const COLS = ['id', 'run_id', 'surface', 'kind', 'proposed', 'chosen', 'dropped', 'added', 'at'];

test('fresh DB: the table has exactly its 9 columns (no text) and its run index', () => {
  const db = new DatabaseSync(':memory:');
  migrate(db);
  assert.ok(SCHEMA_VERSION >= 97);
  assert.equal(version(db), SCHEMA_VERSION);
  assert.deepEqual(cols(db, 'perspective_choices'), COLS);
  assert.deepEqual(indexes(db), ['idx_perspective_choices_run']);
});

test('a DB stamped 96 without the table gains it and is stamped current', () => {
  const db = new DatabaseSync(':memory:');
  migrate(db);
  db.exec('DROP TABLE perspective_choices; PRAGMA user_version = 96');
  migrate(db);
  assert.equal(version(db), SCHEMA_VERSION);
  assert.deepEqual(cols(db, 'perspective_choices'), COLS);
  assert.deepEqual(indexes(db), ['idx_perspective_choices_run']);
});
