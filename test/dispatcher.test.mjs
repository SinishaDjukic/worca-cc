// test/dispatcher.test.mjs
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createOrchestrator, createOrchestrator as makeOrch } from '../src/core/orchestrator.mjs';
import { LEGACY_DEFAULT_WORKFLOW, writeWorkflow } from '../src/core/workflows.mjs';
import { artifactPaths } from '../src/core/artifacts.mjs';
import { useTempHome } from './helpers/temp-home.mjs';

useTempHome(after); // file-wide store isolation for tests that don't sandbox themselves

const tmpDirs = [];
async function makeTmpDir() {
  const dir = await mkdtemp(join(tmpdir(), 'worca-cc-dispatch-'));
  tmpDirs.push(dir);
  return dir;
}
after(async () => {
  await Promise.all(tmpDirs.map((d) => rm(d, { recursive: true, force: true })));
});

test('_nodeCtx tags every emit with nodeId/stepIndex/cycle', () => {
  const orch = createOrchestrator({ projectDir: '/tmp/proj' });
  orch.pipeline = { id: 'x', dir: '/tmp/proj', promptText: 'demo' };
  const node = { nodeId: 's2_1', key: 'implementer', runnerType: 'producer' };
  const tagged = [];
  orch.on('log', (l) => tagged.push(l));
  const ctx = orch._nodeCtx(node, { stepIndex: 2, cycle: 3 });
  ctx.onEvent({ type: 'assistant', text: 'hi', raw: {} });
  assert.equal(tagged.length, 1);
  assert.equal(tagged[0].nodeId, 's2_1');
  assert.equal(tagged[0].stepIndex, 2);
  assert.equal(tagged[0].cycle, 3);
});

test('cost is attributed to the node step key, not the live phase', () => {
  const orch = createOrchestrator({ projectDir: '/tmp/proj' });
  orch.pipeline = { id: 'x', dir: '/tmp/proj', promptText: 'demo' };
  // Open TWO node steps (simulating an in-flight parallel group).
  const nodeA = { nodeId: 'p_a', key: 'implementer', runnerType: 'producer' };
  const nodeB = { nodeId: 'p_b', key: 'reviewer', runnerType: 'verifier' };
  orch._nodeStep(nodeA, 0, 1, 'start');
  orch._nodeStep(nodeB, 0, 1, 'start');
  const ctxA = orch._nodeCtx(nodeA, { stepIndex: 0, cycle: 1 });
  const ctxB = orch._nodeCtx(nodeB, { stepIndex: 0, cycle: 1 });
  // Interleaved result events — must land on their OWN node, not whoever is "live".
  ctxB.onEvent({ type: 'result', costUsd: 0.05, raw: { type: 'result' } });
  ctxA.onEvent({ type: 'result', costUsd: 0.02, raw: { type: 'result' } });
  const st = orch.getState();
  const keyA = orch._stepKeyFor(nodeA, 0, 1);
  const keyB = orch._stepKeyFor(nodeB, 0, 1);
  assert.equal(st.steps.find((s) => s.key === keyA).costUsd, 0.02);
  assert.equal(st.steps.find((s) => s.key === keyB).costUsd, 0.05);
  assert.equal(st.totalCostUsd, 0.07);
});

// ── dispatcher: parallel walk + generic feedback loop ──────────────────────────

// Build a minimally-initialized orchestrator ready to dispatch: pipeline dir +
// prompts stubbed, git/preflight skipped. We call _dispatch directly.
async function primed(projectDir) {
  const orch = makeOrch({ projectDir, prompt: 'demo', auto: true, claude: { mock: true } });
  orch.pipeline = { id: 'p1', dir: projectDir, promptText: 'demo' };
  orch.state.id = 'p1';
  orch.state.pipelineDir = projectDir;
  orch.baseName = 'feature';
  orch.agentPrompts = {};
  orch.toolInstruction = '';
  orch.checkpointRef = null;
  orch._setStatus('running');
  return orch;
}

