import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rewriteStepperForDecomposition } from '../src/core/workflows.mjs';

const baseManifest = {
  version: 1,
  steps: [
    { kind: 'preflight', nodes: [{ id: 'preflight', label: 'Preflight' }] },
    { kind: 'agents', nodes: [{ id: 's2_0', key: 'implementer', uiPhase: 'implement', label: 'Implementation', color: 'peach', sub: 'write the code' }] },
    { kind: 'agents', nodes: [{ id: 's3_0', key: 'reviewer', uiPhase: 'review', label: 'Review' }] },
    { kind: 'done', nodes: [{ id: 'done', label: 'Done' }] },
  ],
  feedbacks: [{ id: 'fb_review', from: 's3_0', to: 's2_0', maxCycles: 3 }],
};

const phases = [
  { ordinal: 1, tasks: [
    { id: 'p1t1', title: 'Slice one', nodeId: 's_impl_p1_t1' },
    { id: 'p1t2', title: 'Slice two', nodeId: 's_impl_p1_t2' },
  ] },
  { ordinal: 2, tasks: [{ id: 'p2t1', title: 'Slice three', nodeId: 's_impl_p2_t1' }] },
];

test('replaces the implementer cell with one cell per phase, one node per task', () => {
  const m = rewriteStepperForDecomposition(baseManifest, phases);
  // preflight, phase1, phase2, reviewer, done
  assert.equal(m.steps.length, 5);
  const p1 = m.steps[1];
  assert.equal(p1.kind, 'agents');
  assert.equal(p1.label, 'Phase 1');
  assert.deepEqual(p1.nodes.map((n) => n.id), ['s_impl_p1_t1', 's_impl_p1_t2']);
  assert.deepEqual(p1.nodes.map((n) => n.label), ['Slice one', 'Slice two']);
  assert.equal(p1.nodes[0].key, 'implementer');
  assert.equal(p1.nodes[0].uiPhase, 'implement');
  assert.equal(p1.nodes[0].color, 'peach'); // inherited from the original implementer node
  assert.equal(m.steps[2].label, 'Phase 2');
  assert.equal(m.steps[3].nodes[0].id, 's3_0'); // reviewer preserved
});

test('retargets a feedback whose to=implementer to the first task node', () => {
  const m = rewriteStepperForDecomposition(baseManifest, phases);
  const fb = m.feedbacks.find((f) => f.id === 'fb_review');
  assert.equal(fb.to, 's_impl_p1_t1');
  assert.equal(fb.from, 's3_0');
});

test('no implementer cell -> manifest returned unchanged', () => {
  const noImpl = { version: 1, steps: [{ kind: 'agents', nodes: [{ id: 's0_0', key: 'planner' }] }], feedbacks: [] };
  const m = rewriteStepperForDecomposition(noImpl, phases);
  assert.deepEqual(m, noImpl);
});

test('idempotent: re-applying to an already-rewritten manifest is a no-op (resume path)', () => {
  // A pause during decomposed implement persists the REWRITTEN manifest; resume
  // re-enters _runDecomposedImplement and applies the rewrite again. The second
  // application must not duplicate the phase/task cells.
  const once = rewriteStepperForDecomposition(baseManifest, phases);
  const twice = rewriteStepperForDecomposition(once, phases);
  assert.deepEqual(twice, once);
  assert.equal(twice.steps.length, 5); // preflight, phase1, phase2, reviewer, done — no duplicates
});
