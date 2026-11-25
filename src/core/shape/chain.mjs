// src/core/shape/chain.mjs — Shaper small runs (flag shaperSmallRuns): a feature's runs start from its latest finished
// work, not from the run numbered before it. The latest-finished pick, the scheduler's gate wrapper, the fire-time
// source and the one-PR ship check. Imports features.mjs one way; features.mjs never imports this module (verifier.mjs,
// which features.mjs imports, calls back into latestFinishedSlice at runtime only).
import { getDb } from '../db.mjs';
import { previousBranchesOf } from '../scheduler.mjs';
import { isAncestor } from '../worktree.mjs';
import { shaperSmallRunsOn, smallRunsOfFeature } from './small-runs.mjs';
import { SHIP_LOCK, shipLocked } from './ship-lock.mjs';
import { roundOrigin } from './rounds.mjs';
import { SMALL_RUNS_SHIP } from '../../shared/shape/ship-ledger.mjs';
import { sliceOfTicket, sliceGateState, featureBase, featureRootSource, busySliceOf, featureOfPipeline, currentFeatureId, finishedSlices } from './features.mjs';

import { recordSettledFigures as recordFigures } from './measure.mjs';
import { verifyAfterSettled, verifyCheckOfPipeline } from './verifier.mjs';
export { createHeldStops } from './held-stops.mjs';
export { recordShipCommit, shipCover, shipStopped } from './verifier.mjs';
export { SHIPPING, featureShipping } from './ship-lock.mjs';

/**
 * afterRunSettled's hook (D17): the Verifier first (small runs C5: a check may start, or a Verifier run's result is
 * recorded), then the feature's figures. Returns the Verifier's Ship-card promise, which the PR finish chains after, or
 * undefined. deps = { tick, offerShip, broadcastFeature, finishing?, flagEnabled? }. Never throws.
 */
export function recordSettledFigures(state, deps = {}) {
  const card = verifyAfterSettled(state, deps);
  recordFigures(state);
  return card;
}

/** The feature a pipeline belongs to: a slice's (featureOfPipeline), else the Verifier run's (small runs C5). */
export function featureOfAnyPipeline(pipelineId) {
  return featureOfPipeline(pipelineId) || verifyCheckOfPipeline(pipelineId);
}

/** The refusal of a round of `pipelineId` while its feature is shipping (the Ship lock), or null. */
export function roundWhileShipping(pipelineId) {
  const at = pipelineId ? featureOfPipeline(roundOrigin(pipelineId)) : null;
  return at && shipLocked(currentFeatureId(at.featureId)) ? SHIP_LOCK : null;
}

/**
 * Small runs C3 (D9): whether stopped run `index` of the feature may go on now. Another slice going holds it (one slice
 * of a feature at a time); another run whose answer is held does not, so two held answers never wait on each other and
 * are delivered one at a time. → {due:true} | {due:false, after}
 */
export function heldStopTurn(featureId, index, { live = () => null, now = Date.now(), isLive = null } = {}) {
  const open = (pid) => { const l = live(pid); return l && l.stop && l.stop.held ? { ...l, stop: { ...l.stop, held: false } } : l; };
  const busy = busySliceOf(featureId, { exclude: index, live: open, now, isLive });
  return busy ? { due: false, after: busy.index } : { due: true };
}

/**
 * The feature's latest finished run (D5): the last of finishedSlices (features.mjs), so both read one ordering: among
 * its slices whose pipeline is `done` and not archived, the one whose last step finished last; a tie goes to the higher
 * index. `exclude` = a pipeline id left out. → {index, pipelineId} | null
 */
