// ui/public/chat/pr-watch-words.mjs — Watch PR in the chat, as words: the pull-request link's watch tooltip
// (GET /api/pr/watch, ui/server.mjs watchView), a stopped watch on the run card (Shaper s5) and a legacy PR fix-run
// card's outcome (src/core/pr-watch.mjs fixOutcome).
// Pure: no DOM, no fetch.

/** src/core/pr-watch.mjs MAX_FIX_RUNS — that module reads the database, so the browser keeps its own copy; a test pins
 *  the two equal. */
export const PR_WATCH_MAX_FIX_RUNS = 3;
const ACTIVE = new Set(['starting', 'fixing', 'publishing']);
const REASONS = Object.freeze({
  cap: `gave up after ${PR_WATCH_MAX_FIX_RUNS} fix runs`,
  'fix-failed': 'the fix run failed',
  'fix-interrupted': 'the fix run was interrupted',
  'no-change': 'the fix run changed nothing',
  'remote-moved': 'the branch moved on the remote',
  'conflict-markers': 'conflict markers were left in',
  'base-not-merged': 'the base branch was not merged in',
  'push-refused': 'the push was refused',
  'start-refused': 'the fix run could not start',
  'launch-failed': 'the fix run failed to launch',
  'start-lost': 'the fix run never started',
  'branch-mismatch': "the pull request's branch is not the run's",
  'remote-missing': 'the branch is gone from the remote',
  'checkout-busy': 'the branch is checked out elsewhere',
  diverged: 'the branch diverged from the remote',
  'fast-forward-failed': 'the branch could not be fast-forwarded',
  'origin-gone': 'the run that opened it is gone',
});

/** A watch reason code as words; one this table does not know (`checkout-<code>`) reads with its dashes as spaces. */
export function prWatchReasonText(reason) {
  return REASONS[reason] || String(reason || 'unknown').replace(/-/g, ' ');
}

/** Shaper s5 (D23): the PR link's tooltip — the watch as a detail, never a line under the card. */
export function prWatchTooltip(number, view) {
  const head = `PR #${number}`;
  if (!view || typeof view !== 'object') return head;
  if (view.status === 'needs-person') return `${head} · watch stopped`;
  return view.watching || ACTIVE.has(view.status) ? `${head} · watched` : head;
}

const STILL = Object.freeze({ checks: 'checks still failing', comments: 'review comments still open',
  changes: 'changes still requested', conflict: 'conflicts still there', behind: 'still behind the base' });

/** Shaper s5 (D23): a stopped watch on the run card, from stoppedWatchFact and the last fix round's kinds; null while
 *  it still watches. */
export function watchStoppedText(watch, kinds = []) {
  if (!watch || watch.status !== 'needs-person') return null;
  if (watch.reason === 'cap') {
    const still = (kinds || []).map((k) => STILL[k]).filter(Boolean);
    return `Watch stopped · ${watch.fixRuns || PR_WATCH_MAX_FIX_RUNS} fix runs${still.length ? `, ${still.join(' and ')}` : ''}`;
  }
  return `Watch stopped · ${prWatchReasonText(watch.reason)}`;
}

/** A PR fix-run card's outcome (card.fix.outcome) → { text, tone: 'ok'|'bad'|'none' }, or null while the watcher still
 *  has the run. */
export function fixOutcomeText(outcome) {
  const o = outcome && typeof outcome === 'object' ? outcome : null;
  if (!o) return null;
  if (o.kind === 'pushed') {
    const stop = o.stopped === 'cap' ? ` · gave up after ${o.fixRuns || PR_WATCH_MAX_FIX_RUNS} fix runs`
      : o.stopped ? ` · watch stopped: ${prWatchReasonText(o.stopped)}` : '';
    return { text: `Pushed the fix${o.sha ? ` (${o.sha})` : ''}${stop}`, tone: 'ok' };
  }
  if (o.kind === 'ended') return { text: `Not pushed: the pull request was ${o.reason || 'closed'}`, tone: 'none' };
  return { text: `Not pushed: ${prWatchReasonText(o.reason)}`, tone: 'bad' };
}
