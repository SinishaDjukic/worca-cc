// test/ui-team-metrics.test.mjs
// Team metrics page: the nav entry in both menus, the #team-metrics route and its
// loader, the scope select + KPI row + sync chip, the decision-36 sequence guard,
// and the Stats "Team-wide view ->" hint. boot() is a local copy of
// test/ui-stats.test.mjs's harness (imports, htmlPath/appPath, the WebSocket stub),
// with a `url` passthrough so the boot-direct test (#5) can open straight onto the
// Team metrics view.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import { makeRecord } from './fixtures/team-metrics/records.mjs';

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

async function boot({ fetchHandler, url = 'http://localhost:4317/' } = {}) {
  const dom = new JSDOM(readFileSync(htmlPath, 'utf8'), { url });
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

test('nav entry sits directly below Stats in sidebar and compact top-nav; routes to the view', async () => {
  const { window, tick } = await boot({ fetchHandler: tmHandler({ scopes: SCOPES_ON, data: TM_DATA }) });
  const doc = window.document;
  for (const sel of ['.sidebar .nav', '.topnav']) {
    const btns = [...doc.querySelectorAll(`${sel} button[data-nav]`)].map((b) => b.dataset.nav);
    assert.equal(btns[btns.indexOf('stats') + 1], 'team-metrics', sel);
  }
  assert.equal(doc.querySelector('.sidebar [data-nav="team-metrics"] span').textContent, 'Team metrics');
  window.location.hash = 'team-metrics'; window.dispatchEvent(new window.Event('hashchange')); await tick(); await tick();
  assert.equal(doc.querySelector('section[data-view="team-metrics"]').classList.contains('hidden'), false);
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

test('nothing enabled → empty state with two deep links; Stats hint hidden', async () => {
  const EMPTY = { projects: [], workspaces: [], scopes: { projects: [], workspaces: [] }, anyEnabled: false };
  const { window, tick } = await boot({ fetchHandler: tmHandler({ scopes: EMPTY }) });
  const doc = window.document;
  window.location.hash = 'team-metrics'; window.dispatchEvent(new window.Event('hashchange')); await tick(); await tick();
  assert.ok(doc.querySelector('#tm-body a[href="#projects"]'));
  assert.ok(doc.querySelector('#tm-body a[href="#workspaces"]'));
  assert.equal(doc.getElementById('tm-scope').disabled, true);
  assert.equal(doc.getElementById('tm-sync').hidden, true);
  window.location.hash = 'stats'; window.dispatchEvent(new window.Event('hashchange')); await tick(); await tick();
  assert.equal(doc.getElementById('stats-tm-hint').hidden, true);
});

test('booting straight to #team-metrics renders the page (module-scope state is declared before boot)', async () => {
  // Guards the §9.4 placement note: declared after the boot block, showView() reads tmState in its
  // temporal dead zone and the whole app fails to start.
  const { window, tick } = await boot({ url: 'http://localhost:4317/#team-metrics', fetchHandler: tmHandler({ scopes: SCOPES_ON, data: TM_DATA }) });
  await tick(); await tick();
  assert.equal(window.document.querySelectorAll('#tm-body .stat-tile').length, 6);
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

test('Stats shows "Team-wide view →" when a scope is enabled', async () => {
  const { window, tick } = await boot({ fetchHandler: tmHandler({ scopes: SCOPES_ON }) });
  window.location.hash = 'stats'; window.dispatchEvent(new window.Event('hashchange')); await tick(); await tick();
  assert.equal(window.document.getElementById('stats-tm-hint').hidden, false);
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
  const { window, tick } = await boot({
    fetchHandler: (u) => {
      if (u.includes('/api/team-metrics/scopes')) return respond(SCOPES_ON);
      if (u.includes('/api/team-metrics?')) return new Promise((res) => setTimeout(() => res(respond(u.includes('scope=workspace') ? WS_DATA : TM_DATA)), 60));
      return null;
    },
  });
  const doc = window.document;
  const body = doc.getElementById('tm-body');
  const settle = async () => { await new Promise((r) => setTimeout(r, 100)); await tick(); await tick(); };
  window.location.hash = 'team-metrics'; window.dispatchEvent(new window.Event('hashchange'));
  await settle();
  assert.equal(body.querySelectorAll('.stat-tile').length, 6);
  const sel = doc.getElementById('tm-scope');
  const pick = (v) => { sel.value = v; sel.dispatchEvent(new window.Event('change', { bubbles: true })); };
  pick('workspace:wks-iot-sp-platform-0123abcd'); await tick(); await tick();
  assert.ok(body.querySelector('.tm-skeleton'), 'never seen: the skeleton, not the project scope\'s numbers');
  await settle();
  assert.ok(doc.querySelector('.tm-home-hint'), 'the workspace payload landed');
  pick('project:billing-api-0123abcd'); await tick(); await tick();
  assert.equal(body.querySelector('.tm-skeleton'), null);
  assert.equal(body.querySelectorAll('.stat-tile').length, 6, 'the project scope\'s cached payload paints at once');
  assert.equal(doc.querySelector('.tm-home-hint'), null, 'and it is that scope\'s payload');
  assert.ok(body.classList.contains('is-loading')); assert.equal(body.getAttribute('aria-busy'), 'true');
  await settle();
  assert.equal(body.classList.contains('is-loading'), false); assert.equal(body.getAttribute('aria-busy'), null);
});
