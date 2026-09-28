// test/wsmap-map-tab-dblclick.test.mjs — a double-click on a Map-tab action sends ONE request.
// The first click's answer (and the workspaces-changed{map} frame the server emits BEFORE it answers)
// repaints the tab within tens of milliseconds, so the second click of a double-click lands on a
// fresh, enabled button in the same place — a different verdict (Confirm -> Reject), another row's
// Delete or verdict (a cleared stale review's row is gone, the next row slides up), the Add edge
// button of a cleared form, or a Regenerate that failed. The second click of a mouse double-click
// (detail 2) is ignored on every action; keyboard presses (detail 0) are separate intents and keep
// working, and a second Enter never sends the opposite verdict.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import { edgeId, manualEdgeId } from '../src/shared/workspace-map/ids.mjs';
import { effectiveEdges, setEdgeState } from '../src/shared/workspace-map/overrides.mjs';

const htmlPath = fileURLToPath(new URL('../ui/public/index.html', import.meta.url));
const appPath = fileURLToPath(new URL('../ui/public/app.js', import.meta.url));

const ID = 'wks-shop-00000001';
const AT = '2026-09-25T11:00:00.000Z';
const X_HTTP = edgeId('web', 'billing-api', 'http', 'http:GET /invoices/{}');
const X_PKG = edgeId('billing-api', 'shared-lib', 'pkg', 'pkg:npm:shared-lib');
const X_WL = edgeId('web', 'shared-lib', 'pkg', 'pkg:npm:shared-lib');
// A rejected review whose edge the last scan no longer found (a stale review): it sorts right above X_HTTP.
const X_GONE = edgeId('web', 'billing-api', 'http', 'http:GET /invoices');
const M_A = manualEdgeId('web', 'shared-lib', 'other', 'bucket A', '2026-09-25T12:00:00.000Z');
const M_B = manualEdgeId('web', 'shared-lib', 'other', 'bucket B', '2026-09-25T12:00:01.000Z');
const M_NEW = manualEdgeId('web', 'shared-lib', 'other', 'S3 bucket', '2026-09-25T12:00:02.000Z');
const WS = [{ id: ID, name: 'Shop', description: '# Workspace: Shop\n## Overview\nthree svcs', projectPaths: ['/s/billing-api', '/s/shared-lib', '/s/web'],
  projectKeys: ['billing-api', 'shared-lib', 'web'], exists: [true, true, true], createdAt: '2026-09-01T10:00:00.000Z', updatedAt: '2026-09-25T10:00:00.000Z',
  descriptionOrigin: 'generated', mapSummary: { scannedAt: '2026-09-25T10:00:00.000Z', members: 3, edges: 3, gaps: 0, confirmed: 0, rejected: 0, manual: 0, missing: 0, byKind: { http: 1, pkg: 2 } } }];
