// test/bridge-schema-keywords.test.mjs
// An upstream that compiles tool schemas into a decoding grammar may refuse the
// whole request over one validation keyword (OpenRouter's ModelRun on
// qwen3.8-27b:free: `unsupported schema keyword "maxLength"`). The bridge learns
// the keyword from the 400, drops it from every tool schema, retries, and keeps
// dropping it for that upstream model — a keyword-named PROPERTY is never touched.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { unsupportedSchemaKeyword, dropSchemaKeywords, withToolSchemaKeywordsDropped, refusedToolName, withoutTools } from '../src/core/bridge/translate/schema-keywords.mjs';
import { handleMessages, _resetBridgeWarnings, _resetSchemaKeywordDrops } from '../src/core/bridge/upstream.mjs';
import { _resetBridgeTelemetry } from '../src/core/bridge/telemetry.mjs';

const REFUSAL = 'failed to translate request: folding the request grammar: tool "ListAgents" parameter schema: parameter "channel": unsupported schema keyword "maxLength"';

test('unsupportedSchemaKeyword: names the keyword from the refusal, null for anything else', () => {
  assert.equal(unsupportedSchemaKeyword(REFUSAL), 'maxLength');
  assert.equal(unsupportedSchemaKeyword("unsupported JSON schema keyword: 'pattern'"), 'pattern');
  assert.equal(unsupportedSchemaKeyword('request rejected (400) — bad request'), null);
  assert.equal(unsupportedSchemaKeyword(undefined), null);
});

test('dropSchemaKeywords: every depth, never a property named like the keyword, input untouched', () => {
  const schema = {
    type: 'object',
    properties: {
      channel: { type: 'string', maxLength: 256 },
      maxLength: { type: 'integer', minimum: 1 },   // a PROPERTY called maxLength stays
      tags: { type: 'array', items: { type: 'string', maxLength: 10 } },
      pick: { anyOf: [{ type: 'string', maxLength: 5 }, { type: 'null' }] },
    },
    $defs: { name: { type: 'string', maxLength: 3 } },
  };
  const snapshot = JSON.stringify(schema);
  const out = dropSchemaKeywords(schema, new Set(['maxLength']));
  assert.equal(JSON.stringify(schema), snapshot, 'input not mutated');
  assert.deepEqual(out, {
    type: 'object',
    properties: {
      channel: { type: 'string' },
      maxLength: { type: 'integer', minimum: 1 },
      tags: { type: 'array', items: { type: 'string' } },
      pick: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    },
    $defs: { name: { type: 'string' } },
  });
});

test('withToolSchemaKeywordsDropped: chat and Responses tool shapes; no tools or no drops is a no-op', () => {
  const params = { type: 'object', properties: { c: { type: 'string', maxLength: 9 } } };
  const drop = new Set(['maxLength']);
  const chat = withToolSchemaKeywordsDropped({ tools: [{ type: 'function', function: { name: 'a', parameters: params } }] }, drop);
  assert.deepEqual(chat.tools[0].function.parameters.properties.c, { type: 'string' });
  const resp = withToolSchemaKeywordsDropped({ tools: [{ type: 'function', name: 'a', parameters: params }] }, drop);
  assert.deepEqual(resp.tools[0].parameters.properties.c, { type: 'string' });
  const none = { messages: [] };
  assert.equal(withToolSchemaKeywordsDropped(none, drop), none);
  const body = { tools: [] };
  assert.equal(withToolSchemaKeywordsDropped(body, new Set()), body);
});

// ── through handleMessages ──────────────────────────────────────────────────

let home;
const prevEnv = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, WORCA_TEST_ALLOW_HOME_FALLBACK: process.env.WORCA_TEST_ALLOW_HOME_FALLBACK };
before(async () => {
  home = await mkdtemp(join(tmpdir(), 'worca-cc-schema-kw-'));
  process.env.HOME = home; process.env.USERPROFILE = home; process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = '1';
});
after(async () => {
  for (const k of Object.keys(prevEnv)) { if (prevEnv[k] === undefined) delete process.env[k]; else process.env[k] = prevEnv[k]; }
  await rm(home, { recursive: true, force: true });
});

function fakeReply() {
  const r = { statusCode: 0, headers: null, chunks: [], body: null, ended: false };
  return Object.assign(r, {
    status(code, headers) { r.statusCode = code; r.headers = headers; },
    write(c) { r.chunks.push(typeof c === 'string' ? c : Buffer.from(c).toString()); },
    end() { r.ended = true; },
    json(status, obj, headers) { r.statusCode = status; r.body = obj; r.headers = headers || null; r.ended = true; },
  });
}
const ok = () => new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'OK' }, finish_reason: 'stop' }] }), { status: 200, headers: { 'content-type': 'application/json' } });
// The live shape: OpenRouter nests the provider's own JSON error in metadata.raw.
const refuse = (kw) => new Response(JSON.stringify({ error: { message: 'Provider returned error', code: 400, metadata: { raw: JSON.stringify({ error: { code: '400', message: REFUSAL.replace('maxLength', kw) } }), provider_name: 'ModelRun' } } }), { status: 400, headers: { 'content-type': 'application/json' } });
const entry = { id: 'or-qwen', upstream: { provider: 'openai', api: 'openai-chat', model: 'qwen/qwen3.8-27b:free', baseUrl: 'https://openrouter.ai/api/v1', apiKey: 'sk-test' } };
const body = {
  model: 'or-qwen', max_tokens: 50, messages: [{ role: 'user', content: 'hi' }],
  tools: [{ name: 'ListAgents', description: 'x', input_schema: { type: 'object', properties: { channel: { type: 'string', maxLength: 256, pattern: '^a' } } } }],
};
const channelOf = (b) => b.tools[0].function.parameters.properties.channel;

