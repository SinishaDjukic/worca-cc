// ui/public/runs-list.mjs — the Runs list: one compact list of live, scheduled and finished
// runs, grouped by project, with a "Needs you" group on top. Pure: app.js adapts the run
// model, the History rows and the schedule tickets into the plain items below; every
// DOM builder takes a `doc`, so jsdom tests drive this module without app.js.
//
// Item shapes (the adapters live in app.js: runsLiveItem / runsHistItem / runsSchedItem):
//   live:  { runId, pipelineId, title, status, ask: {kind, step}|null, pauseReason, unread,
//            step, failedStep, startedAt, groupKey, groupName, by, pr, checks, files, tags, retained,
//            progress: {fraction, tone}|null }
//   hist:  { id, projectKey, title, status, pauseReason, startedAt, mtime, groupName, by,
//            pr (a glance input: glancePrInput's output), checks, files,
//            archived, archivedAt (archived-feed rows only), tags, retained }
//   sched: { id, scheduleId, title (may be null), status, after, queued, retryAt, runAt, groupKey, groupName, by }
//   chain: { id, title, members[], total, index, fraction, tone, text, groupKey, groupName, open }
import { glanceCopy } from './run-glance.mjs';
import { renderRowLine } from './run-progress-bar.mjs';
import { engineLabel } from '../../src/shared/engine-switch.mjs';
import { archiveBlock, ENDED as ENDED_ICONS, rowMenuItems, SKIP_WORDS } from './runs-archive.mjs';

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

