// test/engine-select.test.mjs
// One engine remains, so there is nothing left to SELECT: the module's whole
// job is refusing a resume that was frozen by the retired v1 engine.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { useTempHome } from './helpers/temp-home.mjs';
import { createOrchestratorFor, EngineRetiredError } from '../src/core/engine-select.mjs';
import { V1_RUN_RETIRED } from '../src/core/db.mjs';

useTempHome(after);

test('selectEngine is gone — there is no second engine to select', async () => {
  const m = await import('../src/core/engine-select.mjs');
  assert.equal(m.selectEngine, undefined);
});

test('createOrchestratorFor: async, and builds the graph orchestrator from a workflow id', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'worca-engine-select-'));
  const p = createOrchestratorFor({ projectDir: dir, workflowId: 'wf_default', prompt: 'x' });
  assert.ok(p instanceof Promise, 'createOrchestratorFor is async — every call site awaits it');
  const orch = await p;
  assert.equal(typeof orch._dispatch, 'undefined', 'the v1 dispatcher is gone');
  assert.equal(typeof orch._execute, 'function', 'the graph engine\'s per-execution adapter');
  assert.equal(orch.workflowId, 'wf_default');
  assert.equal(orch.engine, 'graph');
});

test('createOrchestratorFor: an unknown workflow id still builds (the row read happens at run())', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'worca-engine-select-'));
  const orch = await createOrchestratorFor({ projectDir: dir, workflowId: 'wf_nope', prompt: 'x' });
  assert.equal(orch.engine, 'graph');
});

test('createOrchestratorFor: a v2 resume point builds the graph engine', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'worca-engine-select-'));
  const orch = await createOrchestratorFor({
    projectDir: dir, workflowId: 'wf_default',
    resume: { row: {}, resumePoint: { version: 2 }, steps: [] },
  });
  assert.equal(orch.getState().engine, 2);
  assert.equal(orch.engine, 'graph');
});

test('createOrchestratorFor REFUSES a v1 (or unversioned) resume point', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'worca-engine-select-'));
  for (const version of [1, '1', null]) {
    await assert.rejects(
      () => createOrchestratorFor({ projectDir: dir, workflowId: 'wf_default', resume: { row: {}, resumePoint: { version }, steps: [] } }),
      (err) => {
        assert.ok(err instanceof EngineRetiredError);
        assert.equal(err.code, 'ENGINE_RETIRED');
        assert.equal(err.status, 409);
        assert.equal(err.message, V1_RUN_RETIRED);
        return true;
      },
      `resumePoint.version=${JSON.stringify(version)} must be refused`,
    );
  }
});
