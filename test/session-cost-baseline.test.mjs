// test/session-cost-baseline.test.mjs — one host session shared by several rows books each dollar once (it booked the running total on every row before).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { createOrchestrator } from '../src/core/orchestrator.mjs';

useTempHome(after);
function unit() {
  const o = createOrchestrator({ projectDir: join(tmpdir(), 'worca-sess-baseline'), claude: { mock: true } });
  o._persist = async () => {};
  for (const k of ['x:n_a:1', 'x:n_b:1', 'x:n_c:1']) o.state.steps.push({ key: k, executionId: k, nodeId: k.split(':')[1], costUsd: 0 });
  return o;
}
const res = (sid, total) => ({ type: 'result', costUsd: total, cumulativeCost: true, sessionId: sid });
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} vs ${b}`);

test('rows sharing a host session book their own turn only', () => {
  const o = unit();
  near(o._sessionCostDelta(res('H', 1.0), 'x:n_a:1'), 1.0);
  near(o._sessionCostDelta(res('H', 1.5), 'x:n_b:1'), 0.5);
  near(o._sessionCostDelta(res('H', 1.75), 'x:n_a:1'), 0.25);
});

test('a resumed harness rebuilds the baseline from the persisted rows (max over rows)', () => {
  const o = unit();
  o.state.steps[0].sessionCosts = { H: 1.0 };
  o.state.steps[1].sessionCosts = { H: 1.5 };
  near(o._sessionCostDelta(res('H', 2.0), 'x:n_c:1'), 0.5);
});

test('a figure below the baseline books nothing and becomes the baseline', () => {
  const o = unit();
  o._sessionCostDelta(res('H', 1.0), 'x:n_a:1');
  near(o._sessionCostDelta(res('H', 0.8), 'x:n_b:1'), 0);
  near(o._sessionCostDelta(res('H', 0.9), 'x:n_c:1'), 0.1);
});

test('M-1 — a seeded baseline (the trace\'s last cumulative) wins over the row max after a restart', () => {
  const o = unit();
  o.state.steps[0].sessionCosts = { H: 1.0 };                // a row that saw 1.0 before the CLI restored less
  o.state.steps[1].sessionCosts = { H: 0.8 };                // the live baseline was 0.8 (last-wins)
  o.seedSessionBaseline('H', 0.8);
  near(o._sessionCostDelta(res('H', 1.1), 'x:n_c:1'), 0.3, 'the same booking the live harness would have made');
  o.seedSessionBaseline('K', NaN);
  near(o._sessionCostDelta(res('K', 0.4), 'x:n_c:1'), 0.4, 'a non-finite seed is ignored');
});

test('ungrouped: one row per session behaves exactly as before', () => {
  const o = unit();
  near(o._sessionCostDelta(res('A', 0.3), 'x:n_a:1'), 0.3);
  near(o._sessionCostDelta(res('B', 0.2), 'x:n_b:1'), 0.2);
  near(o._sessionCostDelta(res('A', 0.5), 'x:n_a:1'), 0.2);
  assert.deepEqual(o.state.steps[0].sessionCosts, { A: 0.5 });
});

// ── v2 ──
test('v2 — the row max skips non-finite figures; a seed after first use replaces the live baseline', () => {
  const o = unit();
  o.state.steps[0].sessionCosts = { H: 'x' };
  o.state.steps[1].sessionCosts = { H: 0.6 };
  o.state.steps[2].sessionCosts = { H: Infinity };           // v3: any non-finite figure, not only NaN
  near(o._sessionCostDelta(res('H', 1.0), 'x:n_c:1'), 0.4, 'max over the finite figures only');
  o.seedSessionBaseline('H', 0.5);
  near(o._sessionCostDelta(res('H', 0.7), 'x:n_a:1'), 0.2, 'the seed replaces the live 1.0');
  near(o._sessionCostDelta(res('H', 0.9), 'x:n_b:1'), 0.2, 'then last-wins again');
});

test('v2 — a result with no step row books its own figure and leaves the baseline alone', () => {
  const o = unit();
  near(o._sessionCostDelta(res('H', 0.4), 'x:n_missing:1'), 0.4);
  near(o._sessionCostDelta(res('H', 0.5), 'x:n_a:1'), 0.5, 'the missing row never set a baseline');
});

// ── v4 ──
test('v4 — a seed sets the baseline of its own session id only', () => {
  const o = unit();
  near(o._sessionCostDelta(res('K', 0.6), 'x:n_a:1'), 0.6);
  o.seedSessionBaseline('H', 0.5);
  near(o._sessionCostDelta(res('K', 0.7), 'x:n_a:1'), 0.1, 'K keeps its own baseline');
  near(o._sessionCostDelta(res('H', 0.8), 'x:n_b:1'), 0.3, 'H books from its seed');
});

// ── v5 ──
test('v5 — a seed of 0 (a new epoch, Task 47\'s "else 0") is a baseline too', () => {
  const o = unit();
  o.state.steps[0].sessionCosts = { H: 0.5 };
  o.seedSessionBaseline('H', 0);
  near(o._sessionCostDelta(res('H', 0.3), 'x:n_b:1'), 0.3, 'the seed wins over the row max, even at 0');
});
