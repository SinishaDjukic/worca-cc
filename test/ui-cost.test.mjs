// test/ui-cost.test.mjs
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import { useDomRelease } from './helpers/jsdom-release.mjs';
import { checkRows } from './helpers/rows.mjs';
import { readIndexHtml } from '../src/core/read-index-html.mjs';

// Release each booted window after its test (see test/helpers/jsdom-release.mjs).
const trackDom = useDomRelease(afterEach);

const appPath = fileURLToPath(new URL('../ui/public/app.js', import.meta.url));
const PROJECT = '/tmp/proj';

async function boot({ fetchHandler } = {}) {
  const dom = trackDom(new JSDOM(readIndexHtml(), { url: 'http://localhost:4317/' }));
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
  // The card no longer expands — open the run's DETAIL screen (#history/<key>/<id>).
  const showDetail = (key, id) => { window.location.hash = `history/${key}/${id}`; window.dispatchEvent(new window.Event('hashchange')); };
  const settle = async (n = 3) => { for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0)); };
  return { window, selectProject, showDetail, settle };
}

test('costByNode buckets per nodeId (none without one) and folds a nodeId-tagged clarify step onto its node', async () => {
  const { window } = await boot();
  const fn = window.__np.costByNode;
  await checkRows([
    { name: 'costByNode buckets per nodeId; a row with no nodeId has nothing to bucket onto', run: () => {
      assert.equal(fn([{ nodeId: 's0_0', phase: 'planner', costUsd: 0.12 }])['s0_0'], 0.12);
      // The v1 phase->node fallback died with the v1 manifest: stepBucketKey is the
      // nodeId or nothing.
      assert.deepEqual(fn([{ phase: 'plan', costUsd: 0.05 }]), {});
    } },
    { name: 'costByNode folds a nodeId-tagged clarify step onto the plan node', run: () => {
      const out = fn([
        { key: 'clarify#1', phase: 'clarify', nodeId: 's0_0', costUsd: 0.01 },
        { key: '0:s0_0', phase: 'planner', nodeId: 's0_0', costUsd: 0.02 },
      ]);
      assert.equal(out['s0_0'], 0.03);
    } },
  ]);
});
