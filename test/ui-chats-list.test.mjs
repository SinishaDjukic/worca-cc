// test/ui-chats-list.test.mjs — the Chats column's pure model (issue #948 slice 2, ui/public/chats-list.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildChatsModel, chatRow, chatArchivePlan, chatRowMenuItems, chatsViewChip, loadChatsView, CHATS_VIEW_KEY,
  chatGroupRow, chatGroupMenuItems, CHAT_KINDS } from '../ui/public/chats-list.mjs';
import { CHAT_BUSY, chatGroupBusyText } from '../src/shared/chat-busy.mjs';
import { ICONS } from '../ui/public/icons.mjs';
import { checkRows } from './helpers/rows.mjs';

const NOW = new Date(2026, 9, 25, 12, 0, 0).getTime();
const HOUR = 3600e3;
const thread = (id, o = {}) => ({ id, title: `Chat ${id}`, createdAt: new Date(NOW - 50 * HOUR).toISOString(),
  updatedAt: new Date(NOW - HOUR).toISOString(), totals: { costUsd: 0.4 }, scope: { projectKey: 'worka-1' }, ...o });
const daysAgo = (d) => new Date(NOW - d * 24 * HOUR).toISOString();

test('Group by Date: Pinned, then the Runs day sections by last activity; Older is folded and counts the unloaded', () => {
  const threads = [
    thread('p1', { pinnedAt: daysAgo(40), updatedAt: daysAgo(40) }),
    thread('t1'), thread('t2'),
    ...[1, 3, 7, 8, 30, 31, 90].map((d) => thread(`d${d}`, { updatedAt: daysAgo(d) })),
  ];
  const m = buildChatsModel({ threads, total: 15, now: NOW });
  assert.deepEqual(m.sections.map((s) => [s.title, s.rows.map((r) => r.id)]), [
    ['Pinned', ['p1']], ['Today', ['t1', 't2']], ['Yesterday', ['d1']], ['Previous 7 days', ['d3', 'd7']],
    ['Previous 30 days', ['d8', 'd30']], ['Older', ['d31', 'd90']]]);
  const older = m.sections[5];
  assert.equal(older.collapsed, true);
  assert.equal(older.count, 15 - 8, 'the 2 loaded plus the 5 not loaded');
  assert.equal(older.more, false, 'Show older only once Older is open');
  assert.equal(buildChatsModel({ threads, total: 15, more: true, olderOpen: true, now: NOW }).sections[5].more, true);
  assert.deepEqual(m.sections.slice(1, 5).map((s) => s.collapsed), [false, false, false, false], 'the other day sections fold by hand');
  assert.equal(buildChatsModel({ threads, collapsed: new Set(['week']), now: NOW }).sections[3].collapsed, true);
});

test('Group by Date: before the loaded chats reach Older, Show more ends the last day section and no Older is guessed', () => {
  const m = buildChatsModel({ threads: [thread('t1'), thread('d3', { updatedAt: daysAgo(3) })], total: 9, more: true, now: NOW });
  assert.deepEqual(m.sections.map((s) => s.id), ['today', 'week']);
  assert.equal(m.sections[1].more, true);
  assert.equal(m.sections[1].moreLabel, 'Show more');
});

test('Today starts at local midnight: a chat at 00:00 today is Today, one a millisecond earlier is Yesterday', () => {
  const midnight = new Date(NOW);
  midnight.setHours(0, 0, 0, 0);
  const m = buildChatsModel({ threads: [thread('at', { updatedAt: new Date(midnight.getTime()).toISOString() }),
    thread('before', { updatedAt: new Date(midnight.getTime() - 1).toISOString() })], total: 2, now: NOW });
  const ids = (sec) => m.sections.find((s) => s.id === sec).rows.map((r) => r.id);
  assert.deepEqual(ids('today'), ['at']);
  assert.deepEqual(ids('yesterday'), ['before']);
});

