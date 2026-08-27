import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RULES, validateGraph, formatIssue } from '../src/shared/graph/validate.mjs';
import { portsFnFor } from '../src/shared/graph/ports.mjs';

// Inline fixture registry (the REAL sidecars arrive in test/helpers/graph-ports.mjs
// at Task 10 Step 4 and are exercised by the seed drift guard, Task 13).
const REG = {
  planner: { key: 'planner', inputs: [{ id: 'task', type: 'md', required: true },
      { id: 'answers', type: 'json', required: false }, { id: 'revise', type: 'md', required: false, loop: true }],
    outputs: [{ id: 'plan', type: 'md', when: 'always' }] },
  // `fix` is required AND loop: that combination is what makes V9's loop
  // exemption (and V11's, and V18's (d)) load-bearing instead of vacuous.
  impl: { key: 'impl', inputs: [{ id: 'fix', type: 'md', required: true, loop: true },
      { id: 'task', type: 'json', required: false, expands: true }, { id: 'plan', type: 'md', required: true }],
    outputs: [{ id: 'done', type: 'void', when: 'always' }] },
  reviewer: { key: 'reviewer', verdict: { filename: 'r.json' },
    inputs: [{ id: 'plan', type: 'md', required: true }, { id: 'done', type: 'void', required: false }],
    outputs: [{ id: 'review', type: 'md', when: 'blocking' }, { id: 'pass', type: 'void', when: 'clean' }] },
  clarify: { key: 'clarify', inputs: [{ id: 'task', type: 'md', required: true }],
    outputs: [{ id: 'answers', type: 'json', when: 'always' }] },
  legacy: { key: 'legacy' },                                     // known but not ported
  hidden: { key: 'hidden', placeable: false, inputs: [], outputs: [{ id: 'out', type: 'md', when: 'always' }] },
};
const portsFn = portsFnFor(REG);
const V = (tpl, opts) => validateGraph(tpl, portsFn, opts);
const codes = (list) => list.map((i) => i.code);
const A = (id, key, config = {}) => ({ id, kind: 'agent', key, x: 0, y: 0, config });
const F = (id, kind, config = {}) => ({ id, kind, x: 0, y: 0, config });
const W = (id, fn, fp, tn, tp, config) => ({ id, from: { node: fn, port: fp }, to: { node: tn, port: tp },
  ...(config ? { config } : {}) });
// task -> planner -> impl -> reviewer -{blocking}-> impl.fix (a loop), reviewer.pass -> end
const ok = () => ({
  id: 'wf_t', name: 'T', version: 2, domain: 'coding',
  nodes: [F('n_task', 'task'), A('n_plan', 'planner'), A('n_impl', 'impl'), A('n_rev', 'reviewer'), F('n_end', 'end')],
  wires: [W('w1', 'n_task', 'task', 'n_plan', 'task'), W('w2', 'n_plan', 'plan', 'n_impl', 'plan'),
    W('w3', 'n_plan', 'plan', 'n_rev', 'plan'), W('w4', 'n_impl', 'done', 'n_rev', 'done'),
    W('w5', 'n_rev', 'review', 'n_impl', 'fix', { maxCycles: 3 }), W('w6', 'n_rev', 'pass', 'n_end', 'result')],
});

test('the rule table is V1..V21 in order, with V22 retired', () => {
  assert.deepEqual(RULES.map((r) => r.code),
    ['V1','V2','V3','V4','V5','V6','V7','V8','V9','V10','V11','V12','V13','V14','V15','V16','V17','V18','V19','V20','V21']);
  assert.deepEqual(RULES.filter((r) => r.level === 'W').map((r) => r.code), ['V15','V16','V17','V18','V19']);
  for (const r of RULES) assert.equal(typeof r.check, 'function', `${r.code} has a check`);
});

test('a legal graph validates clean', () => {
  const r = V(ok());
  assert.deepEqual(r.errors, [], JSON.stringify(r.errors));
  assert.deepEqual(r.warnings, [], JSON.stringify(r.warnings));
  assert.equal(r.ok, true);
});

