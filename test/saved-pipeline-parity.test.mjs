// test/saved-pipeline-parity.test.mjs
// v1 PARITY GUARD for the v2 graph engine: runs SAVED SEED TEMPLATES under mock
// and asserts their AGENT execution sequences are byte-identical to the v1-parity
// scripts (the 2026-08-10 dual-engine adjudication's S3-style scripts).
//
// The pins, stated once and reused by every case:
//   * only AGENT executions are compared. Flow rows are $0 engine executions the
//     v1 engine had no counterpart for — the `task` head, the `end` tail and, in
//     the OR-fanned seeds, one `or` per loop emission — and are EXCLUDED from the
//     sequence comparison (asserted separately, below).
//   * the trailing `end` execution lands after the final reviewer `pass`; End is
//     trace-neutral (spec Amendment f, "End is trace-neutral on all 8 builtin
//     graphs"), so it adds bookkeeping and nothing else.
//   * a COMPOSITE SHELL is excluded on the same grounds. A decomposed stage runs
//     one `kind:'task'` sub-execution per task; those ARE its agent runs (v1
//     spawned exactly them, and had no node-level row for the stage at all),
//     while the `kind:'cycle'` row bracketing them spawns nothing and only owns
//     the bind, the phase order and the single publish.
//
// SCOPE: all four coding seeds that terminate under mock — the two non-expands
// ones, and the two decomposer-gated double-loop ones whose fan-out the composite
// executor now runs.
//
// RED WINDOW: this suite drives the REAL orchestrator, so it is written against
// the graph engine and stays red until the orchestrator swap replaces the v1
// dispatcher. That is deliberate and documented in the PR3 plan; do NOT paper
// over it with v1 aliases.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createOrchestrator as makeOrch } from '../src/core/orchestrator.mjs';
import { writeWorkflow } from '../src/core/workflows.mjs';
import { SEED_TEMPLATES } from '../src/core/graph/seed-templates.mjs';
import { planPath } from '../src/core/artifacts.mjs';
import { _resetForTests } from '../src/core/db.mjs';

const SEEDS = Object.fromEntries(SEED_TEMPLATES.map((t) => [t.id, t]));

/**
 * The v1-parity AGENT sequences. Under mock every verifier is BLOCKING at cycle 1
 * and clean from cycle 2 (claude-runner's mock writers), so each loop fires
 * exactly once:
 *   wf_quick-fix         plan -> implement -> review(blocking) -> fix -> review(clean)
 *   wf_clarify-implement clarify -> plan -> refine(blocking) -> refine(clean)
 *                        -> implement -> review(blocking) -> fix -> review(clean)
 */
const PARITY = {
  'wf_quick-fix': ['planner', 'implementer', 'reviewer', 'implementer', 'reviewer'],
  'wf_clarify-implement': [
    'clarify', 'planner', 'refiner', 'refiner', 'implementer', 'reviewer', 'implementer', 'reviewer',
  ],
};

/** Save the seed template into a throwaway store and run it under mock. */
async function runSeedUnderMock(workflowId) {
  const home = await mkdtemp(join(tmpdir(), 'worca-cc-parity-home-'));
  const prevHome = process.env.WORCA_HOME;
  process.env.WORCA_HOME = home;                 // sandbox the global store
  _resetForTests();                              // fresh DB singleton at this home
  try {
    const template = structuredClone(SEEDS[workflowId]);
    assert.ok(template, `seed template ${workflowId} exists`);
    await writeWorkflow(template);

    const projectDir = await mkdtemp(join(tmpdir(), 'worca-cc-parity-proj-'));
    const orch = makeOrch({ projectDir, prompt: 'demo', auto: true, claude: { mock: true }, workflowId });
    const execs = [];
    orch.on('exec', (e) => execs.push(e));
    const artifacts = [];
    orch.on('artifact', (e) => artifacts.push(e));
    const tokens = [];
    orch.on('token', (e) => tokens.push(e));
    const res = await orch.run();
    const state = orch.getState();
    // Resolved HERE, inside the sandbox: artifactPaths reads WORCA_HOME, which the
    // finally below restores.
    const planV1 = planPath(projectDir, state.baseName, 1, state.datePrefix);
    return { res, execs, template, artifacts, tokens, projectDir, state, planV1 };
  } finally {
    _resetForTests();
    if (prevHome === undefined) delete process.env.WORCA_HOME; else process.env.WORCA_HOME = prevHome;
  }
}

