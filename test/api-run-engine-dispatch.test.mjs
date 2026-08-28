// test/api-run-engine-dispatch.test.mjs
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { useTempHome } from './helpers/temp-home.mjs';
import { createOrchestratorFor, EngineRetiredError } from '../src/core/engine-select.mjs';
import { GraphOrchestrator } from '../src/core/orchestrator.mjs';

useTempHome(after);

test('every workflow id dispatches to the graph engine', async () => {
  const graph = await createOrchestratorFor({ projectDir: process.cwd(), workflowId: 'wf_default', claude: { mock: true } });
  assert.ok(graph instanceof GraphOrchestrator, 'wf_default => GraphOrchestrator');
  assert.equal(graph.getState().engine, 2);
  assert.equal(graph.engine, 'graph');
  assert.equal(graph.workflowId, 'wf_default');
});

test('a v2 resume point dispatches to the graph engine, and an already-read template is a hint only', async () => {
  const o = await createOrchestratorFor({
    projectDir: process.cwd(), claude: { mock: true },
    resume: { row: { id: 'p', status: 'paused' }, resumePoint: { version: 2 }, steps: [] },
  });
  assert.ok(o instanceof GraphOrchestrator);
  const hinted = await createOrchestratorFor({ projectDir: process.cwd(), workflowId: 'wf_whatever', template: { id: 'wf_whatever', version: 2, nodes: [], wires: [] }, claude: { mock: true } });
  assert.ok(hinted instanceof GraphOrchestrator, 'the template hint skips the row read');
  assert.equal(hinted.opts.template, undefined, 'the hint is not an orchestrator option');
});

test('a v1 resume point is refused with a 409, not silently re-run on the graph engine', async () => {
  await assert.rejects(
    () => createOrchestratorFor({
      projectDir: process.cwd(), claude: { mock: true },
      resume: { row: { id: 'p', status: 'paused' }, resumePoint: { version: 1, kind: 'node' }, steps: [] },
    }),
    EngineRetiredError,
  );
});
