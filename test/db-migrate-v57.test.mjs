import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { migrate, SCHEMA_VERSION } from '../src/core/db.mjs';

const cols = (db, table) => db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);

test('fresh DB is at v57 or later and has the sliced-feature tables', () => {
  const db = new DatabaseSync(':memory:');
  migrate(db);
  assert.ok(SCHEMA_VERSION >= 57);
  for (const c of ['origin_pipeline_id', 'source_branch', 'replan_ticket_id']) {
    assert.ok(cols(db, 'shape_features').includes(c), `shape_features.${c}`);
  }
  // The v57 columns, in order; later versions append (v58: draft_pr_url).
  assert.deepEqual(cols(db, 'shape_feature_slices').slice(0, 6),
    ['feature_id', 'idx', 'slice_id', 'title', 'ticket_id', 'pipeline_id']);
  assert.deepEqual(cols(db, 'shape_plans'), ['thread_id', 'card_id', 'title', 'created_at']);
});

test('v57 migration creates the tables on a v56 DB', () => {
  const db = new DatabaseSync(':memory:');
  migrate(db);
  db.exec('DROP TABLE shape_plans; DROP TABLE shape_feature_slices; DROP TABLE shape_features; PRAGMA user_version = 56');
  migrate(db);
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION);
  assert.ok(cols(db, 'shape_features').includes('origin_pipeline_id'));
  const idx = db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'shape_features'").all().map((r) => r.name);
  assert.ok(idx.includes('idx_shape_features_origin'));
});

test('deleting a feature cascades its slices', () => {
  const db = new DatabaseSync(':memory:');
  // the pragma is set only on the getDb() connection (db.mjs), so a bare connection must turn it on
  db.exec('PRAGMA foreign_keys = ON');
  migrate(db);
  db.prepare(`INSERT INTO shape_features (id, title, project_dir, origin_pipeline_id, outline, workflow_id, created_at, updated_at)
    VALUES ('f1', 'T', '/p', 'pipe', '{}', 'wf_shape', 'now', 'now')`).run();
  db.prepare("INSERT INTO shape_feature_slices (feature_id, idx, title) VALUES ('f1', 1, 'one'), ('f1', 2, 'two')").run();
  assert.equal(db.prepare('SELECT count(*) n FROM shape_feature_slices').get().n, 2);
  db.prepare("DELETE FROM shape_features WHERE id = 'f1'").run();
  assert.equal(db.prepare('SELECT count(*) n FROM shape_feature_slices').get().n, 0);
});
