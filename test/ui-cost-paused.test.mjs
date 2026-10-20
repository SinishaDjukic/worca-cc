// test/ui-cost-paused.test.mjs — cost-paused UX: the Runs list row's word (in Needs you and in
// its project group), the run page's banners and Resume, the continue-without-cap override flow,
// total-cap resume gating, and the History parity (the row word, banner in the detail, gated Resume).
// Harness: jsdom boot of the REAL index.html + app.js, with the dispatchable
// WebSocket stub from test/ui-history-cache.test.mjs (so `done`/`budget-changed`
// frames can be pushed into the running client), the mutable `box.budget`
// /api/budget stub from test/ui-budget-indicator.test.mjs, and the
// fetchCalls recorder from test/ui-running-resume.test.mjs.
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
  const dom = trackDom(new JSDOM(readFileSync(htmlPath, 'utf8'), { url: 'http://localhost:4317/' }));
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
  // The bare Runs list with nothing open: forget the remembered run first, or a bare route
  // would reopen it side by side (rule 5).
  const showRunning = () => {
    window.localStorage.removeItem('worca-cc.runs.last');
    window.location.hash = 'running'; window.dispatchEvent(new window.Event('hashchange'));
  };
  const showHistory = () => { window.location.hash = 'history'; window.dispatchEvent(new window.Event('hashchange')); };
  // Open the saved run's DETAIL screen (#history/<key>/<id>) in the Runs pane.
  const showDetail = (key, id) => { window.location.hash = `history/${key}/${id}`; window.dispatchEvent(new window.Event('hashchange')); };
  const settle = async (n = 3) => { for (let i = 0; i < n; i++) await tick(); };
  await tick();  // let the boot /api/budget land
  return { window, wsBox, box, fetchCalls, tick, recv, showRunning, showHistory, showDetail, settle };
}

const historyList = (pipelines) =>
  Promise.resolve({ ok: true, status: 200, json: async () => ({ pipelines, live: [], ghAvailable: false }) });

// A run's row (listed once), and the same row when it sits in Needs you (null when it is not there).
const groupRow = (ctx, sel) => ctx.window.document.querySelector(`#runs-list .runs-row${sel}`);
const needsRow = (ctx, sel) => ctx.window.document.querySelector(`#runs-list .runs-sec[data-section="needs"] .runs-row${sel}`);
// The row's status line head (run-model.mjs singleLine: "Paused · cost limit"), before " · " and the time or project.
// rowWord is the state word alone; rowHead keeps its first n parts ("Paused · cost limit").
const rowWord = (row) => row.querySelector('.runs-row-sub').textContent.split(' · ')[0];
const rowHead = (row, n) => row.querySelector('.runs-row-sub').textContent.split(' · ').slice(0, n).join(' · ');

// Seed one live run via `hello`, then drive it paused with a `done` frame that
// carries the pause reason (the server's done broadcast really carries it —
// orchestrator._completePaused emits it and wireRun spreads the payload).
// Resolves to the run's row in its project group.
async function pausedRun(ctx, reason, detail = undefined) {
  ctx.showRunning();
  ctx.recv({
    type: 'hello',
    runs: [{ runId: 'r1', title: 'Feat', projectDir: PROJECT, status: 'running', startedAt: '00:00:00', pipelineId: 'pl_1' }],
  });
  await ctx.tick();
  ctx.recv({ type: 'done', runId: 'r1', status: 'paused', reason, ...(detail !== undefined ? { detail } : {}) });
  await ctx.settle();
  return groupRow(ctx, '[data-run-id="r1"]');
}

// The cost/error banners and the run's Resume live on the run page (#running/<id>);
// the list row only names the pause and puts the run in Needs you.
async function openRunPage(ctx, runId = 'r1') {
  ctx.window.location.hash = `running/${runId}`;
  ctx.window.dispatchEvent(new ctx.window.Event('hashchange'));
  await ctx.settle();
  return ctx.window.document.querySelector('#run-detail');
}
const resumeOf = (page) => page.querySelector('.rd-pause');

