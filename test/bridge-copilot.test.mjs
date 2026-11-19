// test/bridge-copilot.test.mjs
// The GitHub Copilot provider against a stubbed fetch (model-bridge-design.md
// §7): device flow state machine, token exchange + expiry refresh, the
// header set (X-Initiator / vision), models-list normalization and the
// import shape, the quota snapshot.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  startDeviceFlow, pollDeviceFlow, githubLogin, copilotToken, invalidateCopilotToken, _resetCopilotCache,
  copilotHeaders, githubHeaders, copilotApiHost, bodyHasImage, requestInitiator,
  normalizeCopilotModel, catalogEntryForCopilotModel, copilotApiFor, listCopilotModels, copilotUsage, GITHUB_CLIENT_ID,
  copilotAccountHost, copilotGateway,
  readGithubRefusal, githubReasonText, copilotRefusalText,
} from '../src/core/bridge/providers/copilot.mjs';
import { checkRows } from './helpers/rows.mjs';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { handleMessages, _resetBridgeWarnings } from '../src/core/bridge/upstream.mjs';
import { _resetBridgeTelemetry } from '../src/core/bridge/telemetry.mjs';
import { updateProvider, settingsFile } from '../src/core/settings.mjs';

const jsonRes = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body), headers: new Map() });
function stub(routes) {
  const calls = [];
  const f = async (url, init = {}) => {
    calls.push({ url, init });
    for (const [re, fn] of routes) if (re.test(url)) return fn(url, init, calls.length);
    return jsonRes(404, { message: `no stub for ${url}` });
  };
  f.calls = calls;
  return f;
}

beforeEach(() => _resetCopilotCache());

test('device flow: start returns the code; poll walks pending → slow_down → ok; expired/denied are errors', async () => {
  let n = 0;
  const f = stub([
    [/login\/device\/code$/, (u, init) => {
      const b = JSON.parse(init.body);
      assert.equal(b.client_id, GITHUB_CLIENT_ID);
      assert.equal(b.scope, 'read:user');
      return jsonRes(200, { device_code: 'dc', user_code: 'ABCD-1234', verification_uri: 'https://github.com/login/device', interval: 5, expires_in: 900 });
    }],
    [/oauth\/access_token$/, () => {
      n += 1;
      if (n === 1) return jsonRes(200, { error: 'authorization_pending' });
      if (n === 2) return jsonRes(200, { error: 'slow_down', interval: 10 });
      if (n === 3) return jsonRes(200, { access_token: 'gho_x', token_type: 'bearer' });
      if (n === 4) return jsonRes(200, { error: 'expired_token' });
      return jsonRes(200, { error: 'access_denied' });
    }],
  ]);
  const s = await startDeviceFlow({ fetch: f });
  assert.deepEqual(s, { deviceCode: 'dc', userCode: 'ABCD-1234', verificationUri: 'https://github.com/login/device', interval: 5, expiresIn: 900, host: 'github.com' });
  assert.deepEqual(await pollDeviceFlow('dc', { fetch: f }), { pending: true });
  assert.deepEqual(await pollDeviceFlow('dc', { fetch: f }), { pending: true, interval: 10 });
  assert.deepEqual(await pollDeviceFlow('dc', { fetch: f }), { ok: true, token: 'gho_x' });
  assert.match((await pollDeviceFlow('dc', { fetch: f })).error, /expired/);
  assert.match((await pollDeviceFlow('dc', { fetch: f })).error, /denied/);
});

test('login + token exchange: cached until near expiry, refreshed after, invalidated on demand; apiHost from endpoints', async () => {
  let exchanges = 0;
  let now = 1_000_000_000_000;
  const f = stub([
    [/\/user$/, (u, init) => { assert.equal(init.headers.authorization, 'token gho_x'); return jsonRes(200, { login: 'octocat' }); }],
    [/copilot_internal\/v2\/token$/, () => { exchanges += 1; return jsonRes(200, { token: `cp_${exchanges}`, expires_at: Math.floor(now / 1000) + 1800, endpoints: { api: 'https://api.individual.githubcopilot.com/' } }); }],
  ]);
  assert.equal(await githubLogin('gho_x', { fetch: f }), 'octocat');
  const a = await copilotToken('gho_x', { fetch: f, now: () => now });
  assert.deepEqual(a, { token: 'cp_1', apiHost: 'https://api.individual.githubcopilot.com' });
  assert.equal((await copilotToken('gho_x', { fetch: f, now: () => now + 60_000 })).token, 'cp_1');   // cached
  now += 1790 * 1000;                                                                                  // inside the refresh margin
  assert.equal((await copilotToken('gho_x', { fetch: f, now: () => now })).token, 'cp_2');
  invalidateCopilotToken('gho_x');
  assert.equal((await copilotToken('gho_x', { fetch: f, now: () => now })).token, 'cp_3');
  assert.equal(exchanges, 3);
});

