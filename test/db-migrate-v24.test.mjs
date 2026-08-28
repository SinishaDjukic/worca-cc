// test/db-migrate-v24.test.mjs
// V24 = the v2 break (spec §10.2). Reversible by construction: rows are archived,
// never deleted, and a physical .pre-v24.bak is taken before the transaction.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { useTempHome } from './helpers/temp-home.mjs';
import { buildResidueDb } from './helpers/db-residue-v22.mjs';
import { getDb, SCHEMA_VERSION } from '../src/core/db.mjs';
import { SEED_TEMPLATES } from '../src/core/graph/seed-templates.mjs';

useTempHome(after);

test('V24 archives every live v1 template row and stamps the version', () => {
  const fx = buildResidueDb();
  const db = getDb();                                   // triggers migrate() 23 → 24
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION);
  assert.equal(SCHEMA_VERSION, 24);
  const live = db.prepare('SELECT id FROM workflows WHERE version = 1 AND archived_at IS NULL').all();
  assert.deepEqual(live, [], 'no live v1 row survives the break');
  for (const id of fx.v1Ids) {
    const row = db.prepare('SELECT version, steps, archived_at FROM workflows WHERE id = ?').get(id);
    assert.ok(row, `${id} still exists — archived, never deleted`);
    assert.equal(row.version, 1, 'the row is NOT converted');
    assert.notEqual(row.steps, '[]', 'its v1 topology is kept verbatim');
    assert.ok(row.archived_at, `${id} archived`);
  }
  assert.ok(existsSync(`${fx.dbFile}.pre-v24.bak`), 'a physical backup was taken before the tx');
  const report = JSON.parse(db.prepare("SELECT data FROM store_meta WHERE key = 'migration:v24'").get().data);
  assert.deepEqual([...report.archived].sort(), [...fx.v1Ids].sort());
  assert.equal(report.seeded.length, SEED_TEMPLATES.length);
});

test('the 7 seed graphs are inserted on an EXISTING DB, as v2 rows with graph JSON', () => {
  buildResidueDb();
  const db = getDb();
  for (const t of SEED_TEMPLATES) {
    const row = db.prepare('SELECT name, version, domain, origin, steps, feedbacks, graph, created_at, archived_at FROM workflows WHERE id = ?').get(t.id);
    assert.ok(row, `${t.id} inserted`);
    assert.equal(row.version, 2);
    assert.equal(row.name, t.name);
    assert.equal(row.domain, t.domain);
    assert.equal(row.origin, null);
    assert.equal(row.steps, '[]');
    assert.equal(row.feedbacks, '[]');
    assert.equal(row.created_at, t.createdAt, 'the seed keeps its authored createdAt');
    assert.equal(row.archived_at, null);
    const graph = JSON.parse(row.graph);
    assert.deepEqual(Object.keys(graph).sort(), ['nodes', 'wires']);
    assert.equal(graph.nodes.length, t.nodes.length);
    assert.equal(graph.wires.length, t.wires.length);
  }
});

