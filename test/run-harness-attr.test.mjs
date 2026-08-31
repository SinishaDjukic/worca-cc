// test/run-harness-attr.test.mjs
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { RunHarness } from '../src/core/run-harness.mjs';
import { createOrchestrator } from '../src/core/orchestrator.mjs';
import { useTempHome } from './helpers/temp-home.mjs';

useTempHome(after);

const TELEMETRY = [
  '_onAgentEvent', '_recordSubAgentSpawns', '_recordSubAgentFinishes',
  '_recordSubAgentTelemetry', '_recordSkills', '_recordGraphify',
  '_upsertSubAgent', '_subAgentTransition', '_recordCost',
];

test('the attr-driven telemetry block lives on RunHarness (both engines share ONE copy)', () => {
  for (const name of TELEMETRY) {
    assert.equal(typeof RunHarness.prototype[name], 'function', `RunHarness#${name}`);
    assert.ok(
      !Object.hasOwn(Object.getPrototypeOf(createOrchestrator({ projectDir: process.cwd() })), name),
      `Orchestrator must NOT redeclare ${name} — it inherits the one copy`,
    );
  }
});

test('_log carries executionId and _artifact carries the node attribution', () => {
  const orch = createOrchestrator({ projectDir: process.cwd() });
  const logs = [];
  const arts = [];
  orch.on('log', (e) => logs.push(e));
  orch.on('artifact', (e) => arts.push(e));

  orch._log('planner', 'info', 'hello', { nodeId: 'n_plan', executionId: 'x:n_plan:2', cycle: 2 });
  assert.equal(logs[0].nodeId, 'n_plan');
  assert.equal(logs[0].executionId, 'x:n_plan:2');
  assert.equal(logs[0].cycle, 2);

  orch._log('planner', 'info', 'plain', null);
  assert.equal(logs[1].executionId, undefined, 'no attr => no executionId key');

  orch._artifact('plan', '/tmp/p.md', { nodeId: 'n_plan', executionId: 'x:n_plan:2', port: 'plan' });
  assert.deepEqual(arts[0], { kind: 'plan', path: '/tmp/p.md', nodeId: 'n_plan', executionId: 'x:n_plan:2', port: 'plan' });

  orch._artifact('plan', '/tmp/q.md');
  assert.deepEqual(arts[1], { kind: 'plan', path: '/tmp/q.md' }, '2-arg call stays byte-identical');
});

test('_ask echoes wireId/executionId on the question event, and only when given', async () => {
  const orch = createOrchestrator({ projectDir: process.cwd(), auto: true });
  const qs = [];
  orch.on('question', (q) => qs.push(q));
  const a = await orch._ask({ id: 'gate-w9-3', kind: 'gate', wireId: 'w9', executionId: 'x:n_rev:3', issues: [] });
  assert.deepEqual(a, { decision: 'continue' }, 'auto mode answers a gate with continue');
  assert.equal(qs[0].wireId, 'w9');
  assert.equal(qs[0].executionId, 'x:n_rev:3');
  await orch._ask({ id: 'q1', kind: 'gate', issues: [] });
  assert.ok(!('wireId' in qs[1]) && !('executionId' in qs[1]), 'v1 payload is byte-identical');
});

test('_recordCost attributes to an arbitrary step key (the executionId case)', () => {
  const orch = createOrchestrator({ projectDir: process.cwd() });
  orch.state.steps.push({ key: 'x:n_impl:1', phase: 'implementer', cycle: 1, status: 'start', activeMs: 0, runningSince: null });
  orch._recordCost(0.25, 'x:n_impl:1');
  assert.equal(orch.state.steps[0].costUsd, 0.25);
  assert.equal(orch.state.totalCostUsd, 0.25);
});

test('_ask freezes EVERY running execution, and never resurrects one that ended mid-prompt', async () => {
  const orch = createOrchestrator({ projectDir: process.cwd() });   // interactive: the ask parks
  const t0 = Date.now() - 50;
  orch.state.steps.push(
    { key: 'x:n_a:1', phase: 'a', cycle: 1, status: 'start', activeMs: 0, runningSince: t0 },
    { key: 'x:n_b:1', phase: 'b', cycle: 1, status: 'start', activeMs: 0, runningSince: t0 },
  );
  const [a, b] = orch.state.steps;
  // _ask runs synchronously up to `await new Promise(...)`, whose executor installs
  // pendingQuestion — so by the time this returns a promise, the freeze has happened
  // and answer() is safe (the setImmediate rule is only for a listener on `question`).
  const pending = orch._ask({ id: 'q-both', kind: 'gate', issues: [] });
  assert.equal(a.runningSince, null, 'A frozen');
  assert.equal(b.runningSince, null, 'B frozen too — not just the first row found');
  assert.ok(a.activeMs > 0 && b.activeMs > 0, 'both clocks folded their elapsed run');

  b.status = 'done';                       // B ended while the prompt was open; A did not
  assert.equal(orch.answer('q-both', { decision: 'continue' }), true);
  await pending;

  assert.notEqual(a.runningSince, null, 'A resumed: it is still running');
  assert.equal(b.runningSince, null, 'a step that ended mid-prompt is NOT resurrected');
});
