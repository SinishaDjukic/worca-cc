// test/stillhet-pulse-read-host-1.test.mjs — Pulse in the live kind (#1268): opening an update marks it and every update about
// the same task read at once; a notification's read is the server's, a run outcome's lives in this browser
// (`worca-rail.pulse-read`), in every tab and after a reload; reading ends the icon's news; Now rows say what clears them;
// a task opens by its own id. The host is test/helpers/stillhet-live-counts-host.mjs (jsdom, dev-shaped answers).
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { SOURCES, clone, liveHost, settle, toastText, closeHosts, bellN } from './helpers/stillhet-live-counts-host.mjs';
import { at } from './helpers/stillhet-live-fixture.mjs';

afterEach(closeHosts);   // each test's window closes when the test ends

const KEY = 'worca-rail.pulse-read';
// dev's GET /api/notifications rows (src/core/notifications.mjs rowToNotification): a scheduled run that paused (about h1),
// a start that failed, and one that finished (info: it arrives read), beside the fixture's missed start n7
const PAUSED_NOTE = { id: 9, kind: 'run_paused', ticketId: null, scheduleId: 'sr1', pipelineId: 'h1', title: 'Old pause', message: 'paused (cost pipeline): over its cap', createdAt: at(9, 31), readAt: null, unread: true };
const FAILED_NOTE = { id: 10, kind: 'failed', ticketId: null, scheduleId: 'sr1', pipelineId: null, title: 'Nightly', message: 'Could not start', createdAt: at(4), readAt: null, unread: true };
const DONE_NOTE = { id: 11, kind: 'completed', ticketId: null, scheduleId: 'sr1', pipelineId: 'h2', title: 'Nightly', message: 'Finished', createdAt: at(2), readAt: null, unread: true };
const withNotes = () => { const s = clone(SOURCES); s.notifications.notifications.push(clone(PAUSED_NOTE), clone(FAILED_NOTE), clone(DONE_NOTE)); return s; };

const frame = (h, f) => h.sockets.at(-1).onmessage({ data: JSON.stringify(f) });
const pop = (d) => d.querySelector('#app .pz-popover');
const openUpdates = (w) => w.RailPulse.open('updates');
// the list's sentence: Showing [unread ▾] → all (or another view)
function showAll(w, d, v = 'all') {
  openUpdates(w);
  d.querySelector('#app .pz-popover [data-menu="show"]').click();
  d.querySelector(`#app [data-pick="show|${v}"]`).click();
}
const titleOf = (d, id) => pop(d)?.querySelector(`[data-open="${id}"] .pz-row-t`) || null;
const unreadRow = (d, id) => titleOf(d, id).classList.contains('is-unread');
// the Pulse button's words: "N unread", or none
const unreadN = (d) => +(/(\d+) unread/.exec(d.querySelector('#rail-pulse-slot .pz-pulse-b').title)?.[1] || 0);
const news = (d) => d.querySelector('#rail-pulse-slot .pz-pulse-b').classList.contains('is-news');
const rawKeys = (w) => { const v = w.localStorage.getItem(KEY); return v === null ? null : JSON.parse(v).keys; };
// the stored keys without their outcome's time (id|event|ms → id|event), so the cases read by event
const stored = (w) => rawKeys(w)?.map((k) => k.replace(/\|\d+$/, '')) ?? null;
const open = (d, id) => pop(d).querySelector(`[data-open="${id}"]`).click();
const readPosts = (posts) => posts.filter((p) => /^\/api\/notifications\/\d+\/read$/.test(p.url));

async function loaded(o = {}) {
  const h = await liveHost({ sources: withNotes(), ...o });
  await h.hello();
  return h;
}

test('opening a run_paused notification posts its read once and drops the count before the reply', async () => {
  const h = await loaded(), { w, d, posts } = h;
  showAll(w, d);
  assert.equal(unreadRow(d, 'n9'), true, 'the notification arrives unread');
  const was = unreadN(d);
  open(d, 'n9');
  assert.ok(unreadN(d) <= was - 1, 'the count falls in the click\'s own repaint, before the server answers');
  await settle();
  assert.deepEqual(readPosts(posts).map((p) => p.url), ['/api/notifications/9/read'], 'exactly one read is posted');
  assert.ok(!(stored(w) || []).some((k) => /^n/.test(k)), 'no notification id enters the local store');
});

test('a notification stays read after notifications-changed', async () => {
  const sources = withNotes();
  const h = await loaded({ sources }), { w, d } = h;
  showAll(w, d);
  open(d, 'n9'); await settle();
  sources.notifications.notifications.find((n) => n.id === 9).readAt = at(15);   // the server stored the read
  frame(h, { type: 'notifications-changed' }); await settle(400);
  showAll(w, d);
  assert.equal(unreadRow(d, 'n9'), false);
});

test('a completed notification arrives read', async () => {
  const { w, d } = await loaded();
  showAll(w, d);
  assert.equal(unreadRow(d, 'n11'), false, 'info arrives read');
  showAll(w, d, 'unread');
  assert.equal(titleOf(d, 'n11'), null, 'it is not among the unread');
});

