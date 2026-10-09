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

async function boot({ alertsOn = true, unread = 0, storage = null } = {}) {
  const dom = trackDom(new JSDOM(readFileSync(htmlPath, 'utf8'), { url: 'http://localhost:4317/' }));
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
  const { window, N, tick, recv } = await boot();
  recv(HELLO([{ runId: 'r1', title: 'Backfilled run', status: 'paused', pendingQuestion: { id: 'q1', kind: 'gate' } }]));
  recv({ type: 'question', runId: 'r1', id: 'q1', kind: 'gate', seq: 1 });   // the subscribe replay
  await tick();
  assert.equal(N.shown.length, 0, 'D7: nothing that was already pending notifies');
  assert.equal(window.document.title, '(1) Worca CC');

  recv({ type: 'run-created', runId: 'r2', title: 'Live run', status: 'running' });
  recv({ type: 'question', runId: 'r2', id: 'q2', kind: 'questions', seq: 1, questions: [{ question: 'SECRET?' }] });
  await tick();
  assert.equal(N.shown.length, 1);
  assert.equal(N.shown[0].title, 'Worca: Questions waiting');
  assert.equal(N.shown[0].body, 'Live run');
  assert.equal(N.shown[0].tag, 'worca:r2:q2');
  assert.equal(window.document.title, '(2) Worca CC');

  recv({ type: 'question-resolved', runId: 'r2', id: 'q2', seq: 2 });
  await tick();
  assert.equal(N.shown[0].closed, true);
  assert.equal(window.document.title, '(1) Worca CC');
});

test('a reconnect hello notifies a wait raised while the socket was down, once; one already seen does not notify again', async () => {
  const { N, tick, recv } = await boot();
  recv(HELLO([{ runId: 'r1', title: 'Old wait', status: 'paused', pendingQuestion: { id: 'q1', kind: 'gate' } }]));
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
  assert.equal(N.shown[1].title, 'Worca: Recovery decision needed');
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
  assert.equal(N.shown[0].title, 'Worca: Usage limit reached');
  assert.equal(N.shown[0].body, 'Limited run', 'the body names the run, never the limit detail');
  assert.equal(window.document.title, '(1) Worca CC');
  recv({ type: 'done', runId: 'r1', status: 'stopped' });
  await tick();
  assert.equal(N.shown[0].closed, true);
  assert.equal(window.document.title, 'Worca CC');
});

test('a paused run on page load counts on the badge without notifying; a manual pause neither notifies nor counts', async () => {
  const { window, N, tick, recv } = await boot();
  recv(HELLO([
    { runId: 'r1', title: 'Already limited', status: 'paused', pauseReason: 'usage_limit' },
    { runId: 'r2', title: 'Paused by hand', status: 'paused', pauseReason: null },
  ]));
  await tick();
  assert.equal(N.shown.length, 0);
  assert.equal(window.document.title, '(1) Worca CC');
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
  assert.equal(N.shown[0].title, 'Worca: Cost cap reached');
});

test('no notification while the tab is visible and focused; the badge still counts', async () => {
  const { window, N, look, tick, recv } = await boot();
  look.visible = true;
  recv(HELLO([]));
  recv({ type: 'question', runId: 'r3', id: 'q3', kind: 'gate', seq: 1 });
  await tick();
  assert.equal(N.shown.length, 0);
  assert.equal(window.document.title, '(1) Worca CC');
});

test('click: focuses the window and opens the run detail; a schedule problem opens the scheduled runs view', async () => {
  const { window, N, tick, recv, focused } = await boot();
  recv(HELLO([]));
  recv({ type: 'run-created', runId: 'r4', title: 'Clicky', status: 'running' });
  recv({ type: 'question', runId: 'r4', id: 'q4', kind: 'recovery', seq: 1 });
  await tick();
  assert.equal(N.shown[0].title, 'Worca: Recovery decision needed');
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

test('unread schedule problems from /api/counts join the badge', async () => {
  const { window, tick, recv } = await boot({ unread: 2 });
  recv(HELLO([]));
  await tick(); await tick();
  assert.equal(window.document.title, '(2) Worca CC');
});

test('Alerts never turned on: no notification and no badge', async () => {
  const { window, N, tick, recv } = await boot({ alertsOn: false });
  recv(HELLO([{ runId: 'r1', title: 'x', status: 'paused', pendingQuestion: { id: 'q1', kind: 'gate' } }]));
  recv({ type: 'question', runId: 'r5', id: 'q5', kind: 'gate', seq: 1 });
  await tick();
  assert.equal(N.shown.length, 0);
  assert.equal(window.document.title, 'Worca CC');
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
  assert.equal(window.document.title, 'Worca CC');
  assert.ok($('#alerts-card'));
});
