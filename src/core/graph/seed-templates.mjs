// src/core/graph/seed-templates.mjs
// The 7 hand-written v2 seed templates the V17 migration re-seeds the user's
// saved pipelines as, plus the static overlay-migration maps.
//
// Each entry is a FLAT Template object — `{ id, name, version, domain, createdAt,
// nodes, wires }` at the TOP level, never nested under `graph`. Flat is
// load-bearing: validateGraph runs on the whole template and V1 reads `version`
// off the object it is handed.
//
// Shape rules the graphs follow (a copy-check, not an authoring recipe — these
// were hand-authored and verified against the v1 rows):
//   - Every template has a Task source node and exactly ONE End node, wired from
//     `webui.pass` where a webui node exists, else `reviewer.pass`.
//   - `implementer.done -> reviewer.done`, `reviewer.pass -> checklist.await` and
//     `checklist.checklist -> webui.checklist` reproduce v1's linear order; refine
//     self-loops and review loops carry `config.maxCycles: 3`.
//   - The double-loop templates (wf_full, wf_provided-plan, wf_full-no-decompose)
//     fan `reviewer.review -> n_or.in1` and `webui.review -> n_or.in2` — each
//     in-wire keeps its OWN maxCycles, because those are the loop wires and the
//     gate sites — while `n_or.out -> implementer.fix` carries NO config
//     (maxCycles on an always-sourced wire fails V13). wf_no-clarify has no or
//     card: only w10 targets `fix`, and `webui.review` is UNWIRED, matching its
//     two-feedback v1 row.
//
// Parity note: the OR in-wires keep their v1-era wire ids and budgets, so source
// firings, per-wire delivery counts and gate sites are identical to the direct
// wire shape; the OR adds one $0 instant exec row per loop emission and forwards
// the identical review path to `fix`.

import { deepFreeze } from './builtin-workflows.mjs';

/** Full: clarify -> plan -> refine -> decompose -> implement -> review ->
 *  checklist -> web UI, with both review loops fanned through the or card.
 *  11 nodes / 17 wires. */
const WF_FULL = {
  id: 'wf_full',
  name: 'Full',
  version: 2,
  domain: 'coding',
  createdAt: '2026-07-29T19:39:27.650Z',
  nodes: [
    { id: 'n_task', kind: 'task', x: 60, y: 198, config: {} },
    { id: 'n_clarify', kind: 'agent', key: 'clarify', x: 360, y: 198, config: {} },
    { id: 'n_plan', kind: 'agent', key: 'planner', x: 660, y: 198, config: {} },
    { id: 'n_refine', kind: 'agent', key: 'refiner', x: 960, y: 198, config: {} },
    { id: 'n_decompose', kind: 'agent', key: 'decomposer', x: 1260, y: 198, config: {} },
    { id: 'n_impl', kind: 'agent', key: 'implementer', x: 1560, y: 198, config: {} },
    { id: 'n_review', kind: 'agent', key: 'reviewer', x: 1860, y: 198, config: {} },
    { id: 'n_check', kind: 'agent', key: 'manualTestsChecklist', x: 2160, y: 198, config: {} },
    { id: 'n_webui', kind: 'agent', key: 'manualWebUiTesting', x: 2460, y: 198, config: {} },
    { id: 'n_end', kind: 'end', x: 2760, y: 198, config: {} },
    { id: 'n_or', kind: 'or', x: 2010, y: 430, config: { arity: 2 } },
  ],
  wires: [
    { id: 'w1', from: { node: 'n_task', port: 'task' }, to: { node: 'n_clarify', port: 'task' } },
    { id: 'w2', from: { node: 'n_task', port: 'task' }, to: { node: 'n_plan', port: 'task' } },
    { id: 'w3', from: { node: 'n_clarify', port: 'answers' }, to: { node: 'n_plan', port: 'answers' } },
    { id: 'w4', from: { node: 'n_plan', port: 'plan' }, to: { node: 'n_refine', port: 'plan' } },
    { id: 'w5', from: { node: 'n_refine', port: 'revise' }, to: { node: 'n_refine', port: 'revise' }, config: { maxCycles: 3 } },
    { id: 'w6', from: { node: 'n_refine', port: 'plan' }, to: { node: 'n_decompose', port: 'plan' } },
    { id: 'w7', from: { node: 'n_refine', port: 'plan' }, to: { node: 'n_impl', port: 'plan' } },
    { id: 'w8', from: { node: 'n_refine', port: 'plan' }, to: { node: 'n_review', port: 'plan' } },
    { id: 'w9', from: { node: 'n_refine', port: 'plan' }, to: { node: 'n_check', port: 'plan' } },
    { id: 'w10', from: { node: 'n_decompose', port: 'tasks' }, to: { node: 'n_impl', port: 'task' } },
    { id: 'w11', from: { node: 'n_impl', port: 'done' }, to: { node: 'n_review', port: 'done' } },
    { id: 'w12', from: { node: 'n_review', port: 'review' }, to: { node: 'n_or', port: 'in1' }, config: { maxCycles: 3 } },
    { id: 'w13', from: { node: 'n_review', port: 'pass' }, to: { node: 'n_check', port: 'await' } },
    { id: 'w14', from: { node: 'n_check', port: 'checklist' }, to: { node: 'n_webui', port: 'checklist' } },
    { id: 'w15', from: { node: 'n_webui', port: 'review' }, to: { node: 'n_or', port: 'in2' }, config: { maxCycles: 3 } },
    { id: 'w16', from: { node: 'n_webui', port: 'pass' }, to: { node: 'n_end', port: 'result' } },
    { id: 'w17', from: { node: 'n_or', port: 'out' }, to: { node: 'n_impl', port: 'fix' } },
  ],
};

