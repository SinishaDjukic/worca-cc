// src/core/shape/chain.mjs — Shaper small runs (flag shaperSmallRuns): a feature's runs start from its latest finished
// work, not from the run numbered before it. The latest-finished pick, the scheduler's gate wrapper, the fire-time
// source and the one-PR ship check. Imports features.mjs one way; features.mjs never imports this module (verifier.mjs,
// which features.mjs imports, calls back into latestFinishedSlice at runtime only).
import { getDb } from '../db.mjs';
import { previousBranchesOf } from '../scheduler.mjs';
import { isAncestor, runGitCapture, commitOf } from '../worktree.mjs';
import { checkCombine, mergeBaseInto } from '../git-sync.mjs';
import { shaperSmallRunsOn, smallRunsOfFeature } from './small-runs.mjs';
import { SHIP_LOCK, shipLocked } from './ship-lock.mjs';
import { roundOrigin } from './rounds.mjs';
import { SMALL_RUNS_SHIP } from '../../shared/shape/ship-ledger.mjs';
import { sliceOfTicket, sliceGateState, featureBase, featureRootSource, featureOfPipeline, currentFeatureId, finishedSlices,
  dependencyBranchesOf, setClashHold, clearClashHold } from './features.mjs';

import { recordSettledFigures as recordFigures } from './measure.mjs';
import { verifyAfterSettled, verifyCheckOfPipeline } from './verifier.mjs';
export { createHeldStops } from './held-stops.mjs';
export { heldStopTurn } from './features.mjs';
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

