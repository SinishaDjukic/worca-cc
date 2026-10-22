// test/ui-team-metrics.test.mjs
// Team metrics page: the nav entry in both menus, the #team-metrics route and its
// loader, the scope select + KPI row + sync chip, the decision-36 sequence guard,
// and the Stats "Team-wide view ->" hint. boot() is a local copy of
// test/ui-stats.test.mjs's harness (imports, htmlPath/appPath, the WebSocket stub),
// with a `url` passthrough so the boot-direct row can open straight onto the
// Team metrics view.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import { makeRecord } from './fixtures/team-metrics/records.mjs';
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
  budget: { pipelineLimitUsd: null, totalLimitUsd: null, resetPeriod: 'monthly',
    windowStartMs: 0, windowEndMs: Date.now() + 4 * 86400000, msUntilReset: 4 * 86400000,
    windowSpendUsd: 3.5, allTimeSpendUsd: 3.5, remainingUsd: null, blocked: false },
  series: [{ bucketStartMs: Date.now() - 2 * 86400000, spentUsd: 3.5, finished: 2, stopped: 1, failed: 0 }],
};

async function boot({ fetchHandler, url = 'http://localhost:4317/', storage = {} } = {}) {
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
  for (const [k, v] of Object.entries(storage)) window.localStorage.setItem(k, v);
  await import(pathToFileURL(appPath).href + `?b=${Date.now()}_${Math.random()}`);
  await new Promise((r) => setTimeout(r, 0));
  const tick = () => new Promise((r) => setTimeout(r, 0));
  return { window, calls, wsBox, tick };
}

const respond = (body, status = 200) => Promise.resolve({ ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) });
function tmHandler(routes, tmCalls = []) {
  return (u) => {
    if (u.includes('/api/team-metrics')) tmCalls.push(u);
    if (u.includes('/api/team-metrics/scopes')) return respond(routes.scopes);
    if (u.includes('/api/team-metrics?')) return routes.data ? respond(routes.data) : respond({ error: 'not enabled', code: 'NOT_ENABLED' }, 404);
    return null; // fall through to boot()'s defaults
  };
}

const nowIso = new Date().toISOString();
const SCOPES_ON = {
  projects: [{ key: 'billing-api-0123abcd', name: 'billing-api', slug: 'acme/billing-api', enabled: true, recordsLocally: true, hasOrigin: true, runs: 2, pending: 0, record: true }],
  workspaces: [{ id: 'wks-iot-sp-platform-0123abcd', name: 'IoT SP Platform', projectPaths: ['/a', '/b'], home: { state: 'ok', slug: 'acme/gateway', runs: 1 }, members: [], counts: { recordsHere: 1, routed: 0, notRecording: 1 } }],
  scopes: { projects: [{ id: 'project:billing-api-0123abcd', label: 'acme/billing-api', name: 'billing-api' }], workspaces: [{ id: 'workspace:wks-iot-sp-platform-0123abcd', label: 'IoT SP Platform', home: 'acme/gateway' }] },
  anyEnabled: true,
};
const TM_DATA = {
  scope: { kind: 'project', id: 'billing-api-0123abcd', name: 'billing-api', slug: 'acme/billing-api' },
  records: [makeRecord({ id: 'r1', startedAt: nowIso, usd: 3 }), makeRecord({ id: 'r2', startedAt: nowIso, usd: 1, result: 'failed' })],
  aggregate: null, stats: { files: 2, malformed: 0, unknownV: 0 },
  sync: [{ slug: 'acme/billing-api', pending: 3, lastSyncAt: nowIso, fetchedAt: nowIso }],
  refresh: { requested: false, fetched: true, limited: false, retryInMs: 0 }, fetchError: null,
};