test('row: state column and sub line; busy rows carry their reason', () => {
  const idle = chatRow(thread('a'), { scopeName: () => 'worka-cc', now: NOW });
  assert.equal(idle.model.icon, 'chat');
  assert.equal(idle.model.line, 'worka-cc · $0.40 · 11:00');
  const live = chatRow(thread('b', { inFlight: true, totals: { costUsd: 1.84 } }), { scopeName: () => 'worka-cc', now: NOW });
  assert.equal(live.model.dot, 'green');
  assert.equal(live.busy, 'replying');
  assert.equal(live.model.line, 'worka-cc · Replying · $1.84 · 11:00');
  const needs = chatRow(thread('c', { waiting: true, trackingRuns: 1 }), { now: NOW });
  assert.equal(needs.model.symbol, 'question');
  assert.equal(needs.needs, true);
  assert.equal(needs.busy, 'following');
  assert.equal(chatRow(thread('d', { scope: null }), { now: NOW }).model.line.split(' · ')[0], 'No project');
  assert.equal(chatRow(thread('e', { commands: 1 }), { now: NOW }).busy, 'command');
});

// What the chat did, first match wins: Needs you · Started a run · Follows a run · Proposed a workflow · Chat.
const dotOf = (r) => ({ state: r.model.state, kind: r.model.kind, dot: r.model.dot, pulse: r.model.pulse, symbol: r.model.symbol,
  icon: r.model.icon, dotLabel: r.model.dotLabel });

test('row: the state column draws what the chat did, first match wins; history facts count on an idle chat', async () => {
  const idle = (kind, icon, dotLabel) => ({ state: 'idle', kind, dot: 'grey', pulse: false, symbol: null, icon, dotLabel });
  const needs = { state: 'needs-you', kind: 'needs-you', dot: 'amber', pulse: false, symbol: 'question', icon: null, dotLabel: 'Run needs you' };
  await checkRows([
    ['plain chat', {}, idle('chat', 'chat', 'Chat')],
    ['proposed a workflow', { hasWorkflowCard: true }, idle('workflow', 'workflow', 'Proposed a workflow')],
    ['tracks a run it did not start', { trackedRuns: 1 }, idle('tracks', 'track', 'Follows a run')],
    ['started a run from its card', { startedRuns: 2 }, idle('started', 'run', 'Started a run')],
    ['a run it follows needs you', { waiting: true }, needs],
    ['needs you beats every history fact', { waiting: true, startedRuns: 1, trackedRuns: 1, hasWorkflowCard: true, trackingRuns: 1 }, needs],
    ['started beats tracks and a workflow', { startedRuns: 1, trackedRuns: 3, hasWorkflowCard: true }, idle('started', 'run', 'Started a run')],
    ['tracks beats a workflow', { trackedRuns: 1, hasWorkflowCard: true }, idle('tracks', 'track', 'Follows a run')],
  ].map(([name, o, want]) => ({ name, run: () => {
    const r = chatRow(thread('k', o), { now: NOW });
    assert.deepEqual(dotOf(r), want);
    assert.equal(r.needs, want.state === 'needs-you');
  } })));
});

test('row: Replying and Running a command keep the green pulse; Following draws the run icon in its colour, pulsing', async () => {
  const green = (state, kind) => ({ state, kind, dot: 'green', pulse: true, symbol: null, icon: null, dotLabel: null });
  const follow = (kind, icon, dotLabel) => ({ state: 'following', kind, dot: 'peach', pulse: true, symbol: null, icon, dotLabel });
  await checkRows([
    ['replying over a started run', { inFlight: true, startedRuns: 1, trackingRuns: 1 }, green('replying', 'started')],
    ['running a command in a workflow chat', { commands: 1, hasWorkflowCard: true }, green('command', 'workflow')],
    ['following a run it started', { trackingRuns: 1, startedRuns: 1 }, follow('started', 'run', 'Started a run')],
    ['following a run it tracked', { trackingRuns: 1, trackedRuns: 1, hasWorkflowCard: true }, follow('tracks', 'track', 'Follows a run')],
    ['following with no link counted yet still draws the tracked-run icon', { trackingRuns: 1 }, follow('chat', 'track', 'Follows a run')],
    ['following never draws the workflow icon', { trackingRuns: 1, hasWorkflowCard: true }, follow('workflow', 'track', 'Follows a run')],
  ].map(([name, o, want]) => ({ name, run: () => {
    const r = chatRow(thread('b', o), { scopeName: () => 'worka-cc', now: NOW });
    assert.deepEqual(dotOf(r), want);
    if (want.state === 'following') assert.equal(r.model.line, 'worka-cc · Following a run · $0.40 · 11:00', 'the sub line keeps its word');
  } })));
});