/** "8", "8 and 9", "4, 6 and 8". */
const andList = (items) => (items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`);
/** "runs 8 and 9" (ascending, each once); "run 8" alone. */
const runsText = (runs) => {
  const list = [...new Set(runs)].sort((a, b) => a - b);
  return `${list.length === 1 ? 'run' : 'runs'} ${andList(list)}`;
};
const CLASH_FILES_NAMED = 3;

/** D8: why a run is held: the runs whose work clashes, ascending, and at most 3 of the files they clash in, then how
 *  many more (`fileCount`, checkCombine's real count when its list is capped). Pure.
 *  → 'runs 8 and 9 clash in src/a.mjs' | 'runs 8 and 9 clash in a, b, c and 2 more files' */
export function clashReason({ runs, files, fileCount = files.length }) {
  const named = files.slice(0, CLASH_FILES_NAMED);
  const more = Math.max(0, fileCount - named.length);
  const where = more ? `${named.join(', ')} and ${more} more ${more === 1 ? 'file' : 'files'}` : andList(named);
  return `${runsText(runs)} clash in ${where}`;
}

/** The dependency branches of `found` that `start` lacks (not it, and not an ancestor of it), each once, in order. */
async function missingFrom(dir, start, found, ancestor) {
  const missing = [];
  for (const d of found) {
    if (d.branch === start || missing.some((m) => m.branch === d.branch)) continue;
    if (!(await ancestor(dir, `refs/heads/${d.branch}`, `refs/heads/${start}`, { timeout: 10_000 }))) missing.push(d);
  }
  return missing;
}

/**
 * The one combine verdict of the gate and the harness (D8): checkCombine over `start.branch` then each missing branch.
 * Run numbers are the card's (slice indices); `start.index` may be null (the feature base). Writes no ref.
 * → {status:'clean', check} | {status:'clash', reason, runs, files}
 *   | {status:'no-branch', error} | {status:'error', error, transient}
 */
export async function combineVerdict(dir, start, missing, combine) {
  const indexOf = new Map(missing.map((d) => [d.branch, d.index]));
  if (Number.isInteger(start.index)) indexOf.set(start.branch, start.index);
  const runsOf = (list) => list.map((b) => indexOf.get(b)).filter(Number.isInteger);
  const branches = [start.branch, ...missing.map((m) => m.branch)];
  const c = await combine(dir, { branches });
  if (c.status === 'clean') return { status: 'clean', check: c };
  if (c.status === 'conflicts') {
    // Only the runs that clash: those that conflict with `branch` alone; none alone → the clash needs the whole fold.
    const alone = [];
    for (const w of c.with) {
      if ((await combine(dir, { branches: [w, c.branch] })).status === 'conflicts') alone.push(w);
    }
    const runs = runsOf([c.branch, ...(alone.length ? alone : c.with)]);
    return { status: 'clash', reason: clashReason({ runs, files: c.files, fileCount: c.fileCount }), runs, files: c.files };
  }
  if (c.status === 'no-branch') return { status: 'no-branch', error: `branch ${c.branch} no longer exists` };
  return { status: 'error', error: `could not combine the work of ${runsText(runsOf(branches))}: ${c.error}`,
    transient: c.kind === 'failed' || c.kind === 'timeout' };
}

/** A pipeline's branch record (`pipelines.branch`, parsed), or null. */
function branchRecordOf(pipelineId) {
  const row = getDb().prepare('SELECT branch FROM pipelines WHERE id = ?').get(String(pipelineId));
  if (!row || !row.branch) return null;
  const b = JSON.parse(row.branch);
  return b && typeof b === 'object' ? b : null;
}

/** Slice 3 (D5): the branch a run started from at fire time: `sourceFrom` (kept once it took work in) else `source`.
 *  `deps.recordOf` is the test seam. → string | null; never throws. */
export function fireSourceOf(pipelineId, deps = {}) {
  try {
    const rec = (deps.recordOf || branchRecordOf)(pipelineId);
    const s = rec ? (rec.sourceFrom ?? rec.source) : null;
    return typeof s === 'string' && s ? s : null;
  } catch { return null; }
}

/**
 * Slice 3 (D1, D5, D6): what a run that waited (at a stop, or paused and resumed) must take in before it goes on: every
 * finished run of the feature whose work is not in `branch`, whatever base it started from, in finish order, and
 * whether they combine with it. A run still merging back is a wait; a run whose branch is gone is left out (`skipped`).
 * A run with no recorded fire-time base takes in nothing. Writes no ref; never throws.
 * `deps` = { checkCombine, isAncestor, resolves(dir, ref), recordOf(pipelineId) } seams.
 * → {status:'none', skipped} | {status:'wait', after} | {status:'clean', missing, check, skipped}
 *   | {status:'clash', reason, runs, files, missing} | {status:'error', error}   (a clash's `missing`: the harness names
 *   the clashing branch in its audit line)
 */
export async function takeInVerdict(dir, { featureId, pipelineId, branch }, deps = {}) {
  try {
    if (!fireSourceOf(pipelineId, deps)) return { status: 'none', skipped: [] };
    const found = finishedSlices(featureId, { exclude: pipelineId }).map((r) => ({ ...r, prev: previousBranchesOf(r.pipelineId) }));
    const pending = found.find((r) => r.prev && r.prev.pending);
    if (pending) return { status: 'wait', after: pending.index };
    const resolves = deps.resolves || (async (d, ref) => !!(await commitOf(d, ref, { timeout: 10_000 })));
    const skipped = [];
    const kept = [];
    for (const r of found) {
      const b = r.prev && r.prev.sourceBranch;
      if (!b) { skipped.push({ index: r.index, branch: null }); continue; }
      if (!(await resolves(dir, `refs/heads/${b}`))) { skipped.push({ index: r.index, branch: b }); continue; }
      kept.push({ index: r.index, branch: b, pipelineId: r.pipelineId });
    }
    const missing = await missingFrom(dir, branch, kept, deps.isAncestor || isAncestor);
    if (!missing.length) return { status: 'none', skipped };
    const index = featureOfPipeline(pipelineId)?.idx ?? null;
    const v = await combineVerdict(dir, { branch, index }, missing, deps.checkCombine || checkCombine);
    if (v.status === 'clean') return { status: 'clean', missing, check: v.check, skipped };
    if (v.status === 'clash') return { ...v, missing };
    return { status: 'error', error: v.error };
  } catch (err) {
    return { status: 'error', error: err && err.message ? err.message : String(err) };
  }
}

/**
 * Small runs (D2, D8): fire-time check that a slice run can start with the work of every run it builds on. The start
 * stays `own.sourceBranch` (D1); the dependency branches it lacks are merged on top by the harness
 * (combineDependencies). Writes no ref (isAncestor and checkCombine only). null = start as today (flag off, unmarked
 * feature, workspace ticket, no start branch, nothing to combine, a clean combine); a clash sets the ticket's clash
 * hold; any other answer clears it. `deps` = { flagEnabled, checkCombine, isAncestor } seams.
 * → null | {ok:false, hold:true, error} | {ok:false, error, transient}
 */
export async function sliceCombineGate(ticket, own, deps = {}) {
  if (!shaperSmallRunsOn(deps)) return null;
  const at = activeSlice(ticket);
  if (!at || !smallRunsOfFeature(at.featureId)) return null;
  if (!own || own.pending || !own.sourceBranch || ticket.workspaceId) return null;
  const done = (res) => { clearClashHold(ticket.id); return res; };
  const found = dependencyBranchesOf(at.featureId, at.index);
  if (found.pending) return done({ ok: false, error: 'the run before it is still merging its work back', transient: true });
  const dir = ticket.projectDir;
  const missing = await missingFrom(dir, own.sourceBranch, found.branches, deps.isAncestor || isAncestor);
  if (!missing.length) return done(null);
  const index = found.branches.find((d) => d.branch === own.sourceBranch)?.index
    ?? (own.pipelineId ? finishedSlices(at.featureId).find((s) => s.pipelineId === own.pipelineId)?.index : null);
  const v = await combineVerdict(dir, { branch: own.sourceBranch, index }, missing, deps.checkCombine || checkCombine);
  if (v.status === 'clean') return done(null);
  if (v.status === 'clash') {
    setClashHold(ticket.id, { reason: v.reason, runs: v.runs, files: v.files, at: Date.now() });
    return { ok: false, hold: true, error: v.reason };
  }
  return done({ ok: false, error: v.error, transient: v.status === 'error' && v.transient });
}

/**
 * Small runs (D3, D10): the harness's half. Re-checks the combine on the run's fresh branch `branch` (it started from
 * `source`) and, when clean, merges each missing dependency into it from its local SHA (the check's `heads`), in the
 * check's order. Throws before writing anything for a pending dependency, a clash (its reason) or a check error; a
 * merge failure puts the branch back at its start and throws with its `kind`. `deps` = { checkCombine, mergeBaseInto, isAncestor }.
 * → null (nothing missing) | {tip, merged: Array<{index, branch}>}
 */
export async function combineDependencies(dir, { featureId, index, branch, source }, deps = {}) {
  const found = dependencyBranchesOf(featureId, index);
  if (found.pending) throw new Error('the run before it is still merging its work back');
  const missing = await missingFrom(dir, branch, found.branches, deps.isAncestor || isAncestor);
  if (!missing.length) return null;
  const start = found.branches.find((d) => d.branch === source)?.index
    ?? finishedSlices(featureId).find((s) => previousBranchesOf(s.pipelineId)?.sourceBranch === source)?.index ?? null;
  const v = await combineVerdict(dir, { branch, index: start }, missing, deps.checkCombine || checkCombine);
  if (v.status !== 'clean') throw new Error(v.status === 'clash' ? v.reason : v.error);
  const merge = deps.mergeBaseInto || mergeBaseInto;
  const begin = v.check.heads[0];
  let tip = begin;
  let at = null;                                   // the checkout an earlier merge ran in
  for (const [i, d] of missing.entries()) {
    const r = await merge(dir, { feature: branch, baseSha: v.check.heads[i + 1], headSha: tip, baseRef: d.branch });
    if (!r.ok) {
      // Never leave a partial combine: put the branch back at its start.
      if (tip !== begin) {
        await (at ? runGitCapture(at, ['reset', '-q', '--hard', begin])
          : runGitCapture(dir, ['update-ref', `refs/heads/${branch}`, begin, tip])).catch(() => {});
      }
      throw Object.assign(new Error(`could not merge the work of run ${d.index} (\`${d.branch}\`): ${r.error || r.kind}`), { kind: r.kind });
    }
    tip = r.to;
    at = r.path || at;
  }
  return { tip, merged: missing.map(({ index: k, branch: b }) => ({ index: k, branch: b })) };
}

/** The audit line of a combine: "Combined the work of run 9 (`feat/run-9`) into `feat/run-10` before the first agent." */
export function combinedAudit(merged, branch) {
  const what = merged.map((d) => `${d.index} (\`${d.branch}\`)`);
  return `Combined the work of ${merged.length === 1 ? 'run' : 'runs'} ${andList(what)} into \`${branch}\` before the first agent.`;
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
