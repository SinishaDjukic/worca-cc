// test/ui-budget-indicator.test.mjs
// Always-visible spend indicator: the sidebar mount, the topnav amount, the
// New-view creation gate, click-through to #stats, and the countdown tick
// (idle recompute vs. rolled-over refetch). Boots the REAL app.js against the
// REAL index.html under jsdom (harness from test/ui-stats.test.mjs) with the
// dispatchable WebSocket stub from test/ui-history-cache.test.mjs so
// `budget-changed` frames can be pushed into the running client.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const htmlPath = fileURLToPath(new URL('../ui/public/index.html', import.meta.url));
const appPath = fileURLToPath(new URL('../ui/public/app.js', import.meta.url));
const PROJECT = '/tmp/proj';

const HOUR = 3600000;
const DAY = 86400000;

// $41.23 of a $50 monthly cap = 82% -> unblocked, but past BUDGET_WARN_AT.
const okBudget = () => ({
  pipelineLimitUsd: null, totalLimitUsd: 50, resetPeriod: 'monthly',
  windowStartMs: Date.now() - 3 * DAY, windowEndMs: Date.now() + 4 * DAY,
  msUntilReset: 4 * DAY, windowSpendUsd: 41.23, allTimeSpendUsd: 41.23,
  remainingUsd: 8.77, blocked: false,
});
const blockedBudget = () => ({ ...okBudget(), windowSpendUsd: 52.13, remainingUsd: 0, blocked: true });

// /api/stats echoes the same budget object back under .budget (server contract).
const statsFixture = (budget) => ({
  range: 'month', bucket: 'day',
  windowStartMs: Date.now() - 3 * DAY, windowEndMs: Date.now() + 4 * DAY,
  totals: { spentUsd: 3.5, workedMs: 7200000, runs: 3, finished: 2, stopped: 1,
    failed: 0, paused: 0, running: 0, prsOpened: 1, prsMerged: 1 },
  prev: null,
  budget,
  series: [{ bucketStartMs: Date.now() - 2 * DAY, spentUsd: 3.5, finished: 2, stopped: 1, failed: 0 }],
});

async function boot({ budget = okBudget(), tickMs } = {}) {
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
  // Mutable so a test can swap the server's answer mid-run and re-drive the
  // client with a `budget-changed` frame.
  // `runResponse` lets a test hold POST /api/run open and drive events into the
  // in-flight window between "Start disabled" and the response landing.
  const box = { budget, runResponse: null };
  const counts = { budget: 0, stats: 0 };
  const statsCalls = [];
  window.fetch = (url, opts) => {
    const u = String(url);
    if (u.endsWith('/api/run') && opts && opts.method === 'POST') {
      return box.runResponse
        || Promise.resolve({ ok: true, status: 200, json: async () => ({ runId: 'run-1' }) });
    }
    if (u.includes('/api/budget')) {
      counts.budget += 1;
      return Promise.resolve({ ok: true, status: 200, json: async () => box.budget });
    }
    if (u.includes('/api/stats')) {
      counts.stats += 1; statsCalls.push(u);
      return Promise.resolve({ ok: true, status: 200, json: async () => statsFixture(box.budget) });
    }
    if (u.includes('/api/settings')) {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({
        root: '', projectsRoot: '', projectsRootDefault: '/home/me', default: '/home/me',
        pipelineCostLimitUsd: null, totalCostLimitUsd: 50, costLimitResetPeriod: 'monthly',
      }) });
    }
    if (u.includes('/api/projects')) {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ projects: [{ name: 'proj', path: PROJECT, exists: true }] }) });
    }
    return Promise.resolve({ ok: true, status: 200, json: async () => ({ config: { steps: {}, customModels: [] }, models: [], efforts: [] }) });
  };
  for (const k of ['window', 'document', 'location', 'localStorage', 'WebSocket', 'fetch', 'navigator']) {
    try { Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true }); } catch { /* keep */ }
  }
  globalThis.window = window; globalThis.document = window.document;
  // The tick seam is read ONCE inside startBudgetTick() at boot, so it has to
  // be on `window` between JSDOM creation and the cache-busted app.js import.
  if (tickMs != null) window.__budgetTickMs = tickMs;
  await import(appPath + `?b=${Date.now()}_${Math.random()}`);
  await new Promise((r) => setTimeout(r, 0));
  const tick = () => new Promise((r) => setTimeout(r, 0));
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const pushBudgetChanged = async () => {
    wsBox.ws.dispatch('message', { data: JSON.stringify({ type: 'budget-changed', action: null }) });
    await tick();
  };
  const showView = async (name) => {
    window.location.hash = name;
    window.dispatchEvent(new window.Event('hashchange'));
    await tick();
  };
  return { window, box, counts, statsCalls, wsBox, tick, wait, pushBudgetChanged, showView };
}

