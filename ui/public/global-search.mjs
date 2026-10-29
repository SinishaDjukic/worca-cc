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
//     labels:     [string] — the label words in use on the listed runs (the Runs list label filter)
//     level:      'simple'|'advanced'|'expert' — the interface mode (missing = expert); read only for locks
//     flags:      { key: bool } — the Labs features that are on (missing = all off); read only for locks
//   }
//   Row = { kind: 'run'|'project'|'workspace'|'workflow'|'schedule'|'ticket'|'label'|'setting'|'addon'|'chat', id, title, meta,
//           tone?: 'need'|'run'|'fail'|'idle' (runs), href? (every kind but workflow and label), workflowId?, label?,
//           locks?: [{ type: 'mode', min } | { type: 'flag', key, title }] and note? (setting, addon: what unlocks it),
//           sub? (chat: the matched message snippet or topic group) }
import { liveRow, histRow, rowTime } from './runs-list.mjs';
import { formatInstant } from '../../src/shared/schedule/recurrence.mjs';
import { isMac } from './list-keys.mjs';
import { SETTING_ENTRIES, ADDON_ENTRIES, locksFor, lockNote } from './settings-index.mjs';

export const RUN_LIMIT = 5;
export const OTHER_LIMIT = 6;
export const SETTINGS_LIMIT = 5;
export const ADDON_LIMIT = 4;
export const CHAT_LIMIT = 5;

/** #948 s2: GET /api/ask/threads?q= items as Chats rows: title, the message snippet (when the hit was not the title) and
 *  the time; an archived chat's time reads "Archived · Oct 9". */
export function chatRows(threads = [], { now = Date.now() } = {}) {
  return threads.slice(0, CHAT_LIMIT).map((t) => {
    const at = Date.parse(t.updatedAt);
    const time = Number.isFinite(at) ? rowTime(at, now) : '';
    // #948 s3: a hit on the chat's topic group name says which group (store.mjs toListRow match.group).
    const sub = t.match && t.match.group ? `Group · ${t.match.group}` : (t.match && t.match.snippet) || '';
    return { kind: 'chat', id: t.id, title: t.title || 'New chat', sub,
      meta: t.archived || t.archivedAt ? ['Archived', time].filter(Boolean).join(' · ') : time, href: `#chat/${t.id}` };
  });
}

const ENDED_ICONS = new Set(['done', 'stop', 'fail']);
const KIND_ORDER = Object.freeze({ project: 0, workspace: 1, workflow: 2, schedule: 3, ticket: 3, label: 4 });
const WORD_CHAR = /[\p{L}\p{N}]/u;

