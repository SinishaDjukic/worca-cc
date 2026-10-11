// test/subagent-backstop.test.mjs — execution-boundary force-close of still-running subs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createOrchestrator } from '../src/core/orchestrator.mjs';
import { checkRows } from './helpers/rows.mjs';

// The graph engine's ledger row is keyed by executionId: attr.stepKey IS the
// executionId (orchestrator.mjs `_execCtx`), and `_execStep(ctx, mark)` is the
// v1 `_nodeStep(node, stepIndex, cycle, mark)` re-keyed onto executions.
const execCtx = (nodeId, ordinal = 1, key = 'planner') => ({
  executionId: `x:${nodeId}:${ordinal}`, nodeId, ordinal, uiPhase: 'plan', node: { id: nodeId, key },
});
const NODE = execCtx('n1');
const spawnEvt = (id) => ({
  type: 'assistant',
  raw: { type: 'assistant', message: { content: [
    { type: 'tool_use', id, name: 'Agent', input: { description: 'd' } },
  ] } },
});

function withSpawn(status) {
  const orch = createOrchestrator({ projectDir: '/tmp/proj' });
  const stepKey = NODE.executionId; // "x:n1:1"
  orch._onAgentEvent('planner', spawnEvt('toolu_A'),
    { nodeId: 'n1', stepIndex: null, cycle: 1, stepKey });
  if (status) orch.state.status = status; // simulate a stopped/errored run
  return orch;
}

test("a node's 'done' marker force-closes its still-running subs to finished (stopped when the run is stopped) and emits a finish delta for each", async () => {
  const orch = withSpawn();
  const evts = [];
  orch.on('subagent', (m) => evts.push(m));
  orch._execStep(NODE, 'done');
  await checkRows([
    { name: "a node's 'done' marker force-closes its still-running subs to finished", run: () => {
      assert.equal(orch.state.subAgents.find((s) => s.id === 'toolu_A').status, 'finished');
    } },
    { name: 'the backstop emits a finish delta for each forced sub-agent', run: () => {
      const fin = evts.find((m) => m.transition === 'finish' && m.id === 'toolu_A');
      assert.ok(fin, 'a finish delta fires for the forced sub-agent');
      assert.equal(fin.status, 'finished');
    } },
    { name: "when the run is stopped, the backstop closes them as 'stopped'", run: () => {
      const stopped = withSpawn('stopped');
      stopped._execStep(NODE, 'done');
      assert.equal(stopped.state.subAgents.find((s) => s.id === 'toolu_A').status, 'stopped');
    } },
  ]);
});

test('the backstop only touches THIS step’s subs and never re-closes a terminal one', () => {
  const orch = createOrchestrator({ projectDir: '/tmp/proj' });
  // Two subs on two different steps; close only step 0:n1.
  orch._onAgentEvent('planner', spawnEvt('toolu_A'), { nodeId: 'n1', stepIndex: null, cycle: 1, stepKey: 'x:n1:1' });
  orch._onAgentEvent('planner', spawnEvt('toolu_B'), { nodeId: 'n2', stepIndex: null, cycle: 1, stepKey: 'x:n2:1' });
  const evts = [];
  orch.on('subagent', (m) => evts.push(m));
  orch._execStep(NODE, 'done'); // executionId "x:n1:1"
  assert.equal(orch.state.subAgents.find((s) => s.id === 'toolu_A').status, 'finished');
  assert.equal(orch.state.subAgents.find((s) => s.id === 'toolu_B').status, 'running', 'other step untouched');
  // 'start' must never close anything.
  orch._execStep(execCtx('n2', 1, 'x'), 'start');
  assert.equal(orch.state.subAgents.find((s) => s.id === 'toolu_B').status, 'running');
  assert.equal(evts.filter((m) => m.transition === 'finish').length, 1, 'exactly one forced finish');
});

test("an execution's terminal marker drops its legacy-envelope normalizer; a start keeps it", () => {
  const orch = createOrchestrator({ projectDir: '/tmp/proj' });
  const attr = (ctx) => ({ nodeId: ctx.nodeId, stepIndex: null, cycle: 1, stepKey: ctx.executionId, executionId: ctx.executionId });
  const other = execCtx('n2');
  orch._onAgentEvent('planner', spawnEvt('toolu_A'), attr(NODE));
  orch._onAgentEvent('planner', spawnEvt('toolu_B'), attr(other));
  orch._execStep(NODE, 'start');
  assert.deepEqual([...orch._legacyNormalizers.keys()], [NODE.executionId, other.executionId]);
  orch._execStep(NODE, 'done');
  assert.deepEqual([...orch._legacyNormalizers.keys()], [other.executionId], 'only the finished execution is pruned');
});
