// ui/public/runs-archive.mjs — which Runs-list rows can be archived (#739), the one confirm every archive
// path shares, the age rule, and the one-by-one sender. Pure: rows are buildRunsModel rows (runs-list.mjs)
// and the request is injected, so node tests drive every branch without app.js, a DOM or fetch.

// The ended icons. runs-list.mjs imports this set as its ENDED_ICONS, so "finished" means one thing.
export const ENDED = new Set(['done', 'stop', 'fail']);
const DAY_MS = 86400000;
/** The Archived view's age choices, in days. */
export const AGE_CHOICES = Object.freeze([7, 30, 90]);
export const DEFAULT_AGE_DAYS = 30;
/** A skipped run's reason, as the confirm and the disabled checkbox say it. */
export const SKIP_WORDS = Object.freeze({
  live: 'still running', paused: 'paused', waiting: 'waiting', scheduled: 'scheduled',
  retained: 'has retained work', archived: 'already archived',
});
const RETAINED_WHY = 'Recover or discard the retained work first';

/** Why `row` cannot be archived: '' when it can. Finished, stopped, failed and merged runs can; a live,
 *  paused, waiting or scheduled run never can, nor one with retained work or a checkout (the server
 *  refuses those with 409 RETAINED_WORKTREE). */
export function archiveBlock(row) {
  if (!row) return 'live';
  if (row.archived) return 'archived';
  if (row.kind === 'sched') return row.word === 'Waiting' ? 'waiting' : 'scheduled';
  if (row.icon === 'scheduled') return 'scheduled';
  if (row.icon === 'paused') return 'paused';
  if (row.icon === 'ask') return 'waiting';
  if ((row.kind !== 'hist' && row.kind !== 'live') || !ENDED.has(row.icon) || !row.pipelineId) return 'live';
  if (row.retained) return 'retained';
  return '';
}
export const canArchive = (row) => archiveBlock(row) === '';

/** The row ⋯ menu: [] for a row without one (live, paused, scheduled, chain). */
export function rowMenuItems(row) {
  if (!row || (row.kind !== 'hist' && row.kind !== 'live') || !row.pipelineId) return [];
  if (row.archived) return [{ id: 'restore', label: 'Restore' }, { id: 'copy-id', label: 'Copy run id' }];
  if (!ENDED.has(row.icon)) return [];
  const why = archiveBlock(row);
  return [
    why ? { id: 'archive', label: 'Archive', disabled: true, why: why === 'retained' ? RETAINED_WHY : `Can't archive: ${SKIP_WORDS[why]}` }
      : { id: 'archive', label: 'Archive' },
    { id: 'new-run', label: 'Open in New run' },
    { id: 'copy-id', label: 'Copy run id' },
  ];
}

/** Split rows (deduplicated by key, order kept) into the ones to archive and the ones skipped, with why. */
export function archivePlan(rows) {
  const eligible = [];
  const skipped = [];
  const seen = new Set();
  for (const r of rows || []) {
    if (!r || seen.has(r.key)) continue;
    seen.add(r.key);
    const why = archiveBlock(r);
    if (why) skipped.push({ row: r, why });
    else eligible.push(r);
  }
  return { eligible, skipped };
}

const runsWord = (n) => `${n} run${n === 1 ? '' : 's'}`;
const skippedLine = (skipped) => `Skipped (${skipped.length}): ${skipped.map((s) => `${s.row.title} (${SKIP_WORDS[s.why]})`).join(', ')}.`;

/** "Marked missed: “Nightly” (waits for Old thing)." — `waiting` is [{ row, titles }] for eligible runs that a
 *  scheduled "after" run waits for (GET /api/schedules/dependents); '' when none. Archiving a run marks its
 *  waiting dependents missed, so the confirm says so, as the run page's afterDependentsNote does. */
export function missedLine(waiting = []) {
  const parts = (waiting || []).filter((w) => w && w.row && w.titles && w.titles.length)
    .map((w) => `${w.titles.map((t) => `“${t || 'Scheduled run'}”`).join(', ')} (${w.titles.length === 1 ? 'waits' : 'wait'} for ${w.row.title})`);
  return parts.length ? `Marked missed: ${parts.join('; ')}.` : '';
}

/** The shared confirm's copy for a plan, or null when nothing is eligible (no dialog then). */
export function archiveConfirm({ eligible = [], skipped = [] } = {}, { waiting = [] } = {}) {
  const n = eligible.length;
  if (!n) return null;
  const lines = [];
  if (n === 1) lines.push(eligible[0].title, '');
  lines.push('Removed: the local branch, the worktree and the run files (logs, results, diff).');
  lines.push(`Kept: the remote branch, any open PR and the cost in Statistics. You can restore ${n === 1 ? 'it' : 'them'} from Show › Archived.`);
  const missed = missedLine(waiting);
  if (skipped.length || missed) lines.push('');
  if (skipped.length) lines.push(skippedLine(skipped));
  if (missed) lines.push(missed);
  return { title: `Archive ${runsWord(n)}?`, message: lines.join('\n'), confirmLabel: `Archive ${runsWord(n)}`, danger: true };
}

/** The toast for a plan with nothing eligible. */
export function nothingToArchive({ skipped = [] } = {}) {
  return { tone: 'info', title: 'Nothing to archive', detail: skipped.length ? skippedLine(skipped) : '' };
}

/** The age rule: finished, not archived rows whose last activity is more than `days` days before `now`,
 *  as a plan; one with retained work lands in `skipped`, never in `eligible`. Unknown times are left out. */
export function olderThan(rows, days, now = Date.now()) {
  const cutoff = now - Number(days) * DAY_MS;
  return archivePlan((rows || []).filter((r) => r && !r.archived && ENDED.has(r.icon)
    && Number.isFinite(r.activityMs) && r.activityMs < cutoff));
}

/** Send one archive at a time (there is no bulk endpoint). `request(row)` resolves { ok, error }; a
 *  rejection or ok:false is kept by row and the rest still go. Never throws. */
export async function archiveEach(rows, request, { onDone = () => {} } = {}) {
  const done = [];
  const failed = [];
  for (const row of rows || []) {
    let res;
    try { res = await request(row); } catch (err) { res = { ok: false, error: err && err.message ? err.message : String(err) }; }
    if (res && res.ok) { done.push(row); onDone(row); } else failed.push({ row, error: (res && res.error) || 'failed' });
  }
  return { done, failed };
}

/** The result toast: every failure named by its run title. */
export function archiveReport({ done = [], failed = [] } = {}) {
  const detail = failed.map((f) => `${f.row.title}: ${f.error}`).join('\n');
  if (!failed.length) return { tone: 'ok', title: `Archived ${runsWord(done.length)}`, detail: '' };
  if (!done.length) return { tone: 'err', title: `Could not archive ${runsWord(failed.length)}`, detail, key: 'runs-archive' };
  return { tone: 'err', title: `Archived ${runsWord(done.length)} · ${failed.length} failed`, detail, key: 'runs-archive' };
}
