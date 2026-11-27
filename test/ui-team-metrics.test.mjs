// test/ui-team-metrics.test.mjs
// Team metrics page: the nav entry in both menus, the #team-metrics route and its
// loader, the scope select + KPI row + sync chip, the decision-36 sequence guard,
// and the Stats "Team-wide view ->" hint. boot() is a local copy of
// test/ui-stats.test.mjs's harness (imports, htmlPath/appPath, the WebSocket stub),
// with a `url` passthrough so the boot-direct row can open straight onto the
// Team metrics view.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import { makeRecord } from './fixtures/team-metrics/records.mjs';
import { useDomRelease } from './helpers/jsdom-release.mjs';
import { checkRows } from './helpers/rows.mjs';
import { readIndexHtml } from '../src/core/read-index-html.mjs';

// Release each booted window after its test (see test/helpers/jsdom-release.mjs).
const trackDom = useDomRelease(afterEach);

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
  const dom = trackDom(new JSDOM(readIndexHtml(), { url }));
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
  const doc = window.document;
  window.location.hash = 'team-metrics'; window.dispatchEvent(new window.Event('hashchange'));
  await tick(); await tick(); await tick();
  assert.equal(doc.getElementById('tm-tag').hidden, true);
  assert.deepEqual([...doc.querySelectorAll('#tm-group option')].map((o) => o.value), ['workflow', 'result', 'actor']);
});

async function openTm(opts) {
  const ctx = await boot(opts);
  ctx.window.location.hash = 'team-metrics'; ctx.window.dispatchEvent(new ctx.window.Event('hashchange'));
  await ctx.tick(); await ctx.tick(); await ctx.tick();
  return ctx;
}

