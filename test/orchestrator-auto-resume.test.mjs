// test/orchestrator-auto-resume.test.mjs
import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { gitDir } from './helpers/git-dir.mjs';
import { createOrchestrator } from '../src/core/orchestrator.mjs';
import { normalizeShape } from '../src/shared/graph/assemble.mjs';
import { ClassifierError } from '../src/core/auto/classify.mjs';
import { readPipelineForResume, listSubAgents, reconcileStaleRunning } from '../src/core/artifacts.mjs';
import { setPipelineCostLimitUsd } from '../src/core/settings.mjs';

useTempHome(after);
let sandboxHome;
const prevEnv = {};
before(async () => {
  sandboxHome = await mkdtemp(join(tmpdir(), 'worca-auto-resume-home-'));
  for (const k of ['HOME', 'USERPROFILE', 'WORCA_TEST_ALLOW_HOME_FALLBACK']) prevEnv[k] = process.env[k];
  process.env.HOME = sandboxHome; process.env.USERPROFILE = sandboxHome; process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = '1';
});
after(async () => {
  for (const k of ['HOME', 'USERPROFILE', 'WORCA_TEST_ALLOW_HOME_FALLBACK']) { if (prevEnv[k] === undefined) delete process.env[k]; else process.env[k] = prevEnv[k]; }
  await rm(sandboxHome, { recursive: true, force: true });
});

const S = (agent, extra = {}) => ({ agent, ...extra });
const QUICK = { name: 'Quick fix', taskKind: 'prompt', stages: [S('planner'), S('implementer'), S('reviewer')] };
const BAD = { name: 'Bad', stages: [S('workspaceScanner')] };   // a real key the assembler refuses (placeable:false)
const shapeOf = (s, costUsd = 0.01) => async (input) => ({ shape: normalizeShape(s), warnings: [], costUsd, attempts: 1, model: input.model || null, _input: input });
/** A classifier that fails after having SPENT `costUsd` (two billed replies behind a CLASSIFIER_FAILED). */
const failing = (msg, costUsd = 0) => async () => { throw new ClassifierError('CLASSIFIER_FAILED', msg, [], { costUsd, usage: { input_tokens: 7, output_tokens: 3 } }); };
const orchFor = (dir, over = {}) => createOrchestrator({ projectDir: dir, workflowId: 'wf_auto', prompt: 'Build the thing.', claude: { mock: true }, humanInLoop: false, ...over });
/** Record the order two methods run in and whether the restore ever saw a `deciding` point. */
function spy(orch) {
  const order = [];
  const restored = [];
  for (const m of ['_decideTopology', '_replaySetup']) { const orig = orch[m].bind(orch); orch[m] = async (...a) => { order.push(m); return orig(...a); }; }
  const origRestore = orch._restoreFromResumePoint.bind(orch);
  orch._restoreFromResumePoint = async (rp) => { restored.push(rp?.manifest?.auto?.status ?? null); return origRestore(rp); };
  return { order, restored };
}
/** Answer every workflow question with `onWorkflow`; clarify with no answers; gates continue. */
function answerer(orch, onWorkflow) {
  const seen = [];
  orch.on('question', (q) => {
    seen.push(q);
    setImmediate(() => {
      if (q.kind === 'workflow') orch.answer(q.id, onWorkflow(q));
      else if (q.kind === 'clarify' || q.kind === 'questions') orch.answer(q.id, { answers: [] });
      else orch.answer(q.id, { decision: 'continue' });
    });
  });
  return seen;
}
/** Run to the open proposal and pause there (the worktree is KEPT — stop() would tear it down). */
async function pausedOnProposal(dir, classify) {
  const first = orchFor(dir, { humanInLoop: true, classify });
  first.on('question', (q) => { if (q.kind === 'workflow') setImmediate(() => first.pause()); });
  const r1 = await first.run();
  assert.equal(r1.status, 'paused', JSON.stringify(r1));
  return { first, saved: readPipelineForResume(first.getState().id) };
}

