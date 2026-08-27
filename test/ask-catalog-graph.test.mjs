import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shapeWorkflow } from '../src/core/ask/catalog.mjs';

const REG = {
  planner: { key: 'planner', displayName: 'Plan', description: 'plans',
    inputs: [{ id: 'task', type: 'md', required: true }, { id: 'revise', type: 'md', required: false, loop: true }],
    outputs: [{ id: 'plan', type: 'md', when: 'always' }] },
  reviewer: { key: 'reviewer', displayName: 'Review', description: 'reviews', verdict: { filename: 'r.json' },
    inputs: [{ id: 'plan', type: 'md', required: true }],
    outputs: [{ id: 'review', type: 'md', when: 'blocking' }, { id: 'pass', type: 'void', when: 'clean' }] },
};
const V2 = { id: 'wf_g', name: 'G', version: 2, domain: 'coding', origin: null,
  nodes: [{ id: 'n_task', kind: 'task', x: 0, y: 0, config: {} },
    { id: 'n_plan', kind: 'agent', key: 'planner', x: 300, y: 0, config: {} },
    { id: 'n_rev', kind: 'agent', key: 'reviewer', x: 600, y: 0, config: {} },
    { id: 'n_end', kind: 'end', x: 900, y: 0, config: {} }],
  wires: [{ id: 'w1', from: { node: 'n_task', port: 'task' }, to: { node: 'n_plan', port: 'task' } },
    { id: 'w2', from: { node: 'n_plan', port: 'plan' }, to: { node: 'n_rev', port: 'plan' } },
    { id: 'w3', from: { node: 'n_rev', port: 'review' }, to: { node: 'n_plan', port: 'revise' }, config: { maxCycles: 3 } },
    { id: 'w4', from: { node: 'n_rev', port: 'pass' }, to: { node: 'n_end', port: 'result' } }] };

test('a v2 row shapes into the SAME catalog contract as a v1 one', () => {
  const s = shapeWorkflow(V2, REG);
  assert.deepEqual(Object.keys(s), ['id', 'name', 'domain', 'origin', 'steps', 'feedbacks']);
  assert.deepEqual(s.steps, [
    [{ nodeId: 'n_plan', key: 'planner', displayName: 'Plan', description: 'plans' }],
    [{ nodeId: 'n_rev', key: 'reviewer', displayName: 'Review', description: 'reviews' }],
  ], 'agent nodes only, one group per rank — flow cards are engine plumbing');
  assert.deepEqual(s.feedbacks, [{ id: 'w3', from: 'n_rev', to: 'n_plan' }]);
});

test('a v1 row is untouched', () => {
  const v1 = { id: 'wf_v1', name: 'V1', version: 1, domain: 'coding', origin: null,
    steps: [[{ id: 's0_0', key: 'planner' }]], feedbacks: [{ id: 'fb_0', from: 's1_0', to: 's0_0', maxCycles: 3 }] };
  assert.deepEqual(shapeWorkflow(v1, REG), { id: 'wf_v1', name: 'V1', domain: 'coding', origin: null,
    steps: [[{ nodeId: 's0_0', key: 'planner', displayName: 'Plan', description: 'plans' }]],
    feedbacks: [{ id: 'fb_0', from: 's1_0', to: 's0_0' }] });
});

test('a malformed node or wire never throws the whole catalog', () => {
  // buildCatalog maps EVERY template, so one junk row used to take down the Ask
  // system prompt and list_workflows for every thread until it was deleted.
  const junk = { ...V2, nodes: [null, 7, ...V2.nodes], wires: [{}, 'junk', ...V2.wires] };
  const s = shapeWorkflow(junk, REG);
  assert.deepEqual(s.steps.map((g) => g.map((n) => n.nodeId)), [['n_plan'], ['n_rev']]);
  assert.deepEqual(s.feedbacks, [{ id: 'w3', from: 'n_rev', to: 'n_plan' }]);
});

test('an unknown key falls back to the key itself', () => {
  const g = { ...V2, nodes: V2.nodes.map((n) => (n.id === 'n_plan' ? { ...n, key: 'ghost' } : n)) };
  assert.equal(shapeWorkflow(g, REG).steps[0][0].displayName, 'ghost');
});
