// test/graph-ports.test.mjs
// ports.mjs is the pure port layer of the v2 graph engine: token construction,
// loop classification (Tarjan SCC + blocking-source rule), conditional output
// routing, the or card's payload-type resolution and the spec §3 firing rule.
// Every wiring fact asserted here is copied from the canonical fixtures.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FIXTURE_DEFAULT, FIXTURE_FLOW, FIXTURE_PORTS, portsFnFor } from '../src/core/graph/fixtures.mjs';
import { makeToken, classifyLoops, firedOutputs, resolveOrOutType, isReady } from '../src/core/graph/ports.mjs';

const ports = portsFnFor(FIXTURE_PORTS);

const nodeOf = (template, id) => template.nodes.find((n) => n.id === id);
const sorted = (set) => [...set].sort();
const hasScc = (sccs, members) =>
  sccs.some((s) => s.length === members.length && members.every((m) => s.includes(m)));

const tok = (seq, type = 'md') =>
  makeToken({ seq, type, path: `/p/a-${seq}.md`, sourceExecutionId: `e${seq}` });

/** isReady ctx builder. THE KEY-SPACE TRAP: `wiredIn`/`consumed` are keyed by the
 *  BARE port id, `tokens`/`loopInputs` by graph-global `'<nodeId>.<port>'`. */
function ctxFor(node, opts = {}) {
  const { wired = [], tokens = {}, consumed = {}, loopInputs = [], everRan = false, awaitAll = false } = opts;
  return {
    portsFn: ports,
    wiredIn: new Map(wired.map((port, i) => [port, `w_${i + 1}`])),
    loopInputs: new Set(loopInputs),
    tokens: new Map(Object.entries(tokens).map(([port, t]) => [`${node.id}.${port}`, t])),
    consumed: new Map(Object.entries(consumed)),
    everRan,
    awaitAll,
    isFlow: node.kind !== 'agent',
  };
}

/** consumer.done → two verifiers → or → consumer.fix: the seeds' new loop shape,
 *  every node in ONE SCC. Budgets belong on the blocking in-wires into the or. */
const OR_FANNED = {
  id: 'wf_or_fanned',
  name: 'Or fanned',
  version: 2,
  domain: 'coding',
  nodes: [
    { id: 'n_impl', kind: 'agent', key: 'implementer', x: 0, y: 200, config: {} },
    { id: 'n_a', kind: 'agent', key: 'reviewer', x: 280, y: 80, config: {} },
    { id: 'n_b', kind: 'agent', key: 'workspaceReviewer', x: 280, y: 320, config: {} },
    { id: 'n_or', kind: 'or', x: 560, y: 200, config: { arity: 2 } },
  ],
  wires: [
    { id: 'wa', from: { node: 'n_impl', port: 'done' }, to: { node: 'n_a', port: 'done' } },
    { id: 'wb', from: { node: 'n_impl', port: 'done' }, to: { node: 'n_b', port: 'done' } },
    { id: 'wc', from: { node: 'n_a', port: 'review' }, to: { node: 'n_or', port: 'in1' } },
    { id: 'wd', from: { node: 'n_b', port: 'review' }, to: { node: 'n_or', port: 'in2' } },
    { id: 'we', from: { node: 'n_or', port: 'out' }, to: { node: 'n_impl', port: 'fix' } },
  ],
};

/** or → or: the payload type resolves THROUGH the chain. */
const OR_CHAIN = {
  id: 'wf_or_chain',
  name: 'Or chain',
  version: 2,
  domain: 'coding',
  nodes: [
    { id: 'n_plan', kind: 'agent', key: 'planner', x: 0, y: 0, config: {} },
    { id: 'n_or1', kind: 'or', x: 280, y: 0, config: { arity: 2 } },
    { id: 'n_or2', kind: 'or', x: 560, y: 0, config: { arity: 2 } },
  ],
  wires: [
    { id: 'w1', from: { node: 'n_plan', port: 'plan' }, to: { node: 'n_or1', port: 'in1' } },
    { id: 'w2', from: { node: 'n_or1', port: 'out' }, to: { node: 'n_or2', port: 'in1' } },
  ],
};