test('a classifier failure pauses the run through the failure policy before any graph exists; resume re-decides BEFORE the setup replay and finishes', { timeout: 120000 }, async () => {
  const dir = gitDir('auto-fail');
  const first = orchFor(dir, { classify: failing('no reply from the model', 0.03) });
  const r1 = await first.run();
  assert.equal(r1.status, 'paused', JSON.stringify(r1));
  assert.equal(r1.reason, 'error', 'D17: a classifier failure is an error-pause (a REASON code, never free text)');
  assert.equal(r1.detail, 'the workflow classifier failed: no reply from the model', 'the message rides pauseDetail');
  assert.equal(first.getState().pauseReason, 'error', 'mirrored onto state by _setPauseReason');
  const billed = listSubAgents(first.getState().id).find((s) => s.id === 'auto-classify-1');
  assert.equal(billed?.costUsd, 0.03, 'a FAILED round is still billed (D14)');
  assert.equal(billed?.tokens, 10);
  const saved = readPipelineForResume(first.getState().id);
  assert.equal(saved.row.status, 'paused');
  const rp = saved.resumePoint;
  assert.equal(rp.version, 2);
  assert.equal(rp.workflowId, 'wf_auto');
  assert.equal(rp.pauseReason, 'error');
  assert.equal(rp.setupIncomplete, true, 'the hook sits before _setupDone: resume replays the setup');
  assert.equal(rp.manifest.auto.status, 'deciding');
  assert.deepEqual(rp.auto, { humanInLoop: false, feedback: [], round: 1, prior: null, costUsd: 0.03, pending: null }, 'a round that never assembled leaves no pending proposal');
  assert.equal(rp.snapshot, null, 'nothing was dispatched');

  const calls = [];
  const second = createOrchestrator({ projectDir: dir, claude: { mock: true }, resume: saved, classify: async (input) => { calls.push(input); return shapeOf(QUICK)(input); } });
  const { order, restored } = spy(second);
  const r2 = await second.resume();
  assert.equal(r2.status, 'done', r2.error);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].humanInLoop, false, 'the switch was restored from the point');
  assert.deepEqual(order, ['_decideTopology', '_replaySetup'], 'the decision precedes the setup replay, so the skills gate sees the adopted agents');
  assert.deepEqual(restored, [], 'a point still deciding is re-decided by resume(), never restored');
  assert.deepEqual([...second._engineAgentKeys()].sort(), ['implementer', 'planner', 'reviewer'], 'the replayed skills gate walked the ADOPTED keys');
  const st = second.getState();
  assert.equal(st.stepper.auto.status, 'decided');
  assert.equal(st.stepper.auto.rounds, 2, 'the failed round counts');
  assert.equal(readPipelineForResume(st.id).row.resume_point, null);
});

test('two unassemblable shapes pause the run; the revise feedback survives the pause and resume', { timeout: 120000 }, async () => {
  const dir = gitDir('auto-shape');
  let n = 0;
  const classify = async (input) => { n += 1; return n === 1 ? shapeOf(QUICK)(input) : shapeOf(BAD)(input); };
  const first = orchFor(dir, { classify, humanInLoop: true });
  first.on('question', (q) => setImmediate(() => first.answer(q.id, q.kind === 'workflow' ? { decision: 'revise', text: 'make it bigger' } : { answers: [] })));
  const r1 = await first.run();
  assert.equal(r1.status, 'paused', JSON.stringify(r1));
  assert.equal(r1.reason, 'error');
  assert.match(r1.detail, /^invalid workflow shape: .*cannot be a graph node/);
  assert.equal(n, 3, 'round 1 ok, round 2 = one attempt + one assembler-driven retry');
  const saved = readPipelineForResume(first.getState().id);
  assert.deepEqual(saved.resumePoint.auto.feedback, ['make it bigger']);
  assert.equal(saved.resumePoint.auto.round, 2);
  assert.equal(saved.resumePoint.auto.humanInLoop, true);
  assert.equal(saved.resumePoint.auto.prior.name, 'Quick fix');

  const calls = [];
  const second = createOrchestrator({ projectDir: dir, claude: { mock: true }, resume: saved, classify: async (input) => { calls.push(input); return shapeOf(QUICK)(input); } });
  second.on('question', (q) => setImmediate(() => second.answer(q.id, q.kind === 'workflow' ? { decision: 'accept' } : { answers: [] })));
  const r2 = await second.resume();
  assert.equal(r2.status, 'done', r2.error);
  assert.deepEqual(calls[0].feedback, ['make it bigger']);
  assert.equal(calls[0].priorShape.name, 'Quick fix');
  assert.equal(second.getState().stepper.auto.rounds, 3);
});

