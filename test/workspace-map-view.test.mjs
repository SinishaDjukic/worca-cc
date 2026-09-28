// test/workspace-map-view.test.mjs — the Map tab renderer (spec D17, §5.7, §5.9): coverage strip,
// graph (rejected and missing never drawn, dashed / confirmed styling, keyboard-focusable pairs),
// edge table (rejected greyed, missing named, actions per state, evidence + graphify context),
// filters, the add form, Regenerate description only for an edited description, and no markup
// ever parsed from repo- or agent-authored strings. Edge ids are real (x_ / m_ + 12 hex): P1's
// checkOverrides drops any other id, and the top line counts through the stored overrides.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { renderMapTab, filterEdges, emptyMapFilters } from '../ui/public/workspace-map-view.mjs';
import { KINDS } from '../src/shared/workspace-map/schema.mjs';
import { edgeId, manualEdgeId } from '../src/shared/workspace-map/ids.mjs';
import { effectiveEdges } from '../src/shared/workspace-map/overrides.mjs';

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

test('the top line counts projects, drawn edges and gaps through the stored overrides; Regenerate shows only for an edited description', () => {
  assert.deepEqual(effectiveEdges(MAP, OVERRIDES).map((e) => `${e.id}:${e.state}`), EDGES.map((e) => `${e.id}:${e.state}`),
    'the fixture is what GET /map sends');
  const root = renderMapTab(payload(), { doc });
  assert.equal(root.querySelector('.wm-meta').textContent, '3 projects · 3 edges · 1 gap · scanned 2026-09-25');
  // The overrides are applied (real ids): 3 scanned − 1 rejected = 2 without the manual edge, 3 without overrides.
  const meta = (overrides) => renderMapTab(payload({ overrides }), { doc }).querySelector('.wm-meta').textContent;
  assert.equal(meta({ ...OVERRIDES, manual: [] }), '3 projects · 2 edges · 1 gap · scanned 2026-09-25');
  assert.equal(meta(null), '3 projects · 3 edges · 1 gap · scanned 2026-09-25');
  assert.equal(root.querySelector('.wm-regen'), null, 'origin generated → no Regenerate');
  const edited = renderMapTab(payload({ descriptionOrigin: 'edited' }), { doc });
  const regen = edited.querySelector('.wm-regen');
  assert.ok(regen, 'origin edited → Regenerate');
  assert.equal(regen.type, 'button');
  assert.equal(regen.textContent, 'Regenerate description');
  assert.equal(renderMapTab(payload({ descriptionOrigin: null }), { doc }).querySelector('.wm-regen'), null);
});

test('coverage strip: one chip per member with level, survey / usage failures and the graph state; a chip is a member filter', () => {
  const root = renderMapTab(payload(), { doc, filters: { ...emptyMapFilters(), member: 'web' } });
  const chips = [...root.querySelectorAll('.wm-coverage .wm-chip')];
  assert.deepEqual(chips.map((c) => c.dataset.value), ['billing-api', 'shared-lib', 'web']);
  assert.deepEqual(chips.map((c) => [...c.classList].find((x) => x.startsWith('lvl-'))), ['lvl-rich', 'lvl-partial', 'lvl-none']);
  assert.deepEqual(texts(chips[0].querySelectorAll('.wm-tag')), ['rich', 'graph']);
  assert.deepEqual(texts(chips[1].querySelectorAll('.wm-tag')), ['partial', 'stale graph']);
  assert.deepEqual(texts(chips[2].querySelectorAll('.wm-tag')), ['none', 'survey failed', 'usage failed', 'no graph']);
  assert.ok(chips[1].querySelector('.wm-tag:last-child').classList.contains('is-off'));
  assert.ok(!chips[0].querySelector('.wm-tag:last-child').classList.contains('is-off'));
  // The graph tag of billing-api for each coverage.graph shape: P7 { nodes, bytes, fresh, used }, P1 { nodes, fresh }.
  const graphTag = (graph) => renderMapTab(payload({ map: { ...MAP, members: MAP.members.map((m, i) => (i === 0 ? { ...m, coverage: { ...m.coverage, graph } } : m)) } }), { doc })
    .querySelector('.wm-coverage .wm-chip .wm-tag:last-child').textContent;
  assert.equal(graphTag({ nodes: 120, bytes: 48000, fresh: true, used: false }), 'graph unused');
  assert.equal(graphTag({ nodes: 120, fresh: true }), 'graph', 'P1 alone: fresh, no used field');
  assert.equal(graphTag({ nodes: 120, fresh: false }), 'stale graph');
  assert.equal(graphTag(null), 'no graph');
  for (const c of chips) { assert.equal(c.type, 'button'); assert.ok(c.classList.contains('wm-filter')); assert.equal(c.dataset.filter, 'member'); }
  assert.equal(chips[2].getAttribute('aria-pressed'), 'true');
  assert.equal(chips[0].getAttribute('aria-pressed'), 'false');
});

