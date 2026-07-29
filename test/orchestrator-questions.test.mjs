// test/orchestrator-questions.test.mjs
// Ask-then-resume loop (spec 2026-07-11 §5): dispatcher-level, offline, stubbed
// runners. Harness mirrors test/dispatcher.test.mjs `primed` (:63-74) but with
// auto:false, a registry for display names, and a REAL pipelines row (via
// seedPipeline) so step_questions FK writes land.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createOrchestrator } from '../src/core/orchestrator.mjs';
import { readStepQuestions } from '../src/core/artifacts.mjs';
import { useTempHome } from './helpers/temp-home.mjs';
import { seedPipeline } from './helpers/db-seed.mjs';

useTempHome(after);
const tmpDirs = [];
async function makeTmpDir() {
  const dir = await mkdtemp(join(tmpdir(), 'worca-cc-qorch-'));
  tmpDirs.push(dir);
  return dir;
}
after(async () => Promise.all(tmpDirs.map((d) => rm(d, { recursive: true, force: true }))));

async function primedInteractive(projectDir) {
  const orch = createOrchestrator({ projectDir, prompt: 'demo', auto: false, claude: { mock: true } });
  const { id } = await seedPipeline(projectDir);
  orch.pipeline = { id, dir: projectDir, promptText: 'demo' };
  orch.state.id = id;
  orch.state.pipelineDir = projectDir;
  orch.baseName = 'feature';
  orch.agentPrompts = {};
  orch.toolInstruction = '';
  orch.checkpointRef = null;
  orch.registry = { worker: { key: 'worker', displayName: 'Worker' } };
  orch._setStatus('running');
  return orch;
}

const QNODE = { nodeId: 'n1', key: 'worker', runnerType: 'producer', askQuestions: true };
const PLAN = (nodes) => ({ id: 'wf_q', name: 'Q', steps: [nodes], feedbacks: [] });

test('enabled node: ask -> answer -> resume same session -> done; rounds persisted', async () => {
  const dir = await makeTmpDir();
  const orch = await primedInteractive(dir);
  const calls = [];
  let qPath1 = null;
  orch._runners = {
    producer: async (ctx) => {
      calls.push({ resume: ctx.resumeSessionId || null, answered: (ctx.questionsAnswered || []).length });
      if (calls.length === 1) {
        qPath1 = ctx.questionsFile;
        // Simulate the agent reporting its session id (the way real runners do
        // via runClaude's session event) then writing round 1's questions.
        ctx.onEvent({ type: 'session', sessionId: 'sess-1' });
        await writeFile(ctx.questionsFile, JSON.stringify({
          questions: [{ id: 'q1', question: 'Which storage?', options: ['Redis', 'Postgres'] }],
        }), 'utf8');
      }
      return { status: 'ok', summary: 'x' };
    },
    verifier: async () => ({ status: 'ok', issues: [], review: { issues: [], summary: '' } }),
  };
  const events = [];
  orch.on('question', (q) => {
    events.push(q);
    setImmediate(() => orch.answer(q.id, { answers: [{ id: 'q1', choice: 'Postgres' }] }));
  });
  await orch._dispatch(PLAN([QNODE]));
  assert.equal(events.length, 1);
  assert.equal(events[0].kind, 'questions');
  assert.equal(events[0].agent, 'Worker');
  assert.equal(events[0].nodeId, 'n1');
  assert.equal(calls.length, 2, 'initial run + one resume');
  assert.equal(calls[1].resume, 'sess-1', 'resume reuses the captured session');
  assert.equal(calls[1].answered, 1, 'answers injected into the resume ctx');
  const rows = readStepQuestions(orch.pipeline.id);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].round, 1);
  assert.equal(rows[0].agentKey, 'worker');
  assert.equal(rows[0].nodeId, 'n1');
  assert.deepEqual(rows[0].answers, [{ id: 'q1', question: 'Which storage?', choice: 'Postgres' }]);
  assert.equal(existsSync(qPath1), false, 'answered round file is consumed');
});

test('round cap: asks at most 3 times, final resume has no questions file', async () => {
  const dir = await makeTmpDir();
  const orch = await primedInteractive(dir);
  const files = [];
  orch._runners = {
    producer: async (ctx) => {
      files.push(ctx.questionsFile || null);
      if (ctx.questionsFile) {
        await writeFile(ctx.questionsFile, JSON.stringify({
          questions: [{ id: 'q1', question: 'Round?', options: ['A', 'B'] }],
        }), 'utf8');
      }
      return { status: 'ok', summary: 'x' };
    },
    verifier: async () => ({ status: 'ok', issues: [], review: { issues: [], summary: '' } }),
  };
  let asks = 0;
  orch.on('question', (q) => { asks += 1; setImmediate(() => orch.answer(q.id, { answers: [] })); });
  await orch._dispatch(PLAN([QNODE]));
  assert.equal(asks, 3, 'capped at MAX_QUESTION_ROUNDS');
  assert.equal(files.length, 4, 'initial + 3 resumes');
  assert.equal(files[3], null, 'final resume carries no next-round file');
});