test('a pipeline cost cap hit by the classifier pauses with cost_pipeline; raising it lets the resume decide', { timeout: 120000 }, async () => {
  const dir = gitDir('auto-cost');
  await setPipelineCostLimitUsd(0.01);
  try {
    const first = orchFor(dir, { classify: shapeOf(QUICK, 0.05) });
    const r1 = await first.run();
    assert.equal(r1.status, 'paused', JSON.stringify(r1));
    assert.equal(r1.reason, 'cost_pipeline');
    assert.match(r1.detail, /pipeline cost limit/);
    const saved = readPipelineForResume(first.getState().id);
    assert.equal(saved.resumePoint.manifest.auto.status, 'deciding');
    assert.equal(saved.resumePoint.auto.round, 1, 'the point carries the CURRENT decision state, rebuilt when the cap unwound the loop');
    assert.ok(listSubAgents(first.getState().id).some((s) => s.id === 'auto-classify-1'), 'the spend that tripped the cap is recorded');
    await setPipelineCostLimitUsd(10);
    const second = createOrchestrator({ projectDir: dir, claude: { mock: true }, resume: saved, classify: shapeOf(QUICK, 0.05) });
    const r2 = await second.resume();
    assert.equal(r2.status, 'done', r2.error);
    assert.equal(second.getState().stepper.auto.status, 'decided');
  } finally {
    await setPipelineCostLimitUsd('');
  }
});

test('a pause AFTER the decision resumes through the normal path: no classifier call, rounds unchanged', { timeout: 120000 }, async () => {
  const dir = gitDir('auto-decided');
  let calls = 0;
  const first = orchFor(dir, { classify: async (input) => { calls += 1; return shapeOf(QUICK)(input); } });
  let paused = false;
  // Pause on the first AGENT execution start (the graph is decided by then; the
  // preflight/done bookends are not agent nodes).
  first.on('exec', (ev) => {
    if (!paused && ev.status === 'start' && ev.nodeId && ev.nodeId !== 'preflight' && ev.nodeId !== 'done') { paused = true; first.pause(); }
  });
  const r1 = await first.run();
  assert.equal(r1.status, 'paused', JSON.stringify(r1));
  const saved = readPipelineForResume(first.getState().id);
  assert.equal(saved.resumePoint.manifest.auto.status, 'decided');
  assert.equal(saved.resumePoint.workflowId, saved.resumePoint.manifest.auto.workflowId, 'the point names the ADOPTED workflow, not wf_auto');
  assert.equal(saved.resumePoint.auto, null, 'decided: no decision state rides the point');
  const second = createOrchestrator({ projectDir: dir, claude: { mock: true }, resume: saved, classify: async () => { throw new Error('the classifier must not run again'); } });
  const { order } = spy(second);
  const r2 = await second.resume();
  assert.equal(r2.status, 'done', r2.error);
  assert.equal(calls, 1);
  assert.ok(!order.includes('_replaySetup') || order.indexOf('_decideTopology') < order.indexOf('_replaySetup'));
  assert.equal(second.getState().stepper.auto.rounds, 1);
});

test('B4: a pause while the proposal is open resumes INTO the same proposal — no classifier call, no second cost row, round unchanged', { timeout: 120000 }, async () => {
  const dir = gitDir('auto-pending-pause');
  let calls = 0;
  const { saved } = await pausedOnProposal(dir, async (input) => { calls += 1; return shapeOf(QUICK, 0.02)(input); });
  assert.equal(saved.resumePoint.manifest.auto.status, 'deciding');
  assert.equal(saved.resumePoint.setupIncomplete, true);
  assert.deepEqual(saved.resumePoint.auto.pending && { round: saved.resumePoint.auto.pending.round, name: saved.resumePoint.auto.pending.shape.name, warnings: saved.resumePoint.auto.pending.warnings }, { round: 1, name: 'Quick fix', warnings: [] }, 'the open proposal rides the point');
  assert.equal(saved.resumePoint.auto.costUsd, 0.02, 'the classifier spend rides the point (B5)');
  const second = createOrchestrator({ projectDir: dir, claude: { mock: true }, resume: saved, classify: async () => { throw new Error('the classifier must not run again'); } });
  const seen = answerer(second, () => ({ decision: 'accept', name: 'Quick fix', nodes: {} }));
  const r2 = await second.resume();
  assert.equal(r2.status, 'done', r2.error);
  assert.equal(calls, 1);
  assert.equal(seen.filter((q) => q.kind === 'workflow').length, 1, 'the SAME proposal is re-asked once');
  assert.equal(seen[0].workflow.round, 1);
  assert.equal(seen[0].workflow.costUsd, 0.02, 'proposal.costUsd includes the pre-pause spend');
  assert.equal(second.getState().stepper.auto.rounds, 1, 'a replay is not a new round');
  assert.deepEqual(listSubAgents(second.getState().id).filter((s) => s.subagentType === 'auto-classify').map((s) => s.id), ['auto-classify-1'], 'no second cost row');
  assert.equal(readPipelineForResume(second.getState().id).row.resume_point, null, 'decided + done: the point is gone');
});

