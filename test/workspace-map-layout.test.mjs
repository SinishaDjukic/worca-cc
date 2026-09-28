// test/workspace-map-layout.test.mjs — the Map tab's pure layout (spec D17, index P6):
// pairsOf folds effective edges into drawn pairs (rejected and missing never drawn), layoutMap
// puts providers left of consumers, is deterministic, and keeps cycles in one layer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { layoutMap, pairsOf, MAP_LAYOUT } from '../src/shared/workspace-map/layout.mjs';
import { edgeId, manualEdgeId } from '../src/shared/workspace-map/ids.mjs';

const AT = '2026-09-25T11:00:00.000Z';
const M = (key, level = 'rich') => ({ key, name: key.toUpperCase(), coverage: { level } });
// Real ids (x_ / m_ + 12 hex), like the GET /map payload. MAN = P1 v2's synthetic manual edge (confidence null).
const E = (from, to, kind, extra = {}) => ({ id: edgeId(from, to, kind, `${kind}:${to}`), from, to, kind, display: `${kind} ${to}`, confidence: 'exact', state: 'auto', ...extra });
const MAN = (from, to, kind, extra = {}) => E(from, to, kind, { id: manualEdgeId(from, to, kind, `${kind} ${to}`, AT), norm: null, confidence: null, sources: ['manual'], state: 'manual', ...extra });

test('pairsOf: one pair per (from, to); rejected and missing edges are never drawn; a manual edge has no confidence', () => {
  const pairs = pairsOf([
    E('web', 'api', 'http'),
    E('web', 'api', 'http', { id: edgeId('web', 'api', 'http', 'http:GET /b'), display: 'GET /b', confidence: 'heuristic' }),
    E('web', 'api', 'topic', { confidence: 'verified' }),
    E('web', 'lib', 'pkg', { state: 'rejected' }),
    E('api', 'lib', 'pkg', { state: 'missing', confidence: 'verified' }),
    MAN('api', 'lib', 'db', { confidence: 'verified' }),   // P1 v1 stamped manual edges 'verified': still no confidence
  ]);
  assert.deepEqual(pairs, [
    { from: 'api', to: 'lib', kinds: ['db'], confidence: null, count: 1, state: 'manual' },
    { from: 'web', to: 'api', kinds: ['http', 'topic'], confidence: 'exact', count: 3, state: 'auto' },
  ]);
});

test('pairsOf: a confirmed edge makes the pair confirmed; unknown kinds count as other; garbage is skipped', () => {
  const pairs = pairsOf([E('a', 'b', 'grpc', { state: 'confirmed', confidence: 'inferred' }), E('a', 'b', 'weird'), E('a', 'b', 'weird', { id: edgeId('a', 'b', 'weird', 'weird:b2') }), null, 7, { from: 'a' }, E('a', 'a', 'http')]);
  assert.deepEqual(pairs, [{ from: 'a', to: 'b', kinds: ['other', 'grpc'], confidence: 'exact', count: 3, state: 'confirmed' }]);
  assert.deepEqual(pairsOf(null), []);
});

test('layoutMap: providers sit left of their consumers; nodes carry coverage level and layer', () => {
  const members = [M('web'), M('api', 'partial'), M('lib', 'none'), M('solo')];
  const pairs = pairsOf([E('web', 'api', 'http'), E('api', 'lib', 'pkg'), E('web', 'lib', 'pkg')]);
  const out = layoutMap({ members, pairs, order: null });
  const at = Object.fromEntries(out.nodes.map((n) => [n.key, n]));
  for (const p of pairs) assert.ok(at[p.to].x + at[p.to].w <= at[p.from].x, `${p.to} left of ${p.from}`);
  assert.equal(at.lib.layer, 0); assert.equal(at.api.layer, 1); assert.equal(at.web.layer, 2);
  assert.equal(at.api.level, 'partial'); assert.equal(at.lib.level, 'none');
  assert.equal(out.edges.length, 3);
  const e = out.edges.find((x) => x.from === 'web' && x.to === 'api');
  assert.match(e.d, /^M[\d.]+ [\d.]+ C/);
  const nums = e.d.match(/-?[\d.]+/g).map(Number);
  assert.equal(nums[0], at.web.x, 'the path leaves the consumer on its left side');
  assert.equal(nums[nums.length - 2], at.api.x + at.api.w, 'and ends on the provider\'s right side');
  assert.ok(out.width >= at.web.x + MAP_LAYOUT.NODE_W + MAP_LAYOUT.PAD);
  assert.ok(out.height >= MAP_LAYOUT.NODE_H + 2 * MAP_LAYOUT.PAD);
});