test('#team-metrics routes from the sidebar entry (directly below Stats) and renders when booted straight onto the hash', async () => {
  await checkRows([
    { name: 'nav entry sits directly below Stats in the sidebar; routes to the view', run: async () => {
      const { window, tick } = await boot({ fetchHandler: tmHandler({ scopes: SCOPES_ON, data: TM_DATA }) });
      const doc = window.document;
      for (const sel of ['.sidebar .nav']) {
        const btns = [...doc.querySelectorAll(`${sel} button[data-nav]`)].map((b) => b.dataset.nav);
        assert.equal(btns[btns.indexOf('stats') + 1], 'team-metrics', sel);
      }
      assert.equal(doc.querySelector('.sidebar [data-nav="team-metrics"] span').textContent, 'Team metrics');
      window.location.hash = 'team-metrics'; window.dispatchEvent(new window.Event('hashchange')); await tick(); await tick();
      assert.equal(doc.querySelector('section[data-view="team-metrics"]').classList.contains('hidden'), false);
    } },
    { name: 'booting straight to #team-metrics renders the page (module-scope state is declared before boot)', run: async () => {
      // Guards the §9.4 placement note: declared after the boot block, showView() reads tmState in its
      // temporal dead zone and the whole app fails to start.
      const { window, tick } = await boot({ url: 'http://localhost:4317/#team-metrics', fetchHandler: tmHandler({ scopes: SCOPES_ON, data: TM_DATA }) });
      await tick(); await tick();
      assert.equal(window.document.querySelectorAll('#tm-body .stat-tile').length, 6);
      assert.equal(window.location.hash, '#team-metrics', 'a fresh load keeps the hash');
      assert.equal(window.document.querySelector('[data-view="chat"]').classList.contains('hidden'), true, 'not Chat');
      assert.equal(window.document.getElementById('topnav-title').textContent, 'Team metrics');
    } },
    { name: 'simple level and a late /api/flags: the hash stays #team-metrics and Team metrics shows', run: async () => {
      const tm = tmHandler({ scopes: SCOPES_ON, data: TM_DATA });
      const { window, tick } = await boot({ url: 'http://localhost:4317/#team-metrics', fetchHandler: (u, o) => {
        if (u.includes('/api/flags')) return new Promise((r) => setTimeout(() => r({ ok: true, status: 200, json: async () => ({ flags: {} }) }), 30));
        if (u.includes('/api/settings')) return respond({ uiLevel: 'simple' });
        return tm(u, o);
      } });
      await new Promise((r) => setTimeout(r, 60));
      await tick(); await tick();
      const doc = window.document;
      assert.equal(window.location.hash, '#team-metrics');
      assert.equal(doc.querySelector('[data-view="team-metrics"]').classList.contains('hidden'), false);
      assert.equal(doc.querySelector('[data-view="chat"]').classList.contains('hidden'), true);
      assert.equal(doc.getElementById('topnav-title').textContent, 'Team metrics');
    } },
  ]);
});

test('scope select is populated (grouped), KPI row renders 6 tiles, sync chip shows pending; range change does not refetch', async () => {
  const tmCalls = [];
  const { window, tick } = await boot({ fetchHandler: tmHandler({ scopes: SCOPES_ON, data: TM_DATA }, tmCalls) });
  const doc = window.document;
  window.location.hash = 'team-metrics'; window.dispatchEvent(new window.Event('hashchange'));
  await tick(); await tick(); await tick();
  const sel = doc.getElementById('tm-scope');
  assert.deepEqual([...sel.querySelectorAll('optgroup')].map((g) => g.label), ['Projects', 'Workspaces']);
  assert.equal(sel.value, 'project:billing-api-0123abcd');
  assert.equal(doc.querySelectorAll('#tm-body .stat-tile').length, 6);
  assert.match(doc.getElementById('tm-sync').textContent, /3 runs pending push/);
  assert.equal(doc.getElementById('tm-sync').hidden, false);
  const before = tmCalls.length;
  assert.ok(before >= 2, 'scopes + data were fetched');
  doc.querySelector('#tm-range button[data-range="all"]').click(); await tick();
  assert.equal(tmCalls.length, before, 're-aggregation on range change needs no fetch');
  assert.equal(doc.querySelector('#tm-range button[data-range="all"]').classList.contains('on'), true);
});

