// test/stillhet-graph-entry.test.mjs — the live graph is drawn exactly as the demo one (Stillhet slice 7 D5): dev's
// template through fromTpl gives the build path's template, ports and agents, with and without Auto-align. The pixel
// compare proves the demo drawing; this equality carries it to live templates.
import { test } from 'node:test';
import assert from 'node:assert/strict';

globalThis.window = globalThis.window || {};
await import('../ui/public/stillhet/graph/graph-entry.mjs');
const G = globalThis.window.RailGraph;

// the demo security-first record (workflows/workflows.js data.workflow)
const wf = { id: 'security-first', title: 'Security-first review', steps: [['Plan', 'planner', 'Opus 5.5', 'high', 3, 0.40], ['Build', 'implementer', 'Sonnet 5.5', 'high', 9, 0.31], ['Security check', 'security', 'Opus 5.5', 'high', 4, 0.19], ['Review', 'reviewer', 'Opus 5.5', 'medium', 2, 0.12]], loops: [['Security check', 'Build', 2]] };
const ports = (g) => g.tpl.nodes.map((n) => g.portsFn(n));

for (const aligned of [false, true]) {
  test(`fromTpl on build(wf).tpl equals the build path${aligned ? ' after Auto-align' : ''}`, () => {
    let a = G.build(wf), b = G.fromTpl({ ...wf, tpl: G.build(wf).tpl, agentsByKey: G.demo(wf).agentsByKey });
    if (aligned) { a = G.align(a); b = G.align(b); }
    assert.deepEqual(b.tpl, a.tpl);
    assert.deepEqual(ports(b), ports(a));
    assert.deepEqual(b.agents, a.agents);
  });
}

test('fromTpl reads a live template\'s stored positions and its agents\' descriptions', () => {
  const { tpl, agentsByKey } = G.demo(wf);
  for (const k of Object.keys(agentsByKey)) agentsByKey[k].description = `does ${k}`;
  const g = G.fromTpl({ tpl, agentsByKey });
  assert.deepEqual(g.tpl.nodes.map((n) => [n.id, n.x, n.y]), tpl.nodes.map((n) => [n.id, n.x, n.y]));
  assert.equal(g.agents.s0.description, 'does s0');
  assert.equal(G.fromTpl({ tpl, agentsByKey }, (k) => `says ${k}`).agents.s1.description, 'says s1');
});

// the demo two-builds record (workflows/workflows.js data.workflow): two steps named Build, each with its own loop
const twoBuilds = { id: 'two-builds', title: 'Build twice', steps: [['Plan', 'planner', 'Opus 5.5', 'high', 3, 0.30, undefined, undefined, undefined, 'd_plan'], ['Build', 'implementer', 'Sonnet 5.5', 'high', 9, 0.22, undefined, undefined, undefined, 'd_build1'],
  ['Review', 'reviewer', 'Opus 5.5', 'medium', 4, 0.12, undefined, undefined, undefined, 'd_review'], ['Build', 'implementer', 'Sonnet 5.5', 'medium', 5, 0.15, undefined, undefined, undefined, 'd_build2'], ['Run tests', 'run-tests', '', '', 2, 0.01, undefined, undefined, undefined, 'd_tests']],
loops: [['Review', 'Build', 2, 'd_review', 'd_build1'], ['Run tests', 'Build', 1, 'd_tests', 'd_build2']] };

test('V-TW-06: the demo graph wires each loop to its own step when two share a name', () => {
  const { tpl, agentsByKey } = G.demo(twoBuilds);
  assert.deepEqual(tpl.nodes.filter((n) => n.kind === 'agent').map((n) => n.id), ['d_plan', 'd_build1', 'd_review', 'd_build2', 'd_tests']);
  const wire = (id) => tpl.wires.find((w) => w.id === id);
  assert.deepEqual([wire('wl0').from.node, wire('wl0').to.node], ['d_review', 'd_build1']);
  assert.deepEqual([wire('wl1').from.node, wire('wl1').to.node], ['d_tests', 'd_build2']);
  assert.equal(wire('wl1').config.maxCycles, 1);
  assert.deepEqual([wire('w_in').to.node, wire('w0').from.node, wire('w0').to.node, wire('w_end').from.node], ['d_plan', 'd_plan', 'd_build1', 'd_tests']);
  assert.ok(agentsByKey.s3.inputs.some((p) => p.id === 'back'), 'the second Build takes a loop');
  assert.ok(agentsByKey.s4.outputs.some((p) => p.id === 'fix'), 'Run tests sends one');
  assert.ok(!agentsByKey.s1.outputs.some((p) => p.id === 'fix'), 'a Build sends none');
});

test('V-TW-19: demo node models come from modelIdOf', async () => {
  const { modelWords } = await import('../ui/public/stillhet/live/workflow-map.mjs');
  const old = modelWords('claude-opus-4-1');   // what the page shows for it
  const { tpl } = G.demo({ ...wf, steps: [['Plan', 'planner', old, 'high'], ['Build', 'implementer', 'Sonnet 5.5', 'high'], ['Review', 'reviewer', 'gpt-9-mini', 'low']], loops: [] });
  assert.deepEqual(tpl.nodes.filter((n) => n.kind === 'agent').map((n) => n.config.model), ['claude-opus-4-1', 'claude-sonnet-5-5', 'gpt-9-mini']);
});