test('token exchange failures: 401 → AUTH code (cache dropped); no token → EXCHANGE; not signed in throws', async () => {
  const f = stub([[/v2\/token$/, () => jsonRes(401, { message: 'bad' })]]);
  await assert.rejects(copilotToken('gho_bad', { fetch: f, log: () => {} }), (e) => e.code === 'AUTH');
  const g = stub([[/v2\/token$/, () => jsonRes(200, { nope: true })]]);
  await assert.rejects(copilotToken('gho_x', { fetch: g }), (e) => e.code === 'EXCHANGE');
  await assert.rejects(copilotToken('', {}), (e) => e.code === 'NOT_SIGNED_IN');
});

test('headers: the editor identity, X-Initiator, vision flag, account hosts', () => {
  const h = copilotHeaders('cp', { vision: true, initiator: 'agent', requestId: 'rid' });
  assert.equal(h.authorization, 'Bearer cp');
  assert.equal(h['copilot-integration-id'], 'vscode-chat');
  assert.equal(h['x-initiator'], 'agent');
  assert.equal(h['copilot-vision-request'], 'true');
  assert.equal(h['x-request-id'], 'rid');
  assert.match(h['editor-version'], /^vscode\//);
  const plain = copilotHeaders('cp');
  assert.equal(plain['x-initiator'], 'user');
  assert.equal('copilot-vision-request' in plain, false);
  assert.match(plain['x-request-id'], /^[0-9a-f-]{36}$/);
  assert.equal(githubHeaders().authorization, undefined);
  assert.equal(copilotApiHost('business'), 'https://api.business.githubcopilot.com');
  assert.equal(copilotApiHost('enterprise'), 'https://api.enterprise.githubcopilot.com');
  assert.equal(copilotApiHost('individual'), 'https://api.githubcopilot.com');
});

test('initiator + vision detection from a Messages body, incl. trailing system reminders after a tool-loop continuation', async () => {
  await checkRows([
    { name: 'initiator + vision detection from a Messages body', run: async () => {
      assert.equal(requestInitiator({ messages: [{ role: 'user', content: 'x' }] }), 'user');
      assert.equal(requestInitiator({ messages: [{ role: 'assistant', content: 'x' }] }), 'agent');
      assert.equal(requestInitiator({ messages: [{ role: 'user', content: [{ type: 'tool_result', tool_use_id: 'a', content: 'b' }] }] }), 'agent');
      assert.equal(requestInitiator({}), 'user');
      assert.equal(bodyHasImage({ messages: [{ role: 'user', content: [{ type: 'image', source: {} }] }] }), true);
      assert.equal(bodyHasImage({ messages: [{ role: 'user', content: [{ type: 'tool_result', content: [{ type: 'image' }] }] }] }), true);
      assert.equal(bodyHasImage({ messages: [{ role: 'user', content: 'no' }] }), false);
    } },
    { name: 'initiator: the CLI\'s trailing system reminders do not turn a tool-loop continuation into a user turn', run: async () => {
      const call = { role: 'assistant', content: [{ type: 'thinking', thinking: 't', signature: 's' }, { type: 'tool_use', id: 't1', name: 'Read', input: {} }] };
      const result = { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }] };
      const reminder = { role: 'system', content: [{ type: 'text', text: '<total_tokens>14999970 tokens left</total_tokens>' }] };
      // The shape of both captured CLI continuations: … assistant > user(tool_result) > system.
      assert.equal(requestInitiator({ messages: [{ role: 'user', content: 'go' }, { role: 'system', content: 'deferred tools' }, call, result, reminder] }), 'agent');
      assert.equal(requestInitiator({ messages: [{ role: 'user', content: 'go' }, call, reminder, { role: 'system', content: 'more' }] }), 'agent');
      // A new prompt stays a user turn, with or without a reminder after it.
      assert.equal(requestInitiator({ messages: [{ role: 'user', content: 'go' }, reminder] }), 'user');
      assert.equal(requestInitiator({ messages: [reminder] }), 'user');
    } },
  ]);
});

