// test/db-migrate-v62.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { migrate, SCHEMA_VERSION } from '../src/core/db.mjs';

const cols = (db, t) => db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);

test('fresh DB is at v62 or later: notes table, slice kind, round index', () => {
  const db = new DatabaseSync(':memory:'); migrate(db);
  assert.ok(SCHEMA_VERSION >= 62);
  assert.deepEqual(cols(db, 'shape_feature_notes'), ['id', 'feature_id', 'kind', 'text', 'run_index', 'created_by', 'created_at']);
  assert.ok(cols(db, 'shape_feature_slices').includes('kind'));
  assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_pipelines_round_of'").get());
});

test('a v61 DB upgrades: the slice kind column, the notes table and the round index appear', () => {
  const db = new DatabaseSync(':memory:'); migrate(db);
  db.exec('DROP TABLE shape_feature_notes'); db.exec('DROP INDEX idx_pipelines_round_of');
  db.exec('ALTER TABLE shape_feature_slices DROP COLUMN kind');
  db.exec('PRAGMA user_version = 61');
  migrate(db);
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION);
  assert.ok(cols(db, 'shape_feature_slices').includes('kind'));
  assert.ok(cols(db, 'shape_feature_notes').includes('run_index'));
  assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_pipelines_round_of'").get());
});