const DONE = new Set(['done', 'complete', 'completed']);
const FAILED = new Set(['error', 'failed']);
const STOPPED = new Set(['stopped', 'aborted']);
const PARKED = new Set(['paused', 'pausing', 'interrupted']);
// A pause names its cause, like statusPill ("Paused · cost limit") but short enough for a row.
const PAUSE_WORDS = Object.freeze({
  cost_pipeline: 'Cost limit', cost_total: 'Total budget', cost_pipeline_policy: 'Team cap',
  cost_total_policy: 'Team total', usage_limit: 'Usage limit', drain: 'Restart',
  error: 'Error', recoverable: 'Error', night_guardrail: 'Away limit',
});
// #724: what a Needs-you pause asks of the person — the subline's tail.
const PAUSE_HINTS = Object.freeze({
  cost_pipeline: 'resume or raise it', cost_total: 'resume or raise it',
  cost_pipeline_policy: 'an admin can raise it', cost_total_policy: 'an admin can raise it',
  error: 'resume to retry', recoverable: 'resume to retry',
});
const clock = (ms) => { const d = new Date(ms); return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`; };
// Search words per icon, beyond the row's own word: "paused" finds a cost-limit pause too.
const STATE_TERMS = Object.freeze({
  ask: 'waiting question review', paused: 'paused', fail: 'failed error', stop: 'stopped',
  run: 'running', start: 'starting running', done: 'done finished', scheduled: 'scheduled',
});

/** `limitEngine`: a usage limit an engine hit names that engine ("Codex usage limit").
 *  `limitNote`: when that limit resets ("resets 18:00"). `resumeAt`: the booked resume (epoch ms). */
function parkedState(s, { pauseReason = '', limitEngine = null, limitNote = '', resumeAt = null, ask = null } = {}) {
  if (s === 'pausing') return { icon: 'paused', word: 'Pausing', detail: '', hint: '' };
  if (s === 'interrupted') return { icon: 'paused', word: 'Interrupted', detail: '', hint: 'resume it' };
  const limit = limitEngine ? `${engineLabel(limitEngine)} usage limit` : 'Usage limit';
  const auto = autoParked(pauseReason, resumeAt);
  // D19: a question still open on a manual pause is what the person must do.
  if (auto === 'you') return { icon: 'paused', word: 'Paused by you', detail: '', hint: ask && typeof ask === 'object' ? askWord(ask) : '' };
  if (auto === 'resumes') return { icon: 'paused', word: `Resumes at ${clock(resumeAt)}`, detail: limitEngine ? limit : 'usage limit', hint: '' };
  if (pauseReason === 'usage_limit') return { icon: 'paused', word: limit, detail: limitNote || '', hint: limitNote || 'resume when it resets' };
  return { icon: 'paused', word: PAUSE_WORDS[pauseReason] || 'Paused', detail: '', hint: PAUSE_HINTS[pauseReason] || 'resume it' };
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
  const n = Number(ask && ask.count) || 0;
  if (n > 0) return `Answer ${n} question${n === 1 ? '' : 's'}`;
  if (kind === 'form') return step ? `${step} question` : 'Input needed';
  return step ? `${step} question` : 'Question';
}

/** A finished run's word: exactly the glance headline (run-glance.mjs glanceCopy, done branch). */
function doneWord({ pr = null, checks = null, files = null } = {}) {
  return glanceCopy({ status: 'done', steps: [] }, { pr, checks, files }).lead;
}

/** A live run's row: { icon, word, detail }. Branch order mirrors app.js statusPill:
 *  parked-ness outranks a question, a question outranks the raw terminal status. */
export function liveRowState(it) {
  const s = String((it && it.status) || '').toLowerCase();
  if (PARKED.has(s)) return parkedState(s, it);
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
  if (PARKED.has(s)) st = parkedState(s, p);
  else if (FAILED.has(s)) st = { icon: 'fail', word: 'Failed', detail: '' };
  else if (STOPPED.has(s)) st = { icon: 'stop', word: 'Stopped', detail: '' };
  else if (DONE.has(s)) st = { icon: 'done', word: doneWord(p), detail: '' };
  else if (s === 'running' || s === 'starting' || s === 'created') st = { icon: 'run', word: 'Running', detail: '' };
  else st = { icon: 'stop', word: s ? `${s.charAt(0).toUpperCase()}${s.slice(1)}` : 'Unknown', detail: '' };
  // An archived run keeps its terminal icon (it did finish that way) but its word says
  // where it lives now — the glance headline ("Merged") would hide the soft delete.
  if (p && p.archived) st = { ...st, word: 'Archived', detail: '', hint: '' };
  return st;
}

/** A schedule ticket's state, in schedules-view.mjs ticketRow's order: missed, firing, chained
 *  after another run, queued behind the previous run, retrying, else due. */
export function schedRowState(t) {
  const s = String((t && t.status) || '');
  if (s === 'missed') return { icon: 'scheduled', word: 'Missed', detail: '' };
  if (s === 'firing') return { icon: 'start', word: 'Starting', detail: '' };
  const word = t && t.after ? 'Waiting' : t && t.queued ? 'Queued' : t && t.retryAt ? 'Retrying' : 'Scheduled';
  const detail = t && t.after ? `after ${t.after.title || 'another run'}` : '';
  return { icon: 'scheduled', word, detail };
}

/** Needs you (#724): only a person can move the run on. An open question or approval; a pause that will
 *  not lift by itself — every pause reason except a manual one (no reason recorded) and a usage limit
 *  with a resume booked (`resumeAt`, the open resume ticket's time); an interrupted run; a failed run
 *  nobody opened yet. A schedule ticket never needs you. */
export function needsYou({ kind = 'live', status = '', ask = false, unread = false, pauseReason = '', resumeAt = null } = {}) {
  if (kind === 'sched') return false;
  const s = String(status || '').toLowerCase();
  if (s === 'pausing') return false;
  if (ask && kind === 'live') return true;
  if (s === 'interrupted') return true;
  if (s === 'paused') return autoParked(pauseReason, resumeAt) === null;
  return kind === 'live' && !!unread && FAILED.has(s);
}

/** A pause that needs nobody: 'you' (a manual pause) or 'resumes' (usage limit, resume booked); else null. */
function autoParked(pauseReason, resumeAt) {
  if (!pauseReason) return 'you';
  return pauseReason === 'usage_limit' && Number.isFinite(resumeAt) ? 'resumes' : null;
}

const needsOf = (kind, r) => needsYou({
  kind, status: r.status, ask: !!r.ask, unread: !!r.unread, pauseReason: r.pauseReason || '', resumeAt: r.resumeAt ?? null,
});

/** The items Needs you holds: live items that need you, and History rows that do whose run is not
 *  listed live. countNeedsYou counts exactly these; the top bar's Activity lists them. */
export function needsYouItems({ live = [], history = [] } = {}) {
  const pids = new Set(live.map((r) => r && r.pipelineId).filter(Boolean));
  return {
    live: live.filter((r) => r && needsOf('live', r)),
    history: history.filter((p) => p && !pids.has(p.id) && needsOf('hist', p)),
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
    groupKey: String(it.groupKey || ''), groupName: String(it.groupName || ''), by: String(it.by || ''),
    tags: Array.isArray(it.tags) ? it.tags.map(String) : [],
    retained: !!it.retained,
    unread: !!it.unread, needs: needsOf('live', it), resumeAt: it.resumeAt ?? null,
    resumes: status === 'paused' && autoParked(it.pauseReason, it.resumeAt ?? null) === 'resumes',
    progress: it.progress || null,
  }, { at: it.startedAt }, now);
}

/** P8: a "Run after" chain as ONE row: the first run's title, "Run 2 of 3 · Build", one overall line. */
export function chainRow(c, now = Date.now()) {
  const members = Array.isArray(c.members) ? c.members : [];
  const cur = members.find((m) => m.state === 'current') || members.find((m) => m.state === 'waiting') || members[0] || null;
  // The current member's glyph (runsChainItem sets it from the live run: ask | paused | run); a chain
  // that only waits shows the scheduled clock. Every value is an icon rowDot() reads.
  const icon = cur && cur.state === 'current' ? (cur.icon || 'run') : cur && cur.state === 'waiting' ? 'scheduled' : 'run';
  // D17: a chain that is a feature opens the feature page.
  const feature = c.feature && c.feature.id ? { id: String(c.feature.id) } : null;
  return {
    kind: 'chain', key: `chain:${c.id}`,
    href: feature ? String(c.href || `#feature/${encodeURIComponent(feature.id)}`) : (cur && cur.href) || '#runs',
    runId: (cur && cur.runId) || '', pipelineId: (cur && cur.pipelineId) || '', projectKey: '',
    title: String(c.title || '(untitled)'), status: 'running', icon, word: String(c.text || ''), detail: '',
    groupKey: String(c.groupKey || ''), groupName: String(c.groupName || ''), by: '',
    unread: false, needs: false, time: '', sortMs: now, open: !!c.open,
    progress: { fraction: c.fraction || 0, tone: c.tone || 'blue' },
    feature,
    members,
    memberKeys: new Set(members.flatMap((m) => [m.pipelineId && `p:${m.pipelineId}`, m.ticketId && `t:${m.ticketId}`, m.runId && `r:${m.runId}`]).filter(Boolean)),
  };
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
    groupKey: key, groupName: String(p.groupName || key || '(unknown project)'), by: String(p.by || ''),
    tags: Array.isArray(p.tags) ? p.tags.map(String) : [],
    retained: !!p.retained,
    archived: !!(p && p.archived),
    base: String(p.base || ''),                      // #620: "conflicts with dev" / "dev moved", else ''
    unread: false, needs: !p.archived && needsOf('hist', p), resumeAt: p.resumeAt ?? null,
    resumes: status === 'paused' && autoParked(p.pauseReason, p.resumeAt ?? null) === 'resumes',
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
  }, t.after ? { at: now, time: '' } : { at: t.runAt }, now);   // an after-ticket's runAt is a far-future sentinel
}