test('models: normalization, vendor routing and the import entry', async () => {
  const raw = {
    data: [
      { id: 'claude-sonnet-4.5', name: 'Claude Sonnet 4.5', vendor: 'Anthropic', model_picker_enabled: true, capabilities: { type: 'chat', family: 'claude', supports: { tool_calls: true, vision: true }, limits: { max_prompt_tokens: 128000, max_output_tokens: 16000, max_context_window_tokens: 200000 } } },
      { id: 'gpt-5', name: 'GPT-5', vendor: 'OpenAI', preview: true, capabilities: { type: 'chat', supports: { tool_calls: true, reasoning_effort: true }, limits: { max_prompt_tokens: 100000 } }, policy: { state: 'unconfigured' } },
      { id: 'gpt-4.1', name: 'GPT-4.1', vendor: 'OpenAI', capabilities: { type: 'chat', supports: { tool_calls: true } } },
      { id: 'text-embedding-3', name: 'emb', vendor: 'OpenAI', capabilities: { type: 'embeddings' } },
    ],
  };
  const f = stub([
    [/v2\/token$/, () => jsonRes(200, { token: 'cp', expires_at: Math.floor(Date.now() / 1000) + 1800 })],
    [/\/models$/, (u, init) => { assert.equal(u, 'https://api.business.githubcopilot.com/models'); assert.equal(init.headers.authorization, 'Bearer cp'); return jsonRes(200, raw); }],
  ]);
  const list = await listCopilotModels('gho', { accountType: 'business', fetch: f });
  assert.deepEqual(list.map((m) => m.id), ['claude-sonnet-4.5', 'gpt-5', 'gpt-4.1']);
  const claude = list[0];
  assert.equal(claude.vision, true);
  assert.equal(claude.maxPromptTokens, 128000);
  assert.equal(claude.contextWindow, 200000);
  const e = catalogEntryForCopilotModel(claude);
  assert.deepEqual(e, {
    id: 'copilot-claude-sonnet-4.5', label: 'Claude Sonnet 4.5 (Copilot)', efforts: undefined,
    upstream: { provider: 'copilot', api: 'anthropic', model: 'claude-sonnet-4.5', capabilities: { toolCalls: true, vision: true, reasoning: false, maxPromptTokens: 128000, maxOutputTokens: 16000 } },
    cost: { free: true },
  });
  const gpt5 = list[1];
  assert.equal(gpt5.reasoning, true);
  assert.equal(gpt5.preview, true);
  assert.equal(gpt5.policyState, 'unconfigured');
  const e5 = catalogEntryForCopilotModel(gpt5);
  assert.equal(e5.upstream.api, 'openai-chat');
  assert.equal(e5.efforts, undefined);
  const e41 = catalogEntryForCopilotModel(list[2]);
  assert.deepEqual(e41.efforts, ['medium']);
  assert.equal(e41.upstream.capabilities.reasoning, false);
  assert.equal(normalizeCopilotModel(null), null);
});

test('usage: the premium-request snapshot, or null without one', async () => {
  const f = stub([[/copilot_internal\/user$/, () => jsonRes(200, { quota_reset_date: '2026-10-01', quota_snapshots: { premium_interactions: { entitlement: 1500, remaining: 1188, percent_remaining: 79.2, unlimited: false } } })]]);
  assert.deepEqual(await copilotUsage('gho', { fetch: f }), { used: 312, entitlement: 1500, remaining: 1188, percentRemaining: 79.2, unlimited: false, resetDate: '2026-10-01' });
  const g = stub([[/copilot_internal\/user$/, () => jsonRes(200, {})]]);
  assert.equal(await copilotUsage('gho', { fetch: g }), null);
  const h = stub([[/copilot_internal\/user$/, () => jsonRes(403, {})]]);
  assert.equal(await copilotUsage('gho', { fetch: h }), null);
});

