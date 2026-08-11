// test/migrate-v17.test.mjs
//
// v17 is the node-graph engine swap's storage step (spec §8):
//   workflows.graph TEXT            -- the v2 template, stored as the FULL flat object
//   pipeline_steps.execution_id TEXT-- the step key IS the executionId
//   config_workflow_wires table     -- per-WIRE maxCycles overlays (replaces the fb rows)
//   RE-SEED                         -- the 7 saved v1 templates become version-2 graphs
//   overlay migration               -- config_workflow_nodes.node_id rewrites + the
//                                      config_workflow_feedbacks -> config_workflow_wires move
//   DELETE FROM workflows WHERE version = 1  -- now only the NON-reseeded leftovers
// Like v12-v16 the step opens with a CONDITIONAL repair (repairSchemaGaps): both new
// columns live in INCREMENTAL_COLUMNS and the new table in the schemaGaps flags, so on
// a ladder pass from <12 the earlier heals have ALREADY added them.
//
// Structure mirrors test/migrate-v16.test.mjs (seed through the real schema, rewind the
// stamp, reopen so the ladder runs exactly the v17 step) with one addition: v17 carries
// DDL, so the rewind also strips the three v17 artifacts — otherwise the "migration"
// would run against a schema that already has everything.
//
// The v1 rows are RECONSTRUCTED from the overlay maps: steps = one column per
// NODE_ID_MAP key in s<i>_0 order carrying that node's agent key, feedbacks = one row
// per FB_WIRE_MAP entry whose from/to are the NODE_ID_MAP keys of the mapped wire's
// (from, target) node pair. That makes the wire resolver's job the exact inverse of the
// reconstruction, so asserting resolver output === FB_WIRE_MAP catches a future seed
// edit that moves a loop wire HERE rather than in a user's overlay.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { useTempHome } from './helpers/temp-home.mjs';
import { seedPipeline } from './helpers/db-seed.mjs';
import { getDb, migrate, _resetForTests } from '../src/core/db.mjs';
import { SEED_TEMPLATES, NODE_ID_MAP, FB_WIRE_MAP } from '../src/core/graph/seed-templates.mjs';
import { FIXTURE_PORTS, portsFnFor } from '../src/core/graph/fixtures.mjs';
import { validateGraph } from '../src/core/graph/validate.mjs';

useTempHome(after);

const ports = portsFnFor(FIXTURE_PORTS);
const SEED_BY_ID = new Map(SEED_TEMPLATES.map((t) => [t.id, t]));
const FLOW_KINDS = new Set(['and', 'or', 'combine']);

const PK = 'proj-v17-0001';
const V1_UPDATED = '2026-08-09T20:00:00.000Z';
const WFP_CREATED = '2026-08-01T10:00:00.000Z';

/** The agent node a loop wire ultimately feeds: a blocking wire into the OR valve
 *  reaches `implementer.fix` through the card's single out-wire, so the v1 feedback's
 *  `to` step is the card's DOWNSTREAM target, never the card itself. */
function wireTarget(t, wire) {
  const kind = new Map(t.nodes.map((n) => [n.id, n.kind]));
  let node = wire.to.node;
  while (FLOW_KINDS.has(kind.get(node))) node = t.wires.find((w) => w.from.node === node).to.node;
  return node;
}

/** v1 `steps` JSON for a template: [[{id,key}]], one single-node column per
 *  NODE_ID_MAP key, in the map's s<i>_0 insertion order. */
function v1Steps(id) {
  const t = SEED_BY_ID.get(id);
  const keyOf = (nodeId) => t.nodes.find((n) => n.id === nodeId).key;
  return Object.entries(NODE_ID_MAP[id]).map(([stepId, nodeId]) => [{ id: stepId, key: keyOf(nodeId) }]);
}

