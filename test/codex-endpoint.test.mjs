// test/codex-endpoint.test.mjs — Codex models on their own OpenAI-compatible endpoint
// (src/core/engines/codex-endpoint.mjs): the `-c model_providers.*` overrides and env a spawn gets,
// the key kept off argv, no list price for an endpoint model, the fail-fast on a missing key, and
// the Test button's hints. The live check against the real codex binary runs only when
// WORCA_CODEX_LIVE_BIN names one (it serves the Responses API from test/helpers/fake-openai-responses.mjs).
import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _resetForTests } from '../src/core/db.mjs';
import { addGlobalModel, updateProvider } from '../src/core/settings.mjs';
import { codexEndpointSpawn, findCodexEndpointEntry, CODEX_PROVIDER_KEY_ENV } from '../src/core/engines/codex-endpoint.mjs';
import { runCodexProcess, codexModelPriced, codexInvestigatorRole } from '../src/core/engines/codex.mjs';
import { testModel, CODEX_ENDPOINT_NETWORK_HINT } from '../src/core/model-test.mjs';
import { fakeCodex } from './helpers/fake-codex.mjs';
import { startFakeResponses, FAKE_RESPONSES_KEY } from './helpers/fake-openai-responses.mjs';

const POSIX = { skip: process.platform === 'win32' };
const dirs = [];
const tmp = () => { const d = realpathSync(mkdtempSync(join(tmpdir(), 'codex-ep-'))); dirs.push(d); return d; };
const keep = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, WORCA_HOME: process.env.WORCA_HOME, ALLOW: process.env.WORCA_TEST_ALLOW_HOME_FALLBACK, KEY: process.env.CX_EP_KEY };
beforeEach(() => {
  const home = tmp();
  _resetForTests();
  process.env.HOME = home; process.env.USERPROFILE = home; process.env.WORCA_HOME = tmp();
  process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = '1';
  process.env.CX_EP_KEY = FAKE_RESPONSES_KEY;
});
after(() => {
  _resetForTests();
  for (const [k, v] of [['HOME', keep.HOME], ['USERPROFILE', keep.USERPROFILE], ['WORCA_HOME', keep.WORCA_HOME], ['WORCA_TEST_ALLOW_HOME_FALLBACK', keep.ALLOW], ['CX_EP_KEY', keep.KEY]]) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const UP = { provider: 'openai', api: 'openai-responses', model: 'qwen3-coder', baseUrl: 'https://gw.example/v1', apiKey: '${CX_EP_KEY}', headers: { 'X-Team': 'blue' } };

test('codexEndpointSpawn: a codex model provider by -c overrides; the key and headers ride the env', async () => {
  await addGlobalModel({ id: 'Cx.Local', engine: 'codex', upstream: UP });
  const s = codexEndpointSpawn('cx.local');
  assert.equal(s.model, 'qwen3-coder');
  assert.deepEqual(s.args, [
    '-c', 'model_provider="worca_cx_local"',
    '-c', 'model_providers.worca_cx_local.name="Cx.Local (worca)"',
    '-c', 'model_providers.worca_cx_local.base_url="https://gw.example/v1"',
    '-c', 'model_providers.worca_cx_local.wire_api="responses"',
    '-c', `model_providers.worca_cx_local.env_key="${CODEX_PROVIDER_KEY_ENV}"`,
    '-c', 'model_providers.worca_cx_local.env_http_headers={"X-Team"="WORCA_CODEX_PROVIDER_HEADER_0"}',
  ]);
  assert.deepEqual(s.env, { [CODEX_PROVIDER_KEY_ENV]: FAKE_RESPONSES_KEY, WORCA_CODEX_PROVIDER_HEADER_0: 'blue' });
  assert.ok(!s.args.some((a) => a.includes(FAKE_RESPONSES_KEY)), 'the key never goes on argv');
  // Not an endpoint model: a built-in, a plain Codex entry, a Claude entry.
  await addGlobalModel({ id: 'cx-plain', engine: 'codex' });
  for (const id of ['gpt-5.5', 'cx-plain', 'claude-sonnet-5', '']) assert.equal(codexEndpointSpawn(id), null, id);
});

test('codexEndpointSpawn: base URL and key fall back to the OpenAI-compatible provider row; a local one needs no key', async () => {
  await updateProvider('openai', { baseUrl: 'https://provider.example/v1', apiKey: '${CX_EP_KEY}' });
  await addGlobalModel({ id: 'cx-row', engine: 'codex', upstream: { provider: 'openai', api: 'openai-responses', model: 'm1' } });
  const s = codexEndpointSpawn('cx-row');
  assert.ok(s.args.includes('model_providers.worca_cx-row.base_url="https://provider.example/v1"'), s.args.join(' '));
  assert.equal(s.env[CODEX_PROVIDER_KEY_ENV], FAKE_RESPONSES_KEY);
  await updateProvider('openai', { apiKey: null });
  await addGlobalModel({ id: 'cx-lan', engine: 'codex', upstream: { provider: 'openai', api: 'openai-responses', model: 'm2', baseUrl: 'http://127.0.0.1:11434/v1' } });
  const lan = codexEndpointSpawn('cx-lan');
  assert.deepEqual(lan.env, {});
  assert.ok(!lan.args.some((a) => a.includes('env_key')), 'a keyless local endpoint names no env_key');
});

test('codexEndpointSpawn: no usable key fails fast with the provider hint, before any spawn', POSIX, async () => {
  await addGlobalModel({ id: 'cx-nokey', engine: 'codex', upstream: { provider: 'openai', api: 'openai-responses', model: 'm', baseUrl: 'https://remote.example/v1' } });
  assert.throws(() => codexEndpointSpawn('cx-nokey'), (e) => e.errorClass === 'auth' && e.bridgeReason === 'no_key' && /no API key/.test(e.message));
  const dir = tmp();
  const fake = fakeCodex(dir, 'never');
  await assert.rejects(() => runCodexProcess({ cwd: dir, bin: fake.bin, prompt: 'P', usageDir: dir, model: 'cx-nokey' }), /no API key/);
  assert.equal(fake.args(), null, 'codex never ran');
  const r = await testModel('cx-nokey', { engine: 'codex' });
  assert.equal(r.ok, false);
  assert.match(r.hint, /set an API key for openai on the Providers page, or on this model's Connection/);
});

test('runCodexProcess: an endpoint model spawns codex on its provider, the key in its env, no list price', POSIX, async () => {
  // A Codex entry may take a built-in's id; on its own endpoint it is no longer priced at OpenAI's list price.
  await addGlobalModel({ id: 'gpt-5.5', engine: 'codex', upstream: UP });
  const dir = tmp();
  const fake = fakeCodex(dir, 'ok');
  const events = [];
  await runCodexProcess({ cwd: dir, bin: fake.bin, prompt: 'P', usageDir: dir, model: 'gpt-5.5', effort: 'high', onEvent: (e) => events.push(e) });
  const args = fake.args();
  assert.deepEqual(args.slice(args.indexOf('-m'), args.indexOf('-m') + 2), ['-m', 'qwen3-coder'], 'the upstream id goes to -m');
  assert.ok(args.includes('model_provider="worca_gpt-5_5"'), args.join(' '));
  assert.ok(args.includes('model_reasoning_effort="high"'));
  assert.ok(!args.some((a) => a.includes(FAKE_RESPONSES_KEY)), 'the key never goes on argv');
  assert.equal(fake.env()[CODEX_PROVIDER_KEY_ENV], FAKE_RESPONSES_KEY);
  const result = events.find((e) => e.type === 'result');
  assert.ok(result && !('costUsd' in result), 'cost unknown: no CODEX_PRICES for an endpoint model');
  assert.equal(events.find((e) => e.type === 'session' && e.init).model, 'gpt-5.5', 'the session names worca\'s id');
  assert.equal(codexModelPriced('gpt-5.5'), false);
  await addGlobalModel({ id: 'cx-priced', engine: 'codex', upstream: UP, cost: { perMtok: { input: 1, output: 2 } } });
  assert.equal(codexModelPriced('cx-priced'), true, 'a price override prices it');
  assert.equal(findCodexEndpointEntry('cx-priced').source, 'global');
});

test('the investigator role on an endpoint inherits the parent model instead of naming a built-in', () => {
  const agents = { investigator: { prompt: 'Look.', model: 'gpt-5.5' } };
  assert.match(codexInvestigatorRole({ agents }).toml, /^model = "gpt-5.5"$/m);
  assert.doesNotMatch(codexInvestigatorRole({ agents, inheritModel: true }).toml, /^model =/m);
});

test('the Test button on an unreachable endpoint names the Base URL, not codex login', POSIX, async () => {
  await addGlobalModel({ id: 'cx-down', engine: 'codex', upstream: UP });
  const r = await testModel('cx-down', { engine: 'codex', run: async () => { throw Object.assign(new Error('codex: stream error: connection refused'), { errorClass: 'network' }); } });
  assert.equal(r.hint, CODEX_ENDPOINT_NETWORK_HINT);
  const auth = await testModel('cx-down', { engine: 'codex', run: async () => { throw Object.assign(new Error('codex: 401 Unauthorized'), { errorClass: 'auth' }); } });
  assert.match(auth.hint, /check the token\/secret for this model/);
});

const LIVE_BIN = process.env.WORCA_CODEX_LIVE_BIN;
test('live: the real codex binary answers through a fake Responses endpoint, with no codex sign-in', { skip: !LIVE_BIN && 'set WORCA_CODEX_LIVE_BIN to a codex binary' }, async () => {
  const srv = await startFakeResponses({ reply: 'live reply from the fake endpoint' });
  try {
    await addGlobalModel({ id: 'cx-live', engine: 'codex', upstream: { ...UP, baseUrl: srv.url } });
    const dir = tmp();
    const prev = process.env.CODEX_HOME;
    process.env.CODEX_HOME = tmp();   // an empty codex home: no sign-in anywhere
    const events = [];
    let out;
    try {
      out = await runCodexProcess({ cwd: dir, bin: LIVE_BIN, prompt: 'Say hi', usageDir: dir, model: 'cx-live', sandbox: 'read-only', onEvent: (e) => events.push(e) });
    } finally { if (prev === undefined) delete process.env.CODEX_HOME; else process.env.CODEX_HOME = prev; }
    assert.equal(out.text, 'live reply from the fake endpoint');
    const req = srv.requests.find((r) => r.method === 'POST' && r.url.endsWith('/responses'));
    assert.ok(req, JSON.stringify(srv.requests.map((r) => r.url)));
    assert.equal(req.body.model, 'qwen3-coder');
    assert.equal(req.headers.authorization, `Bearer ${FAKE_RESPONSES_KEY}`);
    assert.equal(req.headers['x-team'], 'blue');
    const result = events.find((e) => e.type === 'result');
    assert.equal(result.usage.input_tokens, 120);
    assert.ok(!('costUsd' in result));
  } finally { await srv.close(); }
});