test('V1 shape + limits', () => {
  assert.deepEqual(codes(V(null).errors).filter((c) => c === 'V1').length ? ['V1'] : [], ['V1']);
  assert.match(V({ ...ok(), version: 1 }).errors.find((e) => e.code === 'V1').message, /version must be 2 \(got 1\)/);
  assert.ok(V({ ...ok(), nodes: [] }).errors.some((e) => e.code === 'V1'));
  assert.ok(V({ ...ok(), wires: undefined }).errors.some((e) => e.code === 'V1'));
  const big = { ...ok(), nodes: [...ok().nodes, ...Array.from({ length: 3 }, (_, i) => A(`x${i}`, 'clarify'))] };
  assert.match(V(big, { limits: { maxNodes: 4, maxWires: 99 } }).errors.find((e) => e.code === 'V1').message,
    /template has 8 nodes — the limit is 4/);
  assert.ok(V(ok(), { limits: { maxNodes: 99, maxWires: 2 } }).errors.some((e) => /wires — the limit is 2/.test(e.message)));
  assert.equal(V(ok(), { limits: { maxNodes: 99, maxWires: 99 } }).ok, true);
});

test('V1 REJECTS malformed nodes/wires entries instead of silently filtering them', () => {
  // A non-object entry used to be dropped by buildContext and validate clean, so
  // the row was written and every consumer that does NOT filter (Ask's
  // shapeWorkflow, the layout, the thumbnail) crashed on it afterwards.
  const t = { ...ok(), nodes: [null, ...ok().nodes, 7], wires: [...ok().wires, 'junk'] };
  const r = V(t);
  const v1 = r.errors.filter((e) => e.code === 'V1').map((e) => e.message);
  assert.ok(v1.includes('nodes[0] must be an object (got null)'), JSON.stringify(v1));
  assert.ok(v1.includes('nodes[6] must be an object (got 7)'), JSON.stringify(v1));
  assert.ok(v1.includes('wires[6] must be an object (got "junk")'), JSON.stringify(v1));
  assert.equal(r.ok, false);
});

test('a node with a non-string id is never indexed, so an endpoint-less wire cannot resolve through it', () => {
  // `nodes:[{}], wires:[{}]` indexed the node under the key `undefined`, so
  // `nodeById.has(w?.from?.node)` said true and the next dereference threw —
  // POST /api/workflows answered 500 instead of the validator's 422.
  const bare = V({ version: 2, nodes: [{}], wires: [{}] });
  assert.equal(bare.ok, false);
  assert.ok(bare.errors.some((e) => e.code === 'V2' && /must match/.test(e.message)));
  assert.ok(bare.errors.some((e) => e.code === 'V5' && /starts at unknown node/.test(e.message)));
  assert.ok(bare.errors.some((e) => e.code === 'V5' && /ends at unknown node/.test(e.message)));
  // Half-wires, both directions (the throws at validate.mjs:87 and :173).
  const noFrom = V({ ...ok(), wires: [...ok().wires, { id: 'w9', to: { node: 'n_impl', port: 'plan' } }] });
  assert.ok(noFrom.errors.some((e) => e.code === 'V5' && /wire 'w9' starts at unknown node/.test(e.message)));
  const noTo = V({ ...ok(), wires: [...ok().wires, { id: 'w9', from: { node: 'n_plan', port: 'plan' } }] });
  assert.ok(noTo.errors.some((e) => e.code === 'V5' && /wire 'w9' ends at unknown node/.test(e.message)));
});

test('V2 node ids and coordinates', () => {
  const t = ok(); t.nodes[1] = { ...t.nodes[1], id: 'bad id' };
  assert.ok(V(t).errors.some((e) => e.code === 'V2' && /must match/.test(e.message)));
  const d = ok(); d.nodes.push(A('n_plan', 'clarify'));
  assert.ok(V(d).errors.some((e) => e.code === 'V2' && /duplicate node id 'n_plan'/.test(e.message)));
  const c = ok(); c.nodes[1] = { ...c.nodes[1], x: NaN };
  assert.ok(V(c).errors.some((e) => e.code === 'V2' && /finite x\/y/.test(e.message)));
});

