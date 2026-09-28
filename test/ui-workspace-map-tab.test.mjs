// test/ui-workspace-map-tab.test.mjs — jsdom boot tests for the workspace page's Map tab
// (#workspaces/<id>/map, spec D17): the lazy GET /map, the routes every override calls (PUT / POST /
// DELETE / render) followed by a reload of the list and the tab, the frames that reload it, the
// filters (graph pair by click and by keyboard, coverage chip, selects), the add-form draft, focus
// and scroll that survive a repaint, Regenerate after a description save, and Re-scan from the
// empty state. Edge ids are real (x_ / m_ + 12 hex): P5 answers 400 to any other id.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import { edgeId, manualEdgeId } from '../src/shared/workspace-map/ids.mjs';

const htmlPath = fileURLToPath(new URL('../ui/public/index.html', import.meta.url));
const appPath = fileURLToPath(new URL('../ui/public/app.js', import.meta.url));

const ID = 'wks-shop-00000001';
const AT = '2026-09-25T11:00:00.000Z';
const X_HTTP = edgeId('web', 'billing-api', 'http', 'http:GET /invoices/{}');
const X_PKG = edgeId('billing-api', 'shared-lib', 'pkg', 'pkg:npm:shared-lib');
const M_NEW = manualEdgeId('web', 'shared-lib', 'other', 'S3 bucket', '2026-09-25T12:00:00.000Z');
const WS = [{ id: ID, name: 'Shop', description: '# Workspace: Shop\n## Overview\nthree svcs', projectPaths: ['/s/billing-api', '/s/shared-lib', '/s/web'],
  projectKeys: ['billing-api', 'shared-lib', 'web'], exists: [true, true, true], createdAt: '2026-09-01T10:00:00.000Z', updatedAt: '2026-09-25T10:00:00.000Z',
  descriptionOrigin: 'generated', mapSummary: { scannedAt: '2026-09-25T10:00:00.000Z', members: 3, edges: 2, gaps: 0, confirmed: 0, rejected: 0, manual: 0, missing: 0, byKind: { http: 1, pkg: 1 } } }];
const cov = (level) => ({ level, files: 3, scannedFiles: 3, truncated: false, factsStatic: 3, factsLlm: 0, unresolved: 0, rejected: 0, surveyed: 'skipped', usageStatus: 'investigated', graph: null });
const MAP = {
  version: 1, workspace: { name: 'Shop' }, scannedAt: '2026-09-25T10:00:00.000Z', runId: 'run-1',
  members: ['billing-api', 'shared-lib', 'web'].map((key) => ({ key, name: key, role: null, roleSource: null, aliases: [], stack: ['node'], coverage: cov('rich') })),
  edges: [
    { id: X_HTTP, from: 'web', to: 'billing-api', kind: 'http', norm: 'http:GET /invoices/{}', display: 'GET /invoices/{id}', label: null, detail: '', confidence: 'exact', sources: ['static'],
      evidence: { from: [{ file: 'src/api.ts', line: 12, match: "fetch('/invoices/'" }], to: [{ file: 'src/routes.ts', line: 4, match: "router.get('/invoices/:id'" }] } },
    { id: X_PKG, from: 'billing-api', to: 'shared-lib', kind: 'pkg', norm: 'pkg:npm:shared-lib', display: 'shared-lib', label: null, detail: '', confidence: 'exact', sources: ['static'],
      evidence: { from: [{ file: 'package.json', line: 7, match: '"shared-lib"' }], to: [] } },
  ],
  order: [['shared-lib'], ['billing-api'], ['web']], cycles: [], graph: { mode: 'none', file: null, nodes: 0, bridges: 0 }, stats: {}, errors: [],
};
const EMPTY_OV = { version: 1, edges: {}, manual: [] };
// The GET /map payload (P5): the overrides doc from the edge states and the manual edges; edges =
// P1 effectiveEdges order (from, to, kind, display), a manual edge in P1 v2's synthetic shape.
const byEdge = (a, b) => `${a.from}|${a.to}|${a.kind}|${a.display}`.localeCompare(`${b.from}|${b.to}|${b.kind}|${b.display}`);
const payloadOf = ({ states = {}, manual = [], origin = 'generated', map = MAP } = {}) => ({
  map, synthesis: null, descriptionOrigin: origin,
  overrides: { version: 1, manual, edges: Object.fromEntries((map ? map.edges : []).filter((e) => states[e.id])
    .map((e) => [e.id, { state: states[e.id], from: e.from, to: e.to, kind: e.kind, display: e.display, at: AT }])) },
  edges: map ? [...manual.map((m) => ({ ...m, norm: null, label: null, confidence: null, sources: ['manual'], evidence: { from: [], to: [] }, state: 'manual' })),
    ...map.edges.map((e) => ({ ...e, state: states[e.id] || 'auto' }))].sort(byEdge) : [],
});

