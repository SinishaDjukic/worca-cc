import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildGraphManifest, manifestPortsFn, manifestTemplate, UI_PHASE } from '../src/shared/graph/manifest.mjs';
import { validateGraph } from '../src/shared/graph/validate.mjs';

const AGENTS = {
  planner: { key: 'planner', displayName: 'Planner', color: 'violet', icon: '<path d="M1 1"/>',
    inputs: [{ id: 'task', type: 'md', required: true }, { id: 'revise', type: 'md', required: false, loop: true }],
    outputs: [{ id: 'plan', type: 'md', when: 'always' }] },
  reviewer: { key: 'reviewer', displayName: 'Reviewer', color: 'blue', verdict: { filename: 'r.json' },
    inputs: [{ id: 'plan', type: 'md', required: true }],
    outputs: [{ id: 'review', type: 'md', when: 'blocking' }, { id: 'pass', type: 'void', when: 'clean' }] },
};
// Two reviewers fan their blocking arms through an OR valve back into the
// planner's loop input — the double-loop seed shape in miniature.
const TPL = { id: 'wf_t', name: 'T', version: 2, domain: 'coding',
  // The Task card carries `planStoreSeed` — `wf_provided-plan`'s shape
  // (seed-templates.mjs:121, A2 parity-mandatory) — so a manifest that drops
  // `node.config` is caught here instead of in P4's resume path.
  nodes: [{ id: 'n_task', kind: 'task', x: 60, y: 100, config: { planStoreSeed: true } },
    { id: 'n_plan', kind: 'agent', key: 'planner', x: 360, y: 100, config: { model: 'claude-sonnet-5', awaitAll: true } },
    { id: 'n_rev', kind: 'agent', key: 'reviewer', x: 660, y: 100, config: {} },
    { id: 'n_rev2', kind: 'agent', key: 'reviewer', x: 660, y: 300, config: {} },
    { id: 'n_or', kind: 'or', x: 960, y: 430, config: { arity: 2 } },
    { id: 'n_end', kind: 'end', x: 1260, y: 100, config: {} }],
  wires: [{ id: 'w1', from: { node: 'n_task', port: 'task' }, to: { node: 'n_plan', port: 'task' } },
    { id: 'w2', from: { node: 'n_plan', port: 'plan' }, to: { node: 'n_rev', port: 'plan' } },
    { id: 'w3', from: { node: 'n_rev', port: 'review' }, to: { node: 'n_or', port: 'in1' }, config: { maxCycles: 3 } },
    { id: 'w4', from: { node: 'n_plan', port: 'plan' }, to: { node: 'n_rev2', port: 'plan' } },
    { id: 'w5', from: { node: 'n_rev2', port: 'review' }, to: { node: 'n_or', port: 'in2' }, config: { maxCycles: 3 } },
    { id: 'w6', from: { node: 'n_or', port: 'out' }, to: { node: 'n_plan', port: 'revise' } },
    { id: 'w7', from: { node: 'n_rev', port: 'pass' }, to: { node: 'n_end', port: 'result' } }] };
const build = (over) => buildGraphManifest(TPL, AGENTS, over);

test('manifest head and node cells', () => {
  const m = build();
  assert.equal(m.version, 2);
  assert.deepEqual(m.template, { id: 'wf_t', name: 'T' });
  assert.deepEqual(m.bookends, { preflight: true, done: true });
  const plan = m.graph.nodes.find((n) => n.id === 'n_plan');
  assert.equal(plan.label, 'Planner');
  assert.equal(plan.color, 'violet');
  assert.equal(plan.uiPhase, 'plan');
  assert.equal(plan.model, 'claude-sonnet-5');
  assert.equal(plan.awaitAll, true);
  assert.deepEqual(plan.ports.inputs, [{ id: 'task', type: 'md', required: true, loop: false, expands: false },
    { id: 'revise', type: 'md', required: false, loop: true, expands: false }]);
  assert.deepEqual(plan.ports.outputs, [{ id: 'plan', type: 'md', when: 'always' }]);
  assert.equal(plan.ports.await, true, 'a boolean — the await port is never listed under inputs');
  assert.equal(plan.ports.inputs.some((p) => p.id === 'await'), false);
  // Every cell carries the AUTHORED config verbatim — the manifest is the only
  // persisted topology, so nothing may be dropped or rebuilt key by key.
  assert.deepEqual(plan.config, { model: 'claude-sonnet-5', awaitAll: true });
  assert.deepEqual(m.graph.nodes.find((n) => n.id === 'n_task').config, { planStoreSeed: true });
  assert.deepEqual(m.graph.nodes.find((n) => n.id === 'n_or').config, { arity: 2 });
  // uiPhase: the builtin map wins; the key is the fallback. (The v1 sidecar
  // `uiPhase` field died with the rest of the v1 wiring vocabulary — a custom
  // agent buckets under its own key.)
  const custom = buildGraphManifest(
    { ...TPL, nodes: TPL.nodes.map((n) => (n.id === 'n_plan' ? { ...n, key: 'custom' } : n)) },
    { ...AGENTS, custom: { ...AGENTS.planner, key: 'custom', displayName: 'Custom', uiPhase: 'review' } });
  assert.equal(custom.graph.nodes.find((n) => n.id === 'n_plan').uiPhase, 'custom',
    'a sidecar can no longer name its own bucket');
  assert.equal(plan.uiPhase, 'plan', 'UI_PHASE still wins for a builtin key');
});