test('models: supported_endpoints and effort lists drive the api, the reasoning flag and the efforts', () => {
  const astra = normalizeCopilotModel({ id: 'gpt-6-astra', name: 'GPT-6 Astra', vendor: 'OpenAI', supported_endpoints: ['/responses', 'ws:/responses'], capabilities: { type: 'chat', supports: { tool_calls: true, vision: true, reasoning_effort: ['low', 'medium', 'high', 'xhigh', 'max'] }, limits: { max_prompt_tokens: 272000, max_output_tokens: 128000 } } });
  assert.equal(astra.reasoning, true);                         // the id regex misses gpt-6; the list says so
  assert.deepEqual(astra.reasoningEfforts, ['low', 'medium', 'high', 'xhigh', 'max']);
  assert.deepEqual(astra.endpoints, ['/responses', 'ws:/responses']);
  assert.equal(copilotApiFor(astra), 'openai-responses');
  const ea = catalogEntryForCopilotModel(astra);
  assert.equal(ea.efforts, undefined);                         // every Worca effort is listed
  assert.deepEqual(ea.upstream, { provider: 'copilot', api: 'openai-responses', model: 'gpt-6-astra', capabilities: { toolCalls: true, vision: true, reasoning: true, maxPromptTokens: 272000, maxOutputTokens: 128000, reasoningEfforts: ['low', 'medium', 'high', 'xhigh', 'max'] } });

  const both = normalizeCopilotModel({ id: 'gpt-5.4', name: 'GPT-5.4', vendor: 'OpenAI', supported_endpoints: ['/responses', '/chat/completions', 'ws:/responses'], capabilities: { type: 'chat', supports: { reasoning_effort: ['none', 'low', 'medium', 'high', 'xhigh'] } } });
  assert.equal(copilotApiFor(both), 'openai-responses');       // an OpenAI model goes to Responses whenever it is served there
  assert.deepEqual(catalogEntryForCopilotModel(both).efforts, ['medium', 'high', 'xhigh']);
  assert.equal(copilotApiFor({ ...both, vendor: 'Azure OpenAI' }), 'openai-responses');

  const gem = normalizeCopilotModel({ id: 'gemini-3.8-flash', name: 'Gemini 3.8 Flash', vendor: 'Google', supported_endpoints: ['/chat/completions'], capabilities: { type: 'chat', supports: { reasoning_effort: ['low', 'medium', 'high'] } } });
  assert.equal(gem.reasoning, true);
  assert.equal(copilotApiFor(gem), 'openai-chat');
  assert.deepEqual(catalogEntryForCopilotModel(gem).efforts, ['medium', 'high']);
  assert.deepEqual(catalogEntryForCopilotModel(gem).upstream.capabilities.reasoningEfforts, ['low', 'medium', 'high']);

  assert.equal(copilotApiFor({ id: 'grok', vendor: 'xAI', endpoints: ['/responses', '/chat/completions'] }), 'openai-chat');   // other vendors keep chat when it is served
  assert.equal(copilotApiFor({ id: 'grok', vendor: 'xAI', endpoints: ['/responses'] }), 'openai-responses');                  // …unless only Responses is
  assert.equal(copilotApiFor({ id: 'gpt-4o', vendor: 'Azure OpenAI', endpoints: null }), 'openai-chat');                       // legacy: no list
  assert.equal(copilotApiFor({ id: 'claude-x', vendor: 'Anthropic', endpoints: ['/v1/messages', '/chat/completions'] }), 'anthropic');

  const lowOnly = normalizeCopilotModel({ id: 'tiny', name: 'tiny', vendor: 'OpenAI', capabilities: { type: 'chat', supports: { reasoning_effort: ['low'] } } });
  assert.deepEqual(catalogEntryForCopilotModel(lowOnly).efforts, ['medium']);   // nothing in common: medium, mapped down to low per request
  const noneOnly = normalizeCopilotModel({ id: 'plain', name: 'plain', vendor: 'OpenAI', capabilities: { type: 'chat', supports: { reasoning_effort: ['none'] } } });
  assert.equal(noneOnly.reasoning, false);
  assert.deepEqual(catalogEntryForCopilotModel(noneOnly).efforts, ['medium']);
  const legacy = normalizeCopilotModel({ id: 'gpt-4.1', name: 'GPT-4.1', vendor: 'OpenAI', capabilities: { type: 'chat', supports: { tool_calls: true } } });
  assert.equal(legacy.endpoints, null);
  assert.equal(legacy.reasoningEfforts, null);
  assert.equal('reasoningEfforts' in catalogEntryForCopilotModel(legacy).upstream.capabilities, false);
  const claude = normalizeCopilotModel({ id: 'claude-sonnet-5', name: 'Claude Sonnet 5', vendor: 'Anthropic', capabilities: { type: 'chat', supports: { reasoning_effort: ['low', 'high'] } } });
  assert.equal('reasoningEfforts' in catalogEntryForCopilotModel(claude).upstream.capabilities, false);   // passthrough: the CLI speaks effort itself
});

// ── GHE.com tenant (data residency) ──────────────────────────────────────────

const TENANT = 'acme.ghe.com';

test('device flow on a GHE.com tenant: code and token URLs on acme.ghe.com; fallback verificationUri and host; denied names the tenant', async () => {
  const f = stub([
    [/login\/device\/code$/, () => jsonRes(200, { device_code: 'dc', user_code: 'ABCD-1234' })],
    [/oauth\/access_token$/, () => jsonRes(200, { error: 'access_denied' })],
  ]);
  const s = await startDeviceFlow({ fetch: f, enterpriseHost: TENANT });
  assert.equal(f.calls[0].url, 'https://acme.ghe.com/login/device/code');
  assert.equal(s.verificationUri, 'https://acme.ghe.com/login/device');
  assert.equal(s.host, TENANT);
  assert.match((await pollDeviceFlow('dc', { fetch: f, enterpriseHost: TENANT })).error, /denied on acme\.ghe\.com/);
  assert.equal(f.calls[1].url, 'https://acme.ghe.com/login/oauth/access_token');
  const bad = stub([[/device\/code$/, () => jsonRes(404, {})]]);
  await assert.rejects(startDeviceFlow({ fetch: bad, enterpriseHost: TENANT }), /could not start on acme\.ghe\.com \(404\).*Copilot app/);
});

test('device flow without a host: URLs, verificationUri fallback, host and messages unchanged (github.com)', async () => {
  const f = stub([
    [/login\/device\/code$/, () => jsonRes(200, { device_code: 'dc', user_code: 'U' })],
    [/oauth\/access_token$/, () => jsonRes(200, { error: 'access_denied' })],
  ]);
  const s = await startDeviceFlow({ fetch: f });
  assert.equal(f.calls[0].url, 'https://github.com/login/device/code');
  assert.equal(s.verificationUri, 'https://github.com/login/device');
  assert.equal(s.host, 'github.com');
  assert.equal((await pollDeviceFlow('dc', { fetch: f })).error, 'the sign-in was denied on github.com');
  const bad = stub([[/device\/code$/, () => jsonRes(500, {})]]);
  await assert.rejects(startDeviceFlow({ fetch: bad }), (e) => e.message === 'GitHub device flow could not start (500)');
});

