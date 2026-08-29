// test/orchestrator-questions.test.mjs
// The mid-run ask-then-resume loop (spec 2026-07-11 §5), ported to the graph
// engine. Same six behaviours dev's file of this name pinned (deleted by P8
// commit 11c7b7ee without a port), re-driven through GraphOrchestrator:
// _primeQuestions (orchestrator.mjs:778) -> _questionsPath (:796) ->
// _questionsLoop (:810), MAX_QUESTION_ROUNDS = 3 (:36).
//
// Harness: a REAL saved v2 graph, the REAL scheduler, `auto:false`, and one
// injected `producer` runner standing in for the spawn (P3's `opts.runners`
// seam — the v2 equivalent of dev's `orch._runners`). The runner sees the very
// ctx the loop primes, so `ctx.questionsFile` / `ctx.questionsEnabled` /
// `ctx.questionsAnswered` / `ctx.resumeSessionId` are read off the object under
// test, never off a literal path.
import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { gitDir } from './helpers/git-dir.mjs';
import { createOrchestrator } from '../src/core/orchestrator.mjs';
import { writeGraphWorkflow } from '../src/core/workflows.mjs';
import { readStepQuestions } from '../src/core/artifacts.mjs';
import { runAgentExecution } from '../src/core/graph/executor.mjs';
import { getDb } from '../src/core/db.mjs';

useTempHome(after);

// settings/agent lookups resolve under HOME, not WORCA_HOME (the isolation
// test/orchestrator-graph.test.mjs:22-36 uses).
let sandboxHome;
const prevEnv = {};
before(async () => {
  sandboxHome = await mkdtemp(join(tmpdir(), 'worca-questions-home-'));
  for (const k of ['HOME', 'USERPROFILE']) prevEnv[k] = process.env[k];
  process.env.HOME = sandboxHome;
  process.env.USERPROFILE = sandboxHome;
});
after(async () => {
  for (const k of ['HOME', 'USERPROFILE']) {
    if (prevEnv[k] === undefined) delete process.env[k]; else process.env[k] = prevEnv[k];
  }
  await rm(sandboxHome, { recursive: true, force: true });
});

/** The v2 executor ABI for an injected runner: one entry per declared output. */
function outsOf(ctx) {
  const o = {};
  for (const p of ctx.ports.outputs || []) o[p.id] = { path: ctx.outputs?.[p.id]?.path ?? null, type: p.type };
  return o;
}

// `askQuestions` is a per-NODE control (workflows.mjs:542-546 resolves
// `config.askQuestions` for any sidecar with asksQuestions && !questionsLocked),
// which is exactly what the composer inspector writes.
const ASKS = { askQuestions: true };

/** One asking agent: task -> implementer -> End. */
const G_SINGLE = {
  id: 'wf_q_single', name: 'Questions single', domain: 'coding',
  nodes: [
    { id: 'n_task', kind: 'task', x: 0, y: 0, config: {} },
    { id: 'n_ask', kind: 'agent', key: 'implementer', x: 200, y: 0, config: { ...ASKS } },
    { id: 'n_end', kind: 'end', x: 400, y: 0, config: {} },
  ],
  wires: [
    { id: 'w1', from: { node: 'n_task', port: 'task' }, to: { node: 'n_ask', port: 'plan' } },
    { id: 'w2', from: { node: 'n_ask', port: 'done' }, to: { node: 'n_end', port: 'result' } },
  ],
};

/** TWO asking agents fired by the same token, joined by an AND card: the only
 *  shape where two nodes can have a question open at the same time. */
const G_PARALLEL = {
  id: 'wf_q_par', name: 'Questions parallel', domain: 'coding',
  nodes: [
    { id: 'n_task', kind: 'task', x: 0, y: 0, config: {} },
    { id: 'n_pa', kind: 'agent', key: 'implementer', x: 200, y: 0, config: { ...ASKS } },
    { id: 'n_pb', kind: 'agent', key: 'planner', x: 200, y: 120, config: { ...ASKS } },
    { id: 'n_and', kind: 'and', x: 400, y: 60, config: { arity: 2 } },
    { id: 'n_end', kind: 'end', x: 600, y: 60, config: {} },
  ],
  wires: [
    { id: 'w1', from: { node: 'n_task', port: 'task' }, to: { node: 'n_pa', port: 'plan' } },
    { id: 'w2', from: { node: 'n_task', port: 'task' }, to: { node: 'n_pb', port: 'task' } },
    { id: 'w3', from: { node: 'n_pa', port: 'done' }, to: { node: 'n_and', port: 'in1' } },
    { id: 'w4', from: { node: 'n_pb', port: 'plan' }, to: { node: 'n_and', port: 'in2' } },
    { id: 'w5', from: { node: 'n_and', port: 'out' }, to: { node: 'n_end', port: 'result' } },
  ],
};