/** A cyclic or → or chain with no external source: the seen-set must return null
 *  rather than hang. */
const OR_CYCLE = {
  id: 'wf_or_cycle',
  name: 'Or cycle',
  version: 2,
  domain: 'coding',
  nodes: [
    { id: 'n_or1', kind: 'or', x: 0, y: 0, config: { arity: 2 } },
    { id: 'n_or2', kind: 'or', x: 280, y: 0, config: { arity: 2 } },
  ],
  wires: [
    { id: 'w1', from: { node: 'n_or1', port: 'out' }, to: { node: 'n_or2', port: 'in1' } },
    { id: 'w2', from: { node: 'n_or2', port: 'out' }, to: { node: 'n_or1', port: 'in1' } },
  ],
};

/** Void-only inbound (implementer.done + reviewer.pass): a void payload valve. */
const OR_VOID = {
  id: 'wf_or_void',
  name: 'Or void',
  version: 2,
  domain: 'coding',
  nodes: [
    { id: 'n_impl', kind: 'agent', key: 'implementer', x: 0, y: 0, config: {} },
    { id: 'n_review', kind: 'agent', key: 'reviewer', x: 0, y: 200, config: {} },
    { id: 'n_or', kind: 'or', x: 280, y: 100, config: { arity: 2 } },
  ],
  wires: [
    { id: 'w1', from: { node: 'n_impl', port: 'done' }, to: { node: 'n_or', port: 'in1' } },
    { id: 'w2', from: { node: 'n_review', port: 'pass' }, to: { node: 'n_or', port: 'in2' } },
  ],
};

test('classifyLoops(FIXTURE_DEFAULT): blocking-source wires in an SCC are the loop wires', () => {
  const { loopWires, loopInputs, sccs, order } = classifyLoops(FIXTURE_DEFAULT, ports);
  assert.deepEqual(sorted(loopWires), ['w5', 'w9']);
  // w8 (impl.done → review.done) sits INSIDE the {n_impl, n_review} SCC but its
  // source output is when:'always' — a plain forward wire, no budget, no amber.
  assert.equal(loopWires.has('w8'), false);
  // loop INPUTS are meta-derived: planner.revise is loop:true though unwired here.
  assert.deepEqual(sorted(loopInputs), ['n_impl.fix', 'n_plan.revise', 'n_refine.revise']);
  assert.ok(hasScc(sccs, ['n_refine']));
  assert.ok(hasScc(sccs, ['n_impl', 'n_review']));
  assert.deepEqual(order, ['n_task', 'n_clarify', 'n_plan', 'n_refine', 'n_impl', 'n_review', 'n_end']);
});

test('classifyLoops(FIXTURE_FLOW): flow cards join no SCC; order is fully pinned', () => {
  const { loopWires, sccs, order } = classifyLoops(FIXTURE_FLOW, ports);
  assert.deepEqual(sorted(loopWires), ['w3', 'w7']);
  assert.ok(hasScc(sccs, ['n_impl', 'n_review']));
  for (const id of ['n_or', 'n_and', 'n_end']) assert.ok(hasScc(sccs, [id]));
  // n_and precedes n_or purely by the min-nodeId tie-break between two same-rank
  // condensation vertices — order-visible, behaviour-neutral (never co-ready).
  assert.deepEqual(order, [
    'n_task2', 'n_plan', 'n_refine', 'n_impl', 'n_review', 'n_and', 'n_or', 'n_check', 'n_end',
  ]);
});

test('classifyLoops or-fanned loop: only the blocking in-wires into the or are loop wires', () => {
  const { loopWires, sccs } = classifyLoops(OR_FANNED, ports);
  assert.ok(hasScc(sccs, ['n_impl', 'n_a', 'n_b', 'n_or']));
  assert.deepEqual(sorted(loopWires), ['wc', 'wd']);
  // or.out → implementer.fix is an ALWAYS source: the valve carries no budget.
  assert.equal(loopWires.has('we'), false);
});

