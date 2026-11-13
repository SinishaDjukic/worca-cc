// test/db-migrate-v92.test.mjs — Design sound: designs.sound_json (the design's sound choice; NULL = not asked yet, D2).
// A comment-only rung: the column comes from INCREMENTAL_COLUMNS, added by the hoisted repairSchemaGaps.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { migrate, SCHEMA_VERSION } from '../src/core/db.mjs';

const cols = (db, t) => db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);
const version = (db) => db.prepare('PRAGMA user_version').get().user_version;

test('a v91 DB gains designs.sound_json (null for old rows), stamped current', () => {
  const db = new DatabaseSync(':memory:'); migrate(db); assert.ok(SCHEMA_VERSION >= 92);
  db.exec('ALTER TABLE designs DROP COLUMN sound_json; PRAGMA user_version = 91');
  assert.equal(cols(db, 'designs').includes('sound_json'), false);
  db.prepare("INSERT INTO designs (id, title, kind, created_at, updated_at) VALUES ('d_000000000001', 'T', 'web', 'x', 'x')").run();
  migrate(db);
  assert.equal(version(db), SCHEMA_VERSION);
  assert.ok(cols(db, 'designs').includes('sound_json'));
  assert.equal(db.prepare("SELECT sound_json FROM designs WHERE id = 'd_000000000001'").get().sound_json, null);
});
test('stamped current without it: healed on open, the stamp untouched', () => {
  const db = new DatabaseSync(':memory:'); migrate(db);
  db.exec('ALTER TABLE designs DROP COLUMN sound_json');
  migrate(db);
  assert.ok(cols(db, 'designs').includes('sound_json'));
  assert.equal(version(db), SCHEMA_VERSION);
});
