// src/core/graph/builtin-workflows.mjs
// The SHIPPING builtin workflow: wf_default as a version-2 template. This is the
// constant the seeder writes and the V17 migration reconciles against — not a
// test fixture. `fixtures.mjs` re-exports it as FIXTURE_DEFAULT so the engine
// tests and the shipping default can never drift apart.
//
// Pure data + one pure helper — no IO, no dependency on the registry. The one import is the pure
// role-review round cap, a shared shape constant.
import { ROLE_REVIEW_MAX_ROUNDS } from '../../shared/shape/role-review.mjs';

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
 *  are the loop wires; w10 lands the clean review on the End node. Refine runs ONE light
 *  cycle: a refine that still blocks (or asks for its re-check) continues with the open
 *  issues recorded instead of looping, and the code review catches what is left. */
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
    { id: 'w5', from: { node: 'n_refine', port: 'revise' }, to: { node: 'n_refine', port: 'revise' }, config: { maxCycles: 1, onExhausted: 'clean' } },
    { id: 'w6', from: { node: 'n_refine', port: 'plan' }, to: { node: 'n_impl', port: 'plan' } },
    { id: 'w7', from: { node: 'n_refine', port: 'plan' }, to: { node: 'n_review', port: 'plan' } },
    { id: 'w8', from: { node: 'n_impl', port: 'done' }, to: { node: 'n_review', port: 'done' } },
    { id: 'w9', from: { node: 'n_review', port: 'review' }, to: { node: 'n_impl', port: 'fix' }, config: { maxCycles: 3 } },
    { id: 'w10', from: { node: 'n_review', port: 'pass' }, to: { node: 'n_end', port: 'result' } },
  ],
});

/** The Lean built-in: Clarify -> a design-level Plan -> Implement -> an adversarial Review -> ONE
 *  fix pass (w9 maxCycles 2: review, fix, re-review, then the person decides). No Refine: the
 *  implementer proves the plan by building it, and the review's severity floors catch what refine
 *  used to. The planner's research lanes run on Sonnet because the planner re-reads what it builds
 *  on; the reviewer keeps the auto pick for its severity calls. Wire ids follow Default's (per-project
 *  loop budgets are keyed by wire id). Reserved like wf_memory_defrag: never a row, listed after
 *  Default, opened read-only in the composer. The id has an underscore so no NAME can slug onto it
 *  (a saved "Lean" stays wf_lean). It is NOT the fallback default (yet). */
export const LEAN_WORKFLOW_ID = 'wf_lean_build';
export const LEAN_WORKFLOW_NAME = 'Lean';
export const GRAPH_LEAN_WORKFLOW = deepFreeze({
  id: LEAN_WORKFLOW_ID,
  name: LEAN_WORKFLOW_NAME,
  version: 2,
  domain: 'coding',
  createdAt: '1970-01-01T00:00:00.000Z',
  updatedAt: '1970-01-01T00:00:00.000Z',
  nodes: [
    { id: 'n_task', kind: 'task', x: 40, y: 200, config: {} },
    { id: 'n_clarify', kind: 'agent', key: 'clarify', x: 320, y: 200, config: {} },
    { id: 'n_plan', kind: 'agent', key: 'planner', x: 600, y: 200, config: { subagentModel: 'sonnet' } },
    { id: 'n_impl', kind: 'agent', key: 'implementer', x: 880, y: 200, config: {} },
    { id: 'n_review', kind: 'agent', key: 'reviewer', x: 1160, y: 200, config: {} },
    { id: 'n_end', kind: 'end', x: 1440, y: 200, config: {} },
  ],
  wires: [
    { id: 'w1', from: { node: 'n_task', port: 'task' }, to: { node: 'n_clarify', port: 'task' } },
    { id: 'w2', from: { node: 'n_task', port: 'task' }, to: { node: 'n_plan', port: 'task' } },
    { id: 'w3', from: { node: 'n_clarify', port: 'answers' }, to: { node: 'n_plan', port: 'answers' } },
    { id: 'w6', from: { node: 'n_plan', port: 'plan' }, to: { node: 'n_impl', port: 'plan' } },
    { id: 'w7', from: { node: 'n_plan', port: 'plan' }, to: { node: 'n_review', port: 'plan' } },
    { id: 'w8', from: { node: 'n_impl', port: 'done' }, to: { node: 'n_review', port: 'done' } },
    { id: 'w9', from: { node: 'n_review', port: 'review' }, to: { node: 'n_impl', port: 'fix' }, config: { maxCycles: 2 } },
    { id: 'w10', from: { node: 'n_review', port: 'pass' }, to: { node: 'n_end', port: 'result' } },
  ],
});

