// test/graph-assemble.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeShape, cleanText, ShapeError, TASK_KINDS, SHAPE_LIMITS } from '../src/shared/graph/assemble.mjs';

const codes = (fn) => { try { fn(); } catch (e) { assert.ok(e instanceof ShapeError, String(e)); return e.issues.map((i) => i.code); } assert.fail('expected a ShapeError'); };

test('a minimal shape normalizes: minted ids, defaults, filtered tunables', () => {
  const s = normalizeShape({ stages: [{ agent: 'planner', model: ' m ', effort: 'high', fanOut: 'yes', askQuestions: true, bogus: 1 }, { agent: 'implementer' }] });
  assert.equal(s.name, 'Auto workflow');
  assert.equal(s.taskKind, 'prompt');
  assert.equal(s.reasoning, '');
  assert.deepEqual(s.stages.map((x) => x.id), ['s1', 's2']);
  assert.deepEqual(s.stages[0].tunables, { model: 'm', effort: 'high', askQuestions: true });
  assert.equal(s.stages[0].selfLoop, null);
  assert.equal(s.stages[0].loop, true);
  assert.deepEqual(s.loops, []);
});

test('name/taskKind/reasoning are sanitised; TASK_KINDS is the closed vocabulary', () => {
  const s = normalizeShape({ name: `  Plan,\n  refine   ${'x'.repeat(100)}`, taskKind: 'nope', reasoning: 'y'.repeat(900), stages: [{ agent: 'implementer' }] });
  assert.equal(s.name.length, SHAPE_LIMITS.maxNameLen);
  assert.ok(s.name.startsWith('Plan, refine x'));
  assert.equal(s.taskKind, 'prompt');
  assert.equal(s.reasoning.length, SHAPE_LIMITS.maxReasoningLen);
  assert.deepEqual([...TASK_KINDS], ['prompt', 'plan-partial', 'plan-complete-detailed', 'plan-complete-small']);
  assert.equal(normalizeShape({ taskKind: 'plan-complete-small', stages: [{ agent: 'implementer' }] }).taskKind, 'plan-complete-small');
});

test('cleanText: ANSI, control and format characters are stripped; whitespace collapses to one line; caps apply', () => {
  // ESC[31m is an ANSI colour code, U+202E a right-to-left override, U+200B a zero-width space:
  // model output is untrusted and lands in a terminal, a system prompt and a workflow row name.
  assert.equal(cleanText('A\x1b[31mB‮c\nd', 60), 'ABc d');
  assert.equal(cleanText('  x\t\ty​ z  ', 60), 'x y z');
  assert.equal(cleanText('long'.repeat(20), 10), 'longlonglo');
  assert.equal(cleanText(null, 5), '');
  const s = normalizeShape({ name: 'Plan\x1b[2J\nit', reasoning: 'why\n\nnot', stages: [{ agent: 'implementer' }] });
  assert.equal(s.name, 'Plan it');
  assert.equal(s.reasoning, 'why not', 'reasoning is a single line');
  // Stage ids and model ids are model-authored too and end up in ShapeError messages
  // that the terminal and the pause card print — cleaned before they get there.
  assert.throws(() => normalizeShape({ stages: [{ id: 'a\x1b[31m', agent: 'implementer' }, { id: 'a', agent: 'reviewer' }] }),
    (e) => e.issues.some((i) => i.code === 'DUP_STAGE_ID' && i.message.includes('"a"') && !i.message.includes('\x1b')));
  assert.equal(normalizeShape({ stages: [{ agent: 'planner', model: ' claude-\x1b[31mopus-5 ' }] }).stages[0].tunables.model, 'claude-opus-5');
});

