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
} from '../src/core/bridge/providers/copilot.mjs';

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
  assert.deepEqual(s, { deviceCode: 'dc', userCode: 'ABCD-1234', verificationUri: 'https://github.com/login/device', interval: 5, expiresIn: 900 });
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
  await assert.rejects(copilotToken('gho_bad', { fetch: f }), (e) => e.code === 'AUTH');
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

test('initiator + vision detection from a Messages body', () => {
  assert.equal(requestInitiator({ messages: [{ role: 'user', content: 'x' }] }), 'user');
  assert.equal(requestInitiator({ messages: [{ role: 'assistant', content: 'x' }] }), 'agent');
  assert.equal(requestInitiator({ messages: [{ role: 'user', content: [{ type: 'tool_result', tool_use_id: 'a', content: 'b' }] }] }), 'agent');
  assert.equal(requestInitiator({}), 'user');
  assert.equal(bodyHasImage({ messages: [{ role: 'user', content: [{ type: 'image', source: {} }] }] }), true);
  assert.equal(bodyHasImage({ messages: [{ role: 'user', content: [{ type: 'tool_result', content: [{ type: 'image' }] }] }] }), true);
  assert.equal(bodyHasImage({ messages: [{ role: 'user', content: 'no' }] }), false);
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

test('initiator: the CLI\'s trailing system reminders do not turn a tool-loop continuation into a user turn', () => {
  const call = { role: 'assistant', content: [{ type: 'thinking', thinking: 't', signature: 's' }, { type: 'tool_use', id: 't1', name: 'Read', input: {} }] };
  const result = { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }] };
  const reminder = { role: 'system', content: [{ type: 'text', text: '<total_tokens>14999970 tokens left</total_tokens>' }] };
  // The shape of both captured CLI continuations: … assistant > user(tool_result) > system.
  assert.equal(requestInitiator({ messages: [{ role: 'user', content: 'go' }, { role: 'system', content: 'deferred tools' }, call, result, reminder] }), 'agent');
  assert.equal(requestInitiator({ messages: [{ role: 'user', content: 'go' }, call, reminder, { role: 'system', content: 'more' }] }), 'agent');
  // A new prompt stays a user turn, with or without a reminder after it.
  assert.equal(requestInitiator({ messages: [{ role: 'user', content: 'go' }, reminder] }), 'user');
  assert.equal(requestInitiator({ messages: [reminder] }), 'user');
});