test('every chat kind has its own line icon from ICONS and a name', () => {
  assert.deepEqual(Object.keys(CHAT_KINDS), ['needs-you', 'started', 'tracks', 'workflow', 'chat'], 'the user\'s priority order');
  assert.deepEqual(Object.values(CHAT_KINDS).map((k) => k.label), ['Run needs you', 'Started a run', 'Follows a run', 'Proposed a workflow', 'Chat']);
  const icons = Object.values(CHAT_KINDS).map((k) => k.icon).filter(Boolean);
  assert.equal(new Set(icons).size, 4, 'Needs you keeps its "?" symbol; the other four differ');
  for (const ic of icons) assert.ok(ICONS[ic], `${ic} is an ICONS name`);
});

test('bulk Archive counts only idle chats and names the skipped ones; unarchive counts all', () => {
  const rows = [chatRow(thread('a'), { now: NOW }), chatRow(thread('b', { inFlight: true, title: 'Busy one' }), { now: NOW })];
  const p = chatArchivePlan(rows);
  assert.equal(p.count, 1);
  assert.equal(p.title, 'Skipped 1 busy chat: Busy one.');
  assert.equal(chatArchivePlan(rows, { unarchive: true }).count, 2);
});

test('⋯: Archive is disabled with the busy text on a busy chat; an archived chat reads Restore', () => {
  const on = { select() {}, rename() {}, pin() {}, archive() {}, del() {} };
  const busy = chatRowMenuItems(chatRow(thread('b', { inFlight: true }), { now: NOW }), { mac: true, on });
  const arch = busy.find((i) => i.key === 'archive');
  assert.equal(arch.disabled, true);
  assert.equal(arch.title, CHAT_BUSY.replying);
  assert.deepEqual(busy.filter((i) => i.label).map((i) => i.hint), ['Space', 'R', 'P', 'G', 'E', '⌫']);
  const archived = chatRowMenuItems(chatRow(thread('c', { archivedAt: daysAgo(2) }), { now: NOW }), { mac: false, on });
  assert.equal(archived.find((i) => i.key === 'archive').label, 'Restore');
  assert.equal(archived.find((i) => i.key === 'delete').hint, 'Backspace');
});

test('Show = Archived and Group by None are flat (bare); the chip names the view and the count', () => {
  const threads = [thread('a', { archivedAt: daysAgo(1) })];
  assert.equal(buildChatsModel({ threads, view: { show: 'archived' }, now: NOW }).sections[0].bare, true);
  assert.equal(buildChatsModel({ threads: [thread('a')], view: { groupBy: 'none' }, now: NOW }).sections[0].bare, true);
  assert.equal(chatsViewChip({ show: 'archived', sort: 'activity', groupBy: 'date' }, { shown: 8 }), 'Archived · 8 chats');
  assert.equal(chatsViewChip({ show: 'all', sort: 'activity', groupBy: 'date' }, { shown: 8 }), '');
  assert.equal(chatsViewChip({ show: 'all', sort: 'title', groupBy: 'date' }, { shown: 4 }), 'Title A–Z · 4 chats', 'the chip keeps the full name');
  assert.equal(chatsViewChip({ show: 'all', sort: 'activity', groupBy: 'date' }, { shown: 4 }), '');
  for (const groupBy of ['project', 'topic', 'none']) {
    assert.equal(chatsViewChip({ show: 'all', sort: 'activity', groupBy }, { shown: 4 }), '', 'grouping draws no chip (the Runs rule)');
  }
  const mem = { m: new Map([[CHATS_VIEW_KEY, '{"show":"bogus","sort":"cost"}']]), getItem(k) { return this.m.get(k) ?? null; } };
  assert.deepEqual(loadChatsView(mem), { show: 'all', sort: 'cost', groupBy: 'date' });
});

