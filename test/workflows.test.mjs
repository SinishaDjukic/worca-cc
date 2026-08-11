// test/workflows.test.mjs
// workflows.mjs v2: the graph-column store, registryPortsFn (the ONE shared port
// synthesis over a live registry), resolveGraph (run-config overlays + generic
// workspace substitution) and buildGraphManifest (spec §8 manifest v2).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  workflowsDir,
  listWorkflows,
  readWorkflow,
  writeWorkflow,
  deleteWorkflow,
  registryPortsFn,
  buildGraphManifest,
  resolveGraph,
} from '../src/core/workflows.mjs';
import { setNodeModel, setStep } from '../src/core/config.mjs';
import { GRAPH_DEFAULT_WORKFLOW } from '../src/core/graph/builtin-workflows.mjs';
import { AWAIT_PORT, FIXTURE_PORTS, portsFnFor } from '../src/core/graph/fixtures.mjs';
import { SEED_TEMPLATES } from '../src/core/graph/seed-templates.mjs';
import { validateGraph } from '../src/core/graph/validate.mjs';
import { getDb, prepare, _resetForTests } from '../src/core/db.mjs';
import { projectKey } from '../src/core/store.mjs';

// Each test gets its own ~/.worca-cc via WORCA_HOME so the global store is
// isolated and nothing touches the developer's real home dir. The DB singleton is
// reset so the next getDb() reopens against the fresh WORCA_HOME.
const homes = [];
async function freshHome() {
  const d = await mkdtemp(join(tmpdir(), 'worca-cc-home-'));
  homes.push(d);
  _resetForTests();
  process.env.WORCA_HOME = d;
  return d;
}
const projects = [];
async function freshProject() {
  const d = await mkdtemp(join(tmpdir(), 'worca-cc-proj-'));
  projects.push(d);
  return d;
}
after(async () => {
  _resetForTests();
  delete process.env.WORCA_HOME;
  await Promise.all([...homes, ...projects].map((d) => rm(d, { recursive: true, force: true })));
});

/** A minimal but LEGAL v2 template: task -> planner -> end. */
function tinyGraph(extra = {}) {
  return {
    name: 'Tiny',
    domain: 'coding',
    nodes: [
      { id: 'n_task', kind: 'task', x: 0, y: 0, config: {} },
      { id: 'n_plan', kind: 'agent', key: 'planner', x: 280, y: 0, config: {} },
      { id: 'n_end', kind: 'end', x: 560, y: 0, config: {} },
    ],
    wires: [
      { id: 'w1', from: { node: 'n_task', port: 'task' }, to: { node: 'n_plan', port: 'task' } },
      { id: 'w2', from: { node: 'n_plan', port: 'plan' }, to: { node: 'n_end', port: 'result' } },
    ],
    ...extra,
  };
}

// ── the store: the graph column IS the template ─────────────────────────────

test('writeWorkflow stores the FULL flat template in `graph` and stamps version 2', async () => {
  await freshHome();
  const saved = await writeWorkflow(tinyGraph());
  assert.match(saved.id, /^wf_tiny/);
  assert.equal(saved.version, 2);
  assert.ok(saved.createdAt && saved.updatedAt, 'timestamps stamped');

  const row = getDb().prepare('SELECT version, graph, steps, feedbacks FROM workflows WHERE id = ?').get(saved.id);
  assert.equal(row.version, 2);
  const parsed = JSON.parse(row.graph);
  assert.deepEqual(
    Object.keys(parsed).sort(),
    ['createdAt', 'domain', 'id', 'name', 'nodes', 'version', 'wires'],
    'the column is the FULL flat template, not a {nodes, wires} slice',
  );
  assert.equal(parsed.id, saved.id);
  assert.equal(parsed.version, 2);
  assert.equal(row.steps, '[]', 'the v1 topology columns are blanked, not written');
  assert.equal(row.feedbacks, '[]');
});

test('readWorkflow parses the graph column back into the flat template; row columns win', async () => {
  await freshHome();
  const saved = await writeWorkflow(tinyGraph());
  // The row columns are authoritative for id/name/domain: rename via SQL and the
  // stale name inside the JSON must NOT win.
  prepare('UPDATE workflows SET name = ?, domain = ? WHERE id = ?').run('Renamed', 'docs', saved.id);
  const got = await readWorkflow(saved.id);
  assert.equal(got.id, saved.id);
  assert.equal(got.name, 'Renamed', 'row name wins over the graph JSON');
  assert.equal(got.domain, 'docs', 'row domain wins over the graph JSON');
  assert.equal(got.version, 2);
  assert.deepEqual(got.nodes, saved.nodes);
  assert.deepEqual(got.wires, saved.wires);
  assert.equal(got.origin, null);
});

test('writeWorkflow persists the canvas view state when present', async () => {
  await freshHome();
  const saved = await writeWorkflow(tinyGraph({ canvas: { x: 12, y: -4, zoom: 1.5 } }));
  const got = await readWorkflow(saved.id);
  assert.deepEqual(got.canvas, { x: 12, y: -4, zoom: 1.5 });
});

test('writeWorkflow rejects a version other than 2', async () => {
  await freshHome();
  await assert.rejects(
    () => writeWorkflow({ ...tinyGraph(), version: 1 }),
    /version/i,
    'a v1 template can no longer be saved',
  );
  await assert.rejects(() => writeWorkflow({ ...tinyGraph(), version: 3 }), /version/i);
  // version 2 (or absent, which stamps 2) is fine.
  assert.equal((await writeWorkflow({ ...tinyGraph(), version: 2 })).version, 2);
});