test('Team metrics chips: By person = the By actor table alone; a stored By tag opens Cost without tags', async () => {
  const plain = await openTm({ fetchHandler: tmHandler({ scopes: SCOPES_ON, data: TM_DATA }), storage: { 'worca.teamMetrics.view': 'tag' } });
  const doc = plain.window.document;
  assert.deepEqual([...doc.querySelectorAll('#tm-view button')].map((b) => b.textContent), ['Overview', 'By person', 'Cost']);
  assert.equal(doc.querySelector('#tm-view [data-tm-view="cost"]').getAttribute('aria-pressed'), 'true');
  assert.ok(doc.querySelector('#tm-body .cost-report'), 'a stored "tag" without tags renders Cost');
  doc.querySelector('#tm-view [data-tm-view="person"]').click(); await plain.tick();
  assert.equal(doc.querySelector('#tm-body .tm-run-tbl'), null);
  assert.deepEqual([...doc.querySelectorAll('#tm-body .tm-tbl')].map((t) => t.dataset.dim), ['actor']);
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

// ── By person: Worca levels and the leaderboard ────────────────────────────────────────────────────
const LEVEL = { level: { index: 3, key: 'builder', name: 'Builder', avatar: '/assets/worca-levels/builder.svg' } };
const monthStart = (back = 0) => { const d = new Date(); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - back, 1); };
const lbRec = (id, actor, startedAt, extra = {}) => ({ ...makeRecord({ id, startedAt, actor }), ...extra });
function lbData({ viewer = { names: ['Ana'], actorKey: null }, records, display = { levels: true } } = {}) {
  const recent = new Date().toISOString();
  return { ...TM_DATA, viewer, display, records: records || [
    lbRec('a1', 'Ana', recent), lbRec('a2', 'Ana', recent), lbRec('a3', 'Ana', recent),
    lbRec('b1', 'Bo', recent), lbRec('b2', 'Bo', recent), lbRec('b3', 'Bo', recent, { result: 'failed' }),
  ] };
}
function lbHandler(data, { level = LEVEL, prs = (body) => respond({ prs: {}, status: { gh: 'ok' } }), log = [] } = {}) {
  const tm = tmHandler({ scopes: SCOPES_ON, data });
  return (u, o) => {
    if (u.includes('/api/worca-level')) return respond(level);
    if (u.includes('/api/team-metrics/prs')) { const body = JSON.parse(o.body); log.push(body); return prs(body); }
    return tm(u, o);
  };
}
const openPerson = async (opts) => {
  const ctx = await openTm(opts);
  ctx.window.document.querySelector('#tm-view [data-tm-view="person"]').click();
  for (let i = 0; i < 6; i++) await ctx.tick();
  return ctx;
};
const lbRow = (doc, name) => doc.querySelector(`#tm-body .tm-lb .tm-lb-row[data-lb-key="${name}"]`);
const merged = (doc, name) => { const c = lbRow(doc, name).querySelector('.tm-lb-num[data-part="merged"]'); return [c.querySelector('.tm-lb-val').textContent, c.querySelector('.tm-lb-pts').textContent]; };
const tableRow = (doc, name) => [...doc.querySelectorAll('#tm-body table[data-dim="actor"] tbody tr')].find((tr) => tr.querySelector('.tm-person')?.textContent === name);

test('levels on overview and by person: the viewer (matched by name) shows the served level, teammates "Level unknown"', async () => {
  const { window, tick } = await openTm({ fetchHandler: lbHandler(lbData()) });
  const doc = window.document;
  for (let i = 0; i < 4; i++) await tick();
  const ana = tableRow(doc, 'Ana').querySelector('.tm-level');
  assert.equal(ana.dataset.levelState, 'known');
  assert.equal(ana.querySelector('img').getAttribute('src'), LEVEL.level.avatar);
  assert.equal(ana.querySelector('img').alt, 'Builder');
  assert.equal(tableRow(doc, 'Bo').querySelector('.tm-level').dataset.levelState, 'unknown');
  assert.match(tableRow(doc, 'Bo').textContent, /Level unknown/);
  doc.querySelector('#tm-view [data-tm-view="person"]').click();
  for (let i = 0; i < 4; i++) await tick();
  assert.equal(lbRow(doc, 'Ana').querySelector('img.tm-lb-ava').getAttribute('src'), LEVEL.level.avatar, 'the same level avatar');
  assert.equal(lbRow(doc, 'Ana').querySelector('.tm-lb-level').textContent, 'Builder');
  assert.equal(lbRow(doc, 'Bo').querySelector('.tm-lb-level').dataset.levelState, 'unknown');
  assert.equal(doc.querySelector('#tm-body .tm-lb-leader img.tm-lb-ava').getAttribute('src'), LEVEL.level.avatar, 'the leader box shows the leader level avatar');
});

test('the viewer is also found by actor key, and without a level yet shows "No level yet"', async () => {
  const recent = new Date().toISOString();
  const records = ['a1', 'a2', 'a3'].map((id) => lbRec(id, 'Ana B.', recent, { actorKey: '0123456789abcdef' }));
  const keyed = await openPerson({ fetchHandler: lbHandler(lbData({ viewer: { names: [], actorKey: '0123456789abcdef' }, records })) });
  assert.equal(lbRow(keyed.window.document, 'Ana B.').querySelector('.tm-lb-level').dataset.levelState, 'known');
  const none = await openPerson({ fetchHandler: lbHandler(lbData(), { level: { level: null, setup: {}, ladder: [] } }) });
  assert.match(lbRow(none.window.document, 'Ana').textContent, /No level yet/);
  assert.match(lbRow(none.window.document, 'Bo').textContent, /Level unknown/);
  const stranger = await openPerson({ fetchHandler: lbHandler(lbData({ viewer: { names: [], actorKey: null } })) });
  assert.equal(stranger.window.document.querySelector('#tm-body .tm-lb .tm-lb-level[data-level-state="known"]'), null, 'nobody is guessed');
});

test('a failing level read never breaks the page', async () => {
  const ctx = await openPerson({ fetchHandler: (u, o) => (u.includes('/api/worca-level') ? respond({ error: 'no' }, 500) : lbHandler(lbData())(u, o)) });
  assert.ok(ctx.window.document.querySelector('#tm-body .tm-lb'));
});

test('a viewer with no level yet shows "No level yet" when the level view arrives after the first paint, without a Refresh', async () => {
  let release; const gate = new Promise((r) => { release = r; });
  const base = lbHandler(lbData());
  const NONE = { level: null, setup: {}, ladder: [] };
  const ctx = await openTm({ fetchHandler: (u, o) => (u.includes('/api/worca-level') ? gate.then(() => respond(NONE)) : base(u, o)) });
  const levelState = () => tableRow(ctx.window.document, 'Ana').querySelector('.tm-level').dataset.levelState;
  assert.equal(levelState(), 'unknown', 'the level is not read yet');
  release();
  for (let i = 0; i < 8; i++) await ctx.tick();
  assert.equal(levelState(), 'none');
  assert.match(tableRow(ctx.window.document, 'Ana').textContent, /No level yet/);
});

// The account corner reads /api/worca-level too, so these tests switch the served answer instead of counting reads.
const levelSwitch = (first) => {
  const served = { now: first, reads: 0 };
  const base = lbHandler(lbData());
  const fetchHandler = (u, o) => {
    if (!u.includes('/api/worca-level')) return base(u, o);
    served.reads += 1;
    return served.now ? respond(served.now) : respond({ error: 'no' }, 500);
  };
  return { served, fetchHandler };
};
const tmRefresh = async ({ window, tick }) => { window.document.querySelector('#tm-sync .tm-refresh').click(); for (let i = 0; i < 8; i++) await tick(); };

test('a failed level read recovers, and a level-up shows, on Refresh', async () => {
  const UP = { level: { index: 4, key: 'orchestrator', name: 'Orchestrator', avatar: '/assets/worca-levels/orchestrator.svg' } };
  const { served, fetchHandler } = levelSwitch(null);
  const ctx = await openPerson({ fetchHandler });
  const levelOf = () => lbRow(ctx.window.document, 'Ana').querySelector('.tm-lb-level').textContent;
  assert.match(levelOf(), /Level unknown/, 'the failed read leaves the level unread: not "No level yet"');
  served.now = LEVEL;
  await tmRefresh(ctx);
  assert.equal(levelOf(), 'Builder', 'the failed read was not kept for the session');
  served.now = UP;
  await tmRefresh(ctx);
  assert.equal(levelOf(), 'Orchestrator', 'a level-up shows after Refresh');
});

test('a failed level read after a good one keeps the level that was shown', async () => {
  const { served, fetchHandler } = levelSwitch(LEVEL);
  const ctx = await openPerson({ fetchHandler });
  const levelOf = () => lbRow(ctx.window.document, 'Ana').querySelector('.tm-lb-level').textContent;
  assert.equal(levelOf(), 'Builder');
  served.now = null;
  const before = served.reads;
  await tmRefresh(ctx);
  assert.ok(served.reads > before, 'Refresh asked again');
  assert.equal(levelOf(), 'Builder');
});

test('a level-up reaches the leaderboard without Refresh (the account menu\'s own read)', async () => {
  const UP = { level: { index: 4, key: 'orchestrator', name: 'Orchestrator', avatar: '/assets/worca-levels/orchestrator.svg' } };
  const { served, fetchHandler } = levelSwitch(LEVEL);
  const ctx = await openPerson({ fetchHandler });
  const levelOf = () => lbRow(ctx.window.document, 'Ana').querySelector('.tm-lb-level').textContent;
  assert.equal(levelOf(), 'Builder');
  served.now = UP;
  ctx.wsBox.ws.dispatch('message', { data: JSON.stringify({ type: 'worca-level-changed' }) });
  await new Promise((r) => setTimeout(r, 350));
  for (let i = 0; i < 4; i++) await ctx.tick();
  assert.equal(levelOf(), 'Orchestrator');
});

test('levels are off without the policy: no Level column, no badges, no avatars, no level read for the page', async () => {
  let levelReads = 0;
  const data = { ...lbData(), display: undefined };
  const base = lbHandler(data);
  const ctx = await openTm({ fetchHandler: (u, o) => { if (u.includes('/api/worca-level')) levelReads += 1; return base(u, o); } });
  const doc = ctx.window.document;
  for (let i = 0; i < 4; i++) await ctx.tick();
  assert.equal(doc.querySelector('#tm-body table[data-dim="actor"] th[data-sort="level"], #tm-body .tm-level'), null, 'no Level column on Overview');
  doc.querySelector('#tm-view [data-tm-view="person"]').click();
  for (let i = 0; i < 6; i++) await ctx.tick();
  assert.ok(doc.querySelector('#tm-body .tm-lb'), 'the leaderboard itself still shows');
  assert.equal(doc.querySelector('#tm-body .tm-lb-level, #tm-body .tm-lb-ava, #tm-body .tm-level'), null);
  const before = levelReads;   // the account menu's own read at boot is not Team metrics'
  await tmRefresh(ctx);
  assert.equal(doc.querySelector('#tm-body .tm-lb-level, #tm-body .tm-level'), null);
  assert.equal(levelReads, before, 'Refresh does not read a level when levels are off');
});

test('an Azure DevOps or Bitbucket lookup that could not answer is named under the leaderboard', async () => {
  const open = (status) => openPerson({ fetchHandler: lbHandler(lbData(), { prs: () => respond({ prs: {}, status }) }) });
  const note = (ctx) => ctx.window.document.querySelector('#tm-body .tm-lb-merged-note')?.textContent ?? null;
  assert.match(note(await open({ gh: 'unused', azure: 'missing' })), /^Azure DevOps has no sign-in on this machine/);
  assert.match(note(await open({ gh: 'ok', bitbucket: 'ok', bitbucketError: 'HTTP 500' })), /^Bitbucket could not be reached/);
  assert.match(note(await open({ gh: 'ok', azure: 'ok', azureTruncated: ['org/p/r'] })), /^org\/p\/r has more pull requests than one listing covers/);
  assert.equal(note(await open({ gh: 'ok', azure: 'ok', bitbucket: 'unused' })), null);
});

test('switching the leaderboard period re-ranks and persists', async () => {
  const lastMonth = new Date(monthStart(1) + 9 * 86_400_000).toISOString();
  const recs = [...lbData().records.slice(0, 3), ...['c1', 'c2', 'c3'].map((id) => lbRec(id, 'Cy', lastMonth))];
  const { window, tick } = await openPerson({ fetchHandler: lbHandler(lbData({ records: recs })) });
  const doc = window.document;
  const winners = () => doc.querySelector('#tm-body .tm-lb-leader .tm-lb-headline').textContent;
  assert.match(winners(), /^Ana is leading /);
  assert.equal(doc.querySelector('#tm-body .tm-lb [data-lb-range="this-month"]').getAttribute('aria-pressed'), 'true');
  const lmBtn = doc.querySelector('#tm-body .tm-lb [data-lb-range="last-month"]');
  lmBtn.focus();
  lmBtn.click();
  await tick();
  assert.equal(doc.activeElement.dataset.lbRange, 'last-month', 'the repaint keeps focus on the pressed period');
  for (let i = 0; i < 4; i++) await tick();   // the PR answer repaints the card again
  assert.equal(doc.activeElement.dataset.lbRange, 'last-month', 'and so does the repaint the PR answer brings');
  assert.match(winners(), /^Cy won /);
  assert.equal(window.localStorage.getItem('worca.teamMetrics.lbRange'), 'last-month');
  const again = await openPerson({ fetchHandler: lbHandler(lbData({ records: recs })), storage: { 'worca.teamMetrics.lbRange': 'last-month' } });
  assert.match(again.window.document.querySelector('#tm-body .tm-lb-leader .tm-lb-headline').textContent, /^Cy won /, 'the period is remembered');
});

test('merged runs come from the PR lookup: asked once per run, the count rises after the repaint', async () => {
  const log = [];
  const pr = (number, state) => [{ state, repo: 'acme/api', number }];
  const prs = () => respond({ prs: { a1: pr(1, 'MERGED'), a2: pr(2, 'MERGED'), a3: pr(3, 'OPEN') }, status: { gh: 'ok' } });
  const { window, tick } = await openPerson({ fetchHandler: lbHandler(lbData(), { prs, log }) });
  const doc = window.document;
  assert.equal(log.length, 1);
  assert.deepEqual(log[0].runs.map((r) => r.id).sort(), ['a1', 'a2', 'a3', 'b1', 'b2', 'b3']);
  assert.deepEqual(merged(doc, 'Ana'), ['2', '35.0 / 35']);
  assert.deepEqual(merged(doc, 'Bo'), ['0', '0.0 / 35']);
  assert.equal(doc.querySelector('#tm-body .tm-lb-merged-note'), null);
  doc.querySelector('#tm-body .tm-lb [data-lb-range="all"]').click();
  for (let i = 0; i < 4; i++) await tick();
  assert.equal(log.length, 1, 'the same runs are never asked twice');
});

test('a failing request to Worca leaves merged at 0, says so without naming a git host, and shows no toast', async () => {
  const { window } = await openPerson({ fetchHandler: lbHandler(lbData(), { prs: () => respond({ error: 'gh down' }, 502) }) });
  const doc = window.document;
  const note = doc.querySelector('#tm-body .tm-lb-merged-note').textContent;
  assert.equal(note, 'Worca could not look up pull requests — pull requests it could not check count as not merged.');
  assert.doesNotMatch(note, /GitHub|Azure|Bitbucket/);
  assert.deepEqual(merged(doc, 'Ana'), ['0', '0.0 / 35']);
  assert.equal(doc.querySelector('.toast, [data-toast]'), null);
});

test('a failed lookup\'s warning clears when Refresh succeeds', async () => {
  let calls = 0;
  const prs = () => (++calls === 1 ? respond({ error: 'down' }, 502) : respond({ prs: {}, status: { gh: 'ok' } }));
  const ctx = await openPerson({ fetchHandler: lbHandler(lbData(), { prs }) });
  const note = () => ctx.window.document.querySelector('#tm-body .tm-lb-merged-note');
  assert.match(note().textContent, /Worca could not look up pull requests/);
  await tmRefresh(ctx);
  assert.equal(calls, 2, 'Refresh asked again');
  assert.equal(note(), null, 'the old warning did not outlive the successful Refresh');
});

test('a lookup still in flight at Refresh cannot bring its error back', async () => {
  let calls = 0;
  let fail;
  const gate = new Promise((r) => { fail = r; });
  const prs = () => (++calls === 1 ? gate.then(() => respond({ error: 'down' }, 502)) : respond({ prs: {}, status: { gh: 'ok' } }));
  const ctx = await openTm({ fetchHandler: lbHandler(lbData(), { prs }) });
  const doc = ctx.window.document;
  doc.querySelector('#tm-view [data-tm-view="person"]').click();
  for (let i = 0; i < 4; i++) await ctx.tick();
  assert.equal(calls, 1);
  await tmRefresh(ctx);                      // the first lookup is still out
  fail();
  for (let i = 0; i < 8; i++) await ctx.tick();
  assert.ok(calls >= 2, 'the repaint after the stale answer asked again');
  assert.equal(doc.querySelector('#tm-body .tm-lb-merged-note'), null, 'the stale 502 was dropped');
});

test('leaving for the Timeline mid-lookup: the person view is not repainted and no run is asked twice', async () => {
  const log = [];
  let release;
  const gate = new Promise((r) => { release = r; });
  const prs = (body) => (log.length === 1 ? gate.then(() => respond({ prs: { a1: [{ state: 'MERGED', repo: 'acme/api', number: 1 }] }, status: { gh: 'ok' } })) : respond({ prs: {}, status: { gh: 'ok' } }));
  const ctx = await openTm({ fetchHandler: lbHandler(lbData(), { prs, log }) });
  const { window, tick } = ctx;
  const doc = window.document;
  doc.querySelector('#tm-view [data-tm-view="person"]').click();
  for (let i = 0; i < 4; i++) await tick();
  assert.equal(log.length, 1);
  assert.match(doc.querySelector('#tm-body .tm-lb-merged-note').textContent, /Checking merged pull requests/);
  const personBody = doc.querySelector('#tm-body .tm-lb');
  window.location.hash = 'team-metrics/timeline'; window.dispatchEvent(new window.Event('hashchange'));
  for (let i = 0; i < 4; i++) await tick();
  release();
  for (let i = 0; i < 6; i++) await tick();
  assert.equal(doc.querySelector('#tm-body .tm-lb'), personBody, 'the hidden person view was not repainted');
  const ids = log.flatMap((b) => b.runs.map((r) => r.id));
  assert.equal(new Set(ids).size, ids.length, 'each run asked once across both surfaces');
});
