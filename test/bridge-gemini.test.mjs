// test/bridge-gemini.test.mjs
// Gemini through the openai-chat bridge (docs/models.md › Gemini and Qwen models): a tool call's `extra_content`
// (Gemini 3's thought signature) is kept by tool call id, streamed or buffered, and handed back on the next request;
// a call the bridge no longer knows gets Google's stand-in signature on a Gemini base URL only.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isGemini, adaptGeminiChatBody, ExtraContentStore, GEMINI_SKIP_SIGNATURE } from '../src/core/bridge/gemini.mjs';
import { toChatRequest } from '../src/core/bridge/translate/request.mjs';
import { ChatStreamTranslator } from '../src/core/bridge/translate/stream.mjs';
import { toMessagesResponse } from '../src/core/bridge/translate/response.mjs';
import { handleMessages, _resetBridgeWarnings } from '../src/core/bridge/upstream.mjs';
import { _resetBridgeTelemetry } from '../src/core/bridge/telemetry.mjs';
import { GEMINI_OPENAI_BASE_URL } from '../src/core/model-env.mjs';
import { checkRows } from './helpers/rows.mjs';

const SIG = { google: { thought_signature: 'c2lnLW9uZQ==' } };

test('the Gemini pieces: base URL, store, stand-in signature, translators', async () => {
  await checkRows([
    { name: 'isGemini: Google\'s OpenAI-compatible host only', run: async () => {
      assert.equal(isGemini(GEMINI_OPENAI_BASE_URL), true);
      assert.equal(isGemini('https://generativelanguage.googleapis.com/v1beta/openai/'), true);
      assert.equal(isGemini('https://openrouter.ai/api/v1'), false);
      assert.equal(isGemini('https://evil.example.com/generativelanguage.googleapis.com'), false);
      assert.equal(isGemini(''), false);
    } },
    { name: 'ExtraContentStore: bounded, oldest out first, a re-set refreshes', run: async () => {
      const s = new ExtraContentStore(2);
      s.set('a', { x: 1 }); s.set('b', { x: 2 }); s.set('a', { x: 3 }); s.set('c', { x: 4 });
      assert.equal(s.get('b'), undefined);
      assert.deepEqual(s.get('a'), { x: 3 });
      assert.equal(s.size, 2);
      s.set('', { x: 5 }); s.set('d', null);
      assert.equal(s.size, 2);
    } },
    { name: 'adaptGeminiChatBody: a tool turn without any signature gets the stand-in on its first call; signed turns and others are untouched', run: async () => {
      const body = { model: 'gemini-3-flash', messages: [
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: null, tool_calls: [{ id: '1', type: 'function', function: { name: 'a', arguments: '{}' } }, { id: '2', type: 'function', function: { name: 'b', arguments: '{}' } }] },
        { role: 'tool', tool_call_id: '1', content: 'x' },
        { role: 'assistant', content: null, tool_calls: [{ id: '3', type: 'function', function: { name: 'a', arguments: '{}' }, extra_content: SIG }] },
        { role: 'assistant', content: 'done' },
      ] };
      const out = adaptGeminiChatBody(body);
      assert.equal(out.messages[1].tool_calls[0].extra_content.google.thought_signature, GEMINI_SKIP_SIGNATURE);
      assert.equal(out.messages[1].tool_calls[1].extra_content, undefined);
      assert.deepEqual(out.messages[3], body.messages[3]);
      assert.equal(body.messages[1].tool_calls[0].extra_content, undefined, 'the input is not mutated');
      const plain = { model: 'm', messages: [{ role: 'user', content: 'x' }] };
      assert.equal(adaptGeminiChatBody(plain), plain);
    } },
    { name: 'toChatRequest: extraContentFor puts a call\'s extra_content back on it; none is added otherwise', run: async () => {
      const body = { model: 'g', max_tokens: 10, messages: [
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: [{ type: 'tool_use', id: 'call_1', name: 'Read', input: { p: 1 } }, { type: 'tool_use', id: 'call_2', name: 'Read', input: {} }] },
        { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'call_1', content: 'ok' }, { type: 'tool_result', tool_use_id: 'call_2', content: 'ok' }] },
      ] };
      const t = toChatRequest(body, { upstreamModel: 'g', extraContentFor: (id) => (id === 'call_1' ? SIG : undefined) });
      const calls = t.body.messages[1].tool_calls;
      assert.deepEqual(calls[0].extra_content, SIG);
      assert.equal('extra_content' in calls[1], false);
      assert.equal('extra_content' in toChatRequest(body, { upstreamModel: 'g' }).body.messages[1].tool_calls[0], false);
    } },
    { name: 'ChatStreamTranslator / toMessagesResponse: each tool call\'s extra_content is reported under the id the CLI sees', run: async () => {
      const seen = [];
      const tr = new ChatStreamTranslator({ model: 'gem', onExtraContent: (id, extra) => seen.push([id, extra]) });
      tr.push({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_a', function: { name: 'Read', arguments: '{"p":' } }] } }] });
      tr.push({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '1}' }, extra_content: SIG }] } }] });
      tr.push({ choices: [{ delta: { tool_calls: [{ index: 1, function: { name: 'Glob', arguments: '{}' } }] }, finish_reason: 'tool_calls' }] });
      tr.finish();
      assert.deepEqual(seen, [['call_a', SIG]]);

      const got = [];
      const msg = toMessagesResponse({ choices: [{ message: { role: 'assistant', content: null, tool_calls: [
        { function: { name: 'Read', arguments: '{}' }, extra_content: SIG },
        { id: 'call_c', function: { name: 'Glob', arguments: '{}' } },
      ] }, finish_reason: 'tool_calls' }] }, { model: 'gem', onExtraContent: (id, extra) => got.push([id, extra]) });
      assert.equal(got.length, 1);
      assert.equal(got[0][0], msg.content[0].id, 'a minted id is the one stored');
      assert.deepEqual(got[0][1], SIG);
    } },
  ]);
});

