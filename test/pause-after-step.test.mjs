// test/pause-after-step.test.mjs — Stillhet's Pause after this step (plans/rail/task-engine-additions.md): the
// in-memory flag lets every running step finish (a fan-out's siblings too, never aborted), starts nothing new, then
// pauses once. The flag never persists; pause, stop and finish drop it.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { gitDir } from './helpers/git-dir.mjs';
import { createOrchestrator } from '../src/core/orchestrator.mjs';
import { writeGraphWorkflow } from '../src/core/workflows.mjs';
import { readPipelineForResume } from '../src/core/artifacts.mjs';

useTempHome(after);

async function outsOf(ctx) {
  const outputs = {};
  for (const p of ctx.ports?.outputs || []) {
    const path = ctx.outputs?.[p.id]?.path ?? null;
    if (path && p.type !== 'void') { await mkdir(dirname(path), { recursive: true }); await writeFile(path, `# ${p.id}\n`, 'utf8'); }
    outputs[p.id] = { path, type: p.type };
  }
  return outputs;
}
const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));
const FANOUT = {
  id: 'wf_pause_fanout', name: 'Pause fan-out', domain: 'coding',
  nodes: [
    { id: 'n_task', kind: 'task', x: 40, y: 200, config: {} },
    { id: 'n_plan', kind: 'agent', key: 'planner', x: 340, y: 200, config: {} },
    { id: 'n_impl', kind: 'agent', key: 'implementer', x: 640, y: 200, config: {} },
    { id: 'n_rev1', kind: 'agent', key: 'reviewer', x: 940, y: 100, config: {} },
    { id: 'n_rev2', kind: 'agent', key: 'reviewer', x: 940, y: 320, config: {} },
    { id: 'n_end', kind: 'end', x: 1240, y: 200, config: {} },
  ],
  wires: [
    { id: 'w1', from: { node: 'n_task', port: 'task' }, to: { node: 'n_plan', port: 'task' } },
    { id: 'w2', from: { node: 'n_plan', port: 'plan' }, to: { node: 'n_impl', port: 'plan' } },
    { id: 'w3', from: { node: 'n_plan', port: 'plan' }, to: { node: 'n_rev1', port: 'plan' } },
    { id: 'w4', from: { node: 'n_plan', port: 'plan' }, to: { node: 'n_rev2', port: 'plan' } },
    { id: 'w5', from: { node: 'n_impl', port: 'done' }, to: { node: 'n_rev1', port: 'done' } },
    { id: 'w6', from: { node: 'n_impl', port: 'done' }, to: { node: 'n_rev2', port: 'done' } },
    { id: 'w7', from: { node: 'n_rev1', port: 'pass' }, to: { node: 'n_end', port: 'result' } },
  ],
};

test('the running step finishes, the next one never starts, the run pauses once; a second request is refused; a resume runs on without the flag', { timeout: 120000 }, async () => {
  await writeGraphWorkflow(FANOUT);
  const started = []; const frames = [];
  let orch, second;
  orch = createOrchestrator({
    projectDir: gitDir('pafter'), workflowId: 'wf_pause_fanout', prompt: 'demo', claude: { mock: true }, auto: true,
    runners: {
      producer: async (ctx) => {
        started.push(ctx.node.id);
        if (ctx.node.id === 'n_plan') {
          assert.equal(orch.pauseAfterStep('me'), true);
          second = orch.pauseAfterStep('me');
          await tick();
          assert.equal(ctx.signal.aborted, false, 'the running step is never aborted');
        }
        return { outputs: await outsOf(ctx), verdict: null, summary: 'ok' };
      },
      verifier: async (ctx) => { started.push(ctx.node.id); return { outputs: await outsOf(ctx), verdict: { issues: [], summary: '' } }; },
    },
  });
  orch.on('state', (s) => frames.push(s.pauseAfterStep === true));
  const res = await orch.run();
  assert.equal(second, 'already', 'the route answers 409 ALREADY_PAUSING');
  assert.equal(res.status, 'paused');
  assert.deepEqual(started, ['n_plan'], 'the next node never started');
  const plan = orch.getState().steps.find((s) => s.nodeId === 'n_plan');
  assert.equal(plan.status, 'done', 'the step ran to its end');
  assert.ok(frames.includes(true), 'a state frame carried pauseAfterStep');
  assert.equal(orch.getState().pauseAfterStep, undefined, 'the pause dropped the flag');

  const resumed = createOrchestrator({ projectDir: orch.projectDir, workflowId: 'wf_pause_fanout', claude: { mock: true }, auto: true,
    resume: readPipelineForResume(orch.state.id),
    runners: {
      producer: async (ctx) => { started.push(ctx.node.id); return { outputs: await outsOf(ctx), verdict: null, summary: 'ok' }; },
      verifier: async (ctx) => { started.push(ctx.node.id); return { outputs: await outsOf(ctx), verdict: { issues: [], summary: '' } }; },
    } });
  assert.equal(resumed.getState().pauseAfterStep, undefined, 'never persisted');
  const out = await resumed.resume();
  assert.equal(out.status, 'done', out.error);
  assert.ok(started.includes('n_impl'), 'the resume ran the next node');
  assert.equal(started.filter((id) => id === 'n_plan').length, 1, 'the finished step never runs again on resume');
});

