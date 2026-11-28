// src/core/repo-readiness/run-guard.mjs — one AI readiness run at a time per project, across both start routes (a
// project's chip and a workspace's buttons). The pipelines row is written only once the run is under way, so the
// routes also ask the live run registry (a run started, no row yet) and hold a start in flight (no run entry yet).
import { resolve } from 'node:path';
import { READINESS_CHECK_WORKFLOW_ID, READINESS_SETUP_WORKFLOW_ID, isLiveReadinessStatus } from './projects.mjs';

const READINESS_FLOWS = new Set([READINESS_CHECK_WORKFLOW_ID, READINESS_SETUP_WORKFLOW_ID]);

/** The project folders a run entry works in: a workspace run's members (the run's own list), else its projectDir. */
function entryPaths(r) {
  const members = r.orch && Array.isArray(r.orch.members) ? r.orch.members.map((m) => m && m.projectDir).filter(Boolean) : [];
  if (members.length) return members;
  return typeof r.projectDir === 'string' && r.projectDir ? [r.projectDir] : [];
}

/**
 * The live readiness run in `registry` (the server's runs Map) whose target covers any of `projectPaths`: a project
 * run (kind 'run') on one of them, or a workspace run (kind 'workspace-run') with one of them as a member. null if none.
 */
export function liveReadinessEntryFor(registry, projectPaths) {
  const want = new Set((projectPaths || []).map((p) => resolve(p)));
  for (const r of registry.values()) {
    if (!r || (r.kind !== 'run' && r.kind !== 'workspace-run')) continue;
    if (!READINESS_FLOWS.has(r.orch && r.orch.workflowId) || !isLiveReadinessStatus(r.status)) continue;
    if (entryPaths(r).some((p) => want.has(resolve(p)))) return r;
  }
  return null;
}

// Project folders whose readiness start is in flight (between the routes' checks and the run's entry).
const starting = new Set();

/**
 * Reserve `projectPaths` for one readiness start (a workspace start reserves every member). Returns the release
 * function (call it when the run handler returns), or null when any of them is already reserved.
 */
export function reserveReadinessStart(projectPaths) {
  const paths = [...new Set((projectPaths || []).map((p) => resolve(p)))];
  if (paths.some((p) => starting.has(p))) return null;
  for (const p of paths) starting.add(p);
  let done = false;
  return () => { if (done) return; done = true; for (const p of paths) starting.delete(p); };
}