/** Every whitespace-separated word of `query` appears in the row (case-insensitive). */
export function rowMatches(row, query) {
  const words = String(query || '').toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const hay = [row.title, row.groupName, row.word, row.detail, row.base || '', (row.tags || []).join(' '), STATE_TERMS[row.icon] || '', row.needs ? 'needs you' : '']
    .join(' ').toLowerCase();
  return words.every((w) => hay.includes(w));
}

/** "<state> · <the one thing that matters>" (#724). On a Needs-you row the tail is the action it asks
 *  for ("resume or raise it"), or the time of an unread failure. `project` joins the line wherever no
 *  project header sits above the row. Under a date bucket the time stays only where the header does not
 *  already pin the day (Yesterday drops it) and the run is not live. */
export function rowSub(row, { bucket = '', project = '' } = {}) {
  const word = row.base ? `${row.word} · ${row.base}` : row.word;   // #620: the base-check note rides the word
  let tail;
  if (row.needs) tail = row.hint || (row.icon === 'fail' ? row.time : '');
  else if (bucket) {
    // A live row is happening now: its start time would only push the line onto two.
    const time = bucket === 'yesterday' || row.kind === 'live' ? '' : (row.kind === 'hist' ? rowTime(row.activityMs, row.nowMs) : row.time);
    tail = [row.detail, time].filter(Boolean).join(' · ');
  } else tail = row.detail || row.time;
  return [word, tail, project].filter(Boolean).join(' · ');
}

/** What the list shows (#724): Active (Needs you · Running · Recent), Finished (the full history),
 *  Archived (the soft-deleted feed, a separate lazy-loaded array; the flag is the belt-and-braces check). */