test('Sort by orders rows inside a section, not across sections', () => {
  const threads = [thread('a', { title: 'Zed', updatedAt: daysAgo(2) }), thread('b', { title: 'Alpha', updatedAt: daysAgo(3) })];
  const m = buildChatsModel({ threads, view: { sort: 'title' }, now: NOW });
  assert.deepEqual(m.sections.find((s) => s.id === 'week').rows.map((r) => r.title), ['Alpha', 'Zed']);
});

test('flat lists put pinned chats first and mark them; grouped lists do not; Show more names the button', () => {
  const threads = [thread('a', { updatedAt: daysAgo(1) }), thread('p', { pinnedAt: daysAgo(9), updatedAt: daysAgo(9) })];
  const none = buildChatsModel({ threads, view: { groupBy: 'none' }, more: true, now: NOW });
  assert.equal(none.sections.length, 1, 'one bare list, no Pinned head');
  assert.deepEqual(none.sections[0].rows.map((r) => r.id), ['p', 'a']);
  assert.match(none.sections[0].rows[0].model.line, /^Pinned · /);
  assert.equal(none.sections[0].moreLabel, 'Show more');
  const byDate = buildChatsModel({ threads, now: NOW });
  assert.equal(byDate.sections[0].title, 'Pinned');
  assert.doesNotMatch(byDate.sections[0].rows[0].model.line, /Pinned/);
  const byProject = buildChatsModel({ threads, view: { groupBy: 'project' }, more: true, now: NOW });
  assert.equal(byProject.sections.at(-1).moreLabel, 'Show more');
});

// ── #948 s3: topic groups ──
const GID = 'askg_00000001';
const G = (id, name, o = {}) => ({ id, name, nameSource: 'user', createdAt: daysAgo(5), count: 2, ...o });

test('a group row folds its chats, sits in its newest chat\'s section, counts them and reads "2 projects"', () => {
  const threads = [
    thread('a', { groupId: GID, updatedAt: daysAgo(3) }),
    thread('b', { groupId: GID, scope: { projectKey: 'worka-2' } }),     // today
    thread('c', { updatedAt: daysAgo(2) }),
  ];
  const m = buildChatsModel({ threads, groups: [G(GID, 'Release prep')], now: NOW, scopeName: (s) => s.projectKey });
  const today = m.sections.find((s) => s.id === 'today');
  const g = today.rows.find((r) => r.kind === 'chat-group');
  assert.equal(g.key, `cgroup:${GID}`);
  assert.equal(g.title, 'Release prep');
  assert.equal(g.count, '2');
  assert.deepEqual(g.members.map((r) => r.id), ['b', 'a']);
  assert.match(g.model.line, /^2 projects · /);
  assert.equal(g.open, false);
  assert.ok(!m.sections.find((s) => s.id === 'week').rows.some((r) => r.id === 'a'), 'a member is not listed twice');
});

test('Group by Date: a group row counts its chats, so no phantom Older section appears', () => {
  const threads = [thread('a', { groupId: GID }), thread('b', { groupId: GID }), thread('c', { groupId: GID }), thread('d')];
  const m = buildChatsModel({ threads, total: 4, groups: [G(GID, 'Release prep', { count: 3 })], now: NOW });
  assert.deepEqual(m.sections.map((s) => s.id), ['today']);
  const older = [thread('o1', { groupId: GID, updatedAt: daysAgo(40) }), thread('o2', { groupId: GID, updatedAt: daysAgo(41) }),
    ...Array.from({ length: 10 }, (_, i) => thread(`r${i}`, { updatedAt: daysAgo(i + 1) }))];
  const m2 = buildChatsModel({ threads: older, total: 10 + 4, groups: [G(GID, 'x')], now: NOW });
  assert.equal(m2.sections.find((s) => s.id === 'older').count, 4, 'the 2 folded chats plus 2 not loaded');
});