/** The Auto entry's reserved id. Like wf_default it is NEVER a row: the picker
 *  lists it as a client-side constant, POST /api/run + the CLI accept it, and the
 *  orchestrator decides the real graph per run (auto-workflow spec §5). */
export const AUTO_WORKFLOW_ID = 'wf_auto';
export const AUTO_WORKFLOW_NAME = 'Auto';

/** What readWorkflow('wf_auto') answers: an id + name and NO graph, so nothing
 *  can validate or run it as a template. `auto: true` is the discriminator. */
export const AUTO_WORKFLOW_STUB = deepFreeze({
  id: AUTO_WORKFLOW_ID,
  name: AUTO_WORKFLOW_NAME,
  version: 2,
  domain: 'coding',
  auto: true,
  createdAt: '1970-01-01T00:00:00.000Z',
  updatedAt: '1970-01-01T00:00:00.000Z',
});

/** The Memory defragment workflow (agent-memory-design.md §7.2): one agent node between the
 *  task and End. Reserved like wf_default — never a row, read through readWorkflow, hidden
 *  from listWorkflows, undeletable, opened read-only in the composer. A run of it needs the
 *  `memoryScope` option (memory-sync.mjs validateMemoryScope). */
export const MEMORY_DEFRAG_WORKFLOW_ID = 'wf_memory_defrag';
export const MEMORY_DEFRAG_WORKFLOW_NAME = 'Memory defragment';
export const GRAPH_MEMORY_DEFRAG_WORKFLOW = deepFreeze({
  id: MEMORY_DEFRAG_WORKFLOW_ID,
  name: MEMORY_DEFRAG_WORKFLOW_NAME,
  version: 2,
  domain: 'shared',
  createdAt: '1970-01-01T00:00:00.000Z',
  updatedAt: '1970-01-01T00:00:00.000Z',
  nodes: [
    { id: 'n_task', kind: 'task', x: 40, y: 200, config: {} },
    // Sonnet 5 by default: a bounded restructure of a few markdown files. The template layer
    // is the lowest (workflows.mjs resolveGraph), so a per-role or per-node pick still wins.
    { id: 'n_defrag', kind: 'agent', key: 'memoryDefragmenter', x: 320, y: 200, config: { model: 'claude-sonnet-5' } },
    { id: 'n_end', kind: 'end', x: 600, y: 200, config: {} },
  ],
  wires: [
    { id: 'w1', from: { node: 'n_task', port: 'task' }, to: { node: 'n_defrag', port: 'task' } },
    { id: 'w2', from: { node: 'n_defrag', port: 'report' }, to: { node: 'n_end', port: 'result' } },
  ],
});

/** What a Workspace scan runs on when nothing else is named (D15/D16): the scan agent on Sonnet 5
 *  at medium effort, its per-project investigators on the `sonnet` alias at medium effort. The
 *  scan node's template config carries the same values, so every path agrees. */
export const WORKSPACE_SCAN_DEFAULT_MODELS = deepFreeze({
  scanModel: 'claude-sonnet-5', scanEffort: 'medium', agentModel: 'sonnet', agentEffort: 'medium',
});

