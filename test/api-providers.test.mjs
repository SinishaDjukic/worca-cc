// test/api-providers.test.mjs
// The provider routes (model-bridge-design.md §9) against a stubbed
// globalThis.fetch standing in for github.com: state payloads never carry a
// token, the device-flow login and poll, the models list and
// the import, PATCH validation, /api/models' bridged facts, and the CLI's
// pure formatters. Sandboxes HOME (settings.json) + WORCA_HOME (DB).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _resetForTests } from '../src/core/db.mjs';
import { _resetCopilotCache } from '../src/core/bridge/providers/copilot.mjs';
import { settingsFile } from '../src/core/settings.mjs';
import { testProviderConnection } from '../src/core/bridge/provider-ops.mjs';
import { formatModelLine, formatProviders, modelsArgs, cmdModels } from '../src/cli/models.mjs';

let srv, base, homeDir, worcaHomeDir;
const prevEnv = {
  HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, WORCA_HOME: process.env.WORCA_HOME,
  WORCA_TEST_ALLOW_HOME_FALLBACK: process.env.WORCA_TEST_ALLOW_HOME_FALLBACK,
};
const realFetch = globalThis.fetch;
const jsonRes = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
let pollState = 'pending';
let pollToken = 'gho_test';   // the access_token the oauth poll hands out once pollState is 'ok'
const deviceBodies = [];      // the JSON body of every device-flow request (start and poll)
let modelsExtra = [];
const seen = [];   // every non-server URL fetched, in order
const github = async (url, init = {}) => {
  const u = String(url);
  if (u.startsWith(base)) return realFetch(url, init);
  seen.push(u);
  if (/login\/(device\/code|oauth\/access_token)$/.test(u)) deviceBodies.push({ url: u, ...JSON.parse(init.body) });
  // A GHE.com tenant (acme.ghe.com): its own device flow, REST host and Copilot gateway.
  if (/^https:\/\/acme\.ghe\.com\/login\/device\/code$/.test(u)) return jsonRes(200, { device_code: 'dc-acme', user_code: 'ACME-0001', verification_uri: 'https://acme.ghe.com/login/device', interval: 1, expires_in: 900 });
  if (/^https:\/\/api\.acme\.ghe\.com\/user$/.test(u)) return jsonRes(200, { login: 'tenant-octo' });
  if (/^https:\/\/api\.acme\.ghe\.com\/copilot_internal\/v2\/token$/.test(u) && init.headers.authorization === 'token gho_refused') return jsonRes(403, { message: 'Forbidden', error_details: { message: 'Copilot is not enabled for your account', url: 'https://acme.ghe.com/settings/copilot', notification_id: 'no_copilot_access' } });
  if (/^https:\/\/api\.acme\.ghe\.com\/copilot_internal\/v2\/token$/.test(u) && init.headers.authorization === 'token gho_bare403') return new Response('', { status: 403 });
  if (/^https:\/\/api\.acme\.ghe\.com\/copilot_internal\/v2\/token$/.test(u)) return init.headers.authorization === 'token gho_test' ? jsonRes(200, { token: 'cp_acme', expires_at: Math.floor(Date.now() / 1000) + 1800, endpoints: { api: 'https://copilot-api.acme.ghe.com' } }) : jsonRes(401, {});
  if (/^https:\/\/copilot-api\.acme\.ghe\.com\/models$/.test(u)) return jsonRes(200, { data: [{ id: 'tenant-model', name: 'Tenant Model', vendor: 'OpenAI', capabilities: { type: 'chat' } }] });
  if (/login\/device\/code$/.test(u)) return jsonRes(200, { device_code: 'dc1', user_code: 'WXYZ-9876', verification_uri: 'https://github.com/login/device', interval: 1, expires_in: 900 });
  if (/oauth\/access_token$/.test(u)) return pollState === 'ok' ? jsonRes(200, { access_token: pollToken }) : jsonRes(200, { error: 'authorization_pending' });
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
  assert.equal('termsCurrent' in body.copilot, false);
  assert.equal('acknowledgedTerms' in body.copilot, false);
  assert.equal(body.copilot.accountType, 'individual');
  assert.equal(body.openai.configured, false);
  assert.equal(body.openai.baseUrl, 'https://api.openai.com/v1');
  assert.equal(JSON.stringify(body).includes('gho_'), false);
});

