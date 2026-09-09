import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assembleShape } from '../src/shared/graph/assemble.mjs';
import { validateGraph } from '../src/shared/graph/validate.mjs';
import { loadAgentRegistry } from '../src/core/agent-registry.mjs';
import { registryPortsFn } from '../src/core/graph/registry-ports.mjs';
import { createScheduler } from '../src/core/graph/scheduler.mjs';

const REG = loadAgentRegistry(undefined, { userAgentsDir: null, includePlugins: false });
const PORTS = registryPortsFn(REG);
const S = (agent, extra = {}) => ({ agent, ...extra });
const wire = (t, fromNode, fromPort, toNode, toPort) => t.wires.find((w) => w.from.node === fromNode && w.from.port === fromPort && w.to.node === toNode && w.to.port === toPort);

test('a reviewer ∥ checklist group after the implementer: one AND, no combine, the successor waits on the AND and awaits the whole wave', () => {
  const { template, warnings } = assembleShape({
    stages: [{ agent: 'planner' }, { agent: 'refiner', selfLoop: true }, { agent: 'implementer' },
      { parallel: [{ agent: 'reviewer' }, { agent: 'manualTestsChecklist' }] }, { agent: 'manualWebUiTesting' }],
  }, { registry: REG });
  const and = template.nodes.find((n) => n.kind === 'and');
  assert.ok(and && !template.nodes.some((n) => n.kind === 'combine'), 'exactly one md producer in the group => no combine');
  assert.deepEqual(and.config, { arity: 2 });
  assert.ok(wire(template, 'n_reviewer', 'pass', and.id, 'in1'));
  assert.ok(wire(template, 'n_manualtestschecklist', 'checklist', and.id, 'in2'));
  assert.ok(wire(template, 'n_implementer', 'done', 'n_reviewer', 'done'));
  assert.ok(wire(template, 'n_refiner', 'plan', 'n_manualtestschecklist', 'plan'));
  assert.ok(wire(template, 'n_implementer', 'done', 'n_manualtestschecklist', 'await'), 'a member taking nothing from the predecessor waits on it');
  assert.ok(wire(template, 'n_manualtestschecklist', 'checklist', 'n_manualwebuitesting', 'checklist'), 'the group deliverable is the single md output');
  assert.ok(wire(template, and.id, 'out', 'n_manualwebuitesting', 'await'), 'after a group the successor waits on the AND');
  assert.equal(template.nodes.find((n) => n.id === 'n_manualwebuitesting').config.awaitAll, true, 'a group successor awaits the whole wave (both its wires come from the group)');
  const or = template.nodes.find((n) => n.kind === 'or');
  assert.ok(or, 'reviewer + web-ui review both loop into implementer.fix');
  assert.ok(wire(template, or.id, 'out', 'n_implementer', 'fix'));
  assert.ok(wire(template, 'n_manualwebuitesting', 'pass', 'n_end', 'result'));
  assert.deepEqual(validateGraph(template, PORTS).errors, []);
  assert.deepEqual(warnings, [], 'a well-formed group carries no warnings at all');
});

test('two md producers in a group are joined by ONE combine gate that feeds the successor, which awaits the wave', () => {
  const { template, warnings } = assembleShape({
    stages: [{ agent: 'planner' }, { parallel: [{ agent: 'manualTestsChecklist' }, { agent: 'decomposer' }, { agent: 'refiner', selfLoop: true }] }, { agent: 'implementer' }, { agent: 'reviewer' }],
  }, { registry: REG });
  const combine = template.nodes.find((n) => n.kind === 'combine');
  const and = template.nodes.find((n) => n.kind === 'and');
  assert.ok(combine && and);
  assert.equal(template.nodes.filter((n) => n.kind === 'combine').length, 1, 'minted once on first bind, then reused');
  assert.deepEqual(combine.config, { arity: 2 }, 'checklist.checklist + refiner.plan (the decomposer emits json, not md)');
  assert.deepEqual(and.config, { arity: 3 });
  assert.ok(wire(template, combine.id, 'out', 'n_implementer', 'plan'), 'the group speaks through its join: combine.out beats the member port literally named "plan"');
  assert.ok(!wire(template, 'n_refiner', 'plan', 'n_implementer', 'plan'));
  assert.ok(wire(template, combine.id, 'out', 'n_reviewer', 'plan'), 'a later binder of md gets the same join');
  assert.ok(wire(template, 'n_decomposer', 'tasks', 'n_implementer', 'task'), 'a member output still reaches the successor for a type the gates do not carry');
  assert.ok(wire(template, and.id, 'out', 'n_implementer', 'await'));
  assert.equal(template.nodes.find((n) => n.id === 'n_implementer').config.awaitAll, true, 'plan, task and await all come from the group');
  assert.deepEqual(validateGraph(template, PORTS).errors, []);
  assert.deepEqual(warnings, [], 'no V18 double-fire warning once awaitAll is set');
});

