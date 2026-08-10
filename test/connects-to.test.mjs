// test/connects-to.test.mjs
// What may connect to what, v2 — and the palette that offers it. The v1
// channel-governance helper (`canConnect`, allow-lists and the `*` wildcard) is
// gone: legality is now TYPED PORTS, decided by graph-model's canWire against
// the live template. This file is the ported successor of the composer-core
// version: legality, the palette merge, and the offline EMBEDDED_AGENTS fallback
// that governs when /api/agents is unreachable.
import test from 'node:test';
import assert from 'node:assert/strict';
import { FIXTURE_PORTS } from '../src/core/graph/fixtures.mjs';
import { canWire, portsFnFor } from '../ui/public/graph/graph-model.mjs';
import {
  EMBEDDED_AGENTS, FLOW_PILLS, FLOW_GROUP, mergePalette, groupPaletteByDomain, paletteDesc,
} from '../ui/public/graph/agents-meta.mjs';

const ports = portsFnFor(EMBEDDED_AGENTS);

/** planner -> implementer -> reviewer, plus an and card and the two bookends. */
const TEMPLATE = {
  id: 'wf_t', name: 'T', version: 2, domain: 'coding',
  nodes: [
    { id: 'n_task', kind: 'task', x: 0, y: 0, config: {} },
    { id: 'n_clarify', kind: 'agent', key: 'clarify', x: 0, y: 200, config: {} },
    { id: 'n_plan', kind: 'agent', key: 'planner', x: 300, y: 0, config: {} },
    { id: 'n_impl', kind: 'agent', key: 'implementer', x: 600, y: 0, config: {} },
    { id: 'n_and', kind: 'and', x: 600, y: 400, config: { arity: 2 } },
    { id: 'n_end', kind: 'end', x: 900, y: 0, config: {} },
  ],
  wires: [{ id: 'w1', from: { node: 'n_task', port: 'task' }, to: { node: 'n_plan', port: 'task' } }],
};
const drop = (fromNode, fromPort, toNode, toPort) =>
  canWire({ template: TEMPLATE, portsFn: ports, from: { node: fromNode, port: fromPort }, to: { node: toNode, port: toPort } });

test('legality is typed ports now: matching types connect, mismatched ones do not', () => {
  assert.equal(drop('n_plan', 'plan', 'n_impl', 'plan').ok, true);              // md -> md
  assert.deepEqual(drop('n_clarify', 'answers', 'n_impl', 'plan'),              // json -> md
    { ok: false, reason: 'json → md type mismatch' });
  assert.equal(drop('n_plan', 'plan', 'n_and', 'in1').ok, true);                // md -> any
  assert.equal(drop('n_impl', 'done', 'n_impl', 'await').ok, true);             // void -> the gate
  assert.deepEqual(drop('n_task', 'task', 'n_plan', 'task'),                    // V7, uniform
    { ok: false, reason: 'already connected' });
});

test('the EMBEDDED_AGENTS port table drives the client validator directly', () => {
  // portsFnFor over the palette table must synthesize exactly what the engine does.
  assert.deepEqual(ports({ kind: 'agent', key: 'reviewer' }).inputs.map((p) => p.id), ['plan', 'done', 'await']);
  assert.deepEqual(ports({ kind: 'agent', key: 'implementer' }).inputs.map((p) => p.id), ['plan', 'fix', 'task', 'await']);
  assert.equal(ports({ kind: 'agent', key: 'implementer' }).inputs.some((p) => p.id === 'start'), false);
});

test('mergePalette carries the v2 ports through to the UI', () => {
  const merged = mergePalette({
    agents: [{
      key: 'x', displayName: 'X', order: 1, domain: 'coding', runnerType: 'producer',
      inputs: [{ id: 'plan', type: 'md', required: true, as: 'file' }],
      outputs: [{ id: 'plan', type: 'md', when: 'always' }, { id: 'revise', type: 'md', when: 'blocking' }],
      verdict: { filename: 'r.json' },
    }],
  });
  assert.deepEqual(merged[0].inputs.map((p) => p.id), ['plan']);
  assert.deepEqual(merged[0].outputs.map((p) => p.id), ['plan', 'revise']);
  assert.deepEqual(merged[0].verdict, { filename: 'r.json' });        // V13 needs this client-side
  assert.equal(merged[0].placeable, true);
  assert.equal(merged[0].origin, 'builtin');
  assert.equal(paletteDesc(merged[0]), 'in plan · out plan, revise');
});