class WSStub {
  constructor() { this.readyState = 1; this._listeners = {}; WSStub.last = this; }
  send() {} close() {}
  addEventListener(type, fn) { (this._listeners[type] = this._listeners[type] || []).push(fn); }
  deliver(obj) { (this._listeners.message || []).forEach((fn) => fn({ data: JSON.stringify(obj) })); }
}
const ok = (body, status = 200) => Promise.resolve({ ok: status < 400, status, json: async () => body });

// A tiny server: GET /map answers `server.payload`; every call is logged as "METHOD path body".
async function boot({ payload = payloadOf(), route = null } = {}) {
  const server = { payload, calls: [], workspaces: WS };
  const dom = new JSDOM(readFileSync(htmlPath, 'utf8'), { url: 'http://localhost:4317/' });
  const { window } = dom;
  window.Element.prototype.scrollIntoView = function () {};
  window.WebSocket = WSStub;
  window.requestAnimationFrame = (fn) => setTimeout(fn, 0);
  window.fetch = (url, opts = {}) => {
    const u = String(url);
    const method = opts.method || 'GET';
    if (u.includes('/api/workspaces')) server.calls.push(`${method} ${u}${opts.body ? ` ${opts.body}` : ''}`);
    if (route) { const r = route(u, opts, server); if (r) return r; }
    if (u === `/api/workspaces/${ID}/map` && method === 'GET') return ok(server.payload);
    if (u.endsWith('/api/workspaces') || u.includes('/api/workspaces?')) return ok({ workspaces: server.workspaces });
    if (u.includes('/api/projects')) return ok({ projects: [] });
    return ok({ config: { steps: {}, customModels: [] }, models: [], efforts: [] });
  };
  for (const k of ['window', 'document', 'location', 'localStorage', 'WebSocket', 'fetch', 'navigator', 'requestAnimationFrame']) {
    try { Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true }); } catch {}
  }
  globalThis.window = window; globalThis.document = window.document;
  await import(pathToFileURL(appPath).href + `?b=${Date.now()}_${Math.random()}`);
  await new Promise((r) => setTimeout(r, 0));
  return { window, doc: window.document, server, ws: () => WSStub.last };
}
const tick = () => new Promise((r) => setTimeout(r, 0));
const settle = async (n = 8) => { for (let i = 0; i < n; i++) await tick(); };
const click = (window, node) => node.dispatchEvent(new window.Event('click', { bubbles: true }));
async function go(window, hash) { window.location.hash = hash; await settle(); }
const mapSec = (doc) => doc.querySelector('#ws-detail .pd-sec[data-sec="map"]');
const gets = (server) => server.calls.filter((c) => c === `GET /api/workspaces/${ID}/map`).length;
const rows = (doc) => [...mapSec(doc).querySelectorAll('.wm-row')].map((r) => `${r.dataset.edge}:${r.querySelector('.wm-state').textContent}`);

test('#workspaces/<id>/map opens the Map pill, loads GET /map once and paints coverage, graph and table; the pills keep the hash', async () => {
  const { window, doc, server } = await boot();
  await go(window, `workspaces/${ID}/map`);
  const page = doc.querySelector('#ws-detail .pd.wd');
  assert.equal(page.querySelector('.pd-tab.active').dataset.sec, 'map');
  assert.equal(gets(server), 1);
  const sec = mapSec(doc);
  assert.equal(sec.hidden, false);
  assert.equal(sec.querySelectorAll('.wm-chip').length, 3);
  assert.equal(sec.querySelectorAll('svg.wm-graph .wm-pair').length, 2);
  assert.deepEqual(rows(doc), [`${X_PKG}:auto`, `${X_HTTP}:auto`]);
  click(window, page.querySelector('.pd-tab[data-sec="overview"]'));
  await settle();
  assert.equal(window.location.hash, `#workspaces/${ID}`);
  click(window, page.querySelector('.pd-tab[data-sec="map"]'));
  await settle();
  assert.equal(window.location.hash, `#workspaces/${ID}/map`);
  assert.equal(gets(server), 1, 'a built tab is not refetched by a pill hop');
});

test('an older GET /map that answers last never paints over a newer one', async () => {
  let release; const gate = new Promise((r) => { release = r; });
  let n = 0;
  const { window, doc, server, ws } = await boot({
    route: (u, opts, s) => {
      if (u !== `/api/workspaces/${ID}/map` || (opts.method || 'GET') !== 'GET') return null;
      n += 1;
      if (n === 1) { const old = s.payload; return gate.then(() => ok(old)); }
      return null;
    },
  });
  await go(window, `workspaces/${ID}/map`);
  server.payload = payloadOf({ states: { [X_HTTP]: 'confirmed' } });
  ws().deliver({ type: 'workspaces-changed', action: 'map' });
  await settle();
  assert.deepEqual(rows(doc), [`${X_PKG}:auto`, `${X_HTTP}:confirmed`]);
  release();
  await settle();
  assert.deepEqual(rows(doc), [`${X_PKG}:auto`, `${X_HTTP}:confirmed`], 'the stale answer is dropped');
});