/** The Workspace scan workflow — the hybrid interconnection map (wsmap spec D5, "v3" of the scan):
 *  task -> extract (script) -> survey (agent workspaceScanner, node n_scan, fan-out) -> catalog
 *  (script) -> usage (agent workspaceUsageMapper, fan-out) -> join (script) -> synth (agent
 *  workspaceSynthesizer) -> render (script) -> End. Code extracts, verifies and joins; the agents only
 *  fill gaps, confirm uses and write prose; render writes workspace-scan.md under the member-count
 *  line budget. Every card is placeable:false — only a RESERVED workflow may carry them
 *  (workflows.mjs). Reserved like wf_memory_defrag, but NEVER listed (GET /api/workflows, the Ask
 *  catalog and the composer leave it out): only POST /api/workspaces/scan and
 *  /api/workspaces/:id/scan start it. run-harness treats it as READ-ONLY (nothing committed, every
 *  member's run branch deleted at teardown) and, on `done`, saves render's output as the
 *  workspace's description (workspace-scan-run.mjs finalizeWorkspaceScan).
 *  `version: 2` is the TEMPLATE FORMAT (resolveGraph runs version 2 only), not the scan's revision. */
export const WORKSPACE_SCAN_WORKFLOW_ID = 'wf_workspace_scan';
export const WORKSPACE_SCAN_WORKFLOW_NAME = 'Workspace scan';
/** The model config of the scan's fan-out agents (survey, usage): the D15/D16 defaults. */
const SCAN_FANOUT_CONFIG = {
  model: WORKSPACE_SCAN_DEFAULT_MODELS.scanModel,
  effort: WORKSPACE_SCAN_DEFAULT_MODELS.scanEffort,
  subagentModel: WORKSPACE_SCAN_DEFAULT_MODELS.agentModel,
  subagentEffort: WORKSPACE_SCAN_DEFAULT_MODELS.agentEffort,
};
export const GRAPH_WORKSPACE_SCAN_WORKFLOW = deepFreeze({
  id: WORKSPACE_SCAN_WORKFLOW_ID,
  name: WORKSPACE_SCAN_WORKFLOW_NAME,
  version: 2,
  domain: 'shared',
  createdAt: '1970-01-01T00:00:00.000Z',
  updatedAt: '1970-01-01T00:00:00.000Z',
  nodes: [
    { id: 'n_task', kind: 'task', x: 40, y: 200, config: {} },
    { id: 'n_extract', kind: 'script', key: 'workspaceMapExtract', x: 280, y: 200, config: {} },
    { id: 'n_scan', kind: 'agent', key: 'workspaceScanner', x: 520, y: 80, config: { ...SCAN_FANOUT_CONFIG } },
    // The two-input stages wait for BOTH inputs (awaitAll): the V18 double-fire guard.
    { id: 'n_catalog', kind: 'script', key: 'workspaceMapCatalog', x: 760, y: 200, config: { awaitAll: true } },
    { id: 'n_usage', kind: 'agent', key: 'workspaceUsageMapper', x: 1000, y: 80, config: { ...SCAN_FANOUT_CONFIG } },
    { id: 'n_join', kind: 'script', key: 'workspaceMapJoin', x: 1240, y: 200, config: { awaitAll: true } },
    { id: 'n_synth', kind: 'agent', key: 'workspaceSynthesizer', x: 1480, y: 80, config: {
      model: WORKSPACE_SCAN_DEFAULT_MODELS.scanModel,
      effort: WORKSPACE_SCAN_DEFAULT_MODELS.scanEffort,
    } },
    { id: 'n_render', kind: 'script', key: 'workspaceMapRender', x: 1720, y: 200, config: { awaitAll: true } },
    { id: 'n_end', kind: 'end', x: 1960, y: 200, config: {} },
  ],
  wires: [
    { id: 'w1', from: { node: 'n_task', port: 'task' }, to: { node: 'n_extract', port: 'task' } },
    { id: 'w2', from: { node: 'n_extract', port: 'brief' }, to: { node: 'n_scan', port: 'brief' } },
    { id: 'w3', from: { node: 'n_extract', port: 'extract' }, to: { node: 'n_catalog', port: 'extract' } },
    { id: 'w4', from: { node: 'n_scan', port: 'survey' }, to: { node: 'n_catalog', port: 'survey' } },
    { id: 'w5', from: { node: 'n_catalog', port: 'brief' }, to: { node: 'n_usage', port: 'brief' } },
    { id: 'w6', from: { node: 'n_catalog', port: 'catalog' }, to: { node: 'n_join', port: 'catalog' } },
    { id: 'w7', from: { node: 'n_usage', port: 'usage' }, to: { node: 'n_join', port: 'usage' } },
    { id: 'w8', from: { node: 'n_join', port: 'brief' }, to: { node: 'n_synth', port: 'brief' } },
    { id: 'w9', from: { node: 'n_join', port: 'map' }, to: { node: 'n_render', port: 'map' } },
    { id: 'w10', from: { node: 'n_synth', port: 'synthesis' }, to: { node: 'n_render', port: 'synthesis' } },
    { id: 'w11', from: { node: 'n_render', port: 'workspace' }, to: { node: 'n_end', port: 'result' } },
  ],
});

