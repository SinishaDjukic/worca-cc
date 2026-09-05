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
import { readPipelineForResume, listSubAgents } from '../src/core/artifacts.mjs';
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
  assert.deepEqual(rp.auto, { humanInLoop: false, feedback: [], round: 1, prior: null });
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
