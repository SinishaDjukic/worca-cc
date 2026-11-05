// test/orchestrator-plan-concern.test.mjs — #990 s5: the implementer's plan concern re-raises the plan approval.
import { test, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile, symlink, utimes, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { gitDir } from './helpers/git-dir.mjs';
import { createOrchestrator } from '../src/core/orchestrator.mjs';
import { readPipelineForResume } from '../src/core/artifacts.mjs';
import { createSliceFeature } from '../src/core/shape/features.mjs';
import { getDb } from '../src/core/db.mjs';
import { _testing } from '../src/core/graph/executor.mjs';
import { runClaude } from '../src/core/claude-runner.mjs';
import { MOCK_OUTLINE } from '../src/core/engines/mock.mjs';

useTempHome(after);

const CONCERN = { title: 'Store export jobs in the DB, not in memory', detail: 'A restart loses queued exports.', section: 'Decisions' };
let sandboxHome;
const prevEnv = {};
const ENV = ['HOME', 'USERPROFILE', 'WORCA_TEST_ALLOW_HOME_FALLBACK', 'WORCA_MOCK_PLAN_CONCERN'];
before(async () => {
  sandboxHome = await mkdtemp(join(tmpdir(), 'worca-plan-concern-home-'));
  for (const k of ENV) prevEnv[k] = process.env[k];
  process.env.HOME = sandboxHome;
  process.env.USERPROFILE = sandboxHome;
  process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = '1';
});
afterEach(() => { delete process.env.WORCA_MOCK_PLAN_CONCERN; _testing.runClaude = null; });
after(async () => {
  for (const k of ENV) { if (prevEnv[k] === undefined) delete process.env[k]; else process.env[k] = prevEnv[k]; }
  await rm(sandboxHome, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

const waitFor = async (pred, ms = 60000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (pred()) return; await new Promise((r) => setTimeout(r, 10)); }
  throw new Error('waitFor timed out');
};
const approve = (q, orch) => orch.answer(q.id, { decision: 'approve' });
const IMPL = /^MOCK_ROLE: implementer$/m;
const raise = () => { process.env.WORCA_MOCK_PLAN_CONCERN = JSON.stringify(CONCERN); };
/** opts.afterImpl(orch, prompt): runs after each mock implementer call, before its result returns (installed before run()). */
function start(opts = {}, onPlan = approve) {
  const { afterImpl, ...rest } = opts;
  const dir = rest.projectDir || gitDir('concern');
  const orch = createOrchestrator({ projectDir: dir, workflowId: 'wf_shape', prompt: 'demo', claude: { mock: true },
    shape: { perspectives: ['product', 'qa'] }, ...rest });
  const plans = []; const execs = []; const prompts = []; const questions = [];
  _testing.runClaude = async (o) => {
    prompts.push(o.prompt);
    const r = await runClaude(o);
    if (afterImpl && IMPL.test(o.prompt)) await afterImpl(orch, o.prompt);
    return r;
  };
  orch.on('exec', (e) => execs.push(e));
  orch.on('question', (q) => {
    questions.push(q);
    if (q.kind === 'plan') { plans.push(q); setImmediate(() => onPlan(q, orch)); return; }
    if (q.kind === 'gate') { setImmediate(() => orch.answer(q.id, { decision: 'continue' })); return; }
    if (q.kind === 'clarify' || q.kind === 'questions') setImmediate(() => orch.answer(q.id, { answers: [] }));
  });
  const done = rest.resume ? orch.resume() : orch.run();
  return { orch, plans, execs, prompts, questions, done, dir };
}
const shells = (execs, nodeId) => execs.filter((e) => e.nodeId === nodeId && e.kind !== 'task' && e.status === 'start');
const auditOf = (orch) => getDb().prepare('SELECT text FROM pipeline_events WHERE pipeline_id = ?').all(orch.getState().id).map((r) => r.text);
const concernFile = (orch) => join(orch.pipeline.dir, 'n_impl-plan-concern-c1.json');
const implPrompts = (h) => h.prompts.filter((p) => IMPL.test(p));

test('#990 s5 a concern re-raises the plan approval before the build is reviewed', async () => {
  raise();
  let reviewsAtAsk = null;
  const h = start({}, (q, orch) => {
    if (!q.concern) return approve(q, orch);
    reviewsAtAsk = shells(h.execs, 'n_review').length;
    return orch.answer(q.id, { decision: 'stop' });
  });
  await h.done;
  assert.deepEqual(h.plans.map((q) => q.id), ['plan-n_refine-1', 'plan-concern-n_impl-c1']);
  const c = h.plans[1];
  assert.equal(c.kind, 'plan');
  assert.equal(c.concern.title, CONCERN.title);
  assert.equal(c.plan.round, 1, 'the live approval round');
  assert.equal(c.plan.revisable, true);
  assert.equal(c.plan.nodeId, 'n_refine');
  assert.equal(reviewsAtAsk, 0, 'the held-back build is not reviewed');
  assert.ok(implPrompts(h)[0].includes('## Plan concern'));
  assert.ok(auditOf(h.orch).some((t) => t.endsWith(` raised a plan concern: "${CONCERN.title}".`)));
});

test('#990 s5 Ask for changes accepts the concern: n_plan re-runs with the concern in its revise input', async () => {
  raise();
  let reviewsBeforeRound2 = null;
  const h = start({ afterImpl: () => { delete process.env.WORCA_MOCK_PLAN_CONCERN; } }, (q, orch) => {
    if (q.id === 'plan-n_refine-2') reviewsBeforeRound2 = shells(h.execs, 'n_review').length;
    if (!q.concern) return approve(q, orch);
    return orch.answer(q.id, { decision: 'revise', feedback: 'Take the concern.' });
  });
  assert.equal((await h.done).status, 'done');
  assert.deepEqual(h.plans.map((q) => q.id), ['plan-n_refine-1', 'plan-concern-n_impl-c1', 'plan-n_refine-2']);
  assert.equal(shells(h.execs, 'n_plan').length, 2);
  assert.equal(reviewsBeforeRound2, 0, 'no done was published for the held-back build');
  const fbPath = join(h.orch.pipeline.dir, 'plan-concern-feedback-c1.md');
  const fb = await readFile(fbPath, 'utf8');
  assert.match(fb, /Take the concern\./);
  assert.match(fb, /^## The implementer's plan concern$/m);
  assert.match(fb, /Store export jobs in the DB, not in memory/);
  assert.match(fb, /^> A restart loses queued exports\.$/m);
  const planner2 = h.prompts.filter((p) => /^MOCK_ROLE: planner/m.test(p))[1];
  assert.ok(planner2.includes('plan-concern-feedback-c1.md'), 'the second planner run binds the concern feedback');
  assert.ok(auditOf(h.orch).some((t) => /Plan concern \*\*accepted\*\*/.test(t)));
});

test('#990 s5 Approve overrides the concern: the implementer re-runs with the override note and the plan is unchanged', async () => {
  raise();
  let planFile = null; let planBytes = null;
  const h = start({}, async (q, orch) => {
    if (!q.concern) { planFile = q.plan.file; planBytes = await readFile(planFile, 'utf8'); }
    approve(q, orch);
  });
  assert.equal((await h.done).status, 'done');
  assert.deepEqual(h.plans.map((q) => q.id), ['plan-n_refine-1', 'plan-concern-n_impl-c1'], 'exactly 2 plan asks');
  assert.equal(shells(h.execs, 'n_plan').length, 1);
  const impls = implPrompts(h);                  // [the build, its override re-run, then any review fix runs]
  assert.match(impls[1], /## Plan concern overridden/);
  assert.ok(impls[1].includes(CONCERN.title));
  assert.equal(impls.filter((p) => /## Plan concern overridden/.test(p)).length, 1, 'n_impl re-ran once for the override');
  assert.ok(impls.slice(1).every((p) => !/MOCK_PLAN_CONCERN/.test(p)), 'no later run is offered a second concern');
  assert.equal(await readFile(planFile, 'utf8'), planBytes);
  assert.ok(auditOf(h.orch).some((t) => /Plan concern \*\*overridden\*\*/.test(t)));
});

test('#990 s5 under --yes the concern is overridden without an ask and the audit log says so', async () => {
  raise();
  const h = start({ auto: true });            // the plan approval itself still needs a person: `approve` answers it
  assert.equal((await h.done).status, 'done');
  assert.equal(h.questions.filter((q) => q.concern).length, 0, 'no concern ask is raised');
  assert.equal(shells(h.execs, 'n_plan').length, 1);
  assert.match(implPrompts(h)[1], /## Plan concern overridden/);
  assert.ok(auditOf(h.orch).some((t) => t.startsWith(`Plan concern overridden automatically (--yes): "${CONCERN.title}".`)));
});

test('#990 s5 Away mode without --yes waits for a person: the concern ask is pending and not armed', async () => {
  raise();
  const clock = { now: () => Date.now(), setTimeout: () => 0, clearTimeout: () => {} };
  const armed = [];
  const h = start({ projectDir: gitDir('concern-away'), nightMode: true, nightClock: clock },
    (q, orch) => { if (!q.concern) approve(q, orch); });
  h.orch._nightActiveNow = () => true;
  const orig = h.orch._nightArm.bind(h.orch);
  h.orch._nightArm = (q) => { armed.push(q); return orig(q); };
  await waitFor(() => h.plans.length === 2);
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(h.orch.pendingQuestion?.id, 'plan-concern-n_impl-c1', 'still waiting for a person');
  assert.ok(!armed.some((q) => q?.concern), 'no Away arm for the concern ask');
  h.orch.answer('plan-concern-n_impl-c1', { decision: 'approve' });
  assert.equal((await h.done).status, 'done');
});

test('#990 s5 a Default run\'s implementer is not offered a concern', async () => {
  raise();
  const h = start({ workflowId: 'wf_default', shape: undefined });
  assert.equal((await h.done).status, 'done');
  assert.ok(implPrompts(h).length >= 1);
  assert.ok(implPrompts(h).every((p) => !/MOCK_PLAN_CONCERN|## Plan concern/.test(p)));
  assert.equal(h.questions.filter((q) => q.concern).length, 0);
});

test('#990 s5 a concern file linked to a target outside the pipeline dir raises no ask and is audited', async () => {
  const outside = await mkdtemp(join(tmpdir(), 'worca-concern-outside-'));
  const target = join(outside, 'c.json');
  await writeFile(target, JSON.stringify(CONCERN), 'utf8');      // fresh: only containment can refuse it
  const h = start({ afterImpl: async (orch) => { await unlink(concernFile(orch)).catch(() => {}); await symlink(target, concernFile(orch)); } });
  assert.equal((await h.done).status, 'done');
  assert.deepEqual(h.plans.map((q) => q.id), ['plan-n_refine-1']);
  assert.ok(auditOf(h.orch).some((t) => t.includes('plan-concern.json ignored (outside the pipeline dir)')));
  await rm(outside, { recursive: true, force: true });
});

test('#990 s5 a concern file older than the execution is not read', async () => {
  const h = start({ afterImpl: async (orch) => {
    await writeFile(concernFile(orch), JSON.stringify(CONCERN), 'utf8');
    const old = new Date(Date.now() - 3600_000);
    await utimes(concernFile(orch), old, old);
  } });
  assert.equal((await h.done).status, 'done');
  assert.deepEqual(h.plans.map((q) => q.id), ['plan-n_refine-1']);
  assert.equal(auditOf(h.orch).some((t) => t.includes('raised a plan concern')), false);
});

// A real agent whose session is resumed does not write the concern file again: only the first spawn writes it.
const writeOnce = { afterImpl: () => { delete process.env.WORCA_MOCK_PLAN_CONCERN; } };
const PLAIN_BLOCK = /^## Plan concern$/m;
const OVERRIDE_BLOCK = /^## Plan concern overridden$/m;
/** Resume `saved`, recording how many n_review executions had started when the override re-run finished. */
function resumeCountingReviews(dir, saved, onPlan) {
  const atOverride = [];
  const h = start({ projectDir: dir, resume: saved, shape: undefined,
    afterImpl: (orch, prompt) => { if (OVERRIDE_BLOCK.test(prompt)) atOverride.push(shells(h.execs, 'n_review').length); } }, onPlan);
  h.atOverride = atOverride;
  return h;
}
const assertOverrideReviewedAfter = (h) => {
  assert.equal(h.atOverride[0], 0, 'the held-back build is not reviewed');
  assert.ok(shells(h.execs, 'n_review').length > 0, 'the overridden build is reviewed');
  assert.ok(implPrompts(h).some((p) => OVERRIDE_BLOCK.test(p) && p.includes(CONCERN.title)));
};

test('#990 s5 an answer given just before a pause is replayed on resume, not asked again', async () => {
  raise();
  const a = start(writeOnce, (q, orch) => {
    if (!q.concern) return approve(q, orch);
    orch.answer(q.id, { decision: 'approve' });
    orch.pause();                               // same tick: the graph-ask-kind-traps pause window
  });
  assert.equal((await a.done).status, 'paused');
  const saved = await readPipelineForResume(a.orch.getState().id);
  const b = resumeCountingReviews(a.dir, saved);
  assert.equal((await b.done).status, 'done');
  assert.equal(b.plans.filter((q) => q.concern).length, 0, 'the concern is not asked again');
  assertOverrideReviewedAfter(b);
});

test('#990 s5 pausing and resuming audits one concern once', async () => {
  raise();
  const a = start(writeOnce, (q, orch) => (q.concern ? orch.pause() : approve(q, orch)));   // paused while the ask is open
  assert.equal((await a.done).status, 'paused');
  const b = start({ projectDir: a.dir, resume: await readPipelineForResume(a.orch.getState().id), shape: undefined }, (q, orch) => {
    orch.answer(q.id, { decision: 'approve' });
    orch.pause();                                 // answered, then paused in the same tick
  });
  assert.equal((await b.done).status, 'paused');
  assert.equal(b.plans.filter((q) => q.concern).length, 1, 'the open ask is raised again on resume');
  assert.equal(b.plans.find((q) => q.concern).concern.title, CONCERN.title);
  const c = resumeCountingReviews(a.dir, await readPipelineForResume(a.orch.getState().id));
  assert.equal((await c.done).status, 'done');
  assert.equal(c.plans.filter((q) => q.concern).length, 0, 'the answer is replayed');
  assertOverrideReviewedAfter(c);
  assert.equal(auditOf(c.orch).filter((t) => t.includes('raised a plan concern')).length, 1);
});

test('#990 s5 a pause during the override re-run resumes as the override re-run', async () => {
  raise();
  const a = start({ afterImpl: (orch, prompt) => {
    delete process.env.WORCA_MOCK_PLAN_CONCERN;
    if (OVERRIDE_BLOCK.test(prompt)) orch.pause();
  } });
  assert.equal((await a.done).status, 'paused');
  assert.ok(implPrompts(a).some((p) => OVERRIDE_BLOCK.test(p)), 'paused in the override re-run');
  const b = resumeCountingReviews(a.dir, await readPipelineForResume(a.orch.getState().id));
  assert.equal((await b.done).status, 'done');
  assert.equal(b.plans.filter((q) => q.concern).length, 0, 'the decision is not asked again');
  assertOverrideReviewedAfter(b);
  const first = implPrompts(b)[0];
  assert.match(first, OVERRIDE_BLOCK);
  assert.doesNotMatch(first, PLAIN_BLOCK);
});

test('#990 s5 an old resume point without concern fields resumes and reaches done', async () => {
  raise();
  const a = start({}, (q, orch) => (q.concern ? orch.pause() : approve(q, orch)));
  assert.equal((await a.done).status, 'paused');
  const saved = await readPipelineForResume(a.orch.getState().id);
  assert.ok(saved.resumePoint.planConcernSeen, 'the new key is carried when set');
  delete saved.resumePoint.planConcernAnswer;
  delete saved.resumePoint.planConcernSeen;
  const b = start({ projectDir: a.dir, resume: saved, shape: undefined });
  assert.equal((await b.done).status, 'done');
});

test('#990 s5 a concern stops a later slice even when Approve each slice\'s plan is off', async () => {
  raise();
  const pid = `p${Date.now()}${Math.random().toString(36).slice(2, 6)}`;
  const outline = MOCK_OUTLINE;
  const f = createSliceFeature({ pipelineId: pid, projectDir: gitDir(`concern-slice-${pid}`), title: 'T',
    outline, perspectives: ['product', 'qa'], workflowId: 'wf_shape', approveEach: false });
  const slice = { feature: f.id, index: 2, total: 2, outline };
  let index = null;
  const h = start({ shape: { perspectives: ['product', 'qa'], slices: 'off', slice } }, (q, orch) => {
    index = orch.runShape?.slice?.index;
    approve(q, orch);
  });
  h.orch._planCheck = async () => ({ ok: true, passed: 8, total: 8, items: [] });
  assert.equal((await h.done).status, 'done');
  assert.deepEqual(h.plans.map((q) => q.id), ['plan-concern-n_impl-c1'], 'the plan itself was approved without an ask');
  assert.equal(index, 2);
});
