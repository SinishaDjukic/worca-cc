// test/stillhet-workflow-map.test.mjs — dev's workflows, agents and scripts as the prototype's records (Stillhet slice 7
// D4), and the graph model the live page draws equals dev's engine manifest (Invariant 5).
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { SEED_TEMPLATES } from '../src/core/graph/seed-templates.mjs';
import { GRAPH_DEFAULT_WORKFLOW, GRAPH_LEAN_WORKFLOW, GRAPH_MEMORY_DEFRAG_WORKFLOW, GRAPH_SHAPE_WORKFLOW } from '../src/core/workflows.mjs';
import { loadAgentRegistry } from '../src/core/agent-registry.mjs';
import { GRAPH_PRESENTATION_WORKFLOW } from '../src/core/graph/presentation-workflow.mjs';
import { GRAPH_ARCHITECTURE_WORKFLOW } from '../src/core/graph/architecture-workflow.mjs';
import { GRAPH_PROMO_VIDEO_WORKFLOW } from '../src/core/graph/promo-video-workflow.mjs';
import { buildGraphManifest } from '../src/shared/graph/manifest.mjs';
import { workflowOf, agentOf, scriptOf, graphModelOf, NOT_OWN_IDS, DEFAULT_MODEL, loopEnds, modelWords, modelIdOf } from '../ui/public/stillhet/live/workflow-map.mjs';

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

