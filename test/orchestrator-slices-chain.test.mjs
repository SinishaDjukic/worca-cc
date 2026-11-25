// test/orchestrator-slices-chain.test.mjs — Shape it first slice 4, spec §6 end to end: the outline is approved, the
// feature and its tickets are created, slice 2 is planned just in time against slice 1's output (L5, L6, L9, D14).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { existsSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { useTempHome } from './helpers/temp-home.mjs';
import { gitDir } from './helpers/git-dir.mjs';
import { createOrchestrator } from '../src/core/orchestrator.mjs';
import { runDueTickets, previousBranchesOf, setTicketPipeline, getTicket } from '../src/core/scheduler.mjs';
import { featureView, resumeFeature, featureThread, liveSliceFrom, setApproveEach, addFeatureNote, createSliceFeature } from '../src/core/shape/features.mjs';
import { createThread, linkRun } from '../src/core/ask/store.mjs';
import { readRunResultsById, readPipelineForResume } from '../src/core/artifacts.mjs';
import { projectKey as projectKeyOf } from '../src/core/store.mjs';
import { seedPipelineRow } from './helpers/db-seed.mjs';
import { worcaHome } from '../src/core/projects.mjs';
import { readRunManifest, updateRunManifest } from '../src/core/run-manifest.mjs';
import { getDb } from '../src/core/db.mjs';
import { _testing } from '../src/core/graph/executor.mjs';
import { runClaude } from '../src/core/claude-runner.mjs';
import { mergesFeatureBase, mergesLatestOnResume } from '../src/core/run-harness.mjs';

useTempHome(after);

