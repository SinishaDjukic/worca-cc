// test/bridge-translate.test.mjs
// The pure Messages ⇄ chat/completions mappers (model-bridge-design.md §5):
// request table, block ordering rules, the streaming state machine driven by
// recorded chunk shapes, stop reasons, usage, errors and the token estimate.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toChatRequest, budgetToReasoningEffort } from '../src/core/bridge/translate/request.mjs';
import { ChatStreamTranslator, SseDataParser, serializeSse, mapStopReason, mapUsage } from '../src/core/bridge/translate/stream.mjs';
import { toMessagesResponse, estimateInputTokens } from '../src/core/bridge/translate/response.mjs';
import { mapUpstreamError, mapNetworkError, PROMPT_TOO_LONG, bridgeErrors, isContextOverflow, isFailedResponseOverflow } from '../src/core/bridge/errors.mjs';
import { mapEffort, requestedEffort, encodeReasoningMarker, decodeReasoningMarker } from '../src/core/bridge/translate/common.mjs';

const M = 'gpt-5';

test('request: system blocks join, cache_control dropped and named once', () => {
  const r = toChatRequest({
    system: [{ type: 'text', text: 'A', cache_control: { type: 'ephemeral' } }, { type: 'text', text: 'B' }],
    messages: [{ role: 'user', content: 'hi' }],
    max_tokens: 100,
  }, { upstreamModel: M });
  assert.equal(r.error, undefined);
  assert.deepEqual(r.body.messages[0], { role: 'system', content: 'A\n\nB' });
  assert.deepEqual(r.body.messages[1], { role: 'user', content: 'hi' });
  assert.equal(r.body.model, M);
  assert.equal(r.body.max_tokens, 100);
  assert.deepEqual(r.warnings, ['cache_control']);
});

test('request: assistant tool_use → tool_calls, tool_result → tool messages first, then user text', () => {
  const r = toChatRequest({
    messages: [
      { role: 'user', content: 'read it' },
      { role: 'assistant', content: [
        { type: 'thinking', thinking: 'hmm', signature: 'x' },
        { type: 'text', text: 'ok' },
        { type: 'tool_use', id: 'toolu_1', name: 'Read', input: { path: 'a' } },
      ] },
      { role: 'user', content: [
        { type: 'text', text: 'and now?' },
        { type: 'tool_result', tool_use_id: 'toolu_1', content: [{ type: 'text', text: 'file body' }] },
      ] },
    ],
    tools: [{ name: 'Read', description: 'read a file', input_schema: { type: 'object', properties: { path: { type: 'string' } } } }],
    tool_choice: { type: 'auto', disable_parallel_tool_use: true },
    stream: true,
  }, { upstreamModel: M });
  assert.equal(r.error, undefined);
  const [a, t, u] = r.body.messages.slice(1);
  assert.equal(a.role, 'assistant');
  assert.equal(a.content, 'ok');
  assert.deepEqual(a.tool_calls, [{ id: 'toolu_1', type: 'function', function: { name: 'Read', arguments: '{"path":"a"}' } }]);
  assert.deepEqual(t, { role: 'tool', tool_call_id: 'toolu_1', content: 'file body' });
  assert.deepEqual(u, { role: 'user', content: 'and now?' });
  assert.deepEqual(r.body.tools, [{ type: 'function', function: { name: 'Read', description: 'read a file', parameters: { type: 'object', properties: { path: { type: 'string' } } } } }]);
  assert.equal(r.body.tool_choice, 'auto');
  assert.equal(r.body.parallel_tool_calls, false);
  assert.equal(r.body.stream, true);
  assert.deepEqual(r.body.stream_options, { include_usage: true });
  assert.ok(r.warnings.includes('thinking'));
});

test('request: a thinking-only assistant turn is removed; adjacent user texts merge', () => {
  const r = toChatRequest({
    messages: [
      { role: 'user', content: 'one' },
      { role: 'assistant', content: [{ type: 'thinking', thinking: 'x' }] },
      { role: 'user', content: 'two' },
    ],
  }, { upstreamModel: M });
  assert.deepEqual(r.body.messages, [{ role: 'user', content: 'one\n\ntwo' }]);
});

