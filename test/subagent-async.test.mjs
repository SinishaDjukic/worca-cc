// test/subagent-async.test.mjs — background (async) sub-agent lifecycle.
// Probed (claude 2.1.251, 2026-08-31): a backgrounded Task/Agent's tool_result is
// only a LAUNCH ACK (frame-level tool_use_result {isAsync:true, status:
// 'async_launched'}); the real completion arrives later as a main-stream
// {type:'system', subtype:'task_notification', tool_use_id, status} frame.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createOrchestrator } from '../src/core/orchestrator.mjs';

const ATTR = { nodeId: 'n1', stepIndex: 2, cycle: 1, stepKey: '2:n1' };

const spawnEvt = (id, model) => ({
  type: 'assistant',
  raw: { type: 'assistant', message: { content: [
    { type: 'tool_use', id, name: 'Agent', input: { description: 'verify claims', ...(model ? { model } : {}) } },
  ] } },
});

// Launch ack: tool_use_result sits on the FRAME (top level), not in the block.
const ackEvt = (id, tur = { isAsync: true, status: 'async_launched', agentId: 'a1' }) => ({
  type: 'user',
  raw: { type: 'user', tool_use_result: tur, message: { content: [
    { type: 'tool_result', tool_use_id: id, content: [{ type: 'text', text: 'Async agent launched successfully.' }] },
  ] } },
});

// Background completion frame (system/task_notification). No usage field here —
// the usage-bearing variant is built inline where a test needs it.
const noteEvt = (id, status = 'completed') => ({
  type: 'system',
  raw: { type: 'system', subtype: 'task_notification', task_id: 'a1', tool_use_id: id, status, output_file: '/x', summary: 's' },
});

// Foreground completion: tool_result plus telemetry-bearing tool_use_result.
const syncEvt = (id, tur) => ({
  type: 'user',
  raw: { type: 'user', ...(tur ? { tool_use_result: tur } : {}), message: { content: [
    { type: 'tool_result', tool_use_id: id, content: [{ type: 'text', text: 'report' }] },
  ] } },
});

function fresh() { return createOrchestrator({ projectDir: '/tmp/proj' }); }

test('a launch ack (isAsync:true) leaves the record running with no finishedAt', () => {
  const orch = fresh();
  orch._onAgentEvent('planner', spawnEvt('toolu_A'), ATTR);
  orch._onAgentEvent('planner', ackEvt('toolu_A'));
  const r = orch.state.subAgents.find((s) => s.id === 'toolu_A');
  assert.equal(r.status, 'running');
  assert.equal(r.finishedAt, null);
});

test("a launch ack variant carrying only status:'async_launched' is also skipped", () => {
  const orch = fresh();
  orch._onAgentEvent('planner', spawnEvt('toolu_A'), ATTR);
  orch._onAgentEvent('planner', ackEvt('toolu_A', { status: 'async_launched', agentId: 'a1' }));
  assert.equal(orch.state.subAgents[0].status, 'running');
});

test('a launch ack emits no finish delta', () => {
  const orch = fresh();
  const evts = [];
  orch.on('subagent', (m) => evts.push(m));
  orch._onAgentEvent('planner', spawnEvt('toolu_A'), ATTR);
  orch._onAgentEvent('planner', ackEvt('toolu_A'));
  assert.equal(evts.filter((m) => m.transition === 'finish').length, 0);
});

test('a plain tool_result with NO tool_use_result still finishes (baseline preserved)', () => {
  const orch = fresh();
  orch._onAgentEvent('planner', spawnEvt('toolu_A'), ATTR);
  orch._onAgentEvent('planner', syncEvt('toolu_A'));
  const r = orch.state.subAgents[0];
  assert.equal(r.status, 'finished');
  assert.ok(r.finishedAt, 'finishedAt stamped');
});

test('task_notification (completed) closes the ack’d record with a real finishedAt', () => {
  const orch = fresh();
  const evts = [];
  orch.on('subagent', (m) => evts.push(m));
  orch._onAgentEvent('planner', spawnEvt('toolu_A'), ATTR);
  orch._onAgentEvent('planner', ackEvt('toolu_A'));
  orch._onAgentEvent('planner', noteEvt('toolu_A'));
  const r = orch.state.subAgents.find((s) => s.id === 'toolu_A');
  assert.equal(r.status, 'finished');
  assert.ok(r.finishedAt, 'finishedAt stamped');
  assert.ok(Date.parse(r.finishedAt) >= Date.parse(r.startedAt), 'finish not before start');
  assert.equal(evts.filter((m) => m.transition === 'finish' && m.id === 'toolu_A').length, 1);
});

test("task_notification with a non-'completed' status closes as error", () => {
  const orch = fresh();
  orch._onAgentEvent('planner', spawnEvt('toolu_A'), ATTR);
  orch._onAgentEvent('planner', ackEvt('toolu_A'));
  orch._onAgentEvent('planner', noteEvt('toolu_A', 'failed'));
  assert.equal(orch.state.subAgents[0].status, 'error');
});

test('a repeated task_notification is a no-op (resumable agents may notify twice)', () => {
  const orch = fresh();
  const evts = [];
  orch.on('subagent', (m) => evts.push(m));
  orch._onAgentEvent('planner', spawnEvt('toolu_A'), ATTR);
  orch._onAgentEvent('planner', ackEvt('toolu_A'));
  orch._onAgentEvent('planner', noteEvt('toolu_A'));
  orch._onAgentEvent('planner', noteEvt('toolu_A', 'failed'));
  const r = orch.state.subAgents[0];
  assert.equal(r.status, 'finished', 'terminal status never flips');
  assert.equal(evts.filter((m) => m.transition === 'finish').length, 1, 'one finish delta only');
});