/** v1 `feedbacks` JSON for a template: [{id,from,to}] in FB_WIRE_MAP order (which
 *  preserves the file's fb order, incl. wf_clarify-implement's swapped fb_0). */
function v1Feedbacks(id) {
  const t = SEED_BY_ID.get(id);
  const stepOf = new Map(Object.entries(NODE_ID_MAP[id]).map(([s, n]) => [n, s]));
  return Object.entries(FB_WIRE_MAP[id]).map(([fbId, wireId]) => {
    const w = t.wires.find((x) => x.id === wireId);
    return { id: fbId, from: stepOf.get(w.from.node), to: stepOf.get(wireTarget(t, w)) };
  });
}

const cols = (db, table) => db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
const hasTable = (db, name) => db.prepare(
  "SELECT count(*) AS n FROM sqlite_master WHERE type='table' AND name=?").get(name).n > 0;

/** Run `fn` with console.warn captured — the migration's audit trail goes to stderr
 *  (stdout belongs to the UI), and the test both asserts on it and keeps it quiet. */
function captureWarns(fn) {
  const orig = console.warn;
  const lines = [];
  console.warn = (...args) => { lines.push(args.join(' ')); };
  try { fn(); } finally { console.warn = orig; }
  return lines;
}

let audit = [];
let pipelineId = null;

test('v16 -> v17 re-seeds the saved templates and migrates the overlays', async () => {
  const db = getDb();

  // A costed run so pipeline_steps has pre-v17 rows to read execution_id NULL from.
  pipelineId = (await seedPipeline('/tmp/proj-v17', {
    title: 'pre-v17 run', status: 'done',
    steps: [{ key: '0:s0_0', status: 'done' }, { key: '1:s1_0', status: 'done' }],
  })).id;

  // ── the v1 workflows rows: all 7 saved templates + one plugin import ────────────
  const insWf = db.prepare(`INSERT INTO workflows
    (id, name, version, steps, feedbacks, domain, origin, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'coding', ?, ?, ?)`);
  for (const t of SEED_TEMPLATES) {
    insWf.run(t.id, t.name, 1, JSON.stringify(v1Steps(t.id)), JSON.stringify(v1Feedbacks(t.id)),
      null, t.createdAt, V1_UPDATED);
  }
  insWf.run('wfp_acme-flow', 'Acme Flow', 1, '[]', '[]', 'plugin:acme', WFP_CREATED, WFP_CREATED);

  // ── the user's overlay shapes, keyed by v1 step id ──────────────────────────────
  const insNode = db.prepare(`INSERT INTO config_workflow_nodes
    (project_key, workflow_id, node_id, model, effort, fan_out, ask_questions) VALUES (?,?,?,?,?,?,?)`);
  insNode.run(PK, 'wf_full', 's4_0', 'opus', 'high', 1, null);
  insNode.run(PK, 'wf_full', 's0_0', null, null, null, 1);
  insNode.run(PK, 'wf_default', 's_clarify', 'haiku', null, null, 1);
  insNode.run(PK, 'wf_default', 's2_0', 'sonnet', 'low', 0, null);
  insNode.run(PK, 'wf_quick-fix', 'sX_9', 'ghost', null, null, null); // unmapped: stays orphaned

  const insFb = db.prepare(`INSERT INTO config_workflow_feedbacks
    (project_key, workflow_id, fb_id, max_cycles) VALUES (?,?,?,?)`);
  for (const t of SEED_TEMPLATES) {
    for (const fbId of Object.keys(FB_WIRE_MAP[t.id])) {
      insFb.run(PK, t.id, fbId, t.id === 'wf_no-clarify' ? 6 : 4); // the user's wf_no-clarify 6s
    }
  }
  insFb.run(PK, 'wf_default', 'fb_review', 5);

  // ── rewind to a genuine v16 shape: strip the stamp AND the three v17 artifacts ──
  db.exec('ALTER TABLE workflows DROP COLUMN graph');
  db.exec('ALTER TABLE pipeline_steps DROP COLUMN execution_id');
  db.exec('DROP TABLE config_workflow_wires');
  db.exec('PRAGMA user_version = 16');
  _resetForTests();

  audit = captureWarns(() => { getDb(); });

  assert.equal(getDb().prepare('PRAGMA user_version').get().user_version, 18);
});

