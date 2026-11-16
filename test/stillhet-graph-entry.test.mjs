// test/stillhet-graph-entry.test.mjs — the live graph is drawn exactly as the demo one (Stillhet slice 7 D5): dev's
// template through fromTpl gives the build path's template, ports and agents, with and without Auto-align. The pixel
// compare proves the demo drawing; this equality carries it to live templates.
import { test } from 'node:test';
import assert from 'node:assert/strict';

globalThis.window = globalThis.window || {};
await import('../ui/public/stillhet/graph/graph-entry.mjs');
const G = globalThis.window.RailGraph;

// the demo security-first record (workflows/workflows.js data.workflow)
const wf = { id: 'security-first', title: 'Security-first review', steps: [['Plan', 'planner', 'Opus 5.5', 'high', 3, 0.40], ['Build', 'implementer', 'Sonnet 5.5', 'high', 9, 0.31], ['Security check', 'security', 'Opus 5.5', 'high', 4, 0.19], ['Review', 'reviewer', 'Opus 5.5', 'medium', 2, 0.12]], loops: [['Security check', 'Build', 2]] };
const ports = (g) => g.tpl.nodes.map((n) => g.portsFn(n));

for (const aligned of [false, true]) {
  test(`fromTpl on build(wf).tpl equals the build path${aligned ? ' after Auto-align' : ''}`, () => {
    let a = G.build(wf), b = G.fromTpl({ ...wf, tpl: G.build(wf).tpl, agentsByKey: G.demo(wf).agentsByKey });
    if (aligned) { a = G.align(a); b = G.align(b); }
    assert.deepEqual(b.tpl, a.tpl);
    assert.deepEqual(ports(b), ports(a));
    assert.deepEqual(b.agents, a.agents);
  });
}

test('fromTpl reads a live template\'s stored positions and its agents\' descriptions', () => {
  const { tpl, agentsByKey } = G.demo(wf);
  for (const k of Object.keys(agentsByKey)) agentsByKey[k].description = `does ${k}`;
  const g = G.fromTpl({ tpl, agentsByKey });
  assert.deepEqual(g.tpl.nodes.map((n) => [n.id, n.x, n.y]), tpl.nodes.map((n) => [n.id, n.x, n.y]));
  assert.equal(g.agents.s0.description, 'does s0');
  assert.equal(G.fromTpl({ tpl, agentsByKey }, (k) => `says ${k}`).agents.s1.description, 'says s1');
});

// V-TW-09: a fit never goes below READABLE_FIT; a wider graph scrolls sideways in its well
const { JSDOM } = await import('jsdom');
const { READABLE_FIT } = await import('../ui/public/graph/view.mjs');
const stepsOf = (n) => Array.from({ length: n }, (_, i) => [`Step ${i + 1}`, 'planner', 'Sonnet 5.5', 'high', 3, 0.1]);
const wide = { id: 'wide', title: 'Wide', steps: stepsOf(14), loops: [] };
const hostOf = () => new JSDOM('<!doctype html><div id="h"></div>').window.document.getElementById('h');

test('V-TW-09: RailGraph.mount of a 14-step demo workflow at 900px opens at READABLE_FIT, the well scrolls, fit is 0.82 and whole the unfloored zoom', () => {
  const host = hostOf();
  const { view, fit, whole } = G.mount(host, wide, { width: 900 });
  assert.equal(fit, READABLE_FIT);
  assert.equal(whole, 900 / view.bounds(60).w);
  assert.ok(whole < READABLE_FIT);
  assert.equal(view.getTransform().z, READABLE_FIT);
  assert.equal(host.style.overflowX, 'auto', 'the well scrolls sideways');
  assert.ok(parseFloat(view.stage.style.width) > 900, 'the drawing is wider than the well');
  assert.equal(host.style.width, '', 'the detail well keeps its width');
});

test('V-TW-09: an explicit zoom below the floor (the editor\'s Zoom out) is drawn at that zoom', () => {
  const host = hostOf();
  const { view, fit, whole } = G.mount(host, wide, { width: 900, zoom: 0.42, mode: 'edit' });
  assert.equal(view.fitFloor, null);
  assert.ok(Math.abs(view.getTransform().z - 0.42) < 0.005, `z ${view.getTransform().z}`);
  assert.equal(fit, READABLE_FIT, 'fit stays the floored fit');
  assert.ok(whole < 0.42);
  assert.equal(host.style.overflowX, '');
  const opened = G.mount(hostOf(), wide, { width: 900, zoom: 0, mode: 'edit' });
  const z0 = opened.view.getTransform().z;
  assert.ok(z0 >= READABLE_FIT && z0 < READABLE_FIT + 0.005, `the editor opens at the floor: ${z0}`);
});

test('V-TW-09: the editor\'s Zoom out to whole (below the edit view\'s 0.4 minimum) draws the whole graph in the host', () => {
  const host = hostOf();
  const { whole } = G.mount(hostOf(), wide, { width: 900 });
  assert.ok(whole < 0.4, `the 14-step workflow at 900px needs a zoom below 0.4: ${whole}`);
  const { view } = G.mount(host, wide, { width: 900, zoom: whole, mode: 'edit' });
  const z = view.getTransform().z;
  assert.ok(Math.abs(z - whole) < 0.005, `drawn at whole: z ${z}, whole ${whole}`);
  const hostW = parseFloat(host.style.width);
  assert.ok(view.bounds(60).w * z <= hostW + 1, `the drawing (${view.bounds(60).w * z}px) fits the host (${hostW}px)`);
});

test('a floored mount followed by one that fits, on the same host, leaves no sideways scroll behind', () => {
  const host = hostOf();
  G.mount(host, wide, { width: 900 });
  assert.equal(host.style.overflowX, 'auto');
  G.mount(host, wf, { width: 1600 });
  assert.equal(host.style.overflowX, '');
});

test('a graph that fits (4 steps at 1600px) draws as before: fit === whole, no overflow', () => {
  const host = hostOf();
  const { view, fit, whole } = G.mount(host, wf, { width: 1600 });
  assert.equal(fit, whole);
  assert.ok(fit >= READABLE_FIT);
  assert.equal(view.getTransform().z, fit);
  assert.equal(host.style.overflowX, '');
  assert.equal(view.stage.style.width, '');
});
