// test/artifacts-exec-ledger.test.mjs
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeState, createPipeline, readPipeline, readPipelineForResume } from '../src/core/artifacts.mjs';
import { useTempHome } from './helpers/temp-home.mjs';

useTempHome(after);

test('the execution ledger round-trips through pipeline_steps + pipelines.outcome', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'worca-cc-ledger-'));
  const p = await createPipeline(dir, { promptText: 'x', sourceType: 'prompt' });
  const live = {
    id: p.id, projectDir: dir, status: 'done', phase: 'implement', cycle: 2,
    engine: 2, endReached: true, result: { type: 'md', path: '/tmp/plan.md' },
    warnings: ['w1'], wireDeliveries: { w9: 2 },
    tokens: { 'n_impl.done': { seq: 7, type: 'void', path: null, firedAt: 't' } },
    steps: [{
      key: 'x:n_impl:2', executionId: 'x:n_impl:2', nodeId: 'n_impl', kind: 'cycle',
      ordinal: 2, cycle: 2, agentKey: 'implementer', phase: 'implementer', stepIndex: null,
      status: 'done', startedAt: 'a', updatedAt: 'b', endedAt: 'c', activeMs: 10,
      runningSince: null, costUsd: 0.5, trigger: { wireIds: ['w9'], freshPorts: ['fix'] },
      result: null,
    }, {
      key: 'x:n_impl:2:p1t1', executionId: 'x:n_impl:2:p1t1', nodeId: 'n_impl', kind: 'task',
      ordinal: 2, cycle: 2, agentKey: 'implementer', phase: 'implementer', stepIndex: null,
      status: 'done', activeMs: 3, runningSince: null, costUsd: 0.1,
      trigger: { wireIds: [], freshPorts: [] },
      taskId: 't1', parentExecutionId: 'x:n_impl:2', title: 'Add schema', phaseOrdinal: 1, taskIndex: 1, taskTotal: 2,
    }],
    subAgents: [],
  };
  await writeState(p.dir, live);

  // The History reader (rowToState) and the resume reader (stepRowToStep) must agree.
  const { state } = await readPipeline(dir, p.id);
  const row = state.steps.find((r) => r.key === 'x:n_impl:2');
  assert.equal(row.executionId, 'x:n_impl:2');
  assert.equal(row.kind, 'cycle');
  assert.equal(row.ordinal, 2);
  assert.equal(row.agentKey, 'implementer');
  assert.equal(row.endedAt, 'c');
  assert.deepEqual(row.trigger, { wireIds: ['w9'], freshPorts: ['fix'] });
  assert.equal(row.stepIndex, undefined, 'v2 rows carry no stepIndex');
  const slice = state.steps.find((r) => r.key === 'x:n_impl:2:p1t1');
  assert.equal(slice.kind, 'task');
  assert.equal(slice.taskId, 't1');
  assert.equal(slice.parentExecutionId, 'x:n_impl:2');
  assert.equal(slice.title, 'Add schema');
  assert.equal(slice.phaseOrdinal, 1);
  assert.equal(slice.taskIndex, 1);
  assert.equal(slice.taskTotal, 2);
  assert.equal(state.engine, 2);
  assert.equal(state.endReached, true);
  assert.deepEqual(state.result, { type: 'md', path: '/tmp/plan.md' });
  assert.deepEqual(state.warnings, ['w1']);
  assert.deepEqual(state.wireDeliveries, { w9: 2 });
  assert.deepEqual(state.tokens, { 'n_impl.done': { seq: 7, type: 'void', path: null, firedAt: 't' } });
  assert.deepEqual(state.active, []);
  assert.equal(state.gate, null);
  const saved = readPipelineForResume(p.id);
  assert.equal(saved.steps.find((r) => r.key === 'x:n_impl:2').executionId, 'x:n_impl:2');
});

test('a v1 pipeline row is untouched: no outcome, no exec fields', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'worca-cc-ledger-v1-'));
  const p = await createPipeline(dir, { promptText: 'x', sourceType: 'prompt' });
  await writeState(p.dir, { id: p.id, projectDir: dir, status: 'done', phase: 'done', cycle: 0,
    steps: [{ key: '0:s0_0', nodeId: 's0_0', phase: 'planner', stepIndex: 0, cycle: 1, status: 'done', activeMs: 1, runningSince: null }], subAgents: [] });
  const { state } = await readPipeline(dir, p.id);
  assert.equal(state.engine, undefined);
  assert.equal(state.endReached, undefined);
  assert.equal(state.steps[0].executionId, undefined);
  assert.equal(state.steps[0].kind, undefined);
  assert.equal(state.steps[0].stepIndex, 0);
});