test('parallel step: both nodes run, both emit (tagged), both complete', async () => {
  const dir = await makeTmpDir();
  const orch = await primed(dir);
  const ran = [];
  const emits = [];
  orch.on('log', (l) => { if (l.nodeId) emits.push(l.nodeId); });
  // Stub the registry the dispatcher consults.
  orch._runners = {
    producer: async (ctx) => {
      ran.push(ctx.node.nodeId);
      ctx.onEvent({ type: 'assistant', text: `did ${ctx.node.nodeId}`, raw: {} });
      return { status: 'ok', summary: ctx.node.nodeId };
    },
    verifier: async () => ({ status: 'ok', issues: [], review: { issues: [], summary: '' } }),
  };
  const plan = {
    id: 'wf_x', name: 'X',
    steps: [[
      { nodeId: 'a', key: 'implementer', runnerType: 'producer' },
      { nodeId: 'b', key: 'implementer', runnerType: 'producer' },
    ]],
    feedbacks: [],
  };
  await orch._dispatch(plan);
  assert.deepEqual(ran.sort(), ['a', 'b'], 'both parallel nodes ran');
  assert.deepEqual([...new Set(emits)].sort(), ['a', 'b'], 'both emitted node-tagged events');
  const st = orch.getState();
  assert.ok(st.steps.find((s) => s.nodeId === 'a' && s.status === 'done'));
  assert.ok(st.steps.find((s) => s.nodeId === 'b' && s.status === 'done'));
});

test('feedback loop fires on blocked verifier, then stops at maxCycles and gates', async () => {
  const dir = await makeTmpDir();
  const orch = await primed(dir);
  // Verifier ALWAYS blocks -> the loop can only stop at maxCycles.
  let implRuns = 0;
  let gateAsks = 0;
  orch._runners = {
    producer: async (ctx) => { if (ctx.node.key === 'implementer') implRuns += 1; return { status: 'ok', summary: 'impl' }; },
    verifier: async () => ({ status: 'blocked', issues: [{ severity: 'major', title: 't', detail: 'd', location: 'l' }], review: { issues: [{ severity: 'major' }], summary: 's' } }),
  };
  orch.on('question', ({ kind }) => { if (kind === 'gate') gateAsks += 1; });
  const plan = {
    id: 'wf_loop', name: 'Loop',
    steps: [
      [{ nodeId: 'impl', key: 'implementer', runnerType: 'producer' }],
      [{ nodeId: 'rev', key: 'reviewer', runnerType: 'verifier', loopSource: true }],
    ],
    feedbacks: [{ id: 'fb0', from: 'rev', to: 0, maxCycles: 3, gate: 'hasBlocking' }],
  };
  await orch._dispatch(plan);
  // cycle starts at 1; loop re-runs to step 0 while cycle<maxCycles=3 -> impl runs at
  // cycles 1,2,3 = 3 times; the 3rd review is still blocked so it gates once (auto->continue).
  assert.equal(implRuns, 3, 'implementer re-ran up to maxCycles');
  assert.equal(gateAsks, 1, 'gated the user exactly once at maxCycles');
});

test('feedback loop does NOT fire when verifier passes', async () => {
  const dir = await makeTmpDir();
  const orch = await primed(dir);
  let implRuns = 0;
  orch._runners = {
    producer: async (ctx) => { if (ctx.node.key === 'implementer') implRuns += 1; return { status: 'ok', summary: 'impl' }; },
    verifier: async () => ({ status: 'ok', issues: [], review: { issues: [], summary: '' } }),
  };
  const plan = {
    id: 'wf_ok', name: 'OK',
    steps: [
      [{ nodeId: 'impl', key: 'implementer', runnerType: 'producer' }],
      [{ nodeId: 'rev', key: 'reviewer', runnerType: 'verifier', loopSource: true }],
    ],
    feedbacks: [{ id: 'fb0', from: 'rev', to: 0, maxCycles: 3, gate: 'hasBlocking' }],
  };
  await orch._dispatch(plan);
  assert.equal(implRuns, 1, 'no loop -> implementer runs once');
});

