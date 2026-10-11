// test/graph-lanes.test.mjs — the lane router (src/shared/graph/lanes.mjs) on the Deck workflow.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { routeGraph, routeLanes, countCrossings, LANE } from '../src/shared/graph/lanes.mjs';
import { classifyLoops } from '../src/shared/graph/loops.mjs';
import { autoLayout } from '../src/shared/graph/layout.mjs';
import { nodeSize, portAnchor } from '../src/shared/graph/geometry.mjs';
import { deckTemplate, deckPortsFn as pf } from './helpers/deck-fixture.mjs';

const geo = { describe: true };
const route = (tpl, o = {}) => routeGraph(tpl, {
  sizeOf: (n) => nodeSize(n, pf(n), geo), anchorOf: (n, port, dir) => portAnchor(n, pf(n), port, dir),
  loopWireIds: classifyLoops(tpl, pf).loopWireIds, ...o,
});
const roomy = () => {
  const tpl = deckTemplate();
  const pos = autoLayout(tpl, pf, geo);
  return { ...tpl, nodes: tpl.nodes.map((n) => ({ ...n, ...pos[n.id] })) };
};
const legsOf = (routes) => [...routes].flatMap(([id, r]) => r.pts.slice(1).map((p, i) => ({ id, a: r.pts[i], b: p })));
const overlap = (a0, a1, b0, b1) => Math.min(Math.max(a0, a1), Math.max(b0, b1)) - Math.max(Math.min(a0, a1), Math.min(b0, b1));

test('every wire is an orthogonal route that leaves its output and enters its input horizontally', () => {
  for (const tpl of [deckTemplate(), roomy()]) {
    const { routes } = route(tpl);
    assert.equal(routes.size, tpl.wires.length, 'every wire is routed');
    for (const [id, { pts, d, mid }] of routes) {
      for (let i = 1; i < pts.length; i += 1) assert.ok(pts[i].x === pts[i - 1].x || pts[i].y === pts[i - 1].y, `${id} leg ${i} is axis-aligned`);
      assert.ok(pts[1].y === pts[0].y && pts[1].x > pts[0].x, `${id} leaves to the right`);
      assert.ok(pts.at(-2).y === pts.at(-1).y && pts.at(-2).x < pts.at(-1).x, `${id} enters from the left`);
      assert.equal(/[CSA]/.test(d), false, `${id} paints straight runs and rounded corners only`);
      assert.ok(Number.isFinite(mid.x) && Number.isFinite(mid.y));
    }
  }
});

test('roomy (auto-layout spacing): parallel runs and vertical legs keep LANE px apart', () => {
  const legs = legsOf(route(roomy()).routes);
  for (const A of legs) {
    for (const B of legs) {
      if (A.id >= B.id) continue;
      const hA = A.a.y === A.b.y; const hB = B.a.y === B.b.y;
      if (hA && hB && A.a.y !== B.a.y && overlap(A.a.x, A.b.x, B.a.x, B.b.x) > 30) {
        assert.ok(Math.abs(A.a.y - B.a.y) >= LANE, `${A.id} / ${B.id} run ${Math.abs(A.a.y - B.a.y)}px apart`);
      }
      if (!hA && !hB && A.a.x !== B.a.x && overlap(A.a.y, A.b.y, B.a.y, B.b.y) > 30) {
        assert.ok(Math.abs(A.a.x - B.a.x) >= LANE, `${A.id} / ${B.id} legs ${Math.abs(A.a.x - B.a.x)}px apart`);
      }
    }
  }
});

test('golden crossings: the OR input order removes crossings, roomy removes more', () => {
  const golden = (tpl, reorder) => countCrossings(route(tpl, { reorder }).routes);
  assert.equal(golden(deckTemplate(), false), 30);
  assert.equal(golden(deckTemplate(), true), 25);
  assert.equal(golden(roomy(), false), 27);
  assert.equal(golden(roomy(), true), 17);
});