test('parallel groups mint lettered member ids; nesting and tiny groups are refused', () => {
  const s = normalizeShape({ stages: [{ agent: 'planner' }, { parallel: [{ agent: 'reviewer' }, { agent: 'manualTestsChecklist' }] }] });
  assert.equal(s.stages[1].id, 's2');
  assert.deepEqual(s.stages[1].parallel.map((x) => x.id), ['s2a', 's2b']);
  assert.ok(codes(() => normalizeShape({ stages: [{ parallel: [{ agent: 'a' }, { parallel: [{ agent: 'b' }, { agent: 'c' }] }] }] })).includes('NESTED_GROUP'));
  assert.ok(codes(() => normalizeShape({ stages: [{ parallel: [{ agent: 'a' }] }] })).includes('GROUP_TOO_SMALL'));
});

test('selfLoop accepts true | n | {maxCycles}; loops resolve by id or by a unique key; ceilings hold', () => {
  const s = normalizeShape({
    stages: [{ id: 'p', agent: 'planner' }, { agent: 'refiner', selfLoop: true }, { agent: 'implementer' }, { agent: 'reviewer', selfLoop: { maxCycles: 5 } }, { agent: 'implementer', loop: false }],
    loops: [{ from: 'reviewer', to: 'p' }, { from: 's4', to: 's3', maxCycles: 2 }],
  });
  assert.deepEqual(s.stages[1].selfLoop, { maxCycles: 3 });
  assert.deepEqual(s.stages[3].selfLoop, { maxCycles: 5 });
  assert.equal(s.stages[4].loop, false);
  assert.deepEqual(s.loops, [{ from: 's4', to: 'p', maxCycles: 3 }, { from: 's4', to: 's3', maxCycles: 2 }]);
  assert.ok(codes(() => normalizeShape({ stages: [{ agent: 'implementer' }, { agent: 'implementer' }], loops: [{ from: 'implementer', to: 'implementer' }] })).includes('LOOP_ENDPOINT'));
  assert.ok(codes(() => normalizeShape({ stages: [{ agent: 'reviewer', selfLoop: 99 }] })).includes('BAD_CYCLES'));
  assert.ok(codes(() => normalizeShape({ stages: [] })).includes('NO_STAGES'));
  assert.ok(codes(() => normalizeShape({ stages: [{ agent: 'not a key!' }] })).includes('BAD_AGENT'));
  assert.ok(codes(() => normalizeShape({ stages: [{ id: 'x', agent: 'a' }, { id: 'x', agent: 'b' }] })).includes('DUP_STAGE_ID'));
  assert.ok(codes(() => normalizeShape({ stages: Array.from({ length: SHAPE_LIMITS.maxStages + 1 }, () => ({ agent: 'implementer' })) })).includes('TOO_MANY_STAGES'));
  assert.ok(codes(() => normalizeShape({ stages: [{ parallel: Array.from({ length: SHAPE_LIMITS.maxGroupMembers + 1 }, () => ({ agent: 'reviewer' })) }] })).includes('GROUP_TOO_LARGE'));
});

test('normalizeShape is IDEMPOTENT — assembleShape re-normalizes the classifier\'s already-normalized output', () => {
  const RAW = {
    name: 'N', taskKind: 'plan-partial', reasoning: 'r',
    stages: [{ id: 'p', agent: 'planner', model: 'm', effort: 'high', fanOut: true, askQuestions: true },
      { agent: 'refiner', selfLoop: { maxCycles: 4 } },
      { parallel: [{ agent: 'reviewer', loop: false }, { agent: 'manualTestsChecklist' }] }],
    loops: [{ from: 'reviewer', to: 'p', maxCycles: 2 }],
  };
  const once = normalizeShape(RAW);
  assert.deepEqual(once.stages[0].tunables, { model: 'm', effort: 'high', fanOut: true, askQuestions: true });
  assert.deepEqual(normalizeShape(once), once, 'a second pass must not drop the tunables (they now live under stage.tunables)');
});

// ── the assembler ─────────────────────────────────────────────────────────────

