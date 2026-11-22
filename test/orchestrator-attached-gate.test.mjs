// test/orchestrator-attached-gate.test.mjs — the agreement gate for attached Requirements features on the real
// orchestrator in mock mode: nothing runs before the person agrees to every Not-Ready feature; an all-Ready run is
// never asked; a bad answer is refused (422) and leaves the ask open; Stop stops; a resume re-raises an open ask and
// stays quiet once everything is agreed.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { gitDir } from './helpers/git-dir.mjs';
import { createOrchestrator } from '../src/core/orchestrator.mjs';
import { readPipelineForResume } from '../src/core/artifacts.mjs';

useTempHome(after);

let sandboxHome;
const prevEnv = {};
const ENV = ['HOME', 'USERPROFILE', 'WORCA_TEST_ALLOW_HOME_FALLBACK'];
before(async () => {
  sandboxHome = await mkdtemp(join(tmpdir(), 'worca-attgate-home-'));
  for (const k of ENV) prevEnv[k] = process.env[k];
  process.env.HOME = sandboxHome;
  process.env.USERPROFILE = sandboxHome;
  process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = '1';
});
after(async () => {
  for (const k of ENV) { if (prevEnv[k] === undefined) delete process.env[k]; else process.env[k] = prevEnv[k]; }
  await rm(sandboxHome, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

const READY = { seq: 1, id: 'FEAT-1', title: 'Ready one', version: 2, ready: true, criteriaCount: 4, agreed: true };
const DRAFT = { seq: 2, id: 'FEAT-2', title: 'Draft two', version: 1, ready: false, criteriaCount: 0, agreed: false };
// The setup preflight reports an exec of its own before the engine starts; only graph nodes count.
const isNode = (e) => e.status === 'start' && e.kind !== 'task' && e.nodeId !== 'preflight';
const started = (execs) => execs.filter(isNode);
const isAttachedAsk = (q) => q.kind === 'plan' && !!q.plan?.attached;

/** A mock run carrying `attached`. `onAsk(q, orch, execs)` answers each attached ask (default: agree to every pending seq). */
function start(attached, { onAsk, resume } = {}) {
  const dir = resume?.dir || gitDir('attgate');
  const orch = createOrchestrator({ projectDir: dir, workflowId: 'wf_default', prompt: 'demo', auto: true, claude: { mock: true },
    ...(attached ? { attachedRequirements: attached } : {}), ...(resume ? { resume: resume.opts } : {}) });
  const asks = []; const execs = []; const order = [];
  orch.on('exec', (e) => { execs.push(e); if (isNode(e)) order.push(`exec:${e.nodeId}`); });
  orch.on('question', (q) => {
    asks.push(q);
    if (isAttachedAsk(q)) {
      order.push('ask');
      const answer = onAsk || ((qq, o) => o.answer(qq.id, { decision: 'approve', agreedSeqs: qq.plan.attached.features.filter((f) => !f.agreed).map((f) => f.seq) }));
      setImmediate(() => answer(q, orch, execs));
      return;
    }
    if (q.kind === 'plan') setImmediate(() => orch.answer(q.id, { decision: 'approve' }));
    else if (q.kind === 'clarify' || q.kind === 'questions') setImmediate(() => orch.answer(q.id, { answers: [] }));
  });
  const done = resume ? orch.resume() : orch.run();
  return { orch, asks, execs, order, done, dir };
}

test('every feature Ready: no attached ask, the run goes straight to its nodes', async () => {
  const h = start([READY]);
  const res = await h.done;
  assert.equal(res.status, 'done', `${res.error} | ${h.orch.pauseDetail}`);
  assert.equal(h.asks.filter(isAttachedAsk).length, 0);
});

test('a run with no attachedRequirements never asks', async () => {
  const h = start(null);
  const res = await h.done;
  assert.equal(res.status, 'done', `${res.error} | ${h.orch.pauseDetail}`);
  assert.equal(h.asks.filter(isAttachedAsk).length, 0);
  assert.equal('attachedRequirements' in (h.orch._buildResumePoint(null)), false, 'the resume point is unchanged');
});

test('a Not-Ready feature pauses before the first node: one ask, no node runs until the answer', async () => {
  let nodesAtAsk = null;
  const h = start([READY, DRAFT], {
    onAsk: (q, orch, execs) => {
      nodesAtAsk = started(execs).length;
      orch.answer(q.id, { decision: 'approve', agreedSeqs: [2] });
    },
  });
  const res = await h.done;
  assert.equal(res.status, 'done', `${res.error} | ${h.orch.pauseDetail}`);
  const asks = h.asks.filter(isAttachedAsk);
  assert.equal(asks.length, 1);
  assert.equal(nodesAtAsk, 0, 'nothing ran while the ask was open');
  assert.equal(h.order[0], 'ask', 'the ask came before any node');
  assert.deepEqual(asks[0].plan.attached.features.map((f) => [f.seq, f.id, f.title, f.criteriaCount, f.agreed]),
    [[1, 'FEAT-1', 'Ready one', 4, true], [2, 'FEAT-2', 'Draft two', 0, false]]);
  assert.equal(asks[0].plan.revisable, false, 'it is not revisable');
  assert.equal(h.orch.attachedRequirements.find((f) => f.seq === 2).agreed, true, 'the agreement is stored');
});

test('approve that misses a pending seq is refused with 422 errors and the ask stays open', async () => {
  let refused = null;
  let open = null;
  const h = start([DRAFT], {
    onAsk: (q, orch) => {
      try { orch.answer(q.id, { decision: 'approve', agreedSeqs: [] }); } catch (e) { refused = e; }
      open = orch.pendingQuestion?.id === q.id;
      orch.answer(q.id, { decision: 'approve', agreedSeqs: [2] });
    },
  });
  const res = await h.done;
  assert.equal(res.status, 'done', `${res.error} | ${h.orch.pauseDetail}`);
  assert.equal(refused?.code, 'INVALID_ANSWER');
  assert.match(refused.errors[0].message, /2/);
  assert.equal(open, true);
});

test('stop on the ask stops the run before any node ran', async () => {
  const h = start([DRAFT], { onAsk: (q, orch) => orch.answer(q.id, { decision: 'stop' }) });
  const res = await h.done;
  assert.equal(res.status, 'stopped');
  assert.equal(started(h.execs).length, 0);
});

test('the open ask is stamped on the resume point: it carries the list, agreements included', async () => {
  let point = null;
  const h = start([READY, DRAFT], {
    onAsk: (q, orch) => { point = orch.state.resumePoint; orch.answer(q.id, { decision: 'approve', agreedSeqs: [2] }); },
  });
  await h.done;
  assert.deepEqual(point.attachedRequirements.map((f) => [f.seq, f.agreed]), [[1, true], [2, false]]);
  assert.equal(point.snapshot, null);
});

test('resume: an ask left open is raised again; once everything is agreed a resume does not ask', async () => {
  // First run: pause while the ask is open.
  const first = start([DRAFT], { onAsk: (q, orch) => { orch.pause(); } });
  const r1 = await first.done;
  assert.equal(r1.status, 'paused', r1.error);
  const opts1 = readPipelineForResume(first.orch.getState().id);
  assert.deepEqual(opts1.resumePoint.attachedRequirements.map((f) => [f.seq, f.agreed]), [[2, false]]);
  const second = start(null, { resume: { dir: first.dir, opts: opts1 } });
  const r2 = await second.done;
  assert.equal(r2.status, 'done', r2.error);
  assert.equal(second.asks.filter(isAttachedAsk).length, 1, 'raised again after the restart');
  assert.deepEqual(second.orch.attachedRequirements.map((f) => f.agreed), [true]);
});
