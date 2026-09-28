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
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import { renderBudgetRing, renderBudgetStack, railUsd } from '../ui/public/stats-view.mjs';

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

async function boot({ budget = okBudget(), tickMs, idleRefetchMs } = {}) {
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
  // `budgetGate` does the same for one GET /api/budget: a held fetch is what a
  // second refresh request has to coalesce behind.
  const box = { budget, runResponse: null, budgetGate: null };
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
  assert.equal(doc.querySelector('#topnav-spend').classList.contains('over'), false);
  assert.equal(doc.querySelector('#topnav-spend').textContent, '$41.23');
});

// ---- collapsed-rail budget ring ----
// Pure renderer: its own bare document, no app.js boot.
const pureDoc = () => new JSDOM('<!doctype html><body></body>').window.document;
const ringBudget = (over) => ({
  totalLimitUsd: 50, resetPeriod: 'monthly', windowEndMs: Date.now() + 4 * DAY,
  blocked: false, ...over,
});

test('the ring meters spend against the total limit', () => {
  const el = renderBudgetRing(ringBudget({ windowSpendUsd: 20 }), { doc: pureDoc() });
  assert.equal(el.style.getPropertyValue('--ring-pct'), '40');
  assert.equal(el.querySelector('.spend-ring-val').textContent, '40%');
  assert.equal(el.classList.contains('warn'), false);
  assert.equal(el.classList.contains('over'), false);
});

test('the ring keeps .spend-ind and data-nav so the click still routes to #stats', () => {
  const el = renderBudgetRing(ringBudget({ windowSpendUsd: 20 }), { doc: pureDoc() });
  assert.ok(el.classList.contains('spend-ind'),
    'app.js:517 routes the sidebar spend click via closest(".spend-ind")');
  assert.ok(el.classList.contains('spend-ring'));
  assert.equal(el.dataset.nav, 'stats');
  assert.equal(el.tagName, 'BUTTON');
});

test('the ring turns amber at the warn threshold and red when blocked', () => {
  const warn = renderBudgetRing(ringBudget({ windowSpendUsd: 41.23 }), { doc: pureDoc() });
  assert.ok(warn.classList.contains('warn'), '82% of the cap is the warn band');
  const over = renderBudgetRing(ringBudget({ windowSpendUsd: 61, blocked: true }), { doc: pureDoc() });
  assert.ok(over.classList.contains('over'));
  assert.equal(over.style.getPropertyValue('--ring-pct'), '100');
  assert.equal(over.querySelector('.spend-ring-val').textContent, '100%');
});

test('the ring clamps its arc to 0-100 whatever the raw ratio is', () => {
  // Both clamps were proven vacuous in v1 — deleting either kept every test green.
  const hot = renderBudgetRing(ringBudget({ windowSpendUsd: 75 }), { doc: pureDoc() });
  assert.equal(hot.style.getPropertyValue('--ring-pct'), '100',
    '150% of the cap must not sweep the arc past a full circle');
  assert.equal(hot.querySelector('.spend-ring-val').textContent, '100%');
  const credit = renderBudgetRing(ringBudget({ windowSpendUsd: -5 }), { doc: pureDoc() });
  assert.equal(credit.style.getPropertyValue('--ring-pct'), '0',
    'a refund/credit must not sweep a negative arc');
  assert.equal(credit.querySelector('.spend-ring-val').textContent, '0%');
});

// ---- collapsed rail with NO total limit: the Spent/Saved stack ----
const stackBudget = (over) => ({
  totalLimitUsd: null, resetPeriod: 'monthly', windowEndMs: Date.now() + 4 * DAY,
  blocked: false, windowSpendUsd: 10604.7, windowHumanHours: 1512, windowSavedUsd: 42315.3, ...over,
});

