// test/engine-events.test.mjs — the normalized vocabulary and the Claude normalizer
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isNormalized, EVENT_TYPES } from '../src/core/engines/events.mjs';
import { createClaudeNormalizer, normalizingOnEvent } from '../src/core/engines/claude-events.mjs';

const env = (raw, extra = {}) => ({ type: raw.type, raw, ...extra });
const norm = () => createClaudeNormalizer();

test('the vocabulary', () => {
  assert.deepEqual([...EVENT_TYPES].sort(), ['hook', 'log', 'result', 'retry', 'session', 'stderr', 'subagent', 'text', 'tool', 'toolResult', 'usage']);
});

test('isNormalized: raw envelopes are not, hook and raw-free events are', () => {
  assert.equal(isNormalized({ type: 'assistant', raw: {} }), false);
  assert.equal(isNormalized({ type: 'result', raw: { type: 'result' } }), false);
  assert.equal(isNormalized({ type: 'log', text: 'x', raw: 'x' }), false);
  assert.equal(isNormalized({ type: 'hook', raw: {} }), true);
  assert.equal(isNormalized({ type: 'session', sessionId: 's' }), true);
  assert.equal(isNormalized({ type: 'stderr', stream: 'err', text: 'x' }), true);
});

test('system/init -> session{init, model}; the runner session passes through', () => {
  assert.deepEqual(norm()(env({ type: 'system', subtype: 'init', session_id: 's1', model: 'claude-x' })),
    [{ type: 'session', sessionId: 's1', model: 'claude-x', init: true }]);
  assert.deepEqual(norm()(env({ type: 'system', subtype: 'init' })),
    [{ type: 'session', sessionId: null, model: null, init: true }]);
  assert.deepEqual(norm()({ type: 'session', sessionId: 's1' }), [{ type: 'session', sessionId: 's1' }]);
});

test('system/init carries the MCP server list as mcpServers, main stream only', () => {
  const servers = [{ name: 'pg', status: 'failed' }, { name: 'jira', status: 'connected' }];
  assert.deepEqual(norm()(env({ type: 'system', subtype: 'init', session_id: 's1', model: 'm', mcp_servers: servers })),
    [{ type: 'session', sessionId: 's1', model: 'm', init: true, mcpServers: servers }]);
  // A sub-agent's init, or an init without a list, says nothing about the servers.
  assert.deepEqual(norm()(env({ type: 'system', subtype: 'init', session_id: 's1', mcp_servers: servers, parent_tool_use_id: 'toolu_A' })),
    [{ type: 'session', sessionId: 's1', model: null, init: true }]);
  assert.deepEqual(norm()(env({ type: 'system', subtype: 'init', session_id: 's1', mcp_servers: 'x' })),
    [{ type: 'session', sessionId: 's1', model: null, init: true }]);
});

test('system/api_retry -> retry with the CLI\'s numbers, category and sub-agent parent', () => {
  // CLI 2.1.281: the frame is the CLI's only report of a retried API call.
  const raw = { type: 'system', subtype: 'api_retry', attempt: 1, max_retries: 10, retry_delay_ms: 500,
    error_status: 529, error: 'overloaded', no_response: { waited_ms: 300000, retry_wait_ms: 500 }, session_id: 's', parent_tool_use_id: 'toolu_A' };
  assert.deepEqual(norm()(env(raw)), [{ type: 'retry', parentId: 'toolu_A', attempt: 1, maxRetries: 10, delayMs: 500,
    httpStatus: 529, reason: 'overloaded', waitedMs: 300000 }]);
  // No status, no category, no numbers: a status-less 'unknown', every optional field absent.
  assert.deepEqual(norm()(env({ type: 'system', subtype: 'api_retry', error_status: null, error: '' })),
    [{ type: 'retry', parentId: null, httpStatus: null, reason: 'unknown' }]);
});

