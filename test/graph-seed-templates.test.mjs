// test/graph-seed-templates.test.mjs
// The 7 hand-written v2 seed templates (V17 re-seeds the user's saved pipelines
// as these) plus the static overlay-migration maps.
//
// The load-bearing guard is the DRIFT guard: every seed, handed WHOLE to
// validateGraph (flat template — `version` lives at the top level and V1 reads it
// there), produces zero errors AND zero warnings. Warnings count because the
// warning-free property is what four separate rule exemptions were written for —
// V18(b) void inputs (the quick-fix reviewers' `done`), V18(c) the synthesized
// await port (the checklist gate wires), V18(d) loop inputs (`or.out -> fix` is
// an ALWAYS source, so without (d) every double-loop seed warns forever), and
// V19's or-inK exemption (the three OR-fanned seeds' blocking review wires). If
// any of those regresses, this file is the tripwire.
//
// Byte-identity with the authored JSON is NOT asserted here: the reference JSONs
// live outside the repo, so a read-at-test-time deepEqual would be untestable in
// CI. Counts + structural facts are pinned instead; the diff was done once by
// hand at authoring time.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SEED_TEMPLATES, NODE_ID_MAP, FB_WIRE_MAP } from '../src/core/graph/seed-templates.mjs';
import { FIXTURE_PORTS, portsFnFor } from '../src/core/graph/fixtures.mjs';
import { validateGraph } from '../src/core/graph/validate.mjs';

const ports = portsFnFor(FIXTURE_PORTS);

const byId = (id) => {
  const t = SEED_TEMPLATES.find((s) => s.id === id);
  assert.ok(t, `seed '${id}' is missing`);
  return t;
};
const nodeOf = (t, id) => t.nodes.find((n) => n.id === id);
const hasKey = (t, key) => t.nodes.some((n) => n.key === key);
const wire = (t, fromNode, fromPort, toNode, toPort) => t.wires.find((w) => (
  w.from.node === fromNode && w.from.port === fromPort && w.to.node === toNode && w.to.port === toPort
));
const outWires = (t, node, port) => t.wires.filter((w) => w.from.node === node && w.from.port === port);

/** id -> [nodes, wires]. Concurrency parity rides these — a dropped node or wire
 *  re-orders execution, so the table is a pin, not documentation. */
const COUNTS = {
  wf_full: [11, 17],
  'wf_no-clarify': [9, 13],
  'wf_provided-plan': [9, 14],
  'wf_full-no-decompose': [10, 15],
  'wf_quick-fix': [5, 6],
  'wf_clarify-implement': [7, 10],
  'wf_clarify-quick-fix': [6, 8],
};

/** The single terminal wire per seed: webui.pass where a webui node exists, else
 *  reviewer.pass. Exactly one End node, exactly one wire into it. */
const TERMINALS = {
  wf_full: 'n_webui',
  'wf_no-clarify': 'n_webui',
  'wf_provided-plan': 'n_webui',
  'wf_full-no-decompose': 'n_webui',
  'wf_quick-fix': 'n_review',
  'wf_clarify-implement': 'n_review',
  'wf_clarify-quick-fix': 'n_review',
};

/** The three seeds whose reviewer AND webui feedback fan through an or card. */
const DOUBLE_LOOP = ['wf_full', 'wf_provided-plan', 'wf_full-no-decompose'];

// ---------------------------------------------------------------- the set

test('SEED_TEMPLATES is the 7 hand-written v2 seeds, each FLAT (nodes/wires at the top level, not nested under graph)', () => {
  assert.equal(SEED_TEMPLATES.length, 7);
  assert.deepEqual(SEED_TEMPLATES.map((t) => t.id), Object.keys(COUNTS));
  for (const t of SEED_TEMPLATES) {
    assert.equal(t.version, 2, `${t.id} version`);                 // V1 reads version off the object it is handed
    assert.equal(t.domain, 'coding', `${t.id} domain`);
    assert.equal(typeof t.name, 'string');
    assert.match(t.createdAt, /^\d{4}-\d{2}-\d{2}T/, `${t.id} createdAt`);
    assert.ok(Array.isArray(t.nodes) && Array.isArray(t.wires), `${t.id} flat nodes/wires`);
    assert.equal(t.graph, undefined, `${t.id} must NOT nest under graph`);
  }
});

test('SEED_TEMPLATES node/wire counts match the authored table', () => {
  for (const [id, [nodes, wires]] of Object.entries(COUNTS)) {
    const t = byId(id);
    assert.equal(t.nodes.length, nodes, `${id} nodes`);
    assert.equal(t.wires.length, wires, `${id} wires`);
  }
});

// ---------------------------------------------------------------- drift guard