test('V3 kinds and the key rule', () => {
  const t = ok(); t.nodes.push(F('n_weird', 'merge'));
  assert.ok(V(t).errors.some((e) => e.code === 'V3' && /unknown kind "merge"/.test(e.message)));
  const k = ok(); k.nodes[1] = { ...k.nodes[1], key: undefined };
  assert.ok(V(k).errors.some((e) => e.code === 'V3' && /must declare a key/.test(e.message)));
  const f = ok(); f.nodes[0] = { ...f.nodes[0], key: 'planner' };
  assert.ok(V(f).errors.some((e) => e.code === 'V3' && /must not declare a key/.test(e.message)));
});

test('V4 unknown agent vs un-ported sidecar vs placeable:false', () => {
  const u = ok(); u.nodes[1] = A('n_plan', 'ghost');
  assert.match(V(u).errors.find((e) => e.code === 'V4').message, /^unknown agent "ghost" — no such key in the registry$/);
  const l = ok(); l.nodes[1] = A('n_plan', 'legacy');
  assert.match(V(l).errors.find((e) => e.code === 'V4').message,
    /^agent "legacy" has no v2 ports — port its sidecar to metaVersion 2$/);
  const p = ok(); p.nodes.push(A('n_hidden', 'hidden'));
  assert.match(V(p).errors.find((e) => e.code === 'V4').message, /placeable: false/);
});

test('V5 endpoints and declared ports', () => {
  const t = ok(); t.wires.push(W('w9', 'ghost', 'task', 'n_plan', 'task'));
  assert.ok(V(t).errors.some((e) => e.code === 'V5' && /starts at unknown node 'ghost'/.test(e.message)));
  const b = ok(); b.wires.push(W('w9', 'n_plan', 'nope', 'n_impl', 'nope2'));
  const msgs = V(b).errors.filter((e) => e.code === 'V5').map((e) => e.message);
  assert.ok(msgs.some((m) => /'n_plan\.nope' is not a declared output/.test(m)));
  assert.ok(msgs.some((m) => /'n_impl\.nope2' is not a declared input/.test(m)));
  // The port halves run ONLY where the meta RESOLVED: an unknown key is V4's
  // one error, and re-reporting every wire hanging off it would bury the cause.
  // (Drop the `metaOf(...)` guards and this goes red with a V5 port message.)
  const gk = ok(); gk.nodes.push(A('n_ghost', 'ghost'));
  gk.wires.push(W('w9', 'n_ghost', 'out', 'n_impl', 'await'));
  // INBOUND wire into the unknown-key node too: exercises V5's `metaOf(toId) &&` guard
  // on its own (without it, dropping only the toId half of the guard survives).
  // `n_task` — the fixture's ONE task node (fan-out from `task` is legal). A typo
  // here (the v2 text said `n_ts`) is a real V5 `starts at unknown node` error and
  // turns this assertion red on a CORRECT validator.
  gk.wires.push({ id: 'w_ghost_in', from: { node: 'n_task', port: 'task' }, to: { node: 'n_ghost', port: 'nope' } });
  assert.deepEqual(V(gk).errors.filter((e) => e.code === 'V5'), [],
    'an unknown key yields V4 only, never a V5 port message');
  assert.ok(V(gk).errors.some((e) => e.code === 'V4'));
});

test('V6 duplicate wire ids and duplicate (from,to) pairs', () => {
  const t = ok(); t.wires.push({ ...t.wires[0], id: 'w1' });
  const e = V(t).errors.filter((x) => x.code === 'V6').map((x) => x.message);
  assert.ok(e.some((m) => /duplicate wire id 'w1'/.test(m)));
  assert.ok(e.some((m) => /duplicate wire n_task\.task -> n_plan\.task/.test(m)));
});