export function latestFinishedSlice(featureId, { exclude = null } = {}) {
  const r = finishedSlices(featureId, { exclude }).at(-1);
  return r ? { index: r.index, pipelineId: r.pipelineId } : null;
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

/** schedulerTick's `chainGate`: the slice gate with the live-run lookup while the flag is on; null = dev's gate. */
export function smallRunsChainGate(live, deps = {}) {
  return shaperSmallRunsOn(deps) ? (t, o) => sliceChainGate(t, { ...o, live }) : null;
}

/**
 * fireTicket's slice start (D6, D7): a slice starts from the feature's latest finished run, picked now. A forced slice
 * still waits for what it builds on; a run still merging back waits. A slice-1 restart (no `after`) sets
 * `body.sourceBranch`. `own` null = dev's path, body untouched. → {own, refusal}
 */
export function sliceFireStart(ticket, body, { isLive, live } = {}, deps = {}) {
  const own = sliceSourceOf(ticket, deps);
  if (!own) return { own: null, refusal: null };
  if (ticket.forced) {
    const g = sliceGateState(ticket, { isLive, live });
    if (g && g.state === 'waiting') return { own, refusal: { ok: false, error: 'the run before it is still going', transient: true } };
    if (g && g.state === 'bad') return { own, refusal: { ok: false, error: `the run it builds on ${g.reason}`, transient: false } };
  }
  if (own.pending) return { own, refusal: { ok: false, error: 'the run before it is still merging its work back', transient: true } };
  if (!ticket.after && own.sourceBranch) body.sourceBranch = own.sourceBranch;   // a slice-1 restart
  return { own, refusal: null };
}

/**
 * D11: the first done slice whose branch tip cannot be proven to be in `headBranch` (the branch one PR would ship), or
 * null. `rows` = the done slices ({index, pipelineId}); a slice's branch is its work branch (previousBranchesOf). A
 * branch that cannot be proven to be in the head (missing, unresolvable, git failure or timeout) counts as missing.
 * `deps.isAncestor` is the test seam. → {index} | null; never throws.
 */
export async function headMissingSlice(dir, headBranch, rows, deps = {}) {
  const list = rows || [];
  if (!list.length) return null;
  if (!dir || !headBranch) return { index: list[0].index };
  const ancestor = deps.isAncestor || isAncestor;
  for (const r of list) {
    const br = r && r.pipelineId ? previousBranchesOf(r.pipelineId)?.sourceBranch : null;
    if (br && br === headBranch) continue;
    if (!br) return { index: r.index };
    if (!(await ancestor(dir, `refs/heads/${br}`, `refs/heads/${headBranch}`, { timeout: 10_000 }))) return { index: r.index };
  }
  return null;
}

/**
 * shipFeatureNow's one-PR refusals, in order (a marked feature: STACKED_ONLY for one, the latest finished head for stacked): a slice that already has a PR (dev's HAS_SLICE_PR, flag on or off), then
 * (flag on) the latest finished slice's branch must hold every done slice's work. `ctxOf(head)` = shipCtxOf for that
 * head; its error refuses too (fail-closed). Read-only. → {head, refusal: {status, body} | null}
 */
export async function oneShipCheck(featureId, mode, view, ctxOf, deps = {}) {
  // Feature D1 (D5): a marked feature (its marker, whatever the flag says) ships stacked only, from its latest finished
  // run's branch: the changelog and the push land there.
  if (smallRunsOfFeature(featureId)) {
    return mode === 'one' ? { head: null, refusal: { status: 409, body: { code: 'STACKED_ONLY', error: SMALL_RUNS_SHIP } } }
      : { head: latestFinishedSlice(featureId)?.pipelineId || null, refusal: null };
  }
  if (mode !== 'one') return { head: null, refusal: null };
  if (view.slices.some((s) => s.pr && s.pr.url && s.pr.state !== 'CLOSED' && !s.pr.draft)) {
    return { head: null, refusal: { status: 409, body: { code: 'HAS_SLICE_PR', error: 'a run in this feature already has a PR: create one PR per run' } } };
  }
  if (!shaperSmallRunsOn(deps)) return { head: null, refusal: null };
  const head = latestFinishedSlice(featureId)?.pipelineId || null;
  if (!head) return { head: null, refusal: null };
  const ctx = ctxOf(head);
  if (ctx.error) {
    return { head, refusal: { status: 409, body: { code: 'HEAD_MISSING_WORK',
      error: `the branch one PR would ship cannot be checked (${ctx.error}): create one PR per run` } } };
  }
  const done = view.slices.filter((s) => s.state === 'done' && s.pipelineId).map(({ index, pipelineId }) => ({ index, pipelineId }));
  const missing = await headMissingSlice(ctx.target.repoDir, ctx.target.feature, done, deps);
  if (missing) {
    return { head, refusal: { status: 409, body: { code: 'HEAD_MISSING_WORK',
      error: `run ${missing.index}'s work is not in the branch one PR would ship: create one PR per run` } } };
  }
  return { head, refusal: null };
}

/** shipCtxOf: the slice row one PR ships (`head`), or null (dev's last row). */
export function shipHeadRow(view, head) {
  return head ? view.slices.find((s) => s.pipelineId === head) || null : null;
}

/** shipCtxOf: the head's base is the feature's root branch, as its own chain may start from another slice's branch. */
export function shipHeadBase(view, head) {
  return shipHeadRow(view, head) ? featureRootSource(view.id) : null;
}
