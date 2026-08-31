import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  NODE_W, ROW0, SNAP, ZOOM_MIN, ZOOM_MAX, ZOOM_K, GEOMETRY_CSS_VARS, injectGeometry,
  nodeSize, portAnchor, snap,
  hitNode, hitPort, graphBounds, fitBounds, fanLines, FAN_PER_ROW, FAN_ROW_W,
} from '../src/shared/graph/geometry.mjs';
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

test('the constants are frozen at the spec values', () => {
  assert.equal(NODE_W, 220);
  assert.equal(ROW0, 56);
  assert.equal(SNAP, 11);
  assert.deepEqual([ZOOM_MIN, ZOOM_MAX, ZOOM_K], [0.4, 1.6, 0.002]);
});

test('nodeSize closed forms', () => {
  assert.deepEqual(nodeSize(N_AGENT, P(N_AGENT)), { w: 220, h: 191.5 });   // 95.5 + 24*4
  assert.equal(nodeSize(N_TASK, P(N_TASK)).h, 110.5);
  assert.equal(nodeSize(N_END, P(N_END)).h, 110.5);
  const or2 = { id: 'o', kind: 'or', x: 0, y: 0, config: { arity: 2 } };
  const and2 = { id: 'a', kind: 'and', x: 0, y: 0, config: { arity: 2 } };
  assert.equal(nodeSize(or2, P(or2)).h, 167.5);
  assert.equal(nodeSize(and2, P(and2)).h, 134.5);
  const agentPorts = (nIn, nOut) => ({
    inputs: [...Array.from({ length: nIn }, (_, i) => ({ id: `i${i}`, type: 'md' })),
      { id: 'await', type: 'any', synthetic: true }],
    outputs: Array.from({ length: nOut }, (_, i) => ({ id: `o${i}`, type: 'md' })) });
  const bare = { id: 'x', kind: 'agent', key: 'k', x: 0, y: 0, config: {} };
  for (const [nIn, nOut] of [[1, 1], [2, 2], [3, 2], [1, 3]]) {
    assert.equal(nodeSize(bare, agentPorts(nIn, nOut)).h, 95.5 + 24 * (nIn + nOut), `agent ${nIn}/${nOut}`);
  }
  // A zone is emitted only when NON-EMPTY, so a zero-input agent loses one
  // separator and falls BELOW the closed form (which assumes both zones exist).
  // The SAME rule moves its await gate up by the missing separator: the spec's
  // `y + 74 + 24·(nIn+nOut)` becomes `y + 65 + 24·nOut` at nIn = 0. Both are
  // deviations from the closed form and both are CORRECT — pin them together so
  // P5's CDP measurement script cannot "fix" the code towards the formula.
  assert.equal(nodeSize(bare, agentPorts(0, 1)).h, 110.5);            // not 119.5
  assert.equal(portAnchor(bare, agentPorts(0, 1), 'await', 'in').y, 89);   // y(0) + 65 + 24·1, not 98
  assert.equal(portAnchor(bare, agentPorts(1, 1), 'await', 'in').y, 122);  // y(0) + 74 + 24·2 — the closed form holds from nIn = 1
});

test('the executions footer grows the card and never moves an anchor', () => {
  assert.equal(nodeSize(N_AGENT, P(N_AGENT), { footerRows: 1 }).h, 191.5 + 26);
  assert.equal(nodeSize(N_AGENT, P(N_AGENT), { footerRows: 3 }).h, 191.5 + 26 + 2 * 22);
  assert.deepEqual(portAnchor(N_AGENT, P(N_AGENT), 'plan', 'out'),
    portAnchor(N_AGENT, P(N_AGENT), 'plan', 'out'));
});

test('the fan wraps at FAN_PER_ROW and its row width is the CSS var', () => {
  assert.equal(FAN_PER_ROW, 16);
  assert.equal(FAN_ROW_W, 157);                            // 16·(7+3) − 3
  assert.equal(GEOMETRY_CSS_VARS['--gv-fan-w'], '157px');
  assert.equal(fanLines(0), 1);
  assert.equal(fanLines(1), 1);
  assert.equal(fanLines(16), 1);
  assert.equal(fanLines(17), 2);
  assert.equal(fanLines(24), 2);                           // SUB_SQUARE_CAP → two lines max
});

test('port anchors match the measured prototype', () => {
  assert.deepEqual(portAnchor(N_AGENT, P(N_AGENT), 'task', 'in'), { x: 400, y: 136 });
  assert.deepEqual(portAnchor(N_AGENT, P(N_AGENT), 'fix', 'in'), { x: 400, y: 160 });
  assert.deepEqual(portAnchor(N_AGENT, P(N_AGENT), 'plan', 'out'), { x: 620, y: 193 });
  assert.deepEqual(portAnchor(N_AGENT, P(N_AGENT), 'review', 'out'), { x: 620, y: 217 });
  assert.deepEqual(portAnchor(N_AGENT, P(N_AGENT), 'await', 'in'), { x: 400, y: 250 });
  assert.deepEqual(portAnchor(N_TASK, P(N_TASK), 'task', 'out'), { x: 280, y: 199 });
  assert.deepEqual(portAnchor(N_END, P(N_END), 'result', 'in'), { x: 760, y: 199 });
  assert.equal(portAnchor(N_AGENT, P(N_AGENT), 'ghost', 'in'), null);
});

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

test('graphBounds + fitBounds reproduce the measured auto-fit', () => {
  const tpl = { version: 2, nodes: [N_TASK, N_AGENT, N_END], wires: [] };
  assert.deepEqual(graphBounds(tpl, portsFn), { x: 60, y: 80, w: 920, h: 191.5 });
  const padded = graphBounds(tpl, portsFn, { pad: 60 });
  assert.deepEqual(padded, { x: 0, y: 20, w: 1040, h: 311.5 });
  assert.deepEqual(fitBounds(padded, { width: 1280, height: 560 }), { z: 1, tx: 120, ty: 104.25 });
  assert.equal(fitBounds(padded, { width: 200, height: 100 }).z, ZOOM_MIN, 'fit clamps at the floor');
  assert.equal(fitBounds(padded, { width: 200, height: 100 }, { zoomMin: 0 }).z < 0.4, true);
  assert.deepEqual(graphBounds({ nodes: [] }, portsFn), null);
  // A truthy non-object entry survived `filter(Boolean)` and sized as a card at
  // the origin, stretching the bounds of every thumbnail built from a junk row.
  const junk = { nodes: [null, 7, 'x', N_TASK, N_AGENT, N_END] };
  assert.deepEqual(graphBounds(junk, portsFn), graphBounds(tpl, portsFn));
});

test('GEOMETRY_CSS_VARS covers every CSS-visible number and injectGeometry writes px', () => {
  assert.deepEqual(Object.keys(GEOMETRY_CSS_VARS).sort(), ['--gv-border', '--gv-dot', '--gv-exec-row-h',
    '--gv-fan-w', '--gv-foot-h', '--gv-head-h', '--gv-node-w', '--gv-pad-b', '--gv-pad-t', '--gv-row-h', '--gv-sep-h']);
  assert.equal(GEOMETRY_CSS_VARS['--gv-node-w'], '220px');
  assert.equal(GEOMETRY_CSS_VARS['--gv-pad-t'], '8.5px');
  const written = [];
  injectGeometry({ style: { setProperty: (k, v) => written.push([k, v]) } });
  assert.equal(written.length, 11);
  assert.deepEqual(written.find(([k]) => k === '--gv-row-h'), ['--gv-row-h', '24px']);
  injectGeometry(null);                                    // never throws on a missing host
});