test('V7 every input takes at most ONE wire — agent, await, inK and end.result alike', () => {
  const a = ok(); a.wires.push(W('w9', 'n_plan', 'plan', 'n_impl', 'plan'));
  assert.match(V(a).errors.find((e) => e.code === 'V7').message,
    /^input 'n_impl\.plan' already has an inbound wire — every input accepts at most one \(fan in through an or card\)$/);
  const g = ok(); g.wires.push(W('w9', 'n_plan', 'plan', 'n_impl', 'await'),
    W('w10', 'n_task', 'task', 'n_impl', 'await'));
  assert.ok(V(g).errors.some((e) => e.code === 'V7' && /n_impl\.await/.test(e.message)));
  const s = ok(); s.wires.push(W('w9', 'n_plan', 'plan', 'n_end', 'result'));
  assert.ok(V(s).errors.some((e) => e.code === 'V7' && /n_end\.result/.test(e.message)));
  // Counted over ALL wires, with NO dependency on meta resolution: stacking two
  // wires on an input is wrong even when the key is unknown. (Restrict the rule
  // to `liveWires` and this goes red — neither wire resolves a port.)
  const gh = ok(); gh.nodes.push(A('n_ghost', 'ghost'));
  gh.wires.push(W('w9', 'n_plan', 'plan', 'n_ghost', 'in'), W('w10', 'n_rev', 'pass', 'n_ghost', 'in'));
  assert.ok(V(gh).errors.some((e) => e.code === 'V7' && /n_ghost\.in/.test(e.message)),
    'V7 does not depend on meta resolution');
});

test('V8 per-wire types, any inputs, and the or valve resolution', () => {
  const t = ok(); t.nodes.push(A('n_cl', 'clarify'));
  t.wires.push(W('w7', 'n_task', 'task', 'n_cl', 'task'), W('w8', 'n_cl', 'answers', 'n_impl', 'plan'));
  assert.match(V(t).errors.find((e) => e.code === 'V8').message,
    /^wire 'w8' type mismatch: json -> md \(n_cl\.answers -> n_impl\.plan\)$/);
  const anyOk = ok(); anyOk.wires.push(W('w7', 'n_plan', 'plan', 'n_impl', 'await'));
  assert.equal(V(anyOk).errors.filter((e) => e.code === 'V8').length, 0, 'an any input accepts md');
  // or.out resolves to md from its inbound review wire, so or.out -> impl.fix is legal
  // and or.out -> a json input is not.
  const o = ok();
  o.nodes.push(F('n_or', 'or', { arity: 2 }), A('n_cl', 'clarify'));
  o.wires = [...o.wires.filter((w) => w.id !== 'w5'),
    W('w5', 'n_rev', 'review', 'n_or', 'in1', { maxCycles: 3 }),
    W('w7', 'n_task', 'task', 'n_cl', 'task'), W('w8', 'n_cl', 'answers', 'n_or', 'in2'),
    W('w9', 'n_or', 'out', 'n_impl', 'fix')];
  const r = V(o);
  assert.ok(r.errors.some((e) => e.code === 'V12' && /heterogeneous inbound types/.test(e.message)));
  assert.deepEqual(r.errors.find((e) => e.code === 'V12' && e.wireIds).wireIds.sort(), ['w5', 'w8']);
});