/** The partial re-scan after a member REMOVAL (server afterMembersChanged, rescan: 'partial'):
 *  seed (script: the stored, pruned map the run froze → workspace-map.json + the synth brief)
 *  -> synth (workspaceSynthesizer) -> render -> End. No investigator, no graphify build
 *  (codeGraph: false): one agent rewrites the overview, the missing roles and the coordination
 *  notes. A scan in every other respect (isWorkspaceScanWorkflow): read-only, overrides frozen, saved
 *  by finalizeWorkspaceScan on `done` behind the same SET_CHANGED guard. Reserved, never listed. */
export const WORKSPACE_RESYNTH_WORKFLOW_ID = 'wf_workspace_resynth';
export const WORKSPACE_RESYNTH_WORKFLOW_NAME = 'Workspace re-synthesis';
export const GRAPH_WORKSPACE_RESYNTH_WORKFLOW = deepFreeze({
  id: WORKSPACE_RESYNTH_WORKFLOW_ID,
  name: WORKSPACE_RESYNTH_WORKFLOW_NAME,
  version: 2,
  domain: 'shared',
  codeGraph: false,
  createdAt: '1970-01-01T00:00:00.000Z',
  updatedAt: '1970-01-01T00:00:00.000Z',
  nodes: [
    { id: 'n_task', kind: 'task', x: 40, y: 200, config: {} },
    { id: 'n_seed', kind: 'script', key: 'workspaceMapResynth', x: 280, y: 200, config: {} },
    { id: 'n_synth', kind: 'agent', key: 'workspaceSynthesizer', x: 520, y: 80, config: {
      model: WORKSPACE_SCAN_DEFAULT_MODELS.scanModel,
      effort: WORKSPACE_SCAN_DEFAULT_MODELS.scanEffort,
    } },
    { id: 'n_render', kind: 'script', key: 'workspaceMapRender', x: 760, y: 200, config: { awaitAll: true } },
    { id: 'n_end', kind: 'end', x: 1000, y: 200, config: {} },
  ],
  wires: [
    { id: 'w1', from: { node: 'n_task', port: 'task' }, to: { node: 'n_seed', port: 'task' } },
    { id: 'w2', from: { node: 'n_seed', port: 'brief' }, to: { node: 'n_synth', port: 'brief' } },
    { id: 'w3', from: { node: 'n_seed', port: 'map' }, to: { node: 'n_render', port: 'map' } },
    { id: 'w4', from: { node: 'n_synth', port: 'synthesis' }, to: { node: 'n_render', port: 'synthesis' } },
    { id: 'w5', from: { node: 'n_render', port: 'workspace' }, to: { node: 'n_end', port: 'result' } },
  ],
});
/** Workflows that ARE a Workspace scan (read-only run, finalize saves the map on done). */
export const WORKSPACE_SCAN_WORKFLOW_IDS = Object.freeze([WORKSPACE_SCAN_WORKFLOW_ID, WORKSPACE_RESYNTH_WORKFLOW_ID]);
export function isWorkspaceScanWorkflow(id) { return WORKSPACE_SCAN_WORKFLOW_IDS.includes(id); }