test('the DDL lands: graph, execution_id and config_workflow_wires', () => {
  const db = getDb();
  assert.ok(cols(db, 'workflows').includes('graph'), 'workflows.graph exists');
  assert.ok(cols(db, 'pipeline_steps').includes('execution_id'), 'pipeline_steps.execution_id exists');
  assert.ok(hasTable(db, 'config_workflow_wires'), 'config_workflow_wires exists');
  assert.deepEqual(cols(db, 'config_workflow_wires'),
    ['workflow_id', 'project_key', 'wire_id', 'max_cycles']);
  const steps = db.prepare(
    'SELECT execution_id FROM pipeline_steps WHERE pipeline_id = ?').all(pipelineId);
  assert.equal(steps.length, 2, 'the pre-v17 step rows survive');
  assert.ok(steps.every((s) => s.execution_id === null), 'legacy step rows read execution_id NULL');
});

test('all 7 saved templates become version-2 rows carrying a full flat graph', () => {
  const db = getDb();
  const row = db.prepare('SELECT version, graph, created_at, updated_at FROM workflows WHERE id = ?');
  for (const t of SEED_TEMPLATES) {
    const r = row.get(t.id);
    assert.ok(r, `${t.id} survived the v1 delete`);
    assert.equal(r.version, 2, `${t.id} is version 2`);
    assert.equal(r.created_at, t.createdAt, `${t.id} created_at preserved`);
    assert.notEqual(r.updated_at, V1_UPDATED, `${t.id} updated_at restamped`);

    const parsed = JSON.parse(r.graph);
    assert.equal(parsed.id, t.id, `${t.id} graph carries its own id`);
    assert.deepEqual(Object.keys(parsed).sort(),
      ['createdAt', 'domain', 'id', 'name', 'nodes', 'version', 'wires'],
      `${t.id} graph is the FULL flat template, not a nested {graph}`);
    assert.equal(parsed.version, 2);
    // Unwrapped validation: a seed missing its End node (V21) or still carrying a
    // direct double fix fan-in (V7) fails HERE, not in a downstream UI test.
    const { errors } = validateGraph(parsed, ports);
    assert.deepEqual(errors, [], `${t.id} graph column validates unwrapped`);
  }
  const { n } = db.prepare('SELECT COUNT(*) AS n FROM workflows').get();
  assert.equal(n, 7, 'exactly the 7 re-seeded rows remain');
});

test('the non-reseeded v1 row is deleted, with an audit line naming it', () => {
  const db = getDb();
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM workflows WHERE id = 'wfp_acme-flow'").get().n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM workflows WHERE version = 1').get().n, 0);
  assert.ok(audit.some((l) => l.includes('wfp_acme-flow') && l.includes('Acme Flow')),
    `a delete audit line names the row; got:\n${audit.join('\n')}`);
  for (const t of SEED_TEMPLATES) {
    assert.ok(audit.some((l) => l.includes(t.id) && /re-seed/i.test(l)),
      `a re-seed audit line names ${t.id}`);
  }
});