test('V9 required non-loop AGENT inputs must be wired; loop inputs and flow cards exempt', () => {
  const t = ok(); t.wires = t.wires.filter((w) => w.id !== 'w2');
  assert.match(V(t).errors.find((e) => e.code === 'V9').message, /^required input 'n_impl\.plan' is unwired$/);
  // `impl.fix` is required AND loop — unwire it and V9 must stay silent (the
  // valve is optional by construction). Delete the loop exemption -> red.
  const noValve = ok(); noValve.wires = noValve.wires.filter((w) => w.id !== 'w5');
  assert.equal(V(noValve).errors.filter((e) => e.code === 'V9').length, 0,
    'a REQUIRED loop input that is unwired never reports');
  // Flow cards are V12/V21's, never V9's, even though P1 marks `inK` and
  // `result` required:true — drop the `n.kind !== 'agent'` guard and the
  // unwired `in2` below reports TWICE.
  const card = ok(); card.nodes.push(F('n_and', 'and', { arity: 2 }));
  card.wires.push(W('w7', 'n_plan', 'plan', 'n_and', 'in1'), W('w8', 'n_and', 'out', 'n_impl', 'await'));
  assert.deepEqual(V(card).errors.filter((e) => e.code === 'V9'), [], 'V9 is the agent-input rule');
  assert.equal(V(card).errors.filter((e) => e.code === 'V12' && /unwired input 'in2'/.test(e.message)).length, 1);
  assert.equal(V(ok()).errors.filter((e) => e.code === 'V9').length, 0);
});

test('V10 a cycle needs a blocking-source edge', () => {
  const t = ok();
  t.wires = t.wires.map((w) => (w.id === 'w5'
    ? W('w5', 'n_rev', 'pass', 'n_impl', 'fix') : w));       // clean source: no loop wire left
  assert.match(V(t).errors.find((e) => e.code === 'V10').message,
    /^cycle without a blocking-source edge: n_impl, n_rev \(wires w4, w5\)$/);
});

