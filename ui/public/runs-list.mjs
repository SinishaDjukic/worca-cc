// ui/public/runs-list.mjs — the Runs list: one compact list of live, scheduled and finished
// runs, grouped by project, with a "Needs you" group on top. Pure: app.js adapts the run
// model, the History rows and the schedule tickets into the plain items below; every
// DOM builder takes a `doc`, so jsdom tests drive this module without app.js.
//
// Item shapes (the adapters live in app.js: runsLiveItem / runsHistItem / runsSchedItem):
//   live:  { runId, pipelineId, title, status, ask: {kind, step}|null, pauseReason, unread,
//            step, failedStep, startedAt, groupKey, groupName, by, pr, checks, files }
//   hist:  { id, projectKey, title, status, pauseReason, startedAt, mtime, groupName, by,
//            pr (a glance input: glancePrInput's output), checks, files,
//            archived, archivedAt (archived-feed rows only) }
//   sched: { id, scheduleId, title (may be null), status, after, queued, retryAt, runAt, groupKey, groupName, by }
import { glanceCopy } from './run-glance.mjs';

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
// error / recoverable / a manual pause read plain "Paused".
const PAUSE_WORDS = Object.freeze({
  cost_pipeline: 'Cost limit', cost_total: 'Total budget', cost_pipeline_policy: 'Team cap',
  cost_total_policy: 'Team total', usage_limit: 'Usage limit', model_unavailable: 'Model unavailable',
});
// Search words per icon, beyond the row's own word: "paused" finds a cost-limit pause too.
const STATE_TERMS = Object.freeze({
  ask: 'waiting question review', paused: 'paused', fail: 'failed error', stop: 'stopped',
  run: 'running', start: 'starting running', done: 'done finished', scheduled: 'scheduled',
});

function parkedState(s, pauseReason) {
  if (s === 'pausing') return { icon: 'paused', word: 'Pausing', detail: '' };
  if (s === 'interrupted') return { icon: 'paused', word: 'Interrupted', detail: '' };
  return { icon: 'paused', word: PAUSE_WORDS[pauseReason] || 'Paused', detail: '' };
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
  if (PARKED.has(s)) return parkedState(s, it.pauseReason);
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
  if (PARKED.has(s)) st = parkedState(s, p.pauseReason);
  else if (FAILED.has(s)) st = { icon: 'fail', word: 'Failed', detail: '' };
  else if (STOPPED.has(s)) st = { icon: 'stop', word: 'Stopped', detail: '' };
  else if (DONE.has(s)) st = { icon: 'done', word: doneWord(p), detail: '' };
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

/** Needs you: a question or gate, a pause (cost caps included), a failed run nobody opened yet. */
export function needsYou({ kind = 'live', status = '', ask = false, unread = false } = {}) {
  if (kind === 'sched') return false;
  const s = String(status || '').toLowerCase();
  if (s === 'paused') return true;
  if (kind !== 'live') return false;
  if (ask && s !== 'pausing' && s !== 'interrupted') return true;
  return !!unread && FAILED.has(s);
}

/** The Runs badge: the Needs you count without building the list (runs on every WS frame). */
export function countNeedsYou({ live = [], history = [] } = {}) {
  const pids = new Set(live.map((r) => r && r.pipelineId).filter(Boolean));
  let n = 0;
  for (const r of live) if (r && needsYou({ kind: 'live', status: r.status, ask: !!r.ask, unread: !!r.unread })) n += 1;
  for (const p of history) if (p && !pids.has(p.id) && needsYou({ kind: 'hist', status: p.status })) n += 1;
  return n;
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
    unread: !!it.unread, needs: needsYou({ kind: 'live', status, ask: !!it.ask, unread: !!it.unread }),
  }, { at: it.startedAt }, now);
}