/** The PR fix workflow every Watch PR fix run and #620's Resolve in a pipeline start (pr-watch.mjs
 *  FIX_WORKFLOW_ID): Implementation
 *  -> Review Implementation, the blocking review looping back into the implementer. There is no
 *  planner: the task (the fix brief) feeds both plan ports. Reserved like wf_workspace_scan and NEVER
 *  listed — only the server starts it — so it runs on every home, not only one with a saved row.
 *  The id has an underscore so no NAME can slug onto it (slugify maps "_" to "-"). */
export const PR_FIX_WORKFLOW_ID = 'wf_pr_fix';
export const PR_FIX_WORKFLOW_NAME = 'PR fix';
export const GRAPH_PR_FIX_WORKFLOW = deepFreeze({
  id: PR_FIX_WORKFLOW_ID,
  name: PR_FIX_WORKFLOW_NAME,
  version: 2,
  domain: 'coding',
  // A fix brief names the failing check or comment; the agents read the code around it, so the
  // per-run graphify build (~30 s on this repo) would only delay the fix.
  codeGraph: false,
  createdAt: '1970-01-01T00:00:00.000Z',
  updatedAt: '1970-01-01T00:00:00.000Z',
  nodes: [
    { id: 'n_task', kind: 'task', x: 40, y: 200, config: {} },
    { id: 'n_impl', kind: 'agent', key: 'implementer', x: 320, y: 200, config: {} },
    { id: 'n_review', kind: 'agent', key: 'reviewer', x: 600, y: 200, config: {} },
    { id: 'n_end', kind: 'end', x: 880, y: 200, config: {} },
  ],
  wires: [
    { id: 'w1', from: { node: 'n_task', port: 'task' }, to: { node: 'n_impl', port: 'plan' } },
    { id: 'w2', from: { node: 'n_task', port: 'task' }, to: { node: 'n_review', port: 'plan' } },
    { id: 'w3', from: { node: 'n_impl', port: 'done' }, to: { node: 'n_review', port: 'done' } },
    { id: 'w4', from: { node: 'n_review', port: 'review' }, to: { node: 'n_impl', port: 'fix' }, config: { maxCycles: 3 } },
    { id: 'w5', from: { node: 'n_review', port: 'pass' }, to: { node: 'n_end', port: 'result' } },
  ],
});

/** The Shape it first workflows: wf_default's graph with the Clarify cap (3 questions, a hint to
 *  recommend an option) and a plan approval hold on Refine's `plan` output. wf_shape_ux adds the
 *  manual-test stages the UX perspective brings (wf_full-no-decompose's verifier tail). A run picks
 *  one through POST /api/run's `shape` field (core/shape/run.mjs). Reserved like wf_memory_defrag; the
 *  ids have an underscore, so only the name "Shape" can slug onto wf_shape and nothing onto wf_shape_ux. */
export const SHAPE_WORKFLOW_ID = 'wf_shape';
export const SHAPE_UX_WORKFLOW_ID = 'wf_shape_ux';
export const SHAPE_WORKFLOW_NAME = 'Shaper';
export const SHAPE_CLARIFY_HINTS = 'Shaping: ask at most 3 questions — only decisions that change what gets built '
  + 'and that the repo can\'t answer. Give each question a recommended option.';
const SHAPE_CLARIFY_CONFIG = { maxQuestions: 3, promptHints: SHAPE_CLARIFY_HINTS };
const SHAPE_APPROVE_CONFIG = { approve: { kind: 'plan', port: 'plan' } };
const SHAPE_ROLES_CONFIG = { roleReview: true, model: 'claude-sonnet-5-5', effort: 'medium' };   // spec decision 1
/** Refine waits for the reviewed plan AND its findings, both from n_roles (one publish), so it fires once per round. */
const SHAPE_REFINE_CONFIG = { ...SHAPE_APPROVE_CONFIG, awaitAll: true };
/** Spec §3: plan → role reviews → refine, one loop of at most 2 rounds that ends at the plan approval. Default's
 *  w4/w5 ids are kept (per-project loop budgets are keyed by wire id); w17/w18 are new. */
