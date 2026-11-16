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