test('sync chip states: a flush-failed WS frame does not reload the page', async () => {
  const tmCalls = [];
  const { window, wsBox, tick } = await boot({ fetchHandler: tmHandler({ scopes: SCOPES_ON, data: { ...TM_DATA, sync: [{ slug: 'acme/billing-api', pending: 1, lastError: 'remote: GH013: Repository rule violations found' }] } }, tmCalls) });
  window.location.hash = 'team-metrics'; window.dispatchEvent(new window.Event('hashchange')); await tick(); await tick(); await tick();
  assert.ok(window.document.querySelector('#tm-sync .dot.red'));
  const before = tmCalls.length;
  wsBox.ws.dispatch('message', { data: JSON.stringify({ type: 'team-metrics-changed', action: 'flush-failed' }) });
  await tick(); await tick();
  assert.equal(tmCalls.length, before);
});

const WS_DATA = {
  scope: { kind: 'workspace', id: 'wks-iot-sp-platform-0123abcd', name: 'IoT SP Platform', home: 'acme/gateway', sources: ['acme/gateway'] },
  records: [makeRecord({ id: 'w1', kind: 'workspace', workspace: 'IoT SP Platform', touched: ['acme/gateway'], startedAt: nowIso, usd: 7 })],
  aggregate: null, stats: { files: 1, malformed: 0, unknownV: 0 },
  sync: [{ slug: 'acme/gateway', pending: 0, lastSyncAt: nowIso, fetchedAt: nowIso }],
  refresh: { requested: false, fetched: true, limited: false, retryInMs: 0 }, fetchError: null,
};

test('a slow scope response never repaints under a newer scope (decision 36)', async () => {
  // The workspace scope answers slowly; the user switches back to the project scope meanwhile.
  const { window, tick } = await boot({
    fetchHandler: (u) => {
      if (u.includes('/api/team-metrics/scopes')) return respond(SCOPES_ON);
      if (u.includes('/api/team-metrics?')) {
        return u.includes('scope=workspace')
          ? new Promise((res) => setTimeout(() => res(respond(WS_DATA)), 150))
          : respond(TM_DATA);
      }
      return null;
    },
  });
  const doc = window.document;
  window.location.hash = 'team-metrics'; window.dispatchEvent(new window.Event('hashchange'));
  await tick(); await tick(); await tick();
  const sel = doc.getElementById('tm-scope');
  const pick = (v) => { sel.value = v; sel.dispatchEvent(new window.Event('change', { bubbles: true })); };
  pick('workspace:wks-iot-sp-platform-0123abcd');
  await tick();
  pick('project:billing-api-0123abcd');
  await new Promise((r) => setTimeout(r, 250)); await tick(); await tick();
  assert.equal(sel.value, 'project:billing-api-0123abcd');
  // Without the sequence guard the delayed workspace response lands last and repaints the page:
  // the workspace-only "Metrics home" hint appears under the project scope's name.
  assert.equal(doc.querySelector('.tm-home-hint'), null);
});

test('loading: the skeleton paints before the data, the read is deferred, the chip says "Checking origin…" while the fetch runs, and its fetched frame reloads', async () => {
  let release; const gate = new Promise((r) => { release = r; });
  const tmCalls = [];
  const { window, wsBox, tick } = await boot({
    fetchHandler: (u) => {
      if (u.includes('/api/team-metrics')) tmCalls.push(u);
      if (u.includes('/api/team-metrics/scopes')) return respond(SCOPES_ON);
      if (u.includes('/api/team-metrics?')) return gate.then(() => respond({ ...TM_DATA, refresh: { ...TM_DATA.refresh, pending: true } }));
      return null;
    },
  });
  const doc = window.document;
  window.location.hash = 'team-metrics'; window.dispatchEvent(new window.Event('hashchange'));
  await tick(); await tick(); await tick();
  const body = doc.getElementById('tm-body');
  assert.ok(body.querySelector('.tm-skeleton'), 'the page shape, not "Loading…"');
  assert.equal(body.querySelectorAll('.tm-skeleton .stat-tile').length, 6);
  assert.equal(body.getAttribute('aria-busy'), 'true');
  assert.match(tmCalls.find((u) => u.includes('/api/team-metrics?')), /defer=1/, 'the page asks for the two-phase read');
  release(); await tick(); await tick(); await tick();
  assert.equal(body.querySelector('.tm-skeleton'), null);
  assert.equal(body.querySelectorAll('.stat-tile').length, 6);
  assert.equal(body.getAttribute('aria-busy'), null);
  const chip = doc.getElementById('tm-sync');
  assert.ok(chip.querySelector('.sync-chip-inner.is-busy'), 'refresh.pending: the deferred fetch is still running');
  assert.match(chip.textContent, /Checking origin…/);
  assert.equal(chip.querySelector('.tm-refresh').disabled, true);
  const reads = () => tmCalls.filter((u) => u.includes('/api/team-metrics?')).length;
  const before = reads();
  wsBox.ws.dispatch('message', { data: JSON.stringify({ type: 'team-metrics-changed', action: 'fetched' }) });
  await tick(); await tick(); await tick();
  assert.equal(reads(), before + 1, 'the fetched frame reloads the page');
});

