// test/stillhet-live-counts.test.mjs — the live kind in the app host (jsdom, the app's scripts in boot.js's order,
// data-adapter="live"): every count of the bar, Pulse and the bell equals its source, each opens what it counts, the store
// is written only by the adapter, a refused action changes nothing and says so, and the mode is dev's uiLevel.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { stillhetHost } from './helpers/stillhet-host.mjs';
import { SOURCES, NOW } from './helpers/stillhet-live-fixture.mjs';
import { SOURCES as URLS } from '../ui/public/stillhet/live/live-adapter.mjs';
import { countNeedsYou } from '../src/shared/needs-you.mjs';

const settle = (ms = 30) => new Promise((r) => setTimeout(r, ms));
const BY_URL = Object.fromEntries(Object.entries(URLS).map(([k, u]) => [u, k]));
const clone = (x) => JSON.parse(JSON.stringify(x));

// Hand-computed from the fixture: tasks that need you by dev's rule (run-a asks, run-c paused, h1 paused; pa is live, so its
// saved row does not count), the missed ticket, and two projects (gone-3's folder is missing, api-2 is out of sync).
const TASK_NEEDS = 3, MISSED = 1, PROJECT_NEEDS = 2, BELL = TASK_NEEDS + MISSED + PROJECT_NEEDS;

async function liveHost({ sources = SOURCES, getStatus = () => 200, post = () => [200, {}], level = 'expert', hash = '#chat', before } = {}) {
  const gets = [], posts = [], sockets = [];
  const fetch = async (u, o = {}) => {
    const url = String(u), method = o.method || 'GET';
    if (method !== 'GET') {
      const body = o.body ? JSON.parse(o.body) : null; posts.push({ url, method, body });
      const [status, data] = post(url, body);
      return { ok: status < 300, status, json: async () => data };
    }
    gets.push(url);
    const s = getStatus(url), key = BY_URL[url];
    return { ok: s < 300, status: s, json: async () => clone(sources[key] ?? {}) };
  };
  const w = stillhetHost({ adapter: 'live', level, hash, fetch, after, beforeScripts: (win) => {
    win.WebSocket = class { constructor(url) { this.url = url; sockets.push(this); } close() {} send() {} };
    win.Date.now = () => NOW;
    if (before) before(win);
  } });
  w.RailAdapter.importLive = () => import('../ui/public/stillhet/live/live-adapter.mjs');
  const hello = async (runs = sources.hello.runs) => { await settle(); sockets.at(-1).onmessage({ data: JSON.stringify({ type: 'hello', bootId: 'b', runs }) }); await settle(); };
  return { w, d: w.document, gets, posts, sockets, hello };
}
const bellN = (d) => { const b = d.querySelector('#rail-pulse-slot .topnav-badge'); return b ? +b.textContent : null; };
const openAcct = (d) => { if (!d.querySelector('#app .acct-menu')) d.querySelector('[data-acct]').click(); };
const toastText = (d) => d.querySelector('body > .rc-toast')?.textContent || '';
const store = (w) => clone({ data: w.RailWorld.data(), parts: ['chats', 'schedules', 'projects', 'costs', 'updates', 'actions', 'away', 'keep'].map((k) => w.RailWorld.part(k)) });
const DEMO_NAMES = ['Add CSV export to billing', 'Fix flaky login test', 'billing-api', 'Billing CSV export', 'Nightly export check'];

test('before the first snapshot: no rows, the loading look in the bar and Pulse, no number on the bell', async () => {
  const { w, d } = await liveHost();
  assert.equal(w.RailAdapter.kind, 'live');
  assert.equal(w.RailDemoState.list, 'loading');
  assert.equal(w.RailWorld.data().runs.length, 0);
  assert.equal(bellN(d), null);
  w.RailPulse.open('now');
  assert.match(d.querySelector('#app .pz-popover').textContent, /Loading updates…/);
  await settle(350);
  assert.match(d.getElementById('bar-chat').textContent, /Loading chats…/);
  for (const n of DEMO_NAMES) assert.ok(!d.body.textContent.includes(n), `no seeded ${n}`);
});

