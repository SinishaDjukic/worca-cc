// test/db-migrate-v94.test.mjs — Design pictures: designs.pictures (the design's Pictures switch, on for old rows) and
// design_pictures (one row per picture ask, D10). First written as v91; dev's run cost cap took 91.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { migrate, SCHEMA_VERSION } from '../src/core/db.mjs';

const cols = (db, t) => db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);
const version = (db) => db.prepare('PRAGMA user_version').get().user_version;
const indexes = (db) => db.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all().map((r) => r.name);

test('a v93 DB gains designs.pictures (on for old rows) and design_pictures, stamped current', () => {
  const db = new DatabaseSync(':memory:'); migrate(db); assert.ok(SCHEMA_VERSION >= 94);
  db.exec('DROP TABLE design_pictures; ALTER TABLE designs DROP COLUMN pictures; PRAGMA user_version = 93');
  db.prepare("INSERT INTO designs (id, title, kind, created_at, updated_at) VALUES ('d_000000000001', 'T', 'web', 'x', 'x')").run();
  migrate(db);
  assert.equal(version(db), SCHEMA_VERSION);
  assert.equal(db.prepare("SELECT pictures FROM designs WHERE id = 'd_000000000001'").get().pictures, 1);
  assert.deepEqual(cols(db, 'design_pictures'), ['id', 'design_id', 'build_id', 'round', 'name', 'shape', 'prompt', 'model', 'state', 'file', 'w', 'h', 'cost_usd', 'ms', 'reason', 'created_at']);
  assert.ok(indexes(db).includes('design_pictures_design'));
});
test('stamped current without them: healed on open, the stamp untouched', () => {
  const db = new DatabaseSync(':memory:'); migrate(db);
  db.exec('DROP TABLE design_pictures; ALTER TABLE designs DROP COLUMN pictures');
  migrate(db);
  assert.ok(cols(db, 'designs').includes('pictures')); assert.ok(cols(db, 'design_pictures').length);
  assert.equal(version(db), SCHEMA_VERSION);
});
