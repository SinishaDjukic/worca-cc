import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeTemplate, serializeTemplate, newNode, newWire, mintId, canWire,
  removeNode, removeWire, nodeById, wireById,
} from '../src/shared/graph/template.mjs';
import { portsFnFor } from '../src/shared/graph/ports.mjs';

const REG = {
  planner: { key: 'planner', inputs: [{ id: 'task', type: 'md', required: true }],
    outputs: [{ id: 'plan', type: 'md', when: 'always' }] },
  clarify: { key: 'clarify', inputs: [{ id: 'task', type: 'md', required: true }],
    outputs: [{ id: 'answers', type: 'json', when: 'always' }] },
};
const portsFn = portsFnFor(REG);
const tpl = () => normalizeTemplate({
  id: 'wf_t', name: 'T', domain: 'coding',
  nodes: [{ id: 'n_task', kind: 'task', x: 0, y: 0 }, { id: 'n_plan', kind: 'agent', key: 'planner', x: 300, y: 0 },
    { id: 'n_cl', kind: 'agent', key: 'clarify', x: 0, y: 200 }, { id: 'n_or', kind: 'or', x: 600, y: 200, config: { arity: 2 } }],
  wires: [{ id: 'w1', from: { node: 'n_task', port: 'task' }, to: { node: 'n_plan', port: 'task' } }],
});

test('normalizeTemplate coerces shape, keeps unknown config, drops junk', () => {
  const t = normalizeTemplate({ nodes: [{ id: 'a', kind: 'agent', key: 'planner', x: '5', y: 6, config: { zzz: 1 } }, null],
    wires: [{ id: 'w', from: { node: 'a', port: 'plan' }, to: { node: 'b', port: 'task' }, config: {} }, 7],
    canvas: { x: 1, y: 2, zoom: 0.5 } });
  assert.equal(t.version, 2);
  assert.equal(t.nodes.length, 1);
  assert.deepEqual(t.nodes[0], { id: 'a', kind: 'agent', x: 5, y: 6, config: { zzz: 1 }, key: 'planner' });
  assert.equal(t.wires.length, 1);
  assert.equal('config' in t.wires[0], false, 'an empty wire config is dropped');
  assert.deepEqual(t.canvas, { x: 1, y: 2, zoom: 0.5 });
  assert.equal(normalizeTemplate({ canvas: { x: 1, y: 2 } }).canvas, undefined, 'a half-written canvas is dropped');
  assert.equal(normalizeTemplate(null).nodes.length, 0);
  assert.equal(normalizeTemplate({ nodes: [{ id: 'a', kind: 'task', x: 0, y: 0, key: 'planner' }] }).nodes[0].key,
    undefined, 'only agent nodes keep a key (V3)');
});

test('serializeTemplate has a stable key order and round-trips through JSON', () => {
  const a = serializeTemplate(tpl());
  const b = serializeTemplate(normalizeTemplate(JSON.parse(JSON.stringify(a))));
  assert.equal(JSON.stringify(a), JSON.stringify(b));
  assert.deepEqual(Object.keys(a), ['id', 'name', 'version', 'domain', 'nodes', 'wires']);
  assert.deepEqual(Object.keys(a.nodes[1]), ['id', 'kind', 'key', 'x', 'y', 'config']);
  assert.deepEqual(Object.keys(a.wires[0]), ['id', 'from', 'to']);
});

test('mintId: prefix + 8 base36 chars, never a collision with `taken`', () => {
  const id = mintId('n_', new Set());
  assert.match(id, /^n_[0-9a-z]{8}$/);
  const taken = new Set();
  for (let i = 0; i < 200; i += 1) {
    const next = mintId('w_', taken);
    assert.equal(taken.has(next), false);
    taken.add(next);
  }
});

test('newNode / newWire', () => {
  const n = newNode('agent', 'planner', 10, 20);
  assert.match(n.id, /^n_[0-9a-z]{8}$/);
  assert.deepEqual({ kind: n.kind, key: n.key, x: n.x, y: n.y, config: n.config }, { kind: 'agent', key: 'planner', x: 10, y: 20, config: {} });
  assert.equal(newNode('end', null, 0, 0).key, undefined);
  assert.equal(newNode('or', null, 0, 0).config.arity, 2, 'and/or/combine are born with arity 2');
  const w = newWire({ node: 'a', port: 'plan' }, { node: 'b', port: 'task' }, { maxCycles: 3 });
  assert.match(w.id, /^w_[0-9a-z]{8}$/);
  assert.deepEqual(w.config, { maxCycles: 3 });
  assert.equal('config' in newWire({ node: 'a', port: 'p' }, { node: 'b', port: 'q' }), false);
});