export const RUNS_FILTERS = Object.freeze(['active', 'finished', 'archived']);
/** A stored or passed filter, legacy values included ('all' / 'live' / 'needs' were the four-way bar), as one of RUNS_FILTERS. */
export function normalizeRunsFilter(f) { return RUNS_FILTERS.includes(f) ? f : 'active'; }
/** Recent keeps runs that finished in the last RECENT_DAYS; older ones are behind "Show older" (Finished). */
export const RECENT_DAYS = 7;
const SECTION_NAMES = Object.freeze({ needs: 'Needs you', running: 'Running', recent: 'Recent' });
// A run ended: its icon says so. A History row that is paused, interrupted or still running has not.
const isFinishedRow = (r) => (r.kind === 'hist' || r.kind === 'live') && ENDED_ICONS.has(r.icon);
export function rowInFilter(row, filter) {
  if (filter === 'archived') return !!row.archived;
  if (filter === 'finished') return isFinishedRow(row);
  return true;
}
const FILTER_EMPTY = Object.freeze({ finished: 'No finished runs yet.', archived: 'No archived runs.' });
// A finished row's time for Recent: its last activity; a live row that just ended is "now".
const finishedAt = (r, now) => (Number.isFinite(r.activityMs) ? r.activityMs : now);

/** The row's status dot (#724 polish): needs (amber), work (peach, pulsing), paused (grey), wait (hollow
 *  ring: a ticket, a chain that only waits, a booked resume), done (green), fail (red), stop (grey). */
export function rowDot(row) {
  if (row.needs) return 'needs';
  if (row.kind === 'sched' || row.icon === 'scheduled' || row.resumes) return 'wait';
  if (row.icon === 'paused') return 'paused';
  if (row.icon === 'run' || row.icon === 'start' || row.icon === 'ask') return 'work';
  return row.icon === 'done' ? 'done' : row.icon === 'fail' ? 'fail' : 'stop';
}
const isDim = (r) => { const d = rowDot(r); return d === 'paused' || d === 'wait'; };

/** "Group by" for the list: per project/workspace (the default), or by when the run last moved. */
export const RUNS_GROUPINGS = Object.freeze(['project', 'date']);
/** The View menu's two choices (#740): Show (RUNS_FILTERS) and Group by (RUNS_GROUPINGS). */
export const DEFAULT_RUNS_VIEW = Object.freeze({ show: 'active', groupBy: 'project' });
const SHOW_LABELS = Object.freeze({ active: 'Active', finished: 'Finished', archived: 'Archived' });
/** A stored or passed view as known values; a legacy filter ('all' / 'live' / 'needs') reads as Active. */
export function normalizeRunsView({ show, groupBy } = {}) {
  return { show: normalizeRunsFilter(show), groupBy: RUNS_GROUPINGS.includes(groupBy) ? groupBy : DEFAULT_RUNS_VIEW.groupBy };
}
/** The chip under the header: null for the default view, else "Finished · by date". */
export function viewChip(view) {
  const { show, groupBy } = normalizeRunsView(view);
  if (show === DEFAULT_RUNS_VIEW.show && groupBy === DEFAULT_RUNS_VIEW.groupBy) return null;
  return `${SHOW_LABELS[show]} · by ${groupBy}`;
}
/** Date sections, top to bottom. Live rows are happening now (Today); a scheduled run is
 *  Upcoming; a History row files under its last activity (finish time, else start). The
 *  boundaries are local midnights, stepped with setDate so a DST day is still one day. */
export const DATE_BUCKETS = Object.freeze([
  ['upcoming', 'Upcoming'], ['today', 'Today'], ['yesterday', 'Yesterday'],
  ['week', 'Previous 7 days'], ['older', 'Older'],
]);
export function dateBucket(row, now = Date.now()) {
  if (row.kind === 'sched') return 'upcoming';
  const t = row.kind === 'live' || row.kind === 'chain' ? now : row.activityMs;
  if (!Number.isFinite(t)) return 'older';
  const day = new Date(now);
  day.setHours(0, 0, 0, 0);
  if (t >= day.getTime()) return 'today';
  day.setDate(day.getDate() - 1);
  if (t >= day.getTime()) return 'yesterday';
  day.setDate(day.getDate() - 6);
  return t >= day.getTime() ? 'week' : 'older';
}
const KIND_RANK = Object.freeze({ live: 0, chain: 0, sched: 1, hist: 2 });
const cmpDateRows = (a, b) => ((KIND_RANK[a.kind] ?? 3) - (KIND_RANK[b.kind] ?? 3))
  || (a.kind === 'hist' ? (b.activityMs || 0) - (a.activityMs || 0) : 0);

const NEEDS_RANK = Object.freeze({ ask: 0, paused: 1, fail: 2 });
export const cmpNeeds = (a, b) => ((NEEDS_RANK[a.needsIcon || a.icon] ?? 3) - (NEEDS_RANK[b.needsIcon || b.icon] ?? 3)) || ((b.sortMs || 0) - (a.sortMs || 0));

/** One section's rows as display groups. `mode`: 'project' (a header per project), 'date' (DATE_BUCKETS), 'flat'
 *  (one header-less group). `prefix` scopes fold keys to the section in Active ("running/<project key>"). */