/** Node kind by id, so a trace row can be classified without re-deriving ports. */
const kindOf = (template, nodeId) => template.nodes.find((n) => n.id === nodeId)?.kind;

/** Executions in launch order, one row per execution (the 'start' emission). */
const started = (execs) => execs.filter((e) => e.status === 'start');

/**
 * The rows that actually SPAWNED an agent: every agent execution except a
 * composite shell — a `kind:'cycle'` row whose node also ran `kind:'task'`
 * sub-executions at that same ordinal. Derived from the trace itself, so it needs
 * no extra field on the event.
 */
function spawning(rows, template) {
  const shells = new Set(rows.filter((e) => e.kind === 'task').map((e) => `${e.nodeId}:${e.ordinal}`));
  return rows.filter((e) => kindOf(template, e.nodeId) === 'agent'
    && !(e.kind === 'cycle' && shells.has(`${e.nodeId}:${e.ordinal}`)));
}

for (const [workflowId, expected] of Object.entries(PARITY)) {
  test(`${workflowId}: the AGENT execution sequence is byte-identical to the v1 parity script`, async () => {
    const { res, execs, template } = await runSeedUnderMock(workflowId);
    assert.equal(res.status, 'done', 'the pipeline converges');

    const rows = started(execs);
    const agents = rows.filter((e) => kindOf(template, e.nodeId) === 'agent');
    assert.deepEqual(agents.map((e) => e.agentKey), expected, 'agent sequence');
    // The loop re-fires are re-executions of the SAME nodes, not new ones.
    const impl = agents.filter((e) => e.agentKey === 'implementer');
    assert.deepEqual(impl.map((e) => e.ordinal), [1, 2], 'the implementer fix pass is ordinal 2');
    assert.equal(new Set(impl.map((e) => e.nodeId)).size, 1, 'one implementer node, two executions');
  });

  test(`${workflowId}: flow rows are the $0 task head and end tail — excluded from the agent sequence`, async () => {
    const { execs, template } = await runSeedUnderMock(workflowId);
    const rows = started(execs);
    const flow = rows.filter((e) => kindOf(template, e.nodeId) !== 'agent');

    assert.deepEqual(
      flow.map((e) => kindOf(template, e.nodeId)),
      ['task', 'end'],
      'these two seeds have no or/and cards: the task head and the End tail are the only flow rows',
    );
    assert.equal(rows[0].nodeId, flow[0].nodeId, 'the task node fires first, at t0');
    assert.equal(rows.at(-1).nodeId, flow.at(-1).nodeId, 'End is the last execution of the run');
    for (const e of flow) {
      assert.equal(e.agentKey, null, 'flow executions carry no agent key');
    }
    // $0: engine executions spawn nothing, so whatever cost the run reports for
    // them is zero.
    const done = execs.filter((e) => e.status === 'done' && kindOf(template, e.nodeId) !== 'agent');
    for (const e of done) assert.equal(Number(e.costUsd || 0), 0, 'flow executions are $0');
  });

  test(`${workflowId}: End lands after the final reviewer pass and completes the run`, async () => {
    const { res, execs, template } = await runSeedUnderMock(workflowId);
    const rows = started(execs);
    const endRow = rows.find((e) => kindOf(template, e.nodeId) === 'end');
    assert.ok(endRow, 'the End node executed');
    assert.equal(rows.filter((e) => e.nodeId === endRow.nodeId).length, 1, 'End executes at most once');

    const lastReview = rows.map((e) => e.agentKey).lastIndexOf('reviewer');
    assert.ok(rows.indexOf(endRow) > lastReview, 'End follows the final reviewer execution');
    assert.equal(res.status, 'done', 'End arrival IS the natural completion');
    assert.notEqual(res.endReached, false, 'the quiescence-without-End warning must not fire on a seed');
  });
}

// ── the decomposer-gated double-loop seeds (S2) ───────────────────────────────

