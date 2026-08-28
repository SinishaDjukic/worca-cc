// test/orchestrator-graph.test.mjs
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { useTempHome } from './helpers/temp-home.mjs';
import { gitDir } from './helpers/git-dir.mjs';
import { createGraphOrchestrator } from '../src/core/graph/orchestrator.mjs';

useTempHome(after);

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { before } from 'node:test';
import { SEED_TEMPLATES } from '../src/core/graph/seed-templates.mjs';
import { writeGraphWorkflow } from '../src/core/workflows.mjs';
import { readPipelineForResume } from '../src/core/artifacts.mjs';
import { setPipelineCostLimitUsd } from '../src/core/settings.mjs';
import { QUIESCENCE_WARNING } from '../src/core/graph/scheduler.mjs';

// settings sandbox: settingsFile() resolves under HOME, not WORCA_HOME (the
// same isolation test/cost-enforcement.test.mjs:18-36 uses).
let sandboxHome;
const prevEnv = {};
before(async () => {
  sandboxHome = await mkdtemp(join(tmpdir(), 'worca-graph-home-'));
  for (const k of ['HOME', 'USERPROFILE']) prevEnv[k] = process.env[k];
  process.env.HOME = sandboxHome;
  process.env.USERPROFILE = sandboxHome;
});
after(async () => {
  for (const k of ['HOME', 'USERPROFILE']) {
    if (prevEnv[k] === undefined) delete process.env[k]; else process.env[k] = prevEnv[k];
  }
  await rm(sandboxHome, { recursive: true, force: true });
});

/** Persist the 7 seeds so readWorkflow can serve them (V24 does this for real
 *  in P8). wf_default rides its coexistence alias and is NOT written. */
async function seedGraphs() {
  for (const t of SEED_TEMPLATES) {
    await writeGraphWorkflow({ id: t.id, name: t.name, domain: t.domain, nodes: t.nodes, wires: t.wires });
  }
}
/** Every runnable graph id: the 7 saved seeds + the graph default's alias. */
const GRAPH_IDS = [...SEED_TEMPLATES.map((t) => t.id), 'wf_default'];
/** Seeds that cannot reach End under the mock BY DESIGN (P3's mock-graph audit). */
const QUIESCENT = new Set(['wf_no-clarify']);
/** The v2 executor ABI for injected runners: one entry per declared output port. */
function outsOf(ctx) {
  const o = {};
  for (const p of ctx.ports.outputs || []) o[p.id] = { path: ctx.outputs?.[p.id]?.path ?? null, type: p.type };
  return o;
}

test('the graph default runs end to end under mock and reaches the End card', { timeout: 120000 }, async () => {
  const dir = gitDir();
  const orch = createGraphOrchestrator({
    projectDir: dir, workflowId: 'wf_default', prompt: 'demo task',
    claude: { mock: true }, auto: true,
  });
  const execs = [];
  orch.on('exec', (e) => execs.push(e));

  const res = await orch.run();
  assert.equal(res.status, 'done', res.error);

  const st = orch.getState();
  assert.equal(st.engine, 2);
  assert.equal(st.endReached, true, 'the End card was bound');
  assert.ok(st.result, 'state.result carries the End payload');
  assert.deepEqual(st.warnings, []);
  // Every ledger row is keyed by its executionId (bookends aside).
  const rows = st.steps.filter((x) => String(x.key).startsWith('x:'));
  assert.ok(rows.length > 0);
  for (const s of rows) {
    assert.equal(s.key, s.executionId);
    assert.ok(/^x:[A-Za-z0-9_-]+:\d+(:[A-Za-z0-9_-]+)?$/.test(s.key), `bad executionId ${s.key}`);
    assert.equal(s.stepIndex, null);
    assert.ok(['done', 'error', 'paused', 'stopped'].includes(s.status), `${s.key} ended ${s.status}`);
  }
  // The agent nodes all ran (clarify, planner, refiner x2, implementer x2, reviewer x2).
  const started = execs.filter((e) => e.status === 'start' && e.agentKey);
  assert.ok(started.length >= 8, `expected >= 8 agent executions, got ${started.length}`);
  assert.equal(orch.getState().status, 'done');
});

test('every seed graph completes offline under mock; all but the quiescent one bind End', { timeout: 300000 }, async () => {
  await seedGraphs();
  assert.equal(GRAPH_IDS.length, 8, 'seven seeds + the graph default alias');
  for (const workflowId of GRAPH_IDS) {
    const dir = gitDir('seed');
    const orch = createGraphOrchestrator({
      projectDir: dir, workflowId, prompt: 'demo task', claude: { mock: true }, auto: true,
    });
    const res = await orch.run();
    const st = orch.getState();
    assert.equal(res.status, 'done', `${workflowId} finished: ${res.error || ''}`);
    if (QUIESCENT.has(workflowId)) {
      assert.equal(st.endReached, false, `${workflowId} quiesces by design`);
      assert.deepEqual(st.warnings, [QUIESCENCE_WARNING]);
    } else {
      assert.equal(st.endReached, true, `${workflowId} reached End`);
      assert.ok(st.result, `${workflowId} bound a result`);
      assert.deepEqual(st.warnings, [], `${workflowId} produced no quiescence warning`);
    }
    assert.ok(st.steps.every((s) => s.status !== 'error'), `${workflowId}: no error rows`);
  }
});