test('request: images become data URIs; an image in a tool result relocates to a user message', () => {
  const img = { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } };
  const r = toChatRequest({
    messages: [
      { role: 'user', content: [{ type: 'text', text: 'look' }, img] },
      { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'Shot', input: {} }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: [{ type: 'text', text: 'here' }, img] }] },
    ],
  }, { upstreamModel: M, capabilities: { vision: true } });
  assert.deepEqual(r.body.messages[0].content, [{ type: 'text', text: 'look' }, { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } }]);
  assert.equal(r.body.messages[2].role, 'tool');
  assert.deepEqual(r.body.messages[3], { role: 'user', content: [{ type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } }] });
});

test('request: no vision → image replaced by a marker and warned', () => {
  const r = toChatRequest({
    messages: [{ role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } }] }],
  }, { upstreamModel: M, capabilities: { vision: false } });
  assert.equal(r.body.messages[0].content, '[image omitted: model has no vision]');
  assert.ok(r.warnings.includes('image'));
});

test('request: tool_choice any/tool/none map; server tools are a hard error', () => {
  const base = { messages: [{ role: 'user', content: 'x' }], tools: [{ name: 'A', input_schema: { type: 'object' } }] };
  assert.equal(toChatRequest({ ...base, tool_choice: { type: 'any' } }, { upstreamModel: M }).body.tool_choice, 'required');
  assert.deepEqual(toChatRequest({ ...base, tool_choice: { type: 'tool', name: 'A' } }, { upstreamModel: M }).body.tool_choice, { type: 'function', function: { name: 'A' } });
  assert.equal(toChatRequest({ ...base, tool_choice: { type: 'none' } }, { upstreamModel: M }).body.tool_choice, 'none');
  const r = toChatRequest({ ...base, tools: [{ type: 'web_search_20250305', name: 'web_search' }] }, { upstreamModel: M });
  assert.equal(r.error.type, 'invalid_request_error');
  assert.match(r.error.message, /web_search.*server tool/);
  const r2 = toChatRequest(base, { upstreamModel: M, capabilities: { toolCalls: false } });
  assert.match(r2.error.message, /does not support tool calls/);
});

test('request: reasoning models get reasoning_effort + max_completion_tokens and lose sampling', () => {
  const body = { messages: [{ role: 'user', content: 'x' }], max_tokens: 64000, temperature: 0.2, top_p: 0.9, top_k: 5, thinking: { type: 'enabled', budget_tokens: 20000 } };
  const r = toChatRequest(body, { upstreamModel: M, capabilities: { reasoning: true, maxOutputTokens: 32000 } });
  assert.equal(r.body.reasoning_effort, 'high');
  assert.equal(r.body.max_completion_tokens, 32000);
  assert.equal(r.body.max_tokens, undefined);
  assert.equal(r.body.temperature, undefined);
  for (const w of ['temperature', 'top_p', 'top_k', 'max_tokens clamped']) assert.ok(r.warnings.includes(w), w);
  const plain = toChatRequest(body, { upstreamModel: M });
  assert.equal(plain.body.reasoning_effort, undefined);
  assert.equal(plain.body.temperature, 0.2);
  assert.ok(plain.warnings.includes('thinking'));
  // output_config.effort (the CLI's --effort) outranks the budget band.
  const eff = toChatRequest({ ...body, output_config: { effort: 'low' } }, { upstreamModel: M, capabilities: { reasoning: true } });
  assert.equal(eff.body.reasoning_effort, 'low');
});

test('request: tool search — a deferred tool (defer_loading) is not sent; all-deferred sends no tools array', () => {
  const tools = [
    { name: 'Read', description: 'r', input_schema: { type: 'object', properties: {} } },
    { name: 'DeferredToolPlaceholder', description: 'p', input_schema: { type: 'object', properties: {} }, defer_loading: true },
  ];
  const r = toChatRequest({ messages: [{ role: 'user', content: 'hi' }], tools }, { upstreamModel: 'm' });
  assert.deepEqual(r.body.tools.map((t) => t.function.name), ['Read']);
  const only = toChatRequest({ messages: [{ role: 'user', content: 'hi' }], tools: [tools[1]], tool_choice: { type: 'auto' } }, { upstreamModel: 'm' });
  assert.equal('tools' in only.body, false);
  assert.equal('tool_choice' in only.body, false);
});

