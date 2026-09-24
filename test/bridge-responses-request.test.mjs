// test/bridge-responses-request.test.mjs
// The pure Messages → OpenAI Responses request mapper
// (2026-09-23-bridge-openai-responses-design.md §7): top-level fields, the
// input-item mapping and its ordering, reasoning replay through the marker,
// tools, tool_choice, sampling and effort.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toResponsesRequest } from '../src/core/bridge/translate/responses-request.mjs';
import { encodeReasoningMarker } from '../src/core/bridge/translate/common.mjs';

const M = 'gpt-r';

test('request: system → instructions, store:false, max_output_tokens, stream without stream_options', () => {
  const r = toResponsesRequest({
    system: [{ type: 'text', text: 'A', cache_control: { type: 'ephemeral' } }, { type: 'text', text: 'B' }],
    messages: [{ role: 'user', content: 'hi' }],
    max_tokens: 100,
    stream: true,
  }, { upstreamModel: M });
  assert.equal(r.error, undefined);
  assert.deepEqual(r.body, {
    model: M,
    instructions: 'A\n\nB',
    input: [{ role: 'user', content: [{ type: 'input_text', text: 'hi' }] }],
    store: false,
    max_output_tokens: 100,
    stream: true,
  });
  assert.deepEqual(r.warnings, ['cache_control']);
});

test('request: a tool loop maps to input items in order — reasoning replayed, call/output paired, mid-conversation system kept', () => {
  const r = toResponsesRequest({
    messages: [
      { role: 'user', content: 'read it' },
      { role: 'system', content: [{ type: 'text', text: 'Be brief.' }] },
      { role: 'assistant', content: [
        { type: 'thinking', thinking: 'plan', signature: encodeReasoningMarker(M, 'ENC1') },
        { type: 'text', text: 'ok' },
        { type: 'tool_use', id: 'toolu_1', name: 'Read', input: { path: 'a' } },
      ] },
      { role: 'user', content: [
        { type: 'text', text: 'and now?' },
        { type: 'tool_result', tool_use_id: 'toolu_1', content: [{ type: 'text', text: 'file body' }] },
      ] },
    ],
  }, { upstreamModel: M });
  assert.deepEqual(r.body.input, [
    { role: 'user', content: [{ type: 'input_text', text: 'read it' }] },
    { role: 'system', content: [{ type: 'input_text', text: 'Be brief.' }] },
    { type: 'reasoning', summary: [{ type: 'summary_text', text: 'plan' }], encrypted_content: 'ENC1' },
    { role: 'assistant', content: [{ type: 'output_text', text: 'ok' }] },
    { type: 'function_call', call_id: 'toolu_1', name: 'Read', arguments: '{"path":"a"}' },
    { type: 'function_call_output', call_id: 'toolu_1', output: 'file body' },
    { role: 'user', content: [{ type: 'input_text', text: 'and now?' }] },
  ]);
  assert.deepEqual(r.warnings, []);
});

test('request: only this upstream model\'s reasoning is replayed; foreign, Claude and malformed blocks are dropped', () => {
  const r = toResponsesRequest({
    messages: [
      { role: 'user', content: 'x' },
      { role: 'assistant', content: [{ type: 'redacted_thinking', data: encodeReasoningMarker(M, 'E2') }, { type: 'text', text: 'a' }] },
      { role: 'user', content: 'y' },
      { role: 'assistant', content: [
        { type: 'thinking', thinking: 't', signature: encodeReasoningMarker('gpt-other', 'E3') },
        { type: 'thinking', thinking: 'c', signature: 'EqQBCkgIARABGAIiQ' },
        { type: 'redacted_thinking', data: 'worca.rsn.v1.' },
      ] },
      { role: 'user', content: 'z' },
    ],
  }, { upstreamModel: M });
  assert.deepEqual(r.body.input, [
    { role: 'user', content: [{ type: 'input_text', text: 'x' }] },
    { type: 'reasoning', summary: [], encrypted_content: 'E2' },
    { role: 'assistant', content: [{ type: 'output_text', text: 'a' }] },
    { role: 'user', content: [{ type: 'input_text', text: 'y' }, { type: 'input_text', text: 'z' }] },
  ]);
  assert.deepEqual(r.warnings, ['thinking']);
});

