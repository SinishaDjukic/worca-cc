// test/stillhet-workflow-map.test.mjs — dev's workflows, agents and scripts as the prototype's records (Stillhet slice 7
// D4), and the graph model the live page draws equals dev's engine manifest (Invariant 5).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SEED_TEMPLATES } from '../src/core/graph/seed-templates.mjs';
import { GRAPH_DEFAULT_WORKFLOW, GRAPH_LEAN_WORKFLOW, GRAPH_MEMORY_DEFRAG_WORKFLOW, GRAPH_SHAPE_WORKFLOW } from '../src/core/workflows.mjs';
import { loadAgentRegistry } from '../src/core/agent-registry.mjs';
import { GRAPH_PRESENTATION_WORKFLOW } from '../src/core/graph/presentation-workflow.mjs';
import { GRAPH_ARCHITECTURE_WORKFLOW } from '../src/core/graph/architecture-workflow.mjs';
import { GRAPH_PROMO_VIDEO_WORKFLOW } from '../src/core/graph/promo-video-workflow.mjs';
import { buildGraphManifest } from '../src/shared/graph/manifest.mjs';
import { workflowOf, agentOf, scriptOf, graphModelOf, NOT_OWN_IDS, DEFAULT_MODEL } from '../ui/public/stillhet/live/workflow-map.mjs';

const agents = loadAgentRegistry(undefined, { userAgentsDir: null, includePlugins: false });
const full = structuredClone(SEED_TEMPLATES.find((t) => t.id === 'wf_full'));
const chain = {
  id: 'wf_mine', name: 'Mine', version: 2, domain: 'coding', origin: null, createdAt: '2026-11-01T00:00:00.000Z',
  nodes: [{ id: 'n_task', kind: 'task', x: 0, y: 0, config: {} },
    { id: 'n_plan', kind: 'agent', key: 'planner', x: 300, y: 0, config: { model: 'claude-opus-5-5', effort: 'high' } },
    { id: 'n_end', kind: 'end', x: 600, y: 0, config: {} }],
  wires: [{ id: 'w1', from: { node: 'n_task', port: 'task' }, to: { node: 'n_plan', port: 'task' } },
    { id: 'w2', from: { node: 'n_plan', port: 'plan' }, to: { node: 'n_end', port: 'result' } }],
};

test('graph model of seeded wf_full equals the engine manifest', () => {
  const g = graphModelOf(full, agents), m = buildGraphManifest(full, agents).graph;
  assert.equal(g.nodes.length, 11);
  assert.deepEqual(g.nodes.map((n) => [n.id, n.kind, n.key]), m.nodes.map((n) => [n.id, n.kind, n.key]));
  assert.deepEqual(g.wires.map((w) => [w.from.node, w.from.port, w.to.node, w.to.port]), full.wires.map((w) => [w.from.node, w.from.port, w.to.node, w.to.port]));
  assert.deepEqual(g.nodes.map((n) => [n.id, n.kind]), full.nodes.map((n) => [n.id, n.kind]));
});

test('workflowOf: steps in order from the task node, loops from the loop wires, usage figures per node', () => {
  const usage = { wf_full: { tasks: 3, merged: 67, running: 1, nodes: { n_plan: { costUsd: 0.3, minutes: 2.6 } } } };
  const w = workflowOf(full, { usage, agentsByKey: agents });
  assert.deepEqual(w.nodeIds, ['n_clarify', 'n_plan', 'n_refine', 'n_decompose', 'n_impl', 'n_review', 'n_check', 'n_webui']);
  assert.deepEqual(w.steps.map((s) => s[1]), ['clarify', 'planner', 'refiner', 'decomposer', 'implementer', 'reviewer', 'manualTestsChecklist', 'manualWebUiTesting']);
  assert.deepEqual(w.steps[1].slice(4, 6), [3, 0.3]);
  assert.equal(w.steps[1][9], 'n_plan', 'each step carries its node');
  assert.equal(w.steps[0][2], DEFAULT_MODEL);
  const label = (k) => agents[k].displayName;
  assert.deepEqual(w.loops, [[label('refiner'), label('refiner'), 3], [label('reviewer'), label('implementer'), 3], [label('manualWebUiTesting'), label('implementer'), 3]]);
  assert.equal(w.tasks, 3); assert.equal(w.merged, 67); assert.equal(w.running, true);
  assert.equal(w.title, 'Full'); assert.equal(w.tpl, full);
});