const cov = (level) => ({ level, files: 3, scannedFiles: 3, truncated: false, factsStatic: 3, factsLlm: 0, unresolved: 0, rejected: 0, surveyed: 'skipped', usageStatus: 'investigated', graph: null });
const MAP = {
  version: 1, workspace: { name: 'Shop' }, scannedAt: '2026-09-25T10:00:00.000Z', runId: 'run-1',
  members: ['billing-api', 'shared-lib', 'web'].map((key) => ({ key, name: key, role: null, roleSource: null, aliases: [], stack: ['node'], coverage: cov('rich') })),
  edges: [
    { id: X_HTTP, from: 'web', to: 'billing-api', kind: 'http', norm: 'http:GET /invoices/{}', display: 'GET /invoices/{id}', label: null, detail: '', confidence: 'exact', sources: ['static'],
      evidence: { from: [{ file: 'src/api.ts', line: 12, match: "fetch('/invoices/'" }], to: [{ file: 'src/routes.ts', line: 4, match: "router.get('/invoices/:id'" }] } },
    { id: X_PKG, from: 'billing-api', to: 'shared-lib', kind: 'pkg', norm: 'pkg:npm:shared-lib', display: 'shared-lib', label: null, detail: '', confidence: 'exact', sources: ['static'],
      evidence: { from: [{ file: 'package.json', line: 7, match: '"shared-lib"' }], to: [] } },
    { id: X_WL, from: 'web', to: 'shared-lib', kind: 'pkg', norm: 'pkg:npm:shared-lib', display: 'shared-lib', label: null, detail: '', confidence: 'heuristic', sources: ['static'],
      evidence: { from: [{ file: 'package.json', line: 9, match: '"shared-lib"' }], to: [] } },
  ],
  order: [['shared-lib'], ['billing-api'], ['web']], cycles: [], graph: { mode: 'none', file: null, nodes: 0, bridges: 0 }, stats: {}, errors: [],
};
// The GET /map payload P5 serves: the stored overrides doc, and effectiveEdges over it.
const withOverrides = (overrides, origin = 'generated') => ({ map: MAP, synthesis: null, descriptionOrigin: origin, overrides, edges: effectiveEdges(MAP, overrides) });
/** A payload from the states of scanned edges, stale reviews (rejections of edges the map no longer has) and manual edges. */
const payloadOf = ({ states = {}, stale = [], manual = [], origin = 'generated' } = {}) => {
  const edges = {};
  for (const e of MAP.edges) if (states[e.id]) edges[e.id] = { state: states[e.id], from: e.from, to: e.to, kind: e.kind, display: e.display, at: AT };
  for (const x of stale) edges[x.id] = { state: 'rejected', from: x.from, to: x.to, kind: x.kind, display: x.display, at: AT };
  return withOverrides({ version: 1, edges, manual }, origin);
};
const man = (id, display) => ({ id, from: 'web', to: 'shared-lib', kind: 'other', display, detail: '', createdAt: AT });

class WSStub {
  constructor() { this.readyState = 1; this._listeners = {}; WSStub.last = this; }
  send() {} close() {}
  addEventListener(type, fn) { (this._listeners[type] = this._listeners[type] || []).push(fn); }
  deliver(obj) { (this._listeners.message || []).forEach((fn) => fn({ data: JSON.stringify(obj) })); }
}
const ok = (body, status = 200) => Promise.resolve({ ok: status < 400, status, json: async () => body });

/** P5's order for every mutation: the handler emits workspaces-changed{map} BEFORE it answers. */
function answer(s, next, body, status = 200) {
  s.payload = next;
  WSStub.last.deliver({ type: 'workspaces-changed', action: 'map' });
  return ok(body, status);
}
/** The override routes as P5 serves them: PUT sets or clears a state, DELETE removes a manual edge
 *  (404 when it is gone), POST /edges adds one; POST /render fails (500) when `renderFails`. */
function serverRoute(u, opts, s, { renderFails = false, addFails = false } = {}) {
  const ov = s.payload.overrides;
  const origin = s.payload.descriptionOrigin;
  if (u === `/api/workspaces/${ID}/map/render` && opts.method === 'POST') {
    return renderFails ? ok({ error: 'database is locked' }, 500) : answer(s, withOverrides(ov, 'generated'), { workspace: WS[0] });
  }
  if (u === `/api/workspaces/${ID}/map/edges` && opts.method === 'POST') {
    if (addFails) return ok({ error: 'the edge could not be saved' }, 500);
    const edge = { id: M_NEW, ...JSON.parse(opts.body), createdAt: AT };
    return answer(s, withOverrides({ ...ov, manual: [...ov.manual, edge] }, origin), { edge }, 201);
  }
  const m = u.match(/\/map\/edges\/([^/]+)$/);
  if (!m) return null;
  const id = decodeURIComponent(m[1]);
  if (opts.method === 'PUT') {
    // P5's setWorkspaceEdgeState: the effective edge, else the stored review of an edge the map no longer has.
    const target = effectiveEdges(MAP, ov).find((e) => e.id === id) || (ov.edges[id] ? { id, ...ov.edges[id] } : null);
    if (!target) return ok({ error: 'edge not found' }, 404);
    return answer(s, withOverrides(setEdgeState(ov, target, JSON.parse(opts.body).state, AT), origin), { ok: true });
  }
  if (opts.method === 'DELETE') {
    if (!ov.manual.some((x) => x.id === id)) return ok({ error: 'edge not found' }, 404);
    return answer(s, withOverrides({ ...ov, manual: ov.manual.filter((x) => x.id !== id) }, origin), { ok: true });
  }
  return null;
}

