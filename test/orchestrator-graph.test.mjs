// test/orchestrator-graph.test.mjs
// End-to-end coverage of the GRAPH orchestrator (the v1 dispatcher's replacement).
// Everything here drives the REAL orchestrator under mock: the exec trace on the
// builtin wf_default, the review->fix loop, pause/resume, the exhausted-budget gate,
// the run-time validateGraph abort, and the quiescence-without-End warning.
//
// The suite is deliberately event-level: `exec` (one row per execution, start +
// terminal) and `log` are the engine's public trace, so pinning them here is what
// keeps the run monitor honest.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { useTempHome } from './helpers/temp-home.mjs';
import { createOrchestrator } from '../src/core/orchestrator.mjs';
import { writeWorkflow } from '../src/core/workflows.mjs';
import { readPipelineForResume } from '../src/core/artifacts.mjs';
import { GRAPH_DEFAULT_WORKFLOW } from '../src/core/graph/builtin-workflows.mjs';

useTempHome(after);

/** A throwaway git checkout: worktree creation (and therefore resume) needs one. */
function gitDir(tag = 'graph') {
  const dir = mkdtempSync(join(tmpdir(), `worca-cc-${tag}-`));
  execSync('git init -q && git -c user.email=t@t -c user.name=t commit -q --allow-empty -m init', { cwd: dir });
  return dir;
}

/** Collect the engine's trace off a live orchestrator. */
function trace(orch) {
  const t = { execs: [], logs: [], questions: [], artifacts: [], states: [] };
  orch.on('exec', (e) => t.execs.push(e));
  orch.on('log', (e) => t.logs.push(e));
  orch.on('question', (e) => t.questions.push(e));
  orch.on('artifact', (e) => t.artifacts.push(e));
  orch.on('state', (e) => t.states.push(e));
  return t;
}

const started = (execs) => execs.filter((e) => e.status === 'start');
const kindOf = (template, nodeId) => template.nodes.find((n) => n.id === nodeId)?.kind;

// ── 1. the wf_default trace ───────────────────────────────────────────────────

test('wf_default under mock: the scheduler case-1 agent sequence, with the End tail', async () => {
  const dir = gitDir('wfdef');
  const orch = createOrchestrator({ projectDir: dir, prompt: 'demo', auto: true, claude: { mock: true } });
  const t = trace(orch);
  const res = await orch.run();
  assert.equal(res.status, 'done');

  const rows = started(t.execs);
  const agents = rows.filter((e) => kindOf(GRAPH_DEFAULT_WORKFLOW, e.nodeId) === 'agent');
  assert.deepEqual(
    agents.map((e) => e.agentKey),
    ['clarify', 'planner', 'refiner', 'refiner', 'implementer', 'reviewer', 'implementer', 'reviewer'],
    'the mock blocks every verifier at cycle 1, so both loops fire exactly once',
  );

  const flow = rows.filter((e) => kindOf(GRAPH_DEFAULT_WORKFLOW, e.nodeId) !== 'agent');
  assert.deepEqual(flow.map((e) => kindOf(GRAPH_DEFAULT_WORKFLOW, e.nodeId)), ['task', 'end']);
  assert.equal(rows[0].nodeId, 'n_task', 'the task card fires first');
  assert.equal(rows.at(-1).nodeId, 'n_end', 'End is the last execution');
  assert.equal(res.endReached, true, 'the run resolved through End');
  assert.ok(res.result, 'the run carries End\'s bound result');
});

test('wf_default: the review->fix loop re-executes the SAME implementer node as ordinal 2', async () => {
  const dir = gitDir('loop');
  const orch = createOrchestrator({ projectDir: dir, prompt: 'demo', auto: true, claude: { mock: true } });
  const t = trace(orch);
  await orch.run();

  const impl = started(t.execs).filter((e) => e.agentKey === 'implementer');
  assert.deepEqual(impl.map((e) => e.ordinal), [1, 2], 'the fix pass is ordinal 2');
  assert.equal(new Set(impl.map((e) => e.nodeId)).size, 1, 'one implementer node, two executions');
  assert.deepEqual(
    impl.map((e) => e.executionId),
    ['x:n_impl:1', 'x:n_impl:2'],
    'the executionId IS the step key',
  );
});

