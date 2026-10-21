// src/shared/run-bulk.mjs — which runs a Runs-list bulk action applies to (runs redesign §3.2). Pure, no imports:
// the action bar's preview (ui/public/runs-selection.mjs) and the server (src/core/run-bulk.mjs) both use it, so the
// counts the bar shows are the runs the server acts on. A target is { id, title, state (run-model.mjs state id),
// status? (raw), prNeeds? (a finished run raised to Needs you by its PR, D31), members? (a group) }.
const STOPPABLE = new Set(['starting', 'working', 'needs-you', 'paused']);
const ENDED = new Set(['failed', 'stopped', 'ready', 'in-review', 'merged']);
export const BULK_ACTIONS = Object.freeze(['stop', 'archive', 'delete', 'restore']);

/** The state the bulk table reads: a PR-raised Needs you run is a finished, in-review run (nothing to stop). */
const bulkState = (t) => (t && t.prNeeds ? 'in-review' : t && t.state);
/** An interrupted run with no resume point: it can never resume (and is never stopped), so Archive and Delete take it.
 *  Only an explicit `resumable: false` counts — a live run in memory carries no flag and stays resumable. */
const deadInterrupted = (t) => !!t && t.status === 'interrupted' && t.resumable === false;

/** 'apply' | 'cancel' (a waiting run's ticket is cancelled) | 'skip'. */
export function bulkVerdict(action, t, { inGroup = false } = {}) {
  const s = bulkState(t);
  if (action === 'stop') {
    if (t && t.status === 'interrupted') return 'skip';
    if (STOPPABLE.has(s)) return 'apply';
    return s === 'waiting' && inGroup ? 'cancel' : 'skip';
  }
  // A ticket that never became a run (canceled / skipped) has no record to archive or delete.
  const neverRan = !!(t && t.ticketId && !t.pipelineId);
  // Restore applies to any archived record: an archived paused row reads Paused and restorePipeline makes it interrupted.
  if (action === 'restore') return neverRan ? 'skip' : 'apply';
  const over = ENDED.has(s) || deadInterrupted(t);
  if (action === 'archive') return over && !neverRan ? 'apply' : 'skip';
  if (action === 'delete') return s === 'waiting' ? 'cancel' : over && !neverRan ? 'apply' : 'skip';
  return 'skip';
}

export function skipReason(action, t) {
  // An interrupted run reads Paused (run-model.mjs), so Archive skips it too unless it can never resume: only Resume moves it on.
  if (action === 'stop') return t.status === 'interrupted' ? 'interrupted — resume it first' : t.state === 'waiting' ? 'not started yet' : 'already finished';
  // A waiting member carries its ticketId too (rowTarget): say "not started yet" before "never started".
  if (t.state === 'waiting') return 'not started yet';
  if (t.ticketId && !t.pipelineId) return 'never started';
  if (t.status === 'interrupted') return 'interrupted — resume it first';
  if (action === 'delete') return 'still running — stop it first';
  return t.state === 'waiting' ? 'not started yet' : 'still running';
}

/** Expand groups, dedupe by id, sort each target into apply / cancel / skip. */
export function planBulk(action, targets) {
  const plan = { action, apply: [], cancel: [], skip: [] };
  const seen = new Set();
  const visit = (t, inGroup) => {
    // A group whose members all failed to resolve (deleted) adds nothing, never a bogus "group:…" skip.
    if (Array.isArray(t.members)) { for (const m of t.members) visit(m, true); return; }
    if (seen.has(t.id)) return;
    seen.add(t.id);
    const v = bulkVerdict(action, t, { inGroup });
    if (v === 'skip') plan.skip.push({ ...t, reason: skipReason(action, t) });
    else plan[v].push(t);
  };
  for (const t of targets || []) visit(t, false);
  return plan;
}

const runs = (n) => `${n} run${n === 1 ? '' : 's'}`;
const names = (list) => list.slice(0, 3).map((t) => t.title).join(', ') + (list.length > 3 ? ` and ${list.length - 3} more` : '');

/** "Skipped 1 still running: Fix login." per reason, in first-seen order. */
export function skipText(plan) {
  const by = new Map();
  for (const t of plan.skip) by.set(t.reason, [...(by.get(t.reason) || []), t]);
  return [...by].map(([reason, list]) => `Skipped ${list.length} ${reason}: ${names(list)}.`).join(' ');
}

/** The one confirm for Stop and Delete (§3.2, §5a.3). Archive has none: it shows Undo. */
export function bulkConfirm(action, plan) {
  const skipped = skipText(plan);
  if (action === 'stop') {
    const c = plan.cancel.length;
    // The headline counts what the bar and the result toast count: the stopped runs and the cancelled waiting ones.
    return { title: `Stop ${runs(plan.apply.length + c)}?`, confirmLabel: 'Stop', danger: true,
      message: [c ? `${c} waiting run${c === 1 ? ' is' : 's are'} cancelled: ${names(plan.cancel)}.` : '', skipped, 'Stopping cannot be undone.'].filter(Boolean).join(' ') };
  }
  return { title: `Delete ${runs(plan.apply.length + plan.cancel.length)} permanently?`, confirmLabel: 'Delete', danger: true,
    message: ['Deletes the run records, their files and local branches.',
      'Keeps remote branches, pull requests and their cost in Statistics (as "deleted run").', skipped, 'There is no undo.'].filter(Boolean).join(' ') };
}