/** One asking node beside one that never opted in — the per-node toggle the
 *  composer inspector writes is what tells them apart. */
const G_MIXED = {
  id: 'wf_q_mixed', name: 'Questions mixed', domain: 'coding',
  nodes: [
    { id: 'n_task', kind: 'task', x: 0, y: 0, config: {} },
    { id: 'n_on', kind: 'agent', key: 'implementer', x: 200, y: 0, config: { ...ASKS } },
    { id: 'n_off', kind: 'agent', key: 'planner', x: 200, y: 120, config: {} },
    { id: 'n_and', kind: 'and', x: 400, y: 60, config: { arity: 2 } },
    { id: 'n_end', kind: 'end', x: 600, y: 60, config: {} },
  ],
  wires: [
    { id: 'w1', from: { node: 'n_task', port: 'task' }, to: { node: 'n_on', port: 'plan' } },
    { id: 'w2', from: { node: 'n_task', port: 'task' }, to: { node: 'n_off', port: 'task' } },
    { id: 'w3', from: { node: 'n_on', port: 'done' }, to: { node: 'n_and', port: 'in1' } },
    { id: 'w4', from: { node: 'n_off', port: 'plan' }, to: { node: 'n_and', port: 'in2' } },
    { id: 'w5', from: { node: 'n_and', port: 'out' }, to: { node: 'n_end', port: 'result' } },
  ],
};

/** A fan-out: the mock decomposer writes 2 phases / 3 tasks, so the asking node
 *  runs as composite SLICES — several at once, which is why a slice may never
 *  open a prompt nobody can attribute (orchestrator.mjs:774-776). */
const G_COMPOSITE = {
  id: 'wf_q_slices', name: 'Questions slices', domain: 'coding',
  nodes: [
    { id: 'n_task', kind: 'task', x: 0, y: 0, config: {} },
    { id: 'n_dec', kind: 'agent', key: 'decomposer', x: 200, y: 0, config: {} },
    { id: 'n_impl', kind: 'agent', key: 'implementer', x: 400, y: 0, config: { ...ASKS } },
    { id: 'n_end', kind: 'end', x: 600, y: 0, config: {} },
  ],
  wires: [
    { id: 'w1', from: { node: 'n_task', port: 'task' }, to: { node: 'n_dec', port: 'plan' } },
    { id: 'w2', from: { node: 'n_task', port: 'task' }, to: { node: 'n_impl', port: 'plan' } },
    { id: 'w3', from: { node: 'n_dec', port: 'tasks' }, to: { node: 'n_impl', port: 'task' } },
    { id: 'w4', from: { node: 'n_impl', port: 'done' }, to: { node: 'n_end', port: 'result' } },
  ],
};

const QUESTION = (id, text) => ({ id, question: text, options: ['Redis', 'Postgres'] });
const writeQuestions = (path, ...qs) => writeFile(path, JSON.stringify({ questions: qs }), 'utf8');

/** Build an orchestrator over one of the graphs above with a scripted producer. */
async function orchFor(graph, { producer, auto = false, tag = 'q' }) {
  await writeGraphWorkflow(graph);
  return createOrchestrator({
    projectDir: gitDir(tag), workflowId: graph.id, prompt: 'demo',
    claude: { mock: true }, auto, runners: { producer },
  });
}

const auditLines = (pipelineId) => getDb()
  .prepare('SELECT text FROM pipeline_events WHERE pipeline_id = ? ORDER BY id').all(pipelineId)
  .map((r) => r.text);

// ── 1. ask -> answer -> resume the SAME session ───────────────────────────────