import { assembleShape } from '../src/shared/graph/assemble.mjs';
import { loadAgentRegistry } from '../src/core/agent-registry.mjs';
import { registryPortsFn } from '../src/core/graph/registry-ports.mjs';
import { validateGraph } from '../src/shared/graph/validate.mjs';
import { isomorphic } from '../src/shared/graph/isomorphic.mjs';
import { GRAPH_DEFAULT_WORKFLOW } from '../src/core/graph/builtin-workflows.mjs';
import { SEED_TEMPLATES } from '../src/core/graph/seed-templates.mjs';

const REG = loadAgentRegistry(undefined, { userAgentsDir: null, includePlugins: false });
const PORTS = registryPortsFn(REG);
const seed = (id) => SEED_TEMPLATES.find((t) => t.id === id);
const wire = (t, fromNode, fromPort, toNode, toPort) => t.wires.find((w) => w.from.node === fromNode && w.from.port === fromPort && w.to.node === toNode && w.to.port === toPort);

test('the prompt base shape assembles to the built-in Default graph (isomorphic), valid and laid out', () => {
  const { template, warnings, stageToNode, tunables } = assembleShape({
    name: 'Prompt base', stages: [{ agent: 'clarify' }, { agent: 'planner', model: 'claude-opus-5', effort: 'high' }, { agent: 'refiner', selfLoop: true }, { agent: 'implementer' }, { agent: 'reviewer' }],
  }, { registry: REG });
  assert.ok(isomorphic(template, GRAPH_DEFAULT_WORKFLOW), 'topology equals wf_default');
  assert.deepEqual(validateGraph(template, PORTS).errors, []);
  assert.deepEqual(warnings, []);
  assert.deepEqual(template.nodes.map((n) => n.id), ['n_task', 'n_clarify', 'n_planner', 'n_refiner', 'n_implementer', 'n_reviewer', 'n_end']);
  assert.equal(stageToNode.get('s2'), 'n_planner');
  assert.deepEqual(tunables, { n_planner: { model: 'claude-opus-5', effort: 'high' } });
  assert.deepEqual(template.nodes.find((n) => n.id === 'n_planner').config, { model: 'claude-opus-5', effort: 'high' });
  assert.ok(template.nodes.every((n) => Number.isFinite(n.x) && Number.isFinite(n.y)), 'autoLayout positioned every node');
  assert.ok(template.nodes.find((n) => n.id === 'n_planner').x > template.nodes.find((n) => n.id === 'n_clarify').x);
  assert.equal(template.version, 2);
  assert.equal(template.name, 'Prompt base');
  // The exact wires the rules promise (ids are w1..wN in creation order).
  assert.ok(wire(template, 'n_task', 'task', 'n_clarify', 'task'));
  assert.ok(wire(template, 'n_task', 'task', 'n_planner', 'task'), 'a required md input walks past clarify to the task card');
  assert.ok(wire(template, 'n_clarify', 'answers', 'n_planner', 'answers'), 'an optional input binds from the immediate predecessor');
  assert.ok(!wire(template, 'n_clarify', 'answers', 'n_implementer', 'task'), 'an optional expands input never reaches back past its predecessor');
  assert.deepEqual(wire(template, 'n_refiner', 'revise', 'n_refiner', 'revise').config, { maxCycles: 3 });
  assert.deepEqual(wire(template, 'n_reviewer', 'review', 'n_implementer', 'fix').config, { maxCycles: 3 }, 'a verifier auto-loops to the nearest loop input');
  assert.ok(wire(template, 'n_reviewer', 'pass', 'n_end', 'result'));
  assert.ok(!template.nodes.some((n) => n.config?.awaitAll), 'no seed node needs awaitAll');
});