test('graph: rejected and missing edges are not drawn; pairs are keyboard-focusable, coloured by primary kind, confirmed thicker', () => {
  const root = renderMapTab(payload(), { doc });
  const svgEl = root.querySelector('.wm-graph-scroll svg.wm-graph');
  assert.equal(svgEl.getAttribute('role'), 'group');
  assert.equal(svgEl.getAttribute('aria-label'), 'Workspace map: 3 projects, 2 connections');
  assert.equal(svgEl.querySelectorAll('.wm-node').length, 3);
  const pairs = [...svgEl.querySelectorAll('.wm-pair')];
  assert.deepEqual(pairs.map((p) => `${p.dataset.from}>${p.dataset.to}`), ['billing-api>shared-lib', 'web>billing-api']);
  assert.equal(svgEl.querySelector('.wm-pair[data-from="web"][data-to="shared-lib"]'), null, 'the rejected edge is not drawn');
  for (const p of pairs) {
    assert.equal(p.getAttribute('tabindex'), '0');
    assert.equal(p.getAttribute('role'), 'button');
    assert.equal(p.getAttribute('aria-pressed'), 'false');
    assert.ok(p.getAttribute('aria-label'));
    assert.ok(p.querySelector('path.wm-hit') && p.querySelector('path.wm-line'));
  }
  const bill = pairs[0];
  assert.ok(bill.classList.contains('wm-k-pkg'), 'pkg and db tie → KINDS order picks pkg');
  assert.ok(bill.classList.contains('is-confirmed'));
  assert.ok(!bill.classList.contains('is-dashed'));
  assert.equal(bill.querySelector('.wm-line').getAttribute('marker-end'), 'url(#wm-arrow-pkg)');
  assert.ok(svgEl.querySelector('marker#wm-arrow-pkg') && svgEl.querySelector('marker#wm-arrow-http'));
  assert.equal(bill.getAttribute('aria-label'), 'billing-api uses shared-lib: 2 edges (build dep, shared DB)');
  const web = pairs[1];
  assert.ok(web.classList.contains('wm-k-http'));
  assert.ok(!web.classList.contains('is-confirmed'));
  assert.deepEqual(texts(root.querySelectorAll('.wm-legend-item')), ['REST API', 'build dep', 'shared DB']);
});

test('graph: inferred and manual-only pairs are dashed; a pair filter selects it and dims the rest', () => {
  const edges = [
    { id: edgeId('web', 'billing-api', 'service', 'service:billing'), from: 'web', to: 'billing-api', kind: 'service', display: 'billing:8080', confidence: 'inferred', state: 'auto' },
    { id: manualEdgeId('shared-lib', 'billing-api', 'other', 'S3 bucket', AT), from: 'shared-lib', to: 'billing-api', kind: 'other', norm: null, display: 'S3 bucket', detail: '',
      confidence: null, sources: ['manual'], evidence: { from: [], to: [] }, createdAt: AT, state: 'manual' },
  ];
  const root = renderMapTab(payload({ edges }), { doc, filters: { ...emptyMapFilters(), pair: { from: 'web', to: 'billing-api' } } });
  const svgEl = root.querySelector('svg.wm-graph');
  assert.ok(svgEl.classList.contains('has-focus'));
  const inferred = svgEl.querySelector('.wm-pair[data-from="web"]');
  const manual = svgEl.querySelector('.wm-pair[data-from="shared-lib"]');
  assert.ok(inferred.classList.contains('is-dashed') && manual.classList.contains('is-dashed'));
  assert.ok(inferred.classList.contains('is-selected'));
  assert.equal(inferred.getAttribute('aria-pressed'), 'true');
  assert.equal(manual.getAttribute('aria-pressed'), 'false');
  assert.ok(manual.classList.contains('is-dim'));
  assert.ok(svgEl.querySelector('.wm-node[data-value="web"]').classList.contains('is-selected'));
});

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
  assert.deepEqual([...auto.querySelectorAll('.wm-actions button')].map((b) => b.className), ['btn-ghost btn-mini wm-confirm', 'btn-ghost btn-mini wm-reject']);
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

