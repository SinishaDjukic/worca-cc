// test/ui-graph-model.test.mjs
// graph-model.mjs is the composer's model layer: v2 normalize/serialize, the
// node/wire factory, client-side wiring legality (canWire), and the POLICY-
// SANCTIONED COPIES of the engine's pure functions — ui/public cannot import
// src/core (no build step), so the SCC/loop classifier, resolveOrOutType, the
// await port, the flow-port synthesis and validateGraph are duplicated here and
// held byte-identical by the drift guards below, then re-asserted against the
// SAME engine fixtures. The server stays authoritative via /api validation.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  FIXTURE_DEFAULT, FIXTURE_FLOW, FIXTURE_PORTS,
  AWAIT_PORT as ENGINE_AWAIT_PORT, portsFnFor as enginePortsFnFor,
} from '../src/core/graph/fixtures.mjs';
import { classifyLoops as engineClassifyLoops, resolveOrOutType as engineResolveOrOutType } from '../src/core/graph/ports.mjs';
import { validateGraph as engineValidateGraph } from '../src/core/graph/validate.mjs';
import {
  AWAIT_PORT, portsFnFor, classifyLoops, resolveOrOutType, validateGraph,
  normalizeTemplate, serializeTemplate, newNode, newWire, canWire,
} from '../ui/public/graph/graph-model.mjs';

const ports = portsFnFor(FIXTURE_PORTS);
const sorted = (set) => [...set].sort();
const nodeOf = (template, id) => template.nodes.find((n) => n.id === id);

/** A scratch template the legality matrix wires into. Only `w1` exists up front,
 *  so every other input below is genuinely unwired. */
const LEGAL = {
  id: 'wf_legal',
  name: 'Legality',
  version: 2,
  domain: 'coding',
  nodes: [
    { id: 'n_task', kind: 'task', x: 0, y: 0, config: {} },
    { id: 'n_clarify', kind: 'agent', key: 'clarify', x: 300, y: 300, config: {} },
    { id: 'n_plan', kind: 'agent', key: 'planner', x: 300, y: 0, config: {} },
    { id: 'n_impl', kind: 'agent', key: 'implementer', x: 600, y: 0, config: {} },
    { id: 'n_review', kind: 'agent', key: 'reviewer', x: 900, y: 0, config: {} },
    { id: 'n_or', kind: 'or', x: 600, y: 400, config: { arity: 2 } },
    { id: 'n_and', kind: 'and', x: 900, y: 400, config: { arity: 2 } },
    { id: 'n_end', kind: 'end', x: 1200, y: 0, config: {} },
  ],
  wires: [
    { id: 'w1', from: { node: 'n_task', port: 'task' }, to: { node: 'n_plan', port: 'task' } },
  ],
};

const withWires = (extra) => ({ ...LEGAL, wires: [...LEGAL.wires, ...extra] });
const wire = (id, fromNode, fromPort, toNode, toPort) =>
  ({ id, from: { node: fromNode, port: fromPort }, to: { node: toNode, port: toPort } });
const drop = (template, fromNode, fromPort, toNode, toPort) =>
  canWire({ template, portsFn: ports, from: { node: fromNode, port: fromPort }, to: { node: toNode, port: toPort } });

// --------------------------------------------------------- byte-identity guards

test('the client copies are BYTE-IDENTICAL to the engine originals', () => {
  assert.equal(classifyLoops.toString(), engineClassifyLoops.toString());
  assert.equal(resolveOrOutType.toString(), engineResolveOrOutType.toString());
  assert.equal(validateGraph.toString(), engineValidateGraph.toString());
  assert.equal(portsFnFor.toString(), enginePortsFnFor.toString());
});

test('AWAIT_PORT mirrors the engine constant, frozen', () => {
  assert.deepEqual(AWAIT_PORT, ENGINE_AWAIT_PORT);
  assert.deepEqual(AWAIT_PORT, { id: 'await', type: 'any', required: false, synthetic: true });
  assert.equal(Object.isFrozen(AWAIT_PORT), true);
});

