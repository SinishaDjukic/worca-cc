// test/db-migrate-v107.test.mjs — Shaper small runs A4: shape_feature_figures, one row per finished feature (its Care
// position and its figures). A new table and its care index, IF NOT EXISTS; no existing table changes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { migrate, SCHEMA_VERSION } from '../src/core/db.mjs';

const COLS = ['feature_id', 'care', 'figures', 'recorded_at', 'updated_at'];
const cols = (db, t) => db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);
const version = (db) => db.prepare('PRAGMA user_version').get().user_version;
const indexes = (db, t) => db.prepare(`PRAGMA index_list(${t})`).all().map((i) => i.name);
const rows = (db, t, order) => db.prepare(`SELECT * FROM ${t} ORDER BY ${order}`).all().map((r) => ({ ...r }));

test('a fresh DB has shape_feature_figures with its 5 columns and the care index', () => {
  const db = new DatabaseSync(':memory:'); migrate(db);
  assert.ok(SCHEMA_VERSION >= 107);
  assert.equal(version(db), SCHEMA_VERSION);
  assert.deepEqual(cols(db, 'shape_feature_figures'), COLS);
  assert.ok(indexes(db, 'shape_feature_figures').includes('idx_shape_feature_figures_care'));
});

test('a v106 DB migrates: every shape_features row is unchanged, the new table exists and is empty', () => {
  const db = new DatabaseSync(':memory:'); migrate(db);
  db.exec('DROP TABLE shape_feature_figures; PRAGMA user_version = 106');
  const feature = db.prepare(`INSERT INTO shape_features (id, title, project_dir, origin_pipeline_id, source_branch, outline, request_base,
    perspectives, workflow_id, approve_each, status, proposed, merges, removals, created_by, created_at, updated_at, care, care_chosen_by)
    VALUES (?, ?, '/p', ?, 'main', '{"why":"x","slices":[]}', '{}', '["product"]', 'wf_shape', 0, ?, 3, 1, 0, 'ann',
    '2026-11-01T00:00:00.000Z', '2026-11-02T00:00:00.000Z', ?, ?)`);
  feature.run('feat_aaaaaaaaaaaa', 'Charts', 'p1', 'active', 'lean', 'person');
  feature.run('feat_bbbbbbbbbbbb', 'Exports', 'p2', 'canceled', 'balanced', 'default');
  const before = rows(db, 'shape_features', 'id');
  migrate(db);
  assert.equal(version(db), SCHEMA_VERSION);
  assert.deepEqual(rows(db, 'shape_features', 'id'), before);
  assert.deepEqual(cols(db, 'shape_feature_figures'), COLS);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM shape_feature_figures').get().n, 0);
});

test('stamped current without the table: healed on open, the stamp untouched', () => {
  const db = new DatabaseSync(':memory:'); migrate(db);
  db.exec('DROP TABLE shape_feature_figures');
  migrate(db);
  assert.deepEqual(cols(db, 'shape_feature_figures'), COLS);
  assert.equal(version(db), SCHEMA_VERSION);
});