test('drift guard: every seed validates with ZERO errors and ZERO warnings', () => {
  for (const t of SEED_TEMPLATES) {
    const { errors, warnings } = validateGraph(t, ports);
    assert.deepEqual(errors, [], `${t.id} errors`);
    assert.deepEqual(warnings, [], `${t.id} warnings`);
  }
});

// ---------------------------------------------------------------- structure

test('every seed has exactly one task node and one end node, with a single terminal wire into result', () => {
  for (const t of SEED_TEMPLATES) {
    assert.equal(t.nodes.filter((n) => n.kind === 'task').length, 1, `${t.id} task nodes`);
    const ends = t.nodes.filter((n) => n.kind === 'end');
    assert.equal(ends.length, 1, `${t.id} end nodes`);
    const into = t.wires.filter((w) => w.to.node === ends[0].id);
    assert.equal(into.length, 1, `${t.id} wires into end`);
    assert.equal(into[0].to.port, 'result');
    assert.deepEqual(into[0].from, { node: TERMINALS[t.id], port: 'pass' }, `${t.id} terminal source`);
  }
});

test('every seed reproduces v1 linear order: implementer.done -> reviewer.done', () => {
  for (const t of SEED_TEMPLATES) {
    assert.ok(wire(t, 'n_impl', 'done', 'n_review', 'done'), `${t.id} impl.done -> review.done`);
  }
});

test('checklist seeds gate on reviewer.pass -> checklist.await and forward checklist -> webui', () => {
  for (const t of SEED_TEMPLATES) {
    if (!hasKey(t, 'manualTestsChecklist')) continue;
    assert.ok(wire(t, 'n_review', 'pass', 'n_check', 'await'), `${t.id} review.pass -> check.await`);
    assert.ok(wire(t, 'n_check', 'checklist', 'n_webui', 'checklist'), `${t.id} check.checklist -> webui.checklist`);
  }
  assert.deepEqual(
    SEED_TEMPLATES.filter((t) => hasKey(t, 'manualTestsChecklist')).map((t) => t.id),
    ['wf_full', 'wf_no-clarify', 'wf_provided-plan', 'wf_full-no-decompose'],
  );
});

test('clarify seeds wire clarify.answers -> planner.answers', () => {
  for (const t of SEED_TEMPLATES) {
    if (!hasKey(t, 'clarify')) continue;
    assert.ok(wire(t, 'n_clarify', 'answers', 'n_plan', 'answers'), `${t.id} clarify.answers -> plan.answers`);
    assert.ok(wire(t, 'n_task', 'task', 'n_clarify', 'task'), `${t.id} task -> clarify.task`);
  }
  assert.deepEqual(
    SEED_TEMPLATES.filter((t) => hasKey(t, 'clarify')).map((t) => t.id),
    ['wf_full', 'wf_full-no-decompose', 'wf_clarify-implement', 'wf_clarify-quick-fix'],
  );
});

test('double-loop seeds fan reviewer.review and webui.review through the or card; or.out -> impl.fix carries NO config', () => {
  for (const id of DOUBLE_LOOP) {
    const t = byId(id);
    assert.equal(nodeOf(t, 'n_or').kind, 'or');
    assert.equal(nodeOf(t, 'n_or').config.arity, 2);

    const in1 = wire(t, 'n_review', 'review', 'n_or', 'in1');
    const in2 = wire(t, 'n_webui', 'review', 'n_or', 'in2');
    assert.ok(in1, `${id} review.review -> or.in1`);
    assert.ok(in2, `${id} webui.review -> or.in2`);
    assert.equal(in1.config.maxCycles, 3, `${id} in1 budget`);          // gate + budget sites stay on the in-wires
    assert.equal(in2.config.maxCycles, 3, `${id} in2 budget`);

    const out = wire(t, 'n_or', 'out', 'n_impl', 'fix');
    assert.ok(out, `${id} or.out -> impl.fix`);
    assert.equal(out.config, undefined, `${id} or.out is always-sourced — maxCycles on it fails V13`);
  }
  // FB_WIRE_MAP rides these ids, so pin them explicitly
  assert.equal(wire(byId('wf_full'), 'n_review', 'review', 'n_or', 'in1').id, 'w12');
  assert.equal(wire(byId('wf_full'), 'n_webui', 'review', 'n_or', 'in2').id, 'w15');
  assert.equal(wire(byId('wf_provided-plan'), 'n_review', 'review', 'n_or', 'in1').id, 'w9');
  assert.equal(wire(byId('wf_provided-plan'), 'n_webui', 'review', 'n_or', 'in2').id, 'w12');
  assert.equal(wire(byId('wf_full-no-decompose'), 'n_review', 'review', 'n_or', 'in1').id, 'w10');
  assert.equal(wire(byId('wf_full-no-decompose'), 'n_webui', 'review', 'n_or', 'in2').id, 'w13');
});

