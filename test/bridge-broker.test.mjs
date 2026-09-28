// test/bridge-broker.test.mjs
// Bridged models through the credential broker (plans/credential-broker-design.html §5.2,
// §5.3): the CLI (a plain HTTP client here) presents its spawn token to worca's bridge,
// the bridge translates and forwards to the model's broker slot, and the broker adds the
// key — an OpenAI key, or a Copilot token it exchanges from the stored GitHub sign-in.
// worca holds neither. Also: model→slot routing, discovery and imports through the
// broker, and the Providers operations that move to the key page. Sandboxes HOME + WORCA_HOME.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { addGlobalModel, acknowledgeCopilotTerms } from '../src/core/settings.mjs';
import { startBridge, stopBridge, bridgeBaseUrl } from '../src/core/bridge/server.mjs';
import { endpointModelsForImport, copilotModelsForImport, testProviderConnection, patchProvider, beginCopilotLogin } from '../src/core/bridge/provider-ops.mjs';
import { _resetForTests } from '../src/core/db.mjs';
import { readBrokerConfig } from '../src/broker/config.mjs';
import { builtinSlots, mergeSlots } from '../src/broker/slots.mjs';
import { startBroker } from '../src/broker/main.mjs';
import { resetBrokerClient, brokerInfo, mintSpawnToken } from '../src/core/broker-client.mjs';
import { modelSlot, routeUpstream, slotForBaseUrl } from '../src/core/broker-routing.mjs';
import { withBillTo } from '../src/core/billing.mjs';
import { findLocalCredentials } from '../src/core/broker-guard.mjs';

const OPENAI_KEY = 'sk-openai-real-key-0000000001';
const GH_TOKEN = 'gho_realgithubsignin00000000000000000001';
const SECRET = 'b'.repeat(48);
let home, worcaHome, fake, fakeUrl, broker;
const seen = [];
const prevEnv = {};
for (const k of ['HOME', 'USERPROFILE', 'WORCA_HOME', 'WORCA_TEST_ALLOW_HOME_FALLBACK', 'WORCA_BROKER_URL', 'WORCA_BROKER_SECRET']) prevEnv[k] = process.env[k];
const readBody = (req) => new Promise((r) => { let s = ''; req.on('data', (c) => { s += c; }); req.on('end', () => r(s)); });