test('a <synthetic> assistant message is the CLI speaking: text from:\'cli\', no usage', () => {
  const line = 'API Error: 403 No access to this model';
  const raw = { type: 'assistant', message: { id: 'synth-1', model: '<synthetic>', content: [{ type: 'text', text: line }],
    usage: { input_tokens: 0, output_tokens: 0 } } };
  assert.deepEqual(norm()(env(raw, { text: line })),
    [{ type: 'text', text: line, parentId: null, from: 'cli', blocks: [line], messageId: 'synth-1' }]);
});

test('assistant text + tool_use in one frame -> text then one tool event', () => {
  const raw = { type: 'assistant', message: { id: 'm1', content: [
    { type: 'text', text: 'Hi' }, { type: 'tool_use', id: 't1', name: 'Read', input: { file_path: 'a' } },
    { type: 'tool_use', id: 't2', name: 'Skill', input: { skill: 'x' } }] } };
  assert.deepEqual(norm()(env(raw, { text: 'Hi' })), [
    { type: 'text', text: 'Hi', parentId: null, from: 'assistant', blocks: ['Hi'], messageId: 'm1' },
    { type: 'tool', parentId: null, messageId: 'm1', calls: [
      { name: 'Read', input: { file_path: 'a' }, toolUseId: 't1' }, { name: 'Skill', input: { skill: 'x' }, toolUseId: 't2' }] },
  ]);
});

test('assistant usage -> usage{phase:message}', () => {
  const raw = { type: 'assistant', message: { id: 'm1', usage: { input_tokens: 3 }, content: [] } };
  assert.deepEqual(norm()(env(raw)), [{ type: 'usage', messageId: 'm1', parentId: null, usage: { input_tokens: 3 }, phase: 'message' }]);
});

test('assistant usage carries the message model when it names one', () => {
  const raw = { type: 'assistant', message: { id: 'm1', model: 'claude-x', usage: { input_tokens: 3 }, content: [] } };
  assert.deepEqual(norm()(env(raw)), [{ type: 'usage', messageId: 'm1', parentId: null, usage: { input_tokens: 3 }, phase: 'message', model: 'claude-x' }]);
});

test('main-stream Agent tool_use -> subagent spawn before the tool event; a child Agent does not spawn', () => {
  const n = norm();
  const raw = { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'a1', name: 'Agent', input: { description: 'd', subagent_type: 'Explore', model: 'haiku' } }] } };
  const out = n(env(raw));
  assert.deepEqual(out[0], { type: 'subagent', event: 'spawn', toolUseId: 'a1', name: 'Agent', label: 'd', description: 'd', subagentType: 'Explore', model: 'haiku' });
  assert.equal(out[1].type, 'tool');
  const child = { type: 'assistant', parent_tool_use_id: 'a1', message: { content: [{ type: 'tool_use', id: 'a2', name: 'Agent', input: {} }] } };
  assert.equal(n(env(child)).some((e) => e.type === 'subagent'), false);
});

test('tool_result for a tracked agent: ack, finish (with telemetry), error', () => {
  const n = norm();
  n(env({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 'a1', name: 'Agent', input: {} }] } }));
  const ack = n(env({ type: 'user', tool_use_result: { isAsync: true, status: 'async_launched', resolvedModel: 'm' },
    message: { content: [{ type: 'tool_result', tool_use_id: 'a1', content: [{ type: 'text', text: 'launched' }] }] } }));
  assert.deepEqual(ack[0], { type: 'subagent', event: 'ack', toolUseId: 'a1', resolvedModel: 'm' });
  assert.equal(ack[1].type, 'toolResult');
  assert.deepEqual(ack[1].results, [{ toolUseId: 'a1', isError: false, text: 'launched', content: [{ type: 'text', text: 'launched' }] }]);
  const done = n(env({ type: 'user', tool_use_result: { status: 'completed', totalDurationMs: 5, totalTokens: 7, resolvedModel: 'm', agentType: 'Explore', usage: { input_tokens: 1 } },
    message: { content: [{ type: 'tool_result', tool_use_id: 'a1', content: 'ok' }] } }));
  assert.deepEqual(done[0], { type: 'subagent', event: 'finish', toolUseId: 'a1', durationMs: 5, tokens: 7, resolvedModel: 'm', agentType: 'Explore', usage: { input_tokens: 1 } });
  const n2 = norm();
  n2(env({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 'a2', name: 'Agent', input: {} }] } }));
  const failed = n2(env({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'a2', is_error: true, content: [{ type: 'text', text: 'boom' }] }] } }));
  assert.deepEqual(failed[0], { type: 'subagent', event: 'error', toolUseId: 'a2', errorText: 'boom' });
});

