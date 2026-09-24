// ui/public/team-metrics-timeline.mjs
// Team metrics → Timeline (docs/team-metrics.md "Timeline"): work items as bars on a calendar,
// month → week → day, for the people who plan the work rather than run it. Pure DOM: takes the
// work items built by src/shared/team-metrics/timeline.mjs and returns detached elements; app.js
// owns fetching, state and the delegated events (every control carries a data-tl-* attribute).
// Calendar windows are in the viewer's LOCAL time — a PM reads "Thursday", not a UTC day.
import { summarizeWindow } from '../../src/shared/team-metrics/timeline.mjs';
import { safeHttpUrl } from '../../src/shared/team-metrics/aggregate.mjs';
import { TM_FMT } from './team-metrics-view.mjs';

export const TL_ZOOMS = Object.freeze(['month', 'week', 'day']);
export const TL_MODES = Object.freeze(['items', 'people']);
export const TL_FILTERS = Object.freeze(['shipped', 'review', 'attention']);
const HOUR = 3_600_000;
// Minimum widths; a wider panel stretches the calendar to fill it (timelineWindow's `fit`).
const DAY_PX = 24;          // month: one day
const WEEKDAY_PX = 110;     // week: one day
const HOUR_PX = 52;         // day: one hour
const DAY_FIRST_HOUR = 6;
const DAY_HOURS = 16;       // 06:00–22:00
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export const TL_STATUS = Object.freeze({
  shipped: { label: 'Shipped', tone: 'green' },
  review: { label: 'In review', tone: 'blue' },
  attention: { label: 'Needs attention', tone: 'red' },
  stopped: { label: 'Stopped', tone: 'slate' },
  closed: { label: 'Closed, not merged', tone: 'slate' },
  done: { label: 'Done', tone: 'violet' },
});

// ---- calendar ------------------------------------------------------------------------------

const dayStart = (t) => { const d = new Date(t); return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); };
const addDays = (t, n) => { const d = new Date(t); return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, d.getHours(), d.getMinutes()).getTime(); };
const weekStart = (t) => addDays(dayStart(t), -((new Date(t).getDay() + 6) % 7));

/** ISO-8601 week number of the local date `t`. */
export function isoWeek(t) {
  const d = new Date(t);
  const u = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const wd = u.getUTCDay() || 7;
  u.setUTCDate(u.getUTCDate() + 4 - wd);
  return Math.ceil(((u - Date.UTC(u.getUTCFullYear(), 0, 1)) / 86_400_000 + 1) / 7);
}

/**
 * The calendar window a zoom shows around `anchor`: { s, e (exclusive), W (px) }. `fit` is the
 * width available for the calendar: W grows to it, never below the zoom's minimum (the panel then
 * scrolls sideways).
 */
export function timelineWindow(zoom, anchor, { fit = 0 } = {}) {
  const a = new Date(anchor);
  const width = (min) => Math.max(min, Math.floor(Number(fit) || 0));
  if (zoom === 'week') { const s = weekStart(anchor); return { s, e: addDays(s, 7), W: width(7 * WEEKDAY_PX) }; }
  if (zoom === 'day') {
    const s = new Date(a.getFullYear(), a.getMonth(), a.getDate(), DAY_FIRST_HOUR).getTime();
    return { s, e: s + DAY_HOURS * HOUR, W: width(DAY_HOURS * HOUR_PX) };
  }
  const s = new Date(a.getFullYear(), a.getMonth(), 1).getTime();
  const e = new Date(a.getFullYear(), a.getMonth() + 1, 1).getTime();
  return { s, e, W: width(Math.round((e - s) / 86_400_000) * DAY_PX) };
}

/** Previous / next period (dir −1 / +1). Month steps land mid-day on the 1st. */
export function shiftAnchor(zoom, anchor, dir) {
  const a = new Date(anchor);
  if (zoom === 'month') return new Date(a.getFullYear(), a.getMonth() + dir, 1, 12).getTime();
  return addDays(anchor, zoom === 'week' ? 7 * dir : dir);
}

export const fmtDay = (t) => { const d = new Date(t); return `${WD[d.getDay()]} ${d.getDate()} ${MON[d.getMonth()]}`; };
const hhmm = (t) => { const d = new Date(t); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };

/** "45m", "3h 10m", "2d 4h" — how long, in the words a PM uses. */
export function fmtSpan(ms) {
  if (ms == null || !Number.isFinite(ms)) return '—';
  const m = Math.max(0, Math.round(ms / 60_000));
  if (m < 60) return `${m}m`;
  if (m < 1440) { const hrs = Math.floor(m / 60); const r = m % 60; return r ? `${hrs}h ${r}m` : `${hrs}h`; }
  const d = Math.floor(m / 1440); const hrs = Math.floor((m % 1440) / 60);
  return hrs ? `${d}d ${hrs}h` : `${d}d`;
}

// ---- DOM helpers ---------------------------------------------------------------------------

function h(doc, tag, cls, text) {
  const n = doc.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}
function btn(doc, cls, text, data = {}) {
  const b = h(doc, 'button', cls, text);
  b.type = 'button';
  for (const [k, v] of Object.entries(data)) b.dataset[k] = String(v);
  return b;
}
const px = (n) => `${Math.round(n * 10) / 10}px`;

// ---- the page ------------------------------------------------------------------------------

function groupItems(items, mode) {
  const groups = new Map();
  for (const it of items) {
    const k = mode === 'people' ? (it.actor || '') : it.project;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(it);
  }
  return [...groups.entries()].sort((a, b) => (a[0] === '' ? 1 : b[0] === '' ? -1 : a[0].localeCompare(b[0])));
}

function tiles(doc, sum, { filter }) {
  const row = h(doc, 'div', 'tl-tiles');
  const tile = ({ f, tone, label, value, sub }) => {
    const t = f ? btn(doc, `card stat-tile tl-tile tl-t-${tone}`, null, { tlFilter: f }) : h(doc, 'div', 'card stat-tile tl-tile');
    if (f) t.setAttribute('aria-pressed', String(filter === f));
    const l = h(doc, 'div', 'stat-label');
    if (tone) l.append(h(doc, 'i', 'tl-dot'));
    l.append(h(doc, 'span', null, label));
    t.append(l, h(doc, 'div', 'stat-value', value), h(doc, 'small', 'stat-sub', sub));
    return t;
  };
  if (sum.prKnown) {
    row.append(tile({ f: 'shipped', tone: 'green', label: 'Shipped', value: String(sum.shipped.length), sub: 'Pull requests merged in this period' }));
    row.append(tile({ f: 'review', tone: 'blue', label: 'In review', value: String(sum.inReview.length), sub: 'Pull request open, not merged yet' }));
  } else {
    row.append(tile({ label: 'Completed', value: String(sum.completed.length), sub: 'Finished runs in this period (no merge data)' }));
  }
  const failing = sum.attention.filter((i) => !i.prs.some((p) => p.state === 'OPEN')).length;
  const waiting = sum.attention.length - failing;
  const attSub = sum.attention.length
    ? [failing && `${failing} failing`, waiting && `${waiting} waiting for review`].filter(Boolean).join(' · ')
    : 'Nothing is blocked';
  row.append(tile({ f: 'attention', tone: 'red', label: 'Needs attention', value: String(sum.attention.length), sub: attSub }));
  if (sum.prKnown) row.append(tile({ label: 'Median lead time', value: fmtSpan(sum.medianLeadMs), sub: 'First run to merge' }));
  row.append(tile({ label: 'Agent spend', value: TM_FMT.usd(sum.spendUsd), sub: 'Runs started in this period' }));
  return row;
}