test('task_notification usage fills durationMs/tokens when the CLI sends them', () => {
  // Real shape: test/fixtures/ask/task-subagent.jsonl:41 (2.1.239 capture).
  const orch = fresh();
  orch._onAgentEvent('planner', spawnEvt('toolu_A'), ATTR);
  orch._onAgentEvent('planner', ackEvt('toolu_A'));
  orch._onAgentEvent('planner', { type: 'system', raw: {
    type: 'system', subtype: 'task_notification', task_id: 'a1', tool_use_id: 'toolu_A',
    status: 'completed', summary: 's', usage: { total_tokens: 5266, tool_uses: 1, duration_ms: 2860 },
  } });
  const r = orch.state.subAgents[0];
  assert.equal(r.status, 'finished');
  assert.equal(r.durationMs, 2860);
  assert.equal(r.tokens, 5266);
  assert.equal(r.costUsd ?? null, null, 'no cost figure on the notification — stays hook-gated');
});

test('a usage-less task_notification leaves durationMs null — the timestamp pair carries the duration', () => {
  const orch = fresh();
  orch._onAgentEvent('planner', spawnEvt('toolu_A'), ATTR);
  orch._onAgentEvent('planner', ackEvt('toolu_A'));
  orch._onAgentEvent('planner', noteEvt('toolu_A')); // noteEvt builds no usage field
  const r = orch.state.subAgents[0];
  assert.equal(r.status, 'finished');
  assert.equal(r.durationMs ?? null, null, 'no fabricated figure');
  assert.ok(r.finishedAt, 'hdSubDuration falls back to finishedAt − startedAt (real wall time here)');
});

test('a task_notification for an unknown or absent tool_use_id is ignored, not crashed', () => {
  const orch = fresh();
  orch._onAgentEvent('planner', spawnEvt('toolu_A'), ATTR);
  orch._onAgentEvent('planner', noteEvt('toolu_ZZZ'));               // unknown id
  const bare = { type: 'system', raw: { type: 'system', subtype: 'task_notification', status: 'completed' } };
  orch._onAgentEvent('planner', bare);                               // no tool_use_id
  assert.equal(orch.state.subAgents[0].status, 'running');
});

test('other task system frames (task_started/task_updated) do not touch records', () => {
  const orch = fresh();
  orch._onAgentEvent('planner', spawnEvt('toolu_A'), ATTR);
  orch._onAgentEvent('planner', ackEvt('toolu_A'));
  orch._onAgentEvent('planner', { type: 'system', raw: { type: 'system', subtype: 'task_started', task_id: 'a1', tool_use_id: 'toolu_A', is_backgrounded: true } });
  orch._onAgentEvent('planner', { type: 'system', raw: { type: 'system', subtype: 'task_updated', task_id: 'a1', patch: { status: 'completed', end_time: 1 } } });
  assert.equal(orch.state.subAgents[0].status, 'running');
});

test('a foreground finish fills durationMs/tokens from the frame tool_use_result', () => {
  const orch = fresh();
  orch._onAgentEvent('planner', spawnEvt('toolu_A'), ATTR);
  orch._onAgentEvent('planner', syncEvt('toolu_A', {
    agentId: 'a1', agentType: 'Explore', resolvedModel: 'claude-opus-5',
    totalDurationMs: 225000, totalTokens: 48213, usage: { input_tokens: 40000, output_tokens: 8213 },
  }));
  const r = orch.state.subAgents[0];
  assert.equal(r.status, 'finished');
  assert.equal(r.durationMs, 225000);
  assert.equal(r.tokens, 48213);
  assert.equal(r.costUsd ?? null, null, 'cost stays hook-gated');
});

test('resolvedModel fills a null runModel on the ack (frontmatter-model gap) and emits an update delta', () => {
  const orch = fresh();
  const evts = [];
  orch.on('subagent', (m) => evts.push(m));
  orch._onAgentEvent('planner', spawnEvt('toolu_A'), ATTR); // no input.model, no attr.model → runModel null
  assert.equal(orch.state.subAgents[0].runModel, null);
  orch._onAgentEvent('planner', ackEvt('toolu_A', { isAsync: true, status: 'async_launched', resolvedModel: 'claude-haiku-4-5-20251001' }));
  assert.equal(orch.state.subAgents[0].runModel, 'claude-haiku-4-5-20251001');
  assert.ok(evts.some((m) => m.transition === 'update' && m.runModel === 'claude-haiku-4-5-20251001'));
  assert.equal(orch.state.subAgents[0].status, 'running', 'still an ack — not finished');
});

test('resolvedModel never overwrites a runModel the spawn already set', () => {
  const orch = fresh();
  orch._onAgentEvent('planner', spawnEvt('toolu_A', 'opus'), ATTR); // Task input names model:'opus'
  orch._onAgentEvent('planner', ackEvt('toolu_A', { isAsync: true, resolvedModel: 'claude-opus-5[1m]' }));
  assert.equal(orch.state.subAgents[0].runModel, 'opus', 'clean alias kept for the UI pill');
});

test('the execution backstop still force-closes an ack’d record that never notified', () => {
  const orch = fresh();
  const stepKey = 'x:n1:1'; // graph engine: attr.stepKey IS the executionId
  orch._onAgentEvent('planner', spawnEvt('toolu_A'), { nodeId: 'n1', stepIndex: null, cycle: 1, stepKey });
  orch._onAgentEvent('planner', ackEvt('toolu_A'));
  orch._execStep({ executionId: stepKey, nodeId: 'n1', ordinal: 1, uiPhase: 'plan', node: { id: 'n1', key: 'planner' } }, 'done');
  assert.equal(orch.state.subAgents[0].status, 'finished', 'backstop caught the still-running async record');
});
