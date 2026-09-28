// test/api-providers.test.mjs
// The provider routes (model-bridge-design.md §9) against a stubbed
// globalThis.fetch standing in for github.com: state payloads never carry a
// token, the terms gate on login, the device-flow poll, the models list and
// the import, PATCH validation, /api/models' bridged facts, and the CLI's
// pure formatters. Sandboxes HOME (settings.json) + WORCA_HOME (DB).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _resetForTests } from '../src/core/db.mjs';
import { _resetCopilotCache } from '../src/core/bridge/providers/copilot.mjs';
import { formatModelLine, formatProviders, modelsArgs, cmdModels } from '../src/cli/models.mjs';

let srv, base, homeDir, worcaHomeDir;
const prevEnv = {
  HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, WORCA_HOME: process.env.WORCA_HOME,
  WORCA_TEST_ALLOW_HOME_FALLBACK: process.env.WORCA_TEST_ALLOW_HOME_FALLBACK,
};
const realFetch = globalThis.fetch;
const jsonRes = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
let pollState = 'pending';
let modelsExtra = [];
const github = async (url, init = {}) => {
  const u = String(url);
  if (u.startsWith(base)) return realFetch(url, init);
  if (/login\/device\/code$/.test(u)) return jsonRes(200, { device_code: 'dc1', user_code: 'WXYZ-9876', verification_uri: 'https://github.com/login/device', interval: 1, expires_in: 900 });
  if (/oauth\/access_token$/.test(u)) return pollState === 'ok' ? jsonRes(200, { access_token: 'gho_test' }) : jsonRes(200, { error: 'authorization_pending' });
  if (/api\.github\.com\/user$/.test(u)) return jsonRes(200, { login: 'octo' });
  if (/copilot_internal\/v2\/token$/.test(u)) return init.headers.authorization === 'token gho_test' ? jsonRes(200, { token: 'cp_t', expires_at: Math.floor(Date.now() / 1000) + 1800, endpoints: { api: 'https://api.individual.githubcopilot.com' } }) : jsonRes(401, {});
  if (/copilot_internal\/user$/.test(u)) return jsonRes(200, { quota_snapshots: { premium_interactions: { entitlement: 300, remaining: 250 } } });
  if (/githubcopilot\.com\/models$/.test(u)) {
    return jsonRes(200, { data: [
      { id: 'gpt-5', name: 'GPT-5', vendor: 'OpenAI', capabilities: { type: 'chat', supports: { tool_calls: true, reasoning_effort: true }, limits: { max_prompt_tokens: 100000, max_output_tokens: 16000 } } },
      { id: 'claude-sonnet-4.5', name: 'Claude Sonnet 4.5', vendor: 'Anthropic', capabilities: { type: 'chat', supports: { tool_calls: true, vision: true }, limits: { max_context_window_tokens: 200000 } } },
      ...modelsExtra,
    ] });
  }
  return jsonRes(404, { message: `no stub for ${u}` });
};
const jfetch = async (path, opts) => { const r = await realFetch(`${base}${path}`, opts); return { status: r.status, body: await r.json().catch(() => null) }; };
const post = (path, body) => jfetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
const patch = (path, body) => jfetch(path, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

before(async () => {
  homeDir = await mkdtemp(join(tmpdir(), 'worca-cc-apiprov-home-'));
  worcaHomeDir = await mkdtemp(join(tmpdir(), 'worca-cc-apiprov-whome-'));
  process.env.HOME = homeDir; process.env.USERPROFILE = homeDir; process.env.WORCA_HOME = worcaHomeDir;
  process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = '1';
  _resetForTests();
  _resetCopilotCache();
  const { app } = await import('../ui/server.mjs');
  srv = http.createServer(app);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
  globalThis.fetch = github;
});
after(async () => {
  globalThis.fetch = realFetch;
  if (srv) await new Promise((r) => srv.close(r));
  _resetForTests();
  for (const k of Object.keys(prevEnv)) { if (prevEnv[k] === undefined) delete process.env[k]; else process.env[k] = prevEnv[k]; }
  await Promise.all([homeDir, worcaHomeDir].map((d) => rm(d, { recursive: true, force: true })));
});

test('GET /api/providers: defaults, never a token', async () => {
  const { status, body } = await jfetch('/api/providers');
  assert.equal(status, 200);
  assert.equal(body.copilot.connected, false);
  assert.equal(body.copilot.termsCurrent, false);
  assert.equal(body.copilot.accountType, 'individual');
  assert.equal(body.openai.configured, false);
  assert.equal(body.openai.baseUrl, 'https://api.openai.com/v1');
  assert.equal(JSON.stringify(body).includes('gho_'), false);
});

test('login is refused until the notice is acknowledged (409 TERMS)', async () => {
  const r = await post('/api/providers/copilot/login');
  assert.equal(r.status, 409);
  assert.equal(r.body.code, 'TERMS');
  const a = await post('/api/providers/copilot/acknowledge');
  assert.equal(a.status, 200);
  assert.equal(a.body.copilot.termsCurrent, true);
  assert.match(a.body.copilot.acknowledgedTerms, /^\d{4}-\d{2}-\d{2}T/);
});

test('device flow: start → pending → ok stores the sign-in; state shows the login; quota on demand; models list; import', async () => {
  const start = await post('/api/providers/copilot/login');
  assert.equal(start.status, 200, JSON.stringify(start.body));
  assert.equal(start.body.userCode, 'WXYZ-9876');
  const p1 = await jfetch(`/api/providers/copilot/login/${start.body.deviceCode}`);
  assert.deepEqual(p1.body, { pending: true, interval: 1 });
  pollState = 'ok';
  const p2 = await jfetch(`/api/providers/copilot/login/${start.body.deviceCode}`);
  assert.deepEqual(p2.body, { ok: true, login: 'octo' });
  const unknown = await jfetch('/api/providers/copilot/login/nope');
  assert.match(unknown.body.error, /unknown or expired/);

  const st = await jfetch('/api/providers?quota=1');
  assert.equal(st.body.copilot.connected, true);
  assert.equal(st.body.copilot.login, 'octo');
  assert.equal(st.body.copilot.tokenSource, 'stored');
  assert.deepEqual(st.body.copilot.quota.used, 50);
  assert.equal(JSON.stringify(st.body).includes('gho_test'), false);

  const list = await jfetch('/api/providers/copilot/models');
  assert.equal(list.status, 200);
  assert.deepEqual(list.body.models.map((m) => [m.id, m.catalogId, m.inCatalog]), [['claude-sonnet-4.5', 'copilot-claude-sonnet-4.5', false], ['gpt-5', 'copilot-gpt-5', false]]);

  const bad = await post('/api/providers/copilot/import-models', { provider: 'openai', ids: ['x'] });
  assert.equal(bad.status, 400);
  const none = await post('/api/providers/copilot/import-models', { ids: [] });
  assert.equal(none.status, 400);
  const imp = await post('/api/providers/copilot/import-models', { provider: 'copilot', ids: ['gpt-5', 'claude-sonnet-4.5', 'ghost'] });
  assert.equal(imp.status, 200, JSON.stringify(imp.body));
  assert.deepEqual(imp.body.created, ['copilot-gpt-5', 'copilot-claude-sonnet-4.5']);
  assert.deepEqual(imp.body.skipped, ['ghost']);
  const gpt = imp.body.models.find((m) => m.id === 'copilot-gpt-5');
  assert.equal(gpt.bridged, 'copilot');
  assert.equal(gpt.needsSignIn, false);
  assert.deepEqual(gpt.efforts, ['medium', 'high', 'xhigh', 'max']);   // reasoning model keeps every effort
  assert.deepEqual(gpt.upstream, { provider: 'copilot', api: 'openai-chat', model: 'gpt-5', capabilities: { toolCalls: true, vision: false, reasoning: true, maxPromptTokens: 100000, maxOutputTokens: 16000 } });
  assert.deepEqual(gpt.cost, { free: true });
  const cl = imp.body.models.find((m) => m.id === 'copilot-claude-sonnet-4.5');
  assert.equal(cl.upstream.api, 'anthropic');

  // Re-import refreshes capabilities but keeps a user-edited label.
  await patch('/api/models/copilot-gpt-5', { label: 'My GPT' });
  const again = await post('/api/providers/copilot/import-models', { provider: 'copilot', ids: ['gpt-5'] });
  assert.deepEqual(again.body.updated, ['copilot-gpt-5']);
  assert.equal(again.body.models.find((m) => m.id === 'copilot-gpt-5').label, 'My GPT');

  // /api/config carries the picker facts.
  const cfg = await jfetch('/api/config');
  const row = cfg.body.models.find((m) => m.id === 'copilot-gpt-5');
  assert.equal(row.bridged, 'copilot');
  assert.equal(row.upstreamApi, 'openai-chat');
  assert.equal(row.routed, true);
  assert.equal(row.needsSignIn, false);
  const ask = await jfetch('/api/ask/models');
  assert.equal(ask.body.models.find((m) => m.id === 'copilot-gpt-5').bridged, 'copilot');
});

test('import: Responses-only and list-reasoning models get the Responses API and their efforts; re-import repairs what the old importer stored', async () => {
  modelsExtra = [
    { id: 'gpt-6-astra', name: 'GPT-6 Astra', vendor: 'OpenAI', supported_endpoints: ['/responses', 'ws:/responses'], capabilities: { type: 'chat', supports: { tool_calls: true, vision: true, reasoning_effort: ['low', 'medium', 'high', 'xhigh', 'max'] }, limits: { max_prompt_tokens: 272000, max_output_tokens: 128000 } } },
    { id: 'gemini-3.8-flash', name: 'Gemini 3.8 Flash', vendor: 'Google', supported_endpoints: ['/chat/completions'], capabilities: { type: 'chat', supports: { tool_calls: true, reasoning_effort: ['low', 'medium', 'high'] }, limits: { max_prompt_tokens: 200000 } } },
  ];
  try {
    const list = await jfetch('/api/providers/copilot/models');
    const row = Object.fromEntries(list.body.models.map((m) => [m.id, m]));
    assert.equal(row['gpt-6-astra'].api, 'openai-responses');
    assert.equal(row['gemini-3.8-flash'].api, 'openai-chat');
    assert.equal(row['claude-sonnet-4.5'].api, 'anthropic');

    // What the old importer stored for both: chat API, not reasoning, trimmed to medium.
    for (const id of ['gpt-6-astra', 'gemini-3.8-flash']) {
      const r = await post('/api/models', { id: `copilot-${id}`, label: `${id} (Copilot)`, efforts: ['medium'], upstream: { provider: 'copilot', api: 'openai-chat', model: id, capabilities: { toolCalls: true, reasoning: false } }, cost: { free: true } });
      assert.equal(r.status, 200, JSON.stringify(r.body));
    }
    // A reasoning model the user pinned to medium on purpose keeps it — and so does a
    // Claude entry (the old importer never trimmed those; its stub reports no reasoning).
    const pin = await patch('/api/models/copilot-gpt-5', { efforts: ['medium'] });
    assert.equal(pin.status, 200, JSON.stringify(pin.body));
    const pinClaude = await patch('/api/models/copilot-claude-sonnet-4.5', { efforts: ['medium'] });
    assert.equal(pinClaude.status, 200, JSON.stringify(pinClaude.body));

    const again = await post('/api/providers/copilot/import-models', { provider: 'copilot', ids: ['gpt-6-astra', 'gemini-3.8-flash', 'gpt-5', 'claude-sonnet-4.5'] });
    assert.equal(again.status, 200, JSON.stringify(again.body));
    assert.deepEqual([...again.body.updated].sort(), ['copilot-claude-sonnet-4.5', 'copilot-gemini-3.8-flash', 'copilot-gpt-5', 'copilot-gpt-6-astra']);
    const got = Object.fromEntries(again.body.models.map((m) => [m.id, m]));
    assert.equal(got['copilot-gpt-6-astra'].upstream.api, 'openai-responses');
    assert.deepEqual(got['copilot-gpt-6-astra'].upstream.capabilities.reasoningEfforts, ['low', 'medium', 'high', 'xhigh', 'max']);
    assert.equal(got['copilot-gpt-6-astra'].upstream.capabilities.reasoning, true);
    assert.deepEqual(got['copilot-gpt-6-astra'].efforts, ['medium', 'high', 'xhigh', 'max']);   // widened from the old medium-only default
    assert.equal(got['copilot-gpt-6-astra'].label, 'gpt-6-astra (Copilot)');                    // label untouched
    assert.equal(got['copilot-gemini-3.8-flash'].upstream.api, 'openai-chat');
    assert.deepEqual(got['copilot-gemini-3.8-flash'].efforts, ['medium', 'high']);
    assert.deepEqual(got['copilot-gpt-5'].efforts, ['medium']);                                  // chosen by the user: untouched
    assert.deepEqual(got['copilot-claude-sonnet-4.5'].efforts, ['medium']);                      // ditto
    assert.equal(got['copilot-claude-sonnet-4.5'].upstream.api, 'anthropic');
  } finally {
    modelsExtra = [];
  }
});

test('PATCH /api/providers: validation, masked echo = keep, logout flips the catalog to needs-sign-in', async () => {
  assert.equal((await patch('/api/providers/copilot', { accountType: 'team' })).status, 400);
  assert.equal((await patch('/api/providers/nope', {})).status, 400);
  const ok = await patch('/api/providers/openai', { apiKey: 'sk-live-key-1234', baseUrl: 'https://gw.example/v1', maxConcurrent: 3 });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.openai.configured, true);
  assert.equal(ok.body.openai.keyMasked, '••••••1234');
  assert.equal(JSON.stringify(ok.body).includes('sk-live-key'), false);
  const keep = await patch('/api/providers/openai', { apiKey: '••••••1234', maxConcurrent: 4 });
  assert.equal(keep.body.openai.configured, true);
  assert.equal(keep.body.openai.maxConcurrent, 4);

  const out = await post('/api/providers/copilot/logout');
  assert.equal(out.body.copilot.connected, false);
  assert.equal(out.body.copilot.termsCurrent, true);   // the acknowledgement stays
  const models = await jfetch('/api/models');
  const gpt = models.body.models.find((m) => m.id === 'copilot-gpt-5');
  assert.equal(gpt.needsSignIn, true);
  assert.equal(gpt.signInReason, 'not_signed_in');
  const t = await post('/api/models/copilot-gpt-5/test');
  assert.equal(t.status, 200);
  assert.equal(t.body.ok, false);
  assert.match(t.body.hint, /sign in to copilot/);
  const lst = await jfetch('/api/providers/copilot/models');
  assert.equal(lst.status, 409);
  assert.equal(lst.body.code, 'NOT_SIGNED_IN');
});