test('request: another model\'s reasoning is dropped even when the turn goes on (text / tool_use after it)', () => {
  const r = toResponsesRequest({
    messages: [
      { role: 'user', content: 'x' },
      { role: 'assistant', content: [
        { type: 'thinking', thinking: 't', signature: encodeReasoningMarker('gpt-other', 'E3') },
        { type: 'text', text: 'a' },
        { type: 'redacted_thinking', data: encodeReasoningMarker('gpt-other', 'E4') },
        { type: 'tool_use', id: 'toolu_1', name: 'Read', input: {} },
      ] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'ok' }] },
    ],
  }, { upstreamModel: M });
  assert.deepEqual(r.body.input, [
    { role: 'user', content: [{ type: 'input_text', text: 'x' }] },
    { role: 'assistant', content: [{ type: 'output_text', text: 'a' }] },
    { type: 'function_call', call_id: 'toolu_1', name: 'Read', arguments: '{}' },
    { type: 'function_call_output', call_id: 'toolu_1', output: 'ok' },
  ]);
  assert.deepEqual(r.warnings, ['thinking']);
});

test('request: a reasoning-only assistant turn is not replayed — a reasoning item always has the item it was produced with after it', () => {
  const r = toResponsesRequest({
    messages: [
      { role: 'user', content: 'q' },
      { role: 'assistant', content: [{ type: 'thinking', thinking: 'plan', signature: encodeReasoningMarker(M, 'E1') }] },
      { role: 'user', content: 'again' },
      { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'Read', input: {} }, { type: 'redacted_thinking', data: encodeReasoningMarker(M, 'E2') }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }] },
    ],
  }, { upstreamModel: M });
  assert.deepEqual(r.body.input, [
    { role: 'user', content: [{ type: 'input_text', text: 'q' }, { type: 'input_text', text: 'again' }] },
    { type: 'function_call', call_id: 't1', name: 'Read', arguments: '{}' },
    { type: 'function_call_output', call_id: 't1', output: 'ok' },
  ]);
  assert.deepEqual(r.warnings, ['thinking']);
});