test('the mirrored portsFn synthesizes the await input and the flow-card ports', () => {
  assert.deepEqual(ports(nodeOf(FIXTURE_DEFAULT, 'n_review')).inputs.map((p) => p.id), ['plan', 'done', 'await']);
  assert.deepEqual(ports(nodeOf(FIXTURE_DEFAULT, 'n_task')), { inputs: [], outputs: [{ id: 'task', type: 'md', when: 'always' }] });
  assert.deepEqual(ports(nodeOf(FIXTURE_DEFAULT, 'n_end')), { inputs: [{ id: 'result', type: 'any', required: true }], outputs: [] });
  assert.deepEqual(ports(nodeOf(FIXTURE_FLOW, 'n_and')).outputs, [{ id: 'out', type: 'void', when: 'always' }]);
  assert.deepEqual(ports(nodeOf(FIXTURE_FLOW, 'n_or')).outputs, [{ id: 'out', type: 'any', when: 'always' }]);
  assert.equal(ports({ kind: 'agent', key: 'nope' }), undefined);
});

// ----------------------------------------- the same fixture assertions, client side

test('the mirrored classifyLoops finds the same loop wires as the engine', () => {
  const mine = classifyLoops(FIXTURE_DEFAULT, ports);
  const theirs = engineClassifyLoops(FIXTURE_DEFAULT, enginePortsFnFor(FIXTURE_PORTS));
  assert.deepEqual(sorted(mine.loopWires), ['w5', 'w9']);
  assert.deepEqual(sorted(mine.loopWires), sorted(theirs.loopWires));
  assert.deepEqual(sorted(mine.loopInputs), sorted(theirs.loopInputs));
  assert.deepEqual(mine.order, theirs.order);
  assert.deepEqual(sorted(classifyLoops(FIXTURE_FLOW, ports).loopWires), ['w3', 'w7']);
});

test('the mirrored resolveOrOutType resolves the flow fixture or to md', () => {
  const or = nodeOf(FIXTURE_FLOW, 'n_or');
  assert.equal(resolveOrOutType(or, FIXTURE_FLOW, ports), 'md');
  assert.equal(resolveOrOutType(or, FIXTURE_FLOW, ports), engineResolveOrOutType(or, FIXTURE_FLOW, enginePortsFnFor(FIXTURE_PORTS)));
  assert.equal(resolveOrOutType(nodeOf(LEGAL, 'n_or'), LEGAL, ports), null);   // no inbound wires yet
});

// ------------------------------------------------------ the client validate adapter

test('the validate adapter agrees with the engine on the canonical fixtures', () => {
  for (const fixture of [FIXTURE_DEFAULT, FIXTURE_FLOW]) {
    const mine = validateGraph(fixture, ports);
    assert.deepEqual(mine, engineValidateGraph(fixture, enginePortsFnFor(FIXTURE_PORTS)));
    assert.deepEqual(mine.errors, []);
  }
  assert.deepEqual(validateGraph(FIXTURE_FLOW, ports).warnings, []);
});

test('deleting the End node reports V21 — the composer disables Save from this', () => {
  const noEnd = {
    ...FIXTURE_FLOW,
    nodes: FIXTURE_FLOW.nodes.filter((n) => n.kind !== 'end'),
    wires: FIXTURE_FLOW.wires.filter((w) => w.to.node !== 'n_end'),
  };
  const { errors } = validateGraph(noEnd, ports);
  assert.ok(errors.some((e) => e.code === 'V21'), JSON.stringify(errors));
});

test('a duplicate (from,to) pair is V6 in the adapter — canWire has no separate reason for it', () => {
  const dup = { ...FIXTURE_FLOW, wires: [...FIXTURE_FLOW.wires, { ...FIXTURE_FLOW.wires[1], id: 'w99' }] };
  const { errors } = validateGraph(dup, ports);
  assert.ok(errors.some((e) => e.code === 'V6'), JSON.stringify(errors));
  assert.ok(errors.some((e) => e.code === 'V7'), 'the second wire also violates single-wire cardinality');
});

// ------------------------------------------------------------- normalize/serialize

test('canvas {x,y,zoom} survives a normalize/serialize round trip', () => {
  const authored = { ...FIXTURE_FLOW, canvas: { x: -120, y: 40, zoom: 1.25 } };
  const round = normalizeTemplate(JSON.parse(JSON.stringify(serializeTemplate(authored))));
  assert.deepEqual(round.canvas, { x: -120, y: 40, zoom: 1.25 });
  assert.equal(round.version, 2);
  assert.equal(round.nodes.length, FIXTURE_FLOW.nodes.length);
  assert.equal(round.wires.length, FIXTURE_FLOW.wires.length);
  assert.deepEqual(round.wires.find((w) => w.id === 'w3').config, { maxCycles: 3 });
  assert.deepEqual(round.nodes.find((n) => n.id === 'n_or').config, { arity: 2 });
});

