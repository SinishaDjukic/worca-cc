// test/orchestrator-recovery.test.mjs — recoverable-error retry gate.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, existsSync } from 'node:fs';
import { writeFile, chmod } from 'node:fs/promises';
import { tmpdir, hostname } from 'node:os';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { useTempHome } from './helpers/temp-home.mjs';
import { createOrchestrator } from '../src/core/orchestrator.mjs';
import { readPipelineForResume, reconcileStaleRunning } from '../src/core/artifacts.mjs';
import { writeGraphWorkflow } from '../src/core/workflows.mjs';
import { getDb } from '../src/core/db.mjs';
import { checkRows } from './helpers/rows.mjs';
import { NETWORK_ACTOR } from '../src/core/network-wait.mjs';
import { limitResetAt } from '../src/core/recoverable-error.mjs';
import { runOpts } from '../src/core/phases.mjs';
import { RECOVERY_MAX_AUTO_ATTEMPTS } from '../src/core/failure-policy.mjs';

useTempHome(after);
process.env.WORCA_RECOVERY_BACKOFF_MS = '0'; // no real waiting in tests
// The D17 straggler test needs BOTH branches of its graph in flight at once:
// defaultMaxParallel() reads WORCA_MAX_PARALLEL FIRST (scheduler.mjs:45-48), and at
// an ambient 1 n_side may take the only slot, End never fires and the run hangs.
// Same pin as test/orchestrator-recovery-release.test.mjs:34-38.
process.env.WORCA_MAX_PARALLEL = '4';

function gitDir() {
  const dir = mkdtempSync(join(tmpdir(), 'worca-cc-recovery-'));
  execSync('git init -q && git -c user.email=t@t -c user.name=t commit -q --allow-empty -m init', { cwd: dir });
  return dir;
}

const AUTH_ERR = () => new Error('claude exited with code 1: Failed to authenticate. API Error: 401 Invalid authentication credentials');
const NET_ERR = () => new Error('request to https://api.anthropic.com failed, reason: ECONNRESET');
const LIMIT_ERR = () => new Error("claude exited with code 1: You've hit your session limit · resets 6pm (Europe/Sofia)");
const QUOTA_ERR = () => new Error('claude exited with code 1: Your credit balance is too low to access the Anthropic API');
const okVerifier = async () => ({ status: 'ok', issues: [], review: { issues: [] }, summary: '' });

// Producer that throws an auth error on its FIRST call, then succeeds.
function authOnceProducer() {
  let thrown = false;
  return async () => {
    if (!thrown) { thrown = true; throw AUTH_ERR(); }
    return { status: 'ok', summary: 'done' };
  };
}

// Auto-answer clarify with the first option; route recovery to a fixed decision.
// IMPORTANT: defer every answer onto a microtask — _ask emits `question` BEFORE
// it parks pendingQuestion (orchestrator.mjs:1590 vs :1607) and answer() drops
// answers with no pending question (:248), so a synchronous answer would hang the
// run. queueMicrotask matches the established pattern in orchestrator-pause.test.
function answerWith(getOrch, recoveryDecision) {
  return ({ id, kind, questions }) => {
    queueMicrotask(() => {
      const orch = getOrch();
      if (kind === 'clarify') {
        orch.answer(id, { answers: (questions || []).map((q) => ({ id: q.id, choice: (q.options || ['auto'])[0] })) });
      } else if (kind === 'recovery') {
        orch.answer(id, { decision: recoveryDecision });
      } else {
        orch.answer(id, { decision: 'continue' }); // gates
      }
    });
  };
}

test('interactive: recoverable error -> Retry re-runs the node, run completes', async () => {
  const dir = gitDir();
  let orch;
  orch = createOrchestrator({
    projectDir: dir, prompt: 'demo', auto: false, claude: { mock: true },
    runners: { producer: authOnceProducer(), verifier: okVerifier },
  });
  orch.on('question', answerWith(() => orch, 'retry'));
  const res = await orch.run();
  assert.equal(res.status, 'done');
});

test('interactive: recoverable error -> Pause parks the run as paused (reason error), never error', async () => {
  const dir = gitDir();
  let orch;
  const logs = [];
  orch = createOrchestrator({
    projectDir: dir, prompt: 'demo', auto: false, claude: { mock: true },
    runners: { producer: authOnceProducer(), verifier: okVerifier },
  });
  orch.on('question', answerWith(() => orch, 'pause'));
  orch.on('log', (l) => logs.push(l));
  const res = await orch.run();
  assert.equal(res.status, 'paused', JSON.stringify(res));
  assert.equal(res.reason, 'error');
  assert.match(res.detail, /401 Invalid authentication credentials/);
  assert.equal(orch.getState().status, 'paused');
  assert.equal(orch.getState().pauseReason, 'error', 'getState() carries the reason');
  // The ONE error-level line is written BEFORE the error is converted into the pause sentinel.
  assert.ok(logs.some((l) => l.level === 'error' && /execution failed: .*401/.test(l.text)), JSON.stringify(logs.filter((l) => l.level === 'error')));
  const row = getDb().prepare('SELECT status, resume_point, branch FROM pipelines WHERE id = ?').get(orch.state.id);
  assert.equal(row.status, 'paused');
  const rp = JSON.parse(row.resume_point);
  assert.equal(rp.pauseReason, 'error');
  assert.match(rp.pauseDetail, /401/);
  assert.ok(existsSync(JSON.parse(row.branch).worktreeDir), 'worktree kept for the resume');
  // The failed execution is a PAUSED (non-terminal) row — what reattach re-invokes.
  assert.ok(orch.getState().steps.some((s) => s.status === 'paused'), JSON.stringify(orch.getState().steps.map((s) => [s.key, s.status])));
  assert.ok(!orch.getState().steps.some((s) => s.status === 'error'));
});

test("interactive: the legacy { decision: 'abort' } answer still means Pause", async () => {
  const dir = gitDir();
  let orch;
  orch = createOrchestrator({
    projectDir: dir, prompt: 'demo', auto: false, claude: { mock: true },
    runners: { producer: authOnceProducer(), verifier: okVerifier },
  });
  orch.on('question', answerWith(() => orch, 'abort'));
  const res = await orch.run();
  assert.equal(res.status, 'paused');
  assert.equal(res.reason, 'error');
});

