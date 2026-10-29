// The Chats column's model (issue #948 slice 2): the view (Show / Sort by / Group by, per browser),
// the chat rows in the Runs list's item shape (runs-list.mjs renderRunsList draws them), the sections Pinned · Today ·
// Recent · Older, the busy rule for Archive and the row ⋯ items. Pure: no DOM, no fetch; chats-column.mjs mounts it.
import { timeMs, rowTime } from './runs-list.mjs';
import { viewMenuItems } from './runs-view-menu.mjs';
import { keyHint } from './list-keys.mjs';
import { fmtUsd } from './graph/run-decor.mjs';
import { chatBusyReason, CHAT_BUSY, chatGroupBusyText } from '../../src/shared/chat-busy.mjs';

export const CHATS_VIEW_KEY = 'worca-cc.chats.view';
export const CHATS_LIST_W_KEY = 'worca-cc.chats.listWidth';
export const CHATS_SHOW = Object.freeze([['all', 'All'], ['needs', 'Needs you'], ['archived', 'Archived']]);
export const CHATS_SORT = Object.freeze([['activity', 'Recent', 'Last activity'], ['created', 'Created'], ['title', 'A–Z', 'Title A–Z'], ['cost', 'Cost']]);
// Date's third entry is its segment title in the View menu.
export const CHATS_GROUP = Object.freeze([['date', 'Date', 'Today · Recent · Older'], ['project', 'Project'], ['topic', 'Topic'], ['none', 'None']]);
export const DEFAULT_CHATS_VIEW = Object.freeze({ show: 'all', sort: 'activity', groupBy: 'date' });
export const CHATS_RECENT = 10;
export const CHATS_PAGE = 50;
export const CHATS_EMPTY = Object.freeze({ needs: 'No chat needs you.', archived: 'No archived chats.' });
export const CHATS_LOADING = 'Loading chats…';
export const CHATS_OFFLINE = "The chats show here once Worca's server is reachable again.";

const pick = (list, v, d) => (list.some(([id]) => id === v) ? v : d);
const labelOf = (list, id) => (list.find(([k]) => k === id) || [id, id])[1];
/** A list entry's full name: its title when it has one ("Title A–Z"), else its label. */
const fullName = (list, id) => { const e = list.find(([k]) => k === id); return e ? e[2] || e[1] : id; };
export function cleanChatsView(v) {
  return { show: pick(CHATS_SHOW, v?.show, 'all'), sort: pick(CHATS_SORT, v?.sort, 'activity'), groupBy: pick(CHATS_GROUP, v?.groupBy, 'date') };
}
export function loadChatsView(storage) {
  try { const raw = storage.getItem(CHATS_VIEW_KEY); return raw ? cleanChatsView(JSON.parse(raw)) : { ...DEFAULT_CHATS_VIEW }; } catch { return { ...DEFAULT_CHATS_VIEW }; }
}
export function saveChatsView(storage, v) {
  try { storage.setItem(CHATS_VIEW_KEY, JSON.stringify(cleanChatsView(v))); } catch { /* private mode: the view lasts the session */ }
}

/** '' for the default view, else its non-default parts and "N chats" ("Archived · 8 chats"). */
export function chatsViewChip(v, { shown = 0 } = {}) {
  const parts = [];
  if (v.show !== 'all') parts.push(labelOf(CHATS_SHOW, v.show));
  if (v.groupBy === 'project') parts.push('By project');
  else if (v.groupBy === 'topic') parts.push('By topic');
  else if (v.groupBy === 'none') parts.push('Not grouped');
  if (v.sort !== 'activity') parts.push(fullName(CHATS_SORT, v.sort));
  if (!parts.length) return '';
  parts.push(`${shown} chat${shown === 1 ? '' : 's'}`);
  return parts.join(' · ');
}

export function chatsViewMenuItems(v, counts, { onPick, mac = false }) {
  return viewMenuItems(v, counts, { onPick, mac, showOpts: CHATS_SHOW, sortOpts: CHATS_SORT, groupOpts: CHATS_GROUP });
}

/** The state column and the state word on the sub line. Busy states pulse; idle draws the bubble (status-dot icon). */
export const CHAT_STATES = Object.freeze({
  'needs-you': Object.freeze({ word: 'Needs you', line: 'Run needs you', dot: 'amber', pulse: false, symbol: 'question', icon: null }),
  replying: Object.freeze({ word: 'Replying', line: 'Replying', dot: 'green', pulse: true, symbol: null, icon: null }),
  command: Object.freeze({ word: 'Running a command', line: 'Running a command', dot: 'green', pulse: true, symbol: null, icon: null }),
  following: Object.freeze({ word: 'Following a run', line: 'Following a run', dot: 'peach', pulse: true, symbol: null, icon: null }),
  idle: Object.freeze({ word: 'Idle', line: '', dot: 'grey', pulse: false, symbol: null, icon: 'chat' }),
});

