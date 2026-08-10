// test/graph-validate.test.mjs
// validate.mjs is the shared pure validator of the v2 graph engine: rules V1-V21
// (V7 restored as the universal input-cardinality error, V22 retired). Every case
// mutates a structuredClone of a canonical fixture and asserts rule MEMBERSHIP
// plus targeted absence — never exact error-list equality, because a mutation
// legitimately cascades into companion rules (a deleted node dangles wires, an
// unknown key un-resolves ports, ...). The two baselines are the only exact
// assertions: both fixtures must be zero-error AND zero-warning.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FIXTURE_DEFAULT, FIXTURE_FLOW, FIXTURE_PORTS, portsFnFor } from '../src/core/graph/fixtures.mjs';
import { isReady } from '../src/core/graph/ports.mjs';
import { validateGraph } from '../src/core/graph/validate.mjs';

const ports = portsFnFor(FIXTURE_PORTS);

const clone = (template) => structuredClone(template);
const nodeOf = (template, id) => template.nodes.find((n) => n.id === id);
const wireOf = (template, id) => template.wires.find((w) => w.id === id);
const has = (list, code) => list.some((e) => e.code === code);
const of = (list, code) => list.filter((e) => e.code === code);
const dropWire = (template, id) => { template.wires = template.wires.filter((w) => w.id !== id); };
const dropNode = (template, id) => { template.nodes = template.nodes.filter((n) => n.id !== id); };

/** A portsFn over a MUTATED copy of the spec §5 port table. */
function withPorts(mutate) {
  const table = structuredClone(FIXTURE_PORTS);
  mutate(table);
  return portsFnFor(table);
}

/** consumer.done -> two verifiers -> or -> consumer.fix, one SCC (the seeds' new
 *  loop shape). `we` is an ALWAYS-sourced in-SCC wire: never a loop wire, so a
 *  budget on it is V13's error. */
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

/** and.out (static void) -> and.in (any): the `any` side accepts every source and
 *  AND cards chain. Otherwise a clean little graph. */
const AND_CHAIN = {
  id: 'wf_and_chain',
  name: 'And chain',
  version: 2,
  domain: 'coding',
  nodes: [
    { id: 'n_task', kind: 'task', x: 0, y: 0, config: {} },
    { id: 'n_plan', kind: 'agent', key: 'planner', x: 280, y: 0, config: {} },
    { id: 'n_and1', kind: 'and', x: 560, y: 0, config: { arity: 2 } },
    { id: 'n_and2', kind: 'and', x: 840, y: 0, config: { arity: 2 } },
    { id: 'n_end', kind: 'end', x: 1120, y: 0, config: {} },
  ],
  wires: [
    { id: 'w1', from: { node: 'n_task', port: 'task' }, to: { node: 'n_plan', port: 'task' } },
    { id: 'w2', from: { node: 'n_plan', port: 'plan' }, to: { node: 'n_and1', port: 'in1' } },
    { id: 'w3', from: { node: 'n_task', port: 'task' }, to: { node: 'n_and1', port: 'in2' } },
    { id: 'w4', from: { node: 'n_and1', port: 'out' }, to: { node: 'n_and2', port: 'in1' } },
    { id: 'w5', from: { node: 'n_plan', port: 'plan' }, to: { node: 'n_and2', port: 'in2' } },
    { id: 'w6', from: { node: 'n_and2', port: 'out' }, to: { node: 'n_end', port: 'result' } },
  ],
};

/** An or fed only by void outputs: or.out resolves to `void`, so its outbound
 *  wire into an md input is a V8 mismatch. */
const OR_VOID_FEED = {
  id: 'wf_or_void_feed',
  name: 'Or void feed',
  version: 2,
  domain: 'coding',
  nodes: [
    { id: 'n_task', kind: 'task', x: 0, y: 200, config: {} },
    { id: 'n_impl', kind: 'agent', key: 'implementer', x: 280, y: 80, config: {} },
    { id: 'n_review', kind: 'agent', key: 'reviewer', x: 280, y: 320, config: {} },
    { id: 'n_or', kind: 'or', x: 560, y: 200, config: { arity: 2 } },
    { id: 'n_check', kind: 'agent', key: 'manualTestsChecklist', x: 840, y: 200, config: {} },
    { id: 'n_end', kind: 'end', x: 1120, y: 200, config: {} },
  ],
  wires: [
    { id: 'w1', from: { node: 'n_task', port: 'task' }, to: { node: 'n_impl', port: 'plan' } },
    { id: 'w2', from: { node: 'n_task', port: 'task' }, to: { node: 'n_review', port: 'plan' } },
    { id: 'w3', from: { node: 'n_impl', port: 'done' }, to: { node: 'n_or', port: 'in1' } },
    { id: 'w4', from: { node: 'n_review', port: 'pass' }, to: { node: 'n_or', port: 'in2' } },
    { id: 'w5', from: { node: 'n_or', port: 'out' }, to: { node: 'n_check', port: 'plan' } },
    { id: 'w6', from: { node: 'n_check', port: 'checklist' }, to: { node: 'n_end', port: 'result' } },
  ],
};

/** or1 -> or2: the payload type must resolve THROUGH the chain, for V8's outbound
 *  check and V12's homogeneity clause alike. `wj` makes or2 heterogeneous
 *  (md through or1 vs json from clarify). */