test('the feedback resolver agrees with FB_WIRE_MAP on every mapped feedback', () => {
  const db = getDb();
  const wires = db.prepare('SELECT wire_id, max_cycles FROM config_workflow_wires WHERE workflow_id = ? AND wire_id = ?');
  for (const t of SEED_TEMPLATES) {
    const expectedCycles = t.id === 'wf_no-clarify' ? 6 : 4;
    for (const [fbId, wireId] of Object.entries(FB_WIRE_MAP[t.id])) {
      const r = wires.get(t.id, wireId);
      assert.ok(r, `${t.id}.${fbId} migrated onto wire ${wireId}`);
      assert.equal(r.max_cycles, expectedCycles, `${t.id} ${wireId} keeps its max_cycles`);
    }
    const { n } = db.prepare(
      'SELECT COUNT(*) AS n FROM config_workflow_wires WHERE workflow_id = ?').get(t.id);
    assert.equal(n, Object.keys(FB_WIRE_MAP[t.id]).length, `${t.id} migrated no extra wires`);
  }
  // A silent fallback to the pinned map would hide a resolver that stopped resolving.
  assert.deepEqual(audit.filter((l) => /unresolved|pinned/i.test(l)), [],
    'every mapped feedback resolved dynamically — no fallback, no disagreement');
});

test("wf_no-clarify's two loop wires carry the user's max_cycles 6", () => {
  const rows = getDb().prepare(
    'SELECT wire_id, max_cycles FROM config_workflow_wires WHERE workflow_id = ? ORDER BY wire_id'
  ).all('wf_no-clarify');
  assert.deepEqual(rows.map((r) => ({ ...r })), [
    { wire_id: 'w10', max_cycles: 6 },
    { wire_id: 'w3', max_cycles: 6 },
  ]);
});

test('config_workflow_nodes ids are rewritten, including wf_default; unmapped rows orphan', () => {
  const db = getDb();
  const one = db.prepare(
    'SELECT node_id, model, effort, fan_out, ask_questions FROM config_workflow_nodes WHERE workflow_id = ? AND node_id = ?');

  const impl = one.get('wf_full', 'n_impl');
  assert.ok(impl, 'wf_full s4_0 -> n_impl');
  assert.deepEqual({ ...impl },
    { node_id: 'n_impl', model: 'opus', effort: 'high', fan_out: 1, ask_questions: null });
  assert.ok(one.get('wf_full', 'n_clarify'), 'wf_full s0_0 -> n_clarify');
  assert.equal(one.get('wf_full', 's4_0'), undefined, 'the old id is gone');

  // wf_default is a BUILTIN with no workflows row — its overlays migrate all the same.
  assert.equal(one.get('wf_default', 'n_clarify')?.model, 'haiku', 'wf_default s_clarify -> n_clarify');
  assert.equal(one.get('wf_default', 'n_impl')?.model, 'sonnet', 'wf_default s2_0 -> n_impl');

  // resolveGraph ignores unknown node ids, so an unmapped overlay stays put, harmless.
  assert.equal(one.get('wf_quick-fix', 'sX_9')?.model, 'ghost', 'unmapped overlay left orphaned');
});

test("wf_default's feedback overlay migrates onto the builtin's wire", () => {
  const rows = getDb().prepare(
    'SELECT wire_id, max_cycles FROM config_workflow_wires WHERE workflow_id = ?').all('wf_default');
  assert.deepEqual(rows.map((r) => ({ ...r })), [{ wire_id: 'w9', max_cycles: 5 }]);
});

test('reopen is a clean no-op: no re-seed, no re-delete, no duplicate wires', () => {
  _resetForTests();
  const again = captureWarns(() => { getDb(); });
  assert.deepEqual(again, [], 'a migrated DB emits no further audit lines');
  const db = getDb();
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, 18);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM workflows').get().n, 7);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM config_workflow_wires').get().n,
    SEED_TEMPLATES.reduce((s, t) => s + Object.keys(FB_WIRE_MAP[t.id]).length, 0) + 1);
});