function groupRows(rows, { mode, prefix, collapsed, searching, now }) {
  const fold = (key) => !searching && collapsed.has(key);
  if (mode === 'flat') return rows.length ? [{ key: `${prefix}all`, name: '', head: false, count: rows.length, collapsed: false, rows }] : [];
  if (mode === 'date') {
    const buckets = new Map(DATE_BUCKETS.map(([id]) => [id, []]));
    for (const r of rows) buckets.get(dateBucket(r, now)).push(r);
    return DATE_BUCKETS.filter(([id]) => buckets.get(id).length).map(([id, name]) => {
      const list = buckets.get(id).sort(cmpDateRows).map((r) => ({ ...r, nowMs: now }));
      const key = `${prefix}date:${id}`;
      return { key, name, bucket: id, head: true, count: list.length, collapsed: fold(key), rows: list };
    });
  }
  const groups = new Map();
  for (const r of rows) {
    let g = groups.get(r.groupKey);
    if (!g) { g = { projectKey: r.groupKey, name: r.groupName || '(unknown project)', rows: [], live: false, latest: -Infinity }; groups.set(r.groupKey, g); }
    g.rows.push(r);
    if (r.kind === 'live' || r.kind === 'chain') g.live = true;
    const t = Math.min(Number.isFinite(r.sortMs) ? r.sortMs : -Infinity, now);   // a future runAt counts as now
    if (t > g.latest) g.latest = t;
  }
  return [...groups.values()]
    .sort((a, b) => (Number(b.live) - Number(a.live)) || (b.latest - a.latest) || a.name.localeCompare(b.name))
    .map((g) => { const key = `${prefix}${g.projectKey}`; return { key, projectKey: g.projectKey, name: g.name, head: true, count: g.rows.length, collapsed: fold(key), rows: g.rows }; });
}

/**
 * The list model (#724): { sections: [{ key, name, count, groups, older }], groups, needs, total, older, searching, filter, groupBy }.
 * Active: Needs you (only when not empty), Running (live runs, then the dimmed paused-by-you, resuming and waiting
 * ones), Recent (finished in the last RECENT_DAYS, newest first; `older` counts the rest). Every row appears in
 * exactly one section. Finished / Archived: one untitled section. Group by (clarify answer 2): 'project' adds
 * project headers in every section when the listed rows span more than one project; 'date' buckets Recent,
 * Finished and Archived, and leaves Needs you and Running flat.
 * Live rows arrive in cmpTabRuns order and History rows newest first. A History row whose run is listed live is
 * dropped (the live row stands for it), and so is a schedule ticket whose run is (a firing ticket's id IS its runId),
 * and a booked resume ticket whose run is listed (that run's row reads "Resumes at").
 */