const OR_CHAIN = {
  id: 'wf_or_chain',
  name: 'Or chain',
  version: 2,
  domain: 'coding',
  nodes: [
    { id: 'n_task', kind: 'task', x: 0, y: 200, config: {} },
    { id: 'n_clarify', kind: 'agent', key: 'clarify', x: 280, y: 340, config: {} },
    { id: 'n_plan', kind: 'agent', key: 'planner', x: 280, y: 60, config: {} },
    { id: 'n_refine', kind: 'agent', key: 'refiner', x: 560, y: 60, config: {} },
    { id: 'n_or1', kind: 'or', x: 840, y: 60, config: { arity: 2 } },
    { id: 'n_or2', kind: 'or', x: 1120, y: 200, config: { arity: 2 } },
    { id: 'n_check', kind: 'agent', key: 'manualTestsChecklist', x: 1400, y: 200, config: {} },
    { id: 'n_end', kind: 'end', x: 1680, y: 200, config: {} },
  ],
  wires: [
    { id: 'wa', from: { node: 'n_task', port: 'task' }, to: { node: 'n_clarify', port: 'task' } },
    { id: 'wb', from: { node: 'n_task', port: 'task' }, to: { node: 'n_plan', port: 'task' } },
    { id: 'wc', from: { node: 'n_plan', port: 'plan' }, to: { node: 'n_refine', port: 'plan' } },
    { id: 'wd', from: { node: 'n_plan', port: 'plan' }, to: { node: 'n_or1', port: 'in1' } },
    { id: 'we', from: { node: 'n_refine', port: 'plan' }, to: { node: 'n_or1', port: 'in2' } },
    { id: 'wf', from: { node: 'n_or1', port: 'out' }, to: { node: 'n_or2', port: 'in1' } },
    { id: 'wg', from: { node: 'n_plan', port: 'plan' }, to: { node: 'n_or2', port: 'in2' } },
    { id: 'wh', from: { node: 'n_or2', port: 'out' }, to: { node: 'n_check', port: 'plan' } },
    { id: 'wi', from: { node: 'n_check', port: 'checklist' }, to: { node: 'n_end', port: 'result' } },
  ],
};

/** A cyclic or -> or chain with no external source: every walk must terminate on
 *  the seen-set instead of hanging. */
const OR_CYCLE = {
  id: 'wf_or_cycle',
  name: 'Or cycle',
  version: 2,
  domain: 'coding',
  nodes: [
    { id: 'n_task', kind: 'task', x: 0, y: 0, config: {} },
    { id: 'n_plan', kind: 'agent', key: 'planner', x: 280, y: 0, config: {} },
    { id: 'n_or1', kind: 'or', x: 560, y: 0, config: { arity: 2 } },
    { id: 'n_or2', kind: 'or', x: 840, y: 0, config: { arity: 2 } },
    { id: 'n_end', kind: 'end', x: 1120, y: 0, config: {} },
  ],
  wires: [
    { id: 'w1', from: { node: 'n_task', port: 'task' }, to: { node: 'n_plan', port: 'task' } },
    { id: 'w2', from: { node: 'n_or1', port: 'out' }, to: { node: 'n_or2', port: 'in1' } },
    { id: 'w3', from: { node: 'n_or2', port: 'out' }, to: { node: 'n_or1', port: 'in1' } },
    { id: 'w4', from: { node: 'n_plan', port: 'plan' }, to: { node: 'n_end', port: 'result' } },
  ],
};

/** The wf_full implementer shape: `or.out -> fix` (an ALWAYS source landing on a
 *  loop input) beside `decomposer.tasks -> task`. Exemption (d) is the only thing
 *  standing between this graph and a permanent V18 warning. */
const LOOP_VALVE = {
  id: 'wf_loop_valve',
  name: 'Loop valve',
  version: 2,
  domain: 'coding',
  nodes: [
    { id: 'n_task', kind: 'task', x: 0, y: 200, config: {} },
    { id: 'n_plan', kind: 'agent', key: 'planner', x: 280, y: 200, config: {} },
    { id: 'n_refine', kind: 'agent', key: 'refiner', x: 560, y: 200, config: {} },
    { id: 'n_decomp', kind: 'agent', key: 'decomposer', x: 560, y: 440, config: {} },
    { id: 'n_pr', kind: 'agent', key: 'planReviewer', x: 840, y: 620, config: {} },
    { id: 'n_impl', kind: 'agent', key: 'implementer', x: 840, y: 200, config: {} },
    { id: 'n_review', kind: 'agent', key: 'reviewer', x: 1120, y: 200, config: {} },
    { id: 'n_or', kind: 'or', x: 1120, y: 440, config: { arity: 2 } },
    { id: 'n_end', kind: 'end', x: 1400, y: 200, config: {} },
  ],
  wires: [
    { id: 'w1', from: { node: 'n_task', port: 'task' }, to: { node: 'n_plan', port: 'task' } },
    { id: 'w2', from: { node: 'n_plan', port: 'plan' }, to: { node: 'n_refine', port: 'plan' } },
    { id: 'w3', from: { node: 'n_plan', port: 'plan' }, to: { node: 'n_decomp', port: 'plan' } },
    { id: 'w4', from: { node: 'n_refine', port: 'plan' }, to: { node: 'n_impl', port: 'plan' } },
    { id: 'w5', from: { node: 'n_decomp', port: 'tasks' }, to: { node: 'n_impl', port: 'task' } },
    { id: 'w6', from: { node: 'n_refine', port: 'plan' }, to: { node: 'n_review', port: 'plan' } },
    { id: 'w7', from: { node: 'n_impl', port: 'done' }, to: { node: 'n_review', port: 'done' } },
    { id: 'w8', from: { node: 'n_refine', port: 'plan' }, to: { node: 'n_pr', port: 'plan' } },
    { id: 'w9', from: { node: 'n_review', port: 'review' }, to: { node: 'n_or', port: 'in1' }, config: { maxCycles: 3 } },
    { id: 'w10', from: { node: 'n_pr', port: 'review' }, to: { node: 'n_or', port: 'in2' } },
    { id: 'w11', from: { node: 'n_or', port: 'out' }, to: { node: 'n_impl', port: 'fix' } },
    { id: 'w12', from: { node: 'n_review', port: 'pass' }, to: { node: 'n_end', port: 'result' } },
  ],
};

