// test/ui-team-metrics-timeline.test.mjs
// Team metrics → Timeline wired into app.js: #team-metrics/timeline opens the tab, the PR
// lookup is asked once for the runs on screen and repaints the tiles, tab switches do not
// refetch the records, a bar opens its card (Escape closes it), zooming by the header works,
// and a failing PR lookup leaves a working page. boot() is test/ui-team-metrics.test.mjs's.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import { makeRecord } from './fixtures/team-metrics/records.mjs';

const htmlPath = fileURLToPath(new URL('../ui/public/index.html', import.meta.url));
const appPath = fileURLToPath(new URL('../ui/public/app.js', import.meta.url));

async function boot({ fetchHandler, url = 'http://localhost:4317/' } = {}) {
  const dom = new JSDOM(readFileSync(htmlPath, 'utf8'), { url });
  const { window } = dom;
  window.Element.prototype.scrollIntoView = function () {};
  window.WebSocket = class {
    constructor() { this.readyState = 1; this._listeners = {}; }
    send() {} close() {}
    addEventListener(type, fn) { (this._listeners[type] ||= []).push(fn); }
  };
  window.fetch = (u, opts) => {
    const r = fetchHandler(String(u), opts || {});
    if (r) return r;
    if (String(u).includes('/api/projects')) return Promise.resolve({ ok: true, status: 200, json: async () => ({ projects: [] }) });
    return Promise.resolve({ ok: true, status: 200, json: async () => ({ config: { steps: {}, customModels: [] }, models: [], efforts: [] }) });
  };
  for (const k of ['window', 'document', 'location', 'localStorage', 'WebSocket', 'fetch', 'navigator']) {
    try { Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true }); } catch {}
  }
  globalThis.window = window; globalThis.document = window.document;
  await import(pathToFileURL(appPath).href + `?b=${Date.now()}_${Math.random()}`);
  const tick = () => new Promise((r) => setTimeout(r, 0));
  await tick();
  return { window, tick };
}

const respond = (body, status = 200) => Promise.resolve({ ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) });
const now = Date.now();
const iso = (t) => new Date(t).toISOString().replace(/\.\d{3}Z$/, 'Z');
function rec(id, ageH, extra = {}) {
  const r = makeRecord({ id, startedAt: iso(now - ageH * 3_600_000), title: `Work ${id}`, ...extra });
  r.endedAt = iso(now - ageH * 3_600_000 + 1_800_000);
  r.git.branch = `worca/${id}`;
  return r;
}
const SCOPES = {
  projects: [], workspaces: [],
  scopes: { projects: [{ id: 'project:billing-api-0123abcd', label: 'acme/billing-api', name: 'billing-api' }], workspaces: [] },
  anyEnabled: true,
};
const DATA = {
  scope: { kind: 'project', id: 'billing-api-0123abcd', name: 'billing-api', slug: 'acme/billing-api' },
  records: [rec('a', 3), rec('b', 2, { result: 'failed' })],
  aggregate: null, stats: { files: 2, malformed: 0, unknownV: 0 },
  sync: [{ slug: 'acme/billing-api', pending: 0, fetchedAt: iso(now) }],
  refresh: { requested: false, fetched: true, limited: false, retryInMs: 0 }, fetchError: null,
};
const PRS_OK = { prs: { a: [{ repo: 'acme/billing-api', number: 9, url: 'https://github.com/acme/billing-api/pull/9', state: 'MERGED', createdAt: iso(now - 2.5 * 3_600_000), mergedAt: iso(now - 3_600_000) }], b: [] }, status: { gh: 'ok', actionRepos: [], unsupportedRepos: [] } };

function handler({ prs = PRS_OK, prsStatus = 200, events = [], log = [] } = {}) {
  return (u, opts) => {
    if (!u.includes('/api/team-metrics')) return null;
    log.push({ u, body: opts.body ? JSON.parse(opts.body) : null });
    if (u.includes('/api/team-metrics/scopes')) return respond(SCOPES);
    if (u.includes('/api/team-metrics/pr-events')) return respond({ prs: events, truncated: false, actionRepos: ['acme/billing-api'] });
    if (u.includes('/api/team-metrics/prs')) return respond(prs, prsStatus);
    if (u.includes('/api/team-metrics?')) return respond(DATA);
    return null;
  };
}
async function settle(tick, n = 6) { for (let i = 0; i < n; i++) await tick(); }