test('login, exchange and quota on a tenant hit api.acme.ghe.com; github.com path still hits api.github.com', async () => {
  const f = stub([
    [/\.com\/user$/, () => jsonRes(200, { login: 'octocat' })],
    [/copilot_internal\/v2\/token$/, () => jsonRes(200, { token: 'cp', expires_at: Math.floor(Date.now() / 1000) + 1800 })],
    [/copilot_internal\/user$/, () => jsonRes(200, { quota_snapshots: { premium_interactions: { entitlement: 10, remaining: 4 } } })],
  ]);
  await githubLogin('gho_t', { fetch: f, enterpriseHost: TENANT });
  await copilotToken('gho_t', { fetch: f, enterpriseHost: TENANT });
  assert.equal((await copilotUsage('gho_t', { fetch: f, enterpriseHost: TENANT })).used, 6);
  assert.deepEqual(f.calls.map((c) => c.url), [
    'https://api.acme.ghe.com/user', 'https://api.acme.ghe.com/copilot_internal/v2/token', 'https://api.acme.ghe.com/copilot_internal/user',
  ]);
  const g = stub([[/.*/, () => jsonRes(200, { login: 'x', token: 'cp' })]]);
  await githubLogin('gho_g', { fetch: g });
  await copilotToken('gho_g', { fetch: g });
  await copilotUsage('gho_g', { fetch: g });
  assert.deepEqual(g.calls.map((c) => c.url), [
    'https://api.github.com/user', 'https://api.github.com/copilot_internal/v2/token', 'https://api.github.com/copilot_internal/user',
  ]);
});

test('token cache is keyed by host: the same token on github.com and a tenant exchanges twice; invalidate drops only that host', async () => {
  let n = 0;
  const f = stub([[/v2\/token$/, () => { n += 1; return jsonRes(200, { token: `cp_${n}`, expires_at: Math.floor(Date.now() / 1000) + 1800 }); }]]);
  assert.equal((await copilotToken('same', { fetch: f })).token, 'cp_1');
  assert.equal((await copilotToken('same', { fetch: f, enterpriseHost: TENANT })).token, 'cp_2');
  assert.equal((await copilotToken('same', { fetch: f })).token, 'cp_1');                                  // both cached
  assert.equal((await copilotToken('same', { fetch: f, enterpriseHost: TENANT })).token, 'cp_2');
  invalidateCopilotToken('same', { enterpriseHost: TENANT });
  assert.equal((await copilotToken('same', { fetch: f })).token, 'cp_1');                                  // github.com kept
  assert.equal((await copilotToken('same', { fetch: f, enterpriseHost: TENANT })).token, 'cp_3');          // tenant re-exchanged
  invalidateCopilotToken('same');
  assert.equal((await copilotToken('same', { fetch: f })).token, 'cp_4');
});

test('copilotGateway on a tenant: trusted endpoints.api wins; an untrusted one falls back to copilot-api.<t>.ghe.com; no host keeps today\'s rule', () => {
  const fb = 'https://copilot-api.acme.ghe.com';
  for (const ok of ['https://copilot-api.acme.ghe.com', 'https://api.individual.githubcopilot.com', 'https://proxy.acme.ghe.com']) {
    assert.equal(copilotGateway({ apiHost: ok, enterpriseHost: TENANT }), ok);
  }
  for (const bad of ['https://evil.example', 'https://copilot-api.other.ghe.com', 'http://copilot-api.acme.ghe.com', 'https://copilot-api.acme.ghe.com:8443', 'https://acme.ghe.com.evil.example', 'https://u@copilot-api.acme.ghe.com', 'https://api.githubcopilot.com:8443', 'https://u:p@api.githubcopilot.com', null, undefined]) {
    assert.equal(copilotGateway({ apiHost: bad, enterpriseHost: TENANT }), fb, String(bad));
  }
  assert.equal(copilotGateway({ apiHost: 'https://anything.example', accountType: 'business' }), 'https://anything.example');
  assert.equal(copilotGateway({ apiHost: null, accountType: 'business' }), 'https://api.business.githubcopilot.com');
  assert.equal(copilotGateway({}), 'https://api.githubcopilot.com');
});

test('copilotAccountHost / copilotApiHost: ghe-com without a valid host throws NO_HOST; other types return null and keep their gateways', () => {
  assert.equal(copilotAccountHost({ accountType: 'individual' }), null);
  assert.equal(copilotAccountHost({ accountType: 'enterprise', enterpriseHost: TENANT }), null);
  assert.equal(copilotAccountHost({}), null);
  assert.equal(copilotAccountHost({ accountType: 'ghe-com', enterpriseHost: TENANT }), TENANT);
  for (const cfg of [{ accountType: 'ghe-com' }, { accountType: 'ghe-com', enterpriseHost: 'github.com' }, { accountType: 'ghe-com', enterpriseHost: 'api.acme.ghe.com' }]) {
    assert.throws(() => copilotAccountHost(cfg), (e) => e.code === 'NO_HOST' && /GHE\.com tenant but has no valid host/.test(e.message));
  }
  assert.equal(copilotApiHost('ghe-com', TENANT), 'https://copilot-api.acme.ghe.com');
  assert.throws(() => copilotApiHost('ghe-com'), (e) => e.code === 'NO_HOST');
  assert.equal(copilotApiHost('business', TENANT), 'https://api.business.githubcopilot.com');
  assert.equal(copilotApiHost('individual'), 'https://api.githubcopilot.com');
});