test('classifyLoops does not crash on an unknown agent key (cyclic AND acyclic)', () => {
  const cyclic = structuredClone(FIXTURE_DEFAULT);
  nodeOf(cyclic, 'n_refine').key = 'nope';                 // unknown key, keeps the w5 self-wire
  const cyclicRes = classifyLoops(cyclic, ports);
  assert.equal(cyclicRes.loopWires.has('w5'), false);      // no meta ⇒ no blocking source
  assert.equal(cyclicRes.loopWires.has('w9'), true);
  const acyclic = structuredClone(FIXTURE_DEFAULT);
  nodeOf(acyclic, 'n_clarify').key = 'nope';               // wiring untouched, node outside every cycle
  const acyclicRes = classifyLoops(acyclic, ports);        // the loopInputs pass calls portsFn on EVERY node
  assert.deepEqual(sorted(acyclicRes.loopWires), ['w5', 'w9']);
  assert.equal(acyclicRes.order.length, FIXTURE_DEFAULT.nodes.length);
});

test('makeToken materializes every default — no undefined fields for snapshot compares', () => {
  const t = makeToken({ seq: 7, type: 'md', path: '/p/plan.md', sourceExecutionId: 'ex1' });
  assert.deepEqual(t, {
    seq: 7, type: 'md', path: '/p/plan.md', value: null, meta: null, sourceExecutionId: 'ex1', forced: false,
  });
  const bare = makeToken({ seq: 1, type: 'void' });
  assert.deepEqual(bare, {
    seq: 1, type: 'void', path: null, value: null, meta: null, sourceExecutionId: null, forced: false,
  });
  assert.equal(Object.values(bare).some((v) => v === undefined), false);
  const forced = makeToken({ seq: 2, type: 'md', value: 'x', meta: { issues: 1 }, sourceExecutionId: 'ex2', forced: true });
  assert.deepEqual(forced, {
    seq: 2, type: 'md', path: null, value: 'x', meta: { issues: 1 }, sourceExecutionId: 'ex2', forced: true,
  });
});

test('firedOutputs fires the always ports plus exactly one conditional side', () => {
  const reviewer = FIXTURE_PORTS.reviewer.outputs;
  assert.deepEqual(firedOutputs(reviewer, { issues: [{ severity: 'major', title: 'x' }] }).map((o) => o.id), ['review']);
  assert.deepEqual(firedOutputs(reviewer, { issues: [{ severity: 'minor', title: 'x' }] }).map((o) => o.id), ['pass']);
  assert.deepEqual(firedOutputs(reviewer, null).map((o) => o.id), ['pass']);   // hasBlocking(null) === false
  const planner = FIXTURE_PORTS.planner.outputs;
  assert.deepEqual(firedOutputs(planner, null).map((o) => o.id), ['plan']);
  // PORT OBJECTS, not ids — the executor needs filename/store/artifactKind.
  const [plan] = firedOutputs(planner, null);
  assert.equal(plan.filename, '{base}{vsuffix}.md');
  assert.equal(plan.store, 'project');
  assert.equal(plan.artifactKind, 'plan');
  const [review] = firedOutputs(reviewer, { issues: [{ severity: 'critical' }] });
  assert.equal(review.filename, '{base}-impl-review.md');
  assert.equal(review.store, 'project');
});

test('resolveOrOutType resolves the or payload type from its inbound wires', () => {
  assert.equal(resolveOrOutType(nodeOf(FIXTURE_FLOW, 'n_or'), FIXTURE_FLOW, ports), 'md');
  assert.equal(resolveOrOutType(nodeOf(OR_CHAIN, 'n_or2'), OR_CHAIN, ports), 'md');   // through the chain
  assert.equal(resolveOrOutType(nodeOf(OR_CYCLE, 'n_or1'), OR_CYCLE, ports), null);   // seen-set, no hang
  assert.equal(resolveOrOutType(nodeOf(OR_VOID, 'n_or'), OR_VOID, ports), 'void');
  const unwired = { id: 'wf_or_bare', name: 'Bare', version: 2, domain: 'coding', nodes: [{ id: 'n_or', kind: 'or', x: 0, y: 0, config: { arity: 2 } }], wires: [] };
  assert.equal(resolveOrOutType(unwired.nodes[0], unwired, ports), null);
});

