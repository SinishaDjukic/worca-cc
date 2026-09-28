// test/wsmap-stale-reviews.test.mjs — a rejection whose edge a re-scan no longer finds (and that
// finalize could not move: M14) is a STALE review: an effective edge in state `stale`, built from the
// override's snapshot like `missing`. The Map tab lists it with a Clear button; the description, the
// graph, the counts and the eval never treat it as an edge.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { basename } from 'node:path';
import { JSDOM } from 'jsdom';

import { useTempHome } from './helpers/temp-home.mjs';
import { makeRepos } from './helpers/wsmap-p1-repos.mjs';
import { sampleMap, DISPLAYS } from './helpers/wsmap-stored.mjs';
import { EDGE_STATES } from '../src/shared/workspace-map/schema.mjs';
import { edgeId } from '../src/shared/workspace-map/ids.mjs';
import { emptyOverrides, setEdgeState, effectiveEdges } from '../src/shared/workspace-map/overrides.mjs';
import { renderWorkspaceDescription } from '../src/shared/workspace-map/render.mjs';
import { mapSummary } from '../src/shared/workspace-map/summary.mjs';
import { pairsOf } from '../src/shared/workspace-map/layout.mjs';
import { evaluate } from '../src/core/workspace-map/eval.mjs';
import { renderMapTab, filterEdges, emptyMapFilters } from '../ui/public/workspace-map-view.mjs';
import { createWorkspace, readWorkspace, readWorkspaceMap, saveWorkspaceScanResult, setWorkspaceEdgeState } from '../src/core/workspaces.mjs';

useTempHome(after);
const repos = [];
after(() => Promise.all(repos.map((r) => r.cleanup())));
const T1 = '2026-09-26T08:00:00.000Z';
const E = (from, to, kind, norm, display, over = {}) => ({ id: edgeId(from, to, kind, norm), from, to, kind, norm, display, label: null, detail: null,
  confidence: 'inferred', sources: ['usage'], agentKeyed: true, evidence: { from: [{ file: 'src/a.ts', line: 1, match: 'x' }], to: [] }, ...over });
const LIVE = E('web', 'users', 'http', 'http:GET /users/{}', 'GET /users/{id}', { confidence: 'verified' });
const GONE = E('web', 'users', 'other', 'other:shared s3 bucket', 'shared S3 bucket');   // rejected, then lost by a re-scan
const LOST = E('web', 'billing', 'topic', 'topic:invoices.paid', 'invoices.paid');        // confirmed, then lost by a re-scan
const cov = { level: 'rich', files: 1, scannedFiles: 1, truncated: false, factsStatic: 1, factsLlm: 0, unresolved: 0, rejected: 0, surveyed: 'skipped', usageStatus: 'investigated', graph: null };
const MAP = { version: 1, workspace: { name: 'Shop' }, scannedAt: '2026-09-26T09:00:00.000Z', runId: 'r2',
  members: ['billing', 'users', 'web'].map((key) => ({ key, name: key, role: `Role of ${key}`, roleSource: 'static', aliases: [], stack: ['node'], coverage: cov })),
  edges: [LIVE], order: [['billing', 'users'], ['web']], cycles: [], graph: { mode: 'none', file: null, nodes: 0, bridges: 0 }, stats: {}, errors: [] };
let OV = setEdgeState(emptyOverrides(), GONE, 'rejected', T1);
OV = setEdgeState(OV, LOST, 'confirmed', T1);

test('a rejection whose edge is gone is a stale review: a synthetic edge from its snapshot, no confidence, no evidence (killer: stale state)', () => {
  assert.ok(EDGE_STATES.includes('stale'));
  const eff = effectiveEdges(MAP, OV);
  assert.deepEqual(eff.map((e) => `${e.id}:${e.state}`), [`${LOST.id}:missing`, `${LIVE.id}:auto`, `${GONE.id}:stale`]);
  assert.deepEqual(eff.find((e) => e.id === GONE.id), { id: GONE.id, from: 'web', to: 'users', kind: 'other', norm: null, display: 'shared S3 bucket',
    label: null, detail: '', confidence: null, sources: ['override'], evidence: { from: [], to: [] }, at: T1, state: 'stale' });
  assert.equal(eff.find((e) => e.id === LOST.id).confidence, 'verified', 'a missing edge keeps its verified stamp');
});

test('a stale review is never an edge: the description, the summary counts, the graph pairs and the eval leave it out (killer: exclusions)', () => {
  const text = renderWorkspaceDescription({ name: 'Shop', map: MAP, overrides: OV, budget: 300 });
  assert.ok(text.includes('GET /users/{id}'), 'the live edge is described');
  assert.ok(!text.includes('shared S3 bucket'), 'the stale review is not');
  assert.deepEqual(mapSummary(MAP, OV), { scannedAt: MAP.scannedAt, members: 3, edges: 1, gaps: 0, confirmed: 0, rejected: 0, manual: 0, missing: 1, stale: 1,
    byKind: { http: 1 } });
  assert.deepEqual(pairsOf(effectiveEdges(MAP, OV)).map((p) => `${p.from}>${p.to} ${p.kinds.join(',')}`), ['web>users http']);
  const labels = { version: 1, workspace: 'Shop', edges: [{ from: 'web', to: 'users', kind: 'other', truth: false }] };
  const r = evaluate(MAP, labels, { overrides: OV });
  assert.equal(r.counts.edges, 1);
  assert.deepEqual([r.pairs.fp, r.pairs.tp], [0, 0], 'the stale pair is not predicted, so its false label costs nothing');
});

