import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { gitDir } from './helpers/git-dir.mjs';
import { createOrchestrator } from '../src/core/orchestrator.mjs';
import { normalizeShape, assembleShape } from '../src/shared/graph/assemble.mjs';
import { readWorkflow, listWorkflows, writeGraphWorkflow } from '../src/core/workflows.mjs';
import { listSubAgents, readPipelineForResume } from '../src/core/artifacts.mjs';
import { setHideBuiltinModels } from '../src/core/settings.mjs';
import { loadAgentRegistry } from '../src/core/agent-registry.mjs';
import { setNodeModel } from '../src/core/config.mjs';

useTempHome(after);
// settings/catalog lookups resolve under HOME (same sandbox as test/orchestrator-graph.test.mjs).
let sandboxHome;
const prevEnv = {};
before(async () => {
  sandboxHome = await mkdtemp(join(tmpdir(), 'worca-auto-home-'));
  for (const k of ['HOME', 'USERPROFILE', 'WORCA_TEST_ALLOW_HOME_FALLBACK']) prevEnv[k] = process.env[k];
  process.env.HOME = sandboxHome; process.env.USERPROFILE = sandboxHome; process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = '1';
});
after(async () => {
  for (const k of ['HOME', 'USERPROFILE', 'WORCA_TEST_ALLOW_HOME_FALLBACK']) { if (prevEnv[k] === undefined) delete process.env[k]; else process.env[k] = prevEnv[k]; }
  await rm(sandboxHome, { recursive: true, force: true });
});

const S = (agent, extra = {}) => ({ agent, ...extra });
const PLAN_PARTIAL = { name: 'Plan, refine, implement + review', taskKind: 'plan-partial', reasoning: 'a sketch', stages: [S('planner'), S('refiner', { selfLoop: true }), S('implementer'), S('reviewer')] };
const QUICK = { name: 'Quick fix', taskKind: 'prompt', stages: [S('planner'), S('implementer'), S('reviewer')] };
const DEFAULT_SHAPE = { name: 'Standard', taskKind: 'prompt', stages: [S('clarify'), S('planner'), S('refiner', { selfLoop: true }), S('implementer'), S('reviewer')] };
const ASKING_SHAPE = { name: 'Asking', taskKind: 'prompt', stages: [S('clarify'), S('planner', { askQuestions: true }), S('refiner', { selfLoop: true }), S('implementer', { askQuestions: true }), S('reviewer')] };

/** A scripted classifier: one shape per call, records its inputs. */
function scripted(shapes, { costUsd = 0.02 } = {}) {
  const calls = [];
  const classify = async (input) => {
    calls.push(input);
    const s = shapes[Math.min(calls.length, shapes.length) - 1];
    if (s instanceof Error) throw s;
    return { shape: normalizeShape(s), warnings: [], costUsd, usage: { input_tokens: 100, output_tokens: 20 }, attempts: 1, model: input.model || null };
  };
  return { classify, calls };
}
/** Answer every question: workflow questions through `onWorkflow`, clarify with no answers. */
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
const ids = async () => (await listWorkflows()).map((t) => t.id).sort();
const orchFor = (over = {}) => createOrchestrator({ projectDir: gitDir('auto'), workflowId: 'wf_auto', prompt: 'Build the thing, carefully.', claude: { mock: true }, ...over });

