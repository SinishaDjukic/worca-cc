// ui/public/graph/agents-meta.mjs
// The composer palette's agent metadata: the offline EMBEDDED_AGENTS table, the
// live-registry merge, the domain grouping (with the pinned Flow group) and the
// pill's port line.
//
// EMBEDDED_AGENTS is BUILTINS ONLY, BY DESIGN. It is the fallback the palette
// degrades to when GET /api/agents is unreachable; user and plugin agents live
// only in the live registry and cannot be shipped here. Its entries are copied
// from the builtin sidecars in `agents/*.meta.json` in the NORMALIZED shape the
// registry's normalizeMeta produces (every port default materialized: `required`
// on inputs, `as: 'file'` on non-void inputs, `when`/`store`/`artifactKind` on
// outputs) — so the table doubles as the port table for the client's portsFn and
// validate adapter. `test/connects-to.test.mjs` pins it against the engine's
// FIXTURE_PORTS port-for-port. The synthesized `await` input is NEVER stored
// here; graph-model's portsFn appends it, exactly like the engine.
//
// Amendment f: implementer and manualTestsChecklist carry NO `start` row — the
// universal `await` gate replaced it.

export const EMBEDDED_AGENTS = {
  clarify: {
    key: 'clarify', displayName: 'Clarify', domain: 'coding', color: 'red', order: 0,
    description: 'Turns hidden decisions into questions before planning. Multiple-choice, so later steps never guess.',
    icon: '<circle cx="12" cy="12" r="9"/><path d="M9.4 9.3a2.7 2.7 0 0 1 5.2 1c0 1.8-2.6 2.1-2.6 3.6" stroke-linecap="round" fill="none"/><circle cx="12" cy="17" r="0.7" fill="currentColor" stroke="none"/>',
    runnerType: 'clarifier', scope: 'project', fanOut: true,
    asksQuestions: true, questionsLocked: true, questionsDefault: true,
    inputs: [{ id: 'task', type: 'md', required: true, as: 'file' }],
    outputs: [{ id: 'answers', type: 'json', when: 'always', filename: 'clarify.json', store: 'run', artifactKind: 'clarify' }],
  },
  workspaceScanner: {
    key: 'workspaceScanner', displayName: 'Workspace Scan', domain: 'shared', color: 'violet', order: 0.5,
    description: "Maps how the workspace's projects relate before pipelines run. Shared APIs, schemas, queues, and build dependencies.",
    icon: '<path d="M4 7h16M4 12h10M4 17h7" stroke-linecap="round"/><circle cx="18" cy="15" r="3"/><path d="M20.2 17.2L22 19" stroke-linecap="round"/>',
    runnerType: 'producer', scope: 'workspace-only', placeable: false, fanOut: true,
    asksQuestions: false, questionsLocked: false, questionsDefault: false,
    inputs: [{ id: 'task', type: 'md', required: true, as: 'file' }],
    outputs: [{ id: 'workspace', type: 'md', when: 'always', filename: 'workspace-description.md', store: 'run', artifactKind: 'workspace' }],
  },
  planner: {
    key: 'planner', displayName: 'Plan', domain: 'coding', color: 'violet', order: 1,
    description: 'Explores the codebase and writes the implementation plan. Architecture, task breakdown, concrete code snippets; can ask clarifying questions first.',
    icon: '<path d="M8 6h11M8 12h11M8 18h8" stroke-linecap="round"/><circle cx="4" cy="6" r="1.1"/><circle cx="4" cy="12" r="1.1"/><circle cx="4" cy="18" r="1.1"/>',
    runnerType: 'producer', scope: 'project', fanOut: true,
    workspaceFanOut: true, workspaceStrategy: 'explore',
    asksQuestions: true, questionsLocked: false, questionsDefault: false,
    inputs: [
      { id: 'task', type: 'md', required: true, as: 'file' },
      { id: 'answers', type: 'json', required: false, as: 'answers' },
      { id: 'revise', type: 'md', required: false, loop: true, as: 'file',
        directive: '## Revise to address the review\n\nA reviewer found issues with the previous plan. Re-plan from scratch (cold start) and address EVERY critical and major finding in the review below. Preserve the "## Clarifications (Q&A)" section.' },
    ],
    outputs: [{ id: 'plan', type: 'md', when: 'always', filename: '{base}{vsuffix}.md', store: 'project', artifactKind: 'plan' }],
  },
  refiner: {
    key: 'refiner', displayName: 'Refine Plan', domain: 'coding', color: 'green', order: 2,
    description: 'Rewrites the latest plan into a tighter version. Fixes structure, correctness, and code snippets until no blocking issues remain.',
    icon: '<path d="M12 3v3M12 18v3M4.5 7.5l2 1M17.5 15.5l2 1M4.5 16.5l2-1M17.5 8.5l2-1" stroke-linecap="round"/><path d="M12 8.2l1.2 2.6L16 12l-2.8 1.2L12 15.8l-1.2-2.6L8 12l2.8-1.2L12 8.2Z" stroke-linejoin="round"/>',
    runnerType: 'producer', scope: 'project', fanOut: true, wantsRequest: true,
    workspaceFanOut: true, workspaceStrategy: 'explore',
    verdict: { filename: 'refine-review-cycle{cycle}.json' },
    asksQuestions: true, questionsLocked: false, questionsDefault: false,
    inputs: [
      { id: 'plan', type: 'md', required: true, as: 'file' },
      { id: 'revise', type: 'md', required: false, loop: true, as: 'file' },
    ],
    outputs: [
      { id: 'plan', type: 'md', when: 'clean', filename: '{base}{vsuffix}.md', store: 'project', artifactKind: 'plan' },
      { id: 'revise', type: 'md', when: 'blocking', filename: '{base}{vsuffix}.md', store: 'project', artifactKind: 'plan' },
    ],
  },
  decomposer: {
    key: 'decomposer', displayName: 'Decompose', domain: 'coding', color: 'blue', order: 2.5,
    description: 'Splits an approved plan into vertical-slice tasks. Each task gets its own implementer.',
    icon: '<path d="M12 3v6M12 9l-5 5M12 9l5 5M5 14h2M17 14h2M6 18h2M16 18h2" stroke-linecap="round" stroke-linejoin="round"/>',
    runnerType: 'producer', scope: 'project', fanOut: true,
    asksQuestions: true, questionsLocked: false, questionsDefault: false,
    inputs: [{ id: 'plan', type: 'md', required: true, as: 'file' }],
    outputs: [{ id: 'tasks', type: 'json', when: 'always', filename: 'decomposition.json', store: 'run', artifactKind: 'tasks' }],
  },
  implementer: {
    key: 'implementer', displayName: 'Implementation', domain: 'coding', color: 'peach', order: 3,
    description: 'Writes the code from the approved plan, strict TDD. In fix mode, addresses only the issues a review flagged.',
    icon: '<path d="M9 8l-4 4 4 4M15 8l4 4-4 4" stroke-linecap="round" stroke-linejoin="round"/>',
    runnerType: 'producer', scope: 'project', fanOut: true, sideEffect: 'code',
    workspaceFanOut: true, workspaceStrategy: 'task',
    asksQuestions: true, questionsLocked: false, questionsDefault: false,
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
    key: 'reviewer', displayName: 'Review Implementation', domain: 'coding', color: 'blue', order: 4,
    description: 'Reviews the implementation diff against the plan. Honest verdict; blocking findings loop back to the implementer.',
    icon: '<path d="M12 3l7 3v5c0 4.4-3 7.6-7 9-4-1.4-7-4.6-7-9V6l7-3Z" stroke-linejoin="round"/><path d="M9 12l2 2 4-4" stroke-linecap="round" stroke-linejoin="round"/>',
    runnerType: 'verifier', scope: 'project', fanOut: true, wantsRequest: true,
    workspaceStrategy: 'review',
    verdict: { filename: 'impl-review-cycle{cycle}.json' },
    asksQuestions: true, questionsLocked: false, questionsDefault: false,
    inputs: [
      { id: 'plan', type: 'md', required: true, as: 'file' },
      { id: 'done', type: 'void', required: false, as: 'worktree' },
    ],
    outputs: [
      { id: 'review', type: 'md', when: 'blocking', filename: '{base}-impl-review.md', store: 'project', artifactKind: 'review' },
      { id: 'pass', type: 'void', when: 'clean' },
    ],
  },
  workspaceReviewer: {
    key: 'workspaceReviewer', displayName: 'Workspace Review', domain: 'shared', color: 'blue', order: 4.5,
    description: 'Fans out one review per changed project in the workspace. Synthesizes a single cross-project verdict.',
    icon: '<path d="M12 3l7 3v5c0 4.4-3 7.6-7 9-4-1.4-7-4.6-7-9V6l7-3Z" stroke-linejoin="round"/><path d="M8 11l2 2 4-4" stroke-linecap="round" stroke-linejoin="round"/>',
    runnerType: 'verifier', scope: 'workspace-only', fanOut: true, workspaceVariantOf: 'reviewer',
    workspaceFanOut: true, workspaceStrategy: 'review',
    verdict: { filename: 'ws-review-cycle{cycle}.json' },
    asksQuestions: true, questionsLocked: false, questionsDefault: false,
    inputs: [
      { id: 'plan', type: 'md', required: true, as: 'file' },
      { id: 'done', type: 'void', required: false, as: 'worktree' },
    ],
    outputs: [
      { id: 'review', type: 'md', when: 'blocking', filename: '{base}-ws-review.md', store: 'project', artifactKind: 'review' },
      { id: 'pass', type: 'void', when: 'clean' },
    ],
  },
  manualTestsChecklist: {
    key: 'manualTestsChecklist', displayName: 'Manual Tests Checklist', domain: 'coding', color: 'blue', order: 5,
    description: 'Drafts a manual test checklist for the change. User-visible flows, edge cases, regressions worth clicking through.',
    icon: '<rect x="6" y="4" width="12" height="17" rx="2"/><path d="M9.5 4V2.8h5V4" stroke-linejoin="round"/><path d="M8.8 12l1.6 1.6L13.4 10" stroke-linecap="round" stroke-linejoin="round"/>',
    runnerType: 'producer', scope: 'project', fanOut: false,
    asksQuestions: true, questionsLocked: false, questionsDefault: false,
    inputs: [{ id: 'plan', type: 'md', required: true, as: 'file' }],           // start REMOVED (Amendment f)
    outputs: [{ id: 'checklist', type: 'md', when: 'always', filename: 'manual-tests-checklist.md', store: 'run', artifactKind: 'checklist' }],
  },
  manualWebUiTesting: {
    key: 'manualWebUiTesting', displayName: 'Manual web UI testing', domain: 'coding', color: 'violet', order: 6,
    description: 'Runs the manual checklist in the live web UI via Playwright. Reports what passed, failed, or blocked.',
    icon: '<circle cx="12" cy="12" r="9"/><path d="M10 8.5l5 3.5-5 3.5V8.5Z" fill="currentColor" stroke="none"/>',
    runnerType: 'verifier', scope: 'project', fanOut: false,
    verdict: { filename: 'webui-review-cycle{cycle}.json' },
    asksQuestions: true, questionsLocked: false, questionsDefault: false,
    inputs: [{ id: 'checklist', type: 'md', required: true, as: 'file' }],
    outputs: [
      { id: 'review', type: 'md', when: 'blocking', filename: 'webui-review-cycle{cycle}.md', store: 'run', artifactKind: 'webui' },
      { id: 'pass', type: 'void', when: 'clean' },
    ],
  },
  planReviewer: {
    key: 'planReviewer', displayName: 'Plan Review', domain: 'coding', color: 'amber', order: 7,
    description: 'Reviews the plan against the request and the codebase. Blocking issues bounce it back for a cold re-plan.',
    icon: '<path d="M10.5 4a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13Z"/><path d="M15.5 15.5L21 21" stroke-linecap="round"/><path d="M7.6 10.3l2 2 3.3-3.6" stroke-linecap="round" stroke-linejoin="round"/>',
    runnerType: 'verifier', scope: 'project', fanOut: true, wantsRequest: true,
    workspaceFanOut: true, workspaceStrategy: 'explore',
    verdict: { filename: 'plan-review-cycle{cycle}.json' },
    asksQuestions: true, questionsLocked: false, questionsDefault: false,
    inputs: [{ id: 'plan', type: 'md', required: true, as: 'file' }],
    outputs: [
      { id: 'review', type: 'md', when: 'blocking', filename: '{base}-plan-review.md', store: 'project', artifactKind: 'review' },
      { id: 'pass', type: 'void', when: 'clean' },
    ],
  },
};

