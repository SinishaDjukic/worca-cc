// test/bridge-responses-stream.test.mjs
// The OpenAI Responses → Anthropic Messages response mappers
// (2026-09-23-bridge-openai-responses-design.md §9): the streaming state
// machine driven by a recorded Copilot capture and by hand-built edge cases,
// and the buffered (non-streaming) mapper.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ResponsesStreamTranslator, toMessagesResponseFromResponses, mapResponsesUsage } from '../src/core/bridge/translate/responses-stream.mjs';
import { SseDataParser } from '../src/core/bridge/translate/stream.mjs';
import { encodeReasoningMarker } from '../src/core/bridge/translate/common.mjs';

const M = 'gpt-r';
function run(events) {
  const t = new ResponsesStreamTranslator({ model: 'copilot-gpt-r', upstreamModel: M });
  const out = [];
  for (const e of events) out.push(...t.push(e));
  out.push(...t.finish());
  return out;
}
const names = (evs) => evs.map((e) => (e.event === 'content_block_delta' ? `delta:${e.data.delta.type}`
  : e.event === 'content_block_start' ? `start:${e.data.content_block.type}` : e.event));
const added = (i, item) => ({ type: 'response.output_item.added', output_index: i, item });
const done = (i, item) => ({ type: 'response.output_item.done', output_index: i, item });
const completed = (usage = { input_tokens: 10, output_tokens: 2 }) => ({ type: 'response.completed', response: { status: 'completed', usage } });

test('stream: the recorded Copilot capture — reasoning, text, two parallel calls — maps to the exact Anthropic sequence', () => {
  const parser = new SseDataParser();
  const objs = parser.feed(readFileSync(new URL('./fixtures/bridge/copilot-responses-reasoning-tools.sse', import.meta.url), 'utf8'));
  objs.push(...parser.end());
  const ev = run(objs);
  assert.deepEqual(names(ev), [
    'message_start',
    'start:thinking', 'delta:thinking_delta', 'delta:thinking_delta', 'delta:thinking_delta', 'delta:signature_delta', 'content_block_stop',
    'start:text', 'delta:text_delta', 'delta:text_delta', 'delta:text_delta', 'content_block_stop',
    'start:tool_use', 'delta:input_json_delta', 'content_block_stop',
    'start:tool_use', 'delta:input_json_delta', 'content_block_stop',
    'message_delta', 'message_stop',
  ]);
  assert.deepEqual(ev.map((e) => e.data.index).filter((x) => x !== undefined), [0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 2, 2, 2, 3, 3, 3]);
  assert.equal(ev[0].data.message.model, 'copilot-gpt-r');
  const thinking = ev.filter((e) => e.data.delta?.type === 'thinking_delta').map((e) => e.data.delta.thinking).join('');
  assert.equal(thinking, '**Comparing decimals**\n\n9.9 is larger; then read both files.');
  // The done item's encrypted_content, not the preliminary one on output_item.added.
  assert.equal(ev.find((e) => e.data.delta?.type === 'signature_delta').data.delta.signature, encodeReasoningMarker(M, 'ENC_FINAL'));
  const text = ev.filter((e) => e.data.delta?.type === 'text_delta').map((e) => e.data.delta.text).join('');
  assert.equal(text, '9.9 is larger than 9.11.');
  const calls = ev.filter((e) => e.event === 'content_block_start' && e.data.content_block.type === 'tool_use').map((e) => e.data.content_block);
  assert.deepEqual(calls.map((c) => [c.id, c.name]), [['call_VL46iRtFNgVqjN9SHm7EVDKW', 'Read'], ['call_k9a9OUT1nfLvI8K5vro7LVFX', 'Read']]);
  assert.deepEqual(ev.filter((e) => e.data.delta?.type === 'input_json_delta').map((e) => e.data.delta.partial_json), ['{"file_path":"/a.txt"}', '{"file_path":"/b.txt"}']);
  const md = ev.at(-2).data;
  assert.equal(md.delta.stop_reason, 'tool_use');
  assert.deepEqual(md.usage, { input_tokens: 90, output_tokens: 118, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 });
});

test('stream: a reasoning item without summary text becomes one redacted_thinking block carrying the marker', () => {
  const ev = run([
    added(0, { type: 'reasoning', encrypted_content: 'PRE', summary: [] }),
    done(0, { type: 'reasoning', encrypted_content: 'FIN', summary: [] }),
    added(1, { type: 'message', content: [] }),
    { type: 'response.output_text.delta', output_index: 1, item_id: 'a', delta: 'hi' },
    done(1, { type: 'message' }),
    completed(),
  ]);
  assert.deepEqual(names(ev), ['message_start', 'start:redacted_thinking', 'content_block_stop', 'start:text', 'delta:text_delta', 'content_block_stop', 'message_delta', 'message_stop']);
  assert.equal(ev[1].data.content_block.data, encodeReasoningMarker(M, 'FIN'));
  assert.equal(ev.at(-2).data.delta.stop_reason, 'end_turn');
});