test('task_notification -> subagent finish/error with usage', () => {
  assert.deepEqual(norm()(env({ type: 'system', subtype: 'task_notification', tool_use_id: 'a1', status: 'completed', usage: { duration_ms: 9, total_tokens: 4 } })),
    [{ type: 'subagent', event: 'finish', toolUseId: 'a1', durationMs: 9, tokens: 4, via: 'notification' }]);
  assert.deepEqual(norm()(env({ type: 'system', subtype: 'task_notification', tool_use_id: 'a1', status: 'killed' })),
    [{ type: 'subagent', event: 'error', toolUseId: 'a1', via: 'notification' }]);
});

test('stream_event -> usage start/delta and text deltas on the main stream only', () => {
  const n = norm();
  assert.deepEqual(n(env({ type: 'stream_event', event: { type: 'message_start', message: { id: 'm1', usage: { input_tokens: 1 } } } })),
    [{ type: 'usage', messageId: 'm1', parentId: null, usage: { input_tokens: 1 }, phase: 'start' }]);
  assert.deepEqual(n(env({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'He' } } })),
    [{ type: 'text', text: 'He', parentId: null, from: 'assistant', delta: true, messageId: 'm1' }]);
  assert.deepEqual(n(env({ type: 'stream_event', event: { type: 'message_delta', usage: { output_tokens: 2 } } })),
    [{ type: 'usage', messageId: 'm1', parentId: null, usage: { output_tokens: 2 }, phase: 'delta' }]);
  assert.deepEqual(n(env({ type: 'stream_event', parent_tool_use_id: 'a1', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'x' } } })), []);
});

test('result -> result with every field worca reads', () => {
  const raw = { type: 'result', subtype: 'error_max_turns', is_error: true, result: 'r', total_cost_usd: 0.5, usage: { input_tokens: 1 },
    terminal_reason: 'max_turns', num_turns: 3, duration_ms: 99, session_id: 's', errors: ['e'], modelUsage: { m: {} } };
  assert.deepEqual(norm()(env(raw, { text: 'r', costUsd: 0.5 })), [{ type: 'result', text: 'r', costUsd: 0.5, usage: { input_tokens: 1 },
    subtype: 'error_max_turns', isError: true, terminalReason: 'max_turns', numTurns: 3, durationMs: 99, sessionId: 's', errors: ['e'], modelUsage: { m: {} } }]);
});

test('a genuine $0 survives; no cost field means no costUsd key', () => {
  assert.equal(norm()(env({ type: 'result', total_cost_usd: 0 }))[0].costUsd, 0);
  assert.equal('costUsd' in norm()(env({ type: 'result' }))[0], false);
});

test('hook lines, stderr, log, mock log lines', () => {
  const hook = { type: 'system', subtype: 'hook_response', hook_event: 'PostToolUse' };
  assert.deepEqual(norm()({ type: 'hook-event', raw: hook }), [{ type: 'hook', raw: hook }]);
  assert.deepEqual(norm()(env(hook)), [{ type: 'hook', raw: hook }]);
  assert.deepEqual(norm()({ type: 'log', text: 'x', raw: 'x' }), [{ type: 'log', text: 'x' }]);
  assert.deepEqual(norm()({ type: 'assistant', text: '[mock] hi', raw: { mock: true, text: '[mock] hi' } }),
    [{ type: 'text', text: '[mock] hi', parentId: null, from: 'assistant' }]);
  assert.deepEqual(norm()({ type: 'tool_use', text: 'wrote x', raw: { mock: true, file: 'x' } }),
    [{ type: 'text', text: 'wrote x', parentId: null, from: 'assistant' }]);
});

