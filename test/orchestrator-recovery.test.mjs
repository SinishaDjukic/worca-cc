// test/orchestrator-recovery.test.mjs — recoverable-error retry gate.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir, hostname } from 'node:os';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { useTempHome } from './helpers/temp-home.mjs';
import { createOrchestrator } from '../src/core/orchestrator.mjs';
import { readPipelineForResume, reconcileStaleRunning } from '../src/core/artifacts.mjs';
import { getDb } from '../src/core/db.mjs';

useTempHome(after);
process.env.WORCA_RECOVERY_BACKOFF_MS = '0'; // no real waiting in tests

function gitDir() {
  const dir = mkdtempSync(join(tmpdir(), 'worca-cc-recovery-'));
  execSync('git init -q && git -c user.email=t@t -c user.name=t commit -q --allow-empty -m init', { cwd: dir });
  return dir;
}

const AUTH_ERR = () => new Error('claude exited with code 1: Failed to authenticate. API Error: 401 Invalid authentication credentials');
const NET_ERR = () => new Error('request to https://api.anthropic.com failed, reason: ECONNRESET');
const LIMIT_ERR = () => new Error("claude exited with code 1: You've hit your session limit · resets 6pm (Europe/Sofia)");
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

test('interactive: recoverable error -> Abort fails the run as today', async () => {
  const dir = gitDir();
  let orch;
  orch = createOrchestrator({
    projectDir: dir, prompt: 'demo', auto: false, claude: { mock: true },
    runners: { producer: authOnceProducer(), verifier: okVerifier },
  });
  orch.on('question', answerWith(() => orch, 'abort'));
  const res = await orch.run();
  assert.equal(res.status, 'error');
});

test('auto: bounded retry then fail when the error never clears', async () => {
  const dir = gitDir();
  let calls = 0;
  const alwaysAuth = async () => { calls++; throw AUTH_ERR(); };
  const orch = createOrchestrator({
    projectDir: dir, prompt: 'demo', auto: true, claude: { mock: true },
    runners: { producer: alwaysAuth, verifier: okVerifier },
  });
  const res = await orch.run();
  assert.equal(res.status, 'error');
  // First producer node: 1 initial + RECOVERY_MAX_AUTO_ATTEMPTS retries = 4 calls.
  assert.equal(calls, 4);
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
  assert.match(res.reason || '', /session limit/i);
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
  assert.equal(a, 'retry');
  assert.equal(b, 'retry');
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
    await new Promise((r) => { const t = setTimeout(r, 5); t.unref?.(); });
    open--;
    return { decision: 'retry' };
  };
  const [a, b] = await Promise.all([
    orch._recover({ node: { key: 'n1', nodeId: 'a' }, cls: 'auth', err: AUTH_ERR(), attempt: 1 }),
    orch._recover({ node: { key: 'n2', nodeId: 'b' }, cls: 'network', err: NET_ERR(), attempt: 1 }),
  ]);
  assert.equal(a, 'retry');
  assert.equal(b, 'retry');
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
  // synthetic boundary point at step 0 (re-run from step 0 is safe for a mock runner).
  const point = {
    version: 1, kind: 'boundary', stepIndex: 0, stepCycle: [], loopState: {},
    bus: null, stepModels: null, workflowId: 'wf_default', plan: null,
    nodes: [], gate: null, toolInstruction: '', pipelineDir: pDir,
    pausedAt: new Date().toISOString(),
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
  assert.equal(after.resumePoint.kind, 'boundary');

  // Resume (requires Feature 6 widening to accept 'interrupted').
  const orch2 = createOrchestrator({
    projectDir: dir, prompt: 'demo', auto: true, claude: { mock: true },
    runners: { producer: okVerifierF5, verifier: okVerifierF5 },
    resume: after,
  });
  const res2 = await orch2.resume();
  assert.equal(res2.status, 'done');
});