test('LEGACY_DEFAULT_WORKFLOW dispatch reproduces the legacy phase order + loop gating (mock)', async () => {
  const dir = await makeTmpDir();
  const orch = makeOrch({
    projectDir: dir,
    prompt: 'demo task',
    auto: true,
    claude: { mock: true },
    // default workflowId -> wf_default
  });

  // Capture the node-tagged step order (dedupe consecutive duplicates from start/done).
  const order = [];
  orch.on('log', (l) => { /* keep logs flowing; no-op */ });
  orch.on('state', () => {});
  const phases = [];
  orch.on('phase', ({ phase, cycle, status }) => {
    if (status === 'start') phases.push(cycle ? `${phase}#${cycle}` : phase);
  });
  const nodeStarts = [];
  // agent-dispatch steps are recorded in state.steps with nodeId; snapshot their first-seen
  // order. Exclude the clarify step (phase 'clarify'), which now also carries a nodeId for
  // UI attribution but is not an agent dispatch node.
  const seen = new Set();
  orch.on('state', (st) => {
    for (const s of st.steps) {
      if (s.nodeId && s.phase !== 'clarify' && !seen.has(s.key)) { seen.add(s.key); nodeStarts.push(s.phase); }
    }
  });
  let gateAsks = 0;
  orch.on('question', ({ kind }) => { if (kind === 'gate') gateAsks += 1; });

  // CONV-5: capture the implementer's mode on each invocation (proves the review
  // loop rewinds in `fix` mode against the review md, not a from-scratch implement).
  const implementerModes = [];
  const realProducer = orch._runners.producer;
  orch._runners.producer = async (ctx) => {
    if (ctx?.node?.key === 'implementer') implementerModes.push(ctx.mode);
    return realProducer(ctx);
  };

  const res = await orch.run();
  assert.equal(res.status, 'done', 'mock default pipeline finishes');

  // Node-type order must be planner -> refiner -> implementer -> reviewer. NOTE:
  // nodeStarts has one entry PER cycle (it dedupes on the per-cycle step key), and
  // the refine self-loop legitimately re-runs the refiner BEFORE the implementer
  // (plan->refine#1->refine#2->implement#1->...), so a raw slice(0,4) would be
  // [planner, refiner, refiner, implementer]. Assert the order of the DISTINCT node
  // types instead (a stricter check than the first four raw entries: it pins the
  // topological order of all four roles across the whole run, loop re-runs and all).
  const distinctOrder = [...new Set(nodeStarts)];
  assert.deepEqual(
    distinctOrder,
    ['planner', 'refiner', 'implementer', 'reviewer'],
    `default node order must be plan->refine->implement->review, saw ${nodeStarts.join(',')}`,
  );
  // Mock convergence: refiner cycle1 major -> cycle2 minor (refine self-loop fires
  // ONCE); reviewer cycle1 major -> implementer fix -> reviewer cycle2 suggestion.
  const refinerRuns = nodeStarts.filter((p) => p === 'refiner').length;
  const reviewerRuns = nodeStarts.filter((p) => p === 'reviewer').length;
  const implementerRuns = nodeStarts.filter((p) => p === 'implementer').length;
  // CONV-3: the refine self-loop MUST fire — this is exactly what v1's dead-loop
  // dispatcher silently skipped (refinerRuns would have been 1). This assertion is
  // the regression guard the v1 parity test lacked.
  assert.equal(refinerRuns, 2, 'refine self-loop fires once: refiner at cycle 1 (blocking) then cycle 2 (converged)');
  assert.equal(reviewerRuns, 2, 'review loop runs the reviewer exactly twice (mock converges at cycle 2)');
  assert.equal(implementerRuns, 2, 'implement + one fix pass');
  assert.equal(gateAsks, 0, 'no gate fires under default maxCycles with the converging mock');
  // CONV-5: the SECOND implementer pass must be `fix` (review md threaded back).
  assert.deepEqual(implementerModes, ['implement', 'fix'], 'first an implement pass, then a fix pass against the review md');
  // CONV-4: the live UI stepper must advance — 'phase' events cover all four UI
  // stages in order (frozen-stepper guard; v1 stuck scalar phase on "clarify").
  const ui = phases.map((p) => p.split('#')[0]);
  for (const stage of ['plan', 'refine', 'implement', 'review']) {
    assert.ok(ui.includes(stage), `live 'phase' events must include "${stage}" (saw ${ui.join(',')})`);
  }
  const order4 = ['plan', 'refine', 'implement', 'review'];
  const idxs = order4.map((p) => ui.indexOf(p));
  assert.deepEqual(idxs, [...idxs].sort((a, b) => a - b), 'UI phases first appear in plan->refine->implement->review order');
});

test('LEGACY_DEFAULT_WORKFLOW is the wf_default 5-step Plan->Refine->Implement->Review topology', () => {
  assert.equal(LEGACY_DEFAULT_WORKFLOW.id, 'wf_default');
  const keys = LEGACY_DEFAULT_WORKFLOW.steps.map((g) => g.map((n) => n.key));
  assert.deepEqual(keys, [['clarify'], ['planner'], ['refiner'], ['implementer'], ['reviewer']]);
  // CONV-3/CONV-7: the two feedbacks are the refiner self-loop + the review->implement loop.
  assert.deepEqual(
    LEGACY_DEFAULT_WORKFLOW.feedbacks.map((f) => ({ id: f.id, from: f.from, to: f.to })),
    [{ id: 'fb_refine', from: 's1_0', to: 's1_0' }, { id: 'fb_review', from: 's3_0', to: 's2_0' }],
  );
});

