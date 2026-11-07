// src/core/repo-readiness/projects.mjs
// Agent readiness of registered projects, for the UI server: read one project's report, re-read the ones already
// evaluated when what decides the judged tools moves, and evaluate a project just added. Never throws. What the
// server tells open tabs goes out on the cache's emitter: `changed` ({projectKey}) and `added` ({projectKey, name,
// engine}, a project added not ready for a tool it uses).
import { listProjects } from '../projects.mjs';
import { resolveRunEngine } from '../settings-cascade.mjs';
import { readinessIgnore } from '../settings.mjs';
import { projectKey } from '../store.mjs';
import { INTERACTIVE_TIMEOUT_MS } from '../git-sync.mjs';
import { engineLabel } from '../../shared/engine-switch.mjs';
import { cache, getCachedOrEvaluate, readinessSummary, usageInputs } from './cache.mjs';
import { readinessEnabled } from './evaluate.mjs';

const runEngineOf = (p) => resolveRunEngine({ projectDir: p.path, projectKey: p.key }).engine || 'claude';

/**
 * One registered project's report: the tools it uses are judged (settings, run engine, run history, tool files, read
 * on every call). `refresh` re-evaluates past the cache (and refreshes it). An evaluation failure answers null (no chip).
 */
export async function getReadiness(p, { refresh = false } = {}) {
  try {
    return await getCachedOrEvaluate({
      dir: p.path, projectKey: p.key, timeoutMs: INTERACTIVE_TIMEOUT_MS, force: refresh,
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
      if (notReady) cache.emit('added', { projectKey: p.key, name: p.name, engine: engineLabel(notReady[0]) });
    } catch { /* best effort */ }
  })();
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