test('the Map tab is lazy: the Overview never fetches /map, and a map frame before it is built fetches nothing', async () => {
  const { window, server, ws } = await boot();
  await go(window, `workspaces/${ID}`);
  ws().deliver({ type: 'workspaces-changed', action: 'map' });
  await settle();
  assert.equal(gets(server), 0);
});

test('frames: map and scan actions reload a built tab; other actions do not; the add-form draft, the focus and both scrolls survive the repaint', async () => {
  const { window, doc, server, ws } = await boot();
  await go(window, `workspaces/${ID}/map`);
  const input = mapSec(doc).querySelector('[name="wm-display"]');
  input.value = 'half-typed';
  input.focus();
  mapSec(doc).querySelector('.wm-graph-scroll').scrollLeft = 60;
  mapSec(doc).querySelector('.wm-table-scroll').scrollLeft = 140;
  ws().deliver({ type: 'workspaces-changed', action: 'metrics-home' });
  await settle();
  assert.equal(gets(server), 1, 'metrics-home does not touch the map');
  server.payload = payloadOf({ states: { [X_HTTP]: 'confirmed' } });
  ws().deliver({ type: 'workspaces-changed', action: 'map' });
  await settle();
  assert.equal(gets(server), 2);
  assert.deepEqual(rows(doc), [`${X_PKG}:auto`, `${X_HTTP}:confirmed`]);
  const again = mapSec(doc).querySelector('[name="wm-display"]');
  assert.equal(again.value, 'half-typed', 'the draft is restored');
  assert.equal(doc.activeElement, again, 'and keeps the focus');
  assert.equal(mapSec(doc).querySelector('.wm-graph-scroll').scrollLeft, 60, 'the graph keeps its scroll');
  assert.equal(mapSec(doc).querySelector('.wm-table-scroll').scrollLeft, 140, 'and the table its own (the actions are its last column)');
  ws().deliver({ type: 'workspaces-changed', action: 'scan-updated' });
  await settle();
  assert.equal(gets(server), 3);
});

test('filters: a graph pair by click or Enter filters the table and keeps focus; a coverage chip and a select filter too', async () => {
  const { window, doc } = await boot();
  await go(window, `workspaces/${ID}/map`);
  click(window, mapSec(doc).querySelector('.wm-pair[data-from="web"] .wm-line'));
  await settle(2);
  assert.deepEqual(rows(doc), [`${X_HTTP}:auto`]);
  assert.ok(mapSec(doc).querySelector('.wm-filters .wm-pair-chip'));
  assert.equal(mapSec(doc).querySelector('.wm-pair[data-from="web"]').getAttribute('aria-pressed'), 'true');
  click(window, mapSec(doc).querySelector('.wm-pair[data-from="web"]'));
  await settle(2);
  assert.deepEqual(rows(doc), [`${X_PKG}:auto`, `${X_HTTP}:auto`], 'the same pair again clears');
  const pair = mapSec(doc).querySelector('.wm-pair[data-from="billing-api"]');
  pair.focus();
  pair.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  await settle(2);
  assert.deepEqual(rows(doc), [`${X_PKG}:auto`]);
  assert.equal(doc.activeElement, mapSec(doc).querySelector('.wm-pair[data-from="billing-api"]'), 'focus stays on the pair');
  click(window, mapSec(doc).querySelector('.wm-filters button[data-filter="all"]'));
  await settle(2);
  click(window, mapSec(doc).querySelector('.wm-chip[data-value="web"]'));
  await settle(2);
  assert.deepEqual(rows(doc), [`${X_HTTP}:auto`]);
  assert.equal(mapSec(doc).querySelector('.wm-chip[data-value="web"]').getAttribute('aria-pressed'), 'true');
  const kind = mapSec(doc).querySelector('select.wm-filter[data-filter="kind"]');
  kind.value = 'pkg';
  kind.dispatchEvent(new window.Event('change', { bubbles: true }));
  await settle(2);
  assert.equal(mapSec(doc).querySelector('.wm-none td').textContent, 'No edges', 'member web AND kind pkg');
  assert.equal(mapSec(doc).querySelector('select.wm-filter[data-filter="kind"]').value, 'pkg');
});

test('Space on a focused pair filters the table like Enter and never scrolls the page', async () => {
  const { window, doc } = await boot();
  await go(window, `workspaces/${ID}/map`);
  const pair = mapSec(doc).querySelector('.wm-pair[data-from="billing-api"]');
  pair.focus();
  const ev = new window.KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true });
  pair.dispatchEvent(ev);
  await settle(2);
  assert.deepEqual(rows(doc), [`${X_PKG}:auto`]);
  assert.equal(ev.defaultPrevented, true, 'no page scroll');
});