export function buildRunsModel({
  live = [], history = [], scheduled = [], chains = [], person = '', query = '', filter = 'active', groupBy = 'project', collapsed = new Set(), now = Date.now(),
} = {}) {
  const shown = normalizeRunsFilter(filter);
  const byDate = groupBy === 'date';
  const liveRows = live.map((it) => liveRow(it, now));
  const listed = new Set(liveRows.map((r) => r.pipelineId).filter(Boolean));
  const liveIds = new Set(liveRows.map((r) => r.runId));
  const histRows = history.filter((p) => p && p.id && !listed.has(String(p.id))).map((p) => histRow(p, now));
  const runIds = new Set([...listed, ...histRows.map((r) => r.pipelineId)]);
  const schedRows = scheduled
    .filter((t) => t && !liveIds.has(String(t.id)) && !(!t.scheduleId && t.resumePipelineId && runIds.has(String(t.resumePipelineId))))
    .map((t) => schedRow(t, now));
  const all = [...liveRows, ...schedRows, ...histRows]
    .filter((r) => (!person || r.by === person) && rowMatches(r, query) && rowInFilter(r, shown));
  const chainRows = chains.map((c) => chainRow(c, now));
  // D17: a feature row needs you exactly when a row it claims does (the same needsYou() rule as the member rows), so
  // nothing is dropped or invented. `needsIcon` (the needy member's icon) lets cmpNeeds order it like that row; the
  // row's own `icon` stays the current member's.
  const featureOf = (r) => chainRows.find((c) => c.feature && rowChainKeys(r).some((k) => c.memberKeys.has(k))) || null;
  for (const r of all) {
    const c = r.needs ? featureOf(r) : null;
    if (c && (!c.needs || (NEEDS_RANK[r.icon] ?? 3) < (NEEDS_RANK[c.needsIcon] ?? 3))) { c.needs = true; c.needsIcon = r.icon; }
  }
  const placed = new Set();
  const placedRows = [];
  for (const r of all) {
    const c = chainRows.find((x) => rowChainKeys(r).some((k) => x.memberKeys.has(k)));
    if (!c) { placedRows.push(r); continue; }
    if (placed.has(c.key)) continue;
    placed.add(c.key);
    // The chain sits where its first listed member sat (that row passed the person/search/filter checks).
    placedRows.push({ ...c, groupKey: c.groupKey || r.groupKey, groupName: c.groupName || r.groupName, sortMs: r.sortMs });
  }
  const searching = !!String(query || '').trim();
  const base = { searching, filter: shown, groupBy: byDate ? 'date' : 'project' };
  const multi = new Set(placedRows.map((r) => r.groupKey)).size > 1;
  const opts = (prefix) => ({ prefix, collapsed, searching, now });
  if (shown !== 'active') {
    const groups = groupRows(placedRows, { mode: byDate ? 'date' : multi ? 'project' : 'flat', ...opts('') });
    const sections = placedRows.length ? [{ key: shown, name: '', count: placedRows.length, groups, older: 0 }] : [];
    return { ...base, sections, groups, needs: [], total: placedRows.length, older: 0 };
  }
  // Needs you lists the member rows, not the chain row that folds them (a question never hides behind an expander),
  // except a feature's: its member rows are left out and the placed feature row stands for them. Computed from the
  // pre-fold list (`all`): see .claude/rules/worca/project/runs-list-needs-before-collapse.md.
  const needs = [
    ...all.filter((r) => r.needs && !featureOf(r)),
    ...placedRows.filter((r) => r.kind === 'chain' && r.feature && r.needs),
  ].sort(cmpNeeds);
  const inNeeds = new Set(needs.map((r) => r.key));
  const cutoff = now - RECENT_DAYS * DAY_MS;
  const running = [];
  const recent = [];
  let older = 0;
  for (const r of placedRows) {
    if (inNeeds.has(r.key)) continue;                         // each run once (#724)
    if (!isFinishedRow(r)) running.push(r);
    else if (finishedAt(r, now) >= cutoff) recent.push(r);
    else older += 1;
  }
  running.sort((a, b) => Number(isDim(a)) - Number(isDim(b)));   // stable: live first, then the dimmed ones
  recent.sort((a, b) => finishedAt(b, now) - finishedAt(a, now));
  const anyMulti = multi || new Set(needs.map((r) => r.groupKey).concat(placedRows.map((r) => r.groupKey))).size > 1;
  const mode = (key) => (byDate ? (key === 'recent' ? 'date' : 'flat') : anyMulti ? 'project' : 'flat');
  const sections = [['needs', needs], ['running', running], ['recent', recent]]
    .filter(([key, rows]) => rows.length || (key === 'recent' && older))
    .map(([key, rows]) => ({ key, name: SECTION_NAMES[key], count: rows.length, older: key === 'recent' ? older : 0,
      groups: groupRows(rows, { mode: mode(key), ...opts(`${key}/`) }) }));
  return { ...base, sections, groups: sections.flatMap((s) => s.groups), needs, total: needs.length + running.length + recent.length, older };
}