test('quick fix and the two "complete plan" shapes', () => {
  const qf = assembleShape({ stages: [{ agent: 'planner' }, { agent: 'implementer' }, { agent: 'reviewer' }] }, { registry: REG }).template;
  assert.ok(isomorphic(qf, seed('wf_quick-fix')));

  const detailed = assembleShape({ taskKind: 'plan-complete-detailed', stages: [{ agent: 'implementer' }, { agent: 'reviewer' }] }, { registry: REG }).template;
  assert.deepEqual(detailed.nodes.find((n) => n.kind === 'task').config, { planStoreSeed: true });
  assert.ok(wire(detailed, 'n_task', 'task', 'n_implementer', 'plan'));
  assert.ok(wire(detailed, 'n_task', 'task', 'n_reviewer', 'plan'), 'the reviewer reads the provided plan from the task card');
  assert.ok(wire(detailed, 'n_implementer', 'done', 'n_reviewer', 'done'));
  assert.deepEqual(wire(detailed, 'n_reviewer', 'review', 'n_implementer', 'fix').config, { maxCycles: 3 });
  assert.deepEqual(validateGraph(detailed, PORTS).errors, []);

  const small = assembleShape({ taskKind: 'plan-complete-small', stages: [{ agent: 'implementer' }] }, { registry: REG }).template;
  assert.equal(small.nodes.length, 3);
  assert.deepEqual(small.wires.map((w) => [w.from.node, w.from.port, w.to.node, w.to.port]),
    [['n_task', 'task', 'n_implementer', 'plan'], ['n_implementer', 'done', 'n_end', 'result']]);
  assert.deepEqual(validateGraph(small, PORTS).errors, []);
});

test('two loops into one input fan through an or gate with per-wire budgets; loop:false leaves a verifier unwired', () => {
  const full = assembleShape({
    stages: [{ agent: 'clarify' }, { agent: 'planner' }, { agent: 'refiner', selfLoop: true }, { agent: 'decomposer' }, { agent: 'implementer' },
      { agent: 'reviewer' }, { agent: 'manualTestsChecklist' }, { agent: 'manualWebUiTesting' }],
    loops: [{ from: 'manualWebUiTesting', to: 'implementer', maxCycles: 2 }],
  }, { registry: REG }).template;
  const or = full.nodes.find((n) => n.kind === 'or');
  assert.ok(or, 'an or gate was minted');
  assert.deepEqual(or.config, { arity: 2 });
  assert.deepEqual(wire(full, 'n_reviewer', 'review', or.id, 'in1').config, { maxCycles: 3 });
  assert.deepEqual(wire(full, 'n_manualwebuitesting', 'review', or.id, 'in2').config, { maxCycles: 2 });
  assert.equal(wire(full, or.id, 'out', 'n_implementer', 'fix').config, undefined, 'the or.out wire carries no budget (V13)');
  assert.ok(wire(full, 'n_reviewer', 'pass', 'n_manualtestschecklist', 'await'), 'a stage taking nothing from its predecessor waits on it');
  assert.ok(wire(full, 'n_decomposer', 'tasks', 'n_implementer', 'task'));
  assert.deepEqual(validateGraph(full, PORTS).errors, []);

  const noLoop = assembleShape({
    stages: [{ agent: 'planner' }, { agent: 'implementer' }, { agent: 'reviewer' }, { agent: 'manualTestsChecklist' }, { agent: 'manualWebUiTesting', loop: false }],
  }, { registry: REG });
  assert.ok(!noLoop.template.nodes.some((n) => n.kind === 'or'));
  assert.ok(!noLoop.template.wires.some((w) => w.from.node === 'n_manualwebuitesting' && w.from.port === 'review'));
  assert.deepEqual(noLoop.warnings, [], 'loop:false is explicit — no LOOP_UNWIRED warning');
});

test('a verifier with nowhere to loop warns LOOP_UNWIRED; explicit loops are type-checked', () => {
  const r = assembleShape({ stages: [{ agent: 'planner' }, { agent: 'planReviewer' }, { agent: 'manualTestsChecklist' }] }, { registry: REG });
  assert.ok(wire(r.template, 'n_planreviewer', 'review', 'n_planner', 'revise'), 'planReviewer auto-loops into planner.revise');
  const r2 = assembleShape({ stages: [{ agent: 'manualTestsChecklist' }, { agent: 'manualWebUiTesting' }] }, { registry: REG });
  assert.deepEqual(r2.warnings.map((w) => w.code), ['LOOP_UNWIRED']);
  assert.throws(() => assembleShape({ stages: [{ agent: 'planner' }, { agent: 'implementer' }], loops: [{ from: 'planner', to: 'implementer' }] }, { registry: REG }),
    (e) => e.code === 'SHAPE_INVALID' && e.issues.some((i) => i.code === 'LOOP_SOURCE'));
  assert.throws(() => assembleShape({ stages: [{ agent: 'implementer' }, { agent: 'reviewer', selfLoop: true }] }, { registry: REG }),
    (e) => e.issues.some((i) => i.code === 'BAD_SELF_LOOP'));
});