test('stream: deltas are correlated by output_index — rotating item_ids stay one block; a second summary part gets a blank line', () => {
  const ev = run([
    added(0, { type: 'reasoning', summary: [] }),
    { type: 'response.reasoning_summary_part.added', output_index: 0, item_id: 'x1' },
    { type: 'response.reasoning_summary_text.delta', output_index: 0, item_id: 'x2', delta: 'one' },
    { type: 'response.reasoning_summary_part.added', output_index: 0, item_id: 'x3' },
    { type: 'response.reasoning_summary_text.delta', output_index: 0, item_id: 'x4', delta: 'two' },
    done(0, { type: 'reasoning', summary: [] }),   // no encrypted_content: no signature_delta
    completed(),
  ]);
  assert.deepEqual(names(ev), ['message_start', 'start:thinking', 'delta:thinking_delta', 'delta:thinking_delta', 'delta:thinking_delta', 'content_block_stop', 'message_delta', 'message_stop']);
  assert.deepEqual(ev.filter((e) => e.data.delta?.type === 'thinking_delta').map((e) => e.data.delta.thinking), ['one', '\n\n', 'two']);
});

test('stream: two items of the same kind at different output_index values are two blocks', () => {
  const ev = run([
    added(0, { type: 'message' }),
    { type: 'response.output_text.delta', output_index: 0, delta: 'first' },
    added(1, { type: 'message' }),
    { type: 'response.output_text.delta', output_index: 1, delta: 'second' },
    completed(),
  ]);
  assert.deepEqual(names(ev), ['message_start', 'start:text', 'delta:text_delta', 'content_block_stop', 'start:text', 'delta:text_delta', 'content_block_stop', 'message_delta', 'message_stop']);
});

test('stream: a reasoning item whose thinking block was closed early (items interleaved) still hands its encrypted reasoning on', () => {
  const ev = run([
    added(0, { type: 'reasoning', summary: [] }),
    { type: 'response.reasoning_summary_text.delta', output_index: 0, delta: 'first thought' },
    added(1, { type: 'reasoning', summary: [] }),
    { type: 'response.reasoning_summary_text.delta', output_index: 1, delta: 'second thought' },
    done(0, { type: 'reasoning', encrypted_content: 'E0', summary: [] }),
    done(1, { type: 'reasoning', encrypted_content: 'E1', summary: [] }),
    completed(),
  ]);
  assert.deepEqual(names(ev), [
    'message_start',
    'start:thinking', 'delta:thinking_delta', 'content_block_stop',                           // item 0, closed by item 1 opening
    'start:thinking', 'delta:thinking_delta', 'content_block_stop',                           // item 1 … closed by item 0's redacted block
    'start:redacted_thinking', 'content_block_stop',                                          // item 0's reasoning, not lost
    'start:redacted_thinking', 'content_block_stop',                                          // item 1's (its block was closed above)
    'message_delta', 'message_stop',
  ]);
  const redacted = ev.filter((e) => e.data.content_block?.type === 'redacted_thinking').map((e) => e.data.content_block.data);
  assert.deepEqual(redacted, [encodeReasoningMarker(M, 'E0'), encodeReasoningMarker(M, 'E1')]);
});