/** No Clarify: Full minus the clarify node, and with only ONE feedback into
 *  `fix` — w10 reviewer.review. `webui.review` is deliberately unwired, matching
 *  the v1 row's two feedbacks. 9 nodes / 13 wires. */
const WF_NO_CLARIFY = {
  id: 'wf_no-clarify',
  name: 'No Clarify',
  version: 2,
  domain: 'coding',
  createdAt: '2026-07-29T19:40:22.212Z',
  nodes: [
    { id: 'n_task', kind: 'task', x: 60, y: 198, config: {} },
    { id: 'n_plan', kind: 'agent', key: 'planner', x: 360, y: 198, config: {} },
    { id: 'n_refine', kind: 'agent', key: 'refiner', x: 660, y: 198, config: {} },
    { id: 'n_decompose', kind: 'agent', key: 'decomposer', x: 960, y: 198, config: {} },
    { id: 'n_impl', kind: 'agent', key: 'implementer', x: 1260, y: 198, config: {} },
    { id: 'n_review', kind: 'agent', key: 'reviewer', x: 1560, y: 198, config: {} },
    { id: 'n_check', kind: 'agent', key: 'manualTestsChecklist', x: 1860, y: 198, config: {} },
    { id: 'n_webui', kind: 'agent', key: 'manualWebUiTesting', x: 2160, y: 198, config: {} },
    { id: 'n_end', kind: 'end', x: 2460, y: 198, config: {} },
  ],
  wires: [
    { id: 'w1', from: { node: 'n_task', port: 'task' }, to: { node: 'n_plan', port: 'task' } },
    { id: 'w2', from: { node: 'n_plan', port: 'plan' }, to: { node: 'n_refine', port: 'plan' } },
    { id: 'w3', from: { node: 'n_refine', port: 'revise' }, to: { node: 'n_refine', port: 'revise' }, config: { maxCycles: 3 } },
    { id: 'w4', from: { node: 'n_refine', port: 'plan' }, to: { node: 'n_decompose', port: 'plan' } },
    { id: 'w5', from: { node: 'n_refine', port: 'plan' }, to: { node: 'n_impl', port: 'plan' } },
    { id: 'w6', from: { node: 'n_refine', port: 'plan' }, to: { node: 'n_review', port: 'plan' } },
    { id: 'w7', from: { node: 'n_refine', port: 'plan' }, to: { node: 'n_check', port: 'plan' } },
    { id: 'w8', from: { node: 'n_decompose', port: 'tasks' }, to: { node: 'n_impl', port: 'task' } },
    { id: 'w9', from: { node: 'n_impl', port: 'done' }, to: { node: 'n_review', port: 'done' } },
    { id: 'w10', from: { node: 'n_review', port: 'review' }, to: { node: 'n_impl', port: 'fix' }, config: { maxCycles: 3 } },
    { id: 'w11', from: { node: 'n_review', port: 'pass' }, to: { node: 'n_check', port: 'await' } },
    { id: 'w12', from: { node: 'n_check', port: 'checklist' }, to: { node: 'n_webui', port: 'checklist' } },
    { id: 'w13', from: { node: 'n_webui', port: 'pass' }, to: { node: 'n_end', port: 'result' } },
  ],
};