test('request: tool search — a deferred tool referenced by a ToolSearch result is sent, and the reference reads as text', () => {
  const tools = [
    { name: 'ToolSearch', input_schema: { type: 'object', properties: {} } },
    { name: 'WebFetch', input_schema: { type: 'object', properties: {} }, defer_loading: true },
    { name: 'mcp__x__y', input_schema: { type: 'object', properties: { q: { type: 'string' } } }, defer_loading: true },
  ];
  const messages = [
    { role: 'user', content: 'find it' },
    { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'ToolSearch', input: { query: 'select:mcp__x__y' } }] },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: [{ type: 'tool_reference', tool_name: 'mcp__x__y' }] }] },
  ];
  const r = toChatRequest({ messages, tools }, { upstreamModel: 'm' });
  assert.deepEqual(r.body.tools.map((t) => t.function.name), ['ToolSearch', 'mcp__x__y']);
  assert.equal(r.body.messages.find((m) => m.role === 'tool').content, 'Tool loaded: mcp__x__y');
  assert.equal(r.warnings.includes('tool_reference'), false);
});

test('budget bands', () => {
  assert.equal(budgetToReasoningEffort(1000), 'low');
  assert.equal(budgetToReasoningEffort(8000), 'medium');
  assert.equal(budgetToReasoningEffort(50000), 'high');
  assert.equal(budgetToReasoningEffort(undefined), 'medium');
});

test('request: stop_sequences → stop, metadata dropped', () => {
  const r = toChatRequest({ messages: [{ role: 'user', content: 'x' }], stop_sequences: ['END'], metadata: { user_id: 'u' } }, { upstreamModel: M });
  assert.deepEqual(r.body.stop, ['END']);
  assert.ok(r.warnings.includes('metadata'));
});

// ── streaming ──

function drive(chunks, model = 'cat') {
  const t = new ChatStreamTranslator({ model });
  const events = [];
  for (const c of chunks) events.push(...t.push(c));
  events.push(...t.finish());
  return events;
}
const types = (events) => events.map((e) => e.event);

test('stream: text only', () => {
  const ev = drive([
    { choices: [{ delta: { role: 'assistant', content: '' } }] },
    { choices: [{ delta: { content: 'Hel' } }] },
    { choices: [{ delta: { content: 'lo' } }] },
    { choices: [{ delta: {}, finish_reason: 'stop' }] },
    { choices: [], usage: { prompt_tokens: 10, completion_tokens: 2, prompt_tokens_details: { cached_tokens: 4 } } },
  ]);
  assert.deepEqual(types(ev), ['message_start', 'content_block_start', 'content_block_delta', 'content_block_delta', 'content_block_stop', 'message_delta', 'message_stop']);
  assert.equal(ev[0].data.message.model, 'cat');
  assert.deepEqual(ev[1].data.content_block, { type: 'text', text: '' });
  assert.equal(ev[2].data.delta.text, 'Hel');
  assert.equal(ev[5].data.delta.stop_reason, 'end_turn');
  assert.deepEqual(ev[5].data.usage, { input_tokens: 6, output_tokens: 2, cache_read_input_tokens: 4, cache_creation_input_tokens: 0 });
});

test('stream: single tool call → one tool_use block with the full JSON, stop tool_use', () => {
  const ev = drive([
    { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: 'Read', arguments: '' } }] } }] },
    { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '{"pa' } }] } }] },
    { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'th":"a"}' } }] } }] },
    { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
  ]);
  assert.deepEqual(types(ev), ['message_start', 'content_block_start', 'content_block_delta', 'content_block_stop', 'message_delta', 'message_stop']);
  assert.deepEqual(ev[1].data.content_block, { type: 'tool_use', id: 'call_1', name: 'Read', input: {} });
  assert.deepEqual(ev[2].data.delta, { type: 'input_json_delta', partial_json: '{"path":"a"}' });
  assert.equal(ev[4].data.delta.stop_reason, 'tool_use');
});

