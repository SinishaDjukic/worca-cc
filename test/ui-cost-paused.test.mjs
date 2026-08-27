// test/ui-cost-paused.test.mjs — cost-paused UX: run-card banners, the
// continue-without-cap override flow, total-cap resume gating, and the History
// parity (pause note in the head, banner in the expanded detail, gated Resume).
// Harness: jsdom boot of the REAL index.html + app.js, with the dispatchable
// WebSocket stub from test/ui-history-cache.test.mjs (so `done`/`budget-changed`
// frames can be pushed into the running client), the mutable `box.budget`
// /api/budget stub from test/ui-budget-indicator.test.mjs, and the
// fetchCalls recorder from test/ui-running-resume.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';

const htmlPath = fileURLToPath(new URL('../ui/public/index.html', import.meta.url));
const appPath = fileURLToPath(new URL('../ui/public/app.js', import.meta.url));
const PROJECT = '/tmp/proj';
const DAY = 86400000;

// resetPeriod stays 'monthly' so the budget snapshot never flips the Stats
// default range (see test/ui-stats.test.mjs).
const okBudget = () => ({
  pipelineLimitUsd: 5, totalLimitUsd: 50, resetPeriod: 'monthly',
  windowStartMs: Date.now() - 3 * DAY, windowEndMs: Date.now() + 4 * DAY,
  msUntilReset: 4 * DAY, windowSpendUsd: 12.5, allTimeSpendUsd: 12.5,
  remainingUsd: 37.5, blocked: false,
});
const blockedBudget = () => ({
  ...okBudget(), windowSpendUsd: 50, remainingUsd: 0, blocked: true,
});

async function boot({ budget = okBudget(), fetchHandler } = {}) {
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
  const box = { budget };
  const fetchCalls = [];
  window.fetch = (url, opts) => {
    const u = String(url);
    fetchCalls.push({ url: u, opts: opts || {} });
    if (fetchHandler) { const r = fetchHandler(u, opts || {}); if (r) return r; }
    if (u.includes('/api/budget')) {
      return Promise.resolve({ ok: true, status: 200, json: async () => box.budget });
    }
    if (u.includes('/api/resume')) {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true, runId: 'r-new', pipelineId: 'pl_1' }) });
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
  await import(pathToFileURL(appPath).href + `?b=${Date.now()}_${Math.random()}`);
  await new Promise((r) => setTimeout(r, 0));
  const tick = () => new Promise((r) => setTimeout(r, 0));
  const recv = (obj) => wsBox.ws.dispatch('message', { data: JSON.stringify(obj) });
  const showRunning = () => { window.location.hash = 'running'; window.dispatchEvent(new window.Event('hashchange')); };
  const showHistory = () => { window.location.hash = 'history'; window.dispatchEvent(new window.Event('hashchange')); };
  // The card no longer expands — open the run's DETAIL screen (#history/<key>/<id>).
  const showDetail = (key, id) => { window.location.hash = `history/${key}/${id}`; window.dispatchEvent(new window.Event('hashchange')); };
  const settle = async (n = 3) => { for (let i = 0; i < n; i++) await tick(); };
  await tick();  // let the boot /api/budget land
  return { window, wsBox, box, fetchCalls, tick, recv, showRunning, showHistory, showDetail, settle };
}

const historyList = (pipelines) =>
  Promise.resolve({ ok: true, status: 200, json: async () => ({ pipelines, live: [], ghAvailable: false }) });

// Seed one live run via `hello`, then drive it paused with a `done` frame that
// carries the pause reason (the server's done broadcast really carries it —
// orchestrator._completePaused emits it and wireRun spreads the payload).
async function pausedRun(ctx, reason) {
  ctx.showRunning();
  ctx.recv({
    type: 'hello',
    runs: [{ runId: 'r1', title: 'Feat', projectDir: PROJECT, status: 'running', startedAt: '00:00:00', pipelineId: 'pl_1' }],
  });
  await ctx.tick();
  ctx.recv({ type: 'done', runId: 'r1', status: 'paused', reason });
  await ctx.tick();
  return ctx.window.document.querySelector('#run-list .run-card');
}

test('cost_pipeline pause renders the amber banner with an enabled Resume', async () => {
  const ctx = await boot();
  const card = await pausedRun(ctx, 'cost_pipeline');
  assert.ok(card, 'paused run still has a card in the Overview list');
  const banner = card.querySelector('.cost-banner');
  assert.ok(banner, 'card carries a .cost-banner slot');
  assert.equal(banner.hidden, false, 'banner is revealed for a cost pause');
  assert.ok(banner.classList.contains('cb-pipeline'), 'amber per-pipeline variant');
  assert.match(banner.textContent, /pipeline cost limit/);
  assert.ok(banner.querySelector('.cb-override'), 'override action offered');
  assert.equal(card.querySelector('.btn-resume').disabled, false, 'per-pipeline pause never blocks Resume');
  assert.equal(card.querySelector('.rc-status-word').textContent, 'Paused · cost limit');
});