/** Provided Plan: no planner — the task node carries `planStoreSeed` (A2) and
 *  wires straight into `refiner.plan`. 9 nodes / 14 wires. */
const WF_PROVIDED_PLAN = {
  id: 'wf_provided-plan',
  name: 'Provided Plan',
  version: 2,
  domain: 'coding',
  createdAt: '2026-08-07T11:29:56.074Z',
  nodes: [
    { id: 'n_task', kind: 'task', x: 60, y: 198, config: { planStoreSeed: true } },
    { id: 'n_refine', kind: 'agent', key: 'refiner', x: 360, y: 198, config: {} },
    { id: 'n_decompose', kind: 'agent', key: 'decomposer', x: 660, y: 198, config: {} },
    { id: 'n_impl', kind: 'agent', key: 'implementer', x: 960, y: 198, config: {} },
    { id: 'n_review', kind: 'agent', key: 'reviewer', x: 1260, y: 198, config: {} },
    { id: 'n_check', kind: 'agent', key: 'manualTestsChecklist', x: 1560, y: 198, config: {} },
    { id: 'n_webui', kind: 'agent', key: 'manualWebUiTesting', x: 1860, y: 198, config: {} },
    { id: 'n_end', kind: 'end', x: 2160, y: 198, config: {} },
    { id: 'n_or', kind: 'or', x: 1410, y: 430, config: { arity: 2 } },
  ],
  wires: [
    { id: 'w1', from: { node: 'n_task', port: 'task' }, to: { node: 'n_refine', port: 'plan' } },
    { id: 'w2', from: { node: 'n_refine', port: 'revise' }, to: { node: 'n_refine', port: 'revise' }, config: { maxCycles: 3 } },
    { id: 'w3', from: { node: 'n_refine', port: 'plan' }, to: { node: 'n_decompose', port: 'plan' } },
    { id: 'w4', from: { node: 'n_refine', port: 'plan' }, to: { node: 'n_impl', port: 'plan' } },
    { id: 'w5', from: { node: 'n_refine', port: 'plan' }, to: { node: 'n_review', port: 'plan' } },
    { id: 'w6', from: { node: 'n_refine', port: 'plan' }, to: { node: 'n_check', port: 'plan' } },
    { id: 'w7', from: { node: 'n_decompose', port: 'tasks' }, to: { node: 'n_impl', port: 'task' } },
    { id: 'w8', from: { node: 'n_impl', port: 'done' }, to: { node: 'n_review', port: 'done' } },
    { id: 'w9', from: { node: 'n_review', port: 'review' }, to: { node: 'n_or', port: 'in1' }, config: { maxCycles: 3 } },
    { id: 'w10', from: { node: 'n_review', port: 'pass' }, to: { node: 'n_check', port: 'await' } },
    { id: 'w11', from: { node: 'n_check', port: 'checklist' }, to: { node: 'n_webui', port: 'checklist' } },
    { id: 'w12', from: { node: 'n_webui', port: 'review' }, to: { node: 'n_or', port: 'in2' }, config: { maxCycles: 3 } },
    { id: 'w13', from: { node: 'n_webui', port: 'pass' }, to: { node: 'n_end', port: 'result' } },
    { id: 'w14', from: { node: 'n_or', port: 'out' }, to: { node: 'n_impl', port: 'fix' } },
  ],
};

