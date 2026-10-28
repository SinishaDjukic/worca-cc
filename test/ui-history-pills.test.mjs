// test/ui-history-pills.test.mjs — the finished runs' project groups in the Runs list.
// The per-project filter pills (and their remembered choice) are gone (D4): every
// project is a collapsible group of #runs-list; only the Started-by pills stay in
// #historyFilter, on shared deployments.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import { useDomRelease } from './helpers/jsdom-release.mjs';
import { checkRows } from './helpers/rows.mjs';

// Release each booted window after its test (see test/helpers/jsdom-release.mjs).
const trackDom = useDomRelease(afterEach);

const htmlPath = fileURLToPath(new URL('../ui/public/index.html', import.meta.url));
const appPath = fileURLToPath(new URL('../ui/public/app.js', import.meta.url));

// Newest-first, exactly as listAllPipelines returns it (server sorts by mtime desc).
const HISTORY = [
  { id: 'a2', title: 'Alpha two', status: 'done',    startedAt: '2026-06-04T00:00:00Z', projectName: 'Alpha', projectKey: 'alpha-00000001', projectDir: '/x/alpha' },
  { id: 'b1', title: 'Beta one',  status: 'done',    startedAt: '2026-06-03T00:00:00Z', projectName: 'Beta',  projectKey: 'beta-00000002',  projectDir: '/x/beta' },
  { id: 'a1', title: 'Alpha one', status: 'stopped', startedAt: '2026-06-01T00:00:00Z', projectName: 'Alpha', projectKey: 'alpha-00000001', projectDir: '/x/alpha' },
];
const histResp = (pipelines, ghAvailable = false) =>
  Promise.resolve({ ok: true, status: 200, json: async () => ({ pipelines, ghAvailable }) });

async function boot({ fetchHandler, local = { 'worca-cc.runs.view': JSON.stringify({ show: 'all', groupBy: 'project', person: '' }) } } = {}) {
  const dom = trackDom(new JSDOM(readFileSync(htmlPath, 'utf8'), { url: 'http://localhost:4317/' }));
  const { window } = dom;
  window.Element.prototype.scrollIntoView = function () {};
  // Store the socket's listeners so a test can deliver a frame (recv), as test/ui-runs-view.test.mjs does.
  let lastWs = null;
  window.WebSocket = class {
    constructor() { this.readyState = 1; this._l = {}; lastWs = this; }
    send() {} close() {}
    addEventListener(t, fn) { (this._l[t] ||= []).push(fn); }
  };
  window.fetch = (url, opts) => {
    if (fetchHandler) { const r = fetchHandler(String(url), opts || {}); if (r) return r; }
    if (String(url).includes('/api/projects'))
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ projects: [] }) });
    return Promise.resolve({ ok: true, status: 200, json: async () => ({ config: { steps: {}, customModels: [] }, models: [], efforts: [] }) });
  };
  for (const k of ['window', 'document', 'location', 'localStorage', 'WebSocket', 'fetch', 'navigator']) {
    try { Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true }); } catch {}
  }
  globalThis.window = window; globalThis.document = window.document;
  // Group by Project (the View menu, runs-view-menu.mjs): read once when app.js loads.
  window.localStorage.clear();
  for (const [k, v] of Object.entries(local)) window.localStorage.setItem(k, v);
  await import(pathToFileURL(appPath).href + `?b=${Date.now()}_${Math.random()}`);
  await new Promise((r) => setTimeout(r, 0));
  function showRuns() { window.location.hash = 'runs'; window.dispatchEvent(new window.Event('hashchange')); }
  const recv = (obj) => (lastWs._l.message || []).forEach((fn) => fn({ data: JSON.stringify(obj) }));
  return { window, showRuns, recv };
}

test('the Runs list groups finished runs per project (name + count, server order inside), no project pills; a pipelines-changed frame refetches once and keeps the groups', async () => {
  let hits = 0;
  const { window, showRuns, recv } = await boot({
    // Count only the skeleton GET; the Phase-2 POST /api/history/pr is a separate
    // trigger, not a refetch of the history list.
    fetchHandler: (url) => {
      if (url.endsWith('/api/history/pr')) return null;
      if (url.includes('/api/history')) { hits++; return histResp(HISTORY); }
      return null;
    },
  });
  showRuns();
  await new Promise((r) => setTimeout(r, 0));
  const doc = window.document;
  await checkRows([
    { name: 'the Runs list groups finished runs in one section per project (name + count); no project pills', run: async () => {
      // No pill row at all: "Started by" lives in the View menu (runs redesign D6).
      assert.equal(doc.getElementById('historyFilter'), null, 'no pill row');

      const groups = [...doc.querySelectorAll('#runs-list .runs-sec[data-section^="project:"]')];
      assert.equal(groups.length, 2, 'one section per project');
      const name = (g) => g.querySelector('.runs-sec-head .runs-sec-title').textContent;
      const count = (g) => g.querySelector('.runs-sec-head .runs-count').textContent;
      assert.equal(groups[0].dataset.section, 'project:alpha-00000001');
      assert.equal(name(groups[0]), 'Alpha', 'Alpha first (most recent activity)');
      assert.equal(count(groups[0]), '2');
      assert.equal(groups[1].dataset.section, 'project:beta-00000002');
      assert.equal(name(groups[1]), 'Beta');
      assert.equal(count(groups[1]), '1');
      assert.deepEqual([...groups[0].querySelectorAll('.runs-row-title')].map((n) => n.textContent), ['Alpha two', 'Alpha one'],
        'rows keep the server order (newest first) inside their group');
      assert.equal(doc.querySelectorAll('#runs-list .runs-row[data-kind="hist"]').length, 3);
      // No <li> ever (regression guard kept from ui-history).
      assert.equal(doc.querySelectorAll('#runs-list li').length, 0);
    } },
    { name: 'a pipelines-changed frame re-fetches /api/history and keeps the groups', run: async () => {
      // Don't assume exactly one hit here: setting location.hash can make jsdom fire a
      // native hashchange in addition to our manual dispatch. Assert the reload adds one.
      const before = hits;
      assert.ok(before >= 1, 'history fetched when the view is shown');
      // The Refresh button is gone (D14): the app reloads on this frame while on #runs (app.js:1076).
      recv({ type: 'pipelines-changed' });
      await new Promise((r) => setTimeout(r, 0));
      assert.equal(hits, before + 1, 'the frame refetches exactly once');
      assert.deepEqual([...doc.querySelectorAll('#runs-list .runs-sec')].map((g) => g.dataset.section),
        ['project:alpha-00000001', 'project:beta-00000002']);
      assert.equal(doc.querySelectorAll('#runs-list .runs-row[data-kind="hist"]').length, 3);
    } },
  ]);
});
