// test/engine-select.test.mjs
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { useTempHome } from './helpers/temp-home.mjs';
import { selectEngine, createOrchestratorFor } from '../src/core/engine-select.mjs';

useTempHome(after);

test('selectEngine: version 2 picks the graph engine, everything else v1', () => {
  assert.equal(selectEngine({ templateVersion: 2 }), 'graph');
  assert.equal(selectEngine({ templateVersion: '2' }), 'graph');
  assert.equal(selectEngine({ templateVersion: 1 }), 'v1');
  assert.equal(selectEngine({ templateVersion: undefined }), 'v1');
  assert.equal(selectEngine({}), 'v1');
  assert.equal(selectEngine(), 'v1');
  assert.equal(selectEngine({ templateVersion: 'two' }), 'v1');
});

test('selectEngine: the resume point wins over the template row', () => {
  assert.equal(selectEngine({ templateVersion: 2, resumePointVersion: 1 }), 'v1');
  assert.equal(selectEngine({ templateVersion: 1, resumePointVersion: 2 }), 'graph');
  assert.equal(selectEngine({ templateVersion: 2, resumePointVersion: null }), 'graph');
});

test('createOrchestratorFor: async, and builds the v1 orchestrator from a workflow id', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'worca-engine-select-'));
  const p = createOrchestratorFor({ projectDir: dir, workflowId: 'wf_default_v1', prompt: 'x' });
  assert.ok(p instanceof Promise, 'createOrchestratorFor is async — every call site awaits it');
  const orch = await p;
  assert.equal(typeof orch._dispatch, 'function', 'v1 orchestrator (the v1-only dispatcher is present)');
  assert.equal(orch.workflowId, 'wf_default_v1');
  assert.equal(orch.engine, 'v1', 'the factory records the selector\'s answer for the row it read');
});

test('createOrchestratorFor: an unknown workflow id still yields the v1 orchestrator (no throw)', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'worca-engine-select-'));
  const orch = await createOrchestratorFor({ projectDir: dir, workflowId: 'wf_nope', prompt: 'x' });
  assert.equal(typeof orch._dispatch, 'function');
});

test('createOrchestratorFor: a v2 resume point builds the graph engine', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'worca-engine-select-'));
  assert.equal(selectEngine({ resumePointVersion: 2 }), 'graph');
  const orch = await createOrchestratorFor({
    projectDir: dir, workflowId: 'wf_default',
    resume: { row: {}, resumePoint: { version: 2 }, steps: [] },
  });
  assert.equal(typeof orch._dispatch, 'undefined', 'the graph engine has no v1 dispatcher');
  assert.equal(orch.getState().engine, 2);
  assert.equal(orch.engine, 'graph', 'the factory consulted the resume point, not just the row');
});
