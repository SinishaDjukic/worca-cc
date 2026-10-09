// test/ui-budget-indicator.test.mjs
// Always-visible spend: the ring around the account avatar and the account menu's spend
// card, the New-view creation gate, click-through to #stats, and the countdown tick
// (idle recompute vs. rolled-over refetch). Boots the REAL app.js against the
// REAL index.html under jsdom (harness from test/ui-stats.test.mjs) with the
// dispatchable WebSocket stub from test/ui-history-cache.test.mjs so
// `budget-changed` frames can be pushed into the running client.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import { ringDash, RING_R } from '../ui/public/account-menu.mjs';
import { minLevelFor } from '../ui/public/ui-level.mjs';
import { useDomRelease } from './helpers/jsdom-release.mjs';
import { checkRows } from './helpers/rows.mjs';

// Release each booted window after its test (see test/helpers/jsdom-release.mjs).
const trackDom = useDomRelease(afterEach);

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

async function boot({ budget = okBudget(), tickMs, idleRefetchMs, free = null } = {}) {
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
  // `runResponse` lets a test hold POST /api/run open and drive events into the
  // in-flight window between "Start disabled" and the response landing.
  // `budgetGate` does the same for one GET /api/budget: a held fetch is what a
  // second refresh request has to coalesce behind.
  const box = { budget, free, runResponse: null, budgetGate: null };
  const counts = { budget: 0, stats: 0 };
  const statsCalls = [];
  window.fetch = (url, opts) => {
    const u = String(url);
    if (u.endsWith('/api/run') && opts && opts.method === 'POST') {
      return box.runResponse
        || Promise.resolve({ ok: true, status: 200, json: async () => ({ runId: 'run-1' }) });
    }
    // box.free: the OpenRouter free-request status (null: OpenRouter is off).
    if (u.includes('/api/openrouter/free-daily')) return Promise.resolve({ ok: true, status: 200, json: async () => box.free || { enabled: false } });
    if (u.includes('/api/budget')) {
      counts.budget += 1;
      // The server answers with the budget as it was when the request arrived —
      // snapshot it here so a held response cannot silently report a LATER
      // server state than the one it was issued against.
      const snap = box.budget;
      const gate = box.budgetGate;
      box.budgetGate = null;                     // one-shot: gates the next fetch only
      const res = { ok: true, status: 200, json: async () => snap };
      return gate ? gate.then(() => res) : Promise.resolve(res);
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
  // The tick seams are read ONCE inside startBudgetTick() at boot, so they have
  // to be on `window` between JSDOM creation and the cache-busted app.js import.
  if (tickMs != null) window.__budgetTickMs = tickMs;
  if (idleRefetchMs != null) window.__budgetIdleRefetchMs = idleRefetchMs;
  // app.js starts its budget tick at import time against the REAL global
  // setInterval (jsdom's is never installed on globalThis here). Capture the
  // ids so a fast-tick suite can stop its own timer: a leaked one repaints —
  // and, now that an idle tab re-verifies, refetches — into whatever document
  // and fetch stub happen to be global by the time the next suite runs.
  const timers = [];
  const realSetInterval = globalThis.setInterval;
  globalThis.setInterval = (...a) => { const t = realSetInterval(...a); timers.push(t); return t; };
  try {
    await import(pathToFileURL(appPath).href + `?b=${Date.now()}_${Math.random()}`);
  } finally { globalThis.setInterval = realSetInterval; }
  const stopTimers = () => { timers.forEach((t) => clearInterval(t)); timers.length = 0; };
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
  return { window, box, counts, statsCalls, wsBox, tick, wait, pushBudgetChanged, showView, stopTimers };
}

// The corner (#side-acct: data-spend none | ok | warn | over, the ring's arc) and the spend card in the menu.
const ring = (doc) => { const b = doc.getElementById('side-acct'); return [b.dataset.spend, b.querySelector('.acct-ring .arc').getAttribute('stroke-dasharray')]; };
const card = (doc) => doc.querySelector('#acct-spend .spend-card');
const cardRows = (doc) => [...card(doc).querySelectorAll('.mc-rows dt')].map((dt) => [dt.textContent, dt.nextElementSibling.textContent, dt.nextElementSibling.className]);

test('spend ring and card: boot paints them (warn band), budget-changed repaints, blocked disables Start with a reason and clears again; Details and Raise limit route', async () => {
  const ctx = await boot();
  const { window, tick } = ctx;
  const doc = window.document;
  await checkRows([
    { name: 'boot paints the ring around the avatar and the spend card in the menu', run: async () => {
      assert.deepEqual(ring(doc), ['warn', ringDash(41.23 / 50, RING_R)], '82% of the cap is the warn band');
      assert.equal(doc.getElementById('acct-spend').hidden, false);
      assert.deepEqual(cardRows(doc), [['Limit', '$50.00', ''], ['Spent', '$41.23', 'warn']]);
      assert.equal(card(doc).querySelector('.mc-btn').textContent, 'Details');
      assert.match(doc.getElementById('side-acct').getAttribute('aria-label'), /· \$41\.23 of \$50\.00 spent in \w+: spend, away mode, interface mode and settings$/);
    } },
    { name: 'budget-changed repaints; blocked: a red full ring, Raise limit and the note; Start disabled with a reason', run: async () => {
      assert.equal(doc.querySelector('#start-btn').disabled, false, 'unblocked boot leaves Start enabled');
      assert.equal(doc.querySelector('#newBlockedNote').hidden, true);

      ctx.box.budget = blockedBudget();
      await ctx.pushBudgetChanged();

      assert.deepEqual(ring(doc), ['over', ringDash(1, RING_R)]);
      assert.equal(card(doc).querySelector('.mc-btn').textContent, 'Raise limit');
      assert.match(card(doc).querySelector('.mc-note').textContent, /^New runs are blocked until \w{3} \w{3} \d+, \d\d:\d\d\.$/);
      assert.equal(doc.querySelector('#start-btn').disabled, true);
      const note = doc.querySelector('#newBlockedNote');
      assert.equal(note.hidden, false);
      assert.match(note.textContent, /\$52\.13 of \$50\.00/);
      assert.match(note.textContent, /blocked until/);
      for (const el of [doc.getElementById('side-acct'), card(doc), note]) {
        assert.equal(minLevelFor(el), 'simple', 'a block is never hidden at any interface mode');
      }

      ctx.box.budget = okBudget();
      await ctx.pushBudgetChanged();
      assert.equal(doc.querySelector('#start-btn').disabled, false, 'clearing the block re-enables Start');
      assert.equal(doc.querySelector('#newBlockedNote').hidden, true);
      assert.equal(ring(doc)[0], 'warn');
    } },
    { name: 'Details opens Statistics and closes the menu; blocked, Raise limit opens the budget card in Settings › Runs', run: async () => {
      doc.getElementById('side-acct').click();
      assert.equal(doc.getElementById('acct-menu').hidden, false);
      card(doc).querySelector('.mc-btn').click();
      await tick();
      assert.equal(window.location.hash, '#stats');
      assert.equal(doc.getElementById('acct-menu').hidden, true);
      ctx.box.budget = blockedBudget();
      await ctx.pushBudgetChanged();
      doc.getElementById('side-acct').click();
      card(doc).querySelector('.mc-btn').click();
      await tick();
      assert.equal(window.location.hash, '#settings/runs/budget');
      assert.equal(doc.getElementById('acct-menu').hidden, true);
      const runsPaneShown = () => !doc.querySelector('[data-view="settings"]').classList.contains('hidden')
        && !doc.querySelector('.settings-pane[data-tab="runs"]').classList.contains('hidden');
      assert.ok(runsPaneShown(), 'Settings › Runs is open');
      doc.getElementById('side-acct').click();               // again, from the page it already opened
      card(doc).querySelector('.mc-btn').click();
      await tick();
      assert.equal(window.location.hash, '#settings/runs/budget');
      assert.ok(runsPaneShown(), 'the same hash routes too (no hashchange: showView directly)');
      for (let i = 0; i < 4; i++) await tick();             // showView reloads Settings, then focuses the card
      assert.ok(doc.getElementById('budget-settings-card').contains(doc.activeElement),
        'and lands on the budget card again (the pane alone was already showing, so it proves nothing)');
      ctx.box.budget = okBudget();
      await ctx.pushBudgetChanged();
    } },
  ]);
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

test('a run finishing and an ask-done frame both refetch the budget (creation gate flips without reload)', async () => {
  const ctx = await boot();
  await checkRows([
    { name: 'a run finishing refetches the budget so the final delta lands without a reload', run: async () => {
      // A non-cost `done` broadcasts nothing (the server emits budget-changed only for
      // cost pauses, and pipelines-changed only on archive), and the slow tick refetches
      // only while runs are live — so the LAST spend delta, and a `blocked` flip it
      // causes, went unseen until a reload: Start stayed enabled and the click hit the
      // raw 403 instead of the pre-emptive gate.
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
    } },
    { name: 'an ask-done frame refetches the budget (D12 sidebar half)', run: async () => {
      const before = ctx.counts.budget;
      ctx.wsBox.ws.dispatch('message', { data: JSON.stringify({ type: 'ask-done',
        threadId: 'ask_00000000', messageId: 'askm_00000000', status: 'done',
        usage: {}, costUsd: 0.1, threadTotals: null }) });
      await ctx.tick();
      await ctx.tick();
      assert.ok(ctx.counts.budget > before, 'the sidebar indicator repaints on chat spend');
    } },
  ]);
});

// refreshBudget used to DROP any refresh asked for while one was in flight. Two
// broadcasts close together (a total limit set, then cleared) therefore left the
// FIRST, older snapshot latched in budgetState.budget — the spend card kept
// saying "new runs blocked" and Start stayed disabled until a reload.
test('a refresh asked for mid-flight runs a trailing fetch and the newer snapshot wins', async () => {
  const ctx = await boot();
  const doc = ctx.window.document;
  const before = ctx.counts.budget;

  let releaseBudget;
  ctx.box.budgetGate = new Promise((r) => { releaseBudget = r; });
  ctx.box.budget = blockedBudget();
  await ctx.pushBudgetChanged();               // fetch #1: held, carries `blocked`
  assert.equal(ctx.counts.budget, before + 1, 'the first refresh is in flight');

  // The limit is cleared server-side while that fetch hangs; every request made
  // inside the in-flight window collapses into ONE trailing fetch.
  ctx.box.budget = okBudget();
  await ctx.pushBudgetChanged();
  await ctx.pushBudgetChanged();
  await ctx.pushBudgetChanged();
  assert.equal(ctx.counts.budget, before + 1, 'requests made mid-flight do not each fetch');

  releaseBudget();
  for (let i = 0; i < 6; i += 1) await ctx.tick();

  assert.equal(ctx.counts.budget, before + 2,
    'exactly one trailing fetch runs once the in-flight one settles');
  assert.equal(doc.querySelector('#start-btn').disabled, false,
    'the newer, unblocked snapshot is painted — the stale blocked one must not latch');
  assert.equal(doc.querySelector('#newBlockedNote').hidden, true);
  assert.equal(ring(doc)[0], 'warn', 'the ring follows the newer snapshot');
  assert.deepEqual(cardRows(doc)[1], ['Spent', '$41.23', 'warn']);
});

// The tick suites run last and each stops its own interval: a fast tick that
// outlives its test repaints — and, on the slow idle cadence, refetches — into
// whatever document and fetch stub are global by then, which would make a later
// suite's DOM and /api/budget call count nonsense.
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
  ctx.stopTimers();
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
  ctx.stopTimers();
  assert.ok(ctx.counts.budget > before,
    'once the boundary passes the client must re-derive spend/blocked server-side');
});

// An idle tab saw no `budget-changed` for a limit cleared elsewhere and the tick
// only refetched while runs were live or past windowEndMs — so whatever snapshot
// the tab last saw outlived the truth until a reload. The slow idle cadence
// re-verifies it.
test('an idle tab refetches on the slow cadence and clears a stale blocked snapshot', async () => {
  const ctx = await boot({
    tickMs: 5,
    idleRefetchMs: 12,
    budget: { ...blockedBudget(), windowEndMs: Date.now() + 2 * HOUR, msUntilReset: 2 * HOUR },
  });
  const doc = ctx.window.document;
  assert.equal(doc.querySelector('#start-btn').disabled, true, 'the tab booted blocked');
  const before = ctx.counts.budget;

  ctx.box.budget = { ...okBudget(), windowEndMs: Date.now() + 2 * HOUR, msUntilReset: 2 * HOUR };
  await ctx.wait(60);                            // no live runs, window not rolled over
  ctx.stopTimers();

  assert.ok(ctx.counts.budget > before,
    'an idle tab must re-verify the snapshot on the slow cadence');
  assert.equal(doc.querySelector('#start-btn').disabled, false,
    'the cleared limit reaches the creation gate without a reload');
  assert.equal(doc.querySelector('#newBlockedNote').hidden, true);
  assert.equal(ring(doc)[0], 'warn', 'the red ring clears too');
});

test('the spend card re-rendered under the keyboard keeps focus on its button', async () => {
  const ctx = await boot();
  const doc = ctx.window.document;
  doc.getElementById('side-acct').click();                 // a keyboard open (detail 0): focus lands on Details
  assert.equal(doc.activeElement, card(doc).querySelector('.mc-btn'));
  ctx.box.budget = { ...okBudget(), windowSpendUsd: 42 };
  await ctx.pushBudgetChanged();
  assert.deepEqual(cardRows(doc)[1], ['Spent', '$42.00', 'warn'], 'the card was re-rendered');
  assert.equal(doc.activeElement, card(doc).querySelector('.mc-btn'), 'focus is on the new Details, never on <body>');
  ctx.box.budget = blockedBudget();
  await ctx.pushBudgetChanged();
  assert.equal(doc.activeElement.textContent, 'Raise limit', 'and follows the button as it changes');
  ctx.box.budget = okBudget();
  await ctx.pushBudgetChanged();
});

test('the spend card re-rendered under the keyboard keeps focus on the free-request row too', async () => {
  const ctx = await boot({ free: { enabled: true, known: true, limit: 50, remaining: 4, resetAt: new Date(Date.now() + 3 * HOUR).toISOString(), models: [] } });
  const doc = ctx.window.document;
  doc.getElementById('side-acct').click();
  card(doc).querySelector('.mc-free').focus();
  ctx.box.budget = { ...okBudget(), windowSpendUsd: 42 };
  await ctx.pushBudgetChanged();
  assert.deepEqual(cardRows(doc)[1], ['Spent', '$42.00', 'warn'], 'the card was re-rendered');
  assert.equal(doc.activeElement, card(doc).querySelector('.mc-free'), 'focus stays on the free-request row, not on Details');
  ctx.box.budget = okBudget();
  await ctx.pushBudgetChanged();
});

test('the open account menu is placed again when its spend card changes height (a block lands)', async () => {
  const ctx = await boot();
  const doc = ctx.window.document;
  const acct = doc.getElementById('side-acct');
  const menu = doc.getElementById('acct-menu');
  // jsdom lays nothing out: the corner near the foot of its 768px window, the menu as tall as its cards.
  acct.getBoundingClientRect = () => ({ left: 10, top: 700, width: 200, height: 46, right: 210, bottom: 746, x: 10, y: 700 });
  let h = 200;
  Object.defineProperty(menu, 'offsetHeight', { configurable: true, get: () => h });
  acct.click();
  assert.equal(menu.style.top, '494px', 'opened upward: 700 - 200 - 6');
  h = 260;                                                    // the blocked note makes the card taller
  ctx.box.budget = blockedBudget();
  await ctx.pushBudgetChanged();
  assert.equal(menu.style.top, '434px', 'placed again, so it still ends 6px above the corner');
  ctx.box.budget = okBudget();
  await ctx.pushBudgetChanged();
});