test('switching back to a scope paints its cached payload at once, dimmed, while the read is out; a new scope gets the skeleton', async () => {
  // The payload reads are held until the test releases them, and every step waits on the page's
  // own state: a fixed sleep raced the loader on a loaded CI runner.
  const held = [];
  const { window } = await boot({
    fetchHandler: (u) => {
      if (u.includes('/api/team-metrics/scopes')) return respond(SCOPES_ON);
      if (u.includes('/api/team-metrics?')) return new Promise((res) => held.push(() => res(respond(u.includes('scope=workspace') ? WS_DATA : TM_DATA))));
      return null;
    },
  });
  const doc = window.document;
  const body = doc.getElementById('tm-body');
  const until = async (pred, what) => {
    for (let i = 0; i < 500; i++) { if (pred()) return; await new Promise((r) => setTimeout(r, 10)); }
    assert.fail(`timed out waiting for ${what}`);
  };
  const release = () => held.splice(0).forEach((f) => f());
  window.location.hash = 'team-metrics'; window.dispatchEvent(new window.Event('hashchange'));
  await until(() => held.length, 'the first payload read');
  release();
  await until(() => body.querySelectorAll('.stat-tile').length === 6 && !body.hasAttribute('aria-busy'), 'the project payload');
  const sel = doc.getElementById('tm-scope');
  const pick = (v) => { sel.value = v; sel.dispatchEvent(new window.Event('change', { bubbles: true })); };
  pick('workspace:wks-iot-sp-platform-0123abcd');
  await until(() => held.length, 'the workspace payload read');
  assert.ok(body.querySelector('.tm-skeleton'), 'never seen: the skeleton, not the project scope\'s numbers');
  release();
  await until(() => doc.querySelector('.tm-home-hint') && !body.hasAttribute('aria-busy'), 'the workspace payload');
  pick('project:billing-api-0123abcd');
  await until(() => held.length, 'the project payload read');
  assert.equal(body.querySelector('.tm-skeleton'), null);
  assert.equal(body.querySelectorAll('.stat-tile').length, 6, 'the project scope\'s cached payload paints at once');
  assert.equal(doc.querySelector('.tm-home-hint'), null, 'and it is that scope\'s payload');
  assert.ok(body.classList.contains('is-loading')); assert.equal(body.getAttribute('aria-busy'), 'true');
  release();
  await until(() => !body.hasAttribute('aria-busy'), 'the project read to land');
  assert.equal(body.classList.contains('is-loading'), false); assert.equal(body.getAttribute('aria-busy'), null);
});