const SHAPE_HEAD_WIRES = [
  { id: 'w1', from: { node: 'n_task', port: 'task' }, to: { node: 'n_clarify', port: 'task' } },
  { id: 'w2', from: { node: 'n_task', port: 'task' }, to: { node: 'n_plan', port: 'task' } },
  { id: 'w3', from: { node: 'n_clarify', port: 'answers' }, to: { node: 'n_plan', port: 'answers' } },
  { id: 'w4', from: { node: 'n_plan', port: 'plan' }, to: { node: 'n_roles', port: 'plan' } },
  { id: 'w17', from: { node: 'n_roles', port: 'plan' }, to: { node: 'n_refine', port: 'plan' } },
  { id: 'w18', from: { node: 'n_roles', port: 'findings' }, to: { node: 'n_refine', port: 'findings' } },
  { id: 'w5', from: { node: 'n_refine', port: 'revise' }, to: { node: 'n_roles', port: 'revise' },
    config: { maxCycles: ROLE_REVIEW_MAX_ROUNDS, onExhausted: 'clean' } },
];
const SHAPE_ROLES_NODE = { id: 'n_roles', kind: 'agent', key: 'planReviewer', x: 740, y: 380, config: { ...SHAPE_ROLES_CONFIG } };
const copyWire = (w) => ({ ...w, from: { ...w.from }, to: { ...w.to }, ...(w.config ? { config: { ...w.config } } : {}) });

export const GRAPH_SHAPE_WORKFLOW = deepFreeze({
  id: SHAPE_WORKFLOW_ID,
  name: SHAPE_WORKFLOW_NAME,
  version: 2,
  domain: 'coding',
  createdAt: '1970-01-01T00:00:00.000Z',
  updatedAt: '1970-01-01T00:00:00.000Z',
  nodes: [
    { id: 'n_task', kind: 'task', x: 40, y: 200, config: {} },
    { id: 'n_clarify', kind: 'agent', key: 'clarify', x: 320, y: 200, config: { ...SHAPE_CLARIFY_CONFIG } },
    { id: 'n_plan', kind: 'agent', key: 'planner', x: 600, y: 200, config: {} },
    { id: 'n_refine', kind: 'agent', key: 'refiner', x: 880, y: 200, config: { ...SHAPE_REFINE_CONFIG } },
    { id: 'n_impl', kind: 'agent', key: 'implementer', x: 1160, y: 200, config: {} },
    { id: 'n_review', kind: 'agent', key: 'reviewer', x: 1440, y: 200, config: {} },
    { id: 'n_end', kind: 'end', x: 1720, y: 200, config: {} },
    { ...SHAPE_ROLES_NODE, config: { ...SHAPE_ROLES_CONFIG } },
  ],
  wires: [
    ...SHAPE_HEAD_WIRES.map(copyWire),
    ...GRAPH_DEFAULT_WORKFLOW.wires.filter((w) => !['w1', 'w2', 'w3', 'w4', 'w5'].includes(w.id)).map(copyWire),
  ],
});

/** wf_shape + the manual-test stages (UX picked): wf_full-no-decompose's verifier tail. There is no
 *  review.pass -> End wire: the clean review hands over to the checklist, and the web UI test lands on End. */
