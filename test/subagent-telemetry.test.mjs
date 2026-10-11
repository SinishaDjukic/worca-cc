// test/subagent-telemetry.test.mjs — gated hook-event telemetry (the hooks-off baseline finish is subagent-lifecycle's finish test)
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { subagentHooksEnabled, buildHookArgs } from '../src/core/claude-runner.mjs';
import { createOrchestrator } from '../src/core/orchestrator.mjs';
import { checkRows } from './helpers/rows.mjs';

afterEach(() => { delete process.env.WORCA_SUBAGENT_HOOKS; });

test('WORCA_SUBAGENT_HOOKS gate: off by default/"0"/"false" with no flags; "1" adds --include-hook-events and one --settings PostToolUse(Agent) hook', async () => {
  await checkRows([
    { name: 'subagentHooksEnabled is OFF by default and ON only for a truthy env', run: () => {
      delete process.env.WORCA_SUBAGENT_HOOKS;
      assert.equal(subagentHooksEnabled(), false);
      process.env.WORCA_SUBAGENT_HOOKS = '0';
      assert.equal(subagentHooksEnabled(), false, '"0" is off');
      process.env.WORCA_SUBAGENT_HOOKS = 'false';
      assert.equal(subagentHooksEnabled(), false, '"false" is off');
      process.env.WORCA_SUBAGENT_HOOKS = '1';
      assert.equal(subagentHooksEnabled(), true);
    } },
    { name: 'buildHookArgs is [] when off and the two flags when on', run: () => {
      delete process.env.WORCA_SUBAGENT_HOOKS;
      assert.deepEqual(buildHookArgs(), []);
      process.env.WORCA_SUBAGENT_HOOKS = '1';
      const a = buildHookArgs();
      assert.ok(a.includes('--include-hook-events'), 'adds the hook-events flag');
      const si = a.indexOf('--settings');
      assert.ok(si >= 0, 'adds --settings');
      const settings = JSON.parse(a[si + 1]);
      assert.equal(settings.hooks.PostToolUse[0].matcher, 'Agent', 'PostToolUse matched to Agent');
      // The payload reaches the stream only as the hook's echoed stdout: `cat`, synchronous.
      assert.deepEqual(settings.hooks.PostToolUse[0].hooks, [{ type: 'command', command: 'cat' }]);
    } },
  ]);
});

// The CLI's hook line (see test/fixtures/hooks/): the PostToolUse payload rides
// inside the envelope as the hook command's echoed stdout.
const hookResponse = (payload) => {
  const out = JSON.stringify({ hook_event_name: 'PostToolUse', tool_name: 'Agent', ...payload });
  return { type: 'hook-event', raw: { type: 'system', subtype: 'hook_response',
    hook_name: 'PostToolUse:Agent', hook_event: 'PostToolUse', output: out, stdout: out,
    stderr: '', exit_code: 0, outcome: 'success' } };
};

test('a hook-event fills duration/tokens/cost for a tracked tool_use_id and is ignored for an unknown one', async () => {
  await checkRows([
    { name: 'a hook-event for a tracked sub-agent fills duration/tokens/cost (keyed by tool_use_id)', run: () => {
      const orch = createOrchestrator({ projectDir: '/tmp/proj' });
      const spawn = (id) => ({ type: 'assistant', raw: { type: 'assistant', message: { content: [
        { type: 'tool_use', id, name: 'Agent', input: { description: 'd' } } ] } } });
      orch._onAgentEvent('planner', spawn('toolu_A'), { nodeId: 'n', stepIndex: 0, cycle: 1, stepKey: '0:n' });
      orch._onAgentEvent('planner', hookResponse({
        tool_use_id: 'toolu_A',
        tool_response: { totalDurationMs: 4200, totalTokens: 1536, usage: { cost_usd: 0.012 } },
      }));
      const r = orch.state.subAgents.find((s) => s.id === 'toolu_A');
      assert.equal(r.durationMs, 4200);
      assert.equal(r.tokens, 1536);
      assert.equal(r.costUsd, 0.012);
    } },
    { name: 'a hook-event for an unknown id is ignored (no crash, no record)', run: () => {
      const orch = createOrchestrator({ projectDir: '/tmp/proj' });
      orch._onAgentEvent('planner', hookResponse({ tool_use_id: 'ghost', tool_response: { totalDurationMs: 1 } }));
      assert.equal(orch.state.subAgents.length, 0);
    } },
  ]);
});