test('a fan-out: the request lands while both siblings run; the faster finishes, the slower finishes done (not aborted), then one pause', { timeout: 120000 }, async () => {
  await writeGraphWorkflow(FANOUT);
  const signals = {}; let pauses = 0; let orch;
  orch = createOrchestrator({
    projectDir: gitDir('pfan'), workflowId: 'wf_pause_fanout', prompt: 'demo', claude: { mock: true }, auto: true,
    runners: {
      producer: async (ctx) => ({ outputs: await outsOf(ctx), verdict: null, summary: 'ok' }),
      verifier: async (ctx) => {
        signals[ctx.node.id] = ctx.signal;
        if (ctx.node.id === 'n_rev1') {
          for (let i = 0; i < 100 && !signals.n_rev2; i++) await tick(5);   // both siblings in flight
          assert.equal(orch.pauseAfterStep('me'), true);
          return { outputs: await outsOf(ctx), verdict: { issues: [], summary: '' } };
        }
        await tick(150);                                                     // the slower sibling
        signals.rev2AbortedAtEnd = ctx.signal.aborted;
        return { outputs: await outsOf(ctx), verdict: { issues: [], summary: '' } };
      },
    },
  });
  const pause = orch.pause.bind(orch);
  orch.pause = (by) => { pauses++; return pause(by); };
  const res = await orch.run();
  const steps = orch.getState().steps;
  assert.deepEqual(['n_rev1', 'n_rev2'].map((id) => steps.find((s) => s.nodeId === id)?.status), ['done', 'done']);
  assert.equal(signals.rev2AbortedAtEnd, false, 'the slower sibling was never aborted while it ran');
  assert.equal(pauses, 1, 'one pause');
  assert.equal(res.status, 'paused', res.error);
  const again = [];
  const resumed = createOrchestrator({ projectDir: orch.projectDir, workflowId: 'wf_pause_fanout', claude: { mock: true }, auto: true,
    resume: readPipelineForResume(orch.state.id),
    runners: {
      producer: async (ctx) => { again.push(ctx.node.id); return { outputs: await outsOf(ctx), verdict: null, summary: 'ok' }; },
      verifier: async (ctx) => { again.push(ctx.node.id); return { outputs: await outsOf(ctx), verdict: { issues: [], summary: '' } }; },
    } });
  const out = await resumed.resume();
  assert.equal(out.status, 'done', out.error);
  assert.deepEqual(again, [], 'neither finished sibling runs again on resume');
});

test('stop with the flag set clears it and the state frame drops pauseAfterStep; not running answers false', async () => {
  const orch = createOrchestrator({ projectDir: gitDir('pstop'), prompt: 'x', claude: { mock: true }, auto: true });
  assert.equal(orch.pauseAfterStep('me'), false, 'idle: dev\'s CANNOT_PAUSE');
  orch.state.status = 'running';
  orch._inFlight = 1;                                     // a step in flight: the flag waits
  assert.equal(orch.pauseAfterStep('me'), true);
  assert.equal(orch.getState().pauseAfterStep, true);
  const frames = [];
  orch.on('state', (s) => frames.push(s));
  orch.stop('me');
  assert.equal(orch.getState().pauseAfterStep, undefined);
  assert.equal('pauseAfterStep' in frames.at(-1), false, 'the stopped frame drops it');
  assert.equal(orch.pauseRequested, false, 'a stop never became a pause');
});

test('a fan-out phase with more slices than agent slots: a slice waiting at the boundary when the last one leaves still reaches paused (no snapshot comes for a slice)', async () => {
  const orch = createOrchestrator({ projectDir: gitDir('pslots'), prompt: 'x', claude: { mock: true }, auto: true });
  orch.state.status = 'running';
  let pauses = 0;
  orch.pause = () => { pauses++; orch.pauseRequested = true; return true; };
  await orch._awaitStepBoundary();                        // slice 1 holds slot 1
  await orch._awaitStepBoundary();                        // slice 2 holds slot 2
  assert.equal(orch.pauseAfterStep('me'), true);
  orch._leaveStep();                                      // slice 1 done; slice 3 takes its slot and waits at the boundary
  let third = false;
  const waiting = orch._awaitStepBoundary().then(() => { third = true; });
  await new Promise((r) => setImmediate(r));
  assert.equal(third, false, 'slice 3 does not start while slice 2 runs');
  orch._leaveStep();                                      // slice 2 done: nothing in flight, no scheduler snapshot follows
  await Promise.race([waiting, new Promise((r) => setTimeout(r, 500))]);
  assert.equal(third, true, 'the waiting slice is released instead of hanging the phase');
  assert.equal(pauses, 1, 'the pending pause converted once');
  assert.equal(orch.getState().pauseAfterStep, undefined);
});
