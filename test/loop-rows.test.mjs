// test/loop-rows.test.mjs — the pure per-loop row builders, called directly (scripts and ports passed in, no app.js globals).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildFeedbackRows, buildGraphWireRows } from '../ui/public/loop-rows.mjs';
import { portsFnFor } from '../src/shared/graph/ports.mjs';
import { indexByKey } from '../src/shared/graph/agent-meta.mjs';

const AGENTS = [
  { key: 'planner', displayName: 'Plan', inputs: [{ id: 'task', type: 'md', required: true }], outputs: [{ id: 'plan', type: 'md', when: 'always' }] },
  { key: 'implementer', displayName: 'Implement',
    inputs: [{ id: 'fix', type: 'md', required: false, loop: true }, { id: 'plan', type: 'md', required: true }],
    outputs: [{ id: 'done', type: 'void', when: 'always' }] },
  { key: 'reviewer', displayName: 'Review',
    inputs: [{ id: 'plan', type: 'md', required: true }, { id: 'done', type: 'void', required: false }],
    outputs: [{ id: 'review', type: 'md', when: 'blocking' }, { id: 'pass', type: 'void', when: 'clean' }] },
];
const reg = indexByKey(AGENTS);
const portsFn = portsFnFor(reg, {});

const V2 = {
  id: 'wf_g', version: 2,
  nodes: [
    { id: 'n_task', kind: 'task', config: {} },
    { id: 'n_plan', kind: 'agent', key: 'planner', config: {} },
    { id: 'n_impl', kind: 'agent', key: 'implementer', config: {} },
    { id: 'n_review', kind: 'agent', key: 'reviewer', config: {} },
    { id: 'n_end', kind: 'end', config: {} },
  ],
  wires: [
    { id: 'w1', from: { node: 'n_task', port: 'task' }, to: { node: 'n_plan', port: 'task' } },
    { id: 'w2', from: { node: 'n_plan', port: 'plan' }, to: { node: 'n_impl', port: 'plan' } },
    { id: 'w3', from: { node: 'n_plan', port: 'plan' }, to: { node: 'n_review', port: 'plan' } },
    { id: 'w4', from: { node: 'n_impl', port: 'done' }, to: { node: 'n_review', port: 'done' } },
    { id: 'w5', from: { node: 'n_review', port: 'review' }, to: { node: 'n_impl', port: 'fix' }, config: { maxCycles: 4 } },
    { id: 'w6', from: { node: 'n_review', port: 'pass' }, to: { node: 'n_end', port: 'result' } },
  ],
};

test('v2: one row per loop wire, keyed by the wire id, budget from the run config, else the wire, else 3', () => {
  const rows = buildFeedbackRows(V2, reg, {}, {}, portsFn);
  assert.deepEqual(rows.map((r) => [r.fbId, r.label, r.maxCycles, r.selfLoop]), [['w5', 'Implement ← Review', 4, false]]);
  assert.equal(buildFeedbackRows(V2, reg, { wires: { w5: { maxCycles: 2 } } }, {}, portsFn)[0].maxCycles, 2);
  const bare = { ...V2, wires: V2.wires.map((w) => (w.id === 'w5' ? { ...w, config: {} } : w)) };
  assert.equal(buildGraphWireRows(bare, reg, {}, {}, portsFn)[0].maxCycles, 3);
});

test('v2: the ports function is the one passed in — no ports, no loops', () => {
  assert.deepEqual(buildGraphWireRows(V2, reg, {}, {}, () => ({ ported: true, inputs: [], outputs: [] })), []);
});

test('v1: rows are the feedbacks ids (fb_*), not wire ids', () => {
  const wf = { id: 'w', steps: [[{ id: 's0_0', key: 'implementer' }], [{ id: 's1_0', key: 'reviewer' }]], feedbacks: [{ id: 'fb_0', from: 's1_0', to: 's0_0' }] };
  const rows = buildFeedbackRows(wf, reg, { feedbacks: { fb_0: { maxCycles: 7 } } });
  assert.deepEqual(rows.map((r) => [r.fbId, r.label, r.maxCycles]), [['fb_0', 'Implement ← Review', 7]]);
});