/** Combine is NOT exempt from V19: a blocking output landing on `in1` warns. */
const COMBINE_SINK = {
  id: 'wf_combine_sink',
  name: 'Combine sink',
  version: 2,
  domain: 'coding',
  nodes: [
    { id: 'n_task', kind: 'task', x: 0, y: 200, config: {} },
    { id: 'n_plan', kind: 'agent', key: 'planner', x: 280, y: 60, config: {} },
    { id: 'n_review', kind: 'agent', key: 'reviewer', x: 280, y: 340, config: {} },
    { id: 'n_combine', kind: 'combine', x: 560, y: 200, config: { arity: 2 } },
    { id: 'n_end', kind: 'end', x: 840, y: 200, config: {} },
  ],
  wires: [
    { id: 'w1', from: { node: 'n_task', port: 'task' }, to: { node: 'n_plan', port: 'task' } },
    { id: 'w2', from: { node: 'n_task', port: 'task' }, to: { node: 'n_review', port: 'plan' } },
    { id: 'w3', from: { node: 'n_review', port: 'review' }, to: { node: 'n_combine', port: 'in1' } },
    { id: 'w4', from: { node: 'n_plan', port: 'plan' }, to: { node: 'n_combine', port: 'in2' } },
    { id: 'w5', from: { node: 'n_combine', port: 'out' }, to: { node: 'n_end', port: 'result' } },
  ],
};

// ---------------------------------------------------------------- baselines

test('baseline: both canonical fixtures are zero-error AND zero-warning', () => {
  const def = validateGraph(FIXTURE_DEFAULT, ports);
  assert.deepEqual(def.errors, []);
  assert.deepEqual(def.warnings, []);
  const flow = validateGraph(FIXTURE_FLOW, ports);
  assert.deepEqual(flow.errors, []);
  assert.deepEqual(flow.warnings, []);
});

// ---------------------------------------------------------------- V1 - V4

test('V1: the template shape (version 2, non-empty nodes, wires array)', () => {
  const v1 = clone(FIXTURE_DEFAULT);
  v1.version = 1;
  assert.ok(has(validateGraph(v1, ports).errors, 'V1'));
  const noNodes = clone(FIXTURE_DEFAULT);
  noNodes.nodes = [];
  assert.ok(has(validateGraph(noNodes, ports).errors, 'V1'));
  const noWires = clone(FIXTURE_DEFAULT);
  delete noWires.wires;
  assert.ok(has(validateGraph(noWires, ports).errors, 'V1'));
});

test('V2: node ids unique and well-formed; x/y FINITE (NaN is a bad drag-serialize)', () => {
  const dup = clone(FIXTURE_DEFAULT);
  nodeOf(dup, 'n_plan').id = 'n_clarify';
  assert.ok(of(validateGraph(dup, ports).errors, 'V2').some((e) => /duplicate/i.test(e.msg)));
  const badId = clone(FIXTURE_DEFAULT);
  nodeOf(badId, 'n_plan').id = 'n plan!';
  assert.ok(has(validateGraph(badId, ports).errors, 'V2'));
  const nan = clone(FIXTURE_DEFAULT);
  nodeOf(nan, 'n_plan').x = NaN;
  const nanErrs = of(validateGraph(nan, ports).errors, 'V2');
  assert.equal(nanErrs.length, 1);
  assert.equal(nanErrs[0].nodeId, 'n_plan');
});

test('V3: the kind set is {agent, task, and, or, combine, end} — await and merge are NOT kinds', () => {
  for (const kind of ['await', 'merge']) {
    const t = clone(FIXTURE_DEFAULT);
    const n = nodeOf(t, 'n_clarify');
    n.kind = kind;
    delete n.key;
    const errs = validateGraph(t, ports).errors;
    assert.ok(of(errs, 'V3').some((e) => e.nodeId === 'n_clarify'), `kind '${kind}' must be rejected`);
  }
  // task / and / or / end are all accepted kinds — the fixtures carry every one.
  assert.equal(has(validateGraph(FIXTURE_DEFAULT, ports).errors, 'V3'), false);
  assert.equal(has(validateGraph(FIXTURE_FLOW, ports).errors, 'V3'), false);
  const noKey = clone(FIXTURE_DEFAULT);
  delete nodeOf(noKey, 'n_clarify').key;
  assert.ok(of(validateGraph(noKey, ports).errors, 'V3').some((e) => e.nodeId === 'n_clarify'));
});

test('V4: an unknown agent key names the v1-sidecar migration, acyclic AND inside a cycle', () => {
  const PINNED = "agent 'nope' is not loaded — a metaVersion-1 sidecar must be migrated to 2";
  const acyclic = clone(FIXTURE_DEFAULT);
  nodeOf(acyclic, 'n_clarify').key = 'nope';                  // outside every cycle
  const acyclicErrs = of(validateGraph(acyclic, ports).errors, 'V4');
  assert.equal(acyclicErrs.length, 1);
  assert.equal(acyclicErrs[0].msg, PINNED);
  assert.equal(acyclicErrs[0].nodeId, 'n_clarify');

  const cyclic = clone(FIXTURE_DEFAULT);
  nodeOf(cyclic, 'n_refine').key = 'nope';                    // keeps the w5 self-wire
  const res = validateGraph(cyclic, ports);                   // must not crash on the cycle
  assert.ok(of(res.errors, 'V4').some((e) => e.msg === PINNED && e.nodeId === 'n_refine'));
  // Measured cascade: the orphaned maxCycles (V13), the from-ports that no longer
  // resolve (V9) and the nodes they stranded (V15).
  assert.ok(has(res.errors, 'V13'));
  assert.ok(of(res.errors, 'V9').some((e) => e.nodeId === 'n_impl'));
  // The entry set is RESOLVED-ports-with-zero-inputs; a node whose meta does not
  // resolve is excluded, or it would look like an entry and suppress the cascade.
  assert.ok(of(res.warnings, 'V15').some((w) => w.nodeId === 'n_refine'));
  assert.ok(of(res.warnings, 'V15').some((w) => w.nodeId === 'n_impl'));
});

