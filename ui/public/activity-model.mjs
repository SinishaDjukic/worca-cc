// ui/public/activity-model.mjs — the top bar's Activity popover (Lite: a list, no actions): what
// needs you, what is running, what is scheduled, and the Activity button's one badge. Pure: app.js
// adapts its runs (runsLiveItem / runsHistItem, plus `live`) and GET /api/schedules into the plain
// inputs below; nothing here reads the DOM, fetches or keeps state.
//
// Needs you is EXACTLY the Runs badge's rule (runs-list.mjs needsYouItems, which countNeedsYou
// counts), so the amber number on Activity and the one on Runs can never differ; Running is the
// sidebar's live runs (app.js liveRuns(): workspace scans and agent jobs too) less those.
//
// Inputs: `live` = the Runs list's live items { runId, pipelineId, title, status, ask, unread, … }
// (overviewRuns), `history` = History rows { id, projectKey, title, status, … }, `active` = the same
// item shape for every run liveRuns() holds; tickets and series as GET /api/schedules sends them.
// Row: { kind: 'run'|'ticket'|'series', key, href, title, time, sub, tone: 'need'|'run'|'idle' }.
import { needsYouItems, liveRow, histRow, cmpNeeds } from './runs-list.mjs';
import { zonedParts, formatInstant } from '../../src/shared/schedule/recurrence.mjs';

export const ACTIVITY_TABS = Object.freeze(['needs', 'running', 'scheduled']);
export const TAB_LABELS = Object.freeze({ needs: 'Needs you', running: 'Running', scheduled: 'Scheduled' });
export const TAB_EMPTY = Object.freeze({ needs: 'Nothing needs you', running: 'Nothing running', scheduled: 'Nothing scheduled' });
/** Scheduled groups, top to bottom. */
export const SCHED_GROUPS = Object.freeze([
  ['missed', 'Missed'], ['today', 'Today'], ['tomorrow', 'Tomorrow'], ['week', 'This week'], ['later', 'Later'], ['after', 'After a run'],
]);

const DAY_MS = 86400000;
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const pad2 = (n) => String(n).padStart(2, '0');

/** Needs you (the Runs badge's items) and Running (the live runs that are not among them). */
function splitRuns({ live = [], history = [], active = [] } = {}) {
  const needs = needsYouItems({ live, history });
  const asking = new Set(needs.live.map((it) => it.runId));
  return { needs, running: active.filter((it) => it && !asking.has(it.runId)) };
}

/** The two numbers the badge shows, from the light items app.js builds on every frame
 *  (live: { runId, pipelineId, status, ask, unread }, history: { id, status }, active: { runId }). */
export function activityCounts(src = {}) {
  const { needs, running } = splitRuns(src);
  return { needs: needs.live.length + needs.history.length, running: running.length };
}

/** The button's badge: amber Needs you, else the running count, else hidden (n 0). */
export function badgeState({ needs = 0, running = 0 } = {}) {
  const title = needs || running ? `${needs} need${needs === 1 ? 's' : ''} you · ${running} running` : '';
  if (needs > 0) return { tone: 'need', n: needs, title };
  if (running > 0) return { tone: 'run', n: running, title };
  return { tone: '', n: 0, title };
}

/** The tab the popover opens on: the first with rows, else Needs you (a count not loaded yet is null). */
export function firstTab(counts = {}) {
  return ACTIVITY_TABS.find((t) => counts[t] > 0) || 'needs';
}

/** Civil day number, weekday (0 = Sunday) and "HH:MM" of an instant in `tz` (undefined = the browser's). */
function civil(ms, tz) {
  const p = zonedParts(ms, tz);
  const day = Date.UTC(p.y, p.m - 1, p.d);
  return { day: day / DAY_MS, dow: new Date(day).getUTCDay(), clock: `${pad2(p.hh)}:${pad2(p.mm)}` };
}

/** A scheduled row's time: "Fri 02:00" within six days of today, else "Mon Oct 19, 06:00" (formatInstant). */
export function schedTime(ms, now = Date.now(), tz = undefined) {
  if (!Number.isFinite(ms)) return '';
  const a = civil(ms, tz);
  return Math.abs(a.day - civil(now, tz).day) <= 6 ? `${WD[a.dow]} ${a.clock}` : formatInstant(ms, tz);
}

/** The day group of a start: today (overdue included), tomorrow, the rest of this week (weeks start
 *  on Monday), else later. */
