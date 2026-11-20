// src/core/shape/chain.mjs — Shaper small runs (flag shaperSmallRuns): a feature's runs start from its latest finished
// work, not from the run numbered before it. The latest-finished pick, the scheduler's gate wrapper, the fire-time
// source and the one-PR ship check. Imports features.mjs one way; features.mjs never imports this module.
import { execFile } from 'node:child_process';
import { getDb } from '../db.mjs';
import { previousBranchesOf } from '../scheduler.mjs';
import { shaperSmallRunsOn } from './small-runs.mjs';
import { sliceOfTicket, sliceGateState, featureBase } from './features.mjs';

/**
 * The feature's latest finished run (D5): among its slices whose pipeline is `done` and not archived, the one whose
 * last step finished last (MAX(pipeline_steps.updated_at), else pipelines.updated_at); a tie goes to the higher index.
 * `exclude` = a pipeline id left out. → {index, pipelineId} | null
 */
export function latestFinishedSlice(featureId, { exclude = null } = {}) {
  const r = getDb().prepare(`SELECT x.idx AS idx, p.id AS pid,
      COALESCE((SELECT MAX(st.updated_at) FROM pipeline_steps st WHERE st.pipeline_id = p.id), p.updated_at) AS finished
    FROM (SELECT s.idx AS idx, COALESCE(s.pipeline_id, t.pipeline_id) AS pid FROM shape_feature_slices s
      LEFT JOIN scheduled_runs t ON t.id = s.ticket_id WHERE s.feature_id = ?) x
    JOIN pipelines p ON p.id = x.pid
    WHERE p.status = 'done' AND p.archived_at IS NULL AND p.id IS NOT ?
    ORDER BY finished DESC, x.idx DESC LIMIT 1`).get(String(featureId), exclude == null ? null : String(exclude));
  return r ? { index: r.idx, pipelineId: r.pid } : null;
}

/** The branch the latest finished run's work is on. {pending:true} while it merges back; null when no run finished
 *  or it left no single-project branch (a workspace run). → {pipelineId, sourceBranch} | {pending:true} | null */
export function latestFinishedSource(featureId, { exclude = null } = {}) {
  const l = latestFinishedSlice(featureId, { exclude });
  if (!l) return null;
  const prev = previousBranchesOf(l.pipelineId);
  if (prev && prev.pending) return { pending: true };
  return prev && prev.sourceBranch ? { pipelineId: l.pipelineId, sourceBranch: prev.sourceBranch } : null;
}

/** The slice of an active feature `ticket` fires, or null. */
function activeSlice(ticket) {
  const at = ticket && ticket.id ? sliceOfTicket(ticket.id) : null;
  return at && at.status === 'active' ? at : null;
}

/** runDueTickets' `chainGate` (D3): the slice gate (features.mjs sliceGateState) for a slice ticket of an active
 *  feature while the flag is on; null otherwise (dev's predecessor gate). `deps.flagEnabled` is the flag's test seam. */
export function sliceChainGate(ticket, opts = {}, deps = {}) {
  if (!shaperSmallRunsOn(deps)) return null;
  try { return activeSlice(ticket) ? sliceGateState(ticket, opts) : null; } catch { return null; }
}

/**
 * The branch a slice run starts from, picked at fire time (D6): the latest finished run's branch, {pending:true} while
 * it merges back, or the feature's base when no run finished. null with the flag off, for a ticket that is not a slice
 * of an active feature, and for a follow-up run (it starts from the base by design).
 * → {pipelineId, sourceBranch} | {pipelineId:null, sourceBranch} | {pending:true} | null
 */
export function sliceSourceOf(ticket, deps = {}) {
  if (!shaperSmallRunsOn(deps)) return null;
  const at = activeSlice(ticket);
  if (!at) return null;
  const kind = getDb().prepare('SELECT kind FROM shape_feature_slices WHERE ticket_id = ? LIMIT 1').get(String(ticket.id))?.kind;
  if (kind === 'follow-up') return null;
  const src = latestFinishedSource(at.featureId, { exclude: ticket.pipelineId || null });
  if (src) return src;
  return { pipelineId: null, sourceBranch: featureBase(at.featureId) };
}

const git = (args, cwd) => new Promise((resolve) => {
  execFile('git', args, { cwd, timeout: 10_000, windowsHide: true }, (err) =>
    resolve(err ? (typeof err.code === 'number' ? err.code : -1) : 0));
});

/**
 * D11: the first done slice whose branch tip is not in `headBranch` (the branch one PR would ship), or null. `rows` =
 * the done slices ({index, pipelineId}); a slice's branch is its work branch (previousBranchesOf). A branch that does
 * not resolve is skipped. → {index} | null
 */
export async function headMissingSlice(dir, headBranch, rows) {
  if (!dir || !headBranch) return null;
  for (const r of rows || []) {
    const br = r && r.pipelineId ? previousBranchesOf(r.pipelineId)?.sourceBranch : null;
    if (!br || br === headBranch) continue;
    const code = await git(['merge-base', '--is-ancestor', `refs/heads/${br}`, `refs/heads/${headBranch}`], dir);
    if (code === 1) return { index: r.index };   // 0 = in the head; anything else = a ref that does not resolve
  }
  return null;
}