test('the bell: tasks by dev\'s rule, missed schedules and projects that need you; the tab title follows it', async () => {
  const { w, d, hello } = await liveHost();
  await hello();
  assert.equal(w.RailDemoState.list, '');
  const live = SOURCES.hello.runs.map((r) => ({ pipelineId: r.pipelineId, status: r.status, ask: !!r.pendingQuestion }));
  assert.equal(countNeedsYou({ live, history: SOURCES.history.pipelines.filter((p) => !p.archived) }), TASK_NEEDS);
  assert.equal(SOURCES.schedules.counts.missed, MISSED);
  assert.equal(bellN(d), BELL);
  assert.equal(d.title, `(${BELL}) Worca`, 'Badge "what needs you": the tab title counts the same');
  assert.match(d.querySelector('[data-pop]').title, /6 need you \(3 tasks, 1 missed schedule, 2 projects\)/);
  for (const n of DEMO_NAMES) assert.ok(!d.body.textContent.includes(n), `no seeded ${n}`);
});

test('with nothing that needs you the bell has no number; its words say the unread updates (look.alert-ladder)', async () => {
  const calm = clone(SOURCES);
  calm.hello.runs = [calm.hello.runs[1]];
  calm.history.pipelines = calm.history.pipelines.filter((p) => p.status !== 'paused');
  calm.schedules.tickets = calm.schedules.tickets.filter((t) => t.status !== 'missed');
  calm.schedules.counts.missed = 0;
  calm.projects.projects = calm.projects.projects.filter((p) => p.exists && p.key !== 'api-2');
  const { w, d, hello } = await liveHost({ sources: calm });
  await hello();
  assert.equal(bellN(d), null);
  w.RailPulse.open('updates');
  const unread = d.querySelectorAll('#app .pz-popover [data-open]').length;
  assert.ok(unread > 0);
  assert.match(d.querySelector('[data-pop]').title, new RegExp(`${unread} unread`));
  assert.equal(d.title, 'Worca');
});

test('the strip, Pulse\'s tabs and sections equal their rows, and each opens what it counts', async () => {
  const { w, d, hello } = await liveHost();
  await hello();
  const mini = (p) => d.querySelector(`[data-mini="${p}"]`).getAttribute('aria-label');
  assert.match(mini('runs'), new RegExp(`· ${TASK_NEEDS + MISSED} need you`), 'Tasks: the tasks and the missed time that need you');
  assert.match(mini('chat'), new RegExp(`· ${SOURCES.threads.counts.needs} need`), 'Chats: counts.needs of the threads');
  d.querySelector('[data-mini="runs"]').click(); await settle();
  assert.equal(w.location.hash, '#runs');
  d.querySelector('[data-mini="chat"]').click(); await settle();
  assert.equal(w.location.hash, '#chat');
  d.querySelector('[data-mini="schedules"]').click(); await settle();
  assert.equal(w.location.hash, '#schedules');
  d.querySelector('[data-pop]').click();
  const pop = () => d.querySelector('#app .pz-popover');
  assert.equal(pop().querySelector('[data-ptab="vitals"]').getAttribute('aria-selected'), 'true', 'the bell opens Now');
  const tabN = (id) => +pop().querySelector(`[data-ptab="${id}"]`).textContent.replace(/\D+/g, ' ').trim().split(' ').pop();
  const secs = [...pop().querySelectorAll('.pz-sec')];
  let rows = 0;
  for (const s of secs) { const n = +s.querySelector('.pz-h .n').textContent.split(' ')[0]; const r = s.querySelectorAll('[data-open], [data-row]').length; assert.equal(new Set([...s.querySelectorAll('[data-open]')].map((x) => x.dataset.open)).size, n, s.querySelector('.pz-h').textContent); rows += n; void r; }
  assert.equal(tabN('vitals'), rows, 'Now counts its rows');
  assert.equal(+secs[0].querySelector('.pz-h .n').textContent.split(' ')[0], BELL, 'Needs you holds the bell\'s rows');
  pop().querySelector('[data-ptab="updates"]').click();
  assert.equal(tabN('updates'), new Set([...pop().querySelectorAll('[data-open]')].map((x) => x.dataset.open)).size, 'Updates counts its rows');
  pop().querySelector('[data-ptab="vitals"]').click();
  pop().querySelector('[data-open="r:run-a"]').click(); await settle();
  assert.equal(w.location.hash, '#run/question', 'a Needs-you row opens its task');
  assert.match(d.getElementById('route-today').textContent, /Ask me/);
  assert.match(d.getElementById('route-today').textContent, /No task details yet\./);
  for (const n of DEMO_NAMES) assert.ok(!d.getElementById('route-today').textContent.includes(n), `no seeded ${n}`);
});

