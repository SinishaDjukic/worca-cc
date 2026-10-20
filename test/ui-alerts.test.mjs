// test/ui-alerts.test.mjs — Alerts wired into app.js (ui/public/alerts.mjs): the hello backfill
// sets the badge but never notifies (D7), a live question notifies while the tab is hidden and its
// resolution closes it, a schedule problem notifies, a click focuses the window and opens the run,
// unread problems from /api/counts join the badge, and the Settings card is wired and survives a
// throwing localStorage.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import { useDomRelease } from './helpers/jsdom-release.mjs';
import { RUN_STATE_ROWS } from './helpers/run-states.mjs';

const trackDom = useDomRelease(afterEach);

const htmlPath = fileURLToPath(new URL('../ui/public/index.html', import.meta.url));
const appPath = fileURLToPath(new URL('../ui/public/app.js', import.meta.url));

function fakeNotification(permission = 'granted') {
  class N {
    constructor(title, opts = {}) { this.title = title; this.body = opts.body; this.tag = opts.tag; this.closed = false; N.shown.push(this); }
    close() { this.closed = true; }
  }
  N.shown = [];
  N.permission = permission;
  N.requests = 0;
  N.requestPermission = () => { N.requests += 1; return Promise.resolve(N.permission); };
  return N;
}

// `route(url)` may answer a request first (a Response-like object); undefined falls through to the stubs below.
async function boot({ alertsOn = true, unread = 0, storage = null, setup = null, url: pageUrl = 'http://localhost:4317/', route = null } = {}) {
  const dom = trackDom(new JSDOM(readFileSync(htmlPath, 'utf8'), { url: pageUrl }));
  const { window } = dom;
  window.Element.prototype.scrollIntoView = function () {};
  const wsBox = { ws: null };
  window.WebSocket = class {
    constructor() { this.readyState = 1; this._listeners = {}; wsBox.ws = this; }
    send() {} close() {}
    addEventListener(type, fn) { (this._listeners[type] ||= []).push(fn); }
    dispatch(type, evt) { (this._listeners[type] || []).forEach((fn) => fn(evt)); }
  };
  window.fetch = (url) => {
    const u = String(url);
    const own = route ? route(u) : undefined;
    if (own !== undefined) return Promise.resolve({ ok: true, status: 200, json: async () => own });
    if (u.includes('/api/counts'))
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ schedules: { scheduled: 0, missed: 0, recurring: 0, unread } }) });
    if (u.includes('/api/projects'))
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ projects: [] }) });
    return Promise.resolve({ ok: true, status: 200, json: async () => ({ config: { steps: {}, customModels: [] }, models: [], efforts: [] }) });
  };
  if (storage) Object.defineProperty(window, 'localStorage', { configurable: true, value: storage });
  else if (alertsOn) window.localStorage.setItem('worca-cc.alerts.notify', '1');
  const N = fakeNotification();
  window.Notification = N;
  const look = { visible: false };
  Object.defineProperty(window.document, 'visibilityState', { configurable: true, get: () => (look.visible ? 'visible' : 'hidden') });
  window.document.hasFocus = () => look.visible;
  let focused = 0;
  window.focus = () => { focused += 1; };
  if (setup) setup(window);   // before app.js loads: what its module-load wiring captures (navigator)
  for (const k of ['window', 'document', 'location', 'localStorage', 'WebSocket', 'fetch', 'navigator']) {
    try { Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true }); } catch { /* keep */ }
  }
  globalThis.window = window; globalThis.document = window.document;
  await import(pathToFileURL(appPath).href + `?b=${Date.now()}_${Math.random()}`);
  const tick = () => new Promise((r) => setTimeout(r, 0));
  await tick();
  const recv = (obj) => wsBox.ws.dispatch('message', { data: JSON.stringify(obj) });
  const $ = (sel) => window.document.querySelector(sel);
  return { window, N, look, tick, recv, $, focused: () => focused };
}

const HELLO = (runs) => ({ type: 'hello', runs });

