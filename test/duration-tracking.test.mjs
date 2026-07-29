// test/duration-tracking.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createOrchestrator } from '../src/core/orchestrator.mjs';

// Deterministic clock for Date.now (epoch ms). Only the millisecond clock used
// for durations is stubbed; new Date().toISOString() (a separate real-clock
// call) is untouched. ASYNC + awaited so the stub survives await points.
async function withClock(fn) {
  const real = Date.now;
  let t = 1_000_000;
  Date.now = () => t;
  const tick = (ms) => { t += ms; };
  try {
    return await fn(tick);
  } finally {
    Date.now = real;
  }
}

const fresh = (opts = {}) => createOrchestrator({ projectDir: '/tmp/proj', ...opts });

test('initial state carries a zero total active time', () => {
  assert.equal(fresh().getState().totalActiveMs, 0);
});

test('a phase accrues active time between start and done', async () => {
  await withClock((tick) => {
    const orch = fresh();
    orch._phase('plan', 0, 'start');
    tick(2000);
    orch._phase('plan', 0, 'done');
    const step = orch.getState().steps.find((s) => s.key === 'plan');
    assert.equal(step.activeMs, 2000);
    assert.equal(step.runningSince, null, 'clock stopped at done');
    assert.equal(orch.getState().totalActiveMs, 2000);
  });
});

test('cycles of the same phase aggregate into per-stage active time', async () => {
  await withClock((tick) => {
    const orch = fresh();
    orch._phase('refine', 1, 'start'); tick(1500); orch._phase('refine', 1, 'done');
    orch._phase('refine', 2, 'start'); tick(2500); orch._phase('refine', 2, 'done');
    const st = orch.getState();
    assert.equal(st.steps.find((s) => s.key === 'refine#1').activeMs, 1500);
    assert.equal(st.steps.find((s) => s.key === 'refine#2').activeMs, 2500);
    assert.equal(st.totalActiveMs, 4000);
  });
});

test('time blocked on a question is excluded; active work before and after counts', async () => {
  await withClock(async (tick) => {
    const orch = fresh(); // NON-auto (auto defaults false): _ask returns a pending promise we resolve by hand
    orch._phase('clarify', 1, 'start');
    tick(1000);                                   // 1s active (planner work)
    const p = orch._ask({ id: 'q1', kind: 'clarify', questions: [] });
    tick(10_000);                                 // 10s idle — pipeline is blocked on the user
    orch.answer('q1', { answers: [] });           // unblock; _ask's finally resumes the clock
    await p;
    tick(2000);                                   // 2s more active work after the answer
    orch._phase('clarify', 1, 'done');
    const step = orch.getState().steps.find((s) => s.key === 'clarify#1');
    assert.equal(step.activeMs, 3000, '1s + 2s active; the 10s idle is excluded');
  });
});

test('live total includes the running tail before done', async () => {
  await withClock((tick) => {
    const orch = fresh();
    orch._phase('implement', 0, 'start');
    tick(3000);
    assert.equal(orch.liveActiveMs(), 3000, 'running tail reflected before done');
  });
});

test('a terminal status folds a still-running clock (no dangling runningSince)', async () => {
  await withClock((tick) => {
    const orch = fresh();
    orch._phase('implement', 0, 'start');
    tick(5000);
    orch._setStatus('stopped');                   // interrupted mid-phase
    const step = orch.getState().steps.find((s) => s.key === 'implement');
    assert.equal(step.runningSince, null, 'clock folded on terminal status');
    assert.equal(step.activeMs, 5000, 'in-progress tail captured');
    assert.equal(orch.getState().totalActiveMs, 5000);
  });
});
