// test/db-migrate-v96.test.mjs — Requirements run note: req_starts.note + req_starts.note_overrides.
// A comment-only rung: both columns come from INCREMENTAL_COLUMNS, added by the hoisted repairSchemaGaps.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { migrate, SCHEMA_VERSION } from '../src/core/db.mjs';

const cols = (db, t) => db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);
const version = (db) => db.prepare('PRAGMA user_version').get().user_version;
const dropBoth = (db) => db.exec('ALTER TABLE req_starts DROP COLUMN note; ALTER TABLE req_starts DROP COLUMN note_overrides');

test('a v95 DB gains req_starts.note (null) and note_overrides (0) for old rows, stamped current', () => {
  const db = new DatabaseSync(':memory:'); migrate(db); assert.ok(SCHEMA_VERSION >= 96);
  dropBoth(db); db.exec('PRAGMA user_version = 95');
  assert.equal(cols(db, 'req_starts').includes('note'), false);
  assert.equal(cols(db, 'req_starts').includes('note_overrides'), false);
  db.prepare("INSERT INTO req_features (seq, scope_type, scope_key, title, description, status, spec_json, created_at, updated_at) VALUES (1, 'project', 'p', 'T', 'd', 'draft', '{}', 'x', 'x')").run();
  db.prepare(`INSERT INTO req_starts (feature_seq, version, run_id, spec_json, title, ready, failing_json, started_at)
    VALUES (1, 1, 'r1', '{}', 'T', 1, '[]', 'x')`).run();
  migrate(db);
  assert.equal(version(db), SCHEMA_VERSION);
  assert.ok(cols(db, 'req_starts').includes('note'));
  assert.ok(cols(db, 'req_starts').includes('note_overrides'));
  const row = db.prepare("SELECT note, note_overrides FROM req_starts WHERE run_id = 'r1'").get();
  assert.equal(row.note, null);
  assert.equal(row.note_overrides, 0);
});
test('stamped current without them: healed on open, the stamp untouched', () => {
  const db = new DatabaseSync(':memory:'); migrate(db);
  dropBoth(db);
  migrate(db);
  assert.ok(cols(db, 'req_starts').includes('note'));
  assert.ok(cols(db, 'req_starts').includes('note_overrides'));
  assert.equal(version(db), SCHEMA_VERSION);
});
