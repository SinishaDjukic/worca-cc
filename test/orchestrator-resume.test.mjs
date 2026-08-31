// test/orchestrator-resume.test.mjs
// Full cycle: run -> pause mid-node -> NEW orchestrator instance (restart simulation)
// -> resume() -> done. The interrupted node must receive resumeSessionId.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { useTempHome } from './helpers/temp-home.mjs';
import { ENGINES } from './helpers/engines.mjs';
import { readPipelineForResume } from '../src/core/artifacts.mjs';

useTempHome(after);

function gitDir() {
  const dir = mkdtempSync(join(tmpdir(), 'worca-cc-resume-'));
  execSync('git init -q && git -c user.email=t@t -c user.name=t commit -q --allow-empty -m init', { cwd: dir });
  return dir;
}

for (const engine of ENGINES) {
test(`[${engine.id}] pause -> rehydrate fresh instance -> resume -> done, with session re-attach`, async () => {
  const dir = gitDir();
  const seen = [];
  let hangOnce = true;
  let orchRef = null;
  const mkRunners = () => ({
    producer: async (ctx) => {
      ctx.onEvent({ type: 'session', sessionId: `sess-${ctx.nodeId}` });
      if (hangOnce) {
        hangOnce = false;
        queueMicrotask(() => orchRef.pause());
        return new Promise((_r, rej) => {
          const onAbort = () => { const e = new Error('aborted'); e.name = 'AbortError'; rej(e); };
          if (ctx.signal.aborted) onAbort(); else ctx.signal.addEventListener('abort', onAbort, { once: true });
        });
      }
      seen.push({ nodeId: ctx.nodeId, resume: ctx.resumeSessionId || null });
      return { status: 'ok', summary: 'ok' };
    },
    verifier: async (ctx) => {
      seen.push({ nodeId: ctx.nodeId, resume: ctx.resumeSessionId || null });
      return { status: 'ok', issues: [], review: { issues: [] }, summary: '' };
    },
  });

  const orch1 = engine.create({ projectDir: dir, prompt: 'demo', auto: true, claude: { mock: true }, runners: mkRunners() });
  orchRef = orch1;
  const r1 = await orch1.run();
  assert.equal(r1.status, 'paused');
  const pipelineId = orch1.state.id;

  // ── restart simulation: brand-new orchestrator built ONLY from the DB ──
  const saved = readPipelineForResume(pipelineId);
  assert.ok(saved, 'reader returns the paused pipeline');
  assert.equal(saved.row.status, 'paused');
  assert.ok(saved.resumePoint, 'resume point parsed');
  assert.ok(saved.steps.some((s) => s.sessionId === 'sess-' + saved.resumePoint.nodes[0]?.nodeId
    || s.sessionId), 'reader surfaces per-step session ids');

  const orch2 = engine.create({
    projectDir: dir, claude: { mock: true }, auto: true, runners: mkRunners(),
    resume: saved,
  });
  orchRef = orch2;
  const r2 = await orch2.resume();
  assert.equal(r2.status, 'done');

  // The interrupted node re-ran WITH its captured session id.
  const interrupted = saved.resumePoint.nodes.find((n) => n.sessionId && !n.completed);
  assert.ok(interrupted, 'resume point recorded the interrupted node');
  assert.ok(seen.some((s) => s.nodeId === interrupted.nodeId && s.resume === interrupted.sessionId),
    'interrupted node received resumeSessionId');

  // History row went back to a terminal done status under the SAME id.
  const afterRun = readPipelineForResume(pipelineId);
  assert.equal(afterRun.row.status, 'done');
  assert.equal(afterRun.row.resume_point, null, 'resume point cleared on completion');
});

test(`[${engine.id}] resume() refuses a non-paused pipeline`, async () => {
  const dir = gitDir();
  const orch = engine.create({
    projectDir: dir, claude: { mock: true }, auto: true,
    resume: { row: { id: 'x', status: 'done' }, resumePoint: { version: 1 }, steps: [] },
  });
  await assert.rejects(() => orch.resume(), /not resumable/);
});
}