test('request: images, documents, tool-result images, tool references and error results', () => {
  const img = { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAA' } };
  const r = toResponsesRequest({
    messages: [
      { role: 'user', content: [{ type: 'text', text: 'look' }, img, { type: 'document', source: {} }] },
      { role: 'assistant', content: [
        { type: 'tool_use', id: 'c1', name: 'Shot', input: {} },
        { type: 'tool_use', id: 'c2', name: 'ToolSearch', input: {} },
        { type: 'tool_use', id: 'c3', name: 'Bash', input: {} },
      ] },
      { role: 'user', content: [
        { type: 'tool_result', tool_use_id: 'c1', content: [{ type: 'text', text: 'shot' }, img] },
        { type: 'tool_result', tool_use_id: 'c2', content: [{ type: 'tool_reference', tool_name: 'mcp__x__y' }] },
        { type: 'tool_result', tool_use_id: 'c3', content: '', is_error: true },
      ] },
    ],
  }, { upstreamModel: M, capabilities: { vision: true } });
  const inp = r.body.input;
  assert.deepEqual(inp[0], { role: 'user', content: [
    { type: 'input_text', text: 'look' },
    { type: 'input_image', image_url: 'data:image/png;base64,AAA' },
    { type: 'input_text', text: '[document omitted: not supported by this model]' },
  ] });
  assert.deepEqual(inp.slice(1, 4).map((i) => [i.type, i.call_id, i.arguments]), [['function_call', 'c1', '{}'], ['function_call', 'c2', '{}'], ['function_call', 'c3', '{}']]);
  assert.deepEqual(inp.slice(4), [
    { type: 'function_call_output', call_id: 'c1', output: 'shot' },
    { type: 'function_call_output', call_id: 'c2', output: 'Tool loaded: mcp__x__y' },
    { type: 'function_call_output', call_id: 'c3', output: 'error' },
    { role: 'user', content: [{ type: 'input_image', image_url: 'data:image/png;base64,AAA' }] },
  ]);
  assert.deepEqual(r.warnings, ['document']);
  const nv = toResponsesRequest({ messages: [{ role: 'user', content: [img] }] }, { upstreamModel: M, capabilities: { vision: false } });
  assert.deepEqual(nv.body.input[0].content, [{ type: 'input_text', text: '[image omitted: model has no vision]' }]);
  assert.deepEqual(nv.warnings, ['image']);
});

test('request: tools are flat function tools; deferred ones wait for a tool_reference; tool_choice and parallel map', () => {
  const tools = [
    { name: 'Read', description: 'read a file', input_schema: { type: 'object', properties: { p: { type: 'string' } } } },
    { name: 'mcp__x__y', description: 'deferred', input_schema: { type: 'object' }, defer_loading: true },
    { name: 'mcp__x__z', input_schema: { type: 'object' }, defer_loading: true },
  ];
  const msgs = [{ role: 'user', content: [{ type: 'tool_result', tool_use_id: 't', content: [{ type: 'tool_reference', tool_name: 'mcp__x__y' }] }] }];
  const r = toResponsesRequest({ messages: msgs, tools, tool_choice: { type: 'any', disable_parallel_tool_use: true } }, { upstreamModel: M });
  assert.deepEqual(r.body.tools, [
    { type: 'function', name: 'Read', description: 'read a file', parameters: { type: 'object', properties: { p: { type: 'string' } } }, strict: false },
    { type: 'function', name: 'mcp__x__y', description: 'deferred', parameters: { type: 'object' }, strict: false },
  ]);
  assert.equal(r.body.tool_choice, 'required');
  assert.equal(r.body.parallel_tool_calls, false);
  const named = toResponsesRequest({ messages: [], tools: [tools[0]], tool_choice: { type: 'tool', name: 'Read' } }, { upstreamModel: M });
  assert.deepEqual(named.body.tool_choice, { type: 'function', name: 'Read' });
  const noSchema = toResponsesRequest({ messages: [], tools: [{ name: 'Ping' }] }, { upstreamModel: M });
  assert.deepEqual(noSchema.body.tools, [{ type: 'function', name: 'Ping', parameters: { type: 'object', properties: {} }, strict: false }]);
  const none = toResponsesRequest({ messages: [], tool_choice: { type: 'auto' } }, { upstreamModel: M });
  assert.equal('tool_choice' in none.body, false);
  assert.equal('tools' in none.body, false);
});

test('request: a server tool or tools on a model without tool calls is a hard error', () => {
  const st = toResponsesRequest({ messages: [], tools: [{ type: 'web_search_20250305', name: 'web_search' }] }, { upstreamModel: M });
  assert.equal(st.body, undefined);
  assert.equal(st.error.type, 'invalid_request_error');
  assert.equal(st.error.message, 'tool "web_search" is an Anthropic server tool and cannot run through gpt-r (openai-responses bridge)');
  const nt = toResponsesRequest({ messages: [], tools: [{ name: 'Read', input_schema: {} }] }, { upstreamModel: M, capabilities: { toolCalls: false } });
  assert.equal(nt.error.message, 'model gpt-r does not support tool calls');
  assert.equal(toResponsesRequest(null, { upstreamModel: M }).error.message, 'request body must be an object');
});

test('request: reasoning models get a summary + encrypted reasoning every turn, effort mapped to the listed levels; sampling knobs dropped', () => {
  const caps = { reasoning: true, reasoningEfforts: ['low', 'medium', 'high', 'xhigh'], maxOutputTokens: 128000 };
  const r = toResponsesRequest({
    messages: [], max_tokens: 32000, temperature: 0.2, top_p: 0.9, top_k: 5, stop_sequences: ['X'], metadata: { user_id: 'u' },
    thinking: { type: 'adaptive' }, output_config: { effort: 'max' }, context_management: { edits: [] },
  }, { upstreamModel: M, capabilities: caps });
  assert.deepEqual(r.body.reasoning, { summary: 'auto', effort: 'xhigh' });
  assert.deepEqual(r.body.include, ['reasoning.encrypted_content']);
  assert.equal(r.body.max_output_tokens, 32000);
  for (const k of ['temperature', 'top_p', 'top_k', 'stop', 'stop_sequences', 'metadata', 'context_management', 'thinking', 'output_config', 'messages', 'system']) {
    assert.equal(k in r.body, false, k);
  }
  assert.deepEqual([...r.warnings].sort(), ['metadata', 'stop_sequences', 'temperature', 'top_k', 'top_p']);
  const noEffort = toResponsesRequest({ messages: [], thinking: { type: 'adaptive' } }, { upstreamModel: M, capabilities: { reasoning: true } });
  assert.deepEqual(noEffort.body.reasoning, { summary: 'auto' });
  assert.deepEqual(noEffort.body.include, ['reasoning.encrypted_content']);
  const plain = toResponsesRequest({ messages: [], temperature: 0.2, output_config: { effort: 'high' } }, { upstreamModel: M });
  assert.equal(plain.body.temperature, 0.2);
  assert.equal('reasoning' in plain.body, false);
  assert.equal('include' in plain.body, false);
  assert.deepEqual(plain.warnings, ['thinking']);
});

test('request: max_output_tokens is clamped to the model limit and never below 16', () => {
  const c = toResponsesRequest({ messages: [], max_tokens: 50000 }, { upstreamModel: M, capabilities: { maxOutputTokens: 8192 } });
  assert.equal(c.body.max_output_tokens, 8192);
  assert.deepEqual(c.warnings, ['max_tokens clamped']);
  assert.equal(toResponsesRequest({ messages: [], max_tokens: 5 }, { upstreamModel: M }).body.max_output_tokens, 16);
  assert.equal('max_output_tokens' in toResponsesRequest({ messages: [] }, { upstreamModel: M }).body, false);
});