let sandboxHome;
const prevEnv = {};
before(async () => {
  sandboxHome = await mkdtemp(join(tmpdir(), 'worca-slices-chain-home-'));
  for (const k of ['HOME', 'USERPROFILE', 'WORCA_TEST_ALLOW_HOME_FALLBACK']) prevEnv[k] = process.env[k];
  process.env.HOME = sandboxHome;
  process.env.USERPROFILE = sandboxHome;
  process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = '1';
});
after(async () => {
  _testing.runClaude = null;
  for (const k of ['HOME', 'USERPROFILE', 'WORCA_TEST_ALLOW_HOME_FALLBACK']) {
    if (prevEnv[k] === undefined) delete process.env[k]; else process.env[k] = prevEnv[k];
  }
  await rm(sandboxHome, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

const waitFor = async (pred, ms = 60000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (pred()) return; await new Promise((r) => setTimeout(r, 10)); }
  throw new Error('waitFor timed out');
};
const isOutline = (q) => q.kind === 'plan' && q.plan?.outline;

/** Every agent spawn's prompt, in order — the real runner still runs (the mock engine). */
const prompts = [];
function capturePrompts() {
  prompts.length = 0;
  _testing.runClaude = (opts) => { prompts.push({ prompt: opts.prompt }); return runClaude(opts); };
}

/** A mock run whose plan asks (outline and plan) are all approved, except the ones `hold` keeps open. */
function startRun(opts, { hold = () => false } = {}) {
  const orch = createOrchestrator({ workflowId: 'wf_shape', claude: { mock: true }, ...opts });
  const asks = [];
  orch.on('question', (q) => {
    asks.push(q);
    if (q.kind === 'plan') { if (!hold(q)) setImmediate(() => orch.answer(q.id, { decision: 'approve' })); return; }
    if (q.kind === 'clarify' || q.kind === 'questions') setImmediate(() => orch.answer(q.id, { answers: [] }));
  });
  return { orch, asks, done: orch.run() };
}

test('chain: slice 1 approved and done, slice 2 planned just in time on slice 1\'s branch, stop, then restart after slice 1', async () => {
  capturePrompts();
  const dir = gitDir('slices-chain');
  const perspectives = ['product', 'architect', 'qa'];

  // 1. Slice 1: the outline ask and the plan ask are both approved. The run ends done on its feature branch.
  const one = startRun({ projectDir: dir, prompt: 'Plan this in slices: demo', shape: { perspectives } });
  const res1 = await one.done;
  assert.equal(res1.status, 'done', res1.error);
  assert.deepEqual(one.asks.filter((q) => q.kind === 'plan').map((q) => q.id), ['plan-outline-n_plan-1', 'plan-n_refine-1']);
  const pid1 = one.orch.getState().id;
  const f = getDb().prepare('SELECT * FROM shape_features WHERE origin_pipeline_id = ?').get(pid1);
  assert.ok(f, 'the feature row');
  const prev = previousBranchesOf(pid1);
  assert.ok(prev?.sourceBranch, 'the pipelines row has slice 1\'s feature branch');
  const slice1Results = await readRunResultsById(pid1);
  const slice1Files = [...(slice1Results?.newFiles || []), ...(slice1Results?.changedFiles || [])].map((x) => x.path).filter(Boolean);
  assert.ok(slice1Files.length > 0, 'slice 1 changed files (results.json)');

  // 2. The scheduler fires slice 2's ticket the way fireTicket does: the stored request plus the predecessor's branch.
  let two = null;
  let sourceSeen = null;
  const out = await runDueTickets({
    now: Date.now() + 60_000,
    start: async (ticket) => {
      const body = { ...ticket.request, ...previousBranchesOf(ticket.after.id) };
      sourceSeen = body.sourceBranch;
      two = startRun({
        projectDir: body.projectDir, workflowId: body.workflowId, prompt: body.prompt, title: body.title,
        claude: { mock: body.mock === true }, shape: body.shape, branch: { source: body.sourceBranch },
      }, { hold: () => true });
      await waitFor(() => two.orch.getState().id && two.asks.some((q) => q.kind === 'plan'));
      setTicketPipeline(ticket.id, two.orch.getState().id);
      return { ok: true, pipelineId: two.orch.getState().id };
    },
  });
  assert.equal(out.fired.length, 1, JSON.stringify(out));
  const pid2 = two.orch.getState().id;

  // 3. Slice 2 starts from slice 1's branch, asks its plan first (no outline), and is scoped by slice 1's output.
  assert.equal(sourceSeen, prev.sourceBranch);
  const row2 = getDb().prepare('SELECT branch FROM pipelines WHERE id = ?').get(pid2);
  assert.equal(JSON.parse(row2.branch).source, prev.sourceBranch, 'slice 2\'s run starts from slice 1\'s feature branch');
  assert.equal(two.asks.find((q) => q.kind === 'plan').id, 'plan-n_refine-1', 'its first plan ask is the Refine one');
  assert.ok(!two.asks.some(isOutline), 'slices:off raises no outline ask');
  const planner = prompts.filter((p) => /MOCK_ROLE: planner\b/.test(p.prompt)).at(-1);
  assert.ok(planner, 'a Planner spawn was captured');
  assert.ok(planner.prompt.includes('## This is slice 2 of 2'), 'the Planner prompt carries the slice scope');
  assert.ok(planner.prompt.includes(slice1Files[0]), `the Planner prompt names slice 1's file ${slice1Files[0]}`);

  // 3b. Shaper s2: the feature thread is slice 1's; the feature view names slice 2's open plan ask, and its log comes
  // from the harness's own audit lines.
  const thread = createThread({ title: 'demo' });
  linkRun(thread.id, { runId: 'run-1', pipelineId: pid1, cardId: 'card_1' });
  assert.deepEqual(featureThread(f.id), { threadId: thread.id, cardId: 'card_1' });
  const q2 = two.asks.filter((q) => q.kind === 'plan').at(-1);
  const live = (pid) => (pid === pid2 ? liveSliceFrom({ runId: 'run-2', status: two.orch.getState().status, pendingQuestion: q2 }) : null);
  const v2 = featureView(f.id, { live });
  assert.deepEqual(v2.ask, { index: 2, runId: 'run-2', pipelineId: pid2, id: 'plan-n_refine-1', kind: 'plan' });
  assert.ok(v2.log.some((l) => l.text === 'Split into 2 runs'), JSON.stringify(v2.log));
  assert.ok(v2.log.some((l) => l.run === 1 && l.text === 'Plan approved'), JSON.stringify(v2.log));


  // 4. Stop slice 2: the feature halts there and a restart chains after slice 1's pipeline.
  two.orch.stop();
  assert.equal((await two.done).status, 'stopped');
  const view = featureView(f.id);
  assert.equal(view.halted.index, 2);
  assert.equal(view.halted.state, 'stopped');
  const resume = resumeFeature(f.id);
  assert.equal(resume.action, 'restart');
  assert.deepEqual(getTicket(resume.ticketId).after, { kind: 'pipeline', id: pid1, policy: 'done' });
  assert.equal(getTicket(resume.ticketId).sourceFromPrevious, true);
  assert.notEqual(pid2, pid1);
});

test('chat notes with Away active: Away approves the plan, flagged, naming the notes', async () => {
  const dir = gitDir('slices-notes-away');
  const one = startRun({ projectDir: dir, prompt: 'Plan this in slices: demo', shape: { perspectives: ['product'] } });
  assert.equal((await one.done).status, 'done');
  const f = getDb().prepare('SELECT * FROM shape_features WHERE origin_pipeline_id = ?').get(one.orch.getState().id);
  setApproveEach(f.id, false);
  addFeatureNote(f.id, { kind: 'plan', text: 'use a log scale' });
  const row = getDb().prepare('SELECT ticket_id FROM shape_feature_slices WHERE feature_id = ? AND idx = 2').get(f.id);
  const { request } = getDb().prepare('SELECT request FROM scheduled_runs WHERE id = ?').get(row.ticket_id);
  const body = JSON.parse(request);
  const two = startRun({ projectDir: dir, workflowId: body.workflowId, prompt: body.prompt, claude: { mock: true }, shape: body.shape },
    { hold: () => true });
  two.orch._planCheck = async () => ({ ok: true, passed: 8, total: 8, items: [] });
  two.orch.setNightOverride('on');
  await waitFor(() => two.asks.some((q) => q.kind === 'plan'));
  const q = two.asks.find((x) => x.kind === 'plan');
  assert.deepEqual(q.plan.notes, [{ kind: 'plan', text: 'use a log scale' }]);
  await waitFor(() => two.orch.answeredBy(q.id) === 'night-mode');
  const rec = two.orch.nightDecision(q.id);
  assert.equal(rec.choice, 'approve');
  assert.equal(rec.flagged, true);
  assert.match(rec.rationale, /use a log scale/);
  const audit = getDb().prepare('SELECT text FROM pipeline_events WHERE pipeline_id = ?').all(two.orch.getState().id).map((r) => r.text);
  assert.ok(audit.includes('Plan approval held: the chat added notes to this run.'), JSON.stringify(audit));
  two.orch.stop();
  await two.done;
});

test('s5: dev moved after slice 1 → slice 2 merges dev before its first agent; a chat note holds its plan and reaches the Planner', async () => {
  capturePrompts();
  const dir = gitDir('slices-base');
  execSync('git branch -m dev', { cwd: dir });
  // Slice 2's merge of the moved dev writes a commit, and mergeBaseInto never invents an identity: set one here, or a
  // runner without user.name / user.email (CI) fails where a laptop passes.
  execSync('git config user.email t@t && git config user.name t', { cwd: dir });
  const one = startRun({ projectDir: dir, prompt: 'Plan this in slices: demo', shape: { perspectives: ['product'] } });
  assert.equal((await one.done).status, 'done');
  const pid1 = one.orch.getState().id;
  const f = getDb().prepare('SELECT * FROM shape_features WHERE origin_pipeline_id = ?').get(pid1);
  assert.equal(f.source_branch, 'dev');

  // dev moves while the feature runs; the person turns Ask before each run off and adds a note from the chat.
  writeFileSync(join(dir, 'hotfix.txt'), 'hotfix\n');
  execSync('git add hotfix.txt && git -c user.email=t@t -c user.name=t commit -q -m hotfix', { cwd: dir });
  setApproveEach(f.id, false);
  assert.equal(addFeatureNote(f.id, { kind: 'plan', text: 'use a log scale' }).runIndex, 2);

  let two = null;
  const held = [];
  await runDueTickets({
    now: Date.now() + 60_000,
    start: async (ticket) => {
      if (ticket.request?.shape?.slice?.feature !== f.id) return { ok: false, error: 'not in this test' };   // the first case's restart
      const body = { ...ticket.request, ...previousBranchesOf(ticket.after.id) };
      two = startRun({
        projectDir: body.projectDir, workflowId: body.workflowId, prompt: body.prompt, title: body.title,
        claude: { mock: body.mock === true }, shape: body.shape, branch: { source: body.sourceBranch },
      }, { hold: (q) => { held.push(q); return true; } });
      await waitFor(() => two.orch.getState().id && two.asks.some((q) => q.kind === 'plan'));
      setTicketPipeline(ticket.id, two.orch.getState().id);
      return { ok: true, pipelineId: two.orch.getState().id };
    },
  });
  const pid2 = two.orch.getState().id;
  const audit = getDb().prepare('SELECT text FROM pipeline_events WHERE pipeline_id = ? ORDER BY id').all(pid2).map((r) => r.text);
  assert.ok(audit.some((t) => t.startsWith('Base `dev` moved: merged into ')), JSON.stringify(audit));
  const wt = JSON.parse(getDb().prepare('SELECT branch FROM pipelines WHERE id = ?').get(pid2).branch).worktreeDir;
  assert.ok(existsSync(join(wt, 'hotfix.txt')), 'slice 2 starts from the moved base');
  assert.ok(featureView(f.id).log.some((l) => l.text === 'dev moved · run 2 starts from it'), JSON.stringify(featureView(f.id).log));

  // D12: the note holds the plan with Ask before each run off, is on the ask, and reaches the Planner's prompt.
  const q = held.find((x) => x.kind === 'plan');
  assert.ok(q, 'the plan ask is held');
  assert.deepEqual(q.plan.notes, [{ kind: 'plan', text: 'use a log scale' }]);
  assert.ok(audit.includes('Plan approval held: the chat added notes to this run.'), JSON.stringify(audit));
  const planner = prompts.filter((p) => /MOCK_ROLE: planner\b/.test(p.prompt)).at(-1);
  assert.ok(planner.prompt.includes('use a log scale'));
  two.orch.stop();
  await two.done;
});

test('s5 (D14): only a fresh single-project run 2+ of a feature merges the base; no slice, run 1, a workspace or a reused checkout skips it', () => {
  const sl = { feature: 'feat-1', index: 2 };
  assert.equal(mergesFeatureBase({ slice: sl, freshStart: true, isWorkspace: false }), true);
  assert.equal(mergesFeatureBase({ slice: null, freshStart: true, isWorkspace: false }), false, 'a run without shape.slice');
  assert.equal(mergesFeatureBase({ slice: { ...sl, index: 1 }, freshStart: true, isWorkspace: false }), false, 'run 1');
  assert.equal(mergesFeatureBase({ slice: sl, freshStart: true, isWorkspace: true }), false, 'a workspace run');
  assert.equal(mergesFeatureBase({ slice: sl, freshStart: false, isWorkspace: false }), false, 'a reused checkout');
});

// ── Shaper small runs A5 (D8, D9): a resumed slice first merges the feature's latest finished work ─────────────────
const sh = (cwd, cmd) => execSync(cmd, { cwd, encoding: 'utf8' }).trim();
const isAncestorOf = (cwd, a, b) => { try { execSync(`git merge-base --is-ancestor ${a} ${b}`, { cwd, stdio: 'ignore' }); return true; } catch { return false; } };
const auditOf = (pid) => getDb().prepare('SELECT text FROM pipeline_events WHERE pipeline_id = ? ORDER BY id').all(pid).map((r) => r.text);
const branchRow = (pid) => JSON.parse(getDb().prepare('SELECT branch FROM pipelines WHERE id = ?').get(pid).branch);
const filesOf = async (pid) => { const r = await readRunResultsById(pid); return [...(r?.newFiles || []), ...(r?.changedFiles || [])].map((x) => x.path); };
let worldSeq = 0;
/** A 4-run feature in a real repo: run 1 done on `main`, run 2 a mock wf_shape run paused at its plan ask with a commit of
 *  its own (`own.txt`), runs 3 and 4 finished by hand on stacked branches from `main` (`s3.txt`, `s4.txt`; run 4 also
 *  edits `clash.txt` when `clash`). */
async function pausedSliceWorld(tag, { clash = false } = {}) {
  const dir = gitDir(tag);
  execSync('git branch -m main && git config user.email t@t && git config user.name t && git config commit.gpgsign false', { cwd: dir });
  writeFileSync(join(dir, 'clash.txt'), 'base\n');
  writeFileSync(join(dir, 'CLAUDE.md'), '# Project\n');
  sh(dir, 'git add -A && git commit -qm base');
  const key = projectKeyOf(dir);
  const n = ++worldSeq;
  const origin = `a5o${String(n).padStart(5, '0')}`;
  seedPipelineRow({ id: origin, projectKey: key, status: 'done', title: 'Run 1', branch: { source: 'main', feature: 'main' } });
  const outline = { why: 'w', slices: [1, 2, 3, 4].map((i) => ({ id: `s${i}`, title: `Slice ${i}`, goal: `g${i}`, inScope: [], outOfScope: [],
    acceptance: [], dependsOn: [], estimate: 'S' })) };
  const f = createSliceFeature({ pipelineId: origin, projectDir: dir, title: 'Charts', outline, perspectives: ['product'], workflowId: 'wf_shape', base: { mock: true } });
  const ticketOf = (k) => getDb().prepare('SELECT ticket_id FROM shape_feature_slices WHERE feature_id = ? AND idx = ?').get(f.id, k).ticket_id;
  const two = startRun({ projectDir: dir, prompt: 'slice 2', shape: { perspectives: ['product'], slices: 'off', slice: { feature: f.id, index: 2, total: 4, outline } },
    branch: { source: 'main' } }, { hold: () => true });
  let ended = null;
  two.done.then((x) => { ended = x; });
  await waitFor(() => ended || (two.orch.getState().id && two.asks.some((q) => q.kind === 'plan')));
  assert.equal(ended, null, `run 2 ended before its plan ask: ${JSON.stringify(ended)}`);
  two.orch.pause();
  assert.equal((await two.done).status, 'paused');
  const pid = two.orch.getState().id;
  setTicketPipeline(ticketOf(2), pid);
  getDb().prepare("UPDATE scheduled_runs SET status = 'fired' WHERE id = ?").run(ticketOf(2));
  const { worktreeDir: wt, feature } = branchRow(pid);
  writeFileSync(join(wt, 'own.txt'), 'own\n');
  if (clash) writeFileSync(join(wt, 'clash.txt'), 'run 2\n');
  sh(wt, 'git add own.txt clash.txt && git commit -qm own');
  const own = sh(wt, 'git rev-parse HEAD');
  const later = (k, from) => {
    const br = `feat/a5-${n}-s${k}`;
    sh(dir, `git checkout -q -b ${br} ${from}`);
    writeFileSync(join(dir, `s${k}.txt`), `${k}\n`);
    if (clash && k === 4) writeFileSync(join(dir, 'clash.txt'), 'run 4\n');
    sh(dir, `git add -A && git commit -qm s${k} && git checkout -q main`);
    const p = `a5s${String(n).padStart(4, '0')}${k}`;
    seedPipelineRow({ id: p, projectKey: key, status: 'done', title: `Run ${k}`, branch: { source: from, feature: br } });
    getDb().prepare("UPDATE scheduled_runs SET status = 'fired', pipeline_id = ? WHERE id = ?").run(p, ticketOf(k));
    return br;
  };
  const s3 = later(3, 'main');
  const s4 = later(4, s3);
  return { dir, f, pid, wt, feature, own, s3, s4 };
}
/** Resume run 2 from its saved row (a fresh orchestrator, as the server's resumeRun builds one). */
function resumeSlice(w, { hold = () => false } = {}) {
  const orch = createOrchestrator({ workflowId: 'wf_shape', projectDir: w.dir, claude: { mock: true }, resume: readPipelineForResume(w.pid) });
  const asks = [];
  orch.on('question', (q) => {
    asks.push(q);
    if (q.kind === 'plan') { if (!hold(q)) setImmediate(() => orch.answer(q.id, { decision: 'approve' })); return; }
    if (q.kind === 'clarify' || q.kind === 'questions') setImmediate(() => orch.answer(q.id, { answers: [] }));
  });
  return { orch, asks, done: orch.resume() };
}
const SMALL = (on) => { if (on) process.env.WORCA_FLAGS = 'shaperSmallRuns'; else delete process.env.WORCA_FLAGS; };
const withFlag = async (on, fn) => { const prev = process.env.WORCA_FLAGS; SMALL(on); try { return await fn(); } finally { if (prev === undefined) delete process.env.WORCA_FLAGS; else process.env.WORCA_FLAGS = prev; } };

test('mergesLatestOnResume: slice, single project, flag on only', () => {
  const sl = { feature: 'feat-1', index: 3 };
  assert.equal(mergesLatestOnResume({ slice: sl, isWorkspace: false, smallRuns: true }), true);
  assert.equal(mergesLatestOnResume({ slice: { ...sl, index: 1 }, isWorkspace: false, smallRuns: true }), true, 'any slice, run 1 too');
  assert.equal(mergesLatestOnResume({ slice: null, isWorkspace: false, smallRuns: true }), false);
  assert.equal(mergesLatestOnResume({ slice: sl, isWorkspace: true, smallRuns: true }), false);
  assert.equal(mergesLatestOnResume({ slice: sl, isWorkspace: false, smallRuns: false }), false);
});

test('small runs: a paused slice resumed after two later slices finished merges the latest finished branch first', () => withFlag(true, async () => {
  const w = await pausedSliceWorld('a5-merge');
  assert.equal(sh(w.wt, 'git status --porcelain --untracked-files=no'), '', 'a clean checkout at resume');
  const r = resumeSlice(w);
  assert.equal((await r.done).status, 'done');
  assert.ok(isAncestorOf(w.dir, w.s3, w.feature), "run 3's commits are in run 2's branch");
  assert.ok(isAncestorOf(w.dir, w.s4, w.feature), "run 4's commits are in run 2's branch");
  assert.ok(isAncestorOf(w.dir, w.own, w.feature), "run 2's own commit is kept");
  const b = branchRow(w.pid);
  assert.deepEqual({ ...b.baseMerged }, { base: w.s4, behind: b.baseMerged.behind, merged: true, onResume: true });
  assert.ok(b.baseRefs[w.s4], 'the merged base tip is recorded');
  assert.ok(auditOf(w.pid).some((t) => t.startsWith(`Base \`${w.s4}\` moved: merged into`)), JSON.stringify(auditOf(w.pid)));
  const files = await filesOf(w.pid);
  assert.ok(files.includes('own.txt'), JSON.stringify(files));
  assert.ok(!files.includes('s3.txt') && !files.includes('s4.txt'), JSON.stringify(files));
}));

test('small runs: a paused slice with an uncommitted edit commits it, then merges', () => withFlag(true, async () => {
  const w = await pausedSliceWorld('a5-wip');
  writeFileSync(join(w.wt, 'own.txt'), 'own, edited while paused\n');
  const r = resumeSlice(w, { hold: () => true });
  await waitFor(() => r.asks.some((q) => q.kind === 'plan'));
  const merge = sh(w.wt, 'git rev-parse HEAD');
  assert.equal(sh(w.wt, `git rev-list --parents -n 1 ${merge}`).split(' ').length, 3, 'HEAD is the merge');
  const wip = sh(w.wt, `git rev-parse ${merge}^1`);
  assert.notEqual(wip, w.own, 'the edit was committed first');
  assert.deepEqual(sh(w.wt, `git show --name-only --format= ${wip}`).split('\n').filter(Boolean), ['own.txt'], 'only the edit, no injected path');
  r.orch.stop();
  await r.done;
  assert.ok((await filesOf(w.pid)).includes('own.txt'));
  assert.ok(isAncestorOf(w.dir, w.s4, w.feature));
}));

test('small runs: a tracked CLAUDE.md fence left uncommitted records baseMerged.merged false with status dirty and writes the Resumed line', () => withFlag(true, async () => {
  const w = await pausedSliceWorld('a5-fence');
  writeFileSync(join(w.wt, 'CLAUDE.md'), '# Project\n\n<!-- worca:begin -->\nrun context\n<!-- worca:end -->\n');
  // worca's fence entry, as the run's assembly records it (the run root's manifest; reattach restores it on resume).
  const key = projectKeyOf(w.dir);
  const root = join(worcaHome(), 'runs', w.pid);
  const m = await readRunManifest(root);
  assert.ok(m, 'a detached run root');
  const injected = { ...(m.injectedPaths || {}) };
  injected[key] = [...(injected[key] || []), { kind: 'claudeMdSection', path: 'CLAUDE.md' }];
  await updateRunManifest(root, { injectedPaths: injected });
  const r = resumeSlice(w, { hold: () => true });
  await waitFor(() => r.asks.some((q) => q.kind === 'plan'));
  const b = branchRow(w.pid);
  assert.deepEqual({ ...b.baseMerged }, { base: w.s4, behind: b.baseMerged.behind, merged: false, onResume: true, status: 'dirty' });
  assert.ok(auditOf(w.pid).includes('Resumed · could not take in the latest finished work (dirty).'), JSON.stringify(auditOf(w.pid)));
  assert.equal(sh(w.wt, 'git rev-parse HEAD'), w.own, 'nothing was committed: the fence stays out');
  r.orch.stop();
  await r.done;
}));

test("small runs: a conflicting latest branch leaves run 2's head unchanged, records baseMerged.merged false and writes the conflicts line", () => withFlag(true, async () => {
  const w = await pausedSliceWorld('a5-clash', { clash: true });
  const r = resumeSlice(w, { hold: () => true });
  await waitFor(() => r.asks.some((q) => q.kind === 'plan'));
  assert.equal(sh(w.wt, 'git rev-parse HEAD'), w.own);
  const b = branchRow(w.pid);
  assert.deepEqual({ ...b.baseMerged }, { base: w.s4, behind: b.baseMerged.behind, merged: false, onResume: true, status: 'conflicts' });
  assert.ok(auditOf(w.pid).includes(`Base \`${w.s4}\` moved: conflicts in 1 file.`), JSON.stringify(auditOf(w.pid)));
  r.orch.stop();
  assert.equal((await r.done).status, 'stopped', 'the run went on');
}));

test('flag off: the same resume does not merge', () => withFlag(false, async () => {
  const w = await pausedSliceWorld('a5-off');
  const r = resumeSlice(w);
  assert.equal((await r.done).status, 'done');
  assert.ok(!isAncestorOf(w.dir, w.s3, w.feature) && !isAncestorOf(w.dir, w.s4, w.feature));
  assert.ok(!auditOf(w.pid).some((t) => /^Base `.*` moved/.test(t) && t.includes(w.s4)), JSON.stringify(auditOf(w.pid)));
  assert.equal(branchRow(w.pid).baseMerged?.onResume, undefined);
}));

test('merged with the flag on, then resumed with it off: the diff still excludes the merged commits', async () => {
  const w = await withFlag(true, () => pausedSliceWorld('a5-roundtrip'));
  const one = await withFlag(true, async () => {
    const r = resumeSlice(w, { hold: () => true });
    await waitFor(() => r.asks.some((q) => q.kind === 'plan'));
    r.orch.pause();
    return r.done;
  });
  assert.equal(one.status, 'paused');
  assert.ok(isAncestorOf(w.dir, w.s4, w.feature));
  await withFlag(false, async () => {
    const r = resumeSlice(w);
    assert.equal((await r.done).status, 'done');
  });
  const files = await filesOf(w.pid);
  assert.ok(files.includes('own.txt'), JSON.stringify(files));
  assert.ok(!files.includes('s3.txt') && !files.includes('s4.txt'), JSON.stringify(files));
});

test('small runs: a resume with nothing newer finished writes no Resumed line and keeps the earlier baseMerged', () => withFlag(true, async () => {
  const w = await pausedSliceWorld('a5-uptodate');
  const one = resumeSlice(w, { hold: () => true });
  await waitFor(() => one.asks.some((q) => q.kind === 'plan'));
  one.orch.pause();
  assert.equal((await one.done).status, 'paused');
  const before = branchRow(w.pid).baseMerged;
  assert.equal(before.merged, true);
  const head = sh(w.wt, 'git rev-parse HEAD');
  const two = resumeSlice(w, { hold: () => true });
  await waitFor(() => two.asks.some((q) => q.kind === 'plan'));
  assert.equal(sh(w.wt, 'git rev-parse HEAD'), head, 'no new commit');
  assert.deepEqual({ ...branchRow(w.pid).baseMerged }, { ...before });
  assert.ok(!auditOf(w.pid).some((t) => t.startsWith('Resumed ·')), JSON.stringify(auditOf(w.pid)));
  two.orch.stop();
  await two.done;
}));
