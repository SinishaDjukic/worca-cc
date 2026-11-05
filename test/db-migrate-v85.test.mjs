// test/db-migrate-v85.test.mjs — req_features.early_start_reason: the reason kept for starting a feature before Ready.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { migrate, SCHEMA_VERSION } from '../src/core/db.mjs';

const cols = (db, t) => db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);
const version = (db) => db.prepare('PRAGMA user_version').get().user_version;

test('fresh DB: req_features.early_start_reason exists', () => {
  const db = new DatabaseSync(':memory:');
  migrate(db);
  assert.ok(SCHEMA_VERSION >= 85);
  assert.ok(cols(db, 'req_features').includes('early_start_reason'));
});

test('a DB stamped 84 without it gets it, existing rows read NULL, and is stamped current', () => {
  const db = new DatabaseSync(':memory:');
  migrate(db);
  db.exec('ALTER TABLE req_features DROP COLUMN early_start_reason; PRAGMA user_version = 84');
  db.exec(`INSERT INTO req_features (scope_type, scope_key, title, description, status, spec_json, created_at, updated_at)
    VALUES ('project', 'p', 'T', 'D', 'looking', '{}', '2026-01-01', '2026-01-01')`);
  migrate(db);
  assert.equal(version(db), SCHEMA_VERSION);
  assert.ok(cols(db, 'req_features').includes('early_start_reason'));
  assert.equal(db.prepare('SELECT early_start_reason AS r FROM req_features').get().r, null);
});

test('a DB stamped current without the column is healed, its stamp untouched', () => {
  const db = new DatabaseSync(':memory:');
  migrate(db);
  db.exec(`ALTER TABLE req_features DROP COLUMN early_start_reason; PRAGMA user_version = ${SCHEMA_VERSION}`);
  migrate(db);
  assert.equal(version(db), SCHEMA_VERSION);
  assert.ok(cols(db, 'req_features').includes('early_start_reason'));
});
