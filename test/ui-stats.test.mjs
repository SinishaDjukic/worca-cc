// test/ui-stats.test.mjs
// Statistics view integration: the nav entry in BOTH menus, the #stats route and
// its loader, the range segmented control, and the WS-driven refresh. Boots the
// REAL app.js against the REAL index.html under jsdom (harness from
// test/ui-cost.test.mjs) but with the dispatchable WebSocket stub from
// test/ui-history-cache.test.mjs so `pipelines-changed` can be pushed into the
// running client.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import { useDomRelease } from './helpers/jsdom-release.mjs';
import { checkRows } from './helpers/rows.mjs';
import { applyFlags } from '../ui/public/flags.mjs';

// Release each booted window after its test (see test/helpers/jsdom-release.mjs).
const trackDom = useDomRelease(afterEach);

const htmlPath = fileURLToPath(new URL('../ui/public/index.html', import.meta.url));
const appPath = fileURLToPath(new URL('../ui/public/app.js', import.meta.url));
const PROJECT = '/tmp/proj';

const STATS_FIXTURE = {
  range: 'week', bucket: 'day',
  windowStartMs: Date.now() - 3 * 86400000, windowEndMs: Date.now() + 4 * 86400000,
  totals: { spentUsd: 3.5, pipelineSpendUsd: 3, ask: { spendUsd: 0.5, sessions: 2, turns: 4 },
    workedMs: 7200000, runs: 3, finished: 2, stopped: 1,
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
  people: [], filtered: false, groups: null,
};

async function boot({ fetchHandler } = {}) {
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
  await import(pathToFileURL(appPath).href + `?b=${Date.now()}_${Math.random()}`);
  await new Promise((r) => setTimeout(r, 0));
  const tick = () => new Promise((r) => setTimeout(r, 0));
  const showStats = async () => {
    window.location.hash = 'stats';
    window.dispatchEvent(new window.Event('hashchange'));
    await tick();
  };
  return { window, calls, wsBox, tick, showStats };
}

test('nav: the sidebar carries data-nav="stats"; #stats opens the view and fetches', async () => {
  const { window, calls, showStats } = await boot();
  assert.ok(window.document.querySelector('.sidebar [data-nav="stats"]'), 'sidebar Statistics button');
  await showStats();
  const section = window.document.querySelector('[data-view="stats"]');
  assert.ok(section, 'stats section exists');
  assert.ok(!section.classList.contains('hidden'), 'stats section shown');
  // The /api/budget fixture is MONTHLY, so the default range is 'month' — here
  // because budgetState is still the null placeholder, and later because the
  // real budgetState reads the monthly fixture.
  assert.ok(calls.some((u) => u.includes('range=month')), 'default range is month');
  assert.ok(window.document.querySelector('#stats-body .stat-row'), 'KPI row painted');
  assert.equal(window.document.querySelectorAll('#stats-body .stat-tile').length, 7);
});

// Each button boots its own page, so "the previous segment" is always Month (cuts the count, not the time).
test('the range control refetches with range=all / range=today and moves .on', async () => {
  await checkRows([
    { name: 'range seg: clicking All time refetches range=all and moves .on', run: async () => {
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
    } },
    { name: 'range seg: clicking Today refetches range=today and moves .on', run: async () => {
      const { window, calls, tick, showStats } = await boot();
      await showStats();
      const todayBtn = window.document.querySelector('#stats-range [data-range="today"]');
      assert.ok(todayBtn, 'Today button exists in the segmented control');
      todayBtn.click();
      await tick();
      assert.ok(calls.some((u) => u.includes('range=today')), 'refetched with range=today');
      assert.ok(todayBtn.classList.contains('on'), 'Today is the highlighted segment');
      assert.equal(window.document.querySelector('#stats-range [data-range="month"]').classList.contains('on'),
        false, 'the previous segment lost .on');
    } },
  ]);
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

test('while Statistics is open, pipelines-changed, ask-done and ask-error refetch /api/stats; other ask-* frames do not', async () => {
  const { window, calls, wsBox, tick, showStats } = await boot();
  await showStats();
  await checkRows([
    { name: 'pipelines-changed while stats open refetches', run: async () => {
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
    } },
    { name: 'ask-done and ask-error while stats open refetch; other ask-* frames do not', run: async () => {
      const before = calls.length;
      wsBox.ws.dispatch('message', { data: JSON.stringify(
        { type: 'ask-usage', threadId: 'ask_00000000', messageId: 'askm_00000000', usage: {} }) });
      await tick();
      assert.equal(calls.length, before, 'ask-usage does not refetch');
      wsBox.ws.dispatch('message', { data: JSON.stringify(
        { type: 'ask-done', threadId: 'ask_00000000', messageId: 'askm_00000000',
          status: 'done', usage: {}, costUsd: 0.1, threadTotals: null }) });
      await tick();
      assert.ok(calls.length > before, 'ask-done refetches /api/stats (D12)');
      const afterDone = calls.length;
      wsBox.ws.dispatch('message', { data: JSON.stringify(
        { type: 'ask-error', threadId: 'ask_00000000', messageId: 'askm_00000000', message: 'boom' }) });
      await tick();
      assert.ok(calls.length > afterDone, 'ask-error refetches too — an error turn can carry recorded spend');
    } },
  ]);
});

test('Last month, Group by and Custom drive the /api/stats query', async () => {
  const ctx = await boot();                    // calls[] records every /api/stats URL
  await ctx.showStats();
  const doc = ctx.window.document;
  doc.querySelector('#stats-range [data-range="lastMonth"]').click(); await ctx.tick();
  assert.ok(ctx.calls.some((u) => u.includes('range=lastMonth')));
  const group = doc.getElementById('stats-group');
  group.value = 'person'; group.dispatchEvent(new ctx.window.Event('change')); await ctx.tick(); await ctx.tick();
  assert.ok(ctx.calls.some((u) => u.includes('groupBy=person')));
  doc.querySelector('#stats-range [data-range="custom"]').click(); await ctx.tick(); await ctx.tick();
  assert.equal(doc.getElementById('stats-custom').hidden, false);
  const before = ctx.calls.length;
  doc.getElementById('stats-from').value = '2026-08-09';
  doc.getElementById('stats-to').value = '2026-08-01';
  doc.getElementById('stats-to').dispatchEvent(new ctx.window.Event('change')); await ctx.tick(); await ctx.tick();
  assert.equal(ctx.calls.length, before, 'no request while To is before From');
  assert.equal(doc.getElementById('stats-custom-err').hidden, false);
  assert.equal(doc.getElementById('stats-to').getAttribute('aria-invalid'), 'true');
  doc.getElementById('stats-to').value = '2026-08-31';
  doc.getElementById('stats-to').dispatchEvent(new ctx.window.Event('change')); await ctx.tick(); await ctx.tick();
  assert.ok(ctx.calls.at(-1).includes('from=2026-08-09&to=2026-08-31'), 'a valid pair refetches');
  assert.equal(doc.getElementById('stats-custom-err').hidden, true);
  assert.equal(doc.getElementById('stats-to').hasAttribute('aria-invalid'), false);
});

test('narrow widths: the range control wraps and a grouped table scrolls inside its card', () => {
  const css = readFileSync(fileURLToPath(new URL('../ui/public/style.css', import.meta.url)), 'utf8');
  assert.match(css, /#stats-range\{[^}]*flex-wrap:wrap/, 'six range buttons must wrap, not run off-screen');
  // A grid item keeps min-width:auto, so the 1fr track grows to the table's
  // min-content width and .people-scroll never scrolls; min-width:0 caps it.
  assert.match(css, /\.people-grid>\*\{min-width:0;\}/);
});

// Tag dimensions (slice 3): configured dimensions lead the Group by, by label; none configured = slice 2's list.
const json = (body) => Promise.resolve({ ok: true, status: 200, json: async () => body });
function tagHandler(dims, groups = null) {
  return (u) => {
    if (u.includes('/api/tag-dimensions')) return json({ dims });
    if (u.includes('/api/tags')) return json({ keys: [{ key: 'client', count: 2, plain: false, valued: true }, { key: 'spike', count: 1, plain: true, valued: false }], values: {} });
    if (groups && u.includes('/api/stats') && u.includes('groupBy=tag')) return json({ ...STATS_FIXTURE, groups });
    return null;
  };
}
const groupTexts = (doc) => [...doc.querySelectorAll('#stats-group option')].map((o) => o.textContent);

test('Group by: no dimensions → exactly the slice 2 options; a configured dimension leads by label and names the groups card', async () => {
  await checkRows([
    { name: 'none configured', run: async () => {
      const ctx = await boot({ fetchHandler: tagHandler([]) });
      applyFlags({ runTags: true }, ctx.window.document);
      await ctx.showStats(); await ctx.tick(); await ctx.tick();
      assert.deepEqual(groupTexts(ctx.window.document), ['No grouping', 'Group by person', 'Group by tag: client', 'Group by tag: spike']);
      assert.ok(!groupTexts(ctx.window.document).some((t) => t.includes('Cost centre')));
    } },
    { name: 'Cost centre configured', run: async () => {
      const groups = { label: 'cc', rows: [{ key: '4410', label: '4410', spentUsd: 3.5, runs: 3, finished: 2, stopped: 1, failed: 0, running: 0, paused: 0, prsOpened: 1, prsMerged: 1 }] };
      const ctx = await boot({ fetchHandler: tagHandler([{ key: 'cc', label: 'Cost centre', values: [], required: true }], groups) });
      applyFlags({ runTags: true }, ctx.window.document);
      await ctx.showStats(); await ctx.tick(); await ctx.tick();
      const doc = ctx.window.document;
      assert.deepEqual(groupTexts(doc), ['No grouping', 'Group by person', 'Group by Cost centre', 'Group by tag: client', 'Group by tag: spike']);
      const sel = doc.getElementById('stats-group');
      sel.value = 'tag:cc'; sel.dispatchEvent(new ctx.window.Event('change')); await ctx.tick(); await ctx.tick(); await ctx.tick();
      assert.equal(doc.querySelector('#stats-body .groups-card h2').textContent, 'By Cost centre');
    } },
  ]);
});