test('a frame repaint keeps the focus on a row action or a filter select', async () => {
  const { window, doc, server, ws } = await boot();
  await go(window, `workspaces/${ID}/map`);
  const before = mapSec(doc).querySelector(`.wm-confirm[data-edge="${X_HTTP}"]`);
  before.focus();
  ws().deliver({ type: 'workspaces-changed', action: 'map' });
  await settle();
  assert.equal(gets(server), 2);
  assert.equal(before.isConnected, false, 'the table was repainted');
  assert.equal(doc.activeElement, mapSec(doc).querySelector(`.wm-row[data-edge="${X_HTTP}"] .wm-confirm`), 'the row action keeps the focus');
  const select = mapSec(doc).querySelector('select.wm-filter[data-filter="kind"]');
  select.focus();
  ws().deliver({ type: 'workspaces-changed', action: 'scan-updated' });
  await settle();
  assert.equal(gets(server), 3);
  assert.equal(select.isConnected, false);
  assert.equal(doc.activeElement, mapSec(doc).querySelector('select.wm-filter[data-filter="kind"]'), 'and so does a filter select');
});

test('no map yet: the tab says so', async () => {
  const { window, doc } = await boot({ payload: payloadOf({ map: null }) });
  await go(window, `workspaces/${ID}/map`);
  assert.equal(mapSec(doc).querySelector('.wm-empty b').textContent, 'No map yet');
  assert.ok(mapSec(doc).querySelector('.wm-empty .wm-rescan'));
});

test('a failed load shows the error alone, never the empty state', async () => {
  const { window, doc } = await boot({ route: (u) => (u === `/api/workspaces/${ID}/map` ? ok({ error: 'boom' }, 500) : null) });
  await go(window, `workspaces/${ID}/map`);
  assert.equal(mapSec(doc).querySelector('.wm-error').textContent, 'boom');
  assert.equal(mapSec(doc).querySelector('.wm-empty'), null);
});

test('Confirm / Reject / Clear PUT the edge state, then reload the list and the tab; the keyboard stays on the row', async () => {
  const { window, doc, server } = await boot({
    route: (u, opts, s) => {
      const m = u.match(/\/map\/edges\/([^/]+)$/);
      if (m && opts.method === 'PUT') {
        const { state } = JSON.parse(opts.body);
        const states = Object.fromEntries(s.payload.edges.filter((e) => e.state === 'confirmed' || e.state === 'rejected').map((e) => [e.id, e.state]));
        if (state) states[decodeURIComponent(m[1])] = state; else delete states[decodeURIComponent(m[1])];
        s.payload = payloadOf({ states });
        return ok({ overrides: EMPTY_OV });
      }
      return null;
    },
  });
  await go(window, `workspaces/${ID}/map`);
  const confirmBtn = mapSec(doc).querySelector(`.wm-confirm[data-edge="${X_HTTP}"]`);
  confirmBtn.focus();
  click(window, confirmBtn);
  await settle();
  assert.ok(server.calls.includes(`PUT /api/workspaces/${ID}/map/edges/${X_HTTP} {"state":"confirmed"}`));
  const put = server.calls.findIndex((c) => c.startsWith('PUT '));
  assert.ok(server.calls.slice(put).includes('GET /api/workspaces'), 'the list reloads (the description may have been re-rendered)');
  assert.equal(gets(server), 2, 'and the tab reloads');
  assert.deepEqual(rows(doc), [`${X_PKG}:auto`, `${X_HTTP}:confirmed`]);
  assert.equal(doc.activeElement, mapSec(doc).querySelector(`.wm-row[data-edge="${X_HTTP}"] .wm-clear`), 'the keyboard stays on the row, on Clear: never on Reject, which a second Enter would press');
  assert.ok(mapSec(doc).querySelector('.wm-pair[data-from="web"]').classList.contains('is-confirmed'));
  click(window, mapSec(doc).querySelector(`.wm-reject[data-edge="${X_PKG}"]`));
  await settle();
  assert.ok(server.calls.includes(`PUT /api/workspaces/${ID}/map/edges/${X_PKG} {"state":"rejected"}`));
  assert.deepEqual(rows(doc), [`${X_PKG}:rejected`, `${X_HTTP}:confirmed`]);
  assert.equal(mapSec(doc).querySelector('.wm-pair[data-from="billing-api"]'), null, 'a rejected edge leaves the graph');
  assert.equal(doc.activeElement, mapSec(doc).querySelector(`.wm-row[data-edge="${X_HTTP}"] .wm-clear`), 'a press that did not hold the focus never moves it');
  const clearBtn = mapSec(doc).querySelector(`.wm-clear[data-edge="${X_PKG}"]`);
  clearBtn.focus();
  click(window, clearBtn);
  await settle();
  assert.ok(server.calls.includes(`PUT /api/workspaces/${ID}/map/edges/${X_PKG} {"state":null}`));
  assert.deepEqual(rows(doc), [`${X_PKG}:auto`, `${X_HTTP}:confirmed`]);
  assert.equal(doc.activeElement, mapSec(doc).querySelector(`.wm-row[data-edge="${X_PKG}"] .wm-confirm`), 'after Clear (no Clear left): the row\'s first action');
});