test('the spend card shows windowSpendUsd; #insights/spend shows its empty look, no seeded title', async () => {
  const { w, d, hello } = await liveHost();
  await hello();
  d.querySelector('[data-acct]').click();
  d.querySelector('[data-sub="usage"]').click();
  assert.match(d.querySelector('.spend-card').textContent, /\$12\.50/);
  w.location.hash = '#insights/spend'; await settle();
  assert.equal(d.getElementById('route-place').hidden, true);
  assert.match(d.getElementById('route-today').textContent, /No insights yet\./);
  for (const n of DEMO_NAMES) assert.ok(!d.getElementById('route-today').textContent.includes(n), `no seeded ${n}`);
});

test('only the adapter writes: set, remove and taskGone change nothing; the Tasks list draws no selection bar', async () => {
  const { w, d, hello } = await liveHost();
  await hello();
  const before = store(w);
  w.RailWorld.set('every');
  w.RailWorld.remove('run-a');
  w.RailShell.taskGone('question', 'Ask me');
  assert.deepEqual(store(w), before);
  w.location.hash = '#runs'; await settle();
  const row = d.querySelector('#bar-tasks [data-open]');
  assert.ok(row, 'the Tasks list draws its rows');
  row.dispatchEvent(new w.MouseEvent('click', { bubbles: true, metaKey: true, ctrlKey: true }));
  await settle();
  assert.equal(d.querySelector('#bar-tasks [data-bulk], #bar-tasks .sel-bar, #bar-tasks .selection-bar'), null);
});

const REFUSE = { error: 'not now' };
async function refusalHost() {
  const h = await liveHost({ post: () => [409, REFUSE] });
  await h.hello();
  return h;
}

test('every Step 5 action, refused: one toast "Could not ACTION: REASON", the store deep-equal, a toggle keeps its value', async () => {
  const { w, d, posts } = await refusalHost();
  const pop = () => d.querySelector('#app .pz-popover');
  const cases = [
    ['Resume', () => { w.RailPulse.open('updates'); pop().querySelector('[data-fix="oh1"]').click(); }, 'resume', '/api/resume'],
    ['Try again', () => { w.RailPulse.open('updates'); pop().querySelector('[data-fix="oh3"]').click(); }, 'try again', '/api/resume'],
    ['Run now', () => { w.RailPulse.open('updates'); pop().querySelector('[data-fix="n7"]').click(); }, 'run now', '/api/schedules/tk1/run-now'],
    ['Stop', () => { w.RailPulse.open('now'); pop().querySelector('[data-act-stop="i1"]').click(); }, 'stop Dev server :4417', '/api/actions/instances/i1/stop'],
    ['Mark read', () => { w.RailPulse.open('updates'); pop().querySelector('[data-open="n7"]').click(); }, 'mark it read', '/api/notifications/7/read'],
    ['Mark all read', () => { w.RailPulse.open('updates'); pop().querySelector('[data-menu="more"]').click(); d.querySelector('[data-menu-pick="more|allread"], [data-pick="more|allread"]').click(); }, 'mark all read', '/api/notifications/read-all'],
    ['Interface mode', () => { openAcct(d); d.querySelector('[data-sub="lvl"]').click(); d.querySelector('#app [data-level="simple"]').click(); }, 'change the interface mode', '/api/settings'],
    ['Keep awake', () => { openAcct(d); d.querySelector('[data-sw="keep"]').click(); }, 'change Keep awake', '/api/settings'],
    ['Away', () => { openAcct(d); d.querySelector('[data-sw="away"]').click(); }, 'change Away', '/api/settings'],
  ];
  for (const [name, act, what, url] of cases) {
    const before = store(w), mode = w.RailUI.prefs.mode(), n = posts.length;
    w.location.hash = '#chat'; await settle();
    act(); await settle();
    assert.equal(posts.length, n + 1, `${name}: one post`);
    assert.equal(posts.at(-1).url, url, name);
    assert.equal(toastText(d), `Could not ${what}: ${REFUSE.error}`, name);
    assert.deepEqual(store(w), before, `${name}: the store is unchanged`);
    assert.equal(w.RailUI.prefs.mode(), mode, `${name}: the mode is unchanged`);
    if (name === 'Keep awake') { openAcct(d); assert.equal(d.querySelector('[data-sw="keep"]').getAttribute('aria-checked'), 'true', 'Keep awake stays on'); }
    w.document.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  }
});

