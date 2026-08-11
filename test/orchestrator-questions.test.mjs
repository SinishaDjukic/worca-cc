// test/orchestrator-questions.test.mjs
// Ask-then-resume loop (spec 2026-07-11 §5): engine-level, offline, stubbed
// executors. The harness drives _runGraph directly over a hand-built two-node
// graph so the questions machinery is exercised without a real workflow, a real
// registry or a worktree.
//
// The graphs here deliberately carry NO End card: these cases are about the ask
// loop, and a run that drains without binding End resolves 'done' at quiescence
// (with the run-level warning orchestrator-graph.test.mjs pins separately).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createOrchestrator } from '../src/core/orchestrator.mjs';
import { readStepQuestions } from '../src/core/artifacts.mjs';
import { registryPortsFn } from '../src/core/workflows.mjs';
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

/** A questions-enabled agent sidecar with no ports (nothing to wire, fires once). */
const AGENT = (key, displayName) => ({
  key, displayName, runnerType: 'producer', asksQuestions: true, inputs: [], outputs: [],
});

/** Build the { template, ports, nodeCtx } triple _runGraph consumes. */
function graphOf(specs) {
  const registry = Object.fromEntries(specs.map((s) => [s.key, AGENT(s.key, s.label)]));
  const template = {
    id: 'wf_q', name: 'Q', version: 2,
    nodes: specs.map((s, i) => ({ id: s.id, kind: 'agent', key: s.key, x: i * 200, y: 0 })),
    wires: [],
  };
  const nodeCtx = Object.fromEntries(specs.map((s) => [s.id, {
    nodeId: s.id, kind: 'agent', key: s.key, meta: registry[s.key],
    runnerType: 'producer', agentPrompt: '', askQuestions: true, fanOut: false, duplicateKey: false,
  }]));
  return { registry, resolved: { template, ports: registryPortsFn(registry), nodeCtx } };
}

async function primedInteractive(projectDir, specs = [{ id: 'n1', key: 'worker', label: 'Worker' }]) {
  const orch = createOrchestrator({ projectDir, prompt: 'demo', auto: false, claude: { mock: true } });
  const { id } = await seedPipeline(projectDir);
  orch.pipeline = { id, dir: projectDir, promptText: 'demo' };
  orch.state.id = id;
  orch.state.pipelineDir = projectDir;
  orch.baseName = 'feature';
  orch.planDatePrefix = '01-01-26';
  orch.agentPrompts = {};
  orch.toolInstruction = '';
  orch.checkpointRef = null;
  const { registry, resolved } = graphOf(specs);
  orch.registry = registry;
  orch.resolved = resolved;
  orch._setStatus('running');
  return orch;
}

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
        // Simulate the agent reporting its session id (the way the real executor
        // does via runClaude's session event) then writing round 1's questions.
        ctx.onEvent({ type: 'session', sessionId: 'sess-1' });
        await writeFile(ctx.questionsFile, JSON.stringify({
          questions: [{ id: 'q1', question: 'Which storage?', options: ['Redis', 'Postgres'] }],
        }), 'utf8');
      }
      return { outputs: {}, summary: 'x' };
    },
  };
  const events = [];
  orch.on('question', (q) => {
    events.push(q);
    setImmediate(() => orch.answer(q.id, { answers: [{ id: 'q1', choice: 'Postgres' }] }));
  });
  await orch._runGraph();
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
  assert.equal(rows[0].stepKey, 'x:n1:1', 'rounds are keyed by the executionId');
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
      return { outputs: {}, summary: 'x' };
    },
  };
  let asks = 0;
  orch.on('question', (q) => { asks += 1; setImmediate(() => orch.answer(q.id, { answers: [] })); });
  await orch._runGraph();
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
    producer: async (ctx) => { runs += 1; sawEnabled = !!ctx.questionsEnabled; return { outputs: {}, summary: 'x' }; },
  };
  let asks = 0;
  orch.on('question', () => { asks += 1; });
  await orch._runGraph();
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
      return { outputs: {}, summary: 'x' };
    },
  };
  let asks = 0;
  orch.on('question', () => { asks += 1; });
  await orch._runGraph();
  assert.equal(asks, 0);
  assert.equal(runs, 1);
});

const PAIR = [
  { id: 'pa', key: 'worker', label: 'Worker' },
  { id: 'pb', key: 'helper', label: 'Helper' },
];

test('parallel executions: both enabled nodes complete; asks serialize through one slot', async () => {
  const dir = await makeTmpDir();
  const orch = await primedInteractive(dir, PAIR);
  const asked = new Set();
  orch._runners = {
    producer: async (ctx) => {
      if (ctx.questionsFile && !asked.has(ctx.nodeId)) {
        asked.add(ctx.nodeId);
        await writeFile(ctx.questionsFile, JSON.stringify({
          questions: [{ id: 'q1', question: `${ctx.node.key}?`, options: ['A', 'B'] }],
        }), 'utf8');
      }
      return { outputs: {}, summary: 'x' };
    },
  };
  const order = [];
  orch.on('question', (q) => {
    order.push(q.nodeId);
    setImmediate(() => orch.answer(q.id, { answers: [{ id: 'q1', choice: 'A' }] }));
  });
  await orch._runGraph();
  assert.deepEqual([...order].sort(), ['pa', 'pb'], 'both nodes gated once each');
  const st = orch.getState();
  assert.ok(st.steps.find((s) => s.nodeId === 'pa' && s.status === 'done'));
  assert.ok(st.steps.find((s) => s.nodeId === 'pb' && s.status === 'done'));
});

test('pause during a parallel question gate: the queued sibling ask never opens', async () => {
  const dir = await makeTmpDir();
  const orch = await primedInteractive(dir, PAIR);
  const asked = new Set();
  orch._runners = {
    producer: async (ctx) => {
      if (ctx.questionsFile && !asked.has(ctx.nodeId)) {
        asked.add(ctx.nodeId);
        await writeFile(ctx.questionsFile, JSON.stringify({
          questions: [{ id: 'q1', question: `${ctx.node.key}?`, options: ['A', 'B'] }],
        }), 'utf8');
      }
      return { outputs: {}, summary: 'x' };
    },
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
  const res = await orch._runGraph();
  assert.equal(res, 'paused', 'the run unwound as a pause');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(events.length, 1, 'exactly one question event: the queued gate never fired on the pausing run');
  const st = orch.getState();
  assert.equal(st.steps.find((s) => s.nodeId === 'pa')?.status, 'paused', 'pa ended paused');
  assert.equal(st.steps.find((s) => s.nodeId === 'pb')?.status, 'paused', 'pb ended paused');
});
