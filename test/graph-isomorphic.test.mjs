// test/graph-isomorphic.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isomorphic, nodeLabel, wireLabel } from '../src/shared/graph/isomorphic.mjs';
import { SEED_TEMPLATES } from '../src/core/graph/seed-templates.mjs';
import { GRAPH_DEFAULT_WORKFLOW } from '../src/core/graph/builtin-workflows.mjs';

const seed = (id) => SEED_TEMPLATES.find((t) => t.id === id);
/** The same graph with every id renamed, positions moved and tunables added. The
 *  seeds are deep-frozen, so every wire's `config` is COPIED (a shallow spread would
 *  keep the frozen object and a later `maxCycles = 5` would throw). */
function disguise(tpl) {
  const map = new Map(tpl.nodes.map((n, i) => [n.id, `z_${i}`]));
  return {
    ...tpl, id: 'wf_other', name: 'Other',
    nodes: tpl.nodes.map((n, i) => ({ ...n, id: map.get(n.id), x: 9 * i, y: 7 * i,
      config: { ...n.config, ...(n.kind === 'agent' ? { model: 'claude-opus-5', effort: 'max', fanOut: true } : {}) } })),
    wires: tpl.wires.map((w, i) => ({ ...w, id: `q${i}`, ...(w.config ? { config: { ...w.config } } : {}),
      from: { node: map.get(w.from.node), port: w.from.port }, to: { node: map.get(w.to.node), port: w.to.port } })),
  };
}

test('labels: tunables and positions are invisible, topology config and loop budgets are not', () => {
  assert.equal(nodeLabel({ kind: 'agent', key: 'planner', x: 1, y: 2, config: { model: 'm', effort: 'e', awaitAll: true } }),
    nodeLabel({ kind: 'agent', key: 'planner', config: { awaitAll: true } }));
  assert.notEqual(nodeLabel({ kind: 'task', config: { planStoreSeed: true } }), nodeLabel({ kind: 'task', config: {} }));
  assert.notEqual(nodeLabel({ kind: 'or', config: { arity: 2 } }), nodeLabel({ kind: 'or', config: { arity: 3 } }));
  assert.equal(wireLabel({ from: { port: 'review' }, to: { port: 'fix' }, config: { maxCycles: 3 } }), 'review>fix|3');
  assert.equal(wireLabel({ from: { port: 'plan' }, to: { port: 'plan' } }), 'plan>plan|');
});

test('the agent key and awaitAll are part of the label', () => {
  assert.notEqual(nodeLabel({ kind: 'agent', key: 'planner', config: {} }), nodeLabel({ kind: 'agent', key: 'implementer', config: {} }));
  assert.notEqual(nodeLabel({ kind: 'agent', key: 'reviewer', config: { awaitAll: true } }), nodeLabel({ kind: 'agent', key: 'reviewer', config: {} }));
  // Two agents with IDENTICAL ports (reviewer / workspaceReviewer) must not match:
  // Auto must never reuse a workspace-only pipeline for a project run.
  const swap = (tpl, from, to) => ({ ...tpl, nodes: tpl.nodes.map((n) => (n.key === from ? { ...n, key: to } : { ...n })) });
  assert.equal(isomorphic(seed('wf_quick-fix'), swap(seed('wf_quick-fix'), 'reviewer', 'workspaceReviewer')), null);
});

test('every seed is isomorphic to its own disguise, and the map pairs equal labels', () => {
  for (const t of [...SEED_TEMPLATES, GRAPH_DEFAULT_WORKFLOW]) {
    const m = isomorphic(t, disguise(t));
    assert.ok(m, `${t.id} should match its disguise`);
    assert.equal(m.size, t.nodes.length);
    for (const n of t.nodes) assert.equal(m.get(n.id), `z_${t.nodes.indexOf(n)}`);
  }
});

test('the built-in Default IS the Clarify -> Implement seed (same 7 nodes, same 10 wires)', () => {
  assert.ok(isomorphic(GRAPH_DEFAULT_WORKFLOW, seed('wf_clarify-implement')));
});

test('one agent more or less, or a different loop budget, is not a match', () => {
  assert.equal(isomorphic(seed('wf_quick-fix'), seed('wf_clarify-quick-fix')), null);
  assert.equal(isomorphic(seed('wf_full'), seed('wf_full-no-decompose')), null);
  const budget = disguise(seed('wf_quick-fix'));
  budget.wires.find((w) => w.config?.maxCycles).config.maxCycles = 5;
  assert.equal(isomorphic(seed('wf_quick-fix'), budget), null);
  const rewired = disguise(seed('wf_quick-fix'));
  const w = rewired.wires.find((x) => x.to.port === 'done');
  w.to.port = 'await';                       // same nodes, one wire lands elsewhere
  assert.equal(isomorphic(seed('wf_quick-fix'), rewired), null);
});

test('two agent nodes with the same key are told apart by their wiring', () => {
  const twin = {
    nodes: [{ id: 't', kind: 'task', config: {} }, { id: 'a', kind: 'agent', key: 'implementer', config: {} },
      { id: 'b', kind: 'agent', key: 'implementer', config: {} }, { id: 'e', kind: 'end', config: {} }],
    wires: [{ id: 'w1', from: { node: 't', port: 'task' }, to: { node: 'a', port: 'plan' } },
      { id: 'w2', from: { node: 'a', port: 'done' }, to: { node: 'b', port: 'await' } },
      { id: 'w3', from: { node: 't', port: 'task' }, to: { node: 'b', port: 'plan' } },
      { id: 'w4', from: { node: 'b', port: 'done' }, to: { node: 'e', port: 'result' } }],
  };
  const m = isomorphic(twin, disguise(twin));
  assert.ok(m);
  assert.equal(m.get('a'), 'z_1');
  assert.equal(m.get('b'), 'z_2');
});

test('a script node is identified by its key, like an agent node', () => {
  assert.notEqual(nodeLabel({ kind: 'script', key: 'shell', config: {} }), nodeLabel({ kind: 'script', key: 'gitDiff', config: {} }));
  assert.notEqual(nodeLabel({ kind: 'script', key: 'shell', config: {} }), nodeLabel({ kind: 'agent', key: 'shell', config: {} }));
  // v2 R7: what a script card RUNS is topology, not tuning — a different command is a different graph.
  assert.notEqual(nodeLabel({ kind: 'script', key: 'shell', config: { params: { command: 'npm test' } } }),
    nodeLabel({ kind: 'script', key: 'shell', config: { params: { command: 'rm -rf build' } } }));
  assert.notEqual(nodeLabel({ kind: 'script', key: 'shell', config: {} }), nodeLabel({ kind: 'script', key: 'shell', config: { awaitAll: true } }));
  assert.equal(nodeLabel({ kind: 'script', key: 'shell', config: {} }), nodeLabel({ kind: 'script', key: 'shell', config: { timeoutMs: 5000, mock: { summary: 'x' } } }),
    'timeoutMs and mock are tuning, invisible like model/effort');
});