test('auto: bounded retry then PAUSE when a transient error never clears', async () => {
  const dir = gitDir();
  let calls = 0;
  const alwaysNet = async () => { calls++; throw NET_ERR(); };
  const orch = createOrchestrator({
    projectDir: dir, prompt: 'demo', auto: true, claude: { mock: true },
    runners: { producer: alwaysNet, verifier: okVerifier },
  });
  const res = await orch.run();
  // An outage that outlasts the backoff budget is still outside the pipeline's
  // control: park the run as resumable instead of a terminal error.
  assert.equal(res.status, 'paused');
  // A self-parked auto run keeps its CLASS: 'recoverable' (resume when it clears),
  // never the 'error' verdict a user's give-up or a genuine failure carries.
  assert.equal(res.reason, 'recoverable');
  assert.match(res.detail || '', /^network: .*ECONNRESET/);
  // First producer node: 1 initial + RECOVERY_MAX_AUTO_ATTEMPTS retries = 4 calls.
  assert.equal(calls, 4);
});

// OpenRouter's `:free` pool: a 429 for one request, whatever worca's own rate. The
// run retries it like any rate limit, logs each wait, then pauses naming the cause.
const POOL_ERR = () => new Error('claude exited with code 1: API Error: Request rejected (429) · openai: rate limited (429) — qwen/qwen3.8-27b:free is temporarily rate-limited upstream');