/** The pinned palette group id for the flow cards — never a real agent domain. */
export const FLOW_GROUP = 'flow';

/** The pinned Flow group, in render order. Ports are engine-synthesized, so a
 *  pill carries a `kind` where an agent pill carries a `key`. */
export const FLOW_PILLS = Object.freeze([
  Object.freeze({ kind: 'task', displayName: 'Task', description: 'The pipeline entry: the prompt and its attached files.' }),
  Object.freeze({ kind: 'end', displayName: 'End', description: 'The pipeline sink. A token arriving here completes the run.' }),
  Object.freeze({ kind: 'and', displayName: 'AND', description: 'Fires when ALL of its inputs are fresh. Payloads discarded — pure sequencing.' }),
  Object.freeze({ kind: 'or', displayName: 'OR', description: 'Fires on ANY fresh input and forwards the freshest payload.' }),
  Object.freeze({ kind: 'combine', displayName: 'Combine', description: 'Joins its md inputs into one document.' }),
]);

/** Task and End are one-per-template (V20/V21), so their pills disable once placed. */
const SINGLETON_KINDS = new Set(['task', 'end']);

/**
 * mergePalette(agentsResponse) -> ordered Array of palette entries. Prefers the
 * live registry (GET /api/agents -> { agents:[…] } or a bare array); falls back
 * to EMBEDDED_AGENTS. Always sorted by .order so the palette is stable.
 *
 * The capability fields (verdict/sideEffect/wantsRequest/workspace*) are carried
 * through ONLY where set, mirroring the registry — the client validate adapter
 * reads `verdict` for V13, so dropping it here would break Save's live errors.
 */