test('hello backfill sets the badge but does not notify; a live question notifies, its resolution closes it and clears the badge', async () => {
  const { window, N, look, tick, recv } = await boot();
  look.visible = true;                                                        // the page someone opened
  recv(HELLO([{ runId: 'r1', title: 'Backfilled run', status: 'paused', pendingQuestion: { id: 'q1', kind: 'gate' } }]));
  recv({ type: 'question', runId: 'r1', id: 'q1', kind: 'gate', seq: 1 });   // the subscribe replay
  await tick();
  look.visible = false;
  assert.equal(N.shown.length, 0, 'D7: nothing that was already pending notifies');
  assert.equal(window.document.title, '(1) Worca');

  recv({ type: 'run-created', runId: 'r2', title: 'Live run', status: 'running' });
  recv({ type: 'question', runId: 'r2', id: 'q2', kind: 'questions', seq: 1, questions: [{ question: 'SECRET?' }] });
  await tick();
  assert.equal(N.shown.length, 1);
  // §5a.5: the title names the run; the body is its list row's status line.
  assert.equal(N.shown[0].title, 'Worca: Live run');
  assert.equal(N.shown[0].body, 'Needs you · 1 question');
  assert.equal(N.shown[0].tag, 'worca:r2:q2');
  assert.equal(window.document.title, '(2) Worca');

  recv({ type: 'question-resolved', runId: 'r2', id: 'q2', seq: 2 });
  await tick();
  assert.equal(N.shown[0].closed, true);
  assert.equal(window.document.title, '(1) Worca');
});

test('a reconnect hello notifies a wait raised while the socket was down, once; one already seen does not notify again', async () => {
  const { N, look, tick, recv } = await boot();
  look.visible = true;
  recv(HELLO([{ runId: 'r1', title: 'Old wait', status: 'paused', pendingQuestion: { id: 'q1', kind: 'gate' } }]));
  look.visible = false;
  recv({ type: 'run-created', runId: 'r2', title: 'Live run', status: 'running' });
  recv({ type: 'question', runId: 'r2', id: 'q2', kind: 'gate', seq: 1 });
  await tick();
  assert.equal(N.shown.length, 1, 'only the live question notified');

  // The socket drops; r3 starts waiting meanwhile. The reconnect hello lists all three.
  recv(HELLO([
    { runId: 'r1', title: 'Old wait', status: 'paused', pendingQuestion: { id: 'q1', kind: 'gate' } },
    { runId: 'r2', title: 'Live run', status: 'paused', pendingQuestion: { id: 'q2', kind: 'gate' } },
    { runId: 'r3', title: 'Waited while down', status: 'paused', pendingQuestion: { id: 'q3', kind: 'recovery' } },
  ]));
  recv({ type: 'question', runId: 'r3', id: 'q3', kind: 'recovery', seq: 1 });   // the subscribe replay
  await tick();
  assert.equal(N.shown.length, 2, 'exactly one new notification');
  assert.equal(N.shown[1].tag, 'worca:r3:q3');
  assert.equal(N.shown[1].title, 'Worca: Waited while down');
  assert.equal(N.shown[1].body, 'Needs you · a step failed');
});

test('a reconnect hello that no longer lists a pending question closes its notification', async () => {
  const { N, tick, recv } = await boot();
  recv(HELLO([]));
  recv({ type: 'run-created', runId: 'r7', title: 'Answered elsewhere', status: 'running' });
  recv({ type: 'question', runId: 'r7', id: 'q7', kind: 'gate', seq: 1 });
  await tick();
  assert.equal(N.shown.length, 1);
  recv(HELLO([{ runId: 'r7', title: 'Answered elsewhere', status: 'running', pendingQuestion: null }]));
  await tick();
  assert.equal(N.shown[0].closed, true);
});