test('a sub-agent prompt frame (user text with a parent) -> text{from:user}', () => {
  assert.deepEqual(norm()(env({ type: 'user', parent_tool_use_id: 'a1', message: { content: [{ type: 'text', text: 'do x' }] } }, { text: 'do x' })),
    [{ type: 'text', text: 'do x', parentId: 'a1', from: 'user', blocks: ['do x'] }]);
});

test('normalizingOnEvent passes normalized events through and converts raw ones', () => {
  const got = [];
  const on = normalizingOnEvent((e) => got.push(e));
  on({ type: 'session', sessionId: 's' });
  on(env({ type: 'result', total_cost_usd: 0 }));
  assert.deepEqual(got.map((e) => e.type), ['session', 'result']);
});

test('every captured fixture normalizes without throwing and yields only vocabulary types', () => {
  for (const f of ['plain-text', 'task-subagent', 'tool-list-runs', 'propose-run', 'max-turns']) {
    const n = norm();
    const frames = readFileSync(new URL(`./fixtures/ask/${f}.jsonl`, import.meta.url), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
    for (const raw of frames) for (const e of n(env(raw))) assert.ok(EVENT_TYPES.has(e.type), `${f}: ${e.type}`);
  }
});

import { createOrchestrator } from '../src/core/orchestrator.mjs';

test('a raw envelope and its normalized form drive the orchestrator identically', () => {
  const ATTR = { nodeId: 'n', stepIndex: 0, cycle: 1, stepKey: '0:n', executionId: 'x' };
  const frames = [
    { type: 'assistant', raw: { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'a1', name: 'Agent', input: { description: 'd' } }, { type: 'tool_use', id: 's1', name: 'Skill', input: { skill: 'k' } }] } } },
    { type: 'user', raw: { type: 'user', tool_use_result: { status: 'completed', totalDurationMs: 3, totalTokens: 4 }, message: { content: [{ type: 'tool_result', tool_use_id: 'a1', content: 'ok' }] } } },
  ];
  const run = (feed) => {
    const orch = createOrchestrator({ projectDir: '/tmp/p' });
    const seen = [];
    orch.on('subagent', (m) => seen.push({ ...m, ts: 0 }));
    orch.on('log', (m) => seen.push({ ...m, ts: 0 }));
    feed(orch);
    return { seen, subAgents: orch.state.subAgents.map((s) => ({ ...s, startedAt: 0, finishedAt: 0 })) };
  };
  const viaRaw = run((o) => { for (const f of frames) o._onAgentEvent('planner', f, ATTR); });
  const n = createClaudeNormalizer();
  const viaNormalized = run((o) => { for (const f of frames) for (const e of n(f)) o._onAgentEvent('planner', e, ATTR); });
  assert.deepEqual(viaNormalized, viaRaw);
});

test('text on a frame of no known type is kept as text{from:other} (logged, never an Ask answer)', () => {
  assert.deepEqual(norm()({ type: 'assistant', text: 'Considering.', raw: {} }),
    [{ type: 'text', text: 'Considering.', parentId: null, from: 'other' }]);
  assert.deepEqual(norm()(env({ type: 'system', subtype: 'compact_boundary', content: 'x' }, { text: 'x' })),
    [{ type: 'text', text: 'x', parentId: null, from: 'other' }]);
});

test('a tool_result without an id is still a result (id null)', () => {
  const [r] = norm()(env({ type: 'user', message: { content: [{ type: 'tool_result', content: 'ok' }] } }));
  assert.deepEqual(r.results, [{ toolUseId: null, isError: false, text: 'ok', content: 'ok' }]);
});

test('a stderr envelope is stderr only, whatever raw it carries', () => {
  assert.deepEqual(norm()({ type: 'stderr', stream: 'err', text: 'noise', raw: { type: 'assistant', message: { content: [{ type: 'tool_use', id: 't', name: 'Read', input: {} }] } } }),
    [{ type: 'stderr', stream: 'err', text: 'noise' }]);
});

test('the frame decides, not the envelope type: a log envelope carrying a user frame is a toolResult', () => {
  const out = norm()({ type: 'log', text: '', raw: { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }] } } });
  assert.deepEqual(out.map((e) => e.type), ['toolResult']);
});
