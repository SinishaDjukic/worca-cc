// src/shared/ask-run-snapshot.mjs — the Chat run card's snapshot of one run (GET /api/ask/runs/:id `state`), moved out of
// ui/public/ask-run-card.mjs so dev's card and Stillhet's chat TaskCard read one copy. DOM-free; the decor is injected.
import { isGraphManifest } from './graph/manifest.mjs';
import { engineReportsCost } from './engine-switch.mjs';
import { runProgress } from './run-progress.mjs';

/** How a run worked: on a git worktree, a copy of a plain folder, or no project (ui/public/run-kind.mjs re-exports it). */
const MODES = new Set(['git', 'folder', 'none']);

export function workModeOf(x) {
  if (!x || typeof x !== 'object') return 'git';
  if (MODES.has(x.workMode)) return x.workMode;
  if (x.state && typeof x.state === 'object' && MODES.has(x.state.workMode)) return x.state.workMode;
  if (x.branch && typeof x.branch === 'object' && MODES.has(x.branch.workMode)) return x.branch.workMode;
  return 'git';
}

export const PROGRESS_CARD_TYPE = 'progress';
/** app.js isTerminalStatus's set, verbatim (app.js:4304-4306). */
export const TERMINAL_RUN_STATUS = new Set(['done', 'error', 'stopped', 'aborted', 'failed', 'complete', 'completed', 'interrupted']);
/** app.js isLive's status arm (app.js:14663-14666): a run that is scheduling work. A REST row carries no pendingQuestion. */
export const LIVE_STATUS = new Set(['starting', 'running', 'pausing']);

/** Chat P3 (U10): the active nodes with what the chat run card's agent chips show — the node's model (the run's
 *  manifest cell, as app.js activeNodes reads it) named through `modelLabel` (app.js: the catalog label; REST: the
 *  raw id) and the cycle the in-flight execution is on (its ledger ordinal). [] without a decor bag. */
export function activeAgents(decor, stepper, { modelLabel = null } = {}) {
  if (!decor || !Array.isArray(decor.activeNodes)) return [];
  const byId = new Map((isGraphManifest(stepper) ? stepper.graph.nodes : []).filter(Boolean).map((n) => [n.id, n]));
  return decor.activeNodes.map((a) => {
    const n = byId.get(a.nodeId);
    const rows = (decor.footers && decor.footers[a.nodeId] && decor.footers[a.nodeId].rows) || [];
    const row = rows.find((x) => x.executionId === a.executionId) || rows[rows.length - 1] || null;
    const model = a.model || (n && n.model) || '';
    const named = model && typeof modelLabel === 'function' ? modelLabel(model) : null;
    return { ...a, model, effort: a.effort || (n && n.effort) || '', modelLabel: model ? (named || model) : '', cycle: row ? (Number(row.ordinal) || 1) : 1 };
  });
}

/** A frozen snapshot from GET /api/ask/runs/:id `state` (artifacts.mjs rowToState). null for a non-object.
 *  `extras` is the same response's `extras` (Chat P3): a finished run's results.json counts + top files, its last
 *  (newest) artifacts and its PR — null / false when absent. `decorOf` is run-decor.mjs decorFromState, injected so this
 *  module stays in src/shared/ (ui/public/ask-run-card.mjs passes it; without it the snapshot carries no decor). */
