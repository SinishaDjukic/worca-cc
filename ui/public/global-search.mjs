// ui/public/global-search.mjs — the top bar's "Search or ask" model: one pure function from
// plain sources and a query to the two row groups the popover shows. No DOM, no fetch: app.js
// adapts the runs Map, state.historyAll, state.projects, state.workspaces and the lazy
// /api/workflows + /api/schedules reads into the arrays below; topnav-search.mjs renders them.
//
//   sources = {
//     live:       runs-list.mjs live items (app.js runsLiveItem)
//     history:    runs-list.mjs hist items (app.js runsHistItem; an archived row is skipped)
//     projects:   [{ key, name }]
//     workspaces: [{ id, name, projectCount }]
//     workflows:  [{ id, name, builtin }]
//     schedules:  GET /api/schedules `schedules` — the series: { id, title, sentence, status }
//     tickets:    GET /api/schedules `tickets` — { id, scheduleId, title, status, runAt, after }
//   }
//   Row = { kind: 'run'|'project'|'workspace'|'workflow'|'schedule'|'ticket', id, title, meta,
//           tone?: 'need'|'run'|'fail'|'idle' (runs), href? (every kind but workflow), workflowId? }
import { liveRow, histRow } from './runs-list.mjs';
import { formatInstant } from '../../src/shared/schedule/recurrence.mjs';

export const RUN_LIMIT = 5;
export const OTHER_LIMIT = 6;

const ENDED_ICONS = new Set(['done', 'stop', 'fail']);
const KIND_ORDER = Object.freeze({ project: 0, workspace: 1, workflow: 2, schedule: 3, ticket: 3 });
const WORD_CHAR = /[\p{L}\p{N}]/u;

/** The chip's glyph: ⌘K on a Mac, Ctrl K elsewhere (the key handler takes both chords everywhere). */
export function shortcutLabel(win) {
  const nav = win?.navigator;
  const platform = String(nav?.userAgentData?.platform || nav?.platform || '');
  return /mac|iphone|ipad|ipod/i.test(platform) ? '⌘K' : 'Ctrl K';
}

/** ⌘K or Ctrl+K (Shift allowed, Alt not). */
export function isSearchCombo(e) {
  return !!(e && (e.metaKey || e.ctrlKey) && !e.altKey && typeof e.key === 'string' && e.key.toLowerCase() === 'k');
}

function localZone() {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; }
}

/** A one-off's line, in the Schedules page's words: missed, chained, else its start time. A chained
 *  one-off's runAt is a sentinel, never a time. */
function ticketMeta(t, tz) {
  const ms = t.after ? NaN : Date.parse(t.runAt);
  const when = Number.isFinite(ms) ? formatInstant(ms, tz) : '';
  if (t.status === 'missed') return ['Missed', when].filter(Boolean).join(' · ');
  return t.after ? 'Waiting for a run' : when;
}

function runRows(live, history, now) {
  const lv = (Array.isArray(live) ? live : []).filter(Boolean).map((it) => liveRow(it, now));
  const listed = new Set(lv.map((r) => r.pipelineId).filter(Boolean));
  const hs = (Array.isArray(history) ? history : [])
    .filter((p) => p && p.id && !p.archived && !listed.has(String(p.id)))
    .map((p) => histRow(p, now));
  return [...lv, ...hs].map((r) => ({
    row: {
      kind: 'run', id: r.key, title: r.title, meta: [r.groupName, r.word].filter(Boolean).join(' · '),
      tone: r.needs ? 'need' : r.icon === 'run' || r.icon === 'start' ? 'run' : r.icon === 'fail' ? 'fail' : 'idle',
      href: r.href,
    },
    hay: [r.title, r.groupName, r.word].join(' ').toLowerCase(),
    tier: r.needs ? 0 : r.kind === 'live' && !ENDED_ICONS.has(r.icon) ? 1 : 2,
    at: Number.isFinite(r.activityMs) ? r.activityMs : Number.isFinite(r.sortMs) ? r.sortMs : -Infinity,
  }));
}

