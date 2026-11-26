// test/db-migrate-v106.test.mjs — Shaper small runs A2: shape_features.care, care_chosen_by, care_worca_pick and
// requirement_kinds (the feature's Care position and the kind of each agreed requirement). A comment-only rung: the
// columns come from INCREMENTAL_COLUMNS, added by the hoisted repairSchemaGaps. Nothing else of a row changes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { migrate, SCHEMA_VERSION } from '../src/core/db.mjs';

const NEW = ['care', 'care_chosen_by', 'care_worca_pick', 'requirement_kinds'];
const cols = (db, t) => db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);
const version = (db) => db.prepare('PRAGMA user_version').get().user_version;
const rows = (db, t, order) => db.prepare(`SELECT * FROM ${t} ORDER BY ${order}`).all().map((r) => ({ ...r }));
const dropNew = (db) => db.exec(NEW.map((c) => `ALTER TABLE shape_features DROP COLUMN ${c};`).join(''));

const outline = (n) => JSON.stringify({ why: 'because', agreed: [{ id: 'R-po-1', text: 'People see it' }, { id: 'R-sec-1', text: 'It is safe' }],
  leftOut: [], slices: Array.from({ length: n }, (_, i) => ({ id: `s${i + 1}`, title: `Slice ${i + 1}`, requirements: i ? ['R-sec-1'] : ['R-po-1'] })) });

/** Two features with agreed requirements and their slice rows, written with dev's columns only. */
function seedDevRows(db) {
  const feature = db.prepare(`INSERT INTO shape_features (id, title, project_dir, origin_pipeline_id, source_branch, outline, request_base,
    perspectives, workflow_id, approve_each, status, proposed, merges, removals, replaces, replaced_by, created_by, created_at, updated_at)
    VALUES (?, ?, '/p', ?, 'main', ?, '{"mock":true}', '["product"]', 'wf_shape', ?, ?, 3, 1, 0, NULL, NULL, 'ann', '2026-11-01T00:00:00.000Z', '2026-11-02T00:00:00.000Z')`);
  feature.run('feat_aaaaaaaaaaaa', 'Charts', 'p1', outline(2), 0, 'active');
  feature.run('feat_bbbbbbbbbbbb', 'Exports', 'p2', outline(3), 1, 'canceled');
  db.prepare("UPDATE shape_features SET ship_mode = 'one', pr_open = 'ready', pr_slices = 'one' WHERE id = 'feat_aaaaaaaaaaaa'").run();
  const slice = db.prepare('INSERT INTO shape_feature_slices (feature_id, idx, slice_id, title, ticket_id, pipeline_id, kind) VALUES (?, ?, ?, ?, ?, ?, ?)');
  slice.run('feat_aaaaaaaaaaaa', 1, 's1', 'Slice 1', null, 'p1', null);
  slice.run('feat_aaaaaaaaaaaa', 2, 's2', 'Slice 2', 't2', null, null);
  slice.run('feat_bbbbbbbbbbbb', 1, 's1', 'Slice 1', null, 'p2', null);
  slice.run('feat_bbbbbbbbbbbb', 2, 's2', 'Slice 2', 't3', null, 'extra');
}

test('a fresh DB has the 4 columns on shape_features and no new column on shape_feature_slices', () => {
  const db = new DatabaseSync(':memory:'); migrate(db); assert.ok(SCHEMA_VERSION >= 106);
  for (const c of NEW) assert.ok(cols(db, 'shape_features').includes(c), c);
  assert.deepEqual(cols(db, 'shape_feature_slices'), ['feature_id', 'idx', 'slice_id', 'title', 'ticket_id', 'pipeline_id', 'draft_pr_url', 'kind']);
});

test("a v95 DB in dev's shape: every earlier column of every row is unchanged, the new ones read their defaults", () => {
  const db = new DatabaseSync(':memory:'); migrate(db);
  dropNew(db); db.exec('PRAGMA user_version = 95');
  for (const c of NEW) assert.equal(cols(db, 'shape_features').includes(c), false, c);
  seedDevRows(db);
  const before = { features: rows(db, 'shape_features', 'id'), slices: rows(db, 'shape_feature_slices', 'feature_id, idx'), cols: cols(db, 'shape_features') };
  migrate(db);
  assert.equal(version(db), SCHEMA_VERSION);
  assert.deepEqual(cols(db, 'shape_features'), [...before.cols, ...NEW], 'columns are only added, at the end');
  const after = rows(db, 'shape_features', 'id');
  assert.equal(after.length, 2);
  after.forEach((row, i) => {
    const { care, care_chosen_by, care_worca_pick, requirement_kinds, ...earlier } = row;
    assert.deepEqual(earlier, before.features[i]);
    assert.deepEqual({ care, care_chosen_by, care_worca_pick, requirement_kinds },
      { care: 'balanced', care_chosen_by: 'default', care_worca_pick: null, requirement_kinds: null });
  });
  assert.deepEqual(rows(db, 'shape_feature_slices', 'feature_id, idx'), before.slices);
});

test('stamped current without them: healed on open (the fast path), the stamp untouched', () => {
  const db = new DatabaseSync(':memory:'); migrate(db);
  dropNew(db);
  seedDevRows(db);
  migrate(db);
  for (const c of NEW) assert.ok(cols(db, 'shape_features').includes(c), c);
  assert.equal(version(db), SCHEMA_VERSION);
  assert.deepEqual({ ...db.prepare("SELECT care, care_chosen_by, care_worca_pick, requirement_kinds FROM shape_features WHERE id = 'feat_aaaaaaaaaaaa'").get() },
    { care: 'balanced', care_chosen_by: 'default', care_worca_pick: null, requirement_kinds: null });
});