test('auto: a shared-pool 429 retries with logged waits, then pauses naming the shared pool', async () => {
  const dir = gitDir();
  let calls = 0;
  const logs = [];
  const orch = createOrchestrator({
    projectDir: dir, prompt: 'demo', auto: true, claude: { mock: true },
    runners: { producer: async () => { calls++; throw POOL_ERR(); }, verifier: okVerifier },
  });
  orch.on('log', (l) => logs.push(l));
  const res = await orch.run();
  assert.equal(res.status, 'paused');
  assert.equal(res.reason, 'recoverable');
  assert.equal(calls, 4, '1 initial + 3 retries');
  const waits = logs.filter((l) => /retrying in \d+(\.\d+)?s \(retry \d\/\d\)/.test(l.text || ''));
  assert.equal(waits.length, 3, 'each wait is logged');
  assert.match(res.detail || '', /^rate_limit: .*rate-limited upstream/);
  assert.match(res.detail || '', /shared free pool/);
  assert.match(res.detail || '', /not worca's max-concurrent/);
});

test('auto: auth and quota errors pause immediately (one call, reason recoverable, class in the detail; auth logs a warn, never an error)', async () => {
  await checkRows([
    { name: 'auto: auth error pauses immediately — a 7s backoff cannot re-login', run: async () => {
      const dir = gitDir();
      let calls = 0;
      const logs = [];
      const alwaysAuth = async () => { calls++; throw AUTH_ERR(); };
      const orch = createOrchestrator({
        projectDir: dir, prompt: 'demo', auto: true, claude: { mock: true },
        runners: { producer: alwaysAuth, verifier: okVerifier },
      });
      orch.on('log', (l) => logs.push(l));
      const res = await orch.run();
      assert.equal(res.status, 'paused', JSON.stringify(res));
      assert.equal(res.reason, 'recoverable');
      assert.match(res.detail || '', /^auth: .*401/);
      assert.equal(calls, 1, 'auth is NOT retried — it pauses on the first hit');
      // The class survives into the run log (a warn, not the error-level failure line).
      assert.ok(logs.some((l) => l.level === 'warn' && /recoverable auth error — pausing/.test(l.text)), JSON.stringify(logs.map((l) => [l.level, l.text])));
      assert.ok(!logs.some((l) => l.level === 'error'), 'a recoverable pause is not logged as a failure');
    } },
    { name: 'auto: quota error pauses immediately — retrying cannot top up the balance', run: async () => {
      const dir = gitDir();
      let calls = 0;
      const alwaysQuota = async () => { calls++; throw QUOTA_ERR(); };
      const orch = createOrchestrator({
        projectDir: dir, prompt: 'demo', auto: true, claude: { mock: true },
        runners: { producer: alwaysQuota, verifier: okVerifier },
      });
      const res = await orch.run();
      assert.equal(res.status, 'paused');
      assert.equal(res.reason, 'recoverable');
      assert.match(res.detail || '', /^quota: .*credit balance/i);
      assert.equal(calls, 1, 'quota is NOT retried — it pauses on the first hit');
    } },
  ]);
});

test('auto: a network-paused run resumes to done once the outage clears', async () => {
  const dir = gitDir();
  let calls = 0;
  let healthy = false;
  const flaky = async () => { calls++; if (!healthy) throw NET_ERR(); return { status: 'ok', summary: 'done' }; };
  const orch = createOrchestrator({
    projectDir: dir, prompt: 'demo', auto: true, claude: { mock: true },
    runners: { producer: flaky, verifier: okVerifier },
  });
  const res = await orch.run();
  assert.equal(res.status, 'paused');
  assert.equal(calls, 4, 'the retry budget ran dry before the pause');

  // "Circumstances changed": the outage cleared; the paused row must resume to done.
  healthy = true;
  const saved = readPipelineForResume(orch.state.id);
  assert.equal(saved.row.status, 'paused');
  assert.ok(saved.resumePoint, 'the pause left a resume point');
  const orch2 = createOrchestrator({
    projectDir: dir, prompt: 'demo', auto: true, claude: { mock: true },
    runners: { producer: flaky, verifier: okVerifier },
    resume: saved,
  });
  const res2 = await orch2.resume();
  assert.equal(res2.status, 'done');
});

test('a NON-recoverable throw pauses the run with reason error + detail (was: status error)', async () => {
  const dir = gitDir();
  const orch = createOrchestrator({
    projectDir: dir, prompt: 'demo', auto: true, claude: { mock: true },
    runners: { producer: async () => { throw new Error('claude exited with code 1: disk full'); }, verifier: okVerifier },
  });
  const res = await orch.run();
  assert.equal(res.status, 'paused', JSON.stringify(res));
  assert.equal(res.reason, 'error');
  assert.equal(res.detail, 'claude exited with code 1: disk full');
  assert.equal(res.error, undefined, 'a paused result has no error field');
  const saved = readPipelineForResume(orch.state.id);
  assert.equal(saved.row.status, 'paused');
  assert.ok(saved.resumePoint?.snapshot, 'the frozen (clean) scheduler snapshot is persisted (the Task card completed before the agent fired)');
  assert.ok(!saved.resumePoint.snapshot.execs.some((e) => e.status === 'error'), 'the scheduler never saw the error');
});

test('resume after an error-pause re-invokes the paused execution WITH its session and completes', async () => {
  const dir = gitDir();
  let boom = true;
  const seen = [];
  const mkRunners = () => ({
    producer: async (ctx) => {
      ctx.onEvent({ type: 'session', sessionId: `sess-${ctx.nodeId}` });
      seen.push({ nodeId: ctx.nodeId, resume: ctx.resumeSessionId || null });
      if (boom) { boom = false; throw new Error('claude exited with code 1: disk full'); }
      return { status: 'ok', summary: 'ok' };
    },
    verifier: okVerifier,
  });
  const orch1 = createOrchestrator({ projectDir: dir, prompt: 'demo', auto: true, claude: { mock: true }, runners: mkRunners() });
  const r1 = await orch1.run();
  assert.equal(r1.status, 'paused');
  const failed = seen[0];
  const saved = readPipelineForResume(orch1.state.id);
  assert.equal(saved.steps.find((s) => s.nodeId === failed.nodeId)?.status, 'paused');

  const orch2 = createOrchestrator({ projectDir: dir, auto: true, claude: { mock: true }, runners: mkRunners(), resume: saved });
  const r2 = await orch2.resume();
  assert.equal(r2.status, 'done', JSON.stringify(r2));
  assert.ok(seen.some((s) => s.nodeId === failed.nodeId && s.resume === `sess-${failed.nodeId}`), 'the failed execution re-ran with its session re-attached');
  assert.equal(orch2.pauseReason, null); assert.equal(orch2.getState().pauseDetail, null);
  const after2 = readPipelineForResume(orch1.state.id);
  assert.equal(after2.row.status, 'done');
  assert.equal(after2.row.resume_point, null);
});

test('the user stop still ends the run STOPPED even when the child dies with a plain error', async () => {
  const dir = gitDir();
  let orch;
  orch = createOrchestrator({
    projectDir: dir, prompt: 'demo', auto: true, claude: { mock: true },
    runners: {
      producer: async () => {
        orch.stop();                                            // the user's stop lands mid-node…
        await new Promise((r) => setTimeout(r, 5));
        throw new Error('claude exited with code 143');         // …and the child reports a PLAIN error
      },
      verifier: okVerifier,
    },
  });
  const res = await orch.run();
  assert.equal(res.status, 'stopped', JSON.stringify(res));
  const row = getDb().prepare('SELECT status, resume_point FROM pipelines WHERE id = ?').get(orch.state.id);
  assert.equal(row.status, 'stopped');
  assert.equal(row.resume_point, null, 'a stopped run is never resumable');
});

test('an error-pause that lands AFTER the End card fired still PAUSES the run (D17); resume re-invokes the straggler and completes', { timeout: 60_000 }, async () => {
  const dir = gitDir();
  // Two branches off the Task card: n_review (a verifier) reaches End at once;
  // n_side (a producer, NOT wired to End) is still running when End fires and then
  // fails. The scheduler prefers `ended` over `pauseRequested` (scheduler.mjs:1033-1034),
  // so without _engineRun's D17 guard this run would end 'done' with the error swallowed.
  // Needs BOTH branches in flight at once — the module-scope WORCA_MAX_PARALLEL pin
  // (see the top of this file) guarantees the second slot; at 1 this would deadlock.
  const wf = await writeGraphWorkflow({
    id: 'wf_straggler', name: 'Straggler',
    nodes: [
      { id: 'n_task', kind: 'task', x: 0, y: 0, config: {} },
      { id: 'n_review', kind: 'agent', key: 'reviewer', x: 240, y: 0, config: {} },
      { id: 'n_side', kind: 'agent', key: 'planner', x: 240, y: 200, config: {} },
      { id: 'n_end', kind: 'end', x: 480, y: 0, config: {} },
    ],
    wires: [
      { id: 'w1', from: { node: 'n_task', port: 'task' }, to: { node: 'n_review', port: 'plan' } },
      { id: 'w2', from: { node: 'n_task', port: 'task' }, to: { node: 'n_side', port: 'task' } },
      { id: 'w3', from: { node: 'n_review', port: 'pass' }, to: { node: 'n_end', port: 'result' } },
    ],
  });
  let sideCalls = 0;
  let endFired;
  const endReached = new Promise((r) => { endFired = r; });
  const mk = () => ({
    verifier: okVerifier,                                   // n_review: instant pass -> End fires
    producer: async () => {                                 // n_side: the straggler
      sideCalls++;
      if (sideCalls === 1) {
        await endReached;                                   // hold until End has settled…
        await new Promise((r) => setTimeout(r, 10));
        throw new Error('claude exited with code 1: side blew up');   // …then fail
      }
      return { status: 'ok', summary: 'ok' };
    },
  });
  const orch1 = createOrchestrator({ projectDir: dir, prompt: 'demo', auto: true, claude: { mock: true }, workflowId: wf.id, runners: mk() });
  orch1.on('exec', (p) => { if (p.nodeId === 'n_end' && p.status === 'done') endFired(); });
  const r1 = await orch1.run();
  assert.equal(r1.status, 'paused', JSON.stringify(r1));
  assert.equal(r1.reason, 'error');
  assert.match(r1.detail, /side blew up/);
  assert.equal(sideCalls, 1, 'the straggler DID run (both branches fire together: defaultMaxParallel is 4)');
  const saved = readPipelineForResume(orch1.state.id);
  assert.equal(saved.row.status, 'paused');
  assert.ok(saved.resumePoint.snapshot?.ended, 'the frozen point already carries End');
  assert.equal(saved.resumePoint.snapshot.execs.find((e) => e.executionId === 'x:n_side:1')?.status, 'start',
    'the straggler is NON-terminal in the frozen point (onSnapshot froze when pause() ran)');

  const orch2 = createOrchestrator({ projectDir: dir, auto: true, claude: { mock: true }, runners: mk(), resume: saved });
  const r2 = await orch2.resume();
  assert.equal(r2.status, 'done', JSON.stringify(r2));
  assert.equal(sideCalls, 2, 'reattach re-invoked the straggler; nothing else re-ran');
  assert.equal(orch2.getState().endReached, true);
  assert.equal(readPipelineForResume(orch1.state.id).row.status, 'done');
});

test('auto: session-limit pauses the run (not error) and is resumable', async () => {
  const dir = gitDir();
  let calls = 0;
  const limit = async () => { calls++; throw LIMIT_ERR(); };
  const orch = createOrchestrator({
    projectDir: dir, prompt: 'demo', auto: true, claude: { mock: true },
    runners: { producer: limit, verifier: okVerifier },
  });
  const res = await orch.run();
  assert.equal(res.status, 'paused');
  assert.equal(res.reason, 'usage_limit', 'a machine-readable reason code');
  assert.match(res.detail || '', /session limit/i, 'the cause rides the detail');
  assert.equal(calls, 1, 'a usage cap is NOT retried — it pauses on the first hit');
});

// A point saved by a usage-limit pause on the first call; `calls` counts producer entries.
async function limitPausedPoint(dir, err = LIMIT_ERR) {
  const orch = createOrchestrator({
    projectDir: dir, prompt: 'demo', auto: true, claude: { mock: true },
    runners: { producer: async () => { throw err(); }, verifier: okVerifier },
  });
  const res = await orch.run();
  assert.equal(res.status, 'paused', JSON.stringify(res));
  return { orch, res };
}

test('auto: a session-limit pause carries the parsed reset time (done payload + resume point)', async () => {
  const dir = gitDir();
  const expected = new Date(limitResetAt(LIMIT_ERR())).toISOString();
  const { orch, res } = await limitPausedPoint(dir);
  assert.equal(res.reason, 'usage_limit');
  assert.equal(res.limitResetAt, expected);
  assert.equal(orch.getState().limitResetAt, expected);
  assert.equal(readPipelineForResume(orch.state.id).resumePoint.limitResetAt, expected);
});

test('auto: a limit message naming no time pauses with limitResetAt null and logs it', async () => {
  const dir = gitDir();
  const logs = [];
  const orch = createOrchestrator({
    projectDir: dir, prompt: 'demo', auto: true, claude: { mock: true },
    runners: {
      producer: async () => { throw new Error("claude exited with code 1: You've hit your session limit."); },
      verifier: okVerifier,
    },
  });
  orch.on('log', (l) => logs.push(l));
  const res = await orch.run();
  assert.equal(res.status, 'paused', JSON.stringify(res));
  assert.equal(res.reason, 'usage_limit');
  assert.equal(res.limitResetAt, null);
  assert.ok(logs.some((l) => l.level === 'info' && /usage-limit reset time not recognised/.test(l.text)), JSON.stringify(logs.map((l) => l.text)));
  assert.equal('limitResetAt' in readPipelineForResume(orch.state.id).resumePoint, false);
});

test('resume clears limitResetAt from the live state', async () => {
  const dir = gitDir();
  const { orch: orch1 } = await limitPausedPoint(dir);
  const saved = readPipelineForResume(orch1.state.id);
  assert.ok(saved.resumePoint.limitResetAt);
  const orch2 = createOrchestrator({
    projectDir: dir, auto: true, claude: { mock: true },
    runners: { producer: async () => ({ status: 'ok', summary: 'done' }), verifier: okVerifier },
    resume: saved,
  });
  const r2 = await orch2.resume();
  assert.equal(r2.status, 'done', JSON.stringify(r2));
  assert.equal(orch2.getState().limitResetAt, null);
});

test('auto-limit-resume counter: streak continues only on an automatic resume that hits the limit again', async () => {
  const dir = gitDir();
  const { orch: orch1 } = await limitPausedPoint(dir);
  const again = async (autoLimitResume) => {
    const saved = readPipelineForResume(orch1.state.id);
    saved.resumePoint.autoLimitResumes = 1;
    const orch = createOrchestrator({
      projectDir: dir, auto: true, claude: { mock: true },
      runners: { producer: async () => { throw LIMIT_ERR(); }, verifier: okVerifier },
      resume: saved, ...(autoLimitResume ? { autoLimitResume: true } : {}),
    });
    const res = await orch.resume();
    assert.equal(res.status, 'paused', JSON.stringify(res));
    assert.equal(res.reason, 'usage_limit');
    return readPipelineForResume(orch1.state.id).resumePoint;
  };
  assert.equal((await again(true)).autoLimitResumes, 2);
  assert.equal('autoLimitResumes' in await again(false), false, 'a manual resume restarts the streak');
});

test('auto-limit-resume counter: a first-run limit pause has no counter; a finished step ends a streak', async () => {
  const dir = gitDir();
  const { orch: orch1 } = await limitPausedPoint(dir);
  assert.equal('autoLimitResumes' in readPipelineForResume(orch1.state.id).resumePoint, false);

  // step 1 completes, then the next call hits the limit again — on an automatic resume
  const saved = readPipelineForResume(orch1.state.id);
  saved.resumePoint.autoLimitResumes = 1;
  let calls = 0;
  const orch2 = createOrchestrator({
    projectDir: dir, auto: true, claude: { mock: true },
    runners: {
      producer: async () => { if (++calls === 1) return { status: 'ok', summary: 'done' }; throw LIMIT_ERR(); },
      verifier: okVerifier,
    },
    resume: saved, autoLimitResume: true,
  });
  const res = await orch2.resume();
  assert.equal(res.status, 'paused', JSON.stringify(res));
  assert.equal(res.reason, 'usage_limit');
  assert.ok(calls >= 2, 'a step finished before the limit hit');
  assert.equal('autoLimitResumes' in readPipelineForResume(orch1.state.id).resumePoint, false);
});

test('auto-limit-resume: a non-limit pause drops both autoLimitResumes and limitResetAt', async () => {
  const dir = gitDir();
  const { orch: orch1 } = await limitPausedPoint(dir);
  const saved = readPipelineForResume(orch1.state.id);
  saved.resumePoint.autoLimitResumes = 1;
  let orch2;
  orch2 = createOrchestrator({
    projectDir: dir, auto: false, claude: { mock: true },
    runners: { producer: authOnceProducer(), verifier: okVerifier },
    resume: saved, autoLimitResume: true,
  });
  orch2.on('question', answerWith(() => orch2, 'pause'));
  const res = await orch2.resume();
  assert.equal(res.status, 'paused', JSON.stringify(res));
  assert.equal(res.reason, 'error');
  const rp = readPipelineForResume(orch1.state.id).resumePoint;
  assert.equal('autoLimitResumes' in rp, false);
  assert.equal('limitResetAt' in rp, false);
});

test('interactive: session-limit pauses WITHOUT opening a recovery prompt', async () => {
  const dir = gitDir();
  let orch;
  let recoveryAsks = 0;
  orch = createOrchestrator({
    projectDir: dir, prompt: 'demo', auto: false, claude: { mock: true },
    runners: { producer: async () => { throw LIMIT_ERR(); }, verifier: okVerifier },
  });
  // Answer clarify normally; a usage cap must NEVER reach a recovery prompt.
  orch.on('question', ({ id, kind, questions }) => {
    if (kind === 'recovery') { recoveryAsks++; return; }
    queueMicrotask(() => orch.answer(id, {
      answers: (questions || []).map((q) => ({ id: q.id, choice: (q.options || ['auto'])[0] })),
    }));
  });
  const res = await orch.run();
  assert.equal(res.status, 'paused');
  assert.equal(recoveryAsks, 0, 'no retry/abort prompt — a usage cap always pauses');
});

test('shared gate: two concurrent recoveries of one class open ONE prompt', async () => {
  const dir = gitDir();
  const orch = createOrchestrator({ projectDir: dir, prompt: 'x', auto: false, claude: { mock: true } });
  orch.pipeline = { id: 1, dir, promptText: 'x' };   // minimal ctx for appendAudit/log
  let asks = 0;
  orch._ask = async ({ id }) => { asks++; orch.__rid = id; return { decision: 'retry' }; };
  const node = { key: 'planner', nodeId: 'n1' };
  const [a, b] = await Promise.all([
    orch._recover({ node, cls: 'auth', err: AUTH_ERR(), attempt: 1 }),
    orch._recover({ node, cls: 'auth', err: AUTH_ERR(), attempt: 1 }),
  ]);
  assert.equal(a.outcome, 'retry');
  assert.equal(b.outcome, 'retry');
  assert.equal(asks, 1, 'one shared prompt for both same-class failures');
});

test('serialized gate: two DISTINCT classes never open two prompts at once', async () => {
  const dir = gitDir();
  const orch = createOrchestrator({ projectDir: dir, prompt: 'x', auto: false, claude: { mock: true } });
  orch.pipeline = { id: 1, dir, promptText: 'x' };
  let open = 0;
  let maxOpen = 0;
  let asks = 0;
  // Stubbed _ask holds the "prompt" open briefly; record the peak concurrency.
  orch._ask = async () => {
    asks++; open++; maxOpen = Math.max(maxOpen, open);
    // NOTE: the timer must stay REF'd. Every runtime timer in the harness is
    // unref'd ("never hold the CLI open"), so during this 5ms hold the stub's
    // timer is the only thing keeping the event loop alive; an unref'd timer
    // here lets the loop drain mid-test and node:test cancels the run
    // ("Promise resolution is still pending but the event loop has already
    // resolved"), taking every later test in this file down with it.
    await new Promise((r) => { setTimeout(r, 5); });
    open--;
    return { decision: 'retry' };
  };
  const [a, b] = await Promise.all([
    orch._recover({ node: { key: 'n1', nodeId: 'a' }, cls: 'auth', err: AUTH_ERR(), attempt: 1 }),
    orch._recover({ node: { key: 'n2', nodeId: 'b' }, cls: 'network', err: NET_ERR(), attempt: 1 }),
  ]);
  assert.equal(a.outcome, 'retry');
  assert.equal(b.outcome, 'retry');
  assert.equal(asks, 2, 'one prompt per distinct class');
  assert.equal(maxOpen, 1, 'prompts are serialized — only one open at a time');
});

// ── Feature 5: incremental boundary resume point ────────────────────────────────

const okVerifierF5 = async () => ({ status: 'ok', issues: [], review: { issues: [] }, summary: '' });

// ONE done run (both former tests started with exactly this run); the done-row check runs
// before the crash is forged.
test('a done row has NULL resume_point; crash -> reconcile -> resume continues from saved boundary to done', async () => {
  const dir = gitDir();
  const orch = createOrchestrator({
    projectDir: dir, prompt: 'demo', auto: true, claude: { mock: true },
    runners: { producer: okVerifierF5, verifier: okVerifierF5 },
  });
  const res = await orch.run();
  assert.equal(res.status, 'done');
  await checkRows([
    { name: 'done row has NULL resume_point (incremental writes cleared by done arm)', run: () => {
      const saved = readPipelineForResume(orch.state.id);
      assert.equal(saved.resumePoint, null, 'done row must have NULL resume_point');
    } },
    { name: 'crash -> reconcile -> resume continues from saved boundary to done', run: async () => {
      const id = orch.state.id;
      // A finished run has NULL owner columns, cleared by finally (folded from the deleted
      // orchestrator-heartbeat test).
      const cols = getDb().prepare('SELECT owner_pid, owner_host, heartbeat_at FROM pipelines WHERE id = ?').get(id);
      assert.equal(cols.owner_pid, null);
      assert.equal(cols.owner_host, null);
      assert.equal(cols.heartbeat_at, null);
      const pDir = orch.state.pipelineDir;

      // Forge a "crash": flip the finished row back to running with a dead PID and a
      // synthetic v2 point carrying the run's own frozen manifest and an EMPTY
      // scheduler snapshot, so the resume replays the graph from the start (safe for
      // a mock runner). The manifest is what the graph engine rehydrates from.
      const point = {
        version: 2, snapshot: null, manifest: orch.getState().stepper,
        nodes: [], planVersion: 0, stepModels: null, workflowId: 'wf_default',
        checkpointRef: null, pipelineDir: pDir, pausedAt: new Date().toISOString(),
      };
      // Re-create the worktree dir so resume()'s existsSync check passes: in a real crash
      // the worktree was never torn down, but our test ran to completion (teardown ran).
      const savedRow = getDb().prepare('SELECT branch FROM pipelines WHERE id = ?').get(id);
      const branchInfo = savedRow?.branch ? JSON.parse(savedRow.branch) : null;
      if (branchInfo?.worktreeDir) mkdirSync(branchInfo.worktreeDir, { recursive: true });
      getDb().prepare(
        `UPDATE pipelines SET status='running', owner_pid=?, owner_host=?, heartbeat_at=?,
     resume_point=? WHERE id=?`,
      ).run(2 ** 31 - 1, hostname(), new Date().toISOString(), JSON.stringify(point), id);

      // Reconcile: dead PID on THIS host → row flipped to 'interrupted', resume_point preserved.
      const rec = reconcileStaleRunning({ host: hostname() });
      assert.ok(rec.ids.includes(id), 'reaper must flip the row');
      const after = readPipelineForResume(id);
      assert.equal(after.row.status, 'interrupted');
      assert.ok(after.resumePoint, 'resume_point preserved across reclassify');
      assert.equal(after.resumePoint.version, 2);
      assert.equal(after.resumePoint.manifest.version, 2, 'the frozen manifest survived the reclassify');

      // Resume (requires Feature 6 widening to accept 'interrupted').
      const orch2 = createOrchestrator({
        projectDir: dir, prompt: 'demo', auto: true, claude: { mock: true },
        runners: { producer: okVerifierF5, verifier: okVerifierF5 },
        resume: after,
      });
      const res2 = await orch2.resume();
      assert.equal(res2.status, 'done');
    } },
  ]);
});

// ── Wait for the network (network-wait.mjs) ─────────────────────────────────
// Each test injects the probe and a clock and pins the setting with env, so the
// developer's real settings.json cannot flip it.
const okProducer = async () => ({ status: 'ok', summary: 'done' });
function fakeNetClock() {
  let t = Date.parse('2026-10-17T08:00:00Z');
  return { now: () => t, sleep: async (ms, signal) => { if (!signal?.aborted) t += ms; } };
}
/** A real-time clock with 5 ms sleeps that end early on an abort. */
const shortClock = () => ({ now: Date.now, sleep: (ms, s) => new Promise((r) => { const t = setTimeout(r, 5); s?.addEventListener('abort', () => { clearTimeout(t); r(); }, { once: true }); }) });
function withNetEnv(fn) {
  return async () => {
    const keep = { a: process.env.WORCA_NETWORK_WAIT, b: process.env.WORCA_NETWORK_WAIT_MAX_MS };
    process.env.WORCA_NETWORK_WAIT = '1'; process.env.WORCA_NETWORK_WAIT_MAX_MS = '3600000';
    try { await fn(); } finally {
      for (const [k, v] of [['WORCA_NETWORK_WAIT', keep.a], ['WORCA_NETWORK_WAIT_MAX_MS', keep.b]]) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    }
  };
}

test('auto + network down: waits for the endpoint, then retries and finishes — no pause', withNetEnv(async () => {
  const dir = gitDir(); let calls = 0; let up = false; const probes = []; const byNode = new Map();
  const orch = createOrchestrator({ projectDir: dir, prompt: 'demo', auto: true, claude: { mock: true },
    networkClock: fakeNetClock(),
    networkProbe: async (origin) => { probes.push(origin); const r = up; if (probes.length >= 3) up = true; return r; },
    runners: { producer: async (ctx) => { calls++; byNode.set(ctx.nodeId, (byNode.get(ctx.nodeId) || 0) + 1); if (calls === 1) throw NET_ERR(); return okProducer(ctx); }, verifier: okVerifier } });
  const logs = []; orch.on('log', (l) => logs.push(l.text));
  const res = await orch.run();
  assert.equal(res.status, 'done', res.error);
  assert.equal(Math.max(...byNode.values()), 2, 'one failure, one retry after the network came back');
  assert.ok(probes.every((o) => o === 'https://api.anthropic.com'), 'the default route probes the Anthropic API origin');
  assert.ok(logs.some((t) => /waiting for network… api\.anthropic\.com is unreachable/.test(t)));
  assert.ok(logs.some((t) => /network back — retrying/.test(t)));
  assert.equal(orch.getState().networkWait, null, 'the banner is gone');
}));

test('auto + endpoint reachable on the first probe: today\'s bounded retries, then a recoverable pause marked reachable', withNetEnv(async () => {
  const dir = gitDir(); let calls = 0;
  const orch = createOrchestrator({ projectDir: dir, prompt: 'demo', auto: true, claude: { mock: true },
    networkClock: fakeNetClock(), networkProbe: async () => true,
    runners: { producer: async () => { calls++; throw NET_ERR(); }, verifier: okVerifier } });
  const res = await orch.run();
  assert.equal(res.status, 'paused'); assert.equal(res.reason, 'recoverable');
  assert.equal(calls, 4, 'unchanged: 1 try + 3 retries');
  const rp = readPipelineForResume(orch.getState().id).resumePoint;
  assert.equal(rp.pauseClass, 'network');
  assert.equal(rp.network.reachable, true);
  assert.equal(rp.runAuto, true, 'the --yes mode is kept for the watcher');
}));

test('auto + network never back: past the max wait the run pauses as today (recoverable, unreachable)', withNetEnv(async () => {
  const dir = gitDir(); let calls = 0;
  const orch = createOrchestrator({ projectDir: dir, prompt: 'demo', auto: true, claude: { mock: true },
    networkClock: fakeNetClock(), networkProbe: async () => false,
    runners: { producer: async () => { calls++; throw NET_ERR(); }, verifier: okVerifier } });
  const logs = []; orch.on('log', (l) => logs.push(l.text));
  const res = await orch.run();
  assert.equal(res.status, 'paused'); assert.equal(res.reason, 'recoverable');
  assert.equal(calls, 1, 'no retry while the endpoint never answered');
  assert.ok(logs.some((t) => /network still down after 1h 0m — pausing/.test(t)));
  const rp = readPipelineForResume(orch.getState().id).resumePoint;
  assert.equal(rp.network.reachable, false);
  assert.equal(typeof rp.network.since, 'string');
}));

test('auto: a pause during the wait unwinds at once as the user\'s pause', withNetEnv(async () => {
  const dir = gitDir(); let probes = 0;
  let orch;
  orch = createOrchestrator({ projectDir: dir, prompt: 'demo', auto: true, claude: { mock: true },
    networkClock: shortClock(),
    networkProbe: async () => { if (++probes === 2) setImmediate(() => orch.pause('ada')); return false; },
    runners: { producer: async () => { throw NET_ERR(); }, verifier: okVerifier } });
  const res = await orch.run();
  assert.equal(res.status, 'paused');
  assert.equal(res.reason ?? null, null, 'a manual pause: no reason, so the watcher never resumes it');
}));

test('auto: stop during the wait ends the run as stopped', withNetEnv(async () => {
  const dir = gitDir(); let orch;
  orch = createOrchestrator({ projectDir: dir, prompt: 'demo', auto: true, claude: { mock: true },
    networkClock: shortClock(),
    networkProbe: async () => { setImmediate(() => orch.stop()); return false; },
    runners: { producer: async () => { throw NET_ERR(); }, verifier: okVerifier } });
  const res = await orch.run();
  assert.equal(res.status, 'stopped');
}));

test('interactive + network down: the prompt opens at once with the note and answers Retry itself when the probe passes', withNetEnv(async () => {
  const dir = gitDir(); let calls = 0; let probes = 0;
  const orch = createOrchestrator({ projectDir: dir, prompt: 'demo', claude: { mock: true },
    networkClock: fakeNetClock(), networkProbe: async () => ++probes >= 3,
    runners: { producer: async (ctx) => { calls++; if (calls === 1) throw NET_ERR(); return okProducer(ctx); }, verifier: okVerifier } });
  const recoveries = []; const auto = [];
  orch.on('question', (q) => {
    if (q.kind === 'recovery') recoveries.push(q);
    else setImmediate(() => orch.answer(q.id, q.kind === 'gate' ? { decision: 'continue' } : { answers: [] }));
  });
  orch.on('recovery-auto', (e) => auto.push(e));
  const res = await orch.run();
  assert.equal(res.status, 'done', res.error);
  assert.equal(recoveries.length, 1);
  assert.equal(recoveries[0].recovery.network.host, 'api.anthropic.com');
  assert.equal(typeof recoveries[0].recovery.network.until, 'string');
  assert.deepEqual(auto.map((e) => e.decision), ['retry']);
  assert.equal(orch.answeredBy(recoveries[0].id), NETWORK_ACTOR);
}));

test('interactive: the user picking Pause during the wait wins; nothing answers afterwards', withNetEnv(async () => {
  const dir = gitDir(); const auto = [];
  const orch = createOrchestrator({ projectDir: dir, prompt: 'demo', claude: { mock: true },
    networkClock: shortClock(),
    networkProbe: async () => false,
    runners: { producer: async () => { throw NET_ERR(); }, verifier: okVerifier } });
  orch.on('question', (q) => {
    if (q.kind === 'recovery') setTimeout(() => orch.answer(q.id, { decision: 'pause' }, 'ada'), 30);
    else setImmediate(() => orch.answer(q.id, q.kind === 'gate' ? { decision: 'continue' } : { answers: [] }));
  });
  orch.on('recovery-auto', (e) => auto.push(e));
  const res = await orch.run();
  assert.equal(res.status, 'paused'); assert.equal(res.reason, 'error');
  assert.deepEqual(auto, []);
}));

test('interactive + endpoint reachable: today\'s prompt, no note, no self-answer', withNetEnv(async () => {
  const dir = gitDir(); let seen = null;
  const orch = createOrchestrator({ projectDir: dir, prompt: 'demo', claude: { mock: true },
    networkClock: fakeNetClock(), networkProbe: async () => true,
    runners: { producer: async () => { throw NET_ERR(); }, verifier: okVerifier } });
  orch.on('question', (q) => {
    if (q.kind === 'recovery') { seen = q; setImmediate(() => orch.answer(q.id, { decision: 'pause' })); }
    else setImmediate(() => orch.answer(q.id, q.kind === 'gate' ? { decision: 'continue' } : { answers: [] }));
  });
  const res = await orch.run();
  assert.equal(res.status, 'paused');
  assert.equal(seen.recovery.network, undefined);
}));

// ── S3: a swallowed zero-exit is_error result rerouted through _recover (end-to-end, REAL engine) ──
// An injected stub runner sits ABOVE claude.mjs and cannot exercise an engine-level swallow (the
// existing throw→recover tests above already cover a thrown producer). The reroute must run through
// the REAL engine: no injected producer, so the agent node falls through runExecution →
// runAgentExecution → spawnAgent → runClaude, whose runOpts now carries rejectOnErrorResult:true.
// The fake bin travels via claude:{bin} (the plan's blessed path): the orchestrator threads
// this.claude.bin → claudeOpts.bin → runOpts' bin:c.bin for the agent spawn AND → _helperSpawn()'s
// bin for the fire-and-forget title call, so NO spawn reaches the real `claude` (the suite's
// real-claude guard, server-mock-mode.test.mjs). Because mockEnabled also reads ambient
// WORCA_MOCK/ORCH_MOCK, each case clears and restores them.

const S3_POSIX_SHIM = { skip: process.platform === 'win32' ? 'fake claude shim is a POSIX shell script' : false };
async function fakeBin(dir, { stdout = '', stderr = '', code = 0 } = {}) {
  const path = join(dir, 'fake-claude.sh');
  const lines = ['#!/bin/sh'];
  for (const l of stdout.split('\n').filter(Boolean)) lines.push(`printf '%s\\n' ${JSON.stringify(l)}`);
  if (stderr) lines.push(`printf '%s\\n' ${JSON.stringify(stderr)} 1>&2`);
  lines.push(`exit ${code}`);
  await writeFile(path, lines.join('\n') + '\n', 'utf8');
  await chmod(path, 0o755);
  return path;
}
// Clear WORCA_MOCK/ORCH_MOCK so the real engine runs (mockEnabled honours ambient env), restore after.
function withMockOff(fn) {
  const prevMock = process.env.WORCA_MOCK, prevOrch = process.env.ORCH_MOCK;
  delete process.env.WORCA_MOCK; delete process.env.ORCH_MOCK;
  const restore = () => {
    if (prevMock === undefined) delete process.env.WORCA_MOCK; else process.env.WORCA_MOCK = prevMock;
    if (prevOrch === undefined) delete process.env.ORCH_MOCK; else process.env.ORCH_MOCK = prevOrch;
  };
  return Promise.resolve().then(fn).finally(restore);
}

// Unit: the node-runner options funnel opts in; no other caller does.
test('S3: runOpts sets rejectOnErrorResult on the node path', () => {
  const ctx = { claudeOpts: { bin: 'claude' } };
  const o = runOpts(ctx, { role: 'producer', prompt: 'p', systemPrompt: 's', allowedTools: [] });
  assert.equal(o.rejectOnErrorResult, true);
});

// S3: a REAL-engine zero-exit is_error result used to resolve, so the node finished and the run ended
// 'done'. It must now throw and take _recover → pause. Unclassified detail → node '*' → pause(REASON.ERROR).
test('S3: a real-engine zero-exit is_error result takes the _recover path and pauses (never done)', S3_POSIX_SHIM, async () => {
  await withMockOff(async () => {
    const dir = gitDir();
    const bin = await fakeBin(dir, {
      code: 0,
      stdout:
        '{"type":"system","subtype":"init","session_id":"s1"}\n' +
        '{"type":"result","is_error":true,"result":"hit the turn limit"}', // classifyError → null → '*' → pause(ERROR)
    });
    const recovered = [];
    const orch = createOrchestrator({ projectDir: dir, prompt: 'demo', auto: true, claude: { bin, mock: false }, runners: { verifier: okVerifier } });
    const realRecover = orch._recover.bind(orch);
    orch._recover = async (a) => { recovered.push(a.cls); return realRecover(a); };
    const res = await orch.run();
    assert.equal(res.status, 'paused', 'the swallowed failure now parks the run, not done');
    assert.ok(recovered.length >= 1, 'the node went through _recover (recovery path taken)');
    const saved = readPipelineForResume(orch.state.id);
    assert.equal(saved.row.status, 'paused');
    assert.equal(saved.resumePoint.pauseReason, 'error');
    assert.match(saved.resumePoint.pauseDetail, /reported an error result/); // ux-1-2: the surfaced why
  });
});

// Regression: a clean real-engine result is unaffected — the node finishes and the run ends 'done'.
test('S3: a clean real-engine result finishes done (no reroute)', S3_POSIX_SHIM, async () => {
  await withMockOff(async () => {
    const dir = gitDir();
    const bin = await fakeBin(dir, {
      code: 0,
      stdout: '{"type":"system","subtype":"init","session_id":"s1"}\n{"type":"result","result":"ok"}',
    });
    let recoverCalls = 0;
    const orch = createOrchestrator({ projectDir: dir, prompt: 'demo', auto: true, claude: { bin, mock: false }, runners: { verifier: okVerifier } });
    const realRecover = orch._recover.bind(orch);
    orch._recover = async (a) => { recoverCalls++; return realRecover(a); };
    const res = await orch.run();
    assert.equal(res.status, 'done');
    assert.equal(recoverCalls, 0, 'no failure → recovery path never entered');
  });
});

// S3 (QA R-qa-6, the accepted paid-work risk): a rerouted rate_limit (429) on an AUTO run takes the
// bounded retry(RECOVERY_MAX_AUTO_ATTEMPTS) then pauses RECOVERABLE. _backoff is stubbed to a no-op so
// the retry delay does not slow the test (the delay is existing, unchanged machinery, run-harness.mjs:5630).
test('S3: a real-engine 429 is_error result retries to the budget then pauses recoverable (auto)', S3_POSIX_SHIM, async () => {
  await withMockOff(async () => {
    const dir = gitDir();
    const bin = await fakeBin(dir, {
      code: 0,
      stdout:
        '{"type":"system","subtype":"init","session_id":"s1"}\n' +
        '{"type":"result","is_error":true,"result":"API Error: Request rejected (429) · overloaded"}',
    });
    const recovered = [];
    const orch = createOrchestrator({ projectDir: dir, prompt: 'demo', auto: true, claude: { bin, mock: false }, runners: { verifier: okVerifier } });
    orch._backoff = async () => {};   // neutralise the retry delay (timing is unchanged machinery)
    const realRecover = orch._recover.bind(orch);
    orch._recover = async (a) => { recovered.push(a.cls); return realRecover(a); };
    const res = await orch.run();
    assert.equal(res.status, 'paused');
    const saved = readPipelineForResume(orch.state.id);
    assert.equal(saved.resumePoint.pauseReason, 'recoverable', 'a spent retry budget pauses RECOVERABLE');
    assert.ok(
      recovered.filter((c) => c === 'rate_limit').length >= RECOVERY_MAX_AUTO_ATTEMPTS,
      'the 429 retried up to the budget before pausing',
    );
  });
});

// S3 (UX R-ux-3): an INTERACTIVE (auto:false) rerouted CLASSIFIED failure reaches the recovery prompt,
// not a 'done' card. auth interactive cell = prompt(pause(REASON.ERROR)); '*' would NOT prompt (see note).
// _promptRecovery must return a real resolveFailure verdict ({outcome, reason}), NOT {action:...} (qa-1-1).
test('S3: an interactive real-engine auth is_error result reaches the recovery prompt then pauses (never done)', S3_POSIX_SHIM, async () => {
  await withMockOff(async () => {
    const dir = gitDir();
    const bin = await fakeBin(dir, {
      code: 0,
      stdout:
        '{"type":"system","subtype":"init","session_id":"s1"}\n' +
        '{"type":"result","is_error":true,"result":"Not logged in · Please run /login"}', // → auth → prompt
    });
    let prompted = 0;
    const orch = createOrchestrator({ projectDir: dir, prompt: 'demo', auto: false, claude: { bin, mock: false }, runners: { verifier: okVerifier } });
    // The real _promptRecovery returns resolveFailure(...)'s verdict; the give-up answer resolves to
    // pause(REASON.ERROR). _runNodeAttempts reads verdict.outcome/verdict.reason, so the stub must too.
    orch._promptRecovery = async () => { prompted++; return { outcome: 'pause', reason: 'error' }; };
    const res = await orch.run();
    assert.ok(prompted >= 1, 'the interactive recovery prompt was reached, not a done finish');
    assert.equal(res.status, 'paused', 'an interactive give-up pauses (REASON.ERROR), it does not finish done');
  });
});