test('every Step 5 action posts dev\'s route and body; no "Would…" in the app host', async () => {
  let would = 0;
  const { w, d, posts, hello } = await liveHost({ post: (url) => [200, url === '/api/settings' ? { uiLevel: 'simple', keepAwake: false } : { ok: true }] });
  await hello();
  const wrap = w.RailWould; w.RailWould = (p) => { would++; return wrap(p); };
  const pop = () => d.querySelector('#app .pz-popover');
  w.RailPulse.open('updates'); pop().querySelector('[data-fix="oh1"]').click(); await settle();
  w.RailPulse.open('updates'); pop().querySelector('[data-fix="n7"]').click(); await settle();
  w.RailPulse.open('now'); pop().querySelector('[data-act-stop="i1"]').click(); await settle();
  openAcct(d); d.querySelector('[data-sw="keep"]').click(); await settle();
  openAcct(d); d.querySelector('[data-sw="away"]').click(); await settle();
  assert.deepEqual(posts.map((p) => [p.url, p.body]), [
    ['/api/resume', { pipelineId: 'h1', baseCheck: true }],
    ['/api/schedules/tk1/run-now', {}],
    ['/api/actions/instances/i1/stop', {}],
    ['/api/settings', { keepAwake: false }],
    ['/api/settings', { nightModeToggle: 'on' }],
  ]);
  assert.match(toastText(d), /^Away: /);
  assert.equal(would, 0);
});

test('a resume that dev answers with a confirm opens the task instead', async () => {
  const { w, d, hello } = await liveHost({ post: () => [409, { code: 'base-moved', error: 'the base moved' }] });
  await hello();
  w.RailPulse.open('updates');
  d.querySelector('#app .pz-popover [data-fix="oh1"]').click(); await settle();
  assert.equal(w.location.hash, '#run/paused-restart');
  assert.match(d.getElementById('route-today').textContent, /Old pause/);
});

test('a failed first load: failed in the bar and in Pulse; Try again in Pulse and in the bar list retry and then show the rows', async () => {
  let down = true;
  const { w, d, sockets, hello } = await liveHost({ getStatus: (u) => (down && u === URLS.budget ? 500 : 200) });
  await settle();
  assert.equal(w.RailDemoState.list, 'failed');
  assert.match(d.getElementById('bar-chat').textContent, /Could not load the chats/);
  w.RailPulse.open('now');
  assert.match(d.querySelector('#app .pz-popover').textContent, /Could not load the updates/);
  let retried = 0; const real = w.RailAdapter.retry; w.RailAdapter.retry = () => { retried++; return real(); };
  d.querySelector('#app .pz-popover [data-pulse-retry]').click();
  assert.equal(retried, 1);
  await settle();
  [...d.querySelectorAll('#bar-chat button')].find((b) => b.textContent.trim() === 'Try again').click();
  assert.equal(retried, 2);
  down = false;
  w.RailAdapter.retry(); await settle();
  assert.ok(sockets.length >= 1);
  await hello();
  assert.equal(w.RailDemoState.list, '');
  assert.equal(bellN(d), BELL);
  assert.ok(d.querySelector('#bar-chat [data-open]'), 'the chats show');
});

test('the mode: the stamp wins over localStorage, nothing posted at start; a pick posts uiLevel once; a refusal restores the confirmed level', async () => {
  let answer = [200, { uiLevel: 'advanced' }];
  const { w, d, posts, hello } = await liveHost({ level: 'expert', post: () => answer, before: (win) => win.localStorage.setItem('worca-rail.mode', 'simple') });
  await hello();
  assert.equal(w.RailUI.prefs.mode(), 'expert');
  assert.equal(posts.length, 0);
  const pick = (lvl) => { if (!d.querySelector('#app .acct-menu')) d.querySelector('[data-acct]').click(); if (!d.querySelector('#app [data-level]')) d.querySelector('[data-sub="lvl"]').click(); d.querySelector(`#app [data-level="${lvl}"]`).click(); };
  pick('advanced'); await settle();
  assert.deepEqual(posts.map((p) => [p.url, p.body]), [['/api/settings', { uiLevel: 'advanced' }]]);
  assert.equal(w.RailUI.prefs.mode(), 'advanced');
  assert.equal(toastText(d), 'Interface mode: Advanced');
  answer = [400, { error: 'uiLevel is locked by your team' }];
  pick('simple'); await settle();
  assert.equal(posts.length, 2, 'one post for the refused pick, no second');
  assert.equal(w.RailUI.prefs.mode(), 'advanced');
  assert.equal(toastText(d), 'Could not change the interface mode: uiLevel is locked by your team');
  assert.equal(w.localStorage.getItem('worca-rail.mode'), 'simple', 'the live kind never writes the demo\'s mode');
});