test('accept: the proposal carries the manifest, the dispatch order and editable nodes; a NEW shape is saved with origin auto and the run completes on it', { timeout: 120000 }, async () => {
  const { classify, calls } = scripted([PLAN_PARTIAL]);
  const orch = orchFor({ classify });
  const seen = answerer(orch, (q) => ({ decision: 'accept', name: 'My flow', nodes: { n_planner: { model: 'claude-opus-5-5', effort: 'max' } } }));
  const res = await orch.run();
  assert.equal(res.status, 'done', res.error);
  assert.equal(seen.filter((q) => q.kind === 'workflow').length, 1);
  const q = seen[0];
  assert.equal(q.id, 'auto-1');
  const p = q.workflow;
  assert.equal(p.round, 1);
  assert.equal(p.name, 'Plan, refine, implement + review');
  assert.equal(p.reasoning, 'a sketch');
  assert.equal(p.match, null);
  assert.deepEqual(p.manifest.template, { id: 'wf_auto', name: 'Plan, refine, implement + review' });
  assert.deepEqual(p.manifest.graph.nodes.filter((n) => n.kind === 'agent').map((n) => n.key), ['planner', 'refiner', 'implementer', 'reviewer']);
  assert.deepEqual(p.order, ['n_planner', 'n_refiner', 'n_implementer', 'n_reviewer'], 'the dispatch order rides the proposal');
  assert.deepEqual(Object.keys(p.nodes).sort(), ['n_implementer', 'n_planner', 'n_refiner', 'n_reviewer']);
  assert.ok(p.models.some((m) => m.id === 'claude-opus-5-5'));
  assert.equal(p.costUsd, 0.02);
  assert.match(p.fingerprint, /^top-level: /, 'the user can see what the classifier saw');
  assert.equal(p.ignoredProjectOverrides, false);
  // classifier inputs
  assert.equal(calls.length, 1);
  assert.equal(calls[0].humanInLoop, true);
  assert.equal(calls[0].domain, 'coding', 'only coding/shared/general agents are offered');
  assert.match(calls[0].fingerprint, /^top-level: /);
  assert.equal(calls[0].taskText, 'Build the thing, carefully.');
  assert.deepEqual(calls[0].feedback, []);
  assert.equal(typeof calls[0].model, 'string');
  assert.ok(calls[0].signal instanceof AbortSignal, 'the classifier gets the composed stop-or-pause signal');
  // D6 amendment: the classifier runs inside the run's own worktree with the read-only repo look on.
  assert.equal(calls[0].repoLook, true, 'the run path turns the repo look on');
  assert.equal(calls[0].cwd, orch.runCwd, 'cwd is the run worktree, not the scratch dir');
  assert.notEqual(calls[0].cwd, orch.pipeline.dir);
  assert.equal(orch.getState().branch.worktreeDir, calls[0].cwd, 'the recorded worktree IS the classifier cwd');
  // adoption
  const st = orch.getState();
  assert.deepEqual(st.stepper.auto, { status: 'decided', via: 'created', rounds: 1, humanInLoop: true, workflowId: 'wf_my-flow' });
  assert.deepEqual(st.stepper.template, { id: 'wf_my-flow', name: 'My flow' });
  const plan = st.stepper.graph.nodes.find((n) => n.id === 'n_planner');
  assert.equal(plan.model, 'claude-opus-5-5');
  assert.equal(plan.effort, 'max');
  const row = await readWorkflow('wf_my-flow');
  assert.equal(row.origin, 'auto');
  assert.equal(row.name, 'My flow');
  assert.equal(row.nodes.length, 6);
  assert.equal(st.endReached, true);
  const subs = listSubAgents(st.id);
  const cls = subs.find((s) => s.id === 'auto-classify-1');
  assert.ok(cls);
  assert.equal(cls.subagentType, 'auto-classify');
  assert.equal(cls.costUsd, 0.02);
  assert.equal(cls.tokens, 120, 'the classifier usage rides the row');
  assert.equal(cls.stepKey, 'x:preflight:1');
  assert.ok(st.subAgents.some((s) => s.id === 'auto-classify-1'), 'the live state list carries the row too (no reload needed)');
  assert.ok(st.steps.find((s) => s.key === 'x:preflight:1').costUsd >= 0.02, 'the classifier spend lands on the preflight row');
});