test('canWire: legal drop', () => {
  const r = canWire({ tpl: tpl(), portsFn, from: { node: 'n_plan', port: 'plan' }, to: { node: 'n_or', port: 'in1' } });
  assert.deepEqual(r, { ok: true });
});

test('canWire: same node, unknown port, already connected', () => {
  const t = tpl();
  assert.deepEqual(canWire({ tpl: t, portsFn, from: { node: 'n_plan', port: 'plan' }, to: { node: 'n_plan', port: 'task' } }),
    { ok: false, code: 'V0', reason: 'same node' });
  assert.deepEqual(canWire({ tpl: t, portsFn, from: { node: 'n_plan', port: 'nope' }, to: { node: 'n_or', port: 'in1' } }),
    { ok: false, code: 'V5', reason: 'unknown port' });
  assert.deepEqual(canWire({ tpl: t, portsFn, from: { node: 'n_cl', port: 'answers' }, to: { node: 'n_plan', port: 'task' } }),
    { ok: false, code: 'V7', reason: 'already connected' });
});

test('canWire: a self-loop is legal ONLY from a blocking output into a loop input', () => {
  // The seeded refiner: `revise` (when:'blocking') feeds its own `revise` (loop:true).
  const pf = portsFnFor({ ...REG, refiner: { key: 'refiner', verdict: { filename: 'r{cycle}.json' },
    inputs: [{ id: 'plan', type: 'md', required: true }, { id: 'revise', type: 'md', required: false, loop: true }],
    outputs: [{ id: 'plan', type: 'md', when: 'clean' }, { id: 'revise', type: 'md', when: 'blocking' },
      { id: 'verdict', type: 'json', when: 'blocking' }] } });
  const t = tpl();
  t.nodes.push({ id: 'n_ref', kind: 'agent', key: 'refiner', x: 900, y: 0, config: {} });
  const self = (from, to) => canWire({ tpl: t, portsFn: pf, from: { node: 'n_ref', port: from }, to: { node: 'n_ref', port: to } });
  assert.deepEqual(self('revise', 'revise'), { ok: true }, 'blocking → loop on the same card');
  assert.deepEqual(self('plan', 'revise'), { ok: false, code: 'V0', reason: 'same node' }, 'a clean output never loops');
  assert.deepEqual(self('revise', 'plan'), { ok: false, code: 'V0', reason: 'same node' }, 'a non-loop input never receives itself');
  assert.deepEqual(self('verdict', 'revise'), { ok: false, code: 'V8', reason: 'json → md type mismatch' }, 'types still apply');
  t.wires.push(newWire({ node: 'n_ref', port: 'revise' }, { node: 'n_ref', port: 'revise' }));
  assert.deepEqual(self('revise', 'revise'), { ok: false, code: 'V7', reason: 'already connected' }, 'single-wire wins once wired');
});

test('canWire: type mismatch, and `any` inputs accept everything', () => {
  const t = tpl();
  t.nodes.push({ id: 'n_p2', kind: 'agent', key: 'planner', x: 900, y: 0, config: {} });
  assert.deepEqual(canWire({ tpl: t, portsFn, from: { node: 'n_cl', port: 'answers' }, to: { node: 'n_p2', port: 'task' } }),
    { ok: false, code: 'V8', reason: 'json → md type mismatch' });
  assert.equal(canWire({ tpl: t, portsFn, from: { node: 'n_cl', port: 'answers' }, to: { node: 'n_p2', port: 'await' } }).ok, true);
});

test('canWire: or homogeneity mirrors V8/V12', () => {
  const t = tpl();
  t.wires.push(newWire({ node: 'n_plan', port: 'plan' }, { node: 'n_or', port: 'in1' }));
  assert.deepEqual(canWire({ tpl: t, portsFn, from: { node: 'n_cl', port: 'answers' }, to: { node: 'n_or', port: 'in2' } }),
    { ok: false, code: 'V12', reason: 'or inputs must match: md' });
});

test('removeNode drops the node AND its wires; removeWire drops one wire', () => {
  const t = removeNode(tpl(), 'n_plan');
  assert.equal(nodeById(t, 'n_plan'), null);
  assert.deepEqual(t.wires, []);
  const w = removeWire(tpl(), 'w1');
  assert.equal(wireById(w, 'w1'), null);
  assert.equal(w.nodes.length, 4);
  assert.equal(removeNode(tpl(), 'ghost').nodes.length, 4, 'removing an unknown id is a no-op');
});

test('nodeById / wireById', () => {
  assert.equal(nodeById(tpl(), 'n_or').kind, 'or');
  assert.equal(wireById(tpl(), 'w1').to.port, 'task');
  assert.equal(nodeById(null, 'x'), null);
});
