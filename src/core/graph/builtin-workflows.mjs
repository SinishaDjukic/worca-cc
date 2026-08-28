// src/core/graph/builtin-workflows.mjs
// The SHIPPING builtin workflow: wf_default as a version-2 template. This is the
// constant the seeder writes and the V17 migration reconciles against — not a
// test fixture. `fixtures.mjs` re-exports it as FIXTURE_DEFAULT so the engine
// tests and the shipping default can never drift apart.
//
// Pure data + one pure helper — no IO, no imports, no dependency on the registry.

/** Recursively freeze a value and everything reachable from it, returning the
 *  same reference. A shallow `Object.freeze` is NOT enough here: it passes
 *  `Object.isFrozen(template)` while `template.nodes[0].x = 999` mutates the
 *  shipping constant silently, which is exactly what a frozen constant exists to
 *  prevent. Primitives and null pass straight through. */
export function deepFreeze(value) {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const key of Object.keys(value)) deepFreeze(value[key]);
  return value;
}

/** wf_default as a version-2 graph. w5 (refine self-loop) and w9 (review -> fix)
 *  are the loop wires; w10 lands the clean review on the End node. */
export const GRAPH_DEFAULT_WORKFLOW = deepFreeze({
  id: 'wf_default',
  name: 'Default',
  version: 2,
  domain: 'coding',
  createdAt: '1970-01-01T00:00:00.000Z',
  updatedAt: '1970-01-01T00:00:00.000Z',
  nodes: [
    { id: 'n_task', kind: 'task', x: 40, y: 200, config: {} },
    { id: 'n_clarify', kind: 'agent', key: 'clarify', x: 320, y: 200, config: {} },
    { id: 'n_plan', kind: 'agent', key: 'planner', x: 600, y: 200, config: {} },
    { id: 'n_refine', kind: 'agent', key: 'refiner', x: 880, y: 200, config: {} },
    { id: 'n_impl', kind: 'agent', key: 'implementer', x: 1160, y: 200, config: {} },
    { id: 'n_review', kind: 'agent', key: 'reviewer', x: 1440, y: 200, config: {} },
    { id: 'n_end', kind: 'end', x: 1720, y: 200, config: {} },
  ],
  wires: [
    { id: 'w1', from: { node: 'n_task', port: 'task' }, to: { node: 'n_clarify', port: 'task' } },
    { id: 'w2', from: { node: 'n_task', port: 'task' }, to: { node: 'n_plan', port: 'task' } },
    { id: 'w3', from: { node: 'n_clarify', port: 'answers' }, to: { node: 'n_plan', port: 'answers' } },
    { id: 'w4', from: { node: 'n_plan', port: 'plan' }, to: { node: 'n_refine', port: 'plan' } },
    { id: 'w5', from: { node: 'n_refine', port: 'revise' }, to: { node: 'n_refine', port: 'revise' }, config: { maxCycles: 3 } },
    { id: 'w6', from: { node: 'n_refine', port: 'plan' }, to: { node: 'n_impl', port: 'plan' } },
    { id: 'w7', from: { node: 'n_refine', port: 'plan' }, to: { node: 'n_review', port: 'plan' } },
    { id: 'w8', from: { node: 'n_impl', port: 'done' }, to: { node: 'n_review', port: 'done' } },
    { id: 'w9', from: { node: 'n_review', port: 'review' }, to: { node: 'n_impl', port: 'fix' }, config: { maxCycles: 3 } },
    { id: 'w10', from: { node: 'n_review', port: 'pass' }, to: { node: 'n_end', port: 'result' } },
  ],
});