/** FULL-NO-Decompose: Full minus the decomposer, so the implementer takes the
 *  whole plan. 10 nodes / 15 wires. */
const WF_FULL_NO_DECOMPOSE = {
  id: 'wf_full-no-decompose',
  name: 'FULL-NO-Decompose',
  version: 2,
  domain: 'coding',
  createdAt: '2026-08-08T00:02:32.776Z',
  nodes: [
    { id: 'n_task', kind: 'task', x: 60, y: 198, config: {} },
    { id: 'n_clarify', kind: 'agent', key: 'clarify', x: 360, y: 198, config: {} },
    { id: 'n_plan', kind: 'agent', key: 'planner', x: 660, y: 198, config: {} },
    { id: 'n_refine', kind: 'agent', key: 'refiner', x: 960, y: 198, config: {} },
    { id: 'n_impl', kind: 'agent', key: 'implementer', x: 1260, y: 198, config: {} },
    { id: 'n_review', kind: 'agent', key: 'reviewer', x: 1560, y: 198, config: {} },
    { id: 'n_check', kind: 'agent', key: 'manualTestsChecklist', x: 1860, y: 198, config: {} },
    { id: 'n_webui', kind: 'agent', key: 'manualWebUiTesting', x: 2160, y: 198, config: {} },
    { id: 'n_end', kind: 'end', x: 2460, y: 198, config: {} },
    { id: 'n_or', kind: 'or', x: 1710, y: 430, config: { arity: 2 } },
  ],
  wires: [
    { id: 'w1', from: { node: 'n_task', port: 'task' }, to: { node: 'n_clarify', port: 'task' } },
    { id: 'w2', from: { node: 'n_task', port: 'task' }, to: { node: 'n_plan', port: 'task' } },
    { id: 'w3', from: { node: 'n_clarify', port: 'answers' }, to: { node: 'n_plan', port: 'answers' } },
    { id: 'w4', from: { node: 'n_plan', port: 'plan' }, to: { node: 'n_refine', port: 'plan' } },
    { id: 'w5', from: { node: 'n_refine', port: 'revise' }, to: { node: 'n_refine', port: 'revise' }, config: { maxCycles: 3 } },
    { id: 'w6', from: { node: 'n_refine', port: 'plan' }, to: { node: 'n_impl', port: 'plan' } },
    { id: 'w7', from: { node: 'n_refine', port: 'plan' }, to: { node: 'n_review', port: 'plan' } },
    { id: 'w8', from: { node: 'n_refine', port: 'plan' }, to: { node: 'n_check', port: 'plan' } },
    { id: 'w9', from: { node: 'n_impl', port: 'done' }, to: { node: 'n_review', port: 'done' } },
    { id: 'w10', from: { node: 'n_review', port: 'review' }, to: { node: 'n_or', port: 'in1' }, config: { maxCycles: 3 } },
    { id: 'w11', from: { node: 'n_review', port: 'pass' }, to: { node: 'n_check', port: 'await' } },
    { id: 'w12', from: { node: 'n_check', port: 'checklist' }, to: { node: 'n_webui', port: 'checklist' } },
    { id: 'w13', from: { node: 'n_webui', port: 'review' }, to: { node: 'n_or', port: 'in2' }, config: { maxCycles: 3 } },
    { id: 'w14', from: { node: 'n_webui', port: 'pass' }, to: { node: 'n_end', port: 'result' } },
    { id: 'w15', from: { node: 'n_or', port: 'out' }, to: { node: 'n_impl', port: 'fix' } },
  ],
};

/** Quick Fix: plan -> implement -> review, no refiner, no checklist. The
 *  reviewer's only other input is the VOID `done` port, which is why it stays
 *  warning-free under V18 (exemption (b)). 5 nodes / 6 wires. */