function otherRows(src, tz) {
  const list = (v) => (Array.isArray(v) ? v.filter(Boolean) : []);
  const rows = [];
  for (const p of list(src.projects)) {
    if (p.key) rows.push({ kind: 'project', id: String(p.key), title: String(p.name || p.key), meta: 'Project', href: `#projects/${p.key}` });
  }
  for (const w of list(src.workspaces)) {
    if (!w.id) continue;
    const n = Number(w.projectCount) || 0;
    rows.push({ kind: 'workspace', id: String(w.id), title: String(w.name || w.id),
      meta: `Workspace · ${n} ${n === 1 ? 'project' : 'projects'}`, href: `#workspaces/${w.id}` });
  }
  for (const f of list(src.workflows)) {
    if (f.id) rows.push({ kind: 'workflow', id: String(f.id), title: String(f.name || f.id), meta: f.builtin ? 'Workflow · built-in' : 'Workflow', workflowId: String(f.id) });
  }
  // An ended series and a series' own occurrence are not listed (the Repeating tab counts the same way).
  for (const s of list(src.schedules)) {
    if (s.id && s.status !== 'ended') rows.push({ kind: 'schedule', id: String(s.id), title: String(s.title || 'Repeating schedule'), meta: String(s.sentence || ''), href: '#schedules/repeating' });
  }
  for (const t of list(src.tickets)) {
    if (t.id && !t.scheduleId && (t.status === 'scheduled' || t.status === 'missed')) {
      rows.push({ kind: 'ticket', id: String(t.id), title: String(t.title || 'Scheduled run'), meta: ticketMeta(t, tz), href: '#schedules/once' });
    }
  }
  return rows.map((row) => ({ row, hay: `${row.title} ${row.meta}`.toLowerCase() }));
}

/** Does `w` start a word of `t` (at 0, or after a character that is not a letter or digit)? */
function startsWord(t, w) {
  for (let i = t.indexOf(w); i !== -1; i = t.indexOf(w, i + 1)) {
    if (i === 0 || !WORD_CHAR.test(t[i - 1])) return true;
  }
  return false;
}

/** 0: the title starts with the query; 1: a title word starts with its first word; 2: elsewhere. */
function titleRank(title, q, first) {
  const t = String(title).toLowerCase();
  if (t.startsWith(q)) return 0;
  return startsWord(t, first) ? 1 : 2;
}

const byRun = (a, b) => (a.rank - b.rank) || (a.tier - b.tier) || (b.at - a.at) || a.row.title.localeCompare(b.row.title);
const byOther = (a, b) => (a.rank - b.rank) || (KIND_ORDER[a.row.kind] - KIND_ORDER[b.row.kind])
  || a.row.title.localeCompare(b.row.title) || (a.row.id < b.row.id ? -1 : a.row.id > b.row.id ? 1 : 0);

/**
 * The popover's rows: { runs: Row[] (≤ RUN_LIMIT), other: Row[] (≤ OTHER_LIMIT) }.
 * Every whitespace-separated query word must appear (case-insensitive) in the row's haystack —
 * a run's title, project and state word; anything else's name and meta. Ranked title prefix >
 * a title word starting with the first query word > a match elsewhere; ties: needs you, live,
 * newest (runs) and project, workspace, workflow, schedule, name (the rest). An empty query
 * lists runs only: needs you, then live, then the newest finished.
 */
export function searchRows(sources = {}, query = '', { now = Date.now(), tz = localZone() } = {}) {
  const src = sources || {};
  const words = String(query || '').toLowerCase().split(/\s+/).filter(Boolean);
  const runs = runRows(src.live, src.history, now);
  if (!words.length) {
    return { runs: runs.map((r) => ({ ...r, rank: 0 })).sort(byRun).slice(0, RUN_LIMIT).map((r) => r.row), other: [] };
  }
  const q = words.join(' ');
  const pick = (items, cmp, limit) => items
    .filter((it) => words.every((w) => it.hay.includes(w)))
    .map((it) => ({ ...it, rank: titleRank(it.row.title, q, words[0]) }))
    .sort(cmp).slice(0, limit).map((it) => it.row);
  return { runs: pick(runs, byRun, RUN_LIMIT), other: pick(otherRows(src, tz), byOther, OTHER_LIMIT) };
}