test('V4: a placeable:false meta is rejected as a node, naming the flag', () => {
  const t = clone(FIXTURE_DEFAULT);
  nodeOf(t, 'n_clarify').key = 'workspaceScanner';            // placeable: false in the port table
  const errs = of(validateGraph(t, ports).errors, 'V4');
  assert.equal(errs.length, 1);
  assert.equal(errs[0].nodeId, 'n_clarify');
  assert.match(errs[0].msg, /placeable/);
});

// ---------------------------------------------------------------- V5 - V7

test('V5: dangling endpoints and undeclared ports are errors, never a crash', () => {
  const t = clone(FIXTURE_DEFAULT);
  t.wires.push({ id: 'wGhost', from: { node: 'n_plan', port: 'plan' }, to: { node: 'n_ghost', port: 'plan' } });
  t.wires.push({ id: 'wPort', from: { node: 'n_plan', port: 'nope' }, to: { node: 'n_review', port: 'nope' } });
  const errs = of(validateGraph(t, ports).errors, 'V5');
  assert.ok(errs.some((e) => e.wireId === 'wGhost' && /n_ghost/.test(e.msg)));
  assert.ok(errs.some((e) => e.wireId === 'wPort' && /output/.test(e.msg)));
  assert.ok(errs.some((e) => e.wireId === 'wPort' && /input/.test(e.msg)));
});

test('V6: duplicate wire ids and duplicate (from,to) pairs', () => {
  const dupId = clone(FIXTURE_DEFAULT);
  dupId.wires.push({ id: 'w4', from: { node: 'n_plan', port: 'plan' }, to: { node: 'n_review', port: 'await' } });
  assert.ok(of(validateGraph(dupId, ports).errors, 'V6').some((e) => e.wireId === 'w4'));

  const dupPair = clone(FIXTURE_DEFAULT);
  dupPair.wires.push({ id: 'w11', from: { node: 'n_refine', port: 'plan' }, to: { node: 'n_impl', port: 'plan' } });
  const errs = validateGraph(dupPair, ports).errors;
  // A duplicate pair is BOTH a duplicate wire (V6) and a second wire into a wired
  // input (V7) — distinct codes, both must be reported.
  assert.ok(of(errs, 'V6').some((e) => e.wireId === 'w11'));
  assert.ok(of(errs, 'V7').some((e) => e.wireId === 'w11'));
});

test('V7: every input accepts at most ONE wire — agents, or inK, end.result, await', () => {
  const cases = [
    ['n_impl', 'plan', { node: 'n_plan', port: 'plan' }, FIXTURE_DEFAULT],
    ['n_impl', 'fix', { node: 'n_plan', port: 'plan' }, FIXTURE_DEFAULT],
    ['n_end', 'result', { node: 'n_plan', port: 'plan' }, FIXTURE_DEFAULT],
    ['n_or', 'in1', { node: 'n_review', port: 'review' }, FIXTURE_FLOW],
  ];
  for (const [nodeId, port, from, fixture] of cases) {
    const t = clone(fixture);
    t.wires.push({ id: 'wDup', from, to: { node: nodeId, port } });
    const errs = of(validateGraph(t, ports).errors, 'V7');
    assert.equal(errs.length, 1, `${nodeId}.${port} must report exactly one V7`);
    assert.equal(errs[0].nodeId, nodeId);                   // names the INPUT ...
    assert.match(errs[0].msg, new RegExp(`${nodeId}\\.${port}`));
    assert.equal(errs[0].wireId, 'wDup');                   // ... and carries the offending 2nd wire
  }
});

test('V7: two wires into one await port is the SAME rule (was V22, now subsumed)', () => {
  const t = clone(FIXTURE_DEFAULT);
  t.wires.push({ id: 'wA1', from: { node: 'n_plan', port: 'plan' }, to: { node: 'n_review', port: 'await' } });
  t.wires.push({ id: 'wA2', from: { node: 'n_clarify', port: 'answers' }, to: { node: 'n_review', port: 'await' } });
  const errs = of(validateGraph(t, ports).errors, 'V7');
  assert.equal(errs.length, 1);
  assert.equal(errs[0].nodeId, 'n_review');
  assert.equal(errs[0].wireId, 'wA2');
  assert.match(errs[0].msg, /n_review\.await/);
  assert.equal(has(validateGraph(t, ports).errors, 'V22'), false);   // number retired, never emitted
});

test('V7/V8: one wire each is clean, and ANY output type may feed an await port', () => {
  const t = clone(FIXTURE_DEFAULT);
  t.wires.push({ id: 'wMd', from: { node: 'n_plan', port: 'plan' }, to: { node: 'n_review', port: 'await' } });
  t.wires.push({ id: 'wVoid', from: { node: 'n_review', port: 'pass' }, to: { node: 'n_impl', port: 'await' } });
  t.wires.push({ id: 'wJson', from: { node: 'n_clarify', port: 'answers' }, to: { node: 'n_refine', port: 'await' } });
  const { errors } = validateGraph(t, ports);
  assert.equal(has(errors, 'V7'), false);
  assert.equal(has(errors, 'V8'), false);
});

// ---------------------------------------------------------------- V8

