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

async function boot({ fetchHandler, storage = {}, url = 'http://localhost:4317/' } = {}) {
  const dom = trackDom(new JSDOM(readFileSync(htmlPath, 'utf8'), { url }));
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
    if (u.includes('/api/stats')) calls.push(u);   // every stats request, answered by a handler or not
    if (fetchHandler) { const r = fetchHandler(u, opts || {}); if (r) return r; }
    if (u.includes('/api/stats')) {
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
  for (const [k, v] of Object.entries(storage)) window.localStorage.setItem(k, v);
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

test('Last month, By person and Custom drive the /api/stats query', async () => {
  const ctx = await boot();                    // calls[] records every /api/stats URL
  await ctx.showStats();
  const doc = ctx.window.document;
  doc.querySelector('#stats-range [data-range="lastMonth"]').click(); await ctx.tick();
  assert.ok(ctx.calls.some((u) => u.includes('range=lastMonth')));
  doc.querySelector('#stats-view [data-stats-view="person"]').click(); await ctx.tick(); await ctx.tick();
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

test('narrow widths: the range control wraps (no sideways scroll) and tables sit in the shared table-wrap', () => {
  const css = readFileSync(fileURLToPath(new URL('../ui/public/style.css', import.meta.url)), 'utf8');
  assert.match(css, /#stats-range\{[^}]*flex-wrap:wrap;/, 'six range buttons wrap at 290px');
  assert.doesNotMatch(css, /#stats-range\{[^}]*overflow-x:auto/);
  // A grid item keeps min-width:auto, so a 1fr track grows to a table's min-content width; min-width:0 caps it.
  assert.match(css, /\.charts-grid>\*\{min-width:0;\}/);
});

test('a fresh load at #stats shows Statistics, not Chat; a late /api/flags at simple level keeps the hash', async () => {
  await checkRows([
    { name: 'a fresh load at #stats shows Statistics, not Chat', run: async () => {
      const ctx = await boot({ url: 'http://localhost:4317/#stats' });
      const doc = ctx.window.document;
      await ctx.tick(); await ctx.tick();
      assert.equal(ctx.window.location.hash, '#stats');
      assert.equal(doc.querySelector('[data-view="stats"]').classList.contains('hidden'), false);
      assert.equal(doc.querySelector('[data-view="chat"]').classList.contains('hidden'), true);
      assert.equal(doc.getElementById('topnav-title').textContent, 'Statistics');
    } },
    { name: 'simple level and a late /api/flags: the hash stays #stats and Statistics shows', run: async () => {
      const ctx = await boot({ url: 'http://localhost:4317/#stats', fetchHandler: (u) => {
        if (u.includes('/api/flags')) return new Promise((r) => setTimeout(() => r({ ok: true, status: 200, json: async () => ({ flags: {} }) }), 30));
        if (u.includes('/api/settings')) return Promise.resolve({ ok: true, status: 200, json: async () => ({ uiLevel: 'simple' }) });
        return null;
      } });
      const doc = ctx.window.document;
      await new Promise((r) => setTimeout(r, 60));
      await ctx.tick(); await ctx.tick();
      assert.equal(ctx.window.location.hash, '#stats');
      assert.equal(doc.querySelector('[data-view="stats"]').classList.contains('hidden'), false);
      assert.equal(doc.querySelector('[data-view="chat"]').classList.contains('hidden'), true);
      assert.equal(doc.getElementById('topnav-title').textContent, 'Statistics');
    } },
  ]);
});

// View chips (#718 slice 4; Cost: labels-cost-tags s3): Overview · By person · Cost.
const json = (body) => Promise.resolve({ ok: true, status: 200, json: async () => body });
const VOCAB = [{ key: 'client', count: 2, plain: false, valued: true }];
const fact = (id, usd, tags) => ({ id, usd, hours: 1, inCohort: true, status: 'finished', pr: null, person: 'Developer A',
  project: 'web-app', workflow: 'Default', tags, spend: [[0, usd]], hourBucket: 0 });
const REPORT = {
  buckets: [STATS_FIXTURE.series[0].bucketStartMs],
  runs: [fact('r1', 2, { client: 'acme', cc: 'eng' }), fact('r2', 1, { client: 'globex' })],
  prevRuns: null, ask: null,
};
function tagHandler(dims, { keys = VOCAB } = {}) {
  return (u) => {
    if (u.includes('/api/tag-dimensions')) return json({ dims });
    if (u.includes('/api/tags')) return json({ keys, values: {} });
    if (u.includes('/api/stats') && u.includes('report=1')) return json({ ...STATS_FIXTURE, report: REPORT });
    return null;
  };
}
const chipTexts = (doc) => [...doc.querySelectorAll('#stats-view button')].filter((b) => !b.hidden).map((b) => b.textContent);
const CC = [{ key: 'cc', label: 'Cost centre', values: [], required: false }];

test('view chips: Overview, By person and Cost, with or without tags and dimensions', async () => {
  await checkRows([
    { name: 'nothing', dims: [], keys: [] },
    { name: 'a tag in use', dims: [], keys: VOCAB },
    { name: 'a dimension only', dims: CC, keys: [] },
  ].map((row) => ({ name: row.name, run: async () => {
    const ctx = await boot({ fetchHandler: tagHandler(row.dims, { keys: row.keys }) });
    await ctx.showStats(); await ctx.tick(); await ctx.tick();
    assert.deepEqual(chipTexts(ctx.window.document), ['Overview', 'By person', 'Cost']);
  } })));
});

test('Cost: report=1 without byTag or tag filters, the Cost report renders, the tag field and Person hide, remembered', async () => {
  const ctx = await boot({ fetchHandler: tagHandler(CC) });
  await ctx.showStats(); await ctx.tick(); await ctx.tick();
  const doc = ctx.window.document;
  doc.querySelector('#stats-view [data-stats-view="cost"]').click(); await ctx.tick(); await ctx.tick(); await ctx.tick();
  const last = ctx.calls.at(-1);
  assert.ok(last.includes('report=1'), last);
  assert.ok(!last.includes('byTag='), last);
  assert.ok(!last.includes('tag='), last);
  assert.ok(!last.includes('groupBy='), last);
  assert.ok(doc.querySelector('#stats-body .cost-report'), 'the Cost report is painted');
  assert.equal(doc.querySelectorAll('#stats-body .cr-kpis .stat-tile').length, 5);
  assert.equal(doc.getElementById('stats-tags').hidden, true);
  assert.equal(doc.getElementById('stats-person').closest('.select-wrap').hidden, true);
  assert.equal(doc.querySelector('#stats-view [data-stats-view="cost"]').getAttribute('aria-pressed'), 'true');
  assert.equal(ctx.window.localStorage.getItem('worca-cc.stats.view'), 'cost');
  doc.querySelector('#stats-view [data-stats-view="overview"]').click(); await ctx.tick(); await ctx.tick();
  assert.equal(doc.getElementById('stats-tags').hidden, false, 'Overview shows the tag field again');
});

test('Cost: Download CSV saves the report under statistics-month-cost-cc.csv with the hours columns', async () => {
  const ctx = await boot({ fetchHandler: tagHandler(CC), storage: { 'worca-cc.stats.view': 'cost' } });
  // app.js calls the bare URL and Blob, which are Node's globals (boot copies only window, document, location,
  // localStorage, WebSocket, fetch and navigator), so stub Node's URL, not ctx.window.URL. The <a> is jsdom's.
  const blobs = [];
  const names = [];
  const orig = [URL.createObjectURL, URL.revokeObjectURL];
  URL.createObjectURL = (b) => { blobs.push(b); return 'blob:x'; };
  URL.revokeObjectURL = () => {};
  ctx.window.HTMLAnchorElement.prototype.click = function () { names.push(this.download); };
  try {
    await ctx.showStats(); await ctx.tick(); await ctx.tick();
    ctx.window.document.querySelector('#stats-body .cr-csv').click();
    assert.deepEqual(names, ['statistics-month-cost-cc.csv']);
    // Blob.text() strips a leading BOM, so decode the bytes with ignoreBOM to see it.
    assert.match(new TextDecoder('utf-8', { ignoreBOM: true }).decode(await blobs[0].arrayBuffer()),
      /^\uFEFFCost centre,spendUsd,runs,finished,stopped,failed,running,paused,prsOpened,prsMerged,humanHours,savedUsd,usdPerHour\r\n/);
  } finally {
    [URL.createObjectURL, URL.revokeObjectURL] = orig;
  }
});

test('remembered chip: a stored "tag" opens Cost; By person sends groupBy=person and renders only its table', async () => {
  const ctx = await boot({ fetchHandler: tagHandler(CC), storage: { 'worca-cc.stats.view': 'tag' } });
  await ctx.showStats(); await ctx.tick(); await ctx.tick();
  assert.ok(ctx.calls.some((u) => u.includes('report=1')));
  const doc = ctx.window.document;
  assert.equal(doc.querySelector('#stats-view [data-stats-view="cost"]').getAttribute('aria-pressed'), 'true');
  doc.querySelector('#stats-view [data-stats-view="person"]').click(); await ctx.tick(); await ctx.tick();
  assert.ok(ctx.calls.at(-1).includes('groupBy=person'));
  assert.equal(ctx.window.localStorage.getItem('worca-cc.stats.view'), 'person');
  assert.equal(doc.querySelectorAll('#stats-body .chart-card').length, doc.querySelectorAll('#stats-body .groups-card').length);
});

test('Team metrics › Cost CSS: tokens only (light and dark); hidden parts hide through the global [hidden] rule', () => {
  const css = readFileSync(fileURLToPath(new URL('../ui/public/style.css', import.meta.url)), 'utf8');
  const rules = css.match(/[^}]*(\.tm-heat|\.tm-todo|\.cr-tail|\.tm-view)[^{]*\{[^}]*\}/g) || [];
  assert.ok(rules.length >= 8, `${rules.length} rules`);
  for (const r of rules) assert.doesNotMatch(r.slice(r.indexOf('{')), /#[0-9a-f]{3,8}\b|rgb\(/i, r);
  assert.doesNotMatch(css, /\.alloc-/);
  // style.css:4 is written with spaces: `[hidden]:not([hidden="until-found"]) { display: none !important; }`
  assert.match(css, /\[hidden\]:not\(\[hidden="until-found"\]\)\s*\{\s*display:\s*none\s*!important;?\s*\}/);
});