test('run tags: #tm-tag lists the records\' tags, narrows the page with a removable chip; hidden without tags and on the Timeline tab', async () => {
  const tagged = { ...TM_DATA, records: [{ ...makeRecord({ id: 'r1', startedAt: nowIso, usd: 3 }), tags: ['client:acme'] }, makeRecord({ id: 'r2', startedAt: nowIso, usd: 1 })] };
  const { window, tick } = await boot({ fetchHandler: tmHandler({ scopes: SCOPES_ON, data: tagged }) });
  applyFlags({ runTags: true }, window.document);
  const doc = window.document;
  window.location.hash = 'team-metrics'; window.dispatchEvent(new window.Event('hashchange'));
  await tick(); await tick(); await tick();
  const sel = doc.getElementById('tm-tag');
  assert.ok(sel, '#tm-tag is mounted');
  assert.equal(sel.hidden, false);
  assert.deepEqual([...sel.options].map((o) => o.value), ['', 'client:acme']);
  assert.ok([...doc.querySelectorAll('#tm-group option')].some((o) => o.value === 'tag:client'), 'a tag key in the records stacks too');
  sel.value = 'client:acme'; sel.dispatchEvent(new window.Event('change', { bubbles: true })); await tick();
  assert.equal(doc.querySelectorAll('#tm-body .tm-run-tbl tbody tr').length, 1);
  const chip = doc.querySelector('#tm-filters .tm-filter-chip[data-dim="tag"]');
  assert.match(chip.textContent, /tag: client:acme/);
  assert.equal(doc.getElementById('tm-filters').hidden, false);
  chip.click(); await tick();
  assert.equal(doc.querySelectorAll('#tm-body .tm-run-tbl tbody tr').length, 2);
  assert.equal(doc.getElementById('tm-tag').value, '');
  window.location.hash = 'team-metrics/timeline'; window.dispatchEvent(new window.Event('hashchange')); await tick(); await tick();
  assert.equal(doc.getElementById('tm-tag').hidden, true, 'hidden on the Timeline tab with #tm-filters');
});

test('run tags: tag-less records hide #tm-tag and leave the group-by options unchanged', async () => {
  const { window, tick } = await boot({ fetchHandler: tmHandler({ scopes: SCOPES_ON, data: TM_DATA }) });
  applyFlags({ runTags: true }, window.document);
  const doc = window.document;
  window.location.hash = 'team-metrics'; window.dispatchEvent(new window.Event('hashchange'));
  await tick(); await tick(); await tick();
  assert.equal(doc.getElementById('tm-tag').hidden, true);
  assert.deepEqual([...doc.querySelectorAll('#tm-group option')].map((o) => o.value), ['workflow', 'result', 'actor']);
});

const TAGGED = () => {
  const nowIso = new Date().toISOString();
  return { ...TM_DATA, records: [{ ...makeRecord({ id: 'r1', startedAt: nowIso, usd: 3 }), tags: ['client:acme'] }, makeRecord({ id: 'r2', startedAt: nowIso, usd: 1 })] };
};
async function openTm(opts) {
  const ctx = await boot(opts);
  applyFlags({ runTags: true }, ctx.window.document);
  ctx.window.location.hash = 'team-metrics'; ctx.window.dispatchEvent(new ctx.window.Event('hashchange'));
  await ctx.tick(); await ctx.tick(); await ctx.tick();
  return ctx;
}

test('Team metrics chips: By person = the By actor table alone; a stored By tag opens Cost without tags; flag off = no chips', async () => {
  const plain = await openTm({ fetchHandler: tmHandler({ scopes: SCOPES_ON, data: TM_DATA }), storage: { 'worca.teamMetrics.view': 'tag' } });
  const doc = plain.window.document;
  assert.deepEqual([...doc.querySelectorAll('#tm-view button')].map((b) => b.textContent), ['Overview', 'By person', 'Cost']);
  assert.equal(doc.querySelector('#tm-view [data-tm-view="cost"]').getAttribute('aria-pressed'), 'true');
  assert.ok(doc.querySelector('#tm-body .cost-report'), 'a stored "tag" without tags renders Cost');
  doc.querySelector('#tm-view [data-tm-view="person"]').click(); await plain.tick();
  assert.equal(doc.querySelector('#tm-body .tm-run-tbl'), null);
  assert.deepEqual([...doc.querySelectorAll('#tm-body .tm-tbl')].map((t) => t.dataset.dim), ['actor']);

  const off = await boot({ fetchHandler: tmHandler({ scopes: SCOPES_ON, data: TAGGED() }), storage: { 'worca.teamMetrics.view': 'tag' } });
  off.window.location.hash = 'team-metrics'; off.window.dispatchEvent(new off.window.Event('hashchange'));
  await off.tick(); await off.tick(); await off.tick();
  assert.equal(off.window.document.getElementById('tm-view'), null);
  assert.ok(off.window.document.querySelector('#tm-body .tm-run-tbl'));
});

