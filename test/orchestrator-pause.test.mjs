// test/orchestrator-pause.test.mjs
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { useTempHome } from './helpers/temp-home.mjs';
import { ENGINES } from './helpers/engines.mjs';
import { getDb } from '../src/core/db.mjs';

useTempHome(after);

function gitDir() {
  const dir = mkdtempSync(join(tmpdir(), 'worca-cc-pause-'));
  execSync('git init -q && git -c user.email=t@t -c user.name=t commit -q --allow-empty -m init', { cwd: dir });
  return dir;
}

/** Runner that emits a session id, requests pause (deterministically, from inside
 *  the in-flight node), then hangs until the pause-abort lands as AbortError. */
function pausingProducer(getOrch) {
  return async (ctx) => {
    ctx.onEvent({ type: 'session', sessionId: 'sess-hang' });
    // Spawn a (synthetic) sub-agent so the pause path's force-close is exercised:
    // pause SIGTERMs in-flight children, so the record must close as 'stopped'.
    ctx.onEvent({ raw: { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'tu_pause', name: 'Task', input: { description: 'hung child' } }] } } });
    queueMicrotask(() => getOrch().pause());
    return new Promise((_res, rej) => {
      const onAbort = () => { const e = new Error('aborted'); e.name = 'AbortError'; rej(e); };
      if (ctx.signal.aborted) onAbort();
      else ctx.signal.addEventListener('abort', onAbort, { once: true });
    });
  };
}

const okVerifier = async () => ({ status: 'ok', issues: [], review: { issues: [] }, summary: '' });

for (const engine of ENGINES) {
test(`[${engine.id}] pause mid-node -> paused status, resume_point persisted, worktree kept`, async () => {
  const dir = gitDir();
  let orch;
  orch = engine.create({
    projectDir: dir, prompt: 'demo', auto: true, claude: { mock: true },
    runners: { producer: pausingProducer(() => orch), verifier: okVerifier },
  });
  const res = await orch.run();
  assert.equal(res.status, 'paused');
  assert.equal(orch.state.status, 'paused');

  const row = getDb().prepare('SELECT status, resume_point, branch FROM pipelines WHERE id = ?').get(orch.state.id);
  assert.equal(row.status, 'paused');
  const rp = JSON.parse(row.resume_point);
  engine.expectResumePoint(rp, { sessionId: 'sess-hang' });
  assert.equal(rp.workflowId, engine.workflowId);
  // The EFFECTIVE tool instruction (post graph-build, possibly '' when the build was
  // skipped/failed) must ride the resume point — resume() must not fall back to the
  // detect-time tools.instruction and tell agents a graph exists that was never built.
  assert.equal(typeof rp.toolInstruction, 'string', 'effective toolInstruction persisted on the resume point');

  // Worktree must SURVIVE a pause (uncommitted work lives there).
  const wt = JSON.parse(row.branch || '{}').worktreeDir;
  assert.ok(wt && existsSync(wt), 'worktree dir kept while paused');

  // Pause kills in-flight children: the spawned sub-agent record must not stay
  // 'running' for the whole paused period — the paused endMark force-closes it.
  const sa = orch.state.subAgents.find((s) => s.id === 'tu_pause');
  assert.equal(sa?.status, 'stopped', 'sub-agent record closed as stopped on pause');
  const saRow = getDb().prepare('SELECT status FROM sub_agents WHERE pipeline_id = ? AND id = ?').get(orch.state.id, 'tu_pause');
  assert.equal(saRow?.status, 'stopped', 'sub_agents row closed as stopped on pause');
});

test(`[${engine.id}] pause is a no-op unless running; double pause safe`, () => {
  const dir = gitDir();
  const orch = engine.create({ projectDir: dir, prompt: 'x', auto: true, claude: { mock: true } });
  assert.equal(orch.pause(), false); // idle
  orch.state.status = 'running';
  assert.equal(orch.pause(), true);  // -> pausing
  assert.equal(orch.pause(), false); // already pausing
});

test(`[${engine.id}] stop still wins: stopped run is not paused`, async () => {
  const dir = gitDir();
  const hangingProducer = async (ctx) => new Promise((_res, rej) => {
    const onAbort = () => { const e = new Error('aborted'); e.name = 'AbortError'; rej(e); };
    if (ctx.signal.aborted) onAbort();
    else ctx.signal.addEventListener('abort', onAbort, { once: true });
  });
  let orch;
  orch = engine.create({
    projectDir: dir, prompt: 'demo', auto: true, claude: { mock: true },
    runners: {
      producer: async (ctx) => { queueMicrotask(() => orch.stop()); return hangingProducer(ctx); },
      verifier: okVerifier,
    },
  });
  const res = await orch.run();
  assert.equal(res.status, 'stopped');
});

test(`[${engine.id}] stop while pausing: stop wins and no resume_point is persisted`, async () => {
  const dir = gitDir();
  let orch;
  let pausedFirst = false;
  orch = engine.create({
    projectDir: dir, prompt: 'demo', auto: true, claude: { mock: true },
    runners: {
      producer: async (ctx) => {
        // Deterministic interleave: pause() flips status to 'pausing' synchronously,
        // then stop() lands on the pausing run — within the same microtask.
        queueMicrotask(() => {
          pausedFirst = orch.pause() === true && orch.state.status === 'pausing';
          orch.stop();
        });
        return new Promise((_res, rej) => {
          const onAbort = () => { const e = new Error('aborted'); e.name = 'AbortError'; rej(e); };
          if (ctx.signal.aborted) onAbort();
          else ctx.signal.addEventListener('abort', onAbort, { once: true });
        });
      },
      verifier: okVerifier,
    },
  });
  const res = await orch.run();
  assert.equal(pausedFirst, true, 'pause flipped status to pausing before stop landed');
  assert.equal(res.status, 'stopped');
  assert.equal(orch.state.status, 'stopped');

  // Stopped runs are not resumable: the worktree is torn down, so a leftover
  // resume_point (assigned by _dispatch before stop won) must never be persisted.
  const row = getDb().prepare('SELECT status, resume_point FROM pipelines WHERE id = ?').get(orch.state.id);
  assert.equal(row.status, 'stopped');
  assert.equal(row.resume_point, null, 'stopped row carries no resume point');
});
}