test('flow nodes: key null, kind uiPhase, resolved or type, arity', () => {
  const m = build();
  const or = m.graph.nodes.find((n) => n.id === 'n_or');
  assert.equal(or.key, null);
  assert.equal(or.label, 'OR');
  assert.equal(or.uiPhase, 'or');
  assert.equal(or.arity, 2);
  assert.equal(or.ports.await, false);
  assert.equal(or.ports.outputs[0].type, 'md', 'or.out carries the RESOLVED payload type');
  assert.equal(m.graph.nodes.find((n) => n.id === 'n_end').label, 'End');
  assert.equal(m.graph.nodes.find((n) => n.id === 'n_task').label, 'Task');
});

test('wires carry loop + maxCycles, overlays win, plain wires carry none', () => {
  const m = build();
  const w3 = m.graph.wires.find((w) => w.id === 'w3');
  assert.equal(w3.loop, true);
  assert.equal(w3.maxCycles, 3);
  const w2 = m.graph.wires.find((w) => w.id === 'w2');
  assert.equal(w2.loop, false);
  assert.equal('maxCycles' in w2, false);
  const over = build({ overlays: { wires: { w3: { maxCycles: 7 } } } });
  assert.equal(over.graph.wires.find((w) => w.id === 'w3').maxCycles, 7);
  const bare = { ...TPL, wires: TPL.wires.map((w) => (w.id === 'w3' ? { id: w.id, from: w.from, to: w.to } : w)) };
  assert.equal(buildGraphManifest(bare, AGENTS).graph.wires.find((w) => w.id === 'w3').maxCycles, 3, 'default');
});

test('node overlays win over template config', () => {
  const m = build({ overlays: { nodes: { n_plan: { model: 'opus', effort: 'high', askQuestions: true } } } });
  const plan = m.graph.nodes.find((n) => n.id === 'n_plan');
  assert.equal(plan.model, 'opus');
  assert.equal(plan.effort, 'high');
  assert.equal(plan.askQuestions, true);
});

test('a node carries its sub-agent model policy so a resumed run keeps it', () => {
  const plain = build().graph.nodes.find((n) => n.id === 'n_plan');
  assert.equal(plain.subagentModel, '', 'no policy configured -> unset (the runtime resolves auto)');
  const over = build({ overlays: { nodes: { n_plan: { subagentModel: 'auto' } } } });
  assert.equal(over.graph.nodes.find((n) => n.id === 'n_plan').subagentModel, 'auto');
});

test('the icon is sanitized and dropped when oversized or script-ish', () => {
  const iconOf = (icon) => buildGraphManifest(TPL, { ...AGENTS, planner: { ...AGENTS.planner, icon } })
    .graph.nodes.find((n) => n.id === 'n_plan').icon;
  assert.equal(iconOf('<path onload="x()"/>'), '');
  assert.equal(iconOf(`<path d="${'M'.repeat(2100)}"/>`), '');
  // The manifest is persisted and outlives the code, and a user/plugin sidecar is
  // exactly the untrusted author v1's UI refuses to inline (`safeAgentIcon`), so
  // the filter is an ALLOWLIST: these four all slipped past the old denylist.
  // `\son[a-z]+=` misses `/`, `"` and `'` as attribute separators, and an
  // entity-encoded `javascript:` decodes inside an attribute value.
  assert.equal(iconOf('<svg/onload=alert(1)>'), '');
  assert.equal(iconOf('<path d="M1 1"onload=alert(1)/>'), '');
  assert.equal(iconOf('<image/href=x/onerror=alert(1)>'), '');
  assert.equal(iconOf('<a href="&#106;avascript:alert(1)">x</a>'), '');
  assert.equal(iconOf("<path d='M1 1'onmouseover='x()'/>"), '');
  assert.equal(iconOf('<path d="M1 1"/>trailing'), '', 'a text node is never markup an icon needs');
  assert.equal(iconOf('<foreignObject><script>x()</script></foreignObject>'), '');
  // The real sidecar icons still ride through untouched.
  assert.equal(build().graph.nodes.find((n) => n.id === 'n_plan').icon, '<path d="M1 1"/>');
  assert.equal(iconOf('<circle cx="12" cy="17" r="0.7" fill="currentColor" stroke="none"/>'),
    '<circle cx="12" cy="17" r="0.7" fill="currentColor" stroke="none"/>');
  assert.equal(iconOf('<rect x="6" y="4" width="12" height="17" rx="2"/><path d="M9.5 4V2.8h5V4" stroke-linejoin="round"/>'),
    '<rect x="6" y="4" width="12" height="17" rx="2"/><path d="M9.5 4V2.8h5V4" stroke-linejoin="round"/>');
});

