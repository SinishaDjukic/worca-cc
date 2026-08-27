// test/orchestrator-graph.test.mjs
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { useTempHome } from './helpers/temp-home.mjs';
import { gitDir } from './helpers/git-dir.mjs';
import { createGraphOrchestrator } from '../src/core/graph/orchestrator.mjs';

useTempHome(after);

test('the graph default runs end to end under mock and reaches the End card', { timeout: 120000 }, async () => {
  const dir = gitDir();
  const orch = createGraphOrchestrator({
    projectDir: dir, workflowId: 'wf_default_v2', prompt: 'demo task',
    claude: { mock: true }, auto: true,
  });
  const execs = [];
  orch.on('exec', (e) => execs.push(e));

  const res = await orch.run();
  assert.equal(res.status, 'done', res.error);

  const st = orch.getState();
  assert.equal(st.engine, 2);
  assert.equal(st.endReached, true, 'the End card was bound');
  assert.ok(st.result, 'state.result carries the End payload');
  assert.deepEqual(st.warnings, []);
  // Every ledger row is keyed by its executionId (bookends aside).
  const rows = st.steps.filter((x) => String(x.key).startsWith('x:'));
  assert.ok(rows.length > 0);
  for (const s of rows) {
    assert.equal(s.key, s.executionId);
    assert.ok(/^x:[A-Za-z0-9_-]+:\d+(:[A-Za-z0-9_-]+)?$/.test(s.key), `bad executionId ${s.key}`);
    assert.equal(s.stepIndex, null);
    assert.ok(['done', 'error', 'paused', 'stopped'].includes(s.status), `${s.key} ended ${s.status}`);
  }
  // The agent nodes all ran (clarify, planner, refiner x2, implementer x2, reviewer x2).
  const started = execs.filter((e) => e.status === 'start' && e.agentKey);
  assert.ok(started.length >= 8, `expected >= 8 agent executions, got ${started.length}`);
  assert.equal(orch.getState().status, 'done');
});