test('V8: plain per-wire type equality', () => {
  const t = clone(FIXTURE_DEFAULT);
  wireOf(t, 'w4').from = { node: 'n_clarify', port: 'answers' };     // json -> md
  const errs = of(validateGraph(t, ports).errors, 'V8');
  assert.equal(errs.length, 1);
  assert.equal(errs[0].wireId, 'w4');
  assert.match(errs[0].msg, /json -> md/);
});

test('V8: `any` inputs accept every source, and AND cards chain', () => {
  // FIXTURE_FLOW already lands md on and.in1, void on and.in2 and md on end.result.
  assert.equal(has(validateGraph(FIXTURE_FLOW, ports).errors, 'V8'), false);
  assert.equal(has(validateGraph(AND_CHAIN, ports).errors, 'V8'), false);
});

test('V8: and.out is STATIC void — the AND side has no type resolution', () => {
  const t = clone(FIXTURE_FLOW);
  dropWire(t, 'w10');                                   // free n_check.plan (V7)
  wireOf(t, 'w13').to = { node: 'n_check', port: 'plan' };
  const errs = of(validateGraph(t, ports).errors, 'V8');
  assert.equal(errs.length, 1);
  assert.equal(errs[0].wireId, 'w13');
  assert.match(errs[0].msg, /void -> md/);
});

test('V8: or.out resolves from its inbound wires, and its outbound wires are checked', () => {
  assert.equal(has(validateGraph(FIXTURE_FLOW, ports).errors, 'V8'), false);   // md or -> md input
  const jsonPlan = withPorts((p) => { p.manualTestsChecklist.inputs[0].type = 'json'; });
  const errs = of(validateGraph(FIXTURE_FLOW, jsonPlan).errors, 'V8');
  assert.equal(errs.length, 1);
  assert.equal(errs[0].wireId, 'w10');
  assert.match(errs[0].msg, /md -> json/);
});

test('V8: resolution walks THROUGH chained ors and terminates on a cyclic chain', () => {
  assert.equal(has(validateGraph(OR_CHAIN, ports).errors, 'V8'), false);       // or1(md) -> or2 -> md input
  const cyclic = validateGraph(OR_CYCLE, ports);                               // seen-set: returns, never hangs
  assert.equal(has(cyclic.errors, 'V8'), false);                               // unresolvable ⇒ skipped
  assert.ok(has(cyclic.errors, 'V12'));                                        // the unwired inKs are V12's
});

test('V8: an all-void or resolves to void', () => {
  const errs = of(validateGraph(OR_VOID_FEED, ports).errors, 'V8');
  assert.equal(errs.length, 1);
  assert.equal(errs[0].wireId, 'w5');
  assert.match(errs[0].msg, /void -> md/);
});

test('V8: an or with unwired ins resolves to null and is SKIPPED (V12 owns it)', () => {
  const t = clone(FIXTURE_FLOW);
  dropWire(t, 'w8');
  dropWire(t, 'w9');
  const { errors } = validateGraph(t, ports);
  assert.equal(has(errors, 'V8'), false);
  assert.ok(of(errors, 'V12').some((e) => e.nodeId === 'n_or'));
  // Flow-card inputs are synthesized required:true, so V9 fires alongside.
  assert.ok(of(errors, 'V9').some((e) => e.nodeId === 'n_or'));
});

// ---------------------------------------------------------------- V9 - V11

test('V9: required inputs must be wired; optional ones need not be', () => {
  const t = clone(FIXTURE_DEFAULT);
  dropWire(t, 'w6');                                        // refiner.plan -> implementer.plan
  const res = validateGraph(t, ports);
  assert.ok(of(res.errors, 'V9').some((e) => e.nodeId === 'n_impl' && /n_impl\.plan/.test(e.msg)));
  // planner.revise is optional (and a loop input) and unwired in the baseline.
  assert.equal(has(validateGraph(FIXTURE_DEFAULT, ports).errors, 'V9'), false);
  // An unwired required input inside an SCC is NOT a deadlock — n_review still starts.
  assert.equal(has(res.errors, 'V11'), false);
});

test('V10: a cycle whose wires are all always-sourced has no blocking-source edge', () => {
  const alwaysReview = withPorts((p) => {
    p.reviewer.outputs.push({
      id: 'reviewAlways', type: 'md', when: 'always',
      filename: '{base}-impl-review.md', store: 'project', artifactKind: 'review',
    });
  });
  const t = clone(FIXTURE_DEFAULT);
  wireOf(t, 'w9').from = { node: 'n_review', port: 'reviewAlways' };
  delete wireOf(t, 'w9').config;                            // else V13 fires on the orphaned budget
  const errs = of(validateGraph(t, alwaysReview).errors, 'V10');
  assert.equal(errs.length, 1);
  assert.match(errs[0].msg, /n_impl/);
  assert.match(errs[0].msg, /n_review/);
  assert.match(errs[0].msg, /w9/);                          // names the cycle's wires
});

test('V10: a SELF-WIRED singleton is a nontrivial cycle too', () => {
  const alwaysRevise = withPorts((p) => { p.refiner.outputs[1].when = 'always'; });
  const t = clone(FIXTURE_DEFAULT);
  delete wireOf(t, 'w5').config;                            // the budget is V13's story, not this one
  const errs = of(validateGraph(t, alwaysRevise).errors, 'V10');
  assert.equal(errs.length, 1);
  assert.match(errs[0].msg, /n_refine/);
  assert.match(errs[0].msg, /w5/);
});