test('revise twice: feedback threads through, the final shape wins, one classifier row per round', { timeout: 120000 }, async () => {
  const { classify, calls } = scripted([PLAN_PARTIAL, QUICK, QUICK]);
  const orch = orchFor({ classify });
  let n = 0;
  const seen = answerer(orch, () => (n++ < 2 ? { decision: 'revise', text: `change ${n}` } : { decision: 'accept' }));
  const res = await orch.run();
  assert.equal(res.status, 'done', res.error);
  assert.equal(calls.length, 3);
  assert.deepEqual(calls[1].feedback, ['change 1']);
  assert.deepEqual(calls[2].feedback, ['change 1', 'change 2']);
  assert.equal(calls[1].priorShape.name, 'Plan, refine, implement + review');
  assert.deepEqual(seen.filter((q) => q.kind === 'workflow').map((q) => q.id), ['auto-1', 'auto-2', 'auto-3']);
  assert.equal(seen[2].workflow.round, 3);
  assert.equal(seen[2].workflow.costUsd, 0.06, 'the running spend is shown');
  const st = orch.getState();
  assert.equal(st.stepper.auto.rounds, 3);
  assert.deepEqual(st.stepper.graph.nodes.filter((x) => x.kind === 'agent').map((x) => x.key), ['planner', 'implementer', 'reviewer']);
  assert.deepEqual(listSubAgents(st.id).filter((s) => s.subagentType === 'auto-classify').map((s) => s.id), ['auto-classify-1', 'auto-classify-2', 'auto-classify-3']);
});

test('cancel: the run ends stopped and no workflow row is written', { timeout: 60000 }, async () => {
  const before = await ids();   // the temp home is shared by this FILE: earlier tests saved rows
  const orch = orchFor({ classify: scripted([PLAN_PARTIAL]).classify });
  answerer(orch, () => ({ decision: 'cancel' }));
  const res = await orch.run();
  assert.equal(res.status, 'stopped');
  assert.equal(orch.getState().status, 'stopped');
  assert.deepEqual(await ids(), before, 'cancel writes no row');
  assert.equal(readPipelineForResume(orch.getState().id).row.status, 'stopped');
});

test('reuse: an exact twin of the built-in Default is adopted without writing a row', { timeout: 120000 }, async () => {
  const before = await ids();
  const orch = orchFor({ classify: scripted([DEFAULT_SHAPE]).classify });
  const seen = answerer(orch, () => ({ decision: 'accept' }));
  const res = await orch.run();
  assert.equal(res.status, 'done', res.error);
  const q = seen.find((x) => x.kind === 'workflow');
  assert.deepEqual(q.workflow.match, { id: 'wf_default', name: 'Default' });
  assert.equal(q.workflow.manifest.template.id, 'wf_default');
  assert.ok(q.workflow.nodes.n_plan, 'nodes are keyed by the ROW\'s ids');
  assert.deepEqual(q.workflow.order, ['n_clarify', 'n_plan', 'n_refine', 'n_impl', 'n_review']);
  assert.equal(q.workflow.nodes.n_clarify.askQuestions, true, 'the clarifier is locked on');
  assert.equal(q.workflow.ignoredProjectOverrides, false, 'a fresh project has no per-project tuning to ignore');
  const st = orch.getState();
  assert.deepEqual(st.stepper.auto, { status: 'decided', via: 'reused', rounds: 1, humanInLoop: true, workflowId: 'wf_default' });
  assert.deepEqual(await ids(), before, 'reuse writes no row');
  assert.ok(seen.some((x) => x.kind === 'clarify'), 'the clarifier ran (human in the loop)');
});

test('human out of the loop: no proposal, no clarifier, every askQuestions forced off', { timeout: 120000 }, async () => {
  const { classify, calls } = scripted([ASKING_SHAPE]);
  const orch = orchFor({ classify, humanInLoop: false });
  const seen = answerer(orch, () => { throw new Error('must not be asked'); });
  const res = await orch.run();
  assert.equal(res.status, 'done', res.error);
  assert.equal(seen.length, 0);
  assert.equal(calls[0].humanInLoop, false);
  const st = orch.getState();
  const agents = st.stepper.graph.nodes.filter((n) => n.kind === 'agent');
  assert.deepEqual(agents.map((n) => n.key), ['planner', 'refiner', 'implementer', 'reviewer']);
  assert.ok(agents.every((n) => n.askQuestions === false), 'the shape asked for questions on two agents; the switch wins (non-vacuous: normalizeShape keeps the tunables, Task 4)');
  assert.equal(st.stepper.auto.humanInLoop, false);
  assert.notEqual(st.stepper.auto.workflowId, 'wf_default', 'without the clarifier it is not the Default any more');
  assert.ok(['created', 'reused'].includes(st.stepper.auto.via), 'reused when an earlier test in this file saved the same topology');
});

