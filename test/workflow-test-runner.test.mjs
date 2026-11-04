// test/workflow-test-runner.test.mjs — D26/D27/D35–D37: the runner on a fake run handler (no engine, no server):
// parallelism, verdicts, canned answers, the cost cap, stop and finish the rest, the quick check, refusals, a change
// during a test, connectors and reuse. Plus uses.mjs against a real workflow and its versions.
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _resetForTests, getDb } from '../src/core/db.mjs';
import * as store from '../src/core/workflow-tests/store.mjs';
import { createTestRunner, MAX_PARALLEL, PAUSE_REFUSED_TEXT, PAUSE_REFUSED_OTHER, pauseVerdict } from '../src/core/workflow-tests/runner.mjs';
import { checkTry } from '../src/core/workflow-tests/result.mjs';

const homes = [];
let home;
beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'worca-cc-wftrun-'));
  homes.push(home); _resetForTests(); process.env.WORCA_HOME = home;
});
// A live run holds the event loop open in the server (its engine process, its sockets). The runner's cost poll is an
// unref'd timer, so a fake run must hold the loop the same way: with every try held and only that timer pending, Node
// 22 ended the event loop mid-test ('Promise resolution is still pending but the event loop has already resolved').
const holders = new Set();
const holdLoop = () => { const h = setInterval(() => {}, 60_000); holders.add(h); return () => { clearInterval(h); holders.delete(h); }; };
after(() => { for (const h of holders) clearInterval(h); holders.clear(); });
after(async () => { _resetForTests(); delete process.env.WORCA_HOME; await Promise.all(homes.map((d) => rm(d, { recursive: true, force: true }))); });

const WF = 'wf_brief';
const fps = {};
/** A fake run handler: each try is an EventEmitter "orchestrator" that ends as `plan()` says; while it runs it holds
 *  the event loop open, as a real run does. */
function harness({ plan = () => ({ status: 'done', cost: 0.5 }), refuse = null } = {}) {
  const entries = new Map();
  const started = []; const stopped = [];
  let n = 0; let liveNow = 0; let maxLive = 0;
  const deps = {
    startRun: async (body, { workflowTest }) => {
      if (refuse) return refuse;
      n += 1;
      const runKey = `run-${n}`; const pipelineId = `p${String(n).padStart(7, '0')}`;
      const orch = new EventEmitter(); orch.state = { totalCostUsd: 0 };
      const p = plan(body, workflowTest.use, n);
      let finish;
      const launch = new Promise((r) => { finish = r; });
      const release = holdLoop();
      const e = { orch, launch, status: 'running', pipelineId, text: p.text ?? '# Result\n\nProblem solved here',
        end(status) { if (e.status !== 'running') return; e.status = status; liveNow -= 1; release(); finish(); } };
      orch.answer = (id, payload) => { e.answered = [id, payload]; setImmediate(() => e.end(p.status)); return true; };
      entries.set(runKey, e); liveNow += 1; maxLive = Math.max(maxLive, liveNow);
      workflowTest.onOrch(orch, { runKey });
      started.push({ runKey, use: workflowTest.use, connectors: workflowTest.connectors, mock: !!body.mock, title: body.title });
      setImmediate(() => {
        orch.state.totalCostUsd = p.cost;
        if (p.ask) orch.emit('question', p.ask);
        else if (!p.hold) e.end(p.status);
      });
      return { status: 200, body: { runId: runKey, pipelineId } };
    },
    liveRun: (k) => entries.get(k) || null,
    stopRun: async (k) => { stopped.push(k); entries.get(k)?.end('stopped'); },
    answer: (k, id, payload) => entries.get(k).orch.answer(id, payload),
    outcomeOf: async (pipelineId, { help = [], failReason = null, durationMs = null } = {}) => {
      const e = [...entries.values()].find((x) => x.pipelineId === pipelineId);
      return { pipelineId, facts: { status: e.status, costUsd: e.orch.state.totalCostUsd, durationMs, sentBack: 0, help, failReason },
        text: e.text, name: 'result.md', source: 'work', files: ['work/result.md'] };
    },
    judge: (example, outcome) => checkTry(example, outcome),
    fingerprintOf: async (_wf, use) => fps[store.useRef(use)] ?? `fp-${store.useRef(use)}`,
    mockMode: () => false,
    pollMs: 5,
  };
  return { deps, started, stopped, entries, maxLive: () => maxLive };
}
const example = (over = {}) => store.createExample(WF, { name: 'Bulk invoice export', request: 'Write the brief.', tries: 3, ...over });
const until = async (fn, ms = 5000) => { const t0 = Date.now(); while (!fn()) { if (Date.now() - t0 > ms) throw new Error('timeout'); await new Promise((r) => setTimeout(r, 5)); } };
const statuses = (runId) => store.triesOfRun(runId).map((t) => `${t.side}${t.tryNo}:${t.status}`);

test('two versions, two examples, three tries each: 12 tries, at most 3 at a time, every verdict stored', async () => {
  for (const k of Object.keys(fps)) delete fps[k];
  const h = harness();
  const frames = [];
  const runner = createTestRunner({ ...h.deps, notify: (f) => frames.push(f) });
  const e1 = example(); const e2 = example({ name: 'Saved filters' });
  const run = await runner.start({ workflowId: WF, a: 1, b: 'draft', exampleIds: [e1.id, e2.id], tries: 3, capUsd: 50, by: 'Tomica' });
  await runner.idle(run.id);
  const done = store.readTestRun(run.id);
  assert.deepEqual([done.status, done.stopReason], ['done', null]);
  assert.equal(h.started.length, 12);
  assert.ok(h.maxLive() <= MAX_PARALLEL, `at most ${MAX_PARALLEL} at once, saw ${h.maxLive()}`);
  assert.equal(MAX_PARALLEL, 3);
  assert.deepEqual(h.started.slice(0, 3).map((s) => s.use), [1, 'draft', 1], 'example by example, try by try, the old version first');
  const tries = store.triesOfRun(run.id);
  assert.ok(tries.every((t) => t.status === 'passed' && t.verdict.passed && t.costUsd === 0.5));
  assert.equal(store.spentOfRun(run.id), 6);
  assert.match(h.started[0].title, /^Test: Bulk invoice export · try 1$/);
  assert.ok(frames.length && frames.every((f) => f.type === 'workflow-tests-changed' && f.testRunId === run.id && !('runId' in f)), 'D33: testRunId, never runId');
  assert.deepEqual([frames.at(-1).finished, frames.at(-1).status], [true, 'done']);
});