test('enabled node: ask -> answer -> resume same session -> done; rounds persisted', { timeout: 60000 }, async () => {
  const calls = [];
  let qPath1 = null;
  const orch = await orchFor(G_SINGLE, {
    tag: 'q1',
    producer: async (ctx) => {
      calls.push({
        enabled: !!ctx.questionsEnabled,
        file: ctx.questionsFile || null,
        resume: ctx.resumeSessionId || null,
        answered: (ctx.questionsAnswered || []).length,
      });
      if (calls.length === 1) {
        qPath1 = ctx.questionsFile;
        // The real runners report their session id through runClaude's `session`
        // event; the loop re-attaches to whatever that stamped on the ledger row.
        ctx.onEvent({ type: 'session', sessionId: 'sess-1' });
        await writeQuestions(ctx.questionsFile, QUESTION('q1', 'Which storage?'));
      }
      return { outputs: outsOf(ctx), verdict: null, summary: 'x' };
    },
  });
  const events = [];
  orch.on('question', (q) => {
    events.push(q);
    // `question` is emitted BEFORE pendingQuestion is installed: answer next tick.
    setImmediate(() => orch.answer(q.id, { answers: [{ id: 'q1', choice: 'Postgres' }] }));
  });

  const res = await orch.run();
  assert.equal(res.status, 'done', res.error);

  assert.equal(events.length, 1, 'exactly one question round opened');
  assert.equal(events[0].kind, 'questions');
  assert.equal(events[0].agent, 'Implementation', 'the prompt names the node display name');
  assert.equal(events[0].nodeId, 'n_ask');
  assert.equal(events[0].executionId, 'x:n_ask:1');
  assert.equal(events[0].id, 'questions-x:n_ask:1-r1', 'ask id is questions-<executionId>-r<round>');
  // Normalized through protocol.mjs#normalizeClarify on the way out (the
  // `allowFreeText` default is the normalizer's, not the agent's).
  assert.deepEqual(events[0].questions,
    [{ ...QUESTION('q1', 'Which storage?'), allowFreeText: true }]);

  assert.equal(calls.length, 2, 'initial run + one resume');
  assert.equal(calls[0].enabled, true, '_primeQuestions enabled the node');
  assert.equal(basename(calls[0].file), 'questions-x-n_ask-c1-r1.json', 'round 1 path');
  assert.equal(calls[1].resume, 'sess-1', 'the resume re-attaches the captured session');
  assert.equal(calls[1].answered, 1, 'answers injected into the resume ctx');

  const rows = readStepQuestions(orch.getState().id);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].round, 1);
  assert.equal(rows[0].agentKey, 'implementer');
  assert.equal(rows[0].nodeId, 'n_ask');
  assert.deepEqual(rows[0].answers, [{ id: 'q1', question: 'Which storage?', choice: 'Postgres' }]);
  // The processed round file is CONSUMED: a surviving file would re-gate the
  // user on a crash/pause-resumed re-run (orchestrator.mjs:848-850).
  assert.equal(existsSync(qPath1), false, 'answered round file is consumed');
  assert.ok(auditLines(orch.getState().id).includes('Implementation asked 1 question(s) (round 1).'));
  assert.ok(auditLines(orch.getState().id).includes('Implementation: 1 answer(s) received (round 1).'));
});

// ── 2. the round cap ──────────────────────────────────────────────────────────

test('round cap: asks at most MAX_QUESTION_ROUNDS times; the final resume carries no file', { timeout: 60000 }, async () => {
  const files = [];
  const orch = await orchFor(G_SINGLE, {
    tag: 'q2',
    producer: async (ctx) => {
      files.push(ctx.questionsFile || null);
      // Every round the agent asks again: without the cap this never terminates.
      if (ctx.questionsFile) await writeQuestions(ctx.questionsFile, QUESTION('q1', 'Round?'));
      return { outputs: outsOf(ctx), verdict: null, summary: 'x' };
    },
  });
  let asks = 0;
  orch.on('question', (q) => { asks += 1; setImmediate(() => orch.answer(q.id, { answers: [] })); });

  const res = await orch.run();
  assert.equal(res.status, 'done', res.error);
  assert.equal(asks, 3, 'capped at MAX_QUESTION_ROUNDS');
  assert.equal(files.length, 4, 'initial run + 3 resumes');
  assert.deepEqual(files.slice(0, 3).map((f) => basename(f)), [
    'questions-x-n_ask-c1-r1.json', 'questions-x-n_ask-c1-r2.json', 'questions-x-n_ask-c1-r3.json',
  ], 'one file per round, numbered by _questionsPath');
  assert.equal(files[3], null, 'the final resume carries no next-round file');
  const rows = readStepQuestions(orch.getState().id);
  assert.deepEqual(rows.map((r) => r.round), [1, 2, 3]);
  assert.ok(rows.every((r) => r.stepKey === 'x:n_ask:1'), 'every round is keyed by the ONE execution');
});

// ── 3. auto mode ──────────────────────────────────────────────────────────────