test('a malformed answer is IGNORED and the proposal stays open (no re-ask); the next well-formed answer is taken', { timeout: 120000 }, async () => {
  const orch = orchFor({ classify: scripted([QUICK]).classify });
  const results = [];
  const seen = [];
  orch.on('question', (q) => {
    seen.push(q);
    setImmediate(() => {
      if (q.kind === 'workflow') { results.push(orch.answer(q.id, { decision: 'maybe' })); results.push(orch.answer(q.id, { decision: 'accept' })); }
      else if (q.kind === 'clarify' || q.kind === 'questions') orch.answer(q.id, { answers: [] });
      else orch.answer(q.id, { decision: 'continue' });
    });
  });
  const res = await orch.run();
  assert.equal(res.status, 'done', res.error);
  assert.deepEqual(seen.filter((q) => q.kind === 'workflow').map((q) => q.id), ['auto-1'], 'ONE question — spec §5.4 keeps it pending, never re-asks under a new id');
  assert.deepEqual(results, [false, true], 'answer() reports the ignored payload, then the accepted one');
});

test('--yes: the proposal is accepted internally and the run completes', { timeout: 120000 }, async () => {
  const orch = orchFor({ classify: scripted([QUICK]).classify, auto: true });
  const seen = answerer(orch, () => { throw new Error('must not be asked'); });
  const res = await orch.run();
  assert.equal(res.status, 'done', res.error);
  assert.equal(seen.length, 0);
  assert.equal(orch.getState().stepper.auto.humanInLoop, false);
});

test('a Pause during the classifier call aborts it through the composed signal and parks the run undecided; nothing is written', { timeout: 120000 }, async () => {
  const before = await ids();
  let orch;
  let seenSignal = null;
  const classify = async (input) => {
    seenSignal = input.signal;
    orch.pause();                                   // the user pauses while the classifier is out
    // pause() aborts pauseAbort SYNCHRONOUSLY and AbortSignal.any propagates at once, so
    // the composed signal is ALREADY aborted here — an 'abort' listener added now would
    // never fire (a 120 s hang). Check .aborted first, like test/auto-classify's fakeRun.
    await new Promise((_r, rej) => {
      const fire = () => { const e = new Error('aborted'); e.name = 'AbortError'; rej(e); };
      if (input.signal.aborted) fire();
      else input.signal.addEventListener('abort', fire, { once: true });
    });
  };
  orch = orchFor({ classify, humanInLoop: false });
  const res = await orch.run();
  assert.equal(res.status, 'paused', res.error);
  assert.equal(seenSignal.aborted, true, 'the classifier saw the pause through its signal');
  const saved = readPipelineForResume(orch.getState().id);
  assert.equal(saved.row.status, 'paused');
  assert.equal(saved.resumePoint.manifest.auto.status, 'deciding', 'still undecided: resume re-enters the decision');
  assert.equal(saved.resumePoint.auto.round, 1);
  assert.deepEqual(await ids(), before, 'no row was written');
});

test('hidden built-in models are not offered in the proposal but an accepted hidden id still applies', { timeout: 120000 }, async () => {
  await setHideBuiltinModels(true);
  try {
    const orch = orchFor({ classify: scripted([QUICK]).classify });
    const seen = answerer(orch, () => ({ decision: 'accept', nodes: { n_planner: { model: 'claude-opus-5-5', effort: 'max' } } }));
    const res = await orch.run();
    assert.equal(res.status, 'done', res.error);
    const p = seen.find((q) => q.kind === 'workflow').workflow;
    assert.ok(!p.models.some((m) => /^claude-/.test(m.id)), 'the picker list skips hidden built-ins like every other picker');
    assert.equal(orch.getState().stepper.graph.nodes.find((n) => n.id === 'n_planner').model, 'claude-opus-5-5', 'validators still accept a hidden id');
  } finally {
    await setHideBuiltinModels(false);
  }
});