test('a refused read puts the row back', async () => {
  const { w, d, posts } = await loaded({ post: () => [409, { error: 'not now' }] });
  showAll(w, d);
  const was = unreadN(d), before = w.localStorage.getItem(KEY);
  open(d, 'n10'); await settle();
  assert.equal(readPosts(posts).length, 1);
  assert.equal(toastText(d), 'Could not mark it read: not now');
  assert.equal(unreadN(d), was, 'the count is as before the click');
  assert.equal(w.localStorage.getItem(KEY), before, 'the store value is unchanged');
  showAll(w, d);
  assert.equal(unreadRow(d, 'n10'), true, 'the refused row is unread again');
  // a refused notification whose sibling outcome is stored: only the notification rolls back
  open(d, 'n9'); await settle();
  assert.equal(unreadN(d), was - 1, 'the stored sibling stays read');
  assert.deepEqual(stored(w), ['oh1|run.paused_error']);
  showAll(w, d);
  assert.equal(unreadRow(d, 'n9'), true);
});

test('a run outcome opened stays read after pipelines-changed', async () => {
  const h = await loaded(), { w, d } = h;
  showAll(w, d);
  assert.equal(unreadRow(d, 'oh3'), true);
  open(d, 'oh3');
  frame(h, { type: 'pipelines-changed' }); await settle(400);
  showAll(w, d);
  assert.equal(unreadRow(d, 'oh3'), false);
  showAll(w, d, 'unread');
  assert.equal(titleOf(d, 'oh3'), null, 'it leaves the unread view');
  showAll(w, d, 'cleared');
  assert.equal(titleOf(d, 'oh3'), null, 'opening it never clears it');
});

test('a run outcome opened stays read after a reload', async () => {
  const a = await loaded();
  showAll(a.w, a.d);
  const was = unreadN(a.d);
  open(a.d, 'oh3');
  const value = a.w.localStorage.getItem(KEY);
  assert.ok(value, 'the read is stored');
  const b = await loaded({ before: (win) => win.localStorage.setItem(KEY, value) });
  showAll(b.w, b.d);
  assert.equal(unreadRow(b.d, 'oh3'), false, 'read after the reload');
  assert.equal(unreadN(b.d), was - 1, 'the count does not come back');
});

test('a second tab drops it on the storage event', async () => {
  const a = await loaded(), b = await loaded();
  showAll(a.w, a.d); showAll(b.w, b.d);
  const was = unreadN(b.d), gets = b.gets.length;
  open(a.d, 'oh3');
  b.w.localStorage.setItem(KEY, a.w.localStorage.getItem(KEY));   // the browser shares the value; the event says it changed
  b.w.dispatchEvent(new b.w.StorageEvent('storage', { key: KEY }));
  assert.equal(unreadN(b.d), was - 1, 'tab B repaints without a reload');
  assert.equal(unreadRow(b.d, 'oh3'), false);
  assert.equal(b.gets.length, gets, 'without a GET');
});

test('two tabs\' reads both survive', async () => {
  const a = await loaded();
  const b = await loaded({ before: (win) => Object.defineProperty(win, 'localStorage', { value: a.w.localStorage, configurable: true }) });
  showAll(a.w, a.d); showAll(b.w, b.d);
  open(a.d, 'oh3');
  open(b.d, 'oh1');   // B painted before A wrote: its write still keeps A's key
  assert.deepEqual([...stored(a.w)].sort(), ['oh1|run.paused_error', 'oh3|run.failed'], 'both tabs\' keys are kept');

  // a notification read in tab A: tab B hears notifications-changed, and the next answer carries readAt
  const sources = withNotes();
  const c = await loaded({ sources }), e = await loaded({ sources });
  showAll(c.w, c.d);
  open(c.d, 'n10'); await settle();
  sources.notifications.notifications.find((n) => n.id === 10).readAt = at(15);
  frame(e, { type: 'notifications-changed' }); await settle(400);
  showAll(e.w, e.d);
  assert.equal(unreadRow(e.d, 'n10'), false, 'tab B draws the notification read');
});

test('the store keeps the newest 500 and a corrupt store reads as nothing read', async () => {
  const full = JSON.stringify({ v: 1, keys: Array.from({ length: 500 }, (_, i) => `ox${i}|run.failed`) });
  const { w, d } = await loaded({ before: (win) => win.localStorage.setItem(KEY, full) });
  showAll(w, d);
  open(d, 'oh3');
  const keys = stored(w);
  assert.equal(keys.length, 500, 'at most 500 keys');
  assert.ok(!keys.includes('ox0|run.failed'), 'the oldest goes');
  assert.equal(keys.at(-1), 'oh3|run.failed', 'the newest is kept');

  const fresh = await loaded();
  showAll(fresh.w, fresh.d);
  const all = unreadN(fresh.d);
  const bad = await loaded({ before: (win) => win.localStorage.setItem(KEY, '{') });
  showAll(bad.w, bad.d);
  assert.equal(unreadN(bad.d), all, 'a corrupt value: every row unread');
  open(bad.d, 'oh3');
  assert.deepEqual(stored(bad.w), ['oh3|run.failed'], 'and the next write starts it over');
});