async function boot({ payload, routeOpts = {} }) {
  const server = { payload, calls: [] };
  const dom = new JSDOM(readFileSync(htmlPath, 'utf8'), { url: 'http://localhost:4317/' });
  const { window } = dom;
  window.Element.prototype.scrollIntoView = function () {};
  window.WebSocket = WSStub;
  window.requestAnimationFrame = (fn) => setTimeout(fn, 0);
  window.fetch = (url, opts = {}) => {
    const u = String(url);
    const method = opts.method || 'GET';
    if (u.includes('/api/workspaces')) server.calls.push(`${method} ${u}${opts.body ? ` ${opts.body}` : ''}`);
    const r = serverRoute(u, opts, server, routeOpts);
    if (r) return r;
    if (u === `/api/workspaces/${ID}/map` && method === 'GET') return ok(server.payload);
    if (u.endsWith('/api/workspaces') || u.includes('/api/workspaces?')) return ok({ workspaces: [{ ...WS[0], descriptionOrigin: server.payload.descriptionOrigin }] });
    if (u.includes('/api/projects')) return ok({ projects: [] });
    return ok({ config: { steps: {}, customModels: [] }, models: [], efforts: [] });
  };
  for (const k of ['window', 'document', 'location', 'localStorage', 'WebSocket', 'fetch', 'navigator', 'requestAnimationFrame']) {
    try { Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true }); } catch {}
  }
  globalThis.window = window; globalThis.document = window.document;
  await import(pathToFileURL(appPath).href + `?b=${Date.now()}_${Math.random()}`);
  await new Promise((r) => setTimeout(r, 0));
  window.location.hash = `workspaces/${ID}/map`;
  await settle();
  return { window, doc: window.document, server };
}
const tick = () => new Promise((r) => setTimeout(r, 0));
const settle = async (n = 8) => { for (let i = 0; i < n; i++) await tick(); };
const mapSec = (doc) => doc.querySelector('#ws-detail .pd-sec[data-sec="map"]');
const rows = (doc) => [...mapSec(doc).querySelectorAll('.wm-row')].map((r) => `${r.dataset.edge}:${r.querySelector('.wm-state').textContent}`);
/** A mouse click; `detail` = the click count a browser reports (2 = the second click of a double-click, 0 = a keyboard press). */
const clickN = (window, node, detail) => node.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true, detail }));
/** Every mutation sent: "PUT <edge> <body>", "DELETE <edge>", "POST /edges <body>", "POST /render <body>". */
const mutations = (server) => server.calls.filter((c) => /^(PUT|DELETE|POST) /.test(c))
  .map((c) => c.replace(`/api/workspaces/${ID}/map`, '').replace(/^(PUT|DELETE) \/edges\//, '$1 '));
/** "The same place on screen" in jsdom: the same row index and action index (a row action), or the same single button. */
const slot = (doc, sel) => (typeof sel === 'function' ? sel(doc) : mapSec(doc).querySelector(sel));
const rowAction = (rowIdx, actIdx) => (doc) => mapSec(doc).querySelectorAll('.wm-row')[rowIdx].querySelectorAll('.wm-actions button')[actIdx];
/** Click, let the answer and the frame repaint the tab, click whatever now sits in the same place (detail 2). */
async function doubleClick(window, doc, sel) {
  clickN(window, slot(doc, sel), 1);
  await settle();
  const second = slot(doc, sel);
  assert.ok(second, 'something sits in that place for the second click');
  clickN(window, second, 2);
  await settle();
}
const rowIndex = (doc, id) => rows(doc).findIndex((r) => r.startsWith(`${id}:`));

test('double-click Confirm on an auto edge: one PUT confirmed (the Reject that replaced it is never pressed)', async () => {
  const { window, doc, server } = await boot({ payload: payloadOf() });
  await doubleClick(window, doc, rowAction(rowIndex(doc, X_HTTP), 0));
  assert.deepEqual(mutations(server), [`PUT ${X_HTTP} {"state":"confirmed"}`]);
  assert.ok(rows(doc).includes(`${X_HTTP}:confirmed`));
});

test('double-click Reject on an auto edge: one PUT rejected (the Clear that replaced it is never pressed)', async () => {
  const { window, doc, server } = await boot({ payload: payloadOf() });
  await doubleClick(window, doc, rowAction(rowIndex(doc, X_HTTP), 1));
  assert.deepEqual(mutations(server), [`PUT ${X_HTTP} {"state":"rejected"}`]);
  assert.ok(rows(doc).includes(`${X_HTTP}:rejected`));
});

test('double-click Clear on a confirmed edge: one PUT null (the Reject that replaced it is never pressed)', async () => {
  const { window, doc, server } = await boot({ payload: payloadOf({ states: { [X_HTTP]: 'confirmed' } }) });
  await doubleClick(window, doc, rowAction(rowIndex(doc, X_HTTP), 1));
  assert.deepEqual(mutations(server), [`PUT ${X_HTTP} {"state":null}`]);
  assert.ok(rows(doc).includes(`${X_HTTP}:auto`));
});

test('double-click Delete on the first of two manual edges: one DELETE, the second manual edge stays', async () => {
  const { window, doc, server } = await boot({ payload: payloadOf({ manual: [man(M_A, 'bucket A'), man(M_B, 'bucket B')] }) });
  await doubleClick(window, doc, rowAction(rowIndex(doc, M_A), 0));
  assert.deepEqual(mutations(server), [`DELETE ${M_A}`]);
  assert.ok(rows(doc).includes(`${M_B}:manual`));
});

test('double-click Delete on a manual edge beside a confirmed edge: one DELETE, the confirmed edge is never rejected', async () => {
  const { window, doc, server } = await boot({ payload: payloadOf({ states: { [X_WL]: 'confirmed' }, manual: [man(M_A, 'bucket A')] }) });
  const at = rowIndex(doc, M_A);
  assert.equal(rows(doc)[at + 1], `${X_WL}:confirmed`, 'precondition: the confirmed edge is the next row');
  await doubleClick(window, doc, rowAction(at, 0));
  assert.deepEqual(mutations(server), [`DELETE ${M_A}`]);
  assert.ok(rows(doc).includes(`${X_WL}:confirmed`));
});

test('double-click Clear on a stale review (M14b): one PUT null for its old id, never a mutation on the row that slides into its place', async () => {
  const stale = { id: X_GONE, from: 'web', to: 'billing-api', kind: 'http', display: 'GET /invoices' };
  const { window, doc, server } = await boot({ payload: payloadOf({ states: { [X_HTTP]: 'confirmed' }, stale: [stale] }) });
  const at = rowIndex(doc, X_GONE);
  assert.deepEqual(rows(doc).slice(at, at + 2), [`${X_GONE}:stale`, `${X_HTTP}:confirmed`], 'precondition: the stale review, then a confirmed edge');
  assert.deepEqual([...mapSec(doc).querySelectorAll('.wm-row')[at].querySelectorAll('.wm-actions button')].map((b) => b.textContent), ['Clear']);
  await doubleClick(window, doc, rowAction(at, 0));
  assert.deepEqual(mutations(server), [`PUT ${X_GONE} {"state":null}`]);
  assert.ok(!rows(doc).some((r) => r.startsWith(`${X_GONE}:`)), 'the stale review is cleared');
  assert.ok(rows(doc).includes(`${X_HTTP}:confirmed`), 'the edge that slid up keeps its verdict');
});

test('double-click Add edge: one POST and no error on the cleared form', async () => {
  const { window, doc, server } = await boot({ payload: payloadOf() });
  const form = () => mapSec(doc).querySelector('.wm-add-form');
  form().querySelector('[name="wm-from"]').value = 'web';
  form().querySelector('[name="wm-to"]').value = 'shared-lib';
  form().querySelector('[name="wm-kind"]').value = 'other';
  form().querySelector('[name="wm-display"]').value = 'S3 bucket';
  await doubleClick(window, doc, '.wm-add');
  assert.deepEqual(mutations(server), ['POST /edges {"from":"web","to":"shared-lib","kind":"other","display":"S3 bucket","detail":""}']);
  assert.ok(rows(doc).includes(`${M_NEW}:manual`));
  assert.equal(mapSec(doc).querySelector('.wm-add-msg').hidden, true, 'the second click never reaches the cleared form');
});

test('double-click Add edge that the server refuses: one POST, not a retry', async () => {
  const { window, doc, server } = await boot({ payload: payloadOf(), routeOpts: { addFails: true } });
  const form = () => mapSec(doc).querySelector('.wm-add-form');
  form().querySelector('[name="wm-from"]').value = 'web';
  form().querySelector('[name="wm-to"]').value = 'shared-lib';
  form().querySelector('[name="wm-kind"]').value = 'other';
  form().querySelector('[name="wm-display"]').value = 'S3 bucket';
  await doubleClick(window, doc, '.wm-add');
  assert.equal(mutations(server).length, 1, JSON.stringify(mutations(server)));
});

test('double-click Regenerate description that fails: one POST /render, not a retry', async () => {
  const { window, doc, server } = await boot({ payload: payloadOf({ origin: 'edited' }), routeOpts: { renderFails: true } });
  await doubleClick(window, doc, '.wm-regen');
  assert.deepEqual(mutations(server), ['POST /render {}']);
});

test('keyboard: Enter twice on Confirm (detail 0) sends two presses, and the second is never the opposite verdict', async () => {
  const { window, doc, server } = await boot({ payload: payloadOf() });
  const b = mapSec(doc).querySelector(`.wm-confirm[data-edge="${X_HTTP}"]`);
  b.focus();
  clickN(window, b, 0);
  await settle();
  clickN(window, doc.activeElement, 0);   // the keyboard stays on the row: Clear, never Reject
  await settle();
  assert.deepEqual(mutations(server), [`PUT ${X_HTTP} {"state":"confirmed"}`, `PUT ${X_HTTP} {"state":null}`]);
});

test('double-click the pair chip: the pair filter goes and the kind filter stays (Clear filters slides into its slot)', async () => {
  const { window, doc } = await boot({ payload: payloadOf() });
  const kind = mapSec(doc).querySelector('select.wm-filter[data-filter="kind"]');
  kind.value = 'pkg';
  kind.dispatchEvent(new window.Event('change', { bubbles: true }));
  await settle();
  clickN(window, mapSec(doc).querySelector('.wm-pair[data-from="web"][data-to="shared-lib"]'), 1);
  await settle();
  const bar = () => [...mapSec(doc).querySelector('.wm-filters').children];
  const at = bar().findIndex((n) => n.classList.contains('wm-pair-chip'));
  assert.ok(at >= 0, 'precondition: the pair chip is in the filter bar');
  await doubleClick(window, doc, (d) => [...mapSec(d).querySelector('.wm-filters').children][at]);
  assert.equal(mapSec(doc).querySelector('.wm-pair-chip'), null, 'the first click removed the pair filter');
  assert.equal(mapSec(doc).querySelector('select.wm-filter[data-filter="kind"]').value, 'pkg', 'the second click never clears the other filters');
});

test('double-click a coverage chip: the member filter it sets stays (the repainted chip is never toggled off)', async () => {
  const { window, doc } = await boot({ payload: payloadOf() });
  const chip = '.wm-coverage .wm-chip[data-value="web"]';
  await doubleClick(window, doc, chip);
  assert.equal(mapSec(doc).querySelector(chip).getAttribute('aria-pressed'), 'true');
});

test('double-click a pair in the graph: the pair filter it sets stays (the repainted pair is never toggled off)', async () => {
  const { window, doc } = await boot({ payload: payloadOf() });
  await doubleClick(window, doc, '.wm-graph .wm-pair[data-from="web"][data-to="shared-lib"]');
  assert.ok(mapSec(doc).querySelector('.wm-pair-chip'), 'the pair filter is set');
});