test('auto mode: directive suppressed, no question event, single run', async () => {
  const dir = await makeTmpDir();
  const orch = await primedInteractive(dir);
  orch.auto = true;
  let runs = 0;
  let sawEnabled = null;
  orch._runners = {
    producer: async (ctx) => { runs += 1; sawEnabled = !!ctx.questionsEnabled; return { status: 'ok', summary: 'x' }; },
    verifier: async () => ({ status: 'ok', issues: [], review: { issues: [], summary: '' } }),
  };
  let asks = 0;
  orch.on('question', () => { asks += 1; });
  await orch._dispatch(PLAN([QNODE]));
  assert.equal(runs, 1);
  assert.equal(asks, 0);
  assert.equal(sawEnabled, false);
});

test('malformed questions file: proceeds with no gate, single run', async () => {
  const dir = await makeTmpDir();
  const orch = await primedInteractive(dir);
  let runs = 0;
  orch._runners = {
    producer: async (ctx) => {
      runs += 1;
      if (runs === 1) await writeFile(ctx.questionsFile, 'not json at all', 'utf8');
      return { status: 'ok', summary: 'x' };
    },
    verifier: async () => ({ status: 'ok', issues: [], review: { issues: [], summary: '' } }),
  };
  let asks = 0;
  orch.on('question', () => { asks += 1; });
  await orch._dispatch(PLAN([QNODE]));
  assert.equal(asks, 0);
  assert.equal(runs, 1);
});

test('parallel group: both enabled nodes complete; asks serialize through one slot', async () => {
  const dir = await makeTmpDir();
  const orch = await primedInteractive(dir);
  orch.registry = {
    worker: { key: 'worker', displayName: 'Worker' },
    helper: { key: 'helper', displayName: 'Helper' },
  };
  const asked = new Set();
  orch._runners = {
    producer: async (ctx) => {
      if (ctx.questionsFile && !asked.has(ctx.node.nodeId)) {
        asked.add(ctx.node.nodeId);
        await writeFile(ctx.questionsFile, JSON.stringify({
          questions: [{ id: 'q1', question: `${ctx.node.key}?`, options: ['A', 'B'] }],
        }), 'utf8');
      }
      return { status: 'ok', summary: 'x' };
    },
    verifier: async () => ({ status: 'ok', issues: [], review: { issues: [], summary: '' } }),
  };
  const order = [];
  orch.on('question', (q) => {
    order.push(q.nodeId);
    setImmediate(() => orch.answer(q.id, { answers: [{ id: 'q1', choice: 'A' }] }));
  });
  await orch._dispatch(PLAN([
    { nodeId: 'pa', key: 'worker', runnerType: 'producer', askQuestions: true },
    { nodeId: 'pb', key: 'helper', runnerType: 'producer', askQuestions: true },
  ]));
  assert.deepEqual([...order].sort(), ['pa', 'pb'], 'both nodes gated once each');
  const st = orch.getState();
  assert.ok(st.steps.find((s) => s.nodeId === 'pa' && s.status === 'done'));
  assert.ok(st.steps.find((s) => s.nodeId === 'pb' && s.status === 'done'));
});

test('pause during a parallel question gate: the queued sibling ask never opens', async () => {
  const dir = await makeTmpDir();
  const orch = await primedInteractive(dir);
  orch.registry = {
    worker: { key: 'worker', displayName: 'Worker' },
    helper: { key: 'helper', displayName: 'Helper' },
  };
  const asked = new Set();
  orch._runners = {
    producer: async (ctx) => {
      if (ctx.questionsFile && !asked.has(ctx.node.nodeId)) {
        asked.add(ctx.node.nodeId);
        await writeFile(ctx.questionsFile, JSON.stringify({
          questions: [{ id: 'q1', question: `${ctx.node.key}?`, options: ['A', 'B'] }],
        }), 'utf8');
      }
      return { status: 'ok', summary: 'x' };
    },
    verifier: async () => ({ status: 'ok', issues: [], review: { issues: [], summary: '' } }),
  };
  // Deterministic scenario from the review finding: one node's prompt is OPEN and
  // the sibling's ask is QUEUED on _askTail when pause() lands. Spy on _enqueueAsk
  // so the pause fires only once both asks are in the tail.
  let bothQueued;
  const bothQueuedP = new Promise((resolve) => { bothQueued = resolve; });
  const origEnqueue = orch._enqueueAsk.bind(orch);
  let enqueues = 0;
  orch._enqueueAsk = (run) => { if ((enqueues += 1) === 2) bothQueued(); return origEnqueue(run); };
  const events = [];
  orch.on('question', (q) => {
    events.push(q);
    // Pause from inside the FIRST question handler — never answer anything — as
    // soon as the sibling's ask is queued behind this open prompt.
    bothQueuedP.then(() => setImmediate(() => orch.pause()));
  });
  const res = await orch._dispatch(PLAN([
    { nodeId: 'pa', key: 'worker', runnerType: 'producer', askQuestions: true },
    { nodeId: 'pb', key: 'helper', runnerType: 'producer', askQuestions: true },
  ]));
  assert.equal(res, 'paused', 'dispatch unwound as a pause');
  // Drain the queued sibling's unwind (pure microtasks once it was queued):
  // Promise.all rejects on the first paused node, so _dispatch can resolve while
  // the sibling's pauseErr is still propagating.
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(events.length, 1, 'exactly one question event: the queued gate never fired on the pausing run');
  const st = orch.getState();
  assert.equal(st.steps.find((s) => s.nodeId === 'pa')?.status, 'paused', 'pa ended paused');
  assert.equal(st.steps.find((s) => s.nodeId === 'pb')?.status, 'paused', 'pb ended paused');
});