test('POST/PATCH /api/models with upstream: validation messages surface; masked apiKey echo keeps the stored key', async () => {
  const bad = await post('/api/models', { id: 'x', upstream: { provider: 'openai', api: 'anthropic', model: 'm' } });
  assert.equal(bad.status, 400);
  assert.match(bad.body.error, /cannot be driven through api anthropic/);
  const clash = await post('/api/models', { id: 'x', upstream: { provider: 'openai', api: 'openai-chat', model: 'm' }, env: { ANTHROPIC_MODEL: 'z' } });
  assert.match(clash.body.error, /cannot be set on a model with an upstream/);
  const ok = await post('/api/models', { id: 'gw', upstream: { provider: 'openai', api: 'openai-chat', model: 'm', apiKey: 'sk-entry-key-5678' } });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.model.upstream.apiKey, '••••••5678');
  const echoed = await patch('/api/models/gw', { upstream: { provider: 'openai', api: 'openai-chat', model: 'm2', apiKey: '••••••5678' } });
  assert.equal(echoed.status, 200);
  assert.equal(echoed.body.model.upstream.model, 'm2');
  const raw = await jfetch('/api/models/gw/env-value');
  assert.equal(raw.status, 200);   // env-value is env only; the key stays server-side
  const cleared = await patch('/api/models/gw', { upstream: null });
  assert.equal(cleared.body.model.upstream, undefined);
  assert.equal(cleared.body.model.bridged, undefined);
});

