// test/orchestrator-recovery-release.test.mjs
// The v2 port of dev's test/decomposed-phase-abort.test.mjs:69 ("a sibling parked
// on an interactive recovery prompt is released — the doomed phase must not wait
// on a human"), deleted by P8 commit 11c7b7ee with no replacement.
//
// Under the errors-pause policy the release is no longer a bespoke guard in
// GraphOrchestrator._execute's catch: a recovery `_ask` settles ONLY through
// answer()/pause()/stop() (no AbortSignal reaches it), and the phase-mate's genuine
// failure now PAUSES the run — so pause() itself rejects the parked prompt with the
// pause sentinel (run-harness.mjs#pause). Flow: p1t1's kaboom -> _runNodeAttempts
// (classifyError -> null -> the node site's pause verdict) -> _pauseFor -> pause() rejects p1t2's parked _ask
// with PauseError -> that rejection escapes _recover and propagates STRAIGHT out of
// _runNodeAttempts (the `await this._recover(…)` sits INSIDE its catch, so there is
// no re-classification) -> p1t2's _execute catch takes the pause branch. Both slices
// answer { paused: true }, runSlice marks them 'paused', runPhase returns
// { paused: true }, runComposite bails and settle -> pausedExecution for x:n_impl:1.
//
// Everything below the injected runner is REAL: the scheduler's composite driver
// (expand -> phase -> parallel slices -> finish), the semaphore, the recoverable-
// error classifier, _recover's serialized prompt queue and _ask's pendingQuestion
// slot. Only the two slice bodies are scripted; every other node runs under the
// offline mock, which is what writes the two-task phase-1 manifest.
import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { gitDir } from './helpers/git-dir.mjs';
import { createOrchestrator } from '../src/core/orchestrator.mjs';
import { writeGraphWorkflow } from '../src/core/workflows.mjs';
import { runAgentExecution } from '../src/core/graph/executor.mjs';

useTempHome(after);

// settings/agent lookups resolve under HOME, not WORCA_HOME (same isolation
// test/orchestrator-graph.test.mjs:22-36 uses).
let sandboxHome;
const prevEnv = {};
before(async () => {
  // This test needs BOTH slices of the phase in flight at once; at
  // WORCA_MAX_PARALLEL=1 the second never launches and the run dies on the 60 s
  // tripwire. Pin the scheduler's default (scheduler.mjs#defaultMaxParallel).
  prevEnv.WORCA_MAX_PARALLEL = process.env.WORCA_MAX_PARALLEL;
  process.env.WORCA_MAX_PARALLEL = '4';
  sandboxHome = await mkdtemp(join(tmpdir(), 'worca-recrel-home-'));
  for (const k of ['HOME', 'USERPROFILE']) prevEnv[k] = process.env[k];
  process.env.HOME = sandboxHome;
  process.env.USERPROFILE = sandboxHome;
});
after(async () => {
  for (const k of ['HOME', 'USERPROFILE', 'WORCA_MAX_PARALLEL']) {
    if (prevEnv[k] === undefined) delete process.env[k]; else process.env[k] = prevEnv[k];
  }
  await rm(sandboxHome, { recursive: true, force: true });
});

/** task -> decomposer -> implementer(expands) -> End. The smallest graph that
 *  fans out: the mock decomposer writes phase 1 with EXACTLY two tasks
 *  (claude-runner.mjs#mockDecomposer), which is the two-slice composite the
 *  deleted test needed. */
const RECOVERY_GRAPH = {
  id: 'wf_recovery_release',
  name: 'Recovery release probe',
  domain: 'coding',
  nodes: [
    { id: 'n_task', kind: 'task', x: 0, y: 0, config: {} },
    { id: 'n_dec', kind: 'agent', key: 'decomposer', x: 200, y: 0, config: {} },
    { id: 'n_impl', kind: 'agent', key: 'implementer', x: 400, y: 0, config: {} },
    { id: 'n_end', kind: 'end', x: 600, y: 0, config: {} },
  ],
  wires: [
    { id: 'w1', from: { node: 'n_task', port: 'task' }, to: { node: 'n_dec', port: 'plan' } },
    { id: 'w2', from: { node: 'n_task', port: 'task' }, to: { node: 'n_impl', port: 'plan' } },
    { id: 'w3', from: { node: 'n_dec', port: 'tasks' }, to: { node: 'n_impl', port: 'task' } },
    { id: 'w4', from: { node: 'n_impl', port: 'done' }, to: { node: 'n_end', port: 'result' } },
  ],
};