test('log events carry both nodeId and executionId', async () => {
  const dir = gitDir('logattr');
  const orch = createOrchestrator({ projectDir: dir, prompt: 'demo', auto: true, claude: { mock: true } });
  const t = trace(orch);
  await orch.run();

  const agentLines = t.logs.filter((l) => l.nodeId === 'n_plan');
  assert.ok(agentLines.length, 'the planner node produced log lines');
  for (const l of agentLines) {
    assert.equal(l.nodeId, 'n_plan');
    assert.equal(l.executionId, 'x:n_plan:1', 'every planner line is pinned to its execution');
  }
});

test('run() persists the v2 graph manifest into pipelines.stepper', async () => {
  const dir = gitDir('manifest');
  const orch = createOrchestrator({ projectDir: dir, prompt: 'demo', auto: true, claude: { mock: true } });
  await orch.run();
  const stepper = orch.state.stepper;
  assert.equal(stepper.version, 2);
  assert.deepEqual(
    stepper.graph.nodes.map((n) => n.id),
    GRAPH_DEFAULT_WORKFLOW.nodes.map((n) => n.id),
    'every graph node is in the manifest, End included',
  );
  assert.ok(stepper.graph.wires.some((w) => w.loop), 'loop wires carry their flag');
});

// ── 2. pause / resume ─────────────────────────────────────────────────────────

test('pause mid-execution -> fresh instance -> resume -> done', async () => {
  const dir = gitDir('resume');
  const orch1 = createOrchestrator({ projectDir: dir, prompt: 'demo', auto: true, claude: { mock: true } });
  // Pause the moment the implementer starts: the run unwinds with a v2 resume point.
  orch1.on('exec', (e) => {
    if (e.status === 'start' && e.agentKey === 'implementer') queueMicrotask(() => orch1.pause());
  });
  const r1 = await orch1.run();
  assert.equal(r1.status, 'paused');
  const pipelineId = orch1.state.id;

  const saved = readPipelineForResume(pipelineId);
  assert.equal(saved.row.status, 'paused');
  assert.equal(saved.resumePoint.version, 2, 'the resume point is v2');
  assert.ok(saved.resumePoint.snapshot, 'it carries the scheduler snapshot');

  const orch2 = createOrchestrator({
    projectDir: dir, claude: { mock: true }, auto: true, resume: saved,
  });
  const t2 = trace(orch2);
  const r2 = await orch2.resume();
  assert.equal(r2.status, 'done');
  assert.equal(r2.endReached, true);
  // The resumed run re-executed the interrupted implementer and carried on to End.
  assert.ok(started(t2.execs).some((e) => e.agentKey === 'implementer'));
  assert.ok(started(t2.execs).some((e) => e.nodeId === 'n_end'));

  const afterRun = readPipelineForResume(pipelineId);
  assert.equal(afterRun.row.status, 'done');
  assert.equal(afterRun.row.resume_point, null, 'resume point cleared on completion');
});

test('resume() refuses a v1 resume point', async () => {
  const dir = gitDir('v1rp');
  const orch = createOrchestrator({
    projectDir: dir, claude: { mock: true }, auto: true,
    resume: { row: { id: 'x', status: 'paused' }, resumePoint: { version: 1 }, steps: [] },
  });
  await assert.rejects(() => orch.resume(), /unsupported resume point version 1/);
});

test('resume() refuses a non-paused pipeline', async () => {
  const dir = gitDir('nonpaused');
  const orch = createOrchestrator({
    projectDir: dir, claude: { mock: true }, auto: true,
    resume: { row: { id: 'x', status: 'done' }, resumePoint: { version: 2 }, steps: [] },
  });
  await assert.rejects(() => orch.resume(), /not resumable/);
});

// ── 3. the exhausted-budget gate ──────────────────────────────────────────────

