import { test } from 'node:test';
import assert from 'node:assert/strict';
import { thumbnailSvg } from '../src/shared/graph/thumbnail.mjs';
import { portsFnFor } from '../src/shared/graph/ports.mjs';

const portsFn = portsFnFor({ planner: { key: 'planner',
  inputs: [{ id: 'task', type: 'md', required: true }], outputs: [{ id: 'plan', type: 'md', when: 'always' }] } });
const TPL = { version: 2,
  nodes: [{ id: 'n_task', kind: 'task', x: 60, y: 143, config: {} },
    { id: 'n_plan', kind: 'agent', key: 'planner', x: 400, y: 80, config: {} },
    { id: 'n_end', kind: 'end', x: 760, y: 143, config: {} }],
  wires: [{ id: 'w1', from: { node: 'n_task', port: 'task' }, to: { node: 'n_plan', port: 'task' } },
    { id: 'w2', from: { node: 'n_plan', port: 'plan' }, to: { node: 'n_end', port: 'result' } }] };

test('thumbnailSvg: numbers only, wires under cards, deterministic', () => {
  const svg = thumbnailSvg(TPL, portsFn, { width: 120, height: 64 });
  assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" width="120" height="64"/);
  assert.match(svg, /aria-hidden="true"/);
  assert.equal((svg.match(/<rect /g) || []).length, 3);
  assert.equal((svg.match(/<path /g) || []).length, 2);
  assert.ok(svg.indexOf('<path') < svg.indexOf('<rect'), 'wires paint under the cards');
  for (const secret of ['n_task', 'n_plan', 'planner', 'w1']) {
    assert.equal(svg.includes(secret), false, `"${secret}" must never reach the markup`);
  }
  assert.equal(thumbnailSvg(TPL, portsFn, { width: 120, height: 64 }), svg, 'deterministic');
  assert.equal(svg.includes('fill="none"'), true, 'wire paths never fill');
});

test('thumbnailSvg degrades on empty / dangling input', () => {
  assert.equal(thumbnailSvg({ nodes: [], wires: [] }, portsFn, { width: 40, height: 20 }),
    '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20" viewBox="0 0 40 20" role="img" aria-hidden="true"></svg>');
  const dangling = { version: 2, nodes: TPL.nodes,
    wires: [{ id: 'w9', from: { node: 'ghost', port: 'x' }, to: { node: 'n_end', port: 'result' } }] };
  const svg = thumbnailSvg(dangling, portsFn, {});
  assert.equal((svg.match(/<path /g) || []).length, 0);
  assert.equal(svg.includes('NaN'), false);
});

test('a card astride the corridor detours in the tile, and no vertex is clipped out of it', () => {
  // n_blk straddles the straight y=199 corridor between task and end, so the one
  // wire has to route around it — a rounded corner (Q) is the proof.
  const detour = { version: 2,
    nodes: [{ id: 'n_task', kind: 'task', x: 60, y: 143, config: {} },
      { id: 'n_blk', kind: 'agent', key: 'planner', x: 380, y: 130, config: {} },
      { id: 'n_end', kind: 'end', x: 760, y: 143, config: {} }],
    wires: [{ id: 'w1', from: { node: 'n_task', port: 'task' }, to: { node: 'n_end', port: 'result' } }] };
  const width = 120; const height = 64;
  const svg = thumbnailSvg(detour, portsFn, { width, height });
  assert.equal((svg.match(/<path /g) || []).length, 1, 'exactly ONE path element per wire');
  const d = svg.match(/<path d="([^"]+)"/)[1];
  assert.match(d, / Q /, 'the detour rounds at least one corner');
  assert.equal(d.includes('NaN'), false);
  // Every vertex, through the tile's own <g transform>, lands inside the viewport:
  // the fit bounds unioned the route, so a detour is never clipped away.
  const [, tx, ty, z] = svg.match(/translate\((-?[\d.]+) (-?[\d.]+)\) scale\((-?[\d.]+)\)/).map(Number);
  const nums = d.match(/-?\d+(?:\.\d+)?/g).map(Number);
  for (let i = 0; i < nums.length; i += 2) {
    const sx = nums[i] * z + tx; const sy = nums[i + 1] * z + ty;
    assert.ok(sx >= -0.5 && sx <= width + 0.5, `x ${sx} inside the tile`);
    assert.ok(sy >= -0.5 && sy <= height + 0.5, `y ${sy} inside the tile`);
  }
});

test('malformed nodes/wires entries never throw and never reach the markup', () => {
  // `filter(Boolean)` kept `7` and indexed an id-less node under `undefined`, so
  // a non-object wire found a `from` and threw on `w.from.port` (thumbnail.mjs:32).
  const junk = { version: 2, nodes: [null, 7, {}, ...TPL.nodes], wires: [{}, 'junk', { id: 'w0' }, ...TPL.wires] };
  const svg = thumbnailSvg(junk, portsFn, { width: 120, height: 64 });
  assert.equal((svg.match(/<rect /g) || []).length, 3, 'only the three real cards are drawn');
  assert.equal((svg.match(/<path /g) || []).length, 2);
  assert.equal(svg.includes('NaN'), false);
  assert.equal(svg, thumbnailSvg(TPL, portsFn, { width: 120, height: 64 }));
});
