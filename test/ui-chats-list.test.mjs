// test/ui-chats-list.test.mjs — the Chats column's pure model (issue #948 slice 2, ui/public/chats-list.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildChatsModel, chatRow, chatArchivePlan, chatRowMenuItems, chatsViewChip, loadChatsView, CHATS_VIEW_KEY,
  CHATS_RECENT } from '../ui/public/chats-list.mjs';
import { CHAT_BUSY } from '../src/shared/chat-busy.mjs';

const NOW = new Date(2026, 9, 25, 12, 0, 0).getTime();
const HOUR = 3600e3;
const thread = (id, o = {}) => ({ id, title: `Chat ${id}`, createdAt: new Date(NOW - 50 * HOUR).toISOString(),
  updatedAt: new Date(NOW - HOUR).toISOString(), totals: { costUsd: 0.4 }, scope: { projectKey: 'worka-1' }, ...o });
const daysAgo = (d) => new Date(NOW - d * 24 * HOUR).toISOString();

test('Group by Date: Pinned · Today · Recent · Older; Recent holds at most 10; Older is folded and counts the unloaded', () => {
  const threads = [
    thread('p1', { pinnedAt: daysAgo(30), updatedAt: daysAgo(30) }),
    thread('t1'), thread('t2'),
    ...Array.from({ length: 14 }, (_, i) => thread(`o${i}`, { updatedAt: daysAgo(i + 1) })),
  ];
  const m = buildChatsModel({ threads, total: 20, now: NOW });
  assert.deepEqual(m.sections.map((s) => s.title), ['Pinned', 'Today', 'Recent', 'Older']);
  assert.equal(m.sections[2].rows.length, CHATS_RECENT);
  assert.equal(m.sections[3].collapsed, true);
  assert.equal(m.sections[3].count, 20 - 1 - 2 - 10);
  assert.equal(m.sections[3].more, false, 'Show older only once Older is open');
  assert.equal(buildChatsModel({ threads, total: 20, more: true, olderOpen: true, now: NOW }).sections[3].more, true);
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
  assert.deepEqual(busy.filter((i) => i.label).map((i) => i.hint), ['Space', 'R', 'P', 'E', '⌫']);
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
  const mem = { m: new Map([[CHATS_VIEW_KEY, '{"show":"bogus","sort":"cost"}']]), getItem(k) { return this.m.get(k) ?? null; } };
  assert.deepEqual(loadChatsView(mem), { show: 'all', sort: 'cost', groupBy: 'date' });
});

test('Sort by orders rows inside a section, not across sections', () => {
  const threads = [thread('a', { title: 'Zed', updatedAt: daysAgo(2) }), thread('b', { title: 'Alpha', updatedAt: daysAgo(3) })];
  const m = buildChatsModel({ threads, view: { sort: 'title' }, now: NOW });
  assert.deepEqual(m.sections.find((s) => s.id === 'recent').rows.map((r) => r.title), ['Alpha', 'Zed']);
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
