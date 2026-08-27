// test/saved-pipeline-parity.test.mjs
// Task 11 — guard test: runs the 5 saved-pipeline topologies under MOCK and asserts
// they converge with the SAME implementer modes and plan-path parity as before the
// channel-bus refactor (Phases 0–4). No production code is changed here.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createOrchestrator as makeOrch } from '../src/core/orchestrator.mjs';
import { writeWorkflow } from '../src/core/workflows.mjs';
import { _resetForTests, getDb } from '../src/core/db.mjs';

const SHAPES = {
  'default':       { steps: [['planner'],['refiner'],['implementer'],['reviewer']],
                     feedbacks: [['s1_0','s1_0'],['s3_0','s2_0']] },
  'quick-fix':     { steps: [['planner'],['implementer'],['reviewer']], feedbacks: [['s2_0','s1_0']] },
  'implement-only':{ steps: [['implementer'],['reviewer']],             feedbacks: [['s1_0','s0_0']] },
  'plan-only':     { steps: [['planner'],['refiner']],                  feedbacks: [['s1_0','s1_0']] },
  'web-ui':        { steps: [['planner'],['refiner'],['implementer'],['reviewer'],['manualTestsChecklist'],['manualWebUiTesting']],
                     feedbacks: [['s1_0','s1_0'],['s3_0','s2_0'],['s5_0','s2_0']] },
};

async function runShapeUnderMock(shape) {
  const home = await mkdtemp(join(tmpdir(), 'worca-cc-parity-home-'));
  const prevHome = process.env.WORCA_HOME;
  process.env.WORCA_HOME = home;                         // sandbox the global store
  _resetForTests();                                        // fresh DB singleton at this home
  try {
    const steps = shape.steps.map((g, i) => g.map((key, j) => ({ id: `s${i}_${j}`, key })));
    const feedbacks = (shape.feedbacks || []).map(([from, to], k) => ({ id: `fb_${k}`, from, to }));
    const tpl = await writeWorkflow({ name: 'parity', steps, feedbacks });   // async; returns {id,...}
    const projectDir = await mkdtemp(join(tmpdir(), 'worca-cc-parity-proj-'));
    const orch = makeOrch({ projectDir, prompt: 'demo', auto: true, claude: { mock: true }, workflowId: tpl.id });
    const modes = [];
    // Instance-local copy so wrapping the producer does NOT mutate the shared
    // `defaultRunners` singleton (each shape would otherwise chain wrappers and
    // leak a patched producer to later tests in this file).
    orch._runners = { ...orch._runners };
    const realProducer = orch._runners.producer;
    const planReads = [];
    orch._runners.producer = async (ctx) => {
      if (ctx?.node?.key === 'implementer') {
        modes.push(ctx.mode);
        let content = null;
        try { content = await readFile(ctx.planPath, 'utf8'); } catch { /* may not exist */ }
        planReads.push({ planPath: ctx.planPath, content });
      }
      return realProducer(ctx);
    };
    // ▲ v3 (V3-B): artifacts come via the 'artifact' EVENT ({kind,path}); getState()
    // has no .artifacts. Subscribe BEFORE run().
    const artifacts = [];
    orch.on('artifact', (e) => artifacts.push(e));
    let lastState = null;
    orch.on('state', (s) => { lastState = s; });
    const res = await orch.run();
    assert.equal(res.status, 'done', 'pipeline converges');
    // State now persists to the pipelines row (was state.json). Read the row back
    // and reconstruct just the fields these tests assert on (the stepper manifest).
    let persistedState = null;
    try {
      const id = orch.getState().id;
      const row = getDb().prepare('SELECT stepper FROM pipelines WHERE id = ?').get(id);
      if (row) persistedState = { stepper: row.stepper == null ? null : JSON.parse(row.stepper) };
    } catch { /* some shapes may not persist; assert per-test */ }
    return { modes, artifacts, planReads, state: lastState, persistedState };
  } finally {
    _resetForTests();
    if (prevHome === undefined) delete process.env.WORCA_HOME; else process.env.WORCA_HOME = prevHome;
  }
}

test('every saved shape converges with the right implementer modes', async () => {
  for (const [name, shape] of Object.entries(SHAPES)) {
    const { modes } = await runShapeUnderMock(shape);
    if (name === 'plan-only') {
      assert.deepEqual(modes, [], `${name}: no implementer`);
    } else if (name === 'web-ui') {
      // web-ui has TWO verifier loops that both rewind to the implementer step:
      //   reviewer (s3_0->s2_0) + manualWebUiTesting (s5_0->s2_0).
      // Each fires once under mock (cycle1 blocking → cycle2 converged), so the
      // implementer runs: implement (initial) + fix (reviewer loop) + fix (webui loop) = 3 times.
      assert.deepEqual(modes, ['implement', 'fix', 'fix'], `${name} modes`);
    } else {
      assert.deepEqual(modes, ['implement', 'fix'], `${name} modes`);
    }
  }
});

