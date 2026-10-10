// test/ui-sidebar-counts.test.mjs
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { JSDOM } from 'jsdom';
import { useDomRelease } from './helpers/jsdom-release.mjs';
import { checkRows } from './helpers/rows.mjs';

// Release each booted window after its test (see test/helpers/jsdom-release.mjs).
const trackDom = useDomRelease(afterEach);

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
  const dom = trackDom(new JSDOM(readFileSync(htmlPath, 'utf8'), { url: `http://localhost:4321/#${hash}` }));
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

// Only Runs and Schedules carry a number in the main menu; every other entry is a
// bare label, whatever /api/counts reports.
const navButton = (doc, nav) => doc.querySelector(`.nav button[data-nav="${nav}"]`);

test('boot paints Runs + Schedules from /api/counts (no number on Projects/Workspaces), and a projects-changed broadcast re-reads /api/counts', async () => {
  const { window, wsBox, calls, box } = await boot({
    counts: { pipelines: 7, projects: 3, workspaces: 2, schedules: { scheduled: 4, missed: 1, recurring: 0, unread: 0 } },
  });
  const doc = window.document;
  await checkRows([
    { name: 'boot paints Runs + Schedules from /api/counts and no number on Projects/Workspaces', run: async () => {
      assert.equal(doc.querySelector('#nav-running-count').textContent, '0');
      assert.equal(doc.querySelector('#nav-running-count').hidden, true, 'a zero is hidden');
      assert.equal(doc.querySelector('#nav-schedules-count').textContent, '5');
      assert.equal(doc.querySelector('#nav-schedules-count').hidden, false);
      for (const nav of ['projects', 'workspaces']) {
        const b = navButton(doc, nav);
        assert.ok(b, `${nav} nav button present`);
        assert.equal(b.querySelector('.nav-count'), null, `${nav} has no count badge`);
        assert.doesNotMatch(b.textContent, /\d/, `${nav} shows no number`);
      }
    } },
    { name: 'a projects-changed broadcast re-reads /api/counts without adding a number to Projects', run: async () => {
      box.counts = { pipelines: 0, projects: 2, workspaces: 0 };   // server now reports 2
      const before = calls.filter((u) => u.includes('/api/counts')).length;
      wsBox.ws.dispatch('message', { data: JSON.stringify({ type: 'projects-changed', action: 'created' }) });
      await new Promise((r) => setTimeout(r, 5));

      assert.ok(calls.filter((u) => u.includes('/api/counts')).length > before, 're-read /api/counts');
      assert.doesNotMatch(navButton(doc, 'projects').textContent, /\d/, 'Projects shows no number');
    } },
    { name: 'a Schedules count back at zero hides (the element keeps its number)', run: async () => {
      box.counts = { pipelines: 0, projects: 2, workspaces: 0, schedules: { scheduled: 0, missed: 0, recurring: 0, unread: 0 } };
      wsBox.ws.dispatch('message', { data: JSON.stringify({ type: 'projects-changed', action: 'deleted' }) });
      await new Promise((r) => setTimeout(r, 5));
      const n = doc.querySelector('#nav-schedules-count');
      assert.equal(n.textContent, '0');
      assert.equal(n.hidden, true);
    } },
  ]);
});

test('pipelines-changed while on Runs reloads the list (rows reflect a delete)', async () => {
  const { wsBox, calls } = await boot({ counts: { pipelines: 1, projects: 0, workspaces: 0 }, hash: 'runs' });
  const before = calls.filter((u) => u.includes('/api/history')).length;
  wsBox.ws.dispatch('message', { data: JSON.stringify({ type: 'pipelines-changed', action: 'deleted' }) });
  await new Promise((r) => setTimeout(r, 5));
  assert.ok(calls.filter((u) => u.includes('/api/history')).length > before, 'the Runs view re-fetched its finished rows');
});

test('the Runs empty note turns into a row when a run appears (0 -> 1), no lingering placeholder', async () => {
  const { window, wsBox } = await boot({ counts: { pipelines: 0, projects: 0, workspaces: 0 }, hash: 'runs' });
  const doc = window.document;

  wsBox.ws.dispatch('message', { data: JSON.stringify({ type: 'hello', runs: [] }) });
  await new Promise((r) => setTimeout(r, 0));
  const note = doc.querySelector('#runs-list .runs-note');
  assert.ok(note, 'empty note shown when no runs');
  assert.match(note.textContent, /^No runs yet/);
  assert.equal(doc.querySelectorAll('#runs-list .runs-row').length, 0);

  wsBox.ws.dispatch('message', { data: JSON.stringify({ type: 'hello', runs: [{ runId: 'r1', status: 'running', title: 'Demo' }] }) });
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(doc.querySelector('#runs-list .runs-note'), null, 'placeholder removed once a run is live');
  assert.ok(doc.querySelector('#runs-list .runs-row[data-run-id="r1"]'), 'live row rendered');
});
