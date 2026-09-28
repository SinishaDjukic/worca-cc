// test/bridge-effort-drop.test.mjs
// A model served on the Anthropic passthrough may take no reasoning effort (Copilot's
// claude-haiku-4.5: `output_config.effort "medium" was provided, but model claude-haiku-4.5
// does not support reasoning effort`). The bridge leaves the effort out, retries once, keeps
// leaving it out for that model, and lists the model so the Ask picker can grey effort out.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { handleMessages, _resetBridgeWarnings, _resetEffortDrops, effortlessModels } from '../src/core/bridge/upstream.mjs';
import { _resetBridgeTelemetry } from '../src/core/bridge/telemetry.mjs';
import { createAskModels } from '../src/core/ask/models.mjs';

let home;
const prevEnv = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, WORCA_TEST_ALLOW_HOME_FALLBACK: process.env.WORCA_TEST_ALLOW_HOME_FALLBACK };
before(async () => {
  home = await mkdtemp(join(tmpdir(), 'worca-cc-effort-drop-'));
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
const REFUSAL = 'output_config.effort "medium" was provided, but model claude-haiku-4.5 does not support reasoning effort';
const refuse = () => new Response(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: REFUSAL } }), { status: 400, headers: { 'content-type': 'application/json' } });
const ok = () => new Response(JSON.stringify({ id: 'm1', type: 'message', role: 'assistant', content: [{ type: 'text', text: 'OK' }], stop_reason: 'end_turn' }), { status: 200, headers: { 'content-type': 'application/json' } });
const entry = { id: 'copilot-claude-haiku-4.5', upstream: { provider: 'anthropic', api: 'anthropic', model: 'claude-haiku-4.5', baseUrl: 'https://api.example.com', apiKey: 'sk-test' } };
const body = (oc) => ({ model: entry.id, max_tokens: 50, messages: [{ role: 'user', content: 'hi' }], ...(oc ? { output_config: oc } : {}) });

test('an effort refusal is learned: effort left out, retried once, and left out from then on', async () => {
  _resetBridgeTelemetry(); _resetBridgeWarnings(); _resetEffortDrops();
  const seen = [];
  const answers = [refuse(), ok(), ok()];
  const fetch = async (_url, init) => { seen.push(JSON.parse(init.body)); return answers.shift(); };
  const logs = [];
  const reply = fakeReply();
  await handleMessages({ entry, body: body({ effort: 'medium', format: { type: 'text' } }), tag: 't1', fetch, log: (l) => logs.push(l) }, reply);
  assert.equal(reply.statusCode, 200, JSON.stringify(reply.body));
  assert.equal(seen.length, 2);
  assert.deepEqual(seen[0].output_config, { effort: 'medium', format: { type: 'text' } });
  assert.deepEqual(seen[1].output_config, { format: { type: 'text' } }, 'only the effort goes; the rest of output_config stays');
  assert.ok(logs.some((l) => /takes no reasoning effort/.test(l)), logs.join('\n'));
  assert.ok(effortlessModels().has(entry.id));
  // The next request goes out without it: no refusal round trip. An output_config holding
  // only the effort disappears entirely.
  await handleMessages({ entry, body: body({ effort: 'high' }), tag: 't2', fetch, log: () => {} }, fakeReply());
  assert.equal(seen.length, 3);
  assert.equal('output_config' in seen[2], false);
});

test('a refusal that repeats without the effort is answered, not looped; other 400s are not retried', async () => {
  _resetBridgeTelemetry(); _resetBridgeWarnings(); _resetEffortDrops();
  let calls = 0;
  const reply = fakeReply();
  await handleMessages({ entry, body: body({ effort: 'medium' }), tag: 't3', fetch: async () => { calls += 1; return refuse(); }, log: () => {} }, reply);
  assert.equal(calls, 2);
  assert.equal(reply.statusCode, 400);

  _resetEffortDrops(); calls = 0;
  const other = () => new Response(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: 'max_tokens is too large' } }), { status: 400 });
  await handleMessages({ entry, body: body({ effort: 'medium' }), tag: 't4', fetch: async () => { calls += 1; return other(); }, log: () => {} }, fakeReply());
  assert.equal(calls, 1);
  assert.equal(effortlessModels().size, 0);
  // No effort in the request: nothing to leave out, no retry.
  calls = 0;
  await handleMessages({ entry, body: body(null), tag: 't5', fetch: async () => { calls += 1; return refuse(); }, log: () => {} }, fakeReply());
  assert.equal(calls, 1);
});

test('the Ask catalog marks a model the bridge learned takes no effort', async () => {
  const listModels = async () => [
    { id: 'copilot-claude-haiku-4.5', label: 'Claude Haiku 4.5 (Copilot)', custom: 'global' },
    { id: 'sonnet', label: 'Sonnet', custom: false },
  ];
  const ask = createAskModels({ listModels, pluginModels: () => [], effortless: () => new Set(['copilot-claude-haiku-4.5']) });
  const { models } = await ask.askCatalog();
  assert.equal(models.find((m) => m.id === 'copilot-claude-haiku-4.5').noEffort, true);
  assert.equal('noEffort' in models.find((m) => m.id === 'sonnet'), false);
});