test('no total limit renders the Spent/Saved stack, not a ring', () => {
  const el = renderBudgetRing(stackBudget(), { doc: pureDoc() });
  assert.ok(el.classList.contains('spend-stack'));
  assert.equal(el.classList.contains('spend-ring'), false, 'no disc to clip the amount');
  assert.equal(el.querySelector('.spend-ring-val'), null);
  assert.equal(el.style.getPropertyValue('--ring-pct'), '', 'no arc without a denominator');
  const pairs = [...el.querySelectorAll('.spend-stack-pair')].map((p) =>
    [p.querySelector('.spend-stack-lbl').textContent, p.querySelector('.spend-stack-val').textContent]);
  assert.deepEqual(pairs, [['Spent', '$11k'], ['Saved', '$42k']]);
  const [spentPair, savedPair] = el.querySelectorAll('.spend-stack-pair');
  assert.ok(savedPair.classList.contains('pos'), 'a gain is green, as in the expanded card');
  assert.equal(spentPair.classList.contains('pos'), false, 'Spent stays neutral ink');
  // The compact figures are for the eye; exact ones reach the title and the accessible name.
  assert.equal(el.getAttribute('aria-label'),
    'Spent this month: $10,604.70 · Saved this month: $42,315.30');
  assert.match(el.title, /^Spent this month: \$10,604\.70 · Saved this month: \$42,315\.30 · resets /);
  assert.match(el.title, /not authoritative billing/);
  assert.doesNotMatch(el.title, /no total limit/);
});

test('the stack keeps .spend-ind and data-nav so the click still routes to #stats', () => {
  const el = renderBudgetStack(stackBudget(), { doc: pureDoc() });
  assert.ok(el.classList.contains('spend-ind'), 'app.js routes the rail click via closest(".spend-ind")');
  assert.equal(el.dataset.nav, 'stats');
  assert.equal(el.tagName, 'BUTTON');
  assert.equal(el.type, 'button');
});

test('the stack signs a loss, follows a weekly window, and drops Saved when the payload has none', () => {
  const loss = renderBudgetStack(stackBudget({ resetPeriod: 'weekly', windowSavedUsd: -8800 }),
    { doc: pureDoc() });
  const val = loss.querySelectorAll('.spend-stack-val')[1];
  assert.equal(val.textContent, '−$8.8k', 'the sign carries the loss');
  assert.equal(val.parentElement.classList.contains('pos'), false, 'a loss is never green');
  assert.match(loss.getAttribute('aria-label'), /Saved this week: −\$8,800\.00$/);
  const none = renderBudgetStack(stackBudget({ windowSavedUsd: null }), { doc: pureDoc() });
  assert.equal(none.querySelectorAll('.spend-stack-pair').length, 1, 'Spent alone, never a fake $0');
  assert.equal(none.getAttribute('aria-label'), 'Spent this month: $10,604.70');
});

test('railUsd: at most five glyphs unsigned, tiers decided on the ROUNDED value', () => {
  const cases = [
    [0, '$0'], [4.21, '$4'], [317.4, '$317'], [999.49, '$999'],
    [999.5, '$1k'],            // not "$1000"
    [1049, '$1k'], [1050, '$1.1k'], [3168.85, '$3.2k'], [8800, '$8.8k'], [9949, '$9.9k'],
    [9950, '$10k'],            // not "$10.0k"
    [10604.7, '$11k'], [12400, '$12k'], [999499, '$999k'],
    [999500, '$1M'],           // not "$1000k"
    [1250000, '$1.3M'], [9949999, '$9.9M'], [9950000, '$10M'], [123456789, '$123M'],
    [-0.4, '$0'],              // no "−$0"
    [-12.5, '−$13'], [-8800, '−$8.8k'], [-42315.3, '−$42k'],
    [null, '$0'], [undefined, '$0'], [Number.NaN, '$0'],
  ];
  for (const [n, want] of cases) assert.equal(railUsd(n), want, `railUsd(${n})`);
  for (let n = 0; n < 2e8; n = n * 1.37 + 7.3) {
    assert.ok(railUsd(n).length <= 5, `railUsd(${n}) = ${railUsd(n)} is wider than five glyphs`);
  }
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

test('an ask-done frame refetches the budget (D12 sidebar half)', async () => {
  const ctx = await boot();
  const before = ctx.counts.budget;
  ctx.wsBox.ws.dispatch('message', { data: JSON.stringify({ type: 'ask-done',
    threadId: 'ask_00000000', messageId: 'askm_00000000', status: 'done',
    usage: {}, costUsd: 0.1, threadTotals: null }) });
  await ctx.tick();
  await ctx.tick();
  assert.ok(ctx.counts.budget > before, 'the sidebar indicator repaints on chat spend');
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
  assert.equal(doc.querySelector('#side-spend .spend-ind').classList.contains('over'), false);
});