test('humanInLoop:false strips clarifier stages by META and keeps the rest intact', () => {
  const on = assembleShape({ stages: [{ agent: 'clarify' }, { agent: 'planner' }, { agent: 'implementer' }, { agent: 'reviewer' }] }, { registry: REG }).template;
  const off = assembleShape({ stages: [{ agent: 'clarify' }, { agent: 'planner' }, { agent: 'implementer' }, { agent: 'reviewer' }] }, { registry: REG, humanInLoop: false }).template;
  assert.ok(isomorphic(on, seed('wf_clarify-quick-fix')));
  assert.ok(isomorphic(off, seed('wf_quick-fix')));
  assert.throws(() => assembleShape({ stages: [{ agent: 'clarify' }] }, { registry: REG, humanInLoop: false }), (e) => e.issues[0].code === 'EMPTY');
});

test('unknown / unplaceable agents and a missing producer are ShapeErrors with every issue listed', () => {
  assert.throws(() => assembleShape({ stages: [{ agent: 'nope' }, { agent: 'workspaceScanner' }] }, { registry: REG }),
    (e) => e.code === 'SHAPE_INVALID' && e.issues.map((i) => i.code).join() === 'UNKNOWN_AGENT,UNPLACEABLE_AGENT');
  assert.throws(() => assembleShape({ stages: [{ agent: 'workspaceReviewer' }] }, { registry: REG }),
    (e) => e.issues.some((i) => i.code === 'WORKSPACE_ONLY_AGENT'), 'a hand-authored shape cannot smuggle a workspace-only agent into a project run');
  // Every builtin's required inputs are md, which the task card always supplies —
  // so the NO_PRODUCER path needs an agent with a required json input.
  const REG2 = { ...REG, jsoneater: { key: 'jsoneater', displayName: 'JSON eater', runnerType: 'producer', inputs: [{ id: 'data', type: 'json' }], outputs: [{ id: 'out', type: 'md' }] } };
  assert.throws(() => assembleShape({ stages: [{ agent: 'jsoneater' }] }, { registry: REG2 }),
    (e) => e.issues.some((i) => i.code === 'NO_PRODUCER' && /"data"/.test(i.message)));
  assert.ok(assembleShape({ stages: [{ agent: 'decomposer' }, { agent: 'jsoneater' }] }, { registry: REG2 }).template.wires.some((w) => w.from.port === 'tasks' && w.to.port === 'data'),
    'with a json producer upstream the same agent wires up');
});

test('a repeated agent key gets a numbered node id; a Map registry works too', () => {
  const t = assembleShape({ stages: [{ agent: 'implementer' }, { agent: 'implementer' }] }, { registry: new Map(Object.entries(REG)) }).template;
  assert.deepEqual(t.nodes.filter((n) => n.kind === 'agent').map((n) => n.id), ['n_implementer', 'n_implementer2']);
  assert.ok(wire(t, 'n_implementer', 'done', 'n_implementer2', 'await'), 'the second waits on the first');
  assert.deepEqual(validateGraph(t, PORTS).errors, []);
});

