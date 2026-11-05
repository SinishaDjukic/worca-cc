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
afterEach(() => { delete process.env.WORCA_MOCK_UNCOVERED; _testing.runClaude = null; });
after(async () => {
  for (const k of ENV) { if (prevEnv[k] === undefined) delete process.env[k]; else process.env[k] = prevEnv[k]; }
  await rm(sandboxHome, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

const approve = (q, orch) => orch.answer(q.id, { decision: 'approve' });
const isReqAsk = (q) => q.kind === 'plan' && !!(q.plan?.criteria || q.plan?.error);

/** A mock Shaper run. `onAsk(q, orch)` answers every plan ask (default approve); Clarify is answered empty. */
function start(opts = {}, onAsk = approve) {
  const dir = opts.projectDir || gitDir('shapereq');
  const req = resolveShapeRequest({ shape: opts.shape ?? { size: 'large', lead: 'security' } }, { requirementsOn: opts.flag !== false });
  assert.equal(req.ok, true, req.error);
  const orch = createOrchestrator({ projectDir: dir, workflowId: opts.workflowId || req.workflowId, prompt: 'demo',
    claude: { mock: true }, shape: req.shape, ...(opts.resume ? { resume: opts.resume } : {}) });
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

test('a wf_shape_req run paused at the requirements hold resumes with the flag off', async () => {
  const dir = gitDir('shapereq-off');
  let paused = false;
  const h = start({ projectDir: dir }, (q, orch) => { if (!paused && isReqAsk(q)) { paused = true; orch.pause(); } else approve(q, orch); });
  assert.equal((await h.done).status, 'paused');
  const saved = readPipelineForResume(h.orch.getState().id);
  assert.equal(saved.resumePoint.workflowId, 'wf_shape_req');
  const h2 = start({ projectDir: dir, resume: saved, flag: false, workflowId: 'wf_shape_req' });
  const res = await h2.done;
  assert.equal(res.status, 'done', res.error);
  assert.deepEqual(h2.asks.filter((q) => q.kind === 'plan').map((q) => q.nodeId), ['n_reqrefine', 'n_refine']);
});