test('canned answers: "the try counts as failed" stops it; "Worca picks" goes on, but it needed help', async () => {
  const ask = { id: 'q-1', kind: 'questions', questions: [{ id: 'q1', question: 'Which screens come first?', options: ['Home', 'Settings'] }] };
  const h = harness({ plan: () => ({ status: 'done', cost: 0.2, ask }) });
  const runner = createTestRunner(h.deps);
  const strict = example({ otherwise: 'fail', tries: 1 });
  const r1 = await runner.start({ workflowId: WF, kind: 'once', b: 'draft', exampleIds: [strict.id], tries: 1 });
  await runner.idle(r1.id);
  const [t1] = store.triesOfRun(r1.id);
  assert.equal(t1.status, 'failed');
  assert.deepEqual(h.stopped, [t1.runKey], 'the try was stopped');
  assert.equal(t1.verdict.basics[0].detail, 'Worca asked "Which screens come first?", and this example has no answer for it.');
  const loose = example({ name: 'Loose', otherwise: 'pick', tries: 1 });
  const r2 = await runner.start({ workflowId: WF, kind: 'once', b: 'draft', exampleIds: [loose.id], tries: 1 });
  await runner.idle(r2.id);
  const [t2] = store.triesOfRun(r2.id);
  assert.deepEqual([t2.status, t2.verdict.facts.status, t2.verdict.facts.help.length], ['failed', 'done', 1]);
  assert.deepEqual(h.entries.get(t2.runKey).answered, ['q-1', { answers: [{ id: 'q1', choice: 'Home' }] }]);
  const answered = example({ name: 'Answered', tries: 1, answers: [{ question: 'Which screens come first?', answer: 'Settings' }] });
  const r3 = await runner.start({ workflowId: WF, kind: 'once', b: 'draft', exampleIds: [answered.id], tries: 1 });
  await runner.idle(r3.id);
  assert.equal(store.triesOfRun(r3.id)[0].status, 'passed');
});

test('the cost cap stops the running tries, keeps the waiting ones, and finish the rest needs a higher cap', async () => {
  let hold = true;
  const h = harness({ plan: () => (hold ? { status: 'done', cost: 3, hold: true } : { status: 'done', cost: 0.5 }) });
  const runner = createTestRunner(h.deps);
  const ex = example();
  const run = await runner.start({ workflowId: WF, a: 1, b: 'draft', exampleIds: [ex.id], tries: 3, capUsd: 5 });
  await runner.idle(run.id);
  const st = store.readTestRun(run.id);
  assert.deepEqual([st.status, st.stopReason], ['stopped', 'cap']);
  assert.deepEqual(statuses(run.id).sort(), ['a1:stopped', 'a2:stopped', 'a3:waiting', 'b1:stopped', 'b2:waiting', 'b3:waiting'], 'three ran at once');
  assert.equal(store.spentOfRun(run.id), 9, 'the stopped tries count in the cost');
  await assert.rejects(runner.continueRun(run.id), { code: 'BAD_REQUEST', message: 'Raise the cost limit above $9.00 to finish the rest.' });
  hold = false;
  await runner.continueRun(run.id, { capUsd: 20 });
  await runner.idle(run.id);
  assert.equal(store.readTestRun(run.id).status, 'done');
  assert.deepEqual(statuses(run.id).sort(), ['a1:passed', 'a2:passed', 'a3:passed', 'b1:passed', 'b2:passed', 'b3:passed']);
  assert.equal(store.spentOfRun(run.id), 12);
});

test('a person stops a test; finish the rest is refused once the draft or an example changed', async () => {
  for (const k of Object.keys(fps)) delete fps[k];
  let hold = true;
  const h = harness({ plan: () => (hold ? { status: 'done', cost: 0.1, hold: true } : { status: 'done', cost: 0.1 }) });
  const runner = createTestRunner(h.deps);
  const ex = example({ tries: 1 });
  const run = await runner.start({ workflowId: WF, a: 1, b: 'draft', exampleIds: [ex.id], tries: 1 });
  await until(() => h.started.length === 2);
  await assert.rejects(runner.start({ workflowId: WF, a: 1, b: 'draft', exampleIds: [ex.id], tries: 1 }),
    { code: 'BUSY', message: 'A test of this workflow is running. Wait for it, or stop it first.' });
  await assert.rejects(runner.start({ workflowId: WF, kind: 'once', b: 'draft', exampleIds: [ex.id], tries: 1 }), { code: 'BUSY' }, 'Try it once now too (D37)');
  const stoppedRun = await runner.stop(run.id);
  assert.deepEqual([stoppedRun.status, stoppedRun.stopReason], ['stopped', 'person']);
  fps.draft = 'fp-draft-edited';
  await assert.rejects(runner.continueRun(run.id), { message: 'Your draft changed since this test started: start a new test.' });
  delete fps.draft;
  store.updateExample(WF, ex.id, { request: 'Another request' });
  await assert.rejects(runner.continueRun(run.id), { message: '"Bulk invoice export" was edited since this test started: start a new test.' });
  store.updateExample(WF, ex.id, { request: 'Write the brief.' });
  hold = false;
  await runner.continueRun(run.id);
  await runner.idle(run.id);
  assert.equal(store.readTestRun(run.id).status, 'done');
});