test('a run paused on a usage limit notifies and joins the badge; stopping it closes the notification', async () => {
  const { window, N, tick, recv } = await boot();
  recv(HELLO([]));
  recv({ type: 'run-created', runId: 'r1', title: 'Limited run', status: 'running' });
  recv({ type: 'done', runId: 'r1', status: 'paused', reason: 'usage_limit', detail: "You've hit your session limit", limitEngine: 'claude' });
  await tick();
  assert.equal(N.shown.length, 1);
  assert.equal(N.shown[0].title, 'Worca: Limited run');
  assert.equal(N.shown[0].body, 'Paused · usage limit', 'the status line, never the limit detail');
  assert.equal(window.document.title, '(1) Worca');
  recv({ type: 'done', runId: 'r1', status: 'stopped' });
  await tick();
  assert.equal(N.shown[0].closed, true);
  assert.equal(window.document.title, 'Worca');
});

test('a page that loads hidden notifies what is already waiting; one that loads looked at holds a live wait until the person looks away', async () => {
  const a = await boot();
  a.recv(HELLO([{ runId: 'r1', title: 'Waiting in a background tab', status: 'paused', pendingQuestion: { id: 'q1', kind: 'workflow' } }]));
  await a.tick();
  assert.deepEqual(a.N.shown.map((n) => n.title), ['Worca: Waiting in a background tab'], 'a background reload does not swallow it');

  const b = await boot();
  b.look.visible = true;
  b.recv(HELLO([]));
  b.recv({ type: 'run-created', runId: 'r2', title: 'Live run', status: 'running' });
  b.recv({ type: 'question', runId: 'r2', id: 'q2', kind: 'workflow', seq: 1 });
  await b.tick();
  assert.equal(b.N.shown.length, 0, 'nothing while the person is looking');
  b.look.visible = false;
  b.window.document.dispatchEvent(new b.window.Event('visibilitychange'));
  assert.deepEqual(b.N.shown.map((n) => n.tag), ['worca:r2:q2'], 'it notifies when they switch away');
});

test('a Chat card waiting for an OK notifies; a click opens that chat; applying it closes the notification', async () => {
  const { window, N, tick, recv } = await boot();
  recv(HELLO([]));
  recv({ type: 'ask-card', threadId: 'ask_0000abcd', messageId: 'm1', seq: 3, block: { kind: 'card', id: 'c1', state: 'proposed', card: { workflowId: 'wf_default', brief: 'SECRET brief' } } });
  await tick();
  assert.equal(N.shown.length, 1);
  assert.equal(N.shown[0].title, 'Worca: Chat: run to approve');
  assert.equal(N.shown[0].body, 'Open the chat to review it.');
  N.shown[0].onclick({ preventDefault() {} });
  await tick();
  await tick();
  assert.equal(window.location.hash, '#chat/ask_0000abcd', 'the click opens that chat on the Chat page');
  assert.ok(window.document.body.classList.contains('view-chat'), 'the Chat page shows');
  assert.equal(window.localStorage.getItem('worca-cc.ask.thread'), 'ask_0000abcd', 'on that chat');
  recv({ type: 'ask-card', threadId: 'ask_0000abcd', block: { kind: 'card', id: 'c2', state: 'proposed', card: { type: 'web' } } });
  recv({ type: 'ask-message', threadId: 'ask_0000abcd', message: { id: 'm1', blocks: [{ kind: 'card', id: 'c2', state: 'applied', card: { type: 'web' } }] } });
  await tick();
  assert.equal(N.shown[1].closed, true);
});

test('a paused run on page load counts on the badge without notifying; a manual pause does not notify; the title counts it as the sidebar does', async () => {
  const { window, N, look, tick, recv } = await boot();
  look.visible = true;
  recv(HELLO([
    { runId: 'r1', title: 'Already limited', status: 'paused', pauseReason: 'usage_limit' },
    { runId: 'r2', title: 'Paused by hand', status: 'paused', pauseReason: null },
  ]));
  await tick();
  look.visible = false;
  assert.equal(N.shown.length, 0);
  // D25: the title says the sidebar's number (runsNeedsCount), which counts every paused run.
  assert.equal(window.document.title, '(2) Worca');
  recv({ type: 'run-created', runId: 'r3', title: 'Paused again', status: 'running' });
  recv({ type: 'done', runId: 'r3', status: 'paused', reason: null });
  await tick();
  assert.equal(N.shown.length, 0);
});