test('OR inputs are handed out in the order the wires arrive; the template is never touched', () => {
  const tpl = roomy();
  const before = JSON.stringify(tpl);
  const { portMap, routes } = route(tpl);
  assert.equal(JSON.stringify(tpl), before, 'routing never mutates the template');
  assert.deepEqual(Object.fromEntries(portMap), { w19: 'in1', w25: 'in2', w36: 'in3', w35: 'in4', w14: 'in5', w12: 'in6' });
  const or = tpl.nodes.find((n) => n.id === 'n_or');
  for (const [wire, port] of portMap) assert.deepEqual(routes.get(wire).pts.at(-1), portAnchor(or, pf(or), port, 'in'), `${wire} lands on ${port}`);
  const wired = new Set(tpl.wires.filter((w) => w.to.node === 'n_or').map((w) => w.to.port));
  assert.deepEqual(new Set(portMap.values()), wired, 'only the inputs that ARE wired change hands');
  // a frozen map (a drag in progress) is drawn as given, never re-solved
  const frozen = new Map([['w12', 'in1'], ['w14', 'in2']]);
  const held = route(tpl, { portMap: frozen });
  assert.equal(held.portMap, frozen);
  assert.deepEqual(held.routes.get('w12').pts.at(-1), portAnchor(or, pf(or), 'in1', 'in'));
  assert.equal(route(tpl, { reorder: false }).portMap.size, 0, 'reorder off draws every wire into its own input');
});

test('a combine card keeps its port order: it concatenates its inputs in that order', () => {
  const tpl = roomy();
  tpl.nodes.find((n) => n.id === 'n_or').kind = 'combine';
  assert.equal(route(tpl).portMap.size, 0);
});

test('deterministic: the same template routes to byte-identical paths', () => {
  const a = route(roomy()).routes;
  const b = route(roomy()).routes;
  for (const [id, r] of a) assert.equal(b.get(id).d, r.d, id);
});

test('loop pills sit on their lane run, clear of every card', () => {
  for (const tpl of [deckTemplate(), roomy()]) {
    const loops = classifyLoops(tpl, pf).loopWireIds;
    const { routes } = route(tpl);
    for (const id of loops) {
      const { pts, mid } = routes.get(id);
      const onRun = pts.slice(1).some((p, i) => p.y === pts[i].y && p.y === mid.y && mid.x > Math.min(p.x, pts[i].x) && mid.x < Math.max(p.x, pts[i].x));
      assert.ok(onRun, `${id} pill ${JSON.stringify(mid)} rides a horizontal run`);
      for (const n of tpl.nodes) {
        const s = nodeSize(n, pf(n), geo);
        const on = mid.x > n.x && mid.x < n.x + s.w && mid.y > n.y - 26 && mid.y < n.y + s.h;
        assert.ok(!on, `${id} pill sits on ${n.id}`);
      }
    }
  }
});

test('routeLanes degrades: no cards, dangling ends, a self loop and stacked duplicates never throw', () => {
  assert.equal(routeLanes([], []).size, 0);
  const cards = [{ id: 'a', x: 0, y: 0, w: 232, h: 100 }, { id: 'b', x: 0, y: 0, w: 232, h: 100 }];
  const out = routeLanes(cards, [
    { id: 'self', from: 'a', to: 'a', a: { x: 232, y: 40 }, b: { x: 0, y: 20 }, loop: true, pill: true },
    { id: 'ghost', from: 'a', to: 'zz', a: { x: 232, y: 40 }, b: { x: 500, y: 20 } },
    { id: 'noanchor', from: 'a', to: 'b', a: null, b: { x: 0, y: 20 } },
    { id: 'stack', from: 'a', to: 'b', a: { x: 232, y: 60 }, b: { x: 0, y: 60 } },
  ]);
  assert.deepEqual([...out.keys()], ['self', 'stack']);
  for (const r of out.values()) assert.equal(r.d.includes('NaN'), false);
  const self = out.get('self').pts;
  assert.ok(Math.max(...self.map((p) => p.y)) > 100, 'a self loop returns under its card');
});
