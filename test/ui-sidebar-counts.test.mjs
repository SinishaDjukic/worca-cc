// test/ui-sidebar-counts.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
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
  await import(appPath + `?b=${Date.now()}_${Math.random()}`);
  await new Promise((r) => setTimeout(r, 0));
  if (wsBox.ws) wsBox.ws._open();
  await new Promise((r) => setTimeout(r, 0));
  return { window, wsBox, calls, box };
}

test('boot seeds ALL four badges from /api/counts (Workspaces no longer stuck at 0)', async () => {
  const { window } = await boot({ counts: { pipelines: 7, projects: 3, workspaces: 2 } });
  const doc = window.document;
  assert.equal(doc.querySelector('#nav-history-count').textContent, '7');
  assert.equal(doc.querySelector('#nav-projects-count').textContent, '3');
  assert.equal(doc.querySelector('#nav-workspaces-count').textContent, '2');
});

test('a projects-changed broadcast re-reads /api/counts and updates the badge', async () => {
  const { window, wsBox, calls, box } = await boot({ counts: { pipelines: 0, projects: 1, workspaces: 0 } });
  const doc = window.document;
  assert.equal(doc.querySelector('#nav-projects-count').textContent, '1');

  box.counts = { pipelines: 0, projects: 2, workspaces: 0 };   // server now reports 2
  const before = calls.filter((u) => u.includes('/api/counts')).length;
  wsBox.ws.dispatch('message', { data: JSON.stringify({ type: 'projects-changed', action: 'created' }) });
  await new Promise((r) => setTimeout(r, 5));

  assert.ok(calls.filter((u) => u.includes('/api/counts')).length > before, 're-read /api/counts');
  assert.equal(doc.querySelector('#nav-projects-count').textContent, '2');
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
