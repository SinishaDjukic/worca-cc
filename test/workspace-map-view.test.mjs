// test/workspace-map-view.test.mjs — the Map tab renderer (spec D17, §5.7, §5.9): the edge table
// (rejected greyed, missing named, actions per state, at most ROW_MAX rows painted), filters, and
// no markup ever parsed from repo- or agent-authored strings. Edge ids are real (x_ / m_ + 12 hex): P1's
// checkOverrides drops any other id.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { renderMapTab, filterEdges, emptyMapFilters } from '../ui/public/workspace-map-view.mjs';
import { KINDS } from '../src/shared/workspace-map/schema.mjs';
import { edgeId, manualEdgeId } from '../src/shared/workspace-map/ids.mjs';

const doc = new JSDOM('<!doctype html><body></body>').window.document;

const AT = '2026-09-25T11:00:00.000Z';
const X_HTTP = edgeId('web', 'billing-api', 'http', 'http:GET /invoices/{}');
const X_PKG_WEB = edgeId('web', 'shared-lib', 'pkg', 'pkg:npm:shared-lib');
const X_PKG_BILL = edgeId('billing-api', 'shared-lib', 'pkg', 'pkg:npm:shared-lib');
const X_GONE = edgeId('web', 'billing-api', 'topic', 'topic:invoice.created');   // confirmed, then lost by a re-scan
const M_DB = manualEdgeId('billing-api', 'shared-lib', 'db', 'invoices table', AT);
const cov = (level, usageStatus = 'investigated', graph = null) => ({ level, files: 10, scannedFiles: 10, truncated: false, factsStatic: 4, factsLlm: 0, unresolved: 0, rejected: 0, surveyed: 'skipped', usageStatus, graph });
const MAP = {
  version: 1, workspace: { name: 'Shop' }, scannedAt: '2026-09-25T10:00:00.000Z', runId: 'run-1',
  members: [
    { key: 'billing-api', name: 'billing-api', role: 'Invoices', roleSource: 'static', aliases: ['billing'], stack: ['node'], coverage: cov('rich', 'investigated', { nodes: 120, bytes: 48000, fresh: true, used: true }) },
    { key: 'shared-lib', name: 'shared-lib', role: null, roleSource: null, aliases: [], stack: ['node'], coverage: cov('partial', 'investigated', { nodes: 40, bytes: 9000, fresh: false, used: false }) },
    { key: 'web', name: 'web', role: 'Storefront', roleSource: 'survey', aliases: [], stack: [], coverage: { ...cov('none', 'failed'), surveyed: 'failed' } },
  ],
  edges: [
    { id: X_HTTP, from: 'web', to: 'billing-api', kind: 'http', norm: 'http:GET /invoices/{}', display: 'GET /invoices/{id}', label: null, detail: 'fetch in the invoice page',
      confidence: 'exact', sources: ['static'],
      evidence: { from: [{ file: 'src/api.ts', line: 12, match: "fetch('/invoices/'" }], to: [{ file: 'src/routes.ts', line: 4, match: "router.get('/invoices/:id'" }] },
      context: { from: { symbol: 'loadInvoice()', callers: ['InvoicePage.mount()'] }, to: { symbol: 'getInvoice()' } } },
    { id: X_PKG_WEB, from: 'web', to: 'shared-lib', kind: 'pkg', norm: 'pkg:npm:shared-lib', display: 'shared-lib', label: null, detail: '', confidence: 'exact', sources: ['static'],
      evidence: { from: [{ file: 'package.json', line: 9, match: '"shared-lib"' }], to: [{ file: 'package.json', line: 2, match: '"name": "shared-lib"' }] } },
    { id: X_PKG_BILL, from: 'billing-api', to: 'shared-lib', kind: 'pkg', norm: 'pkg:npm:shared-lib', display: 'shared-lib', label: null, detail: '', confidence: 'heuristic', sources: ['candidate'],
      evidence: { from: [{ file: 'package.json', line: 7, match: '"shared-lib"' }], to: [] } },
  ],
  order: [['shared-lib'], ['billing-api'], ['web']], cycles: [],
  graph: { mode: 'none', file: null, nodes: 0, bridges: 0 }, stats: { edges: 3, byKind: {}, byConfidence: {}, candidates: 0, candidatesConfirmed: 0, factsRejected: 0 }, errors: [],
};
const OVERRIDES = {
  version: 1,
  edges: {
    [X_PKG_WEB]: { state: 'rejected', from: 'web', to: 'shared-lib', kind: 'pkg', display: 'shared-lib', at: AT },
    [X_PKG_BILL]: { state: 'confirmed', from: 'billing-api', to: 'shared-lib', kind: 'pkg', display: 'shared-lib', at: AT },
    [X_GONE]: { state: 'confirmed', from: 'web', to: 'billing-api', kind: 'topic', display: 'invoice.created', at: AT },
  },
  manual: [{ id: M_DB, from: 'billing-api', to: 'shared-lib', kind: 'db', display: 'invoices table', detail: 'shared schema', createdAt: AT }],
};
// effectiveEdges(MAP, OVERRIDES) as GET /map sends it, sorted by from, to, kind, display (P1): the
// missing edge is P1's synthetic one ('verified', no evidence). The manual edge keeps P1 v1's
// 'verified' stamp ON PURPOSE (P1 v2 sends null): the UI must show no confidence for it either way.
const EDGES = [
  { ...OVERRIDES.manual[0], norm: null, label: null, confidence: 'verified', sources: ['manual'], evidence: { from: [], to: [] }, state: 'manual' },
  { ...MAP.edges[2], state: 'confirmed' },
  { ...MAP.edges[0], state: 'auto' },
  { id: X_GONE, from: 'web', to: 'billing-api', kind: 'topic', norm: null, display: 'invoice.created', label: null, detail: '', confidence: 'verified', sources: ['override'], evidence: { from: [], to: [] }, at: AT, state: 'missing' },
  { ...MAP.edges[1], state: 'rejected' },
];
const payload = (over = {}) => ({ map: MAP, synthesis: null, overrides: OVERRIDES, edges: EDGES, descriptionOrigin: 'generated', workspace: { id: 'wks-shop-00000001', name: 'Shop' }, ...over });
const rowOf = (root, id) => root.querySelector(`.wm-row[data-edge="${id}"]`);
const texts = (nodes) => [...nodes].map((n) => n.textContent);

