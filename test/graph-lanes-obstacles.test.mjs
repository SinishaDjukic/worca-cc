// test/graph-lanes-obstacles.test.mjs — a session header strip is an obstacle every lane clears.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { routeGraph } from '../src/shared/graph/lanes.mjs';
import { autoLayout } from '../src/shared/graph/layout.mjs';
import { classifyLoops } from '../src/shared/graph/loops.mjs';
import { nodeSize, portAnchor } from '../src/shared/graph/geometry.mjs';
import { portsOf } from '../src/shared/graph/ports.mjs';
import { SEED_TEMPLATES } from '../src/core/graph/seed-templates.mjs';
import { realPortsFn } from './helpers/graph-ports.mjs';

const portsFn = realPortsFn();
function laid() {
  const t = structuredClone(SEED_TEMPLATES.find((s) => s.id === 'wf_no-clarify'));
  const pos = autoLayout(t, portsFn, { describe: true });
  for (const n of t.nodes) Object.assign(n, pos[n.id]);
  return t;
}
const opts = (t, obstacles) => ({
  sizeOf: (n) => nodeSize(n, portsOf(portsFn, n), { describe: true }),
  anchorOf: (n, port, dir) => portAnchor(n, portsOf(portsFn, n), port, dir),
  loopWireIds: classifyLoops(t, portsFn).loopWireIds, obstacles,
});
// The header strip of [n_impl, n_review]: x from Impl − 12 to Review right + 12, 24 high, 4 above the label rows.
function head(t) {
  const [a, b] = ['n_impl', 'n_review'].map((id) => t.nodes.find((n) => n.id === id));
  const w = nodeSize(b, portsOf(portsFn, b), { describe: true }).w;
  const top = Math.min(a.y, b.y) - 26 - 4 - 24;
  return { id: 's_aaaaaaaa', x: a.x - 12, y: top, w: b.x + w + 12 - (a.x - 12), h: 24 };
}
const crosses = (pts, r) => pts.some((p, i) => i > 0 && p.y === pts[i - 1].y && p.y > r.y && p.y < r.y + r.h
  && Math.max(p.x, pts[i - 1].x) > r.x && Math.min(p.x, pts[i - 1].x) < r.x + r.w);

test('no obstacles: byte-identical to the router without the option', () => {
  const t = laid();
  const a = routeGraph(t, opts(t, undefined)).routes;
  const b = routeGraph(t, opts(t, [])).routes;
  assert.deepEqual([...a].map(([k, v]) => [k, v.d]), [...b].map(([k, v]) => [k, v.d]));
});

test('without the obstacle some lane runs through the header band; with it, none does', () => {
  const t = laid(); const h = head(t);
  const bare = [...routeGraph(t, opts(t, [])).routes.values()];
  assert.ok(bare.some((r) => crosses(r.pts, h)), 'the test bites: a lane crosses the band today');
  const with_ = [...routeGraph(t, opts(t, [h])).routes.values()];
  assert.deepEqual(with_.filter((r) => crosses(r.pts, h)).length, 0);
});

test('a loop keeps the floor: "above the cards" is judged on the cards, never on an obstacle', () => {
  const t = structuredClone(SEED_TEMPLATES.find((s) => s.id === 'wf_quick-fix'));
  const pos = autoLayout(t, portsFn, { describe: true });
  for (const n of t.nodes) Object.assign(n, pos[n.id]);
  const ds = (routes) => [...routes].map(([k, v]) => [k, v.d]);
  const far = { id: 's_far00000', x: 0, y: -5000, w: 5000, h: 24 };
  assert.deepEqual(ds(routeGraph(t, opts(t, [far])).routes), ds(routeGraph(t, opts(t, [])).routes), 'a box far above moves no route');
  // Implementation, Review and End dragged 300 down: the strip of [Plan, Implementation] closes a band above them,
  // and the review loop (w5) must not take it over its floor.
  for (const id of ['n_impl', 'n_review', 'n_end']) t.nodes.find((n) => n.id === id).y += 300;
  const [p, i] = ['n_plan', 'n_impl'].map((id) => t.nodes.find((n) => n.id === id));
  const x = p.x - 12;
  const strip = { id: 's_aaaaaaaa', x, y: Math.min(p.y, i.y) - 26 - 4 - 24, w: i.x + nodeSize(i, portsOf(portsFn, i), { describe: true }).w + 12 - x, h: 24 };
  assert.equal(routeGraph(t, opts(t, [strip])).routes.get('w5').d, routeGraph(t, opts(t, [])).routes.get('w5').d);
});