test('V11: an SCC where every member waits on another member deadlocks', () => {
  const t = clone(FIXTURE_DEFAULT);
  wireOf(t, 'w7').from = { node: 'n_review', port: 'review' };   // n_review.plan from inside the SCC
  wireOf(t, 'w6').from = { node: 'n_review', port: 'review' };   // n_impl.plan   from inside the SCC
  const res = validateGraph(t, ports);
  assert.ok(of(res.errors, 'V11').some((e) => /n_impl/.test(e.msg) && /n_review/.test(e.msg)));
  assert.ok(has(res.warnings, 'V15'));                           // the SCC is now unreachable
  assert.ok(has(res.warnings, 'V19'));                           // blocking review -> plain plan inputs
});

// ---------------------------------------------------------------- V12

test('V12: arity must be an explicit integer >= 2 when present', () => {
  for (const [fixture, nodeId] of [[FIXTURE_FLOW, 'n_and'], [FIXTURE_FLOW, 'n_or']]) {
    const t = clone(fixture);
    nodeOf(t, nodeId).config.arity = 1;
    const errs = validateGraph(t, ports).errors;
    assert.ok(of(errs, 'V12').some((e) => e.nodeId === nodeId && /arity/.test(e.msg)));
    assert.ok(has(errs, 'V5'), 'the in2 wire dangles once arity drops to 1');
  }
  const frac = clone(FIXTURE_FLOW);
  nodeOf(frac, 'n_and').config.arity = 2.5;
  assert.ok(of(validateGraph(frac, ports).errors, 'V12').some((e) => e.nodeId === 'n_and'));
  // ABSENT arity is legal — portsFnFor defaults it to 2.
  const absent = clone(FIXTURE_FLOW);
  delete nodeOf(absent, 'n_and').config.arity;
  assert.equal(has(validateGraph(absent, ports).errors, 'V12'), false);
});

test('V12 owns "every inK wired"; V9 is defence in depth, never the sole reporter', () => {
  const t = clone(FIXTURE_FLOW);
  dropWire(t, 'w12');                                       // and.in2
  const errs = validateGraph(t, ports).errors;
  assert.ok(of(errs, 'V12').some((e) => e.nodeId === 'n_and' && /in2/.test(e.msg)));
  assert.ok(of(errs, 'V9').some((e) => e.nodeId === 'n_and'));

  const combine = clone(COMBINE_SINK);
  dropWire(combine, 'w4');                                  // combine.in2
  const cErrs = validateGraph(combine, ports).errors;
  assert.ok(of(cErrs, 'V12').some((e) => e.nodeId === 'n_combine' && /in2/.test(e.msg)));
  assert.ok(of(cErrs, 'V9').some((e) => e.nodeId === 'n_combine'));
});

test('V12: or homogeneity names the MISMATCHED WIRES', () => {
  const t = clone(FIXTURE_DEFAULT);                         // the only fixture with a json output
  t.nodes.push({ id: 'n_or', kind: 'or', x: 900, y: 600, config: { arity: 2 } });
  t.wires.push({ id: 'wOr1', from: { node: 'n_plan', port: 'plan' }, to: { node: 'n_or', port: 'in1' } });
  t.wires.push({ id: 'wOr2', from: { node: 'n_clarify', port: 'answers' }, to: { node: 'n_or', port: 'in2' } });
  const errs = of(validateGraph(t, ports).errors, 'V12').filter((e) => e.nodeId === 'n_or');
  assert.equal(errs.length, 1);
  assert.deepEqual([...errs[0].wireIds].sort(), ['wOr1', 'wOr2']);
  assert.equal(errs[0].wireId, undefined);                  // plural field, not the singular one

  const homogeneous = clone(t);
  wireOf(homogeneous, 'wOr2').from = { node: 'n_refine', port: 'plan' };   // md + md
  assert.equal(has(validateGraph(homogeneous, ports).errors, 'V12'), false);
});

test('V12: homogeneity resolves through chained ors (shared seen-set walk)', () => {
  assert.equal(has(validateGraph(OR_CHAIN, ports).errors, 'V12'), false);
  const t = clone(OR_CHAIN);
  wireOf(t, 'wg').from = { node: 'n_clarify', port: 'answers' };   // or2: md (through or1) + json
  const errs = of(validateGraph(t, ports).errors, 'V12').filter((e) => e.nodeId === 'n_or2');
  assert.equal(errs.length, 1);
  assert.deepEqual([...errs[0].wireIds].sort(), ['wf', 'wg']);
});

// ---------------------------------------------------------------- V13 - V14

test('V13: maxCycles lives on loop wires only, and non-always outputs need a verdict', () => {
  const t = clone(FIXTURE_DEFAULT);
  wireOf(t, 'w2').config = { maxCycles: 2 };                // a plain forward wire
  assert.ok(of(validateGraph(t, ports).errors, 'V13').some((e) => e.wireId === 'w2'));

  const valve = clone(OR_FANNED);
  wireOf(valve, 'we').config = { maxCycles: 3 };            // always-sourced, in-SCC: budgets belong on wc/wd
  assert.ok(of(validateGraph(valve, ports).errors, 'V13').some((e) => e.wireId === 'we'));

  const badWhen = withPorts((p) => { p.clarify.outputs[0].when = 'sometimes'; });
  assert.ok(of(validateGraph(FIXTURE_DEFAULT, badWhen).errors, 'V13').some((e) => e.nodeId === 'n_clarify'));

  const zero = clone(FIXTURE_DEFAULT);
  wireOf(zero, 'w9').config = { maxCycles: 0 };
  assert.ok(of(validateGraph(zero, ports).errors, 'V13').some((e) => e.wireId === 'w9'));
});

test('V14: `expands` inputs must be json', () => {
  const mdExpands = withPorts((p) => { p.refiner.inputs[0].expands = true; });   // plan is md
  const errs = of(validateGraph(FIXTURE_DEFAULT, mdExpands).errors, 'V14');
  assert.equal(errs.length, 1);
  assert.equal(errs[0].nodeId, 'n_refine');
  // implementer.task is expands + json in the baseline and must NOT fire.
  assert.equal(has(validateGraph(FIXTURE_DEFAULT, ports).errors, 'V14'), false);
});