test('workflowOf: steps in order from the task node, loops from the loop wires with their nodes (V-TW-06), usage figures per node', () => {
  const usage = { wf_full: { tasks: 3, merged: 67, running: 1, nodes: { n_plan: { costUsd: 0.3, minutes: 2.6 } } } };
  const w = workflowOf(full, { usage, agentsByKey: agents });
  assert.deepEqual(w.nodeIds, ['n_clarify', 'n_plan', 'n_refine', 'n_decompose', 'n_impl', 'n_review', 'n_check', 'n_webui']);
  assert.deepEqual(w.steps.map((s) => s[1]), ['clarify', 'planner', 'refiner', 'decomposer', 'implementer', 'reviewer', 'manualTestsChecklist', 'manualWebUiTesting']);
  assert.deepEqual(w.steps[1].slice(4, 6), [3, 0.3]);
  assert.equal(w.steps[1][9], 'n_plan', 'each step carries its node');
  assert.equal(w.steps[0][2], DEFAULT_MODEL);
  const label = (k) => agents[k].displayName;
  assert.deepEqual(w.loops, [[label('refiner'), label('refiner'), 3, 'n_refine', 'n_refine'], [label('reviewer'), label('implementer'), 3, 'n_review', 'n_impl'], [label('manualWebUiTesting'), label('implementer'), 3, 'n_webui', 'n_impl']]);   // Review → OR → Build names n_impl, not n_or
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

// task → Build (n_b1) → Review (n_rev) → Build (n_b2) → Web UI (n_web) → end; Review sends back to the first Build, Web UI to the second
const twice = {
  id: 'wf_twice', name: 'Twice', version: 2, domain: 'coding', origin: null, createdAt: '2026-11-01T00:00:00.000Z',
  nodes: [{ id: 'n_task', kind: 'task', x: 0, y: 0, config: {} },
    { id: 'n_b1', kind: 'agent', key: 'implementer', x: 300, y: 0, config: { label: 'Build' } },
    { id: 'n_rev', kind: 'agent', key: 'reviewer', x: 600, y: 0, config: { label: 'Review' } },
    { id: 'n_b2', kind: 'agent', key: 'implementer', x: 900, y: 0, config: { label: 'Build' } },
    { id: 'n_web', kind: 'agent', key: 'manualWebUiTesting', x: 1200, y: 0, config: { label: 'Web UI' } },
    { id: 'n_end', kind: 'end', x: 1500, y: 0, config: {} }],
  wires: [{ id: 'w1', from: { node: 'n_task', port: 'task' }, to: { node: 'n_b1', port: 'task' } },
    { id: 'w2', from: { node: 'n_b1', port: 'done' }, to: { node: 'n_rev', port: 'done' } },
    { id: 'w3', from: { node: 'n_rev', port: 'review' }, to: { node: 'n_b1', port: 'fix' }, config: { maxCycles: 2 } },
    { id: 'w4', from: { node: 'n_rev', port: 'pass' }, to: { node: 'n_b2', port: 'task' } },
    { id: 'w5', from: { node: 'n_b2', port: 'done' }, to: { node: 'n_web', port: 'checklist' } },
    { id: 'w6', from: { node: 'n_web', port: 'review' }, to: { node: 'n_b2', port: 'fix' }, config: { maxCycles: 1 } },
    { id: 'w7', from: { node: 'n_web', port: 'pass' }, to: { node: 'n_end', port: 'result' } }],
};

test('V-TW-06: a template with two loops and a duplicate step label keeps from ≠ to', () => {
  const w = workflowOf(twice, { agentsByKey: agents });
  assert.deepEqual(w.steps.map((s) => [s[0], s[9]]), [['Build', 'n_b1'], ['Review', 'n_rev'], ['Build', 'n_b2'], ['Web UI', 'n_web']]);
  assert.deepEqual(w.loops, [['Review', 'Build', 2, 'n_rev', 'n_b1'], ['Web UI', 'Build', 1, 'n_web', 'n_b2']]);
  assert.deepEqual(w.loops.map((l) => loopEnds(w.steps, l)), [{ from: 1, to: 0 }, { from: 3, to: 2 }]);
  const full = workflowOf(structuredClone(SEED_TEMPLATES.find((t) => t.id === 'wf_full')), { agentsByKey: agents });
  const rev = loopEnds(full.steps, full.loops[1]);
  assert.notEqual(rev.from, rev.to, 'Review → OR → Build is two steps');
});

test('V-TW-06: loopEnds falls back to labels for 3-tuples and steps without [9]', () => {
  const steps = [['Plan', 'planner'], ['Build', 'implementer'], ['Review', 'reviewer'], ['Build', 'implementer']];
  assert.deepEqual(loopEnds(steps, ['Review', 'Build', 3]), { from: 2, to: 1 }, 'the first of each label, as before');
  assert.deepEqual(loopEnds(steps, ['Review', 'Build', 3, 'n2', 'n3']), { from: -1, to: -1 }, 'node ids match [9] only');
  assert.deepEqual(loopEnds(steps, ['Gone', 'Build', 3]), { from: -1, to: 1 });
  assert.deepEqual(loopEnds([], ['Review']), { from: -1, to: -1 }, 'a short tuple never throws');
  const keyedSteps = steps.map((s, i) => [...s, '', '', 0, 0, undefined, undefined, undefined, `d${i}`]);
  assert.deepEqual(loopEnds(keyedSteps, ['Review', 'Build', 1, 'd2', 'd3']), { from: 2, to: 3 });
  assert.deepEqual(loopEnds(keyedSteps, ['Review', 'Build', 1, 'd2']), { from: 2, to: 1 }, 'one node id alone: labels');
});

test('V-TW-06: the classic script\'s loopEnds copy keeps the same non-array guard as the exported one', () => {
  const src = readFileSync(new URL('../ui/public/stillhet/workflows/workflows.js', import.meta.url), 'utf8');
  const line = /const loopEnds = (\(steps, loop\) => \{.*?return \{ from: at\(0\), to: at\(1\) \}; \});/.exec(src);
  assert.ok(line, 'workflows.js keeps a loopEnds copy taking (steps, loop)');
  const classic = new Function(`return ${line[1]}`)();
  const steps = [['Plan', 'planner'], ['Build', 'implementer'], ['Review', 'reviewer']];
  for (const [st, l] of [[steps, null], [steps, undefined], [steps, 'Review'], [steps, { 0: 'Review' }], [null, ['Review', 'Build', 2]], [undefined, ['Review', 'Build']], [[null, ...steps], ['Review', 'Build', 2]], [steps, ['Review', 'Build', 2]]])
    assert.deepEqual(classic(st, l), loopEnds(st, l), `${JSON.stringify(st)} / ${JSON.stringify(l)}`);
  assert.deepEqual(classic(steps, null), { from: -1, to: -1 }, 'a missing loop never throws');
});

test('V-TW-19: modelWords words aliases and every claude-* id; others stay as typed', () => {
  const cases = { opus: 'Opus 5.5', Sonnet: 'Sonnet 5.5', HAIKU: 'Haiku 5.5', 'claude-opus-5-5': 'Opus 5.5', 'claude-opus-4-1': 'Opus 4.1', 'claude-sonnet-4-5-20250929': 'Sonnet 4.5',
    'claude-sonnet-4-20250514': 'Sonnet 4', 'claude-3-5-sonnet-20241022': 'Sonnet 3.5', 'claude-3-haiku-20240307': 'Haiku 3', 'claude-fable-5-2': 'Fable 5.2', 'gpt-9-mini': 'gpt-9-mini', '': '' };
  for (const [id, words] of Object.entries(cases)) assert.equal(modelWords(id), words, id);
  assert.equal(modelWords(undefined), '');
  assert.equal(agentOf({ key: 'x', frontmatter: { model: 'opus' } }).model, 'Opus 5.5');
  const t = structuredClone(chain); t.nodes[1].config.model = 'claude-opus-4-1';
  assert.equal(workflowOf(t, { agentsByKey: agents }).steps[0][2], 'Opus 4.1');
});

test('V-TW-19: modelIdOf round-trips a worded id; canonical words save the 5.5 id', () => {
  for (const id of ['claude-opus-4-1', 'claude-sonnet-4-5-20250929', 'claude-3-5-sonnet-20241022', 'claude-fable-5-2', 'claude-opus-5-5', 'claude-haiku-5-5', 'claude-opus-5-5-20260101', 'claude-sonnet-5-5-20260301', 'gpt-9-mini'])
    assert.equal(modelIdOf(modelWords(id)), id, id);
  assert.equal(modelIdOf('Opus 5.5'), 'claude-opus-5-5');
  assert.equal(modelIdOf(modelWords('opus')), 'claude-opus-5-5', 'an alias saves as the pinned id (open finding)');
  assert.equal(modelIdOf('Sonnet 9.9'), 'Sonnet 9.9', 'words never worded save as typed');
});

test('V-TW-19: a non-claude id equal to a worded id\'s words saves back as itself, never as the claude id', () => {
  const claude = 'claude-sonnet-4-3', literal = 'Sonnet 4.3';
  assert.equal(modelWords(literal), literal, 'a non-claude id reads as itself');
  assert.equal(modelIdOf(modelWords(literal)), literal);
  assert.equal(modelWords(claude), claude, 'a claude id whose words are taken by an id that reads as itself reads raw');
  assert.equal(modelIdOf(modelWords(claude)), claude);
  assert.equal(modelIdOf(modelWords(literal)), literal, 'still itself after the claude id was read');
});

test('V-TW-19: two ids that word the same both round-trip: the later one reads as its raw id', () => {
  const dated = 'claude-haiku-4-7-20260101', plain = 'claude-haiku-4-7';
  const a = modelWords(dated), b = modelWords(plain);
  assert.equal(a, 'Haiku 4.7');
  assert.equal(b, plain, 'an id whose words are taken reads as itself');
  assert.equal(modelIdOf(modelWords(dated)), dated);
  assert.equal(modelIdOf(modelWords(plain)), plain);
  assert.equal(modelWords(dated), 'Haiku 4.7', 'wording the first id again keeps its words');
});