test('a change during a test stops it before its next try: the draft, then an example (review I3)', async () => {
  for (const k of Object.keys(fps)) delete fps[k];
  const h = harness({ plan: () => ({ status: 'done', cost: 0.1, hold: true }) });
  const runner = createTestRunner(h.deps);
  const ex = example({ tries: 5 });
  const r1 = await runner.start({ workflowId: WF, kind: 'once', b: 'draft', exampleIds: [ex.id], tries: 5 });
  await until(() => h.started.length === MAX_PARALLEL);
  fps.draft = 'fp-draft-edited';
  h.entries.get(h.started[0].runKey).end('done');
  await runner.idle(r1.id);
  const s1 = store.readTestRun(r1.id);
  assert.deepEqual([s1.status, s1.stopReason, s1.stopDetail], ['stopped', 'changed', 'Your draft changed since this test started: start a new test.']);
  assert.equal(h.started.length, MAX_PARALLEL, 'the fourth try never started: it would have run the edited draft as the old one');
  assert.deepEqual(statuses(r1.id).sort(), ['b1:passed', 'b2:stopped', 'b3:stopped', 'b4:waiting', 'b5:waiting']);
  delete fps.draft;
  const r2 = await runner.start({ workflowId: WF, kind: 'once', b: 'draft', exampleIds: [ex.id], tries: 5 });
  await until(() => h.started.length === MAX_PARALLEL * 2);
  store.updateExample(WF, ex.id, { request: 'Another request' });
  h.entries.get(h.started[MAX_PARALLEL].runKey).end('done');
  await runner.idle(r2.id);
  const s2 = store.readTestRun(r2.id);
  assert.deepEqual([s2.stopReason, s2.stopDetail], ['changed', '"Bulk invoice export" was edited since this test started: start a new test.']);
});

test('connectors: the mode reaches every try, is stored, and keeps pretend and real results apart (D35)', async () => {
  for (const k of Object.keys(fps)) delete fps[k];
  const h = harness();
  const runner = createTestRunner(h.deps);
  const ex = example({ tries: 1 });
  const real = await runner.start({ workflowId: WF, a: 1, b: 'draft', exampleIds: [ex.id], tries: 1, connectors: 'real' });
  await runner.idle(real.id);
  assert.equal(store.readTestRun(real.id).connectors, 'real');
  assert.deepEqual(h.started.map((s) => s.connectors), ['real', 'real']);
  assert.ok(store.triesOfRun(real.id).every((t) => t.connectors === 'real'));
  const pretend = await runner.start({ workflowId: WF, a: 1, b: 'draft', exampleIds: [ex.id], tries: 1, reuseA: true });
  await runner.idle(pretend.id);
  assert.equal(h.started.length, 4, 'a real result is never reused for a pretend test');
  assert.deepEqual(h.started.slice(2).map((s) => s.connectors), ['pretend', 'pretend']);
  await assert.rejects(runner.start({ workflowId: WF, kind: 'once', b: 'draft', exampleIds: [ex.id], tries: 1, connectors: 'maybe' }),
    { code: 'BAD_REQUEST', message: 'connectors must be "pretend" or "real"' });
});

test('the free quick check runs first as a mock try; when it fails nothing real is tried', async () => {
  const h = harness({ plan: (body) => (body.mock ? { status: 'error', cost: 0 } : { status: 'done', cost: 0.5 }) });
  const runner = createTestRunner(h.deps);
  const ex = example({ tries: 1 });
  const run = await runner.start({ workflowId: WF, a: 1, b: 'draft', exampleIds: [ex.id], tries: 1, quickCheck: true });
  await runner.idle(run.id);
  const st = store.readTestRun(run.id);
  assert.deepEqual([st.status, st.stopReason, st.quick], ['stopped', 'quick-check', { status: 'failed', detail: 'the quick check ended as error' }]);
  assert.deepEqual(h.started.map((s) => [s.mock, s.title]), [[true, 'Quick check: Bulk invoice export']]);
  assert.deepEqual(statuses(run.id).sort(), ['a1:waiting', 'b1:waiting']);
});

test('a refused start (the spending limit) stops the test and keeps the try waiting', async () => {
  const h = harness({ refuse: { status: 403, body: { error: 'total cost limit reached' } } });
  const runner = createTestRunner(h.deps);
  const ex = example({ tries: 1 });
  const run = await runner.start({ workflowId: WF, a: 1, b: 'draft', exampleIds: [ex.id], tries: 1 });
  await runner.idle(run.id);
  const st = store.readTestRun(run.id);
  assert.deepEqual([st.status, st.stopReason, st.stopDetail], ['stopped', 'budget', 'total cost limit reached']);
  assert.ok(statuses(run.id).every((s) => s.endsWith(':waiting')));
});

test('reuse: an old version\'s finished tries are reused only while nothing changed (D26)', async () => {
  for (const k of Object.keys(fps)) delete fps[k];
  const h = harness();
  const runner = createTestRunner(h.deps);
  const ex = example();
  const first = await runner.start({ workflowId: WF, a: 1, b: 'draft', exampleIds: [ex.id], tries: 3 });
  await runner.idle(first.id);
  const second = await runner.start({ workflowId: WF, a: 1, b: 'draft', exampleIds: [ex.id], tries: 3, reuseA: true });
  await runner.idle(second.id);
  assert.equal(h.started.length, 9, 'only the draft was tried again');
  const reused = store.triesOfRun(second.id).filter((t) => t.side === 'a');
  assert.deepEqual([reused.length, reused.every((t) => t.runId === first.id)], [3, true]);
  assert.equal(store.spentOfRun(second.id), 1.5);
  fps['1'] = 'fp-1-library-edit';
  const third = await runner.start({ workflowId: WF, a: 1, b: 'draft', exampleIds: [ex.id], tries: 3, reuseA: true });
  await runner.idle(third.id);
  assert.equal(h.started.length, 15, 'a changed version is tried again');
  store.updateExample(WF, ex.id, { request: 'A new request' });
  const fourth = await runner.start({ workflowId: WF, a: 1, b: 'draft', exampleIds: [ex.id], tries: 3, reuseA: true, reuseB: true });
  await runner.idle(fourth.id);
  assert.equal(h.started.length, 21, 'a changed example is tried again on both sides');
});