test('stream: parallel tool calls keep order and distinct indexes; text after tools flushes them first', () => {
  const ev = drive([
    { choices: [{ delta: { content: 'Let me' } }] },
    { choices: [{ delta: { tool_calls: [{ index: 0, id: 'a', function: { name: 'A', arguments: '{}' } }] } }] },
    { choices: [{ delta: { tool_calls: [{ index: 1, id: 'b', function: { name: 'B', arguments: '{"x":1}' } }] } }] },
    { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '' } }] } }] },   // late, out of order: still buffered
    { choices: [{ delta: { content: 'done' } }] },
    { choices: [{ delta: {}, finish_reason: 'stop' }] },
  ]);
  const starts = ev.filter((e) => e.event === 'content_block_start').map((e) => [e.data.index, e.data.content_block.type, e.data.content_block.name]);
  assert.deepEqual(starts, [[0, 'text', undefined], [1, 'tool_use', 'A'], [2, 'tool_use', 'B'], [3, 'text', undefined]]);
  const stops = ev.filter((e) => e.event === 'content_block_stop').map((e) => e.data.index);
  assert.deepEqual(stops, [0, 1, 2, 3]);
  assert.equal(ev.find((e) => e.event === 'message_delta').data.delta.stop_reason, 'tool_use');
});

test('stream: finish_reason length mid tool call — the unterminated call is dropped for a note, earlier complete calls survive, stop max_tokens', () => {
  const ev = drive([
    { choices: [{ delta: { tool_calls: [{ index: 0, id: 'a', function: { name: 'Read', arguments: '{"path":"x"}' } }] } }] },
    { choices: [{ delta: { tool_calls: [{ index: 1, id: 'b', function: { name: 'Write', arguments: '{"file_path":"p","content":"long' } }] } }] },
    { choices: [{ delta: {}, finish_reason: 'length' }] },
  ]);
  const starts = ev.filter((e) => e.event === 'content_block_start').map((e) => e.data.content_block.type + ':' + (e.data.content_block.name || ''));
  assert.deepEqual(starts, ['tool_use:Read', 'text:']);
  assert.match(ev.find((e) => e.data && e.data.delta && e.data.delta.type === 'text_delta').data.delta.text, /Write call was cut off/);
  assert.equal(ev.find((e) => e.event === 'message_delta').data.delta.stop_reason, 'max_tokens');
  // A COMPLETE call that happens to end on `length` is still run.
  const whole = drive([
    { choices: [{ delta: { tool_calls: [{ index: 0, id: 'a', function: { name: 'Read', arguments: '{"path":"x"}' } }] } }] },
    { choices: [{ delta: {}, finish_reason: 'length' }] },
  ]);
  assert.deepEqual(whole.filter((e) => e.event === 'content_block_start').map((e) => e.data.content_block.type), ['tool_use']);
  // Buffered path.
  const r = toMessagesResponse({ choices: [{ message: { content: null, tool_calls: [{ id: 'c', function: { name: 'Bash', arguments: '{"command":"cat <<EOF' } }] }, finish_reason: 'length' }] }, { model: 'm' });
  assert.equal(r.content.length, 1);
  assert.equal(r.content[0].type, 'text');
  assert.equal(r.stop_reason, 'max_tokens');
});

test('stream: a cut stream with no content is an api_error event; with content it ends end_turn', () => {
  const cut = drive([{ choices: [{ delta: {} }] }]);
  assert.deepEqual(types(cut), ['message_start', 'error']);
  assert.equal(cut[1].data.error.type, 'api_error');
  const some = drive([{ choices: [{ delta: { content: 'x' } }] }]);
  assert.equal(some.find((e) => e.event === 'message_delta').data.delta.stop_reason, 'end_turn');
});

test('stream: upstream error object mid-stream and generated tool ids', () => {
  const ev = drive([{ error: { message: 'boom' } }]);
  assert.equal(ev[1].event, 'error');
  assert.match(ev[1].data.error.message, /boom/);
  const gen = drive([{ choices: [{ delta: { tool_calls: [{ index: 0, function: { name: 'X', arguments: '{}' } }] }, finish_reason: 'tool_calls' }] }]);
  assert.match(gen[1].data.content_block.id, /^toolu_bridge_/);
});

