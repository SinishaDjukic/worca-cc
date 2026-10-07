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
    (e) => e.code === 'STAGE_COMPLETED' && e.status === 409 && /already completed and cannot run again/.test(e.message));
  await assert.rejects(switchPausedRunModels(id, { changes: { n_nope: { model: 'claude-opus-5-5' } }, projectDirFor }),
    (e) => e.code === 'UNKNOWN_STAGE' && e.status === 400);
  await assert.rejects(switchPausedRunModels(id, { changes: { n_plan: { fanOut: true } }, projectDirFor }),
    (e) => e.code === 'BAD_FIELD');
  const other = await paused('msw-int', { status: 'interrupted' });
  await assert.rejects(switchPausedRunModels(other.id, { changes: { n_plan: { model: 'claude-opus-5-5' } }, projectDirFor: other.projectDirFor }),
    (e) => e.code === 'NOT_SWITCHABLE_STATUS' && e.status === 409);
});

test('describeModelSwitch returns stages + the run project catalog', async () => {
  const { id, projectDirFor } = await paused('msw-desc', { steps: STEPS });
  const d = await describeModelSwitch(id, { projectDirFor });
  assert.equal(d.pipelineId, id);
  assert.ok(d.models.some((m) => m.id === 'claude-opus-5-5'));
  assert.deepEqual(d.efforts, ['medium', 'high', 'xhigh', 'max']);
  assert.equal(d.stages.find((s) => s.nodeId === 'n_plan').state, 'paused');
});

test('the widened rule: a paused run\'s loop stage that already ran is switchable', async () => {
  const steps = [...STEPS.map((s) => ({ ...s, status: 'done' })),
    { key: 'x:n_refine:1', executionId: 'x:n_refine:1', nodeId: 'n_refine', status: 'done' },
    { key: 'x:n_impl:1', executionId: 'x:n_impl:1', nodeId: 'n_impl', status: 'done' },
    { key: 'x:n_review:1', executionId: 'x:n_review:1', nodeId: 'n_review', status: 'done' },
    { key: 'x:n_impl:2', executionId: 'x:n_impl:2', nodeId: 'n_impl', status: 'paused', sessionId: 'sess-impl' }];
  const { id, projectDirFor } = await paused('msw-loop', { steps });
  const d = await describeModelSwitch(id, { projectDirFor });
  assert.equal(d.status, 'paused');
  assert.equal(d.stages.find((s) => s.nodeId === 'n_review').state, 'may-rerun');
  const out = await switchPausedRunModels(id, { changes: { n_review: { model: 'claude-opus-5-5' } }, projectDirFor });
  assert.deepEqual(out.changed.map((c) => c.nodeId), ['n_review']);
  await assert.rejects(switchPausedRunModels(id, { changes: { n_plan: { model: 'claude-opus-5-5' } }, projectDirFor }),
    (e) => e.code === 'STAGE_COMPLETED');
});

test('a loop paused at its cycle-cap gate (rp.snapshot.gates) is still going: its stages switch', async () => {
  const steps = [...STEPS.map((s) => ({ ...s, status: 'done' })),
    { key: 'x:n_refine:1', executionId: 'x:n_refine:1', nodeId: 'n_refine', status: 'done' },
    ...[1, 2, 3].flatMap((n) => ['n_impl', 'n_review'].map((nodeId) =>
      ({ key: `x:${nodeId}:${n}`, executionId: `x:${nodeId}:${n}`, nodeId, status: 'done' })))];
  const dir = gitDir('msw-gate');
  const rp = graphResumePoint({ pipelineDir: dir, pausedBy: 'tok-1', snapshot: { gates: [{ wireId: 'w9', askId: 'q1' }] } });
  const { id } = await seedPipeline(dir, { status: 'paused', stepper: rp.manifest, resumePoint: rp, steps });
  const projectDirFor = () => dir;
  const d = await describeModelSwitch(id, { projectDirFor });
  assert.deepEqual(['n_impl', 'n_review', 'n_refine'].map((n) => d.stages.find((s) => s.nodeId === n).state),
    ['may-rerun', 'may-rerun', 'completed']);
  const out = await switchPausedRunModels(id, { changes: { n_impl: { model: 'claude-opus-5-5' } }, projectDirFor });
  assert.deepEqual(out.changed.map((c) => c.nodeId), ['n_impl']);
  assert.equal(out.stages.find((s) => s.nodeId === 'n_review').state, 'may-rerun', 'the reply reads the same hold');
  await assert.rejects(switchPausedRunModels(id, { changes: { n_refine: { model: 'claude-opus-5-5' } }, projectDirFor }),
    (e) => e.code === 'STAGE_COMPLETED');
});

test('a running row driven elsewhere: describe reads the held gate from the row\'s resume point', async () => {
  const steps = [...STEPS.map((s) => ({ ...s, status: 'done' })),
    { key: 'x:n_refine:1', executionId: 'x:n_refine:1', nodeId: 'n_refine', status: 'done' },
    { key: 'x:n_refine:2', executionId: 'x:n_refine:2', nodeId: 'n_refine', status: 'done' },
    { key: 'x:n_refine:3', executionId: 'x:n_refine:3', nodeId: 'n_refine', status: 'done' }];
  const dir = gitDir('msw-gate-run');
  const rp = graphResumePoint({ pipelineDir: dir, snapshot: { gates: [{ wireId: 'w5', askId: 'q1' }] } });
  const { id } = await seedPipeline(dir, { status: 'running', stepper: rp.manifest, resumePoint: rp, steps });
  const d = await describeModelSwitch(id, { projectDirFor: () => dir });
  assert.equal(d.status, 'running');
  assert.deepEqual([d.stages.find((s) => s.nodeId === 'n_refine').state, d.stages.find((s) => s.nodeId === 'n_plan').state],
    ['may-rerun', 'completed']);
});

test('a running row: describe reads it from the store; the paused store edit refuses it as CHANGED', async () => {
  const steps = [STEPS[0], { key: 'x:n_plan:1', executionId: 'x:n_plan:1', nodeId: 'n_plan', status: 'start' }];
  const { id, projectDirFor } = await paused('msw-run', { status: 'running', steps });
  const d = await describeModelSwitch(id, { projectDirFor });
  assert.equal(d.status, 'running'); assert.equal(d.pauseReason, null);
  assert.equal(d.stages.find((s) => s.nodeId === 'n_plan').state, 'running');
  await assert.rejects(switchPausedRunModels(id, { changes: { n_impl: { model: 'claude-opus-5-5' } }, projectDirFor }),
    (e) => e.code === 'CHANGED');
});

test('a row that reads "pausing" is refused as NOT_RUNNING (switch it once paused)', async () => {
  const { id, projectDirFor } = await paused('msw-pausing', { status: 'pausing', steps: STEPS });
  await assert.rejects(describeModelSwitch(id, { projectDirFor }),
    (e) => e.code === 'NOT_RUNNING' && /once it is paused/.test(e.message));
});

test('describe with `live` uses the caller\'s manifest, steps and scheduler view', async () => {
  const { id, projectDirFor } = await paused('msw-live-d', { status: 'running', steps: [] });
  const { manifest } = graphResumePoint({ pipelineDir: 'x' });
  const d = await describeModelSwitch(id, { projectDirFor, live: { manifest, steps: [], active: ['n_clarify'], runDefault: 'claude-opus-5-5' } });
  assert.equal(d.runDefault, 'claude-opus-5-5');
  assert.equal(d.stages.find((s) => s.nodeId === 'n_clarify').state, 'running');
});