test('cost_pipeline pause: the row reads "Paused · cost limit" in Needs you, the run page shows the amber banner with an enabled Resume', async () => {
  const ctx = await boot();
  const card = await pausedRun(ctx, 'cost_pipeline');
  assert.ok(card, 'paused run still has a row in the Runs list');
  assert.equal(card.querySelector('.cost-banner'), null, 'the list row carries no banner');
  assert.equal(rowHead(card, 2), 'Paused · cost limit');
  const needs = needsRow(ctx, '[data-run-id="r1"]');
  assert.ok(needs, 'the pause puts the run in Needs you, which points at the run page');
  assert.equal(rowHead(needs, 2), 'Paused · cost limit');
  assert.equal(needs.dataset.state, 'paused', 'a pause is not a question');
  const page = await openRunPage(ctx);
  const banner = page.querySelector('.rd-banners .cost-banner');
  assert.ok(banner, 'the run page carries the cost-pause banner');
  assert.equal(banner.hidden, false, 'banner is revealed for a cost pause');
  assert.ok(banner.classList.contains('cb-pipeline'), 'amber per-pipeline variant');
  assert.match(banner.textContent, /pipeline cost limit/);
  assert.ok(banner.querySelector('.cb-override'), 'override action offered');
  assert.equal(resumeOf(page).dataset.action, 'resume', 'the pane control is Resume while paused');
  assert.equal(resumeOf(page).disabled, false, 'per-pipeline pause never blocks the run page Resume');
  assert.equal(resumeOf(page).querySelector('.rd-btn-label').textContent, 'Resume');
});

test('cb-override: confirm -> exactly one resume POST with ignoreCostCap:true; cancel posts nothing', async () => {
  const ctx = await boot();
  await pausedRun(ctx, 'cost_pipeline');
  const page = await openRunPage(ctx);
  // Cancel first: the confirm row then proves the same banner still posts exactly once.
  await checkRows([
    { name: 'cb-override: cancelling the confirm posts nothing', run: async () => {
      page.querySelector('.cb-override').click();
      await ctx.tick();
      ctx.window.document.querySelector('#confirm-cancel').click();
      await ctx.tick();
      await ctx.tick();
      assert.equal(ctx.fetchCalls.filter((c) => c.url.includes('/api/resume')).length, 0);
    } },
    { name: 'cb-override: confirm modal -> single resume POST with ignoreCostCap:true', run: async () => {
      page.querySelector('.cb-override').click();
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
      assert.deepEqual(JSON.parse(posts[0].opts.body), { pipelineId: 'pl_1', baseCheck: true, ignoreCostCap: true });
    } },
  ]);
});

test('cost_total pause: red banner, Resume disabled with reset-date tooltip', async () => {
  const ctx = await boot({ budget: blockedBudget() });
  const card = await pausedRun(ctx, 'cost_total');
  assert.equal(card.querySelector('.cost-banner'), null, 'no banner on the list row');
  assert.equal(rowHead(card, 2), 'Paused · total budget');
  assert.equal(rowHead(needsRow(ctx, '[data-run-id="r1"]'), 2), 'Paused · total budget', 'in Needs you too');
  const page = await openRunPage(ctx);
  assert.ok(page.querySelector('.rd-banners .cost-banner.cb-total'), 'red total-budget variant on the run page');
  assert.equal(page.querySelector('.cost-banner .cb-override'), null, 'no per-pipeline override on a total-cap pause');
  const pageResume = resumeOf(page);
  assert.equal(pageResume.dataset.action, 'resume');
  assert.equal(pageResume.disabled, true, 'the run page Resume is gated');
  assert.match(pageResume.title, /Total budget reached/);
});