test('▲ C1: planner writes the canonical v1 plan; refiner writes -v2 (no path drift)', async () => {
  const { artifacts } = await runShapeUnderMock(SHAPES['default']);
  const planPaths = artifacts.filter((a) => a.kind === 'plan').map((a) => a.path);
  assert.ok(planPaths.some((p) => /\/\d\d-\d\d-\d\d-[^/]+\.md$/.test(p) && !/-v\d+\.md$/.test(p)), 'canonical v1 plan file exists');
  assert.ok(planPaths.some((p) => /-v2\.md$/.test(p)), 'refiner v2 plan file exists');
});

test('two implementers separated by a reviewer: trailing impl fixes the reviewer review, not a stale one', async () => {
  // Derivation (do not guess):
  //  impl#1: bus.review null (seed) -> 'implement'; publishes code -> bus.review := null.
  //  reviewer: publishes bus.review = { mdPath: impl-review.md }.
  //  impl#2: reviewer is its immediate predecessor, no intervening code publish ->
  //          binds that review (md present) -> 'fix'.
  // Hence exactly ['implement','fix']. A LATER (3rd) implementer would be 'implement'
  // again because impl#2's code publish clears the review.
  const shape = { steps: [['planner'],['implementer'],['reviewer'],['implementer']], feedbacks: [] };
  const { modes } = await runShapeUnderMock(shape);
  assert.deepEqual(modes, ['implement', 'fix']);
});

test('refiner before implementer does NOT flip the first implement to fix (▲ C2)', async () => {
  // planner -> refiner -> implementer. The refiner publishes only a private (md-less)
  // review, so the implementer's first pass must be 'implement', not 'fix'.
  const shape = { steps: [['planner'],['refiner'],['implementer']], feedbacks: [] };
  const { modes } = await runShapeUnderMock(shape);
  assert.deepEqual(modes, ['implement']);
});

