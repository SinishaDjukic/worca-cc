// test/stillhet-pulse-read-host.test.mjs — Pulse in the live kind (#1268): opening an update marks it and every update about
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

test('a new failure after a retry is unread again', async () => {
  const sources = withNotes();
  const h = await loaded({ sources }), { w, d } = h;
  showAll(w, d);
  open(d, 'oh3');
  // a snapshot without the run keeps its read
  const h3 = sources.history.pipelines.find((p) => p.id === 'h3');
  sources.history.pipelines = sources.history.pipelines.filter((p) => p.id !== 'h3');
  frame(h, { type: 'pipelines-changed' }); await settle(400);
  assert.deepEqual(stored(w), ['oh3|run.failed'], 'absent is not evidence: the key stays');
  sources.history.pipelines.push(h3);
  frame(h, { type: 'pipelines-changed' }); await settle(400);
  showAll(w, d);
  assert.equal(unreadRow(d, 'oh3'), false, 'back in the list, still read');
  // retried elsewhere: the run is seen working, then fails again
  frame(h, { type: 'run-created', runId: 'run-h3', pipelineId: 'h3', projectDir: '/src/web', title: 'Broke', status: 'running', startedAt: at(14, 50) }); await settle();
  assert.deepEqual(stored(w), ['oh3|run.failed'], 'its old outcome is still in the snapshot: not yet evidence');
  h3.status = 'running';
  frame(h, { type: 'pipelines-changed' }); await settle(400);
  assert.deepEqual(stored(w), [], 'seen working with no outcome: the read is forgotten');
  frame(h, { type: 'error', runId: 'run-h3' }); await settle();
  h3.status = 'error'; h3.mtime = Date.parse(at(14, 55));
  frame(h, { type: 'pipelines-changed' }); await settle(400);
  showAll(w, d);
  assert.equal(unreadRow(d, 'oh3'), true, 'the second failure is unread');
});

test('a later outcome under the same event is unread again, though this browser never saw the run working', async () => {
  const sources = withNotes();
  const h = await loaded({ sources }), { w, d } = h;
  showAll(w, d);
  open(d, 'oh3');
  const [key] = rawKeys(w);
  assert.match(key, /^oh3\|run\.failed\|\d+$/, 'the key names the outcome: its event and the work behind it');
  const value = w.localStorage.getItem(KEY);
  // retried and failed again in another browser: the next snapshot holds the same event, with the new attempt's work
  const later = withNotes(), h3 = later.history.pipelines.find((p) => p.id === 'h3');
  h3.status = 'error'; h3.mtime = Date.parse(at(14, 55)); h3.totalActiveMs = 90_000;
  const b = await loaded({ sources: later, before: (win) => win.localStorage.setItem(KEY, value) });
  showAll(b.w, b.d);
  assert.equal(unreadRow(b.d, 'oh3'), true, 'the new failure is unread');
  assert.deepEqual(rawKeys(b.w), [], 'the old outcome\'s key is forgotten');
});

test('a title landing after the failure keeps an opened outcome read', async () => {
  const sources = withNotes();
  const h = await loaded({ sources }), { w, d } = h;
  showAll(w, d);
  open(d, 'oh3');
  const keys = rawKeys(w);
  // the smart title lands after the run failed: updated_at (mtime) moves, the status and the work do not
  const h3 = sources.history.pipelines.find((p) => p.id === 'h3');
  h3.title = 'Fix the Node 24 build'; h3.mtime = Date.parse(at(14, 55));
  frame(h, { type: 'pipelines-changed' }); await settle(400);
  assert.deepEqual(rawKeys(w), keys, 'the stored read is kept');
  showAll(w, d);
  assert.equal(unreadRow(d, 'oh3'), false, 'still read in this tab');
  const b = await loaded({ sources, before: (win) => win.localStorage.setItem(KEY, w.localStorage.getItem(KEY)) });
  showAll(b.w, b.d);
  assert.equal(unreadRow(b.d, 'oh3'), false, 'and after a reload');
});

