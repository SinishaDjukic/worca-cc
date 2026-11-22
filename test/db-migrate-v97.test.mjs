// test/db-migrate-v97.test.mjs — Chat reply style (#1230): ask_threads.verbosity, the chat's own override.
// A comment-only rung: the column comes from INCREMENTAL_COLUMNS, added by the hoisted repairSchemaGaps.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { migrate, SCHEMA_VERSION } from '../src/core/db.mjs';

const cols = (db, t) => db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);
const version = (db) => db.prepare('PRAGMA user_version').get().user_version;

test('a v96 DB gains ask_threads.verbosity (null for old rows), stamped current', () => {
  const db = new DatabaseSync(':memory:'); migrate(db); assert.equal(SCHEMA_VERSION, 97);
  db.exec('ALTER TABLE ask_threads DROP COLUMN verbosity'); db.exec('PRAGMA user_version = 96');
  assert.equal(cols(db, 'ask_threads').includes('verbosity'), false);
  db.prepare("INSERT INTO ask_threads (id, created_at, updated_at) VALUES ('ask_00000001', 'x', 'x')").run();
  migrate(db);
  assert.equal(version(db), SCHEMA_VERSION);
  assert.ok(cols(db, 'ask_threads').includes('verbosity'));
  assert.equal(db.prepare("SELECT verbosity FROM ask_threads WHERE id = 'ask_00000001'").get().verbosity, null);
});
test('stamped current without it: healed on open, the stamp untouched', () => {
  const db = new DatabaseSync(':memory:'); migrate(db);
  db.exec('ALTER TABLE ask_threads DROP COLUMN verbosity');
  migrate(db);
  assert.ok(cols(db, 'ask_threads').includes('verbosity'));
  assert.equal(version(db), SCHEMA_VERSION);
});