test('wf_no-clarify has NO or card: w10 reviewer.review -> impl.fix is the only fix source and webui.review is UNWIRED', () => {
  const t = byId('wf_no-clarify');
  assert.equal(t.nodes.filter((n) => n.kind === 'or').length, 0);
  const w10 = wire(t, 'n_review', 'review', 'n_impl', 'fix');
  assert.equal(w10.id, 'w10');
  assert.equal(w10.config.maxCycles, 3);
  assert.equal(outWires(t, 'n_webui', 'review').length, 0);            // matches its two-feedback v1 row
  assert.equal(t.wires.filter((w) => w.to.node === 'n_impl' && w.to.port === 'fix').length, 1);
});

test('single-loop seeds wire reviewer.review straight into impl.fix with maxCycles 3', () => {
  for (const id of ['wf_quick-fix', 'wf_clarify-implement', 'wf_clarify-quick-fix']) {
    const t = byId(id);
    assert.equal(t.nodes.filter((n) => n.kind === 'or').length, 0, `${id} has no or card`);
    const w = wire(t, 'n_review', 'review', 'n_impl', 'fix');
    assert.ok(w, `${id} review.review -> impl.fix`);
    assert.equal(w.config.maxCycles, 3);
  }
});

test('wf_provided-plan seeds the plan from the task node: config.planStoreSeed and task -> refiner.plan', () => {
  const t = byId('wf_provided-plan');
  assert.equal(nodeOf(t, 'n_task').config.planStoreSeed, true);
  const w1 = wire(t, 'n_task', 'task', 'n_refine', 'plan');
  assert.ok(w1, 'task -> refiner.plan');
  assert.equal(w1.id, 'w1');
  assert.equal(t.nodes.filter((n) => n.key === 'planner').length, 0);   // no planner: the plan is provided
  // no other seed carries planStoreSeed
  for (const other of SEED_TEMPLATES.filter((s) => s.id !== 'wf_provided-plan')) {
    assert.equal(nodeOf(other, 'n_task').config.planStoreSeed, undefined, `${other.id}`);
  }
});

test('every maxCycles in every seed is exactly 3, and every budgeted wire is blocking-sourced', () => {
  const BLOCKING = new Set(['revise', 'review']);
  for (const t of SEED_TEMPLATES) {
    const budgeted = t.wires.filter((w) => w.config?.maxCycles !== undefined);
    assert.ok(budgeted.length >= 1, `${t.id} has at least one loop wire`);
    for (const w of budgeted) {
      assert.equal(w.config.maxCycles, 3, `${t.id} ${w.id}`);
      assert.ok(BLOCKING.has(w.from.port), `${t.id} ${w.id} sourced from a blocking port`);
    }
  }
});

test('no input anywhere carries two wires (V7 single-wire, asserted as an explicit per-seed scan)', () => {
  for (const t of SEED_TEMPLATES) {
    const seen = new Set();
    for (const w of t.wires) {
      const key = `${w.to.node}.${w.to.port}`;
      assert.ok(!seen.has(key), `${t.id}: input '${key}' has more than one inbound wire (wire ${w.id})`);
      seen.add(key);
    }
  }
});

test('every seed node id is unique and every wire endpoint resolves to a declared node', () => {
  for (const t of SEED_TEMPLATES) {
    const ids = new Set(t.nodes.map((n) => n.id));
    assert.equal(ids.size, t.nodes.length, `${t.id} duplicate node ids`);
    const wireIds = new Set(t.wires.map((w) => w.id));
    assert.equal(wireIds.size, t.wires.length, `${t.id} duplicate wire ids`);
    for (const w of t.wires) {
      assert.ok(ids.has(w.from.node), `${t.id} ${w.id} from`);
      assert.ok(ids.has(w.to.node), `${t.id} ${w.id} to`);
    }
  }
});

// ---------------------------------------------------------------- overlay maps

