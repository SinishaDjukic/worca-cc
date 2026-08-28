// test/graph-seed-templates.test.mjs
// The 8 shipping graphs (7 seeds + the graph default) are frozen DATA that the
// V24 migration will insert and the engine will run. These are the structural
// invariants Amendment f pins; the zero-errors/zero-warnings validateGraph
// drift guard against the real sidecars lands with the validator (P2).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SEED_TEMPLATES, NODE_ID_MAP, FB_WIRE_MAP } from '../src/core/graph/seed-templates.mjs';
import { GRAPH_DEFAULT_WORKFLOW, deepFreeze } from '../src/core/graph/builtin-workflows.mjs';
import { NODE_ID_RE, WIRE_ID_RE, PORT_ID_RE, TEMPLATE_VERSION } from '../src/shared/graph/constants.mjs';
import { LEGACY_DEFAULT_WORKFLOW } from '../src/core/workflows.mjs';
import { validateGraph } from '../src/shared/graph/validate.mjs';
import { classifyLoops } from '../src/shared/graph/loops.mjs';
import { realPortsFn } from './helpers/graph-ports.mjs';

const ALL = [...SEED_TEMPLATES, GRAPH_DEFAULT_WORKFLOW];
const byId = Object.fromEntries(ALL.map((t) => [t.id, t]));
const PINS = {
  wf_full: [11, 17],
  'wf_no-clarify': [9, 13],
  'wf_provided-plan': [9, 14],
  'wf_full-no-decompose': [10, 15],
  'wf_quick-fix': [5, 6],
  'wf_clarify-implement': [7, 10],
  'wf_clarify-quick-fix': [6, 8],
  wf_default: [7, 10],
};
const VALVE = new Set(['and', 'or', 'combine']);
const node = (t, id) => t.nodes.find((n) => n.id === id);

/** The loop each v1 feedback id names, by ROLE — the pairing the static map encodes. */
const LOOP_OF = {
  refine: ['refiner', 'refiner'], review: ['reviewer', 'implementer'], webui: ['manualWebUiTesting', 'implementer'],
};
const EXPECTED_FB = {
  wf_full: { fb_0: 'refine', fb_1: 'review', fb_2: 'webui' },
  'wf_no-clarify': { fb_0: 'refine', fb_1: 'review' },
  'wf_provided-plan': { fb_0: 'refine', fb_1: 'review', fb_2: 'webui' },
  'wf_full-no-decompose': { fb_0: 'refine', fb_1: 'review', fb_2: 'webui' },
  'wf_quick-fix': { fb_0: 'review' },
  // The A28 convention (this seed is absent from the reference DB) — pinned so an edit is deliberate.
  'wf_clarify-implement': { fb_0: 'review', fb_1: 'refine' },
  'wf_clarify-quick-fix': { fb_0: 'review' },
};

/** The dynamic overlay resolver the V24 migration uses: the UNIQUE
 *  maxCycles-bearing wire on a path from `fromId` to `toId`, following and/or/
 *  combine valves, at most 4 hops. null when it is not unique. */
function resolveWireId(tpl, fromId, toId) {
  const outOf = (id) => tpl.wires.filter((w) => w.from.node === id);
  const hits = new Set();
  const queue = outOf(fromId).map((w) => ({ w, budget: w.config?.maxCycles ? w : null, hops: 1 }));
  while (queue.length) {
    const { w, budget, hops } = queue.shift();
    if (w.to.node === toId) { if (budget) hits.add(budget.id); continue; }
    const target = node(tpl, w.to.node);
    if (hops >= 4 || !target || !VALVE.has(target.kind)) continue;
    for (const nx of outOf(w.to.node)) {
      queue.push({ w: nx, budget: budget || (nx.config?.maxCycles ? nx : null), hops: hops + 1 });
    }
  }
  return hits.size === 1 ? [...hits][0] : null;
}

test('the 8 shipping graphs: ids, names, version, domain, pin counts', () => {
  assert.equal(SEED_TEMPLATES.length, 7);
  assert.deepEqual(SEED_TEMPLATES.map((t) => t.id), [
    'wf_full', 'wf_no-clarify', 'wf_provided-plan', 'wf_full-no-decompose',
    'wf_quick-fix', 'wf_clarify-implement', 'wf_clarify-quick-fix',
  ]);
  assert.deepEqual(SEED_TEMPLATES.map((t) => t.name), [
    'Full', 'No Clarify', 'Provided Plan', 'FULL-NO-Decompose',
    'Quick Fix', 'Clarify -> Implement', 'Clarify -> Quick Fix',
  ]);
  assert.equal(GRAPH_DEFAULT_WORKFLOW.id, 'wf_default');
  assert.equal(GRAPH_DEFAULT_WORKFLOW.name, 'Default');
  for (const t of ALL) {
    assert.equal(t.version, TEMPLATE_VERSION, `${t.id} version`);
    assert.equal(t.domain, 'coding', `${t.id} domain`);
    assert.deepEqual([t.nodes.length, t.wires.length], PINS[t.id], `${t.id} node/wire counts`);
  }
  for (const t of SEED_TEMPLATES) assert.match(t.createdAt, /^\d{4}-\d{2}-\d{2}T/, `${t.id} createdAt`);
});

