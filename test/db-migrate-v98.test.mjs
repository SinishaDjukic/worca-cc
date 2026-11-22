// test/db-migrate-v98.test.mjs — designs.origin_thread_id: the plain chat that asked for the design (start_design); NULL
// = none, or made before v98. The design's own chat stays thread_id. A comment-only rung: the column comes from
// INCREMENTAL_COLUMNS, added by the hoisted repairSchemaGaps.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { migrate, SCHEMA_VERSION } from '../src/core/db.mjs';

const cols = (db, t) => db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);
const version = (db) => db.prepare('PRAGMA user_version').get().user_version;

test('a v97 DB gains designs.origin_thread_id (null for old rows), stamped current', () => {
  const db = new DatabaseSync(':memory:'); migrate(db); assert.ok(SCHEMA_VERSION >= 98);
  db.exec('ALTER TABLE designs DROP COLUMN origin_thread_id; PRAGMA user_version = 97');
  assert.equal(cols(db, 'designs').includes('origin_thread_id'), false);
  db.prepare("INSERT INTO designs (id, title, kind, thread_id, created_at, updated_at) VALUES ('d_000000000001', 'T', 'web', 't1', 'x', 'x')").run();
  migrate(db);
  assert.equal(version(db), SCHEMA_VERSION);
  assert.ok(cols(db, 'designs').includes('origin_thread_id'));
  assert.deepEqual({ ...db.prepare("SELECT thread_id, origin_thread_id FROM designs WHERE id = 'd_000000000001'").get() },
    { thread_id: 't1', origin_thread_id: null });
});
test('stamped current without it: healed on open, the stamp untouched', () => {
  const db = new DatabaseSync(':memory:'); migrate(db);
  db.exec('ALTER TABLE designs DROP COLUMN origin_thread_id');
  migrate(db);
  assert.ok(cols(db, 'designs').includes('origin_thread_id'));
  assert.equal(version(db), SCHEMA_VERSION);
});
