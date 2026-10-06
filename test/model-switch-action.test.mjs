// test/model-switch-action.test.mjs
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { useTempHome } from './helpers/temp-home.mjs';
import { gitDir } from './helpers/git-dir.mjs';
import { seedPipeline } from './helpers/db-seed.mjs';
import { graphResumePoint } from './helpers/graph-templates.mjs';
import { readPipelineForResume } from '../src/core/artifacts.mjs';
import { switchPausedRunModels, describeModelSwitch } from '../src/core/model-switch.mjs';

useTempHome(after);

async function paused(name, { status = 'paused', steps = [] } = {}) {
  const dir = gitDir(name);
  const rp = graphResumePoint({ pipelineDir: dir, pausedBy: 'tok-1' });
  const { id } = await seedPipeline(dir, { status, stepper: rp.manifest, resumePoint: rp, steps });
  return { dir, id, projectDirFor: () => dir };
}
const STEPS = [
  { key: 'x:n_clarify:1', executionId: 'x:n_clarify:1', nodeId: 'n_clarify', status: 'done' },
  { key: 'x:n_plan:1', executionId: 'x:n_plan:1', nodeId: 'n_plan', status: 'paused', sessionId: 'sess-plan' },
];

test('switching the paused stage rewrites both copies, marks it fresh and hands the row off', async () => {
  const { id, projectDirFor } = await paused('msw-ok', { steps: STEPS });
  const out = await switchPausedRunModels(id, {
    changes: { n_plan: { model: 'claude-opus-5-5', effort: 'high', subagentModel: 'opus', subagentEffort: 'medium' } },
    by: 'tester', projectDirFor,
  });
  assert.deepEqual(out.changed.map((c) => c.nodeId), ['n_plan']);
  const saved = readPipelineForResume(id);
  const cell = saved.resumePoint.manifest.graph.nodes.find((n) => n.id === 'n_plan');
  assert.deepEqual([cell.model, cell.effort, cell.subagentModel, cell.subagentEffort], ['claude-opus-5-5', 'high', 'opus', 'medium']);
  assert.equal(JSON.parse(saved.row.stepper).graph.nodes.find((n) => n.id === 'n_plan').model, 'claude-opus-5-5');
  assert.deepEqual(saved.resumePoint.freshSessionNodes, ['n_plan']);
  assert.match(saved.resumePoint.pausedBy, /^switch:/);
});

test('an effort-only change keeps the session re-attach (no fresh marker)', async () => {
  const { id, projectDirFor } = await paused('msw-effort', { steps: STEPS });
  await switchPausedRunModels(id, { changes: { n_plan: { subagentEffort: 'high' } }, projectDirFor });
  assert.equal(readPipelineForResume(id).resumePoint.freshSessionNodes, undefined);
});

test('refusals: completed stage, unknown stage, bad field, not paused', async () => {
  const { id, projectDirFor } = await paused('msw-refuse', { steps: STEPS });
  await assert.rejects(switchPausedRunModels(id, { changes: { n_clarify: { model: 'claude-opus-5-5' } }, projectDirFor }),
    (e) => e.code === 'STAGE_COMPLETED' && e.status === 409);
  await assert.rejects(switchPausedRunModels(id, { changes: { n_nope: { model: 'claude-opus-5-5' } }, projectDirFor }),
    (e) => e.code === 'UNKNOWN_STAGE' && e.status === 400);
  await assert.rejects(switchPausedRunModels(id, { changes: { n_plan: { fanOut: true } }, projectDirFor }),
    (e) => e.code === 'BAD_FIELD');
  const other = await paused('msw-int', { status: 'interrupted' });
  await assert.rejects(switchPausedRunModels(other.id, { changes: { n_plan: { model: 'claude-opus-5-5' } }, projectDirFor: other.projectDirFor }),
    (e) => e.code === 'NOT_PAUSED');
});

test('describeModelSwitch returns stages + the run project catalog', async () => {
  const { id, projectDirFor } = await paused('msw-desc', { steps: STEPS });
  const d = await describeModelSwitch(id, { projectDirFor });
  assert.equal(d.pipelineId, id);
  assert.ok(d.models.some((m) => m.id === 'claude-opus-5-5'));
  assert.deepEqual(d.efforts, ['medium', 'high', 'xhigh', 'max']);
  assert.equal(d.stages.find((s) => s.nodeId === 'n_plan').state, 'paused');
});