test('edge table: every effective edge, rejected greyed, a missing confirmed edge named missing, actions per state', () => {
  const root = renderMapTab(payload(), { doc });
  const table = root.querySelector('table.wm-table');
  assert.deepEqual(texts(table.querySelectorAll('thead th')), ['From', 'To', 'Kind', 'Edge', 'Confidence', 'State', 'Evidence', 'Actions']);
  for (const th of table.querySelectorAll('thead th')) assert.equal(th.getAttribute('scope'), 'col');
  assert.deepEqual([...table.querySelectorAll('tbody .wm-row')].map((r) => r.dataset.edge), [M_DB, X_PKG_BILL, X_HTTP, X_GONE, X_PKG_WEB]);
  const rejected = rowOf(root, X_PKG_WEB);
  assert.ok(rejected.classList.contains('is-rejected'), 'rejected stays in the table, greyed');
  assert.equal(rejected.querySelector('.wm-state').textContent, 'rejected');
  assert.deepEqual(texts(rejected.querySelectorAll('.wm-actions button')), ['Confirm', 'Clear']);
  const missing = rowOf(root, X_GONE);
  assert.ok(missing.classList.contains('is-missing'));
  assert.equal(missing.querySelector('.wm-state').textContent, 'missing');
  assert.equal(missing.querySelector('.wm-disp .mono').textContent, 'invoice.created');
  assert.equal(missing.querySelector('.wm-conf').textContent, 'verified', 'a missing edge keeps P1\'s verified');
  assert.deepEqual(texts(missing.querySelectorAll('.wm-actions button')), ['Clear']);
  assert.ok(missing.querySelector(`.wm-clear[data-edge="${X_GONE}"]`));
  const auto = rowOf(root, X_HTTP);
  assert.deepEqual([...auto.querySelectorAll('.wm-actions button')].map((b) => b.className), ['btn btn-sm wm-confirm', 'btn btn-sm wm-reject']);
  assert.equal(auto.querySelector('.wm-confirm').getAttribute('aria-label'), 'Confirm web → billing-api GET /invoices/{id}');
  assert.equal(auto.querySelector('.wm-kind').textContent, 'REST API');
  assert.equal(auto.querySelector('.wm-conf').textContent, 'exact');
  assert.ok(auto.querySelector('.wm-conf').classList.contains('green'));
  assert.deepEqual(texts(rowOf(root, X_PKG_BILL).querySelectorAll('.wm-actions button')), ['Reject', 'Clear']);
  const manual = rowOf(root, M_DB);
  assert.deepEqual(texts(manual.querySelectorAll('.wm-actions button')), ['Delete']);
  assert.equal(manual.querySelector('.wm-del').dataset.edge, M_DB);
  assert.equal(manual.querySelector('.wm-conf'), null, 'a manual edge has no confidence badge (even stamped verified)');
  assert.equal(root.querySelector('.wm-edges-card .card-head .badge').textContent, '5');
});