/**
 * The v1-parity AGENT sequences for the two seeds that wire
 * `decomposer.tasks -> implementer.task` (an `expands` input) AND fan both review
 * loops through the or card.
 *
 * The three consecutive `implementer` entries after `decomposer` are the composite
 * sub-executions — the mock decomposer emits 2 phases (p1t1 + p1t2, then p2t1),
 * and v1 spawned exactly those three implementers, phases sequential and tasks
 * parallel. Both loops then fire once each: the reviewer's review rewinds the
 * implementer, and the later web-UI review rewinds it again, which re-opens the
 * checklist -> web-UI tail a second time.
 */
const DOUBLE_LOOP_PARITY = {
  wf_full: [
    'clarify', 'planner', 'refiner', 'refiner', 'decomposer',
    'implementer', 'implementer', 'implementer',
    'reviewer', 'implementer', 'reviewer',
    'manualTestsChecklist', 'manualWebUiTesting',
    'implementer', 'reviewer',
    'manualTestsChecklist', 'manualWebUiTesting',
  ],
  'wf_provided-plan': [
    'refiner', 'refiner', 'decomposer',
    'implementer', 'implementer', 'implementer',
    'reviewer', 'implementer', 'reviewer',
    'manualTestsChecklist', 'manualWebUiTesting',
    'implementer', 'reviewer',
    'manualTestsChecklist', 'manualWebUiTesting',
  ],
};

/** The mock decomposer's manifest: 2 phases, 3 tasks. */
const MOCK_PHASES = [[1, 'p1t1'], [1, 'p1t2'], [2, 'p2t1']];