test('resolveOrOutType walks inbound wires by inK index, not by wire insertion order', () => {
  const template = {
    id: 'wf_or_order',
    name: 'Or order',
    version: 2,
    domain: 'coding',
    nodes: [
      { id: 'n_clarify', kind: 'agent', key: 'clarify', x: 0, y: 0, config: {} },
      { id: 'n_plan', kind: 'agent', key: 'planner', x: 0, y: 200, config: {} },
      { id: 'n_or', kind: 'or', x: 280, y: 100, config: { arity: 2 } },
    ],
    wires: [
      { id: 'w1', from: { node: 'n_plan', port: 'plan' }, to: { node: 'n_or', port: 'in2' } },      // md, listed FIRST
      { id: 'w2', from: { node: 'n_clarify', port: 'answers' }, to: { node: 'n_or', port: 'in1' } }, // json, listed second
    ],
  };
  // Heterogeneous inbound is V12's error; resolution must still be deterministic:
  // in1 wins over in2 regardless of the order the wires appear in the array.
  assert.equal(resolveOrOutType(nodeOf(template, 'n_or'), template, ports), 'json');
});

test('isReady(and): all inputs fresh, every execution', () => {
  const and = nodeOf(FIXTURE_FLOW, 'n_and');
  assert.equal(isReady(and, ctxFor(and, { wired: ['in1', 'in2'], tokens: { in1: tok(1) } })), false);
  assert.equal(isReady(and, ctxFor(and, { wired: ['in1', 'in2'], tokens: { in1: tok(1), in2: tok(2) } })), true);
  // awaitAll is an agent-only key — the flow arms ignore it entirely.
  assert.equal(
    isReady(and, ctxFor(and, { wired: ['in1', 'in2'], tokens: { in1: tok(1) }, awaitAll: true })),
    false,
  );
});

test('isReady(or): ANY fresh input fires the only fan-in card', () => {
  const or = nodeOf(FIXTURE_FLOW, 'n_or');
  assert.equal(isReady(or, ctxFor(or, { wired: ['in1', 'in2'], tokens: { in1: tok(3) } })), true);
  assert.equal(isReady(or, ctxFor(or, { wired: ['in1', 'in2'], tokens: { in2: tok(4) } })), true);
  // Both fresh in one drain is still ONE emission — the scheduler collapses it.
  assert.equal(isReady(or, ctxFor(or, { wired: ['in1', 'in2'], tokens: { in1: tok(3), in2: tok(4) } })), true);
  assert.equal(
    isReady(or, ctxFor(or, { wired: ['in1', 'in2'], tokens: { in1: tok(3) }, consumed: { in1: 3 } })),
    false,
  );
});

test('isReady(end): fires on a fresh result token only', () => {
  const end = nodeOf(FIXTURE_FLOW, 'n_end');
  assert.equal(isReady(end, ctxFor(end, { wired: ['result'], tokens: { result: tok(5) } })), true);
  assert.equal(
    isReady(end, ctxFor(end, { wired: ['result'], tokens: { result: tok(5) }, consumed: { result: 5 }, everRan: true })),
    false,
  );
  assert.equal(isReady(end, ctxFor(end, { wired: ['result'] })), false);
});

test('isReady(task): a zero-input node is ready iff it never ran', () => {
  const task = nodeOf(FIXTURE_DEFAULT, 'n_task');
  assert.equal(isReady(task, ctxFor(task, {})), true);
  assert.equal(isReady(task, ctxFor(task, { everRan: true })), false);
});