test('bad starts are refused before anything runs; a restart stops what was running', async () => {
  const runner = createTestRunner(harness().deps);
  const ex = example();
  await assert.rejects(runner.start({ workflowId: WF, a: 'draft', b: 'draft', exampleIds: [ex.id], tries: 3 }), { message: 'pick two different versions to compare' });
  await assert.rejects(runner.start({ workflowId: WF, b: 'draft', exampleIds: [ex.id], tries: 3 }), { message: 'pick the version to compare with' });
  await assert.rejects(runner.start({ workflowId: WF, a: 1, b: 'draft', exampleIds: [ex.id], tries: 11 }), { message: 'tries must be 1 to 10' });
  await assert.rejects(runner.start({ workflowId: WF, a: 1, b: 'draft', exampleIds: [], tries: 3 }), { message: 'pick at least one example' });
  await assert.rejects(runner.start({ workflowId: WF, a: 1, b: 'draft', exampleIds: [999], tries: 3 }), { code: 'NOT_FOUND' });
  const empty = example({ name: 'Empty', request: '' });
  await assert.rejects(runner.start({ workflowId: WF, a: 1, b: 'draft', exampleIds: [empty.id], tries: 3 }), { message: 'Write the request of "Empty" first.' });
  const guarded = createTestRunner({ ...harness().deps, targetOf: async (_wf, use, e) => (use === 1
    ? { ready: false, reason: 'pick-project', text: `${e.name} is left out: pick its project first.` } : { ready: true, reason: null, text: null }) });
  await assert.rejects(guarded.start({ workflowId: WF, a: 1, b: 'draft', exampleIds: [ex.id], tries: 1 }),
    { code: 'NOT_READY', message: `${ex.name} is left out: pick its project first.` }, 'review M9: side A is checked too');
  await assert.rejects(runner.start({ workflowId: WF, kind: 'both', a: 1, b: 'draft', exampleIds: [ex.id], tries: 1 }),
    { code: 'BAD_REQUEST', message: 'kind must be "compare" or "once"' });
  await assert.rejects(runner.start({ workflowId: WF, a: 0, b: 'draft', exampleIds: [ex.id], tries: 1 }),
    { code: 'BAD_REQUEST', message: 'pick a saved version or your draft' });
  await assert.rejects(runner.start({ workflowId: WF, kind: 'once', b: 'v2', exampleIds: [ex.id], tries: 1 }),
    { code: 'BAD_REQUEST', message: 'pick a saved version or your draft' });
  const parsed = await runner.start({ workflowId: WF, a: '3', b: 'draft', exampleIds: [ex.id], tries: 1 });
  await runner.idle(parsed.id);
  assert.equal(parsed.a, 3, 'a version number from a route ("3") is parsed');
  assert.ok(store.triesOfRun(parsed.id).filter((t) => t.side === 'a').every((t) => t.use === 3));
  store.createTestRun({ workflowId: WF, a: 1, b: 'draft', aFp: 'x', bFp: 'y', exampleIds: [ex.id], tries: 1 });
  assert.equal(runner.recover(), 1);
});

test('uses: the draft and a version have the same fingerprint until either changes; a Library edit changes both', async () => {
  const { writeGraphWorkflow } = await import('../src/core/workflows.mjs');
  const { createVersion } = await import('../src/core/workflow-versions.mjs');
  const { useFingerprint, useGraph } = await import('../src/core/workflow-tests/uses.mjs');
  const md = join(home, 'planner.md');
  await writeFile(md, 'Plan it.');
  const deps = { registry: { planner: { key: 'planner', origin: 'builtin', agentPath: md, displayName: 'Planner' } }, scripts: {} };
  const tpl = (name) => ({ id: 'wf_uses', name, domain: 'product',
    nodes: [{ id: 'n_task', kind: 'task', x: 0, y: 0, config: {} }, { id: 'n_plan', kind: 'agent', key: 'planner', x: 300, y: 0, config: {} }],
    wires: [{ id: 'w1', from: { node: 'n_task', port: 'task' }, to: { node: 'n_plan', port: 'task' } }] });
  await writeGraphWorkflow(tpl('Uses'));
  await createVersion('wf_uses', { deps });
  const v1 = await useFingerprint('wf_uses', 1, deps);
  assert.equal(await useFingerprint('wf_uses', 'draft', deps), v1);
  const moved = tpl('Uses renamed'); moved.nodes[1] = { ...moved.nodes[1], config: { model: 'sonnet' } };
  await writeGraphWorkflow(moved);
  assert.notEqual(await useFingerprint('wf_uses', 'draft', deps), v1);
  assert.equal((await useGraph('wf_uses', 1)).name, 'Uses');
  await writeFile(md, 'Plan it carefully.');
  assert.notEqual(await useFingerprint('wf_uses', 1, deps), v1, 'every version runs today\'s Library text (D6)');
  await assert.rejects(useFingerprint('wf_uses', 7, deps), { code: 'NOT_FOUND' });
});

// ── Review points (Tasks 3/4): pauses, detaching, an idempotent fail, restarts, errors, never --yes ──────────────

