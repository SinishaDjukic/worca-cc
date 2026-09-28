// test/wsmap-overrides.test.mjs — edge overrides, manual edges, effective edges, summary (wsmap P1).
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { emptyOverrides, effectiveEdges, setEdgeState, addManualEdge, removeManualEdge } from '../src/shared/workspace-map/overrides.mjs';
import { mapSummary } from '../src/shared/workspace-map/summary.mjs';
import { edgeId } from '../src/shared/workspace-map/ids.mjs';

const edge = (from, to, kind, norm, display, over = {}) => ({ id: edgeId(from, to, kind, norm), from, to, kind, norm, display,
  label: null, detail: null, confidence: 'exact', sources: ['static'], evidence: { from: [{ file: 'a.ts', line: 1, match: 'x' }], to: [] }, ...over });
const AT = '2026-09-25T10:00:00.000Z';
const mapOf = (edges) => ({ version: 1, scannedAt: AT, members: [
  { key: 'web', coverage: { level: 'rich', usageStatus: 'investigated' } },
  { key: 'api', coverage: { level: 'none', usageStatus: 'investigated' } },
  { key: 'lib', coverage: { level: 'rich', usageStatus: 'failed' } }], edges });

test('emptyOverrides / setEdgeState: new docs, input never mutated, null clears', () => {
  const e = edge('web', 'api', 'http', 'http:GET /x/{}', 'GET /x/{id}');
  const o0 = emptyOverrides();
  const o1 = setEdgeState(o0, e, 'confirmed', AT);
  assert.deepEqual(o0, { version: 1, edges: {}, manual: [] });
  assert.deepEqual(o1.edges[e.id], { state: 'confirmed', from: 'web', to: 'api', kind: 'http', display: 'GET /x/{id}', at: AT });
  assert.deepEqual(setEdgeState(o1, e, null, AT).edges, {});
  assert.throws(() => setEdgeState(o1, e, 'maybe', AT), TypeError);
});

test('overrides survive a re-scan: same edge id after a code move (killer: overrides survive)', () => {
  const before = edge('web', 'api', 'http', 'http:GET /x/{}', 'GET /x/{id}', { evidence: { from: [{ file: 'src/old.ts', line: 10, match: 'x' }], to: [] } });
  const ov = setEdgeState(emptyOverrides(), before, 'rejected', AT);
  const after = edge('web', 'api', 'http', 'http:GET /x/{}', 'GET /x/{id}', { evidence: { from: [{ file: 'src/moved/new.ts', line: 99, match: 'x' }], to: [] } });
  assert.equal(after.id, before.id);
  const eff = effectiveEdges(mapOf([after]), ov);
  assert.equal(eff.length, 1);
  assert.equal(eff[0].state, 'rejected');
  assert.equal(eff[0].evidence.from[0].file, 'src/moved/new.ts');
});

test('a confirmed edge the new scan lacks is surfaced as missing; a rejected one as stale (killer: missing confirmed)', () => {
  const gone = edge('web', 'api', 'topic', 'topic:orders', 'orders');
  const goneRejected = edge('web', 'lib', 'pkg', 'pkg:npm:lib', 'lib');
  let ov = setEdgeState(emptyOverrides(), gone, 'confirmed', AT);
  ov = setEdgeState(ov, goneRejected, 'rejected', AT);
  const eff = effectiveEdges(mapOf([]), ov);
  assert.deepEqual(eff.map((e) => `${e.id}:${e.state}`), [`${gone.id}:missing`, `${goneRejected.id}:stale`], 'M14: a stale review, never dropped');
  assert.equal(eff[0].id, gone.id);
  assert.equal(eff[0].state, 'missing');
  assert.equal(eff[0].confidence, 'verified');
  assert.deepEqual(eff[0].evidence, { from: [], to: [] });
  assert.equal(eff[0].display, 'orders');
});

test('setEdgeState clips a long display so the override survives the next read', () => {
  const e = { id: 'x_0123456789ab', from: 'web', to: 'api', kind: 'http', display: 'GET /' + 'x'.repeat(320) };
  const ov = setEdgeState(emptyOverrides(), e, 'confirmed', AT);
  assert.equal(effectiveEdges({ edges: [e] }, ov)[0].state, 'confirmed');
  assert.equal(ov.edges[e.id].display.length, 300);
});

