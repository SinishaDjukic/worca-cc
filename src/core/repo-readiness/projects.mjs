// src/core/repo-readiness/projects.mjs
// Agent readiness of registered projects, for the UI server: read one project's report, re-read the ones already
// evaluated when what decides the judged tools moves, and evaluate a project just added. Never throws. What the
// server tells open tabs goes out on the cache's emitter: `changed` ({projectKey}) and `added` ({projectKey, name,
// engine}, a project with code added not ready for a tool it uses).
import { listProjects } from '../projects.mjs';
import { resolveRunEngine } from '../settings-cascade.mjs';
import { readinessIgnore } from '../settings.mjs';
import { projectKey } from '../store.mjs';
import { INTERACTIVE_TIMEOUT_MS } from '../git-sync.mjs';
import { engineLabel } from '../../shared/engine-switch.mjs';
import { cache, getCachedOrEvaluate, readinessSummary, usageInputs } from './cache.mjs';
import { readinessEnabled } from './evaluate.mjs';
import { effectiveWorkMode } from '../project-kind.mjs';
import { gitState } from '../git-available.mjs';
import { listWorkflows } from '../workflows.mjs';
import { getDb } from '../db.mjs';
import { mockEnabled } from '../claude-runner.mjs';
import { projectHasCode } from './has-code.mjs';
import { readProjectProfile } from '../project-profile.mjs';
import { readWorkspace } from '../workspaces.mjs';

const runEngineOf = (p) => resolveRunEngine({ projectDir: p.path, projectKey: p.key }).engine || 'claude';

/**
 * One registered project's report: the tools it uses are judged (settings, run engine, run history, tool files, read
 * on every call). `refresh` re-evaluates past the cache (and refreshes it). An evaluation failure answers null (no chip).
 */
export async function getReadiness(p, { refresh = false } = {}) {
  try {
    // A Folder project (vcs 'none', or no git installed) runs on a copy of the folder: no git runs in it.
    const folder = effectiveWorkMode(p.vcs, (await gitState()).available) === 'folder';
    return await getCachedOrEvaluate({
      dir: p.path, projectKey: p.key, timeoutMs: INTERACTIVE_TIMEOUT_MS, force: refresh, folder,
      ignore: readinessIgnore({ projectDir: p.path, projectKey: p.key }),
      usage: () => usageInputs({ projectKey: p.key, projectDir: p.path, runEngine: runEngineOf(p) }),
    });
  } catch (err) {
    console.error(`[worca-ui] readiness ${p.key}: ${err && err.message ? err.message : err}`);
    return null;
  }
}

/** Re-read one project already evaluated (a moved HEAD, a finished run). Only projects with a cached report. */
export async function reevaluateReadiness(key) {
  if (!key || !readinessEnabled() || !readinessSummary(key)) return;
  try {
    const p = (await listProjects()).find((x) => x.key === key);
    if (p && p.exists) await getReadiness(p);
  } catch { /* best effort: the chip catches up on the next Recheck */ }
}

/** A user or team change to run.engine moves which tool every project judges: re-read each one already evaluated. */
export async function reevaluateAllReadiness() {
  if (!readinessEnabled()) return;
  try { for (const p of await listProjects()) await reevaluateReadiness(p.key); } catch { /* best effort */ }
}

/** A project just added: evaluate it in the background so its chip is warm, and say when a tool it uses is not ready. */
export function evaluateAddedProject(dir) {
  if (!readinessEnabled()) return Promise.resolve();
  return (async () => {
    try {
      const key = projectKey(dir);
      const p = (await listProjects()).find((x) => x.key === key || x.path === dir);
      if (!p || !p.exists) return;
      const report = await getReadiness(p);
      if (!report) return;
      cache.emit('changed', { projectKey: p.key });
      const notReady = Object.entries(report.engines || {}).find(([, e]) => e.used && e.level === 'not-ready');
      if (notReady && projectHasCode(p.path)) cache.emit('added', { projectKey: p.key, name: p.name, engine: engineLabel(notReady[0]) });
    } catch { /* best effort */ }
  })();
}

/** A project registered by any route (New, Use git, chat card, conversion): tell open lists, then evaluate its readiness in the background. */
export function announceRegistered(project, action, emitChanged) {
  emitChanged('projects-changed', action);
  if (project && project.path) void evaluateAddedProject(project.path);
}