test('provider connection test: openai against the stub', async () => {
  globalThis.fetch = async (url, init) => (/gw\.example\/v1\/models$/.test(String(url)) ? jsonRes(200, { data: [{ id: 'a' }, { id: 'b' }] }) : github(url, init));
  try {
    const r = await post('/api/providers/openai/test');
    assert.deepEqual(r.body, { ok: true, models: 2 });
    const c = await post('/api/providers/copilot/test');
    assert.equal(c.body.ok, false);
    assert.match(c.body.message, /not signed in/);
    // The card sends what is on screen: an unsaved local base URL is tested as typed, keylessly.
    let asked = null;
    globalThis.fetch = async (url, init) => { const u = String(url); if (u.startsWith(base)) return github(url, init); asked = [u, init.headers.authorization ?? null]; return jsonRes(200, { data: [{ id: 'x' }] }); };
    const typed = await post('/api/providers/openai/test', { baseUrl: 'http://127.0.0.1:11434/v1' });
    assert.deepEqual(typed.body, { ok: true, models: 1 });
    // The endpoint is the typed one; the STORED key still travels, because this provider has one.
    assert.deepEqual(asked, ['http://127.0.0.1:11434/v1/models', 'Bearer sk-live-key-1234']);
  } finally {
    globalThis.fetch = github;
  }
});