test('Group by Project: a group spanning projects gets its own section, never No project', () => {
  const G2 = 'askg_00000002';
  const threads = [
    thread('n', { scope: null }),
    thread('a', { groupId: GID, scope: { projectKey: 'worka-1' } }), thread('b', { groupId: GID, scope: { projectKey: 'other' } }),
    thread('d', { groupId: G2, scope: null }), thread('e', { groupId: G2, scope: null }),
  ];
  const m = buildChatsModel({ threads, view: { groupBy: 'project' }, groups: [G(GID, 'Cross'), G(G2, 'Docs')], now: NOW,
    scopeName: (s) => s.projectKey });
  const none = m.sections.find((s) => s.id === 'project:none');
  assert.equal(none.title, 'No project');
  assert.deepEqual(none.rows.map((r) => r.title).sort(), ['Chat n', 'Docs']);
  const multi = m.sections.find((s) => s.id === 'project:multi');
  assert.equal(multi.title, 'Several projects');
  assert.deepEqual(multi.rows.map((r) => r.title), ['Cross']);
});

test('chatGroupRow: a chat with no project adds none; the server count wins; a pinned member never pins the group', () => {
  const rows = [chatRow(thread('a', { scope: { projectKey: 'worka-1' } }), { scopeName: (s) => s.projectKey }),
    chatRow(thread('b', { scope: null, pinnedAt: daysAgo(1) }), { scopeName: (s) => s.projectKey })];
  const g = chatGroupRow(G(GID, 'Release prep', { count: 4, total: 5 }), rows, { now: NOW });
  assert.match(g.model.line, /^worka-1 · /);
  assert.equal(g.count, '4');
  assert.equal(g.memberCount, 4);
  assert.equal(g.total, 5);
  assert.equal(g.pinned, false);
  const none = chatGroupRow(G(GID, 'x'), [chatRow(thread('c', { scope: null }))], { now: NOW });
  assert.match(none.model.line, /^No project/);
});

test('chatGroupRow: the group takes its highest-priority kind among its members, as it takes its most urgent state', async () => {
  const rowsOf = (...os) => os.map((o, i) => chatRow(thread(`m${i}`, o), { now: NOW }));
  await checkRows([
    ['plain chats only', [{}, {}], { state: 'idle', kind: 'chat', dot: 'grey', pulse: false, symbol: null, icon: 'chat', dotLabel: 'Chat' }],
    ['a workflow chat beside a plain one', [{}, { hasWorkflowCard: true }],
      { state: 'idle', kind: 'workflow', dot: 'grey', pulse: false, symbol: null, icon: 'workflow', dotLabel: 'Proposed a workflow' }],
    ['tracks beats a workflow in another member', [{ hasWorkflowCard: true }, { trackedRuns: 1 }],
      { state: 'idle', kind: 'tracks', dot: 'grey', pulse: false, symbol: null, icon: 'track', dotLabel: 'Follows a run' }],
    ['started beats tracks', [{ trackedRuns: 1 }, {}, { startedRuns: 1 }],
      { state: 'idle', kind: 'started', dot: 'grey', pulse: false, symbol: null, icon: 'run', dotLabel: 'Started a run' }],
    ['a member that needs you wins', [{ startedRuns: 1 }, { waiting: true }],
      { state: 'needs-you', kind: 'needs-you', dot: 'amber', pulse: false, symbol: 'question', icon: null, dotLabel: 'Run needs you' }],
    ['a following member pulses with the group\'s run icon', [{ trackingRuns: 1, trackedRuns: 1 }, { startedRuns: 1 }],
      { state: 'following', kind: 'started', dot: 'peach', pulse: true, symbol: null, icon: 'run', dotLabel: 'Started a run' }],
    ['a replying member keeps the green pulse', [{ inFlight: true }, { trackedRuns: 1 }],
      { state: 'replying', kind: 'tracks', dot: 'green', pulse: true, symbol: null, icon: null, dotLabel: null }],
  ].map(([name, members, want]) => ({ name, run: () => {
    assert.deepEqual(dotOf(chatGroupRow(G(GID, 'Release prep'), rowsOf(...members), { now: NOW })), want);
  } })));
});