test('stream: an incomplete response cut mid tool call drops the call, says why and stops with max_tokens', () => {
  const ev = run([
    added(0, { type: 'function_call', call_id: 'c1', name: 'Write', arguments: '' }),
    { type: 'response.function_call_arguments.delta', output_index: 0, delta: '{"file_path":"/x","content":"abc' },
    { type: 'response.incomplete', response: { status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' }, usage: { input_tokens: 5, output_tokens: 9 } } },
  ]);
  assert.deepEqual(names(ev), ['message_start', 'start:text', 'delta:text_delta', 'content_block_stop', 'message_delta', 'message_stop']);
  assert.match(ev[2].data.delta.text, /the Write call was cut off/);
  assert.equal(ev.at(-2).data.delta.stop_reason, 'max_tokens');
  // A done item that is itself marked incomplete is dropped the same way.
  const ev2 = run([
    done(0, { type: 'function_call', call_id: 'c1', name: 'Write', arguments: '{"a":1}', status: 'incomplete' }),
    { type: 'response.incomplete', response: { incomplete_details: { reason: 'max_output_tokens' } } },
  ]);
  assert.equal(ev2.some((e) => e.data.content_block?.type === 'tool_use'), false);
  assert.equal(ev2.at(-2).data.delta.stop_reason, 'max_tokens');
});

test('stream: a call whose item never finished is emitted when its arguments are complete JSON; refusal text streams as text', () => {
  const ev = run([
    added(0, { type: 'message' }),
    { type: 'response.refusal.delta', output_index: 0, delta: 'I can\'t' },
    added(1, { type: 'function_call', call_id: 'c9', name: 'Read', arguments: '' }),
    { type: 'response.function_call_arguments.delta', output_index: 1, delta: '{"p":"a"}' },
  ]);
  assert.deepEqual(names(ev), ['message_start', 'start:text', 'delta:text_delta', 'content_block_stop', 'start:tool_use', 'delta:input_json_delta', 'content_block_stop', 'message_delta', 'message_stop']);
  assert.equal(ev[4].data.content_block.id, 'c9');
  assert.equal(ev.at(-2).data.delta.stop_reason, 'tool_use');
  // A done item whose arguments came back empty keeps the arguments that streamed in.
  const emptyDone = run([
    added(0, { type: 'function_call', call_id: 'c7', name: 'Read', arguments: '' }),
    { type: 'response.function_call_arguments.delta', output_index: 0, delta: '{"p":"a"}' },
    done(0, { type: 'function_call', call_id: 'c7', name: 'Read', arguments: '', status: 'completed' }),
    completed(),
  ]);
  assert.equal(emptyDone.find((e) => e.data.delta?.type === 'input_json_delta').data.delta.partial_json, '{"p":"a"}');
  // A call cut before any argument arrived is a note, never a runnable call with empty input.
  const bare = run([added(0, { type: 'function_call', call_id: 'c8', name: 'Bash', arguments: '' })]);
  assert.deepEqual(names(bare), ['message_start', 'start:text', 'delta:text_delta', 'content_block_stop', 'message_delta', 'message_stop']);
  assert.match(bare[2].data.delta.text, /the Bash call was cut off/);
  assert.equal(bare.at(-2).data.delta.stop_reason, 'end_turn');
});

test('stream: content_filter ends the turn; failed and error events surface as an SSE error; a cut stream ends cleanly only if something was said', () => {
  const cf = run([added(0, { type: 'message' }), { type: 'response.output_text.delta', output_index: 0, delta: 'x' }, { type: 'response.incomplete', response: { incomplete_details: { reason: 'content_filter' } } }]);
  assert.equal(cf.at(-2).data.delta.stop_reason, 'end_turn');
  const failed = run([{ type: 'response.failed', response: { status: 'failed', error: { code: 'server_error', message: 'boom' } } }]);
  assert.deepEqual(names(failed), ['message_start', 'error']);
  assert.deepEqual(failed[1].data, { type: 'error', error: { type: 'api_error', message: 'upstream stream error: boom' } });
  const err = run([added(0, { type: 'message' }), { type: 'response.output_text.delta', output_index: 0, delta: 'x' }, { type: 'error', code: 'rate_limit', message: 'slow down' }]);
  assert.deepEqual(names(err), ['message_start', 'start:text', 'delta:text_delta', 'content_block_stop', 'error']);
  assert.equal(err.at(-1).data.error.message, 'upstream stream error: slow down');
  const nested = run([{ type: 'error', error: { type: 'server_error', message: 'nested boom' } }]);
  assert.equal(nested.at(-1).data.error.message, 'upstream stream error: nested boom');
  const empty = run([{ type: 'response.created', response: {} }, { copilot_usage: { total_nano_aiu: 1 } }]);
  assert.deepEqual(names(empty), ['message_start', 'error']);
  const cut = run([added(0, { type: 'message' }), { type: 'response.output_text.delta', output_index: 0, delta: 'partial' }]);
  assert.deepEqual(names(cut), ['message_start', 'start:text', 'delta:text_delta', 'content_block_stop', 'message_delta', 'message_stop']);
  assert.equal(cut.at(-2).data.delta.stop_reason, 'end_turn');
});

test('buffered: output items map to thinking / redacted / text / tool_use; incomplete + truncated call → note and max_tokens', () => {
  const r = toMessagesResponseFromResponses({
    status: 'completed',
    output: [
      { type: 'reasoning', encrypted_content: 'E1', summary: [{ type: 'summary_text', text: 'a' }, { type: 'summary_text', text: 'b' }] },
      { type: 'reasoning', encrypted_content: 'E2', summary: [] },
      { type: 'message', content: [{ type: 'output_text', text: 'hi' }, { type: 'refusal', refusal: '!' }] },
      { type: 'function_call', call_id: 'c1', name: 'Read', arguments: '{"p":"x"}', status: 'completed' },
    ],
    usage: { input_tokens: 7, input_tokens_details: { cached_tokens: 3 }, output_tokens: 4 },
  }, { model: 'copilot-gpt-r', upstreamModel: M });
  assert.equal(r.type, 'message');
  assert.equal(r.role, 'assistant');
  assert.equal(r.model, 'copilot-gpt-r');
  assert.deepEqual(r.content, [
    { type: 'thinking', thinking: 'a\n\nb', signature: encodeReasoningMarker(M, 'E1') },
    { type: 'redacted_thinking', data: encodeReasoningMarker(M, 'E2') },
    { type: 'text', text: 'hi!' },
    { type: 'tool_use', id: 'c1', name: 'Read', input: { p: 'x' } },
  ]);
  assert.equal(r.stop_reason, 'tool_use');
  assert.deepEqual(r.usage, { input_tokens: 4, output_tokens: 4, cache_read_input_tokens: 3, cache_creation_input_tokens: 0 });
  const cut = toMessagesResponseFromResponses({ status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' }, output: [{ type: 'function_call', call_id: 'c2', name: 'Write', arguments: '{"a":', status: 'incomplete' }] }, { model: 'x', upstreamModel: M });
  assert.equal(cut.stop_reason, 'max_tokens');
  assert.match(cut.content[0].text, /the Write call was cut off/);
  // An item the upstream marks incomplete is not run even when its arguments happen to parse.
  const parsedButCut = toMessagesResponseFromResponses({ status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' }, output: [{ type: 'function_call', call_id: 'c3', name: 'Bash', arguments: '{"command":"ls"}', status: 'incomplete' }] }, { model: 'x', upstreamModel: M });
  assert.deepEqual(parsedButCut.content.map((b) => b.type), ['text']);
  assert.match(parsedButCut.content[0].text, /the Bash call was cut off/);
  assert.deepEqual(mapResponsesUsage(undefined), { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 });
});

test('stream: the first failure is the last word — nothing after it, however the upstream goes on; a bare {error} data line is a failure too', () => {
  const twice = run([
    added(0, { type: 'message' }),
    { type: 'response.output_text.delta', output_index: 0, delta: 'x' },
    { type: 'error', code: 'server_error', message: 'first' },
    { type: 'response.failed', response: { error: { message: 'second' } } },
    added(1, { type: 'function_call', call_id: 'c1', name: 'Read', arguments: '' }),
    done(1, { type: 'function_call', call_id: 'c1', name: 'Read', arguments: '{}', status: 'completed' }),
    completed(),
  ]);
  assert.deepEqual(names(twice), ['message_start', 'start:text', 'delta:text_delta', 'content_block_stop', 'error']);
  assert.equal(twice.at(-1).data.error.message, 'upstream stream error: first');
  const bare = run([
    added(0, { type: 'message' }),
    { type: 'response.output_text.delta', output_index: 0, delta: 'partial' },
    { error: { message: 'upstream exploded', code: 'internal' } },
  ]);
  assert.deepEqual(names(bare), ['message_start', 'start:text', 'delta:text_delta', 'content_block_stop', 'error']);
  assert.equal(bare.at(-1).data.error.message, 'upstream stream error: upstream exploded');
  assert.equal(run([{ error: 'plain words' }]).at(-1).data.error.message, 'upstream stream error: plain words');
});

test('stream: a context overflow in the stream is the "prompt is too long" error the CLI compacts on — by code or by wording, and only an overflow', () => {
  const byCode = run([{ type: 'response.failed', response: { status: 'failed', error: { code: 'context_length_exceeded', message: 'x' } } }]);
  assert.deepEqual(names(byCode), ['message_start', 'error']);
  assert.deepEqual(byCode[1].data, { type: 'error', error: { type: 'invalid_request_error', message: 'prompt is too long' } });
  assert.equal(run([{ type: 'error', message: 'Your input exceeds the context window of this model.' }]).at(-1).data.error.message, 'prompt is too long');
  assert.deepEqual(run([{ type: 'error', code: 'rate_limit_exceeded', message: 'slow down' }]).at(-1).data.error, { type: 'api_error', message: 'upstream stream error: slow down' });
  // "too long" / "Request too large" in a failure that names a timeout or a rate limit is not an overflow.
  assert.deepEqual(run([{ type: 'response.failed', response: { error: { code: 'server_error', message: 'the model took too long to respond' } } }]).at(-1).data.error, { type: 'api_error', message: 'upstream stream error: the model took too long to respond' });
  assert.equal(run([{ type: 'error', code: 'rate_limit_exceeded', message: 'Request too large for gpt-r on tokens per min (TPM): Limit 30000, Requested 45000.' }]).at(-1).data.error.type, 'api_error');
});
