// test/orchestrator-shape-requirements.test.mjs — Shaper's requirements stage end to end on the real orchestrator in
// mock mode (flag on, a large task, started through resolveShapeRequest): one requirements hold, then one plan hold,
// no Clarify; the decision picks written before the Planner runs; a refused pick writes nothing; an unreadable
// decisions file asks with an error and Try again; resume across the change in both directions.
import { test, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile, mkdir, readdir, stat, chmod } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { gitDir } from './helpers/git-dir.mjs';
import { createOrchestrator } from '../src/core/orchestrator.mjs';
import { readPipelineForResume } from '../src/core/artifacts.mjs';
import { _testing } from '../src/core/graph/executor.mjs';
import { runClaude } from '../src/core/claude-runner.mjs';
import { resolveShapeRequest } from '../src/core/shape/run.mjs';
import { projectKey, projectStorePath } from '../src/core/store.mjs';
import { getDb } from '../src/core/db.mjs';
import { getTicket } from '../src/core/scheduler.mjs';
import { slicePrPreamble } from '../src/core/shape/features.mjs';

useTempHome(after);

let sandboxHome;
const prevEnv = {};
const ENV = ['HOME', 'USERPROFILE', 'WORCA_TEST_ALLOW_HOME_FALLBACK', 'WORCA_MOCK_UNCOVERED'];
before(async () => {
  sandboxHome = await mkdtemp(join(tmpdir(), 'worca-shapereq-home-'));
  for (const k of ENV) prevEnv[k] = process.env[k];
  process.env.HOME = sandboxHome;
  process.env.USERPROFILE = sandboxHome;
  process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = '1';
});
afterEach(() => { delete process.env.WORCA_MOCK_UNCOVERED; delete process.env.WORCA_MOCK_DIFF_UNCOVERED; _testing.runClaude = null; });
after(async () => {
  for (const k of ENV) { if (prevEnv[k] === undefined) delete process.env[k]; else process.env[k] = prevEnv[k]; }
  await rm(sandboxHome, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

const approve = (q, orch) => orch.answer(q.id, { decision: 'approve' });
const isReqAsk = (q) => q.kind === 'plan' && !!(q.plan?.criteria || q.plan?.error);

/** A mock Shaper run. `onAsk(q, orch)` answers every plan ask (default approve); Clarify is answered empty. */
function start(opts = {}, onAsk = approve) {
  const dir = opts.projectDir || gitDir('shapereq');
  const req = resolveShapeRequest({ shape: opts.shape ?? { size: 'large', lead: 'security' } }, { internal: !!opts.internal });
  assert.equal(req.ok, true, req.error);
  const orch = createOrchestrator({ projectDir: dir, workflowId: opts.workflowId || req.workflowId, prompt: opts.prompt || 'demo',
    claude: { mock: true }, ...(opts.savedShape ? {} : { shape: req.shape }), ...(opts.resume ? { resume: opts.resume } : {}),
    ...(opts.branch ? { branch: opts.branch } : {}) });
  const asks = []; const execs = [];
  orch.on('exec', (e) => execs.push(e));
  orch.on('question', (q) => {
    asks.push(q);
    if (q.kind === 'plan') { setImmediate(() => onAsk(q, orch)); return; }
    if (q.kind === 'clarify' || q.kind === 'questions') setImmediate(() => orch.answer(q.id, { answers: [] }));
  });
  const done = opts.resume ? orch.resume() : orch.run();
  return { orch, asks, execs, done, dir, workflowId: req.workflowId };
}
const shells = (execs, nodeId) => execs.filter((e) => e.nodeId === nodeId && e.kind !== 'task' && e.status === 'start');

test('a large task: one requirements hold, then one plan hold, no Clarify; 2 approvals reach the build and the run ends done', async () => {
  const h = start();
  assert.equal(h.workflowId, 'wf_shape_req');
  const res = await h.done;
  assert.equal(res.status, 'done', res.error);
  assert.equal(h.asks.filter((q) => q.kind === 'clarify' || q.kind === 'questions').length, 0, 'no Clarify');
  const plans = h.asks.filter((q) => q.kind === 'plan');
  assert.deepEqual(plans.map((q) => [q.nodeId, isReqAsk(q)]), [['n_reqrefine', true], ['n_refine', false]], 'exactly 2 answers');
  const reqAsk = plans[0].plan;
  assert.equal(reqAsk.criteria.ok, true);
  assert.equal(reqAsk.criteria.total, 8);
  assert.equal(reqAsk.decisions.length, 3);
  assert.deepEqual(reqAsk.decisions[0].options.map((o) => [o.persona, o.reason]), [
    ['security', 'emails are personal data, and exports get forwarded'], ['ux', 'people use them to tell who started a run'],
  ]);
  assert.deepEqual(reqAsk.decisions[1].options.map((o) => o.persona ?? null), ['security', null], 'an option nobody asked for stays bare');
  assert.equal(reqAsk.decisions[2].plain, 'What access does exporting need?');
  assert.deepEqual(reqAsk.decisions[2].options.map((o) => [o.plain, o.persona ?? null]), [['View access', null], ['Edit access', null]]);
  assert.equal(reqAsk.lead, 'security');
  assert.equal(reqAsk.check, undefined, 'the criteria hold skips the shape check');
  assert.deepEqual(plans[1].plan.coverage && [plans[1].plan.coverage.passed, plans[1].plan.coverage.total], [8, 8]);
  assert.equal(shells(h.execs, 'n_impl').length >= 1, true, 'the implement node ran');
  assert.deepEqual(h.orch.state.roleReviews.rounds.filter((r) => r.node !== 'n_review').map((r) => [r.node, r.target]),
    [['n_reqroles', 'requirements'], ['n_roles', 'plan']]);
});

test('approve with a pick writes it into the requirements file before the Planner runs', async () => {
  let reqFile = null;
  let atPlanner = null;
  const h = start({}, async (q, orch) => {
    if (isReqAsk(q)) { reqFile = q.plan.file; orch.answer(q.id, { decision: 'approve', decisions: { 'd-1': 'include' } }); return; }
    approve(q, orch);
  });
  h.orch.on('exec', async (e) => {
    if (e.nodeId === 'n_plan' && e.status === 'start' && atPlanner === null) atPlanner = await readFile(reqFile, 'utf8').catch(() => '');
  });
  const res = await h.done;
  assert.equal(res.status, 'done', res.error);
  const line = '- **d-1** — Email in export → **Include them (decided at approval)**';
  assert.ok(atPlanner.includes(line), 'written before the Planner started');
  assert.match(atPlanner, /- \*\*d-2\*\* — .* → \*\*Require project:read \(decided at approval\)\*\*/, 'a missing pick takes the recommended one');
});

test('a bad pick is refused and writes nothing: 422, the file bytes equal, the ask stays open, the next valid answer succeeds', async () => {
  let outcome = null;
  const h = start({}, async (q, orch) => {
    if (!isReqAsk(q)) return approve(q, orch);
    const bytes = await readFile(q.plan.file, 'utf8');
    let r = null;
    try { orch.answer(q.id, { decision: 'approve', decisions: { 'd-2': 'nope' } }); } catch (e) { r = e; }
    const after = await readFile(q.plan.file, 'utf8');
    const open = orch.pendingQuestion?.id === q.id;
    const files = (await readdir(orch.pipeline.dir)).filter((f) => /feedback/.test(f));
    outcome = { r, same: bytes === after, open, files };
    orch.answer(q.id, { decision: 'approve' });
  });
  const res = await h.done;
  assert.equal(res.status, 'done', res.error);
  assert.equal(outcome.r?.code, 'INVALID_ANSWER', 'refused (POST /api/answer answers 422)');
  assert.deepEqual(outcome.r.errors, [{ path: 'decisions.d-2', code: 'invalid', message: 'pick one of: members, owner' }]);
  assert.deepEqual([outcome.same, outcome.open, outcome.files], [true, true, []]);
});

test('an unreadable decisions file asks with plan.error; Try again after the fix asks with the criteria', async () => {
  let decisionsPath = null;
  _testing.runClaude = async (o) => {
    const out = await runClaude(o);
    const m = /^MOCK_ROLE: requirements-refine$/m.test(o.prompt) && /^MOCK_OUTS: (.+)$/m.exec(o.prompt);
    if (m) { decisionsPath = m[1].split('|')[0]; await writeFile(decisionsPath, '{ not json', 'utf8'); }
    return out;
  };
  const seen = [];
  const h = start({}, async (q, orch) => {
    seen.push({ node: q.nodeId, error: q.plan.error?.message || null, criteria: !!q.plan.criteria });
    if (q.plan.error) {
      assert.throws(() => orch.answer(q.id, { decision: 'approve' }), (e) => e.code === 'INVALID_ANSWER', 'nothing to approve on an error ask');
      await writeFile(decisionsPath, JSON.stringify({ decisions: [] }), 'utf8');
      orch.answer(q.id, { decision: 'retry' });
      return;
    }
    approve(q, orch);
  });
  const res = await h.done;
  assert.equal(res.status, 'done', res.error);
  assert.deepEqual(seen, [
    { node: 'n_reqrefine', error: 'the decisions file is not valid JSON', criteria: false },
    { node: 'n_reqrefine', error: null, criteria: true },
    { node: 'n_refine', error: null, criteria: false },
  ]);
  const ids = h.asks.filter((q) => q.nodeId === 'n_reqrefine').map((q) => q.id);
  assert.equal(new Set(ids).size, 2, 'the retry asks under a new id');
});

/** Append a repeat of the file's first criterion line, so its criteria check fails ("listed twice"). */
async function repeatCriterion(file) {
  const text = await readFile(file, 'utf8');
  await writeFile(file, `${text.trimEnd()}\n${/^- \*\*R-[a-z]+-\d+\*\*.*$/m.exec(text)[0]}\n`, 'utf8');
}

test('a failing criteria check refuses approve; Ask for changes redrafts, and an edit during the hold is checked again at approve', async () => {
  let refined = 0;
  _testing.runClaude = async (o) => {
    const out = await runClaude(o);
    const m = /^MOCK_ROLE: requirements-refine$/m.test(o.prompt) && /^MOCK_OUT: (.+)$/m.exec(o.prompt);
    if (m && (refined += 1) === 1) await repeatCriterion(m[1].trim());
    return out;
  };
  const seen = [];
  const h = start({}, async (q, orch) => {
    if (!isReqAsk(q)) return approve(q, orch);
    seen.push(q.plan.criteria.ok);
    if (!q.plan.criteria.ok) {
      assert.throws(() => orch.answer(q.id, { decision: 'approve' }),
        (e) => e.code === 'INVALID_ANSWER' && e.errors[0].message === 'the requirements check has 1 to fix: ask for changes');
      return orch.answer(q.id, { decision: 'revise', feedback: 'Drop the repeat.' });
    }
    if (seen.length === 2) await repeatCriterion(q.plan.file);   // edited during the hold: approve checks again
    approve(q, orch);
  });
  const res = await h.done;
  assert.equal(res.status, 'done', res.error);
  assert.deepEqual(seen, [false, true, false, true]);
  assert.equal(shells(h.execs, 'n_req').length, 3, 'each refused round was redrafted');
});

test('a decisions write that fails does not approve: the hold asks again with plan.error, and Try again then approve records the picks', async () => {
  const seen = [];
  let file = null;
  const h = start({}, async (q, orch) => {
    if (!isReqAsk(q)) return approve(q, orch);
    seen.push(q.plan.error?.message || 'criteria');
    file = q.plan.file;
    if (seen.length === 1) { await chmod(file, 0o444); return orch.answer(q.id, { decision: 'approve', decisions: { 'd-1': 'include' } }); }
    if (q.plan.error) { await chmod(file, 0o644); return orch.answer(q.id, { decision: 'retry' }); }
    orch.answer(q.id, { decision: 'approve', decisions: { 'd-1': 'include' } });
  });
  const res = await h.done;
  assert.equal(res.status, 'done', res.error);
  assert.deepEqual(seen, ['criteria', 'Could not save your picks. Nothing changed.', 'criteria']);
  assert.ok((await readFile(file, 'utf8')).includes('- **d-1** — Email in export → **Include them (decided at approval)**'));
});

test('Ask for changes on each hold: the drafter re-runs with the feedback and the picks, then the Planner re-runs', async () => {
  let reqRound = 0; let planRound = 0;
  const h = start({}, (q, orch) => {
    if (isReqAsk(q) && (reqRound += 1) === 1) return orch.answer(q.id, { decision: 'revise', feedback: 'Add an audit log.', decisions: { 'd-1': 'include' } });
    if (!isReqAsk(q) && (planRound += 1) === 1) return orch.answer(q.id, { decision: 'revise', feedback: 'Smaller steps.' });
    approve(q, orch);
  });
  const res = await h.done;
  assert.equal(res.status, 'done', res.error);
  assert.deepEqual(h.asks.filter((q) => q.kind === 'plan').map((q) => q.nodeId), ['n_reqrefine', 'n_reqrefine', 'n_refine', 'n_refine']);
  assert.equal(shells(h.execs, 'n_req').length, 2, 'the drafter re-ran');
  assert.equal(shells(h.execs, 'n_plan').length, 2, 'the Planner re-ran');
  const feedback = await readFile(join(h.orch.pipeline.dir, 'n_reqrefine-feedback-1.md'), 'utf8');
  assert.match(feedback, /Add an audit log\./);
  assert.match(feedback, /Decisions made so far:[\s\S]*- \*\*d-1\*\* — Email in export → \*\*Include them/);
});

test('the requirements hold leaves state.shaping.rounds empty; the plan hold records its coverage on its round', async () => {
  let atReq = null;
  const h = start({}, (q, orch) => {
    if (isReqAsk(q)) atReq = JSON.parse(JSON.stringify(orch.state.shaping.rounds));
    approve(q, orch);
  });
  process.env.WORCA_MOCK_UNCOVERED = 'R-ops-1';
  const res = await h.done;
  assert.equal(res.status, 'done', res.error);
  assert.deepEqual(atReq, []);
  const plan = h.asks.find((q) => q.kind === 'plan' && q.nodeId === 'n_refine');
  assert.deepEqual([plan.plan.coverage.passed, plan.plan.coverage.total], [7, 8]);
  assert.deepEqual(plan.plan.coverage.items.find((i) => !i.pass).label, 'R-ops-1 · not covered by any step');
});

/** Copy the pre-change fixture (a wf_shape run paused inside n_roles on 9a388885b) into this run's store. */
async function fixtureResume() {
  const FX = new URL('./fixtures/shape-resume-before-requirements/', import.meta.url);
  const dir = realpathSync(gitDir('shapereq-fx'));
  const sha = execSync('git rev-parse HEAD', { cwd: dir }).toString().trim();
  const key = projectKey(dir);
  const store = projectStorePath(key);
  const home = dirname(dirname(dirname(store)));
  const pdir = join(store, 'pipelines', '05-11-26-demo-af176941');
  const sub = (t) => t.split('__PIPELINE__').join(pdir).split('__PROJECT_KEY__').join(key).split('__PROJECT__').join(dir)
    .split('__HOME__').join(home).split('__BASE_SHA__').join(sha);
  const copy = async (src, dst) => {
    await mkdir(dst, { recursive: true });
    for (const f of await readdir(src)) {
      const s = join(src, f);
      if ((await stat(s)).isDirectory()) await copy(s, join(dst, f));
      else await writeFile(join(dst, f), sub(await readFile(s, 'utf8')));
    }
  };
  await copy(new URL('pipeline/', FX).pathname, pdir);
  await copy(new URL('plans/', FX).pathname, join(store, 'plans'));
  const saved = JSON.parse(sub(await readFile(new URL('saved.json', FX), 'utf8')));
  const wt = saved.state.branch.worktreeDir;
  await mkdir(dirname(wt), { recursive: true });
  execSync(`git worktree add -q --detach ${JSON.stringify(wt)} HEAD`, { cwd: dir });
  return { dir, saved };
}

test('the pre-change wf_shape fixture, paused inside n_roles, resumes to done with the flag on and asks no requirements hold', async () => {
  const { dir, saved } = await fixtureResume();
  assert.equal(saved.resumePoint.workflowId, 'wf_shape');
  const before = JSON.stringify(saved.resumePoint.manifest.graph);
  const h = start({ projectDir: dir, resume: saved, workflowId: 'wf_shape', shape: { size: 'large' } });
  const res = await h.done;
  assert.equal(res.status, 'done', res.error);
  assert.equal(h.asks.filter(isReqAsk).length, 0, 'no requirements hold');
  assert.equal(h.asks.filter((q) => q.kind === 'plan').length, 1);
  assert.deepEqual(Object.keys(h.asks.find((q) => q.kind === 'plan').plan).sort(),
    ['check', 'file', 'nodeId', 'perspectives', 'port', 'revisable', 'round'], 'a plain wf_shape plan ask gains no key (R-arch-5)');
  assert.equal(h.execs.some((e) => /^n_req/.test(e.nodeId)), false);
  assert.ok(h.orch.state.roleReviews.rounds.every((r) => r.node === 'n_roles' || r.node === 'n_review'), 'the old round shape');
  assert.equal(JSON.stringify(saved.resumePoint.manifest.graph), before, 'the frozen graph is the old one');
});

test('a wf_shape_req run paused at the requirements hold resumes', async () => {
  const dir = gitDir('shapereq-off');
  let paused = false;
  const h = start({ projectDir: dir }, (q, orch) => { if (!paused && isReqAsk(q)) { paused = true; orch.pause(); } else approve(q, orch); });
  assert.equal((await h.done).status, 'paused');
  const saved = readPipelineForResume(h.orch.getState().id);
  assert.equal(saved.resumePoint.workflowId, 'wf_shape_req');
  const h2 = start({ projectDir: dir, resume: saved, workflowId: 'wf_shape_req' });
  const res = await h2.done;
  assert.equal(res.status, 'done', res.error);
  assert.deepEqual(h2.asks.filter((q) => q.kind === 'plan').map((q) => q.nodeId), ['n_reqrefine', 'n_refine']);
});

// Slice 2 of the requirements feature: a sliced run carries the agreed ids into the outline, slice 1's checks and the
// later slices' tickets.
const SLICED = 'Plan this in slices: demo';
const isOutlineAsk = (q) => q.kind === 'plan' && !!q.plan?.outline;
const SLICE1 = ['R-po-1', 'R-po-2', 'R-arch-1', 'R-ux-1'];
const capturePrompts = () => {
  const prompts = [];
  _testing.runClaude = (o) => { prompts.push(o.prompt); return runClaude(o); };
  return prompts;
};
const checklistOf = (prompts, role) => prompts.filter((p) => new RegExp(`^MOCK_PERSPECTIVE: ${role}$`, 'm').test(p))
  .map((p) => (/^MOCK_CHECKLIST: (.*)$/m.exec(p) || [])[1] || '');

test('sliced: slices.json lists each agreed id once', async () => {
  const h = start({ prompt: SLICED });
  const res = await h.done;
  assert.equal(res.status, 'done', res.error);
  assert.equal(h.asks.filter(isOutlineAsk).length, 1);
  const outline = JSON.parse(await readFile(join(h.orch.pipeline.dir, 'slices.json'), 'utf8'));
  assert.deepEqual(outline.slices.map((s) => s.requirements), [SLICE1, ['R-qa-1', 'R-sec-1', 'R-sec-2']]);
  assert.deepEqual(outline.leftOut, [{ id: 'R-ops-1', reason: 'Moved to a later feature' }]);
  assert.equal(outline.agreed.length, 8);
  const ask = h.asks.find(isOutlineAsk);
  assert.equal(ask.plan.check.items.at(-1).id, 'requirements');
  assert.equal(ask.plan.check.items.at(-1).pass, true);
  assert.equal(slicePrPreamble(h.orch.pipeline.id).split('\n')[1], `Satisfies: ${SLICE1.join(', ')}`);
});

test('sliced: slice 1\'s code review checks only slice 1\'s ids', async () => {
  const dir = gitDir('shapereq-sliced');
  let prompts = capturePrompts();
  let paused = false;
  const h = start({ projectDir: dir, prompt: SLICED }, (q, orch) => {
    if (!paused && q.nodeId === 'n_refine' && !isOutlineAsk(q)) { paused = true; orch.pause(); return; }
    approve(q, orch);
  });
  assert.equal((await h.done).status, 'paused');
  const planAsk = h.asks.find((q) => q.nodeId === 'n_refine' && !isOutlineAsk(q));
  assert.deepEqual([planAsk.plan.coverage.passed, planAsk.plan.coverage.total], [4, 4]);
  assert.deepEqual(planAsk.plan.coverage.items.map((i) => i.id), SLICE1);
  const saved = readPipelineForResume(h.orch.getState().id);
  prompts = capturePrompts();
  const h2 = start({ projectDir: dir, prompt: SLICED, resume: saved, workflowId: 'wf_shape_req', savedShape: true });   // as the server resumes
  const res = await h2.done;
  assert.equal(res.status, 'done', res.error);
  const again = h2.asks.find((q) => q.nodeId === 'n_refine');
  assert.equal(again.plan.coverage.total, 4, 'the re-asked plan hold after the resume');
  const lists = checklistOf(prompts, 'requirements');
  assert.ok(lists.length >= 1);
  for (const l of lists) assert.equal(l, SLICE1.join(','));
});

test('the slice 2 ticket\'s prompt contains `Satisfies: R-qa-1, R-sec-1, R-sec-2`', async () => {
  const h = start({ prompt: SLICED });
  assert.equal((await h.done).status, 'done');
  const f = getDb().prepare('SELECT id FROM shape_features WHERE origin_pipeline_id = ?').get(h.orch.pipeline.id);
  const row = getDb().prepare('SELECT ticket_id FROM shape_feature_slices WHERE feature_id = ? AND idx = 2').get(f.id);
  const request = getTicket(row.ticket_id, { withRequest: true }).request;
  assert.match(request.prompt, /^Satisfies: R-qa-1, R-sec-1, R-sec-2$/m);
  assert.match(request.prompt, /^- \*\*R-qa-1\*\* A test proves the CSV columns$/m);
  assert.doesNotMatch(request.prompt, /^- \*\*R-po-1\*\*/m);
  assert.equal(request.workflowId, 'wf_shape', 'the stored request keeps wf_shape; the variant is picked at fire');
  const fired = resolveShapeRequest({ shape: request.shape, workflowId: request.workflowId }, { internal: true });
  assert.equal(fired.workflowId, 'wf_shape_slice_req');
});

test('code review: R-arch-1 met by Requirements does not satisfy the plan\'s R-arch-1', async () => {
  _testing.runClaude = async (o) => {
    const out = await runClaude(o);
    const role = /^MOCK_ROLE: code-review$/m.test(o.prompt) && (/^MOCK_PERSPECTIVE: (\w+)$/m.exec(o.prompt) || [])[1];
    const json = role && /^MOCK_CYCLE: 1$/m.test(o.prompt) && (/^MOCK_JSON: (.+)$/m.exec(o.prompt) || [])[1];
    if (json) {
      const v = JSON.parse(await readFile(json, 'utf8'));
      v.checklist = (v.checklist || []).filter((c) => c.id !== 'R-arch-1')
        .concat({ id: 'R-arch-1', status: role === 'requirements' ? 'met' : 'unmet', evidence: 'test' });
      await writeFile(json, JSON.stringify(v), 'utf8');
    }
    return out;
  };
  const h = start({ prompt: SLICED });
  const res = await h.done;
  assert.equal(res.status, 'done', res.error);
  const r1 = h.orch.state.roleReviews.rounds.find((r) => r.node === 'n_review' && r.round === 1);
  assert.equal(r1.roles.find((r) => r.key === 'requirements').checklist.find((c) => c.id === 'R-arch-1').status, 'met');
  const { readPipelineExtras } = await import('../src/core/artifacts.mjs');
  const impl1 = readPipelineExtras(h.orch.pipeline.id).reviews.find((v) => v.kind === 'impl' && v.cycle === 1);
  assert.ok(impl1.issues.some((i) => /R-arch-1/.test(i.title) && !/not covered by the diff/.test(i.title)), JSON.stringify(impl1.issues));
});

const implFixes = (orch) => orch._graphSnapshot.execs.filter((e) => e.nodeId === 'n_impl' && e.bindings?.fix?.path);
const reviewRounds = (orch) => orch.state.roleReviews.rounds.filter((r) => r.node === 'n_review');

test('code review: a round 2 that re-runs only Requirements keeps the skipped roles\' plan checklist; one fix, then done', async () => {
  process.env.WORCA_MOCK_DIFF_UNCOVERED = 'R-ux-1';
  _testing.runClaude = async (o) => {
    const out = await runClaude(o);
    const role = /^MOCK_ROLE: code-review$/m.test(o.prompt) && (/^MOCK_PERSPECTIVE: (\w+)$/m.exec(o.prompt) || [])[1];
    const json = role && role !== 'requirements' && /^MOCK_CYCLE: 1$/m.test(o.prompt) && (/^MOCK_JSON: (.+)$/m.exec(o.prompt) || [])[1];
    if (json) {
      const v = JSON.parse(await readFile(json, 'utf8'));
      v.checklist = (v.checklist || []).map((c) => ({ ...c, status: 'met', evidence: 'test' }));
      await writeFile(json, JSON.stringify(v), 'utf8');
    }
    return out;
  };
  const h = start({ prompt: SLICED });
  const res = await h.done;
  assert.equal(res.status, 'done', res.error);
  const rounds = reviewRounds(h.orch);
  assert.equal(rounds.length, 2);
  assert.deepEqual(rounds[1].roles.filter((r) => !r.skipped).map((r) => r.key), ['requirements']);
  assert.equal(implFixes(h.orch).length, 1);
  const { readPipelineExtras } = await import('../src/core/artifacts.mjs');
  const impl2 = readPipelineExtras(h.orch.pipeline.id).reviews.find((v) => v.kind === 'impl' && v.cycle === 2);
  assert.deepEqual(impl2.issues.filter((i) => i.severity === 'major' || i.severity === 'critical'), [], JSON.stringify(impl2.issues));
});

test('code review: a role that reported a plan item unmet is not skipped in round 2, so the fix is judged again', async () => {
  process.env.WORCA_MOCK_DIFF_UNCOVERED = 'R-ux-1';   // the mock code roles report the plan's first item unmet in round 1
  const h = start({ prompt: SLICED });
  const res = await h.done;
  assert.equal(res.status, 'done', res.error);
  const rounds = reviewRounds(h.orch);
  assert.equal(rounds.length, 2);
  assert.deepEqual(rounds[1].roles.filter((r) => !r.skipped).map((r) => r.key), ['correctness', 'security', 'fit', 'requirements']);
  assert.equal(implFixes(h.orch).length, 1);
});

// Shaper requirements s3 (D1-D5): a plan reviewer's finding naming an agreed requirement rides the plan approval.
const QA_CONCERN = JSON.stringify({ qa: { 1: { severity: 'major', requirement: 'R-po-1' } } });
const auditOf = (orch) => getDb().prepare('SELECT text FROM pipeline_events WHERE pipeline_id = ?').all(orch.getState().id).map((r) => r.text);
const withConcern = async (fn) => {
  process.env.WORCA_MOCK_ROLE_REVIEW = QA_CONCERN;
  try { return await fn(); } finally { delete process.env.WORCA_MOCK_ROLE_REVIEW; }
};

test('Away on: Away agrees to the Requirements, flagged and on record', async () => {
  const h = start({}, () => {});
  h.orch.setNightOverride('on');
  for (const end = Date.now() + 60000; h.orch.answeredBy('plan-n_reqrefine-1') !== 'night-mode' && Date.now() < end;) await new Promise((r) => setTimeout(r, 10));
  assert.equal(h.orch.answeredBy('plan-n_reqrefine-1'), 'night-mode');
  const rec = h.orch.nightDecision('plan-n_reqrefine-1');
  assert.equal(rec.choice, 'approve');
  assert.equal(rec.flagged, true);
  assert.deepEqual(rec.meta, { ask: 'requirements' });
  h.orch.stop();
  await h.done;
});

test('a QA finding naming R-po-1: one plan approval carries the concern; no extra round; the Planner runs once', () => withConcern(async () => {
  const h = start({});
  const res = await h.done;
  assert.equal(res.status, 'done', res.error);
  assert.deepEqual(h.asks.filter((q) => q.kind === 'plan').map((q) => q.id), ['plan-n_reqrefine-1', 'plan-n_refine-1']);
  const ask = h.asks.find((q) => q.id === 'plan-n_refine-1');
  assert.equal(ask.concern.kind, 'requirement');
  assert.deepEqual(ask.concern.requirements, ['R-po-1']);
  assert.equal(ask.concern.detail, 'R-po-1 (QA): Add the missing case.');
  assert.equal(h.asks.find((q) => q.id === 'plan-n_reqrefine-1').concern, undefined);
  assert.equal(shells(h.execs, 'n_plan').length, 1, 'the Planner ran once');
  assert.equal(shells(h.execs, 'n_refine').length, 1, 'Refine ran once: no extra round');
  assert.ok(auditOf(h.orch).includes('Requirement concern overridden: R-po-1 kept as agreed.'));
}));

test('Ask for changes on a requirement concern writes the concern into the planner feedback', () => withConcern(async () => {
  let revised = false;
  const h = start({}, (q, orch) => {
    if (!revised && q.id === 'plan-n_refine-1') { revised = true; orch.answer(q.id, { decision: 'revise', feedback: 'Drop the export.' }); return; }
    approve(q, orch);
  });
  const res = await h.done;
  assert.equal(res.status, 'done', res.error);
  const fb = await readFile(join(h.orch.pipeline.dir, 'plan-feedback-1.md'), 'utf8');
  assert.match(fb, /Drop the export\./);
  assert.match(fb, /^## Requirement concern$/m);
  assert.match(fb, /^> R-po-1 \(QA\): Add the missing case\.$/m);
}));

test('a pause while the concern ask is open re-raises the same ask with the same concern after a resume', () => withConcern(async () => {
  const dir = gitDir('shapereq-concern');
  let paused = false;
  const h = start({ projectDir: dir }, (q, orch) => {
    if (!paused && q.id === 'plan-n_refine-1') { paused = true; orch.pause(); return; }
    approve(q, orch);
  });
  assert.equal((await h.done).status, 'paused');
  const first = h.asks.find((q) => q.id === 'plan-n_refine-1');
  const saved = readPipelineForResume(h.orch.getState().id);
  assert.equal('requirementConcern' in saved.resumePoint, false, 'no new resume-point field');
  const h2 = start({ projectDir: dir, resume: saved, workflowId: 'wf_shape_req', savedShape: true });
  const res = await h2.done;
  assert.equal(res.status, 'done', res.error);
  const again = h2.asks.find((q) => q.kind === 'plan');
  assert.equal(again.id, 'plan-n_refine-1');
  assert.deepEqual(again.concern, first.concern);
}));

// Shaper requirements s3 (D12, D13): Changes after ship on a feature with agreed requirements updates them first.
const SHIPPED_FACTS = { feature: { id: 'f1', title: 'Charts', base: 'dev', projectDir: '/p', shipped: true,
  shipPr: { number: 52, url: 'https://x/pull/52', state: 'OPEN' }, agreed: [{ id: 'R-po-1', text: 'Export the report' }],
  acceptance: [{ id: 'R-po-1', mark: 'met' }], perspectives: ['product', 'qa'],
  slices: [{ index: 1, state: 'done', pipelineId: 'aaaa0001', branch: { source: 'dev', feature: 'worca/charts-1' }, pr: null, rounds: 1 }] } };

test('a Changes round of a shipped feature asks the requirements hold before the plan approval', async () => {
  const { changesCard } = await import('../src/core/shape/changes.mjs');
  const card = changesCard({ text: 'make it blue', facts: SHIPPED_FACTS });
  assert.equal(card.landing.kind, 'round');
  const h = start({ shape: card.run.shape, prompt: card.run.prompt,
    branch: { roundOf: { pipelineId: 'aaaa0001', round: 2, request: 'make it blue' } } });
  assert.equal(h.workflowId, 'wf_shape_req');
  const res = await h.done;
  assert.equal(res.status, 'done', res.error);
  assert.deepEqual(h.asks.filter((q) => q.kind === 'plan').map((q) => q.id), ['plan-n_reqrefine-1', 'plan-n_refine-1']);
  assert.equal(h.asks.filter((q) => q.kind === 'clarify' || q.kind === 'questions').length, 0, 'no Clarify');
});

const FOLLOW_SLICE = { feature: 'f1', index: 1, total: 2, outline: { agreed: [{ id: 'R-po-1', text: 'Export the report' }], leftOut: [], slices: [
  { id: 's1', title: 'Charts', goal: 'g', inScope: [], outOfScope: [], acceptance: ['a'], dependsOn: [], estimate: 'small', requirements: [] },
  { id: 's2', title: 'Follow-up', goal: 'g', inScope: [], outOfScope: [], acceptance: [], dependsOn: [], estimate: null, requirements: ['R-po-1'] }] } };

test('a requirements-first follow-up keeps shape.requirementsFirst across a pause and resume; its criteria are not narrowed to the slice', async () => {
  const dir = gitDir('shapereq-first');
  const shape = { perspectives: ['product'], slices: 'off', slice: FOLLOW_SLICE, requirementsFirst: true };
  let paused = false;
  const h = start({ projectDir: dir, shape, internal: true }, (q, orch) => {
    if (!paused && q.id === 'plan-n_reqrefine-1') { paused = true; orch.pause(); return; }
    approve(q, orch);
  });
  assert.equal(h.workflowId, 'wf_shape_req');
  assert.equal((await h.done).status, 'paused');
  const saved = readPipelineForResume(h.orch.getState().id);
  assert.equal(saved.resumePoint.shape.requirementsFirst, true);
  const h2 = start({ projectDir: dir, shape, internal: true, resume: saved, workflowId: 'wf_shape_req', savedShape: true });
  const res = await h2.done;
  assert.equal(res.status, 'done', res.error);
  assert.equal(h2.orch.runShape.requirementsFirst, true);
  const plan = h2.asks.find((q) => q.id === 'plan-n_refine-1');
  assert.equal(plan.plan.coverage.total, 8, 'every drafted criterion, not only the slice\'s');
});

// ── Small runs B3: the Requirements step under the shaperSmallRuns snapshot ───────────────────────────────────────
/** Runs `fn` with WORCA_FLAGS set to `shaperSmallRuns` (on) or unset (off), restoring it afterwards. */
async function withSmallRuns(on, fn) {
  const prev = process.env.WORCA_FLAGS;
  if (on) process.env.WORCA_FLAGS = 'shaperSmallRuns'; else delete process.env.WORCA_FLAGS;
  try { return await fn(); } finally { if (prev === undefined) delete process.env.WORCA_FLAGS; else process.env.WORCA_FLAGS = prev; }
}
/** Runs `fn` with the mock knobs `env` set, restoring them afterwards. */
async function withEnv(env, fn) {
  const prev = Object.fromEntries(Object.keys(env).map((k) => [k, process.env[k]]));
  for (const [k, v] of Object.entries(env)) process.env[k] = v;
  try { return await fn(); } finally { for (const [k, v] of Object.entries(prev)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } }
}
/** A small-runs mock run: Care answered with `position` (unless the run asks none), plan asks to `onAsk`. */
function startSR({ position = 'balanced', smallRuns = true, ...opts } = {}, onAsk = approve) {
  const req = resolveShapeRequest({ shape: opts.shape ?? { size: 'large', lead: 'security' } }, { internal: !!opts.internal, smallRuns });
  assert.equal(req.ok, true, req.error);
  const dir = opts.projectDir || gitDir('shapereq-b3');
  const orch = createOrchestrator({ projectDir: dir, workflowId: opts.workflowId || req.workflowId, prompt: opts.prompt || 'demo',
    claude: { mock: true }, shape: req.shape, ...(opts.resume ? { resume: opts.resume } : {}), ...(opts.overlay ? { overlay: opts.overlay } : {}),
    ...(opts.branch ? { branch: opts.branch } : {}) });
  const asks = []; const execs = [];
  orch.on('exec', (e) => execs.push(e));
  orch.on('question', (q) => {
    asks.push(q);
    if (q.kind === 'care') setImmediate(() => orch.answer(q.id, { care: { position } }));
    else if (q.kind === 'plan') setImmediate(() => onAsk(q, orch));
    else if (q.kind === 'clarify' || q.kind === 'questions') setImmediate(() => orch.answer(q.id, { answers: [] }));
    // Care's fix cycles hold run 1's code review loop (Lean: 1, and the mock review blocks its first cycle): continue.
    else if (q.kind === 'gate') setImmediate(() => orch.answer(q.id, { decision: 'continue' }));
  });
  const done = opts.resume ? orch.resume() : orch.run();
  return { orch, asks, execs, done, dir, workflowId: req.workflowId };
}
const reqRounds = (orch) => (orch.state.roleReviews?.rounds || []).filter((r) => r.node === 'n_reqroles');
// Product and QA review requirements and plans, never code, so their majors cannot hold the code review loop.
const EVERY = { 1: 'major', 2: 'major', 3: 'major', 4: 'major' };
const MAJOR_EVERY_ROUND = JSON.stringify({ product: EVERY, qa: EVERY });
const reqAskOf = (h) => h.asks.find((q) => isReqAsk(q));

test('small runs: Lean runs 1 requirement round (lead + Product), Balanced 1 with every picked role, Thorough exactly 3', () => withEnv({ WORCA_MOCK_ROLE_REVIEW: MAJOR_EVERY_ROUND }, () => withSmallRuns(true, async () => {
  const roles = {};
  for (const position of ['lean', 'balanced', 'thorough']) {
    const h = startSR({ position });
    const res = await h.done;
    assert.equal(res.status, 'done', res.error);
    const rounds = reqRounds(h.orch);
    assert.equal(rounds.length, position === 'thorough' ? 3 : 1, position);
    roles[position] = rounds[0].roles.map((r) => r.key);
    if (position === 'thorough') {
      // The server attaches the role pass to the ask it sends (attachRoleReviews); do the same here.
      const { attachRoleReviews } = await import('../src/shared/shape/role-review.mjs');
      const ask = attachRoleReviews(structuredClone(reqAskOf(h)), h.orch.state.roleReviews);
      assert.equal(ask.plan.smallRuns, true);
      assert.equal(ask.plan.roleNode, 'n_reqroles');
      const qa = ask.plan.roleReviews.rounds.at(-1).roles.find((r) => r.key === 'qa');
      assert.ok(qa.findings.some((f) => f.severity === 'major'), 'the hold lists the objection raised at the bound');
      assert.equal(ask.plan.roleReviews.rounds.length, 3);
    }
  }
  assert.deepEqual(roles.lean, ['product', 'security']);
  assert.deepEqual(roles.balanced, ['product', 'architect', 'qa', 'security']);
})));

test('small runs: Thorough with a clean round 2 stops after 2; with the flag off the requirement review runs 2 rounds', () => withEnv({ WORCA_MOCK_ROLE_REVIEW: JSON.stringify({ qa: { 1: 'major', 2: 'minor' } }) }, async () => {
  const on = await withSmallRuns(true, async () => { const h = startSR({ position: 'thorough' }); assert.equal((await h.done).status, 'done'); return reqRounds(h.orch).length; });
  assert.equal(on, 2);
  await withEnv({ WORCA_MOCK_ROLE_REVIEW: MAJOR_EVERY_ROUND }, () => withSmallRuns(false, async () => {
    const h = start({});
    assert.equal((await h.done).status, 'done');
    assert.equal(reqRounds(h.orch).length, 2, 'flag off: today\'s 2 rounds');
    assert.equal(h.asks.some((q) => q.kind === 'care'), false);
    assert.equal(reqAskOf(h).plan.smallRuns, undefined);
  }));
}));

test('small runs: a resume keeps the Care budget in the manifest wire (Thorough 3, Lean 1)', () => withEnv({ WORCA_MOCK_ROLE_REVIEW: MAJOR_EVERY_ROUND }, () => withSmallRuns(true, async () => {
  for (const [position, want] of [['thorough', 3], ['lean', 1]]) {
    const dir = gitDir(`shapereq-b3-resume-${position}`);
    let paused = false;
    const h = startSR({ position, projectDir: dir }, approve);
    h.orch.on('exec', (e) => { if (!paused && e.nodeId === 'n_reqrefine' && e.status === 'start') { paused = true; h.orch.pause(); } });
    assert.equal((await h.done).status, 'paused');
    const saved = readPipelineForResume(h.orch.getState().id);
    const wire = saved.resumePoint.manifest.graph.wires.find((w) => w.loop && w.to.node === 'n_reqroles');
    assert.equal(wire.maxCycles, want, `${position}: the manifest wire carries the Care budget`);
    const h2 = startSR({ position, projectDir: dir, resume: saved, workflowId: 'wf_shape_req' });
    assert.equal((await h2.done).status, 'done');
    assert.equal(reqRounds(h2.orch).length, want, position);
  }
})));

test('small runs: a run overlay or a project per-workflow budget for the requirements loop wins over Care', () => withEnv({ WORCA_MOCK_ROLE_REVIEW: MAJOR_EVERY_ROUND }, () => withSmallRuns(true, async () => {
  const over = startSR({ position: 'thorough', overlay: { wires: { wr6: { maxCycles: 2 } } } });
  assert.equal((await over.done).status, 'done');
  assert.equal(reqRounds(over.orch).length, 2, 'the run overlay wins');
  const { setWireCycles } = await import('../src/core/config.mjs');
  const dir = gitDir('shapereq-b3-project');
  await setWireCycles(dir, 'wf_shape_req', 'wr6', 2);
  const proj = startSR({ position: 'thorough', projectDir: dir });
  assert.equal((await proj.done).status, 'done');
  assert.equal(reqRounds(proj.orch).length, 2, 'the project layer wins');
})));

test('small runs: no example: approve refused with the no-example message, the hold stays open and nothing is written', () => withEnv({ WORCA_MOCK_NO_EXAMPLE: 'R-po-1' }, () => withSmallRuns(true, async () => {
  let refused = null;
  let bytes = null;
  const h = startSR({ position: 'lean' }, async (q, orch) => {
    if (!isReqAsk(q) || refused) { if (refused || !isReqAsk(q)) return orch.answer(q.id, q.id === refused?.id ? { decision: 'stop' } : { decision: 'approve' }); }
    bytes = await readFile(q.plan.file, 'utf8');
    assert.ok(q.plan.criteria.items.some((i) => i.code === 'no-example' && i.id === 'R-po-1'));
    const err = await Promise.resolve().then(() => orch.answer(q.id, { decision: 'approve' })).then(() => null, (e) => e);
    refused = { id: q.id, err };
    assert.equal(orch.getState().pendingQuestion?.id ?? orch.pendingQuestion?.id, q.id, 'the hold stays open under the same id');
    assert.equal(await readFile(q.plan.file, 'utf8'), bytes, 'nothing written');
    orch.answer(q.id, { decision: 'stop' });
  });
  await h.done;
  assert.ok(refused, 'the requirements hold was raised');
  const errors = refused.err?.errors || refused.err?.payload?.errors;
  assert.deepEqual(errors, [{ path: 'decision', code: 'invalid', message: '1 requirement has no example yet: ask for changes' }]);
})));

test('small runs: an example removed from the file during the hold is caught on approve', () => withSmallRuns(true, async () => {
  const ids = [];
  const h = startSR({ position: 'lean' }, async (q, orch) => {
    if (!isReqAsk(q)) return approve(q, orch);
    ids.push(q.id);
    if (ids.length === 1) {
      const text = await readFile(q.plan.file, 'utf8');
      await writeFile(q.plan.file, text.replace(/\n {2}Example: [^\n]*(?=\n- \*\*R-po-2\*\*)/, ''), 'utf8');
      return approve(q, orch);
    }
    assert.ok(q.plan.criteria.items.some((i) => i.code === 'no-example' && i.id === 'R-po-1'), 'the re-ask shows the missing example');
    orch.answer(q.id, { decision: 'stop' });
  });
  await h.done;
  assert.equal(ids.length, 2, 'asked again after the stale approve');
  assert.ok(auditOf(h.orch).some((t) => /requirements changed during the hold/.test(t)));
}));

const SEC_DESIGN = (round) => JSON.stringify([
  { round, findings: [`security-${round}-1`, `ux-${round}-1`], question: 'Mask secrets?', options: ['Mask', 'Drop'] },
  { round, findings: [`security-${round}-2`, `ux-${round}-2`], question: 'Warn first?', options: ['Warn', 'Skip'] },
]);

test('small runs: two Security–Design conflicts in the last round give the hold 1 decision with from on, 2 off', async () => {
  const counts = {};
  for (const on of [true, false]) {
    const shape = { size: 'large', lead: 'security', perspectives: ['ux', 'security'] };
    // Two findings per role, on the same criterion, so both pairs are real conflicts.
    const review = JSON.stringify({ security: { 1: { severity: 'minor', findings: 2 } }, ux: { 1: { severity: 'minor', findings: 2 } } });
    await withEnv({ WORCA_MOCK_ROLE_REVIEW: review, WORCA_MOCK_CONFLICTS: SEC_DESIGN(1) }, () => withSmallRuns(on, async () => {
      // Balanced: every picked role reviews (Lean would run only the lead and Product).
      const h = startSR({ position: 'balanced', shape }, (q, orch) => (isReqAsk(q) ? orch.answer(q.id, { decision: 'stop' }) : approve(q, orch)));
      await h.done;
      counts[on] = (reqAskOf(h).plan.decisions || []).filter((d) => d.from).length;
    }));
  }
  assert.deepEqual(counts, { true: 1, false: 2 });
});

test('small runs: Compliance picked spawns a role-compliance reviewer whose brief names R-comp; flag off with default picks none', async () => {
  const prompts = capturePrompts();
  await withSmallRuns(true, async () => {
    const h = startSR({ position: 'balanced', shape: { size: 'large', lead: 'security', perspectives: ['compliance'] } });
    assert.equal((await h.done).status, 'done');
    assert.ok(h.execs.some((e) => e.taskId === 'role-compliance' || /role-compliance/.test(String(e.nodeId || ''))), 'a role-compliance row');
    assert.ok(prompts.some((p) => /## Your role: Compliance/.test(p) && /R-comp/.test(p)));
  });
  const before = prompts.length;
  await withSmallRuns(false, async () => {
    const h = start({});
    assert.equal((await h.done).status, 'done');
    assert.equal(h.execs.some((e) => e.taskId === 'role-compliance' || /role-compliance/.test(String(e.nodeId || ''))), false);
    assert.equal(prompts.slice(before).some((p) => /## Your role: Compliance/.test(p)), false);
  });
});

test('small runs: the snapshot wins over a live flag flip: the flag deleted after round 1 keeps Thorough\'s 3 rounds', () => withEnv({ WORCA_MOCK_ROLE_REVIEW: MAJOR_EVERY_ROUND }, () => withSmallRuns(true, async () => {
  const h = startSR({ position: 'thorough' });
  h.orch.on('exec', (e) => { if (e.nodeId === 'n_reqrefine' && e.status === 'start') delete process.env.WORCA_FLAGS; });
  assert.equal((await h.done).status, 'done');
  assert.equal(reqRounds(h.orch).length, 3);
  assert.equal(reqAskOf(h).plan.smallRuns, true);
})));

// ── Small runs B4: the Split step ─────────────────────────────────────────────────────────────────────────────────
const { careOfPipeline, careOfFeature } = await import('../src/core/shape/small-runs.mjs');
const { featureView, acceptanceRefusal, setFeatureAcceptance, replanRest } = await import('../src/core/shape/features.mjs');
const { startVerifyCheck } = await import('../src/core/shape/verifier.mjs');
const { checkSlices } = await import('../src/shared/shape/slices.mjs');
const { perspectiveByKey } = await import('../src/shared/shape/perspectives.mjs');
const PASSING_PLAN = { ok: true, passed: 8, total: 8, items: [] };
const careAndPlanIds = (h) => h.asks.filter((q) => q.kind === 'care' || q.kind === 'plan').map((q) => q.id);
const featureRow = (orch) => getDb().prepare('SELECT id FROM shape_features WHERE origin_pipeline_id = ?').get(orch.getState().id);
/** `C` per challenge spawn, `R` per Planner spawn with a revise note, in order. */
function splitSpawns(orch) {
  const order = [];
  const real = orch._runNodeAttempts.bind(orch);
  orch._runNodeAttempts = async (nc, ctx) => {
    if (String(ctx.executionId).includes(':split-challenge-')) order.push('C');
    else if (ctx.shapeOutlineNote?.decision === 'revise') order.push('R');
    return real(nc, ctx);
  };
  return order;
}
/** A marked (flag on) sliced run at `position`, with the mock's small-runs outline `outline`; the plan check passes. */
function startSplit({ position = 'balanced', outline = 'pass', challenge = null, smallRuns = true, ...opts } = {}, onAsk = approve) {
  const env = { WORCA_MOCK_SPLIT_OUTLINE: outline, ...(challenge ? { WORCA_MOCK_SPLIT_CHALLENGE: JSON.stringify(challenge) } : {}) };
  const keys = Object.keys(env);
  for (const [k, v] of Object.entries(env)) process.env[k] = v;
  const prevFlags = process.env.WORCA_FLAGS;
  if (smallRuns) process.env.WORCA_FLAGS = 'shaperSmallRuns'; else delete process.env.WORCA_FLAGS;
  const h = startSR({ position, smallRuns, prompt: SLICED, ...opts }, onAsk);
  h.orch._planCheck = async () => PASSING_PLAN;
  h.order = splitSpawns(h.orch);
  h.done = h.done.finally(() => {
    for (const k of keys) delete process.env[k];
    if (prevFlags === undefined) delete process.env.WORCA_FLAGS; else process.env.WORCA_FLAGS = prevFlags;
  });
  return h;
}

test('B4: a marked run asks Start, Requirements and Split only; the approved split starts run 1 with the Start Care', async () => {
  let lastId = null;
  const h = startSplit({}, (q, orch) => {
    if (!q.plan?.outline) return approve(q, orch);
    lastId = q.plan.outline.agreed.at(-1).id;
    // a merge that keeps 2 requirements per run and a confirm to another allowed role
    orch.answer(q.id, { decision: 'approve', edits: [{ op: 'merge', id: 's1' }, { op: 'confirm', id: lastId, role: 'Compliance' }] });
  });
  const res = await h.done;
  assert.equal(res.status, 'done', res.error);
  assert.deepEqual(careAndPlanIds(h), ['care-1', 'plan-n_reqrefine-1', 'plan-outline-n_plan-1']);
  const split = h.asks.find(isOutlineAsk);
  assert.deepEqual([split.plan.smallRuns, split.plan.care, split.plan.runSize], [true, 'balanced', 3]);
  assert.equal(split.plan.requirements.length, 8);
  assert.ok(split.plan.requirements.every((r) => r.example && r.role));
  assert.equal(split.plan.challenge.challenger, true);
  const approved = JSON.parse(await readFile(join(h.orch.pipeline.dir, 'slices.json'), 'utf8'));
  const check = checkSlices(approved, { smallRuns: true, care: 'balanced' });
  assert.equal(check.ok, true, JSON.stringify(check.items.filter((i) => !i.pass)));
  assert.deepEqual(approved.confirmed, [{ id: lastId, role: 'Compliance' }]);
  assert.equal(h.orch.runShape.slice.index, 1);
  const feature = featureRow(h.orch);
  assert.ok(feature);
  // The feature row keeps the Start Care's three stored fields, unchanged.
  const start = careOfPipeline(h.orch.getState().id);
  assert.deepEqual(careOfFeature(feature.id), { position: start.position, chosenBy: start.chosenBy, worcaPick: start.worcaPick });
  assert.ok(auditOf(h.orch).some((x) => x.includes('Plan approval **approve** (the plan passed its checks)')));
});

/** A started marked split run whose Split is approved with `editsOf(lastId)`; → the feature's view and the confirmed id. */
async function approvedSplit(editsOf = () => []) {
  let lastId = null;
  const h = startSplit({}, (q, orch) => {
    if (!q.plan?.outline) return approve(q, orch);
    lastId = q.plan.outline.agreed.at(-1).id;
    orch.answer(q.id, { decision: 'approve', edits: editsOf(lastId) });
  });
  const res = await h.done;
  assert.equal(res.status, 'done', res.error);
  return { h, lastId, fid: featureRow(h.orch).id };
}
const CONFIRM_EDITS = (id) => [{ op: 'merge', id: 's1' }, { op: 'confirm', id, role: 'Compliance' }];

test('the approved split stores what a person confirms: Ship waits for the edited role, and the Verifier leaves the id out', async () => {
  const { lastId, fid } = await approvedSplit(CONFIRM_EDITS);
  let view = featureView(fid);
  assert.deepEqual(view.requirementKinds.at(-1), { id: lastId, kind: 'confirmed', role: 'compliance' });
  assert.equal(view.requirementKinds.length, 8);
  assert.ok(view.requirementKinds.slice(0, -1).every((k) => k.kind === 'owned' && Number.isInteger(k.run)), JSON.stringify(view.requirementKinds));
  const reason = `Waiting for Compliance to confirm ${lastId}`;
  assert.deepEqual([view.ship.smallRuns.waiting, view.ship.smallRuns.blocked, view.ship.smallRuns.reason], [[lastId], true, reason]);
  assert.deepEqual(acceptanceRefusal(view), { error: reason, code: 'ACCEPTANCE_INCOMPLETE', missing: [lastId], role: 'compliance' });
  setFeatureAcceptance(fid, [{ id: lastId, mark: 'met', role: 'compliance', by: 'ann', at: new Date().toISOString() }]);
  view = featureView(fid);
  assert.equal(acceptanceRefusal(view), null);
  assert.equal(view.ship.smallRuns.blocked, false);
  // The Verifier's input, with run 1 as the feature's only run.
  getDb().prepare('DELETE FROM shape_feature_slices WHERE feature_id = ? AND idx > 1').run(fid);
  await withSmallRuns(true, async () => {
    const check = startVerifyCheck(fid);
    assert.ok(check, 'the check started');
    const { owned } = getTicket(check.ticketId, { withRequest: true }).request.shape.verify;
    assert.deepEqual([owned.length, owned.includes(lastId)], [7, false]);
    assert.equal(featureView(fid).verify.owned, 7);
  });
});

test('the approved split without edits stores the Planner\'s own role', async () => {
  const { lastId, fid } = await approvedSplit();
  assert.deepEqual(featureView(fid).requirementKinds.at(-1), { id: lastId, kind: 'confirmed', role: 'security' });
  assert.equal(featureView(fid).ship.smallRuns.reason, `Waiting for Security to confirm ${lastId}`);
});

test('a re-plan of a marked feature carries every requirement no finished run owns; a confirmed one keeps its role, unmarked', async () => {
  const { h, lastId, fid } = await approvedSplit(CONFIRM_EDITS);
  const old = JSON.parse(await readFile(join(h.orch.pipeline.dir, 'slices.json'), 'utf8'));
  const finished = old.slices[0].requirements;                        // run 1 is the planning run: done
  assert.equal(finished.length, 2);
  const carried = old.agreed.filter((a) => !finished.includes(a.id));
  setFeatureAcceptance(fid, [{ id: lastId, mark: 'met', role: 'compliance', by: 'ann', at: new Date().toISOString() }]);
  const request = await withSmallRuns(true, () => getTicket(replanRest(fid, { by: 'ann' }).ticketId, { withRequest: true }).request);
  const fired = resolveShapeRequest({ shape: request.shape, workflowId: request.workflowId }, { internal: true, smallRuns: true });
  assert.equal(fired.ok, true, fired.error);
  const h2 = startSplit({ projectDir: h.dir, shape: request.shape, internal: true, workflowId: fired.workflowId,
    branch: { source: request.sourceBranch }, prompt: `${request.prompt}\nPlan this in slices\n` });
  const res = await h2.done;
  assert.equal(res.status, 'done', res.error);
  assert.equal(h2.asks.some((q) => q.kind === 'care'), false, 'the Care is kept, not asked');
  const split = h2.asks.find(isOutlineAsk);
  assert.ok(split, 'the re-plan asks the Split');
  assert.deepEqual((split.plan.requirements || []).map(({ id, text, example }) => ({ id, text, example })), carried.map(({ id, text, example }) => ({ id, text, example })));
  const f2 = getDb().prepare('SELECT id, outline FROM shape_features WHERE origin_pipeline_id = ?').get(h2.orch.getState().id);
  const outline = JSON.parse(f2.outline);
  assert.deepEqual(outline.agreed, carried);
  const check = checkSlices(outline, { smallRuns: true, care: 'balanced' });
  for (const id of ['ownership', 'coverage', 'confirmRole']) assert.equal(check.items.find((i) => i.id === id).pass, true, id);
  const view = featureView(f2.id);
  assert.deepEqual(view.requirementKinds.at(-1), { id: lastId, kind: 'confirmed', role: 'compliance' }, 'the mock Planner named Security');
  assert.ok(view.requirementKinds.slice(0, -1).every((k) => k.kind === 'owned' && Number.isInteger(k.run)), JSON.stringify(view.requirementKinds));
  const ship = () => withSmallRuns(true, () => featureView(f2.id));
  let v = await ship();
  assert.equal('unowned' in v.ship.smallRuns, false);
  assert.deepEqual([v.ship.smallRuns.waiting, v.ship.smallRuns.reason], [[lastId], `Waiting for you to confirm ${lastId}`], 'the old mark is not carried');
  setFeatureAcceptance(f2.id, [{ id: lastId, mark: 'met', role: 'compliance', by: 'ann', at: new Date().toISOString() }]);
  v = await ship();
  assert.equal(v.ship.smallRuns.blocked, false);
  assert.equal(acceptanceRefusal(v), null);
});

test('a carried re-plan that ends with Don\'t slice runs as wf_shape does: no requirements input, no Requirements reviewer, no plan coverage (also after a resume)', async () => {
  const { h, fid } = await approvedSplit(CONFIRM_EDITS);
  const request = await withSmallRuns(true, () => getTicket(replanRest(fid, { by: 'ann' }).ticketId, { withRequest: true }).request);
  assert.equal(request.workflowId, 'wf_shape_slice_req');
  const seen = (orch) => {
    const spawns = [];
    const real = orch._runNodeAttempts.bind(orch);
    orch._runNodeAttempts = async (nc, ctx) => {
      spawns.push({ node: nc.nodeId, role: ctx.role || null, note: ctx.shapeOutlineNote?.decision || null, ids: (ctx.shapeAgreedIds || []).length,
        bound: !!ctx.bindings?.requirements, text: ctx.roleRequirementsText || '' });
      return real(nc, ctx);
    };
    return spawns;
  };
  const flat = (q, orch) => (q.plan?.outline ? orch.answer(q.id, { decision: 'flat' }) : approve(q, orch));
  const replan = (workflowId) => {
    const fired = resolveShapeRequest({ shape: request.shape, workflowId }, { internal: true, smallRuns: true });
    const x = startSplit({ projectDir: h.dir, shape: request.shape, internal: true, workflowId: fired.workflowId || workflowId,
      branch: { source: request.sourceBranch }, prompt: `${request.prompt}\nPlan this in slices\n` }, flat);
    x.spawns = seen(x.orch);
    return x;
  };
  const a = replan('wf_shape_slice_req');
  assert.equal((await a.done).status, 'done');
  const b = replan('wf_shape');
  assert.equal((await b.done).status, 'done');
  assert.ok(a.asks.find(isOutlineAsk) && b.asks.find(isOutlineAsk), 'both asked the Split');
  // From the person's Don't slice on: the same executions in the same order, none with the carried list.
  const after = (x) => x.spawns.slice(x.spawns.findIndex((s) => s.note === 'flat'));
  const roleSet = (x) => after(x).map((s) => `${s.node}${s.role ? `:${s.role}` : ''}`).sort();
  assert.ok(after(a).length > 4);
  assert.deepEqual(roleSet(a), roleSet(b));
  assert.deepEqual(after(a).filter((s) => s.bound || s.ids || s.text), []);
  assert.equal(after(a).some((s) => s.role === 'requirements'), false);
  const planAsk = (x) => x.asks.find((q) => q.kind === 'plan' && !q.plan.outline);
  assert.deepEqual(Object.keys(planAsk(a).plan).sort(), Object.keys(planAsk(b).plan).sort());
  assert.equal('coverage' in planAsk(a).plan, false);
  // Paused at the plan approval: the resumed run still has no list.
  const c = startSplit({ projectDir: h.dir, shape: request.shape, internal: true, workflowId: 'wf_shape_slice_req',
    branch: { source: request.sourceBranch }, prompt: `${request.prompt}\nPlan this in slices\n` },
  (q, orch) => (q.plan?.outline ? orch.answer(q.id, { decision: 'flat' }) : orch.pause()));
  assert.equal((await c.done).status, 'paused');
  const d = startSplit({ projectDir: h.dir, shape: request.shape, internal: true, workflowId: 'wf_shape_slice_req', resume: readPipelineForResume(c.orch.getState().id) }, flat);
  d.spawns = seen(d.orch);
  assert.equal((await d.done).status, 'done');
  assert.equal('coverage' in planAsk(d).plan, false);
  assert.ok(d.spawns.some((s) => s.node === 'n_review'));
  assert.deepEqual(d.spawns.filter((s) => s.bound || s.ids || s.text || s.role === 'requirements'), []);
});

test('B4: marker off, the sliced run still asks plan-n_refine-1; a marked slice 1 whose plan check fails is held', async () => {
  const off = startSplit({ smallRuns: false });
  assert.equal((await off.done).status, 'done');
  assert.ok(careAndPlanIds(off).includes('plan-n_refine-1'));
  assert.deepEqual(off.order, [], 'no challenge without the marker');
  const held = startSplit();
  held.orch._planCheck = async () => ({ ok: false, passed: 7, total: 8, items: [] });
  assert.equal((await held.done).status, 'done');
  assert.deepEqual(careAndPlanIds(held), ['care-1', 'plan-n_reqrefine-1', 'plan-outline-n_plan-1', 'plan-n_refine-1']);
  assert.ok(auditOf(held.orch).includes('Plan approval held: the shape check did not pass.'));
});

for (const position of ['lean', 'balanced', 'thorough']) {
  test(`B4: ${position}: an approve of a split failing ownership, coverage or confirmRole throws INVALID_ANSWER; the Split stays open, no feature`, async () => {
    for (const outline of ['ownership', 'coverage', 'confirmRole']) {
      let refused = null; let open = null; let feature = 'unset';
      const h = startSplit({ position, outline }, (q, orch) => {
        if (!q.plan?.outline) return approve(q, orch);
        try { orch.answer(q.id, { decision: 'approve' }); } catch (err) { refused = err; }
        open = orch.pendingQuestion?.id || null;
        feature = featureRow(orch) || null;
        orch.answer(q.id, { decision: 'stop' });
      });
      assert.equal((await h.done).status, 'stopped', outline);
      assert.equal(refused?.code, 'INVALID_ANSWER', outline);
      assert.equal(refused.errors[0].code, 'split-not-approvable', outline);
      assert.match(refused.errors[0].message, new RegExp(`${outline} R-`), outline);
      assert.equal(open, 'plan-outline-n_plan-1', outline);
      assert.equal(feature, null, outline);
    }
  });
}

test('B4: a refused Split stays revisable at round 3, not at round 5; Don\'t split is then accepted', async () => {
  const seen = [];
  const h = startSplit({ outline: 'coverage' }, (q, orch) => {
    if (!q.plan?.outline) return approve(q, orch);
    seen.push([q.plan.round, q.plan.revisable]);
    if (q.plan.revisable) orch.answer(q.id, { decision: 'revise', feedback: 'Cover the last requirement' });
    else orch.answer(q.id, { decision: 'flat' });
  });
  assert.equal((await h.done).status, 'done');
  assert.deepEqual(seen, [[1, true], [2, true], [3, true], [4, true], [5, false]]);
  assert.equal(h.order.filter((x) => x === 'C').length, 1, 'person rounds never re-challenge');
});

const OBJECTION = [{ role: 'product', fix: 'Merge runs 1 and 2: they test the same export', ids: ['R-qa-1'] }];

test('B4: objections every round: thorough challenges 3 times with one refine after each; balanced once; lean has no Challenger', async () => {
  for (const [position, want, devil] of [['thorough', ['C', 'R', 'C', 'R', 'C', 'R'], true], ['balanced', ['C', 'R'], true], ['lean', ['C', 'R'], false]]) {
    const prompts = capturePrompts();
    let metaBefore = null; let reviewsBefore = null; let atAsk = null;
    const h = startSplit({ position, challenge: OBJECTION }, (q, orch) => {
      if (q.plan?.outline) {
        atAsk = { reviews: structuredClone(orch.state.roleReviews), meta: JSON.stringify(orch.resolved.nodeCtx.n_roles.meta) };
        return orch.answer(q.id, { decision: 'approve', openObjections: 'kept' });
      }
      if (q.id === 'plan-n_reqrefine-1') { reviewsBefore = structuredClone(orch.state.roleReviews); metaBefore = JSON.stringify(orch.resolved.nodeCtx.n_roles.meta); }
      approve(q, orch);
    });
    const res = await h.done;
    assert.equal(res.status, 'done', res.error);
    assert.deepEqual(h.order, want, position);
    assert.deepEqual(atAsk.reviews, reviewsBefore, `${position}: state.roleReviews unchanged by the challenge`);
    assert.equal(atAsk.meta, metaBefore, `${position}: nc.meta unchanged`);
    const challengePrompts = prompts.filter((p) => p.includes('MOCK_SPLIT_CHALLENGE:'));
    assert.equal(challengePrompts.length, want.filter((x) => x === 'C').length);
    const rule = perspectiveByKey('devil').roleRule;
    assert.equal(challengePrompts.every((p) => p.includes(rule)), devil, `${position}: Challenger`);
    assert.ok(challengePrompts.every((p) => !/MOCK_JSON:|MOCK_PERSPECTIVE:/.test(p)), 'no role-review verdict');
    const later = prompts.slice(prompts.indexOf(challengePrompts.at(-1)) + 1);
    assert.ok(later.filter((p) => /MOCK_PERSPECTIVE:/.test(p)).length > 0, 'n_roles ran after the Split');
    assert.ok(later.every((p) => !p.includes('## Challenge the split')), 'no challenge block in later prompts');
    const ask = h.asks.find(isOutlineAsk);
    assert.equal(ask.plan.challenge.open, 1);
    assert.equal(ask.plan.challenge.rounds, want.length / 2);
    assert.ok(auditOf(h.orch).some((x) => x.startsWith('Slice outline **approve** (round 1 · 1 objection kept)')), position);
    _testing.runClaude = null;
  }
});

test('B4: a person\'s Ask for changes is one Planner resume and no challenge, then the Split is asked again', async () => {
  const h = startSplit({ challenge: OBJECTION }, (q, orch) => {
    if (!q.plan?.outline) return approve(q, orch);
    if (q.plan.round === 1) return orch.answer(q.id, { decision: 'revise', feedback: OBJECTION[0].fix });
    orch.answer(q.id, { decision: 'approve', openObjections: 'kept' });
  });
  assert.equal((await h.done).status, 'done');
  assert.deepEqual(h.order, ['C', 'R', 'R']);
  assert.deepEqual(h.asks.filter(isOutlineAsk).map((q) => q.id), ['plan-outline-n_plan-1', 'plan-outline-n_plan-2']);
});

test('B4: a pause between challenge rounds resumes at the next round', async () => {
  const dir = gitDir('shapereq-b4-pause');
  let paused = false;
  const h = startSplit({ position: 'thorough', challenge: OBJECTION, projectDir: dir });
  const real = h.orch._resumeOutline.bind(h.orch);
  h.orch._resumeOutline = async (...a) => {
    const r = await real(...a);
    if (!paused && h.order.length === 2) { paused = true; h.orch.pause(); }
    return r;
  };
  assert.equal((await h.done).status, 'paused');
  const saved = readPipelineForResume(h.orch.getState().id);
  assert.equal(saved.resumePoint.state?.shaping?.outline?.challenge?.rounds?.length ?? saved.resumePoint.shaping?.outline?.challenge?.rounds?.length, 1);
  const h2 = startSplit({ position: 'thorough', challenge: OBJECTION, projectDir: dir, resume: saved, workflowId: 'wf_shape_req' },
    (q, orch) => (q.plan?.outline ? orch.answer(q.id, { decision: 'approve', openObjections: 'kept' }) : approve(q, orch)));
  const res = await h2.done;
  assert.equal(res.status, 'done', res.error);
  assert.equal(h2.order.filter((x) => x === 'C').length, 2, 'rounds 2 and 3 only');
  assert.equal(h2.asks.find(isOutlineAsk).plan.challenge.rounds, 3);
});

// Small runs C2 (run 1): the origin run builds slice 1 itself. Its Care graph (Test writer, fix cycles, second opinion)
// is applied at the Start step, before the scheduler exists; its plan reviewers come at the Split, from slice 1's ids.
const CODE_MAJOR_EVERY_CYCLE = JSON.stringify({ correctness: EVERY });
const startsOf = (execs) => execs.filter((e) => e.kind !== 'task' && e.status === 'start').map((e) => e.nodeId);
/** A run-1 Split run whose code review blocks every cycle (startSR answers a spent fix loop's gate Continue). */
function startRunOne(position, opts = {}) {
  let testsReq = null;
  const h = startSplit({ position, ...opts });
  const real = h.orch._runNodeAttempts.bind(h.orch);
  h.orch._runNodeAttempts = async (nc, ctx) => {
    if (nc.key === 'testWriter' && testsReq === null) testsReq = await readFile(ctx.bindings?.requirements?.path || '', 'utf8').catch(() => '');
    return real(nc, ctx);
  };
  return { ...h, gates: () => h.asks.filter((q) => q.kind === 'gate').map((q) => q.id), testsReq: () => testsReq };
}

test('small runs C2: run 1 follows its Care plan under every position (Test writer, fix cycles by behaviour, plan reviewers)', () => withEnv({ WORCA_MOCK_ROLE_REVIEW: CODE_MAJOR_EVERY_CYCLE }, async () => {
  const { careRunPlan } = await import('../src/shared/shape/feature-record.mjs');
  const { runRolesOf } = await import('../src/shared/shape/requirements.mjs');
  const { sliceRequirementIds } = await import('../src/shared/shape/slices.mjs');
  for (const position of ['lean', 'balanced', 'thorough']) {
    const h = startRunOne(position);
    const res = await h.done;
    assert.equal(res.status, 'done', `${position}: ${res.error}`);
    const careRun = h.orch.state.stepper.careRun;
    const owned = sliceRequirementIds(h.orch.runShape.slice);
    const want = careRunPlan(position, { runRoles: runRolesOf(owned), lead: 'security' });
    assert.equal(careRun.position, position);
    assert.equal(careRun.testWriter, want.testWriter, position);
    assert.deepEqual(careRun.planReviewers, want.planReviewers, position);
    const planRounds = (h.orch.state.roleReviews?.rounds || []).filter((r) => r.node === 'n_roles');
    assert.deepEqual(planRounds[0].roles.map((r) => r.key), want.planReviewers, position);
    // The fix loop: n_impl runs once per cycle Care allows, then the spent budget holds at w9.
    const order = startsOf(h.execs);
    assert.equal(order.filter((id) => id === 'n_impl').length, want.fixCycles, `${position}: fix executions`);
    assert.deepEqual(h.gates(), [`gate-w9-${want.fixCycles}`], `${position}: the w9 hold`);
    assert.equal(h.orch.state.stepper.graph.wires.find((w) => w.id === 'w9').maxCycles, want.fixCycles);
    // The Test writer: Balanced and Thorough run it once, after Refine and before the Implementer; Lean has none.
    const tests = order.filter((id) => id === 'n_tests').length;
    assert.equal(tests, want.testWriter ? 1 : 0, `${position}: n_tests runs`);
    assert.equal(h.orch.state.stepper.graph.nodes.some((n) => n.id === 'n_tests'), want.testWriter, position);
    if (want.testWriter) {
      assert.ok(order.indexOf('n_tests') > order.lastIndexOf('n_refine') && order.indexOf('n_tests') < order.indexOf('n_impl'), `${position}: ${order.join(' ')}`);
      // Its requirements are slice 1's own agreed ids only.
      const ids = [...h.testsReq().matchAll(/\*\*(R-[a-z]+-\d+)\*\*/g)].map((m) => m[1]);
      assert.ok(ids.length >= 1, h.testsReq());
      assert.deepEqual([...new Set(ids)].sort(), [...owned].sort());
    }
    const label = { lean: 'Lean', balanced: 'Balanced', thorough: 'Thorough' }[position];
    const tw = want.testWriter ? 'by a separate Test writer' : 'by the Implementer';
    const audit = getDb().prepare('SELECT text FROM pipeline_events WHERE pipeline_id = ? ORDER BY id').all(h.orch.getState().id).map((r) => r.text);
    assert.ok(audit.some((t) => t.startsWith(`Care ${label}: tests first, ${tw}, fix cycles ${want.fixCycles}, plan reviewers `)), audit.join('\n'));
  }
}));

test('small runs C2: a project w9 budget wins over run 1\'s Care fix cycles', () => withEnv({ WORCA_MOCK_ROLE_REVIEW: CODE_MAJOR_EVERY_CYCLE }, async () => {
  const { setWireCycles } = await import('../src/core/config.mjs');
  const dir = gitDir('shapereq-c2-w9');
  await setWireCycles(dir, 'wf_shape_req', 'w9', 2);
  const h = startRunOne('lean', { projectDir: dir });
  const res = await h.done;
  assert.equal(res.status, 'done', res.error);
  assert.equal(startsOf(h.execs).filter((id) => id === 'n_impl').length, 2);
  assert.deepEqual(h.gates(), ['gate-w9-2']);
  const audit = getDb().prepare('SELECT text FROM pipeline_events WHERE pipeline_id = ? ORDER BY id').all(h.orch.getState().id).map((r) => r.text);
  assert.ok(audit.some((t) => t.startsWith('Care Lean: tests first, by the Implementer, fix cycles 2, set by the project, plan reviewers ')), audit.join('\n'));
}));

test('small runs C2: an unmarked sliced run 1 has no Care plan, no Test writer and keeps w9 at 3', () => withSmallRuns(false, async () => {
  const h = start({ prompt: SLICED });
  assert.equal((await h.done).status, 'done');
  assert.equal('careRun' in h.orch.state.stepper, false);
  assert.ok(!h.orch.state.stepper.graph.nodes.some((n) => n.id === 'n_tests'));
  assert.equal(h.orch.state.stepper.graph.wires.find((w) => w.id === 'w9').maxCycles, 3);
}));
