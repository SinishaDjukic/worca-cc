// test/model-switch-resume.test.mjs
// A run paused on its planner is switched to another model while paused; the resume spawns the
// planner on the new model/effort/sub-agent policy and does NOT re-attach the old session.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { useTempHome } from './helpers/temp-home.mjs';
import { gitDir } from './helpers/git-dir.mjs';
import { createOrchestrator } from '../src/core/orchestrator.mjs';
import { readPipelineForResume } from '../src/core/artifacts.mjs';
import { switchPausedRunModels } from '../src/core/model-switch.mjs';

useTempHome(after);

function outsOf(ctx) {
  const o = {};
  for (const p of ctx.ports.outputs || []) o[p.id] = { path: ctx.outputs?.[p.id]?.path ?? null, type: p.type };
  return o;
}

function recording(getOrch, seen) {
  const note = (ctx) => seen.spawns.push({
    nodeId: ctx.nodeId, executionId: ctx.executionId, model: ctx.claudeOpts?.model ?? null,
    effort: ctx.claudeOpts?.effort ?? null, resume: ctx.resumeSessionId || null,
    subagentModel: ctx.node?.subagentModel || '', subagentEffort: ctx.node?.subagentEffort || '',
  });
  const done = (ctx, verdict) => ({ outputs: outsOf(ctx), verdict, summary: '' });
  return {
    clarifier: async (ctx) => { note(ctx); return done(ctx, null); },
    verifier: async (ctx) => { note(ctx); return done(ctx, { issues: [], summary: '' }); },
    producer: async (ctx) => {
      note(ctx);
      ctx.onEvent({ type: 'session', sessionId: `sess-${ctx.executionId}` });
      if (seen.paused) return done(ctx, null);
      seen.paused = true;
      queueMicrotask(() => getOrch().pause());
      return new Promise((_r, rej) => {
        const onAbort = () => { const e = new Error('aborted'); e.name = 'AbortError'; rej(e); };
        if (ctx.signal.aborted) onAbort(); else ctx.signal.addEventListener('abort', onAbort, { once: true });
      });
    },
  };
}

async function pausedOnPlanner(name) {
  const dir = gitDir(name);
  const seen = { spawns: [] };
  let orch;
  orch = createOrchestrator({ projectDir: dir, workflowId: 'wf_default', prompt: 'demo', auto: true,
    claude: { mock: true }, runners: recording(() => orch, seen) });
  const first = await orch.run();
  assert.equal(first.status, 'paused', first.error);
  const id = orch.getState().id;
  const pausedSpawn = seen.spawns.at(-1);
  return { dir, id, pausedSpawn };
}

async function resume(dir, id) {
  const seen = { spawns: [], paused: true };
  let orch;
  orch = createOrchestrator({ projectDir: dir, workflowId: 'wf_default', auto: true, claude: { mock: true },
    resume: readPipelineForResume(id), runners: recording(() => orch, seen) });
  const res = await orch.resume();
  assert.equal(res.status, 'done', res.error);
  return seen.spawns;
}

test('a model switch while paused: new model, effort and sub-agent policy, fresh session', { timeout: 120000 }, async () => {
  const { dir, id, pausedSpawn } = await pausedOnPlanner('msw-resume');
  await switchPausedRunModels(id, {
    changes: { [pausedSpawn.nodeId]: { model: 'claude-opus-5-5', effort: 'high', subagentModel: 'opus', subagentEffort: 'medium' } },
    projectDirFor: () => dir,
  });
  const spawns = await resume(dir, id);
  const again = spawns.find((s) => s.executionId === pausedSpawn.executionId);
  assert.ok(again, 'the paused execution re-ran');
  assert.equal(again.resume, null, 'no --resume of the old session');
  assert.deepEqual([again.model, again.effort, again.subagentModel, again.subagentEffort], ['claude-opus-5-5', 'high', 'opus', 'medium']);
});

test('without a model change the paused session is still re-attached (regression guard)', { timeout: 120000 }, async () => {
  const { dir, id, pausedSpawn } = await pausedOnPlanner('msw-keep');
  await switchPausedRunModels(id, { changes: { [pausedSpawn.nodeId]: { subagentEffort: 'high' } }, projectDirFor: () => dir });
  const spawns = await resume(dir, id);
  const again = spawns.find((s) => s.executionId === pausedSpawn.executionId);
  assert.equal(again.resume, `sess-${pausedSpawn.executionId}`);
  assert.equal(again.subagentEffort, 'high');
});