/** One API list item as a Runs list item. `scopeName(scope)` names a project or workspace (app.js knows them). */
export function chatRow(t, { scopeName = () => '', now = Date.now() } = {}) {
  const busy = chatBusyReason({ inFlight: !!t.inFlight, commands: t.commands || 0, tracking: t.trackingRuns || 0 });
  const state = t.waiting ? 'needs-you' : busy || 'idle';
  const s = CHAT_STATES[state];
  const activityMs = timeMs(t.updatedAt, now);
  const cost = Number(t.totals && t.totals.costUsd) > 0 ? Number(t.totals.costUsd) : null;
  const scope = t.scope || null;
  const groupKey = scope ? scope.projectKey || scope.workspaceId || '' : '';
  const groupName = groupKey ? scopeName(scope) || groupKey : 'No project';
  const line = [groupName, s.line, cost != null ? fmtUsd(cost) : '', Number.isFinite(activityMs) ? rowTime(activityMs, now) : '']
    .filter(Boolean).join(' · ');
  return {
    key: `chat:${t.id}`, id: t.id, kind: 'chat', title: t.title || 'New chat', href: `#chat/${t.id}`,
    groupId: t.groupId || '',   // #948 s3: the topic group; groupKey stays the project
    needs: state === 'needs-you', busy, pinned: !!t.pinnedAt, isArchived: !!(t.archived || t.archivedAt),
    activityMs, createdMs: timeMs(t.createdAt, now), cost, groupKey, groupName, projectKey: (scope && scope.projectKey) || '',
    labels: [], model: { state, word: s.word, line, dot: s.dot, pulse: s.pulse, symbol: s.symbol, icon: s.icon },
  };
}

/** #948 s3: one topic group as a list row, drawn by renderRunsList as a Runs group row. `members` are its loaded chat
 *  rows, newest first. Its state is its most urgent member's; its sub line names its one project or "N projects". */
export function chatGroupRow(g, members, { now = Date.now() } = {}) {
  const needs = members.some((m) => m.needs);
  const busyMb = members.find((m) => m.busy) || null;
  const state = needs ? 'needs-you' : busyMb ? busyMb.model.state : 'idle';
  const s = CHAT_STATES[state];
  // Only chats with a project count: one project reads its name, 2+ read "N projects", none reads "No project".
  const keys = [...new Set(members.map((m) => m.groupKey).filter(Boolean))];
  const where = keys.length > 1 ? `${keys.length} projects` : keys.length ? members.find((m) => m.groupKey === keys[0]).groupName : 'No project';
  // D9/D17: the server's count of chats not archived, or the loaded members when more are loaded (a stale list).
  const n = Math.max(Number(g.count) || 0, members.length);
  const costs = members.map((m) => m.cost).filter((c) => c != null);
  const cost = costs.length ? costs.reduce((a, b) => a + b, 0) : null;
  const ms = members.map((m) => m.activityMs).filter(Number.isFinite);
  const activityMs = ms.length ? Math.max(...ms) : undefined;
  const line = [where, s.line, cost != null ? fmtUsd(cost) : '', Number.isFinite(activityMs) ? rowTime(activityMs, now) : '']
    .filter(Boolean).join(' · ');
  return {
    key: `cgroup:${g.id}`, id: g.id, groupId: g.id, kind: 'chat-group', title: g.name, href: '#chat', memberNoun: 'chats',
    nameSource: g.nameSource || 'user', members, count: String(n), memberCount: n,
    total: Math.max(Number(g.total) || 0, n),   // the Delete group… confirm: every member, archived included
    // Never pinned (D9): a group is placed by its newest chat, so a pinned member does not pull it into Pinned.
    needs, busy: busyMb ? busyMb.busy : null, busyTitle: busyMb ? busyMb.title : '', pinned: false,
    isArchived: members.length > 0 && members.every((m) => m.isArchived), activityMs, createdMs: timeMs(g.createdAt, now),
    cost, costUsd: cost || 0, groupKey: keys.length === 1 ? keys[0] : '', groupName: where, projectKey: '', labels: [],
    spansProjects: keys.length > 1,
    open: needs || !!busyMb,   // D9: open while a chat in it needs you or works; buildChatsModel applies the person's ⌄
    model: { state, word: s.word, line, dot: s.dot, pulse: s.pulse, symbol: s.symbol, icon: s.icon },
  };
}

