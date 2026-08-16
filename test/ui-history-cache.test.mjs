// test/ui-history-cache.test.mjs
// Stale-while-revalidate History: instant paint from a versioned localStorage
// cache, version-bust safety, and never persisting live `pr`. Boots the REAL
// app.js against the REAL index.html under jsdom (harness copied from
// test/ui-history.test.mjs), pre-seeding window.localStorage before showHistory().
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const htmlPath = fileURLToPath(new URL('../ui/public/index.html', import.meta.url));
const appPath = fileURLToPath(new URL('../ui/public/app.js', import.meta.url));
const PROJECT = '/tmp/proj';
const CACHE_KEY = 'worca-cc.history.cache.v2';

async function boot({ fetchHandler } = {}) {
  const dom = new JSDOM(readFileSync(htmlPath, 'utf8'), { url: 'http://localhost:4317/' });
  const { window } = dom;
  window.Element.prototype.scrollIntoView = function () {};
  const wsBox = { ws: null };
  window.WebSocket = class {
    constructor() { this.readyState = 1; this._listeners = {}; wsBox.ws = this; }
    send() {} close() {}
    addEventListener(type, fn) { (this._listeners[type] ||= []).push(fn); }
    dispatch(type, evt) { (this._listeners[type] || []).forEach((fn) => fn(evt)); }
  };
  const calls = [];
  window.fetch = (url, opts) => {
    calls.push({ url: String(url), opts: opts || {} });
    if (fetchHandler) { const r = fetchHandler(String(url), opts || {}); if (r) return r; }
    if (String(url).includes('/api/projects')) {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ projects: [{ name: 'proj', path: PROJECT, exists: true }] }) });
    }
    return Promise.resolve({ ok: true, status: 200, json: async () => ({ config: { steps: {}, customModels: [] }, models: [], efforts: [] }) });
  };
  for (const k of ['window', 'document', 'location', 'localStorage', 'WebSocket', 'fetch', 'navigator']) {
    try { Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true }); } catch { /* keep */ }
  }
  globalThis.window = window; globalThis.document = window.document;
  await import(appPath + `?b=${Date.now()}_${Math.random()}`);
  await new Promise((r) => setTimeout(r, 0));
  const showHistory = () => { window.location.hash = 'history'; window.dispatchEvent(new window.Event('hashchange')); };
  const tick = () => new Promise((r) => setTimeout(r, 0));
  // Read the load token the client POSTed to /api/history/pr (the last one).
  const lastPrToken = () => {
    const posts = calls.filter((c) => c.url.endsWith('/api/history/pr') && c.opts.body);
    return posts.length ? JSON.parse(posts[posts.length - 1].opts.body).token : null;
  };
  // Clear the spinner watchdog by delivering the terminal batch for the current load.
  const settle = async () => {
    const token = lastPrToken();
    if (token != null && wsBox.ws) wsBox.ws.dispatch('message', { data: JSON.stringify({ type: 'history-pr', token, done: true, items: [] }) });
    await tick();
  };
  return { window, calls, wsBox, showHistory, tick, lastPrToken, settle };
}

const skeleton = (pipelines, ghAvailable = true) =>
  Promise.resolve({ ok: true, status: 200, json: async () => ({ pipelines, live: [], ghAvailable }) });

test('instant paint from cache before the /api/history fetch resolves, then SWR repaint', async () => {
  let resolveHistory;
  const deferred = new Promise((r) => { resolveHistory = r; });
  const ctx = await boot({
    fetchHandler: (url) => (url.endsWith('/api/history') ? deferred : null),
  });
  // Pre-seed a valid cache BEFORE navigating to History.
  ctx.window.localStorage.setItem(CACHE_KEY, JSON.stringify({
    v: 2, ts: 1700000000000, ghAvailable: true,
    pipelines: [{ id: 'c1', projectKey: 'k1', projectName: 'K1', title: 'Cached', status: 'done', startedAt: '2026-01-01T00:00:00Z' }],
  }));
  ctx.showHistory();
  await ctx.tick();

  // Cards painted from cache while the network fetch is still pending.
  let cards = ctx.window.document.querySelectorAll('#history .hist-card');
  assert.equal(cards.length, 1, 'instant paint rendered the cached row');
  assert.equal(cards[0].querySelector('.h-meta b').textContent, 'Cached');

  // Resolve the skeleton -> SWR repaint with fresh data.
  resolveHistory({ ok: true, status: 200, json: async () => ({
    pipelines: [{ id: 'f1', projectKey: 'k1', projectName: 'K1', title: 'Fresh', status: 'done', startedAt: '2026-01-02T00:00:00Z' }],
    live: [], ghAvailable: true,
  }) });
  await ctx.tick();
  cards = ctx.window.document.querySelectorAll('#history .hist-card');
  assert.equal(cards.length, 1);
  assert.equal(cards[0].querySelector('.h-meta b').textContent, 'Fresh', 'repainted from the fresh skeleton');
  await ctx.settle();
});

test('corrupt/old cache version is busted (no stale paint, key removed) then network paints', async () => {
  let resolveHistory;
  const deferred = new Promise((r) => { resolveHistory = r; });
  const ctx = await boot({
    fetchHandler: (url) => (url.endsWith('/api/history') ? deferred : null),
  });
  // Wrong version + a stale row that must NEVER paint.
  ctx.window.localStorage.setItem(CACHE_KEY, JSON.stringify({
    v: 0, ts: 1, ghAvailable: true,
    pipelines: [{ id: 'STALE', projectKey: 'k1', title: 'Stale', status: 'done' }],
  }));
  ctx.showHistory();
  await ctx.tick();

  assert.equal(ctx.window.document.querySelectorAll('#history .hist-card').length, 0, 'version-busted cache did not paint');
  assert.equal(ctx.window.localStorage.getItem(CACHE_KEY), null, 'busted cache key was removed');

  resolveHistory(await skeleton([{ id: 'n1', projectKey: 'k1', projectName: 'K1', title: 'Net', status: 'done', startedAt: '2026-01-02T00:00:00Z' }]));
  await ctx.tick();
  const cards = ctx.window.document.querySelectorAll('#history .hist-card');
  assert.equal(cards.length, 1);
  assert.equal(cards[0].querySelector('.h-meta b').textContent, 'Net', 'network fallback painted');
  await ctx.settle();
});

test('writeHistoryCache strips the live `pr` field before persisting', async () => {
  const ctx = await boot({
    fetchHandler: (url) => (url.endsWith('/api/history')
      ? skeleton([{ id: 'p1', projectKey: 'k1', projectName: 'K1', title: 'Feat', status: 'done',
                    startedAt: '2026-01-02T00:00:00Z', pr: { state: 'OPEN', url: 'https://gh/x/pull/1', number: 1 } }])
      : null),
  });
  ctx.showHistory();
  await ctx.tick();

  const raw = ctx.window.localStorage.getItem(CACHE_KEY);
  assert.ok(raw, 'a cache was written from the fresh skeleton');
  const parsed = JSON.parse(raw);
  assert.equal(parsed.v, 2);
  assert.ok(parsed.pipelines.length >= 1);
  assert.ok(parsed.pipelines.every((row) => !('pr' in row)), 'no persisted row carries a live pr');
  await ctx.settle();
});