test('auto mode: the loop is suppressed — no gate, one run, no round file', { timeout: 60000 }, async () => {
  const seen = [];
  const orch = await orchFor(G_SINGLE, {
    tag: 'q3', auto: true,
    producer: async (ctx) => {
      seen.push({ enabled: !!ctx.questionsEnabled, file: ctx.questionsFile ?? null });
      return { outputs: outsOf(ctx), verdict: null, summary: 'x' };
    },
  });
  let asks = 0;
  orch.on('question', () => { asks += 1; });

  const res = await orch.run();
  assert.equal(res.status, 'done', res.error);
  assert.equal(asks, 0, 'auto mode never gates the user mid-node');
  assert.deepEqual(seen, [{ enabled: false, file: null }], 'one run, questions disabled, no file allocated');
  assert.deepEqual(readStepQuestions(orch.getState().id), []);
});

test('the per-node askQuestions toggle decides: a node that never opted in is not primed', { timeout: 60000 }, async () => {
  const seen = {};
  const asked = new Set();
  const orch = await orchFor(G_MIXED, {
    tag: 'q3b',
    producer: async (ctx) => {
      seen[ctx.nodeId] ??= { enabled: !!ctx.questionsEnabled, file: ctx.questionsFile ?? null };
      // Both nodes try to ask once; only the primed one has anywhere to write it.
      if (ctx.questionsFile && !asked.has(ctx.nodeId)) {
        asked.add(ctx.nodeId);
        await writeQuestions(ctx.questionsFile, QUESTION('q1', `${ctx.nodeId}?`));
      }
      return { outputs: outsOf(ctx), verdict: null, summary: 'x' };
    },
  });
  const gated = [];
  orch.on('question', (q) => {
    gated.push(q.nodeId);
    setImmediate(() => orch.answer(q.id, { answers: [{ id: 'q1', choice: 'Redis' }] }));
  });

  const res = await orch.run();
  assert.equal(res.status, 'done', res.error);
  assert.deepEqual(gated, ['n_on'], 'only the opted-in node gates the user');
  assert.equal(seen.n_on.enabled, true);
  assert.equal(basename(seen.n_on.file), 'questions-x-n_on-c1-r1.json');
  assert.deepEqual(seen.n_off, { enabled: false, file: null }, 'the other node is never primed');
  assert.deepEqual(readStepQuestions(orch.getState().id).map((r) => r.nodeId), ['n_on']);
});

test('composite slices never gate: several run at once, so no slice is primed', { timeout: 60000 }, async () => {
  const slices = [];
  const orch = await orchFor(G_COMPOSITE, {
    tag: 'q3c',
    producer: async (ctx) => {
      if (!ctx.slice) return runAgentExecution(ctx);     // the decomposer, under the mock
      slices.push({ id: ctx.slice.id, enabled: !!ctx.questionsEnabled, file: ctx.questionsFile ?? null });
      // A slice that WERE primed would ask here.
      if (ctx.questionsFile) await writeQuestions(ctx.questionsFile, QUESTION('q1', `${ctx.slice.id}?`));
      return { outputs: outsOf(ctx), verdict: null, summary: 'x' };
    },
  });
  const gated = [];
  orch.on('question', (q) => {
    gated.push(q.id);
    setImmediate(() => orch.answer(q.id, { answers: [{ id: 'q1', choice: 'Redis' }] }));
  });

  const res = await orch.run();
  assert.equal(res.status, 'done', res.error);
  assert.deepEqual(gated, [], 'no slice ever gates the user');
  for (const s of slices) assert.deepEqual(s, { id: s.id, enabled: false, file: null }, `${s.id} not primed`);
  assert.deepEqual(slices.map((s) => s.id), ['p1t1', 'p1t2', 'p2t1'], 'one pass per slice, no resume rounds');
  assert.deepEqual(readStepQuestions(orch.getState().id), []);
});

// ── 4. a malformed round file ─────────────────────────────────────────────────

test('malformed questions file: audited, no gate, single run', { timeout: 60000 }, async () => {
  let runs = 0;
  const orch = await orchFor(G_SINGLE, {
    tag: 'q4',
    producer: async (ctx) => {
      runs += 1;
      if (runs === 1) await writeFile(ctx.questionsFile, 'not json at all', 'utf8');
      return { outputs: outsOf(ctx), verdict: null, summary: 'x' };
    },
  });
  let asks = 0;
  orch.on('question', () => { asks += 1; });

  const res = await orch.run();
  assert.equal(res.status, 'done', res.error);
  assert.equal(asks, 0, 'a malformed file must not gate the user');
  assert.equal(runs, 1, 'and must not resume');
  assert.deepEqual(readStepQuestions(orch.getState().id), []);
  assert.ok(auditLines(orch.getState().id).includes(
    'Implementation: questions file was malformed — proceeding without asking (round 1).'),
  `audit line missing: ${JSON.stringify(auditLines(orch.getState().id))}`);
});