test('readWorkflow/listWorkflows ignore rows that are not version 2', async () => {
  await freshHome();
  getDb().prepare(
    'INSERT INTO workflows (id, name, version, steps, feedbacks, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run('wf_v1', 'Legacy', 1, JSON.stringify([[{ id: 's0_0', key: 'planner' }]]), '[]',
    '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
  assert.equal(await readWorkflow('wf_v1'), null, 'a leftover v1 row is not a v2 template');
  assert.deepEqual(await listWorkflows(), []);
});

test('readWorkflow drops a row whose graph JSON carries a FOREIGN id (mis-migrated/hand-edited)', async () => {
  await freshHome();
  const saved = await writeWorkflow(tinyGraph());
  const graph = JSON.parse(getDb().prepare('SELECT graph FROM workflows WHERE id = ?').get(saved.id).graph);
  graph.id = 'wf_somebody-else';
  prepare('UPDATE workflows SET graph = ? WHERE id = ?').run(JSON.stringify(graph), saved.id);
  const warned = [];
  const realWarn = console.warn;
  console.warn = (...a) => warned.push(a.join(' '));
  try {
    assert.equal(await readWorkflow(saved.id), null, 'the id assertion rejects the row');
    assert.deepEqual(await listWorkflows(), [], 'and the same row is dropped from the list');
  } finally {
    console.warn = realWarn;
  }
  assert.ok(warned.some((l) => /wf_somebody-else/.test(l)), 'the mismatch is named, not silent');
});

test('readWorkflow survives an unparseable graph column (never throws)', async () => {
  await freshHome();
  const saved = await writeWorkflow(tinyGraph());
  prepare('UPDATE workflows SET graph = ? WHERE id = ?').run('{not json', saved.id);
  const realWarn = console.warn;
  console.warn = () => {};
  try {
    assert.equal(await readWorkflow(saved.id), null);
    assert.deepEqual(await listWorkflows(), []);
  } finally {
    console.warn = realWarn;
  }
});

test('listWorkflows returns v2 templates newest-first and never the built-in default', async () => {
  await freshHome();
  const a = await writeWorkflow({ ...tinyGraph(), id: 'wf_a', name: 'A', createdAt: '2026-01-01T00:00:00.000Z' });
  const b = await writeWorkflow({ ...tinyGraph(), id: 'wf_b', name: 'B', createdAt: '2026-02-01T00:00:00.000Z' });
  const list = await listWorkflows();
  assert.deepEqual(list.map((w) => w.id), ['wf_b', 'wf_a'], 'newest createdAt first');
  assert.ok(Array.isArray(list[0].nodes) && Array.isArray(list[0].wires), 'graph parsed');
  assert.ok(!list.some((w) => w.id === 'wf_default'), 'the built-in default is never a stored row');
  assert.equal(a.version, 2);
  assert.equal(b.version, 2);
});

test('readWorkflow("wf_default") is the built-in GRAPH_DEFAULT_WORKFLOW and is never a row', async () => {
  await freshHome();
  const got = await readWorkflow('wf_default');
  assert.equal(got, GRAPH_DEFAULT_WORKFLOW, 'the shipping constant itself, not a copy');
  assert.equal(got.version, 2);
  assert.equal(getDb().prepare('SELECT 1 FROM workflows WHERE id = ?').get('wf_default'), undefined);
});

test('writeWorkflow preserves createdAt but bumps updatedAt on re-save (single row)', async () => {
  await freshHome();
  const first = await writeWorkflow({ ...tinyGraph(), id: 'wf_x', name: 'X' });
  await new Promise((r) => setTimeout(r, 5));
  const second = await writeWorkflow({ ...first, name: 'X2', updatedAt: undefined });
  assert.equal(second.createdAt, first.createdAt, 'createdAt preserved');
  assert.notEqual(second.updatedAt, first.updatedAt, 'updatedAt advanced');
  assert.equal(getDb().prepare('SELECT COUNT(*) AS n FROM workflows WHERE id = ?').get('wf_x').n, 1);
});

test('deleteWorkflow removes a row, refuses the built-in default and unsafe ids', async () => {
  await freshHome();
  const saved = await writeWorkflow({ ...tinyGraph(), id: 'wf_del' });
  assert.equal(await deleteWorkflow(saved.id), true);
  assert.equal(await readWorkflow(saved.id), null);
  assert.equal(await deleteWorkflow('wf_ghost'), false);
  assert.equal(await deleteWorkflow('wf_default'), false);
  assert.equal((await readWorkflow('wf_default')).id, 'wf_default', 'default still readable');
  assert.equal(await deleteWorkflow('../SENTINEL'), false);
  assert.equal(await deleteWorkflow('a/b'), false);
});

test('readWorkflow rejects path-traversal / unsafe ids (returns null)', async () => {
  await freshHome();
  for (const bad of ['../foo', 'a/b', 'foo.bar', 'foo bar', '', '.', '..']) {
    assert.equal(await readWorkflow(bad), null, `must reject "${bad}"`);
  }
});

test('workflowsDir is <WORCA_HOME>/.worca-cc/workflows', async () => {
  const home = await freshHome();
  assert.equal(workflowsDir(), join(home, '.worca-cc', 'workflows'));
});

// ── registryPortsFn: the ONE shared synthesis, applied to a live registry ────

test('registryPortsFn appends the synthesized await input LAST on every agent node', async () => {
  const ports = registryPortsFn(FIXTURE_PORTS);
  const p = ports({ id: 'n', kind: 'agent', key: 'reviewer' });
  assert.deepEqual(p.inputs.map((i) => i.id), ['plan', 'done', 'await']);
  assert.deepEqual(p.inputs.at(-1), AWAIT_PORT, 'the await port is the shared constant');
  assert.deepEqual(p.outputs.map((o) => o.id), ['review', 'pass'], 'outputs are untouched');
  assert.equal(p.verdict.filename, 'impl-review-cycle{cycle}.json', 'agent-level meta rides along');
});

test('registryPortsFn is the SAME synthesis as portsFnFor (no private copy)', () => {
  const mine = registryPortsFn(FIXTURE_PORTS);
  const theirs = portsFnFor(FIXTURE_PORTS);
  for (const node of [
    { id: 'a', kind: 'agent', key: 'planner' },
    { id: 'b', kind: 'agent', key: 'manualTestsChecklist' },
    { id: 'c', kind: 'task' },
    { id: 'd', kind: 'end' },
    { id: 'e', kind: 'and', config: { arity: 3 } },
    { id: 'f', kind: 'or', config: { arity: 2 } },
    { id: 'g', kind: 'combine', config: { arity: 2 } },
    { id: 'h', kind: 'agent', key: 'nope' },
    { id: 'i', kind: 'nonsense' },
  ]) {
    assert.deepEqual(mine(node), theirs(node), `same ports for kind ${node.kind}`);
  }
});

test('registryPortsFn tolerates a missing registry and unknown keys (V3/V4 own those)', () => {
  const ports = registryPortsFn(undefined);
  assert.equal(ports({ id: 'n', kind: 'agent', key: 'planner' }), undefined);
  assert.deepEqual(ports({ id: 'n', kind: 'task' }).outputs.map((o) => o.id), ['task']);
});

test('every seed template validates CLEAN through registryPortsFn (the await wires resolve)', () => {
  const ports = registryPortsFn(FIXTURE_PORTS);
  for (const tpl of [GRAPH_DEFAULT_WORKFLOW, ...SEED_TEMPLATES]) {
    const { errors, warnings } = validateGraph(tpl, ports);
    assert.deepEqual(errors, [], `${tpl.id}: zero errors`);
    assert.deepEqual(warnings, [], `${tpl.id}: zero warnings`);
  }
});

// ── resolveGraph ────────────────────────────────────────────────────────────

/** A registry over the spec §5 port table, with the presentation/registry fields
 *  the resolve + manifest layers read. `agentFile` points at the REAL prompt files
 *  so prompt + tools loading is exercised. */
const AGENT_FILES = {
  clarify: 'worca-cc-clarify.md',
  planner: 'worca-cc-planner.md',
  refiner: 'worca-cc-plan-refiner.md',
  implementer: 'worca-cc-implementer.md',
  reviewer: 'worca-cc-code-reviewer.md',
  manualTestsChecklist: 'worca-cc-manual-tests-checklist.md',
  workspaceReviewer: 'worca-cc-workspace-reviewer.md',
  workspaceScanner: 'worca-cc-workspace-scanner.md',
};
const COLORS = { planner: 'violet', refiner: 'green', implementer: 'amber', reviewer: 'blue' };

function registry(extra = {}) {
  const reg = {};
  for (const [key, ports] of Object.entries(FIXTURE_PORTS)) {
    reg[key] = {
      key,
      origin: 'builtin',
      order: 10,
      displayName: key,
      description: `${key} does its job`,
      color: COLORS[key] || 'amber',
      agentFile: AGENT_FILES[key] || null,
      ...structuredClone(ports),
    };
  }
  return { ...reg, ...extra };
}

/** planner -> refiner (self-loop, NO budget) -> implementer <-> reviewer (budget 5) -> end. */
function loopyGraph() {
  return {
    name: 'Loopy',
    domain: 'coding',
    nodes: [
      { id: 'n_task', kind: 'task', x: 0, y: 0, config: {} },
      { id: 'n_plan', kind: 'agent', key: 'planner', x: 300, y: 0, config: {} },
      { id: 'n_refine', kind: 'agent', key: 'refiner', x: 600, y: 0, config: {} },
      { id: 'n_impl', kind: 'agent', key: 'implementer', x: 900, y: 0, config: {} },
      { id: 'n_review', kind: 'agent', key: 'reviewer', x: 1200, y: 0, config: {} },
      { id: 'n_end', kind: 'end', x: 1500, y: 0, config: {} },
    ],
    wires: [
      { id: 'w1', from: { node: 'n_task', port: 'task' }, to: { node: 'n_plan', port: 'task' } },
      { id: 'w2', from: { node: 'n_plan', port: 'plan' }, to: { node: 'n_refine', port: 'plan' } },
      { id: 'w3', from: { node: 'n_refine', port: 'revise' }, to: { node: 'n_refine', port: 'revise' } },
      { id: 'w4', from: { node: 'n_refine', port: 'plan' }, to: { node: 'n_impl', port: 'plan' } },
      { id: 'w5', from: { node: 'n_refine', port: 'plan' }, to: { node: 'n_review', port: 'plan' } },
      { id: 'w6', from: { node: 'n_impl', port: 'done' }, to: { node: 'n_review', port: 'done' } },
      { id: 'w7', from: { node: 'n_review', port: 'review' }, to: { node: 'n_impl', port: 'fix' }, config: { maxCycles: 5 } },
      { id: 'w8', from: { node: 'n_review', port: 'pass' }, to: { node: 'n_end', port: 'result' } },
    ],
  };
}

function setWireCycles(projectDir, workflowId, wireId, maxCycles) {
  getDb();
  prepare(`INSERT INTO config_workflow_wires (workflow_id, project_key, wire_id, max_cycles)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(workflow_id, project_key, wire_id) DO UPDATE SET max_cycles = excluded.max_cycles`)
    .run(workflowId, projectKey(projectDir), wireId, maxCycles);
}

const cyclesOf = (template, id) => template.wires.find((w) => w.id === id)?.config?.maxCycles;

test('resolveGraph returns { template, ports, nodeCtx } and throws on an unknown id', async () => {
  await freshHome();
  const p = await freshProject();
  await assert.rejects(() => resolveGraph(p, 'wf_ghost', registry()), /workflow not found: wf_ghost/);

  const resolved = await resolveGraph(p, 'wf_default', registry());
  assert.deepEqual(Object.keys(resolved).sort(), ['nodeCtx', 'ports', 'template']);
  assert.equal(resolved.template.id, 'wf_default');
  assert.notEqual(resolved.template, GRAPH_DEFAULT_WORKFLOW, 'the frozen constant is cloned, never mutated');
  assert.equal(typeof resolved.ports, 'function');
  assert.deepEqual(
    Object.keys(resolved.nodeCtx).sort(),
    ['n_clarify', 'n_end', 'n_impl', 'n_plan', 'n_refine', 'n_review', 'n_task'],
    'every node — flow cards included — gets a context entry',
  );
  const { errors } = validateGraph(resolved.template, resolved.ports);
  assert.deepEqual(errors, [], 'the resolved template is still a legal graph');
});

test('resolveGraph loads each agent prompt + its frontmatter tools', async () => {
  await freshHome();
  const resolved = await resolveGraph(await freshProject(), 'wf_default', registry());
  const plan = resolved.nodeCtx.n_plan;
  assert.equal(plan.kind, 'agent');
  assert.equal(plan.key, 'planner');
  assert.equal(plan.runnerType, 'producer');
  assert.ok(plan.agentPrompt.length > 0, 'the real agents/worca-cc-planner.md body is loaded');
  assert.ok(Array.isArray(plan.tools) && plan.tools.length > 0, 'frontmatter tools parsed');
  assert.equal(resolved.nodeCtx.n_task.kind, 'task');
  assert.equal(resolved.nodeCtx.n_task.key, null, 'flow cards carry no agent key');
});

test('resolveGraph model/effort precedence: node overlay > template config > role > unset', async () => {
  await freshHome();
  const p = await freshProject();
  const wf = await writeWorkflow(loopyGraph());

  // Nothing configured anywhere: undefined (the orchestrator folds the global in).
  let ctx = (await resolveGraph(p, wf.id, registry())).nodeCtx;
  assert.equal(ctx.n_plan.model, undefined);
  assert.equal(ctx.n_plan.effort, undefined);

  // Role (the legacy per-agent config) is the weakest configured layer.
  await setStep(p, 'planner', { model: 'claude-opus-5', effort: 'high' });
  ctx = (await resolveGraph(p, wf.id, registry())).nodeCtx;
  assert.equal(ctx.n_plan.model, 'claude-opus-5');
  assert.equal(ctx.n_plan.effort, 'high');

  // The template's own node.config beats the role.
  const withNodeCfg = loopyGraph();
  withNodeCfg.id = wf.id;
  withNodeCfg.nodes.find((n) => n.id === 'n_plan').config = { model: 'claude-sonnet-4-6', effort: 'medium' };
  await writeWorkflow(withNodeCfg);
  ctx = (await resolveGraph(p, wf.id, registry())).nodeCtx;
  assert.equal(ctx.n_plan.model, 'claude-sonnet-4-6');
  assert.equal(ctx.n_plan.effort, 'medium');

  // The per-project node overlay beats both.
  await setNodeModel(p, wf.id, 'n_plan', { model: 'claude-haiku-4-5', effort: 'medium' });
  ctx = (await resolveGraph(p, wf.id, registry())).nodeCtx;
  assert.equal(ctx.n_plan.model, 'claude-haiku-4-5');
  assert.equal(ctx.n_plan.effort, 'medium');
  // Untouched nodes keep the role layer.
  assert.equal(ctx.n_impl.model, undefined);
});

test('resolveGraph fanOut/askQuestions precedence: overlay > node config > role > sidecar', async () => {
  await freshHome();
  const p = await freshProject();
  const tpl = loopyGraph();
  tpl.nodes.find((n) => n.id === 'n_refine').config = { fanOut: true };
  const wf = await writeWorkflow(tpl);
  const reg = registry();
  reg.planner.fanOut = true;                       // sidecar default
  reg.implementer.asksQuestions = true;            // capable, off by default
  reg.reviewer.asksQuestions = true;
  reg.reviewer.questionsLocked = true;
  reg.reviewer.questionsDefault = true;            // locked ON — overrides are ignored

  let ctx = (await resolveGraph(p, wf.id, reg)).nodeCtx;
  assert.equal(ctx.n_plan.fanOut, true, 'sidecar default reaches the node');
  assert.equal(ctx.n_refine.fanOut, true, 'template node.config sets it');
  assert.equal(ctx.n_impl.fanOut, false);
  assert.equal(ctx.n_impl.askQuestions, false, 'capable but off by default');
  assert.equal(ctx.n_review.askQuestions, true, 'locked ON');

  await setNodeModel(p, wf.id, 'n_plan', { fanOut: false });
  await setNodeModel(p, wf.id, 'n_impl', { askQuestions: true });
  await setNodeModel(p, wf.id, 'n_review', { askQuestions: false });   // locked: must stay true
  ctx = (await resolveGraph(p, wf.id, reg)).nodeCtx;
  assert.equal(ctx.n_plan.fanOut, false, 'overlay beats the sidecar default');
  assert.equal(ctx.n_impl.askQuestions, true);
  assert.equal(ctx.n_review.askQuestions, true, 'a locked agent ignores every override');
  assert.equal(ctx.n_refine.askQuestions, false, 'an agent that cannot ask is ALWAYS off');
});

test('resolveGraph merges awaitAll off the template node config', async () => {
  await freshHome();
  const p = await freshProject();
  const tpl = loopyGraph();
  tpl.nodes.find((n) => n.id === 'n_review').config = { awaitAll: true };
  const wf = await writeWorkflow(tpl);
  const ctx = (await resolveGraph(p, wf.id, registry())).nodeCtx;
  assert.equal(ctx.n_review.awaitAll, true);
  assert.equal(ctx.n_impl.awaitAll, false);
});

test('resolveGraph wire budgets: overlay > template > default 3, on LOOP wires only', async () => {
  await freshHome();
  const p = await freshProject();
  const wf = await writeWorkflow(loopyGraph());

  // No overlay: the refiner self-loop has no template budget (=> 3); the review
  // loop carries 5.
  let { template } = await resolveGraph(p, wf.id, registry());
  assert.equal(cyclesOf(template, 'w3'), 3, 'unbudgeted loop wire falls back to 3');
  assert.equal(cyclesOf(template, 'w7'), 5, 'template budget is used when there is no overlay');

  setWireCycles(p, wf.id, 'w3', 9);
  setWireCycles(p, wf.id, 'w7', 2);
  ({ template } = await resolveGraph(p, wf.id, registry()));
  assert.equal(cyclesOf(template, 'w3'), 9, 'overlay beats the default');
  assert.equal(cyclesOf(template, 'w7'), 2, 'overlay beats the template budget');

  // A stale overlay on a NON-loop wire is ignored: a budget there is a V13 error.
  setWireCycles(p, wf.id, 'w2', 8);
  const resolved = await resolveGraph(p, wf.id, registry());
  assert.equal(cyclesOf(resolved.template, 'w2'), undefined, 'plain wires never gain a budget');
  const { errors } = validateGraph(resolved.template, resolved.ports);
  assert.deepEqual(errors, [], 'the merged template still passes V13');
});

test('resolveGraph wire budgets are per project (another project sees its own)', async () => {
  await freshHome();
  const a = await freshProject();
  const b = await freshProject();
  const wf = await writeWorkflow(loopyGraph());
  setWireCycles(a, wf.id, 'w7', 11);
  assert.equal(cyclesOf((await resolveGraph(a, wf.id, registry())).template, 'w7'), 11);
  assert.equal(cyclesOf((await resolveGraph(b, wf.id, registry())).template, 'w7'), 5);
});

test('resolveGraph flags duplicate agent keys for the executor allocation prefix', async () => {
  await freshHome();
  const p = await freshProject();
  const tpl = loopyGraph();
  tpl.nodes.push({ id: 'n_review2', kind: 'agent', key: 'reviewer', x: 1200, y: 300, config: {} });
  tpl.wires.push({ id: 'w9', from: { node: 'n_refine', port: 'plan' }, to: { node: 'n_review2', port: 'plan' } });
  const wf = await writeWorkflow(tpl);
  const { nodeCtx } = await resolveGraph(p, wf.id, registry());
  assert.equal(nodeCtx.n_review.duplicateKey, true);
  assert.equal(nodeCtx.n_review2.duplicateKey, true);
  assert.equal(nodeCtx.n_impl.duplicateKey, false, 'single-instance keys allocate as today');

  const single = await resolveGraph(p, 'wf_default', registry());
  assert.ok(Object.values(single.nodeCtx).every((c) => !c.duplicateKey), 'wf_default has no duplicates');
});

test('resolveGraph rejects a placeable:false agent as a node (defence in depth with V4)', async () => {
  await freshHome();
  const p = await freshProject();
  const tpl = loopyGraph();
  tpl.nodes.find((n) => n.id === 'n_plan').key = 'workspaceScanner';
  const wf = await writeWorkflow(tpl);
  await assert.rejects(() => resolveGraph(p, wf.id, registry()), /workspaceScanner.*placeable/);
});

test('resolveGraph tolerates an unknown agent key so validateGraph can report V4', async () => {
  await freshHome();
  const p = await freshProject();
  const tpl = loopyGraph();
  tpl.nodes.find((n) => n.id === 'n_plan').key = 'ghostAgent';
  const wf = await writeWorkflow(tpl);
  const resolved = await resolveGraph(p, wf.id, registry());
  assert.equal(resolved.nodeCtx.n_plan.key, 'ghostAgent');
  assert.equal(resolved.ports(resolved.template.nodes[1]), undefined, 'no ports — V4 territory');
  assert.ok(validateGraph(resolved.template, resolved.ports).errors.some((e) => e.code === 'V4'));
});

test('resolveGraph resolves the or card payload type from its wiring', async () => {
  await freshHome();
  const p = await freshProject();
  const tpl = loopyGraph();
  tpl.nodes.push({ id: 'n_or', kind: 'or', x: 900, y: 400, config: { arity: 2 } });
  tpl.wires.find((w) => w.id === 'w7').to = { node: 'n_or', port: 'in1' };
  tpl.wires.push({ id: 'w9', from: { node: 'n_plan', port: 'plan' }, to: { node: 'n_or', port: 'in2' } });
  tpl.wires.push({ id: 'w10', from: { node: 'n_or', port: 'out' }, to: { node: 'n_impl', port: 'fix' } });
  const wf = await writeWorkflow(tpl);
  const { template, ports } = await resolveGraph(p, wf.id, registry());
  const orNode = template.nodes.find((n) => n.id === 'n_or');
  assert.equal(ports(orNode).outputs[0].type, 'md', 'or.out carries its RESOLVED payload type');
  assert.deepEqual(ports(orNode).inputs.map((i) => i.type), ['any', 'any'], 'inK stay any');
});

// ── generic workspace substitution ──────────────────────────────────────────

/** A custom pair with byte-identical META port signatures. */
function customPair(overrides = {}) {
  const inputs = [
    { id: 'plan', type: 'md', required: true, as: 'file' },
    { id: 'done', type: 'void', required: false, as: 'worktree' },
  ];
  const outputs = [
    { id: 'review', type: 'md', when: 'blocking', filename: '{base}-my-review.md', store: 'project', artifactKind: 'review' },
    { id: 'pass', type: 'void', when: 'clean' },
  ];
  return {
    myReviewer: {
      key: 'myReviewer', origin: 'user', order: 20, displayName: 'My Reviewer', color: 'blue',
      runnerType: 'verifier', scope: 'project', verdict: { filename: 'my-review-cycle{cycle}.json' },
      agentFile: null, inputs: structuredClone(inputs), outputs: structuredClone(outputs),
    },
    myWsReviewer: {
      key: 'myWsReviewer', origin: 'user', order: 21, displayName: 'My WS Reviewer', color: 'blue',
      runnerType: 'verifier', scope: 'workspace-only', workspaceVariantOf: 'myReviewer',
      verdict: { filename: 'my-ws-review-cycle{cycle}.json' },
      agentFile: null, inputs: structuredClone(inputs), outputs: structuredClone(outputs),
      ...overrides,
    },
  };
}

/** loopyGraph with the reviewer swapped for the custom key. */
function customGraph(key = 'myReviewer') {
  const tpl = loopyGraph();
  tpl.name = 'Custom';
  tpl.nodes.find((n) => n.id === 'n_review').key = key;
  return tpl;
}

test('workspace substitution is GENERIC: any registry variant of the node key wins on isWorkspace', async () => {
  await freshHome();
  const p = await freshProject();
  const reg = registry(customPair());
  const wf = await writeWorkflow(customGraph());

  const single = await resolveGraph(p, wf.id, reg);
  assert.equal(single.template.nodes.find((n) => n.id === 'n_review').key, 'myReviewer');
  assert.equal(single.nodeCtx.n_review.key, 'myReviewer');

  const ws = await resolveGraph(p, wf.id, reg, undefined, { isWorkspace: true });
  assert.equal(ws.template.nodes.find((n) => n.id === 'n_review').key, 'myWsReviewer',
    'the substituted key lands in the template the scheduler runs');
  assert.equal(ws.nodeCtx.n_review.key, 'myWsReviewer');
  assert.equal(ws.nodeCtx.n_review.templateKey, 'myReviewer', 'the authored key is kept for config lookups');
  assert.equal(ws.nodeCtx.n_review.meta.workspaceVariantOf, 'myReviewer');
  assert.deepEqual(validateGraph(ws.template, ws.ports).errors, [], 'the substituted graph still validates');
});

test('workspace substitution keeps the builtin reviewer -> workspaceReviewer behaviour', async () => {
  await freshHome();
  const p = await freshProject();
  const ws = await resolveGraph(await freshProject(), 'wf_default', registry(), undefined, { isWorkspace: true });
  assert.equal(ws.nodeCtx.n_review.key, 'workspaceReviewer');
  assert.equal(ws.nodeCtx.n_plan.key, 'planner', 'only declared variants substitute');
  const single = await resolveGraph(p, 'wf_default', registry());
  assert.equal(single.nodeCtx.n_review.key, 'reviewer');
});

test('per-role config still reaches a substituted node through its AUTHORED key', async () => {
  await freshHome();
  const p = await freshProject();
  await setStep(p, 'reviewer', { model: 'claude-opus-5' });
  const ws = await resolveGraph(p, 'wf_default', registry(), undefined, { isWorkspace: true });
  assert.equal(ws.nodeCtx.n_review.key, 'workspaceReviewer');
  assert.equal(ws.nodeCtx.n_review.model, 'claude-opus-5');
});

test('a variant whose META port signature differs from its target THROWS at resolve', async () => {
  await freshHome();
  const p = await freshProject();
  const wf = await writeWorkflow(customGraph());

  const badType = customPair();
  badType.myWsReviewer.inputs[0].type = 'json';
  await assert.rejects(() => resolveGraph(p, wf.id, registry(badType)), /myWsReviewer.*port signature.*myReviewer/i);

  const badFlag = customPair();
  badFlag.myWsReviewer.inputs[1].required = true;
  await assert.rejects(() => resolveGraph(p, wf.id, registry(badFlag)), /myWsReviewer/);

  const badWhen = customPair();
  badWhen.myWsReviewer.outputs[0].when = 'always';
  await assert.rejects(() => resolveGraph(p, wf.id, registry(badWhen)), /myWsReviewer/);

  const noVerdict = customPair();
  delete noVerdict.myWsReviewer.verdict;
  await assert.rejects(() => resolveGraph(p, wf.id, registry(noVerdict)), /verdict/i);

  const badScope = customPair({ scope: 'project' });
  await assert.rejects(() => resolveGraph(p, wf.id, registry(badScope)), /workspace-only/);
});

test('the port-signature assertion runs for EVERY declared variant, substituted or not', async () => {
  await freshHome();
  const p = await freshProject();
  const bad = customPair();
  bad.myWsReviewer.outputs.push({ id: 'extra', type: 'md', when: 'always', filename: 'x.md', store: 'run', artifactKind: 'extra' });
  // wf_default does not use myReviewer at all — the broken variant still trips.
  await assert.rejects(() => resolveGraph(p, 'wf_default', registry(bad)), /myWsReviewer/);
});

test('two variants of one target: builtin > user > plugin, then order; losers are warned about', async () => {
  await freshHome();
  const p = await freshProject();
  const pair = customPair();
  const rival = { ...structuredClone(pair.myWsReviewer), key: 'pluginWsReviewer', origin: 'plugin:acme', order: 1 };
  const reg = registry({ ...pair, pluginWsReviewer: rival });
  const wf = await writeWorkflow(customGraph());

  const warned = [];
  const realWarn = console.warn;
  console.warn = (...a) => warned.push(a.join(' '));
  let ws;
  try {
    ws = await resolveGraph(p, wf.id, reg, undefined, { isWorkspace: true });
  } finally {
    console.warn = realWarn;
  }
  assert.equal(ws.nodeCtx.n_review.key, 'myWsReviewer', 'the user layer beats the plugin layer');
  assert.ok(warned.some((l) => /pluginWsReviewer/.test(l) && /myWsReviewer/.test(l)),
    'the losing variant is named, not silently dropped');

  // Same layer: the lower `order` wins.
  const sameLayer = customPair();
  const twin = { ...structuredClone(sameLayer.myWsReviewer), key: 'aaWsReviewer', order: 5 };
  console.warn = () => {};
  try {
    const tie = await resolveGraph(p, wf.id, registry({ ...sameLayer, aaWsReviewer: twin }), undefined, { isWorkspace: true });
    assert.equal(tie.nodeCtx.n_review.key, 'aaWsReviewer');
  } finally {
    console.warn = realWarn;
  }
});

// ── buildGraphManifest (spec §8 manifest v2) ────────────────────────────────

test('buildGraphManifest: version 2, the bookends, and one entry per graph node', async () => {
  await freshHome();
  const resolved = await resolveGraph(await freshProject(), 'wf_default', registry());
  const m = buildGraphManifest(resolved);
  assert.equal(m.version, 2);
  assert.deepEqual(m.bookends, { preflight: true, done: true }, 'preflight/done stay UI chrome');
  assert.deepEqual(Object.keys(m).sort(), ['bookends', 'graph', 'version']);
  assert.deepEqual(
    m.graph.nodes.map((n) => n.id),
    GRAPH_DEFAULT_WORKFLOW.nodes.map((n) => n.id),
    'node order is the template order',
  );
  assert.deepEqual(m.graph.wires.map((w) => w.id), GRAPH_DEFAULT_WORKFLOW.wires.map((w) => w.id));
});

test('buildGraphManifest: agent cards carry label/color/model/effort and their META + await ports', async () => {
  await freshHome();
  const p = await freshProject();
  await setNodeModel(p, 'wf_default', 'n_review', { model: 'claude-opus-5', effort: 'max' });
  const m = buildGraphManifest(await resolveGraph(p, 'wf_default', registry()));
  const review = m.graph.nodes.find((n) => n.id === 'n_review');
  assert.equal(review.kind, 'agent');
  assert.equal(review.key, 'reviewer');
  assert.equal(review.label, 'reviewer', 'the registry displayName');
  assert.equal(review.color, 'blue');
  assert.equal(review.sub, 'reviewer does its job');
  assert.equal(review.model, 'claude-opus-5');
  assert.equal(review.effort, 'max');
  assert.equal(review.x, 1440);
  assert.equal(review.y, 200);
  assert.deepEqual(review.ports.inputs, [
    { id: 'plan', type: 'md', required: true, loop: false, expands: false },
    { id: 'done', type: 'void', required: false, loop: false, expands: false },
    { id: 'await', type: 'any', required: false, loop: false, expands: false },
  ], 'the synthesized await gate is in the manifest — the monitor anchors its wires from here');
  assert.deepEqual(review.ports.outputs, [
    { id: 'review', type: 'md', when: 'blocking' },
    { id: 'pass', type: 'void', when: 'clean' },
  ]);
  const impl = m.graph.nodes.find((n) => n.id === 'n_impl');
  assert.deepEqual(
    impl.ports.inputs.find((i) => i.id === 'fix'),
    { id: 'fix', type: 'md', required: false, loop: true, expands: false },
  );
  assert.deepEqual(
    impl.ports.inputs.find((i) => i.id === 'task'),
    { id: 'task', type: 'json', required: false, loop: false, expands: true },
  );
  assert.equal(m.graph.nodes.find((n) => n.id === 'n_plan').model, '', 'unset model is an empty string');
});

test('buildGraphManifest: flow cards render from the manifest alone (task/end/and/or)', async () => {
  await freshHome();
  const p = await freshProject();
  const tpl = loopyGraph();
  tpl.nodes.push({ id: 'n_or', kind: 'or', x: 900, y: 400, config: { arity: 2 } });
  tpl.nodes.push({ id: 'n_and', kind: 'and', x: 900, y: 600, config: { arity: 2 } });
  tpl.wires.find((w) => w.id === 'w7').to = { node: 'n_or', port: 'in1' };
  tpl.wires.push({ id: 'w9', from: { node: 'n_plan', port: 'plan' }, to: { node: 'n_or', port: 'in2' } });
  tpl.wires.push({ id: 'w10', from: { node: 'n_or', port: 'out' }, to: { node: 'n_impl', port: 'fix' } });
  tpl.wires.push({ id: 'w11', from: { node: 'n_plan', port: 'plan' }, to: { node: 'n_and', port: 'in1' } });
  tpl.wires.push({ id: 'w12', from: { node: 'n_refine', port: 'plan' }, to: { node: 'n_and', port: 'in2' } });
  tpl.wires.push({ id: 'w13', from: { node: 'n_and', port: 'out' }, to: { node: 'n_review', port: 'await' } });
  const wf = await writeWorkflow(tpl);
  const m = buildGraphManifest(await resolveGraph(p, wf.id, registry()));

  const byId = Object.fromEntries(m.graph.nodes.map((n) => [n.id, n]));
  assert.deepEqual(byId.n_task, {
    id: 'n_task', kind: 'task', key: null, label: 'Task', color: '', sub: '',
    x: 0, y: 0, model: '', effort: '', loop: false,
    ports: { inputs: [], outputs: [{ id: 'task', type: 'md', when: 'always' }] },
  });
  assert.deepEqual(byId.n_end.ports, {
    inputs: [{ id: 'result', type: 'any', required: true, loop: false, expands: false }],
    outputs: [],
  });
  assert.equal(byId.n_end.label, 'End');
  assert.equal(byId.n_and.label, 'AND');
  assert.deepEqual(byId.n_and.ports.outputs, [{ id: 'out', type: 'void', when: 'always' }],
    'AND is STATIC void — no resolution');
  assert.equal(byId.n_or.label, 'OR');
  assert.deepEqual(byId.n_or.ports.outputs, [{ id: 'out', type: 'md', when: 'always' }],
    'the or card ships its RESOLVED payload type');
  assert.deepEqual(byId.n_or.ports.inputs.map((i) => i.type), ['any', 'any']);
});

test('buildGraphManifest: wires carry the loop flag + the resolved budget; nodes flag loop targets', async () => {
  await freshHome();
  const p = await freshProject();
  const wf = await writeWorkflow(loopyGraph());
  setWireCycles(p, wf.id, 'w3', 9);
  const m = buildGraphManifest(await resolveGraph(p, wf.id, registry()));
  const byId = Object.fromEntries(m.graph.wires.map((w) => [w.id, w]));
  assert.deepEqual(byId.w3, {
    id: 'w3',
    from: { node: 'n_refine', port: 'revise' },
    to: { node: 'n_refine', port: 'revise' },
    loop: true,
    maxCycles: 9,
  });
  assert.deepEqual(byId.w7, {
    id: 'w7',
    from: { node: 'n_review', port: 'review' },
    to: { node: 'n_impl', port: 'fix' },
    loop: true,
    maxCycles: 5,
  });
  assert.deepEqual(byId.w2, {
    id: 'w2',
    from: { node: 'n_plan', port: 'plan' },
    to: { node: 'n_refine', port: 'plan' },
    loop: false,
  }, 'a plain wire carries no budget');

  const nodes = Object.fromEntries(m.graph.nodes.map((n) => [n.id, n]));
  assert.equal(nodes.n_refine.loop, true, 'the self-loop target cycles');
  assert.equal(nodes.n_impl.loop, true, 'the review -> fix target cycles');
  assert.equal(nodes.n_review.loop, false);
});

test('buildGraphManifest: a workspace resolve ships the SUBSTITUTED key and label', async () => {
  await freshHome();
  const m = buildGraphManifest(
    await resolveGraph(await freshProject(), 'wf_default', registry(), undefined, { isWorkspace: true }),
  );
  const review = m.graph.nodes.find((n) => n.id === 'n_review');
  assert.equal(review.key, 'workspaceReviewer');
  assert.equal(review.label, 'workspaceReviewer');
});

test('buildGraphManifest: an unknown agent key degrades to the key, never a crash', async () => {
  await freshHome();
  const p = await freshProject();
  const tpl = loopyGraph();
  tpl.nodes.find((n) => n.id === 'n_plan').key = 'ghostAgent';
  const wf = await writeWorkflow(tpl);
  const m = buildGraphManifest(await resolveGraph(p, wf.id, registry()));
  const ghost = m.graph.nodes.find((n) => n.id === 'n_plan');
  assert.equal(ghost.label, 'ghostAgent');
  assert.deepEqual(ghost.ports, { inputs: [], outputs: [] });
});

test('buildGraphManifest survives a junk argument (never throws on a half-built run)', () => {
  const m = buildGraphManifest(null);
  assert.equal(m.version, 2);
  assert.deepEqual(m.graph, { nodes: [], wires: [] });
});
