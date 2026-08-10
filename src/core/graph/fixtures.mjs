// src/core/graph/fixtures.mjs
// Canonical node-graph v2 fixtures: the shared contract stub every graph test
// (engine AND UI) imports. Pure data + one pure factory — no IO; the only import
// is the shipping default workflow it re-exports.
//
// `FIXTURE_DEFAULT` is wf_default as a version-2 template — re-exported straight
// from builtin-workflows.mjs so the fixture and the SHIPPING constant can never
// drift; `FIXTURE_FLOW` is a flow-card graph exercising the payload-forwarding OR
// card, the static AND card, the synthesized await port and the End node;
// `FIXTURE_PORTS` is the spec §5 port table as data for the 11 builtin agent
// keys, materialized in the exact normalized shape the registry's normalizeMeta
// produces so the later drift guard compares like with like.

import { GRAPH_DEFAULT_WORKFLOW } from './builtin-workflows.mjs';

/** wf_default as a version-2 graph. w5 (refine self-loop) and w9 (review -> fix)
 *  are the loop wires; w10 lands the clean review on the End node. Deep-frozen at
 *  the source — clone it (structuredClone) before mutating in a test. */
export { GRAPH_DEFAULT_WORKFLOW as FIXTURE_DEFAULT };

/** Flow-card graph: n_check.plan is fed through the payload-forwarding OR (w8
 *  planner draft, w9 refined plan — homogeneous md), which fires on the draft
 *  and AGAIN on the clean plan, superseding the payload; the static AND
 *  (w11/w12/w13) gates n_check through its synthesized await port. Every input
 *  carries exactly ONE wire (V7); loopWires {w3, w7}; zero errors, zero
 *  warnings. The task node + w1 are the entry — without them V20 and V9 fail. */
export const FIXTURE_FLOW = {
  id: 'wf_flow_fixture',
  name: 'Flow',
  version: 2,
  domain: 'coding',
  nodes: [
    { id: 'n_task2', kind: 'task', x: -220, y: 160, config: {} },
    { id: 'n_plan', kind: 'agent', key: 'planner', x: 40, y: 160, config: {} },
    { id: 'n_refine', kind: 'agent', key: 'refiner', x: 320, y: 140, config: {} },
    { id: 'n_impl', kind: 'agent', key: 'implementer', x: 320, y: 420, config: {} },
    { id: 'n_review', kind: 'agent', key: 'reviewer', x: 640, y: 420, config: {} },
    { id: 'n_or', kind: 'or', x: 640, y: 40, config: { arity: 2 } },
    { id: 'n_and', kind: 'and', x: 900, y: 200, config: { arity: 2 } },
    { id: 'n_check', kind: 'agent', key: 'manualTestsChecklist', x: 1160, y: 260, config: {} },
    { id: 'n_end', kind: 'end', x: 1420, y: 260, config: {} },
  ],
  wires: [
    { id: 'w1', from: { node: 'n_task2', port: 'task' }, to: { node: 'n_plan', port: 'task' } },
    { id: 'w2', from: { node: 'n_plan', port: 'plan' }, to: { node: 'n_refine', port: 'plan' } },
    { id: 'w3', from: { node: 'n_refine', port: 'revise' }, to: { node: 'n_refine', port: 'revise' }, config: { maxCycles: 3 } },
    { id: 'w4', from: { node: 'n_refine', port: 'plan' }, to: { node: 'n_impl', port: 'plan' } },
    { id: 'w5', from: { node: 'n_refine', port: 'plan' }, to: { node: 'n_review', port: 'plan' } },
    { id: 'w6', from: { node: 'n_impl', port: 'done' }, to: { node: 'n_review', port: 'done' } },
    { id: 'w7', from: { node: 'n_review', port: 'review' }, to: { node: 'n_impl', port: 'fix' }, config: { maxCycles: 3 } },
    { id: 'w8', from: { node: 'n_plan', port: 'plan' }, to: { node: 'n_or', port: 'in1' } },
    { id: 'w9', from: { node: 'n_refine', port: 'plan' }, to: { node: 'n_or', port: 'in2' } },
    { id: 'w10', from: { node: 'n_or', port: 'out' }, to: { node: 'n_check', port: 'plan' } },
    { id: 'w11', from: { node: 'n_refine', port: 'plan' }, to: { node: 'n_and', port: 'in1' } },
    { id: 'w12', from: { node: 'n_review', port: 'pass' }, to: { node: 'n_and', port: 'in2' } },
    { id: 'w13', from: { node: 'n_and', port: 'out' }, to: { node: 'n_check', port: 'await' } },
    { id: 'w14', from: { node: 'n_check', port: 'checklist' }, to: { node: 'n_end', port: 'result' } },
  ],
};