test('cb-override: confirm modal -> single resume POST with ignoreCostCap:true', async () => {
  const ctx = await boot();
  const card = await pausedRun(ctx, 'cost_pipeline');
  card.querySelector('.cb-override').click();
  await ctx.tick();
  const modal = ctx.window.document.querySelector('#confirm-modal');
  assert.equal(modal.classList.contains('hidden'), false, 'override asks for confirmation first');
  assert.match(ctx.window.document.querySelector('#confirm-message').textContent, /total budget limit still applies/i);
  assert.equal(ctx.window.fetch.length >= 0, true);
  const before = ctx.fetchCalls.filter((c) => c.url.includes('/api/resume')).length;
  assert.equal(before, 0, 'nothing posted until the user confirms');
  ctx.window.document.querySelector('#confirm-ok').click();
  await ctx.tick();
  await ctx.tick();
  const posts = ctx.fetchCalls.filter((c) => c.url.includes('/api/resume'));
  assert.equal(posts.length, 1, 'exactly one resume POST');
  assert.deepEqual(JSON.parse(posts[0].opts.body), { pipelineId: 'pl_1', ignoreCostCap: true });
});

test('cb-override: cancelling the confirm posts nothing', async () => {
  const ctx = await boot();
  const card = await pausedRun(ctx, 'cost_pipeline');
  card.querySelector('.cb-override').click();
  await ctx.tick();
  ctx.window.document.querySelector('#confirm-cancel').click();
  await ctx.tick();
  await ctx.tick();
  assert.equal(ctx.fetchCalls.filter((c) => c.url.includes('/api/resume')).length, 0);
});

test('cost_total pause: red banner, Resume disabled with reset-date tooltip', async () => {
  const ctx = await boot({ budget: blockedBudget() });
  const card = await pausedRun(ctx, 'cost_total');
  assert.ok(card.querySelector('.cost-banner.cb-total'), 'red total-budget variant');
  assert.equal(card.querySelector('.cost-banner .cb-override'), null, 'no per-pipeline override on a total-cap pause');
  const resume = card.querySelector('.btn-resume');
  assert.equal(resume.disabled, true);
  assert.match(resume.title, /Total budget reached/);
  assert.equal(card.querySelector('.rc-status-word').textContent, 'Paused · total budget');
});

test('budget-changed unblocking re-enables Resume and clears the total banner', async () => {
  const ctx = await boot({ budget: blockedBudget() });
  const card = await pausedRun(ctx, 'cost_total');
  assert.equal(card.querySelector('.btn-resume').disabled, true);
  ctx.box.budget = okBudget();
  ctx.recv({ type: 'budget-changed', action: null });
  await ctx.tick();
  await ctx.tick();
  const resume = ctx.window.document.querySelector('#run-list .run-card .btn-resume');
  assert.equal(resume.disabled, false, 'a raised/reset budget must unblock the parked run');
  // Clearing the blocked tooltip must RESTORE the template's help text, not
  // blank the button — every ordinary paused card is painted through here too.
  const stock = ctx.window.document.getElementById('run-card-tpl')
    .content.querySelector('.btn-resume').title;
  assert.ok(stock, 'the template ships a stock Resume tooltip');
  assert.equal(resume.title, stock, 'the stock tooltip comes back');
});

test('an ordinary paused run keeps the template Resume tooltip', async () => {
  const ctx = await boot();
  const card = await pausedRun(ctx, null);
  const resume = card.querySelector('.btn-resume');
  const stock = ctx.window.document.getElementById('run-card-tpl')
    .content.querySelector('.btn-resume').title;
  assert.equal(resume.disabled, false);
  assert.equal(resume.title, stock, 'painting must not strip the stock tooltip');
});

test('a non-cost pause leaves the banner hidden and the pill plain', async () => {
  const ctx = await boot();
  const card = await pausedRun(ctx, undefined);   // manual pause carries no reason
  assert.equal(card.querySelector('.cost-banner').hidden, true);
  assert.equal(card.querySelector('.rc-status-word').textContent, 'Paused');
  assert.equal(card.querySelector('.btn-resume').disabled, false);
});

// Resume + the cost-pause banner moved to the History DETAIL screen; the card
// keeps only the pausenote caption and the dataset.pauseReason stamp.
const PAUSED_ENTRIES = [
  { id: 'h1', projectKey: 'k1', title: 'Pipe cap', status: 'paused', pauseReason: 'cost_pipeline', startedAt: '2026-01-01T00:00:00Z' },
  { id: 'h2', projectKey: 'k1', title: 'Total cap', status: 'paused', pauseReason: 'cost_total', startedAt: '2026-01-01T00:00:00Z' },
];
const pausedDetail = (id) => Promise.resolve({
  ok: true, status: 200,
  json: async () => ({ state: { id, phase: 'implement', status: 'paused', totalCostUsd: 5.2, steps: [] } }),
});
// MOST-SPECIFIC FIRST: the keyed detail URL has the list URL as a prefix.
const pausedArms = (url) => {
  if (url.endsWith('/api/history/k1/h1')) return pausedDetail('h1');
  if (url.endsWith('/api/history/k1/h2')) return pausedDetail('h2');
  if (url.endsWith('/api/history')) return historyList(PAUSED_ENTRIES);
  return null;
};