test('#team-metrics/timeline opens the tab; PRs are asked once and repaint the tiles', async () => {
  const log = [];
  const { window, tick } = await boot({ url: 'http://localhost:4317/#team-metrics/timeline', fetchHandler: handler({ log }) });
  await settle(tick);
  const doc = window.document;
  assert.equal(doc.querySelector('[data-tm-tab="timeline"]').getAttribute('aria-selected'), 'true');
  assert.equal(doc.getElementById('tm-range').hidden, true);
  assert.equal(doc.getElementById('tm-body').hidden, true);
  assert.equal(doc.getElementById('tm-timeline').hidden, false);
  const prCalls = log.filter((c) => c.u.includes('/api/team-metrics/prs'));
  assert.equal(prCalls.length, 1);
  assert.equal(prCalls[0].body.scope, 'project:billing-api-0123abcd');
  assert.deepEqual(prCalls[0].body.runs.map((r) => r.id).sort(), ['a', 'b']);
  assert.deepEqual(prCalls[0].body.runs.find((r) => r.id === 'a').repos, ['acme/billing-api']);
  const tiles = [...doc.querySelectorAll('#tm-timeline .tl-tile .stat-label span')].map((s) => s.textContent);
  assert.deepEqual(tiles.slice(0, 3), ['Shipped', 'In review', 'Needs attention']);
  assert.equal(doc.querySelector('#tm-timeline [data-tl-filter="shipped"] .stat-value').textContent, '1');
  assert.equal(doc.querySelectorAll('#tm-timeline .tl-item').length, 2);
  // A repaint (grouping) does not ask again.
  doc.querySelector('#tm-timeline [data-tl-mode="people"]').click();
  await settle(tick);
  assert.equal(log.filter((c) => c.u.includes('/api/team-metrics/prs')).length, 1);
  assert.ok(doc.querySelector('#tm-timeline .tl-ava'));
});

test('tabs switch without refetching the records; Overview gets its controls back', async () => {
  const log = [];
  const { window, tick } = await boot({ url: 'http://localhost:4317/#team-metrics', fetchHandler: handler({ log }) });
  await settle(tick);
  const doc = window.document;
  assert.equal(doc.getElementById('tm-timeline').hidden, true);
  const dataCalls = () => log.filter((c) => c.u.includes('/api/team-metrics?')).length;
  const before = dataCalls();
  doc.querySelector('[data-tm-tab="timeline"]').click();
  window.dispatchEvent(new window.Event('hashchange'));
  await settle(tick);
  assert.equal(window.location.hash, '#team-metrics/timeline');
  assert.equal(doc.getElementById('tm-timeline').hidden, false);
  doc.querySelector('[data-tm-tab="overview"]').click();
  window.dispatchEvent(new window.Event('hashchange'));
  await settle(tick);
  assert.equal(doc.getElementById('tm-body').hidden, false);
  assert.equal(doc.getElementById('tm-range').hidden, false);
  assert.equal(dataCalls(), before, 'records are not fetched again');
});

test('a bar opens its card and Escape closes it; header zooms to a day', async () => {
  const { window, tick } = await boot({ url: 'http://localhost:4317/#team-metrics/timeline', fetchHandler: handler() });
  await settle(tick);
  const doc = window.document;
  doc.querySelector('#tm-timeline .tl-hit').click();
  const pop = doc.querySelector('.tl-pop');
  assert.ok(pop);
  assert.match(pop.textContent, /Runs/);
  pop.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal(doc.querySelector('.tl-pop'), null);
  doc.querySelector('#tm-timeline .tl-hcell.is-today').click();
  await settle(tick);
  assert.ok(doc.querySelector('#tm-timeline .tl-z-day'));
  assert.equal(doc.querySelectorAll('#tm-timeline .tl-crumb').length, 2);
  doc.querySelector('#tm-timeline .tl-crumb[data-tl-zoom="month"]').click();
  await settle(tick);
  assert.ok(doc.querySelector('#tm-timeline .tl-z-month'));
});

test('PRs outside Worca are fetched once, drawn, and the toggle hides them (remembered)', async () => {
  const log = [];
  const events = [{ repo: 'acme/billing-api', number: 50, head: 'hand-made', url: 'https://github.com/acme/billing-api/pull/50', title: 'Hand-made fix', author: 'sini', state: 'MERGED', createdAt: iso(now - 5 * 3_600_000), mergedAt: iso(now - 4 * 3_600_000) }];
  const { window, tick } = await boot({ url: 'http://localhost:4317/#team-metrics/timeline', fetchHandler: handler({ log, events }) });
  await settle(tick);
  const doc = window.document;
  assert.equal(log.filter((c) => c.u.includes('/api/team-metrics/pr-events')).length, 1);
  const row = () => [...doc.querySelectorAll('#tm-timeline .tl-item')].find((r) => r.textContent.includes('Hand-made fix'));
  assert.ok(row(), 'the outside PR has its own row');
  assert.ok(row().querySelector('.tl-outside'));
  const cb = doc.getElementById('tl-outside');
  cb.checked = false;
  cb.dispatchEvent(new window.Event('change', { bubbles: true }));
  await settle(tick);
  assert.equal(row(), undefined);
  assert.equal(window.localStorage.getItem('worca.teamMetrics.tlOutside'), '0');
  assert.equal(log.filter((c) => c.u.includes('/api/team-metrics/pr-events')).length, 1, 'not fetched again');
  window.localStorage.removeItem('worca.teamMetrics.tlOutside');
});

test('a failing PR lookup leaves a working page that says so', async () => {
  const { window, tick } = await boot({ url: 'http://localhost:4317/#team-metrics/timeline', fetchHandler: handler({ prs: { error: 'boom' }, prsStatus: 500 }) });
  await settle(tick);
  const doc = window.document;
  assert.equal(doc.querySelectorAll('#tm-timeline .tl-item').length, 2);
  assert.match(doc.querySelector('#tm-timeline .tl-note').textContent, /GitHub did not answer for some pull requests: boom/);
  assert.equal(doc.querySelector('#tm-timeline .tl-tile .stat-label span').textContent, 'Completed');
});