test('budget-changed unblocking re-enables Resume on the run page', async () => {
  const ctx = await boot({ budget: blockedBudget() });
  await pausedRun(ctx, 'cost_total');
  await openRunPage(ctx);
  const resume = () => ctx.window.document.querySelector('#run-detail .rd-pause[data-action="resume"]');
  assert.ok(resume(), 'the pane offers Resume for the paused run');
  assert.equal(resume().disabled, true, 'blocked while the total budget is over');
  ctx.box.budget = okBudget();
  ctx.recv({ type: 'budget-changed', action: null });
  await ctx.settle();
  assert.equal(resume().disabled, false, 'a raised/reset budget must unblock the parked run');
  // Clearing the blocked tooltip must restore the Resume help text, not blank the button.
  assert.doesNotMatch(resume().title, /Total budget reached/);
  assert.match(resume().title, /^Resume/, 'the ordinary Resume tooltip comes back');
});

test('non-cost pauses (manual, error) read \'Paused\' in Needs you, show no cost banner (error banner for an error pause) and keep Resume enabled', async () => {
  await checkRows([
    { name: 'a non-cost pause reads a plain "Paused" and shows no banner', run: async () => {
      const ctx = await boot();
      const card = await pausedRun(ctx, undefined);   // manual pause carries no reason
      assert.equal(rowWord(card), 'Paused');
      assert.equal(rowWord(needsRow(ctx, '[data-run-id="r1"]')), 'Paused', 'every pause needs you (D5)');
      const page = await openRunPage(ctx);
      assert.equal(page.querySelector('.rd-banners .cost-banner'), null, 'no cost banner on the run page');
      assert.equal(page.querySelector('.rd-banners .pause-error-banner'), null, 'no error banner either');
      assert.equal(resumeOf(page).disabled, false);
    } },
    { name: 'an error pause: the row reads "Paused" in Needs you, error banner (no cost banner) on the run page, Resume enabled', run: async () => {
      const ctx = await boot();
      const card = await pausedRun(ctx, 'error', 'claude exited with code 1: disk full');
      assert.equal(rowWord(card), 'Paused');
      assert.equal(card.querySelector('.cost-banner'), null);
      assert.equal(rowWord(needsRow(ctx, '[data-run-id="r1"]')), 'Paused');
      const page = await openRunPage(ctx);
      assert.equal(page.querySelector('.rd-banners .cost-banner'), null, 'no cost banner for an error pause');
      assert.match(page.querySelector('.rd-banners .pause-error-banner').textContent, /disk full/);
      assert.equal(resumeOf(page).disabled, false, 'an error pause is always resumable from the run page too');
    } },
  ]);
});

// Resume + the cost-pause banner live on the History DETAIL screen; the list row
// only names the pause ("Cost limit", "Total budget").
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

test('history: the row names the pause; the detail screen shows the banner and gates Resume', async () => {
  const ctx = await boot({ budget: blockedBudget(), fetchHandler: pausedArms });
  ctx.showHistory();
  await ctx.settle();
  const cards = ctx.window.document.querySelectorAll('#runs-list .runs-row[data-kind="hist"]');
  assert.equal(cards.length, 2);

  assert.equal(rowHead(groupRow(ctx, '[data-pipeline-id="h1"]'), 2), 'Paused · cost limit');
  assert.equal(rowHead(groupRow(ctx, '[data-pipeline-id="h2"]'), 2), 'Paused · total budget');
  assert.ok(needsRow(ctx, '[data-pipeline-id="h2"]'), 'a paused saved run not live in this tab needs you (D5)');

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
  assert.deepEqual(JSON.parse(posts[0].opts.body), { pipelineId: 'h1', baseCheck: true, ignoreCostCap: true });
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

test('reload parity: a hello-seeded paused run with pauseReason renders its row word and, on its page, the banner', async () => {
  const ctx = await boot();
  ctx.showRunning();
  // Field-for-field the real hello summary: every key ui/server.mjs
  // summarizeRuns() emits, in its order. The SERVER half of this contract
  // (wireRun storing entry.pauseReason, summarizeRuns emitting it) is pinned
  // separately by the pauseReason tests in test/server-event-names.test.mjs — keep the two in step.
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
      genId: null,
      workspaceId: null,
      projectNames: null,
    }],
  });
  await ctx.settle();
  const card = groupRow(ctx, '[data-run-id="r9"]');
  assert.ok(card, 'a hello-seeded paused run still renders in the Runs list');
  // Without makeRun declaring the field, upsertRun's CREATE path drops it.
  assert.equal(ctx.window.__np.getRun('r9').pauseReason, 'cost_pipeline');
  assert.equal(rowHead(needsRow(ctx, '[data-run-id="r9"]'), 2), 'Paused · cost limit', 'Needs you survives a reload');
  assert.equal(card.querySelector('.cost-banner'), null, 'the banner is a run-page thing');
  assert.equal(rowHead(card, 2), 'Paused · cost limit');
  const page = await openRunPage(ctx, 'r9');
  assert.ok(page.querySelector('.rd-banners .cost-banner.cb-pipeline'), 'banner survives a reload');
});

