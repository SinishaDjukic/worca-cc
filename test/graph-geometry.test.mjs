import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { NODE_W, LABEL_H, ROW_H, SEP_H, PAD_T, PAD_B, CAP_H, DESC_H, BAND_H, FOOT_H, EXEC_ROW_H, ROW0,
  ZOOM_MIN, GEOMETRY_CSS_VARS, injectGeometry, snap, hitNode, hitPort, fitBounds,
  nodeSize, portAnchor, graphBounds, geometryCssVars } from '../src/shared/graph/geometry.mjs';
import { portsFnFor } from '../src/shared/graph/ports.mjs';

// The reference prototype's 3-card scene (the 2026-08-26 CDP measurement).
const REG = { planner: { key: 'planner',
  inputs: [{ id: 'task', type: 'md' }, { id: 'fix', type: 'md' }],
  outputs: [{ id: 'plan', type: 'md' }, { id: 'review', type: 'json', when: 'blocking' }] } };
const portsFn = portsFnFor(REG);
const N_TASK = { id: 'n_task', kind: 'task', x: 60, y: 143, config: {} };
const N_AGENT = { id: 'n_agent', kind: 'agent', key: 'planner', x: 400, y: 80, config: {} };
const N_END = { id: 'n_end', kind: 'end', x: 760, y: 143, config: {} };
const P = (n) => portsFn(n);

test('hit tests', () => {
  const size = nodeSize(N_AGENT, P(N_AGENT));
  assert.equal(hitNode(N_AGENT, size, { x: 410, y: 90 }), true);
  assert.equal(hitNode(N_AGENT, size, { x: 399, y: 90 }), false);
  assert.equal(hitNode(N_AGENT, size, { x: 410, y: 400 }), false);
  assert.equal(hitPort({ x: 400, y: 136 }, { x: 410, y: 141 }), true);
  assert.equal(hitPort({ x: 400, y: 136 }, { x: 420, y: 136 }), false);
  // wire hit testing lives in route.mjs now (hitRoute) — see test/graph-route.test.mjs
});

test('snap rounds to the 11px half-grid', () => {
  assert.equal(snap(0), 0);
  assert.equal(snap(5), 0);
  assert.equal(snap(6), 11);
  assert.equal(snap(-6), -11);
  assert.equal(snap(100, 10), 100);
});

const AGENT = { id: 'n_a', kind: 'agent', key: 'planner', x: 100, y: 200, config: {} };
const AGENT_PORTS = {
  inputs: [{ id: 'task', type: 'md' }, { id: 'answers', type: 'json' }, { id: 'await', type: 'any', synthetic: true }],
  outputs: [{ id: 'plan', type: 'md' }],
};
const TASK = { id: 'n_t', kind: 'task', x: 0, y: 0, config: {} };
const TASK_PORTS = { inputs: [], outputs: [{ id: 'task', type: 'md' }] };

test('mockup numbers: 232 wide, 22px rows, 6px pads, 9px zone gap, label row 26 above, ROW0 17', () => {
  assert.deepEqual([NODE_W, ROW_H, SEP_H, PAD_T, PAD_B, LABEL_H, CAP_H, DESC_H, BAND_H, FOOT_H, EXEC_ROW_H, ROW0],
    [232, 22, 9, 6, 6, 26, 27, 46, 24, 26, 22, 17]);
});

test('nodeSize: inputs (await last) · gap · outputs; caption on flow cards; description only when describe', () => {
  assert.deepEqual(nodeSize(AGENT, AGENT_PORTS), { w: 232, h: 6 + 3 * 22 + 9 + 22 + 6 });            // 109
  assert.equal(nodeSize(AGENT, AGENT_PORTS, { describe: true }).h, 109 + 46);
  assert.equal(nodeSize(TASK, TASK_PORTS).h, 6 + 22 + 6 + 27, 'Task = 61 (mockup)');
  assert.equal(nodeSize(TASK, TASK_PORTS, { describe: true }).h, 61, 'describe never touches a flow card');
  assert.equal(nodeSize(AGENT, AGENT_PORTS, { band: true }).h, 109 + 24);
  assert.equal(nodeSize(AGENT, AGENT_PORTS, { footerRows: 2 }).h, 109 + 26 + 22);
  assert.deepEqual(nodeSize(AGENT, AGENT_PORTS, { scale: 0.5 }), { w: 116, h: 54.5 });
});