/** Show = All (not Topic): each group's loaded chats fold into one group row, placed where its newest chat sits. */
function foldGroups(rows, byId, toggled, now) {
  const of = new Map();
  for (const r of rows) if (r.groupId && byId.has(r.groupId)) (of.get(r.groupId) || of.set(r.groupId, []).get(r.groupId)).push(r);
  const out = [];
  const placed = new Set();
  for (const r of rows) {
    const list = r.groupId ? of.get(r.groupId) : null;
    if (!list) { out.push(r); continue; }
    if (placed.has(r.groupId)) continue;
    placed.add(r.groupId);
    const g = chatGroupRow(byId.get(r.groupId), sortChats(list, 'activity'), { now });
    if (toggled.has(g.key)) g.open = !!toggled.get(g.key);
    out.push(g);
  }
  return out;
}

const n0 = (x) => (Number.isFinite(x) ? x : 0);
const CMP = {
  activity: (a, b) => n0(b.activityMs) - n0(a.activityMs),
  created: (a, b) => n0(b.createdMs) - n0(a.createdMs),
  title: (a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }),
  cost: (a, b) => (b.cost || 0) - (a.cost || 0),
};
/** Rows in the chosen order, ties by id (stable across repaints). */
export function sortChats(rows, sort = 'activity') {
  const c = CMP[sort] || CMP.activity;
  return [...rows].sort((a, b) => c(a, b) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/**
 * The column's sections for renderRunsList. `threads` are the loaded API items (pinned first, as the server pages them),
 * `total` the server's count for this Show, `more` whether a next page exists. Group by Date: Pinned, Today (active since
 * local midnight), Recent (the CHATS_RECENT latest before today), Older (the rest, folded until `olderOpen`; its count
 * includes the chats not loaded yet). Sort by orders rows inside each section.
 */
export function buildChatsModel({ threads = [], view = DEFAULT_CHATS_VIEW, total = null, more = false, olderOpen = false,
  collapsed = new Set(), groups = [], toggled = new Map(), scopeName = () => '', now = Date.now() } = {}) {
  const v = cleanChatsView(view);
  const rows = threads.map((t) => chatRow(t, { scopeName, now }));
  const byId = new Map(groups.map((g) => [g.id, g]));
  // D9: Needs you and Archived stay flat (a question never hides behind ⌄); Topic makes sections instead of rows.
  const top = v.show === 'all' && v.groupBy !== 'topic' ? foldGroups(rows, byId, toggled, now) : rows;
  const sections = [];
  const push = (id, title, list, extra = {}) => {
    const count = extra.count ?? list.length;
    if (list.length || count) sections.push({ id, title, rows: list, count, ...extra });
  };
  // A flat list (Show = Needs you / Archived, Group by None): pinned first, and the sub line says "Pinned" because no
  // Pinned head does there.
  const flat = (list) => {
    const mark = (r) => (r.pinned ? { ...r, model: { ...r.model, line: `Pinned · ${r.model.line}` } } : r);
    return [...sortChats(list.filter((r) => r.pinned), v.sort), ...sortChats(list.filter((r) => !r.pinned), v.sort)].map(mark);
  };
  if (v.show !== 'all') {
    push(v.show, labelOf(CHATS_SHOW, v.show), flat(rows), { bare: true, more, moreLabel: 'Show more' });
  } else if (v.groupBy === 'none') {
    push('all', 'Chats', flat(top), { bare: true, more, moreLabel: 'Show more' });
  } else if (v.groupBy === 'topic') {
    // D10: one foldable section per group, newest chat first, then Ungrouped; no Pinned head (pinned chats lead).
    const by = new Map();
    for (const r of rows) {
      const k = r.groupId && byId.has(r.groupId) ? r.groupId : '';
      if (!by.has(k)) by.set(k, []);
      by.get(k).push(r);
    }
    const newest = (list) => Math.max(...list.map((r) => n0(r.activityMs)));
    for (const k of [...by.keys()].filter(Boolean).sort((a, b) => newest(by.get(b)) - newest(by.get(a)))) {
      const id = `topic:${k}`;
      push(id, byId.get(k).name, flat(by.get(k)), { collapsed: collapsed.has(id) });
    }
    if (by.has('')) push('topic:none', 'Ungrouped', flat(by.get('')), { collapsed: collapsed.has('topic:none') });
    if (sections.length && more) Object.assign(sections[sections.length - 1], { more: true, moreLabel: 'Show more' });
  } else {
    const pinned = top.filter((r) => r.pinned);
    const rest = top.filter((r) => !r.pinned);
    push('pinned', 'Pinned', sortChats(pinned, v.sort));
    if (v.groupBy === 'date') {
      const midnight = new Date(now);
      midnight.setHours(0, 0, 0, 0);
      const byTime = sortChats(rest, 'activity');
      const today = byTime.filter((r) => r.activityMs >= midnight.getTime());
      const before = byTime.filter((r) => !(r.activityMs >= midnight.getTime()));
      const recent = before.slice(0, CHATS_RECENT);
      const older = before.slice(CHATS_RECENT);
      push('today', 'Today', sortChats(today, v.sort));
      push('recent', 'Recent', sortChats(recent, v.sort));
      // `total` counts chats, so a group row weighs its chats here, not 1.
      const chats = (list) => list.reduce((a, r) => a + (r.kind === 'chat-group' ? r.memberCount : 1), 0);
      const olderCount = total == null ? chats(older) : Math.max(chats(older), total - chats(pinned) - chats(today) - chats(recent));
      push('older', 'Older', sortChats(older, v.sort), { count: olderCount, collapsed: !olderOpen, more: olderOpen && more });
    } else {
      // Group by Project: one foldable section per project in first-seen order; counts are the loaded chats'. Groups
      // spanning 2+ projects share one "Several projects" section, never No project's.
      const by = new Map();
      for (const r of rest) {
        const [k, name] = r.spansProjects ? ['*multi', 'Several projects'] : [r.groupKey, r.groupName];
        if (!by.has(k)) by.set(k, { name, rows: [] });
        by.get(k).rows.push(r);
      }
      for (const [k, g] of by) {
        const id = `project:${k === '*multi' ? 'multi' : k || 'none'}`;
        push(id, g.name, sortChats(g.rows, v.sort), { collapsed: collapsed.has(id) });
      }
      if (sections.length && more) Object.assign(sections[sections.length - 1], { more: true, moreLabel: 'Show more' });
    }
  }
  return { sections, view: v, now, total: total ?? rows.length, shown: rows.length, spansProjects: false };
}

/** Bulk Archive / Unarchive: unarchive applies to every row; archive skips busy chats and says which. */
export function chatArchivePlan(rows, { unarchive = false } = {}) {
  if (unarchive) return { apply: rows, skipped: [], count: rows.length, title: '' };
  const apply = rows.filter((r) => !r.busy);
  const skipped = rows.filter((r) => r.busy);
  const title = skipped.length
    ? `Skipped ${skipped.length} busy chat${skipped.length === 1 ? '' : 's'}: ${skipped.map((r) => r.title).join(', ')}.`
    : '';
  return { apply, skipped, count: apply.length, title };
}

/** The row ⋯ (mock 12). `key` is the list-keys action that runs the item; Archive is disabled with the reason while busy. */
export function chatRowMenuItems(r, { mac = false, on }) {
  const k = (...t) => keyHint(t, mac);
  return [
    { label: 'Select', key: 'toggle', hint: k('Space'), onSelect: () => on.select(r) },
    { label: 'Rename…', key: 'rename', hint: k('R'), onSelect: () => on.rename(r) },
    { label: r.pinned ? 'Unpin' : 'Pin', key: 'pin', hint: k('P'), onSelect: () => on.pin(r) },
    // #948 s3: the Runs words and keys (app.js runs ⋯): Add to group… G, Remove from group ⇧G.
    { label: 'Add to group…', key: 'add-to-group', hint: k('G'), onSelect: () => on.addToGroup([r]) },
    ...(r.groupId ? [{ label: 'Remove from group', key: 'leave-group', hint: k('shift', 'G'), onSelect: () => on.leaveGroup(r) }] : []),
    { sep: true },
    r.isArchived
      ? { label: 'Restore', key: 'archive', hint: k('E'), onSelect: () => on.archive([r], { unarchive: true }) }   // the Runs word (D27)
      : { label: 'Archive', key: 'archive', hint: k('E'), disabled: !!r.busy, title: r.busy ? CHAT_BUSY[r.busy] : '', onSelect: () => on.archive([r], { unarchive: false }) },
    { label: 'Delete…', key: 'delete', hint: k('Backspace'), danger: true, onSelect: () => on.del(r) },
  ];
}

/** #948 s3: the group row's ⋯. Archive group is disabled with the reason while a chat in it is busy (the server 409s). */
export function chatGroupMenuItems(g, { mac = false, on }) {
  const k = (...t) => keyHint(t, mac);
  return [
    { label: 'Rename…', key: 'rename', hint: k('R'), onSelect: () => on.renameGroup(g) },
    { label: 'Ungroup', key: 'ungroup', onSelect: () => on.ungroup(g) },
    { sep: true },
    { label: 'Archive group', key: 'archive', hint: k('E'), disabled: !!g.busy, title: g.busy ? chatGroupBusyText(g.busyTitle) : '',
      onSelect: () => on.archiveGroup(g) },
    { label: 'Delete group…', key: 'delete', hint: k('Backspace'), danger: true, onSelect: () => on.deleteGroup(g) },
  ];
}