export function histRow(p, now = Date.now()) {
  const st = histRowState(p);
  const key = String(p.projectKey || '');
  const status = String(p.status || '').toLowerCase();
  return baseRow('hist', st, {
    key: `hist:${key}/${p.id}`, href: `#history/${key}/${p.id}`,
    runId: '', pipelineId: String(p.id), projectKey: key,
    title: String(p.title || p.id || '(untitled)'), status,
    groupKey: key, groupName: String(p.groupName || key || '(unknown project)'), by: String(p.by || ''),
    archived: !!(p && p.archived),
    unread: false, needs: needsYou({ kind: 'hist', status }),
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
  const hay = [row.title, row.groupName, row.word, row.detail, STATE_TERMS[row.icon] || '', row.needs ? 'needs you' : '']
    .join(' ').toLowerCase();
  return words.every((w) => hay.includes(w));
}

/** "<status or step> · <time>"; in Needs you the tail is the project (the group is not in view).
 *  Grouped by date the section says when, so the project joins the line and the time stays only
 *  where the header does not already pin the day (Yesterday drops it) and the run is not live. */
export function rowSub(row, { inNeeds = false, bucket = '' } = {}) {
  if (bucket) {
    // A live row is happening now: its start time would only push the line onto two.
    const time = bucket === 'yesterday' || row.kind === 'live' ? '' : (row.kind === 'hist' ? rowTime(row.activityMs, row.nowMs) : row.time);
    return [row.word, row.detail, row.groupName, time].filter(Boolean).join(' · ');
  }
  const tail = inNeeds ? row.groupName : (row.detail || row.time);
  return tail ? `${row.word} · ${tail}` : row.word;
}

/** The list's filter chips. Finished = the run ended (done, stopped, failed, and every History
 *  row, which covers interrupted); Live = the rest (running, waiting, paused, scheduled). A
 *  run that ended but still lingers as a live row counts as finished: its icon says so.
 *  Archived shows only rows flagged archived (the Runs page feeds them from a separate
 *  lazy-loaded array; the flag is the belt-and-braces check). */
export const RUNS_FILTERS = Object.freeze(['all', 'live', 'finished', 'needs', 'archived']);
const ENDED_ICONS = new Set(['done', 'stop', 'fail']);
const isFinishedRow = (r) => r.kind === 'hist' || (r.kind === 'live' && ENDED_ICONS.has(r.icon));
export function rowInFilter(row, filter) {
  if (filter === 'live') return !isFinishedRow(row);
  if (filter === 'finished') return isFinishedRow(row);
  if (filter === 'needs') return !!row.needs;
  if (filter === 'archived') return !!row.archived;
  return true;
}
const FILTER_EMPTY = Object.freeze({ live: 'No live runs.', finished: 'No finished runs yet.', needs: 'Nothing needs you.', archived: 'No archived runs.' });

/** "Group by" for the list: per project/workspace (the default), or by when the run last moved. */
export const RUNS_GROUPINGS = Object.freeze(['project', 'date']);
/** Date sections, top to bottom. Live rows are happening now (Today); a scheduled run is
 *  Upcoming; a History row files under its last activity (finish time, else start). The
 *  boundaries are local midnights, stepped with setDate so a DST day is still one day. */
export const DATE_BUCKETS = Object.freeze([
  ['upcoming', 'Upcoming'], ['today', 'Today'], ['yesterday', 'Yesterday'],
  ['week', 'Previous 7 days'], ['older', 'Older'],
]);
export function dateBucket(row, now = Date.now()) {
  if (row.kind === 'sched') return 'upcoming';
  const t = row.kind === 'live' ? now : row.activityMs;
  if (!Number.isFinite(t)) return 'older';
  const day = new Date(now);
  day.setHours(0, 0, 0, 0);
  if (t >= day.getTime()) return 'today';
  day.setDate(day.getDate() - 1);
  if (t >= day.getTime()) return 'yesterday';
  day.setDate(day.getDate() - 6);
  return t >= day.getTime() ? 'week' : 'older';
}
const KIND_RANK = Object.freeze({ live: 0, sched: 1, hist: 2 });
const cmpDateRows = (a, b) => ((KIND_RANK[a.kind] ?? 3) - (KIND_RANK[b.kind] ?? 3))
  || (a.kind === 'hist' ? (b.activityMs || 0) - (a.activityMs || 0) : 0);

const NEEDS_RANK = Object.freeze({ ask: 0, paused: 1, fail: 2 });
const cmpNeeds = (a, b) => ((NEEDS_RANK[a.icon] ?? 3) - (NEEDS_RANK[b.icon] ?? 3)) || ((b.sortMs || 0) - (a.sortMs || 0));

/**
 * The list model: { needs: Row[], groups: [{key, name, count, collapsed, rows}], total, searching, filter }.
 * `filter` is one of RUNS_FILTERS; under 'needs' the Needs-you group is the whole list.
 * `groupBy` is one of RUNS_GROUPINGS; by date the groups are DATE_BUCKETS (keys "date:<id>",
 * so their folds never collide with a project's) and each carries its `bucket`.
 * Live rows arrive in cmpTabRuns order and History rows newest first; both orders are kept.
 * A History row whose run is listed live is dropped (the live row stands for it), and so is a
 * schedule ticket whose run is (a firing ticket's id IS its runId).
 */
export function buildRunsModel({
  live = [], history = [], scheduled = [], person = '', query = '', filter = 'all', groupBy = 'project', collapsed = new Set(), now = Date.now(),
} = {}) {
  const shown = RUNS_FILTERS.includes(filter) ? filter : 'all';
  const byDate = groupBy === 'date';
  const liveRows = live.map((it) => liveRow(it, now));
  const listed = new Set(liveRows.map((r) => r.pipelineId).filter(Boolean));
  const liveIds = new Set(liveRows.map((r) => r.runId));
  const histRows = history.filter((p) => p && p.id && !listed.has(String(p.id))).map((p) => histRow(p, now));
  const schedRows = scheduled.filter((t) => t && !liveIds.has(String(t.id))).map((t) => schedRow(t, now));
  const all = [...liveRows, ...schedRows, ...histRows]
    .filter((r) => (!person || r.by === person) && rowMatches(r, query) && rowInFilter(r, shown));
  const needs = all.filter((r) => r.needs).sort(cmpNeeds);
  const groups = new Map();
  for (const r of shown === 'needs' ? [] : all) {
    let g = groups.get(r.groupKey);
    if (!g) {
      g = { key: r.groupKey, name: r.groupName || '(unknown project)', rows: [], live: false, latest: -Infinity };
      groups.set(r.groupKey, g);
    }
    g.rows.push(r);
    if (r.kind === 'live') g.live = true;
    const t = Math.min(Number.isFinite(r.sortMs) ? r.sortMs : -Infinity, now);   // a future runAt counts as now
    if (t > g.latest) g.latest = t;
  }
  const searching = !!String(query || '').trim();
  if (byDate) {
    const buckets = new Map(DATE_BUCKETS.map(([id]) => [id, []]));
    for (const r of shown === 'needs' ? [] : all) buckets.get(dateBucket(r, now)).push(r);
    const list = DATE_BUCKETS.filter(([id]) => buckets.get(id).length).map(([id, name]) => {
      const rows = buckets.get(id).sort(cmpDateRows).map((r) => ({ ...r, nowMs: now }));
      const key = `date:${id}`;
      return { key, name, bucket: id, count: rows.length, collapsed: !searching && collapsed.has(key), rows };
    });
    return { needs, groups: list, total: all.length, searching, filter: shown, groupBy: 'date' };
  }
  const list = [...groups.values()]
    .sort((a, b) => (Number(b.live) - Number(a.live)) || (b.latest - a.latest) || a.name.localeCompare(b.name))
    .map((g) => ({ key: g.key, name: g.name, count: g.rows.length, collapsed: !searching && collapsed.has(g.key), rows: g.rows }));
  return { needs, groups: list, total: all.length, searching, filter: shown, groupBy: 'project' };
}

/** Is `row` the run the pane shows? `sel` = { runId, pipelineId, histKey: "<projectKey>/<id>" }. */
export function isRowSelected(row, sel) {
  if (!sel || row.kind === 'sched') return false;
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
// 24-unit glyphs in the run card's own stroke (index.html #run-card-tpl .sic-*, removed with it).
const GLYPHS = Object.freeze({
  run: [['path', { d: 'M12 3a9 9 0 1 0 9 9' }]],
  start: [['path', { d: 'M12 3a9 9 0 1 0 9 9' }]],
  ask: [['path', { d: 'M9.3 9.4a2.8 2.8 0 1 1 4.1 2.5c-.9.5-1.4 1.1-1.4 2v.4' }], ['path', { d: 'M12 17.4h.01' }]],
  paused: [['path', { d: 'M9.5 7.5v9M14.5 7.5v9' }]],
  fail: [['path', { d: 'M12 6.5v7' }], ['path', { d: 'M12 17.4h.01' }]],
  stop: [['rect', { x: 7.5, y: 7.5, width: 9, height: 9, rx: 1.5, fill: 'currentColor' }]],
  done: [['path', { d: 'M6.5 12.5l3.8 3.8L17.5 9' }]],
  scheduled: [['circle', { cx: 12, cy: 12, r: 7 }], ['path', { d: 'M12 8.5V12l2.5 1.7' }]],
});

/** The row's status glyph (colours come from `.runs-ic-<icon>` in style.css). */
export function renderRowIcon(doc, icon) {
  const s = svg(doc, 'svg', {
    viewBox: '0 0 24 24', width: 14, height: 14, fill: 'none', stroke: 'currentColor',
    'stroke-width': 2.4, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', class: `runs-glyph runs-glyph-${icon}`,
  });
  for (const [tag, attrs] of GLYPHS[icon] || GLYPHS.done) s.appendChild(svg(doc, tag, attrs));
  return s;
}

function textEl(doc, tag, cls, text) {
  const n = doc.createElement(tag);
  n.className = cls;
  n.textContent = text;
  return n;
}

function renderRow(doc, r, { inNeeds = false, bucket = '' } = {}) {
  const a = doc.createElement('a');
  a.className = `runs-row runs-row-${r.kind}`;
  a.setAttribute('href', r.href);
  a.dataset.rowKey = r.key;
  a.dataset.slot = inNeeds ? 'needs' : 'group';   // a Needs-you row is repeated in its group
  a.dataset.kind = r.kind;
  a.dataset.icon = r.icon;                          // 'ask': the click lands the pane on its question
  if (r.runId) a.dataset.runId = r.runId;
  if (r.pipelineId) a.dataset.pipelineId = r.pipelineId;
  if (r.projectKey) a.dataset.projectKey = r.projectKey;
  const ic = doc.createElement('span');
  ic.className = `runs-ic runs-ic-${r.icon}`;
  ic.setAttribute('aria-hidden', 'true');
  ic.appendChild(renderRowIcon(doc, r.icon));
  const body = doc.createElement('span');
  body.className = 'runs-row-body';
  body.append(textEl(doc, 'span', 'runs-row-title', r.title), textEl(doc, 'span', 'runs-row-sub', rowSub(r, { inNeeds, bucket })));
  a.append(ic, body);
  return a;
}

function chevron(doc) {
  const s = svg(doc, 'svg', { viewBox: '0 0 24 24', width: 12, height: 12, fill: 'none', stroke: 'currentColor',
    'stroke-width': 2.6, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', class: 'runs-chev', 'aria-hidden': 'true' });
  s.appendChild(svg(doc, 'path', { d: 'M6 9l6 6 6-6' }));
  return s;
}

/** The list's children: Needs you, then one section per group, then a note when empty. */
export function renderRunsList(doc, model, { emptyText = 'No runs yet.', note = '' } = {}) {
  const out = [];
  if (model.needs.length) {
    const sec = doc.createElement('section');
    sec.className = 'runs-needs';
    sec.setAttribute('aria-label', 'Needs you');
    const head = doc.createElement('div');
    head.className = 'runs-needs-head';
    head.append(textEl(doc, 'span', 'runs-needs-title', 'Needs you'), textEl(doc, 'span', 'runs-count', String(model.needs.length)));
    sec.appendChild(head);
    for (const r of model.needs) sec.appendChild(renderRow(doc, r, { inNeeds: true }));
    out.push(sec);
  }
  for (const g of model.groups) {
    const sec = doc.createElement('section');
    sec.className = 'runs-group';
    sec.dataset.groupKey = g.key;
    const head = doc.createElement('button');
    head.type = 'button';
    head.className = 'runs-group-head';
    head.dataset.groupKey = g.key;
    head.setAttribute('aria-expanded', g.collapsed ? 'false' : 'true');
    if (model.searching) head.setAttribute('aria-disabled', 'true');
    head.append(chevron(doc), textEl(doc, 'span', 'runs-group-name', g.name), textEl(doc, 'span', 'runs-count', String(g.count)));
    const rows = doc.createElement('div');
    rows.className = 'runs-group-rows';
    rows.hidden = g.collapsed;
    if (!g.collapsed) for (const r of g.rows) rows.appendChild(renderRow(doc, r, { bucket: g.bucket || '' }));
    sec.append(head, rows);
    out.push(sec);
  }
  if (!model.total) {
    const empty = model.searching ? 'No runs match your search.' : (FILTER_EMPTY[model.filter] || emptyText);
    out.push(textEl(doc, 'p', 'runs-note', empty));
  }
  if (note) out.push(textEl(doc, 'p', 'runs-note runs-note-err', note));
  return out;
}