test('listCopilotModels on a tenant calls the tenant gateway\'s /models', async () => {
  const f = stub([
    [/v2\/token$/, () => jsonRes(200, { token: 'cp', expires_at: Math.floor(Date.now() / 1000) + 1800, endpoints: { api: 'https://evil.example' } })],
    [/\/models$/, () => jsonRes(200, { data: [{ id: 'gpt-4.1', capabilities: { type: 'chat' } }] })],
  ]);
  const ms = await listCopilotModels('gho_t', { accountType: 'ghe-com', enterpriseHost: TENANT, fetch: f });
  assert.equal(ms.length, 1);
  assert.deepEqual(f.calls.map((c) => c.url), ['https://api.acme.ghe.com/copilot_internal/v2/token', 'https://copilot-api.acme.ghe.com/models']);
});

test('copilot entry on a tenant: exchange on api.acme.ghe.com, request to the trusted endpoints.api; an untrusted endpoints.api goes to copilot-api.acme.ghe.com; no host never reaches github.com', async () => {
  const home = await mkdtemp(join(tmpdir(), 'worca-cc-copilot-tenant-'));
  const prev = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, WORCA_TEST_ALLOW_HOME_FALLBACK: process.env.WORCA_TEST_ALLOW_HOME_FALLBACK };
  process.env.HOME = home; process.env.USERPROFILE = home; process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = '1';
  try {
    _resetBridgeTelemetry(); _resetBridgeWarnings();
    const entry = { id: 'copilot-claude-x', upstream: { provider: 'copilot', api: 'anthropic', model: 'claude-x' } };
    const reply = () => {
      const r = { statusCode: 0, body: null };
      return Object.assign(r, { status(c) { r.statusCode = c; }, write() {}, end() {}, json(c, o) { r.statusCode = c; r.body = o; } });
    };
    const run = async (endpointsApi) => {
      _resetCopilotCache();
      const urls = [];
      const fetch = async (url) => {
        urls.push(String(url));
        if (/copilot_internal\/v2\/token$/.test(url)) return new Response(JSON.stringify({ token: 'cp', expires_at: Math.floor(Date.now() / 1000) + 1800, endpoints: { api: endpointsApi } }), { status: 200 });
        return new Response(JSON.stringify({ id: 'm1', type: 'message', role: 'assistant', content: [{ type: 'text', text: 'OK' }], stop_reason: 'end_turn' }), { status: 200, headers: { 'content-type': 'application/json' } });
      };
      const r = reply();
      await handleMessages({ entry, body: { model: entry.id, max_tokens: 5, messages: [{ role: 'user', content: 'hi' }] }, tag: 't', fetch, log: () => {} }, r);
      return { urls, r };
    };
    await updateProvider('copilot', { accountType: 'ghe-com', enterpriseHost: 'acme.ghe.com' });
    await updateProvider('copilot', { githubToken: 'gho_t' });
    const trusted = await run('https://copilot-api.acme.ghe.com');
    assert.equal(trusted.r.statusCode, 200, JSON.stringify(trusted.r.body));
    assert.deepEqual(trusted.urls, ['https://api.acme.ghe.com/copilot_internal/v2/token', 'https://copilot-api.acme.ghe.com/v1/messages']);
    const untrusted = await run('https://evil.example');
    assert.deepEqual(untrusted.urls, ['https://api.acme.ghe.com/copilot_internal/v2/token', 'https://copilot-api.acme.ghe.com/v1/messages']);
    // Hand-edited ghe-com without a host: the bridge's upstream error, and nothing is fetched.
    const file = settingsFile();
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify({ providers: { copilot: { accountType: 'ghe-com', githubToken: 'gho_t' } } }));
    const warn = console.warn; console.warn = () => {};
    try {
      const bad = await run('https://api.githubcopilot.com');
      assert.deepEqual(bad.urls, []);
      assert.equal(bad.r.statusCode, 502);
      assert.match(JSON.stringify(bad.r.body), /GHE\.com tenant but has no valid host/);
    } finally { console.warn = warn; }
  } finally {
    for (const k of Object.keys(prev)) { if (prev[k] === undefined) delete process.env[k]; else process.env[k] = prev[k]; }
    await rm(home, { recursive: true, force: true });
  }
});

// ── GitHub's refusal on the token exchange ───────────────────────────────────

const refusalRes = (status, body, headers = {}) => ({
  ok: false, status, json: async () => body, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  headers: new Map(Object.entries(headers)),
});