const DIMS = { dims: [{ key: 'client', label: 'Client', values: [], required: true }] };
const withDims = (inner) => (u, o) => (u.includes('/api/tag-dimensions') ? respond(DIMS) : inner(u, o));
const COSTED = () => {
  const at = new Date().toISOString();
  const rec = (id, usd, actor, tags) => ({ ...makeRecord({ id, startedAt: at, usd, actor }), ...(tags ? { tags } : {}) });
  return { ...TM_DATA, humanRateUsd: 35, records: [
    rec('a1', 6, 'Developer A', ['client:acme']), rec('a2', 1.5, 'Developer A'), rec('a3', 2, 'Developer A'),
    rec('a4', 0.5, 'Developer A', ['spike']), rec('b1', 3, 'Developer B', ['client:globex']),
  ] };
};

test('Team metrics › Cost: the report table, the heat grid and the to-do strip; a stored By tag opens Cost', async () => {
  const ctx = await openTm({ fetchHandler: withDims(tmHandler({ scopes: SCOPES_ON, data: COSTED() })), storage: { 'worca.teamMetrics.view': 'tag' } });
  const doc = ctx.window.document;
  await ctx.tick();
  assert.deepEqual([...doc.querySelectorAll('#tm-view button')].map((b) => b.textContent), ['Overview', 'By person', 'Cost']);
  assert.equal(doc.querySelector('#tm-view [data-tm-view="cost"]').getAttribute('aria-pressed'), 'true');
  const body = doc.getElementById('tm-body');
  assert.deepEqual([...body.querySelectorAll('.cr-table tbody tr')].map((r) => r.cells[0].textContent.trim()), ['acme', 'globex', 'Unallocated']);
  assert.deepEqual([...body.querySelectorAll('.tm-heat-table thead th')].map((t) => t.textContent), ['Person', 'acme', 'globex', 'Unallocated', 'Total']);
  assert.deepEqual([...body.querySelectorAll('.tm-heat-table tbody tr')].map((r) => r.cells[0].textContent), ['Developer A', 'Developer B']);
  const row = body.querySelector('.tm-todo .tm-todo-row');
  assert.deepEqual([...row.children].map((c) => c.textContent), ['Developer A', '3 runs', '$4.00', 'missing Client']);
  assert.equal(body.querySelector('.cr-runs'), null);
  assert.equal(doc.getElementById('tm-tag').hidden, true);
  assert.equal(doc.getElementById('tm-filters').hidden, true);
  assert.equal(body.querySelector('.alloc-card'), null);
});

test('Team metrics › Cost: Download CSV names the scope, range and key; chip choice remembered; own report state', async () => {
  const ctx = await openTm({ fetchHandler: withDims(tmHandler({ scopes: SCOPES_ON, data: COSTED() })) });
  const { window } = ctx;
  const doc = window.document;
  doc.querySelector('#tm-view [data-tm-view="cost"]').click();
  await ctx.tick();
  assert.equal(window.localStorage.getItem('worca.teamMetrics.view'), 'cost');
  // Stub the download as the replaced .alloc-csv test did: Node's URL (app.js's bare URL/Blob are Node globals here),
  // restored in finally so later tests in the process keep the real createObjectURL.
  let name = '';
  const orig = [URL.createObjectURL, URL.revokeObjectURL];
  URL.createObjectURL = () => 'blob:x';
  URL.revokeObjectURL = () => {};
  window.HTMLAnchorElement.prototype.click = function () { name = this.download; };
  try {
    doc.querySelector('#tm-body .cr-csv').click();
  } finally {
    [URL.createObjectURL, URL.revokeObjectURL] = orig;
  }
  assert.equal(name, 'team-metrics-project-billing-api-0123abcd-this-month-cost-client.csv');
  assert.match(doc.querySelector('#tm-body .cr-chart-card .card-head small').textContent, /^[A-Z][a-z]{2} 1 – [A-Z][a-z]{2} \d{2}$/);   // "Oct 1 – Oct 31"
  doc.querySelector('#tm-body .cr-metric [data-metric="hours"]').click();
  assert.ok(window.localStorage.getItem('worca-cc.teamMetrics.cost.v1'));
  assert.equal(window.localStorage.getItem('worca-cc.stats.cost.v1'), null);
});