test('a try paused by a drain or a cost/usage limit is stopped, not judged; the test stops; finish the rest re-makes it', async () => {
  for (const k of Object.keys(fps)) delete fps[k];
  let hold = true;
  const h = harness({ plan: () => (hold ? { status: 'done', cost: 0.2, hold: true } : { status: 'done', cost: 0.2 }) });
  const runner = createTestRunner(h.deps);
  const ex = example({ tries: 1 });
  const run = await runner.start({ workflowId: WF, kind: 'once', b: 'draft', exampleIds: [ex.id], tries: 2 });
  await until(() => h.started.length === 2);
  const first = h.entries.get(h.started[0].runKey);
  first.pauseReason = 'drain';
  first.end('paused');
  await runner.idle(run.id);
  const st = store.readTestRun(run.id);
  assert.deepEqual([st.status, st.stopReason, st.stopDetail], ['stopped', 'drain', null], 'the UI words each reason (C7)');
  assert.ok(h.stopped.includes(h.started[0].runKey), 'the paused try was stopped, never left paused');
  assert.deepEqual(statuses(run.id).sort(), ['b1:stopped', 'b2:stopped'], 'a paused try is unfinished, not failed');
  assert.ok(store.triesOfRun(run.id).every((t) => t.verdict === null));
  hold = false;
  await runner.continueRun(run.id);
  await runner.idle(run.id);
  assert.equal(store.readTestRun(run.id).status, 'done');
  assert.deepEqual(statuses(run.id).sort(), ['b1:passed', 'b2:passed']);
  assert.equal(h.started.length, 4, 'both were made again as new tries');

  hold = true;
  const r2 = await runner.start({ workflowId: WF, kind: 'once', b: 'draft', exampleIds: [ex.id], tries: 1 });
  await until(() => h.started.length === 5);
  const limited = h.entries.get(h.started[4].runKey);
  limited.pauseReason = 'cost_total';
  limited.end('paused');
  await runner.idle(r2.id);
  const s2 = store.readTestRun(r2.id);
  assert.deepEqual([s2.stopReason, s2.stopDetail, statuses(r2.id)], ['budget', null, ['b1:stopped']]);
});

test('every answerer is detached when its try ends, the quick check\'s too', async () => {
  const h = harness();
  const runner = createTestRunner(h.deps);
  const ex = example({ tries: 1 });
  const run = await runner.start({ workflowId: WF, a: 1, b: 'draft', exampleIds: [ex.id], tries: 2, quickCheck: true });
  await runner.idle(run.id);
  assert.equal(h.started.length, 6);
  for (const e of h.entries.values()) assert.equal(e.orch.listenerCount('question'), 0);
});

test('a fail that fires twice stops the try once and keeps the first reason', async () => {
  const q = (id, text) => ({ id, kind: 'questions', questions: [{ id: 'q1', question: text, options: ['Yes'] }] });
  const h = harness({ plan: () => ({ status: 'done', cost: 0.1, hold: true }) });
  const runner = createTestRunner(h.deps);
  const ex = example({ otherwise: 'fail', tries: 1 });
  const run = await runner.start({ workflowId: WF, kind: 'once', b: 'draft', exampleIds: [ex.id], tries: 1 });
  await until(() => h.started.length === 1);
  const e = h.entries.get(h.started[0].runKey);
  e.orch.emit('question', q('q-1', 'First?'));
  e.orch.emit('question', q('q-2', 'Second?'));
  await runner.idle(run.id);
  assert.deepEqual(h.stopped, [h.started[0].runKey], 'stopped once');
  const [t] = store.triesOfRun(run.id);
  assert.equal(t.status, 'failed');
  assert.equal(t.verdict.basics[0].detail, 'Worca asked "First?", and this example has no answer for it.');
});

test('a try is never an auto (--yes) run: canned answers need the question to wait', async () => {
  const bodies = [];
  const h = harness();
  const runner = createTestRunner({ ...h.deps, startRun: (body, opts) => { bodies.push(body); return h.deps.startRun(body, opts); } });
  const ex = example({ tries: 1 });
  const run = await runner.start({ workflowId: WF, a: 1, b: 'draft', exampleIds: [ex.id], tries: 1, quickCheck: true });
  await runner.idle(run.id);
  assert.equal(bodies.length, 4);
  for (const b of bodies) assert.ok(!('yes' in b) && !('auto' in b) && !('autoAnswer' in b), JSON.stringify(Object.keys(b)));
});

test('a start that throws leaves no try running: the try waits again and the test stops as error', async () => {
  const h = harness();
  const runner = createTestRunner({ ...h.deps, startRun: async () => { throw new Error('engine went away'); } });
  const ex = example({ tries: 1 });
  const run = await runner.start({ workflowId: WF, a: 1, b: 'draft', exampleIds: [ex.id], tries: 1 });
  await runner.idle(run.id);
  const st = store.readTestRun(run.id);
  assert.deepEqual([st.status, st.stopReason, st.stopDetail], ['stopped', 'error', 'engine went away']);
  assert.deepEqual(statuses(run.id).sort(), ['a1:waiting', 'b1:waiting']);
});

test('a judge that throws stops the try it was judging, never leaves it running', async () => {
  const h = harness();
  const runner = createTestRunner({ ...h.deps, judge: async () => { throw new Error('judge broke'); } });
  const ex = example({ tries: 1 });
  const run = await runner.start({ workflowId: WF, kind: 'once', b: 'draft', exampleIds: [ex.id], tries: 1 });
  await runner.idle(run.id);
  const st = store.readTestRun(run.id);
  assert.deepEqual([st.status, st.stopReason, st.stopDetail], ['stopped', 'error', 'judge broke']);
  const [t] = store.triesOfRun(run.id);
  assert.deepEqual([t.status, t.costUsd], ['stopped', 0.5], 'it ran, so it is stopped with what it spent');
});

