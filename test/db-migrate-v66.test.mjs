// test/db-migrate-v66.test.mjs — v66 (Shaper s4): the draft release columns on shape_features and pipelines
// and shape_features.ship_closed,
// INCREMENTAL_COLUMNS added by the hoisted repairSchemaGaps (a comment rung only).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { migrate, SCHEMA_VERSION } from '../src/core/db.mjs';

const RELEASE = ['release_version', 'release_target', 'release_url', 'release_at', 'release_error'];
const cols = (db, table) => db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);

test('fresh DB is at v66 or later with the release columns on shape_features and pipelines', () => {
  const db = new DatabaseSync(':memory:');
  migrate(db);
  assert.ok(SCHEMA_VERSION >= 66);
  for (const t of ['shape_features', 'pipelines']) for (const c of RELEASE) assert.ok(cols(db, t).includes(c), `${t}.${c}`);
  assert.ok(cols(db, 'shape_features').includes('ship_closed'));
});

test('a v65 DB gains the eleven columns and reaches the current version', () => {
  const db = new DatabaseSync(':memory:');
  migrate(db);
  for (const t of ['shape_features', 'pipelines']) for (const c of RELEASE) db.exec(`ALTER TABLE ${t} DROP COLUMN ${c}`);
  db.exec('ALTER TABLE shape_features DROP COLUMN ship_closed');
  db.exec('PRAGMA user_version = 65');
  assert.ok(!cols(db, 'pipelines').includes('release_version'));
  migrate(db);
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION);
  for (const t of ['shape_features', 'pipelines']) for (const c of RELEASE) assert.ok(cols(db, t).includes(c), `${t}.${c}`);
  assert.ok(cols(db, 'shape_features').includes('ship_closed'));
});