test('layoutMap: a pair that skips a column runs over a lane above every node and never enters a node box', () => {
  const members = [M('web'), M('api'), M('lib'), M('mid'), M('mid2')];
  const pairs = pairsOf([E('web', 'api', 'http'), E('api', 'lib', 'pkg'), E('web', 'lib', 'pkg'), E('mid', 'lib', 'db'), E('mid2', 'lib', 'db')]);
  const out = layoutMap({ members, pairs, order: null });
  const long = out.edges.find((e) => e.from === 'web' && e.to === 'lib');
  const pts = [...long.d.matchAll(/(-?[\d.]+) (-?[\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])]);
  const top = Math.min(...out.nodes.map((n) => n.y));
  assert.ok(Math.min(...pts.map(([, y]) => y)) < top, 'the lane is above the top row');
  assert.ok(top >= MAP_LAYOUT.PAD + 2 * MAP_LAYOUT.LANE_GAP, 'the band pushed the nodes down');
  for (const [x, y] of pts) {
    for (const n of out.nodes) assert.ok(!(x > n.x && x < n.x + n.w && y > n.y && y < n.y + n.h), `(${x}, ${y}) inside ${n.key}`);
  }
  const short = out.edges.find((e) => e.from === 'web' && e.to === 'api');
  assert.doesNotMatch(short.d, /Q/, 'a pair between neighbouring columns stays one curve');
  assert.equal(out.height, 2 * MAP_LAYOUT.PAD + 2 * MAP_LAYOUT.LANE_GAP + 3 * MAP_LAYOUT.NODE_H + 2 * MAP_LAYOUT.ROW_GAP);
});

test('layoutMap: deterministic — the same input in any order gives the same coordinates', () => {
  const members = ['a', 'b', 'c', 'd', 'e', 'f'].map((k) => M(k));
  const edges = [E('a', 'b', 'http'), E('c', 'b', 'topic'), E('d', 'a', 'pkg'), E('e', 'f', 'db'), E('d', 'c', 'http')];
  const one = layoutMap({ members, pairs: pairsOf(edges), order: null });
  const two = layoutMap({ members: [...members].reverse(), pairs: pairsOf([...edges].reverse()).reverse(), order: null });
  assert.deepEqual(two, one);
  assert.deepEqual(layoutMap({ members, pairs: pairsOf(edges), order: null }), one, 'and again');
});

test('layoutMap: a cycle shares one layer and its loop stays on the right of the column', () => {
  const out = layoutMap({ members: [M('a'), M('b'), M('c')], pairs: pairsOf([E('a', 'b', 'http'), E('b', 'a', 'http'), E('c', 'a', 'pkg')]), order: null });
  const at = Object.fromEntries(out.nodes.map((n) => [n.key, n]));
  assert.equal(at.a.layer, at.b.layer, 'a and b share a layer');
  assert.equal(at.a.x, at.b.x, 'one column');
  assert.ok(at.a.x + at.a.w <= at.c.x, 'the consumer c is to the right');
  const loop = out.edges.find((e) => e.from === 'a' && e.to === 'b');
  assert.ok(loop.d.startsWith(`M${at.a.x + at.a.w} `), 'a loop leaves from the right side');
  assert.ok(out.width >= at.c.x + at.c.w + MAP_LAYOUT.PAD + MAP_LAYOUT.LOOP_PAD, 'room for the bulge');
});

test('layoutMap: the map order is used when it fits the drawn pairs, recomputed when a manual edge breaks it', () => {
  const members = [M('a'), M('b'), M('solo')];
  const pairs = pairsOf([E('a', 'b', 'http')]);
  const kept = layoutMap({ members, pairs, order: [['b'], ['a'], ['solo']] });
  assert.equal(kept.nodes.find((n) => n.key === 'solo').layer, 2, 'a consistent order is kept as given');
  const flipped = pairsOf([E('a', 'b', 'http'), MAN('b', 'solo', 'pkg')]);
  const re = layoutMap({ members, pairs: flipped, order: [['b'], ['a'], ['solo']] });
  const at = Object.fromEntries(re.nodes.map((n) => [n.key, n]));
  for (const p of flipped) assert.ok(at[p.to].x + at[p.to].w <= at[p.from].x, `${p.to} left of ${p.from}`);
  const partial = layoutMap({ members, pairs, order: [['b']] });
  assert.equal(partial.nodes.length, 3, 'an order missing members is not used');
});

test('layoutMap: a stale order that puts a consumer and its provider in one layer (no cycle) is recomputed', () => {
  const members = [M('a'), M('b'), M('solo')];
  const pairs = pairsOf([E('a', 'b', 'http'), MAN('solo', 'b', 'other')]);
  const out = layoutMap({ members, pairs, order: [['b', 'solo'], ['a']] });
  const at = Object.fromEntries(out.nodes.map((n) => [n.key, n]));
  for (const p of pairs) assert.ok(at[p.to].x + at[p.to].w <= at[p.from].x, `${p.to} left of ${p.from}`);
});

