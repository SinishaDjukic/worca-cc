// test/stillhet-pulse-read-host-2.test.mjs — Pulse in the live kind (#1268): opening an update marks it and every update about
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
  h3.status = 'paused'; h3.pauseReason = 'error'; h3.mtime = Date.parse(at(14, 55));   // an error pause (F-7a-06: your own pause is no update)
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
    ready: 'Clears when you create its pull request or discard it', 'no-remote': 'Clears when you create its pull request or discard it', 'no-base': 'Clears when you create its pull request or discard it', missed: 'Clears when you run it or cancel it', 'project-behind': 'Clears when you sync it', 'project-diverged': 'Clears when you bring them together', 'project-missing': 'Clears when you locate its folder', project: '', workspace: 'Clears when you answer it' };
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

test('the profile spend figure changes after a pipelines-changed that names its run, once the run\'s cost moved', async () => {
  const sources = clone(SOURCES);
  const h = await liveHost({ sources }), { d } = h;
  await h.hello();
  d.querySelector('[data-acct]').click();
  d.querySelector('[data-sub="usage"]').click();
  assert.match(d.querySelector('.spend-card').textContent, /\$12\.50/);
  sources.budget.windowSpendUsd = 14.25;   // the run settled with its cost
  frame(h, { type: 'pipelines-changed', action: 'updated', runId: 'run-a', pipelineId: 'pa', key: 'web-00000001' });
  await settle(400);
  assert.match(d.querySelector('.spend-card').textContent, /\$14\.25/, 'read again, with no reload');
  assert.ok(h.gets.includes('/api/history/web-00000001/pa?row=1'), 'its one row, not the whole history');
});

test('Updates and Limits rows draw the Pulse mark (signal) in their tones, never the event bolt', async () => {
  const { icon } = await import('../ui/public/design-system/components/index.mjs');
  const h = await loaded(), { w, d } = h;
  const inner = (html) => { const t = d.createElement('template'); t.innerHTML = html; return t.content.querySelector('svg').innerHTML; };
  const signal = inner(icon('signal')), bolt = inner(icon('kind-event'));
  const marks = (sel) => [...pop(d).querySelectorAll(sel)].map((m) => ({ tone: [...m.classList].find((c) => c.startsWith('is-')), glyph: m.querySelector('svg').innerHTML }));
  showAll(w, d);
  const updates = marks('.pz-list .kind-mark');
  assert.ok(updates.length > 0, 'Updates has rows');
  assert.ok(updates.every((m) => ['is-ask', 'is-idle'].includes(m.tone) && m.glyph === signal && m.glyph !== bolt), JSON.stringify(updates));
  w.RailPulse.open('vitals');
  const lim = [...pop(d).querySelectorAll('.pz-sec')].find((s) => s.querySelector('.pz-h').textContent.startsWith('Limits'));
  assert.ok(lim, 'Vitals shows its Limits section');
  const limits = [...lim.querySelectorAll('.kind-mark')].map((m) => ({ tone: [...m.classList].find((c) => c.startsWith('is-')), glyph: m.querySelector('svg').innerHTML }));
  assert.ok(limits.length > 0);
  assert.ok(limits.every((m) => ['is-fail', 'is-act'].includes(m.tone) && m.glyph === signal), JSON.stringify(limits));
});

test('F-G-G5-02: a missed schedule row in Now opens the schedule\'s own page, never a dead task page', async () => {
  const sources = withNotes();
  sources.schedules.tickets.push({ id: 'tk3', kind: 'once', scheduleId: 'sr1', title: 'Nightly', status: 'missed', runAt: at(2), projectKey: 'web-1', createdAt: at(1) });
  const h = await liveHost({ sources }), { w, d } = h;
  await h.hello();
  for (const [ticket, page] of [['tk1', '#schedule/tk1'], ['tk3', '#schedule/sr1']]) {
    w.location.hash = '#chat'; await settle();
    w.RailPulse.open('now');
    const row = pop(d).querySelector(`[data-open="r:sched:${ticket}"]`);
    assert.ok(row, `the missed ${ticket} is in Now`);
    row.click(); await settle();
    assert.equal(w.location.hash, page, `${ticket} opens its schedule`);
    assert.doesNotMatch(d.body.textContent, /This task no longer exists/);
  }
});