test('the ledger is one row per execution, and every loop closes at ordinal 2', { timeout: 120000 }, async () => {
  await seedGraphs();
  const dir = gitDir('ledger');
  const orch = createGraphOrchestrator({
    projectDir: dir, workflowId: 'wf_full', prompt: 'demo', claude: { mock: true }, auto: true,
  });
  await orch.run();
  const st = orch.getState();
  const keys = st.steps.map((s) => s.key);
  assert.equal(new Set(keys).size, keys.length, 'no duplicate ledger keys');
  // The mock verifier is blocking at ordinal 1 and clean at ordinal 2, so every
  // looped node runs at MOST ordinal 3 (wf_full has TWO loops into the implementer:
  // review->fix and webui->fix, each closing at its own second delivery).
  const byNode = new Map();
  for (const s of st.steps.filter((x) => x.kind === 'cycle' && x.agentKey)) {
    byNode.set(s.nodeId, Math.max(byNode.get(s.nodeId) || 0, s.ordinal));
  }
  assert.ok([...byNode.values()].some((n) => n >= 2), 'at least one node re-fired');
  assert.ok([...byNode.values()].every((n) => n <= 3), `a loop overran: ${JSON.stringify([...byNode])}`);
  // Composite slices ride their parent's ordinal and carry the task fields.
  const slices = st.steps.filter((x) => x.kind === 'task');
  assert.ok(slices.length >= 2, 'the decomposer fanned the implementer out');
  for (const s of slices) {
    assert.ok(s.parentExecutionId && s.taskId && s.key === `${s.parentExecutionId}:${s.taskId}`);
    assert.ok(Number.isInteger(s.taskIndex) && Number.isInteger(s.taskTotal));
  }
  // wireDeliveries never exceeds the wire's budget (and under mock never exceeds 1).
  const wires = new Map((st.stepper.graph.wires || []).map((w) => [w.id, w]));
  for (const [wireId, n] of Object.entries(st.wireDeliveries)) {
    const max = wires.get(wireId)?.maxCycles;
    if (max != null) assert.ok(n <= max, `${wireId} delivered ${n} > ${max}`);
    assert.ok(n <= 1, `${wireId} delivered ${n} times (loops close at ordinal 2)`);
  }
});

test('a loop gate asks with the POST /api/answer shape and "another" buys one more cycle', { timeout: 120000 }, async () => {
  await seedGraphs();
  const dir = gitDir('gate');
  // Budget 1 => allowance 0 => the FIRST blocking delivery is held behind a gate.
  const tpl = SEED_TEMPLATES.find((t) => t.id === 'wf_quick-fix');
  const wires = tpl.wires.map((w) => (w.config?.maxCycles ? { ...w, config: { ...w.config, maxCycles: 1 } } : w));
  await writeGraphWorkflow({ id: 'wf_gate_probe', name: 'Gate probe', domain: tpl.domain, nodes: tpl.nodes, wires });
  const orch = createGraphOrchestrator({
    projectDir: dir, workflowId: 'wf_gate_probe', prompt: 'demo', claude: { mock: true }, auto: false,
  });
  const gates = [];
  orch.on('question', (q) => {
    // `question` is emitted BEFORE pendingQuestion is installed: answer on the next tick.
    if (q.kind !== 'gate') return setImmediate(() => orch.answer(q.id, { answers: [] }));
    gates.push(q);
    setImmediate(() => orch.answer(q.id, { decision: gates.length === 1 ? 'another' : 'continue' }));
  });
  const res = await orch.run();
  assert.equal(res.status, 'done', res.error);
  assert.equal(orch.getState().endReached, true);
  assert.equal(gates.length, 1, 'the gate fired once; the second cycle was clean');
  const g = gates[0];
  assert.match(g.id, /^gate-[A-Za-z0-9_-]+-\d+$/, 'ask id is gate-<wireId>-<deliveryNo>');
  assert.equal(g.kind, 'gate');
  assert.equal(g.wireId, 'w5', 'the gate names its wire');
  assert.ok(g.nodeId, 'the gate names the SOURCE node');
  assert.ok(g.executionId, 'and the execution that produced the verdict');
  assert.ok(Array.isArray(g.issues) && g.issues.length > 0, 'the gate carries the blocking issues');
  const impl = orch.getState().steps.filter((s) => s.agentKey === 'implementer').map((s) => s.ordinal);
  assert.deepEqual(impl, [1, 2], '"another" bought exactly one more implementer cycle');
});