test('Copilot sign-in needs no acknowledgement: the old acknowledge route is gone', async () => {
  const r = await post('/api/providers/copilot/acknowledge');
  assert.equal(r.status, 404);
});

test('device flow: start → pending → ok stores the sign-in; state shows the login; quota on demand; models list; import', async () => {
  // No acknowledgement first: sign-in starts straight away (the notice is gone).
  const start = await post('/api/providers/copilot/login');
  assert.equal(start.status, 200, JSON.stringify(start.body));
  assert.equal(start.body.userCode, 'WXYZ-9876');
  const p1 = await jfetch(`/api/providers/copilot/login/${start.body.deviceCode}`, { method: 'POST' });
  assert.deepEqual(p1.body, { pending: true, interval: 1 });
  pollState = 'ok';
  const p2 = await jfetch(`/api/providers/copilot/login/${start.body.deviceCode}`, { method: 'POST' });
  assert.deepEqual(p2.body, { ok: true, login: 'octo' });
  const unknown = await jfetch('/api/providers/copilot/login/nope', { method: 'POST' });
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

const copilotPatch = (b) => patch('/api/providers/copilot', b);
const seenSince = (n) => seen.slice(n);

test('GHE.com tenant end to end: PATCH → login begins on acme.ghe.com and returns host; poll stores the token; state shows host; quota and models hit the tenant', async () => {
  pollState = 'ok';
  const set = await copilotPatch({ accountType: 'ghe-com', enterpriseHost: ' https://Acme.ghe.com/ ' });
  assert.equal(set.status, 200, JSON.stringify(set.body));
  assert.equal(set.body.copilot.enterpriseHost, 'acme.ghe.com');
  assert.equal(set.body.copilot.githubHost, 'acme.ghe.com');
  assert.equal(set.body.copilot.accountType, 'ghe-com');
  const n0 = seen.length;
  const start = await post('/api/providers/copilot/login');
  assert.equal(start.status, 200, JSON.stringify(start.body));
  assert.equal(start.body.host, 'acme.ghe.com');
  assert.equal(start.body.verificationUri, 'https://acme.ghe.com/login/device');
  const done = await jfetch(`/api/providers/copilot/login/${start.body.deviceCode}`, { method: 'POST' });
  assert.deepEqual(done.body, { ok: true, login: 'tenant-octo' });
  assert.deepEqual(seenSince(n0), [
    'https://acme.ghe.com/login/device/code', 'https://acme.ghe.com/login/oauth/access_token',
    'https://api.acme.ghe.com/user', 'https://api.acme.ghe.com/copilot_internal/v2/token',
  ]);
  const n1 = seen.length;
  const st = await jfetch('/api/providers?quota=1');
  assert.equal(st.body.copilot.connected, true);
  assert.equal(st.body.copilot.githubHost, 'acme.ghe.com');
  assert.equal(st.body.copilot.quota.used, 50);
  assert.equal(JSON.stringify(st.body).includes('gho_test'), false);
  assert.deepEqual(seenSince(n1), ['https://api.acme.ghe.com/copilot_internal/user']);
  const n2 = seen.length;
  const list = await jfetch('/api/providers/copilot/models');
  assert.deepEqual(list.body.models.map((m) => m.id), ['tenant-model']);
  assert.ok(seenSince(n2).includes('https://copilot-api.acme.ghe.com/models'));
  assert.ok(seenSince(n2).every((u) => /\.acme\.ghe\.com\//.test(u)), 'every call goes to the tenant');
  const conn = await testProviderConnection('copilot', { fetch: github });
  assert.deepEqual(conn, { ok: true });
});

test('changing the host while signed in signs out (state connected:false) in one PATCH', async () => {
  const before = (await jfetch('/api/providers')).body.copilot;
  assert.equal(before.connected, true);
  const r = await copilotPatch({ enterpriseHost: 'other.ghe.com' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.copilot.connected, false);
  assert.equal(r.body.copilot.login, null);
  assert.equal(r.body.copilot.enterpriseHost, 'other.ghe.com');
  assert.equal(r.body.copilot.githubHost, 'other.ghe.com');
});

test('PATCH validation: ghe-com without a host, a host with a path or port, a host without ghe-com are 400 with the message; nothing stored', async () => {
  assert.equal((await copilotPatch({ accountType: 'individual' })).status, 200);
  const raw = await readFile(settingsFile(), 'utf8');
  const cases = [
    [{ accountType: 'ghe-com' }, /needs enterpriseHost/],
    [{ accountType: 'ghe-com', enterpriseHost: 'acme.ghe.com/x' }, /enterpriseHost must be a GHE\.com host like acme\.ghe\.com/],
    [{ accountType: 'ghe-com', enterpriseHost: 'acme.ghe.com:443' }, /with no path, port or credentials/],
    [{ enterpriseHost: 'acme.ghe.com' }, /applies only to accountType ghe-com/],
    [{ accountType: 'business', enterpriseHost: 'acme.ghe.com' }, /applies only to accountType ghe-com/],
  ];
  for (const [body, re] of cases) {
    const r = await copilotPatch(body);
    assert.equal(r.status, 400, JSON.stringify(body));
    assert.match(r.body.error, re);
  }
  assert.equal(await readFile(settingsFile(), 'utf8'), raw);
});

test('host changed between login begin and approval: poll returns the HOST_CHANGED error and stores no token', async () => {
  pollState = 'ok';
  assert.equal((await copilotPatch({ accountType: 'ghe-com', enterpriseHost: 'acme.ghe.com' })).status, 200);
  const start = await post('/api/providers/copilot/login');
  assert.equal(start.status, 200, JSON.stringify(start.body));
  assert.equal((await copilotPatch({ enterpriseHost: 'other.ghe.com' })).status, 200);       // the person edits the host meanwhile
  const done = await jfetch(`/api/providers/copilot/login/${start.body.deviceCode}`, { method: 'POST' });
  assert.match(done.body.error, /host changed during the sign-in/);
  assert.equal((await jfetch('/api/providers')).body.copilot.connected, false);
  assert.equal((await copilotPatch({ accountType: 'individual' })).status, 200);
});

const signInRefused = async (token) => {
  pollState = 'ok'; pollToken = token;
  try {
    assert.equal((await copilotPatch({ accountType: 'ghe-com', enterpriseHost: 'acme.ghe.com' })).status, 200);
    const start = await post('/api/providers/copilot/login');
    assert.equal(start.status, 200, JSON.stringify(start.body));
    return await jfetch(`/api/providers/copilot/login/${start.body.deviceCode}`, { method: 'POST' });
  } finally { pollToken = 'gho_test'; }
};
const assertNothingStored = async () => {
  assert.equal((await jfetch('/api/providers')).body.copilot.connected, false);
  assert.doesNotMatch(await readFile(settingsFile(), 'utf8'), /githubToken|gho_/);
};

test('GHE.com sign-in refused by Copilot (403 with error_details): the error names the tenant and GitHub\'s reason, never "stored token", and nothing is stored', async () => {
  const warns = []; const warn = console.warn; console.warn = (m) => warns.push(String(m));
  let done;
  try { done = await signInRefused('gho_refused'); } finally { console.warn = warn; }
  assert.equal(done.status, 200);
  assert.match(done.body.error, /the sign-in on acme\.ghe\.com worked \(as tenant-octo\), but GitHub refused Copilot access \(403\)/);
  assert.match(done.body.error, /GitHub says: "Copilot is not enabled for your account" \(https:\/\/acme\.ghe\.com\/settings\/copilot\)/);
  assert.doesNotMatch(done.body.error, /stored token|sign in again/i);
  await assertNothingStored();
  assert.ok(warns.some((w) => /answered 403: Copilot is not enabled/.test(w) && !/gho_refused/.test(w)), warns.join('\n'));
  assert.equal((await copilotPatch({ accountType: 'individual' })).status, 200);
});

test('a bare 403 at sign-in says GitHub gave no reason and points at the admin and the client id', async () => {
  _resetCopilotCache();
  const warn = console.warn; console.warn = () => {};
  let done;
  try { done = await signInRefused('gho_bare403'); } finally { console.warn = warn; }
  assert.match(done.body.error, /the sign-in on acme\.ghe\.com worked/);
  assert.match(done.body.error, /gave no reason/);
  assert.match(done.body.error, /enterprise admin/);
  assert.match(done.body.error, /Client id/);
  assert.doesNotMatch(done.body.error, /stored token|sign in again/i);
  await assertNothingStored();
  assert.equal((await copilotPatch({ accountType: 'individual' })).status, 200);
});

test('a stored token that later gets 401 still says to sign in again', async () => {
  const j = JSON.parse(await readFile(settingsFile(), 'utf8'));
  j.providers = { ...(j.providers || {}), copilot: { githubToken: 'gho_expired' } };
  await writeFile(settingsFile(), JSON.stringify(j));
  _resetCopilotCache();
  const warn = console.warn; console.warn = () => {};
  try {
    assert.deepEqual(await testProviderConnection('copilot', { fetch: github }), { ok: false, message: 'GitHub rejected the stored token (401) — sign in again' });
  } finally { console.warn = warn; }
  assert.equal((await post('/api/providers/copilot/logout')).status, 200);
});

test('client id: PATCH {clientId} is shown in state; the device flow starts and polls with it; a change after begin does not affect the running session; github.com still uses Copilot\'s app', async () => {
  pollState = 'ok';
  assert.equal((await copilotPatch({ accountType: 'ghe-com', enterpriseHost: 'acme.ghe.com' })).status, 200);
  assert.equal((await copilotPatch({ clientId: 'bad id!' })).status, 400);
  const set = await copilotPatch({ clientId: 'Ov23liCUSTOM123' });
  assert.equal(set.status, 200, JSON.stringify(set.body));
  assert.equal(set.body.copilot.clientId, 'Ov23liCUSTOM123');
  const d0 = deviceBodies.length;
  const start = await post('/api/providers/copilot/login');
  assert.equal((await copilotPatch({ clientId: 'Ov23liCHANGED999' })).status, 200);       // changed after begin
  const done = await jfetch(`/api/providers/copilot/login/${start.body.deviceCode}`, { method: 'POST' });
  assert.deepEqual(done.body, { ok: true, login: 'tenant-octo' });
  assert.deepEqual(deviceBodies.slice(d0).map((b) => b.client_id), ['Ov23liCUSTOM123', 'Ov23liCUSTOM123']);
  assert.equal((await jfetch('/api/providers')).body.copilot.clientId, 'Ov23liCHANGED999');   // the change did not sign out
  assert.equal((await jfetch('/api/providers')).body.copilot.connected, true);
  const r = await copilotPatch({ accountType: 'individual' });
  assert.equal(r.body.copilot.clientId, null);
  const d1 = deviceBodies.length;
  const gh = await post('/api/providers/copilot/login');
  await jfetch(`/api/providers/copilot/login/${gh.body.deviceCode}`, { method: 'POST' });
  assert.deepEqual(deviceBodies.slice(d1).map((b) => b.client_id), ['Iv1.b507a08c87ecfe98', 'Iv1.b507a08c87ecfe98']);
  assert.equal((await post('/api/providers/copilot/logout')).status, 200);
});

test('ghe-com with a hand-edited missing host: login is 400 NO_HOST message; GET /api/providers still 200 with quota null; logout works', async () => {
  const file = settingsFile();
  const j = JSON.parse(await readFile(file, 'utf8'));
  j.providers = { ...(j.providers || {}), copilot: { accountType: 'ghe-com', githubToken: 'gho_test' } };
  await writeFile(file, JSON.stringify(j));
  const warn = console.warn; console.warn = () => {};
  try {
    const n0 = seen.length;
    const login = await post('/api/providers/copilot/login');
    assert.equal(login.status, 400);
    assert.match(login.body.error, /GHE\.com tenant but has no valid host/);
    const st = await jfetch('/api/providers?quota=1');
    assert.equal(st.status, 200);
    assert.equal(st.body.copilot.quota, null);
    assert.equal(st.body.copilot.githubHost, null);
    assert.equal(st.body.copilot.enterpriseHost, null);
    assert.equal((await jfetch('/api/providers/copilot/models')).status, 400);
    assert.deepEqual(await testProviderConnection('copilot', { fetch: github }), { ok: false, message: login.body.error });
    assert.deepEqual(seenSince(n0), [], 'a tenant token never goes to github.com');
    const out = await post('/api/providers/copilot/logout');
    assert.equal(out.status, 200);
    assert.equal(out.body.copilot.connected, false);
  } finally { console.warn = warn; }
  assert.equal((await copilotPatch({ accountType: 'individual' })).status, 200);
});

test('github.com path unchanged: login/poll/user/exchange/quota URLs on github.com and api.github.com', async () => {
  pollState = 'ok';
  const n0 = seen.length;
  const start = await post('/api/providers/copilot/login');
  assert.equal(start.body.host, 'github.com');
  await jfetch(`/api/providers/copilot/login/${start.body.deviceCode}`, { method: 'POST' });
  await jfetch('/api/providers?quota=1');
  assert.deepEqual(seenSince(n0), [
    'https://github.com/login/device/code', 'https://github.com/login/oauth/access_token',
    'https://api.github.com/user', 'https://api.github.com/copilot_internal/v2/token', 'https://api.github.com/copilot_internal/user',
  ]);
  assert.equal((await post('/api/providers/copilot/logout')).body.copilot.connected, false);
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
  const lines = formatProviders({ copilot: { connected: true, login: 'o', accountType: 'individual', maxConcurrent: 4, quota: { used: 1, entitlement: 5 } }, openai: { configured: false, keySet: true, keySource: 'env', keyRef: '${K}', baseUrl: 'u', maxConcurrent: 8 }, anthropic: { maxConcurrent: 8 } });
  assert.match(lines[0], /connected as @o/);
  assert.doesNotMatch(lines[0], /clientId=/);
  assert.match(formatProviders({ copilot: { connected: false, accountType: 'ghe-com', enterpriseHost: 'acme.ghe.com', clientId: 'Iv1.abc12345', maxConcurrent: 4 }, openai: { maxConcurrent: 8 }, anthropic: { maxConcurrent: 8 } })[0], /clientId=Iv1\.abc12345/);
  assert.doesNotMatch(lines[0], /terms=/);
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
  await assert.rejects(cmdModels(['login', 'copilot', '--accept-terms'], io), /Unknown flag/);
  // login walks the device flow against the stub, with no prompt before it.
  pollState = 'ok';
  out.length = 0;
  assert.equal(await cmdModels(['login', 'copilot'], { ...io, sleep: async () => {} }), 0);
  assert.ok(out.some((l) => /WXYZ-9876/.test(l)));
  assert.ok(out.some((l) => /Connected to GitHub Copilot as @octo/.test(l)));
  out.length = 0;
  assert.equal(await cmdModels(['import', 'copilot'], io), 0);   // no --all/--pick: lists
  assert.ok(out.some((l) => /gpt-5.*OpenAI/.test(l)));
  assert.equal(await cmdModels(['logout', 'copilot'], io), 0);
});

test('/api/models: readiness is per entry, not per provider — a keyless local endpoint does not make a remote one ready', async () => {
  assert.equal((await patch('/api/providers/openai', { apiKey: null, baseUrl: 'https://api.openai.com/v1' })).status, 200);
  const up = (model, baseUrl) => ({ provider: 'openai', api: 'openai-responses', model, baseUrl });
  assert.equal((await post('/api/models', { id: 'cx-api-local', engine: 'codex', upstream: up('qwen3-coder', 'http://127.0.0.1:8000/v1') })).status, 200);
  assert.equal((await post('/api/models', { id: 'cx-api-remote', engine: 'codex', upstream: up('gpt-oss-120b', 'https://gw.example/v1') })).status, 200);
  const chat = await post('/api/models', { id: 'cx-api-chat', engine: 'codex', upstream: { ...up('m', 'http://127.0.0.1:8000/v1'), api: 'openai-chat' } });
  assert.equal(chat.status, 400);
  assert.match(chat.body.error, /Responses API only/);
  const rows = (await jfetch('/api/models')).body.models;
  const row = (id) => rows.find((m) => m.id === id);
  assert.equal(row('cx-api-local').needsSignIn, false, 'a local endpoint needs no key');
  assert.equal(row('cx-api-remote').needsSignIn, true);
  assert.equal(row('cx-api-remote').signInReason, 'no_key');
  assert.equal(formatModelLine({ ...row('cx-api-remote'), custom: 'global', upstreamModel: 'gpt-oss-120b' }), 'cx-api-remote  yours  endpoint: openai → gpt-oss-120b  NEEDS API KEY');
});

test('formatProviders prints host= for a tenant; cmdModels set copilot accountType=ghe-com enterpriseHost=acme.ghe.com stores both; a bad host fails with the message', async () => {
  const lines = formatProviders({ copilot: { connected: false, accountType: 'ghe-com', enterpriseHost: 'acme.ghe.com', maxConcurrent: 4 }, openai: {}, anthropic: {} });
  assert.match(lines[0], /account=ghe-com  host=acme\.ghe\.com  maxConcurrent=4/);
  assert.doesNotMatch(formatProviders({ copilot: { connected: false, accountType: 'individual', maxConcurrent: 4 }, openai: {}, anthropic: {} })[0], /host=/);

  const out = [];
  const io = { out: (s) => out.push(s), c: (n, s) => s, fail: (m) => { throw new Error(m); } };
  await assert.rejects(cmdModels(['set', 'copilot', 'accountType=ghe-com', 'enterpriseHost=acme.ghe.com/x'], io), /enterpriseHost must be a GHE\.com host like acme\.ghe\.com/);
  await assert.rejects(cmdModels(['set', 'copilot', 'accountType=ghe-com'], io), /needs enterpriseHost/);
  assert.equal(await cmdModels(['set', 'copilot', 'accountType=ghe-com', 'enterpriseHost=Acme.ghe.com'], io), 0);
  assert.match(out.join('\n'), /copilot .*account=ghe-com  host=acme\.ghe\.com/);
  out.length = 0;
  assert.equal(await cmdModels(['set', 'copilot', 'clientId=Iv1.abc12345'], io), 0);
  assert.match(out.join('\n'), /host=acme\.ghe\.com  clientId=Iv1\.abc12345/);
  assert.equal(await cmdModels(['set', 'copilot', 'clientId='], io), 0);
  // The CLI sign-in names the tenant it is signing in to.
  pollState = 'ok'; out.length = 0;
  const begin = await post('/api/providers/copilot/login');
  assert.equal(begin.body.host, 'acme.ghe.com');
  assert.equal(await cmdModels(['login', 'copilot'], { ...io, sleep: async () => {} }), 0);
  assert.ok(out.some((l) => /Open https:\/\/acme\.ghe\.com\/login\/device \(acme\.ghe\.com\) and enter the code ACME-0001/.test(l)), out.join('\n'));
  // Back to a different type drops the host (and the sign-in) in the same write.
  out.length = 0;
  assert.equal(await cmdModels(['set', 'copilot', 'accountType=enterprise'], io), 0);
  assert.doesNotMatch(out.join('\n'), /host=/);
  assert.match(out.join('\n'), /copilot\s+not connected/);
});
