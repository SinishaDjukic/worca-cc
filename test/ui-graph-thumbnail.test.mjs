// test/ui-graph-thumbnail.test.mjs
// thumbnail.mjs turns a v2 template into a mini-SVG STRING — the saved-template
// rows render it inline, so it must be pure, deterministic and safe to drop into
// innerHTML (numbers only; no author-controlled text reaches the markup).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FIXTURE_DEFAULT, FIXTURE_FLOW, FIXTURE_PORTS } from '../src/core/graph/fixtures.mjs';
import { portsFnFor } from '../ui/public/graph/graph-model.mjs';
import { thumbnail } from '../ui/public/graph/thumbnail.mjs';

const ports = portsFnFor(FIXTURE_PORTS);
const count = (svg, needle) => svg.split(needle).length - 1;

test('returns an <svg> string with one rect per node and one path per wire', () => {
  const svg = thumbnail(FIXTURE_DEFAULT, ports);
  assert.equal(typeof svg, 'string');
  assert.ok(svg.startsWith('<svg'), svg.slice(0, 40));
  assert.ok(svg.endsWith('</svg>'));
  assert.equal(count(svg, '<rect'), FIXTURE_DEFAULT.nodes.length);
  assert.equal(count(svg, '<path'), FIXTURE_DEFAULT.wires.length);
});

test('the flow fixture keeps its own node count', () => {
  const svg = thumbnail(FIXTURE_FLOW, ports);
  assert.equal(count(svg, '<rect'), FIXTURE_FLOW.nodes.length);
  assert.equal(count(svg, '<path'), FIXTURE_FLOW.wires.length);
});

test('honours the requested box and is deterministic', () => {
  const svg = thumbnail(FIXTURE_DEFAULT, ports, { width: 96, height: 48 });
  assert.ok(svg.includes('width="96"'));
  assert.ok(svg.includes('height="48"'));
  assert.ok(svg.includes('viewBox="0 0 96 48"'));
  assert.equal(svg, thumbnail(FIXTURE_DEFAULT, ports, { width: 96, height: 48 }));
});

test('every coordinate stays inside the box', () => {
  const svg = thumbnail(FIXTURE_FLOW, ports, { width: 120, height: 64 });
  for (const m of svg.matchAll(/<rect x="(-?[\d.]+)" y="(-?[\d.]+)" width="([\d.]+)" height="([\d.]+)"/g)) {
    const [x, y, w, h] = m.slice(1).map(Number);
    assert.ok(x >= 0 && y >= 0, `origin ${x},${y}`);
    assert.ok(x + w <= 120.001 && y + h <= 64.001, `extent ${x + w},${y + h}`);
  }
});

test('a template with no nodes renders an empty frame rather than throwing', () => {
  const svg = thumbnail({ nodes: [], wires: [] }, ports);
  assert.ok(svg.startsWith('<svg'));
  assert.equal(count(svg, '<rect'), 0);
  assert.equal(count(svg, '<path'), 0);
  assert.equal(thumbnail(null, ports), thumbnail({ nodes: [], wires: [] }, ports));
});

test('a single node is centred rather than divided by a zero span', () => {
  const one = { nodes: [{ id: 'n_task', kind: 'task', x: 900, y: -400, config: {} }], wires: [] };
  const svg = thumbnail(one, ports, { width: 100, height: 50 });
  assert.equal(count(svg, '<rect'), 1);
  assert.equal(/NaN|Infinity/.test(svg), false, svg);
});

test('a wire with a dangling endpoint is dropped, not drawn as NaN', () => {
  const dangling = {
    nodes: FIXTURE_DEFAULT.nodes,
    wires: [...FIXTURE_DEFAULT.wires, { id: 'wx', from: { node: 'n_ghost', port: 'x' }, to: { node: 'n_end', port: 'result' } }],
  };
  const svg = thumbnail(dangling, ports);
  assert.equal(count(svg, '<path'), FIXTURE_DEFAULT.wires.length);
  assert.equal(/NaN/.test(svg), false);
});
