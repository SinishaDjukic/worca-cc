// test/ui-duration.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';

const htmlPath = fileURLToPath(new URL('../ui/public/index.html', import.meta.url));
const appPath = fileURLToPath(new URL('../ui/public/app.js', import.meta.url));
const PROJECT = '/tmp/proj';

// Identical boot harness to test/ui-cost.test.mjs (jsdom + stubbed WS/fetch).
async function boot({ fetchHandler } = {}) {
  const dom = new JSDOM(readFileSync(htmlPath, 'utf8'), { url: 'http://localhost:4317/' });
  const { window } = dom;
  window.Element.prototype.scrollIntoView = function () {};
  window.WebSocket = class {
    constructor() { this.readyState = 1; this._listeners = {}; }
    send() {} close() {}
    addEventListener(t, fn) { (this._listeners[t] ||= []).push(fn); }
  };
  window.fetch = (url, opts) => {
    if (fetchHandler) { const r = fetchHandler(String(url), opts || {}); if (r) return r; }
    if (String(url).includes('/api/projects')) {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ projects: [{ name: 'proj', path: PROJECT, exists: true }] }) });
    }
    return Promise.resolve({ ok: true, status: 200, json: async () => ({ config: { steps: {}, customModels: [] }, models: [], efforts: [] }) });
  };
  for (const k of ['window', 'document', 'location', 'localStorage', 'WebSocket', 'fetch', 'navigator']) {
    try { Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true }); } catch {}
  }
  globalThis.window = window; globalThis.document = window.document;
  await import(pathToFileURL(appPath).href + `?b=${Date.now()}_${Math.random()}`);
  await new Promise((r) => setTimeout(r, 0));
  const selectProject = () => { const s = window.document.querySelector('#projectSelect'); s.value = PROJECT; s.dispatchEvent(new window.Event('change', { bubbles: true })); };
  const showHistory = () => { window.location.hash = 'history'; window.dispatchEvent(new window.Event('hashchange')); };
  // The card no longer expands — open the run's DETAIL screen (#history/<key>/<id>).
  const showDetail = (key, id) => { window.location.hash = `history/${key}/${id}`; window.dispatchEvent(new window.Event('hashchange')); };
  const settle = async (n = 3) => { for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0)); };
  return { window, selectProject, showHistory, showDetail, settle };
}
const runsList = (pipelines, live = []) => Promise.resolve({ ok: true, status: 200, json: async () => ({ pipelines, live }) });

test('history card shows total pipeline duration next to the date', async () => {
  const ctx = await boot({
    fetchHandler: (url) => url.includes('/api/history')
      ? runsList([{ id: 'p1', title: 'Run', status: 'done', startedAt: '2026-01-01T00:00:00Z', totalActiveMs: 83_000 }])
      : null,
  });
  ctx.showHistory();
  await new Promise((r) => setTimeout(r, 0));
  const t = ctx.window.document.querySelector('#history .hist-card .hist-time');
  assert.equal(t.textContent, '1m 23s');
});

test('a pipeline with no timing data renders a blank time chip', async () => {
  const ctx = await boot({
    fetchHandler: (url) => url.includes('/api/history')
      ? runsList([{ id: 'p1', title: 'Run', status: 'done', startedAt: '2026-01-01T00:00:00Z', totalActiveMs: null }])
      : null,
  });
  ctx.showHistory();
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(ctx.window.document.querySelector('#history .hist-card .hist-time').textContent, '');
});




// Phase-label harness (CONV-4): identical jsdom/WS/fetch stubs to boot() above,
// but the WebSocket stub records its instances + can fire a `message`, so a
// `phase` event can be driven into the live Running view. We feed a run whose
// uiPhase is one of the two new agents' buckets ('manual-web'/'manual-checklist')
// and assert the running card's phase chip is labelled (not the 'Preflight'
// default that normalizePhase->null leaves it on).
async function bootLive() {
  const wsInstances = [];
  const dom = new JSDOM(readFileSync(htmlPath, 'utf8'), { url: 'http://localhost:4317/' });
  const { window } = dom;
  window.Element.prototype.scrollIntoView = function () {};
  window.WebSocket = class {
    constructor() { this.readyState = 1; this._listeners = {}; wsInstances.push(this); }
    send() {} close() {}
    addEventListener(t, fn) { (this._listeners[t] ||= []).push(fn); }
    _fire(type, data) { for (const fn of (this._listeners[type] || [])) fn(data); }
  };
  window.fetch = (url) => {
    if (String(url).includes('/api/projects')) {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ projects: [{ name: 'proj', path: PROJECT, exists: true }] }) });
    }
    return Promise.resolve({ ok: true, status: 200, json: async () => ({ config: { steps: {}, customModels: [] }, models: [], efforts: [] }) });
  };
  for (const k of ['window', 'document', 'location', 'localStorage', 'WebSocket', 'fetch', 'navigator']) {
    try { Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true }); } catch {}
  }
  globalThis.window = window; globalThis.document = window.document;
  await import(pathToFileURL(appPath).href + `?b=${Date.now()}_${Math.random()}`);
  await new Promise((r) => setTimeout(r, 0));
  const selectProject = () => { const s = window.document.querySelector('#projectSelect'); s.value = PROJECT; s.dispatchEvent(new window.Event('change', { bubbles: true })); };
  const showRunning = () => { window.location.hash = '#running'; window.dispatchEvent(new window.Event('hashchange')); };
  const emit = (msg) => wsInstances[0]._fire('message', { data: JSON.stringify(msg) });
  return { window, selectProject, showRunning, emit };
}

// The card's phase chip went with the redesign, so these check the surface that
// still PRINTS the label: renderQpanel's head, which reads
// `PHASE_LABEL[r.phaseKey] || 'Pipeline'`. Asserting the rendered string keeps
// both halves honest — the normalization AND the wiring. Comparing
// PHASE_LABEL['manual-web'] to 'Manual web UI' alone would just restate app.js's
// own literal against itself.
const askFrame = (runId) => ({
  type: 'question', runId, id: 'q1', kind: 'clarify',
  questions: [{ id: 'a', question: 'Which one?', options: ['A', 'B'] }],
});
const panelHead = (ctx, runId) =>
  ctx.window.document.querySelector(`#run-list .run-card[data-run-id="${runId}"] .qpanel-head b`);



test('durByNode buckets per nodeId; a row with no nodeId has nothing to bucket onto', async () => {
  const { window } = await boot();
  const fn = window.__np.durByNode;
  const a = fn([{ nodeId: 's1_0', phase: 'refiner', activeMs: 1500, runningSince: null }], 0, false);
  assert.equal(a['s1_0'], 1500);
  // The v1 phase->node fallback died with the v1 manifest.
  assert.deepEqual(fn([{ phase: 'refine', activeMs: 800, runningSince: null }], 0, false), {});
});


