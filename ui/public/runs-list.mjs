// ui/public/runs-list.mjs — the Runs list (runs redesign §3.1): the sections Needs you, Running, Waiting and Recent (or one per
// project / date bucket, or one per Show filter), single rows and group rows, drawn from the one run model
// (src/shared/run-model.mjs runModel / groupModel) and the one status dot (status-dot.mjs). Pure: app.js adapts the
// live runs, the History rows, the schedule tickets and the groups into the plain items below; every DOM builder
// takes a `doc`, so jsdom tests drive this module without app.js.
//
// Item shapes (the adapters live in app.js: runsLiveItem / runsHistItem / runsSchedItem / runsGroupItem). Every item
// carries `run` (the raw state run-model.mjs reads) and `memo` (runProgress's monotonic memo, owned by app.js per run):
//   live:  { runId, pipelineId, title, status, ask: {kind, step}|null, pauseReason, unread, step, failedStep,
//            startedAt, groupKey, groupName, by, pr, checks, files, tags, cost, run, memo }
//   hist:  { id, projectKey, title, status, pauseReason, startedAt, mtime, groupName, by,
//            pr (a glance input: glancePrInput's output), checks, files, archived, tags, cost, run }
//   sched: { id, scheduleId, title (may be null), status, after ({…, title, group, index}), queued, retryAt, runAt, createdAt,
//            groupKey, groupName, by }
//   group: { id, groupKind: 'chain'|'feature'|'user', title, pr?, memo?, groupKey?, groupName?, cost?, liveCost?,
//            costMemo?, members: [{ position, title, adhoc, href, pipelineId, ticketId, runId,
//            kind: 'live'|'hist'|'sched', run, memo, cost, startedAt, roundOf? }] }
// A live or hist item (and a member) may carry `roundOf` ({ pipelineId: round 1's id, round ≥ 2, request, by?, kinds?,
// outcome? }): a round of another run. buildRunsModel folds it under that run (plans/pr-fix-rounds-stacking-plan.md).
// The state words of liveRowState / histRowState / schedRowState stay for ⌘K and the Activity menu; the list reads
// none of them (D1).
import { icon } from './icons.mjs';
import { originMark } from './chat-origin.mjs';
import { glanceCopy } from './run-glance.mjs';
import { splitShown, matchesLabels } from '../../src/shared/run-labels.mjs';
import { labelChip } from './label-picker.mjs';
import { paintProgressBar, renderRowLine } from './run-progress-bar.mjs';
import { renderStatusDot } from './status-dot.mjs';
import { fmtUsd } from './graph/run-decor.mjs';
import { engineLabel } from '../../src/shared/engine-switch.mjs';
import { runModel, groupModel, finishedNeedsYou, WATCH_WHY } from '../../src/shared/run-model.mjs';
import { kindChip } from './run-kind.mjs';

const pad2 = (n) => String(n).padStart(2, '0');
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAY_MS = 86400000;

/** Epoch ms for a time field: an ISO stamp, epoch ms, or a bare "HH:MM[:SS]" (today). NaN when unknown.
 *  0 is unknown too: rowToHistoryEntry emits `mtime: 0` when a row has no updated_at. */
export function timeMs(v, now = Date.now()) {
  if (typeof v === 'number') return Number.isFinite(v) && v > 0 ? v : NaN;
  const s = String(v || '').trim();
  if (!s) return NaN;
  const bare = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(s);
  if (bare) {
    const d = new Date(now);
    d.setHours(Number(bare[1]), Number(bare[2]), Number(bare[3] || 0), 0);
    return d.getTime();
  }
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : NaN;
}

/** The subline's time: "11:17" today, "Tue" within six days, "Sep 12" this year, else "Sep 12, 2025". */
export function rowTime(v, now = Date.now()) {
  const t = timeMs(v, now);
  if (!Number.isFinite(t)) return '';
  const d = new Date(t);
  const n = new Date(now);
  const day = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round(Math.abs(day(n) - day(d)) / DAY_MS);
  if (days === 0) return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  if (days <= 6) return DAYS[d.getDay()];
  const md = `${MONTHS[d.getMonth()]} ${d.getDate()}`;
  return d.getFullYear() === n.getFullYear() ? md : `${md}, ${d.getFullYear()}`;
}

// The wall clock of `ms` in zone `tz` as a local Date, so rowTime's local getters read that zone's fields.
function inZone(ms, tz) {
  if (!tz) return ms;
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric',
  }).formatToParts(ms).map((p) => [p.type, p.value]));
  return new Date(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute).getTime();
}

/** A run time for any surface: rowTime's style, with the 24h clock after the day when it is not today.
 *  "17:45" today, "Thu, 02:00" this week, "Sep 12, 14:05" this year, "Dec 3, 2025, 14:05" before. */
export function whenLabel(v, now = Date.now(), tz = '') {
  const t = timeMs(v, now);
  if (!Number.isFinite(t)) return '';
  const when = inZone(t, tz);
  const ref = inZone(now, tz);
  const day = rowTime(when, ref);
  const d = new Date(when);
  const clock = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  return day === clock ? clock : `${day}, ${clock}`;
}

const DONE = new Set(['done', 'complete', 'completed']);
const FAILED = new Set(['error', 'failed']);
const STOPPED = new Set(['stopped', 'aborted']);
const PARKED = new Set(['paused', 'pausing', 'interrupted']);
// A pause names its cause, like statusPill ("Paused · cost limit") but short enough for a row.
// error / recoverable / a manual pause read plain "Paused".
const PAUSE_WORDS = Object.freeze({
  cost_pipeline: 'Cost limit', cost_total: 'Total budget', cost_pipeline_policy: 'Team cap',
  cost_total_policy: 'Team total', usage_limit: 'Usage limit', drain: 'Restart',
});
// Search words per icon, beyond the row's own word: "paused" finds a cost-limit pause too.
const STATE_TERMS = Object.freeze({
  ask: 'waiting question review', paused: 'paused', fail: 'failed error', stop: 'stopped',
  run: 'running', start: 'starting running', done: 'done finished', scheduled: 'scheduled',
});

/** `limitEngine`: a usage limit an engine hit names that engine ("Codex usage limit").
 *  `limitNote`: when that limit resets ("resets 18:00"), the usage-limit arms' detail. */
function parkedState(s, pauseReason, limitEngine = null, limitNote = '') {
  if (s === 'pausing') return { icon: 'paused', word: 'Pausing', detail: '' };
  if (s === 'interrupted') return { icon: 'paused', word: 'Interrupted', detail: '' };
  if (pauseReason === 'usage_limit' && limitEngine) return { icon: 'paused', word: `${engineLabel(limitEngine)} usage limit`, detail: limitNote || '' };
  return { icon: 'paused', word: PAUSE_WORDS[pauseReason] || 'Paused', detail: pauseReason === 'usage_limit' ? limitNote || '' : '' };
}

/** A question's word, naming its step the way the mockup does ("Plan review"): a workflow
 *  decision or a gate is a review, a recovery a failed step, anything else a question. */
function askWord(ask) {
  const step = ask && ask.step ? String(ask.step) : '';
  const kind = ask && ask.kind;
  if (kind === 'workflow' || kind === 'gate') {
    if (step) return `${step} review`;
    return kind === 'gate' ? 'Approval needed' : 'Workflow review';
  }
  if (kind === 'recovery') return step ? `${step} failed` : 'Step failed';
  if (kind === 'plan') return ask.outline ? 'Approve the slices' : 'Approve the plan';   // Shaper's plan ask (D33)
  if (kind === 'form') return step ? `${step} question` : 'Input needed';
  return step ? `${step} question` : 'Question';
}

/** A finished run's word: exactly the glance headline (run-glance.mjs glanceCopy, done branch). */
function doneWord({ pr = null, checks = null, files = null, changes = null } = {}) {
  return glanceCopy({ status: 'done', steps: [] }, { pr, checks, files, changes }).lead;
}

/** A live run's row: { icon, word, detail }. Branch order mirrors app.js statusPill:
 *  parked-ness outranks a question, a question outranks the raw terminal status. */
export function liveRowState(it) {
  const s = String((it && it.status) || '').toLowerCase();
  if (PARKED.has(s)) return parkedState(s, it.pauseReason, it.limitEngine, it.limitNote);
  if (it.ask) return { icon: 'ask', word: askWord(it.ask), detail: '' };
  if (FAILED.has(s)) return { icon: 'fail', word: it.failedStep ? `${it.failedStep} failed` : 'Failed', detail: '' };
  if (STOPPED.has(s)) return { icon: 'stop', word: 'Stopped', detail: '' };
  if (DONE.has(s)) return { icon: 'done', word: doneWord(it), detail: '' };
  if (s === 'starting' || s === 'created' || !s) return { icon: 'start', word: 'Starting', detail: '' };
  return { icon: 'run', word: 'Running', detail: it.step ? String(it.step) : '' };
}