test('every graph has exactly one Task and one End; key iff kind agent', () => {
  for (const t of ALL) {
    assert.equal(t.nodes.filter((n) => n.kind === 'task').length, 1, `${t.id} task`);
    assert.equal(t.nodes.filter((n) => n.kind === 'end').length, 1, `${t.id} end`);
    for (const n of t.nodes) {
      assert.equal('key' in n, n.kind === 'agent', `${t.id}/${n.id}: key iff agent`);
      if (n.kind === 'agent') assert.ok(n.key && typeof n.key === 'string');
      assert.equal(typeof n.x, 'number');
      assert.equal(typeof n.y, 'number');
      assert.ok(n.config && typeof n.config === 'object', `${t.id}/${n.id} config`);
    }
  }
});

test('ids are unique, well-shaped, and every wire lands on a real node', () => {
  for (const t of ALL) {
    const ids = t.nodes.map((n) => n.id);
    assert.equal(new Set(ids).size, ids.length, `${t.id} unique node ids`);
    const wids = t.wires.map((w) => w.id);
    assert.equal(new Set(wids).size, wids.length, `${t.id} unique wire ids`);
    for (const id of ids) assert.match(id, NODE_ID_RE, `${t.id}/${id}`);
    for (const w of t.wires) {
      assert.match(w.id, WIRE_ID_RE, `${t.id}/${w.id}`);
      assert.ok(node(t, w.from.node), `${t.id}/${w.id} from`);
      assert.ok(node(t, w.to.node), `${t.id}/${w.id} to`);
      assert.match(w.from.port, PORT_ID_RE, `${t.id}/${w.id} from.port`);
      assert.match(w.to.port, PORT_ID_RE, `${t.id}/${w.id} to.port`);
    }
  }
});

test('V7: every input carries exactly one inbound wire, and no port is named start', () => {
  for (const t of ALL) {
    const seen = new Set();
    for (const w of t.wires) {
      const key = `${w.to.node}.${w.to.port}`;
      assert.ok(!seen.has(key), `${t.id}: ${key} has two inbound wires (V7)`);
      seen.add(key);
      assert.notEqual(w.to.port, 'start', `${t.id}/${w.id}`);
      assert.notEqual(w.from.port, 'start', `${t.id}/${w.id}`);
    }
  }
});

test('the End node is fed from webui.pass where a webui node exists, else reviewer.pass', () => {
  for (const t of ALL) {
    const end = t.nodes.find((n) => n.kind === 'end');
    const inbound = t.wires.filter((w) => w.to.node === end.id);
    assert.equal(inbound.length, 1, `${t.id}: one wire into End`);
    assert.equal(inbound[0].to.port, 'result');
    const src = node(t, inbound[0].from.node);
    const hasWebui = t.nodes.some((n) => n.key === 'manualWebUiTesting');
    assert.equal(src.key, hasWebui ? 'manualWebUiTesting' : 'reviewer', `${t.id}: End source`);
    assert.equal(inbound[0].from.port, 'pass');
  }
});

test('reviewer.pass -> checklist.await wherever a checklist node exists', () => {
  for (const t of ALL) {
    const check = t.nodes.find((n) => n.key === 'manualTestsChecklist');
    if (!check) continue;
    const rev = t.nodes.find((n) => n.key === 'reviewer');
    const w = t.wires.find((x) => x.from.node === rev.id && x.from.port === 'pass');
    assert.ok(w, `${t.id}: reviewer.pass is wired`);
    assert.equal(w.to.node, check.id, `${t.id}: reviewer.pass -> checklist`);
    assert.equal(w.to.port, 'await', `${t.id}: lands on the synthesized await gate`);
  }
});

test('the OR valve appears on exactly the three double-loop seeds', () => {
  const withOr = ALL.filter((t) => t.nodes.some((n) => n.kind === 'or')).map((t) => t.id);
  assert.deepEqual(withOr.sort(), ['wf_full', 'wf_full-no-decompose', 'wf_provided-plan']);
  for (const id of withOr) {
    const t = byId[id];
    const or = t.nodes.find((n) => n.kind === 'or');
    assert.equal(or.config.arity, 2, `${id} arity`);
    const ins = t.wires.filter((w) => w.to.node === or.id);
    assert.deepEqual(ins.map((w) => w.to.port).sort(), ['in1', 'in2'], `${id} valve inputs`);
    for (const w of ins) assert.equal(w.config.maxCycles, 3, `${id}/${w.id} keeps its own budget`);
    const outs = t.wires.filter((w) => w.from.node === or.id);
    assert.equal(outs.length, 1, `${id}: one out-wire`);
    assert.equal(outs[0].from.port, 'out');
    assert.equal(outs[0].to.port, 'fix');
    assert.equal(outs[0].config, undefined, `${id}: the always-sourced out-wire carries no maxCycles`);
  }
});

