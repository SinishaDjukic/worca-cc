// test/duration-tracking.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createOrchestrator } from '../src/core/orchestrator.mjs';
import { resumedElapsedMs } from '../src/core/run-harness.mjs';

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

// ── The run clock: elapsed time as a clock (1 s per real second while the run works) ──
// state.elapsedMs (folded) + state.elapsedSince (anchor), the same shape as a step's clock.

/** Two step rows whose clocks both run (`_phase` start closes the others, so reopen the first). */
function twoRunningSteps(orch) {
  orch._phase('a', 0, 'start');
  orch._phase('b', 0, 'start');
  orch._clockResume('a');
}

test('run clock: parallel steps count once', async () => {
  await withClock((tick) => {
    const orch = fresh();
    orch._setStatus('running');
    twoRunningSteps(orch);
    tick(10_000);
    assert.equal(orch.liveElapsedMs(), 10_000, 'the run clock moved by the real time');
    assert.equal(orch.liveActiveMs(), 20_000, 'the summed step time counts both');
    orch._setStatus('done');
    const st = orch.getState();
    assert.equal(st.elapsedMs, 10_000);
    assert.equal(st.totalActiveMs, 20_000);
  });
});

test('run clock: ticks through the gap between steps', async () => {
  await withClock((tick) => {
    const orch = fresh();
    orch._setStatus('running');
    tick(500);                                              // set-up before the first step
    orch._phase('plan', 0, 'start'); tick(2000); orch._phase('plan', 0, 'done');
    tick(3000);                                             // no step clock runs
    orch._phase('implement', 0, 'start'); tick(1000); orch._phase('implement', 0, 'done');
    assert.equal(orch.liveElapsedMs(), 6500);
    assert.equal(orch.getState().totalActiveMs, 3000);
  });
});

test('run clock: a waiting question is excluded', async () => {
  await withClock(async (tick) => {
    const orch = fresh();
    orch._setStatus('running');
    orch._phase('clarify', 1, 'start');
    tick(1000);
    const p = orch._ask({ id: 'q1', kind: 'clarify', questions: [] });
    const parked = orch.getState();
    assert.equal(parked.elapsedMs, 1000, 'folded at the park');
    assert.equal(parked.elapsedSince, null, 'the clock stands while a person must answer');
    tick(10_000);
    assert.equal(orch.liveElapsedMs(), 1000);
    orch.answer('q1', { answers: [] });
    await p;
    assert.notEqual(orch.getState().elapsedSince, null, 'the answer restarts the clock');
    tick(2000);
    assert.equal(orch.liveElapsedMs(), 3000);
  });
});

test('an auto-answered gate does not park the run clock', async () => {
  await withClock(async (tick) => {
    const orch = fresh({ auto: true });
    orch._setStatus('running');
    tick(1000);
    let frames = 0;
    orch.on('state', () => { frames += 1; });
    const since = orch.getState().elapsedSince;
    await orch._ask({ id: 'g1', kind: 'gate' });
    assert.equal(frames, 0, 'no extra state frame');
    assert.equal(orch.getState().elapsedSince, since, 'the clock was never touched');
    tick(1000);
    assert.equal(orch.liveElapsedMs(), 2000);
  });
});

test('two waiting questions: the clock restarts after the last answer', async () => {
  await withClock(async (tick) => {
    const orch = fresh();
    orch._setStatus('running');
    tick(1000);
    const p1 = orch._ask({ id: 'q1', kind: 'clarify', questions: [] });
    const first = orch.pendingQuestion;
    const p2 = orch._ask({ id: 'q2', kind: 'clarify', questions: [] });   // a parallel execution's ask
    tick(5000);
    first.resolve({ answers: [] });
    await p1;
    assert.equal(orch.getState().elapsedSince, null, 'still parked: the second question waits');
    tick(5000);
    orch.answer('q2', { answers: [] });
    await p2;
    assert.notEqual(orch.getState().elapsedSince, null);
    tick(1000);
    assert.equal(orch.liveElapsedMs(), 2000);
  });
});