test('NODE_ID_MAP covers all 7 seeds plus wf_default, mapping old step ids to node ids', () => {
  assert.deepEqual(Object.keys(NODE_ID_MAP), [...Object.keys(COUNTS), 'wf_default']);
  assert.deepEqual(NODE_ID_MAP.wf_full, {
    s0_0: 'n_clarify', s1_0: 'n_plan', s2_0: 'n_refine', s3_0: 'n_decompose',
    s4_0: 'n_impl', s5_0: 'n_review', s6_0: 'n_check', s7_0: 'n_webui',
  });
  assert.deepEqual(NODE_ID_MAP['wf_quick-fix'], { s0_0: 'n_plan', s1_0: 'n_impl', s2_0: 'n_review' });
  assert.deepEqual(NODE_ID_MAP.wf_default, {
    s_clarify: 'n_clarify', s0_0: 'n_plan', s1_0: 'n_refine', s2_0: 'n_impl', s3_0: 'n_review',
  });
  // every mapped target must be a real node in that seed
  for (const [id, map] of Object.entries(NODE_ID_MAP)) {
    if (id === 'wf_default') continue;
    const t = byId(id);
    for (const target of Object.values(map)) assert.ok(nodeOf(t, target), `${id} -> ${target}`);
  }
});

test('FB_WIRE_MAP points every old feedback id at a real wire id carrying maxCycles', () => {
  assert.deepEqual(Object.keys(FB_WIRE_MAP), [...Object.keys(COUNTS), 'wf_default']);
  // wf_no-clarify: fb_0 is the refine self-wire, fb_1 the review loop wire — the
  // user's max_cycles=6 overlays ride exactly these two.
  assert.deepEqual(FB_WIRE_MAP['wf_no-clarify'], { fb_0: 'w3', fb_1: 'w10' });
  assert.deepEqual(FB_WIRE_MAP.wf_full, { fb_0: 'w5', fb_1: 'w12', fb_2: 'w15' });
  assert.deepEqual(FB_WIRE_MAP['wf_provided-plan'], { fb_0: 'w2', fb_1: 'w9', fb_2: 'w12' });
  assert.deepEqual(FB_WIRE_MAP['wf_full-no-decompose'], { fb_0: 'w5', fb_1: 'w10', fb_2: 'w13' });
  assert.deepEqual(FB_WIRE_MAP['wf_quick-fix'], { fb_0: 'w5' });
  // wf_clarify-implement's fb order is BELIEVED swapped in the DB and is unverified
  // (the template is absent from the reference DB); V17's dynamic resolver, not
  // this row, is what makes the migration safe.
  assert.deepEqual(FB_WIRE_MAP['wf_clarify-implement'], { fb_0: 'w9', fb_1: 'w5' });
  assert.deepEqual(FB_WIRE_MAP['wf_clarify-quick-fix'], { fb_0: 'w7' });
  assert.deepEqual(FB_WIRE_MAP.wf_default, { fb_refine: 'w5', fb_review: 'w9' });

  for (const [id, map] of Object.entries(FB_WIRE_MAP)) {
    if (id === 'wf_default') continue;
    const t = byId(id);
    for (const target of Object.values(map)) {
      const w = t.wires.find((x) => x.id === target);
      assert.ok(w, `${id} -> ${target}`);
      assert.equal(w.config?.maxCycles, 3, `${id} ${target} is a budgeted loop wire`);
    }
  }
});

// ---------------------------------------------------------------- freeze

test('seeds and overlay maps are DEEP frozen — nested nodes/wires/config reject writes', () => {
  assert.ok(Object.isFrozen(SEED_TEMPLATES));
  for (const t of SEED_TEMPLATES) {
    assert.ok(Object.isFrozen(t), `${t.id}`);
    assert.ok(Object.isFrozen(t.nodes), `${t.id}.nodes`);
    assert.ok(Object.isFrozen(t.nodes[0]), `${t.id}.nodes[0]`);
    assert.ok(Object.isFrozen(t.nodes[0].config), `${t.id}.nodes[0].config`);
    assert.ok(Object.isFrozen(t.wires[0]), `${t.id}.wires[0]`);
    assert.ok(Object.isFrozen(t.wires[0].from), `${t.id}.wires[0].from`);
  }
  const full = byId('wf_full');
  const x = full.nodes[0].x;
  assert.throws(() => { full.nodes[0].x = 999; }, TypeError);              // shallow freeze would mutate silently
  assert.equal(full.nodes[0].x, x);
  assert.throws(() => { full.wires.find((w) => w.id === 'w12').config.maxCycles = 99; }, TypeError);
  assert.equal(full.wires.find((w) => w.id === 'w12').config.maxCycles, 3);
  assert.throws(() => { SEED_TEMPLATES.push({ id: 'wf_evil' }); }, TypeError);

  assert.ok(Object.isFrozen(NODE_ID_MAP));
  assert.ok(Object.isFrozen(NODE_ID_MAP.wf_full));
  assert.ok(Object.isFrozen(FB_WIRE_MAP));
  assert.ok(Object.isFrozen(FB_WIRE_MAP.wf_full));
  assert.throws(() => { NODE_ID_MAP.wf_full.s0_0 = 'n_evil'; }, TypeError);
});