export function mergePalette(agentsResponse) {
  let list = null;
  if (Array.isArray(agentsResponse)) list = agentsResponse;
  else if (agentsResponse && Array.isArray(agentsResponse.agents)) list = agentsResponse.agents;
  if (!list || !list.length) list = Object.values(EMBEDDED_AGENTS);
  return list
    .map((a) => ({
      key: a.key,
      displayName: a.displayName || a.key,
      description: a.description || '',
      color: a.color || 'blue',
      icon: a.icon || '',
      // Trusted-icon gate: only 'user' is untrusted; the EMBEDDED_AGENTS
      // fallback has no origin and is repo-shipped -> 'builtin' is correct.
      origin: a.origin === 'user' ? 'user' : 'builtin',
      order: typeof a.order === 'number' ? a.order : 99,
      domain: typeof a.domain === 'string' && a.domain ? a.domain : 'general',
      scope: a.scope === 'workspace-only' ? 'workspace-only' : 'project',
      placeable: a.placeable !== false,
      runnerType: a.runnerType || 'producer',
      fanOut: Boolean(a.fanOut),
      asksQuestions: Boolean(a.asksQuestions),
      questionsLocked: Boolean(a.questionsLocked),
      questionsDefault: Boolean(a.questionsDefault),
      inputs: Array.isArray(a.inputs) ? a.inputs : [],
      outputs: Array.isArray(a.outputs) ? a.outputs : [],
      ...capabilities(a),
    }))
    .sort((x, y) => x.order - y.order);
}