test('a group whose chat needs you opens by default; the person\'s toggle wins; Needs you stays flat', () => {
  const threads = [thread('a', { groupId: GID, waiting: true }), thread('b', { groupId: GID })];
  const groups = [G(GID, 'Release prep')];
  const g = (m) => m.sections.flatMap((s) => s.rows).find((r) => r.kind === 'chat-group');
  assert.equal(g(buildChatsModel({ threads, groups, now: NOW })).open, true);
  assert.equal(g(buildChatsModel({ threads, groups, now: NOW, toggled: new Map([[`cgroup:${GID}`, false]]) })).open, false);
  const needs = buildChatsModel({ threads, groups, view: { show: 'needs', sort: 'activity', groupBy: 'date' }, now: NOW });
  assert.ok(needs.sections[0].rows.every((r) => r.kind === 'chat'));
});

test('Group by Topic: one section per group (newest first), then Ungrouped; pinned leads; no chip', () => {
  const groups = [G(GID, 'Release prep'), G('askg_00000002', 'Docs')];
  const threads = [thread('a', { groupId: GID, updatedAt: daysAgo(3) }), thread('b', { groupId: 'askg_00000002' }),
    thread('d', { updatedAt: daysAgo(1) }), thread('c', { pinnedAt: daysAgo(1), updatedAt: daysAgo(4) })];
  const m = buildChatsModel({ threads, groups, view: { show: 'all', sort: 'activity', groupBy: 'topic' }, now: NOW });
  assert.deepEqual(m.sections.map((s) => s.title), ['Docs', 'Release prep', 'Ungrouped']);
  assert.deepEqual(m.sections.map((s) => s.id), ['topic:askg_00000002', `topic:${GID}`, 'topic:none']);
  assert.deepEqual(m.sections[2].rows.map((r) => r.id), ['c', 'd']);
  assert.match(m.sections[2].rows[0].model.line, /^Pinned · /);
  assert.equal(chatsViewChip(m.view, { shown: 4 }), '');
});

test('group ⋯: Archive group is disabled with the reason while a member is busy; chat ⋯ gains the group items', () => {
  const m = buildChatsModel({ threads: [thread('a', { groupId: GID, inFlight: true, title: 'Ship notes' }), thread('b', { groupId: GID })],
    groups: [G(GID, 'Release prep')], now: NOW });
  const g = m.sections.flatMap((s) => s.rows).find((r) => r.kind === 'chat-group');
  const items = chatGroupMenuItems(g, { mac: true, on: {} });
  assert.deepEqual(items.filter((i) => !i.sep).map((i) => i.label), ['Rename…', 'Ungroup', 'Archive group', 'Delete group…']);
  const arch = items.find((i) => i.label === 'Archive group');
  assert.equal(arch.disabled, true);
  assert.equal(arch.title, chatGroupBusyText('Ship notes'));
  const grouped = chatRowMenuItems(g.members[0], { mac: true, on: {} }).map((i) => i.label);
  assert.ok(grouped.includes('Add to group…') && grouped.includes('Remove from group'));
  const loose = chatRowMenuItems(chatRow(thread('z')), { mac: true, on: {} }).map((i) => i.label);
  assert.ok(loose.includes('Add to group…') && !loose.includes('Remove from group'));
});