test('normalize drops a canvas that is not three finite numbers, and keeps the template valid', () => {
  for (const canvas of [undefined, null, {}, { x: 1, y: 2 }, { x: 1, y: 2, zoom: 'big' }, { x: NaN, y: 0, zoom: 1 }]) {
    assert.equal('canvas' in normalizeTemplate({ ...FIXTURE_FLOW, canvas }), false, JSON.stringify(canvas));
  }
  assert.deepEqual(validateGraph(normalizeTemplate(FIXTURE_FLOW), ports).errors, []);
});

test('normalize materializes config, coerces coordinates and drops a key from a non-agent node', () => {
  const raw = {
    id: 'wf_x', name: 'X', version: 1, domain: 'coding',
    nodes: [
      { id: 'n_task', kind: 'task', x: '40', y: 200, key: 'planner' },
      { id: 'n_end', kind: 'end', x: 300, y: 200, config: { nope: 1 } },
      'not-a-node',
    ],
    wires: [{ id: 'w1', from: { node: 'n_task', port: 'task' }, to: { node: 'n_end', port: 'result' } }, null],
  };
  const t = normalizeTemplate(raw);
  assert.equal(t.version, 2);
  assert.equal(t.nodes.length, 2);
  assert.equal(t.wires.length, 1);
  assert.deepEqual(t.nodes[0], { id: 'n_task', kind: 'task', x: 40, y: 200, config: {} });
  assert.deepEqual(t.nodes[1].config, { nope: 1 });          // V17 preserves unknown config keys
  assert.equal('config' in t.wires[0], false);
});

test('the node/wire factory mints stable prefixed base36 ids', () => {
  const node = newNode('agent', { key: 'planner', x: 12, y: 34 });
  assert.match(node.id, /^n_[a-z0-9]{8}$/);
  assert.deepEqual({ ...node, id: 'n_x' }, { id: 'n_x', kind: 'agent', key: 'planner', x: 12, y: 34, config: {} });
  const flow = newNode('or', { x: 0, y: 0, config: { arity: 3 } });
  assert.equal('key' in flow, false);                        // V3: only agents carry a key
  assert.deepEqual(flow.config, { arity: 3 });
  const w = newWire({ node: 'n_a', port: 'plan' }, { node: 'n_b', port: 'plan' });
  assert.match(w.id, /^w_[a-z0-9]{8}$/);
  assert.deepEqual(w.from, { node: 'n_a', port: 'plan' });
  const ids = new Set(Array.from({ length: 200 }, () => newNode('end', { x: 0, y: 0 }).id));
  assert.equal(ids.size, 200);
});

// -------------------------------------------------------------- legality (canWire)

test('md -> md is legal', () => {
  assert.deepEqual(drop(LEGAL, 'n_plan', 'plan', 'n_impl', 'plan'), { ok: true, reason: '' });
});

test('json -> md reports the type mismatch', () => {
  assert.deepEqual(drop(LEGAL, 'n_clarify', 'answers', 'n_impl', 'plan'),
    { ok: false, reason: 'json → md type mismatch' });
});

test('a second wire into ANY wired input is rejected `already connected`', () => {
  // agent meta input (already wired by w1) — a DIFFERENT source, and the duplicate pair itself
  assert.deepEqual(drop(LEGAL, 'n_task', 'task', 'n_plan', 'task'), { ok: false, reason: 'already connected' });
  const t1 = withWires([wire('w2', 'n_plan', 'plan', 'n_impl', 'plan')]);
  assert.deepEqual(drop(t1, 'n_review', 'review', 'n_impl', 'plan'), { ok: false, reason: 'already connected' });
  // or.inK
  const t2 = withWires([wire('w2', 'n_plan', 'plan', 'n_or', 'in1')]);
  assert.deepEqual(drop(t2, 'n_plan', 'plan', 'n_or', 'in1'), { ok: false, reason: 'already connected' });
  // end.result
  const t3 = withWires([wire('w2', 'n_review', 'pass', 'n_end', 'result')]);
  assert.deepEqual(drop(t3, 'n_plan', 'plan', 'n_end', 'result'), { ok: false, reason: 'already connected' });
  // the synthesized await port
  const t4 = withWires([wire('w2', 'n_review', 'pass', 'n_impl', 'await')]);
  assert.deepEqual(drop(t4, 'n_and', 'out', 'n_impl', 'await'), { ok: false, reason: 'already connected' });
});

