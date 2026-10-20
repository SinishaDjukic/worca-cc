// src/core/stop-paused.mjs
// Stop a PAUSED run for good — ONE implementation behind the UI (POST /api/stop), `worca
// stop <id>` and chat `/stop *<ref>`. A paused run has no process driving it, so there is
// nothing to abort: its orchestrator is rebuilt from the saved row (the resume loader and
// factory) and RunHarness.stopPaused settles it the way a live stop settles — the row
// reads stopped, the resume point is gone, the work so far is committed onto the kept
// branch and the worktree is removed. Interrupted runs are refused on purpose: they stay
// resumable (a crash is something you fix and resume, not something you discard).

import { readPipelineForResume } from './artifacts.mjs';
import { createOrchestratorFor } from './engine-select.mjs';
import { runProjectDir } from './store.mjs';

export class StopPausedError extends Error {
  /**
   * @param {string} code    machine-readable reason (BAD_REQUEST, NOT_FOUND, INTERRUPTED, …)
   * @param {string} message what a surface shows
   * @param {number} [status] the HTTP status a route answers with
   */
  constructor(code, message, status = 409) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

/** The checkout a saved row lives in: the workspace's members, or its one project dir. */
async function targetOf(row, projectDirFor) {
  if (row.target === 'workspace') {
    let meta = null;
    try { meta = JSON.parse(row.workspace_meta || 'null'); } catch { meta = null; }
    const projects = Array.isArray(meta?.projects) ? meta.projects.map((p) => ({ ...p })) : [];
    if (!projects.length) throw new StopPausedError('NO_PROJECT', 'workspace metadata incomplete', 400);
    return {
      projectDir: projects[0].projectDir,
      workspace: {
        id: meta.workspaceId, key: row.workspace_key, name: meta.workspaceName,
        description: meta.workspaceDescription || '', projects,
      },
    };
  }
  const projectDir = await runProjectDir(row, projectDirFor);   // P3: a run without a project is its own work folder
  if (!projectDir) throw new StopPausedError('NO_PROJECT', 'project for this pipeline is not onboarded on this machine', 400);
  return { projectDir, workspace: null };
}

/**
 * Stop the paused run `pipelineId`. Awaited to the end — the teardown commits the work and
 * removes the worktree — so every caller reports what actually happened.
 * @param {string} pipelineId
 * @param {object} opts
 * @param {(projectKey:string) => (Promise<string|null>|string|null)} opts.projectDirFor maps a row's project key to its dir
 * @param {string} [opts.by]        who asked (identity.mjs actor); the audit names them
 * @param {string} [opts.agentsDir]
 * @param {object} [opts.claude]    { mock } — a mock server's stop records no team metrics, like its runs
 * @param {(orch:object) => void} [opts.beforeStop] runs SYNCHRONOUSLY right before the claim,
 *   nothing awaited in between: the server's last "did a resume go live meanwhile?" check and
 *   its event wiring. A throw aborts the stop before anything is touched.
 * @returns {Promise<{ok:true, pipelineId:string, status:'stopped'}>}
 * @throws {StopPausedError}
 */
export async function stopPausedRun(pipelineId, { by = 'local', projectDirFor, agentsDir, claude, beforeStop } = {}) {
  if (!pipelineId || typeof pipelineId !== 'string') throw new StopPausedError('BAD_REQUEST', 'pipelineId is required', 400);
  const saved = readPipelineForResume(pipelineId);
  if (!saved) throw new StopPausedError('NOT_FOUND', 'pipeline not found', 404);
  const { row } = saved;
  if (row.status === 'interrupted') {
    throw new StopPausedError('INTERRUPTED', 'pipeline is interrupted — it stays resumable; only a paused run can be stopped');
  }
  if (row.status !== 'paused') throw new StopPausedError('NOT_PAUSED', `pipeline is "${row.status}", not paused`);
  if (row.archived_at) throw new StopPausedError('ARCHIVED', 'pipeline is archived');
  if (!saved.resumePoint) throw new StopPausedError('NO_RESUME_POINT', 'pipeline has no resume point — archive it instead');
  const { projectDir, workspace } = await targetOf(row, projectDirFor);
  let orch;
  try {
    orch = await createOrchestratorFor({
      projectDir,
      ...(workspace ? { workspace } : {}),
      ...(agentsDir ? { agentsDir } : {}),
      ...(claude ? { claude } : {}),
      resume: saved,
    });
  } catch (err) {
    if (err?.code === 'ENGINE_RETIRED') throw new StopPausedError('ENGINE_RETIRED', err.message);
    throw err;
  }
  if (beforeStop) beforeStop(orch);
  try {
    const res = await orch.stopPaused(by);
    return { ok: true, pipelineId, status: res.status };
  } catch (err) {
    if (err?.code === 'NOT_PAUSED') {
      throw new StopPausedError('NOT_PAUSED', 'pipeline is no longer paused — it was resumed or stopped meanwhile');
    }
    throw err;
  }
}