const WF_QUICK_FIX = {
  id: 'wf_quick-fix',
  name: 'Quick Fix',
  version: 2,
  domain: 'coding',
  createdAt: '2026-08-09T14:40:59.262Z',
  nodes: [
    { id: 'n_task', kind: 'task', x: 60, y: 198, config: {} },
    { id: 'n_plan', kind: 'agent', key: 'planner', x: 360, y: 198, config: {} },
    { id: 'n_impl', kind: 'agent', key: 'implementer', x: 660, y: 198, config: {} },
    { id: 'n_review', kind: 'agent', key: 'reviewer', x: 960, y: 198, config: {} },
    { id: 'n_end', kind: 'end', x: 1260, y: 198, config: {} },
  ],
  wires: [
    { id: 'w1', from: { node: 'n_task', port: 'task' }, to: { node: 'n_plan', port: 'task' } },
    { id: 'w2', from: { node: 'n_plan', port: 'plan' }, to: { node: 'n_impl', port: 'plan' } },
    { id: 'w3', from: { node: 'n_plan', port: 'plan' }, to: { node: 'n_review', port: 'plan' } },
    { id: 'w4', from: { node: 'n_impl', port: 'done' }, to: { node: 'n_review', port: 'done' } },
    { id: 'w5', from: { node: 'n_review', port: 'review' }, to: { node: 'n_impl', port: 'fix' }, config: { maxCycles: 3 } },
    { id: 'w6', from: { node: 'n_review', port: 'pass' }, to: { node: 'n_end', port: 'result' } },
  ],
};

/** Clarify -> Implement: clarify -> plan -> refine -> implement -> review.
 *  7 nodes / 10 wires. */
