// v60: seed AND refresh the shipped Promo video workflow (wf_promo_video) as a v2 row — the V41
// (Presentation) / V55 (Architecture) shape for a third shipped graph. A fresh DB and a DB stamped at
// v59 both gain it; an archived row or a user's own live row holding the id is never resurrected or
// rewritten; a user-edited seed is left alone by the refresh that runs on every later bump.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { migrate, getDb, SCHEMA_VERSION } from '../src/core/db.mjs';
import { listWorkflows } from '../src/core/workflows.mjs';
import { validateGraph } from '../src/shared/graph/validate.mjs';
import { realPortsFn } from './helpers/graph-ports.mjs';
import { useTempHome } from './helpers/temp-home.mjs';
import { checkRows } from './helpers/rows.mjs';
import {
  GRAPH_PROMO_VIDEO_WORKFLOW as CUR, PROMO_VIDEO_WORKFLOW_ID as ID, promoVideoGraphFingerprint,
} from '../src/core/graph/promo-video-workflow.mjs';

useTempHome(after);

const rowFor = (db) => db.prepare('SELECT * FROM workflows WHERE id = ?').get(ID);
const freshMigrated = () => { const db = new DatabaseSync(':memory:'); migrate(db); return db; };

test('a fresh home lists wf_promo_video under the video domain, and the stored graph validates', async () => {
  assert.ok(SCHEMA_VERSION >= 60);
  assert.equal(getDb().prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION);
  const listed = (await listWorkflows()).find((w) => w.id === ID);
  assert.ok(listed, 'listed in the Workflows Library');
  assert.equal(listed.name, 'Promo video');
  assert.equal(listed.domain, 'video');
  assert.equal(listed.version, 2);

  const db = freshMigrated();
  try {
    const row = rowFor(db);
    assert.equal(row.origin, null, 'a worca seed, not a plugin row');
    assert.equal(row.archived_at, null);
    const graph = JSON.parse(row.graph);
    assert.equal(promoVideoGraphFingerprint(graph), promoVideoGraphFingerprint(CUR));
    const { errors } = validateGraph({ ...CUR, nodes: graph.nodes, wires: graph.wires }, realPortsFn());
    assert.deepEqual(errors, [], JSON.stringify(errors, null, 1));
  } finally { db.close(); }
});

test('a DB stamped at v59 migrates to the current version and gains the seed; the others are untouched', () => {
  const db = freshMigrated();
  try {
    const before = db.prepare("SELECT id, graph FROM workflows WHERE id <> ? ORDER BY id").all(ID);
    db.prepare('DELETE FROM workflows WHERE id = ?').run(ID);
    db.exec('PRAGMA user_version = 59');
    migrate(db);
    assert.equal(db.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION);
    const row = rowFor(db);
    assert.ok(row, 'seeded on the ladder');
    assert.equal(row.domain, 'video');
    assert.equal(promoVideoGraphFingerprint(JSON.parse(row.graph)), promoVideoGraphFingerprint(CUR));
    assert.deepEqual(db.prepare("SELECT id, graph FROM workflows WHERE id <> ? ORDER BY id").all(ID), before,
      'the Presentation and Architecture seeds are byte-identical');
  } finally { db.close(); }
});

test('INSERT OR IGNORE: an archived row or a user\'s own live row holding the id is never resurrected or rewritten', async () => {
  const holding = (archivedAt) => {
    const db = freshMigrated();
    db.prepare('DELETE FROM workflows WHERE id = ?').run(ID);
    db.prepare(`INSERT INTO workflows (id, name, version, domain, origin, steps, feedbacks, graph, created_at, updated_at, archived_at)
      VALUES (?, 'Mine', 2, 'video', NULL, '[]', '[]', '{"nodes":[],"wires":[]}', 't', 't', ?)`).run(ID, archivedAt);
    db.exec('PRAGMA user_version = 59');
    migrate(db);
    return db;
  };
  await checkRows([
    { name: 'an archived row keeps the id and is not resurrected', run: () => {
      const db = holding('t');
      try {
        const row = rowFor(db);
        assert.equal(row.archived_at, 't');
        assert.equal(row.name, 'Mine');
        assert.equal(row.graph, '{"nodes":[],"wires":[]}');
      } finally { db.close(); }
    } },
    { name: 'a user\'s own live row with the id is left byte-identical', run: () => {
      const db = holding(null);
      try {
        const row = rowFor(db);
        assert.equal(row.name, 'Mine');
        assert.equal(row.graph, '{"nodes":[],"wires":[]}', 'not a shipped shape: the refresh leaves it alone');
      } finally { db.close(); }
    } },
  ]);
});

test('the refresh on a later bump leaves a user-edited seed and a pinned current seed alone', async () => {
  await checkRows([
    { name: 'a seed the user re-wired (a shape worca never shipped) is not touched', run: () => {
      const db = freshMigrated();
      try {
        const edited = { nodes: CUR.nodes, wires: CUR.wires.filter((w) => w.id !== 'w13') };
        db.prepare('UPDATE workflows SET graph = ? WHERE id = ?').run(JSON.stringify(edited), ID);
        db.exec('PRAGMA user_version = 59');
        migrate(db);
        assert.deepEqual(JSON.parse(rowFor(db).graph), edited);
      } finally { db.close(); }
    } },
    { name: 'the current shape with a user\'s model pin and viewport keeps both', run: () => {
      const db = freshMigrated();
      try {
        const nodes = CUR.nodes.map((n) => (n.id === 'n_scenes' ? { ...n, config: { ...n.config, model: 'opus-pinned' } } : n));
        const stored = { nodes, wires: CUR.wires, canvas: { x: 10, y: 20, scale: 0.7 } };
        db.prepare('UPDATE workflows SET graph = ? WHERE id = ?').run(JSON.stringify(stored), ID);
        db.exec('PRAGMA user_version = 59');
        migrate(db);
        assert.deepEqual(JSON.parse(rowFor(db).graph), stored);
      } finally { db.close(); }
    } },
  ]);
});