test('a required input prefers the upstream output whose PORT ID equals the input id', () => {
  const REG3 = { ...REG, twoout: { key: 'twoout', displayName: 'Two out', runnerType: 'producer',
    inputs: [{ id: 'task', type: 'md' }], outputs: [{ id: 'other', type: 'md' }, { id: 'plan', type: 'md' }] } };
  const t = assembleShape({ stages: [{ agent: 'twoout' }, { agent: 'implementer' }] }, { registry: REG3 }).template;
  assert.ok(wire(t, 'n_twoout', 'plan', 'n_implementer', 'plan'), 'the "plan" output wins over the earlier "other" output');
  assert.ok(!wire(t, 'n_twoout', 'other', 'n_implementer', 'plan'));
});

test('ids, awaitAll and graph warnings: w1..wN in creation order, sanitised node ids, awaitAll on a whole-unit successor, GRAPH_* warnings surface', () => {
  const REG4 = { ...REG,
    'plug_AGENT-with_a_very_long_key_indeed': { key: 'plug_AGENT-with_a_very_long_key_indeed', displayName: 'Plug', runnerType: 'producer',
      inputs: [{ id: 'task', type: 'md' }], outputs: [{ id: 'out', type: 'md' }] },
    twoin: { key: 'twoin', displayName: 'Two in', runnerType: 'producer',
      inputs: [{ id: 'a', type: 'md' }, { id: 'b', type: 'md' }], outputs: [{ id: 'out', type: 'md' }] },
    twounits: { key: 'twounits', displayName: 'Two units', runnerType: 'producer',
      inputs: [{ id: 'plan', type: 'md' }, { id: 'tasks', type: 'json' }], outputs: [{ id: 'out', type: 'md' }] } };
  const t = assembleShape({ stages: [{ agent: 'plug_AGENT-with_a_very_long_key_indeed' }] }, { registry: REG4 }).template;
  assert.deepEqual(t.nodes.map((n) => n.id), ['n_task', 'n_plugagentwithaverylongkeyind', 'n_end'], 'the node id is lower-cased, stripped and clipped to NODE_ID_RE');
  assert.ok(t.nodes.every((n) => /^n_[a-z0-9]{1,32}$/.test(n.id)));
  assert.deepEqual(t.wires.map((w) => w.id), ['w1', 'w2'], 'wire ids are w1..wN in creation order');

  // Both inputs come from the ONE immediate predecessor: awaitAll, and no double-fire warning.
  const whole = assembleShape({ stages: [{ agent: 'planner' }, { agent: 'twoin' }] }, { registry: REG4 });
  assert.equal(whole.template.nodes.find((n) => n.id === 'n_twoin').config.awaitAll, true, 'rule 3b: a whole-unit successor awaits the wave');
  assert.deepEqual(whole.warnings, []);
  // Inputs from TWO units (planner.plan two steps back, decomposer.tasks): no awaitAll — and
  // validateGraph's V18 (two always-sourced payload inputs may double-fire) surfaces as GRAPH_V18.
  const warned = assembleShape({ stages: [{ agent: 'planner' }, { agent: 'decomposer' }, { agent: 'twounits' }] }, { registry: REG4 });
  assert.notEqual(warned.template.nodes.find((n) => n.id === 'n_twounits').config.awaitAll, true);
  assert.deepEqual(warned.warnings.map((w) => w.code), ['GRAPH_V18'], 'validateGraph warnings surface as GRAPH_<code>');
  assert.match(warned.warnings[0].message, /always-sourced payload inputs/);
  assert.equal(warned.warnings[0].nodeId, 'n_twounits');
});

test('an already-normalized shape assembles with its tunables intact (the classifier hands over a normalized shape)', () => {
  const normalized = normalizeShape({ stages: [{ agent: 'planner', model: 'claude-opus-5', effort: 'high' }, { agent: 'implementer', fanOut: true }, { agent: 'reviewer' }] });
  const { tunables, template } = assembleShape(normalized, { registry: REG });
  assert.deepEqual(tunables, { n_planner: { model: 'claude-opus-5', effort: 'high' }, n_implementer: { fanOut: true } });
  assert.deepEqual(template.nodes.find((n) => n.id === 'n_planner').config, { model: 'claude-opus-5', effort: 'high' });
});