test('NODE_ID_MAP: the 7 seed ids + wf_default, every target node exists', () => {
  assert.deepEqual(Object.keys(NODE_ID_MAP).sort(), Object.keys(PINS).sort());
  for (const [wfId, map] of Object.entries(NODE_ID_MAP)) {
    const t = byId[wfId];
    for (const [v1Id, nodeId] of Object.entries(map)) {
      assert.match(v1Id, /^s(_clarify|\d+_\d+)$/, `${wfId}: v1 stage id ${v1Id}`);
      assert.ok(node(t, nodeId), `${wfId}: ${v1Id} -> ${nodeId} exists`);
      assert.equal(node(t, nodeId).kind, 'agent', `${wfId}: ${nodeId} is an agent node`);
    }
    const agents = t.nodes.filter((n) => n.kind === 'agent').length;
    assert.equal(Object.keys(map).length, agents, `${wfId}: one overlay mapping per agent node`);
  }
});

test('FB_WIRE_MAP equals the dynamic (from,to) resolver over the seed graphs', () => {
  assert.deepEqual(Object.keys(FB_WIRE_MAP).sort(), Object.keys(PINS).sort());
  for (const [wfId, map] of Object.entries(FB_WIRE_MAP)) {
    const t = byId[wfId];
    const budgeted = t.wires.filter((w) => w.config?.maxCycles);
    assert.deepEqual(
      Object.values(map).sort(),
      budgeted.map((w) => w.id).sort(),
      `${wfId}: the map covers exactly the budget-bearing wires`,
    );
    for (const w of budgeted) {
      // The loop's (from, to) as v1 saw it: source node -> ultimate consumer,
      // following the OR valve where the seeds route through one.
      const direct = node(t, w.to.node);
      const to = VALVE.has(direct.kind)
        ? t.wires.find((x) => x.from.node === direct.id).to.node
        : w.to.node;
      assert.equal(resolveWireId(t, w.from.node, to), w.id, `${wfId}: resolve(${w.from.node}, ${to})`);
    }
    // Every mapped feedback id is a v1 fb id, and the ids are distinct.
    assert.equal(new Set(Object.values(map)).size, Object.keys(map).length, `${wfId}: distinct wire ids`);
    for (const fbId of Object.keys(map)) assert.match(fbId, /^fb_/, `${wfId}: ${fbId}`);
  }
});

test('FB_WIRE_MAP pins the fb_N ↔ wire PAIRING: wf_default off the REAL v1 row, every seed by loop role', () => {
  // wf_clarify-implement is absent from the reference DB, so its v1 feedback ORDER is a
  // convention shared with P3's v1 fixture (test/fixtures/workflows-v1/wf_clarify-implement.json):
  // fb_0 = the review loop (n_review.review -> n_impl.fix, w9), fb_1 = the refiner
  // self-loop (n_refine.revise -> n_refine.revise, w5). V24 applies the STATIC
  // maps only (spec §10.2), so this pairing is load-bearing and pinned verbatim.
  const t = byId['wf_clarify-implement'];
  assert.deepEqual({ ...FB_WIRE_MAP['wf_clarify-implement'] }, { fb_0: 'w9', fb_1: 'w5' });
  assert.deepEqual([t.wires.find((w) => w.id === 'w9').to.port, t.wires.find((w) => w.id === 'w5').to.port], ['fix', 'revise']);

  // Every seed's fb_N named by the LOOP it stands for — the same pairing, stated as data.
  for (const [wfId, fbs] of Object.entries(EXPECTED_FB)) {
    const tpl = byId[wfId];
    assert.deepEqual(Object.keys(FB_WIRE_MAP[wfId]).sort(), Object.keys(fbs).sort(), `${wfId}: fb ids`);
    for (const [fbId, loop] of Object.entries(fbs)) {
      const [fromKey, toKey] = LOOP_OF[loop];
      const from = tpl.nodes.find((n) => n.key === fromKey).id;
      const to = tpl.nodes.find((n) => n.key === toKey).id;
      assert.equal(FB_WIRE_MAP[wfId][fbId], resolveWireId(tpl, from, to), `${wfId}.${fbId} is the ${loop} loop`);
    }
  }

  // wf_default is no convention at all: both maps are derivable from the REAL v1
  // LEGACY_DEFAULT_WORKFLOW row (workflows.mjs) — node ids, agent keys and feedbacks.
  const v1 = LEGACY_DEFAULT_WORKFLOW;
  const nodeMap = NODE_ID_MAP.wf_default;
  assert.deepEqual(Object.keys(nodeMap).sort(), v1.steps.flat().map((n) => n.id).sort());
  for (const n of v1.steps.flat()) {
    assert.equal(node(GRAPH_DEFAULT_WORKFLOW, nodeMap[n.id]).key, n.key, `${n.id} keeps its agent key`);
  }
  assert.deepEqual(Object.keys(FB_WIRE_MAP.wf_default).sort(), v1.feedbacks.map((f) => f.id).sort());
  for (const fb of v1.feedbacks) {
    assert.equal(
      FB_WIRE_MAP.wf_default[fb.id],
      resolveWireId(GRAPH_DEFAULT_WORKFLOW, nodeMap[fb.from], nodeMap[fb.to]),
      `${fb.id} resolves from the real (from,to)`,
    );
  }
});

