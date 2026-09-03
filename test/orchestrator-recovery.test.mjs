// test/orchestrator-recovery.test.mjs — recoverable-error retry gate.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir, hostname } from 'node:os';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { useTempHome } from './helpers/temp-home.mjs';
import { createOrchestrator } from '../src/core/orchestrator.mjs';
import { readPipelineForResume, reconcileStaleRunning } from '../src/core/artifacts.mjs';
import { writeGraphWorkflow } from '../src/core/workflows.mjs';
import { getDb } from '../src/core/db.mjs';

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

test('auto: auth error pauses immediately — a 7s backoff cannot re-login', async () => {
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
});

test('auto: quota error pauses immediately — retrying cannot top up the balance', async () => {
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

test('done row has NULL resume_point (incremental writes cleared by done arm)', async () => {
  const dir = gitDir();
  const orch = createOrchestrator({
    projectDir: dir, prompt: 'demo', auto: true, claude: { mock: true },
    runners: { producer: okVerifierF5, verifier: okVerifierF5 },
  });
  const res = await orch.run();
  assert.equal(res.status, 'done');
  const saved = readPipelineForResume(orch.state.id);
  assert.equal(saved.resumePoint, null, 'done row must have NULL resume_point');
});

test('crash -> reconcile -> resume continues from saved boundary to done', async () => {
  const dir = gitDir();
  const orch = createOrchestrator({
    projectDir: dir, prompt: 'demo', auto: true, claude: { mock: true },
    runners: { producer: okVerifierF5, verifier: okVerifierF5 },
  });
  const res = await orch.run();
  assert.equal(res.status, 'done');
  const id = orch.state.id;
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
});