test('implement-only seeds the plan from the prompt without changing implementer modes', async () => {
  const { planReads, modes } = await runShapeUnderMock(SHAPES['implement-only']);
  assert.ok(planReads.length >= 1, 'implementer ran');
  const first = planReads[0];
  assert.ok(first.content, `seeded plan file exists at ${first.planPath}`);
  assert.match(first.content, /## Original request/);
  assert.match(first.content, /demo/); // the prompt text the harness passes to makeOrch
  // Seeding fills plan CONTENT only — it must NOT flip the implementer's mode.
  assert.deepEqual(modes, ['implement', 'fix'], 'no mode drift from seeding');
});

test('default (planner-first) does NOT seed — no prompt-seed banner in the plan', async () => {
  const { planReads } = await runShapeUnderMock(SHAPES['default']);
  assert.ok(planReads.length >= 1);
  assert.doesNotMatch(planReads[0].content || '', /No upstream agent produced this artifact/);
});

test('stepper.feedbacks flows through the emitted state AND the persisted state.json (no whitelist)', async () => {
  const { state, persistedState } = await runShapeUnderMock(SHAPES['default']);
  // (1) Emitted state (getState() deep-clone -> _emit('state', ...)) carries the loop edges.
  assert.ok(state && state.stepper, 'a state event with a stepper was emitted');
  assert.deepEqual(state.stepper.feedbacks, [
    { id: 'fb_0', from: 's1_0', to: 's1_0', maxCycles: 3 }, // self-cycle (refiner)
    { id: 'fb_1', from: 's3_0', to: 's2_0', maxCycles: 3 }, // cross-loop (review->implement)
  ]);
  // (2) Persisted state.json (writeState writes the whole state object) carries them identically.
  assert.ok(persistedState && persistedState.stepper, 'state.json persisted a stepper');
  assert.deepEqual(persistedState.stepper.feedbacks, state.stepper.feedbacks,
    'persisted feedbacks === emitted feedbacks (no field stripped on the way to disk)');
});

// ── P4: dual-engine parity on the eight graphs ────────────────────────────────
import { execSync } from 'node:child_process';
import { createGraphOrchestrator } from '../src/core/graph/orchestrator.mjs';
import { writeGraphWorkflow } from '../src/core/workflows.mjs';
import { SEED_TEMPLATES, FB_WIRE_MAP } from '../src/core/graph/seed-templates.mjs';
import { listArtifacts } from '../src/core/artifacts.mjs';

const PARITY_SKIP_KINDS = new Set(['pipeline', 'run-log', 'live-log', 'questions', 'clarify', 'decomposition', 'result']);

function parityGitDir(tag) {
  const dir = mkdtempSync(join(tmpdir(), `worca-cc-parity-${tag}-`));
  execSync('git init -q && git -c user.email=t@t -c user.name=t commit -q --allow-empty -m init', { cwd: dir });
  return dir;
}
const counts = (seq) => seq.reduce((m, k) => ({ ...m, [k]: (m[k] || 0) + 1 }), {});
const gateKey1 = (q, wfId) => { const m = /^gate-(.+)-(\d+)$/.exec(q.id); return `${(FB_WIRE_MAP[wfId] || {})[m[1]] || m[1]}#${m[2]}`; };
const gateKey2 = (q) => { const m = /^gate-(.+)-(\d+)$/.exec(q.id); return `${q.wireId || m[1]}#${m[2]}`; };
const files = async (id) => (await listArtifacts(id)).filter((a) => !PARITY_SKIP_KINDS.has(a.kind)).map((a) => `${a.kind}:${a.relPath}`).sort();

/** Drive a run interactively (gates answered `continue`, clarify with empty answers)
 *  and collect the START sequence. Answers go through setImmediate: `question` is
 *  emitted before pendingQuestion is installed. */
async function drive(orch, { v2 }) {
  const gateQs = [];
  const starts = [];
  const parents = new Set();
  orch.on('question', (q) => {
    if (q.kind === 'gate') gateQs.push(q);
    setImmediate(() => orch.answer(q.id, q.kind === 'gate' ? { decision: 'continue' } : { answers: [] }));
  });
  if (v2) {
    orch.on('exec', (e) => {
      if (e.kind === 'task' && e.parentExecutionId) parents.add(e.parentExecutionId);
      if (e.status === 'start' && e.agentKey) starts.push({ key: e.agentKey, executionId: e.executionId });
    });
  } else {
    orch.on('phase', (p) => { if (p.status === 'start' && p.nodeId) starts.push({ nodeId: p.nodeId }); });
  }
  const res = await orch.run();
  const st = orch.getState();
  const seq = v2
    ? starts.filter((s) => !parents.has(s.executionId)).map((s) => s.key)
    : starts.map((s) => (st.steps.find((x) => x.nodeId === s.nodeId) || {}).phase || s.nodeId);
  return { res, st, gateQs, seq };
}

/** Same sandboxing the file's runShapeUnderMock uses: a private WORCA_HOME + DB per run. */
async function withParityHome(fn) {
  const home = await mkdtemp(join(tmpdir(), 'worca-cc-parity-v2-home-'));
  const prevHome = process.env.WORCA_HOME;
  process.env.WORCA_HOME = home;
  _resetForTests();
  try { return await fn(); } finally {
    _resetForTests();
    if (prevHome === undefined) delete process.env.WORCA_HOME; else process.env.WORCA_HOME = prevHome;
  }
}

const PARITY_CASES = [
  ...SEED_TEMPLATES.map((t) => ({ id: t.id, graph: t })),
  { id: 'wf_default', graph: null },   // rides the coexistence alias on v2
];

for (const c of PARITY_CASES) {
  test(`parity: ${c.id} traces identically on both engines`, { timeout: 300000 }, async () => {
    await withParityHome(async () => {
      // ── v1 leg ──
      const v1Tpl = c.graph
        ? JSON.parse(await readFile(new URL(`./fixtures/workflows-v1/${c.id}.json`, import.meta.url), 'utf8'))
        : { id: 'wf_default' };
      if (c.graph) await writeWorkflow(v1Tpl);
      const a = await drive(makeOrch({
        projectDir: parityGitDir(`${c.id}-v1`), workflowId: v1Tpl.id, prompt: 'parity probe',
        claude: { mock: true }, auto: false,
      }), { v2: false });

      // ── v2 leg ──
      if (c.graph) await writeGraphWorkflow({ id: `${c.id}__g`, name: c.graph.name, domain: c.graph.domain, nodes: c.graph.nodes, wires: c.graph.wires });
      const b = await drive(createGraphOrchestrator({
        projectDir: parityGitDir(`${c.id}-v2`), workflowId: c.graph ? `${c.id}__g` : 'wf_default_v2',
        prompt: 'parity probe', claude: { mock: true }, auto: false,
      }), { v2: true });

      assert.equal(a.res.status, 'done', `v1 leg completed: ${a.res.error || ''}`);
      assert.equal(b.res.status, 'done', `v2 leg completed: ${b.res.error || ''}`);
      assert.deepEqual(b.seq, a.seq, `agent execution sequence diverged for ${c.id}`);
      assert.deepEqual(counts(b.seq), counts(a.seq), `per-key run counts diverged for ${c.id}`);
      assert.deepEqual(await files(b.st.id), await files(a.st.id), `produced files diverged for ${c.id}`);
      assert.deepEqual(b.gateQs.map(gateKey2), a.gateQs.map((q) => gateKey1(q, c.id)), `gate prompts diverged for ${c.id}`);
      if (c.id !== 'wf_no-clarify') assert.equal(b.st.endReached, true, `${c.id}: v2 bound End`);
    });
  });
}