test('a second press while the first request runs sends nothing', async () => {
  let release; const gate = new Promise((r) => { release = r; });
  const { window, doc, server } = await boot({ route: (u, opts) => (opts.method === 'PUT' ? gate.then(() => ok({ overrides: EMPTY_OV })) : null) });
  await go(window, `workspaces/${ID}/map`);
  const btn = mapSec(doc).querySelector(`.wm-reject[data-edge="${X_PKG}"]`);
  click(window, btn);
  click(window, btn);
  await settle(2);
  assert.equal(btn.disabled, true, 'busy while the request runs');
  release();
  await settle();
  assert.equal(server.calls.filter((c) => c.startsWith('PUT ')).length, 1);
});

// Chrome's focus fixup moves the focus off a button that turns disabled; jsdom keeps it (and
// ignores blur() on a disabled button), so these tests drop it by hand.
function dropFocus(doc) {
  const away = doc.createElement('input');
  doc.body.append(away);
  away.focus();
  away.remove();
  assert.equal(doc.activeElement, doc.body);
}

test('a row that comes back unchanged keeps the keyboard on the pressed action, even after the browser dropped the focus', async () => {
  let release; const gate = new Promise((r) => { release = r; });
  // The PUT succeeds but the reload shows the row as it was (another window undid it at once).
  const { window, doc } = await boot({ route: (u, opts) => (opts.method === 'PUT' ? gate.then(() => ok({ overrides: EMPTY_OV })) : null) });
  await go(window, `workspaces/${ID}/map`);
  const reject = mapSec(doc).querySelector(`.wm-reject[data-edge="${X_PKG}"]`);
  reject.focus();
  click(window, reject);
  await settle(2);
  dropFocus(doc);
  release();
  await settle();
  assert.equal(doc.activeElement, mapSec(doc).querySelector(`.wm-row[data-edge="${X_PKG}"] .wm-reject`), 'the same action, not the row\'s first one');
});

test('a frame\'s newer reload that overtakes the override\'s own reload still puts the keyboard on the row', async () => {
  let putRelease; const putGate = new Promise((r) => { putRelease = r; });
  const mapGates = [];
  let maps = 0;
  const { window, doc, ws } = await boot({
    route: (u, opts, s) => {
      if (opts.method === 'PUT') return putGate.then(() => { s.payload = payloadOf({ states: { [X_PKG]: 'rejected' } }); return ok({ overrides: EMPTY_OV }); });
      if (u !== `/api/workspaces/${ID}/map` || (opts.method || 'GET') !== 'GET') return null;
      maps += 1;
      if (maps === 1) return null;                                      // the tab's first load answers at once
      const payload = s.payload;                                         // what the server holds when the GET arrives
      return new Promise((r) => mapGates.push(() => r(ok(payload))));   // later loads wait for the test
    },
  });
  await go(window, `workspaces/${ID}/map`);
  const reject = mapSec(doc).querySelector(`.wm-reject[data-edge="${X_PKG}"]`);
  reject.focus();
  click(window, reject);
  await settle(2);
  dropFocus(doc);
  putRelease();
  await settle();                                                        // the override's own GET /map waits
  ws().deliver({ type: 'workspaces-changed', action: 'map' });           // P5's frame (or another window's)
  await settle();                                                        // the frame's newer GET /map waits too
  assert.equal(mapGates.length, 2);
  mapGates[0]();                                                         // ours answers first: dropped (newest wins)
  await settle();
  mapGates[1]();                                                         // the frame's answer paints
  await settle();
  assert.deepEqual(rows(doc), [`${X_PKG}:rejected`, `${X_HTTP}:auto`]);
  assert.equal(doc.activeElement, mapSec(doc).querySelector(`.wm-row[data-edge="${X_PKG}"] .wm-clear`), 'the keyboard lands on the row in the paint that won');
});

