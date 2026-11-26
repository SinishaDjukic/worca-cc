// Engine rule (small runs C2, D10): no node reviews its own output. Hand-built, non-Shaper graphs only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selfReviewViolations } from '../src/shared/graph/self-review.mjs';

const META = {
  writer: { inputs: [{ id: 'task', type: 'md' }], outputs: [{ id: 'doc', type: 'md' }] },
  coder: { sideEffect: 'code', inputs: [{ id: 'doc', type: 'md' }, { id: 'fix', type: 'md', required: false, loop: true }], outputs: [{ id: 'done', type: 'void' }] },
  checker: { runnerType: 'verifier', inputs: [{ id: 'doc', type: 'md' }], outputs: [{ id: 'review', type: 'md', when: 'blocking' }, { id: 'pass', type: 'void', when: 'clean' }] },
  // A checker that also edits code: as a verifier downstream of a code node it reviews code it may write itself.
  fixingChecker: { runnerType: 'verifier', sideEffect: 'code', inputs: [{ id: 'doc', type: 'md' }], outputs: [{ id: 'review', type: 'md', when: 'blocking' }, { id: 'pass', type: 'void', when: 'clean' }] },
  panel: { inputs: [{ id: 'plan', type: 'md' }], outputs: [{ id: 'findings', type: 'md' }] },
};
const metaOf = (n) => META[n.key];
const w = (id, from, to) => ({ id, from: { node: from.split('.')[0], port: from.split('.')[1] }, to: { node: to.split('.')[0], port: to.split('.')[1] } });
const graph = (nodes, wires) => ({ id: 'wf_hand', version: 2, nodes: [{ id: 't', kind: 'task' }, ...nodes], wires });
const agent = (id, key, config) => ({ id, kind: 'agent', key, ...(config ? { config } : {}) });

test('a clean 3-node graph (writer, coder, separate checker) has no violation', () => {
  const g = graph([agent('a', 'writer'), agent('b', 'coder'), agent('c', 'checker')],
    [w('w1', 't.task', 'a.task'), w('w2', 'a.doc', 'b.doc'), w('w3', 'a.doc', 'c.doc'), w('w4', 'c.review', 'b.fix')]);
  assert.deepEqual(selfReviewViolations(g, metaOf), []);
});

test('a role reviewer wired to its own output is a violation', () => {
  const plan = { roleReview: { roles: [{ key: 'x', label: 'X' }], target: 'plan', sink: 'refiner' } };
  const g = graph([agent('a', 'writer'), agent('r', 'panel', plan)],
    [w('w1', 't.task', 'a.task'), w('w2', 'r.findings', 'r.plan')]);
  assert.deepEqual(selfReviewViolations(g, metaOf), [{ reviewer: 'r', output: 'r.findings' }]);
});

test('a `target: diff` reviewer that is itself a code node is a violation', () => {
  const diff = { roleReview: { roles: [{ key: 'x', label: 'X' }], target: 'diff', sink: 'implementer' } };
  const g = graph([agent('a', 'writer'), agent('b', 'coder', diff)],
    [w('w1', 't.task', 'a.task'), w('w2', 'a.doc', 'b.doc')]);
  assert.deepEqual(selfReviewViolations(g, metaOf), [{ reviewer: 'b', output: 'code' }]);
});

test('a plain verifier fed by its own output is a violation; a loop input is not counted', () => {
  const g = graph([agent('a', 'writer'), agent('c', 'checker')],
    [w('w1', 't.task', 'a.task'), w('w2', 'c.review', 'c.doc')]);
  assert.deepEqual(selfReviewViolations(g, metaOf), [{ reviewer: 'c', output: 'c.review' }]);
});

test('a verifier downstream of a code node reviews every code node, itself included', () => {
  const g = graph([agent('a', 'writer'), agent('b', 'coder'), agent('c', 'fixingChecker')],
    [w('w1', 't.task', 'a.task'), w('w2', 'a.doc', 'b.doc'), w('w3', 'a.doc', 'c.doc'), w('w4', 'b.done', 'c.await')]);
  assert.deepEqual(selfReviewViolations(g, metaOf), [{ reviewer: 'c', output: 'code' }]);
});