test('an opened outcome that changes event is unread again in the same tab', async () => {
  const sources = withNotes();
  const h = await loaded({ sources }), { w, d } = h;
  showAll(w, d);
  open(d, 'oh3');
  const h3 = sources.history.pipelines.find((p) => p.id === 'h3');
  h3.status = 'paused'; h3.mtime = Date.parse(at(14, 55));
  frame(h, { type: 'pipelines-changed' }); await settle(400);
  assert.deepEqual(stored(w), [], 'the old event\'s key is forgotten');
  showAll(w, d);
  assert.equal(unreadRow(d, 'oh3'), true, 'this tab\'s own mark goes too');
});

test('a refused Try again keeps the stored read; an accepted one forgets it', async () => {
  let resume = [400, { error: 'pipeline is "error", not resumable' }];
  const h = await loaded({ post: (url) => (url === '/api/resume' ? resume : [200, { ok: true }]) }), { w, d } = h;
  showAll(w, d);
  open(d, 'oh3');
  assert.deepEqual(stored(w), ['oh3|run.failed']);
  showAll(w, d);
  pop(d).querySelector('[data-fix="oh3"]').click();
  assert.deepEqual(stored(w), ['oh3|run.failed'], 'while the request is out, another tab still reads it read');
  await settle();
  assert.match(toastText(d), /^Could not try again: /);
  assert.deepEqual(stored(w), ['oh3|run.failed'], 'nothing new happened: the read stays');
  showAll(w, d);
  assert.equal(unreadRow(d, 'oh3'), false);
  resume = [200, { ok: true }];
  pop(d).querySelector('[data-fix="oh3"]').click(); await settle();
  assert.deepEqual(stored(w), [], 'resumed: the run\'s next outcome is news');
});

test('opening a paused run\'s update ends the news and reads its sibling', async () => {
  // h1 starts done and its notification is not there yet: the news comes only from its pause
  const sources = clone(SOURCES), h1 = sources.history.pipelines.find((p) => p.id === 'h1');
  h1.status = 'done';
  const h = await liveHost({ sources, post: () => [200, { ok: true }] }), { w, d } = h;
  await h.hello();
  openUpdates(w);
  d.querySelector('#app .pz-popover [data-menu="more"]').click();
  d.querySelector('#app [data-pick="more|allread"]').click(); await settle();
  assert.equal(news(d), false, 'everything read: no news');
  h1.status = 'paused'; h1.mtime = Date.parse(at(14, 58));
  sources.notifications.notifications.push(clone(PAUSED_NOTE));
  frame(h, { type: 'pipelines-changed' }); frame(h, { type: 'notifications-changed' }); await settle(400);
  showAll(w, d);
  assert.equal(unreadRow(d, 'oh1'), true); assert.equal(unreadRow(d, 'n9'), true);
  assert.equal(news(d), true, 'the pause raised the news');
  const bell = bellN(d), n = h.posts.length;
  open(d, 'oh1');
  assert.equal(news(d), false, 'reading the update that raised it ends the news, in the same repaint');
  assert.equal(bellN(d), bell, 'the Needs-you badge stays');
  assert.ok(bell >= 1);
  await settle();
  assert.deepEqual(h.posts.slice(n).map((p) => p.url), ['/api/notifications/9/read'], 'its sibling\'s read is posted');
  showAll(w, d);
  assert.equal(unreadRow(d, 'oh1'), false); assert.equal(unreadRow(d, 'n9'), false);
});

test('bulk Mark read persists both kinds and Undo returns them', async () => {
  const { w, d, posts } = await loaded({ post: () => [200, { ok: true }] });
  showAll(w, d);
  d.querySelector('#app .pz-popover [data-menu="more"]').click();
  d.querySelector('#app [data-pick="more|select"]').click();
  for (const id of ['n7', 'n10', 'oh3']) pop(d).querySelector(`[data-sel="${id}"]`).click();
  const n = posts.length;
  pop(d).querySelector('[data-bulk="read"]').click(); await settle();
  assert.deepEqual(posts.slice(n).map((p) => p.url).sort(), ['/api/notifications/10/read', '/api/notifications/7/read'], 'one post per notification');
  assert.deepEqual(stored(w), ['oh3|run.failed'], 'the outcome is stored; no notification id is');
  for (const id of ['n7', 'n10', 'oh3']) assert.equal(unreadRow(d, id), false, `${id} reads read`);
  const m = posts.length;
  d.querySelector('[data-undo]').click(); await settle();
  assert.deepEqual(posts.slice(m).map((p) => [p.url, p.body]).sort(), [['/api/notifications/10/read', { read: false }], ['/api/notifications/7/read', { read: false }]], 'Undo posts read:false');
  assert.deepEqual(stored(w), [], 'and forgets the outcome');
  showAll(w, d);
  assert.equal(unreadRow(d, 'oh3'), true);
});