test('a group can end the run: the AND feeds End; an unbound md join is never minted', () => {
  const { template } = assembleShape({ taskKind: 'plan-complete-detailed', stages: [{ agent: 'implementer' }, { parallel: [{ agent: 'reviewer' }, { agent: 'manualTestsChecklist' }] }] }, { registry: REG });
  const and = template.nodes.find((n) => n.kind === 'and');
  assert.ok(wire(template, and.id, 'out', 'n_end', 'result'));
  assert.deepEqual(validateGraph(template, PORTS).errors, []);
  // Two md producers as the LAST stage: nothing binds the join, so the Combine is
  // never minted (a dangling gate would be a node with an unwired output).
  const last = assembleShape({ taskKind: 'plan-complete-detailed', stages: [{ agent: 'implementer' }, { parallel: [{ agent: 'manualTestsChecklist' }, { agent: 'refiner', selfLoop: true }] }] }, { registry: REG });
  assert.ok(!last.template.nodes.some((n) => n.kind === 'combine'), 'an unused join is never minted');
  assert.ok(last.template.nodes.some((n) => n.kind === 'and'));
  assert.deepEqual(validateGraph(last.template, PORTS).errors, []);
});

test('siblings never loop into each other — the review loops back to the planner instead; no awaitAll without a group successor', () => {
  const { template, warnings } = assembleShape({ stages: [{ agent: 'planner' }, { parallel: [{ agent: 'implementer' }, { agent: 'reviewer' }] }] }, { registry: REG });
  assert.ok(!wire(template, 'n_reviewer', 'review', 'n_implementer', 'fix'));
  assert.ok(wire(template, 'n_reviewer', 'review', 'n_planner', 'revise'), 'the nearest NON-sibling loop input of type md');
  assert.deepEqual(warnings.filter((w) => w.code === 'LOOP_UNWIRED'), []);
  assert.ok(!template.nodes.some((n) => n.config?.awaitAll), 'End is not an agent; siblings mix no waves');
  assert.deepEqual(validateGraph(template, PORTS).errors, []);
});

test('a loop never targets a group member its source does not read (the AND would never re-fire)', () => {
  const r = assembleShape({ stages: [{ agent: 'planner' }, { parallel: [{ agent: 'implementer' }, { agent: 'manualTestsChecklist' }] }, { agent: 'manualWebUiTesting' }] }, { registry: REG });
  assert.ok(!r.template.wires.some((w) => w.from.node === 'n_manualwebuitesting' && w.to.node === 'n_implementer'), 'not into the member');
  assert.ok(wire(r.template, 'n_manualwebuitesting', 'review', 'n_planner', 'revise'), 'the next loop input outside the group');
  assert.throws(() => assembleShape({ stages: [{ agent: 'planner' }, { parallel: [{ agent: 'implementer' }, { agent: 'manualTestsChecklist' }] }, { agent: 'manualWebUiTesting' }], loops: [{ from: 'manualWebUiTesting', to: 'implementer' }] }, { registry: REG }),
    (e) => e.code === 'SHAPE_INVALID' && e.issues.some((i) => i.code === 'LOOP_INTO_GROUP'));
  const ok = assembleShape({ stages: [{ agent: 'planner' }, { parallel: [{ agent: 'implementer' }, { agent: 'manualTestsChecklist' }] }, { agent: 'reviewer' }] }, { registry: REG });
  assert.ok(wire(ok.template, 'n_reviewer', 'review', 'n_implementer', 'fix'), 'legal: the reviewer binds implementer.done, so it re-fires without the AND');
});

test('a verifier after a mid-workflow group runs exactly once per fix wave, after the AND (real scheduler)', async () => {
  const { template } = assembleShape({
    stages: [S('planner'), S('implementer'), { parallel: [S('reviewer'), S('manualTestsChecklist')] }, S('manualWebUiTesting')],
    loops: [{ from: 'manualWebUiTesting', to: 'implementer', maxCycles: 6 }],
  }, { registry: REG });
  const execs = [];
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const execute = async ({ node, ordinal }) => {
    execs.push(`${node.id} c${ordinal}`);
    if (node.kind !== 'agent') return {};
    const outs = (REG[node.key].outputs).map((o) => o.id);
    const out = Object.fromEntries(outs.map((p) => [p, { value: `${node.id}#${ordinal}` }]));
    // The reviewer blocks once, the web-UI test three times: four waves in total. The
    // checklist is fast and the reviewer slow, so without awaitAll the web-UI test
    // would launch on the fresh checklist BEFORE the AND fired, then again on and.out.
    if (node.key === 'reviewer') { await sleep(20); return { outputs: out, verdict: { issues: ordinal === 1 ? [{ severity: 'major' }] : [] } }; }
    if (node.key === 'manualWebUiTesting') { await sleep(60); return { outputs: out, verdict: { issues: ordinal <= 3 ? [{ severity: 'major' }] : [] } }; }
    await sleep(5);
    return { outputs: out };
  };
  const sched = createScheduler({ template, portsFn: PORTS, execute, maxParallel: 4, onAsk: async () => 'continue' });
  assert.equal(await sched.run(), 'done');
  const webui = execs.filter((e) => e.startsWith('n_manualwebuitesting '));
  const ands = execs.filter((e) => e.startsWith('n_and1 '));
  assert.equal(webui.length, 4, `one web-UI run per wave, got ${execs.join(', ')}`);
  assert.equal(ands.length, 4, 'the AND fires on every wave');
  for (let i = 0; i < 4; i += 1) assert.ok(execs.indexOf(ands[i]) < execs.indexOf(webui[i]), `wave ${i + 1}: the AND fires before the web-UI test`);
});