// ---------------------------------------------------------------------------
// Error pauses in History: the row word, the detail banner, and the
// deep-link fallback onto the DETAIL payload (rowToState now carries both keys).
// ---------------------------------------------------------------------------
const ERROR_ENTRIES = [
  { id: 'h3', projectKey: 'k1', title: 'Blew up', status: 'paused', pauseReason: 'error',
    pauseDetail: 'claude exited with code 1: disk full', startedAt: '2026-09-02T00:00:00Z' },
];
const errorDetailArm = (id) => Promise.resolve({
  ok: true, status: 200,
  json: async () => ({ state: { id, phase: 'implement', status: 'paused', totalCostUsd: 1.2, steps: [],
                                pauseReason: 'error', pauseDetail: 'claude exited with code 1: disk full' } }),
});
const errorArms = (url) => {
  if (url.endsWith('/api/history/k1/h3')) return errorDetailArm('h3');
  if (url.endsWith('/api/history')) return historyList(ERROR_ENTRIES);
  return null;
};

test('history error pause: row reads Paused, detail shows the error banner + enabled Resume, also from a deep link with no list row', async () => {
  await checkRows([
    { name: 'history: an error pause reads "Paused" on its row; the detail screen shows the error banner and an enabled Resume', run: async () => {
      const ctx = await boot({ fetchHandler: errorArms });
      ctx.showHistory();
      await ctx.settle();
      const card = groupRow(ctx, '[data-pipeline-id="h3"]');
      assert.ok(card, 'the paused saved run is listed');
      assert.equal(rowWord(card), 'Paused');

      ctx.showDetail('k1', 'h3');
      await ctx.settle();
      const resume = ctx.window.document.querySelector('#hist-detail .hd-resume');
      assert.equal(resume.disabled, false, 'an error pause never gates Resume');
      assert.match(resume.title, /Paused after an error: claude exited with code 1: disk full/);
      const banner = ctx.window.document.querySelector('#hist-detail .hd-banners .pause-error-banner');
      assert.ok(banner, 'the detail screen shows the error-pause banner');
      assert.match(banner.textContent, /Paused after an error/);
      assert.match(banner.textContent, /disk full/);
      assert.equal(ctx.window.document.querySelector('#hist-detail .hd-banners .cost-banner'), null, 'no cost banner for an error pause');
    } },
    { name: 'history deep link: the DETAIL payload alone (no list row yet) still shows the error banner', run: async () => {
      // A list without the entry — only the detail arm knows the pause cause (rowToState).
      const arms = (url) => (url.endsWith('/api/history/k1/h3') ? errorDetailArm('h3') : (url.endsWith('/api/history') ? historyList([]) : null));
      const ctx = await boot({ fetchHandler: arms });
      ctx.showDetail('k1', 'h3');
      await ctx.settle();
      const banner = ctx.window.document.querySelector('#hist-detail .hd-banners .pause-error-banner');
      assert.ok(banner, 'the banner falls back to data.state.pauseReason/pauseDetail');
      assert.match(banner.textContent, /disk full/);
    } },
  ]);
});