const WF_CLARIFY_IMPLEMENT = {
  id: 'wf_clarify-implement',
  name: 'Clarify -> Implement',
  version: 2,
  domain: 'coding',
  createdAt: '2026-08-09T15:16:43.806Z',
  nodes: [
    { id: 'n_task', kind: 'task', x: 60, y: 198, config: {} },
    { id: 'n_clarify', kind: 'agent', key: 'clarify', x: 360, y: 198, config: {} },
    { id: 'n_plan', kind: 'agent', key: 'planner', x: 660, y: 198, config: {} },
    { id: 'n_refine', kind: 'agent', key: 'refiner', x: 960, y: 198, config: {} },
    { id: 'n_impl', kind: 'agent', key: 'implementer', x: 1260, y: 198, config: {} },
    { id: 'n_review', kind: 'agent', key: 'reviewer', x: 1560, y: 198, config: {} },
    { id: 'n_end', kind: 'end', x: 1860, y: 198, config: {} },
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
};

/** Clarify -> Quick Fix: Quick Fix with a clarify step in front. 6 nodes /
 *  8 wires. */
const WF_CLARIFY_QUICK_FIX = {
  id: 'wf_clarify-quick-fix',
  name: 'Clarify -> Quick Fix',
  version: 2,
  domain: 'coding',
  createdAt: '2026-08-09T15:18:40.077Z',
  nodes: [
    { id: 'n_task', kind: 'task', x: 60, y: 198, config: {} },
    { id: 'n_clarify', kind: 'agent', key: 'clarify', x: 360, y: 198, config: {} },
    { id: 'n_plan', kind: 'agent', key: 'planner', x: 660, y: 198, config: {} },
    { id: 'n_impl', kind: 'agent', key: 'implementer', x: 960, y: 198, config: {} },
    { id: 'n_review', kind: 'agent', key: 'reviewer', x: 1260, y: 198, config: {} },
    { id: 'n_end', kind: 'end', x: 1560, y: 198, config: {} },
  ],
  wires: [
    { id: 'w1', from: { node: 'n_task', port: 'task' }, to: { node: 'n_clarify', port: 'task' } },
    { id: 'w2', from: { node: 'n_task', port: 'task' }, to: { node: 'n_plan', port: 'task' } },
    { id: 'w3', from: { node: 'n_clarify', port: 'answers' }, to: { node: 'n_plan', port: 'answers' } },
    { id: 'w4', from: { node: 'n_plan', port: 'plan' }, to: { node: 'n_impl', port: 'plan' } },
    { id: 'w5', from: { node: 'n_plan', port: 'plan' }, to: { node: 'n_review', port: 'plan' } },
    { id: 'w6', from: { node: 'n_impl', port: 'done' }, to: { node: 'n_review', port: 'done' } },
    { id: 'w7', from: { node: 'n_review', port: 'review' }, to: { node: 'n_impl', port: 'fix' }, config: { maxCycles: 3 } },
    { id: 'w8', from: { node: 'n_review', port: 'pass' }, to: { node: 'n_end', port: 'result' } },
  ],
};

/** The 7 seeds, in seeding order. */
export const SEED_TEMPLATES = deepFreeze([
  WF_FULL,
  WF_NO_CLARIFY,
  WF_PROVIDED_PLAN,
  WF_FULL_NO_DECOMPOSE,
  WF_QUICK_FIX,
  WF_CLARIFY_IMPLEMENT,
  WF_CLARIFY_QUICK_FIX,
]);

/** V17 overlay migration: `config_workflow_nodes.node_id` rewrites, old v1 step
 *  id -> v2 node id. wf_default is included for projects carrying overlays on
 *  the builtin default workflow. */
export const NODE_ID_MAP = deepFreeze({
  wf_full: { s0_0: 'n_clarify', s1_0: 'n_plan', s2_0: 'n_refine', s3_0: 'n_decompose', s4_0: 'n_impl', s5_0: 'n_review', s6_0: 'n_check', s7_0: 'n_webui' },
  'wf_no-clarify': { s0_0: 'n_plan', s1_0: 'n_refine', s2_0: 'n_decompose', s3_0: 'n_impl', s4_0: 'n_review', s5_0: 'n_check', s6_0: 'n_webui' },
  'wf_provided-plan': { s0_0: 'n_refine', s1_0: 'n_decompose', s2_0: 'n_impl', s3_0: 'n_review', s4_0: 'n_check', s5_0: 'n_webui' },
  'wf_full-no-decompose': { s0_0: 'n_clarify', s1_0: 'n_plan', s2_0: 'n_refine', s3_0: 'n_impl', s4_0: 'n_review', s5_0: 'n_check', s6_0: 'n_webui' },
  'wf_quick-fix': { s0_0: 'n_plan', s1_0: 'n_impl', s2_0: 'n_review' },
  'wf_clarify-implement': { s0_0: 'n_clarify', s1_0: 'n_plan', s2_0: 'n_refine', s3_0: 'n_impl', s4_0: 'n_review' },
  'wf_clarify-quick-fix': { s0_0: 'n_clarify', s1_0: 'n_plan', s2_0: 'n_impl', s3_0: 'n_review' },
  wf_default: { s_clarify: 'n_clarify', s0_0: 'n_plan', s1_0: 'n_refine', s2_0: 'n_impl', s3_0: 'n_review' },
});

/** V17 overlay migration: `config_workflow_feedbacks` -> `config_workflow_wires`
 *  rows, old feedback id -> v2 wire id. Wire ids reflect Amendment f as revised
 *  (single-wire inputs; the double-loop seeds' blocking wires keep their ids as
 *  the OR valve's in-wires — exactly where budgets and gates now count, so
 *  migrated overlays land correctly by construction).
 *
 *  wf_no-clarify's fb_0 is the refine self-wire and fb_1 the review loop wire —
 *  the user's max_cycles=6 overlays ride those two. wf_clarify-implement's fb
 *  order is BELIEVED swapped in the DB and is UNVERIFIED (that template is absent
 *  from the reference DB); V17's dynamic resolver, not this row, is what makes
 *  the migration safe. */
export const FB_WIRE_MAP = deepFreeze({
  wf_full: { fb_0: 'w5', fb_1: 'w12', fb_2: 'w15' },
  'wf_no-clarify': { fb_0: 'w3', fb_1: 'w10' },
  'wf_provided-plan': { fb_0: 'w2', fb_1: 'w9', fb_2: 'w12' },
  'wf_full-no-decompose': { fb_0: 'w5', fb_1: 'w10', fb_2: 'w13' },
  'wf_quick-fix': { fb_0: 'w5' },
  'wf_clarify-implement': { fb_0: 'w9', fb_1: 'w5' },
  'wf_clarify-quick-fix': { fb_0: 'w7' },
  wf_default: { fb_refine: 'w5', fb_review: 'w9' },
});