test('a reconnect hello notifies a pause that happened while the socket was down', async () => {
  const { N, tick, recv } = await boot();
  recv(HELLO([{ runId: 'r1', title: 'Running', status: 'running' }]));
  recv(HELLO([{ runId: 'r1', title: 'Running', status: 'paused', pauseReason: 'cost_total' }]));
  await tick();
  assert.equal(N.shown.length, 1);
  assert.equal(N.shown[0].title, 'Worca: Running');
  assert.equal(N.shown[0].body, 'Paused · total budget');
});

test('no notification while the tab is visible and focused; the badge still counts', async () => {
  const { window, N, look, tick, recv } = await boot();
  look.visible = true;
  recv(HELLO([]));
  recv({ type: 'question', runId: 'r3', id: 'q3', kind: 'gate', seq: 1 });
  await tick();
  assert.equal(N.shown.length, 0);
  assert.equal(window.document.title, '(1) Worca');
});

test('click: focuses the window and opens the run detail; a schedule problem opens the scheduled runs view', async () => {
  const { window, N, tick, recv, focused } = await boot();
  recv(HELLO([]));
  recv({ type: 'run-created', runId: 'r4', title: 'Clicky', status: 'running' });
  recv({ type: 'question', runId: 'r4', id: 'q4', kind: 'recovery', seq: 1 });
  await tick();
  assert.equal(N.shown[0].title, 'Worca: Clicky');
  N.shown[0].onclick({ preventDefault() {} });
  assert.equal(focused(), 1);
  assert.equal(window.location.hash, '#running/r4');
  assert.equal(N.shown[0].closed, true);

  recv({ type: 'notification', notification: { id: 9, severity: 'problem', title: 'Nightly deps bump' } });
  recv({ type: 'notification', notification: { id: 10, severity: 'info', title: 'Ran fine' } });
  await tick();
  assert.equal(N.shown.length, 2);
  assert.equal(N.shown[1].title, 'Worca: Scheduled run needs attention');
  N.shown[1].onclick({ preventDefault() {} });
  assert.equal(window.location.hash, '#schedules');
});

test('unread schedule problems mark the favicon and the app badge, not the title', async () => {
  const badges = [];
  // jsdom draws no canvas, so the favicon's dot is observed through the app badge it travels with (applyBadge).
  const { window, tick, recv } = await boot({ unread: 2, setup: (w) => { w.navigator.setAppBadge = (n) => { badges.push(n); }; } });
  recv(HELLO([]));
  await tick(); await tick(); await tick();
  assert.equal(window.document.title, 'Worca', 'problems are not runs that need you (D25)');
  assert.equal(badges.at(-1), 2, 'the problems still badge the app');
});

test('Alerts never turned on: no notification and no badge', async () => {
  const { window, N, tick, recv } = await boot({ alertsOn: false });
  recv(HELLO([{ runId: 'r1', title: 'x', status: 'paused', pendingQuestion: { id: 'q1', kind: 'gate' } }]));
  recv({ type: 'question', runId: 'r5', id: 'q5', kind: 'gate', seq: 1 });
  await tick();
  assert.equal(N.shown.length, 0);
  assert.equal(window.document.title, 'Worca');
});

test('the Settings card is wired at boot without asking for permission', async () => {
  const { window, N, $ } = await boot({ alertsOn: false });
  assert.equal(N.requests, 0);
  assert.equal($('#alertsNotify').checked, false);
  assert.equal($('#alertsTest').disabled, true);
  $('#alertsNotify').checked = true;
  $('#alertsNotify').dispatchEvent(new window.Event('change', { bubbles: true }));
  assert.equal(N.requests, 1, 'asked on the click');
});