/** Is `row` the run the pane shows? `sel` = { runId, pipelineId, histKey: "<projectKey>/<id>" }. */
export function isRowSelected(row, sel) {
  if (!sel || row.kind === 'sched') return false;
  if (row.kind === 'chain') return !!((sel.pipelineId && row.memberKeys.has(`p:${sel.pipelineId}`)) || (sel.runId && row.memberKeys.has(`r:${sel.runId}`)));
  if (sel.runId && row.runId === sel.runId) return true;
  if (sel.histKey && row.kind === 'hist' && `${row.projectKey}/${row.pipelineId}` === sel.histKey) return true;
  return !!sel.pipelineId && row.pipelineId === sel.pipelineId;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
function svg(doc, tag, attrs) {
  const n = doc.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
  return n;
}
function textEl(doc, tag, cls, text) {
  const n = doc.createElement(tag);
  n.className = cls;
  n.textContent = text;
  return n;
}

function renderRow(doc, r, { inNeeds = false, bucket = '', project = '', lineFrom = null } = {}) {
  const a = doc.createElement('a');
  a.className = `runs-row runs-row-${r.kind}${isDim(r) ? ' is-dim' : ''}`;
  a.setAttribute('href', r.href);
  a.dataset.rowKey = r.key;
  a.dataset.slot = inNeeds ? 'needs' : 'group';   // #724: each run is listed once; the slot names its section kind
  a.dataset.kind = r.kind;
  a.dataset.icon = r.icon;                          // 'ask': the click lands the pane on its question
  if (r.runId) a.dataset.runId = r.runId;
  if (r.pipelineId) a.dataset.pipelineId = r.pipelineId;
  if (r.projectKey) a.dataset.projectKey = r.projectKey;
  if (r.memberKeys) a.dataset.memberKeys = [...r.memberKeys].join(' ');   // a chain row: paintRunsSelection rebuilds the set from it
  const ic = doc.createElement('span');
  ic.className = `runs-ic runs-ic-${r.icon}`;     // the family class stays (tests and focus code read it)
  ic.dataset.dot = rowDot(r);
  ic.setAttribute('aria-hidden', 'true');
  const body = doc.createElement('span');
  body.className = 'runs-row-body';
  body.append(textEl(doc, 'span', 'runs-row-title', r.title), textEl(doc, 'span', 'runs-row-sub', rowSub(r, { bucket, project })));
  // P7: the thin line, only while the run is live (an ended live row and every History row have none).
  // `lineFrom` (paintRunsList): the width this row's line had before the rebuild, so it glides on.
  if (r.progress && (r.kind === 'live' || r.kind === 'chain') && !ENDED_ICONS.has(r.icon)) {
    body.appendChild(renderRowLine(doc, r.progress, (lineFrom && lineFrom.get(r.key)) || ''));
  }
  a.append(ic, body);
  return a;
}

/** A row with a ⋯ menu, or any row while selecting (#739): a wrapper holding the row's <a> and either
 *  the ⋯ button (a sibling, never inside the link) or a leading checkbox. Otherwise the bare row. */
function renderItem(doc, r, opts, selecting) {
  const a = renderRow(doc, r, opts);
  if (!selecting && !rowMenuItems(r).length) return a;
  const wrap = doc.createElement('div');
  wrap.className = selecting ? 'runs-item is-selecting' : 'runs-item';
  wrap.dataset.rowKey = r.key;
  if (selecting) {
    const why = archiveBlock(r);
    const box = doc.createElement('input');
    box.type = 'checkbox';
    box.className = 'runs-row-check';
    box.dataset.rowKey = r.key;
    box.checked = selecting.has(r.key);
    box.disabled = !!why;
    box.setAttribute('aria-label', why ? `${r.title}: can't archive, ${SKIP_WORDS[why]}` : `Select ${r.title}`);
    if (why) box.title = `Can't archive: ${SKIP_WORDS[why]}`;
    wrap.append(box, a);
    return wrap;
  }
  const more = doc.createElement('button');
  more.type = 'button';
  more.className = 'runs-row-more';
  more.dataset.rowKey = r.key;
  more.setAttribute('aria-haspopup', 'menu');
  more.setAttribute('aria-expanded', 'false');
  more.setAttribute('aria-controls', 'runs-row-menu');
  more.setAttribute('aria-label', `More actions for ${r.title}`);
  more.textContent = '⋯';
  wrap.append(a, more);
  return wrap;
}

const MEMBER_GLYPH = Object.freeze({ done: '✓', current: '●', waiting: '○', failed: '✕' });
function renderChainRow(doc, r, opts) {
  const wrap = doc.createElement('div');
  wrap.className = 'runs-chain';
  wrap.dataset.chainKey = r.key;
  const toggle = doc.createElement('button');
  toggle.type = 'button';
  toggle.className = 'runs-chain-toggle';
  toggle.dataset.chainKey = r.key;
  toggle.setAttribute('aria-expanded', r.open ? 'true' : 'false');
  if (r.feature) toggle.dataset.feature = '1';
  toggle.setAttribute('aria-label', `${r.open ? 'Hide' : 'Show'} the ${r.members.length} ${r.feature ? 'slices in this feature' : 'runs in this chain'}`);
  toggle.appendChild(chevron(doc));
  const list = doc.createElement('ol');
  list.className = 'runs-chain-members';
  list.hidden = !r.open;
  if (r.open) {
    // The row itself toggles the group (a plain click), so the feature page is the first item inside.
    if (r.feature) {
      const li = doc.createElement('li');
      li.className = 'runs-chain-member runs-chain-open-feature';
      const link = doc.createElement('a');
      link.className = 'runs-chain-link';
      link.setAttribute('href', r.href);
      link.textContent = 'Open feature →';
      li.appendChild(link);
      list.appendChild(li);
    }
    for (const m of r.members) {
      const li = doc.createElement('li');
      // D33: the current slice's dot: amber while it needs the person (a question waits, paused or not), blue and
      // pulsing while it works, grey while it is paused with nothing to answer.
      const dot = m.state !== 'current' ? ''
        : m.icon === 'ask' || (m.icon === 'paused' && m.asks) ? ' is-needs'
        : m.icon === 'paused' ? ' is-paused'
        : m.icon === 'run' ? ' is-live' : '';
      li.className = `runs-chain-member is-${m.state}${dot}`;
      li.append(textEl(doc, 'span', 'runs-chain-glyph', MEMBER_GLYPH[m.state] || '○'));
      const link = doc.createElement('a');
      link.className = 'runs-chain-link';
      link.setAttribute('href', m.href || '#runs');
      link.textContent = m.title || '(untitled)';
      li.appendChild(link);
      if (m.state === 'done' && m.prUrl) {
        const pr = doc.createElement('a');
        pr.className = 'runs-chain-pr';
        pr.setAttribute('href', m.prUrl);           // https-only, enforced server-side (runChains)
        pr.target = '_blank';
        pr.rel = 'noopener noreferrer';
        pr.textContent = 'PR';
        li.appendChild(pr);
      }
      list.appendChild(li);
    }
  }
  wrap.append(renderRow(doc, r, opts), toggle, list);
  return wrap;
}

function chevron(doc) {
  const s = svg(doc, 'svg', { viewBox: '0 0 24 24', width: 12, height: 12, fill: 'none', stroke: 'currentColor',
    'stroke-width': 2.6, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', class: 'runs-chev', 'aria-hidden': 'true' });
  s.appendChild(svg(doc, 'path', { d: 'M6 9l6 6 6-6' }));
  return s;
}

function renderGroup(doc, g, { searching, inNeeds, lineFrom, selecting }) {
  // No project header above the row: the project joins its subline (#724 D9).
  const rowEl = (r) => {
    const opts = { inNeeds, bucket: g.bucket || '', project: g.head && !g.bucket ? '' : r.groupName, lineFrom };
    return r.kind === 'chain' ? renderChainRow(doc, r, opts) : renderItem(doc, r, opts, selecting);
  };
  if (!g.head) return g.rows.map(rowEl);
  const sec = doc.createElement('section');
  sec.className = 'runs-group';
  sec.dataset.groupKey = g.key;
  if (g.projectKey) sec.dataset.projectKey = g.projectKey;   // "Show in Runs" finds a project by it
  const head = doc.createElement('button');
  head.type = 'button';
  head.className = 'runs-group-head';
  head.dataset.groupKey = g.key;
  head.setAttribute('aria-expanded', g.collapsed ? 'false' : 'true');
  if (searching) head.setAttribute('aria-disabled', 'true');
  head.append(chevron(doc), textEl(doc, 'span', 'runs-group-name', g.name), textEl(doc, 'span', 'runs-count', String(g.count)));
  const rows = doc.createElement('div');
  rows.className = 'runs-group-rows';
  rows.hidden = g.collapsed;
  if (!g.collapsed) rows.append(...g.rows.map(rowEl));
  sec.append(head, rows);
  return [sec];
}

/** The list's children (#724): one <section> per model section (Needs you · Running · Recent in Active, one
 *  untitled section in Finished / Archived), "Show older" at the end of Recent, then a note when empty. */
export function renderRunsList(doc, model, { emptyText = 'No runs yet.', note = '', lineFrom = null, selecting = null } = {}) {
  const out = [];
  for (const s of model.sections) {
    const sec = doc.createElement('section');
    sec.className = s.key === 'needs' ? 'runs-sec runs-needs' : `runs-sec runs-sec-${s.key}`;
    sec.dataset.section = s.key;
    if (s.name) {
      sec.setAttribute('aria-label', s.name);
      const head = doc.createElement('div');
      head.className = s.key === 'needs' ? 'runs-sec-head runs-needs-head' : 'runs-sec-head';
      head.append(textEl(doc, 'span', 'runs-sec-title', s.name), textEl(doc, 'span', 'runs-count', String(s.count)));
      sec.appendChild(head);
    }
    for (const g of s.groups) sec.append(...renderGroup(doc, g, { searching: model.searching, inNeeds: s.key === 'needs', lineFrom, selecting }));
    if (s.older) {
      const more = textEl(doc, 'button', 'runs-show-older', 'Show older');
      more.type = 'button';
      sec.appendChild(more);
    }
    out.push(sec);
  }
  if (!model.total && !model.older) {
    const empty = model.searching ? 'No runs match your search.' : (FILTER_EMPTY[model.filter] || emptyText);
    out.push(textEl(doc, 'p', 'runs-note', empty));
  }
  if (note) out.push(textEl(doc, 'p', 'runs-note runs-note-err', note));
  return out;
}