export function snapshotFromState(state, { now = Date.now(), extras = null, decorOf = null } = {}) {
  if (!state || typeof state !== 'object') return null;
  const status = String(state.status || '').toLowerCase();
  const graph = isGraphManifest(state.stepper);
  // live derives from the status exactly as app.js isLive does for the Running list: a row that is still running
  // marches its ants and paints unfinished executions active; a paused/finished row is resolved (run-decor.mjs:162).
  const live = LIVE_STATUS.has(status);
  const decor = graph && typeof decorOf === 'function' ? decorOf(state, { live, now }) : null;
  const ws = state.target === 'workspace';
  const x = extras && typeof extras === 'object' ? extras : null;
  const pr = x && x.pr && typeof x.pr.url === 'string' && x.pr.url ? x.pr : null;
  return {
    source: 'rest',
    runId: null,
    pipelineId: state.id || null,
    kind: ws ? 'workspace-run' : 'run',
    title: state.title || '',
    projectKey: ws ? null : (state.projectKey || null),
    workspaceId: ws ? (state.workspaceId || null) : null,
    projectDir: state.projectDir || '',
    projectNames: ws && Array.isArray(state.projects) ? state.projects.map((p) => p && p.projectName).filter(Boolean) : null,
    status,
    pauseReason: state.pauseReason || null,
    pendingQuestion: null,
    labels: Array.isArray(state.labels) ? state.labels : [],
    live,
    terminal: TERMINAL_RUN_STATUS.has(status),
    startedAt: state.startedAt || null,
    elapsedMs: Number(state.totalActiveMs) || 0,
    costUsd: engineReportsCost(state.runEngine) ? (Number(state.totalCostUsd) || 0) : null,   // null: cost unknown (Cursor), never $0.00
    progress: decor ? decor.progress : null,
    stageProgress: graph ? runProgress(state) : null,   // a frozen state is final: no memo
    active: decor ? activeAgents(decor, state.stepper) : [],   // a v1 row names no agent even when state.active is set
    stepper: graph ? state.stepper : null,
    decor,
    auto: (state.stepper && typeof state.stepper === 'object' && state.stepper.auto) || null,
    branch: state.branch && typeof state.branch === 'object' && typeof state.branch.feature === 'string' ? state.branch.feature : '',
    results: x && x.results && typeof x.results === 'object' ? x.results : null,
    artifacts: x && Array.isArray(x.artifacts) ? x.artifacts : null,
    moreArtifacts: !!(x && x.moreArtifacts),
    artifactsTotal: x && Number.isInteger(x.artifactsTotal) ? x.artifactsTotal : null,   // P3: the run card's Artifacts · <n>
    pr,
    // A run on its source branch (extras.source, sourceShipFacts): the run page's Push rule reads these.
    ...(x && x.source && x.source.sameAsSource === true ? { sameAsSource: true, sourceBranch: x.source.sourceBranch || null, mergeBack: x.source.mergeBack || null, push: x.source.push || null } : {}),
    rounds: x && Array.isArray(x.rounds) ? x.rounds : [],          // Shaper s5: the run's rounds (askRunCardExtras)
    watch: x && x.watch && typeof x.watch === 'object' ? x.watch : null,   // Shaper s5: a watch that gave up on its PR
    archived: !!state.archivedAt,                    // archived: the run folder and its History row are gone
    ...(workModeOf(state) !== 'git' ? { workMode: workModeOf(state), changes: x && x.changes && typeof x.changes === 'object' ? x.changes : null } : {}),
    ...(state && state.shaping ? { shaping: state.shaping } : {}),
    // Runs redesign slice 4 (D9): the raw state runModel reads, so the card draws the same model as the list and the page.
    run: { stepper: state.stepper || null, status, steps: state.steps || [], active: state.active || [],
      endReached: !!state.endReached, tokens: state.tokens || {}, progressFacts: state.progressFacts || null,
      pendingQuestion: null, pauseReason: state.pauseReason || '', pr,
      // Tri-state: a live state carries no flag (it stays resumable); only the saved detail's `false` means never.
      ...(typeof state.resumable === 'boolean' ? { resumable: state.resumable } : {}),
      // D24: the round marker (branch.roundOf) and the Watch PR fact (extras.watch) pass through; the model words them.
      branch: state.branch && typeof state.branch === 'object' ? state.branch : null, round: state.round || null,
      watch: (x && x.watch) || null,
      // Review A12: the live role rows read the picked perspectives and the role-review rounds.
      shaping: state.shaping || null, roleReviews: state.roleReviews || null },
  };
}