test('a localStorage that throws on the Alerts keys does not break the page', async () => {
  // Only the Alerts keys throw: other app.js readers (Team policy's scope) are not ours to guard.
  const mem = new Map();
  const guard = (k) => { if (String(k).startsWith('worca-cc.alerts.')) throw new Error('SecurityError'); };
  const bad = {
    getItem(k) { guard(k); return mem.has(k) ? mem.get(k) : null; },
    setItem(k, v) { guard(k); mem.set(k, String(v)); },
    removeItem(k) { guard(k); mem.delete(k); },
  };
  const { window, N, tick, recv, $ } = await boot({ storage: bad });
  recv(HELLO([]));
  recv({ type: 'question', runId: 'r6', id: 'q6', kind: 'gate', seq: 1 });
  await tick();
  assert.equal(N.shown.length, 0);
  assert.equal(window.document.title, 'Worca');
  assert.ok($('#alerts-card'));
});

// §5a.5: the alert says what the Runs list says, and opens what the row opens.
const NEEDS = RUN_STATE_ROWS.find((r) => r.state === 'needs-you').run;
const stateFrame = (over = {}) => ({ type: 'state', runId: 'r1', id: 'p1', status: NEEDS.status, stepper: NEEDS.stepper, steps: NEEDS.steps,
  active: NEEDS.active, endReached: NEEDS.endReached, tokens: NEEDS.tokens, progressFacts: NEEDS.progressFacts, subAgents: [], totalCostUsd: 1, ...over });

test("a Needs you alert's text equals the list row's status line, and its click opens what the row opens", async () => {
  const FEATURE = { id: 'feat_1', kind: 'feature', title: 'Run tags', projectKey: null, planning: null, cost: { usd: 0, byPipeline: {} }, members: [
    { position: 1, title: 'Store tags', pipelineId: 'p0', ticketId: null, status: 'done', pr: null, ticket: null, adhoc: false, after: null },
    { position: 2, title: 'Fix the login bug', pipelineId: 'p1', ticketId: null, status: 'running', pr: null, ticket: null, adhoc: false, after: 1 },
    { position: 3, title: 'Cost report', pipelineId: null, ticketId: 't3', status: null, pr: null, ticket: { id: 't3', status: 'scheduled', runAt: null, after: true }, adhoc: false, after: 2 }] };
  for (const [name, groups, rowSel, hrefRe] of [
    ['a single run', [], '#runs-list .runs-row[data-run-id="r1"]', /^#running\/r1$/],
    ['a feature member', [FEATURE], '#runs-list .runs-item[data-row-key="chain:feat_1"] > a.runs-row', /^#feature\/feat_1$/],
  ]) {
    const route = (u) => (u.endsWith('/api/history') ? { pipelines: [] } : u.endsWith('/api/run-groups') ? { groups } : undefined);
    const { window, N, look, tick, recv } = await boot({ url: 'http://localhost:4317/#runs', route });
    look.visible = true;
    recv(HELLO([{ runId: 'r1', pipelineId: 'p1', title: 'Fix the login bug', projectDir: '/tmp/p', status: 'running', kind: 'run', startedAt: '2026-01-01T00:00:00Z' }]));
    for (let i = 0; i < 4; i++) await tick();
    look.visible = false;
    recv(stateFrame());
    recv({ type: 'question', runId: 'r1', seq: 1, ...NEEDS.pendingQuestion });
    for (let i = 0; i < 4; i++) await tick();
    const row = window.document.querySelector(rowSel);
    assert.ok(row, `${name}: the list row`);
    assert.equal(row.dataset.state, 'needs-you', `${name}: the row needs you`);
    assert.equal(N.shown.length, 1, `${name}: one alert`);
    assert.equal(N.shown[0].title, 'Worca: Fix the login bug');
    assert.equal(N.shown[0].body, row.dataset.line, `${name}: the alert body is the row's status line`);
    N.shown[0].onclick({ preventDefault() {} });
    assert.match(row.getAttribute('href'), hrefRe);
    assert.equal(window.location.hash, row.getAttribute('href'), `${name}: the click opens what the row opens`);
  }
});