test('a duplicate (from,to) drop surfaces as `already connected`, not a reason of its own', () => {
  assert.deepEqual(drop(LEGAL, 'n_task', 'task', 'n_plan', 'task'), { ok: false, reason: 'already connected' });
});

test('any-typed inputs accept every source type', () => {
  assert.deepEqual(drop(LEGAL, 'n_plan', 'plan', 'n_and', 'in1'), { ok: true, reason: '' });      // md -> any
  assert.deepEqual(drop(LEGAL, 'n_review', 'pass', 'n_and', 'in2'), { ok: true, reason: '' });    // void -> any
  assert.deepEqual(drop(LEGAL, 'n_review', 'pass', 'n_impl', 'await'), { ok: true, reason: '' }); // void -> await
  assert.deepEqual(drop(LEGAL, 'n_clarify', 'answers', 'n_end', 'result'), { ok: true, reason: '' });
});

test('and.out is STATIC void — it cannot feed an md input', () => {
  assert.deepEqual(drop(LEGAL, 'n_and', 'out', 'n_impl', 'plan'),
    { ok: false, reason: 'void → md type mismatch' });
});

test('or inputs accept any type until one is wired, then homogeneity mirrors in', () => {
  assert.deepEqual(drop(LEGAL, 'n_plan', 'plan', 'n_or', 'in1'), { ok: true, reason: '' });
  assert.deepEqual(drop(LEGAL, 'n_clarify', 'answers', 'n_or', 'in1'), { ok: true, reason: '' });
  const wired = withWires([wire('w2', 'n_plan', 'plan', 'n_or', 'in1')]);
  assert.deepEqual(drop(wired, 'n_clarify', 'answers', 'n_or', 'in2'),
    { ok: false, reason: 'or inputs must match: md' });
  assert.deepEqual(drop(wired, 'n_review', 'review', 'n_or', 'in2'), { ok: true, reason: '' });   // md again
});

test("an or's out carries the RESOLVED payload type downstream, and rejects on mismatch", () => {
  const wired = withWires([
    wire('w2', 'n_plan', 'plan', 'n_or', 'in1'),
    wire('w3', 'n_review', 'review', 'n_or', 'in2'),
  ]);
  assert.equal(resolveOrOutType(nodeOf(wired, 'n_or'), wired, ports), 'md');
  assert.deepEqual(drop(wired, 'n_or', 'out', 'n_impl', 'fix'), { ok: true, reason: '' });
  const unresolved = withWires([]);
  assert.equal(resolveOrOutType(nodeOf(unresolved, 'n_or'), unresolved, ports), null);
  assert.deepEqual(drop(unresolved, 'n_or', 'out', 'n_impl', 'fix'), { ok: true, reason: '' });   // unresolvable: allow
  const jsonOr = withWires([wire('w2', 'n_clarify', 'answers', 'n_or', 'in1')]);
  assert.equal(resolveOrOutType(nodeOf(jsonOr, 'n_or'), jsonOr, ports), 'json');
  assert.deepEqual(drop(jsonOr, 'n_or', 'out', 'n_impl', 'fix'), { ok: false, reason: 'json → md type mismatch' });
});

test('a self-wire onto a loop input stays legal (the refine self-loop)', () => {
  assert.deepEqual(drop(LEGAL, 'n_impl', 'done', 'n_review', 'done'), { ok: true, reason: '' });
  const refine = { ...LEGAL, nodes: [...LEGAL.nodes, { id: 'n_refine', kind: 'agent', key: 'refiner', x: 0, y: 700, config: {} }] };
  assert.deepEqual(drop(refine, 'n_refine', 'revise', 'n_refine', 'revise'), { ok: true, reason: '' });
});

test('canWire never throws on a dangling endpoint — it reports it', () => {
  assert.deepEqual(drop(LEGAL, 'n_ghost', 'plan', 'n_impl', 'plan'), { ok: false, reason: 'unknown port' });
  assert.deepEqual(drop(LEGAL, 'n_plan', 'nope', 'n_impl', 'plan'), { ok: false, reason: 'unknown port' });
  assert.deepEqual(drop(LEGAL, 'n_plan', 'plan', 'n_impl', 'nope'), { ok: false, reason: 'unknown port' });
  assert.deepEqual(drop(LEGAL, 'n_plan', 'plan', 'n_plan', 'plan'), { ok: false, reason: 'unknown port' });  // 'plan' is an output here
});
