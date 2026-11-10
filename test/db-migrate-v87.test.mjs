// test/db-migrate-v87.test.mjs — the PR-when-done columns: pipelines.pr_auto, workspaces.settings_json, shape_features.pr_*.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { migrate, SCHEMA_VERSION } from '../src/core/db.mjs';

const cols = (db, t) => db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);
const version = (db) => db.prepare('PRAGMA user_version').get().user_version;
const WANT = { pipelines: ['pr_auto'], workspaces: ['settings_json'], shape_features: ['pr_open', 'pr_slices', 'pr_source', 'pr_outcome'] };
const hasAll = (db) => Object.entries(WANT).every(([t, cs]) => cs.every((c) => cols(db, t).includes(c)));

test('fresh DB: the v87 columns exist', () => {
  const db = new DatabaseSync(':memory:');
  migrate(db);
  assert.ok(SCHEMA_VERSION >= 87);
  assert.ok(hasAll(db));
});

test('a DB stamped 86 without them gets them, existing rows read NULL, and is stamped current', () => {
  const db = new DatabaseSync(':memory:');
  migrate(db);
  db.exec(`ALTER TABLE pipelines DROP COLUMN pr_auto; ALTER TABLE workspaces DROP COLUMN settings_json;
    ALTER TABLE shape_features DROP COLUMN pr_open; ALTER TABLE shape_features DROP COLUMN pr_slices;
    ALTER TABLE shape_features DROP COLUMN pr_source; ALTER TABLE shape_features DROP COLUMN pr_outcome; PRAGMA user_version = 86`);
  migrate(db);
  assert.equal(version(db), SCHEMA_VERSION);
  assert.ok(hasAll(db));
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM pipelines WHERE pr_auto IS NOT NULL').get().n, 0);
});

test('a DB stamped current without them is healed, its stamp untouched', () => {
  const db = new DatabaseSync(':memory:');
  migrate(db);
  db.exec(`ALTER TABLE shape_features DROP COLUMN pr_outcome; ALTER TABLE workspaces DROP COLUMN settings_json; PRAGMA user_version = ${SCHEMA_VERSION}`);
  migrate(db);
  assert.equal(version(db), SCHEMA_VERSION);
  assert.ok(hasAll(db));
});