test('stop reason table + usage', () => {
  assert.equal(mapStopReason('stop'), 'end_turn');
  assert.equal(mapStopReason('length'), 'max_tokens');
  assert.equal(mapStopReason('tool_calls'), 'tool_use');
  assert.equal(mapStopReason('function_call'), 'tool_use');
  assert.equal(mapStopReason('content_filter'), 'end_turn');
  assert.equal(mapStopReason(undefined, { emitted: false }), null);
  assert.deepEqual(mapUsage(undefined), { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 });
});

test('serializeSse + SseDataParser round-trip, [DONE] ends, CRLF tolerated', () => {
  const text = serializeSse([{ event: 'ping', data: { type: 'ping' } }]);
  assert.equal(text, 'event: ping\ndata: {"type":"ping"}\n\n');
  const p = new SseDataParser();
  assert.deepEqual(p.feed('data: {"a":1}\r\n\r\ndata: {"b":'), [{ a: 1 }]);
  assert.deepEqual(p.feed('2}\n\n'), [{ b: 2 }]);
  assert.deepEqual(p.feed('data: [DONE]\n\ndata: {"c":3}\n\n'), []);
  assert.equal(p.done, true);
  const q = new SseDataParser();
  assert.deepEqual(q.feed('data: {"tail":true}'), []);
  assert.deepEqual(q.end(), [{ tail: true }]);
});

test('non-stream response: text + tool_calls + usage; malformed arguments kept raw', () => {
  const m = toMessagesResponse({
    choices: [{ message: { role: 'assistant', content: 'hi', tool_calls: [
      { id: 'c1', function: { name: 'A', arguments: '{"k":1}' } },
      { id: 'c2', function: { name: 'B', arguments: '{oops' } },
    ] }, finish_reason: 'tool_calls' }],
    usage: { prompt_tokens: 5, completion_tokens: 7 },
  }, { model: 'cat' });
  assert.equal(m.type, 'message');
  assert.equal(m.model, 'cat');
  assert.deepEqual(m.content[0], { type: 'text', text: 'hi' });
  assert.deepEqual(m.content[1], { type: 'tool_use', id: 'c1', name: 'A', input: { k: 1 } });
  assert.deepEqual(m.content[2].input, { _raw: '{oops' });
  assert.equal(m.stop_reason, 'tool_use');
  assert.equal(m.usage.input_tokens, 5);
});

test('count_tokens estimate scales with text, tools and images', () => {
  const small = estimateInputTokens({ messages: [{ role: 'user', content: 'x'.repeat(400) }] });
  assert.equal(small, 100);
  const withTools = estimateInputTokens({ messages: [{ role: 'user', content: 'x'.repeat(400) }], tools: [{ name: 'A', input_schema: {} }] });
  assert.ok(withTools > small + 20);
  const withImg = estimateInputTokens({ messages: [{ role: 'user', content: [{ type: 'image', source: {} }] }] });
  assert.ok(withImg >= 1200);
  assert.equal(estimateInputTokens(null), 0);
});

test('errors: upstream status → envelope', () => {
  assert.deepEqual(mapUpstreamError(401, '{"error":{"message":"bad key"}}', { provider: 'openai' }),
    { status: 401, body: { type: 'error', error: { type: 'authentication_error', message: 'openai: authentication failed (401) — bad key' } } });
  const rl = mapUpstreamError(429, 'slow', { provider: 'copilot', retryAfter: '7' });
  assert.equal(rl.status, 429);
  assert.equal(rl.body.error.type, 'rate_limit_error');
  assert.deepEqual(rl.headers, { 'retry-after': '7' });
  assert.equal(mapUpstreamError(413, '', {}).body.error.message, PROMPT_TOO_LONG);
  assert.equal(mapUpstreamError(400, '{"error":{"message":"This model\'s maximum context length is 128000 tokens"}}', {}).body.error.message, PROMPT_TOO_LONG);
  assert.equal(mapUpstreamError(400, 'nope', {}).body.error.type, 'invalid_request_error');
  assert.equal(mapUpstreamError(404, '', {}).status, 400);
  assert.equal(mapUpstreamError(503, '', {}).body.error.type, 'overloaded_error');
  assert.equal(mapUpstreamError(500, '', {}).status, 502);
  assert.equal(mapNetworkError(Object.assign(new Error('x'), { name: 'AbortError' })).status, 499);
  assert.match(mapNetworkError(new Error('ECONNREFUSED'), { provider: 'openai' }).body.error.message, /unreachable/);
  assert.equal(bridgeErrors.unauthorized().status, 401);
  assert.equal(bridgeErrors.unknownModel('z').status, 404);
});