// §10 integration — the REAL registry -> resolveWorkflow -> dispatcher -> real runners
// path on a NON-default saved workflow, exercising a concurrent producer group
// (CONV-6 IO isolation + ordered merge) AND a feedback loop (CONV-3 gate). v1 tested
// parallel only with a stubbed runner registry + injected plan, so this end-to-end
// path — the spec's headline guarantee — was never run.
test('custom workflow: a PARALLEL producer step + a review->implement loop dispatches end-to-end (mock)', async () => {
  const home = await makeTmpDir();
  const prevHome = process.env.WORCA_HOME;
  process.env.WORCA_HOME = home;            // sandbox the global ~/.worca-cc store
  try {
    const tpl = await writeWorkflow({         // CONV-1: writeWorkflow is async — await it
      name: 'Parallel QA',
      steps: [
        [{ id: 's0_0', key: 'planner' }],
        [{ id: 's1_0', key: 'implementer' }, { id: 's1_1', key: 'manualTestsChecklist' }], // PARALLEL group
        [{ id: 's2_0', key: 'reviewer' }],
      ],
      feedbacks: [{ id: 'fb_qa', from: 's2_0', to: 's1_0' }],   // review -> the parallel impl step
    });

    const dir = await makeTmpDir();
    const orch = makeOrch({ projectDir: dir, prompt: 'demo', auto: true, claude: { mock: true }, workflowId: tpl.id });

    const runsByNode = {};                     // nodeId -> distinct step-key count (== run count)
    const seenKeys = new Set();
    orch.on('state', (st) => {
      for (const s of st.steps) {
        if (s.nodeId && !seenKeys.has(s.key)) { seenKeys.add(s.key); runsByNode[s.nodeId] = (runsByNode[s.nodeId] || 0) + 1; }
      }
    });
    const logNodeIds = new Set();
    orch.on('log', (l) => { if (l.nodeId) logNodeIds.add(l.nodeId); });

    const res = await orch.run();
    assert.equal(res.status, 'done', 'custom workflow finishes under mock');

    // Parallel step: BOTH members ran (CONV-6 — no lost node; events id-tagged, no cross-attribution).
    assert.ok(logNodeIds.has('s1_0') && logNodeIds.has('s1_1'), 'both parallel nodes emit id-tagged events');
    // Feedback loop fired once then converged: reviewer (s2_0) ran twice; the rewind
    // re-ran the whole parallel step, so s1_0/s1_1 also ran twice.
    assert.equal(runsByNode.s2_0, 2, 'review->implement loop fired once then converged (reviewer ran twice)');
    assert.equal(runsByNode.s1_0, 2, 'the parallel implementer re-ran on the loop rewind');
    assert.equal(runsByNode.s1_1, 2, 'the parallel checklist re-ran on the loop rewind');
  } finally {
    if (prevHome === undefined) delete process.env.WORCA_HOME; else process.env.WORCA_HOME = prevHome;
  }
});

test('run(): stamps state.stepper (preflight..done) and node phase events carry nodeId', async () => {
  const dir = await makeTmpDir();
  const orch = makeOrch({ projectDir: dir, prompt: 'demo task', auto: true, claude: { mock: true } });
  const phaseEvents = [];
  orch.on('phase', (e) => phaseEvents.push(e));

  const res = await orch.run();
  assert.equal(res.status, 'done', 'mock default pipeline finishes');

  const st = orch.getState();
  assert.ok(st.stepper, 'state.stepper present');
  assert.equal(st.stepper.version, 1);
  assert.equal(st.stepper.steps[0].kind, 'preflight');
  assert.equal(st.stepper.steps.at(-1).kind, 'done');
  assert.equal(st.stepper.steps.length, 7, 'wf_default: preflight + 5 agent cells + done');

  // Agent-node phase events (from _nodeStep) carry a nodeId; bookend phases
  // (_phase: preflight/clarify/done) carry none.
  const nodeEvents = phaseEvents.filter((e) => e.nodeId);
  assert.ok(nodeEvents.length >= 1, 'at least one node phase event carried a nodeId');
  assert.ok(nodeEvents.every((e) => typeof e.nodeId === 'string'));
  assert.ok(
    phaseEvents.some((e) => e.phase === 'preflight' && e.nodeId == null),
    'the preflight bookend phase has no nodeId',
  );
});