/** The spec §5 port table as data, for all 11 builtin keys, in the canonical
 *  normalized shape — stated PER SIDE, because the sides materialize DIFFERENT
 *  fields. Every INPUT materializes `required` (default true) plus, on NON-VOID
 *  inputs only, `as: 'file'`; void inputs carry no default `as`, and the only
 *  `as` a void input ever carries is an EXPLICIT 'worktree'. Inputs never carry
 *  `when`, `store` or `filename`. Every OUTPUT materializes `when: 'always'`
 *  plus, on NON-VOID outputs, `store: 'run'` and `artifactKind: <port id>`
 *  alongside its `filename`; outputs never carry `required`. Agent-LEVEL fields
 *  materialize NOTHING: `runnerType` is present on every entry as a required
 *  field, while verdict/sideEffect/wantsRequest/workspaceFanOut/
 *  workspaceStrategy/workspaceVariantOf/placeable/scope appear only where
 *  actually set. `loop`/`expands`/`directive` likewise appear only where set.
 *  The synthesized `await` port is NOT stored here — portsFnFor appends it at
 *  resolution. */
export const FIXTURE_PORTS = {
  clarify: {
    runnerType: 'clarifier',
    inputs: [{ id: 'task', type: 'md', required: true, as: 'file' }],
    outputs: [{ id: 'answers', type: 'json', when: 'always', filename: 'clarify.json', store: 'run', artifactKind: 'clarify' }],
  },
  planner: {
    runnerType: 'producer', workspaceFanOut: true, workspaceStrategy: 'explore',
    inputs: [
      { id: 'task', type: 'md', required: true, as: 'file' },
      { id: 'answers', type: 'json', required: false, as: 'answers' },
      { id: 'revise', type: 'md', required: false, loop: true, as: 'file',
        directive: '## Revise to address the review\n\nA reviewer found issues with the previous plan. Re-plan from scratch (cold start) and address EVERY critical and major finding in the review below. Preserve the "## Clarifications (Q&A)" section.' },
    ],
    outputs: [{ id: 'plan', type: 'md', when: 'always', filename: '{base}{vsuffix}.md', store: 'project', artifactKind: 'plan' }],
  },
  refiner: {
    runnerType: 'producer', wantsRequest: true, workspaceFanOut: true, workspaceStrategy: 'explore',
    verdict: { filename: 'refine-review-cycle{cycle}.json' },
    inputs: [
      { id: 'plan', type: 'md', required: true, as: 'file' },
      { id: 'revise', type: 'md', required: false, loop: true, as: 'file' },
    ],
    outputs: [
      { id: 'plan', type: 'md', when: 'clean', filename: '{base}{vsuffix}.md', store: 'project', artifactKind: 'plan' },
      { id: 'revise', type: 'md', when: 'blocking', filename: '{base}{vsuffix}.md', store: 'project', artifactKind: 'plan' },
    ],
  },
  implementer: {
    runnerType: 'producer', sideEffect: 'code', workspaceFanOut: true, workspaceStrategy: 'task',
    inputs: [
      { id: 'plan', type: 'md', required: true, as: 'file' },
      { id: 'fix', type: 'md', required: false, loop: true, as: 'fix-review',
        directive: 'Address EVERY critical and major issue in the review below, then re-run the tests. Follow the plan; deviate only if something does not work at all.' },
      { id: 'task', type: 'json', required: false, expands: true, as: 'file',
        directive: 'Implement the task below using TDD (red-green-refactor). The TASK file is a self-contained vertical slice and is AUTHORITATIVE — do exactly what it says and nothing outside its scope. The plan is reference/context only; you do NOT need to read the whole plan.' },
    ],
    outputs: [{ id: 'done', type: 'void', when: 'always' }],
  },
  reviewer: {
    runnerType: 'verifier', wantsRequest: true, workspaceStrategy: 'review',   // NO workspaceFanOut — FANOUT_ELIGIBLE deliberately excludes reviewer
    verdict: { filename: 'impl-review-cycle{cycle}.json' },
    inputs: [
      { id: 'plan', type: 'md', required: true, as: 'file' },
      { id: 'done', type: 'void', required: false, as: 'worktree' },
    ],
    outputs: [
      { id: 'review', type: 'md', when: 'blocking', filename: '{base}-impl-review.md', store: 'project', artifactKind: 'review' },
      { id: 'pass', type: 'void', when: 'clean' },
    ],
  },
  planReviewer: {
    runnerType: 'verifier', wantsRequest: true, workspaceFanOut: true, workspaceStrategy: 'explore',
    verdict: { filename: 'plan-review-cycle{cycle}.json' },
    inputs: [{ id: 'plan', type: 'md', required: true, as: 'file' }],
    outputs: [
      { id: 'review', type: 'md', when: 'blocking', filename: '{base}-plan-review.md', store: 'project', artifactKind: 'review' },
      { id: 'pass', type: 'void', when: 'clean' },
    ],
  },
  decomposer: {
    runnerType: 'producer',
    inputs: [{ id: 'plan', type: 'md', required: true, as: 'file' }],
    outputs: [{ id: 'tasks', type: 'json', when: 'always', filename: 'decomposition.json', store: 'run', artifactKind: 'tasks' }],
    // artifactKind 'tasks' = the port-id default — cross-checked against the v1 artifact-event kind before the sidecars land
  },
  manualTestsChecklist: {
    runnerType: 'producer',
    inputs: [{ id: 'plan', type: 'md', required: true, as: 'file' }],   // start REMOVED (Amendment f)
    outputs: [{ id: 'checklist', type: 'md', when: 'always', filename: 'manual-tests-checklist.md', store: 'run', artifactKind: 'checklist' }],
  },
  manualWebUiTesting: {
    runnerType: 'verifier',
    verdict: { filename: 'webui-review-cycle{cycle}.json' },
    inputs: [{ id: 'checklist', type: 'md', required: true, as: 'file' }],
    outputs: [
      { id: 'review', type: 'md', when: 'blocking', filename: 'webui-review-cycle{cycle}.md', store: 'run', artifactKind: 'webui' },
      { id: 'pass', type: 'void', when: 'clean' },
    ],
  },
  workspaceReviewer: {
    // NO wantsRequest: v1's request block named refiner|reviewer|planReviewer only, and the
    // workspace-substituted node's key matched none of them, so v1 workspace reviews carried none.
    runnerType: 'verifier', scope: 'workspace-only', workspaceVariantOf: 'reviewer',
    workspaceFanOut: true, workspaceStrategy: 'review',
    verdict: { filename: 'ws-review-cycle{cycle}.json' },
    inputs: [
      { id: 'plan', type: 'md', required: true, as: 'file' },
      { id: 'done', type: 'void', required: false, as: 'worktree' },
    ],
    outputs: [
      { id: 'review', type: 'md', when: 'blocking', filename: '{base}-ws-review.md', store: 'project', artifactKind: 'review' },
      { id: 'pass', type: 'void', when: 'clean' },
    ],
  },
  workspaceScanner: {
    runnerType: 'producer', scope: 'workspace-only', placeable: false,
    inputs: [{ id: 'task', type: 'md', required: true, as: 'file' }],
    outputs: [{ id: 'workspace', type: 'md', when: 'always', filename: 'workspace-description.md', store: 'run', artifactKind: 'workspace' }],
  },
};