// ── 5. serialization across a parallel group ──────────────────────────────────

test('parallel group: both enabled nodes gate once, and the asks serialize through one slot', { timeout: 60000 }, async () => {
  const asked = new Set();
  // Both nodes have written their round-1 file — i.e. BOTH asks are due — before
  // the first one is answered. Without that hold the two asks never overlap and
  // the serialization is not under test at all.
  let bothArmed;
  const armed = new Promise((resolve) => { bothArmed = resolve; });
  let armedCount = 0;
  const orch = await orchFor(G_PARALLEL, {
    tag: 'q5',
    producer: async (ctx) => {
      if (ctx.questionsFile && !asked.has(ctx.nodeId)) {
        asked.add(ctx.nodeId);
        await writeQuestions(ctx.questionsFile, QUESTION('q1', `${ctx.nodeId}?`));
        if ((armedCount += 1) === 2) bothArmed();
      }
      return { outputs: outsOf(ctx), verdict: null, summary: 'x' };
    },
  });
  const trace = [];
  orch.on('question', (q) => {
    trace.push(`open:${q.nodeId}`);
    armed.then(() => setTimeout(() => {
      trace.push(`answer:${q.nodeId}`);
      orch.answer(q.id, { answers: [{ id: 'q1', choice: 'Redis' }] });
    }, 20));
  });

  const res = await orch.run();
  assert.equal(res.status, 'done', res.error);
  const opened = trace.filter((t) => t.startsWith('open:')).map((t) => t.slice(5));
  assert.deepEqual([...opened].sort(), ['n_pa', 'n_pb'], 'both nodes gated exactly once');
  // ONE pendingQuestion slot: an open prompt is always answered before the next
  // one opens (a broken _enqueueAsk shows up as two consecutive `open:`).
  for (let i = 0; i < trace.length; i += 2) {
    assert.ok(trace[i].startsWith('open:'), `trace[${i}] should be an open: ${JSON.stringify(trace)}`);
    assert.equal(trace[i + 1], `answer:${trace[i].slice(5)}`, `unserialized asks: ${JSON.stringify(trace)}`);
  }
  const st = orch.getState();
  for (const nodeId of ['n_pa', 'n_pb']) {
    assert.equal(st.steps.find((s) => s.nodeId === nodeId)?.status, 'done', `${nodeId} finished`);
  }
});

// ── 6. pause while a parallel gate is open ────────────────────────────────────

test('pause during a parallel question gate: the queued sibling ask never opens', { timeout: 60000 }, async () => {
  const asked = new Set();
  const orch = await orchFor(G_PARALLEL, {
    tag: 'q6',
    producer: async (ctx) => {
      if (ctx.questionsFile && !asked.has(ctx.nodeId)) {
        asked.add(ctx.nodeId);
        await writeQuestions(ctx.questionsFile, QUESTION('q1', `${ctx.nodeId}?`));
      }
      return { outputs: outsOf(ctx), verdict: null, summary: 'x' };
    },
  });
  // One prompt OPEN and the sibling's ask QUEUED on _askTail when pause() lands.
  // Spy on _enqueueAsk so the pause fires only once both asks are in the tail.
  let bothQueued;
  const bothQueuedP = new Promise((resolve) => { bothQueued = resolve; });
  const origEnqueue = orch._enqueueAsk.bind(orch);
  let enqueues = 0;
  orch._enqueueAsk = (run) => { if ((enqueues += 1) === 2) bothQueued(); return origEnqueue(run); };

  const events = [];
  orch.on('question', (q) => {
    events.push(q);
    // Pause from inside the FIRST handler — never answer anything — as soon as
    // the sibling's ask is queued behind this open prompt.
    bothQueuedP.then(() => setImmediate(() => orch.pause()));
  });

  const res = await orch.run();
  assert.equal(res.status, 'paused', `run unwound as a pause: ${JSON.stringify(res)}`);
  assert.equal(events.length, 1, 'exactly one question event: the queued gate never fired on a pausing run');
  const st = orch.getState();
  for (const nodeId of ['n_pa', 'n_pb']) {
    assert.equal(st.steps.find((s) => s.nodeId === nodeId)?.status, 'paused', `${nodeId} ended paused`);
  }
});
