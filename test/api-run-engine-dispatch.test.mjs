// test/api-run-engine-dispatch.test.mjs
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { useTempHome } from './helpers/temp-home.mjs';
import { createOrchestratorFor, selectEngine } from '../src/core/engine-select.mjs';
import { GraphOrchestrator } from '../src/core/graph/orchestrator.mjs';

useTempHome(after);

test('selectEngine prefers the resume point, then the template version', () => {
  assert.equal(selectEngine({ templateVersion: 1, resumePointVersion: 2 }), 'graph');
  assert.equal(selectEngine({ templateVersion: 2, resumePointVersion: 1 }), 'v1');
  assert.equal(selectEngine({ templateVersion: 2 }), 'graph');
  assert.equal(selectEngine({ templateVersion: 1 }), 'v1');
  assert.equal(selectEngine({}), 'v1', 'unknown => the live engine');
});

test('createOrchestratorFor dispatches a v2 workflow id to the graph engine', async () => {
  const graph = await createOrchestratorFor({ projectDir: process.cwd(), workflowId: 'wf_default_v2', claude: { mock: true } });
  assert.ok(graph instanceof GraphOrchestrator, 'wf_default_v2 => GraphOrchestrator');
  assert.equal(graph.getState().engine, 2);
  assert.equal(graph.engine, 'graph');
  assert.equal(graph.workflowId, 'wf_default_v2');

  const v1 = await createOrchestratorFor({ projectDir: process.cwd(), workflowId: 'wf_default', claude: { mock: true } });
  assert.ok(!(v1 instanceof GraphOrchestrator), 'wf_default => the v1 Orchestrator');
  assert.equal(v1.getState().engine, undefined);
  assert.equal(v1.engine, 'v1');
});

test('createOrchestratorFor dispatches a v2 resume point to the graph engine, and honours an already-read template', async () => {
  const o = await createOrchestratorFor({
    projectDir: process.cwd(), claude: { mock: true },
    resume: { row: { id: 'p', status: 'paused' }, resumePoint: { version: 2 }, steps: [] },
  });
  assert.ok(o instanceof GraphOrchestrator);
  const hinted = await createOrchestratorFor({ projectDir: process.cwd(), workflowId: 'wf_whatever', template: { id: 'wf_whatever', version: 2, nodes: [], wires: [] }, claude: { mock: true } });
  assert.ok(hinted instanceof GraphOrchestrator, 'the template hint skips the row read');
  assert.equal(hinted.opts.template, undefined, 'the hint is not an orchestrator option');
});
