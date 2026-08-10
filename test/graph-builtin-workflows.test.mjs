// test/graph-builtin-workflows.test.mjs
// GRAPH_DEFAULT_WORKFLOW is the SHIPPING wf_default constant — the one the seeder
// and the V17 migration write, not a test fixture. fixtures.mjs re-exports it as
// FIXTURE_DEFAULT, so a deepEqual against FIXTURE_DEFAULT here would be a
// tautology; the re-export IS the drift guard. What this file pins instead is the
// literal shape (so a silent edit to the shipping default breaks a test) and the
// DEEP freeze — a shallow Object.freeze passes `isFrozen(template)` while
// `nodes[0].x = 999` mutates silently, which is exactly the failure a frozen
// constant is supposed to make impossible.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GRAPH_DEFAULT_WORKFLOW, deepFreeze } from '../src/core/graph/builtin-workflows.mjs';

const wireOf = (template, id) => template.wires.find((w) => w.id === id);

test('GRAPH_DEFAULT_WORKFLOW is wf_default as a version-2 template: 1 task + 5 agent + 1 end nodes, 10 wires', () => {
  assert.equal(GRAPH_DEFAULT_WORKFLOW.id, 'wf_default');
  assert.equal(GRAPH_DEFAULT_WORKFLOW.name, 'Default');
  assert.equal(GRAPH_DEFAULT_WORKFLOW.version, 2);
  assert.equal(GRAPH_DEFAULT_WORKFLOW.domain, 'coding');
  assert.equal(GRAPH_DEFAULT_WORKFLOW.nodes.length, 7);
  assert.equal(GRAPH_DEFAULT_WORKFLOW.wires.length, 10);
  assert.equal(GRAPH_DEFAULT_WORKFLOW.nodes.filter((n) => n.kind === 'task').length, 1);
  assert.equal(GRAPH_DEFAULT_WORKFLOW.nodes.filter((n) => n.kind === 'agent').length, 5);
  assert.equal(GRAPH_DEFAULT_WORKFLOW.nodes.filter((n) => n.kind === 'end').length, 1);
  assert.deepEqual(
    GRAPH_DEFAULT_WORKFLOW.nodes.filter((n) => n.kind === 'agent').map((n) => n.key),
    ['clarify', 'planner', 'refiner', 'implementer', 'reviewer'],
  );
  assert.ok(GRAPH_DEFAULT_WORKFLOW.nodes.every((n) => Number.isFinite(n.x) && Number.isFinite(n.y)));
});

test('GRAPH_DEFAULT_WORKFLOW loop wires: w5 refine self-loop and w9 review -> fix both carry maxCycles 3', () => {
  const w5 = wireOf(GRAPH_DEFAULT_WORKFLOW, 'w5');
  assert.deepEqual(w5.from, { node: 'n_refine', port: 'revise' });
  assert.deepEqual(w5.to, { node: 'n_refine', port: 'revise' });
  assert.equal(w5.config.maxCycles, 3);

  const w9 = wireOf(GRAPH_DEFAULT_WORKFLOW, 'w9');
  assert.deepEqual(w9.from, { node: 'n_review', port: 'review' });
  assert.deepEqual(w9.to, { node: 'n_impl', port: 'fix' });
  assert.equal(w9.config.maxCycles, 3);

  // w10 lands the clean review on the End node — the single terminal wire.
  const w10 = wireOf(GRAPH_DEFAULT_WORKFLOW, 'w10');
  assert.deepEqual(w10.from, { node: 'n_review', port: 'pass' });
  assert.deepEqual(w10.to, { node: 'n_end', port: 'result' });
  assert.equal(w10.config, undefined);

  // exactly the two loop wires carry a budget — nothing else does
  assert.deepEqual(GRAPH_DEFAULT_WORKFLOW.wires.filter((w) => w.config?.maxCycles !== undefined).map((w) => w.id), ['w5', 'w9']);
});

test('GRAPH_DEFAULT_WORKFLOW is DEEP frozen — nested nodes/wires/config reject writes, not just the root', () => {
  assert.ok(Object.isFrozen(GRAPH_DEFAULT_WORKFLOW));
  assert.ok(Object.isFrozen(GRAPH_DEFAULT_WORKFLOW.nodes));
  assert.ok(Object.isFrozen(GRAPH_DEFAULT_WORKFLOW.nodes[0]));
  assert.ok(Object.isFrozen(GRAPH_DEFAULT_WORKFLOW.nodes[0].config));
  assert.ok(Object.isFrozen(GRAPH_DEFAULT_WORKFLOW.wires));
  assert.ok(Object.isFrozen(GRAPH_DEFAULT_WORKFLOW.wires[0]));
  assert.ok(Object.isFrozen(GRAPH_DEFAULT_WORKFLOW.wires[0].from));
  assert.ok(Object.isFrozen(wireOf(GRAPH_DEFAULT_WORKFLOW, 'w5').config));

  // isFrozen alone is the weak assertion — prove the write actually fails. ESM is
  // strict mode, so a write to a frozen object throws instead of failing silently.
  const x = GRAPH_DEFAULT_WORKFLOW.nodes[0].x;
  assert.throws(() => { GRAPH_DEFAULT_WORKFLOW.nodes[0].x = 999; }, TypeError);
  assert.equal(GRAPH_DEFAULT_WORKFLOW.nodes[0].x, x);                       // shallow-freeze bug would have let this through
  assert.throws(() => { wireOf(GRAPH_DEFAULT_WORKFLOW, 'w5').config.maxCycles = 99; }, TypeError);
  assert.equal(wireOf(GRAPH_DEFAULT_WORKFLOW, 'w5').config.maxCycles, 3);
  assert.throws(() => { GRAPH_DEFAULT_WORKFLOW.nodes.push({ id: 'n_evil', kind: 'end', x: 0, y: 0 }); }, TypeError);
  assert.equal(GRAPH_DEFAULT_WORKFLOW.nodes.length, 7);
});

test('deepFreeze recurses through arrays and plain objects and returns the same reference', () => {
  const o = { a: [{ b: { c: 1 } }], d: null };
  assert.equal(deepFreeze(o), o);
  assert.ok(Object.isFrozen(o));
  assert.ok(Object.isFrozen(o.a));
  assert.ok(Object.isFrozen(o.a[0]));
  assert.ok(Object.isFrozen(o.a[0].b));
  assert.throws(() => { o.a[0].b.c = 2; }, TypeError);
  assert.equal(deepFreeze(null), null);                                     // null/primitives pass through, no crash
  assert.equal(deepFreeze(7), 7);
});
