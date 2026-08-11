// test/clarify-node.test.mjs
// Clarify is its own graph node (n_clarify in wf_default) that runs BEFORE the
// planner. It records its own state.steps row keyed by its executionId, writes
// clarify.json (its `answers` output) + the DB answers row, and a graph WITHOUT a
// clarify node still plans (the planner's `answers` input is optional).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createOrchestrator } from '../src/core/orchestrator.mjs';
import { readClarifyRow } from '../src/core/artifacts.mjs';
import { writeWorkflow } from '../src/core/workflows.mjs';
import { useTempHome } from './helpers/temp-home.mjs';

useTempHome(after); // store writes -> isolated temp home

const tmpDirs = [];
async function makeTmpDir() {
  const dir = await mkdtemp(join(tmpdir(), 'worca-cc-clarify-node-'));
  tmpDirs.push(dir);
  return dir;
}
after(async () => { await Promise.all(tmpDirs.map((d) => rm(d, { recursive: true, force: true }))); });

test('clarify runs as its own node (n_clarify) and the planner is a separate row', async () => {
  const orch = createOrchestrator({
    projectDir: await makeTmpDir(),
    workflowId: 'wf_default',
    prompt: 'demo task',
    auto: true,             // auto-answers the clarify gate (orch _ask kind:'clarify')
    claude: { mock: true },
  });
  const res = await orch.run();
  assert.equal(res.status, 'done', 'mock pipeline finishes');

  const st = orch.getState();
  const clarify = st.steps.find((s) => s.nodeId === 'n_clarify');
  assert.ok(clarify, 'a clarify node step exists');
  assert.equal(clarify.phase, 'clarify');
  assert.equal(clarify.key, 'x:n_clarify:1', 'the executionId IS the step key');

  const plan = st.steps.find((s) => s.nodeId === 'n_plan');
  assert.ok(plan, 'the planner node step exists');
  assert.equal(plan.key, 'x:n_plan:1');
  assert.notEqual(plan.nodeId, clarify.nodeId);

  // Totals stay Σ steps (no double-count, no drop) — the structural invariant.
  const sum = (f) => st.steps.reduce((a, s) => a + (Number(s[f]) || 0), 0);
  assert.equal(st.totalActiveMs, sum('activeMs'), 'totalActiveMs === Σ steps.activeMs');
});

test('the default run writes clarify.json (scratch) AND a DB answers row', async () => {
  const projectDir = await makeTmpDir();
  const orch = createOrchestrator({ projectDir, workflowId: 'wf_default', prompt: 'demo task', auto: true, claude: { mock: true } });
  const res = await orch.run();
  assert.equal(res.status, 'done');

  const pipelineDir = orch.pipeline.dir;            // VERIFIED real accessor (orchestrator.mjs)
  const fs = JSON.parse(await readFile(join(pipelineDir, 'clarify.json'), 'utf8'));
  assert.ok(Array.isArray(fs.questions), 'clarify.json has a questions array');

  const row = readClarifyRow(orch.pipeline.id);     // VERIFIED real accessor
  assert.ok(row && row.answers, 'answers persisted to the clarify DB row');
});

test('a workflow WITHOUT a clarify node records no clarify step and still plans', async () => {
  const tpl = await writeWorkflow({
    name: 'NoClarify', version: 2,
    nodes: [
      { id: 'n_task', kind: 'task', x: 0, y: 0 },
      { id: 'n_plan', kind: 'agent', key: 'planner', x: 200, y: 0 },
      { id: 'n_impl', kind: 'agent', key: 'implementer', x: 400, y: 0 },
      { id: 'n_end', kind: 'end', x: 600, y: 0 },
    ],
    wires: [
      { id: 'w1', from: { node: 'n_task', port: 'task' }, to: { node: 'n_plan', port: 'task' } },
      { id: 'w2', from: { node: 'n_plan', port: 'plan' }, to: { node: 'n_impl', port: 'plan' } },
      { id: 'w3', from: { node: 'n_impl', port: 'done' }, to: { node: 'n_end', port: 'result' } },
    ],
  });
  const orch = createOrchestrator({ projectDir: await makeTmpDir(), workflowId: tpl.id, prompt: 'demo', auto: true, claude: { mock: true } });
  const res = await orch.run();
  assert.equal(res.status, 'done');
  const st = orch.getState();
  assert.equal(st.steps.find((s) => s.phase === 'clarify'), undefined, 'no clarify step');
  assert.ok(st.steps.find((s) => s.nodeId === 'n_plan'), 'planner still ran');
});