/**
 * Wire readiness to the server: a verdict that moves reaches open tabs (`emitChanged('readiness-changed', key)`), a project
 * added not ready gets its toast frame (`broadcast`), a moved HEAD re-reads that project and a team policy change every
 * evaluated one (fingerprint-guarded; only projects already evaluated, so there is no startup sweep).
 */
export function watchReadiness({ projectSyncEvents, policyEvents, emitChanged, broadcast }) {
  cache.on('changed', (e) => emitChanged('readiness-changed', e && e.projectKey ? e.projectKey : null));
  cache.on('added', (e) => broadcast({ type: 'readiness-added', ...e }));
  projectSyncEvents.on('changed', (e) => { void reevaluateReadiness(e && e.projectKey); });
  policyEvents.on('changed', () => { void reevaluateAllReadiness(); });   // team policy can set run.engine
}

/**
 * After a project settings patch: readiness.ignore changes the base report (re-evaluate past the cache); readiness.tools
 * and run.engine change only which tools are judged. The cache emits `changed` when the verdict moves.
 */
export function readinessAfterSettingsPatch(project, patch) {
  const keys = Object.keys(patch || {});
  if (!readinessEnabled() || !project?.key || !keys.some((id) => id.startsWith('readiness.') || id === 'run.engine')) return;
  void getReadiness(project, { refresh: Object.hasOwn(patch, 'readiness.ignore') });
}

/** The plugin's two workflows and the title the chip gives each run. */
export const READINESS_SETUP_WORKFLOW_ID = 'wfp_ai-readiness_setup';
export const READINESS_SETUP_TITLE = 'AI readiness setup';
export const READINESS_CHECK_WORKFLOW_ID = 'wfp_ai-readiness_check';
export const READINESS_CHECK_TITLE = 'AI readiness check';

/** A readiness run that is over: done, failed, stopped or interrupted. Anything else (starting, running, paused) is live. */
const OVER = new Set(['done', 'error', 'failed', 'stopped', 'interrupted', 'completed']);
export const isLiveReadinessStatus = (status) => !OVER.has(String(status || ''));

/**
 * The project's newest runs of the two workflows (finished ones too), by the workflow id kept in pipelines.run_setup:
 * one indexed read, no git. A workspace run's row carries only its primary member's project_key, so the other members
 * are found in workspace_meta.projectKeys (the member list stored with the run, not the workspace's current members).
 */
function latestRuns(key) {
  const db = getDb();
  const WF = "json_extract(CASE WHEN json_valid(run_setup) THEN run_setup END, '$.workflowId')";
  const cols = `id, title, status, started_at, workspace_key, ${WF} AS workflow_id`;
  // Two indexed reads (a project_key OR over json_each would scan every row): the project's own rows, and the workspace rows.
  const own = db.prepare(`SELECT ${cols} FROM pipelines WHERE project_key = ? AND archived_at IS NULL AND ${WF} IN (?, ?) ORDER BY started_at DESC LIMIT 50`).all(key, READINESS_SETUP_WORKFLOW_ID, READINESS_CHECK_WORKFLOW_ID);
  const ws = db.prepare(`SELECT ${cols} FROM pipelines
    WHERE workspace_key IS NOT NULL AND archived_at IS NULL AND ${WF} IN (?, ?)
      AND EXISTS (SELECT 1 FROM json_each(CASE WHEN json_valid(workspace_meta) THEN workspace_meta END, '$.projectKeys') WHERE value = ?)
    ORDER BY started_at DESC LIMIT 50`).all(READINESS_SETUP_WORKFLOW_ID, READINESS_CHECK_WORKFLOW_ID, key);
  const seen = new Set();
  return [...own, ...ws]
    .filter((r) => (r.workflow_id === READINESS_SETUP_WORKFLOW_ID || r.workflow_id === READINESS_CHECK_WORKFLOW_ID) && !seen.has(r.id) && seen.add(r.id))
    .sort((a, b) => String(b.started_at || '').localeCompare(String(a.started_at || '')))
    .slice(0, 50);
}