test('readGithubRefusal: message, url, notification id, SSO header; never throws', async () => {
  const empty = { message: null, url: null, sso: null, notificationId: null };
  await checkRows([
    { name: 'error_details → all fields', run: async () => {
      const g = await readGithubRefusal(refusalRes(403, { error_details: { message: ' No seat ', url: 'https://acme.ghe.com/settings/copilot', notification_id: 'n1' }, message: 'ignored' }));
      assert.deepEqual(g, { message: 'No seat', url: 'https://acme.ghe.com/settings/copilot', sso: null, notificationId: 'n1' });
    } },
    { name: 'top-level message only', run: async () => assert.deepEqual(await readGithubRefusal(refusalRes(403, { message: 'Forbidden' })), { ...empty, message: 'Forbidden' }) },
    { name: 'documentation_url is not a reason', run: async () => assert.deepEqual(await readGithubRefusal(refusalRes(403, { documentation_url: 'https://docs.github.com/x' })), empty) },
    { name: 'empty body', run: async () => assert.deepEqual(await readGithubRefusal(refusalRes(403, '')), empty) },
    { name: 'non-JSON body', run: async () => assert.deepEqual(await readGithubRefusal(refusalRes(403, '<html>nope</html>')), empty) },
    { name: 'no text / no headers', run: async () => assert.deepEqual(await readGithubRefusal({ status: 403 }), empty) },
    { name: 'text() rejects', run: async () => assert.deepEqual(await readGithubRefusal({ status: 403, text: async () => { throw new Error('boom'); } }), empty) },
    { name: 'SSO header', run: async () => {
      const g = await readGithubRefusal(refusalRes(403, {}, { 'x-github-sso': 'required; url=https://bosch.ghe.com/orgs/x/sso?authorization_request=1' }));
      assert.deepEqual(g.sso, { required: true, url: 'https://bosch.ghe.com/orgs/x/sso?authorization_request=1' });
    } },
    { name: 'SSO header with a non-https url', run: async () => {
      const g = await readGithubRefusal(refusalRes(403, {}, { 'x-github-sso': 'required; url=javascript:alert(1)' }));
      assert.deepEqual(g.sso, { required: true, url: null });
    } },
    { name: 'http and javascript urls dropped', run: async () => {
      assert.equal((await readGithubRefusal(refusalRes(403, { error_details: { message: 'm', url: 'http://x.example/a' } }))).url, null);
      assert.equal((await readGithubRefusal(refusalRes(403, { error_details: { message: 'm', url: 'javascript:alert(1)' } }))).url, null);
    } },
    { name: '1,000-char message is capped', run: async () => {
      const g = await readGithubRefusal(refusalRes(403, { message: 'x'.repeat(1000) }));
      assert.ok(g.message.length <= 301 && g.message.endsWith('…'), g.message.length);
    } },
    { name: 'control characters stripped', run: async () => assert.equal((await readGithubRefusal(refusalRes(403, { message: 'a\u0000b\nc\u007fd' }))).message, 'a b c d') },
    { name: 'oversized notification id dropped', run: async () => assert.equal((await readGithubRefusal(refusalRes(403, { error_details: { message: 'm', notification_id: 'n'.repeat(101) } }))).notificationId, null) },
  ]);
});

test('githubReasonText: message+url, message, url, SSO and empty', () => {
  const g = (o) => ({ message: null, url: null, sso: null, notificationId: null, ...o });
  assert.equal(githubReasonText(null), '');
  assert.equal(githubReasonText(g({})), '');
  assert.equal(githubReasonText(g({ message: 'No seat', url: 'https://a.example/x' })), 'GitHub says: "No seat" (https://a.example/x)');
  assert.equal(githubReasonText(g({ message: 'No seat' })), 'GitHub says: "No seat"');
  assert.equal(githubReasonText(g({ url: 'https://a.example/x' })), 'GitHub gave a link: https://a.example/x');
  assert.equal(githubReasonText(g({ sso: { required: true, url: 'https://a.example/sso' } })), 'single sign-on authorization is required — https://a.example/sso');
  assert.equal(githubReasonText(g({ message: 'No seat', sso: { required: true, url: null } })), 'GitHub says: "No seat"; single sign-on authorization is required');
});

test('copilotRefusalText: tenant sign-in, bare, github.com, token; never "stored token" / "sign in again"', async () => {
  const reason = { message: 'No seat', url: null, sso: null, notificationId: null };
  const rows = [
    ['tenant sign-in with a reason', { host: 'acme.ghe.com', status: 403, login: 'octo', github: reason, via: 'sign-in' }, [/the sign-in on acme\.ghe\.com worked \(as octo\), but GitHub refused Copilot access \(403\)/, /GitHub says: "No seat"/, /enterprise admin/]],
    ['bare tenant sign-in', { host: 'acme.ghe.com', status: 403, via: 'sign-in' }, [/gave no reason/, /admin/]],
    ['github.com', { host: 'github.com', status: 401, github: reason }, [/Copilot subscription or seat/]],
    ['token', { host: 'acme.ghe.com', status: 403, via: 'token' }, [/for this token on acme\.ghe\.com/]],
  ];
  for (const [name, args, res] of rows) {
    const text = copilotRefusalText(args);
    for (const re of res) assert.match(text, re, name);
    assert.doesNotMatch(text, /stored token|sign in again/i, name);
  }
  assert.doesNotMatch(copilotRefusalText({ host: 'github.com', status: 403 }), /client id/i);
  assert.doesNotMatch(copilotRefusalText({ host: 'acme.ghe.com', status: 403 }), /client id/i);
});