test('chain is false for seeded wf_full (its or node) and true for a single chain', () => {
  assert.equal(workflowOf(full, { agentsByKey: agents }).chain, false);
  assert.equal(workflowOf(chain, { agentsByKey: agents }).chain, true);
});

test('own is false for wf_default, seeds and plugin: rows, true for a saved row', () => {
  assert.equal(workflowOf(GRAPH_DEFAULT_WORKFLOW, { agentsByKey: agents }).own, false);
  assert.equal(workflowOf(full, { agentsByKey: agents }).own, false);
  const p = workflowOf({ ...chain, id: 'wf_p', origin: 'plugin:acme' }, { agentsByKey: agents });
  assert.equal(p.own, false); assert.equal(p.plugin, 'acme');
  assert.equal(workflowOf(chain, { agentsByKey: agents, pins: ['wf_mine'] }).own, true);
  assert.equal(workflowOf(chain, { agentsByKey: agents, pins: ['wf_mine'] }).pinned, true);
});

test('NOT_OWN_IDS is dev\'s built-ins, its seeded rows and its shipped graphs; a shipped graph reads as built-in', () => {
  const shipped = [GRAPH_PRESENTATION_WORKFLOW, GRAPH_ARCHITECTURE_WORKFLOW, GRAPH_PROMO_VIDEO_WORKFLOW];
  const ids = [GRAPH_DEFAULT_WORKFLOW, GRAPH_LEAN_WORKFLOW, GRAPH_MEMORY_DEFRAG_WORKFLOW, GRAPH_SHAPE_WORKFLOW, ...SEED_TEMPLATES, ...shipped].map((t) => t.id);
  assert.deepEqual([...NOT_OWN_IDS].sort(), ids.sort());
  for (const t of shipped) {   // db.mjs seeds them with origin NULL and a real date: only the id tells them apart
    const w = workflowOf({ ...structuredClone(t), origin: null, createdAt: '2026-08-01T00:00:00.000Z' }, { agentsByKey: agents });
    assert.equal(w.own, false, t.id); assert.equal(w.from, 'Made with Worca', t.id);
  }
});

test('an unknown model id round-trips: the step shows the raw id', () => {
  const t = structuredClone(chain); t.nodes[1].config.model = 'gpt-9-mini';
  const w = workflowOf(t, { agentsByKey: agents });
  assert.equal(w.steps[0][2], 'gpt-9-mini');
  assert.equal(workflowOf(chain, { agentsByKey: agents }).steps[0][2], 'Opus 5.5');
});

test('agentOf reads model and effort from meta.frontmatter, asks and fan from the meta', () => {
  const a = agentOf({ key: 'sec', displayName: 'Security check', origin: 'user', runnerType: 'verifier', inputs: [{ id: 'done' }], outputs: [{ id: 'review' }, { id: 'pass' }],
    asksQuestions: false, fanOut: true, frontmatter: { model: 'claude-sonnet-5-5', effort: 'high' } });
  assert.deepEqual(a, { id: 'sec', title: 'Security check', own: true, domain: 'coding', type: 'verifier', ins: 'done', outs: 'review, pass', model: 'Sonnet 5.5', effort: 'high', asks: false, fan: true });
  assert.equal(agentOf({ ...agents.planner }).own, false);
  assert.equal(agentOf({ key: 'x', frontmatter: { model: '', fields: { effort: 'low' } } }).effort, 'low', 'dev\'s parseFrontmatter keeps effort under fields');
});

test('scriptOf: runtime words, first param, timeout and case count', () => {
  assert.deepEqual(scriptOf({ key: 'diffGate', displayName: 'Diff gate', origin: 'user', runtime: 'node', description: 'Blocks big diffs.', params: [{ id: 'max', label: 'Most files', default: 40 }], timeoutMs: 600000, caseCount: 2 }),
    { id: 'diffGate', title: 'Diff gate', own: true, domain: 'coding', runtime: 'Node.js', what: 'Blocks big diffs', param: ['Most files', '40'], timeout: '600 s', cases: 2 });
});