/** The chip's glyph: ⌘K on a Mac, Ctrl K elsewhere (the key handler takes both chords everywhere). */
export function shortcutLabel(win) {
  return isMac(win) ? '⌘K' : 'Ctrl K';
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
  return [...lv, ...hs].map((r) => {
    const tags = (r.tags || []).map(String);
    return {
      row: {
        kind: 'run', id: r.key, title: r.title, meta: [r.groupName, r.word].filter(Boolean).join(' · '),
        tone: r.needs ? 'need' : r.icon === 'run' || r.icon === 'start' ? 'run' : r.icon === 'fail' ? 'fail' : 'idle',
        href: r.href,
      },
      tags,                                 // on the item, not the row: test/ui-global-search.test.mjs deepEquals rows
      hay: [r.title, r.groupName, r.word, ...tags].join(' ').toLowerCase(),   // D26: ⌘K finds a run by its tags
      tier: r.needs ? 0 : r.kind === 'live' && !ENDED_ICONS.has(r.icon) ? 1 : 2,
      at: Number.isFinite(r.activityMs) ? r.activityMs : Number.isFinite(r.sortMs) ? r.sortMs : -Infinity,
    };
  });
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
  // D17: a Runs list label filter. Matched by the word and by `label:word`, never by its "Runs labelled" title.
  for (const l of list(src.labels)) {
    const label = String(l);
    if (label) rows.push({ kind: 'label', id: label, title: `Runs labelled ${label}`, meta: 'Runs filter', label });
  }
  return rows.map((row) => ({ row, hay: (row.kind === 'label' ? `${row.label} label:${row.label}` : `${row.title} ${row.meta}`).toLowerCase() }));
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

/** Settings / Add-ons rows (settings-index.mjs): every query word in the name (the title and, for a card, its tab's
 *  title) or the alternative words. A name match ranks like any title (0-2); a match that needs an alternative word
 *  ranks 3, after every name match (R-po-18). Ties: catalogue order, where every tab precedes the cards (A-5). */
function catalogueRows(entries, words, q, ctx, kind, limit) {
  const lc = (s) => String(s).toLowerCase();
  return entries
    .map((e, order) => ({ e, order, name: lc(`${e.title} ${e.tabTitle}`), all: lc(`${e.title} ${e.tabTitle} ${e.alts.join(' ')}`) }))
    .filter((it) => words.every((w) => it.all.includes(w)))
    .map((it) => ({ ...it, rank: words.every((w) => it.name.includes(w)) ? titleRank(it.e.title, q, words[0]) : 3 }))
    .sort((a, b) => (a.rank - b.rank) || (a.order - b.order))   // SETTING_ENTRIES lists every tab before the cards (A-5)
    .slice(0, limit)
    .map(({ e }) => {
      const locks = locksFor(e, ctx);
      const where = kind === 'addon' ? 'Add-ons page' : e.type === 'tab' ? 'Settings tab' : `Settings · ${e.tabTitle}`;
      return { kind, id: e.id, title: e.title, meta: where, note: lockNote(locks), href: e.href, locks };
    });
}

/**
 * The popover's rows: { runs: Row[] (≤ RUN_LIMIT), other: Row[] (≤ OTHER_LIMIT), settings: Row[] (≤ SETTINGS_LIMIT),
 * addons: Row[] (≤ ADDON_LIMIT) }.
 * Every whitespace-separated query word must appear (case-insensitive) in the row's haystack —
 * a run's title, project and state word; anything else's name and meta. Ranked title prefix >
 * a title word starting with the first query word > a match elsewhere; ties: needs you, live,
 * newest (runs) and project, workspace, workflow, schedule, name (the rest). Settings and Add-ons rows come
 * from catalogueRows. An empty query lists runs only: needs you, then live, then the newest finished.
 */
export function searchRows(sources = {}, query = '', { now = Date.now(), tz = localZone() } = {}) {
  const src = sources || {};
  const words = String(query || '').toLowerCase().split(/\s+/).filter(Boolean);
  const runs = runRows(src.live, src.history, now);
  if (!words.length) {
    return { runs: runs.map((r) => ({ ...r, rank: 0 })).sort(byRun).slice(0, RUN_LIMIT).map((r) => r.row), other: [], settings: [], addons: [] };
  }
  const q = words.join(' ');
  const pick = (items, cmp, limit) => items
    .filter((it) => words.every((w) => it.hay.includes(w)))
    // A run found only by a tag names that tag in its meta ("proj · Merged · client:acme").
    .map((it) => {
      if (it.row.kind !== 'run' || !it.tags || !it.tags.length) return it;
      const base = `${it.row.title} ${it.row.meta}`.toLowerCase();
      if (words.every((w) => base.includes(w))) return it;
      const tag = it.tags.find((t) => words.some((w) => t.toLowerCase().includes(w)));
      return tag ? { ...it, row: { ...it.row, meta: [it.row.meta, tag].filter(Boolean).join(' · ') } } : it;
    })
    .map((it) => ({ ...it, rank: titleRank(it.row.title, q, words[0]) }))
    .sort(cmp).slice(0, limit).map((it) => it.row);
  const ctx = { level: src.level, flags: src.flags };
  return {
    runs: pick(runs, byRun, RUN_LIMIT),
    other: pick(otherRows(src, tz), byOther, OTHER_LIMIT),
    settings: catalogueRows(SETTING_ENTRIES, words, q, ctx, 'setting', SETTINGS_LIMIT),
    addons: catalogueRows(ADDON_ENTRIES, words, q, ctx, 'addon', ADDON_LIMIT),
  };
}