function capabilities(a) {
  const out = {};
  if (a.verdict) out.verdict = a.verdict;
  if (a.sideEffect) out.sideEffect = a.sideEffect;
  if (a.wantsRequest) out.wantsRequest = true;
  if (a.workspaceFanOut) out.workspaceFanOut = true;
  if (a.workspaceStrategy) out.workspaceStrategy = a.workspaceStrategy;
  if (a.workspaceVariantOf) out.workspaceVariantOf = a.workspaceVariantOf;
  return out;
}

/**
 * groupPaletteByDomain(palette, domains, opts) -> ordered
 * [{domain, flow, agents}], with the pinned Flow group ALWAYS LAST.
 *
 * Each domain group = that domain's own agents PLUS every `shared` agent
 * prepended, then sorted by .order. `placeable: false` agents are dropped
 * everywhere (that is how workspaceScanner never reaches a canvas). `domains` is
 * the ordered header list (general last, shared excluded) — see collectDomains.
 *
 * @param {Array} palette  the output of mergePalette
 * @param {string[]} domains
 * @param {{placedKinds?:string[]}} [opts]  the flow kinds already on the canvas
 */
export function groupPaletteByDomain(palette, domains, { placedKinds = [] } = {}) {
  const list = (Array.isArray(palette) ? palette : []).filter((a) => a.placeable !== false);
  const shared = list.filter((a) => a.domain === 'shared');
  const byOrder = (x, y) => x.order - y.order;
  const groups = (Array.isArray(domains) ? domains : []).map((domain) => ({
    domain,
    flow: false,
    agents: [...shared, ...list.filter((a) => a.domain === domain)].sort(byOrder),
  }));
  const placed = new Set(placedKinds);
  groups.push({
    domain: FLOW_GROUP,
    flow: true,
    agents: FLOW_PILLS.map((pill) => ({ ...pill, disabled: SINGLETON_KINDS.has(pill.kind) && placed.has(pill.kind) })),
  });
  return groups;
}

/**
 * The pill's second line: META port ids only, e.g. `in plan · out plan, revise`.
 * The synthesized `await` gate is never listed — it is not part of the agent's
 * declared contract, and every agent has one.
 */
export function paletteDesc(entry) {
  const ids = (ports) => (Array.isArray(ports) ? ports : []).filter((p) => !p?.synthetic).map((p) => p.id);
  const reads = ids(entry?.inputs);
  const writes = ids(entry?.outputs);
  return [reads.length ? `in ${reads.join(', ')}` : '', writes.length ? `out ${writes.join(', ')}` : '']
    .filter(Boolean).join(' · ');
}