test('CLI formatters + argv parser + `worca models providers/list` through injected io', async () => {
  assert.match(formatModelLine({ id: 'copilot-gpt-6-astra', custom: 'global', bridged: 'copilot', upstreamModel: 'gpt-6-astra', upstreamApi: 'openai-responses' }), /bridged: copilot → gpt-6-astra \(translated\)/);
  assert.equal(formatModelLine({ id: 'copilot-gpt-5', label: 'My GPT', custom: 'global', bridged: 'copilot', upstreamModel: 'gpt-5', upstreamApi: 'openai-chat', needsSignIn: true, signInReason: 'not_signed_in' }),
    'copilot-gpt-5  (My GPT)  yours  bridged: copilot → gpt-5 (translated)  NEEDS SIGN-IN');
  assert.equal(formatModelLine({ id: 'claude-opus-4-8', label: 'Opus', custom: false, hidden: true }), 'claude-opus-4-8  (Opus)  built-in  hidden');
  const lines = formatProviders({ copilot: { connected: true, login: 'o', accountType: 'individual', maxConcurrent: 4, termsCurrent: true, acknowledgedTerms: '2026-09-20T00:00:00Z', quota: { used: 1, entitlement: 5 } }, openai: { configured: false, keySet: true, keySource: 'env', keyRef: '${K}', baseUrl: 'u', maxConcurrent: 8 }, anthropic: { maxConcurrent: 8 } });
  assert.match(lines[0], /connected as @o.*terms=acknowledged 2026-09-20/);
  assert.match(lines[1], /premium requests: 1 \/ 5/);
  assert.match(lines[2], /openai.*key \$\{VAR\} NOT SET \(\$\{K\}\)/);
  assert.deepEqual(modelsArgs(['import', 'copilot', '--pick=a,b', '--yes'], ['--pick'], ['--yes']), { _: ['import', 'copilot'], pick: 'a,b', yes: true });
  assert.throws(() => modelsArgs(['--bogus']), /Unknown flag/);

  const out = [];
  const io = { out: (s) => out.push(s), c: (n, s) => s, fail: (m) => { throw new Error(m); } };
  assert.equal(await cmdModels(['providers'], io), 0);
  assert.match(out.join('\n'), /copilot\s+not connected/);
  out.length = 0;
  assert.equal(await cmdModels(['list'], io), 0);
  assert.ok(out.some((l) => /copilot-gpt-5.*NEEDS SIGN-IN/.test(l)));
  out.length = 0;
  assert.equal(await cmdModels([], io), 0);
  assert.match(out[0], /worca models/);
  await assert.rejects(cmdModels(['login', 'openai'], io), /only `worca models login copilot`/);
  await assert.rejects(cmdModels(['import', 'copilot', '--all', '--yes'], io), /not signed in/);
  // login with --accept-terms walks the device flow against the stub.
  pollState = 'ok';
  out.length = 0;
  assert.equal(await cmdModels(['login', 'copilot', '--accept-terms'], { ...io, sleep: async () => {} }), 0);
  assert.ok(out.some((l) => /WXYZ-9876/.test(l)));
  assert.ok(out.some((l) => /Connected to GitHub Copilot as @octo/.test(l)));
  out.length = 0;
  assert.equal(await cmdModels(['import', 'copilot'], io), 0);   // no --all/--pick: lists
  assert.ok(out.some((l) => /gpt-5.*OpenAI/.test(l)));
  assert.equal(await cmdModels(['logout', 'copilot'], io), 0);
});
