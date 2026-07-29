// test/clarify-node.test.mjs
// Clarify is its own graph node (s_clarify) that runs BEFORE the planner. It records
// its own state.steps row, writes clarify.json (scratch) + the DB answers row, and a
// workflow WITHOUT a clarify node still plans (the planner's clarify consume is optional).
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

test('clarify runs as its own node (s_clarify) and the planner is a separate row', async () => {
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
  const clarify = st.steps.find((s) => s.nodeId === 's_clarify');
  assert.ok(clarify, 'a clarify node step exists');
  assert.equal(clarify.phase, 'clarify');
  assert.equal(clarify.key, '0:s_clarify', 'clarify is step 0');

  const plan = st.steps.find((s) => s.nodeId === 's0_0');
  assert.ok(plan, 'the planner node step exists');
  assert.equal(plan.key, '1:s0_0', 'planner shifted to step 1 (nodeId unchanged)');
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
    name: 'NoClarify',
    steps: [[{ id: 's0_0', key: 'planner' }], [{ id: 's1_0', key: 'implementer' }]],
    feedbacks: [],
  });
  const orch = createOrchestrator({ projectDir: await makeTmpDir(), workflowId: tpl.id, prompt: 'demo', auto: true, claude: { mock: true } });
  const res = await orch.run();
  assert.equal(res.status, 'done');
  const st = orch.getState();
  assert.equal(st.steps.find((s) => s.phase === 'clarify'), undefined, 'no clarify step');
  assert.ok(st.steps.find((s) => s.nodeId === 's0_0'), 'planner still ran');
});
