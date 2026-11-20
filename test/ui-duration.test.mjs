// test/ui-duration.test.mjs
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

// Identical boot harness to test/ui-cost.test.mjs (jsdom + stubbed WS/fetch).
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
const runsList = (pipelines, live = []) => Promise.resolve({ ok: true, status: 200, json: async () => ({ pipelines, live }) });
const ok = (body) => Promise.resolve({ ok: true, status: 200, json: async () => body });

// The glance's labelled fact tiles (Time · Cost · Changes): { label: value }.
const factTiles = (window) => Object.fromEntries(
  [...window.document.querySelectorAll('#hist-detail .rd-facts .rd-stats > div')]
    .map((t) => [t.querySelector('span').textContent, t.querySelector('b').textContent]));

test('duration: the saved run\'s glance shows the total active time; durByNode buckets per nodeId', async () => {
  const KEY = 'proj-a1b2c3d4';
  const row = { id: 'p1', projectKey: KEY, title: 'Run', status: 'done', startedAt: '2026-01-01T00:00:00Z', totalActiveMs: 83_000 };
  const detail = { state: { id: 'p1', title: 'Run', status: 'done', startedAt: row.startedAt, steps: [], totalActiveMs: 83_000 } };
  const ctx = await boot({
    // The detail URL shares the /api/history prefix: match it first.
    fetchHandler: (url) => (url.endsWith(`/api/history/${KEY}/p1`) ? ok(detail)
      : url.endsWith('/api/history') ? runsList([row]) : null),
  });
  await checkRows([
    { name: 'the saved run shows the total pipeline duration in its glance facts', run: async () => {
      ctx.showDetail(KEY, 'p1');
      await ctx.settle(5);
      assert.equal(factTiles(ctx.window).time, '1m 23s');
    } },
    { name: 'durByNode buckets per nodeId; a row with no nodeId has nothing to bucket onto', run: () => {
      const fn = ctx.window.__np.durByNode;
      const a = fn([{ nodeId: 's1_0', phase: 'refiner', activeMs: 1500, runningSince: null }], 0, false);
      assert.equal(a['s1_0'], 1500);
      // The v1 phase->node fallback died with the v1 manifest.
      assert.deepEqual(fn([{ phase: 'refine', activeMs: 800, runningSince: null }], 0, false), {});
    } },
  ]);
});
