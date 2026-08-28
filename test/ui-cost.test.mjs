// test/ui-cost.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const htmlPath = fileURLToPath(new URL('../ui/public/index.html', import.meta.url));
const appPath = fileURLToPath(new URL('../ui/public/app.js', import.meta.url));
const PROJECT = '/tmp/proj';

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
  await import(appPath + `?b=${Date.now()}_${Math.random()}`);
  await new Promise((r) => setTimeout(r, 0));
  const selectProject = () => { const s = window.document.querySelector('#projectSelect'); s.value = PROJECT; s.dispatchEvent(new window.Event('change', { bubbles: true })); };
  const showHistory = () => { window.location.hash = 'history'; window.dispatchEvent(new window.Event('hashchange')); };
  // The card no longer expands — open the run's DETAIL screen (#history/<key>/<id>).
  const showDetail = (key, id) => { window.location.hash = `history/${key}/${id}`; window.dispatchEvent(new window.Event('hashchange')); };
  const settle = async (n = 3) => { for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0)); };
  return { window, selectProject, showHistory, showDetail, settle };
}
const runsList = (pipelines, live = []) => Promise.resolve({ ok: true, status: 200, json: async () => ({ pipelines, live }) });

test('history card shows the pipeline total next to the date', async () => {
  const ctx = await boot({
    fetchHandler: (url) => url.includes('/api/history')
      ? runsList([{ id: 'p1', title: 'Run', status: 'done', startedAt: '2026-01-01T00:00:00Z', totalCostUsd: 0.42 }])
      : null,
  });
  ctx.showHistory();
  await new Promise((r) => setTimeout(r, 0));
  const total = ctx.window.document.querySelector('#history .hist-card .hist-total');
  assert.equal(total.textContent, '$0.42');
});

test('the history total is tooltip-labelled as an estimate with the exact value', async () => {
  const ctx = await boot({
    fetchHandler: (url) => url.includes('/api/history')
      ? runsList([{ id: 'p1', title: 'Run', status: 'done', startedAt: '2026-01-01T00:00:00Z', totalCostUsd: 0.42 }])
      : null,
  });
  ctx.showHistory();
  await new Promise((r) => setTimeout(r, 0));
  const total = ctx.window.document.querySelector('#history .hist-card .hist-total');
  assert.equal(total.textContent, '$0.42', 'visible figure unchanged');
  assert.match(total.title, /[Ee]stimat/, 'tooltip marks it as an estimate');
  assert.match(total.title, /\$0\.4200/, 'tooltip shows the exact 4-dp value');
});



test('costByNode buckets per nodeId and by uiPhase fallback', async () => {
  const { window } = await boot();
  const fn = window.__np.costByNode;
  assert.equal(fn([{ nodeId: 's0_0', phase: 'planner', costUsd: 0.12 }])['s0_0'], 0.12);
  assert.equal(fn([{ phase: 'plan', costUsd: 0.05 }])['plan'], 0.05);
});

test('costByNode folds a nodeId-tagged clarify step onto the plan node', async () => {
  const { window } = await boot();
  const fn = window.__np.costByNode;
  const out = fn([
    { key: 'clarify#1', phase: 'clarify', nodeId: 's0_0', costUsd: 0.01 },
    { key: '0:s0_0', phase: 'planner', nodeId: 's0_0', costUsd: 0.02 },
  ]);
  assert.equal(out['s0_0'], 0.03);
});
