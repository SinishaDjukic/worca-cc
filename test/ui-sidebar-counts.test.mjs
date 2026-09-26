// test/ui-sidebar-counts.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { JSDOM } from 'jsdom';

const __dirname = dirname(fileURLToPath(import.meta.url));
const htmlPath = join(__dirname, '../ui/public/index.html');
const appPath = join(__dirname, '../ui/public/app.js');

// Inbound-frame WS stub: captures the socket so a test can deliver a server broadcast
// to the live app.js handler (mirrors test/ui-history-pr-phase.test.mjs).
function makeWsStub(wsBox) {
  return class {
    constructor() { this.readyState = 1; this._l = {}; wsBox.ws = this; }
    send() {} close() {}
    addEventListener(t, fn) { (this._l[t] ||= []).push(fn); }
    dispatch(t, evt) { (this._l[t] || []).forEach((fn) => fn(evt)); }
    _open() { this.dispatch('open', {}); }
  };
}

async function boot({ counts = { pipelines: 0, projects: 0, workspaces: 0 }, hash = '' } = {}) {
  const calls = [];
  const box = { counts };                                 // mutable so a test can change the server's reply
  const dom = new JSDOM(readFileSync(htmlPath, 'utf8'), { url: `http://localhost:4321/#${hash}` });
  const { window } = dom;
  const wsBox = {};
  window.Element.prototype.scrollIntoView = function () {};
  window.WebSocket = makeWsStub(wsBox);
  window.confirm = () => true;
  window.requestAnimationFrame = (fn) => setTimeout(fn, 0);
  window.fetch = (url) => {
    const u = String(url); calls.push(u);
    if (u.includes('/api/counts')) return Promise.resolve({ ok: true, status: 200, json: async () => box.counts });
    if (u.includes('/api/projects')) return Promise.resolve({ ok: true, status: 200, json: async () => ({ projects: [] }) });
    if (u.includes('/api/workspaces')) return Promise.resolve({ ok: true, status: 200, json: async () => ({ workspaces: [] }) });
    if (u.includes('/api/history')) return Promise.resolve({ ok: true, status: 200, json: async () => ({ pipelines: [], ghAvailable: false }) });
    return Promise.resolve({ ok: true, status: 200, json: async () => ({ config: { steps: {}, customModels: [] }, models: [], efforts: [], branches: [], workspaces: [], agents: [], channels: [] }) });
  };
  for (const k of ['window', 'document', 'location', 'localStorage', 'WebSocket', 'fetch', 'navigator', 'requestAnimationFrame']) {
    try { Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true }); } catch { /* ignore */ }
  }
  globalThis.window = window; globalThis.document = window.document;
  await import(pathToFileURL(appPath).href + `?b=${Date.now()}_${Math.random()}`);
  await new Promise((r) => setTimeout(r, 0));
  if (wsBox.ws) wsBox.ws._open();
  await new Promise((r) => setTimeout(r, 0));
  return { window, wsBox, calls, box };
}

// Only Running and Schedules carry a number in the main menu; every other entry is a
// bare label, whatever /api/counts reports.
const navButton = (doc, nav) => doc.querySelector(`.nav button[data-nav="${nav}"]`);

test('only Running and Schedules carry a count badge in the sidebar markup', () => {
  const doc = new JSDOM(readFileSync(htmlPath, 'utf8')).window.document;
  const counted = [...doc.querySelectorAll('.nav button[data-nav]')]
    .filter((b) => b.querySelector('.nav-count'))
    .map((b) => b.dataset.nav);
  assert.deepEqual(counted, ['running', 'schedules']);
  for (const id of ['nav-history-count', 'nav-projects-count', 'nav-workspaces-count'])
    assert.equal(doc.getElementById(id), null, `#${id} is gone`);
});