test('filters: member / kind / confidence / state / pair narrow the table; the count reads shown / total', () => {
  const f = emptyMapFilters();
  assert.deepEqual(f, { member: '', kind: '', confidence: '', state: '', pair: null });
  assert.deepEqual(filterEdges(EDGES, { ...f, member: 'web' }).map((e) => e.id), [X_HTTP, X_GONE, X_PKG_WEB]);
  assert.deepEqual(filterEdges(EDGES, { ...f, kind: 'pkg' }).map((e) => e.id), [X_PKG_BILL, X_PKG_WEB]);
  assert.deepEqual(filterEdges(EDGES, { ...f, confidence: 'exact' }).map((e) => e.id), [X_HTTP, X_PKG_WEB]);
  assert.deepEqual(filterEdges(EDGES, { ...f, confidence: 'verified' }).map((e) => e.id), [X_GONE], 'a manual edge has no confidence');
  assert.deepEqual(filterEdges(EDGES, { ...f, state: 'missing' }).map((e) => e.id), [X_GONE]);
  assert.deepEqual(filterEdges(EDGES, { ...f, pair: { from: 'web', to: 'billing-api' } }).map((e) => e.id), [X_HTTP, X_GONE]);
  assert.deepEqual(filterEdges(null, null), []);
  const root = renderMapTab(payload(), { doc, filters: { ...f, pair: { from: 'web', to: 'billing-api' }, state: 'auto' } });
  assert.deepEqual([...root.querySelectorAll('.wm-row')].map((r) => r.dataset.edge), [X_HTTP]);
  assert.equal(root.querySelector('.wm-edges-card .card-head .badge').textContent, '1 / 5');
  const selects = [...root.querySelectorAll('.wm-filters select.wm-filter')];
  assert.deepEqual(selects.map((s) => s.dataset.filter), ['member', 'kind', 'confidence', 'state']);
  assert.equal(selects[3].value, 'auto');
  assert.deepEqual([...selects[1].options].map((o) => o.value), ['', ...KINDS]);
  const chip = root.querySelector('.wm-filters .wm-pair-chip');
  assert.equal(chip.textContent, 'web → billing-api ×');
  assert.equal(chip.dataset.filter, 'pair');
  assert.ok(root.querySelector('.wm-filters button[data-filter="all"]'));
  const none = renderMapTab(payload(), { doc, filters: { ...f, state: 'confirmed', kind: 'http' } });
  assert.equal(none.querySelector('.wm-none td').textContent, 'No edges');
});

test('a table longer than ROW_MAX paints the first 500 rows and a "+N more" row; the badge still counts every edge', () => {
  const many = Array.from({ length: 600 }, (_, i) => ({ id: edgeId('web', 'billing-api', 'http', `http:GET /r${i}`), from: 'web', to: 'billing-api', kind: 'http',
    norm: `http:GET /r${i}`, display: `GET /r${i}`, confidence: 'exact', state: 'auto', evidence: { from: [], to: [] } }));
  const root = renderMapTab(payload({ edges: many }), { doc });
  assert.equal(root.querySelectorAll('.wm-row').length, 500);
  const more = root.querySelector('tr.wm-more td');
  assert.equal(more.textContent, '+100 more');
  assert.equal(more.colSpan, 8);
  assert.equal(root.querySelector('.wm-edges-card .card-head .badge').textContent, '600');
  assert.equal(renderMapTab(payload({ edges: many.slice(0, 500) }), { doc }).querySelector('.wm-more'), null, 'exactly ROW_MAX: no extra row');
  const one = renderMapTab(payload({ edges: many }), { doc, filters: { ...emptyMapFilters(), state: 'confirmed' } });
  assert.equal(one.querySelector('.wm-more'), null);
  assert.equal(one.querySelector('.wm-none td').textContent, 'No edges');
});

test('repo-derived strings are text, never markup', () => {
  const evil = '<img src=x onerror=alert(1)>';
  const map = { ...MAP, members: MAP.members.map((m, i) => (i === 0 ? { ...m, name: '<b>billing</b>' } : m)) };
  const edges = [{ ...EDGES[2], display: evil, detail: '<script>bad()</script>', label: '<i>l</i>',
    evidence: { from: [{ file: '<svg onload=x>.ts', line: 1, match: evil }], to: [] }, context: { from: { symbol: '<u>s</u>', callers: ['<a href=x>c</a>'] } } }];
  const root = renderMapTab(payload({ map, edges }), { doc });
  for (const tag of ['img', 'b', 'script', 'i:not(.wm-swatch)', 'u', 'a', 'svg']) assert.equal(root.querySelector(`.wm-table ${tag}, .wm-coverage ${tag}`), null, tag);
  assert.equal(root.querySelectorAll('img').length, 0);
  assert.equal(rowOf(root, X_HTTP).querySelector('.wm-disp .mono').textContent, evil);
  assert.match(root.textContent, /<script>bad\(\)<\/script>/);
  assert.equal(root.querySelector('.wm-chip-name').textContent, '<b>billing</b>');
  assert.equal(root.querySelector('.wm-node text').textContent, '<b>billing</b>');
  assert.equal(rowOf(root, X_HTTP).querySelector('.wm-ev-loc').textContent, '<svg onload=x>.ts:1');
});