test('copilotToken 401/403: stored-token text (reason appended), structured fields, cache dropped', async () => {
  await checkRows([
    { name: 'bare 401 is byte-identical', run: async () => {
      const f = stub([[/v2\/token$/, () => refusalRes(401, '')]]);
      await assert.rejects(copilotToken('gho_a', { fetch: f, log: () => {} }), (e) => {
        assert.equal(e.message, 'GitHub rejected the stored token (401) — sign in again');
        assert.equal(e.code, 'AUTH'); assert.equal(e.status, 401); assert.equal(e.host, 'github.com');
        return true;
      });
    } },
    { name: '403 with error_details on a tenant', run: async () => {
      const f = stub([[/v2\/token$/, () => refusalRes(403, { error_details: { message: 'No seat', url: 'https://acme.ghe.com/s' } })]]);
      await assert.rejects(copilotToken('gho_b', { fetch: f, enterpriseHost: 'acme.ghe.com', log: () => {} }), (e) => {
        assert.ok(e.message.startsWith('GitHub rejected the stored token (403) — sign in again'));
        assert.match(e.message, /GitHub says: "No seat"/);
        assert.equal(e.github.message, 'No seat'); assert.equal(e.host, 'acme.ghe.com');
        return true;
      });
    } },
    { name: 'cache dropped: next call refetches', run: async () => {
      let n = 0; const now = 1_000_000;
      const f = stub([[/v2\/token$/, () => { n += 1; return n === 2 ? refusalRes(403, '') : jsonRes(200, { token: `cp_${n}`, expires_at: Math.floor(now / 1000) + 1800 }); }]]);
      await copilotToken('gho_c', { fetch: f, now: () => now });
      await assert.rejects(copilotToken('gho_c', { fetch: f, now: () => now, force: true, log: () => {} }));
      assert.equal((await copilotToken('gho_c', { fetch: f, now: () => now })).token, 'cp_3');
    } },
  ]);
});

test('copilotToken refusal log: one line, no token, deduped for 10 minutes, reset clears it', async () => {
  const lines = [];
  const log = (l) => lines.push(l);
  let t = 5_000_000;
  const f = stub([[/v2\/token$/, () => refusalRes(403, { error_details: { message: 'No seat for gho_leaky here', notification_id: 'n9' } }, { 'x-github-sso': 'required; url=https://acme.ghe.com/sso' })]]);
  const call = () => copilotToken('gho_leaky', { fetch: f, enterpriseHost: 'acme.ghe.com', log, now: () => t }).catch(() => {});
  await call();
  assert.equal(lines.length, 1);
  assert.match(lines[0], /403/);
  assert.match(lines[0], /https:\/\/api\.acme\.ghe\.com\/copilot_internal\/v2\/token/);
  assert.match(lines[0], /No seat for \[redacted\] here/);
  assert.match(lines[0], /\[notification n9\]/);
  assert.match(lines[0], /\[sso required\]/);
  assert.doesNotMatch(lines[0], /gho_leaky/);
  assert.doesNotMatch(lines[0], /acme\.ghe\.com\/sso/);
  await call();
  assert.equal(lines.length, 1);
  t += 11 * 60 * 1000;
  await call();
  assert.equal(lines.length, 2);
  _resetCopilotCache();
  await call();
  assert.equal(lines.length, 3);
  const bare = stub([[/v2\/token$/, () => refusalRes(401, '')]]);
  await copilotToken('gho_z', { fetch: bare, log, now: () => t }).catch(() => {});
  assert.match(lines.at(-1), /answered 401 with no reason/);
});

test('device flow on a tenant: the Copilot app client id on start and poll; a refused start names the Copilot app', async () => {
  const bodies = [];
  const f = stub([
    [/device\/code$/, (u, init) => { bodies.push(JSON.parse(init.body)); return jsonRes(200, { device_code: 'dc', user_code: 'AB-12', interval: 5, expires_in: 900 }); }],
    [/access_token$/, (u, init) => { bodies.push(JSON.parse(init.body)); return jsonRes(200, { error: 'authorization_pending' }); }],
  ]);
  await startDeviceFlow({ fetch: f, enterpriseHost: 'acme.ghe.com' });
  await pollDeviceFlow('dc', { fetch: f, enterpriseHost: 'acme.ghe.com' });
  assert.deepEqual(bodies.map((b) => b.client_id), [GITHUB_CLIENT_ID, GITHUB_CLIENT_ID]);
  const bad = stub([[/device\/code$/, () => jsonRes(404, {})]]);
  await assert.rejects(startDeviceFlow({ fetch: bad, enterpriseHost: 'acme.ghe.com' }), /the GitHub Copilot app/);
});