test('manual edges: add (deterministic id, duplicate-safe), refuse bad input without throwing, remove', () => {
  const r = addManualEdge(emptyOverrides(), { from: 'web', to: 'api', kind: 'other', display: 'Shared S3 bucket' }, AT);
  assert.match(r.edge.id, /^m_[0-9a-f]{12}$/);
  assert.equal(r.overrides.manual.length, 1);
  const again = addManualEdge(r.overrides, { from: 'web', to: 'api', kind: 'other', display: 'Shared S3 bucket' }, AT);
  assert.equal(again.overrides.manual.length, 1);
  const bad = addManualEdge(r.overrides, { from: 'web', to: 'web', kind: 'other', display: 'x' }, AT);
  assert.equal(bad.edge, null);
  assert.match(bad.error, /differ/);
  assert.match(addManualEdge(null, { from: 'a', to: 'b', kind: 'rest', display: 'x' }, AT).error, /kind/);
  for (const input of [null, 'x', 7]) assert.match(addManualEdge(r.overrides, input, AT).error, /member keys/, 'a null JSON body is bad input, not a throw');
  const eff = effectiveEdges(null, r.overrides);
  assert.equal(eff[0].state, 'manual');
  assert.equal(eff[0].confidence, null, 'a manual edge is a person\'s assertion: no scan confidence');
  assert.equal(eff[0].norm, null);
  assert.deepEqual(removeManualEdge(r.overrides, r.edge.id).manual, []);
  assert.equal(removeManualEdge(r.overrides, 'm_000000000000').manual.length, 1);
});

test('effectiveEdges: states + sort by from, to, kind, display; garbage overrides tolerated', () => {
  const a = edge('web', 'api', 'topic', 'topic:b', 'b');
  const b = edge('web', 'api', 'http', 'http:GET /a', 'GET /a');
  const c = edge('api', 'lib', 'pkg', 'pkg:npm:lib', 'lib');
  const ov = setEdgeState(emptyOverrides(), a, 'confirmed', AT);
  const eff = effectiveEdges(mapOf([a, b, c]), ov);
  assert.deepEqual(eff.map((e) => [e.from, e.to, e.kind, e.state]), [
    ['api', 'lib', 'pkg', 'auto'], ['web', 'api', 'http', 'auto'], ['web', 'api', 'topic', 'confirmed']]);
  assert.equal(effectiveEdges(mapOf([a]), { version: 9, edges: 'x' }).length, 1);
});

test('a corrupt map_json never makes effectiveEdges / mapSummary throw or count a prototype key (v3)', () => {
  const bad = JSON.parse('{"toString":null,"valueOf":null}');
  const map = { edges: [{ id: 'x_000000000001', from: bad, to: 'a', kind: 'http' }, { id: 'x_000000000002', from: 'a', to: 'b', kind: 'constructor' }] };
  assert.deepEqual(effectiveEdges(map, null).map((e) => e.id), ['x_000000000002']);
  assert.deepEqual(mapSummary(map, null).byKind, { constructor: 1 });
});

test('mapSummary: counts effective edges, states, gaps and kinds', () => {
  const a = edge('web', 'api', 'topic', 'topic:b', 'b');
  const b = edge('web', 'api', 'http', 'http:GET /a', 'GET /a');
  const gone = edge('web', 'lib', 'pkg', 'pkg:npm:gone', 'gone');
  let ov = setEdgeState(emptyOverrides(), a, 'rejected', AT);
  ov = setEdgeState(ov, gone, 'confirmed', AT);
  ov = addManualEdge(ov, { from: 'lib', to: 'api', kind: 'db', display: 'shop' }, AT).overrides;
  assert.deepEqual(mapSummary(mapOf([a, b]), ov), {
    scannedAt: AT, members: 3, edges: 2, gaps: 2, confirmed: 0, rejected: 1, manual: 1, missing: 1, stale: 0, byKind: { http: 1, db: 1 } });
  assert.equal(mapSummary(null, ov), null);
});

test('an object-valued display never makes effectiveEdges / mapSummary / setEdgeState throw; a prototype-named edge id is auto (v4)', () => {
  const map = JSON.parse('{"members":[{"key":"a"},{"key":"b"}],"edges":['
    + '{"id":"x_000000000001","from":"a","to":"b","kind":"http","display":{"toString":null}},'
    + '{"id":"x_000000000002","from":"a","to":"b","kind":"http","display":"GET /x"},'
    + '{"id":"toString","from":"a","to":"b","kind":"pkg","display":"p"}]}');
  assert.deepEqual(effectiveEdges(map, null).map((e) => [e.id, e.state]), [['x_000000000001', 'auto'], ['x_000000000002', 'auto'], ['toString', 'auto']]);
  assert.equal(mapSummary(map, null).edges, 3);
  assert.equal(setEdgeState(emptyOverrides(), map.edges[0], 'confirmed', AT).edges.x_000000000001.display, '');
});

test('setEdgeState takes x_ ids only; addManualEdge refuses what the next read would drop (v4)', () => {
  const snap = { from: 'a', to: 'b', kind: 'http', display: 'x' };
  for (const id of ['m_0123456789ab', '__proto__', 'x_nothex']) assert.throws(() => setEdgeState(emptyOverrides(), { id, ...snap }, 'confirmed', AT), TypeError, id);
  const r = addManualEdge(emptyOverrides(), { from: '  ', to: 'b', kind: 'http', display: 'x' }, AT);
  assert.equal(r.edge, null);
  assert.equal(r.error, 'from and to must be member keys');
  assert.equal(addManualEdge(emptyOverrides(), { from: 'a', to: 'b', kind: 'http', display: 'x', detail: null }, AT).edge.detail, '', 'a null detail is no detail');
});
