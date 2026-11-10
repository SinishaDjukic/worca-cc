// test/db-migrate-v90.test.mjs — designs.models_json: a design's own lead and builder model picks.
// First written as v88; dev took 87 and 88, so the Design tables are v89 and this column is v90.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { migrate, SCHEMA_VERSION } from '../src/core/db.mjs';

const cols = (db, t) => db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);
const version = (db) => db.prepare('PRAGMA user_version').get().user_version;

test('a v89 DB gains designs.models_json, keeps its rows (no pick) and is stamped current', () => {
  const db = new DatabaseSync(':memory:');
  migrate(db);
  assert.ok(SCHEMA_VERSION >= 90);
  db.exec('ALTER TABLE designs DROP COLUMN models_json; PRAGMA user_version = 89');
  db.prepare("INSERT INTO designs (id, title, kind, created_at, updated_at) VALUES ('d_000000000001', 'T', 'web', 'x', 'x')").run();
  migrate(db);
  assert.equal(version(db), SCHEMA_VERSION);
  assert.ok(cols(db, 'designs').includes('models_json'));
  assert.equal(db.prepare("SELECT models_json FROM designs WHERE id = 'd_000000000001'").get().models_json, null);
});

test('a DB stamped current without the column heals on open', () => {
  const db = new DatabaseSync(':memory:');
  migrate(db);
  db.exec('ALTER TABLE designs DROP COLUMN models_json');
  migrate(db);
  assert.ok(cols(db, 'designs').includes('models_json'));
});