test('an older reload that still paints after the answer (it began before) never takes the override\'s keyboard target', async () => {
  let putRelease; const putGate = new Promise((r) => { putRelease = r; });
  let listGate = null;
  const mapGates = [];
  let maps = 0;
  const { window, doc, ws } = await boot({
    route: (u, opts, s) => {
      if (opts.method === 'PUT') return putGate.then(() => { s.payload = payloadOf({ states: { [X_PKG]: 'rejected' } }); return ok({ overrides: EMPTY_OV }); });
      if (listGate && (u.endsWith('/api/workspaces') || u.includes('/api/workspaces?'))) { const g = listGate; listGate = null; return g.then(() => ok({ workspaces: s.workspaces })); }
      if (u !== `/api/workspaces/${ID}/map` || (opts.method || 'GET') !== 'GET') return null;
      maps += 1;
      if (maps === 1) return null;
      const payload = s.payload;
      return new Promise((r) => mapGates.push(() => r(ok(payload))));
    },
  });
  await go(window, `workspaces/${ID}/map`);
  const reject = mapSec(doc).querySelector(`.wm-reject[data-edge="${X_PKG}"]`);
  reject.focus();
  click(window, reject);
  await settle(2);
  dropFocus(doc);
  ws().deliver({ type: 'workspaces-changed', action: 'map' });           // another window: its GET /map starts BEFORE the answer
  await settle();
  assert.equal(mapGates.length, 1);
  let releaseList; listGate = new Promise((r) => { releaseList = r; });  // hold the override's own list reload
  putRelease();
  await settle();
  mapGates[0]();                                                         // the older GET answers with the old table and paints
  await settle();
  assert.deepEqual(rows(doc), [`${X_PKG}:auto`, `${X_HTTP}:auto`], 'the old table painted');
  releaseList();
  await settle();                                                        // the override's own GET /map starts and waits
  assert.equal(mapGates.length, 2);
  mapGates[1]();
  await settle();
  assert.deepEqual(rows(doc), [`${X_PKG}:rejected`, `${X_HTTP}:auto`]);
  assert.equal(doc.activeElement, mapSec(doc).querySelector(`.wm-row[data-edge="${X_PKG}"] .wm-clear`), 'the target waited for the new table');
});

test('a refused override shows the server error on the page header and reloads nothing', async () => {
  const { window, doc, server } = await boot({
    route: (u, opts) => (opts.method === 'PUT' ? ok({ error: 'state must be "confirmed", "rejected" or null' }, 400) : null),
  });
  await go(window, `workspaces/${ID}/map`);
  const before = server.calls.length;
  const btn = mapSec(doc).querySelector(`.wm-confirm[data-edge="${X_HTTP}"]`);
  dropFocus(doc);                       // the keyboard is nowhere: a mouse press in a browser that does not focus buttons
  click(window, btn);
  await settle();
  const err = doc.querySelector('#ws-detail .pd-error');
  assert.equal(err.hidden, false);
  assert.equal(err.textContent, 'state must be "confirmed", "rejected" or null');
  assert.deepEqual(server.calls.slice(before), [`PUT /api/workspaces/${ID}/map/edges/${X_HTTP} {"state":"confirmed"}`]);
  assert.equal(btn.disabled, false, 'the button is live again');
  assert.notEqual(doc.activeElement, btn, 'a press that did not hold the keyboard is not handed it');
});

test('a failed press gives the keyboard back to its button once the browser dropped it', async () => {
  let release; const gate = new Promise((r) => { release = r; });
  // The request dies (the server restarted): the catch path, the same finally as a refusal.
  const { window, doc } = await boot({ route: (u, opts) => (opts.method === 'PUT' ? gate.then(() => { throw new Error('network down'); }) : null) });
  await go(window, `workspaces/${ID}/map`);
  const btn = mapSec(doc).querySelector(`.wm-confirm[data-edge="${X_HTTP}"]`);
  btn.focus();
  click(window, btn);
  await settle(2);
  dropFocus(doc);
  release();
  await settle();
  assert.equal(doc.querySelector('#ws-detail .pd-error').textContent, 'network down');
  assert.equal(btn.isConnected, true, 'a failed press repaints nothing');
  assert.equal(btn.disabled, false);
  assert.equal(doc.activeElement, btn, 'the keyboard is back on Confirm');
});

test('Add edge and Regenerate give the keyboard back after the answer, even after the browser dropped it', async () => {
  const gates = [];
  const hold = () => new Promise((r) => { gates.push(r); });
  const { window, doc } = await boot({
    payload: payloadOf({ origin: 'edited' }),
    route: (u, opts, s) => {
      if (u === `/api/workspaces/${ID}/map/edges` && opts.method === 'POST') {
        const edge = { id: M_NEW, ...JSON.parse(opts.body), createdAt: '2026-09-25T12:00:00.000Z' };
        return hold().then(() => { s.payload = payloadOf({ manual: [edge], origin: 'edited' }); return ok({ edge }, 201); });
      }
      if (u === `/api/workspaces/${ID}/map/render` && opts.method === 'POST') {
        return hold().then(() => { s.payload = payloadOf({ manual: s.payload.overrides.manual, origin: 'generated' }); return ok({ workspace: WS[0] }); });
      }
      return null;
    },
  });
  await go(window, `workspaces/${ID}/map`);
  const form = () => mapSec(doc).querySelector('.wm-add-form');
  form().querySelector('[name="wm-from"]').value = 'web';
  form().querySelector('[name="wm-to"]').value = 'shared-lib';
  form().querySelector('[name="wm-kind"]').value = 'other';
  form().querySelector('[name="wm-display"]').value = 'S3 bucket';
  const add = form().querySelector('.wm-add');
  add.focus();
  click(window, add);
  await settle(2);
  dropFocus(doc);
  gates.shift()();
  await settle();
  assert.ok(rows(doc).includes(`${M_NEW}:manual`));
  assert.equal(add.isConnected, false, 'the tab was repainted');
  assert.equal(doc.activeElement, mapSec(doc).querySelector('.wm-add'), 'Add edge has the keyboard again, ready for the next edge');
  const regen = mapSec(doc).querySelector('.wm-regen');
  regen.focus();
  click(window, regen);
  await settle(2);
  dropFocus(doc);
  gates.shift()();
  await settle();
  assert.equal(mapSec(doc).querySelector('.wm-regen'), null, 'Regenerate is gone');
  assert.equal(doc.activeElement, mapSec(doc), 'so the keyboard lands on the tab panel');
});