test('an exhausted loop budget gates the user; continue force-fires the clean side', async () => {
  const dir = gitDir('gate');
  // maxCycles 1 exhausts the review->fix budget on the FIRST blocking delivery.
  const template = structuredClone(GRAPH_DEFAULT_WORKFLOW);
  template.id = 'wf_gate_once';
  template.name = 'Gate Once';
  for (const w of template.wires) if (w.config?.maxCycles) w.config.maxCycles = 1;
  await writeWorkflow(template);

  const orch = createOrchestrator({
    projectDir: dir, prompt: 'demo', auto: true, claude: { mock: true }, workflowId: template.id,
  });
  const t = trace(orch);
  const res = await orch.run();
  assert.equal(res.status, 'done');

  const gates = t.questions.filter((q) => q.kind === 'gate');
  assert.ok(gates.length >= 1, 'at least one gate was raised');
  for (const g of gates) assert.ok(g.wireId, 'a gate question names its wire');
  // Auto-mode answers `continue`, which force-fires the clean side -> End.
  assert.equal(res.endReached, true);
  const impl = started(t.execs).filter((e) => e.agentKey === 'implementer');
  assert.equal(impl.length, 1, 'the budget was 1, so the implementer never got a fix pass');
});

// ── 4. run-time validateGraph abort ───────────────────────────────────────────

test('a saved template referencing a renamed port aborts the run with a clean error', async () => {
  const dir = gitDir('badport');
  const template = structuredClone(GRAPH_DEFAULT_WORKFLOW);
  template.id = 'wf_bad_port';
  template.name = 'Bad Port';
  // `n_plan.answers` was renamed away under this template's feet.
  template.wires.find((w) => w.id === 'w3').to.port = 'gone';
  await writeWorkflow(template);

  const orch = createOrchestrator({
    projectDir: dir, prompt: 'demo', auto: true, claude: { mock: true }, workflowId: template.id,
  });
  const errors = [];
  orch.on('error', (e) => errors.push(e));
  const res = await orch.run();
  assert.equal(res.status, 'error');
  assert.match(res.error, /workflow "wf_bad_port" is not runnable/i);
  assert.match(res.error, /V5/, 'the failing rule is named');
  assert.equal(errors.length, 1);
});

// ── 5. quiescence without End ─────────────────────────────────────────────────

/**
 * "Reviewer scripted clean" is unbuildable in mock (every mock verifier blocks at
 * cycle 1 by construction), so the quiescence case is built the other way: the
 * reviewer's `pass` is the ONLY thing wired into End, and the reviewer blocks. Its
 * `review` feeds a producer whose own output is unwired, so the run drains and goes
 * quiet with End unbound.
 */
const QUIESCENT = {
  id: 'wf_quiescent',
  name: 'Quiescent',
  version: 2,
  domain: 'coding',
  nodes: [
    { id: 'n_task', kind: 'task', x: 40, y: 200, config: {} },
    { id: 'n_review', kind: 'agent', key: 'reviewer', x: 320, y: 200, config: {} },
    { id: 'n_x', kind: 'agent', key: 'manualTestsChecklist', x: 600, y: 200, config: {} },
    { id: 'n_end', kind: 'end', x: 880, y: 200, config: {} },
  ],
  wires: [
    { id: 'w1', from: { node: 'n_task', port: 'task' }, to: { node: 'n_review', port: 'plan' } },
    { id: 'w2', from: { node: 'n_review', port: 'review' }, to: { node: 'n_x', port: 'plan' } },
    { id: 'w3', from: { node: 'n_review', port: 'pass' }, to: { node: 'n_end', port: 'result' } },
  ],
};

test('a run that goes quiet without reaching End warns and reports endReached false', async () => {
  const dir = gitDir('quiesce');
  await writeWorkflow(structuredClone(QUIESCENT));

  const orch = createOrchestrator({
    projectDir: dir, prompt: 'demo', auto: true, claude: { mock: true }, workflowId: QUIESCENT.id,
  });
  const t = trace(orch);
  const res = await orch.run();

  assert.equal(res.status, 'done', 'quiescence still resolves the run');
  assert.equal(res.endReached, false);
  assert.equal(res.result, null);

  const rows = started(t.execs);
  assert.ok(!rows.some((e) => e.nodeId === 'n_end'), 'End never executed');
  assert.equal(rows.filter((e) => e.nodeId === 'n_x').length, 1, 'the producer ran once');

  const warning = 'finished at quiescence — End not reached';
  assert.ok(
    t.logs.some((l) => l.level === 'warn' && l.text.includes(warning)),
    'the exact warning string is logged at run level',
  );
  assert.ok(
    (orch.state.warnings || []).some((w) => String(w).includes(warning)),
    'and is surfaced in state for the run monitor',
  );
});