// ---------------------------------------------------------------- V15 - V17

test('V15: a node with no path from any entry warns', () => {
  const t = clone(FIXTURE_DEFAULT);
  t.nodes.push({ id: 'n_lonely', kind: 'agent', key: 'decomposer', x: 200, y: 700, config: {} });
  const res = validateGraph(t, ports);
  assert.ok(of(res.warnings, 'V15').some((w) => w.nodeId === 'n_lonely'));
  assert.equal(res.errors.length > 0, true);                // its required plan input is unwired (V9)
});

test('V16: awaitAll with fewer than 2 wired non-loop inputs is a no-op warning', () => {
  const t = clone(FIXTURE_DEFAULT);
  nodeOf(t, 'n_refine').config.awaitAll = true;             // plan wired, revise is a loop input, await unwired
  assert.ok(of(validateGraph(t, ports).warnings, 'V16').some((w) => w.nodeId === 'n_refine'));

  const withAwait = clone(t);                               // ... a wired await is the second input
  withAwait.wires.push({ id: 'wAw', from: { node: 'n_clarify', port: 'answers' }, to: { node: 'n_refine', port: 'await' } });
  assert.equal(has(validateGraph(withAwait, ports).warnings, 'V16'), false);
});

test('V17: unknown config keys warn PER KIND, are preserved and are ignored', () => {
  const t = clone(FIXTURE_DEFAULT);
  nodeOf(t, 'n_plan').config.nope = 1;
  const res = validateGraph(t, ports);
  assert.ok(of(res.warnings, 'V17').some((w) => w.nodeId === 'n_plan' && /nope/.test(w.msg)));
  assert.deepEqual(res.errors, []);                         // warnings never block

  const orAwait = clone(FIXTURE_FLOW);
  nodeOf(orAwait, 'n_or').config.awaitAll = true;           // an AGENT key on a flow card
  const orRes = validateGraph(orAwait, ports);
  assert.ok(of(orRes.warnings, 'V17').some((w) => w.nodeId === 'n_or' && /awaitAll/.test(w.msg)));
  assert.equal(nodeOf(orAwait, 'n_or').config.awaitAll, true, 'preserved, not stripped');
  assert.equal(has(orRes.warnings, 'V16'), false, 'V16 is scoped to agent nodes');
  // ... and the card's firing is unchanged: an or still fires on ANY fresh input.
  assert.equal(isReady(nodeOf(orAwait, 'n_or'), {
    portsFn: ports,
    wiredIn: new Map([['in1', 'w8'], ['in2', 'w9']]),
    loopInputs: new Set(),
    tokens: new Map([['n_or.in1', { seq: 1, type: 'md' }]]),
    consumed: new Map(),
    everRan: false,
    awaitAll: true,
    isFlow: true,
  }), true);
});

// ---------------------------------------------------------------- V18

test('V18: two always-sourced non-void inputs on an AGENT node without awaitAll', () => {
  const mdDone = withPorts((p) => {
    p.implementer.outputs[0].type = 'md';                   // done: void -> md
    p.reviewer.inputs[1].type = 'md';
  });
  const t = clone(FIXTURE_DEFAULT);
  wireOf(t, 'w7').from = { node: 'n_plan', port: 'plan' };  // the ONLY always-sourced md reaching n_review
  const warns = of(validateGraph(t, mdDone).warnings, 'V18');
  assert.equal(warns.length, 1);
  assert.equal(warns[0].nodeId, 'n_review');

  const silenced = clone(t);                                // awaitAll is the documented fix
  nodeOf(silenced, 'n_review').config.awaitAll = true;
  assert.equal(has(validateGraph(silenced, mdDone).warnings, 'V18'), false);
});

test('V18 exemption (a): task-node-sourced inputs never enter the pair count', () => {
  const mdDone = withPorts((p) => {
    p.implementer.outputs[0].type = 'md';
    p.reviewer.inputs[1].type = 'md';
  });
  const t = clone(FIXTURE_DEFAULT);
  wireOf(t, 'w7').from = { node: 'n_task', port: 'task' };
  assert.equal(has(validateGraph(t, mdDone).warnings, 'V18'), false);
});

test('V18 exemption (b): VOID inputs are pure sequencing', () => {
  const t = clone(FIXTURE_DEFAULT);
  wireOf(t, 'w7').from = { node: 'n_plan', port: 'plan' };  // load-bearing: without it the case is vacuous
  assert.equal(has(validateGraph(t, ports).warnings, 'V18'), false);   // done stays VOID
});

test('V18 exemption (c): the synthesized await port never enters the pair count', () => {
  const mdDone = withPorts((p) => {
    p.implementer.outputs[0].type = 'md';
    p.reviewer.inputs[1].type = 'md';
  });
  const t = clone(FIXTURE_DEFAULT);
  wireOf(t, 'w7').from = { node: 'n_plan', port: 'plan' };
  t.wires.push({ id: 'wAw', from: { node: 'n_plan', port: 'plan' }, to: { node: 'n_review', port: 'await' } });
  const warns = of(validateGraph(t, mdDone).warnings, 'V18');
  assert.equal(warns.length, 1);
  assert.equal(warns[0].nodeId, 'n_review');
  assert.match(warns[0].msg, /has 2 always-sourced/);       // still exactly the PAIR — await never counted
});

test('V18 exemption (d): loop inputs never enter the pair count (the or.out valve)', () => {
  const res = validateGraph(LOOP_VALVE, ports);
  assert.equal(has(res.warnings, 'V18'), false);            // or.out -> fix is ALWAYS-sourced but loop:true
  assert.deepEqual(res.errors, []);
  assert.deepEqual(res.warnings, []);
});

