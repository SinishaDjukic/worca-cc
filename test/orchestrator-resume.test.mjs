// test/orchestrator-resume.test.mjs
// Full cycle: run -> pause mid-execution -> NEW orchestrator instance (restart
// simulation) -> resume() -> done. The interrupted EXECUTION must receive
// resumeSessionId.
//
// This drives the graph engine through its ONE injection seam: `opts.runners`,
// keyed by runnerType (never by an agent key). The end-to-end mock variant of the
// same cycle lives in orchestrator-graph.test.mjs; this one exists to pin the
// executor ABI (ctx.executionId / ctx.signal / ctx.resumeSessionId) and the
// resume-v2 point's shape.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { useTempHome } from './helpers/temp-home.mjs';
import { createOrchestrator } from '../src/core/orchestrator.mjs';
import { readPipelineForResume } from '../src/core/artifacts.mjs';

useTempHome(after);

function gitDir() {
  const dir = mkdtempSync(join(tmpdir(), 'worca-cc-resume-'));
  execSync('git init -q && git -c user.email=t@t -c user.name=t commit -q --allow-empty -m init', { cwd: dir });
  return dir;
}

test('pause -> rehydrate fresh instance -> resume -> done, with session re-attach', async () => {
  const dir = gitDir();
  const seen = [];
  let hangOnce = true;
  let orchRef = null;
  // Executors are selected by runnerType; the injected pair covers every agent in
  // wf_default (clarify is a clarifier, so it takes the built-in executor).
  const mkRunners = () => ({
    clarifier: async () => ({ outputs: {}, questions: [], answers: [] }),
    producer: async (ctx) => {
      ctx.onEvent({ type: 'session', sessionId: `sess-${ctx.executionId}` });
      if (hangOnce && ctx.node.key === 'implementer') {
        hangOnce = false;
        queueMicrotask(() => orchRef.pause());
        return new Promise((_r, rej) => {
          const onAbort = () => { const e = new Error('aborted'); e.name = 'AbortError'; rej(e); };
          if (ctx.signal.aborted) onAbort(); else ctx.signal.addEventListener('abort', onAbort, { once: true });
        });
      }
      seen.push({ executionId: ctx.executionId, resume: ctx.resumeSessionId || null });
      return { outputs: {}, summary: 'ok' };
    },
    // A clean verdict fires every `when: 'clean'` output, so the run converges to End.
    verifier: async (ctx) => {
      seen.push({ executionId: ctx.executionId, resume: ctx.resumeSessionId || null });
      return { outputs: {}, verdict: { issues: [], summary: '' } };
    },
  });

  const orch1 = createOrchestrator({ projectDir: dir, prompt: 'demo', auto: true, claude: { mock: true }, runners: mkRunners() });
  orchRef = orch1;
  const r1 = await orch1.run();
  assert.equal(r1.status, 'paused');
  const pipelineId = orch1.state.id;

  // ── restart simulation: brand-new orchestrator built ONLY from the DB ──
  const saved = readPipelineForResume(pipelineId);
  assert.ok(saved, 'reader returns the paused pipeline');
  assert.equal(saved.row.status, 'paused');
  assert.equal(saved.resumePoint?.version, 2, 'the resume point is v2');
  assert.ok(saved.resumePoint.snapshot, 'it carries the scheduler snapshot');
  const interrupted = saved.steps.find((s) => s.status === 'paused');
  assert.ok(interrupted?.sessionId, 'the interrupted execution captured a session id');
  assert.equal(interrupted.executionId, interrupted.key, 'the executionId IS the step key');

  const orch2 = createOrchestrator({
    projectDir: dir, claude: { mock: true }, auto: true, runners: mkRunners(),
    resume: saved,
  });
  orchRef = orch2;
  const r2 = await orch2.resume();
  assert.equal(r2.status, 'done');

  // The interrupted execution re-ran WITH its captured session id.
  assert.ok(
    seen.some((s) => s.executionId === interrupted.key && s.resume === interrupted.sessionId),
    'interrupted execution received resumeSessionId',
  );

  // History row went back to a terminal done status under the SAME id.
  const afterRun = readPipelineForResume(pipelineId);
  assert.equal(afterRun.row.status, 'done');
  assert.equal(afterRun.row.resume_point, null, 'resume point cleared on completion');
});

test('resume() refuses a non-paused pipeline', async () => {
  const dir = gitDir();
  const orch = createOrchestrator({
    projectDir: dir, claude: { mock: true }, auto: true,
    resume: { row: { id: 'x', status: 'done' }, resumePoint: { version: 2 }, steps: [] },
  });
  await assert.rejects(() => orch.resume(), /not resumable/);
});