test('handleMessages: a keyword refusal is learned, dropped and retried — and stays dropped for that model', async () => {
  _resetBridgeTelemetry(); _resetBridgeWarnings(); _resetSchemaKeywordDrops();
  const seen = [];
  const answers = [refuse('maxLength'), refuse('pattern'), ok(), ok()];
  const fetch = async (_url, init) => { seen.push(JSON.parse(init.body)); return answers.shift(); };
  const logs = [];
  const reply = fakeReply();
  await handleMessages({ entry, body, tag: 't1', fetch, log: (l) => logs.push(l) }, reply);
  assert.equal(reply.statusCode, 200);
  assert.equal(seen.length, 3);
  assert.deepEqual(channelOf(seen[0]), { type: 'string', maxLength: 256, pattern: '^a' });
  assert.deepEqual(channelOf(seen[1]), { type: 'string', pattern: '^a' });
  assert.deepEqual(channelOf(seen[2]), { type: 'string' });
  assert.ok(logs.some((l) => /maxLength/.test(l) && /dropping/.test(l)), logs.join('\n'));
  // The next request starts without both keywords: no refusal round trip.
  await handleMessages({ entry, body, tag: 't2', fetch, log: () => {} }, fakeReply());
  assert.equal(seen.length, 4);
  assert.deepEqual(channelOf(seen[3]), { type: 'string' });
});

test('handleMessages: a keyword refusal that repeats after the drop is answered, not looped', async () => {
  _resetBridgeTelemetry(); _resetBridgeWarnings(); _resetSchemaKeywordDrops();
  let calls = 0;
  const fetch = async () => { calls += 1; return refuse('maxLength'); };
  const reply = fakeReply();
  await handleMessages({ entry, body, tag: 't3', fetch, log: () => {} }, reply);
  assert.equal(calls, 2, 'one retry for the one keyword, then the refusal is answered');
  assert.equal(reply.statusCode, 400);
  assert.match(reply.body.error.message, /unsupported schema keyword "maxLength"/);
});

// A tool whose schema the grammar cannot represent at all (the CLI's Workflow
// tool: `args` takes any JSON value — "more than one JSON reading of the same
// emitted value"): no keyword to drop, so that tool is left out for the model.
const AMBIGUOUS = 'failed to translate request: folding the request grammar: tool "Workflow" parameter schema: parameter "args": more than one JSON reading of the same emitted value';

test('refusedToolName: names the tool a grammar refusal is about; null for anything else', () => {
  assert.equal(refusedToolName(AMBIGUOUS), 'Workflow');
  assert.equal(refusedToolName(REFUSAL), 'ListAgents');
  assert.equal(refusedToolName('request rejected (400) — bad request'), null);
});

test('withoutTools: chat and Responses shapes; input untouched', () => {
  const chat = { tools: [{ type: 'function', function: { name: 'Workflow', parameters: {} } }, { type: 'function', function: { name: 'Read', parameters: {} } }] };
  const out = withoutTools(chat, new Set(['Workflow']));
  assert.deepEqual(out.tools.map((t) => t.function.name), ['Read']);
  assert.equal(chat.tools.length, 2);
  const resp = withoutTools({ tools: [{ type: 'function', name: 'Workflow' }, { type: 'function', name: 'Read' }] }, new Set(['Workflow']));
  assert.deepEqual(resp.tools.map((t) => t.name), ['Read']);
});

test('handleMessages: a tool the grammar cannot represent is left out, retried, and stays out for that model', async () => {
  _resetBridgeTelemetry(); _resetBridgeWarnings(); _resetSchemaKeywordDrops();
  const seen = [];
  const ambiguous = () => new Response(JSON.stringify({ error: { message: 'Provider returned error', code: 400, metadata: { raw: JSON.stringify({ error: { code: '400', message: AMBIGUOUS } }) } } }), { status: 400, headers: { 'content-type': 'application/json' } });
  const answers = [ambiguous(), ok(), ok()];
  const fetch = async (_url, init) => { seen.push(JSON.parse(init.body)); return answers.shift(); };
  const twoTools = { ...body, tools: [...body.tools, { name: 'Workflow', description: 'y', input_schema: { type: 'object', properties: { args: {} } } }] };
  const logs = [];
  const reply = fakeReply();
  await handleMessages({ entry, body: twoTools, tag: 't4', fetch, log: (l) => logs.push(l) }, reply);
  assert.equal(reply.statusCode, 200);
  assert.deepEqual(seen[0].tools.map((t) => t.function.name), ['ListAgents', 'Workflow']);
  assert.deepEqual(seen[1].tools.map((t) => t.function.name), ['ListAgents']);
  assert.ok(logs.some((l) => /"Workflow"/.test(l) && /leaving it out/.test(l)), logs.join('\n'));
  await handleMessages({ entry, body: twoTools, tag: 't5', fetch, log: () => {} }, fakeReply());
  assert.deepEqual(seen[2].tools.map((t) => t.function.name), ['ListAgents']);
});