test('stop mid-run keeps the partial diff and leaves no resume point', { timeout: 120000 }, async () => {
  await seedGraphs();
  const dir = gitDir('gstop');
  let orch;
  orch = createGraphOrchestrator({
    projectDir: dir, workflowId: 'wf_default', prompt: 'demo', auto: true, claude: { mock: true },
    runners: {
      producer: async (ctx) => {
        // Write a real file so the staged partial diff is non-empty, then stop.
        await writeFile(join(ctx.projectDir, 'touched.txt'), 'x');
        queueMicrotask(() => orch.stop());
        return new Promise((_r, rej) => {
          const onAbort = () => { const e = new Error('aborted'); e.name = 'AbortError'; rej(e); };
          if (ctx.signal.aborted) onAbort(); else ctx.signal.addEventListener('abort', onAbort, { once: true });
        });
      },
      verifier: async (ctx) => ({ outputs: outsOf(ctx), verdict: { issues: [], summary: '' } }),
      clarifier: async (ctx) => ({ outputs: outsOf(ctx), verdict: null }),
    },
  });
  const res = await orch.run();
  assert.equal(res.status, 'stopped');
  assert.equal(orch.getState().resumePoint, null, 'a stopped run is not resumable');
  const saved = readPipelineForResume(orch.getState().id);
  assert.equal(saved.row.status, 'stopped');
  assert.equal(saved.resumePoint, null);
  // The in-flight row was closed by _execStep with the engine's marker (`stopped`
  // when the harness's abort signal fired). Keyed by executionId, which the row
  // carries even before Task 4 persists the exec columns.
  assert.ok(saved.steps.some((s) => String(s.key).startsWith('x:') && (s.status === 'stopped' || s.status === 'error')));
});

test('the End-bound result is recorded as an artifact', { timeout: 120000 }, async () => {
  await seedGraphs();
  const dir = gitDir('gend');
  const orch = createGraphOrchestrator({
    projectDir: dir, workflowId: 'wf_default', prompt: 'demo', claude: { mock: true }, auto: true,
  });
  const arts = [];
  orch.on('artifact', (a) => arts.push(a));
  await orch.run();
  const st = orch.getState();
  if (st.result?.path) {
    const hit = arts.find((a) => a.kind === 'result' && a.path === st.result.path);
    assert.ok(hit, 'the End-bound path was recorded');
    assert.ok(hit.nodeId && hit.executionId, 'the artifact event carries its node + execution attribution');
  } else {
    assert.equal(st.result.type, 'void', 'a void End binds no path (the graph default ends on reviewer.pass)');
  }
  // Every agent output was recorded once, with attribution.
  const plans = arts.filter((a) => a.kind === 'plan');
  assert.ok(plans.length >= 2, 'planner + refiner plans');
  assert.ok(plans.every((a) => a.nodeId && a.executionId && a.port));
});

test('the pipeline cost cap is enforced at EVERY agent launch, not per step', { timeout: 120000 }, async () => {
  await seedGraphs();
  const dir = gitDir('gcost');
  await setPipelineCostLimitUsd(0.05);
  try {
    let launches = 0;
    const spend = (ctx) => ctx.onEvent({ type: 'result', costUsd: 0.04, raw: { type: 'result', total_cost_usd: 0.04 } });
    const orch = createGraphOrchestrator({
      projectDir: dir, workflowId: 'wf_default', prompt: 'demo', auto: true, claude: { mock: true },
      runners: {
        producer: async (ctx) => { launches += 1; spend(ctx); return { outputs: outsOf(ctx), verdict: null }; },
        verifier: async (ctx) => { launches += 1; spend(ctx); return { outputs: outsOf(ctx), verdict: { issues: [], summary: '' } }; },
        clarifier: async (ctx) => { launches += 1; return { outputs: outsOf(ctx), verdict: null }; },
      },
    });
    const res = await orch.run();
    assert.equal(res.status, 'paused');
    assert.equal(orch.pauseReason, 'cost_pipeline');
    // clarifier ($0) + planner ($0.04, under the cap) + refiner ($0.04 -> $0.08): the
    // NEXT launch trips the gate. No more than one extra launch can slip through
    // (agent nodes on the default graph are sequential under the scheduler).
    assert.ok(launches >= 3 && launches <= 4, `capped after the spend crossed 0.05, saw ${launches} launches`);
    assert.ok(orch.getState().steps.some((s) => s.status === 'paused'), 'the gated execution is a paused row');
  } finally {
    await setPipelineCostLimitUsd('');
  }
});