test('B4: a pipeline cost cap raised inside the classifier round resumes into the pending proposal without a second bill', { timeout: 120000 }, async () => {
  const dir = gitDir('auto-pending-cap');
  await setPipelineCostLimitUsd(0.01);
  try {
    const first = orchFor(dir, { classify: shapeOf(QUICK, 0.05) });
    const r1 = await first.run();
    assert.equal(r1.status, 'paused'); assert.equal(r1.reason, 'cost_pipeline');
    const saved = readPipelineForResume(first.getState().id);
    assert.equal(saved.resumePoint.auto.pending.shape.name, 'Quick fix', 'the round that tripped the cap is kept (pending is set BEFORE the cost row)');
    assert.equal(saved.resumePoint.auto.costUsd, 0.05);
    await setPipelineCostLimitUsd(10);
    let calls = 0;
    const second = createOrchestrator({ projectDir: dir, claude: { mock: true }, resume: saved, classify: async (i) => { calls += 1; return shapeOf(QUICK, 0.05)(i); } });
    const r2 = await second.resume();
    assert.equal(r2.status, 'done', r2.error);
    assert.equal(calls, 0, 'replayed, not re-classified');
    assert.equal(second.getState().stepper.auto.rounds, 1);
    assert.equal(listSubAgents(second.getState().id).filter((s) => s.subagentType === 'auto-classify').length, 1);
  } finally { await setPipelineCostLimitUsd(''); }
});

test('B4: a saved proposal that no longer assembles is dropped and the resume classifies afresh in the same call (no second pause)', { timeout: 120000 }, async () => {
  const dir = gitDir('auto-pending-stale');
  const { saved } = await pausedOnProposal(dir, shapeOf(QUICK, 0.02));
  saved.resumePoint.auto.pending.shape.stages[0].agent = 'workspaceScanner';   // a real key the assembler refuses (placeable:false)
  let calls = 0;
  const second = createOrchestrator({ projectDir: dir, claude: { mock: true }, resume: saved, classify: async (i) => { calls += 1; return shapeOf(QUICK, 0.02)(i); } });
  answerer(second, () => ({ decision: 'accept', name: 'Quick fix', nodes: {} }));
  const r2 = await second.resume();
  assert.equal(r2.status, 'done', r2.error);
  assert.equal(calls, 1, 'one fresh classification');
  assert.equal(second.getState().stepper.auto.rounds, 2, 'the stale replay is not a round; the fresh classification is');
  assert.deepEqual(listSubAgents(second.getState().id).filter((s) => s.subagentType === 'auto-classify').map((s) => s.id), ['auto-classify-1', 'auto-classify-2']);
});

test('B6: a server restart while the proposal is open leaves a RESUMABLE row (setup-incomplete point with the pending proposal)', { timeout: 120000 }, async () => {
  const dir = gitDir('auto-pending-restart');
  const first = orchFor(dir, { humanInLoop: true, classify: shapeOf(QUICK, 0.02) });
  const asked = new Promise((res) => { first.on('question', (q) => { if (q.kind === 'workflow') res(q); }); });
  const running = first.run();                       // stays blocked on the open proposal
  await asked;
  const id = first.getState().id;
  const live = readPipelineForResume(id);
  assert.equal(live.row.status, 'running');
  assert.ok(live.resumePoint, 'the row carries a point WHILE the proposal is open (persisted before the question went out)');
  assert.equal(live.resumePoint.setupIncomplete, true, 'a pre-setup point: resume() replays the setup');
  assert.equal(live.resumePoint.manifest.auto.status, 'deciding');
  assert.equal(live.resumePoint.auto.pending.shape.name, 'Quick fix');
  // The boot reconcile of a restarted server: the owner pid is dead ⇒ interrupted, the point untouched.
  const flipped = reconcileStaleRunning({ liveIds: [], pidAlive: () => false, now: Date.now() + 24 * 3600 * 1000 });
  assert.ok(flipped.ids.includes(id), `reconciled: ${JSON.stringify(flipped)}`);
  const saved = readPipelineForResume(id);
  assert.equal(saved.row.status, 'interrupted');
  assert.ok(saved.resumePoint, 'still resumable');
  assert.equal(saved.resumePoint.auto.pending.shape.name, 'Quick fix');
  // Park the blocked process WITHOUT tearing its worktree down: stop() removes the checkout a resume
  // needs (run-harness.mjs finally, :1232), a real crash leaves it in place — pause() keeps it. The
  // in-memory `saved` (status interrupted) is what a fresh server would hand to resume().
  first.pause(); await running;
  const second = createOrchestrator({ projectDir: dir, claude: { mock: true }, resume: saved, classify: async () => { throw new Error('no re-classification after a restart'); } });
  const seen = answerer(second, () => ({ decision: 'accept', name: 'Quick fix', nodes: {} }));
  const r2 = await second.resume();
  assert.equal(r2.status, 'done', r2.error);
  assert.equal(seen[0].workflow.round, 1);
  assert.equal(second.getState().stepper.auto.rounds, 1);
});