test('boot paints the sidebar indicator and topnav amount', async () => {
  const { window } = await boot();
  const amt = window.document.querySelector('#side-spend .spend-ind-amt');
  assert.ok(amt, 'the sidebar indicator is mounted in #side-spend');
  assert.equal(amt.textContent, '$41.23');
  const top = window.document.querySelector('#topnav-spend');
  assert.equal(top.hidden, false, 'the topnav amount is revealed once a budget is known');
  assert.equal(top.textContent, '$41.23');
  assert.equal(top.classList.contains('warn'), true, '82% of the cap is the warn band');
  assert.equal(top.classList.contains('over'), false);
});

test('budget-changed repaints; blocked disables #start-btn with a visible reason', async () => {
  const ctx = await boot();
  assert.equal(ctx.window.document.querySelector('#start-btn').disabled, false, 'unblocked boot leaves Start enabled');
  assert.equal(ctx.window.document.querySelector('#newBlockedNote').hidden, true);

  ctx.box.budget = blockedBudget();
  await ctx.pushBudgetChanged();

  assert.ok(ctx.window.document.querySelector('#side-spend .spend-ind').classList.contains('over'));
  assert.equal(ctx.window.document.querySelector('#topnav-spend').classList.contains('over'), true);
  assert.equal(ctx.window.document.querySelector('#start-btn').disabled, true);
  const note = ctx.window.document.querySelector('#newBlockedNote');
  assert.equal(note.hidden, false);
  assert.match(note.textContent, /\$52\.13 of \$50\.00/);
  assert.match(note.textContent, /blocked until/);

  ctx.box.budget = okBudget();
  await ctx.pushBudgetChanged();
  assert.equal(ctx.window.document.querySelector('#start-btn').disabled, false, 'clearing the block re-enables Start');
  assert.equal(ctx.window.document.querySelector('#newBlockedNote').hidden, true);
});

// Starting a run broadcasts pipelines-changed (and, on a cost pause,
// budget-changed) — both repaint the budget. applyBudgetToNewView writes
// start.disabled unconditionally, so a repaint landing inside the submit's own
// in-flight window re-enabled Start and a fast second click double-submitted.
test('a budget repaint mid-submit must not re-enable #start-btn', async () => {
  const ctx = await boot();
  const doc = ctx.window.document;
  let releaseRun;
  ctx.box.runResponse = new Promise((r) => { releaseRun = r; });

  const psel = doc.querySelector('#projectSelect');
  assert.ok(psel.options.length > 0, 'projects loaded');
  psel.value = PROJECT;
  psel.dispatchEvent(new ctx.window.Event('change', { bubbles: true }));
  doc.querySelector('#prompt').value = 'do a thing';
  doc.querySelector('#run-form').dispatchEvent(new ctx.window.Event('submit', { bubbles: true, cancelable: true }));
  await ctx.tick();
  assert.equal(doc.querySelector('#start-btn').disabled, true, 'Start is disabled while the POST is in flight');

  await ctx.pushBudgetChanged();
  assert.equal(doc.querySelector('#start-btn').disabled, true,
    'a budget repaint must not re-enable Start mid-submit');

  releaseRun({ ok: true, status: 200, json: async () => ({ runId: 'run-1' }) });
  await ctx.tick();
  await ctx.tick();
  assert.equal(doc.querySelector('#start-btn').disabled, false, 'Start returns once the POST settles');
});

