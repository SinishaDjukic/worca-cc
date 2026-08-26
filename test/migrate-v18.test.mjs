// test/migrate-v18.test.mjs
//
// v18 adds source_bindings (task-source profiles): which PROFILE of a plugin
// task source a project/workspace pulls from, one row per (scope, plugin,
// source). The ladder step is a plain IF-NOT-EXISTS DDL, and the table also
// lives in INCREMENTAL_TABLES so the version-independent reconcile heals a
// divergently-stamped DB (repo hard rule after two recorded cross-branch stamp
// collisions). Structure mirrors test/migrate-v14.test.mjs.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { useTempHome } from './helpers/temp-home.mjs';
import { getDb, migrate, SCHEMA_VERSION } from '../src/core/db.mjs';

useTempHome(after);

const hasBindings = (db) => db.prepare(
  "SELECT count(*) AS n FROM sqlite_master WHERE type='table' AND name='source_bindings'"
).get().n === 1;

test('fresh DB migrates to the current version with the source_bindings table', () => {
  const db = getDb(); // opens + migrates to SCHEMA_VERSION
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION);
  assert.ok(hasBindings(db), 'source_bindings table exists');
  const cols = db.prepare('PRAGMA table_info(source_bindings)').all().map((c) => c.name);
  assert.deepEqual(cols, ['scope_type', 'scope_key', 'plugin', 'source_id', 'profile', 'updated_at']);
});

test('a v17-stamped DB upgrades in place: source_bindings created, stamp advances', () => {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA user_version = 17'); // pre-profiles DB: ladder runs only the v18 step

  migrate(db);

  assert.equal(db.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION);
  assert.ok(hasBindings(db), 'source_bindings created');
});

test('a current-stamped DB missing the table is healed by the fast-path reconcile, stamp untouched', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`); // divergent-ladder stamp: version says done, schema says otherwise

  migrate(db); // fast path -> reconcileSchema self-heal

  assert.equal(db.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION, 'stamp not rewritten');
  assert.ok(hasBindings(db), 'table healed');
});

test('migrate() is idempotent at v18 (second call is a clean no-op)', () => {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA user_version = 17');
  migrate(db);
  migrate(db); // IF-NOT-EXISTS + fast path: must not throw "table already exists"
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION);
});
