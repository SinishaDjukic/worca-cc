// src/core/run-retention.mjs
// Run retention (Settings › Runs › Machine load, runLimits.keepRunsDays): the UI server archives finished
// runs older than the setting once a day, which reclaims their store folder, run root, worktree and
// local branch (archivePipeline; the row and its cost stay for Statistics). Off unless set.
//
// An archive deletes the local feature branch, so a run whose branch holds commits that exist nowhere
// else (no other local branch or remote-tracking ref contains its tip) is skipped, as is every run
// archive itself refuses (retained work, a checked-out run). Nothing is ever forced.

import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { promisify } from 'node:util';
import { getDb } from './db.mjs';
import { readPipelineByKey } from './artifacts.mjs';
import { archivePipeline } from './pipeline-delete.mjs';
import { guardedGitEnvSync } from './git-guard.mjs';
import { gitAvailable } from './git-available.mjs';

const run = promisify(execFile);
const FINISHED = ['done', 'error', 'stopped'];
const MAX_PER_SWEEP = 50;   // archives per sweep: one sweep never holds the server for long; the next one carries on

/** [repoDir, feature] for every branch this run kept, single project or workspace member. Pure. */
export function keptBranches(state) {
  if (!state) return [];
  if (state.target === 'workspace') {
    const dirs = new Map((Array.isArray(state.projects) ? state.projects : []).map((p) => [p.projectKey, p.projectDir]));
    return Object.entries(state.branches || {})
      .map(([k, b]) => [dirs.get(k) || null, b?.feature || null])
      .filter(([d, f]) => d && f);
  }
  return state.projectDir && state.branch?.feature ? [[state.projectDir, state.branch.feature]] : [];
}

/** True when `feature`'s tip is reachable only from `feature` itself: archiving would lose commits. */
export async function onlyOnThisBranch(repoDir, feature) {
  if (!existsSync(repoDir) || !gitAvailable()) return false;   // no repo, no branch to lose
  const env = guardedGitEnvSync(repoDir);
  try {
    await run('git', ['rev-parse', '--verify', '--quiet', `refs/heads/${feature}`], { cwd: repoDir, env, timeout: 10_000 });
  } catch { return false; }                                       // branch already gone
  try {
    const { stdout } = await run('git', ['for-each-ref', '--contains', `refs/heads/${feature}`, '--format=%(refname)', 'refs/heads', 'refs/remotes'],
      { cwd: repoDir, env, timeout: 30_000, maxBuffer: 8 * 1024 * 1024 });
    return !stdout.split('\n').some((r) => r && r !== `refs/heads/${feature}`);
  } catch { return true; }                                        // cannot tell: keep it
}

/**
 * Archive the finished runs last updated more than `days` ago. Never throws.
 * @returns {Promise<{ archived: string[], skipped: Array<{ id:string, reason:string }> }>}
 */
export async function pruneOldRuns({ days, now = Date.now() } = {}) {
  const out = { archived: [], skipped: [] };
  if (!Number.isInteger(days) || days < 1) return out;
  const cutoff = new Date(now - days * 86_400_000).toISOString();
  let rows;
  try {
    rows = getDb().prepare(`SELECT id, project_key, workspace_key, target FROM pipelines
      WHERE archived_at IS NULL AND status IN (${FINISHED.map(() => '?').join(', ')}) AND COALESCE(updated_at, started_at) < ?
      ORDER BY updated_at`).all(...FINISHED, cutoff);
  } catch { return out; }
  for (const row of rows) {
    if (out.archived.length >= MAX_PER_SWEEP) break;
    const scope = row.target === 'workspace' && row.workspace_key ? { workspaceKey: row.workspace_key } : { key: row.project_key };
    try {
      const storeKey = scope.workspaceKey ? `workspaces/${scope.workspaceKey}` : scope.key;
      const { state } = (await readPipelineByKey(storeKey, row.id)) || {};
      let unpushed = null;
      for (const [dir, feature] of keptBranches(state)) if (await onlyOnThisBranch(dir, feature)) { unpushed = feature; break; }
      if (unpushed) { out.skipped.push({ id: row.id, reason: `branch ${unpushed} has commits on no other branch` }); continue; }
      await archivePipeline({ ...scope, id: row.id });
      out.archived.push(row.id);
    } catch (err) {
      out.skipped.push({ id: row.id, reason: err?.message || String(err) });
    }
  }
  return out;
}
