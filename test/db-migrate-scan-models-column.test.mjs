// test/db-migrate-scan-models-column.test.mjs — workspaces.scan_models_json, the per-workspace
// scan-model pick captured at creation. An INCREMENTAL_COLUMNS entry: a DB without the column
// gains it on open through the hoisted repairSchemaGaps + reconcileSchema (no ladder step of its
// own — dev's v57 is the shape-slices ladder, so this test lives under its own name and stamps
// the DB at the CURRENT version to exercise the fast path, never a re-run of the ladder).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { useTempHome } from './helpers/temp-home.mjs';
import { getDb, SCHEMA_VERSION, _resetForTests } from '../src/core/db.mjs';

useTempHome(after);
const cols = (db, t) => db.prepare(`PRAGMA table_info(${t})`).all().map((r) => r.name);

test('a DB at the current version missing workspaces.scan_models_json gains it on open', () => {
  let db = getDb();
  assert.ok(cols(db, 'workspaces').includes('scan_models_json'));
  // A DB stamped at the CURRENT version that still lacks the column (a divergent checkout, or an
  // older build's DB): migrate()'s fast path (user_version >= SCHEMA_VERSION) calls
  // reconcileSchema, whose repairSchemaGaps adds the INCREMENTAL column.
  db.exec('ALTER TABLE workspaces DROP COLUMN scan_models_json');
  db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
  assert.ok(!cols(db, 'workspaces').includes('scan_models_json'));
  _resetForTests();
  db = getDb();
  assert.ok(cols(db, 'workspaces').includes('scan_models_json'));
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION);
});
