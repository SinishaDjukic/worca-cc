// test/ui-stats.test.mjs
// Statistics view integration: the nav entry in BOTH menus, the #stats route and
// its loader, the range segmented control, chart tooltip delegation, and the
// WS-driven refresh. Boots the REAL app.js against the REAL index.html under
// jsdom (harness from test/ui-cost.test.mjs) but with the dispatchable
// WebSocket stub from test/ui-history-cache.test.mjs so `pipelines-changed`
// can be pushed into the running client.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const htmlPath = fileURLToPath(new URL('../ui/public/index.html', import.meta.url));
const appPath = fileURLToPath(new URL('../ui/public/app.js', import.meta.url));
const PROJECT = '/tmp/proj';

const STATS_FIXTURE = {
  range: 'week', bucket: 'day',
  windowStartMs: Date.now() - 3 * 86400000, windowEndMs: Date.now() + 4 * 86400000,
  totals: { spentUsd: 3.5, workedMs: 7200000, runs: 3, finished: 2, stopped: 1,
    failed: 0, paused: 0, running: 0, prsOpened: 1, prsMerged: 1 },
  prev: null,
  // resetPeriod MUST be 'monthly' here: this object is also the /api/budget
  // response, and once the budget state lands, boot populates budgetState from
  // it — a 'weekly' fixture would flip defaultStatsRange() to 'week' and break
  // the range=month assertion below.
  budget: { pipelineLimitUsd: null, totalLimitUsd: null, resetPeriod: 'monthly',
    windowStartMs: 0, windowEndMs: Date.now() + 4 * 86400000, msUntilReset: 4 * 86400000,
    windowSpendUsd: 3.5, allTimeSpendUsd: 3.5, remainingUsd: null, blocked: false },
  series: [{ bucketStartMs: Date.now() - 2 * 86400000, spentUsd: 3.5, finished: 2, stopped: 1, failed: 0 }],
};

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
    const u = String(url);
    if (fetchHandler) { const r = fetchHandler(u, opts || {}); if (r) return r; }
    if (u.includes('/api/stats')) {
      calls.push(u);
      return Promise.resolve({ ok: true, status: 200, json: async () => STATS_FIXTURE });
    }
    if (u.includes('/api/budget')) {
      return Promise.resolve({ ok: true, status: 200, json: async () => STATS_FIXTURE.budget });
    }
    if (u.includes('/api/projects')) {
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
  const tick = () => new Promise((r) => setTimeout(r, 0));
  const showStats = async () => {
    window.location.hash = 'stats';
    window.dispatchEvent(new window.Event('hashchange'));
    await tick();
  };
  return { window, calls, wsBox, tick, showStats };
}

test('nav: sidebar + topnav carry data-nav="stats"; #stats opens the view and fetches', async () => {
  const { window, calls, showStats } = await boot();
  assert.ok(window.document.querySelector('.sidebar [data-nav="stats"]'), 'sidebar Statistics button');
  assert.ok(window.document.querySelector('.topnav [data-nav="stats"]'), 'topnav Stats button');
  await showStats();
  const section = window.document.querySelector('[data-view="stats"]');
  assert.ok(section, 'stats section exists');
  assert.ok(!section.classList.contains('hidden'), 'stats section shown');
  // The /api/budget fixture is MONTHLY, so the default range is 'month' — here
  // because budgetState is still the null placeholder, and later because the
  // real budgetState reads the monthly fixture.
  assert.ok(calls.some((u) => u.includes('range=month')), 'default range is month');
  assert.ok(window.document.querySelector('#stats-body .stat-row'), 'KPI row painted');
});

test('range seg: clicking All time refetches range=all and moves .on', async () => {
  const { window, calls, tick, showStats } = await boot();
  await showStats();
  const allBtn = window.document.querySelector('#stats-range [data-range="all"]');
  assert.ok(allBtn, 'All time button exists');
  allBtn.click();
  await tick();
  assert.ok(calls.some((u) => u.includes('range=all')), 'refetched with range=all');
  assert.ok(allBtn.classList.contains('on'), 'All time is the highlighted segment');
  assert.equal(window.document.querySelector('#stats-range [data-range="month"]').classList.contains('on'),
    false, 'the previous segment lost .on');
});

test('tooltip: pointerover on a .ch-hit fills and shows #stats-tip; focus parity', async () => {
  const { window, showStats } = await boot();
  await showStats();
  const hit = window.document.querySelector('.ch-hit');
  assert.ok(hit, 'chart hit target rendered');
  const tip = window.document.querySelector('#stats-tip');
  assert.equal(tip.hidden, true, 'tooltip starts hidden');
  hit.dispatchEvent(new window.Event('pointerover', { bubbles: true }));
  assert.equal(tip.hidden, false);
  assert.ok(tip.textContent.length > 0, 'tooltip carries the hit target text');
  hit.dispatchEvent(new window.Event('pointerout', { bubbles: true }));
  assert.equal(tip.hidden, true);
  hit.dispatchEvent(new window.Event('focusin', { bubbles: true }));
  assert.equal(tip.hidden, false, 'keyboard focus shows the same tooltip');
  hit.dispatchEvent(new window.Event('focusout', { bubbles: true }));
  assert.equal(tip.hidden, true);
});

// A rejected fetch (offline, aborted) is not an !res.ok — without a catch it
// escapes as an unhandled rejection and leaves #stats-body stuck in .is-loading.
test('a network-level failure clears the loading state and surfaces an error', async () => {
  const gate = { fail: false };
  const ctx = await boot({
    fetchHandler: (u) => (gate.fail && u.includes('/api/stats')
      ? Promise.reject(new Error('offline')) : null),
  });
  await ctx.showStats();
  const body = ctx.window.document.querySelector('#stats-body');
  assert.ok(body.childElementCount > 0, 'the first load painted a body');

  gate.fail = true;
  ctx.wsBox.ws.dispatch('message', { data: JSON.stringify({ type: 'pipelines-changed' }) });
  assert.equal(body.classList.contains('is-loading'), true, 'loading state painted');
  await ctx.tick();
  await ctx.tick();
  assert.equal(body.classList.contains('is-loading'), false, 'loading state cleared on failure');
  assert.ok(body.querySelector('.err'), 'the failure is surfaced in the body');
});

test('pipelines-changed while stats open refetches', async () => {
  const { window, calls, wsBox, tick, showStats } = await boot();
  await showStats();
  const before = calls.length;
  const body = window.document.querySelector('#stats-body');
  wsBox.ws.dispatch('message', { data: JSON.stringify({ type: 'pipelines-changed' }) });
  // SYNCHRONOUS assert: loadStatsView adds the class before its first `await
  // fetch(...)` and removes it when the stub fetch resolves one microtask
  // later, so an awaited tick would already see it gone.
  assert.equal(body.classList.contains('is-loading'), true, 'loading state painted synchronously');
  await tick();
  assert.ok(calls.length > before, 'a second /api/stats fetch happened');
  assert.equal(body.classList.contains('is-loading'), false, 'loading state cleared');
});