test('portAnchor: inputs on the left edge from y+17, the await gate after the meta inputs, outputs after the gap', () => {
  assert.deepEqual(portAnchor(AGENT, AGENT_PORTS, 'task', 'in'), { x: 100, y: 217 });
  assert.deepEqual(portAnchor(AGENT, AGENT_PORTS, 'answers', 'in'), { x: 100, y: 239 });
  assert.deepEqual(portAnchor(AGENT, AGENT_PORTS, 'await', 'in'), { x: 100, y: 261 });
  assert.deepEqual(portAnchor(AGENT, AGENT_PORTS, 'plan', 'out'), { x: 332, y: 200 + 17 + 3 * 22 + 9 });
  assert.deepEqual(portAnchor(AGENT, AGENT_PORTS, 'task', 'in', { band: true }), { x: 100, y: 241 });
  assert.equal(portAnchor(AGENT, AGENT_PORTS, 'nope', 'out'), null);
  assert.deepEqual(portAnchor(TASK, TASK_PORTS, 'task', 'out'), { x: 232, y: 17 });
});

test('graphBounds reaches up over the label row', () => {
  const b = graphBounds({ nodes: [TASK] }, () => TASK_PORTS);
  assert.deepEqual(b, { x: 0, y: -26, w: 232, h: 26 + 61 });
});

test('the CSS variable set: label/cap/desc replace the old head height', () => {
  const v = geometryCssVars(1);
  assert.equal(v['--gv-label-h'], '26px');
  assert.equal(v['--gv-cap-h'], '27px');
  assert.equal(v['--gv-desc-h'], '46px');
  assert.equal(v['--gv-border'], '0px');
  assert.equal('--gv-head-h' in v, false);
});

test('graphBounds + fitBounds: the union of the boxes AND their label rows; fit centres, clamps at the floor, never magnifies', () => {
  const tpl = { version: 2, nodes: [N_TASK, N_AGENT, N_END], wires: [] };
  const b = graphBounds(tpl, portsFn);
  const bottom = Math.max(N_AGENT.y + nodeSize(N_AGENT, P(N_AGENT)).h, N_END.y + nodeSize(N_END, P(N_END)).h);
  assert.deepEqual(b, { x: 60, y: 80 - LABEL_H, w: 760 + NODE_W - 60, h: bottom - (80 - LABEL_H) });
  const padded = graphBounds(tpl, portsFn, { pad: 60 });
  assert.deepEqual(padded, { x: b.x - 60, y: b.y - 60, w: b.w + 120, h: b.h + 120 });
  assert.deepEqual(fitBounds(padded, { width: 1280, height: 560 }), { z: 1, tx: (1280 - padded.w) / 2 - padded.x, ty: (560 - padded.h) / 2 - padded.y });
  assert.deepEqual(fitBounds(b, { width: 1280, height: 560 }), { z: 1, tx: (1280 - b.w) / 2 - b.x, ty: (560 - b.h) / 2 - b.y }, 'centred on the box, not on the origin');
  assert.equal(fitBounds(padded, { width: 200, height: 100 }).z, ZOOM_MIN, 'fit clamps at the floor');
  assert.equal(fitBounds(padded, { width: 200, height: 100 }, { zoomMin: 0 }).z < 0.4, true);
  assert.deepEqual(graphBounds({ nodes: [] }, portsFn), null);
  // A truthy non-object entry must never size as a card at the origin.
  const junk = { nodes: [null, 7, 'x', N_TASK, N_AGENT, N_END] };
  assert.deepEqual(graphBounds(junk, portsFn), graphBounds(tpl, portsFn));
});

test('geometryCssVars(scale) scales the px vars and keeps one key set; injectGeometry(el, scale) writes them', () => {
  const one = geometryCssVars(1);
  assert.equal(one['--gv-node-w'], `${NODE_W}px`);
  assert.equal(one['--gv-scale'], '1');
  assert.deepEqual(GEOMETRY_CSS_VARS, one, 'the frozen constant is scale 1');
  const s = geometryCssVars(0.65);
  assert.equal(s['--gv-node-w'], '150.8px');
  assert.equal(s['--gv-label-h'], '16.9px');
  assert.equal(s['--gv-scale'], '0.65');
  assert.deepEqual(Object.keys(s), Object.keys(one), 'same key set at every scale (ui-graph-css pins the set)');
  const dom = new JSDOM('<!doctype html><body><div id="s"></div></body>');
  const el = dom.window.document.getElementById('s');
  injectGeometry(el, 0.65);
  assert.equal(el.style.getPropertyValue('--gv-node-w'), '150.8px');
  assert.equal(el.style.getPropertyValue('--gv-scale'), '0.65');
});