// ── end to end through handleMessages ──────────────────────────────────────

let home;
const prevEnv = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, WORCA_TEST_ALLOW_HOME_FALLBACK: process.env.WORCA_TEST_ALLOW_HOME_FALLBACK };
before(async () => {
  home = await mkdtemp(join(tmpdir(), 'worca-cc-gemini-'));
  process.env.HOME = home; process.env.USERPROFILE = home; process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = '1';
});
after(async () => {
  for (const k of Object.keys(prevEnv)) { if (prevEnv[k] === undefined) delete process.env[k]; else process.env[k] = prevEnv[k]; }
  await rm(home, { recursive: true, force: true });
});

function fakeReply() {
  const r = { statusCode: 0, chunks: [], body: null };
  return Object.assign(r, {
    status(code) { r.statusCode = code; },
    write(c) { r.chunks.push(typeof c === 'string' ? c : Buffer.from(c).toString()); },
    end() {},
    json(status, obj) { r.statusCode = status; r.body = obj; },
  });
}
const sse = (chunks) => new Response(chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join('') + 'data: [DONE]\n\n', { status: 200, headers: { 'content-type': 'text/event-stream' } });
const entryFor = (baseUrl) => ({ id: 'gemini-3-flash', upstream: { provider: 'openai', api: 'openai-chat', model: 'gemini-3-flash', baseUrl, apiKey: 'k', capabilities: { reasoning: true } } });
const followUp = (id) => ({ model: 'gemini-3-flash', max_tokens: 100, stream: true, messages: [
  { role: 'user', content: 'list projects' },
  { role: 'assistant', content: [{ type: 'tool_use', id, name: 'mcp__worca__list_projects', input: {} }] },
  { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: '[]' }] },
] });

test('handleMessages → Gemini: the signature streamed on a tool call comes back on the next request; an unknown call gets the stand-in', async () => {
  _resetBridgeTelemetry(); _resetBridgeWarnings();
  const sent = [];
  let turn = 0;
  const fetch = async (url, init) => {
    sent.push(JSON.parse(init.body));
    turn += 1;
    return turn === 1
      ? sse([{ choices: [{ delta: { tool_calls: [{ index: 0, id: 'gem_call_1', function: { name: 'mcp__worca__list_projects', arguments: '{}' }, extra_content: SIG }] }, finish_reason: 'tool_calls' }] }])
      : sse([{ choices: [{ delta: { content: 'none' }, finish_reason: 'stop' }] }]);
  };
  const entry = entryFor(GEMINI_OPENAI_BASE_URL);
  await handleMessages({ entry, body: { model: 'gemini-3-flash', max_tokens: 100, stream: true, messages: [{ role: 'user', content: 'list projects' }] }, fetch, log: () => {} }, fakeReply());
  await handleMessages({ entry, body: followUp('gem_call_1'), fetch, log: () => {} }, fakeReply());
  assert.deepEqual(sent[1].messages[1].tool_calls[0].extra_content, SIG);

  await handleMessages({ entry, body: followUp('call_from_before_a_restart'), fetch, log: () => {} }, fakeReply());
  assert.equal(sent[2].messages[1].tool_calls[0].extra_content.google.thought_signature, GEMINI_SKIP_SIGNATURE);
});

test('handleMessages → another OpenAI-compatible endpoint: no stand-in signature is invented', async () => {
  _resetBridgeTelemetry(); _resetBridgeWarnings();
  const sent = [];
  const fetch = async (url, init) => { sent.push(JSON.parse(init.body)); return sse([{ choices: [{ delta: { content: 'ok' }, finish_reason: 'stop' }] }]); };
  await handleMessages({ entry: entryFor('https://dashscope-intl.aliyuncs.com/compatible-mode/v1'), body: followUp('call_x'), fetch, log: () => {} }, fakeReply());
  assert.equal('extra_content' in sent[0].messages[1].tool_calls[0], false);
});