test('an override on an edge that is gone (404) shows the error and reloads the tab', async () => {
  const { window, doc, server } = await boot({
    route: (u, opts, s) => {
      if (opts.method !== 'PUT') return null;
      s.payload = payloadOf({ map: { ...MAP, edges: [MAP.edges[1]] } });   // another window's re-scan dropped it
      return ok({ error: `edge not found: ${X_HTTP}` }, 404);
    },
  });
  await go(window, `workspaces/${ID}/map`);
  click(window, mapSec(doc).querySelector(`.wm-confirm[data-edge="${X_HTTP}"]`));
  await settle();
  assert.equal(doc.querySelector('#ws-detail .pd-error').textContent, `edge not found: ${X_HTTP}`);
  assert.equal(gets(server), 2, 'the stale table reloads');
  assert.deepEqual(rows(doc), [`${X_PKG}:auto`]);
});

test('add a manual edge: POST the form, clear it, show the manual row; Delete sends DELETE; a same-project edge never posts', async () => {
  const { window, doc, server } = await boot({
    route: (u, opts, s) => {
      if (u === `/api/workspaces/${ID}/map/edges` && opts.method === 'POST') {
        const b = JSON.parse(opts.body);
        const edge = { id: M_NEW, ...b, createdAt: '2026-09-25T12:00:00.000Z' };
        s.payload = payloadOf({ manual: [edge] });
        return ok({ edge }, 201);
      }
      if (u === `/api/workspaces/${ID}/map/edges/${M_NEW}` && opts.method === 'DELETE') { s.payload = payloadOf(); return ok({ ok: true }); }
      return null;
    },
  });
  await go(window, `workspaces/${ID}/map`);
  const form = () => mapSec(doc).querySelector('.wm-add-form');
  form().querySelector('[name="wm-from"]').value = 'web';
  form().querySelector('[name="wm-to"]').value = 'web';
  form().querySelector('[name="wm-display"]').value = 'S3 bucket';
  click(window, form().querySelector('.wm-add'));
  await settle();
  assert.equal(server.calls.filter((c) => c.startsWith('POST ')).length, 0, 'from = to never posts');
  const msg = mapSec(doc).querySelector('.wm-add-msg');
  assert.equal(msg.hidden, false);
  assert.equal(msg.textContent, 'Pick two different projects');
  form().querySelector('[name="wm-to"]').value = 'shared-lib';
  form().querySelector('[name="wm-kind"]').value = 'other';
  form().querySelector('[name="wm-detail"]').value = 'uploads';
  click(window, form().querySelector('.wm-add'));
  await settle();
  assert.ok(server.calls.includes(`POST /api/workspaces/${ID}/map/edges {"from":"web","to":"shared-lib","kind":"other","display":"S3 bucket","detail":"uploads"}`));
  assert.deepEqual(rows(doc), [`${X_PKG}:auto`, `${X_HTTP}:auto`, `${M_NEW}:manual`]);
  assert.equal(form().querySelector('[name="wm-display"]').value, '', 'the form is cleared after a save');
  assert.equal(form().querySelector('[name="wm-from"]').value, 'web', 'the member picks stay');
  click(window, mapSec(doc).querySelector(`.wm-del[data-edge="${M_NEW}"]`));
  await settle();
  assert.ok(server.calls.includes(`DELETE /api/workspaces/${ID}/map/edges/${M_NEW}`));
  assert.deepEqual(rows(doc), [`${X_PKG}:auto`, `${X_HTTP}:auto`]);
});

test('a frame that repaints the tab while an add is in flight: the saved form is still cleared', async () => {
  let release; const gate = new Promise((r) => { release = r; });
  const { window, doc, ws } = await boot({
    route: (u, opts, s) => {
      if (u !== `/api/workspaces/${ID}/map/edges` || opts.method !== 'POST') return null;
      const edge = { id: M_NEW, ...JSON.parse(opts.body), createdAt: '2026-09-25T12:00:00.000Z' };
      return gate.then(() => { s.payload = payloadOf({ manual: [edge] }); return ok({ edge }, 201); });
    },
  });
  await go(window, `workspaces/${ID}/map`);
  const form = () => mapSec(doc).querySelector('.wm-add-form');
  form().querySelector('[name="wm-from"]').value = 'web';
  form().querySelector('[name="wm-to"]').value = 'shared-lib';
  form().querySelector('[name="wm-kind"]').value = 'other';
  form().querySelector('[name="wm-display"]').value = 'S3 bucket';
  click(window, form().querySelector('.wm-add'));
  await settle(2);
  ws().deliver({ type: 'workspaces-changed', action: 'map' });   // another tab's change repaints the form mid-request
  await settle();
  assert.equal(form().querySelector('[name="wm-display"]').value, 'S3 bucket', 'the draft survived that repaint');
  release();
  await settle();
  assert.equal(form().querySelector('[name="wm-display"]').value, '', 'the live form is cleared after the save');
  assert.ok(rows(doc).includes(`${M_NEW}:manual`));
});