test('a refused quick check (a drain) stops the test as drain, and the quick check still waits', async () => {
  const h = harness({ refuse: { status: 503, body: { error: 'Worca is shutting down' } } });
  const runner = createTestRunner(h.deps);
  const ex = example({ tries: 1 });
  const run = await runner.start({ workflowId: WF, a: 1, b: 'draft', exampleIds: [ex.id], tries: 1, quickCheck: true });
  await runner.idle(run.id);
  const st = store.readTestRun(run.id);
  assert.deepEqual([st.status, st.stopReason, st.stopDetail, st.quick], ['stopped', 'drain', 'Worca is shutting down', { status: 'waiting' }]);
});

test('after a restart: running tries are stopped, waiting ones stay waiting, and finish the rest makes them all', async () => {
  for (const k of Object.keys(fps)) delete fps[k];
  const ex = example({ tries: 1 });
  const run = store.createTestRun({ workflowId: WF, a: 1, b: 'draft', aFp: 'fp-1', bFp: 'fp-draft', exampleIds: [ex.id], tries: 2 });
  const mk = (side, use, n) => {
    const t = store.insertTry({ runId: run.id, workflowId: WF, exampleId: ex.id, use, fp: `fp-${use}`, exampleFp: ex.fingerprint, tryNo: n });
    store.linkTry(run.id, t.id, side);
    return t;
  };
  store.updateTry(mk('a', 1, 1).id, { status: 'running', costUsd: 0.25 });
  store.updateTry(mk('b', 'draft', 1).id, { status: 'running' });
  mk('a', 1, 2); mk('b', 'draft', 2);
  const h = harness();
  const runner = createTestRunner(h.deps);
  assert.equal(runner.recover(), 1);
  assert.deepEqual([store.readTestRun(run.id).status, store.readTestRun(run.id).stopReason], ['stopped', 'restart']);
  assert.deepEqual(statuses(run.id).sort(), ['a1:stopped', 'a2:waiting', 'b1:stopped', 'b2:waiting']);
  await runner.continueRun(run.id);
  await runner.idle(run.id);
  assert.equal(store.readTestRun(run.id).status, 'done');
  assert.deepEqual(statuses(run.id).sort(), ['a1:passed', 'a2:passed', 'b1:passed', 'b2:passed']);
  assert.equal(h.started.length, 4);
  assert.equal(store.spentOfRun(run.id), 2.25, 'the stopped tries still count in the cost');
});

test('two "Finish the rest" at once: one runs, the other is BUSY', async () => {
  for (const k of Object.keys(fps)) delete fps[k];
  const h = harness();
  const runner = createTestRunner(h.deps);
  const ex = example({ tries: 1 });
  const run = store.createTestRun({ workflowId: WF, kind: 'once', b: 'draft', bFp: 'fp-draft', exampleIds: [ex.id], tries: 1 });
  const t = store.insertTry({ runId: run.id, workflowId: WF, exampleId: ex.id, use: 'draft', fp: 'fp-draft', exampleFp: ex.fingerprint, tryNo: 1 });
  store.linkTry(run.id, t.id, 'b');
  runner.recover();
  const both = await Promise.allSettled([runner.continueRun(run.id), runner.continueRun(run.id)]);
  assert.deepEqual(both.map((x) => x.status).sort(), ['fulfilled', 'rejected']);
  assert.equal(both.find((x) => x.status === 'rejected').reason.code, 'BUSY');
  await runner.idle(run.id);
  assert.equal(h.started.length, 1);
});

// ── Fix 1 (review of Task 7): a pause is mapped by its real code ────────────────────────────────────────────────

/** Start a one-try test, pause its try with `reason` (and `detail`), and wait for the test to end. */
async function pauseOne(h, runner, ex, reason, detail = null) {
  const n = h.started.length;
  const r = await runner.start({ workflowId: WF, kind: 'once', b: 'draft', exampleIds: [ex.id], tries: 1 });
  await until(() => h.started.length > n);
  const e = h.entries.get(h.started.at(-1).runKey);
  Object.assign(e, { pauseReason: reason, pauseDetail: detail });
  e.end('paused');
  await runner.idle(r.id);
  return { run: store.readTestRun(r.id), runKey: e.runKey ?? h.started.at(-1).runKey };
}

test('an error pause is a finished, failed try; other pauses stop the test as refused or budget (Fix 1)', async () => {
  for (const k of Object.keys(fps)) delete fps[k];
  const h = harness({ plan: () => ({ status: 'done', cost: 0.3, hold: true }) });
  const runner = createTestRunner(h.deps);
  const ex = example({ tries: 1 });
  const broken = await pauseOne(h, runner, ex, 'error', 'Planner: the model answered nothing');
  assert.deepEqual([broken.run.status, broken.run.stopReason], ['done', null], 'a broken workflow is a result, not a stopped test');
  const [t] = store.triesOfRun(broken.run.id);
  assert.deepEqual([t.status, t.costUsd, t.verdict.basics[0].detail], ['failed', 0.3, 'A step failed: Planner: the model answered nothing.']);
  assert.ok(h.stopped.includes(h.started.at(-1).runKey), 'the paused run is stopped, never left paused');
  const odd = await pauseOne(h, runner, ex, 'something_new');
  const [o] = store.triesOfRun(odd.run.id);
  assert.deepEqual([o.status, o.verdict.basics[0].detail], ['failed', 'A step failed: the try paused.'], 'an unknown code is judged like an error');

  for (const [code, label] of [['usage_limit', 'the AI account reached its usage limit'], ['terminated', 'the run was ended'],
    ['recoverable', 'a step hit an error that Worca could retry'], ['night_guardrail', "Away mode's safety limit paused it"]]) {
    const { run } = await pauseOne(h, runner, ex, code);
    assert.deepEqual([run.status, run.stopReason, run.stopDetail, statuses(run.id)], ['stopped', 'refused', label, ['b1:stopped']], code);
  }
  for (const code of ['cost_pipeline', 'cost_total', 'cost_pipeline_policy', 'cost_total_policy']) {
    const { run } = await pauseOne(h, runner, ex, code);
    assert.deepEqual([run.stopReason, run.stopDetail, statuses(run.id)], ['budget', null, ['b1:stopped']], code);
  }
});

