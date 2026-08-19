// test/decomposed-phase-abort.test.mjs — the FIRST genuine task failure must
// cancel still-running siblings IMMEDIATELY. Regression: phaseAbort.abort()
// used to run only in the post-allSettled forEach, so it could never cancel a
// running sibling — a 30-minute implementer burned its full runtime (plus
// recovery retries / a human-held recovery prompt) before the phase error threw.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { useTempHome } from './helpers/temp-home.mjs';
import { createOrchestrator } from '../src/core/orchestrator.mjs';

useTempHome(after);

const abortErr = () => { const e = new Error('aborted'); e.name = 'AbortError'; return e; };

// Node machinery stubbed at the decomposed-error-line.test.mjs seam:
// _runDecomposedImplement + _runDecomposedTask run REAL (observer, signal fold,
// selection); only _runNodeAttempts (the runner loop) is scripted per task node.
function decomposedOrch(attemptsByNode) {
  const orch = createOrchestrator({ projectDir: '/tmp/proj' });
  orch.pipeline = { id: 'p-phase-abort', dir: '/tmp/proj' };
  orch._nodeStep = () => {};
  orch._nodeCtx = () => ({});
  orch._bindNodeIo = () => ({});
  orch._persist = async () => {};
  orch._stageWorkingTree = async () => {};
  orch._runNodeAttempts = (node, stepIndex, cycle, ctx) => attemptsByNode[node.nodeId](ctx);
  return orch;
}

const IMPL = { key: 'implementer', model: 'sonnet', tools: ['Read'] };
const BUS = (tasks) => ({ decomposition: { phases: [{ ordinal: 1, tasks }] } });

// With the pre-fix code the never-settling sibling deadlocks allSettled, so the
// method under test would hang: race it against a watchdog that only elapses on
// failure (the fixed path settles in microtasks; the timer is cleared after).
async function raceWatchdog(p, ms = 2000) {
  let t;
  const guard = new Promise((res) => { t = setTimeout(() => res('HUNG'), ms); });
  try { return await Promise.race([p.then(() => 'resolved', (e) => e), guard]); }
  finally { clearTimeout(t); }
}

test('first genuine failure cancels a still-running sibling before allSettled; first failure wins over a later one', async () => {
  const tasks = [
    { id: 'p1t1', nodeId: 's_impl_p1_t1', title: 'Slice one', file: 'tasks/p1-t1.md' },
    { id: 'p1t2', nodeId: 's_impl_p1_t2', title: 'Slice two', file: 'tasks/p1-t2.md' },
    { id: 'p1t3', nodeId: 's_impl_p1_t3', title: 'Slice three', file: 'tasks/p1-t3.md' },
  ];
  let siblingCancelled = false;
  const orch = decomposedOrch({
    // t1: terminal failure on a microtask (the FIRST genuine failure).
    s_impl_p1_t1: async () => { await Promise.resolve(); throw new Error('claude exited with code 1: kaboom'); },
    // t2: the "30-minute implementer" — settles ONLY when its folded ctx.signal
    // aborts (claude-runner's contract: SIGTERM -> AbortError). Pre-fix this
    // promise never settles and the phase deadlocks on allSettled.
    s_impl_p1_t2: (ctx) => new Promise((_, rej) => {
      ctx.signal.addEventListener('abort', () => { siblingCancelled = true; rej(abortErr()); }, { once: true });
    }),
    // t3: a SECOND genuine failure, later (macrotask) — must not win selection.
    s_impl_p1_t3: () => new Promise((_, rej) => setTimeout(() => rej(new Error('second failure')), 20)),
  });

  const outcome = await raceWatchdog(orch._runDecomposedImplement(IMPL, 2, 1, BUS(tasks)));
  assert.notEqual(outcome, 'HUNG', 'sibling was never cancelled — phaseAbort fired only after allSettled');
  assert.match(outcome.message, /Decomposed implement failed in phase 1: task "Slice one": .*kaboom/);
  assert.equal(siblingCancelled, true, 'phaseAbort must reach the in-flight sibling via ctx.signal');
});

test('a sibling parked on an interactive recovery prompt is released — the doomed phase must not wait on a human', async () => {
  const tasks = [
    { id: 'p1t1', nodeId: 's_impl_p1_t1', title: 'Fails', file: 'tasks/p1-t1.md' },
    { id: 'p1t2', nodeId: 's_impl_p1_t2', title: 'In recovery', file: 'tasks/p1-t2.md' },
  ];
  let promptRejected = null;
  const orch = decomposedOrch({
    s_impl_p1_t1: async () => { await Promise.resolve(); throw new Error('claude exited with code 1: kaboom'); },
    // Parks exactly as _ask does: a bare promise settled only through
    // this.pendingQuestion (no AbortSignal can reach it).
    s_impl_p1_t2: () => new Promise((resolve, reject) => {
      orch.pendingQuestion = { id: 'recovery-auth-1', kind: 'recovery', resolve, reject };
    }).catch((e) => { promptRejected = e; throw e; }),
  });
  const outcome = await raceWatchdog(orch._runDecomposedImplement(IMPL, 2, 1, BUS(tasks)));
  assert.notEqual(outcome, 'HUNG', 'phase error must not wait for a human to answer a meaningless recovery prompt');
  assert.match(outcome.message, /task "Fails": .*kaboom/);
  assert.equal(promptRejected?.name, 'AbortError');
  assert.equal(orch.pendingQuestion, null, 'the rejected prompt slot must be cleared');
});

test('pause keeps its own unwind: the observer stays silent and no phase error is thrown', async () => {
  const tasks = [
    { id: 'p1t1', nodeId: 's_impl_p1_t1', title: 'Limit hit', file: 'tasks/p1-t1.md' },
    { id: 'p1t2', nodeId: 's_impl_p1_t2', title: 'Running', file: 'tasks/p1-t2.md' },
  ];
  const orch = decomposedOrch({
    // t1 hits a usage cap: _runNodeAttempts pauses the RUN and unwinds as a
    // PauseError (mirrors _pauseForLimit + throw pauseErr()).
    s_impl_p1_t1: async () => {
      await Promise.resolve();
      orch.state.status = 'running';
      orch.pause(); // fires pauseAbort -> kills siblings, sets pauseRequested
      const e = new Error('paused'); e.name = 'PauseError'; throw e;
    },
    // t2 is killed by pauseAbort (folded into ctx.signal) — as today; under
    // pauseRequested the attempts loop re-throws it as a PauseError.
    s_impl_p1_t2: (ctx) => new Promise((_, rej) => {
      ctx.signal.addEventListener('abort', () => { const e = new Error('paused'); e.name = 'PauseError'; rej(e); }, { once: true });
    }),
  });
  const outcome = await raceWatchdog(orch._runDecomposedImplement(IMPL, 2, 1, BUS(tasks)));
  assert.equal(outcome?.name, 'PauseError', `pause must unwind as a pause, got: ${outcome?.message || outcome}`);
});