/** The universal synthesized agent input. The resolveGraph layer IMPORTS this;
 *  the client graph-model MIRRORS it byte-identically (ui/public cannot import
 *  from src/core — no build step). One authored definition, one policy-
 *  sanctioned copy, both covered by the same fixture assertions. */
export const AWAIT_PORT = Object.freeze({ id: 'await', type: 'any', required: false, synthetic: true });

/** Build the ports function over a static port map keyed by agent key: agents
 *  get their table entry plus the synthesized `await` input appended last;
 *  task/end/and/or/combine get their flow ports. */
export function portsFnFor(fixturePorts) {
  return (node) => {
    if (node.kind === 'agent') {
      const m = fixturePorts[node.key];
      if (!m) return m;                      // unknown key — V4's problem; keep the dangling-meta no-crash contract
      return { ...m, inputs: [...m.inputs, AWAIT_PORT] };
    }
    if (node.kind === 'task') {
      return { inputs: [], outputs: [{ id: 'task', type: 'md', when: 'always' }] };
    }
    if (node.kind === 'end') {
      return { inputs: [{ id: 'result', type: 'any', required: true }], outputs: [] };
    }
    if (node.kind === 'and' || node.kind === 'or' || node.kind === 'combine') {
      const arity = node.config?.arity ?? 2;
      const ins = Array.from({ length: arity }, (_, i) => ({
        id: `in${i + 1}`, type: node.kind === 'combine' ? 'md' : 'any', required: true,
      }));
      const out = {   // combine md · or 'any' (resolved later by resolveOrOutType) · and void
        id: 'out', type: node.kind === 'combine' ? 'md' : node.kind === 'or' ? 'any' : 'void', when: 'always',
      };
      return { inputs: ins, outputs: [out] };
    }
    return undefined;                        // unknown kind — V3's problem
  };
}