test('finding 2: the revise answer is persisted BEFORE the next classifier call — a hard kill during that call resumes with the feedback, not into the original proposal', { timeout: 120000 }, async () => {
  const dir = gitDir('auto-revise-restart');
  let calls = 0;
  let round2Started;
  const round2Blocked = new Promise((res) => { round2Started = res; });
  let releaseRound2;
  const gate = new Promise((res) => { releaseRound2 = res; });
  const classify = async (input) => {
    calls += 1;
    if (calls === 1) return shapeOf(QUICK, 0.02)(input);
    round2Started();                                   // round 2 is "out at the model" — the 60–120 s window
    await gate;                                        // held until the test has read the row and paused the run
    throw new ClassifierError('CLASSIFIER_FAILED', 'process killed', [], { costUsd: 0 });
  };
  const first = orchFor(dir, { humanInLoop: true, classify });
  first.on('question', (q) => { if (q.kind === 'workflow') setImmediate(() => first.answer(q.id, { decision: 'revise', text: 'make it bigger' })); });
  const running = first.run();
  await round2Blocked;
  const id = first.getState().id;
  // What the row holds while round 2 is out: the state a restarted server would resume from.
  const live = readPipelineForResume(id);
  assert.equal(live.row.status, 'running');
  assert.ok(live.resumePoint, 'a point is on the row while the classifier is out');
  assert.equal(live.resumePoint.manifest.auto.status, 'deciding');
  assert.equal(live.resumePoint.setupIncomplete, true, 'a pre-setup point: resume() replays the setup');
  assert.deepEqual(live.resumePoint.auto.feedback, ['make it bigger'], 'the revise text rides the row BEFORE round 2 persists anything');
  assert.equal(live.resumePoint.auto.prior.name, 'Quick fix', 'the revised shape rides too');
  assert.equal(live.resumePoint.auto.pending, null, 'the answered proposal is NOT replayed');
  assert.equal(live.resumePoint.auto.round, 1, 'stamped before the round counter moved');
  assert.equal(live.resumePoint.auto.costUsd, 0.02, 'B5: the spend so far rides');
  // The boot reconcile of a restarted server: the owner pid is dead ⇒ interrupted, the point untouched.
  const flipped = reconcileStaleRunning({ liveIds: [], pidAlive: () => false, now: Date.now() + 24 * 3600 * 1000 });
  assert.ok(flipped.ids.includes(id), `reconciled: ${JSON.stringify(flipped)}`);
  const saved = readPipelineForResume(id);
  assert.equal(saved.row.status, 'interrupted');
  assert.deepEqual(saved.resumePoint.auto.feedback, ['make it bigger']);
  // Park the blocked process WITHOUT tearing its worktree down (as the B6 test does): pause(),
  // then let the stub return so run() unwinds.
  first.pause(); releaseRound2(); await running;
  const inputs = [];
  const second = createOrchestrator({ projectDir: dir, claude: { mock: true }, resume: saved, classify: async (i) => { inputs.push(i); return shapeOf(QUICK, 0.02)(i); } });
  const seen = answerer(second, () => ({ decision: 'accept', name: 'Quick fix', nodes: {} }));
  const r2 = await second.resume();
  assert.equal(r2.status, 'done', r2.error);
  assert.equal(inputs.length, 1, 'ONE fresh classification, carrying the feedback');
  assert.deepEqual(inputs[0].feedback, ['make it bigger']);
  assert.equal(inputs[0].priorShape.name, 'Quick fix');
  assert.equal(seen.filter((q) => q.kind === 'workflow').length, 1);
  assert.equal(seen[0].workflow.round, 2, 'round 2 — not a replay of round 1');
  assert.equal(second.getState().stepper.auto.rounds, 2);
  assert.deepEqual(listSubAgents(id).filter((s) => s.subagentType === 'auto-classify').map((s) => s.id), ['auto-classify-1', 'auto-classify-2']);
});