/**
 * What the chip may offer for a project: `available` ({ check, setup }: readiness on, not a mock server, that workflow
 * of the ai-readiness plugin installed and enabled, and the project has code), `hasCode`, the newest `lastCheck` and
 * `lastSetup` run, and `live`, the newest live run of either workflow for this project or a workspace that includes it.
 * A run is { runId, pipelineId, status, title, workflowId, workspaceId, score, at }: `pipelineId` is the row's id (its
 * History page); `runId` the live run this server drives for it (its run page), null once settled or when another
 * process runs it (`deps.liveRunId(pipelineId)`); `score` the project profile's overall score when that profile was
 * written by this run. Never throws. `deps` is also a test seam (mock, listWorkflows, liveRunId, latestRuns, hasCode).
 */
export async function readinessRunInfo(p, deps = {}) {
  const none = { available: { check: false, setup: false }, hasCode: false, lastCheck: null, lastSetup: null, live: null };
  try {
    if (!readinessEnabled() || (deps.mock ?? mockEnabled({}))) return none;
    const hasCode = !!(deps.hasCode || projectHasCode)(p.path);
    const ids = new Set((await (deps.listWorkflows || listWorkflows)()).map((w) => w.id));
    const available = { check: hasCode && ids.has(READINESS_CHECK_WORKFLOW_ID), setup: hasCode && ids.has(READINESS_SETUP_WORKFLOW_ID) };
    if (!available.check && !available.setup) return { ...none, hasCode };
    const rows = (deps.latestRuns || latestRuns)(p.key || projectKey(p.path)) || [];
    let profile = null;
    try { profile = (deps.readProfile || readProjectProfile)(p.key || projectKey(p.path)); } catch { /* no profile */ }
    const toRun = (r) => {
      let runId = null;
      try { runId = (deps.liveRunId && deps.liveRunId(r.id)) || null; } catch { /* no live run known */ }
      const score = profile && profile.runId && (profile.runId === r.id || profile.runId === runId) && typeof profile.score?.overall === 'number'
        ? profile.score.overall : null;
      return { runId, pipelineId: r.id, status: r.status, title: r.title, workflowId: r.workflow_id || r.workflowId,
        workspaceId: r.workspace_key || null, score, at: r.started_at || null };
    };
    const runs = rows.map(toRun);
    const first = (id) => runs.find((r) => r.workflowId === id) || null;
    return {
      available, hasCode,
      lastCheck: first(READINESS_CHECK_WORKFLOW_ID), lastSetup: first(READINESS_SETUP_WORKFLOW_ID),
      live: runs.find((r) => isLiveReadinessStatus(r.status)) || null,
    };
  } catch { return none; }
}

/**
 * What the workspace page may offer: the same shape as readinessRunInfo, for the workspace. `available` is true for a
 * kind when its workflow is installed and any member has code; `lastCheck` / `lastSetup` are the newest runs of that
 * workflow whose row is THIS workspace's run (workspace_key is the id), not a member's own project run; `live` is the
 * newest live readiness run of the workspace or of any member (a member's project run owns that project). `deps` is the
 * readinessRunInfo seam plus `members` ([{ path, key }]). Never throws.
 */
export async function workspaceReadinessInfo(id, deps = {}) {
  const none = { available: { check: false, setup: false }, lastCheck: null, lastSetup: null, live: null };
  try {
    const ws = deps.members ? null : await readWorkspace(id);
    const members = deps.members || (ws ? ws.projectPaths.map((path, i) => ({ path, key: (ws.projectKeys && ws.projectKeys[i]) || projectKey(path) })) : []);
    if (!members.length) return none;
    const rowsOf = deps.latestRuns || latestRuns;
    const own = (k) => (rowsOf(k) || []).filter((r) => (r.workspace_key || r.workspaceId) === id);
    const all = [];
    for (const m of members) {
      const base = await readinessRunInfo(m, deps);
      const mine = await readinessRunInfo(m, { ...deps, latestRuns: own });
      all.push({ base, mine });
    }
    const newest = (runs) => runs.filter(Boolean).sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')))[0] || null;
    return {
      available: { check: all.some((x) => x.base.available.check), setup: all.some((x) => x.base.available.setup) },
      lastCheck: newest(all.map((x) => x.mine.lastCheck)),
      lastSetup: newest(all.map((x) => x.mine.lastSetup)),
      live: newest(all.map((x) => x.base.live)),
    };
  } catch { return none; }
}