test('an error pause in the quick check fails it with the reason; nothing real is tried (Fix 1)', async () => {
  const h = harness({ plan: (body) => (body.mock ? { status: 'done', cost: 0, hold: true } : { status: 'done', cost: 0.5 }) });
  const runner = createTestRunner(h.deps);
  const ex = example({ tries: 1 });
  const run = await runner.start({ workflowId: WF, a: 1, b: 'draft', exampleIds: [ex.id], tries: 1, quickCheck: true });
  await until(() => h.started.length === 1);
  const e = h.entries.get(h.started[0].runKey);
  Object.assign(e, { pauseReason: 'error', pauseDetail: 'Planner: no output' });
  e.end('paused');
  await runner.idle(run.id);
  const st = store.readTestRun(run.id);
  assert.deepEqual([st.status, st.stopReason, st.quick], ['stopped', 'quick-check', { status: 'failed', detail: 'a step failed: Planner: no output' }]);
  assert.equal(h.started.length, 1);
  assert.ok(h.stopped.includes(h.started[0].runKey));
});

// ── Fix 2: nobody pauses a hidden try; the refused details are the runner's own words ────────────────────────────

test('a pause with no reason is a failed try, never a person\'s stop; in the quick check it fails the check (Fix 2)', async () => {
  for (const k of Object.keys(fps)) delete fps[k];
  const h = harness({ plan: () => ({ status: 'done', cost: 0.1, hold: true }) });
  const runner = createTestRunner(h.deps);
  const ex = example({ tries: 1 });
  for (const reason of [null, undefined, 'manual']) {
    const { run } = await pauseOne(h, runner, ex, reason);
    assert.deepEqual([run.status, run.stopReason], ['done', null], String(reason));
    const [t] = store.triesOfRun(run.id);
    assert.deepEqual([t.status, t.verdict.basics[0].detail], ['failed', 'A step failed: the try paused.'], String(reason));
  }
  const n = h.started.length;
  const quick = await runner.start({ workflowId: WF, kind: 'once', b: 'draft', exampleIds: [ex.id], tries: 1, quickCheck: true });
  await until(() => h.started.length > n);
  h.entries.get(h.started.at(-1).runKey).end('paused');
  await runner.idle(quick.id);
  const st = store.readTestRun(quick.id);
  assert.deepEqual([st.stopReason, st.quick], ['quick-check', { status: 'failed', detail: 'a step failed: the try paused' }]);
});

test('the refused details are pinned, with no full stop: the UI says "Stopped: <reason>." (Fix 2)', () => {
  assert.deepEqual({ ...PAUSE_REFUSED_TEXT }, {
    usage_limit: 'the AI account reached its usage limit',
    recoverable: 'a step hit an error that Worca could retry',
    terminated: 'the run was ended',
    night_guardrail: "Away mode's safety limit paused it",
  });
  assert.equal(PAUSE_REFUSED_OTHER, 'the try could not go on');
  for (const text of [...Object.values(PAUSE_REFUSED_TEXT), PAUSE_REFUSED_OTHER]) assert.doesNotMatch(text, /[.!?]$/);
  assert.deepEqual(pauseVerdict('usage_limit'), { stop: 'refused', detail: 'the AI account reached its usage limit' });
  assert.deepEqual(pauseVerdict(null), { fail: true, detail: 'a step failed: the try paused' });
  assert.deepEqual(pauseVerdict('error', 'Planner: no output.\nstack…'), { fail: true, detail: 'a step failed: Planner: no output' }, 'one line, no full stop');
});

test('a 403 that is not about spending stops the test as refused, not budget (Fix 1)', async () => {
  const ex = example({ tries: 1 });
  const owner = createTestRunner(harness({ refuse: { status: 403, body: { error: 'Only the owner can start runs here.' } } }).deps);
  const r1 = await owner.start({ workflowId: WF, kind: 'once', b: 'draft', exampleIds: [ex.id], tries: 1 });
  await owner.idle(r1.id);
  const s1 = store.readTestRun(r1.id);
  assert.deepEqual([s1.stopReason, s1.stopDetail], ['refused', 'Only the owner can start runs here.']);
  const team = createTestRunner(harness({ refuse: { status: 403, body: { error: 'team total cap reached ($5.00 >= $5.00 this week, x)', code: 'team_total' } } }).deps);
  const r2 = await team.start({ workflowId: WF, kind: 'once', b: 'draft', exampleIds: [ex.id], tries: 1 });
  await team.idle(r2.id);
  assert.equal(store.readTestRun(r2.id).stopReason, 'budget');
});

test('a test stopped while the quick check starts stops the quick check run too (Fix 1)', async () => {
  const h = harness({ plan: () => ({ status: 'done', cost: 0, hold: true }) });
  let release;
  const gate = new Promise((r) => { release = r; });
  const runner = createTestRunner({ ...h.deps, startRun: async (body, opts) => { await gate; return h.deps.startRun(body, opts); } });
  const ex = example({ tries: 1 });
  const run = await runner.start({ workflowId: WF, kind: 'once', b: 'draft', exampleIds: [ex.id], tries: 1, quickCheck: true });
  const stopping = runner.stop(run.id);
  release();
  await stopping;
  assert.equal(h.started.length, 1);
  assert.ok(h.stopped.includes(h.started[0].runKey), 'the quick check run that started late is stopped');
  const st = store.readTestRun(run.id);
  assert.deepEqual([st.stopReason, st.quick], ['person', { status: 'waiting' }]);
});