before(async () => {
  home = await mkdtemp(join(tmpdir(), 'worca-bb-home-'));
  worcaHome = await mkdtemp(join(tmpdir(), 'worca-bb-whome-'));
  process.env.HOME = home; process.env.USERPROFILE = home; process.env.WORCA_HOME = worcaHome;
  process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = '1';
  _resetForTests();

  // One fake for every provider: OpenAI chat + models, GitHub's token exchange, Copilot's API.
  fake = http.createServer(async (req, res) => {
    const text = await readBody(req);
    seen.push({ method: req.method, url: req.url, headers: { ...req.headers }, body: text });
    const json = (status, obj) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
    const auth = req.headers.authorization || '';
    if (req.url === '/copilot_internal/v2/token') {
      if (auth !== `token ${GH_TOKEN}`) return json(401, { message: 'Bad credentials' });
      return json(200, { token: 'cp-live-token-1', expires_at: Math.floor(Date.now() / 1000) + 1800, endpoints: { api: 'https://evil.example' } });
    }
    if (req.url === '/v1/chat/completions') {
      if (auth !== `Bearer ${OPENAI_KEY}`) return json(401, { error: { message: `Incorrect API key provided: ${auth.slice(7)}` } });
      return json(200, { id: 'c1', model: 'gpt-x', choices: [{ index: 0, message: { role: 'assistant', content: 'hi from openai' }, finish_reason: 'stop' }], usage: { prompt_tokens: 7, completion_tokens: 3 } });
    }
    if (req.url === '/v1/models') {
      if (auth !== `Bearer ${OPENAI_KEY}`) return json(401, { error: { message: 'no key' } });
      return json(200, { data: [{ id: 'gpt-x', object: 'model' }] });
    }
    if (req.url === '/chat/completions') {
      if (auth !== 'Bearer cp-live-token-1') return json(401, { error: { message: 'bad copilot token' } });
      return json(200, { id: 'c2', model: 'gpt-4o', choices: [{ index: 0, message: { role: 'assistant', content: 'hi from copilot' }, finish_reason: 'stop' }], usage: { prompt_tokens: 5, completion_tokens: 2 } });
    }
    if (req.url === '/models') {
      if (auth !== 'Bearer cp-live-token-1') return json(401, { error: { message: 'bad copilot token' } });
      return json(200, { data: [{ id: 'gpt-4o', name: 'GPT-4o', vendor: 'OpenAI', capabilities: { type: 'chat', limits: { max_prompt_tokens: 64000, max_output_tokens: 4096 }, supports: { tool_calls: true } }, model_picker_enabled: true }] });
    }
    json(404, { error: { message: 'nope' } });
  });
  await new Promise((r) => fake.listen(0, '127.0.0.1', r));
  fakeUrl = `http://127.0.0.1:${fake.address().port}`;

  const slotsFile = join(home, 'slots.json');
  await writeFile(slotsFile, JSON.stringify([
    { id: 'openai', upstream: fakeUrl },
    { id: 'copilot', upstream: fakeUrl, exchangeUrl: `${fakeUrl}/copilot_internal/v2/token` },
  ]));
  const { config, errors } = readBrokerConfig({
    WORCA_BROKER_MODE: 'single', WORCA_BROKER_SECRET: SECRET, WORCA_BROKER_HOST: '127.0.0.1', WORCA_BROKER_PORT: '0',
    WORCA_BROKER_KEY_OPENAI: OPENAI_KEY, WORCA_BROKER_KEY_COPILOT: GH_TOKEN, WORCA_BROKER_SLOTS_FILE: slotsFile,
  });
  assert.deepEqual(errors, []);
  const { readFileSync } = await import('node:fs');
  broker = await startBroker({ config, slots: mergeSlots(builtinSlots(), JSON.parse(readFileSync(slotsFile, 'utf8'))), log: () => {} });

  process.env.WORCA_BROKER_URL = `http://127.0.0.1:${broker.ports.private}`;
  process.env.WORCA_BROKER_SECRET = SECRET;
  resetBrokerClient();
  await brokerInfo({ force: true });

  await acknowledgeCopilotTerms();
  await addGlobalModel({ id: 'oai-x', upstream: { provider: 'openai', api: 'openai-chat', model: 'gpt-x', baseUrl: `${fakeUrl}/v1` } });
  await addGlobalModel({ id: 'cp-x', upstream: { provider: 'copilot', api: 'openai-chat', model: 'gpt-4o' } });
  await addGlobalModel({ id: 'local-x', upstream: { provider: 'openai', api: 'openai-chat', model: 'qwen', baseUrl: 'http://127.0.0.1:1/v1' } });
  await startBridge({ log: () => {} });
});

after(async () => {
  await stopBridge();
  await broker?.close();
  await new Promise((r) => fake.close(r));
  resetBrokerClient();
  _resetForTests();
  for (const k of Object.keys(prevEnv)) { if (prevEnv[k] === undefined) delete process.env[k]; else process.env[k] = prevEnv[k]; }
  await Promise.all([home, worcaHome].map((d) => rm(d, { recursive: true, force: true })));
});