test('run clock: paused time is excluded; `pausing` still counts', async () => {
  await withClock((tick) => {
    const orch = fresh();
    orch._setStatus('running');
    tick(1000);
    orch._setStatus('pausing');
    tick(500);                                              // nodes still unwinding: work
    assert.equal(orch.liveElapsedMs(), 1500);
    orch._setStatus('paused');
    assert.equal(orch.getState().elapsedSince, null);
    tick(60_000);
    assert.equal(orch.liveElapsedMs(), 1500, 'parked');
    orch._setStatus('running');
    tick(1000);
    assert.equal(orch.liveElapsedMs(), 2500, 'continues from the parked value');
  });
});

test('a terminal status folds the run clock', async () => {
  for (const status of ['done', 'stopped', 'error', 'paused']) {
    await withClock((tick) => {
      const orch = fresh();
      orch._setStatus('running');
      tick(4000);
      const frames = [];
      orch.on('state', (s) => frames.push(s));
      orch._setStatus(status);
      assert.equal(orch.state.elapsedSince, null, `${status}: no dangling anchor`);
      assert.equal(orch.state.elapsedMs, 4000);
      assert.equal(frames[0].elapsedMs, 4000, `${status}: the state frame carries the folded figure`);
      assert.equal(frames[0].elapsedSince, null);
    });
  }
});

test('stop while waiting leaves the run clock folded', async () => {
  await withClock(async (tick) => {
    const orch = fresh();
    orch._setStatus('running');
    tick(1000);
    const p = orch._ask({ id: 'q1', kind: 'clarify', questions: [] });
    tick(5000);
    orch.stop();
    await assert.rejects(p);
    tick(5000);
    assert.equal(orch.getState().elapsedSince, null, 'the finally did not restart it');
    assert.equal(orch.liveElapsedMs(), 1000);
  });
});

test('sequential run: elapsed is at least the summed step time', async () => {
  await withClock(async (tick) => {
    const orch = fresh();
    orch._setStatus('running');
    orch._phase('plan', 0, 'start'); tick(2000);
    const p = orch._ask({ id: 'q1', kind: 'clarify', questions: [] });
    tick(9000);
    orch.answer('q1', { answers: [] });
    await p;
    tick(1000); orch._phase('plan', 0, 'done');
    orch._phase('implement', 0, 'start'); tick(4000); orch._phase('implement', 0, 'done');
    orch._setStatus('done');
    const st = orch.getState();
    assert.equal(st.totalActiveMs, 7000);
    assert.ok(st.elapsedMs >= st.totalActiveMs, `${st.elapsedMs} >= ${st.totalActiveMs}`);
  });
});

test('resumedElapsedMs: paused row keeps its figure', () => {
  assert.equal(resumedElapsedMs({ elapsedMs: 5000, elapsedSince: null, anchor: 2_000_000, now: 9_000_000, stepSum: 7000 }), 5000);
});

test('resumedElapsedMs: an interrupted run is credited up to its last heartbeat only', () => {
  assert.equal(resumedElapsedMs({ elapsedMs: 5000, elapsedSince: 1_000_000, anchor: 1_030_000, now: 9_000_000, stepSum: 0 }), 35_000);
  assert.equal(resumedElapsedMs({ elapsedMs: 5000, elapsedSince: 1_000_000, anchor: 1_030_000, now: 1_010_000, stepSum: 0 }), 15_000,
    'never past now');
  assert.equal(resumedElapsedMs({ elapsedMs: 5000, elapsedSince: 1_000_000, anchor: 900_000, now: 9_000_000, stepSum: 0 }), 5000,
    'an anchor before the start adds nothing');
});

test('resumedElapsedMs: a run without a figure continues from its step sum', () => {
  assert.equal(resumedElapsedMs({ elapsedMs: 0, elapsedSince: null, anchor: 2_000_000, now: 9_000_000, stepSum: 7000 }), 7000);
  assert.equal(resumedElapsedMs({ elapsedMs: undefined, elapsedSince: undefined, anchor: NaN, now: 9_000_000, stepSum: 7000 }), 7000);
});

test('resumedElapsedMs: a non-finite anchor adds nothing', () => {
  assert.equal(resumedElapsedMs({ elapsedMs: 5000, elapsedSince: 1_000_000, anchor: NaN, now: 9_000_000, stepSum: 0 }), 5000);
});