test('V18: the pair count is AGENT-only — flow cards have defined join semantics', () => {
  const t = clone(FIXTURE_FLOW);
  wireOf(t, 'w9').from = { node: 'n_plan', port: 'plan' };  // both or ins now always-sourced
  assert.equal(has(validateGraph(t, ports).warnings, 'V18'), false);
});

// ---------------------------------------------------------------- V19

test('V19: a blocking output on a plain payload input warns', () => {
  const t = clone(FIXTURE_FLOW);
  wireOf(t, 'w10').from = { node: 'n_review', port: 'review' };   // -> n_check.plan, no loop:true
  const warns = of(validateGraph(t, ports).warnings, 'V19');
  assert.ok(warns.some((w) => w.wireId === 'w10'));
});

test('V19: loop inputs, and/or inK, end.result and await targets are exempt', () => {
  // ONE blocking output into a loop:true input — the wf_default w9 shape.
  assert.equal(has(validateGraph(FIXTURE_DEFAULT, ports).warnings, 'V19'), false);

  const orIn = clone(FIXTURE_FLOW);
  wireOf(orIn, 'w9').from = { node: 'n_review', port: 'review' };  // -> or.in2
  assert.equal(has(validateGraph(orIn, ports).warnings, 'V19'), false);

  const andIn = clone(FIXTURE_FLOW);
  wireOf(andIn, 'w11').from = { node: 'n_review', port: 'review' };  // -> and.in1
  assert.equal(has(validateGraph(andIn, ports).warnings, 'V19'), false);

  const endResult = clone(FIXTURE_DEFAULT);
  wireOf(endResult, 'w10').from = { node: 'n_review', port: 'review' };
  assert.equal(has(validateGraph(endResult, ports).warnings, 'V19'), false);

  const awaitPort = clone(FIXTURE_FLOW);
  wireOf(awaitPort, 'w13').from = { node: 'n_review', port: 'review' };  // -> n_check.await
  assert.equal(has(validateGraph(awaitPort, ports).warnings, 'V19'), false);

  // or.out is an ALWAYS source: V19 is blocking-source only, so the valve is quiet.
  assert.equal(has(validateGraph(OR_FANNED, ports).warnings, 'V19'), false);
});

test('V19: Combine inputs are payload-bearing and still warn', () => {
  const warns = of(validateGraph(COMBINE_SINK, ports).warnings, 'V19');
  assert.equal(warns.length, 1);
  assert.equal(warns[0].wireId, 'w3');
});

// ---------------------------------------------------------------- V20 - V21

test('V20: exactly one task node, zero inputs, its task output wired', () => {
  const deleted = clone(FIXTURE_DEFAULT);
  dropNode(deleted, 'n_task');
  const delRes = validateGraph(deleted, ports);
  assert.ok(has(delRes.errors, 'V20'));
  assert.ok(has(delRes.errors, 'V5'));                      // w1/w2 dangle
  assert.ok(of(delRes.errors, 'V9').some((e) => e.nodeId === 'n_clarify'));
  assert.ok(has(delRes.warnings, 'V15'));                   // no entry left at all

  const second = clone(FIXTURE_DEFAULT);
  second.nodes.push({ id: 'n_task_b', kind: 'task', x: 40, y: 600, config: {} });
  assert.ok(of(validateGraph(second, ports).errors, 'V20').some((e) => /exactly one/.test(e.msg)));

  const unwired = clone(FIXTURE_DEFAULT);
  dropWire(unwired, 'w1');
  dropWire(unwired, 'w2');
  assert.ok(of(validateGraph(unwired, ports).errors, 'V20').some((e) => e.nodeId === 'n_task'));
});

test('V21: exactly one end node, zero outputs, its result wired (one wire, per V7)', () => {
  const deleted = clone(FIXTURE_DEFAULT);
  dropNode(deleted, 'n_end');
  const delRes = validateGraph(deleted, ports);
  assert.ok(of(delRes.errors, 'V21').some((e) => /exactly one/.test(e.msg)));
  assert.ok(of(delRes.errors, 'V5').some((e) => e.wireId === 'w10'));

  const second = clone(FIXTURE_DEFAULT);
  second.nodes.push({ id: 'n_end_b', kind: 'end', x: 1720, y: 600, config: {} });
  assert.ok(of(validateGraph(second, ports).errors, 'V21').some((e) => /exactly one/.test(e.msg)));

  const unwired = clone(FIXTURE_DEFAULT);
  dropWire(unwired, 'w10');
  const unwiredErrs = validateGraph(unwired, ports).errors;
  assert.ok(of(unwiredErrs, 'V21').some((e) => e.nodeId === 'n_end' && /result/.test(e.msg)));
  assert.ok(of(unwiredErrs, 'V9').some((e) => e.nodeId === 'n_end'));
});

// ---------------------------------------------------------------- contract

test('errors block and warnings do not: the two lists are disjoint and independently populated', () => {
  const warnOnly = clone(FIXTURE_DEFAULT);
  nodeOf(warnOnly, 'n_plan').config.nope = 1;
  const w = validateGraph(warnOnly, ports);
  assert.equal(w.errors.length, 0);
  assert.ok(w.warnings.length > 0);

  const errOnly = clone(FIXTURE_DEFAULT);
  errOnly.version = 1;
  const e = validateGraph(errOnly, ports);
  assert.ok(e.errors.length > 0);
  assert.deepEqual(e.warnings, []);
  for (const entry of [...e.errors, ...w.warnings]) {
    assert.match(entry.code, /^V(?:[1-9]|1[0-9]|2[01])$/);   // V1..V21, never V22
    assert.equal(typeof entry.msg, 'string');
    assert.ok(entry.msg.length > 0);
  }
});