/** One line on where merge data comes from, only when something is missing. */
export function prNotice(doc, { status = null, loading = false, prKnown = false } = {}) {
  const parts = [];
  if (loading) parts.push('Checking pull requests…');
  else if (status) {
    const noAction = !(status.actionRepos || []).length;
    if (noAction && (status.gh === 'missing' || status.gh === 'unauthenticated')) {
      const why = status.gh === 'missing' ? 'the GitHub CLI (gh) is not installed' : 'the GitHub CLI (gh) is not signed in';
      parts.push(`Merge dates are unavailable because ${why}. Install gh and run \`gh auth login\`, or add the merge-tracking workflow to the repository with \`worca metrics pr-workflow\`.${prKnown ? '' : ' Until then, Completed counts finished runs.'}`);
    }
    if (status.ghError) parts.push(`GitHub did not answer for some pull requests: ${status.ghError}`);
    if ((status.unsupportedRepos || []).length) parts.push(`Merge tracking covers GitHub repositories; ${status.unsupportedRepos.join(', ')} show${status.unsupportedRepos.length === 1 ? 's' : ''} without merge data.`);
  }
  if (!parts.length) return null;
  const n = h(doc, 'div', 'hint tl-note');
  n.setAttribute('role', 'status');
  for (const [i, p] of parts.entries()) {
    if (i) n.append(h(doc, 'br'));
    // `code` spans for the two commands, text for the rest.
    p.split(/(`[^`]+`)/).forEach((seg) => n.append(seg.startsWith('`') ? h(doc, 'code', null, seg.slice(1, -1)) : doc.createTextNode(seg)));
  }
  return n;
}

function crumbs(doc, zoom, anchor) {
  const a = new Date(anchor);
  const parts = [{ z: 'month', label: `${MONTH[a.getMonth()]} ${a.getFullYear()}` }];
  if (zoom !== 'month') parts.push({ z: 'week', label: `Week ${isoWeek(anchor)}` });
  if (zoom === 'day') parts.push({ z: 'day', label: fmtDay(anchor) });
  const nav = h(doc, 'nav', 'tl-crumbs');
  nav.setAttribute('aria-label', 'Zoom');
  parts.forEach((p, i) => {
    if (i) nav.append(h(doc, 'span', 'tl-sep', '›'));
    if (i === parts.length - 1) { const cur = h(doc, 'span', 'tl-crumb-cur', p.label); cur.setAttribute('aria-current', 'true'); nav.append(cur); }
    else nav.append(btn(doc, 'tl-crumb', p.label, { tlZoom: p.z }));
  });
  return nav;
}

function controls(doc, { zoom, anchor, mode }) {
  const bar = h(doc, 'div', 'tl-controls');
  const left = h(doc, 'div', 'tl-nav');
  const prev = btn(doc, 'btn-ghost btn-mini tl-step', '‹', { tlShift: -1 }); prev.setAttribute('aria-label', `Previous ${zoom}`);
  const next = btn(doc, 'btn-ghost btn-mini tl-step', '›', { tlShift: 1 }); next.setAttribute('aria-label', `Next ${zoom}`);
  left.append(prev, next, btn(doc, 'btn-ghost btn-mini tl-today', 'Today', { tlToday: 1 }), crumbs(doc, zoom, anchor));
  const right = h(doc, 'div', 'tl-opts');
  right.append(h(doc, 'span', 'hint', 'Group by'));
  const seg = h(doc, 'div', 'seg tl-mode');
  seg.setAttribute('role', 'group'); seg.setAttribute('aria-label', 'Group by');
  for (const [m, label] of [['items', 'Work items'], ['people', 'People']]) {
    const b = btn(doc, m === mode ? 'on' : '', label, { tlMode: m });
    b.setAttribute('aria-pressed', String(m === mode));
    seg.append(b);
  }
  right.append(seg);
  bar.append(left, right);
  return bar;
}

function mergedPips(doc, n) {
  const p = h(doc, 'span', 'tl-pips');
  for (let i = 0; i < Math.min(n, 3); i++) p.append(h(doc, 'i'));
  if (n > 3) p.append(h(doc, 'em', null, `+${n - 3}`));
  return p;
}

function header(doc, { zoom, win, X, items, now }) {
  const rows = [];
  const cols = [];
  const today = dayStart(now);
  const mergedOn = (s, e) => items.filter((it) => it.status === 'shipped' && it.mergedAt != null && it.mergedAt >= s && it.mergedAt < e).length;
  const row = (cls, labText, children) => {
    const r = h(doc, 'div', `tl-row tl-hrow ${cls}`);
    const lab = h(doc, 'div', 'tl-lab', labText);
    const track = h(doc, 'div', 'tl-track');
    track.style.width = px(win.W);
    track.append(...children);
    r.append(lab, track);
    return r;
  };
  if (zoom === 'day') {
    const ticks = [];
    for (let t = win.s; t < win.e; t += HOUR) {
      const tick = h(doc, 'span', 'tl-hour', hhmm(t));
      tick.style.left = px(X(t));
      ticks.push(tick);
      cols.push({ l: X(t), w: X(t + HOUR) - X(t), we: false });
    }
    rows.push(row('tl-h-hours', null, ticks));
    return { rows, cols };
  }
  const weeks = [];
  const days = [];
  for (let t = win.s; t < win.e; t = addDays(t, 1)) {
    const d = new Date(t);
    const next = addDays(t, 1);
    const l = X(t); const w = X(next) - l;
    const we = d.getDay() === 0 || d.getDay() === 6;
    cols.push({ l, w, we });
    const cell = btn(doc, `tl-hcell${t === today ? ' is-today' : ''}`, null, { tlDay: t });
    cell.title = `Zoom to ${fmtDay(t)}`;
    cell.style.left = px(l); cell.style.width = px(w);
    cell.append(h(doc, 'span', 'tl-wd', zoom === 'month' ? WD[d.getDay()][0] : WD[d.getDay()]),
      h(doc, 'span', 'tl-dn', zoom === 'month' ? String(d.getDate()) : `${d.getDate()} ${MON[d.getMonth()]}`), mergedPips(doc, mergedOn(t, next)));
    days.push(cell);
    if (zoom === 'month' && (d.getDay() === 1 || t === win.s)) {
      const end = Math.min(addDays(weekStart(t), 7), win.e);
      const wl = X(t); const ww = X(end) - wl;
      const wk = btn(doc, 'tl-hcell tl-week', ww > 60 ? `Week ${isoWeek(t)}` : String(isoWeek(t)), { tlWeek: t });
      wk.title = `Zoom to week ${isoWeek(t)}`;
      wk.style.left = px(wl); wk.style.width = px(ww);
      weeks.push(wk);
    }
  }
  if (zoom === 'month') rows.push(row('tl-h-weeks', null, weeks));
  rows.push(row('tl-h-days', 'Merged ◆', days));
  return { rows, cols };
}

function bar(doc, it, { X, zoom, now }) {
  const left = X(it.first);
  const width = Math.max(X(it.end) - left, 14);
  const rel = (t) => X(t) - left;
  const st = TL_STATUS[it.status];
  const hit = btn(doc, 'tl-hit', null, { tlItem: it.key });
  hit.style.left = px(left); hit.style.width = px(width);
  hit.setAttribute('aria-label', `${it.title}: ${st.label}`);
  const span = h(doc, 'i', 'tl-span');
  span.style.left = '0px'; span.style.width = px(Math.max(rel(it.lastEnd), 4));
  hit.append(span);
  it.runs.forEach((r, i) => {
    const w = Math.max(rel(r.e) - rel(r.s), 3);
    const run = h(doc, 'i', `tl-run is-${r.result}`, zoom === 'day' && w > 70 ? `${i + 1} · ${fmtSpan(r.e - r.s)}` : null);
    run.style.left = px(rel(r.s)); run.style.width = px(w);
    hit.append(run);
  });
  if (it.prOpenAt != null) {
    const until = it.mergedAt ?? it.closedAt ?? (it.prs.some((p) => p.state === 'OPEN') ? now : null);
    if (until != null) {
      const tail = h(doc, 'i', 'tl-tail');
      tail.style.left = px(rel(it.prOpenAt)); tail.style.width = px(Math.max(rel(until) - rel(it.prOpenAt), 0));
      hit.append(tail);
    }
  }
  const markAt = it.status === 'shipped' ? it.mergedAt : it.status === 'closed' ? it.closedAt : it.prs.some((p) => p.state === 'OPEN') ? now : null;
  if (markAt != null) {
    const kind = it.status === 'shipped' ? 'merged' : it.status === 'closed' ? 'closed' : 'open';
    const mark = h(doc, 'i', `tl-mark is-${kind}`);
    mark.style.left = px(rel(markAt));
    hit.append(mark);
  }
  return hit;
}

function itemRow(doc, it, { mode, win, X, zoom, now }) {
  const st = TL_STATUS[it.status];
  const r = h(doc, 'div', `tl-row tl-item tl-t-${it.status === 'attention' && it.prs.some((p) => p.state === 'OPEN') ? 'blue' : st.tone}`);
  const lab = h(doc, 'div', `tl-lab tl-t-${st.tone}`);
  const t = h(doc, 'div', 'tl-title');
  t.append(h(doc, 'i', 'tl-dot'), Object.assign(h(doc, 'span', 'tl-title-text', it.title), { title: it.title }));
  const who = mode === 'people' ? it.project : (it.actor || 'Unattributed');
  const ref = it.ticket?.ref || (it.prs[0]?.number != null ? `#${it.prs[0].number}` : null);
  const meta = h(doc, 'div', 'tl-meta mono');
  meta.append(`${[ref, who].filter(Boolean).join(' · ')} · `, h(doc, 'span', 'tl-st', it.status === 'done' && it.prKnown && !it.prs.length ? 'Done, no PR' : st.label));
  lab.append(t, meta);
  const track = h(doc, 'div', 'tl-track');
  track.style.width = px(win.W);
  track.append(bar(doc, it, { X, zoom, now }));
  r.append(lab, track);
  return r;
}

function legend(doc) {
  const l = h(doc, 'div', 'tl-legend');
  const entry = (sw, text) => { const s = h(doc, 'span', 'tl-lg'); s.append(sw, text); return s; };
  const sw = (...kids) => { const b = h(doc, 'i', 'tl-lg-sw tl-t-green'); b.append(...kids); return b; };
  const at = (cls, left, width) => { const n = h(doc, 'i', cls); n.style.left = px(left); if (width != null) n.style.width = px(width); return n; };
  l.append(
    entry(sw(at('tl-span', 0, 30)), 'Agent working, first run to last'),
    entry(sw(at('tl-run is-done', 8, 7), at('tl-run is-failed', 18, 7)), 'One run (red: failed)'),
    entry(sw(at('tl-tail', 0, 30)), 'Waiting for review'),
    entry(sw(at('tl-mark is-merged', 15)), 'Merged: shipped'),
    entry(sw(at('tl-mark is-open', 15)), 'Pull request open'),
    entry(sw(at('tl-mark is-closed', 15)), 'Closed without merge'),
  );
  return l;
}

/**
 * @param {object} m
 * @param {object[]} m.items   buildWorkItems() output (the whole scope; the window filters).
 * @param {'month'|'week'|'day'} m.zoom
 * @param {number} m.anchor    a time inside the period shown.
 * @param {'items'|'people'} m.mode
 * @param {string|null} m.filter  one of TL_FILTERS, from the tiles.
 * @param {object|null} m.prStatus  resolveRunPrs().status; m.prLoading while it is out.
 * @param {number} [m.fit]  px available for the calendar (the card's width minus the labels).
 */
export function renderTimeline(m, { doc = globalThis.document } = {}) {
  const { items = [], zoom = 'month', anchor = Date.now(), mode = 'items', filter = null, now = Date.now(), prStatus = null, prLoading = false, fit = 0 } = m;
  const win = timelineWindow(zoom, anchor, { fit });
  const X = (t) => ((t - win.s) / (win.e - win.s)) * win.W;
  const sum = summarizeWindow(items, { startMs: win.s, endMs: win.e, now });
  const root = h(doc, 'div', 'tl');
  root.append(tiles(doc, sum, { filter }));
  const note = prNotice(doc, { status: prStatus, loading: prLoading, prKnown: sum.prKnown });
  if (note) root.append(note);

  const card = h(doc, 'section', 'card tl-card');
  card.append(controls(doc, { zoom, anchor, mode }));
  const scroll = h(doc, 'div', 'tl-scroll');
  const grid = h(doc, 'div', `tl-grid tl-z-${zoom}`);
  grid.style.width = `calc(var(--tl-lab) + ${px(win.W)})`;
  const head = header(doc, { zoom, win, X, items, now });
  grid.append(...head.rows);

  const body = h(doc, 'div', 'tl-body');
  const layer = h(doc, 'div', 'tl-cols');
  layer.style.width = px(win.W);
  for (const c of head.cols) {
    const col = h(doc, 'i', `tl-col${c.we ? ' is-weekend' : ''}`);
    col.style.left = px(c.l); col.style.width = px(c.w);
    layer.append(col);
  }
  if (now < win.e) {
    const fut = h(doc, 'i', 'tl-future');
    fut.style.left = px(Math.max(0, X(now)));
    layer.append(fut);
  }
  if (now >= win.s && now < win.e) {
    const line = h(doc, 'i', 'tl-now');
    line.style.left = px(X(now));
    layer.append(line);
    const tag = h(doc, 'span', 'tl-now-tag', 'Now');
    tag.style.left = `calc(var(--tl-lab) + ${px(X(now))})`;
    body.append(tag);
  }
  body.append(layer);

  let shown = sum.visible;
  if (filter === 'shipped') shown = sum.shipped;
  else if (filter === 'review') shown = sum.inReview;
  else if (filter === 'attention') shown = sum.attention;
  for (const [key, list] of groupItems(shown, mode)) {
    const g = h(doc, 'div', 'tl-row tl-group');
    const lab = h(doc, 'div', 'tl-lab');
    const shipped = list.filter((i) => i.status === 'shipped').length;
    if (mode === 'people') {
      const name = key || 'Unattributed';
      lab.append(h(doc, 'span', 'tl-ava', name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase()), h(doc, 'b', null, name));
    } else lab.append(h(doc, 'i', 'tl-proj'), h(doc, 'b', null, key));
    lab.append(h(doc, 'small', null, `${list.length} item${list.length === 1 ? '' : 's'}${sum.prKnown ? ` · ${shipped} shipped` : ''}`));
    const track = h(doc, 'div', 'tl-track'); track.style.width = px(win.W);
    g.append(lab, track);
    body.append(g);
    for (const it of list) body.append(itemRow(doc, it, { mode, win, X, zoom, now }));
  }
  if (!shown.length) body.append(h(doc, 'div', 'tl-empty hint', filter ? 'No work items match this filter in this period.' : 'No work in this period.'));
  grid.append(body);
  scroll.append(grid);
  card.append(scroll, legend(doc));
  root.append(card);
  root.append(h(doc, 'small', 'hint tl-foot', 'Click a week or a day in the header to zoom in, and a bar for the work item. A work item is every run on one ticket, or on one branch when there is no ticket.'));
  return root;
}

/** The card a bar opens: what it is, where it stands, and the runs behind it. */
export function renderTimelinePopover(it, { doc = globalThis.document, now = Date.now() } = {}) {
  const st = TL_STATUS[it.status];
  const pop = h(doc, 'div', `tl-pop tl-t-${st.tone}`);
  pop.setAttribute('role', 'dialog');
  pop.setAttribute('aria-label', it.title);
  const top = h(doc, 'div', 'tl-pop-top');
  const close = btn(doc, 'tl-pop-x', '×', { tlClose: 1 }); close.setAttribute('aria-label', 'Close');
  top.append(h(doc, 'span', 'tl-pill', it.status === 'done' && it.prKnown && !it.prs.length ? 'Done, no PR' : st.label), close);
  pop.append(top);
  const kicker = h(doc, 'div', 'tl-pop-kicker mono', [it.ticket?.ref, it.project].filter(Boolean).join(' · '));
  pop.append(kicker, h(doc, 'h3', null, it.title));
  if (it.reason) pop.append(h(doc, 'p', 'tl-reason', it.reason));
  const dl = h(doc, 'dl');
  const row = (k, v) => { if (v == null || v === '') return; dl.append(h(doc, 'dt', null, k)); const dd = h(doc, 'dd'); if (typeof v === 'string') dd.textContent = v; else dd.append(v); dl.append(dd); };
  row('Driven by', it.actors.length ? it.actors.join(', ') : 'Unattributed');
  row('Attempts', `${it.runs.length}${it.failed ? ` (${it.failed} failed)` : ''}`);
  if (it.reviewCycles) row('Review cycles', String(it.reviewCycles));
  row('Agent time', fmtSpan(it.activeMs));
  const open = it.prs.some((p) => p.state === 'OPEN');
  if (it.prOpenAt != null) row('Waiting for review', `${fmtSpan((it.mergedAt ?? it.closedAt ?? now) - it.prOpenAt)}${open ? ' so far' : ''}`);
  if (it.mergedAt != null) row('Lead time', `${fmtSpan(it.mergedAt - it.first)} (first run to merge)`);
  row('Spend', TM_FMT.usd(it.costUsd));
  const link = (text, url) => { const safe = safeHttpUrl(url); if (!safe) return text; const a = h(doc, 'a', null, text); a.href = safe; a.target = '_blank'; a.rel = 'noopener noreferrer'; return a; };
  if (it.ticket && (it.ticket.url || it.ticket.ref)) row('Ticket', link(it.ticket.ref || 'Open ticket', it.ticket.url));
  for (const p of it.prs) {
    const when = p.state === 'MERGED' ? (p.mergedAt != null ? `merged ${fmtDay(p.mergedAt)}` : 'merged') : p.state === 'CLOSED' ? 'closed without merge' : p.createdAt != null ? `open since ${fmtDay(p.createdAt)}` : 'open';
    const v = h(doc, 'span');
    v.append(link(p.number != null ? `#${p.number}` : 'Pull request', p.url), ` ${when}`);
    row('Pull request', v);
  }
  if (!it.prs.length) row('Pull request', it.prKnown ? 'None opened' : 'Unknown');
  pop.append(dl);
  const runs = h(doc, 'div', 'tl-attempts');
  runs.append(h(doc, 'span', 'tl-attempts-h', 'Runs'));
  for (const r of it.runs) {
    const line = h(doc, 'div', 'tl-att mono');
    line.append(h(doc, 'i', `tl-att-dot is-${r.result}`), `${fmtDay(r.s)}, ${hhmm(r.s)}`, h(doc, 'span', 'tl-att-r', `${fmtSpan(r.e - r.s)} · ${r.result}`));
    runs.append(line);
  }
  pop.append(runs);
  return pop;
}