test('edge table: evidence file:line on both sides plus the graphify symbol and callers', () => {
  const root = renderMapTab(payload(), { doc });
  const ev = rowOf(root, X_HTTP).querySelector('.wm-evidence');
  const sides = [...ev.querySelectorAll('.wm-ev')];
  assert.deepEqual(sides.map((s) => s.querySelector('.wm-ev-side').textContent), ['from', 'to']);
  assert.deepEqual(texts(ev.querySelectorAll('.wm-ev-loc')), ['src/api.ts:12', 'src/routes.ts:4']);
  assert.equal(ev.querySelector('.wm-ev-loc').title, "fetch('/invoices/'");
  assert.deepEqual(texts(ev.querySelectorAll('.wm-ctx')), ['in loadInvoice() · callers: InvoicePage.mount()', 'in getInvoice()']);
  assert.equal(rowOf(root, X_GONE).querySelector('.wm-evidence').textContent, '—');
  assert.equal(rowOf(root, X_PKG_BILL).querySelectorAll('.wm-ev').length, 1, 'an empty side is left out');
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

test('a filter naming a member the map no longer has is ignored, not an empty table under "All"', () => {
  const root = renderMapTab(payload(), { doc, filters: { ...emptyMapFilters(), member: 'gone', pair: { from: 'gone', to: 'web' }, kind: 'bogus' } });
  assert.equal(root.querySelectorAll('.wm-row').length, 5);
  assert.equal(root.querySelector('select.wm-filter[data-filter="member"]').value, '');
  assert.equal(root.querySelector('.wm-pair-chip'), null);
  assert.equal(root.querySelector('.wm-filters button[data-filter="all"]'), null);
  assert.ok(!root.querySelector('svg.wm-graph').classList.contains('has-focus'));
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

test('a long name is cut in the graph with the full name in its title; an edge to a member outside the map shows its key and is not drawn', () => {
  const long = 'a-very-long-project-name-for-the-graph';
  const map = { ...MAP, members: MAP.members.map((m, i) => (i === 0 ? { ...m, name: long } : m)) };
  const M_OLD = manualEdgeId('web', 'old-svc-9f3a1c20', 'service', 'old:8080', AT);
  const edges = [...EDGES, { id: M_OLD, from: 'web', to: 'old-svc-9f3a1c20', kind: 'service', norm: null, display: 'old:8080', label: null, detail: '',
    confidence: null, sources: ['manual'], evidence: { from: [], to: [] }, createdAt: AT, state: 'manual' }];
  const root = renderMapTab(payload({ map, edges }), { doc });
  const node = root.querySelector('.wm-node[data-value="billing-api"]');
  assert.equal(node.querySelector('text').textContent, 'a-very-long-project…');
  assert.equal(node.querySelector('title').textContent, `${long} (billing-api)`);
  assert.equal(root.querySelector('.wm-pair[data-to="old-svc-9f3a1c20"]'), null, 'not drawn');
  assert.equal(rowOf(root, M_OLD).querySelector('.wm-to').textContent, 'old-svc-9f3a1c20', 'the key stands in for the name');
});

test('add form: from / to list the members, kind lists KINDS, the Add button and a hidden message line', () => {
  const root = renderMapTab(payload(), { doc });
  const form = root.querySelector('.wm-add-form');
  assert.deepEqual([...form.querySelector('select[name="wm-from"]').options].map((o) => o.value), ['billing-api', 'shared-lib', 'web']);
  assert.equal(form.querySelector('select[name="wm-from"]').value, 'billing-api');
  assert.equal(form.querySelector('select[name="wm-to"]').value, 'shared-lib', 'from and to start on different members');
  assert.deepEqual([...form.querySelector('select[name="wm-kind"]').options].map((o) => o.value), [...KINDS]);
  assert.ok(form.querySelector('input[name="wm-display"]') && form.querySelector('input[name="wm-detail"]'));
  for (const n of ['wm-display', 'wm-detail']) assert.equal(form.querySelector(`input[name="${n}"]`).maxLength, 200, `${n}: P5's limit`);
  assert.equal(form.querySelector('.wm-add').type, 'button');
  assert.equal(root.querySelector('.wm-add-msg').hidden, true);
  for (const b of root.querySelectorAll('button')) assert.equal(b.type, 'button', b.className);
});

test('no map yet: a label and a Re-scan button; a load error sits above the last map, or alone', () => {
  const root = renderMapTab({ map: null, edges: [], overrides: null, descriptionOrigin: null, workspace: { id: 'w' } }, { doc });
  const empty = root.querySelector('.wm-empty');
  assert.equal(empty.querySelector('b').textContent, 'No map yet');
  assert.equal(empty.querySelector('.wm-rescan').type, 'button');
  assert.equal(root.querySelector('svg'), null);
  assert.equal(root.querySelector('table'), null);
  assert.ok(renderMapTab(null, { doc }).querySelector('.wm-empty'), 'null data renders the empty state');
  const failed = renderMapTab({ map: null, error: 'HTTP 500' }, { doc });
  assert.equal(failed.querySelector('.wm-error').textContent, 'HTTP 500');
  assert.equal(failed.querySelector('.wm-empty'), null, 'a failed load is not "no map": no Re-scan offer');
  const stale = renderMapTab(payload({ error: 'HTTP 502' }), { doc });
  assert.equal(stale.firstElementChild.className, 'hint err wm-error');
  assert.ok(stale.querySelector('svg.wm-graph'), 'the last good map stays under the error');
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
