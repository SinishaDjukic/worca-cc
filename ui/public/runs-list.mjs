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
//            kind: 'live'|'hist'|'sched', run, memo, cost, startedAt }] }
// The state words of liveRowState / histRowState / schedRowState stay for ⌘K and the Activity menu; the list reads
// none of them (D1).
import { icon } from './icons.mjs';
import { glanceCopy } from './run-glance.mjs';
import { splitShown, matchesLabels } from '../../src/shared/run-labels.mjs';
import { labelChip } from './label-picker.mjs';
import { paintProgressBar, renderRowLine } from './run-progress-bar.mjs';
import { renderStatusDot } from './status-dot.mjs';
import { fmtUsd } from './graph/run-decor.mjs';
import { engineLabel } from '../../src/shared/engine-switch.mjs';
import { runModel, groupModel, finishedNeedsYou } from '../../src/shared/run-model.mjs';
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
  && finishedNeedsYou({ pr: x.pr && typeof x.pr === 'object' ? x.pr : null, watch: x.watch || null, memberPrs: memberPrsOf(x) });

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
  return {
    live: live.filter((r) => r && needsYou({ kind: 'live', status: r.status, ask: !!r.ask, unread: !!r.unread })),
    history: history.filter((p) => p && !pids.has(p.id) && needsYou({ kind: 'hist', status: p.status, prNeeds: prNeedsOf(p) })),
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
    ...(p.resumable === false ? { resumable: false } : {}),   // an interrupted run that can never resume (Archive takes it)
    base: String(p.base || ''),                      // #620: "conflicts with dev" / "dev moved", else ''
    unread: false, needs: needsYou({ kind: 'hist', status, prNeeds: prNeedsOf(p.run || p) }),
    cost: p.cost ?? null,
    activityMs: Number.isFinite(timeMs(p.mtime, now)) ? timeMs(p.mtime, now) : timeMs(p.startedAt, now),
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

/** "Group by" Date sections, top to bottom. Live rows are happening now (Today); a scheduled run is
 *  Upcoming; a History row files under its last activity (finish time, else start). The
 *  boundaries are local midnights, stepped with setDate so a DST day is still one day. */
export const DATE_BUCKETS = Object.freeze([
  ['upcoming', 'Upcoming'], ['today', 'Today'], ['yesterday', 'Yesterday'],
  ['week', 'Previous 7 days'], ['older', 'Older'],
]);
export function dateBucket(row, now = Date.now()) {
  if (row.kind === 'sched') return 'upcoming';
  // Groups include finished features and user groups (D10): an ended group files under its latest member's time.
  const endedGroup = row.kind === 'chain' && row.model && ENDED_STATES.has(row.model.state) && Number.isFinite(row.activityMs);
  const t = row.kind === 'live' || (row.kind === 'chain' && !endedGroup) ? now : row.activityMs;
  if (!Number.isFinite(t)) return 'older';
  const day = new Date(now);
  day.setHours(0, 0, 0, 0);
  if (t >= day.getTime()) return 'today';
  day.setDate(day.getDate() - 1);
  if (t >= day.getTime()) return 'yesterday';
  day.setDate(day.getDate() - 6);
  return t >= day.getTime() ? 'week' : 'older';
}
const NEEDS_RANK = Object.freeze({ ask: 0, paused: 1, fail: 2 });
// D12: dispatch time, newest first, is the default order. A row's `dispatchMs` when it has one (a one-off ticket's
// created time, a group's first member's start), else its `sortMs` (a run's start; a series occurrence's runAt).
export const dispatchOf = (r) => (Number.isFinite(r.dispatchMs) ? r.dispatchMs : r.sortMs || 0);
const byDispatch = (a, b) => dispatchOf(b) - dispatchOf(a);
export const cmpNeeds = (a, b) => ((NEEDS_RANK[a.needsIcon || a.icon] ?? 3) - (NEEDS_RANK[b.needsIcon || b.icon] ?? 3)) || byDispatch(a, b);

export const RUNS_SHOW = Object.freeze(['all', 'needs', 'running', 'waiting', 'finished', 'archived']);
/** D10: a run that has not started (clarify: one-off only): an after-ticket, a one-off timed ticket, or a group whose
 *  next member is one. A series occurrence and a missed ticket stay in Recent. */
const isWaiting = (r) => r.model.state === 'waiting' && !(r.kind === 'sched' && (r.scheduleId || r.status === 'missed'));
export const RUNS_GROUP_BY = Object.freeze(['none', 'project', 'date']);
export const RECENT_PAGE = 20;
const ENDED_STATES = new Set(['failed', 'stopped', 'ready', 'in-review', 'merged']);
const RUNNING_STATES = new Set(['starting', 'working', 'paused', 'needs-you']);
const LIVE_MEMBER = new Set(['starting', 'working', 'needs-you', 'paused', 'failed']);
const STAGED = (m) => (m && m.progress && m.progress.mode === 'stages' ? m.progress.label : '');
const and = (...p) => p.filter(Boolean).join(' · ');

/** A row's place in a Show filter (D4). */
export function rowShow(row, show) {
  if (show === 'archived') return !!row.archived;
  if (row.archived) return false;
  if (show === 'needs') return !!row.needs;
  if (show === 'waiting') return isWaiting(row);
  // A run raised to Needs you by its PR (D31, model.prNeeds) is finished: it lists under Finished, not Running.
  if (show === 'running') return !ENDED_STATES.has(row.model.state) && !row.model.prNeeds && !isWaiting(row);
  if (show === 'finished') return ENDED_STATES.has(row.model.state) || !!row.model.prNeeds;
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
  if (m.prNeeds) return and(`${who} needs you`, m.pr && m.pr.needsYou ? m.pr.word : 'Watch stopped');
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
    const stage = m.current ? STAGED(m.current) : '';
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
    case 'stopped': case 'ready': return and(m.line, time);
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

/**
 * The list model: { sections: [{id, title, rows, count, more?, bucket?, collapsed?}], counts, view, total, shown,
 * spansProjects, now }. Section ids: 'needs' | 'running' | 'recent' | 'project:KEY' | 'date:BUCKET'.
 * A History row whose run is listed live is dropped (the live row stands for it), and so is a schedule ticket whose
 * run is (a firing ticket's id IS its runId). A row a group claims folds into that group's row.
 */
export function buildRunsModel({
  live = [], history = [], scheduled = [], groups = [], person = '', labels = [], show = 'all', groupBy = 'none',
  collapsed = new Set(), toggled = new Map(), recentShown = RECENT_PAGE, archivedCount = null, now = Date.now(),
} = {}) {
  const view = { show: RUNS_SHOW.includes(show) ? show : 'all', groupBy: RUNS_GROUP_BY.includes(groupBy) ? groupBy : 'none' };
  const withModel = (r, run, memo) => ({ ...r, model: runModel(run, { memo: memo || null, now }) });
  const liveRows = live.map((it) => withModel(liveRow(it, now), it.run || { status: it.status }, it.memo));
  const listed = new Set(liveRows.map((r) => r.pipelineId).filter(Boolean));
  const liveIds = new Set(liveRows.map((r) => r.runId));
  const rows0 = [
    ...liveRows,
    // An after-ticket's runAt is a far-future sentinel: no start time for it.
    ...scheduled.filter((t) => t && !liveIds.has(String(t.id)))
      .map((t) => withModel(schedRow(t, now), { ticket: { status: t.status, runAt: t.after ? null : t.runAt,
        after: t.after ? { index: t.after.index || null, group: t.after.group || '', title: t.after.title || '' } : null } })),
    ...history.filter((p) => p && p.id && !listed.has(String(p.id))).map((p) => withModel(histRow(p, now), p.run || { status: p.status })),
  ].filter((r) => (!person || r.by === person) && matchesLabels(r.labels, labels));
  const groupRows = groups.map((g) => groupRow(g, { now }));
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
    archived: archivedCount,
  };
  const shown = top.filter((r) => rowShow(r, view.show));
  const spansProjects = new Set(shown.map((r) => r.groupKey).filter(Boolean)).size > 1 && view.groupBy !== 'project';
  const sections = [];
  const push = (id, title, rows, extra = {}) => { if (rows.length) sections.push({ id, title, rows, count: rows.length, ...extra }); };
  if (view.show !== 'all') {
    const titles = { needs: 'Needs you', running: 'Running', waiting: 'Waiting', finished: 'Finished', archived: 'Archived' };
    const id = ['needs', 'running', 'waiting'].includes(view.show) ? view.show : 'recent';
    push(id, titles[view.show], view.show === 'needs' ? shown.sort(cmpNeeds) : shown.sort(byDispatch));
  } else {
    const rest = shown.filter((r) => !r.needs);
    push('needs', 'Needs you', shown.filter((r) => r.needs).sort(cmpNeeds));
    if (view.groupBy === 'none') {
      push('running', 'Running', rest.filter((r) => RUNNING_STATES.has(r.model.state)).sort(byDispatch));
      push('waiting', 'Waiting', rest.filter(isWaiting).sort(byDispatch));
      const recent = rest.filter((r) => !RUNNING_STATES.has(r.model.state) && !isWaiting(r)).sort(byDispatch);
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
        push(id, name, rest.filter((r) => dateBucket(r, now) === b).sort(byDispatch), { bucket: b, collapsed: collapsed.has(id) });
      }
    }
  }
  // D29: a group is open while it is not finished (any section, any flag), closed once it has ended; the person's
  // ⌄ toggle for this session wins. No shapeFirst check: a plain Run-after chain behaves like a feature.
  for (const s of sections) for (const r of s.rows) {
    if (r.kind === 'chain') r.open = toggled.has(r.key) ? !!toggled.get(r.key) : !ENDED_STATES.has(r.model.state);
  }
  return { sections, counts, view, total: view.show === 'archived' ? shown.length : counts.all, shown: shown.length, spansProjects, now };
}