test('the alias folds first and wins, overlays remap, budgets copy to wires, archived actives reset', () => {
  const warnings = [];
  const realWarn = console.warn;
  console.warn = (msg) => warnings.push(String(msg));
  let fx;
  try { fx = buildResidueDb(); getDb(); } finally { console.warn = realWarn; }
  const db = getDb();
  const nodeRows = db.prepare('SELECT workflow_id, node_id, model FROM config_workflow_nodes ORDER BY workflow_id, node_id').all();

  // the seven orphaned n_impl overlays now address REAL rows
  for (const t of SEED_TEMPLATES) {
    assert.ok(nodeRows.some((r) => r.workflow_id === t.id && r.node_id === 'n_impl'),
      `${t.id} keeps its n_impl overlay`);
    assert.ok(db.prepare('SELECT 1 FROM workflows WHERE id = ?').get(t.id), `${t.id} row exists`);
  }

  // COLLISION (a), at REMAP time: the wf_default_v2 overlay is NEWER than the
  // v1-era wf_default/s0_0 one that NODE_ID_MAP renames onto the same id — the
  // alias value must WIN, and the displaced v1-era row must be audited, never
  // dropped in silence.
  const dflt = nodeRows.filter((r) => r.workflow_id === 'wf_default' && r.node_id === 'n_plan');
  assert.equal(dflt.length, 1, 'exactly one wf_default/n_plan overlay survives');
  assert.equal(dflt[0].model, 'claude-sonnet-4-8', 'the wf_default_v2 (v2-era) value wins over the v1-era one');
  assert.ok(warnings.includes('[worca] V24: wf_default: dropped 1 stale "s0_0" overlay row(s) — "n_plan" already carries a newer value'),
    `expected the displaced-row audit line, got: ${JSON.stringify(warnings.filter((w) => w.includes('stale')))}`);

  // COLLISION (b), at FOLD time: an alias row landing on an EXISTING wf_default
  // row must REPLACE it (the alias value is the newer, deliberate one), audited.
  const refine = nodeRows.filter((r) => r.workflow_id === 'wf_default' && r.node_id === 'n_refine');
  assert.equal(refine.length, 1, 'exactly one wf_default/n_refine overlay survives');
  assert.equal(refine[0].model, 'claude-sonnet-4-8', 'INSERT OR REPLACE: the alias row overwrites the older wf_default value');
  assert.ok(warnings.includes('[worca] V24: config_workflow_nodes: 1 wf_default overlay row(s) replaced by the newer wf_default_v2 value'),
    `expected the fold displacement audit line, got: ${JSON.stringify(warnings.filter((w) => w.includes('replaced')))}`);

  // a clean v1-era overlay on a seed id is renamed by NODE_ID_MAP
  assert.ok(nodeRows.some((r) => r.workflow_id === 'wf_quick-fix' && r.node_id === 'n_plan' && r.model === 'claude-haiku-4-8'),
    's0_0 → n_plan (NODE_ID_MAP)');
  assert.equal(nodeRows.some((r) => r.node_id === 's0_0'), false, 'no v1 step id survives');
  assert.equal(nodeRows.some((r) => r.workflow_id === 'wf_default_v2'), false, 'the alias is gone');

  // FB_WIRE_MAP copies wf_no-clarify fb_0/fb_1 = 6 onto w3/w10.
  // node:sqlite returns NULL-PROTOTYPE rows — deepEqual (strict) compares
  // prototypes, so map every row through an object literal before asserting.
  const wires = db.prepare('SELECT wire_id, max_cycles FROM config_workflow_wires WHERE workflow_id = ? ORDER BY wire_id')
    .all('wf_no-clarify').map((r) => ({ wire_id: r.wire_id, max_cycles: r.max_cycles }));
  assert.deepEqual(wires, [{ wire_id: 'w10', max_cycles: 6 }, { wire_id: 'w3', max_cycles: 6 }]);
  assert.equal(db.prepare('SELECT count(*) AS n FROM config_workflow_feedbacks').get().n, 2,
    'the source rows are COPIED, never deleted');

  // a v2 resume point on the alias is remapped; a v1 one is swept, never remapped
  const rp = JSON.parse(db.prepare('SELECT resume_point FROM pipelines WHERE id = ?').get(fx.v2RunId).resume_point);
  assert.equal(rp.workflowId, 'wf_default', 'a v2 resume point on the alias is remapped');
  assert.equal(db.prepare('SELECT resume_point FROM pipelines WHERE id = ?').get(fx.v1AliasRunId).resume_point, null,
    'a v1 point naming the alias is SWEPT, not remapped');

  // an active workflow that was archived falls back to the graph default…
  assert.equal(db.prepare('SELECT active_workflow_id FROM project_config WHERE project_key = ?')
    .get(fx.projectKey).active_workflow_id, 'wf_default');
  // …and one pointing at a LIVE seed is left alone
  assert.equal(db.prepare('SELECT active_workflow_id FROM project_config WHERE project_key = ?')
    .get(fx.projectKeyLive).active_workflow_id, 'wf_quick-fix');
  const report = JSON.parse(db.prepare("SELECT data FROM store_meta WHERE key = 'migration:v24'").get().data);
  assert.deepEqual(report.activeReset, [fx.projectKey], 'only the stranded project is reset');
  // The counters are the only place the `version = 2` filter on the json_set arm
  // is observable: the run it must skip (`run-v1a`) is NULLed by sweepV1Runs a
  // moment later either way, so the resume_point assertion above cannot see the
  // difference. 3 = two folded wf_default overlay rows + the ONE v2 resume point;
  // without the filter the v1 point is remapped too and this reads 4.
  assert.equal(report.aliasRemapped, 3, 'the alias fold touches the v2 point only');
  assert.equal(report.overlayNodes, 1, 'one clean NODE_ID_MAP rename (wf_quick-fix/s0_0)');
  assert.equal(report.overlaysDisplaced, 1, 'one stale v1-keyed overlay dropped by the remap');
  assert.equal(report.overlayWires, 2, 'both wf_no-clarify budgets copied onto wires');
});