test('clicking the indicator navigates to #stats', async () => {
  const { window, tick } = await boot();
  window.document.querySelector('#side-spend .spend-ind').click();
  assert.equal(window.location.hash.replace('#', ''), 'stats');
  await tick();
});

test('weekly resetPeriod budget makes #stats default to range=week', async () => {
  const ctx = await boot({ budget: { ...okBudget(), resetPeriod: 'weekly' } });
  await ctx.showView('stats');
  assert.ok(ctx.statsCalls.some((u) => u.includes('range=week')),
    `expected a range=week /api/stats fetch, got ${JSON.stringify(ctx.statsCalls)}`);
});

// A non-cost `done` broadcasts nothing (the server emits budget-changed only for
// cost pauses, and pipelines-changed only on archive), and the slow tick refetches
// only while runs are live — so the LAST spend delta, and a `blocked` flip it
// causes, went unseen until a reload: Start stayed enabled and the click hit the
// raw 403 instead of the pre-emptive gate.
test('a run finishing refetches the budget so the final delta lands without a reload', async () => {
  const ctx = await boot();
  const doc = ctx.window.document;
  assert.equal(doc.querySelector('#start-btn').disabled, false, 'unblocked boot leaves Start enabled');

  ctx.box.budget = blockedBudget();
  const before = ctx.counts.budget;
  ctx.wsBox.ws.dispatch('message', {
    data: JSON.stringify({ type: 'done', runId: 'run-fin', status: 'done' }),
  });
  await ctx.tick();
  await ctx.tick();

  assert.ok(ctx.counts.budget > before, 'the client refetches /api/budget when a run ends');
  assert.equal(doc.querySelector('#start-btn').disabled, true, 'and the creation gate flips closed');
});

// The two tick suites run last: their fast interval outlives the test, and a
// leaked tick repaints whatever document is global at the time. Neither leaked
// timer can refetch (both boot inside their window), so a later suite's
// /api/budget call count stays honest.
test('idle tick recomputes the countdown from windowEndMs without fetching', async () => {
  const ctx = await boot({
    tickMs: 5,
    // msUntilReset is deliberately stale-huge; windowEndMs is the real anchor.
    budget: { ...okBudget(), msUntilReset: 999 * DAY, windowEndMs: Date.now() + 2 * HOUR },
  });
  // The sidebar card no longer renders the countdown; the Settings readout is
  // the tick recompute's rendered observable now.
  await ctx.showView('settings');
  const before = ctx.counts.budget;
  await ctx.wait(20);
  const readout = ctx.window.document.querySelector('#budgetReadout');
  assert.doesNotMatch(readout.textContent, /999d/, 'the stale fetched msUntilReset must never be repainted as-is');
  assert.match(readout.textContent, /resets in [12]h/, `countdown recomputed from windowEndMs, got "${readout.textContent}"`);
  assert.equal(ctx.counts.budget, before, 'an idle tick inside the window must not refetch');
});

test('tick past windowEndMs refetches (rolled-over window must not stay blocked)', async () => {
  const ctx = await boot({
    tickMs: 5,
    budget: { ...blockedBudget(), windowEndMs: Date.now() - 1000, msUntilReset: 0 },
  });
  const before = ctx.counts.budget;
  await ctx.wait(20);
  assert.ok(ctx.counts.budget > before,
    'once the boundary passes the client must re-derive spend/blocked server-side');
});