test('malformed nodes/wires entries never throw a manifest build', () => {
  // `filter(Boolean)` kept a truthy non-object and an endpoint-less wire, and
  // `w.from.node` threw one line later (manifest.mjs:104).
  const junk = { ...TPL, nodes: [null, 7, {}, ...TPL.nodes], wires: [{}, 'junk', { id: 'w0' }, ...TPL.wires] };
  const m = buildGraphManifest(junk, AGENTS);
  assert.deepEqual(m.graph.nodes.map((n) => n.id), TPL.nodes.map((n) => n.id));
  assert.deepEqual(m.graph.wires.map((w) => w.id), TPL.wires.map((w) => w.id));
  assert.deepEqual(m.steps, build().steps);
  assert.deepEqual(manifestTemplate(m).nodes, manifestTemplate(build()).nodes);
});

test('the v1 shim cells reproduce buildStepperManifest exactly', () => {
  const m = build();
  assert.equal(m.steps[0].kind, 'preflight');
  assert.deepEqual(m.steps[0].nodes, [{ id: 'preflight', label: 'Preflight', sub: 'checks' }]);
  assert.equal(m.steps.at(-1).kind, 'done');
  assert.deepEqual(m.steps.at(-1).nodes, [{ id: 'done', label: 'Done', sub: 'complete' }]);
  const cells = m.steps.slice(1, -1);
  assert.ok(cells.every((c) => c.kind === 'agents'));
  // One cell per rank (loop wires excluded), nodes in launch order inside a cell.
  // The OR has no forward predecessor — both its in-wires are loop wires — so it
  // ranks 0 beside the task node.
  assert.deepEqual(cells.map((c) => c.nodes.map((n) => n.id)),
    [['n_task', 'n_or'], ['n_plan'], ['n_rev', 'n_rev2'], ['n_end']]);
  const planCell = cells[1].nodes[0];
  assert.deepEqual(Object.keys(planCell),
    ['id', 'key', 'uiPhase', 'label', 'color', 'sub', 'cycles', 'model', 'effort']);
  assert.equal(planCell.cycles, true, 'the planner has a WIRED loop input');
  assert.equal(cells[2].nodes[0].cycles, false);
  assert.equal(cells[0].nodes[1].key, null, 'flow nodes ride the shim cells too');
});

test('feedbacks mirror the loop wires', () => {
  assert.deepEqual(build().feedbacks, [{ id: 'w3', from: 'n_rev', to: 'n_or', maxCycles: 3 },
    { id: 'w5', from: 'n_rev2', to: 'n_or', maxCycles: 3 }]);
  assert.deepEqual(build({ overlays: { wires: { w3: { maxCycles: 5 } } } }).feedbacks[0],
    { id: 'w3', from: 'n_rev', to: 'n_or', maxCycles: 5 });
});

test('manifestPortsFn + manifestTemplate round-trip the graph WITHOUT the registry', () => {
  const m = build();
  const tpl = manifestTemplate(m);
  assert.equal(tpl.version, 2);
  assert.deepEqual(tpl.nodes.map((n) => n.id), TPL.nodes.map((n) => n.id));
  assert.deepEqual(tpl.wires.map((w) => w.id), TPL.wires.map((w) => w.id));
  // The round trip is LOSSLESS on config: rebuild it key by key and the Task
  // card comes back without `planStoreSeed` and P3's runTaskExecution stops
  // seeding the plan store after a resume.
  for (const n of TPL.nodes) {
    assert.deepEqual(tpl.nodes.find((x) => x.id === n.id).config, n.config, `${n.id} config survives`);
  }
  const portsFn = manifestPortsFn(m);
  assert.deepEqual(portsFn(tpl.nodes[1]).inputs.map((p) => p.id), ['task', 'revise', 'await']);
  assert.equal(portsFn(tpl.nodes[1]).inputs.at(-1).synthetic, true);
  assert.equal(portsFn({ id: 'ghost', kind: 'agent', key: 'x' }), undefined);
  const r = validateGraph(tpl, portsFn);
  assert.deepEqual(r.errors, [], JSON.stringify(r.errors));
});

test('UI_PHASE is the v1 map', () => {
  assert.equal(UI_PHASE.planner, 'plan');
  assert.equal(UI_PHASE.workspaceReviewer, 'review');
  assert.equal(UI_PHASE.manualWebUiTesting, 'manual-web');
  assert.equal(UI_PHASE.nope, undefined);
});