/** Is `row` the page the pane shows? `sel` = { runId, pipelineId, histKey: "<projectKey>/<id>", groupId }. A group row
 *  is selected only while its own page is open (D4); isMemberOpen marks it while one of its runs is. */
export function isRowSelected(row, sel) {
  if (!sel || row.kind === 'sched') return false;
  if (row.kind === 'chain') return !!sel.groupId && row.groupId === sel.groupId;
  if (sel.groupId) return false;
  if (sel.runId && row.runId === sel.runId) return true;
  if (sel.histKey && row.kind === 'hist' && `${row.projectKey}/${row.pipelineId}` === sel.histKey) return true;
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

function renderItem(doc, r, { section = '', level = 'top', checked, selecting, spansProjects = false, lineFrom = null, position = '', now = Date.now() } = {}) {
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
  // #948 s3: a Chats column topic group draws as a Runs group row (count, ⌄, indented members), with no stage line.
  const grouped = r.kind === 'chain' || r.kind === 'chat-group';
  const right = doc.createElement('span');
  right.className = 'runs-row-right';
  if (grouped) right.append(textEl(doc, 'span', 'runs-count', r.count));
  if (r.adhoc) right.append(textEl(doc, 'span', 'runs-indep', 'Independent'));
  if (r.model.pr && !r.model.pr.pending) right.append(prChip(doc, r.model.pr));
  // Rows carry no clock: the model's `now` keeps it deterministic. Group rows ('chain') carry their latest member's
  // activityMs, so "Ready to ship · Fri" and a group-PR row's "Fri" get their time too.
  const time = Number.isFinite(r.activityMs) ? rowTime(r.activityMs, now) : (r.time || '');
  // QA 3: a PR-driven member keeps the list's own line, so the model's reason line never sits next to its own chip.
  let line = level === 'member' && LIVE_MEMBER.has(r.model.state) && !r.model.prNeeds ? r.model.line : listLine(r, { section, time });
  if (spansProjects && level === 'top' && r.groupName) line = and(line, r.groupName);
  const title = textEl(doc, 'span', 'runs-row-title', position ? `${position} · ${r.title}` : r.title);
  const lab = rowLabels(doc, r.labels);
  a.append(...[title, lab, right, textEl(doc, 'span', 'runs-row-sub', line)].filter(Boolean));
  if (r.kind === 'chain' && !ENDED_STATES.has(r.model.state) && r.model.progress) {
    a.append(renderRowLine(doc, { fraction: r.model.progress.fraction }, (lineFrom && lineFrom.get(r.key)) || ''));
  } else if (r.kind !== 'chain' && LIVE_MEMBER.has(r.model.state) && r.model.state !== 'failed' && !r.model.prNeeds && r.model.progress) {
    // A run in Needs you only through its PR (conflicts, failing checks) has finished: no progress bar to draw.
    const stage = doc.createElement('div');
    stage.className = 'run-prog runs-stage';
    paintProgressBar(stage, r.model.progress, { pulse: r.model.pulse });
    a.append(stage);
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
  if (grouped && r.open) {
    const list = doc.createElement('div');   // member rows are div.runs-item, so a list of them is a div with role=list
    list.className = 'runs-members';
    list.setAttribute('role', 'list');
    for (const mb of r.members) {
      list.append(renderItem(doc, { ...mb, href: mb.href || '#runs', title: mb.title || '(untitled)' },
        { level: 'member', checked, selecting, lineFrom, now, position: r.kind !== 'chain' || r.groupKind === 'user' || mb.adhoc ? '' : String(mb.position) }));
    }
    item.append(list);
  }
  return item;
}

const SHOW_EMPTY = Object.freeze({ needs: 'Nothing needs you.', running: 'No running runs.', waiting: 'Nothing is waiting.', finished: 'No finished runs yet.', archived: 'No archived runs.' });

/** The list's children: one section element each, then the empty note and the error note. */
/** §5a.2: the empty list's note before History has answered, and while the server is unreachable. */
export const RUNS_LOADING = 'Loading runs…';
export const RUNS_OFFLINE = "The runs show here once Worca's server is reachable again.";

export function renderRunsList(doc, model, { checked = new Set(), selecting = false, lineFrom = null, emptyText = 'No runs yet.', note = '',
  loading = false, offline = false, retry = false, emptyByShow = SHOW_EMPTY, loadingText = RUNS_LOADING,
  offlineText = RUNS_OFFLINE } = {}) {
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
    if (!s.collapsed) for (const r of s.rows) rows.append(renderItem(doc, r, { section: sectionWord, checked, selecting, spansProjects: model.spansProjects, lineFrom, now: model.now }));
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