test('the shipping constants are deep-frozen', () => {
  assert.ok(Object.isFrozen(SEED_TEMPLATES) && Object.isFrozen(NODE_ID_MAP) && Object.isFrozen(FB_WIRE_MAP));
  assert.ok(Object.isFrozen(GRAPH_DEFAULT_WORKFLOW));
  for (const t of ALL) {
    assert.ok(Object.isFrozen(t.nodes) && Object.isFrozen(t.nodes[0]) && Object.isFrozen(t.nodes[0].config));
    assert.ok(Object.isFrozen(t.wires) && Object.isFrozen(t.wires[0].from));
  }
  assert.throws(() => { SEED_TEMPLATES[0].nodes[0].x = 999; }, TypeError);
  const o = deepFreeze({ a: { b: 1 } });
  assert.ok(Object.isFrozen(o.a));
  assert.equal(deepFreeze(5), 5);
});

// ── P2 seed drift guard: the seeds, the validator and the ported sidecars ─────
const LOOP_WIRES = {
  'wf_full': ['w12', 'w15', 'w5'],
  'wf_no-clarify': ['w10', 'w3'],
  'wf_provided-plan': ['w12', 'w2', 'w9'],
  'wf_full-no-decompose': ['w10', 'w13', 'w5'],
  'wf_quick-fix': ['w5'],
  'wf_clarify-implement': ['w5', 'w9'],
  'wf_clarify-quick-fix': ['w7'],
  'wf_default': ['w5', 'w9'],
};
const allGraphs = () => [...SEED_TEMPLATES, GRAPH_DEFAULT_WORKFLOW];

test('every seed graph validates against the REAL sidecars: 0 errors, 0 warnings', () => {
  const portsFn = realPortsFn();
  const graphs = allGraphs();
  assert.equal(graphs.length, 8);
  for (const tpl of graphs) {
    const { ok, errors, warnings } = validateGraph(tpl, portsFn);
    assert.deepEqual(errors, [], `${tpl.id} errors: ${JSON.stringify(errors, null, 1)}`);
    assert.deepEqual(warnings, [], `${tpl.id} warnings: ${JSON.stringify(warnings, null, 1)}`);
    assert.equal(ok, true);
  }
});

test('loop wires are exactly the budgeted feedback wires (Amendment f pins)', () => {
  const portsFn = realPortsFn();
  for (const tpl of allGraphs()) {
    const { loopWireIds } = classifyLoops(tpl, portsFn);
    assert.deepEqual([...loopWireIds].sort(), LOOP_WIRES[tpl.id], `${tpl.id} loop wires`);
    // Every loop wire carries a budget and no plain wire does (V13's placement rule).
    for (const w of tpl.wires) {
      // `!!` is load-bearing: a plain seed wire has NO `config` key at all, so
      // `w.config && …` short-circuits to `undefined`, and assert/strict's
      // `equal` IS `strictEqual` — `undefined !== false` fails on the very first
      // plain wire (`wf_full.w1`).
      const budgeted = !!(w.config && w.config.maxCycles !== undefined);
      assert.equal(budgeted, loopWireIds.has(w.id), `${tpl.id}.${w.id} budget placement`);
    }
  }
});

test('FB_WIRE_MAP names exactly the loop wires of each seed', () => {
  const portsFn = realPortsFn();
  for (const tpl of SEED_TEMPLATES) {
    const mapped = Object.values(FB_WIRE_MAP[tpl.id] || {}).sort();
    assert.deepEqual(mapped, [...classifyLoops(tpl, portsFn).loopWireIds].sort(), tpl.id);
  }
  assert.deepEqual(Object.values(FB_WIRE_MAP.wf_default).sort(),
    [...classifyLoops(GRAPH_DEFAULT_WORKFLOW, realPortsFn()).loopWireIds].sort());
});
