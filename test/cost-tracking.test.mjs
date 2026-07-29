// test/cost-tracking.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createOrchestrator } from '../src/core/orchestrator.mjs';

const fresh = () => createOrchestrator({ projectDir: '/tmp/proj' });

test('initial state carries a zero total before any spend', () => {
  assert.equal(fresh().getState().totalCostUsd, 0);
});

test('a result event attributes total_cost_usd to the executing step and the total', () => {
  const orch = fresh();
  orch._phase('plan', 0, 'start'); // step key = "plan"
  orch._onAgentEvent('planner', { type: 'result', costUsd: 0.0731, raw: { type: 'result' } });
  const st = orch.getState();
  assert.equal(st.steps.find((s) => s.key === 'plan').costUsd, 0.0731);
  assert.equal(st.totalCostUsd, 0.0731);
});

test('cost falls back to raw.total_cost_usd when costUsd is absent', () => {
  const orch = fresh();
  orch._phase('plan', 0, 'start');
  orch._onAgentEvent('planner', { type: 'result', raw: { type: 'result', total_cost_usd: 0.02 } });
  assert.equal(orch.getState().totalCostUsd, 0.02);
});

test('cost fallback also reads the legacy raw.cost_usd spelling', () => {
  const orch = fresh();
  orch._phase('plan', 0, 'start');
  // event with NO top-level costUsd and only the legacy raw.cost_usd field
  orch._onAgentEvent('planner', { type: 'result', raw: { type: 'result', cost_usd: 0.04 } });
  assert.equal(orch.getState().totalCostUsd, 0.04);
});

test('a real (non-mock) result with no cost warns once; mock stays silent', () => {
  // real orchestrator (fresh() leaves claude.mock false)
  const real = fresh();
  real._phase('plan', 0, 'start');
  const realLogs = [];
  real.on('log', (l) => realLogs.push(l));
  real._onAgentEvent('planner', { type: 'result', raw: { type: 'result' } }); // no cost anywhere
  assert.equal(realLogs.filter((l) => l.level === 'warn').length, 1, 'real run warns about the missing cost estimate');

  // mock orchestrator stays silent (claude.mock === true)
  const mock = createOrchestrator({ projectDir: '/tmp/proj', claude: { mock: true } });
  mock._phase('plan', 0, 'start');
  const mockLogs = [];
  mock.on('log', (l) => mockLogs.push(l));
  mock._onAgentEvent('planner', { type: 'result', raw: { type: 'result' } });
  assert.equal(mockLogs.filter((l) => l.level === 'warn').length, 0, 'mock stays silent');
});

test('costs accumulate across phases/cycles into the running total', () => {
  const orch = fresh();
  orch._phase('clarify', 1, 'start');
  orch._onAgentEvent('planner', { type: 'result', costUsd: 0.01 });
  orch._phase('plan', 0, 'start');
  orch._onAgentEvent('planner', { type: 'result', costUsd: 0.02 });
  orch._phase('refine', 1, 'start');
  orch._onAgentEvent('refiner', { type: 'result', costUsd: 0.03 });
  const st = orch.getState();
  assert.equal(st.steps.find((s) => s.key === 'clarify#1').costUsd, 0.01);
  assert.equal(st.steps.find((s) => s.key === 'plan').costUsd, 0.02);
  assert.equal(st.steps.find((s) => s.key === 'refine#1').costUsd, 0.03);
  assert.equal(st.totalCostUsd, 0.06); // roundUsd keeps this exact (no float drift)
});

test('repeated result events on one step accumulate (e.g. a re-entered clarify cycle)', () => {
  const orch = fresh();
  orch._phase('clarify', 1, 'start');
  orch._onAgentEvent('planner', { type: 'result', costUsd: 0.01 });
  orch._onAgentEvent('planner', { type: 'result', costUsd: 0.02 });
  const st = orch.getState();
  assert.equal(st.steps.find((s) => s.key === 'clarify#1').costUsd, 0.03);
  assert.equal(st.totalCostUsd, 0.03);
});

test('a zero-cost result (offline mock) records a truthful $0.00 (field present)', () => {
  const orch = fresh();
  orch._phase('plan', 0, 'start');
  orch._onAgentEvent('planner', { type: 'result', costUsd: 0 });
  const st = orch.getState();
  const plan = st.steps.find((s) => s.key === 'plan');
  assert.equal(plan.costUsd, 0, 'zero is recorded, not skipped');
  assert.ok('costUsd' in plan, 'the field is present so the UI can show $0.00 not blank');
  assert.equal(st.totalCostUsd, 0);
});

test('a negative/NaN cost is ignored (never recorded)', () => {
  const orch = fresh();
  orch._phase('plan', 0, 'start');
  orch._onAgentEvent('planner', { type: 'result', costUsd: -5 });
  orch._onAgentEvent('planner', { type: 'result', costUsd: NaN });
  const plan = orch.getState().steps.find((s) => s.key === 'plan');
  assert.equal(plan.costUsd, undefined, 'no costUsd field written for bogus values');
  assert.equal(orch.getState().totalCostUsd, 0);
});

test('a result event with text both logs AND records cost (cost not swallowed)', () => {
  const orch = fresh();
  orch._phase('plan', 0, 'start');
  const logs = [];
  orch.on('log', (l) => logs.push(l));
  orch._onAgentEvent('planner', { type: 'result', text: 'done.', costUsd: 0.05, raw: { type: 'result' } });
  assert.ok(logs.some((l) => l.text === 'done.'), 'result text still logged at info');
  assert.equal(orch.getState().totalCostUsd, 0.05, 'cost still recorded');
});

test('total always equals the rounded sum of per-step costs (no accumulator drift)', () => {
  const roundUsd = (n) => Math.round(n * 1e4) / 1e4;
  const orch = fresh();
  orch._phase('plan', 0, 'start');
  orch._onAgentEvent('planner', { type: 'result', costUsd: 0.00005 });
  orch._phase('implement', 0, 'start');
  orch._onAgentEvent('coder', { type: 'result', costUsd: 0.00015 });
  const st = orch.getState();
  const sum = st.steps.reduce((a, s) => a + (Number.isFinite(s.costUsd) ? s.costUsd : 0), 0);
  assert.equal(st.totalCostUsd, roundUsd(sum), 'total must equal Σ steps (rounded once)');
  assert.equal(st.totalCostUsd, 0.0002, 'old independent accumulator produced 0.0003 here');
});