test('Now rows say how they clear, and a task opens by its own id', async () => {
  const runs = [...clone(SOURCES.hello.runs), { runId: 'run-f', pipelineId: 'pf', projectDir: '/src/web', title: 'Fell over', status: 'error', unread: true, startedAt: at(14, 40) },
    { runId: 'run-g', pipelineId: 'pg', projectDir: '/src/web', title: 'Stopped on error', status: 'paused', pauseReason: 'error', startedAt: at(14, 41) }];
  const sources = withNotes(); sources.hello.runs = runs;
  const h = await liveHost({ sources }), { w, d } = h;
  await h.hello(runs);

  // wording
  w.RailPulse.open('now');
  const meta = (id) => pop(d).querySelector(`[data-open="r:${id}"] .pz-row-m`)?.textContent || '';
  assert.match(meta('run-c'), /Clears when you resume or stop it/, 'a paused-at-a-limit row');
  assert.match(meta('run-a'), /Clears when you answer it/, 'a question row');
  assert.match(meta('run-g'), /Clears when you resume or stop it/, 'a run paused on an error stays until resumed or stopped');
  assert.match(pop(d).querySelector('[data-open="r:run-c"]').textContent, /Clears when you resume or stop it/, 'in the button\'s own text, not only its title');
  const M = w.PulseModel;
  const TABLE = { question: 'Clears when you answer it', clarify: 'Clears when you answer it', recovery: 'Clears when you retry or stop it', gate: 'Clears when you approve it or ask for changes', plan: 'Clears when you approve it or ask for changes', outline: 'Clears when you approve it or ask for changes',
    'paused-limit': 'Clears when you resume or stop it', paused: 'Clears when you resume or stop it', interrupted: 'Clears when you resume or stop it', capped: 'Clears when you resume or stop it', failed: 'Clears once you open it',
    'pr-changes': 'Clears when its pull request no longer needs you', failing: 'Clears when its pull request no longer needs you', conflicts: 'Clears when its pull request no longer needs you', checks: 'Clears when its pull request no longer needs you', approved: 'Clears when its pull request no longer needs you', 'pr-behind': 'Clears when its pull request no longer needs you', 'pr-blocked': 'Clears when its pull request no longer needs you',
    ready: 'Clears when you create its pull request or discard it', 'no-remote': 'Clears when you create its pull request or discard it', missed: 'Clears when you run it or cancel it', project: 'Clears when the project is fixed', workspace: 'Clears when you answer it' };
  for (const [k, v] of Object.entries(TABLE)) assert.equal(M.clearsWhen(k), v, `clearsWhen(${k})`);
  assert.equal(M.clearsWhen('working'), '', 'a key not in the table says nothing');

  // address: an outcome with no chat opens its task by its own id
  w.RailPulse.open('updates');
  showAll(w, d);
  open(d, 'oh3'); await settle();
  assert.equal(w.location.hash, '#run/h3', 'never #run/failed');

  // Failed: opening it acknowledges it, and it leaves Now
  const seen = [], was = w.RailAdapter.seenRun;
  w.RailAdapter.seenRun = (id) => { seen.push(id); return was(id); };
  w.location.hash = '#chat'; await settle();
  w.RailPulse.open('now');
  assert.ok(pop(d).querySelector('[data-open="r:run-f"]'), 'the failed task is in Now');
  assert.match(meta('run-f'), /Clears once you open it/);
  pop(d).querySelector('[data-open="r:run-f"]').click(); await settle();
  assert.deepEqual(seen, ['run-f'], 'seenRun with its id');
  w.RailPulse.open('now');
  assert.equal(pop(d).querySelector('[data-open="r:run-f"]'), null, 'it leaves Now');
});