test('history: pausenote on the card; the detail screen shows the banner and gates Resume', async () => {
  const ctx = await boot({ budget: blockedBudget(), fetchHandler: pausedArms });
  ctx.showHistory();
  await ctx.tick();
  const cards = ctx.window.document.querySelectorAll('#history .hist-card');
  assert.equal(cards.length, 2);

  const note1 = cards[0].querySelector('.hist-pausenote');
  assert.ok(note1, 'hist-card template carries a .hist-pausenote slot');
  assert.equal(note1.hidden, false);
  assert.equal(note1.textContent, 'paused · cost limit');
  const note2 = cards[1].querySelector('.hist-pausenote');
  assert.equal(note2.textContent, 'paused · total budget');
  assert.ok(note2.classList.contains('total'), 'total-budget note uses the red modifier');
  assert.equal(cards[1].dataset.pauseReason, 'cost_total', 'reason stamped for later re-gating');

  // The total-cap run is blocked while the budget is over.
  ctx.showDetail('k1', 'h2');
  await ctx.settle();
  const gated = ctx.window.document.querySelector('#hist-detail .hd-resume');
  assert.equal(gated.disabled, true);
  assert.match(gated.title, /Total budget reached/);

  // The per-pipeline one is not, and its detail carries the cost-pause banner.
  ctx.showDetail('k1', 'h1');
  await ctx.settle();
  assert.equal(ctx.window.document.querySelector('#hist-detail .hd-resume').disabled, false);
  const detailBanner = ctx.window.document.querySelector('#hist-detail .hd-banners .cost-banner');
  assert.ok(detailBanner, 'the detail screen shows the cost-pause banner');
  assert.ok(detailBanner.classList.contains('cb-pipeline'));
  assert.ok(detailBanner.querySelector('.cb-override'), 'override offered from History too');

  // And it posts the same override body as the Running card.
  detailBanner.querySelector('.cb-override').click();
  await ctx.tick();
  ctx.window.document.querySelector('#confirm-ok').click();
  await ctx.settle();
  const posts = ctx.fetchCalls.filter((c) => c.url.includes('/api/resume'));
  assert.equal(posts.length, 1);
  assert.deepEqual(JSON.parse(posts[0].opts.body), { pipelineId: 'h1', ignoreCostCap: true });
});

test('history: a budget-changed unblock re-enables the gated detail Resume', async () => {
  const ctx = await boot({ budget: blockedBudget(), fetchHandler: pausedArms });
  ctx.showHistory();
  await ctx.tick();
  ctx.showDetail('k1', 'h2');
  await ctx.settle();
  assert.equal(ctx.window.document.querySelector('#hist-detail .hd-resume').disabled, true);
  ctx.box.budget = okBudget();
  ctx.recv({ type: 'budget-changed', action: null });
  await ctx.settle();
  assert.equal(ctx.window.document.querySelector('#hist-detail .hd-resume').disabled, false);
});

test('reload parity: a hello-seeded paused run with pauseReason renders the banner', async () => {
  const ctx = await boot();
  ctx.showRunning();
  // Field-for-field the real hello summary: every key ui/server.mjs
  // summarizeRuns() emits, in its order. The SERVER half of this contract
  // (wireRun storing entry.pauseReason, summarizeRuns emitting it) is pinned
  // separately by test/server-pause-reason.test.mjs — keep the two in step.
  ctx.recv({
    type: 'hello',
    runs: [{
      runId: 'r9',
      stepper: null,
      pipelineId: 'pl_9',
      projectDir: PROJECT,
      title: 'Reloaded',
      status: 'paused',
      pauseReason: 'cost_pipeline',
      startedAt: '00:00:00',
      pendingQuestion: null,
      kind: 'run',
      scanId: null,
      genId: null,
      workspaceId: null,
      projectNames: null,
    }],
  });
  await ctx.tick();
  const card = ctx.window.document.querySelector('#run-list .run-card');
  assert.ok(card, 'a hello-seeded paused run still renders in the Overview');
  // Without makeRun declaring the field, upsertRun's CREATE path drops it.
  assert.equal(ctx.window.__np.getRun('r9').pauseReason, 'cost_pipeline');
  assert.ok(card.querySelector('.cost-banner.cb-pipeline'), 'banner survives a reload');
  assert.equal(card.querySelector('.rc-status-word').textContent, 'Paused · cost limit');
});