test('mapEffort: the default table without a list; clamps to the listed levels with one (none is never chosen)', () => {
  assert.deepEqual(['low', 'medium', 'high', 'xhigh', 'max'].map((e) => mapEffort(e, {})), ['low', 'medium', 'high', 'high', 'high']);
  const list = { reasoningEfforts: ['none', 'low', 'medium', 'high', 'xhigh'] };
  assert.deepEqual(['low', 'medium', 'high', 'xhigh', 'max'].map((e) => mapEffort(e, list)), ['low', 'medium', 'high', 'xhigh', 'xhigh']);
  assert.equal(mapEffort('max', { reasoningEfforts: ['low', 'medium', 'high', 'xhigh', 'max'] }), 'max');
  assert.equal(mapEffort('medium', { reasoningEfforts: ['none', 'high'] }), 'high');   // nothing at or below: the lowest real level
  assert.equal(mapEffort('low', { reasoningEfforts: ['medium', 'high'] }), 'medium');  // …the lowest, not the highest
  assert.equal(mapEffort('high', { reasoningEfforts: ['none'] }), 'high');             // only none listed: the default table
  assert.equal(mapEffort(null, list), null);
  assert.equal(mapEffort('high'), 'high');
});

test('requestedEffort: output_config.effort wins over the thinking budget band; adaptive thinking alone asks for nothing', () => {
  assert.equal(requestedEffort({ thinking: { type: 'enabled', budget_tokens: 2000 } }), 'low');
  assert.equal(requestedEffort({ thinking: { type: 'enabled', budget_tokens: 2000 }, output_config: { effort: 'max' } }), 'max');
  assert.equal(requestedEffort({ thinking: { type: 'adaptive' } }), null);
  assert.equal(requestedEffort({ output_config: { effort: 'bogus' } }), null);
  assert.equal(requestedEffort({}), null);
  assert.equal(requestedEffort(null), null);
});

test('reasoning marker: round-trips the upstream model and the encrypted content; anything else is not a marker', () => {
  const m = encodeReasoningMarker('gpt-5.6-sol', 'gAAAA+/=xyz');
  assert.match(m, /^worca\.rsn\.v1\.[A-Za-z0-9_-]+\.gAAAA\+\/=xyz$/);
  assert.deepEqual(decodeReasoningMarker(m), { model: 'gpt-5.6-sol', encrypted: 'gAAAA+/=xyz' });
  for (const bad of [undefined, null, 42, '', 'EqQBCkgIARAB', 'worca.rsn.v1.', 'worca.rsn.v1.abc', 'worca.rsn.v1..enc', 'worca.rsn.v1.abc.']) {
    assert.equal(decodeReasoningMarker(bad), null, String(bad));
  }
});

test('request (chat): a stored effort list reaches reasoning_effort too; without one the old table applies', () => {
  const body = { messages: [{ role: 'user', content: 'x' }], output_config: { effort: 'max' } };
  assert.equal(toChatRequest(body, { upstreamModel: M, capabilities: { reasoning: true, reasoningEfforts: ['low', 'medium', 'high', 'xhigh'] } }).body.reasoning_effort, 'xhigh');
  assert.equal(toChatRequest(body, { upstreamModel: M, capabilities: { reasoning: true } }).body.reasoning_effort, 'high');
});