/** A recoverable `auth` failure, stamped the way claude-runner stamps a non-zero
 *  exit (recoverable-error.mjs:25 — an explicit stamp is authoritative). */
function authError() {
  const err = new Error('claude exited with code 1: invalid authentication');
  err.errorClass = 'auth';
  return err;
}

test('a slice parked on a recovery prompt is released when a phase-mate fails', { timeout: 60000 }, async () => {
  await writeGraphWorkflow(RECOVERY_GRAPH);
  const dir = gitDir('recrel');

  // Resolved once the recovery prompt is genuinely PARKED (the `question` event
  // fires BEFORE _ask installs pendingQuestion, so the slot is read a tick later).
  let parkedResolve;
  const parked = new Promise((res) => { parkedResolve = res; });
  let rejectedWith = null;

  const orch = createOrchestrator({
    projectDir: dir, workflowId: RECOVERY_GRAPH.id, prompt: 'demo',
    claude: { mock: true }, auto: false,
    runners: {
      // Non-slice executions (the decomposer) run under the offline mock exactly
      // as they would in production — that is what writes the 2-task phase 1.
      producer: async (ctx) => {
        if (!ctx.slice) return runAgentExecution(ctx);
        // p1t2 fails RECOVERABLY -> _runNodeAttempts -> _recover -> _ask parks it
        // on this.pendingQuestion with kind 'recovery'. Nothing ever answers it.
        if (ctx.slice.id === 'p1t2') throw authError();
        // p1t1 is the genuine failure, timed to land while p1t2 is parked.
        await parked;
        throw new Error('claude exited with code 1: kaboom');
      },
    },
  });

  const questions = [];
  const execs = [];
  orch.on('exec', (e) => execs.push(e));
  orch.on('question', (q) => {
    questions.push(q);
    if (q.kind !== 'recovery') return;
    setImmediate(() => {
      const pq = orch.pendingQuestion;
      assert.ok(pq, 'the recovery prompt installed its pendingQuestion slot');
      const reject = pq.reject;
      pq.reject = (err) => { rejectedWith = err; reject(err); };   // observe the guard
      parkedResolve();                                             // …then doom the phase
    });
  });

  const res = await orch.run();

  // 1. The prompt was really opened, and by the real recovery path.
  const recovery = questions.filter((q) => q.kind === 'recovery');
  assert.equal(recovery.length, 1, `exactly one recovery prompt opened: ${JSON.stringify(questions.map((q) => q.kind))}`);
  assert.match(recovery[0].id, /^recovery-auth-/, 'the prompt is keyed by its error class');
  // The prompt carries the failure policy's row options next to the cause.
  assert.deepEqual(recovery[0].recovery.options.map((o) => o.id), ['retry', 'pause']);
  const { options: _opts, ...recoveryCause } = recovery[0].recovery;
  assert.deepEqual(recoveryCause,
    { cls: 'auth', message: 'claude exited with code 1: invalid authentication' });

  // 2. pause() released the parked prompt with the pause sentinel — nothing waits on a human.
  assert.equal(rejectedWith?.name, 'PauseError', 'the parked prompt was rejected by the pause');
  assert.equal(orch.pendingQuestion, null, 'and the single prompt slot was cleared');

  // 3. The genuine failure PAUSED the run (errors never end a run); the reason names it.
  assert.equal(res.status, 'paused', JSON.stringify(res));
  assert.equal(res.reason, 'error');
  assert.equal(res.detail, 'claude exited with code 1: kaboom');
  assert.equal(orch.getState().status, 'paused');
  const composite = execs.find((e) => e.executionId === 'x:n_impl:1' && e.status === 'paused');
  assert.ok(composite, 'the composite shell row is paused (non-terminal), so resume re-runs the whole fan-out');
  assert.ok(!execs.some((e) => e.status === 'error'), 'the scheduler never recorded an error row');

  // 4. Both slices are CLOSED rows — paused, not error.
  const slices = orch.getState().steps.filter((s) => s.kind === 'task');
  assert.deepEqual(slices.map((s) => s.taskId).sort(), ['p1t1', 'p1t2']);
  for (const s of slices) assert.equal(s.status, 'paused', `${s.taskId} closed as paused`);
});