// Final review M4: a test whose close failed stayed running in the store, so the workflow was BUSY until a restart.
const CLOSE_TRIGGER = 'wft_test_close_fails';
const failCloses = (when) => getDb().exec(`CREATE TEMP TRIGGER ${CLOSE_TRIGGER} BEFORE UPDATE OF status ON wf_test_runs
  WHEN ${when} BEGIN SELECT RAISE(ABORT, 'disk I/O error'); END`);
const closesWork = () => getDb().exec(`DROP TRIGGER IF EXISTS ${CLOSE_TRIGGER}`);
const quietly = async (fn) => { const e = console.error; console.error = () => {}; try { return await fn(); } finally { console.error = e; } };

test('a close that fails is recorded as an error stop, so the workflow is not left BUSY (M4)', async () => {
  const h = harness();
  const runner = createTestRunner(h.deps);
  const ex = example({ tries: 1 });
  failCloses("NEW.status = 'done'");
  try {
    const run = await quietly(async () => {
      const r = await runner.start({ workflowId: WF, a: 1, b: 'draft', exampleIds: [ex.id], tries: 1 });
      await runner.idle(r.id);
      return r;
    });
    const st = store.readTestRun(run.id);
    assert.deepEqual([st.status, st.stopReason, st.stopDetail], ['stopped', 'error', 'Worca could not save how this test ended']);
    assert.ok(st.finishedAt);
    assert.equal(store.runningTestRun(WF), null, 'the workflow is free');
  } finally { closesWork(); }
  const next = await runner.start({ workflowId: WF, a: 1, b: 'draft', exampleIds: [ex.id], tries: 1 });
  await runner.idle(next.id);
  assert.equal(store.readTestRun(next.id).status, 'done');
});

test('a test left running with nothing driving it: Stop testing ends it at once and frees the workflow (M4)', async () => {
  const h = harness();
  const frames = [];
  const runner = createTestRunner({ ...h.deps, notify: (f) => frames.push(f) });
  const ex = example({ tries: 1 });
  failCloses("NEW.status IN ('done', 'stopped')");
  let run;
  try {
    run = await quietly(async () => {
      const r = await runner.start({ workflowId: WF, a: 1, b: 'draft', exampleIds: [ex.id], tries: 1 });
      await runner.idle(r.id);
      return r;
    });
    assert.equal(store.readTestRun(run.id).status, 'running', 'the store could not be written');
    await assert.rejects(runner.start({ workflowId: WF, a: 1, b: 'draft', exampleIds: [ex.id], tries: 1 }), (e) => e.code === 'BUSY');
  } finally { closesWork(); }
  frames.length = 0;
  const stopped = await runner.stop(run.id);
  assert.deepEqual([stopped.status, stopped.stopReason, stopped.stopDetail], ['stopped', 'error', 'Worca could not save how this test ended']);
  assert.ok(stopped.finishedAt);
  assert.deepEqual(frames.map((f) => [f.testRunId, f.finished, f.status]), [[run.id, true, 'stopped']], 'the open pages hear it ended');
  const next = await runner.start({ workflowId: WF, a: 1, b: 'draft', exampleIds: [ex.id], tries: 1 });
  await runner.idle(next.id);
  assert.equal(store.readTestRun(next.id).status, 'done');
});

test('a start that answers without its pipeline id: the try row gets the id from liveRun after the settle (3a Task 8)', async () => {
  const h = harness();
  const startRun = h.deps.startRun;
  const runner = createTestRunner({ ...h.deps, startRun: async (...a) => { const out = await startRun(...a); return { ...out, body: { runId: out.body.runId } }; } });
  const ex = example({ tries: 1 });
  const run = await runner.start({ workflowId: WF, kind: 'once', b: 'draft', exampleIds: [ex.id], tries: 1 });
  await runner.idle(run.id);
  const [t] = store.triesOfRun(run.id);
  assert.equal(t.status, 'passed');
  assert.equal(t.pipelineId, h.entries.get(t.runKey).pipelineId, 'the id liveRun carries');
});

test('the try row gets its pipeline id as soon as the run\'s state names it, while the try still runs (3a Task 8)', async () => {
  const h = harness({ plan: () => ({ status: 'done', cost: 0.1, hold: true }) });
  const startRun = h.deps.startRun;
  const runner = createTestRunner({ ...h.deps, startRun: async (...a) => { const out = await startRun(...a); return { ...out, body: { runId: out.body.runId } }; },
    liveRun: (k) => { const e = h.entries.get(k); return e ? { ...e, pipelineId: e.announced ? e.pipelineId : null } : null; } });
  const ex = example({ tries: 1 });
  const run = await runner.start({ workflowId: WF, kind: 'once', b: 'draft', exampleIds: [ex.id], tries: 1 });
  await until(() => store.triesOfRun(run.id)[0].runKey);
  const [t0] = store.triesOfRun(run.id);
  const e = h.entries.get(t0.runKey);
  assert.equal(t0.pipelineId, null, 'not known yet');
  e.announced = true;
  e.orch.emit('state', { id: e.pipelineId, status: 'running' });
  await until(() => store.triesOfRun(run.id)[0].pipelineId === e.pipelineId);
  assert.equal(store.triesOfRun(run.id)[0].status, 'running', 'written while the try runs: a crash now keeps it');
  e.end('done');
  await runner.idle(run.id);
  const [t] = store.triesOfRun(run.id);
  assert.deepEqual([t.status, t.pipelineId], ['passed', e.pipelineId], 'never overwritten');
});
