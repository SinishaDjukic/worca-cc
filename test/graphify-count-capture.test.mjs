// test/graphify-count-capture.test.mjs  (harness copied from skill-capture.test.mjs)
// Counts how many times an agent/sub-agent INVOKES the `graphify` CLI via the Bash
// tool. Bash-only by design: the graphify skill itself runs the CLI, so counting the
// Skill tool too would double-count; the bash invocation is the ground truth and also
// catches direct CLI use with no skill.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createOrchestrator } from '../src/core/orchestrator.mjs';

const ATTR = { nodeId: 'n1', stepIndex: 2, cycle: 1, stepKey: '2:n1' };
const mainTurn = (blocks) => ({ type: 'assistant', raw: { type: 'assistant', message: { content: blocks } } });
const subTurn = (parentId, blocks) => ({
  type: 'assistant',
  raw: { type: 'assistant', parent_tool_use_id: parentId, message: { content: blocks } },
});
const spawn = (id, name = 'Agent', description = 'area A') => mainTurn([{ type: 'tool_use', id, name, input: { description } }]);
const bash = (command, id = 'b') => mainTurn([{ type: 'tool_use', id, name: 'Bash', input: { command } }]);

function orchWithStep() {
  const orch = createOrchestrator({ projectDir: '/tmp/proj' });
  orch.state.steps.push({ key: ATTR.stepKey, nodeId: ATTR.nodeId, cycle: ATTR.cycle, status: 'running' });
  return orch;
}

test('a main-agent `graphify` bash call increments step.graphifyCount + emits stepgraphify', () => {
  const orch = orchWithStep();
  const deltas = [];
  orch.on('stepgraphify', (d) => deltas.push(d));
  orch._onAgentEvent('planner', bash('graphify query "auth flow"'), ATTR);
  assert.equal(orch.state.steps[0].graphifyCount, 1);
  assert.equal(deltas.length, 1);
  assert.equal(deltas[0].graphifyCount, 1);
  assert.equal(deltas[0].nodeId, 'n1');
  assert.equal(deltas[0].cycle, 1);
});

test('two graphify bash blocks in one turn count as 2 (parallel tool calls)', () => {
  const orch = orchWithStep();
  orch._onAgentEvent('planner', mainTurn([
    { type: 'tool_use', id: 'b1', name: 'Bash', input: { command: 'graphify update .' } },
    { type: 'tool_use', id: 'b2', name: 'Bash', input: { command: 'graphify query "x"' } },
  ]), ATTR);
  assert.equal(orch.state.steps[0].graphifyCount, 2);
});

test('two graphify invocations chained in ONE command count as 2', () => {
  const orch = orchWithStep();
  orch._onAgentEvent('planner', bash('graphify update . && graphify query "x"'), ATTR);
  assert.equal(orch.state.steps[0].graphifyCount, 2);
});

test('count accumulates across turns', () => {
  const orch = orchWithStep();
  orch._onAgentEvent('planner', bash('graphify query "a"', 'b1'), ATTR);
  orch._onAgentEvent('planner', bash('graphify query "b"', 'b2'), ATTR);
  assert.equal(orch.state.steps[0].graphifyCount, 2);
});

test('bash that only MENTIONS graphify (not invokes it) does NOT count', () => {
  const orch = orchWithStep();
  let emits = 0;
  orch.on('stepgraphify', () => { emits += 1; });
  orch._onAgentEvent('planner', mainTurn([
    { type: 'tool_use', id: 'c1', name: 'Bash', input: { command: 'cat graphify-out/graph.json' } },
    { type: 'tool_use', id: 'c2', name: 'Bash', input: { command: 'grep graphify notes.txt' } },
    { type: 'tool_use', id: 'c3', name: 'Bash', input: { command: 'rm -rf graphify-out' } },
    { type: 'tool_use', id: 'c4', name: 'Bash', input: { command: 'echo graphify' } },
    { type: 'tool_use', id: 'c5', name: 'Bash', input: { command: 'ls graphify-out/' } },
  ]), ATTR);
  assert.equal(orch.state.steps[0].graphifyCount, undefined);
  assert.equal(emits, 0);
});

test('a path-prefixed graphify binary still counts', () => {
  const orch = orchWithStep();
  orch._onAgentEvent('planner', bash('~/.local/bin/graphify query "x"'), ATTR);
  assert.equal(orch.state.steps[0].graphifyCount, 1);
});

test('graphify after a leading env assignment counts; the bare binary counts', () => {
  const orch = orchWithStep();
  orch._onAgentEvent('planner', bash('GRAPHIFY_CACHE=1 graphify update .', 'e1'), ATTR);
  orch._onAgentEvent('planner', bash('graphify', 'e2'), ATTR);
  assert.equal(orch.state.steps[0].graphifyCount, 2);
});

test('the Skill tool (skill=graphify) does NOT count — bash-only by design', () => {
  const orch = orchWithStep();
  let emits = 0;
  orch.on('stepgraphify', () => { emits += 1; });
  orch._onAgentEvent('planner', mainTurn([
    { type: 'tool_use', id: 's', name: 'Skill', input: { skill: 'graphify' } },
  ]), ATTR);
  assert.equal(orch.state.steps[0].graphifyCount, undefined);
  assert.equal(emits, 0);
});

test('sub-agent graphify bash attaches to the spawned record by parent_tool_use_id; delta carries it', () => {
  const orch = orchWithStep();
  const subDeltas = [];
  orch.on('subagent', (d) => subDeltas.push(d));
  orch._onAgentEvent('planner', spawn('sub_1'), ATTR);
  orch._onAgentEvent('planner', subTurn('sub_1', [
    { type: 'tool_use', id: 'g', name: 'Bash', input: { command: 'graphify query "deep"' } },
  ]), ATTR);
  const rec = orch.state.subAgents.find((s) => s.id === 'sub_1');
  assert.equal(rec.graphifyCount, 1);
  const last = subDeltas.at(-1);
  assert.equal(last.transition, 'update');
  assert.equal(last.graphifyCount, 1);
});

test('no graphify usage leaves graphifyCount unset and emits nothing', () => {
  const orch = orchWithStep();
  let emits = 0;
  orch.on('stepgraphify', () => { emits += 1; });
  orch._onAgentEvent('planner', bash('npm test'), ATTR);
  assert.equal(orch.state.steps[0].graphifyCount, undefined);
  assert.equal(emits, 0);
});