async function viaBridge(id, token) {
  const r = await fetch(`${bridgeBaseUrl(id)}/v1/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: id, max_tokens: 50, stream: false, messages: [{ role: 'user', content: 'hi' }] }),
  });
  return { status: r.status, body: await r.json() };
}
const tokenFor = async (slot) => (await mintSpawnToken({ billTo: 'local', slots: [slot], kind: 'aux' })).token;

test('routing: bridged models map to broker slots by provider and origin; local endpoints stay keyless', () => {
  assert.deepEqual(modelSlot('oai-x'), { slot: 'openai' });
  assert.deepEqual(modelSlot('cp-x'), { slot: 'copilot' });
  assert.deepEqual(modelSlot('local-x'), { keyless: true });
  assert.deepEqual(modelSlot('claude-sonnet-5'), { slot: 'anthropic' });
  const slots = [{ id: 'openrouter', upstream: 'https://openrouter.ai', auth: 'bearer' }, { id: 'gw', upstream: 'https://gw.acme.dev', auth: 'bearer' }];
  assert.deepEqual(slotForBaseUrl('https://openrouter.ai/api/v1/', slots), { slot: 'openrouter', prefix: '/api/v1' });
  assert.deepEqual(routeUpstream({ provider: 'openai', baseUrl: 'https://gw.acme.dev/v1' }, { slots }), { slot: 'gw', prefix: '/v1' });
  assert.match(routeUpstream({ provider: 'openai', baseUrl: 'https://other.example/v1' }, { slots }).error, /no credential slot for other\.example/);
  assert.match(routeUpstream({ provider: 'copilot' }, { slots }).error, /no GitHub Copilot slot/);
});

test('an OpenAI model: bridge → broker → provider, with the key added by the broker only', async () => {
  const tok = await tokenFor('openai');
  seen.length = 0;
  const r = await viaBridge('oai-x', tok);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.match(JSON.stringify(r.body.content), /hi from openai/);
  const up = seen.find((s) => s.url === '/v1/chat/completions');
  assert.equal(up.headers.authorization, `Bearer ${OPENAI_KEY}`, 'the broker added the real key');
  assert.ok(!JSON.stringify(seen).includes(tok), 'the spawn token never reaches the provider');
  await new Promise((res) => setTimeout(res, 20));
  const usage = broker.store.queryUsage({ billTo: 'local' }).find((u) => u.slot === 'openai');
  assert.deepEqual([usage.inputTokens, usage.outputTokens], [7, 3]);
});

test('a Copilot model: the broker exchanges the stored GitHub sign-in and pins the host', async () => {
  const tok = await tokenFor('copilot');
  seen.length = 0;
  const r = await viaBridge('cp-x', tok);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.match(JSON.stringify(r.body.content), /hi from copilot/);
  const ex = seen.find((s) => s.url === '/copilot_internal/v2/token');
  assert.equal(ex.headers.authorization, `token ${GH_TOKEN}`);
  const up = seen.find((s) => s.url === '/chat/completions');
  assert.equal(up.headers.authorization, 'Bearer cp-live-token-1');
  assert.equal(up.headers['copilot-integration-id'], 'vscode-chat', 'the editor headers pass the Copilot slot\'s allowlist');
  assert.ok(!seen.some((s) => /evil/.test(s.headers.host || '')), 'a non-Copilot host named by the exchange is ignored');
});

test('a token for another slot is refused with the broker\'s 403, not re-wrapped as a 401', async () => {
  const tok = await tokenFor('openai');
  const r = await viaBridge('cp-x', tok);
  assert.equal(r.status, 403);
  assert.match(r.body.error.message, /^worca-broker: this token may not use slot copilot/);
});

test('the bridge refuses anything that is neither its secret nor a broker token', async () => {
  const r = await viaBridge('oai-x', 'sk-some-random-key');
  assert.equal(r.status, 401);
});

test('discovery and import go through the broker with the clicking person\'s key', async () => {
  seen.length = 0;
  const list = await withBillTo('local', () => endpointModelsForImport({ baseUrl: `${fakeUrl}/v1` }));
  assert.equal(list.baseUrl, `${fakeUrl}/v1`, 'the listing names the real base URL, so imports point at it');
  assert.ok(list.models.some((m) => m.id === 'gpt-x'));
  assert.ok(seen.filter((s) => s.url === '/v1/models').every((s) => s.headers.authorization === `Bearer ${OPENAI_KEY}`));
  const cp = await withBillTo('local', () => copilotModelsForImport());
  assert.ok(cp.some((m) => m.id === 'gpt-4o'));
});

test('provider keys, tests and the Copilot sign-in move to the key page', async () => {
  const t = await testProviderConnection('openai', { apiKey: 'sk-typed' });
  assert.equal(t.ok, false);
  assert.match(t.message, /key page/);
  await assert.rejects(() => patchProvider('openai', { apiKey: 'sk-new-key-000000' }), /key page/);
  await patchProvider('openai', { maxConcurrent: 3 });   // non-secret settings still save
  await assert.rejects(() => beginCopilotLogin(), /key page/);
});

test('the guard accepts remote endpoints a slot pins, and flags secret headers and unslotted origins', () => {
  const f = findLocalCredentials({
    models: [
      { id: 'ok', upstream: { provider: 'openai', baseUrl: 'https://openrouter.ai/api/v1' } },
      { id: 'cp', upstream: { provider: 'copilot' } },
      { id: 'bad', upstream: { provider: 'openai', baseUrl: 'https://other.example/v1', headers: { 'X-Api-Key': 'abc', 'X-Title': 'w' } } },
    ],
    slotOrigins: ['https://openrouter.ai'],
  }).join('\n');
  assert.ok(!/"ok"|"cp"/.test(f), f);
  assert.match(f, /"bad": upstream\.baseUrl other\.example has no credential slot/);
  assert.match(f, /"bad": upstream\.headers X-Api-Key/);
  assert.ok(!/X-Title/.test(f));
});
