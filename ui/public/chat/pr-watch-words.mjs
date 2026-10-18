// ui/public/chat/pr-watch-words.mjs — Watch PR in the chat, as words: the pull-request card's read-only watch line
// (GET /api/pr/watch, ui/server.mjs watchView) and a PR fix-run card's outcome (src/core/pr-watch.mjs fixOutcome).
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

/** The pull-request card's watch line → { text, tone: 'run'|'bad'|'none' }, or null: the PR is not watched and no fix
 *  run (a Resolve) works on it. */
export function prWatchLine(view) {
  if (!view || typeof view !== 'object') return null;
  const active = ACTIVE.has(view.status);
  if (!view.watching && !active) return null;
  if (active && view.resolving) return { text: 'Resolving conflicts', tone: 'run' };
  if (active && view.mergingBase) return { text: `Merging ${view.mergingBase} in`, tone: 'run' };
  if (view.status === 'starting') return { text: 'Starting a fix run', tone: 'run' };
  if (view.status === 'fixing') return { text: 'Fixing', tone: 'run' };
  if (view.status === 'publishing') return { text: 'Pushing the fix', tone: 'run' };
  if (view.status === 'needs-person') return { text: `Stopped: ${prWatchReasonText(view.reason)}`, tone: 'bad' };
  return { text: 'Watching', tone: 'none' };
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