export const GRAPH_SHAPE_UX_WORKFLOW = deepFreeze({
  id: SHAPE_UX_WORKFLOW_ID,
  name: SHAPE_WORKFLOW_NAME,
  version: 2,
  domain: 'coding',
  createdAt: '1970-01-01T00:00:00.000Z',
  updatedAt: '1970-01-01T00:00:00.000Z',
  nodes: [
    { id: 'n_task', kind: 'task', x: 40, y: 200, config: {} },
    { id: 'n_clarify', kind: 'agent', key: 'clarify', x: 320, y: 200, config: { ...SHAPE_CLARIFY_CONFIG } },
    { id: 'n_plan', kind: 'agent', key: 'planner', x: 600, y: 200, config: {} },
    { id: 'n_refine', kind: 'agent', key: 'refiner', x: 880, y: 200, config: { ...SHAPE_REFINE_CONFIG } },
    { id: 'n_impl', kind: 'agent', key: 'implementer', x: 1160, y: 200, config: {} },
    { id: 'n_review', kind: 'agent', key: 'reviewer', x: 1440, y: 200, config: {} },
    { id: 'n_check', kind: 'agent', key: 'manualTestsChecklist', x: 1720, y: 200, config: {} },
    { id: 'n_webui', kind: 'agent', key: 'manualWebUiTesting', x: 2000, y: 200, config: {} },
    { id: 'n_end', kind: 'end', x: 2280, y: 200, config: {} },
    { id: 'n_or', kind: 'or', x: 1580, y: 430, config: { arity: 2 } },
    { ...SHAPE_ROLES_NODE, config: { ...SHAPE_ROLES_CONFIG } },
  ],
  wires: [
    ...SHAPE_HEAD_WIRES.map(copyWire),
    { id: 'w6', from: { node: 'n_refine', port: 'plan' }, to: { node: 'n_impl', port: 'plan' } },
    { id: 'w7', from: { node: 'n_refine', port: 'plan' }, to: { node: 'n_review', port: 'plan' } },
    { id: 'w8', from: { node: 'n_impl', port: 'done' }, to: { node: 'n_review', port: 'done' } },
    { id: 'w9', from: { node: 'n_review', port: 'review' }, to: { node: 'n_or', port: 'in1' }, config: { maxCycles: 3 } },
    { id: 'w11', from: { node: 'n_refine', port: 'plan' }, to: { node: 'n_check', port: 'plan' } },
    { id: 'w12', from: { node: 'n_review', port: 'pass' }, to: { node: 'n_check', port: 'await' } },
    { id: 'w13', from: { node: 'n_check', port: 'checklist' }, to: { node: 'n_webui', port: 'checklist' } },
    { id: 'w14', from: { node: 'n_webui', port: 'review' }, to: { node: 'n_or', port: 'in2' }, config: { maxCycles: 3 } },
    { id: 'w15', from: { node: 'n_webui', port: 'pass' }, to: { node: 'n_end', port: 'result' } },
    { id: 'w16', from: { node: 'n_or', port: 'out' }, to: { node: 'n_impl', port: 'fix' } },
  ],
});

/** The ids no saved row may claim: writeGraphWorkflow re-mints them, listWorkflows hides them,
 *  DELETE refuses them. wf_workspace_scan and wf_pr_fix are reserved but never listed anywhere;
 *  wf_shape is listed only while the Shape it first gate is on, and wf_shape_ux is never listed. Order is NOT
 *  significant — GET /api/workflows and the Ask catalog list the graph built-ins in their own
 *  fixed order (Default, Lean, then Memory defragment).
 *  NOTE: `ui/public/graph/composer.mjs` keeps a twin of this list as a `Set` (`.has`), not an
 *  Array (`.includes`) — the two are not interchangeable. */
export const RESERVED_WORKFLOW_IDS = Object.freeze([GRAPH_DEFAULT_WORKFLOW.id, LEAN_WORKFLOW_ID, AUTO_WORKFLOW_ID, MEMORY_DEFRAG_WORKFLOW_ID, WORKSPACE_SCAN_WORKFLOW_ID, PR_FIX_WORKFLOW_ID, SHAPE_WORKFLOW_ID, SHAPE_UX_WORKFLOW_ID, WORKSPACE_RESYNTH_WORKFLOW_ID]);
export function isReservedWorkflowId(id) { return RESERVED_WORKFLOW_IDS.includes(id); }