for (const [workflowId, expected] of Object.entries(DOUBLE_LOOP_PARITY)) {
  test(`${workflowId}: the AGENT execution sequence, incl. phased sub-executions, is byte-identical to the v1 parity script`, async () => {
    const { res, execs, template } = await runSeedUnderMock(workflowId);
    assert.equal(res.status, 'done', 'the decomposer-gated seed converges');

    const rows = started(execs);
    assert.deepEqual(spawning(rows, template).map((e) => e.agentKey), expected, 'agent sequence');
    // The loop re-fires are re-executions of the SAME node, not new ones: one
    // composite (ordinal 1) and two fix passes.
    const impl = rows.filter((e) => e.nodeId === 'n_impl' && e.kind === 'cycle');
    assert.deepEqual(impl.map((e) => e.ordinal), [1, 2, 3], 'the composite is ordinal 1, the fixes 2 and 3');
    assert.equal(new Set(rows.filter((e) => e.agentKey === 'implementer').map((e) => e.nodeId)).size, 1,
      'one implementer node throughout — composite and fixes alike');
  });

  test(`${workflowId}: flow rows are the $0 task head, the or valves and the end tail — excluded from the agent sequence`, async () => {
    const { execs, template } = await runSeedUnderMock(workflowId);
    const rows = started(execs);
    const flow = rows.filter((e) => kindOf(template, e.nodeId) !== 'agent');

    assert.deepEqual(
      flow.map((e) => kindOf(template, e.nodeId)),
      ['task', 'or', 'or', 'end'],
      'these seeds fan both loops through the or card: one or row per loop emission',
    );
    assert.equal(rows[0].nodeId, flow[0].nodeId, 'the task node fires first, at t0');
    assert.equal(rows.at(-1).nodeId, flow.at(-1).nodeId, 'End is the last execution of the run');
    for (const e of flow) {
      assert.equal(e.agentKey, null, 'flow executions carry no agent key');
    }
    const done = execs.filter((e) => e.status === 'done' && kindOf(template, e.nodeId) !== 'agent');
    for (const e of done) assert.equal(Number(e.costUsd || 0), 0, 'flow executions are $0');

    // The composite SHELL is excluded on the same $0 grounds: it spawns nothing,
    // so it never records a step row and reports no cost.
    const shell = rows.find((e) => e.nodeId === 'n_impl' && e.kind === 'cycle' && e.ordinal === 1);
    assert.equal(Number(shell.costUsd || 0), 0, 'the composite shell is a $0 engine row');
  });

  test(`${workflowId}: the decomposer fans the implementer out into phased sub-executions under ONE node`, async () => {
    const { execs } = await runSeedUnderMock(workflowId);
    const rows = started(execs);
    const slices = rows.filter((e) => e.kind === 'task');

    assert.deepEqual(slices.map((e) => [e.phase, e.taskId]), MOCK_PHASES, 'phases sequential, in manifest order');
    for (const s of slices) {
      assert.equal(s.nodeId, 'n_impl', 'sub-executions are recorded under the CONSUMER node');
      assert.equal(s.agentKey, 'implementer');
      assert.equal(s.ordinal, 1, 'they belong to the ONE composite execution');
    }
    assert.deepEqual(slices.map((e) => e.executionId),
      MOCK_PHASES.map(([, id]) => `x:n_impl:1:${id}`));

    // The composite publishes once: the reviewer runs after the LAST slice, never
    // once per task.
    const firstReview = rows.findIndex((e) => e.agentKey === 'reviewer');
    assert.ok(rows.indexOf(slices.at(-1)) < firstReview, 'the reviewer waits for the whole fan-out');
    assert.equal(rows.slice(0, firstReview).filter((e) => e.kind === 'task').length, 3);
  });

  test(`${workflowId}: a fix re-fire binds the review path FORWARDED THROUGH the or valve`, async () => {
    const { execs, tokens, template } = await runSeedUnderMock(workflowId);
    const rows = started(execs);
    const orNode = template.nodes.find((n) => n.kind === 'or').id;
    const fixWire = template.wires.find((w) => w.from.node === orNode && w.to.port === 'fix');

    // Each or emission re-emits the payload of the review token it bound, and the
    // or -> fix wire is the ONLY wire out of the valve, so this IS what the fix
    // pass binds.
    const emissions = tokens.filter((t) => t.from.node === orNode);
    const reviewer = tokens.find((t) => t.from.node === 'n_review' && t.from.port === 'review');
    const webui = tokens.find((t) => t.from.node === 'n_webui' && t.from.port === 'review');
    assert.equal(emissions.length, 2, 'one emission per loop');
    assert.equal(emissions[0].path, reviewer.path, "the first fix binds the reviewer's own review file");
    assert.equal(emissions[1].path, webui.path, "the second binds the web-UI reviewer's");
    assert.notEqual(reviewer.path, webui.path, 'two different files reached the same fix port');

    for (const ordinal of [2, 3]) {
      const fix = rows.find((e) => e.nodeId === 'n_impl' && e.kind === 'cycle' && e.ordinal === ordinal);
      assert.deepEqual(fix.trigger.freshPorts, ['fix'], `ordinal ${ordinal} is a pure fix re-fire`);
      assert.ok(fix.trigger.wireIds.includes(fixWire.id), `delivered over ${fixWire.id}, the or -> fix wire`);
    }
    assert.equal(rows.filter((e) => e.kind === 'task').length, 3,
      'a fix re-fire runs ONE normal execution on the combined diff — it never fans out again');
  });
}

test('wf_provided-plan: the task token IS the plans-store file (A2) and the next plan write is -v2', async () => {
  const { res, tokens, state, planV1 } = await runSeedUnderMock('wf_provided-plan');
  assert.equal(res.status, 'done');

  // A2, pinned end-to-end through the live scheduler -> execute path: the task
  // card's `planStoreSeed` makes the emitted token the PLANS-STORE file at
  // version 1, not the pipelineDir document.
  const taskToken = tokens.find((t) => t.from.node === 'n_task');
  assert.equal(taskToken.path, planV1, 'the entry token is the plans-store v1 path');
  assert.equal(taskToken.path.startsWith(state.pipelineDir), false, 'and NOT the pipelineDir doc');

  // The run-global counter therefore starts CONSUMED at 1, so the next plan-store
  // write allocates -v2 (the refiner's first pass), and its second -v3.
  const plans = (await readdir(dirname(taskToken.path))).sort();
  assert.deepEqual(plans, [
    `${state.datePrefix}-${state.baseName}-v2.md`,
    `${state.datePrefix}-${state.baseName}-v3.md`,
    `${state.datePrefix}-${state.baseName}.md`,
  ], 'v1 is the seeded task, then one version per refiner execution — no version is burned twice');
});