test('under mock with no injected classifier the recipes answer and a saved workflow run is untouched', { timeout: 120000 }, async () => {
  const auto = orchFor({ auto: true });
  const res = await auto.run();
  assert.equal(res.status, 'done', res.error);
  assert.equal(auto.getState().stepper.auto.status, 'decided');
  const saved = createOrchestrator({ projectDir: gitDir('saved'), workflowId: 'wf_default', prompt: 'demo', claude: { mock: true }, auto: true });
  const r2 = await saved.run();
  assert.equal(r2.status, 'done', r2.error);
  assert.equal(saved.getState().stepper.auto, undefined);
});

test('B3: a twin saved while the proposal is open is reused at Accept instead of writing a duplicate row', { timeout: 120000 }, async () => {
  const SMALL = { name: 'Small change', taskKind: 'prompt', stages: [S('implementer'), S('reviewer')] };   // no earlier test in this file adopts this topology
  const before = await ids();
  const { classify } = scripted([SMALL]);
  const orch = orchFor({ classify });
  const REG = loadAgentRegistry(undefined, { userAgentsDir: null, includePlugins: false });
  let matchAtProposal = 'unset';
  orch.on('question', (q) => {
    if (q.kind !== 'workflow') { setImmediate(() => orch.answer(q.id, q.kind === 'clarify' || q.kind === 'questions' ? { answers: [] } : { decision: 'continue' })); return; }
    matchAtProposal = q.workflow.match;
    // someone (another run, the composer, the chat) saves the same topology while the question is open
    const built = assembleShape(SMALL, { registry: REG });
    writeGraphWorkflow({ ...built.template, id: 'wf_meanwhile', name: 'Meanwhile', domain: 'coding' })
      .then(() => orch.answer(q.id, { decision: 'accept', name: 'Small change', nodes: { n_implementer: { model: 'claude-opus-5-5', effort: 'high' } } }));
  });
  const res = await orch.run();
  assert.equal(res.status, 'done', res.error);
  assert.equal(matchAtProposal, null, 'nothing matched at proposal time');
  const st = orch.getState();
  assert.deepEqual(st.stepper.auto, { status: 'decided', via: 'reused', rounds: 1, humanInLoop: true, workflowId: 'wf_meanwhile' });
  assert.deepEqual(await ids(), [...before, 'wf_meanwhile'].sort(), 'no duplicate row');
  const impl = st.stepper.graph.nodes.find((n) => n.key === 'implementer');
  assert.deepEqual([impl.model, impl.effort], ['claude-opus-5-5', 'high'], 'the table edit was remapped onto the twin\'s node ids');
});

test('finding 5: with human-in-the-loop OFF, a reused twin whose per-project overrides are ignored still says so in the run log', { timeout: 120000 }, async () => {
  const dir = gitDir('auto-overrides-log');
  const REG = loadAgentRegistry(undefined, { userAgentsDir: null, includePlugins: false });
  const TUNED = { name: 'Tuned twin', taskKind: 'prompt', stages: [S('planner'), S('reviewer')] };   // no other test in this file adopts this topology
  const built = assembleShape(TUNED, { registry: REG, humanInLoop: false });
  await writeGraphWorkflow({ ...built.template, id: 'wf_tuned', name: 'Tuned', domain: 'coding' });
  const plannerId = built.template.nodes.find((n) => n.key === 'planner').id;
  await setNodeModel(dir, 'wf_tuned', plannerId, { model: 'claude-opus-5-5', effort: 'high' });   // the project's own tuning of that row
  const logs = [];
  const orch = createOrchestrator({ projectDir: dir, workflowId: 'wf_auto', prompt: 'Build the thing, carefully.', claude: { mock: true }, humanInLoop: false, classify: scripted([TUNED]).classify });
  orch.on('log', (e) => logs.push(e));
  const res = await orch.run();
  assert.equal(res.status, 'done', res.error);
  assert.deepEqual(orch.getState().stepper.auto, { status: 'decided', via: 'reused', rounds: 1, humanInLoop: false, workflowId: 'wf_tuned' }, 'the tuned row was the twin');
  const line = logs.find((e) => /auto: this project's saved per-node\/wire settings for "Tuned" \(wf_tuned\) are not applied/.test(e.text));
  assert.ok(line, `expected the ignored-overrides log line; got:\n${logs.map((e) => e.text).join('\n')}`);
  assert.equal(line.level, 'warn');
  assert.equal(line.source, 'orchestrator');
});