test('boot paints Running + Schedules from /api/counts and no number on History/Projects/Workspaces', async () => {
  const { window } = await boot({
    counts: { pipelines: 7, projects: 3, workspaces: 2, schedules: { scheduled: 4, missed: 1, recurring: 0, unread: 0 } },
  });
  const doc = window.document;
  assert.equal(doc.querySelector('#nav-running-count').textContent, '0');
  assert.equal(doc.querySelector('#nav-schedules-count').textContent, '5');
  for (const nav of ['history', 'projects', 'workspaces']) {
    const b = navButton(doc, nav);
    assert.ok(b, `${nav} nav button present`);
    assert.equal(b.querySelector('.nav-count'), null, `${nav} has no count badge`);
    assert.doesNotMatch(b.textContent, /\d/, `${nav} shows no number`);
  }
});

test('a projects-changed broadcast re-reads /api/counts without adding a number to Projects', async () => {
  const { window, wsBox, calls, box } = await boot({ counts: { pipelines: 0, projects: 1, workspaces: 0 } });
  const doc = window.document;

  box.counts = { pipelines: 0, projects: 2, workspaces: 0 };   // server now reports 2
  const before = calls.filter((u) => u.includes('/api/counts')).length;
  wsBox.ws.dispatch('message', { data: JSON.stringify({ type: 'projects-changed', action: 'created' }) });
  await new Promise((r) => setTimeout(r, 5));

  assert.ok(calls.filter((u) => u.includes('/api/counts')).length > before, 're-read /api/counts');
  assert.doesNotMatch(navButton(doc, 'projects').textContent, /\d/, 'Projects shows no number');
});

test('pipelines-changed while on History reloads the list (cards reflect a delete)', async () => {
  const { wsBox, calls } = await boot({ counts: { pipelines: 1, projects: 0, workspaces: 0 }, hash: 'history' });
  const before = calls.filter((u) => u.includes('/api/history')).length;
  wsBox.ws.dispatch('message', { data: JSON.stringify({ type: 'pipelines-changed', action: 'deleted' }) });
  await new Promise((r) => setTimeout(r, 5));
  assert.ok(calls.filter((u) => u.includes('/api/history')).length > before, 'History view re-fetched its rows');
});

test('Running empty-state hides when a run appears (0 -> 1), no lingering placeholder', async () => {
  const { window, wsBox } = await boot({ counts: { pipelines: 0, projects: 0, workspaces: 0 }, hash: 'running' });
  const doc = window.document;

  wsBox.ws.dispatch('message', { data: JSON.stringify({ type: 'hello', runs: [] }) });
  await new Promise((r) => setTimeout(r, 0));
  assert.ok(doc.querySelector('#run-list .run-empty'), 'empty-state shown when no runs');

  wsBox.ws.dispatch('message', { data: JSON.stringify({ type: 'hello', runs: [{ runId: 'r1', status: 'running', title: 'Demo' }] }) });
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(doc.querySelector('#run-list .run-empty'), null, 'placeholder removed once a run is live');
  assert.ok(doc.querySelector('#run-list [data-run-id="r1"]'), 'live card rendered');
});

test('the Running badge counts pipelines only — a live workspace scan or agent generation is not a running pipeline', async () => {
  const { window, wsBox } = await boot();
  const doc = window.document;
  wsBox.ws.dispatch('message', { data: JSON.stringify({ type: 'hello', runs: [
    { runId: 'scan_x', scanId: 'scan_x', kind: 'scan', status: 'running', title: 'ws scan' },
    { runId: 'agen_x', genId: 'agen_x', kind: 'agentgen', status: 'running', title: 'agent gen' },
  ] }) });
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(doc.querySelector('#nav-running-count').textContent, '0');

  wsBox.ws.dispatch('message', { data: JSON.stringify({ type: 'hello', runs: [
    { runId: 'scan_x', scanId: 'scan_x', kind: 'scan', status: 'running', title: 'ws scan' },
    { runId: 'r1', status: 'running', title: 'Demo' },
  ] }) });
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(doc.querySelector('#nav-running-count').textContent, '1');
});