export function schedDayGroup(ms, now = Date.now(), tz = undefined) {
  const a = civil(ms, tz);
  const n = civil(now, tz);
  const diff = a.day - n.day;
  if (diff <= 0) return 'today';
  if (diff === 1) return 'tomorrow';
  return diff <= 6 - ((n.dow + 6) % 7) ? 'week' : 'later';
}

function runRow(r, tone) {
  return {
    kind: 'run', key: r.key, href: r.href, title: r.title, time: r.time, tone,
    sub: [r.groupName, r.word, tone === 'run' ? r.detail : ''].filter(Boolean).join(' · '),
  };
}

// A one-off ticket: a missed one under Missed, an after-ticket (its runAt is a far-future sentinel)
// under After a run, else by its start. The Schedules tab that lists it is Once.
function ticketRow(t, place, now, tz) {
  const missed = t.status === 'missed';
  const at = t.after ? NaN : Date.parse(t.runAt);
  return {
    kind: 'ticket', key: `ticket:${t.id}`, href: '#schedules/once', title: String(t.title || 'Scheduled run'),
    time: t.after ? (missed ? '' : 'Waiting') : schedTime(at, now, tz),
    sub: [place, t.after ? `After ‘${t.after.title || 'the run before it'}’` : 'Once'].filter(Boolean).join(' · '),
    tone: missed ? 'need' : 'idle',
    group: missed ? 'missed' : t.after ? 'after' : schedDayGroup(at, now, tz), sortMs: at,
  };
}

// A series by its next start; a paused one (no next start) last under Later.
function seriesRow(s, place, now, tz) {
  const paused = s.status === 'paused';
  const at = paused ? NaN : Date.parse(s.nextRunAt || '');
  return {
    kind: 'series', key: `series:${s.id}`, href: '#schedules/repeating', title: String(s.title || 'Repeating schedule'),
    time: paused ? 'Paused' : schedTime(at, now, tz),
    sub: [place, s.sentence].filter(Boolean).join(' · '),
    tone: 'idle',
    group: Number.isFinite(at) ? schedDayGroup(at, now, tz) : 'later', sortMs: at,
  };
}

/** Scheduled: one-off tickets still to start or missed, and active or paused series (a series stands
 *  for its own occurrences). Before the first load (null inputs) nothing is known: loaded false. */
function scheduledGroups(tickets, schedules, { now, tz, placeOf }) {
  if (!Array.isArray(tickets) || !Array.isArray(schedules)) return { loaded: false, total: 0, groups: [] };
  const rows = [
    ...tickets.filter((t) => t && !t.scheduleId && (t.status === 'scheduled' || t.status === 'missed'))
      .map((t) => ticketRow(t, placeOf(t), now, tz)),
    ...schedules.filter((s) => s && (s.status === 'active' || s.status === 'paused'))
      .map((s) => seriesRow(s, placeOf(s), now, tz)),
  ];
  const at = (r) => (Number.isFinite(r.sortMs) ? r.sortMs : Infinity);
  const byTime = (a, b) => (at(a) === at(b) ? 0 : at(a) - at(b));
  const groups = SCHED_GROUPS
    .map(([id, label]) => ({ id, label, rows: rows.filter((r) => r.group === id).sort(byTime) }))
    .filter((g) => g.rows.length);
  return { loaded: true, total: rows.length, groups };
}

/**
 * The popover's model: { needs: Row[], running: Row[], scheduled: { loaded, total, groups: [{ id, label,
 * rows }] }, counts: { needs, running, scheduled } }. Every count is the number of rows listed;
 * scheduled is null until the schedules are loaded.
 */
export function activityModel({
  live = [], history = [], active = [], tickets = null, schedules = null, now = Date.now(), tz = undefined,
  placeOf = (x) => x.projectKey || '',
} = {}) {
  const { needs, running } = splitRuns({ live, history, active });
  const needRows = [...needs.live.map((it) => liveRow(it, now)), ...needs.history.map((p) => histRow(p, now))]
    .sort(cmpNeeds).map((r) => runRow(r, 'need'));
  const runRows = running.map((it) => runRow(liveRow(it, now), 'run'));
  const scheduled = scheduledGroups(tickets, schedules, { now, tz, placeOf });
  return {
    needs: needRows, running: runRows, scheduled,
    counts: { needs: needRows.length, running: runRows.length, scheduled: scheduled.loaded ? scheduled.total : null },
  };
}
