// src/core/graph/diagram-workflow.mjs
// The shipped Diagram → Plan workflow: wf_default with the Planner swapped for the diagram
// interpreter. Seeded by schema V57 as a v2 row (INSERT OR IGNORE), so a user who edits or
// deletes it keeps their choice; refreshed on later bumps only while the stored shape is one
// worca shipped (DIAGRAM_SHIPPED_FINGERPRINTS), exactly like the Presentation and C4 seeds.
//
//   Task ─┬─▶ Clarify ──answers──▶ Interpret diagram ──plan──▶ Refine ⟲ ──plan──▶ Implement ⇄ Review ─▶ End
//         └──────────task──────────▲
import { deepFreeze } from './builtin-workflows.mjs';
import { presentationGraphFingerprint } from './presentation-workflow.mjs';

export const DIAGRAM_WORKFLOW_ID = 'wf_diagram_plan';

export const GRAPH_DIAGRAM_WORKFLOW = deepFreeze({
  id: DIAGRAM_WORKFLOW_ID,
  name: 'Diagram → Plan',
  version: 2,
  domain: 'coding',
  createdAt: '2026-10-11T00:00:00.000Z',
  updatedAt: '2026-10-11T00:00:00.000Z',
  nodes: [
    { id: 'n_task', kind: 'task', x: 40, y: 200, config: {} },
    { id: 'n_clarify', kind: 'agent', key: 'clarify', x: 320, y: 200, config: {} },
    { id: 'n_interpret', kind: 'agent', key: 'diagramInterpreter', x: 600, y: 200, config: {} },
    { id: 'n_refine', kind: 'agent', key: 'refiner', x: 880, y: 200, config: {} },
    { id: 'n_impl', kind: 'agent', key: 'implementer', x: 1160, y: 200, config: {} },
    { id: 'n_review', kind: 'agent', key: 'reviewer', x: 1440, y: 200, config: {} },
    { id: 'n_end', kind: 'end', x: 1720, y: 200, config: {} },
  ],
  wires: [
    { id: 'w1', from: { node: 'n_task', port: 'task' }, to: { node: 'n_clarify', port: 'task' } },
    { id: 'w2', from: { node: 'n_task', port: 'task' }, to: { node: 'n_interpret', port: 'task' } },
    { id: 'w3', from: { node: 'n_clarify', port: 'answers' }, to: { node: 'n_interpret', port: 'answers' } },
    { id: 'w4', from: { node: 'n_interpret', port: 'plan' }, to: { node: 'n_refine', port: 'plan' } },
    { id: 'w5', from: { node: 'n_refine', port: 'revise' }, to: { node: 'n_refine', port: 'revise' }, config: { maxCycles: 3 } },
    { id: 'w6', from: { node: 'n_refine', port: 'plan' }, to: { node: 'n_impl', port: 'plan' } },
    { id: 'w7', from: { node: 'n_refine', port: 'plan' }, to: { node: 'n_review', port: 'plan' } },
    { id: 'w8', from: { node: 'n_impl', port: 'done' }, to: { node: 'n_review', port: 'done' } },
    { id: 'w9', from: { node: 'n_review', port: 'review' }, to: { node: 'n_impl', port: 'fix' }, config: { maxCycles: 3 } },
    { id: 'w10', from: { node: 'n_review', port: 'pass' }, to: { node: 'n_end', port: 'result' } },
  ],
});

/** Same structural fingerprint as the other shipped seeds: sorted node ids + sorted wire ids. */
export const diagramGraphFingerprint = presentationGraphFingerprint;

/** Every shape this workflow has been SHIPPED as before the current one, newest last. Empty: the
 *  first shape is the constant above. When the shape changes, append the OUTGOING fingerprint here
 *  and bump SCHEMA_VERSION (the procedure presentation-workflow.mjs documents). */
export const DIAGRAM_SHIPPED_FINGERPRINTS = Object.freeze([]);