test('errors: an upstream that serves the model through the other API → 400 with the fix; non-JSON bodies still map', () => {
  const e = mapUpstreamError(400, '{"error":{"message":"model \\"gpt-5.6-sol\\" is not accessible via the /chat/completions endpoint","code":"unsupported_api_for_model"}}', { provider: 'copilot' });
  assert.equal(e.status, 400);
  assert.equal(e.body.error.type, 'invalid_request_error');
  assert.equal(e.body.error.message, 'copilot: model "gpt-5.6-sol" is not accessible via the /chat/completions endpoint — this model needs a different API: re-import it (Settings › Models › Import models…) or change its API in the model editor');
  const g = mapUpstreamError(400, '{"error":{"message":"model gemini-3.8-flash does not support Responses API.","code":"unsupported_api_for_model"}}', { provider: 'copilot' });
  assert.match(g.body.error.message, /does not support Responses API\. — this model needs a different API: re-import it/);
  const byCode = mapUpstreamError(400, '{"error":{"message":"nope","code":"unsupported_api_for_model"}}', { provider: 'openai' });
  assert.equal(byCode.body.error.message, 'openai: nope — this model needs a different API: change its API in the model editor');
  const html = mapUpstreamError(400, '<html>bad gateway</html>', { provider: 'openai' });
  assert.equal(html.body.error.message, 'openai: request rejected (400) — <html>bad gateway</html>');
  const ctx = mapUpstreamError(400, '{"error":{"message":"maximum context length exceeded"}}', { provider: 'copilot' });
  assert.equal(ctx.body.error.message, PROMPT_TOO_LONG);
});

test('errors: a context overflow is known by its code or its wording — OpenAI\'s Responses message and Copilot\'s limit check both become "prompt is too long"', () => {
  const openai = mapUpstreamError(400, '{"error":{"message":"Your input exceeds the context window of this model. Please adjust your input and try again.","code":"context_length_exceeded"}}', { provider: 'openai' });
  assert.deepEqual([openai.status, openai.body.error.type, openai.body.error.message], [400, 'invalid_request_error', PROMPT_TOO_LONG]);
  const copilot = mapUpstreamError(400, '{"error":{"message":"prompt token count of 140000 exceeds the limit of 128000","code":"model_max_prompt_tokens_exceeded"}}', { provider: 'copilot' });
  assert.equal(copilot.body.error.message, PROMPT_TOO_LONG);
  assert.equal(isContextOverflow('context_length_exceeded', ''), true);
  assert.equal(isContextOverflow('', 'Your input exceeds the context window of this model.'), true);
  assert.equal(isContextOverflow(undefined, 'maximum context length is 128000 tokens'), true);
  assert.equal(isContextOverflow('rate_limit_exceeded', 'slow down'), false);
  assert.equal(isContextOverflow(undefined, undefined), false);
  // A 5xx is never read as an overflow.
  assert.equal(mapUpstreamError(500, '{"error":{"message":"x","code":"context_length_exceeded"}}', { provider: 'openai' }).status, 502);
  // Inside a 200 (a stream's response.failed, a buffered status "failed") no status narrows the broad phrases:
  // a code or wording that names another failure wins, so a rate limit or a timeout never makes the CLI compact.
  assert.equal(isFailedResponseOverflow('context_length_exceeded', 'x'), true);
  assert.equal(isFailedResponseOverflow('invalid_request_error', 'This model\'s maximum context length is 128000 tokens.'), true);
  assert.equal(isFailedResponseOverflow(undefined, 'Your input exceeds the context window of this model.'), true);
  assert.equal(isFailedResponseOverflow('rate_limit_exceeded', 'Request too large for gpt-5 on tokens per min (TPM): Limit 30000, Requested 45000.'), false);
  assert.equal(isFailedResponseOverflow('server_error', 'the model took too long to respond'), false);
  assert.equal(isFailedResponseOverflow(undefined, 'Upstream request timed out: the model took too long to respond'), false);
  assert.equal(isFailedResponseOverflow(undefined, undefined), false);
  // The HTTP 400 path keeps its wider reading (a 429 / 5xx never reaches it).
  assert.equal(isContextOverflow(undefined, 'Upstream request timed out: the model took too long to respond'), true);
});