/** A History row's state. A row still "running" here belongs to a run this tab does not know. */
export function histRowState(p) {
  const s = String((p && p.status) || '').toLowerCase();
  let st;
  if (PARKED.has(s)) st = parkedState(s, p.pauseReason, p.limitEngine, p.limitNote);
  else if (FAILED.has(s)) st = { icon: 'fail', word: 'Failed', detail: '' };
  else if (STOPPED.has(s)) st = { icon: 'stop', word: 'Stopped', detail: '' };
  // P5: a mixed workspace row carries its Folder members' rollup `changes`, but its glance is the git one (workMode absent).
  else if (DONE.has(s)) st = { icon: 'done', word: doneWord(p.target === 'workspace' && p.workMode !== 'folder' ? { ...p, changes: null } : p), detail: '' };
  else if (s === 'running' || s === 'starting' || s === 'created') st = { icon: 'run', word: 'Running', detail: '' };
  else st = { icon: 'stop', word: s ? `${s.charAt(0).toUpperCase()}${s.slice(1)}` : 'Unknown', detail: '' };
  // An archived run keeps its terminal icon (it did finish that way) but its word says
  // where it lives now — the glance headline ("Merged") would hide the soft delete.
  if (p && p.archived) st = { ...st, word: 'Archived', detail: '' };
  return st;
}

/** A schedule ticket's state, in schedules-view.mjs ticketRow's order: missed, firing, chained
 *  after another run, queued behind the previous run, retrying, else due. */
export function schedRowState(t) {
  const s = String((t && t.status) || '');
  if (s === 'missed') return { icon: 'scheduled', word: 'Missed', detail: '' };
  if (s === 'firing') return { icon: 'start', word: 'Starting', detail: '' };
  const word = t && t.after ? 'Waiting' : t && t.queued ? 'Queued' : t && t.retryAt ? 'Retrying' : 'Scheduled';
  return { icon: 'scheduled', word, detail: '' };
}

/** A workspace run's member PRs (#784): a run's `memberPrs`, else a History row's members[].pr (the history-pr
 *  batch fills them through app.js applyWsMemberPrs). Objects only; [] for any other run. */
export function memberPrsOf(x) {
  if (x && Array.isArray(x.memberPrs)) return x.memberPrs;
  const ms = x && Array.isArray(x.members) ? x.members : [];
  return ms.map((m) => m && m.pr).filter((p) => p && typeof p === 'object');
}

/** A run (History row, a row's raw run, a member's run) that a finished run's PR or Watch PR raises to Needs you
 *  (run-model.mjs finishedNeedsYou, D31 / D23); a workspace run's member PRs count too (#784). A glance string
 *  ('MERGED') carries no verdict. */
const prNeedsOf = (x) => !!(x && typeof x === 'object')
  && finishedNeedsYou({ pr: x.pr && typeof x.pr === 'object' ? x.pr : null, watch: x.watch || null, memberPrs: memberPrsOf(x),
    prDeduped: !!x.prDeduped,
    // D8: a round never needs you through its PR (a raw History row names its marker `roundOf`, a model run `round`).
    round: x.round || x.roundOf || (x.branch && typeof x.branch === 'object' ? x.branch.roundOf : null) || null });

/** A round's marker (D1) on an item, a row or a raw History row: { pipelineId, round ≥ 2, … }, else null. */
export function roundMarkerOf(x) {
  const m = x && x.roundOf;
  return m && typeof m === 'object' && m.pipelineId && Number.isInteger(m.round) && m.round >= 2 ? m : null;
}
// D5: a round in one of these statuses is live; its run stands for the stack.
const LIVE_ROUND = new Set(['created', 'starting', 'running', 'paused', 'pausing']);
const FIXING_ROUND = new Set(['created', 'starting', 'running']);