test('a refused add that answers after a frame repainted the tab shows its error in the live form', async () => {
  let release; const gate = new Promise((r) => { release = r; });
  const { window, doc, ws } = await boot({
    route: (u, opts) => (u === `/api/workspaces/${ID}/map/edges` && opts.method === 'POST' ? gate.then(() => ok({ error: 'display is at most 200 characters' }, 400)) : null),
  });
  await go(window, `workspaces/${ID}/map`);
  const form = () => mapSec(doc).querySelector('.wm-add-form');
  form().querySelector('[name="wm-from"]').value = 'web';
  form().querySelector('[name="wm-to"]').value = 'shared-lib';
  form().querySelector('[name="wm-display"]').value = 'S3 bucket';
  click(window, form().querySelector('.wm-add'));
  await settle(2);
  ws().deliver({ type: 'workspaces-changed', action: 'map' });           // repaints the form while the POST runs
  await settle();
  release();
  await settle();
  const msg = mapSec(doc).querySelector('.wm-add-msg');
  assert.equal(msg.hidden, false, 'the refusal shows in the form on screen');
  assert.equal(msg.textContent, 'display is at most 200 characters');
});

test('Regenerate: offered after a description save, POSTs /map/render, then gone', async () => {
  const { window, doc, server } = await boot({
    route: (u, opts, s) => {
      if (u === `/api/workspaces/${ID}` && opts.method === 'PATCH') {
        s.payload = payloadOf({ origin: 'edited' });
        s.workspaces = [{ ...WS[0], description: JSON.parse(opts.body).description, descriptionOrigin: 'edited' }];
        return ok({ workspace: s.workspaces[0] });
      }
      if (u === `/api/workspaces/${ID}/map/render` && opts.method === 'POST') {
        s.payload = payloadOf({ origin: 'generated' });
        s.workspaces = [{ ...WS[0], description: '# Workspace: Shop\nRE-RENDERED', descriptionOrigin: 'generated' }];
        return ok({ workspace: s.workspaces[0] });
      }
      return null;
    },
  });
  await go(window, `workspaces/${ID}/map`);
  assert.equal(mapSec(doc).querySelector('.wm-regen'), null);
  await go(window, `workspaces/${ID}`);
  click(window, doc.querySelector('#ws-detail .ws-edit'));
  doc.querySelector('#ws-detail .ws-desc-input').value = 'hand edit';
  click(window, doc.querySelector('#ws-detail .ws-desc-save'));
  await settle();
  assert.equal(gets(server), 2, 'a description save reloads the built Map tab');
  await go(window, `workspaces/${ID}/map`);
  const regen = mapSec(doc).querySelector('.wm-regen');
  assert.ok(regen, 'edited → Regenerate');
  click(window, regen);
  await settle();
  assert.ok(server.calls.includes(`POST /api/workspaces/${ID}/map/render {}`));
  assert.equal(mapSec(doc).querySelector('.wm-regen'), null);
  assert.match(doc.querySelector('#ws-detail .ws-desc-view').textContent, /RE-RENDERED/, 'the Overview shows the re-rendered description');
});

test('Re-scan from the empty Map tab starts one scan run per press', async () => {
  const { window, doc, server } = await boot({
    payload: payloadOf({ map: null }),
    route: (u, opts) => {
      if (u === '/api/workspaces/metrics-scan') return ok({ members: [] });
      if (u === `/api/workspaces/${ID}/scan` && opts.method === 'POST') return ok({ runId: 'run-rescan', workspaceId: ID, title: 'Workspace scan: Shop', projectDir: '/s/web', projectNames: ['a'] });
      return null;
    },
  });
  await go(window, `workspaces/${ID}/map`);
  assert.equal(mapSec(doc).querySelector('.wm-empty b').textContent, 'No map yet');
  const rescan = mapSec(doc).querySelector('.wm-rescan');
  click(window, rescan);
  click(window, rescan);
  await settle();
  assert.equal(server.calls.filter((c) => c === `POST /api/workspaces/${ID}/scan {}`).length, 1, 'one scan per press');
  assert.equal(doc.querySelector('.view[data-view="running"]').classList.contains('hidden'), false, 'on Running');
});