// Points along an SVG path of M / L / Q / C commands (the only ones layoutMap writes), every 2 %.
function along(d) {
  const tok = d.match(/[MLQC]|-?[\d.]+/g);
  const pts = [];
  let i = 0;
  let cmd = 'M';
  let cur = [0, 0];
  const lerp = (a, b, s) => [a[0] + (b[0] - a[0]) * s, a[1] + (b[1] - a[1]) * s];
  const at = (ctrl, s) => (ctrl.length === 1 ? ctrl[0] : at(ctrl.slice(1).map((p, j) => lerp(ctrl[j], p, s)), s));
  while (i < tok.length) {
    if (/[MLQC]/.test(tok[i])) { cmd = tok[i]; i += 1; }
    const ctrl = [cur];
    for (let j = 0; j < { M: 1, L: 1, Q: 2, C: 3 }[cmd]; j += 1) { ctrl.push([Number(tok[i]), Number(tok[i + 1])]); i += 2; }
    if (cmd === 'M') pts.push(ctrl[1]);
    else for (let s = 0.02; s < 1.001; s += 0.02) pts.push(at(ctrl, s));
    cur = ctrl[ctrl.length - 1];
  }
  return pts;
}
// Every "from->to crosses key" where a sampled point lies strictly inside a node box (its own ends
// included: a path leaves and enters a node on its border, never through it).
function crossings(out) {
  const bad = new Set();
  for (const e of out.edges) for (const [x, y] of along(e.d)) for (const n of out.nodes) {
    if (x > n.x + 0.5 && x < n.x + n.w - 0.5 && y > n.y + 0.5 && y < n.y + n.h - 0.5) bad.add(`${e.from}->${e.to} crosses ${n.key}`);
  }
  return [...bad];
}

test('layoutMap: no curve enters a node box, even in a cycle wider than MAX_ROWS; a pair skipping sub-columns takes a lane', () => {
  const ring = (n) => Array.from({ length: n }, (_, i) => `m${String(i).padStart(2, '0')}`);
  // 12 members, one cycle: two sub-columns; the loops of one must not reach the other.
  const small = ring(12);
  const two = layoutMap({ members: small.map((k) => M(k)), pairs: pairsOf(small.map((k, i) => E(k, small[(i + 1) % 12], 'http'))), order: null });
  assert.equal(new Set(two.nodes.map((n) => n.x)).size, 2, 'one layer, two sub-columns');
  assert.deepEqual(crossings(two), []);
  // 32 members, one cycle: four sub-columns; m02 → m25 skips one to its RIGHT, so it rides a lane.
  const big = ring(32);
  const four = layoutMap({ members: big.map((k) => M(k)), pairs: pairsOf([...big.map((k, i) => E(k, big[(i + 1) % 32], 'http')), E('m02', 'm25', 'topic')]), order: null });
  assert.equal(new Set(four.nodes.map((n) => n.x)).size, 4, 'one layer, four sub-columns');
  assert.deepEqual(crossings(four), []);
  const skip = four.edges.find((e) => e.from === 'm02' && e.to === 'm25');
  assert.ok(Math.min(...along(skip.d).map(([, y]) => y)) < Math.min(...four.nodes.map((n) => n.y)), 'the long pair rides a lane above the top row');
  // 30 members, one cycle whose ONLY long pair points right (m02 → m25): the lane band opens for it too.
  const chain = ring(30);
  const back = [E('m29', 'm15', 'pkg'), E('m15', 'm05', 'pkg'), E('m10', 'm00', 'pkg'), E('m02', 'm25', 'topic')];
  const three = layoutMap({ members: chain.map((k) => M(k)), pairs: pairsOf([...chain.slice(0, -1).map((k, i) => E(k, chain[i + 1], 'http')), ...back]), order: null });
  assert.equal(new Set(three.nodes.map((n) => n.x)).size, 3, 'one layer, three sub-columns');
  assert.deepEqual(crossings(three), []);
});

test('layoutMap: a layer taller than MAX_ROWS wraps into sub-columns; 40 members stay bounded', () => {
  const members = Array.from({ length: 40 }, (_, i) => M(`m${String(i).padStart(2, '0')}`));
  const out = layoutMap({ members, pairs: [], order: null });
  assert.equal(out.nodes.length, 40);
  assert.equal(new Set(out.nodes.map((n) => n.x)).size, 4, 'four sub-columns of ten');
  assert.equal(out.height, 2 * MAP_LAYOUT.PAD + 10 * MAP_LAYOUT.NODE_H + 9 * MAP_LAYOUT.ROW_GAP);
  assert.deepEqual(out.nodes.slice(0, 3).map((n) => n.key), ['m00', 'm01', 'm02'], 'rows sorted by key');
});

test('layoutMap: total on garbage — no members, unknown pair ends, duplicate keys', () => {
  assert.deepEqual(layoutMap({}), { width: 2 * MAP_LAYOUT.PAD, height: 2 * MAP_LAYOUT.PAD + MAP_LAYOUT.NODE_H, nodes: [], edges: [] });
  const out = layoutMap({ members: [M('a'), M('a'), { name: 'x' }, null], pairs: [{ from: 'a', to: 'ghost', kinds: ['http'] }], order: 'nope' });
  assert.equal(out.nodes.length, 1);
  assert.equal(out.edges.length, 0);
});
