// test/subagent-telemetry.test.mjs — gated hook-event telemetry + degrade-to-baseline
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { subagentHooksEnabled, buildHookArgs } from '../src/core/claude-runner.mjs';
import { createOrchestrator } from '../src/core/orchestrator.mjs';

afterEach(() => { delete process.env.WORCA_SUBAGENT_HOOKS; });

test('subagentHooksEnabled is OFF by default and ON only for a truthy env', () => {
  delete process.env.WORCA_SUBAGENT_HOOKS;
  assert.equal(subagentHooksEnabled(), false);
  process.env.WORCA_SUBAGENT_HOOKS = '0';
  assert.equal(subagentHooksEnabled(), false, '"0" is off');
  process.env.WORCA_SUBAGENT_HOOKS = 'false';
  assert.equal(subagentHooksEnabled(), false, '"false" is off');
  process.env.WORCA_SUBAGENT_HOOKS = '1';
  assert.equal(subagentHooksEnabled(), true);
});

test('buildHookArgs is [] when off and the two flags when on', () => {
  delete process.env.WORCA_SUBAGENT_HOOKS;
  assert.deepEqual(buildHookArgs(), []);
  process.env.WORCA_SUBAGENT_HOOKS = '1';
  const a = buildHookArgs();
  assert.ok(a.includes('--include-hook-events'), 'adds the hook-events flag');
  const si = a.indexOf('--settings');
  assert.ok(si >= 0, 'adds --settings');
  const settings = JSON.parse(a[si + 1]);
  assert.equal(settings.hooks.PostToolUse[0].matcher, 'Agent', 'PostToolUse matched to Agent');
  assert.equal(settings.hooks.PostToolUse[0].hooks[0].command, 'true');
});

test('a hook-event for a tracked sub-agent fills duration/tokens/cost (keyed by tool_use_id)', () => {
  const orch = createOrchestrator({ projectDir: '/tmp/proj' });
  const spawn = (id) => ({ type: 'assistant', raw: { type: 'assistant', message: { content: [
    { type: 'tool_use', id, name: 'Agent', input: { description: 'd' } } ] } } });
  orch._onAgentEvent('planner', spawn('toolu_A'), { nodeId: 'n', stepIndex: 0, cycle: 1, stepKey: '0:n' });
  orch._onAgentEvent('planner', {
    type: 'hook-event',
    raw: { type: 'hook-event', hook_event_name: 'PostToolUse', tool_name: 'Agent',
      tool_use_id: 'toolu_A',
      tool_response: { totalDurationMs: 4200, totalTokens: 1536, usage: { cost_usd: 0.012 } } },
  });
  const r = orch.state.subAgents.find((s) => s.id === 'toolu_A');
  assert.equal(r.durationMs, 4200);
  assert.equal(r.tokens, 1536);
  assert.equal(r.costUsd, 0.012);
});

test('a hook-event for an unknown id is ignored (no crash, no record)', () => {
  const orch = createOrchestrator({ projectDir: '/tmp/proj' });
  orch._onAgentEvent('planner', { type: 'hook-event', raw: { type: 'hook-event',
    tool_use_id: 'ghost', tool_response: { totalDurationMs: 1 } } });
  assert.equal(orch.state.subAgents.length, 0);
});

test('DEGRADE: with hooks OFF, the baseline spawn→finish lifecycle still fully works', () => {
  delete process.env.WORCA_SUBAGENT_HOOKS;
  assert.deepEqual(buildHookArgs(), [], 'no flags added when off');
  const orch = createOrchestrator({ projectDir: '/tmp/proj' });
  const spawn = (id) => ({ type: 'assistant', raw: { type: 'assistant', message: { content: [
    { type: 'tool_use', id, name: 'Agent', input: { description: 'd' } } ] } } });
  const finish = (id) => ({ type: 'user', raw: { type: 'user', message: { content: [
    { type: 'tool_result', tool_use_id: id } ] } } });
  orch._onAgentEvent('planner', spawn('toolu_A'), { nodeId: 'n', stepIndex: 0, cycle: 1, stepKey: '0:n' });
  orch._onAgentEvent('planner', finish('toolu_A'));
  const r = orch.state.subAgents.find((s) => s.id === 'toolu_A');
  assert.equal(r.status, 'finished', 'lifecycle works with NO telemetry flags');
  assert.equal(r.durationMs, undefined, 'no telemetry enrichment when off');
});