test('isReady first run: the barrier covers wired NON-LOOP inputs only', () => {
  const impl = nodeOf(FIXTURE_DEFAULT, 'n_impl');
  // plan latched, the wired `fix` loop input empty (no review exists yet) ⇒ fire.
  assert.equal(
    isReady(impl, ctxFor(impl, { wired: ['plan', 'fix'], tokens: { plan: tok(1) }, loopInputs: ['n_impl.fix'] })),
    true,
  );
  const review = nodeOf(FIXTURE_DEFAULT, 'n_review');
  assert.equal(
    isReady(review, ctxFor(review, { wired: ['plan', 'done'], tokens: { plan: tok(1) } })),
    false,
  );
  assert.equal(
    isReady(review, ctxFor(review, { wired: ['plan', 'done'], tokens: { plan: tok(1), done: tok(2, 'void') } })),
    true,
  );
});

test('isReady first run: an unwired REQUIRED input is never ready', () => {
  const review = nodeOf(FIXTURE_DEFAULT, 'n_review');   // plan is required:true
  assert.equal(
    isReady(review, ctxFor(review, { wired: ['done'], tokens: { done: tok(2, 'void') } })),
    false,
  );
});

test('isReady re-run (awaitAll off): any fresh token re-fires', () => {
  const review = nodeOf(FIXTURE_DEFAULT, 'n_review');
  const base = { wired: ['plan', 'done'], everRan: true, consumed: { plan: 1, done: 2 } };
  assert.equal(
    isReady(review, ctxFor(review, { ...base, tokens: { plan: tok(1), done: tok(4, 'void') } })),
    true,
  );
  assert.equal(
    isReady(review, ctxFor(review, { ...base, tokens: { plan: tok(1), done: tok(2, 'void') } })),
    false,
  );
});

test('isReady re-run (awaitAll on): all wired non-loop fresh, or a fresh loop token alone', () => {
  const review = nodeOf(FIXTURE_DEFAULT, 'n_review');
  const base = { wired: ['plan', 'done'], everRan: true, awaitAll: true, consumed: { plan: 1, done: 4 } };
  assert.equal(
    isReady(review, ctxFor(review, { ...base, tokens: { plan: tok(2), done: tok(4, 'void') } })),
    false,
  );
  assert.equal(
    isReady(review, ctxFor(review, { ...base, tokens: { plan: tok(5), done: tok(6, 'void') } })),
    true,
  );
  const impl = nodeOf(FIXTURE_DEFAULT, 'n_impl');
  assert.equal(
    isReady(impl, ctxFor(impl, {
      wired: ['plan', 'fix'],
      everRan: true,
      awaitAll: true,
      loopInputs: ['n_impl.fix'],
      consumed: { plan: 1, fix: 2 },
      tokens: { plan: tok(1), fix: tok(9) },     // stale plan, fresh loop token
    })),
    true,
  );
});

test('isReady: the synthesized await input is an ordinary wired non-loop input', () => {
  const check = nodeOf(FIXTURE_FLOW, 'n_check');
  // First run: the await barrier holds until the AND card delivers.
  assert.equal(
    isReady(check, ctxFor(check, { wired: ['plan', 'await'], tokens: { plan: tok(1) } })),
    false,
  );
  assert.equal(
    isReady(check, ctxFor(check, { wired: ['plan', 'await'], tokens: { plan: tok(1), await: tok(2, 'void') } })),
    true,
  );
  // Re-run: a fresh await token re-fires on its own (start-parity).
  assert.equal(
    isReady(check, ctxFor(check, {
      wired: ['plan', 'await'],
      everRan: true,
      consumed: { plan: 1, await: 2 },
      tokens: { plan: tok(1), await: tok(7, 'void') },
    })),
    true,
  );
  // awaitAll: the wired await counts as a wired non-loop input.
  assert.equal(
    isReady(check, ctxFor(check, {
      wired: ['plan', 'await'],
      everRan: true,
      awaitAll: true,
      consumed: { plan: 1, await: 2 },
      tokens: { plan: tok(5), await: tok(2, 'void') },
    })),
    false,
  );
});
