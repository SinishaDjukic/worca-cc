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

/** The Workspace scan workflow: the one agent that maps how a workspace's member projects
 *  interconnect. Reserved like wf_memory_defrag, but NEVER listed (GET /api/workflows, the Ask
 *  catalog and the composer leave it out): only POST /api/workspaces/scan and
 *  /api/workspaces/:id/scan start it. run-harness treats it as READ-ONLY (nothing committed,
 *  every member's run branch deleted at teardown) and, on `done`, saves the scanner's output as
 *  the workspace's description (workspace-scan-run.mjs finalizeWorkspaceScan). */
export const WORKSPACE_SCAN_WORKFLOW_ID = 'wf_workspace_scan';
export const WORKSPACE_SCAN_WORKFLOW_NAME = 'Workspace scan';
export const GRAPH_WORKSPACE_SCAN_WORKFLOW = deepFreeze({
  id: WORKSPACE_SCAN_WORKFLOW_ID,
  name: WORKSPACE_SCAN_WORKFLOW_NAME,
  version: 2,
  domain: 'shared',
  createdAt: '1970-01-01T00:00:00.000Z',
  updatedAt: '1970-01-01T00:00:00.000Z',
  nodes: [
    { id: 'n_task', kind: 'task', x: 40, y: 200, config: {} },
    { id: 'n_scan', kind: 'agent', key: 'workspaceScanner', x: 320, y: 200, config: {
      model: WORKSPACE_SCAN_DEFAULT_MODELS.scanModel,
      effort: WORKSPACE_SCAN_DEFAULT_MODELS.scanEffort,
      subagentModel: WORKSPACE_SCAN_DEFAULT_MODELS.agentModel,
      subagentEffort: WORKSPACE_SCAN_DEFAULT_MODELS.agentEffort,
    } },
    { id: 'n_end', kind: 'end', x: 600, y: 200, config: {} },
  ],
  wires: [
    { id: 'w1', from: { node: 'n_task', port: 'task' }, to: { node: 'n_scan', port: 'task' } },
    { id: 'w2', from: { node: 'n_scan', port: 'workspace' }, to: { node: 'n_end', port: 'result' } },
  ],
});

/** The ids no saved row may claim: writeGraphWorkflow re-mints them, listWorkflows hides them,
 *  DELETE refuses them. wf_workspace_scan is reserved but never listed anywhere. Order is NOT
 *  significant — GET /api/workflows and the Ask catalog list the graph built-ins in their own
 *  fixed order (Default, then Memory defragment).
 *  NOTE: `ui/public/graph/composer.mjs` keeps a twin of this list as a `Set` (`.has`), not an
 *  Array (`.includes`) — the two are not interchangeable. */
export const RESERVED_WORKFLOW_IDS = Object.freeze([GRAPH_DEFAULT_WORKFLOW.id, AUTO_WORKFLOW_ID, MEMORY_DEFRAG_WORKFLOW_ID, WORKSPACE_SCAN_WORKFLOW_ID]);
export function isReservedWorkflowId(id) { return RESERVED_WORKFLOW_IDS.includes(id); }