// ── the skip path: a template id absent from the DB is never inserted ─────────────
// Only 5 of the 7 exist in the reference DB, so the re-seed must UPDATE what is there
// and leave the rest alone. A hand-built v16 seed is the cheapest way to pin that.
const V16_WORKFLOWS_SEED = `
  CREATE TABLE workflows (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1,
    steps TEXT NOT NULL DEFAULT '[]', feedbacks TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL, domain TEXT, origin TEXT
  );
  CREATE TABLE config_workflow_nodes (
    project_key TEXT NOT NULL, workflow_id TEXT NOT NULL, node_id TEXT NOT NULL,
    model TEXT, effort TEXT, fan_out INTEGER, ask_questions INTEGER,
    PRIMARY KEY (project_key, workflow_id, node_id)
  );
  CREATE TABLE config_workflow_feedbacks (
    project_key TEXT NOT NULL, workflow_id TEXT NOT NULL, fb_id TEXT NOT NULL,
    max_cycles INTEGER NOT NULL, PRIMARY KEY (project_key, workflow_id, fb_id)
  );
`;

test('templates absent from the DB are skipped, and a pre-existing v2 row is untouched', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(V16_WORKFLOWS_SEED);
  const ins = db.prepare(`INSERT INTO workflows
    (id, name, version, steps, feedbacks, created_at, updated_at) VALUES (?,?,?,?,?,?,?)`);
  ins.run('wf_full', 'Full', 1, JSON.stringify(v1Steps('wf_full')),
    JSON.stringify(v1Feedbacks('wf_full')), '2026-07-29T19:39:27.650Z', V1_UPDATED);
  ins.run('wf_quick-fix', 'Quick Fix', 1, JSON.stringify(v1Steps('wf_quick-fix')),
    JSON.stringify(v1Feedbacks('wf_quick-fix')), '2026-08-09T14:40:59.262Z', V1_UPDATED);
  ins.run('wf_custom', 'Hand-built v2', 2, '[]', '[]', WFP_CREATED, WFP_CREATED);
  ins.run('wfp_gone', 'Plugin Import', 1, '[]', '[]', WFP_CREATED, WFP_CREATED);
  db.exec('PRAGMA user_version = 16');

  captureWarns(() => { migrate(db); });

  assert.equal(db.prepare('PRAGMA user_version').get().user_version, 18);
  assert.deepEqual(db.prepare('SELECT id FROM workflows ORDER BY id').all().map((r) => r.id),
    ['wf_custom', 'wf_full', 'wf_quick-fix'], 'the 5 absent seeds were skipped, not inserted');
  for (const id of ['wf_full', 'wf_quick-fix']) {
    const r = db.prepare('SELECT version, graph FROM workflows WHERE id = ?').get(id);
    assert.equal(r.version, 2);
    assert.equal(JSON.parse(r.graph).id, id);
  }
  const custom = db.prepare("SELECT version, graph FROM workflows WHERE id = 'wf_custom'").get();
  assert.equal(custom.version, 2, 'a pre-existing v2 row survives the v1 delete');
  assert.equal(custom.graph, null, 'and is NOT re-seeded');
});

test('migrate() is idempotent on a hand-built seed (second call is a clean no-op)', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(V16_WORKFLOWS_SEED);
  db.exec('PRAGMA user_version = 16');
  captureWarns(() => { migrate(db); migrate(db); });
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, 18);
});

test('the v17 step survives a minimal seed that predates the workflow columns', () => {
  // The v12/v13-era minimal seeds carry workflows(id, name) only. The ladder from 12
  // reaches the v17 step, which must skip the re-seed rather than throw "no such column".
  const db = new DatabaseSync(':memory:');
  db.exec("CREATE TABLE pipelines (id TEXT PRIMARY KEY);\nCREATE TABLE workflows (id TEXT PRIMARY KEY, name TEXT);");
  db.prepare("INSERT INTO workflows (id, name) VALUES ('wf_full', 'Full')").run();
  db.exec('PRAGMA user_version = 12');
  captureWarns(() => { migrate(db); });
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, 18);
  assert.ok(cols(db, 'workflows').includes('graph'), 'graph healed onto the minimal table');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM workflows').get().n, 1, 'the row is left alone');
});
