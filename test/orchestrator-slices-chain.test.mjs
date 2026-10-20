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
import { featureView, resumeFeature, featureThread, liveSliceFrom, setApproveEach, addFeatureNote } from '../src/core/shape/features.mjs';
import { createThread, linkRun } from '../src/core/ask/store.mjs';
import { readRunResultsById } from '../src/core/artifacts.mjs';
import { getDb } from '../src/core/db.mjs';
import { _testing } from '../src/core/graph/executor.mjs';
import { runClaude } from '../src/core/claude-runner.mjs';
import { mergesFeatureBase } from '../src/core/run-harness.mjs';

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