test('V11 deadlock freedom', () => {
  // planner.task and reviewer.plan each fed from INSIDE the cycle => nothing can start.
  const t = ok();
  t.wires = [W('w1', 'n_task', 'task', 'n_impl', 'plan'), W('w2', 'n_plan', 'plan', 'n_rev', 'plan'),
    W('w3', 'n_rev', 'review', 'n_plan', 'task', { maxCycles: 3 }), W('w4', 'n_rev', 'pass', 'n_end', 'result')];
  assert.match(V(t).errors.find((e) => e.code === 'V11').message,
    /^deadlock: no node in cycle n_plan, n_rev can start — every member's required inputs come from inside the cycle$/);
  assert.equal(V(ok()).errors.filter((e) => e.code === 'V11').length, 0);
  // A member whose meta did NOT resolve is assumed startable — V4 already names
  // it, and piling a deadlock on top would bury the real cause. (Flip the
  // `if (!metaOf(id)) return true` branch to `false` and this goes red.)
  const uc = ok(); uc.nodes.push(A('n_x', 'ghost'));
  uc.wires = [...uc.wires.filter((w) => w.id !== 'w1'),
    W('w1', 'n_task', 'task', 'n_impl', 'await'),
    W('w7', 'n_x', 'out', 'n_plan', 'task'), W('w8', 'n_plan', 'plan', 'n_x', 'in')];
  assert.deepEqual(V(uc).errors.filter((e) => e.code === 'V11'), [],
    'an unresolved member never turns its cycle into a deadlock');
});

test('V12 arity bounds, unwired inK and or homogeneity', () => {
  const a = ok(); a.nodes.push(F('n_and', 'and', { arity: 1 }));
  assert.match(V(a).errors.find((e) => e.code === 'V12').message, /needs an integer arity/);
  // The UPPER bound matters too: gatePorts clamps to MAX_PORTS_PER_SIDE, so an
  // unbounded rule would store `arity: 99` and render only in1..in8.
  const big = ok(); big.nodes.push(F('n_and', 'and', { arity: 99 }));
  assert.match(V(big).errors.find((e) => e.code === 'V12').message,
    /^and node 'n_and' needs an integer arity between 2 and 8 \(got 99\)$/);
  const u = ok(); u.nodes.push(F('n_and', 'and', { arity: 2 }));
  u.wires.push(W('w7', 'n_plan', 'plan', 'n_and', 'in1'), W('w8', 'n_and', 'out', 'n_impl', 'await'));
  assert.match(V(u).errors.find((e) => e.code === 'V12').message,
    /^and node 'n_and' has unwired input 'in2' — every inK must be wired$/);
  const d = ok(); d.nodes.push(F('n_or', 'or'));               // no explicit arity => 2, legal
  assert.equal(V(d).errors.filter((e) => e.code === 'V12' && /arity/.test(e.message)).length, 0);
});

test('V13 when + verdict + maxCycles placement', () => {
  const t = ok();
  t.wires = t.wires.map((w) => (w.id === 'w2' ? { ...w, config: { maxCycles: 2 } } : w));
  assert.match(V(t).errors.find((e) => e.code === 'V13').message,
    /^wire 'w2' carries maxCycles but is not a loop wire$/);
  const z = ok();
  z.wires = z.wires.map((w) => (w.id === 'w5' ? { ...w, config: { maxCycles: 0 } } : w));
  assert.ok(V(z).errors.some((e) => e.code === 'V13' && /maxCycles must be an integer >= 1 \(got 0\)/.test(e.message)));
  const bad = portsFnFor({ ...REG, reviewer: { ...REG.reviewer, verdict: undefined } });
  const r = validateGraph(ok(), bad);
  assert.ok(r.errors.some((e) => e.code === 'V13' && /is when:'blocking' but the node produces no verdict/.test(e.message)));
});

test('V14 expands inputs must be json', () => {
  const fn = portsFnFor({ ...REG, impl: { ...REG.impl,
    inputs: REG.impl.inputs.map((i) => (i.id === 'task' ? { ...i, type: 'md' } : i)) } });
  assert.match(validateGraph(ok(), fn).errors.find((e) => e.code === 'V14').message,
    /^input 'n_impl\.task' declares expands but is 'md' — expands inputs must be json$/);
  assert.equal(V(ok()).errors.filter((e) => e.code === 'V14').length, 0);
});

test('V15 unreachable node warns', () => {
  const t = ok(); t.nodes.push(A('n_orphan', 'reviewer'));
  t.wires.push(W('w7', 'n_plan', 'plan', 'n_orphan', 'plan'), W('w8', 'n_orphan', 'pass', 'n_impl', 'await'));
  assert.equal(V(t).warnings.filter((w) => w.code === 'V15').length, 0);
  const o = ok(); o.nodes.push(A('n_orphan', 'clarify'));
  o.wires.push(W('w7', 'n_orphan', 'answers', 'n_plan', 'answers'));
  assert.match(V(o).warnings.find((w) => w.code === 'V15').message, /^node 'n_orphan' is unreachable from any entry$/);
  // Entries are nodes whose meta RESOLVED and that declare zero inputs. An
  // unknown key reports zero (unresolvable) inputs, so without the metaOf guard
  // it would promote itself to an entry and stop warning.
  const ux = ok(); ux.nodes.push(A('n_x', 'ghost'), A('n_far', 'clarify'));
  ux.wires.push(W('w7', 'n_x', 'out', 'n_far', 'task'));
  assert.deepEqual(V(ux).warnings.filter((w) => w.code === 'V15').map((w) => w.nodeId).sort(),
    ['n_far', 'n_x'], 'an unresolved node is never an entry');
});

test('V16 awaitAll no-op counts the wired await port', () => {
  const one = ok();
  one.nodes = one.nodes.map((n) => (n.id === 'n_impl' ? A('n_impl', 'impl', { awaitAll: true }) : n));
  assert.match(V(one).warnings.find((w) => w.code === 'V16').message,
    /^node 'n_impl' sets awaitAll but has 1 wired non-loop input\(s\) — the barrier is a no-op$/);
  const two = { ...one, wires: [...one.wires, W('w7', 'n_task', 'task', 'n_impl', 'await')] };
  assert.equal(V(two).warnings.filter((w) => w.code === 'V16').length, 0, 'plan + await = a real barrier');
});

test('V17 unknown config keys warn per kind and are preserved', () => {
  const t = ok();
  t.nodes = t.nodes.map((n) => (n.id === 'n_impl' ? A('n_impl', 'impl', { planStoreSeed: true }) : n));
  t.wires = t.wires.map((w) => (w.id === 'w5' ? { ...w, config: { maxCycles: 3, colour: 'red' } } : w));
  const ws = V(t).warnings.filter((w) => w.code === 'V17').map((w) => w.message);
  assert.ok(ws.some((m) => /node 'n_impl' has unknown config key 'planStoreSeed' for kind 'agent' — preserved and ignored/.test(m)));
  assert.ok(ws.some((m) => /wire 'w5' has unknown config key 'colour' — preserved and ignored/.test(m)));
  const okTask = ok();
  okTask.nodes = okTask.nodes.map((n) => (n.id === 'n_task' ? F('n_task', 'task', { planStoreSeed: true }) : n));
  assert.equal(V(okTask).warnings.filter((w) => w.code === 'V17').length, 0);
});

test('V18 pair count and its four exemptions', () => {
  const t = ok();                                             // impl: plan (always md) + task json unwired
  t.nodes.push(A('n_cl', 'clarify'));
  t.wires.push(W('w7', 'n_task', 'task', 'n_cl', 'task'), W('w8', 'n_cl', 'answers', 'n_impl', 'task'));
  assert.match(V(t).warnings.find((w) => w.code === 'V18').message,
    /^agent node 'n_impl' has 2 always-sourced payload inputs without awaitAll — it may double-fire on re-runs \(enable Await-all or insert an AND card\)$/);
  const off = { ...t, nodes: t.nodes.map((n) => (n.id === 'n_impl' ? A('n_impl', 'impl', { awaitAll: true }) : n)) };
  assert.equal(V(off).warnings.filter((w) => w.code === 'V18').length, 0);
  // (a) task-sourced, (b) void, (c) await, (d) loop are all exempt: the base graph
  // wires plan+done into the reviewer and plan+fix into the implementer and stays clean.
  assert.equal(V(ok()).warnings.filter((w) => w.code === 'V18').length, 0);
  // (a) a TASK-sourced payload never double-fires — the task card fires once by
  // construction. n_two has TWO always-sourced payload inputs, one of them from
  // the task node; delete the exemption and it counts 2 and warns.
  const ts = ok(); ts.nodes.push(A('n_two', 'impl'), A('n_cl2', 'clarify'));
  ts.wires.push(W('w7', 'n_task', 'task', 'n_cl2', 'task'), W('w8', 'n_cl2', 'answers', 'n_two', 'task'),
    W('w9', 'n_task', 'task', 'n_two', 'plan'));
  assert.deepEqual(V(ts).warnings.filter((w) => w.code === 'V18'), [], 'a task source is exempt (a)');
  // (c) the synthesized await is payload-less AND `any`-typed, so (b) misses it.
  // plan + await both come from n_plan (always): with the AWAIT_PORT_ID skip
  // removed n_impl counts 2 and warns.
  const aw = ok(); aw.wires.push(W('w7', 'n_plan', 'plan', 'n_impl', 'await'));
  assert.deepEqual(V(aw).warnings.filter((w) => w.code === 'V18'), [], 'the await gate is exempt (c)');
  // (d) a wired LOOP input is exempt even when its source is `always` — that is
  // exactly `or.out -> impl.fix`, and without (d) every double-loop seed would
  // warn forever.
  const lp = ok(); lp.nodes.push(F('n_or', 'or', { arity: 2 }), A('n_r2', 'reviewer'));
  lp.wires = [...lp.wires.filter((w) => w.id !== 'w5'),
    W('w5', 'n_rev', 'review', 'n_or', 'in1', { maxCycles: 3 }),
    W('w7', 'n_plan', 'plan', 'n_r2', 'plan'), W('w8', 'n_r2', 'review', 'n_or', 'in2'),
    W('w9', 'n_or', 'out', 'n_impl', 'fix')];
  assert.deepEqual(V(lp).warnings.filter((w) => w.code === 'V18'), [], 'a wired loop input is exempt (d)');
});

test('V19 blocking receivers, with the OR/AND/End/await exemptions', () => {
  const t = ok(); t.wires.push(W('w7', 'n_rev', 'review', 'n_plan', 'answers'));
  assert.match(V(t).warnings.find((w) => w.code === 'V19').message,
    /^blocking output 'n_rev\.review' is wired into 'n_plan\.answers', which is not a loop input$/);
  const o = ok(); o.nodes.push(F('n_or', 'or', { arity: 2 }), A('n_r2', 'reviewer'));
  o.wires = [...o.wires.filter((w) => w.id !== 'w5'),
    W('w5', 'n_rev', 'review', 'n_or', 'in1', { maxCycles: 3 }),
    W('w7', 'n_plan', 'plan', 'n_r2', 'plan'), W('w8', 'n_r2', 'review', 'n_or', 'in2'),
    W('w9', 'n_or', 'out', 'n_impl', 'fix'), W('w10', 'n_r2', 'pass', 'n_impl', 'await')];
  assert.deepEqual(V(o).warnings.filter((w) => w.code === 'V19'), []);
  assert.deepEqual(V(o).errors, [], JSON.stringify(V(o).errors));
  // End's `result` is a flow-control sink: a blocking output wired straight into
  // it is the "stop here on a rejection" shape, not a mis-wire. Delete the
  // `end`/`result` exemption and this goes red.
  const er = ok();
  er.wires = er.wires.map((w) => (w.id === 'w6' ? W('w6', 'n_rev', 'review', 'n_end', 'result') : w));
  assert.deepEqual(V(er).warnings.filter((w) => w.code === 'V19'), [], "End's result is exempt");
  // So is an agent's synthesized `await` gate — the canonical "hold until the
  // reviewer rejected" barrier. Delete that exemption and this goes red.
  const ag = ok(); ag.wires.push(W('w7', 'n_rev', 'review', 'n_impl', 'await'));
  assert.deepEqual(V(ag).warnings.filter((w) => w.code === 'V19'), [], "an agent's await gate is exempt");
});

test('V20/V21 exactly one task and one end', () => {
  const two = ok(); two.nodes.push(F('n_task2', 'task'));
  two.wires.push(W('w7', 'n_task2', 'task', 'n_impl', 'await'));
  assert.match(V(two).errors.find((e) => e.code === 'V20').message,
    /^a template must declare exactly one task node \(found 2\)$/);
  const noEnd = ok(); noEnd.nodes = noEnd.nodes.filter((n) => n.kind !== 'end');
  noEnd.wires = noEnd.wires.filter((w) => w.to.node !== 'n_end');
  assert.match(V(noEnd).errors.find((e) => e.code === 'V21').message,
    /^a template must declare exactly one end node \(found 0\)$/);
  const dangling = ok(); dangling.wires = dangling.wires.filter((w) => w.id !== 'w6');
  assert.ok(V(dangling).errors.some((e) => e.code === 'V21' && /input 'result' must be wired/.test(e.message)));
  const noOut = ok(); noOut.wires = noOut.wires.filter((w) => w.id !== 'w1');
  assert.ok(V(noOut).errors.some((e) => e.code === 'V20' && /output 'task' must have at least one wire/.test(e.message)));
});

test('formatIssue names the offending node or wire', () => {
  const t = ok(); t.wires.push(W('w9', 'n_plan', 'plan', 'n_impl', 'plan'));
  assert.equal(formatIssue(V(t).errors.find((e) => e.code === 'V7')),
    "V7: input 'n_impl.plan' already has an inbound wire — every input accepts at most one (fan in through an or card) (wire w9)");
  assert.equal(formatIssue({ code: 'V4', message: 'x', nodeId: 'n1' }), 'V4: x (node n1)');
  assert.equal(formatIssue(null), '?: ');
});