test('custom workflow: a plan-review -> planner loop replans then converges end-to-end (mock)', async () => {
  const home = await makeTmpDir();
  const prevHome = process.env.WORCA_HOME;
  process.env.WORCA_HOME = home;
  try {
    const tpl = await writeWorkflow({
      name: 'Plan Review Loop',
      steps: [
        [{ id: 's0_0', key: 'planner' }],
        [{ id: 's1_0', key: 'planReviewer' }],
        [{ id: 's2_0', key: 'implementer' }],
        [{ id: 's3_0', key: 'reviewer' }],
      ],
      feedbacks: [{ id: 'fb_planreview', from: 's1_0', to: 's0_0' }], // plan-review -> planner
    });

    const dir = await makeTmpDir();
    const orch = makeOrch({ projectDir: dir, prompt: 'demo', auto: true, claude: { mock: true }, workflowId: tpl.id });

    const runsByNode = {};
    const seenKeys = new Set();
    orch.on('state', (st) => {
      for (const s of st.steps) {
        if (s.nodeId && !seenKeys.has(s.key)) { seenKeys.add(s.key); runsByNode[s.nodeId] = (runsByNode[s.nodeId] || 0) + 1; }
      }
    });

    // Capture the implementer's dispatched mode on each invocation (same idiom as the
    // default-workflow test ~L184 and saved-pipeline-parity's `modes`). This is the
    // load-bearing Task 4 check: a run-count of 1 alone does NOT prove the guard held
    // — fix-mode changes the implementer's MODE, not its run count. Instance-local
    // copy first so wrapping the producer does not mutate the shared defaultRunners
    // singleton (orch._runners === defaultRunners) and leak a wrapper to later tests.
    const implementerModes = [];
    orch._runners = { ...orch._runners };
    const realProducer = orch._runners.producer;
    orch._runners.producer = async (ctx) => {
      if (ctx?.node?.key === 'implementer') implementerModes.push(ctx.mode);
      return realProducer(ctx);
    };

    const res = await orch.run();
    assert.equal(res.status, 'done', 'plan-review workflow finishes under mock');

    // Task 3 payoff: the cycle-2 replan minted a fresh -v2 plan (no clobber of v1).
    // Plans live under the project-keyed store root's plans/ dir (a SIBLING of
    // res.pipelineDir, which is the per-run pipelines/<id> subdir), so locate the
    // plans dir from the projectDir via artifactPaths — the same resolver the
    // channels/artifacts layer uses to allocate plan paths.
    const plansDir = artifactPaths(dir).plans;
    const planFiles = await readdir(plansDir);
    assert.ok(planFiles.some((f) => /-v2\.md$/.test(f)), `expected a -v2 plan in ${plansDir}, saw ${planFiles.join(', ')}`);

    // plan-review blocks at cycle 1 -> rewind to planner -> planner replans -> plan-review ok at cycle 2.
    //
    // NOTE on the planner count (=2): clarify is now its OWN graph node (s_clarify),
    // so the one-shot clarify phase is no longer folded onto the planner node. The
    // `seenKeys`-by-`s.key` idiom counts every DISTINCT step key attributed to s0_0,
    // which here are exactly the planner's two passes:
    //   0:s0_0 (plan, cycle 1) + 0:s0_0#2 (the cycle-2 REPLAN, which mints the -v2
    //   plan asserted above). The +1 over a non-replanning planner is the replan.
    assert.equal(runsByNode.s0_0, 2, 'planner replanned on the plan-review bounce (plan-v1 + plan-v2)');
    assert.equal(runsByNode.s1_0, 2, 'plan reviewer ran twice (blocked then ok)');
    assert.equal(runsByNode.s2_0, 1, 'implementer ran once (first pass, not flipped into fix mode by the plan-review)');

    // Task 4 provenance guard, end-to-end: the plan-review (which DID pass at cycle 2)
    // folds onto the SHARED `review` bus the implementer consumes, carrying a review
    // md. A naive "review md present -> fix" would flip this first-pass implementer
    // into fix mode. The guard (channels.mjs legacyFields: reviewKind !== 'plan-review')
    // keeps it in `implement`. Asserting the MODE (not just the count) is what actually
    // pins this — reverting the guard leaves the count at 1 but makes this mode 'fix'.
    assert.deepEqual(implementerModes, ['implement'], 'plan-review did NOT flip the first-pass implementer into fix mode (Task 4 provenance guard)');
  } finally {
    if (prevHome === undefined) delete process.env.WORCA_HOME; else process.env.WORCA_HOME = prevHome;
  }
});