const normPrUrl = (u) => String(u || '').trim().toLowerCase().replace(/[?#].*$/, '').replace(/\/+$/, '');
/** A run's PR urls, normalized: its own PR's, else each workspace member PR's (D8). */
export function prUrlsOf(x) {
  if (!x || typeof x !== 'object') return [];
  const own = x.pr && typeof x.pr === 'object' && x.pr.url ? [x.pr.url] : [];
  return [...new Set((own.length ? own : memberPrsOf(x).map((p) => p && p.url)).filter(Boolean).map(normPrUrl))];
}
// An epoch for "newest" with no clock: epoch ms, or an ISO stamp.
const stampMs = (v) => (typeof v === 'number' ? (Number.isFinite(v) && v > 0 ? v : NaN) : Date.parse(String(v || '')));

/** D8: one open PR raises one Needs-you item. Among `rows` that need you ONLY through their PR (`prOnly`), the newest
 *  (`at`) per normalized PR url (`urls`) counts; a row stays while any of its urls is still unclaimed. → { kept,
 *  dropped: Set }, `kept` in the input order. */
export function dedupeByPr(rows, { prOnly = () => true, urls = prUrlsOf, at = () => 0 } = {}) {
  const ms = (r) => { const t = at(r); return Number.isFinite(t) ? t : 0; };
  const cands = rows.filter((r) => prOnly(r) && urls(r).length).sort((a, b) => ms(b) - ms(a));
  const claimed = new Set();
  const dropped = new Set();
  for (const r of cands) {
    const us = urls(r);
    if (us.every((u) => claimed.has(u))) dropped.add(r);
    else for (const u of us) claimed.add(u);
  }
  return { kept: rows.filter((r) => !dropped.has(r)), dropped };
}

/** Needs you: a question or gate, a pause (cost caps included), a failed run nobody opened yet, and a finished run
 *  whose PR has failing checks or conflicts with no fix run on it (`prNeeds`, D31). */
export function needsYou({ kind = 'live', status = '', ask = false, unread = false, prNeeds = false } = {}) {
  if (kind === 'sched') return false;
  const s = String(status || '').toLowerCase();
  if (s === 'paused') return true;
  if (prNeeds && s === 'done') return true;
  if (kind !== 'live') return false;
  if (ask && s !== 'pausing' && s !== 'interrupted') return true;
  return !!unread && FAILED.has(s);
}

/** The items Needs you holds: live items that need you, and History rows that do whose run is not
 *  listed live. countNeedsYou counts exactly these; the top bar's Activity lists them. */
export function needsYouItems({ live = [], history = [] } = {}) {
  const pids = new Set(live.map((r) => r && r.pipelineId).filter(Boolean));
  // D5: while a round of a run is working, that run is Working, never Needs you through its PR. A paused round is not
  // fixing anything: it counts for its pause, and its run for its PR (plan Task 3: 1 + 1).
  const fixing = new Set([...live, ...history].map((x) => {
    const m = roundMarkerOf(x);
    return m && FIXING_ROUND.has(String(x.status || '').toLowerCase()) ? String(m.pipelineId) : '';
  }).filter(Boolean));
  const hist = history.filter((p) => p && !pids.has(p.id)
    && needsYou({ kind: 'hist', status: p.status, prNeeds: prNeedsOf(p) && !fixing.has(String(p.id)) }));
  return {
    live: live.filter((r) => r && needsYou({ kind: 'live', status: r.status, ask: !!r.ask, unread: !!r.unread })),
    // D8: a History row needs you through its PR only when done (a paused one for its pause); one item per open PR.
    history: dedupeByPr(hist, { prOnly: (p) => String(p.status || '').toLowerCase() === 'done',
      at: (p) => (Number.isFinite(stampMs(p.mtime)) ? stampMs(p.mtime) : stampMs(p.startedAt)) }).kept,
  };
}

/** The Runs badge: the Needs you count without building the list (runs on every WS frame). */
export function countNeedsYou(src = {}) {
  const { live, history } = needsYouItems(src);
  return live.length + history.length;
}

function baseRow(kind, st, fields, when, now) {
  return {
    kind, ...fields, ...st,
    time: when.time === undefined ? rowTime(when.at, now) : when.time,
    sortMs: timeMs(when.at, now),
  };
}

export function liveRow(it, now = Date.now()) {
  const st = liveRowState(it);
  const status = String(it.status || '').toLowerCase();
  return baseRow('live', st, {
    key: `live:${it.runId}`, href: `#running/${it.runId}`,
    runId: String(it.runId), pipelineId: String(it.pipelineId || ''), projectKey: '',
    title: String(it.title || '(untitled)'), status,
    groupKey: String(it.groupKey || ''), groupName: String(it.groupName || ''), groupKind: String(it.groupKind || ''), by: String(it.by || ''),
    tags: Array.isArray(it.tags) ? it.tags.map(String) : [],
    labels: Array.isArray(it.labels) ? it.labels.map(String) : [],
    unread: !!it.unread, needs: needsYou({ kind: 'live', status, ask: !!it.ask, unread: !!it.unread }),
    progress: it.progress || null,
    cost: it.cost ?? null,                           // D32: the row's hover "Cost $1.23"; null = unknown
    roundOf: roundMarkerOf(it),                      // a round of another run: buildRunsModel folds it (D2)
  }, { at: it.startedAt }, now);
}

// A row's identities a chain can claim. A firing ticket's live row has runId === the ticket id.
const rowChainKeys = (r) => [
  r.pipelineId && `p:${r.pipelineId}`,
  r.kind === 'sched' && `t:${r.key.slice('sched:'.length)}`,
  r.kind === 'live' && r.runId && `r:${r.runId}`,
  r.kind === 'live' && r.runId && `t:${r.runId}`,
].filter(Boolean);

export function histRow(p, now = Date.now()) {
  const st = histRowState(p);
  const key = String(p.projectKey || '');
  const status = String(p.status || '').toLowerCase();
  return baseRow('hist', st, {
    key: `hist:${key}/${p.id}`, href: `#history/${key}/${p.id}`,
    runId: '', pipelineId: String(p.id), projectKey: key,
    title: String(p.title || p.id || '(untitled)'), status,
    groupKey: key, groupName: String(p.groupName || key || '(unknown project)'), groupKind: String(p.groupKind || ''), by: String(p.by || ''),
    tags: Array.isArray(p.tags) ? p.tags.map(String) : [],
    labels: Array.isArray(p.labels) ? p.labels.map(String) : [],
    archived: !!(p && p.archived),
    mock: p.mock === true,
    ...(p.resumable === false ? { resumable: false } : {}),   // an interrupted run that can never resume (Archive takes it)
    base: String(p.base || ''),                      // #620: "conflicts with dev" / "dev moved", else ''
    unread: false, needs: needsYou({ kind: 'hist', status, prNeeds: prNeedsOf(p.run || p) }),
    cost: p.cost ?? null,
    activityMs: Number.isFinite(timeMs(p.mtime, now)) ? timeMs(p.mtime, now) : timeMs(p.startedAt, now),
    roundOf: roundMarkerOf(p),                       // a round of another run: buildRunsModel folds it (D2)
  }, { at: p.startedAt || p.mtime }, now);
}

export function schedRow(t, now = Date.now()) {
  const st = schedRowState(t);
  return baseRow('sched', st, {
    // The Schedules tab that lists it (SCHEDULE_TABS): a series occurrence under Repeating.
    key: `sched:${t.id}`, href: t.scheduleId ? '#schedules/repeating' : '#schedules/once',
    runId: '', pipelineId: '', projectKey: '',
    title: String(t.title || 'Scheduled run'), status: String(t.status || 'scheduled'),
    groupKey: String(t.groupKey || ''), groupName: String(t.groupName || ''), by: String(t.by || ''),
    unread: false, needs: false,
    scheduleId: String(t.scheduleId || ''),
    // D12: a one-off ticket is dispatched when it was created; a series occurrence keeps its runAt (sortMs).
    dispatchMs: t.scheduleId ? undefined : timeMs(t.createdAt, now),
  }, t.after ? { at: now, time: '' } : { at: t.runAt }, now);   // an after-ticket's runAt is a far-future sentinel
}

/** The day sections both lists share (Runs and Chats Group by Date), top to bottom: Today, Yesterday, 2–7 days ago,
 *  8–30 days ago, then the rest. The boundaries are local midnights, stepped with setDate so a DST day is still one day. */
export const DAY_BUCKETS = Object.freeze([
  ['today', 'Today'], ['yesterday', 'Yesterday'], ['week', 'Previous 7 days'], ['month', 'Previous 30 days'], ['older', 'Older'],
]);
/** The View menu's Date segment title, for both lists. */
export const DATE_GROUP_TITLE = DAY_BUCKETS.map(([, name]) => name).join(' · ');
export function dayBucket(t, now = Date.now()) {
  if (!Number.isFinite(t)) return 'older';
  const day = new Date(now);
  day.setHours(0, 0, 0, 0);
  if (t >= day.getTime()) return 'today';
  day.setDate(day.getDate() - 1);
  if (t >= day.getTime()) return 'yesterday';
  day.setDate(day.getDate() - 6);
  if (t >= day.getTime()) return 'week';
  day.setDate(day.getDate() - 23);
  return t >= day.getTime() ? 'month' : 'older';
}
/** Older starts folded in both lists. `collapsed` (the person's record) holds the sections whose fold differs from
 *  their default, so a fold read or set goes through these two. */
const FOLDED_FIRST = new Set(['date:older']);
export const isFolded = (collapsed, id) => FOLDED_FIRST.has(id) !== collapsed.has(id);
export function setFolded(collapsed, id, fold) {
  if (fold !== FOLDED_FIRST.has(id)) collapsed.add(id); else collapsed.delete(id);
}

/** Runs "Group by" Date sections: Upcoming, then the shared day sections. Live rows are happening now (Today); a
 *  scheduled run is Upcoming; a History row files under its last activity (finish time, else start). */
export const DATE_BUCKETS = Object.freeze([['upcoming', 'Upcoming'], ...DAY_BUCKETS]);
export function dateBucket(row, now = Date.now()) {
  if (row.kind === 'sched') return 'upcoming';
  // Groups include finished features and user groups (D10): an ended group files under its latest member's time.
  const endedGroup = row.kind === 'chain' && row.model && ENDED_STATES.has(row.model.state) && Number.isFinite(row.activityMs);
  return dayBucket(row.kind === 'live' || (row.kind === 'chain' && !endedGroup) ? now : row.activityMs, now);
}
const NEEDS_RANK = Object.freeze({ ask: 0, paused: 1, fail: 2 });
// D12: dispatch time, newest first, is the default order. A row's `dispatchMs` when it has one (a one-off ticket's
// created time, a group's first member's start), else its `sortMs` (a run's start; a series occurrence's runAt).
export const dispatchOf = (r) => (Number.isFinite(r.dispatchMs) ? r.dispatchMs : r.sortMs || 0);
const byDispatch = (a, b) => dispatchOf(b) - dispatchOf(a);
export const cmpNeeds = (a, b) => ((NEEDS_RANK[a.needsIcon || a.icon] ?? 3) - (NEEDS_RANK[b.needsIcon || b.icon] ?? 3)) || byDispatch(a, b);

export const RUNS_SHOW = Object.freeze(['all', 'needs', 'running', 'waiting', 'finished', 'ready', 'archived']);
/** D10: a run that has not started (clarify: one-off only): an after-ticket, a one-off timed ticket, or a group whose
 *  next member is one. A series occurrence and a missed ticket stay in Recent. */
const isWaiting = (r) => r.model.state === 'waiting' && !(r.kind === 'sched' && (r.scheduleId || r.status === 'missed'));
export const RUNS_GROUP_BY = Object.freeze(['none', 'project', 'date']);
export const RECENT_PAGE = 20;
const ENDED_STATES = new Set(['failed', 'stopped', 'ready', 'in-review', 'merged']);
// Ready to ship: a finished git run (or group) with no open PR. A Folder or no-project run is 'ready' too, but its word
// is Finished / Applied / Discarded (run-model.mjs finishedWords): nothing to ship, so it stays out.
const isReadyToShip = (r) => r.model.state === 'ready' && r.model.word === 'Ready';
const RUNNING_STATES = new Set(['starting', 'working', 'paused', 'needs-you']);
const LIVE_MEMBER = new Set(['starting', 'working', 'needs-you', 'paused', 'failed']);
const STAGED = (m) => (m && m.progress && m.progress.mode === 'stages' ? m.progress.label : '');
const and = (...p) => p.filter(Boolean).join(' · ');
// #955: inside a group the dot already says Working / Starting, so a member's line drops that word ("Running" is a
// round's Working word, run-model.mjs roundLine). Failed, Paused, Stopped, Needs you and Waiting keep theirs.
const DOT_SAYS = new Set(['working', 'starting']);
export function memberLine(m, line) {
  const s = String(line || '');
  return m && DOT_SAYS.has(m.state) ? s.replace(/^(?:Working|Starting|Running)(?: · |$)/, '') : s;
}
// #955 (D8): a chat inside a topic group that names its one project does not repeat it.
const dropLead = (line, lead) => (!lead ? line : line === lead ? '' : line.startsWith(`${lead} · `) ? line.slice(lead.length + 3) : line);

/** A row's place in a Show filter (D4). */
export function rowShow(row, show) {
  if (show === 'archived') return !!row.archived;
  if (row.archived) return false;
  if (show === 'needs') return !!row.needs;
  if (show === 'waiting') return isWaiting(row);
  // A run raised to Needs you by its PR (D31, model.prNeeds) is finished: it lists under Finished, not Running.
  if (show === 'running') return !ENDED_STATES.has(row.model.state) && !row.model.prNeeds && !isWaiting(row);
  if (show === 'finished') return ENDED_STATES.has(row.model.state) || !!row.model.prNeeds;
  if (show === 'ready') return isReadyToShip(row);
  return true;
}

const posOf = (g) => (g.current && g.current === g.planning ? 'Planning' : g.current ? `Run ${g.members.indexOf(g.current) + 1}` : '');
const NEEDS_ICON = ['ask', 'paused', 'fail'];                                     // NEEDS_RANK order (cmpNeeds)
const NEEDS_ICON_OF = { 'needs-you': 'ask', paused: 'paused', failed: 'fail' };

/** D9: why a group sits in Needs you, said on its own row: "Run 1 needs you · Checks failing". '' when the group's
 *  own line already says it (the needing member is its current one and asks, pauses or failed itself). */
function needsWhy(row) {
  const members = row.members || [];
  const mb = members.find((x) => x.needs && x.model);
  if (!mb) return '';
  const m = mb.model;
  if (m === row.model.current && !m.prNeeds) return '';
  const who = `Run ${mb.position || members.indexOf(mb) + 1}`;   // the member's own position: a planning run does not shift it
  // The round count says the base keeps moving (mock: "Run 3 needs you · Conflicts · 7 rounds").
  const rounds = mb.rounds && mb.rounds.length ? `${mb.rounds.length} ${mb.rounds.length === 1 ? 'round' : 'rounds'}` : '';
  if (m.prNeeds) return and(`${who} needs you`, m.pr && m.pr.needsYou ? m.pr.word : 'Watch stopped', rounds);
  if (m.state === 'needs-you') return `${who} needs you`;
  if (m.state === 'paused') return and(`${who} paused`, PAUSE_WORDS[mb.run && mb.run.pauseReason] || '');
  return m.state === 'failed' ? `${who} failed` : '';
}

/** §3.1 "say each thing once": the row's one status line. `section`: 'needs' | 'running' | '' (mixed). */
export function listLine(row, { section = '', time = '' } = {}) {
  const m = row.model;
  if (row.kind === 'chat' || row.kind === 'chat-group') return m.line;   // #948: Chats column rows bring their whole sub line (chats-list.mjs)
  if (row.archived) return and('Archived', time);
  if (row.kind === 'chain') {
    const p = posOf(m);
    // D5: a member's live fix round names itself: "Run 3 · Round 9 · merge dev in".
    const rd = m.current && m.current.state === 'working' ? m.current.round : null;
    const stage = rd ? and(`Round ${rd.n}`, rd.by === 'watch' ? rd.request : '') : m.current ? STAGED(m.current) : '';
    if (row.needs) { const why = needsWhy(row); if (why) return why; }
    // The short form only where the section already says the state; a paused or waiting group keeps its word.
    if ((section === 'needs' && (m.state === 'needs-you' || m.state === 'failed'))
      || (section === 'running' && (m.state === 'working' || m.state === 'starting'))) return and(p, stage) || m.word;
    switch (m.state) {
      case 'starting': case 'working': case 'needs-you': case 'paused': return and(m.word, p, stage);
      case 'waiting': return and('Waiting', p, ((m.current && m.current.line) || '').replace(/^Waiting(?: · )?/, ''));
      case 'failed': return and(p ? `Failed at ${p.toLowerCase()}` : 'Failed', time);
      case 'stopped': return and(p ? `Stopped at ${p.toLowerCase()}` : 'Stopped', time);
      case 'ready': return and('Ready to ship', time);
      case 'in-review': return m.pr ? time : and(m.line, time);
      default: return m.pr ? time : and('Merged', time);
    }
  }
  // A finished run raised to Needs you by its PR (D31): its chip says what is wrong, so the line never repeats it.
  if (m.prNeeds) return section === 'needs' ? 'In review' : and('In review', time);
  const w = STAGED(m);
  if (section === 'needs' && m.state === 'needs-you') return w || m.word;
  if (section === 'running' && (m.state === 'working' || m.state === 'starting')) return w || m.word;
  switch (m.state) {
    case 'failed': return and(w ? `Failed at ${w}` : 'Failed', time);
    case 'ready': return and(row.mock ? 'Mock run' : m.line, time);
    case 'stopped': return and(m.line, time);
    case 'in-review': case 'merged': return m.pr && !m.pr.pending ? time : and(m.word, time);
    // A usage-limit pause keeps its reset / auto-resume note ("resets 18:00", liveRowState / histRowState detail).
    case 'paused': return and(m.line, row.detail);
    default: return m.line;
  }
}

/** §2.4: the group total, max(stored, live) per pipeline, held by `memo` so it never goes down (D32). */
export function groupCostUsd(g, liveCost = {}, memo = null) {
  let usd = 0;
  if (g.cost) {
    const by = g.cost.byPipeline || {};
    for (const [id, stored] of Object.entries(by)) usd += Math.max(Number(stored) || 0, Number(liveCost[id]) || 0);
    // A member that started after the last /api/run-groups load is live but not in byPipeline yet: it still counts.
    for (const [id, live] of Object.entries(liveCost)) if (!(id in by)) usd += Number(live) || 0;
  } else {
    usd = (g.members || []).reduce((a, m) => a + (Number(m.cost) || 0), 0);   // a plain chain: its members' rows
  }
  usd = Math.round(usd * 100) / 100;
  if (memo) { memo.max = Math.max(memo.max || 0, usd); usd = memo.max; }
  return usd;
}

/** D5 (D32's class fix): a member's cost is the highest number any source knows (its live entry, its History row,
 *  the group's stored byPipeline). A finished run still in the live map carries 0 there: it never wins. */
export function memberCostUsd(...xs) {
  const ns = xs.filter((x) => typeof x === 'number' && Number.isFinite(x));
  return ns.length ? Math.round(Math.max(...ns) * 100) / 100 : null;
}

/** The row's hover text (spec §2.4). `cost` null: the engine reports none (engineReportsCost). */
export function costTitle(r) {
  if (r.kind === 'chain' || r.kind === 'chat-group') return `Group total ${fmtUsd(r.costUsd || 0)}`;
  return r.cost == null ? 'Cost unknown' : `Cost ${fmtUsd(r.cost)}`;
}

/** One group (chain, feature or user group) as a list row. Members keep their order; `count` is "2/3". */
export function groupRow(g, { now = Date.now() } = {}) {
  const raw = (g.members || []).map((mb) => ({ ...(mb.run || {}), memo: mb.memo || null }));
  const planningRaw = g.planning ? { ...(g.planning.run || {}), memo: g.planning.memo || null } : null;
  const model = groupModel({ kind: g.groupKind === 'feature' ? 'feature' : 'chain', title: g.title, members: raw,
    planning: planningRaw, pr: g.pr || null, memo: g.memo || null }, { now });
  const members = (g.members || []).map((mb, i) => ({ ...mb, key: `member:${g.id}/${mb.pipelineId || mb.ticketId || i}`, model: model.members[i],
    needs: needsYou({ kind: mb.kind || 'hist', status: mb.run && mb.run.status, ask: !!(mb.run && mb.run.pendingQuestion != null),
      prNeeds: prNeedsOf(mb.run) }) }));
  const planning = g.planning ? { ...g.planning, key: `member:${g.id}/planning`, model: model.planning } : null;
  // `cur` also matches Planning, so the row's runId / pipelineId / href point at the planning run while it is the
  // current one (not at slice 1).
  const cur = (planning && model.current === model.planning ? planning : null)
    || members.find((mb) => mb.model === model.current) || members[0] || null;
  // D12: a group's dispatch time is its planning run's start, else its first member's.
  const firstAt = [...(g.planning ? [g.planning] : []), ...(g.members || [])].map((mb) => timeMs(mb.startedAt, now)).find(Number.isFinite);
  return {
    kind: 'chain', groupKind: g.groupKind || 'chain', key: `chain:${g.id}`, groupId: String(g.id),
    // Run 3 (D3): every group row opens its own page in the pane; the current member's ids stay for the ⋯ and alerts.
    href: `${g.groupKind === 'feature' ? '#feature' : '#group'}/${encodeURIComponent(g.id)}`,
    runId: (cur && cur.runId) || '', pipelineId: (cur && cur.pipelineId) || '', projectKey: '',
    title: String(g.title || '(untitled)'), status: '', groupKey: String(g.groupKey || ''), groupName: String(g.groupName || ''),
    by: '', unread: false, needs: members.some((mb) => mb.needs), time: '', sortMs: now, dispatchMs: firstAt, open: false,   // set by buildRunsModel (D29)
    // cmpNeeds ranks by needsIcon || icon (ask, paused, fail); a group takes its most urgent member's.
    needsIcon: NEEDS_ICON.find((ic) => members.some((mb) => mb.needs && NEEDS_ICON_OF[mb.model.state] === ic)) || '',
    model, count: model.count.text, members,
    costUsd: groupCostUsd(g, g.liveCost || {}, g.costMemo || null),
    // The planning run's keys too, so its own list row folds into the group.
    memberKeys: new Set([...members, ...(planning ? [planning] : [])].flatMap((mb) => [mb.pipelineId && `p:${mb.pipelineId}`, mb.ticketId && `t:${mb.ticketId}`, mb.runId && `r:${mb.runId}`]).filter(Boolean)),
    planning,
  };
}

const ROUND_STATUS_WORD = Object.freeze({ done: 'done', complete: 'done', completed: 'done', error: 'failed', failed: 'failed',
  stopped: 'stopped', aborted: 'stopped', interrupted: 'interrupted', paused: 'paused', pausing: 'paused' });
/** D7: what a round did. Its stored outcome first (pr-watch.mjs fixOutcome): "pushed 3e4f5a6", "nothing pushed: conflicts
 *  remain", "PR merged"; else its status: done, failed, stopped, paused, running. */
export function roundOutcomeWords(round) {
  const o = round && round.outcome && typeof round.outcome === 'object' ? round.outcome : null;
  if (o && o.kind === 'pushed') return o.sha ? `pushed ${o.sha}` : 'pushed';
  if (o && o.kind === 'failed') {
    const why = o.reason ? WATCH_WHY[o.reason] || o.reason : '';
    return why ? `nothing pushed: ${why}` : 'nothing pushed';
  }
  if (o && o.kind === 'ended') return `PR ${o.reason || 'ended'}`;
  return ROUND_STATUS_WORD[String((round && round.status) || '').toLowerCase()] || 'running';
}
/** D7: a round's request and outcome, "merge dev in · pushed 3e4f5a6" (the stack's sub-list names its round apart). */
export const roundWords = (round) => and(String((round && round.request) || ''), roundOutcomeWords(round));
/** D6 / D7: a round's line, "Round 8 · merge dev in · pushed 3e4f5a6 · Thu"; a live round names no time. */
export function roundLine(round, now) {
  const live = LIVE_ROUND.has(String((round && round.status) || '').toLowerCase()) && !(round && round.outcome);
  return and(`Round ${round.n}`, roundWords(round), live || !Number.isFinite(round.activityMs) ? '' : rowTime(round.activityMs, now));
}
/** D9: how many rounds an open stack shows before "+n earlier". */
export const ROUNDS_SHOWN = 5;
// The keys a stack's rounds answer to: the selection (isRowSelected / isMemberOpen) and a group's memberKeys.
const roundKeysOf = (rounds) => rounds.flatMap((rd) => [rd.pipelineId && `p:${rd.pipelineId}`, rd.runId && `r:${rd.runId}`]).filter(Boolean);
// D5: a live round's run with its origin's PR, marked fixing (prOf ranks Fixing above Conflicts / Checks failing).
const stackRun = (roundRun, originRun) => ({ ...(roundRun || {}), pr: (originRun && originRun.pr) || null,
  ...(originRun && Array.isArray(originRun.memberPrs) ? { memberPrs: originRun.memberPrs } : {}), watch: { status: 'fixing' } });

/**
 * D2–D5: fold every round row into its origin (round 1). `all` is every row, `rows0` the plain rows that passed the
 * filters; rows0 is edited IN PLACE (an origin row becomes its stack's head, an orphan stack's head joins it). Returns
 * the groups with each origin member carrying its rounds, and `stacked`: pid -> the head's own activity (the PR dedupe
 * ranks runs by it, as needsYouItems does).
 */
function foldRounds({ all, rows0, groups, pass, raw, view, archivedIds, now }) {
  const stacked = new Map();
  const rounds = all.filter((r) => r.roundOf);
  let orphans = 0;
  if (!rounds.length) return { groups, stacked, orphans };
  const present = new Map(all.filter((r) => r.pipelineId && !r.roundOf).map((r) => [r.pipelineId, r]));
  const rowAt = new Map(rows0.map((r, i) => [r.pipelineId, i]).filter(([pid]) => pid));
  // Group members by pipeline id, in groupOf's order (the first group that names a run claims it).
  const memberAt = new Map();
  groups.forEach((g, gi) => (g.members || []).forEach((mb, mi) => {
    const pid = mb && mb.pipelineId ? String(mb.pipelineId) : '';
    if (pid && !memberAt.has(pid)) memberAt.set(pid, { gi, mi });
  }));
  const rawKeys = (g) => new Set([...(g.members || []), ...(g.planning ? [g.planning] : [])]
    .flatMap((mb) => [mb.pipelineId && `p:${mb.pipelineId}`, mb.ticketId && `t:${mb.ticketId}`, mb.runId && `r:${mb.runId}`]).filter(Boolean));
  const listedGroup = new Map();
  const isListed = (gi) => {
    if (!listedGroup.has(gi)) { const ks = rawKeys(groups[gi]); listedGroup.set(gi, rows0.some((r) => rowChainKeys(r).some((k) => ks.has(k)))); }
    return listedGroup.get(gi);
  };
  const rowOf = new Map();   // round entry -> its row (an orphan's head is that row)
  const byOrigin = new Map();
  const archivedOrigin = new Set();
  for (const r of rounds) {
    const o = String(r.roundOf.pipelineId);
    const origin = present.get(o);
    // D4: an archived origin takes its finished rounds out of the active list; nothing is written. Under Show =
    // Archived they fold under it as usual. A live round, or one that needs you, is never dropped (D3 / D5): it lists
    // as an orphan stack ("… · Round n"), so the list shows what the badge counts.
    if (view.show !== 'archived' && ((origin && origin.archived) || (!origin && archivedIds.has(o)))) {
      if (!LIVE_ROUND.has(r.status) && !r.needs) continue;
      archivedOrigin.add(o);
    }
    const rd = { n: r.roundOf.round, pipelineId: r.pipelineId, runId: r.runId, href: r.href, status: r.status, state: r.model.state,
      request: String(r.roundOf.request || ''), outcome: r.roundOf.outcome || null,
      activityMs: Number.isFinite(r.activityMs) ? r.activityMs : r.sortMs, needs: !!r.needs, needsIcon: r.needsIcon || (r.needs ? r.icon : '') || '',
      live: LIVE_ROUND.has(r.status) };
    rd.line = roundLine(rd, now);
    rd.words = roundWords(rd);
    rd.time = rd.live && !rd.outcome ? '' : rowTime(rd.activityMs, now);
    rowOf.set(rd, r);
    if (!byOrigin.has(o)) byOrigin.set(o, []);
    byOrigin.get(o).push(rd);
  }
  const out = groups.slice();
  const editMember = (gi, mi, fn) => {
    if (out[gi] === groups[gi]) out[gi] = { ...groups[gi], members: groups[gi].members.slice() };
    out[gi].members[mi] = fn(out[gi].members[mi]);
  };
  const latest = (list, ms) => Math.max(...[ms, ...list.map((rd) => rd.activityMs)].filter(Number.isFinite));
  for (const [o, list] of byOrigin) {
    list.sort((a, b) => b.n - a.n);   // newest first
    const live = list.find((rd) => rd.live) || null;
    const liveRaw = live ? raw.get(rowOf.get(live)) : null;
    const stack = { rounds: list, roundsId: o, roundKeys: new Set(roundKeysOf(list)), roundsLive: !!live };
    // An archived origin's row and membership stay out of the active list: its kept rounds head an orphan stack.
    const at = archivedOrigin.has(o) ? undefined : memberAt.get(o);
    const i = archivedOrigin.has(o) ? undefined : rowAt.get(o);
    if (i !== undefined) {
      // The origin's own row: its time moves up with its rounds (Recent order, the Date bucket, its group's time).
      const row = rows0[i];
      stacked.set(o, Number.isFinite(row.activityMs) ? row.activityMs : row.sortMs);
      const next = { ...row, ...stack, activityMs: latest(list, row.activityMs) };
      raw.set(next, raw.get(row));
      if (live) {
        // D5: the stack is the live round (its state, its line, its needs) under the origin's title, position and href.
        next.model = runModel(stackRun(liveRaw.run, (raw.get(row) || {}).run), { memo: liveRaw.memo, now });
        next.needs = list.some((rd) => rd.needs);
        next.needsIcon = (list.find((rd) => rd.needs) || {}).needsIcon || '';
        next.roundsLine = next.model.line;
      } else {
        next.roundsLine = list[0].line;
        next.roundsOwnLine = !!row.needs && !row.model.prNeeds;   // D6
        const why = list.find((rd) => rd.needs);
        if (why) { next.needs = true; next.needsIcon ||= why.needsIcon; }
      }
      rows0[i] = next;
    }
    if (at && isListed(at.gi)) {
      // D2: inside a listed group the member carries the stack; groupRow builds its model from the live round (D5).
      editMember(at.gi, at.mi, (mb) => ({ ...mb, ...stack, roundsLine: list[0].line,
        ...(live ? { run: stackRun(liveRaw.run, mb.run), memo: liveRaw.memo || mb.memo, kind: rowOf.get(live).kind } : {}) }));
      continue;
    }
    if (i !== undefined) continue;
    // D3: no origin listed (deleted, filtered out): the newest round heads its stack, titled after its run.
    const [first, ...older] = list;
    const headRow = rowOf.get(first);
    const named = at ? (groups[at.gi].members[at.mi] || {}).title : '';
    const head = { ...headRow, title: `${named || headRow.title} · Round ${first.n}`, orphan: true,
      ...(older.length ? { rounds: older, roundsId: o, roundKeys: new Set(roundKeysOf(older)), roundsLive: false,
        roundsLine: headRow.model.state === 'working' || headRow.model.state === 'starting' ? headRow.model.line : first.line,
        roundsOwnLine: !!headRow.needs && !headRow.model.prNeeds, activityMs: latest(older, headRow.activityMs) } : {}) };
    raw.set(head, raw.get(headRow));
    const why = older.find((rd) => rd.needs);
    if (why) { head.needs = true; head.needsIcon ||= why.needsIcon; }
    if (pass(head)) rows0.push(head);
    orphans += 1;
  }
  return { groups: out, stacked, orphans };
}

/** D8 in the list: among the rows (and group members) that need you only through their PR, the newest per PR url keeps
 *  Needs you, as needsYouItems counts it. Returns the pipeline ids of the others: the caller rebuilds them with
 *  `prDeduped` (run-model.mjs), so they read In review and list under Recent. A run a round of it raises (a round
 *  that failed or paused) is no candidate: losing the PR need must not hide the round's. */
function dedupeRows(rows0, groupRows, raw, stacked) {
  const cands = new Map();
  const ownMs = (r) => (stacked.has(r.pipelineId) ? stacked.get(r.pipelineId) : Number.isFinite(r.activityMs) ? r.activityMs : r.sortMs);
  const roundNeeds = (x) => (x.rounds || []).some((rd) => rd.needs);
  for (const r of rows0) {
    if (!r.needs || !r.model.prNeeds || !r.pipelineId || roundNeeds(r)) continue;
    cands.set(r.pipelineId, { pid: r.pipelineId, urls: prUrlsOf((raw.get(r) || {}).run), at: ownMs(r) });
  }
  for (const g of groupRows) for (const mb of g.members) {
    if (!mb.needs || !mb.model || !mb.model.prNeeds || !mb.pipelineId || roundNeeds(mb) || cands.has(mb.pipelineId)) continue;
    cands.set(mb.pipelineId, { pid: mb.pipelineId, urls: prUrlsOf(mb.run), at: stampMs(mb.startedAt) });
  }
  if (cands.size < 2) return new Set();
  const { dropped } = dedupeByPr([...cands.values()], { urls: (c) => c.urls, at: (c) => c.at });
  return new Set([...dropped].map((c) => c.pid));
}

/**
 * The list model: { sections: [{id, title, rows, count, more?, bucket?, collapsed?}], counts, view, total, shown,
 * spansProjects, now, orphans }. `archivedIds`: the archived feed's run ids, so an archived run's rounds stay out (D4). Section ids: 'needs' | 'running' | 'recent' | 'project:KEY' | 'date:BUCKET'.
 * A History row whose run is listed live is dropped (the live row stands for it), and so is a schedule ticket whose
 * run is (a firing ticket's id IS its runId). A row a group claims folds into that group's row.
 */
export function buildRunsModel({
  live = [], history = [], scheduled = [], groups = [], person = '', labels = [], show = 'all', groupBy = 'none',
  collapsed = new Set(), toggled = new Map(), recentShown = RECENT_PAGE, archivedCount = null, archivedIds = new Set(),
  now = Date.now(),
} = {}) {
  const view = { show: RUNS_SHOW.includes(show) ? show : 'all', groupBy: RUNS_GROUP_BY.includes(groupBy) ? groupBy : 'none' };
  const raw = new WeakMap();   // row -> { run, memo }: what its model was built from (D5 rebuilds a stack head's model)
  const withModel = (r, run, memo) => {
    const row = { ...r, model: runModel(run, { memo: memo || null, now }) };
    raw.set(row, { run, memo: memo || null });
    return row;
  };
  const liveRows = live.map((it) => withModel(liveRow(it, now), it.run || { status: it.status }, it.memo));
  const listed = new Set(liveRows.map((r) => r.pipelineId).filter(Boolean));
  const liveIds = new Set(liveRows.map((r) => r.runId));
  const all = [
    ...liveRows,
    // An after-ticket's runAt is a far-future sentinel: no start time for it.
    ...scheduled.filter((t) => t && !liveIds.has(String(t.id)))
      .map((t) => withModel(schedRow(t, now), { ticket: { status: t.status, runAt: t.after ? null : t.runAt,
        after: t.after ? { index: t.after.index || null, group: t.after.group || '', title: t.after.title || '' } : null } })),
    ...history.filter((p) => p && p.id && !listed.has(String(p.id))).map((p) => withModel(histRow(p, now), p.run || { status: p.status })),
  ];
  // The person and label filters apply to a stack's head only: a round is filtered with the run it folds into.
  const pass = (r) => (!person || r.by === person) && matchesLabels(r.labels, labels);
  const rows0 = all.filter((r) => !r.roundOf && pass(r));
  const { groups: groupsIn, stacked, orphans } = foldRounds({ all, rows0, groups, pass, raw, view, archivedIds, now });
  const buildGroup = (g, gi) => {
    const row = groupRow(g, { now });
    // A live round runs its member (D5), but rounds are not members: the count ("3/3") is the members' own runs'.
    if (g !== groups[gi] && g.members.some((mb) => mb.roundsLive)) {
      row.count = groupModel({ kind: g.groupKind === 'feature' ? 'feature' : 'chain', members: groups[gi].members.map((mb) => mb.run || {}) }, { now }).count.text;
    }
    for (const mb of row.members) {
      if (!mb.rounds || !mb.rounds.length) continue;
      // D6: a member that needs a person for its own reason keeps its line; the round line comes second.
      mb.roundsOwnLine = !mb.roundsLive && !!mb.needs && !mb.model.prNeeds;
      if (mb.roundsLive) mb.roundsLine = mb.model.line;   // D5: "Running · Round 9 · merge dev in"
      const why = mb.rounds.find((rd) => rd.needs);
      if (why) mb.needs = true;
      if (mb.needs) { row.needs = true; row.needsIcon ||= NEEDS_ICON_OF[mb.model.state] || (why && why.needsIcon) || ''; }
      for (const k of roundKeysOf(mb.rounds)) row.memberKeys.add(k);
    }
    return row;
  };
  const groupRows = groupsIn.map(buildGroup);
  // D8: a run whose open PR another run raises reads In review (prDeduped) and lists under Recent, row and member alike.
  const deduped = dedupeRows(rows0, groupRows, raw, stacked);
  if (deduped.size) {
    const quiet = (run) => ({ ...(run || {}), prDeduped: true });
    rows0.forEach((r, i) => {
      if (!deduped.has(r.pipelineId)) return;
      const src = raw.get(r) || { run: { status: r.status }, memo: null };
      const next = { ...r, model: runModel(quiet(src.run), { memo: src.memo, now }), needs: false, needsIcon: '' };
      raw.set(next, { run: quiet(src.run), memo: src.memo });
      rows0[i] = next;
    });
    groupsIn.forEach((g, gi) => {
      if (!(g.members || []).some((mb) => mb && deduped.has(String(mb.pipelineId || '')))) return;
      groupRows[gi] = buildGroup({ ...g, members: g.members.map((mb) => (mb && deduped.has(String(mb.pipelineId || ''))
        ? { ...mb, run: quiet(mb.run) } : mb)) }, gi);
    });
  }
  const groupOf = (r) => groupRows.find((x) => rowChainKeys(r).some((k) => x.memberKeys.has(k))) || null;
  // Needs before the fold (runs-list-needs-before-collapse): a member that needs you raises its group.
  // The raised group also takes the member's needs icon, so cmpNeeds ranks it (a live failed-unread member counts too).
  for (const r of rows0) { const g = r.needs ? groupOf(r) : null; if (g) { g.needs = true; g.needsIcon ||= r.needsIcon || r.icon || ''; } }
  const placed = new Set();
  const top = [];
  for (const r of rows0) {
    const g = groupOf(r);
    if (!g) { top.push(r); continue; }
    if (placed.has(g.key)) continue;
    placed.add(g.key);
    // The group sits where its first listed member sat; its time is its latest member's (Recent order, the line's
    // "· Fri", the Date bucket).
    const ms = rows0.filter((x) => groupOf(x) === g).map((x) => x.activityMs).filter(Number.isFinite);
    top.push({ ...g, groupKey: g.groupKey || r.groupKey, groupName: g.groupName || r.groupName, sortMs: r.sortMs,
      dispatchMs: Number.isFinite(g.dispatchMs) ? g.dispatchMs : dispatchOf(r),
      activityMs: ms.length ? Math.max(...ms) : undefined, archived: !!r.archived });
  }
  const counts = {
    all: top.filter((r) => !r.archived).length, needs: top.filter((r) => rowShow(r, 'needs')).length,
    running: top.filter((r) => rowShow(r, 'running')).length, waiting: top.filter((r) => rowShow(r, 'waiting')).length, finished: top.filter((r) => rowShow(r, 'finished')).length,
    ready: top.filter((r) => rowShow(r, 'ready')).length,
    archived: archivedCount,
  };
  const shown = top.filter((r) => rowShow(r, view.show));
  const spansProjects = new Set(shown.map((r) => r.groupKey).filter(Boolean)).size > 1 && view.groupBy !== 'project';
  const sections = [];
  const push = (id, title, rows, extra = {}) => { if (rows.length) sections.push({ id, title, rows, count: rows.length, ...extra }); };
  if (view.show !== 'all') {
    const titles = { needs: 'Needs you', running: 'Running', waiting: 'Waiting', finished: 'Finished', ready: 'Ready to ship', archived: 'Archived' };
    const id = ['needs', 'running', 'waiting'].includes(view.show) ? view.show : 'recent';
    push(id, titles[view.show], view.show === 'needs' ? shown.sort(cmpNeeds) : shown.sort(byDispatch));
  } else {
    const rest = shown.filter((r) => !r.needs);
    push('needs', 'Needs you', shown.filter((r) => r.needs).sort(cmpNeeds));
    if (view.groupBy === 'none') {
      // A finished run whose PR another run already raises (D8 dedupe) is finished: it lists under Recent.
      const running = (r) => RUNNING_STATES.has(r.model.state) && !r.model.prNeeds;
      push('running', 'Running', rest.filter(running).sort(byDispatch));
      push('waiting', 'Waiting', rest.filter(isWaiting).sort(byDispatch));
      const recent = rest.filter((r) => !running(r) && !isWaiting(r)).sort(byDispatch);
      push('recent', 'Recent', recent.slice(0, recentShown), { more: Math.max(0, recent.length - recentShown) });
    } else if (view.groupBy === 'project') {
      const by = new Map();
      for (const r of rest) {
        const k = r.groupKey || '(unknown)';
        if (!by.has(k)) by.set(k, { name: r.groupName || '(unknown project)', kind: '', rows: [] });
        by.get(k).rows.push(r);
        // The project kind chip (Git / Folder / No project); a chain row's groupKind is its chain kind, never a project's.
        if (!by.get(k).kind && r.kind !== 'chain' && r.groupKind) by.get(k).kind = r.groupKind;
      }
      const latest = (g) => Math.max(...g.rows.map(dispatchOf));
      for (const [k, g] of [...by].sort((a, b) => latest(b[1]) - latest(a[1]))) {
        const id = `project:${k}`;
        push(id, g.name, g.rows.sort(byDispatch), { collapsed: collapsed.has(id), ...(g.kind ? { kind: g.kind } : {}) });
      }
    } else {
      for (const [b, name] of DATE_BUCKETS) {
        const id = `date:${b}`;
        push(id, name, rest.filter((r) => dateBucket(r, now) === b).sort(byDispatch), { bucket: b, collapsed: isFolded(collapsed, id) });
      }
    }
  }
  // D29: a group is open while it is not finished (any section, any flag), closed once it has ended; the person's
  // ⌄ toggle for this session wins. A plain Run-after chain behaves like a feature.
  for (const s of sections) for (const r of s.rows) {
    if (r.kind === 'chain') r.open = toggled.has(r.key) ? !!toggled.get(r.key) : !ENDED_STATES.has(r.model.state);
  }
  // `orphans`: stacks whose run is not listed (D3); the caller loads the archived feed once to tell an archived run (D4).
  return { sections, counts, view, total: view.show === 'archived' ? shown.length : counts.all, shown: shown.length, spansProjects, now, orphans };
}

/** Is `row` the page the pane shows? `sel` = { runId, pipelineId, histKey: "<projectKey>/<id>", groupId }. A group row
 *  is selected only while its own page is open (D4); isMemberOpen marks it while one of its runs is. */
export function isRowSelected(row, sel) {
  if (!sel || row.kind === 'sched') return false;
  if (row.kind === 'chain') return !!sel.groupId && row.groupId === sel.groupId;
  if (sel.groupId) return false;
  if (sel.runId && row.runId === sel.runId) return true;
  if (sel.histKey && row.kind === 'hist' && `${row.projectKey}/${row.pipelineId}` === sel.histKey) return true;
  // A stack's head stands for its rounds: a round's page marks it (D2).
  if (row.roundKeys && ((sel.pipelineId && row.roundKeys.has(`p:${sel.pipelineId}`)) || (sel.runId && row.roundKeys.has(`r:${sel.runId}`)))) return true;
  return !!sel.pipelineId && row.pipelineId === sel.pipelineId;
}
export function isMemberOpen(row, sel) {
  if (!sel || row.kind !== 'chain' || !row.memberKeys) return false;
  return !!((sel.pipelineId && row.memberKeys.has(`p:${sel.pipelineId}`)) || (sel.runId && row.memberKeys.has(`r:${sel.runId}`)));
}

function textEl(doc, tag, cls, text) {
  const n = doc.createElement(tag);
  n.className = cls;
  n.textContent = text;
  return n;
}

/** The PR chip (spec §2.1a): icon + word, the title in the tooltip. Shared with run-status-card.mjs (slice 4, D1).
 *  `link`: a member row's chip is its own link to the PR (QA 7), above the row's stretched title link.
 *  `number`: the run page's PR bar names its PR inside the chip, between the git-state icon and the word (run 3, D11). */
export function prChip(doc, pr, { link = false, number = false } = {}) {
  const asLink = link && !!pr.url;
  const s = doc.createElement(asLink ? 'a' : 'span');
  s.className = `runs-pr is-${pr.id}`;
  s.title = pr.title;
  if (asLink) { s.setAttribute('href', pr.url); s.setAttribute('target', '_blank'); s.setAttribute('rel', 'noopener'); }
  s.append(icon(doc, pr.icon, 14));
  if (number && pr.number != null) s.append(textEl(doc, 'span', 'runs-pr-num', `PR #${pr.number}`));
  s.append(textEl(doc, 'span', 'runs-pr-word', pr.word));
  return s;
}

function iconButton(doc, cls, name, label) {
  const b = doc.createElement('button');
  b.type = 'button';
  b.className = `btn btn-sm btn-quiet btn-icon ${cls}`;
  b.setAttribute('aria-label', label);
  b.append(icon(doc, name, 14));
  return b;
}

/** Up to 2 label chips after the title, then "+N" (its title names the rest). Null when the row has none. */
export function rowLabels(doc, labels) {
  if (!labels || !labels.length) return null;
  const { shown, more } = splitShown(labels, 2);
  const box = doc.createElement('span');
  box.className = 'runs-row-labels';
  box.append(...shown.map((l) => labelChip(doc, l)));
  if (more) {
    const m = textEl(doc, 'span', 'label-more', `+${more}`);
    m.title = labels.slice(2).join(', ');
    box.append(m);
  }
  return box;
}

/** D6 / D9: a stack's line (the newest round's, or the live round's) with its `k rounds` toggle (a chevron icon), then, while open,
 *  its rounds newest first (5, then "+n earlier"). Round lines are links to each round's page. */
function renderRounds(doc, r, { roundsOpen = new Set(), roundsAll = new Set(), now }) {
  const key = `rounds:${r.roundsId}`;
  const open = roundsOpen.has(key);
  const n = r.rounds.length;
  const bar = doc.createElement('div');
  bar.className = 'runs-rounds-line';
  // The chevron is an icon, never a text glyph (spec §1.3): right while closed, down while open.
  const t = textEl(doc, 'button', 'runs-rounds-toggle', `${n} ${n === 1 ? 'round' : 'rounds'}`);
  t.prepend(icon(doc, open ? 'chevron-down' : 'chevron', 12));
  t.type = 'button';
  t.dataset.roundsKey = key;
  t.setAttribute('aria-expanded', open ? 'true' : 'false');
  t.setAttribute('aria-label', `${open ? 'Hide' : 'Show'} the ${n} ${n === 1 ? 'round' : 'rounds'} of ${r.title}`);
  bar.append(textEl(doc, 'span', 'runs-rounds-text', r.roundsLine || ''), t);
  if (!open) return [bar];
  const list = doc.createElement('div');
  list.className = 'runs-rounds';
  list.setAttribute('role', 'list');
  const all = roundsAll.has(key) || n <= ROUNDS_SHOWN;
  for (const rd of all ? r.rounds : r.rounds.slice(0, ROUNDS_SHOWN)) {
    const a = doc.createElement('a');
    a.className = `runs-round${rd.live && !rd.outcome ? ' is-live' : ''}`;
    a.setAttribute('role', 'listitem');
    a.setAttribute('href', rd.href);
    a.dataset.pipelineId = rd.pipelineId || '';
    a.append(textEl(doc, 'span', 'runs-round-n', `R${rd.n}`), textEl(doc, 'span', 'runs-round-words', rd.words),
      textEl(doc, 'span', 'runs-round-time', rd.time || ''));
    list.append(a);
  }
  if (!all) {
    const more = textEl(doc, 'button', 'runs-rounds-more', `+${n - ROUNDS_SHOWN} earlier`);
    more.type = 'button';
    more.dataset.roundsKey = key;
    list.append(more);
  }
  return [bar, list];
}

function renderItem(doc, r, { section = '', level = 'top', checked, selecting, spansProjects = false, lineFrom = null, position = '', parentWhere = '', now = Date.now(),
  roundsOpen = new Set(), roundsAll = new Set() } = {}) {
  const item = doc.createElement('div');
  item.className = `runs-item${checked.has(r.key) ? ' is-checked' : ''}${r.needs && level === 'top' ? ' is-needs' : ''}`;
  item.dataset.rowKey = r.key;
  item.dataset.level = level;
  item.dataset.stateWord = r.model.word;                 // the layout audit's "said once" check (tools/runs-layout-audit.mjs)
  const pick = doc.createElement('span');
  pick.className = 'runs-pick';
  const box = doc.createElement('input');
  box.type = 'checkbox';
  box.className = 'runs-check';
  box.checked = checked.has(r.key);
  box.setAttribute('aria-label', `Select ${r.title}`);
  pick.append(renderStatusDot(doc, r.model), box);
  const a = doc.createElement('a');
  a.className = `runs-row runs-row-${r.kind}`;
  a.setAttribute('href', r.href);
  a.title = costTitle(r);                                 // §2.4: the PR chip keeps its own title
  for (const [k, v] of Object.entries({ rowKey: r.key, kind: r.kind, state: r.model.state, pipelineId: r.pipelineId, projectKey: r.projectKey,
    groupId: r.kind === 'chain' ? r.groupId : '' })) if (v) a.dataset[k] = v;
  if (r.runId) a.dataset.runId = r.runId;   // this exact line: test/ui-guide-hops.test.mjs reads it as the guide hop's painter
  a.dataset.line = r.model.line;      // slice 4 (D3): the canonical status line, compared across list, card and page
  if (r.memberKeys) a.dataset.memberKeys = [...r.memberKeys].join(' ');   // paintRunsSelection rebuilds the set from it
  if (r.roundKeys && r.roundKeys.size) a.dataset.roundKeys = [...r.roundKeys].join(' ');   // and this one (a stack's rounds)
  // #948 s3: a Chats column topic group draws as a Runs group row (count, ⌄, indented members), with no stage line.
  const grouped = r.kind === 'chain' || r.kind === 'chat-group';
  const right = doc.createElement('span');
  right.className = 'runs-row-right';
  if (grouped) right.append(textEl(doc, 'span', 'runs-count', r.count));
  if (r.model.pr && !r.model.pr.pending) right.append(prChip(doc, r.model.pr));
  // Rows carry no clock: the model's `now` keeps it deterministic. Group rows ('chain') carry their latest member's
  // activityMs, so "Ready to ship · Fri" and a group-PR row's "Fri" get their time too.
  const time = Number.isFinite(r.activityMs) ? rowTime(r.activityMs, now) : (r.time || '');
  // QA 3: a PR-driven member keeps the list's own line, so the model's reason line never sits next to its own chip.
  let line = level === 'member' && LIVE_MEMBER.has(r.model.state) && !r.model.prNeeds ? r.model.line : listLine(r, { section, time });
  if (spansProjects && level === 'top' && r.groupName) line = and(line, r.groupName);
  // #955: a member is one line: no state word its dot says, no project its group names, no label chips.
  if (level === 'member') line = dropLead(memberLine(r.model, line), r.kind === 'chat' ? parentWhere : '');
  // #1012: a staged member draws the four-section block, whose marks name its stage, so its line drops that word.
  // A working one names no step either ("Refine Plan"): only a state its dot does not say (needs you, paused) stays.
  // A member dispatched but not started yet (Starting) has no progress to show: no block, no line.
  const unstarted = level === 'member' && r.model.state === 'starting';
  const staged = level === 'member' && !unstarted && r.kind !== 'chain' && LIVE_MEMBER.has(r.model.state) && r.model.state !== 'failed'
    && !r.model.prNeeds && r.model.progress && r.model.progress.mode === 'stages';
  if (staged) line = DOT_SAYS.has(r.model.state) ? '' : dropLead(line, r.model.progress.label);
  // D6: a stack's sub-line is its newest round's (the stack line below the row); the row keeps its own line only while
  // it needs a person for its own reason, and the round line comes second.
  const stack = !!(r.rounds && r.rounds.length);
  const title = textEl(doc, 'span', 'runs-row-title', position ? `${position} · ${r.title}` : r.title);
  const mark = r.kind === 'chat' ? originMark(doc, r.origin) : null;   // a chat a chat integration opened: its platform's logo
  if (mark) title.prepend(mark);
  const lab = level === 'top' ? rowLabels(doc, r.labels) : null;
  a.append(...[title, lab, right, stack && !r.roundsOwnLine ? null : textEl(doc, 'span', 'runs-row-sub', line)].filter(Boolean));
  if (r.kind === 'chain' && !ENDED_STATES.has(r.model.state) && r.model.progress) {
    a.append(renderRowLine(doc, { fraction: r.model.progress.fraction }, (lineFrom && lineFrom.get(r.key)) || ''));
  } else if (r.kind !== 'chain' && !unstarted && LIVE_MEMBER.has(r.model.state) && r.model.state !== 'failed' && !r.model.prNeeds && r.model.progress) {
    // A run in Needs you only through its PR (conflicts, failing checks) has finished: no progress bar to draw.
    if (level === 'member' && !staged) {
      // #955: a one-line member without stages keeps the list's 3px line; paintRunsProgress (app.js) moves it in place.
      a.append(renderRowLine(doc, { fraction: r.model.progress.fraction }, (lineFrom && lineFrom.get(r.key)) || ''));
    } else {
      const stage = doc.createElement('div');
      stage.className = 'run-prog runs-stage';
      paintProgressBar(stage, r.model.progress, { pulse: r.model.pulse });
      a.append(stage);
    }
  }
  const tail = doc.createElement('span');
  tail.className = 'runs-row-tail';
  if (grouped) {
    // A chat group names the server's count (its chats not all paged in yet); a chain row carries no memberCount.
    const n = r.memberCount ?? r.members.length;
    const t = iconButton(doc, 'runs-expand', 'chevron-down', `${r.open ? 'Hide' : 'Show'} the ${n} ${r.memberNoun || 'runs'} in ${r.title}`);
    t.dataset.chainKey = r.key;
    t.setAttribute('aria-expanded', r.open ? 'true' : 'false');
    tail.append(t);
  }
  const more = iconButton(doc, 'runs-more', 'more', `More for ${r.title}`);
  more.dataset.rowKey = r.key;
  more.setAttribute('aria-haspopup', 'menu');
  tail.append(more);
  item.append(pick, a, tail);
  if (stack) item.append(...renderRounds(doc, r, { roundsOpen, roundsAll, now }));
  if (grouped && r.open) {
    const list = doc.createElement('div');   // member rows are div.runs-item, so a list of them is a div with role=list
    list.className = 'runs-members';
    list.setAttribute('role', 'list');
    for (const mb of r.members) {
      list.append(renderItem(doc, { ...mb, href: mb.href || '#runs', title: mb.title || '(untitled)' },
        { level: 'member', checked, selecting, lineFrom, now, roundsOpen, roundsAll, parentWhere: r.kind === 'chat-group' ? r.groupName || '' : '',
          position: r.kind !== 'chain' || r.groupKind === 'user' || mb.adhoc ? '' : String(mb.position) }));
    }
    item.append(list);
  }
  return item;
}

const SHOW_EMPTY = Object.freeze({ needs: 'Nothing needs you.', running: 'No running runs.', waiting: 'Nothing is waiting.', finished: 'No finished runs yet.', ready: 'Nothing is ready to ship.', archived: 'No archived runs.' });

/** The list's children: one section element each, then the empty note and the error note. */
/** §5a.2: the empty list's note before History has answered, and while the server is unreachable. */
export const RUNS_LOADING = 'Loading runs…';
export const RUNS_OFFLINE = "The runs show here once Worca's server is reachable again.";

/** Repaint every staged row's four-section block IN PLACE from `model` (its fill, marks and breakdown). The list rebuilds
 *  a row only when its signature changes (app.js runsRowSig: stage and label), and the fill is not in it: a row first
 *  painted from hello (a stepper, no steps yet) otherwise kept 0% after the replayed state began its stage (#1067). */
export function paintStageBlocks(host, model) {
  const byKey = new Map();
  for (const s of model.sections) {
    if (s.collapsed) continue;
    for (const r of s.rows) {
      byKey.set(r.key, r);
      if (r.kind === 'chain') for (const m of r.members || []) byKey.set(m.key, m);
    }
  }
  for (const block of host.querySelectorAll('.runs-item > a.runs-row > .runs-stage')) {
    const r = byKey.get(block.closest('.runs-item').dataset.rowKey);
    if (r && r.model && r.model.progress && r.model.progress.mode === 'stages') paintProgressBar(block, r.model.progress, { pulse: r.model.pulse });
  }
}

export function renderRunsList(doc, model, { checked = new Set(), selecting = false, lineFrom = null, emptyText = 'No runs yet.', note = '',
  loading = false, offline = false, retry = false, emptyByShow = SHOW_EMPTY, loadingText = RUNS_LOADING,
  offlineText = RUNS_OFFLINE, roundsOpen = new Set(), roundsAll = new Set() } = {}) {
  const out = [];
  for (const s of model.sections) {
    const sec = doc.createElement('section');
    sec.className = `runs-sec runs-sec-${s.id.split(':')[0]}`;
    sec.dataset.section = s.id;
    sec.setAttribute('aria-label', s.title);
    const collapsible = s.collapsed !== undefined;   // project and date sections fold, as today's group heads
    // A bare section (#948 s2: the Chats column's flat lists) draws no head: the view chip names the list.
    const head = s.bare ? null : doc.createElement(collapsible ? 'button' : 'div');
    if (head) {
      head.className = 'runs-sec-head';
      if (collapsible) { head.type = 'button'; head.dataset.sectionKey = s.id; head.setAttribute('aria-expanded', s.collapsed ? 'false' : 'true'); }
      head.append(textEl(doc, 'span', 'runs-sec-title', s.title), ...(s.kind ? [kindChip(doc, s.kind)].filter(Boolean) : []), textEl(doc, 'span', 'runs-count', String(s.count)));
    }
    const rows = doc.createElement('div');
    rows.className = 'runs-sec-rows';
    rows.hidden = !!s.collapsed;
    const sectionWord = s.id === 'needs' || s.id === 'running' ? s.id : '';
    if (!s.collapsed) for (const r of s.rows) rows.append(renderItem(doc, r, { section: sectionWord, checked, selecting, spansProjects: model.spansProjects, lineFrom, now: model.now, roundsOpen, roundsAll }));
    sec.append(...(head ? [head] : []), rows);
    if (s.more) {
      // #948 s2: "Show more" under the Chats column's project and flat lists; Runs keeps "Show older".
      const b = textEl(doc, 'button', 'btn btn-sm btn-quiet runs-older', s.moreLabel || 'Show older');
      b.type = 'button';
      sec.append(b);
    }
    out.push(sec);
  }
  const retryBtn = () => {
    const b = textEl(doc, 'button', 'btn btn-sm btn-secondary runs-retry', 'Try again');
    b.type = 'button';
    b.dataset.runsRetry = '1';
    return b;
  };
  if (!model.shown) {
    // Only a list with nothing at all says loading or offline: a Show-filtered empty view keeps its own note.
    if (loading && !model.total) out.push(textEl(doc, 'p', 'runs-note runs-loading', loadingText));
    else if (offline && !model.total) {
      const p = textEl(doc, 'p', 'runs-note runs-offline', offlineText);
      // #948 s2: a retry with no error note sits on the offline note (Runs always sends retry with a note).
      if (retry && !note) p.append(' ', retryBtn());
      out.push(p);
    } else out.push(textEl(doc, 'p', 'runs-note', emptyByShow[model.view.show] || emptyText));
  }
  if (note) {
    const p = textEl(doc, 'p', 'runs-note runs-note-err', note);
    if (retry) p.append(' ', retryBtn());
    out.push(p);
  }
  return out;
}