test('the review\'s trap: a rejection whose relation is gone never suppresses another relation of the same pair and kind, and shows as stale', () => {
  const cli = E('web', 'users', 'other', 'other:admin cli', 'admin CLI');
  const bucket = E('web', 'users', 'other', 'other:s3 bucket', 'S3 bucket');
  const map = { ...MAP, edges: [cli] };
  const ov = setEdgeState(emptyOverrides(), bucket, 'rejected', T1);
  assert.deepEqual(effectiveEdges(map, ov).map((e) => `${e.display}:${e.state}`), ['S3 bucket:stale', 'admin CLI:auto']);
  const text = renderWorkspaceDescription({ name: 'Shop', map, overrides: ov, budget: 300 });
  assert.ok(text.includes('admin CLI') && !text.includes('S3 bucket'));
});

test('the Map tab lists a stale review greyed and dashed, with Clear as its only action, and never draws it (killer: stale row)', () => {
  const doc = new JSDOM('<!doctype html><body></body>').window.document;
  const edges = effectiveEdges(MAP, OV);
  const root = renderMapTab({ map: MAP, synthesis: null, overrides: OV, edges, descriptionOrigin: 'generated', workspace: { id: 'wks-shop-00000001', name: 'Shop' } }, { doc });
  const row = root.querySelector(`.wm-row[data-edge="${GONE.id}"]`);
  assert.ok(row.classList.contains('is-stale'));
  const badge = row.querySelector('.wm-state');
  assert.equal(badge.textContent, 'stale');
  assert.ok(badge.classList.contains('amber'));
  assert.equal(row.querySelector('.wm-conf'), null, 'no confidence badge');
  const actions = [...row.querySelectorAll('td.wm-actions button')];
  assert.deepEqual(actions.map((b) => b.className), ['btn-ghost btn-mini wm-clear']);
  assert.equal(actions[0].textContent, 'Clear');
  assert.equal(actions[0].dataset.edge, GONE.id);
  assert.equal(actions[0].getAttribute('aria-label'), 'Clear web → users shared S3 bucket');
  assert.equal(root.querySelector('.wm-pair[data-from="web"][data-to="users"]').getAttribute('aria-label'), 'web uses users: 1 edge (REST API)', 'the stale review is not drawn');
  assert.equal(root.querySelector('.wm-meta').textContent, '3 projects · 1 edge · scanned 2026-09-26');
  const state = root.querySelector('select.wm-filter[data-filter="state"]');
  assert.ok([...state.options].some((o) => o.value === 'stale'));
  assert.deepEqual(filterEdges(edges, { ...emptyMapFilters(), state: 'stale' }).map((e) => e.id), [GONE.id]);
});

test('style: a stale row is greyed like a rejection and dashed like a missing edge', () => {
  const css = readFileSync(fileURLToPath(new URL('../ui/public/style.css', import.meta.url)), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const win = new JSDOM(`<!doctype html><style>${css}</style><table class="wm-table"><tbody><tr class="wm-row is-stale"><td id="inner">s</td></tr>`
    + '<tr class="wm-row is-auto"><td>a</td></tr></tbody></table><table class="wm-table"><tbody><tr class="wm-row is-stale"><td id="last">s</td></tr></tbody></table>').window;
  for (const id of ['inner', 'last']) {
    const td = win.getComputedStyle(win.document.getElementById(id));
    assert.deepEqual([td.color, td.borderBottomStyle, td.borderBottomWidth, td.fontStyle], ['var(--ink-3)', 'dashed', '1px', 'italic'], id);
  }
});

test('stored: a re-scan that drops a rejected edge leaves a stale review the list counts and Clear removes', async () => {
  const r = await makeRepos({ a: { 'x.txt': 'a\n' }, b: { 'x.txt': 'b\n' } });
  repos.push(r);
  const ws = await createWorkspace({ name: 'Stale WS', projectPaths: r.members.map((m) => m.dir) });
  const names = ws.projectPaths.map((p) => basename(p));
  const first = sampleMap({ keys: ws.projectKeys, names, name: ws.name });
  await saveWorkspaceScanResult(ws.id, { map: first.map, synthesis: first.synthesis });
  await setWorkspaceEdgeState(ws.id, first.ids.pkg, 'rejected');
  const rescan = sampleMap({ keys: ws.projectKeys, names, name: ws.name, drop: ['pkg'] });
  await saveWorkspaceScanResult(ws.id, { map: rescan.map, synthesis: rescan.synthesis });
  const stored = await readWorkspaceMap(ws.id);
  assert.equal(effectiveEdges(stored.map, stored.overrides).find((e) => e.id === first.ids.pkg).state, 'stale');
  const listed = await readWorkspace(ws.id);
  assert.deepEqual([listed.mapSummary.edges, listed.mapSummary.stale], [2, 1]);
  assert.ok(!listed.description.includes(DISPLAYS.pkg));
  const cleared = await setWorkspaceEdgeState(ws.id, first.ids.pkg, null);
  assert.equal(cleared.edge, null);
  assert.equal(cleared.workspace.mapSummary.stale, 0);
  assert.ok(!effectiveEdges(rescan.map, cleared.overrides).some((e) => e.id === first.ids.pkg));
});
