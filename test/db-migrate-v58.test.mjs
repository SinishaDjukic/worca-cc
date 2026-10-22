// test/db-migrate-v58.test.mjs — v58 (D24): the feature's ship state and a slice's draft PR, INCREMENTAL_COLUMNS added
// by the hoisted repairSchemaGaps (a comment rung only).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { migrate, SCHEMA_VERSION } from '../src/core/db.mjs';

const cols = (db, table) => db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);

test('fresh DB is at v58 or later with the ship columns', () => {
  const db = new DatabaseSync(':memory:');
  migrate(db);
  assert.ok(SCHEMA_VERSION >= 58);
  for (const c of ['ship_mode', 'ship_pr_url', 'shipped_at']) assert.ok(cols(db, 'shape_features').includes(c), `shape_features.${c}`);
  assert.ok(cols(db, 'shape_feature_slices').includes('draft_pr_url'));
});

test('a v57 DB gains the four columns and reaches the current version', () => {
  const db = new DatabaseSync(':memory:');
  migrate(db);
  db.exec(`DROP TABLE shape_plans; DROP TABLE shape_feature_slices; DROP TABLE shape_features;
    PRAGMA user_version = 56`);
  migrate(db);                                         // back to a v57 shape: the tables without the v58 columns
  db.exec(`ALTER TABLE shape_features DROP COLUMN ship_mode; ALTER TABLE shape_features DROP COLUMN ship_pr_url;
    ALTER TABLE shape_features DROP COLUMN shipped_at; ALTER TABLE shape_feature_slices DROP COLUMN draft_pr_url;
    PRAGMA user_version = 57`);
  assert.ok(!cols(db, 'shape_features').includes('ship_mode'));
  migrate(db);
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION);
  for (const c of ['ship_mode', 'ship_pr_url', 'shipped_at']) assert.ok(cols(db, 'shape_features').includes(c), `shape_features.${c}`);
  assert.ok(cols(db, 'shape_feature_slices').includes('draft_pr_url'));
});