test('mergePalette falls back to EMBEDDED_AGENTS and sorts by order', () => {
  for (const empty of [null, undefined, [], { agents: [] }, {}]) {
    const merged = mergePalette(empty);
    assert.equal(merged.length, Object.keys(EMBEDDED_AGENTS).length, JSON.stringify(empty));
    assert.deepEqual(merged.map((a) => a.order), [...merged.map((a) => a.order)].sort((x, y) => x - y));
    assert.equal(merged[0].key, 'clarify');
  }
  assert.equal(mergePalette([{ key: 'u', origin: 'user' }])[0].origin, 'user');   // trusted-icon gate
});

test('every EMBEDDED_AGENTS entry carries v2 ports (the offline fallback governs)', () => {
  for (const [key, meta] of Object.entries(EMBEDDED_AGENTS)) {
    assert.equal(meta.key, key);
    assert.ok(Array.isArray(meta.inputs) && Array.isArray(meta.outputs), `${key} ports`);
    assert.ok(meta.outputs.length || meta.inputs.length, `${key} declares at least one port`);
    assert.ok(typeof meta.displayName === 'string' && meta.displayName, `${key} displayName`);
    assert.ok(typeof meta.icon === 'string' && meta.icon, `${key} icon`);
    assert.ok(typeof meta.color === 'string' && meta.color, `${key} color`);
    assert.ok(Number.isFinite(meta.order), `${key} order`);
    assert.equal(meta.inputs.some((p) => p.synthetic || p.id === 'await'), false, `${key} must not declare await`);
  }
});

test('EMBEDDED_AGENTS is the builtin table, port-for-port identical to the engine fixture', () => {
  assert.deepEqual(Object.keys(EMBEDDED_AGENTS).sort(), Object.keys(FIXTURE_PORTS).sort());
  for (const [key, expected] of Object.entries(FIXTURE_PORTS)) {
    for (const [field, value] of Object.entries(expected)) {
      assert.deepEqual(EMBEDDED_AGENTS[key][field], value, `${key}.${field}`);
    }
  }
  assert.equal(EMBEDDED_AGENTS.workspaceScanner.placeable, false);
  assert.equal('placeable' in EMBEDDED_AGENTS.planner, false);   // absent, never `true` — mirrors normalizeMeta
});

test('groupPaletteByDomain pins the Flow group last: Task · End · AND · OR · Combine', () => {
  const groups = groupPaletteByDomain(mergePalette(null), ['coding']);
  const flow = groups[groups.length - 1];
  assert.equal(flow.domain, FLOW_GROUP);
  assert.equal(flow.flow, true);
  assert.deepEqual(flow.agents.map((p) => p.kind), ['task', 'end', 'and', 'or', 'combine']);
  assert.deepEqual(flow.agents.map((p) => p.displayName), ['Task', 'End', 'AND', 'OR', 'Combine']);
  assert.deepEqual(FLOW_PILLS.map((p) => p.kind), ['task', 'end', 'and', 'or', 'combine']);
  assert.equal(groups.filter((g) => g.flow).length, 1);
});

test('the Task and End pills disable once placed; the other flow pills never do', () => {
  const disabled = (placedKinds) => Object.fromEntries(
    groupPaletteByDomain(mergePalette(null), ['coding'], { placedKinds })
      .at(-1).agents.map((p) => [p.kind, p.disabled]));
  assert.deepEqual(disabled([]), { task: false, end: false, and: false, or: false, combine: false });
  assert.deepEqual(disabled(['task']), { task: true, end: false, and: false, or: false, combine: false });
  assert.deepEqual(disabled(['task', 'end', 'or']), { task: true, end: true, and: false, or: false, combine: false });
});

test('placeable:false is filtered out of the palette — workspaceScanner never appears', () => {
  const groups = groupPaletteByDomain(mergePalette(null), ['coding', 'general']);
  const keys = groups.flatMap((g) => g.agents.map((a) => a.key)).filter(Boolean);
  assert.equal(keys.includes('workspaceScanner'), false);
  assert.equal(keys.includes('implementer'), true);
  // `shared` agents are prepended to every domain group; workspaceReviewer is shared AND placeable.
  assert.equal(groups[0].agents.some((a) => a.key === 'workspaceReviewer'), true);
  assert.equal(groups.some((g) => g.domain === 'shared'), false);
});

test('paletteDesc lists meta port ids only — never the synthesized gate', () => {
  const byKey = Object.fromEntries(mergePalette(null).map((a) => [a.key, a]));
  assert.equal(paletteDesc(byKey.refiner), 'in plan, revise · out plan, revise');
  assert.equal(paletteDesc(byKey.clarify), 'in task · out answers');
  assert.equal(paletteDesc({ inputs: [], outputs: [{ id: 'task' }] }), 'out task');
  assert.equal(paletteDesc({ inputs: [{ id: 'result' }], outputs: [] }), 'in result');
  assert.equal(paletteDesc({}), '');
});
