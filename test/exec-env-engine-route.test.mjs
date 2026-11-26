// test/exec-env-engine-route.test.mjs
// engineModelRoute (src/core/exec-env/relay-route.mjs): where a sandboxed Codex, Copilot or Cursor spawn's model calls
// go, how worca signs them, what the CLI is given instead of a credential; and the relay's per-API usage meters
// (relay-usage.mjs). No network: fetch is a stub.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { engineModelRoute, codexRelayArgs, copilotWire, RELAY_DUMMY, CODEX_RELAY_KEY_ENV } from '../src/core/exec-env/relay-route.mjs';
import { createRouteMeter, cursorTurnUsage } from '../src/core/exec-env/relay-usage.mjs';

const label = 'E2B sandbox';
const PAT = `github_pat_${'A1b2'.repeat(10)}`;
const refusal = (fn, re) => assert.throws(fn, (e) => { assert.equal(e.errorClass, 'config'); assert.match(e.message, re); return true; });
const json = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const allowed = (r, method, path) => r.allow.some(([m, p]) => m === method && (p instanceof RegExp ? p.test(path) : p === path));

test('codex: the server key signs Responses calls to OpenAI; the CLI gets the relay as its provider and a dummy key', () => {
  const r = engineModelRoute({ engine: 'codex', serverEnv: { CODEX_API_KEY: 'sk-c', OPENAI_API_KEY: 'sk-o' }, label });
  assert.equal(r.upstream, 'https://api.openai.com/v1');
  assert.deepEqual(r.authHeaders({ authorization: 'Bearer dummy' }), { authorization: 'Bearer sk-c' });
  assert.deepEqual(r.secrets, ['sk-c']);
  assert.ok(allowed(r, 'POST', '/responses') && allowed(r, 'GET', '/models'));
  assert.equal(allowed(r, 'POST', '/chat/completions'), false);
  assert.equal(r.protocol, 'openai');
  const s = r.spawn('http://127.0.0.1:5/r/ID');
  assert.deepEqual(s.env, { [CODEX_RELAY_KEY_ENV]: RELAY_DUMMY });
  assert.deepEqual(s.args, codexRelayArgs('http://127.0.0.1:5/r/ID'));
  assert.ok(s.args.includes('model_providers.worca_relay.base_url="http://127.0.0.1:5/r/ID"'));
  assert.equal(engineModelRoute({ engine: 'codex', serverEnv: { OPENAI_API_KEY: ' sk-o ' }, label }).secrets[0], 'sk-o');
  refusal(() => engineModelRoute({ engine: 'codex', serverEnv: {}, label }), /CODEX_API_KEY or OPENAI_API_KEY.*ChatGPT sign-in/);
});

test('codex endpoint model: its own base, key and headers, signed here (a loopback endpoint works); bad bases refused', () => {
  const ep = { baseUrl: 'http://127.0.0.1:1234/v1', apiKey: 'ep-key-123456', headers: { 'X-Org': 'org-secret-1' } };
  const r = engineModelRoute({ engine: 'codex', serverEnv: {}, endpoint: ep, label });
  assert.equal(r.upstream, 'http://127.0.0.1:1234/v1');
  assert.deepEqual(r.authHeaders({}), { authorization: 'Bearer ep-key-123456' });
  assert.deepEqual(r.extraHeaders, { 'X-Org': 'org-secret-1' });
  assert.deepEqual(r.secrets, ['ep-key-123456', 'org-secret-1']);
  assert.deepEqual(engineModelRoute({ engine: 'codex', endpoint: { baseUrl: 'https://gw.example/' }, label }).authHeaders({}), {}, 'a keyless endpoint');
  refusal(() => engineModelRoute({ engine: 'codex', endpoint: { baseUrl: 'https://gw.example/v1?x=1' }, label }), /query or fragment/);
  refusal(() => engineModelRoute({ engine: 'codex', endpoint: { baseUrl: 'https://u:p@gw.example/v1' }, label }), /user name or password/);
  refusal(() => engineModelRoute({ engine: 'codex', endpoint: { baseUrl: 'https://gw.example/v1', headers: { Authorization: 'x' } }, label }), /sets the Authorization header/);
});

test('copilotWire: Claude models on Messages, GPT-5 and o-series on Responses, the rest on Chat Completions', () => {
  assert.deepEqual(copilotWire('claude-sonnet-4.5'), { type: 'anthropic', api: null, path: '/v1/messages' });
  assert.deepEqual(copilotWire('gpt-5-mini'), { type: 'openai', api: 'responses', path: '/responses' });
  assert.equal(copilotWire('o4-mini').api, 'responses');
  assert.deepEqual(copilotWire('gpt-4.1'), { type: 'openai', api: 'completions', path: '/chat/completions' });
  assert.equal(copilotWire('gemini-2.5-pro').path, '/chat/completions');
});

test('copilot: the fine-grained PAT signs the one API the model uses on the account`s Copilot host; the CLI runs offline', async () => {
  const fetched = [];
  const fetchImpl = async (url, init) => { fetched.push({ url, init }); return json(200, { endpoints: { api: 'https://api.individual.githubcopilot.com/' } }); };
  const cache = new Map();
  const r = engineModelRoute({ engine: 'copilot', serverEnv: { COPILOT_GITHUB_TOKEN: PAT }, model: 'claude-sonnet-4.5', label, fetchImpl, cache });
  assert.deepEqual(r.allow, [['POST', '/v1/messages']]);
  assert.equal(r.protocol, 'anthropic');
  assert.equal(await r.upstream(), 'https://api.individual.githubcopilot.com');
  assert.equal(await r.upstream(), 'https://api.individual.githubcopilot.com');
  assert.equal(fetched.length, 1, 'the host lookup is cached');
  assert.equal(fetched[0].url, 'https://api.github.com/copilot_internal/user');
  assert.equal(fetched[0].init.headers.authorization, `Bearer ${PAT}`);
  assert.deepEqual(r.authHeaders({}), { authorization: `Bearer ${PAT}` });
  assert.equal(r.extraHeaders['copilot-integration-id'], 'copilot-developer-cli');
  assert.deepEqual(r.forwardHeaders, ['x-initiator', 'x-interaction-type']);
  assert.deepEqual(r.secrets, [PAT]);
  assert.deepEqual(r.spawn('http://127.0.0.1:5/r/ID').env, { COPILOT_OFFLINE: 'true', COPILOT_PROVIDER_BASE_URL: 'http://127.0.0.1:5/r/ID',
    COPILOT_PROVIDER_API_KEY: RELAY_DUMMY, COPILOT_PROVIDER_TYPE: 'anthropic' });
  r.onStatus(401);
  await r.upstream();
  assert.equal(fetched.length, 2, 'a 401 looks the host up again');
});

test('copilot: a host that is not GitHub`s is never used, and a failed lookup is not cached', async () => {
  let answer = json(200, { endpoints: { api: 'https://evil.example.com' } });
  const fetchImpl = async () => answer;
  const r = engineModelRoute({ engine: 'copilot', serverEnv: { COPILOT_GITHUB_TOKEN: PAT }, model: 'gpt-5-mini', label, fetchImpl });
  await assert.rejects(r.upstream(), /named no Copilot API host/);
  answer = json(403, {});
  await assert.rejects(r.upstream(), /GitHub answered 403.*Copilot Requests permission/);
  answer = json(200, { endpoints: { api: 'https://api.business.githubcopilot.com' } });
  assert.equal(await r.upstream(), 'https://api.business.githubcopilot.com');
});

test('copilot refusals: no token, a classic or OAuth token, a provider of the user`s own', () => {
  refusal(() => engineModelRoute({ engine: 'copilot', serverEnv: {}, model: 'gpt-5-mini', label }), /COPILOT_GITHUB_TOKEN is not set/);
  refusal(() => engineModelRoute({ engine: 'copilot', serverEnv: { COPILOT_GITHUB_TOKEN: `gho_${'x'.repeat(36)}` }, model: 'gpt-5-mini', label }), /OAuth token \(gho_\)/);
  refusal(() => engineModelRoute({ engine: 'copilot', serverEnv: { COPILOT_GITHUB_TOKEN: PAT }, spawnEnv: { COPILOT_PROVIDER_API_KEY: 'mine' }, model: 'gpt-5-mini', label }),
    /sets COPILOT_PROVIDER_API_KEY/);
});

test('cursor: the API key is exchanged once for an access token, cached until shortly before it expires, again after a 401', async () => {
  let now = 1_000_000_000_000;
  const exp = (ms) => `h.${Buffer.from(JSON.stringify({ exp: Math.floor(ms / 1000) })).toString('base64url')}.s`;
  const exchanges = [];
  let token = exp(now + 3600_000);
  const fetchImpl = async (url, init) => { exchanges.push({ url, init }); await new Promise((r) => setTimeout(r, 5)); return json(200, { accessToken: token, refreshToken: 'refresh-0123456789' }); };
  const cache = new Map();
  const r = engineModelRoute({ engine: 'cursor', serverEnv: { CURSOR_API_KEY: 'crsr-key-0123' }, label, fetchImpl, now: () => now, cache });
  assert.equal(r.upstream, 'https://api2.cursor.sh');
  assert.equal(r.protocol, 'connect');
  const [a, b] = await Promise.all([r.authHeaders({}), r.authHeaders({})]);
  assert.deepEqual(a, { authorization: `Bearer ${token}` }); assert.deepEqual(b, a);
  assert.equal(exchanges.length, 1, 'concurrent calls share one exchange');
  assert.equal(exchanges[0].url, 'https://api2.cursor.sh/auth/exchange_user_api_key');
  assert.equal(exchanges[0].init.headers.authorization, 'Bearer crsr-key-0123');
  assert.ok(r.secrets.includes(token) && r.secrets.includes('refresh-0123456789'), 'both derived tokens are route secrets');
  const again = engineModelRoute({ engine: 'cursor', serverEnv: { CURSOR_API_KEY: 'crsr-key-0123' }, label, fetchImpl, now: () => now, cache });
  await again.authHeaders({});
  assert.equal(exchanges.length, 1, 'another spawn of the env reuses the cached token');
  assert.ok(again.secrets.includes(token), 'and still scrubs it');
  now += 3600_000 - 4 * 60_000;   // inside the 5-minute margin
  token = exp(now + 3600_000);
  await r.authHeaders({});
  assert.equal(exchanges.length, 2, 'exchanged again before it expires');
  r.onStatus(401);
  await r.authHeaders({});
  assert.equal(exchanges.length, 3, 'a rejected token is exchanged again');
  assert.equal(r.secrets.filter((s) => s === 'refresh-0123456789').length, 1, 'secrets do not pile up');
  // Paths: Cursor's HTTP/1.1 Connect calls only, never its key exchange or the HTTP/2 agent stream.
  for (const p of ['/aiserver.v1.AiService/GetUsableModels', '/aiserver.v1.DashboardService/GetMe', '/aiserver.v1.BidiService/BidiAppend', '/agent.v1.AgentService/RunSSE']) assert.ok(allowed(r, 'POST', p), p);
  // Exact: every allowed call is signed with the person's token and only RunSSE is metered, so no other method of a
  // listed service passes.
  for (const p of ['/auth/exchange_user_api_key', '/agent.v1.AgentService/Run', '/aiserver.v1.FileSyncService/Sync',
    '/aiserver.v1.DashboardService/GetTeams', '/aiserver.v1.AiService/StreamChat', '/aiserver.v1.ServerConfigService/GetServerConfig']) assert.equal(allowed(r, 'POST', p), false, p);
  assert.ok(r.allow.every(([, p]) => typeof p === 'string'), 'exact paths, no pattern');
  assert.ok(!r.forwardHeaders.includes('x-ghost-mode'), 'privacy mode is never the sandbox`s to pick');
  assert.equal(allowed(r, 'GET', '/aiserver.v1.AiService/GetUsableModels'), false);
  assert.deepEqual(r.spawn('http://127.0.0.1:5/r/ID').env, { CURSOR_API_ENDPOINT: 'http://127.0.0.1:5/r/ID', CURSOR_AUTH_TOKEN: RELAY_DUMMY, CURSOR_AGENT_CLI_AUTHLESS_MODE: 'true' });
});

test('cursor: a failed exchange rejects (not cached) and names no secret; no key is refused', async () => {
  let status = 401;
  const fetchImpl = async () => (status === 200 ? json(200, { accessToken: 'tok-0123456789' }) : json(status, {}));
  const r = engineModelRoute({ engine: 'cursor', serverEnv: { CURSOR_API_KEY: 'crsr-key-0123' }, label, fetchImpl });
  await assert.rejects(r.authHeaders({}), (e) => /Cursor answered 401.*check CURSOR_API_KEY/.test(e.message) && !e.message.includes('crsr-key-0123'));
  status = 200;
  assert.deepEqual(await r.authHeaders({}), { authorization: 'Bearer tok-0123456789' });
  refusal(() => engineModelRoute({ engine: 'cursor', serverEnv: {}, label }), /CURSOR_API_KEY is not set/);
  refusal(() => engineModelRoute({ engine: 'gemini', label }), /no model route/);
});

// ── meters ──
const sse = (events) => Buffer.from(events.map((e) => `data: ${typeof e === 'string' ? e : JSON.stringify(e)}\n\n`).join(''));
const feed = (meter, path, buf, step = 7) => { const m = meter.reply(path); for (let i = 0; i < buf.length; i += step) m.push(buf.subarray(i, i + step)); m.end(); };

test('meters: OpenAI Responses and Chat Completions usage, cached reads apart, by reply model', () => {
  const meter = createRouteMeter();
  feed(meter, '/responses', sse([{ type: 'response.output_text.delta', delta: 'x' },
    { type: 'response.completed', response: { model: 'gpt-5.5', usage: { input_tokens: 100, input_tokens_details: { cached_tokens: 30 }, output_tokens: 9 } } }]));
  feed(meter, '/v1/responses', Buffer.from(JSON.stringify({ object: 'response', model: 'gpt-5.5', usage: { input_tokens: 10, output_tokens: 1 } })));
  feed(meter, '/chat/completions', Buffer.concat([sse([{ model: 'gpt-4.1', choices: [] }, { model: 'gpt-4.1', choices: [], usage: { prompt_tokens: 50, completion_tokens: 6, prompt_tokens_details: { cached_tokens: 10 } } }]), Buffer.from('data: [DONE]\n\n')]));
  feed(meter, '/chat/completions', sse([{ model: 'gpt-4.1', choices: [] }]));   // no usage: nothing booked
  const got = meter.take();
  assert.equal(got.messages, 3);
  assert.deepEqual([got.byModel['gpt-5.5'].input_tokens, got.byModel['gpt-5.5'].cache_read_input_tokens, got.byModel['gpt-5.5'].output_tokens], [80, 30, 10]);
  assert.deepEqual([got.byModel['gpt-4.1'].input_tokens, got.byModel['gpt-4.1'].cache_read_input_tokens, got.byModel['gpt-4.1'].output_tokens], [40, 10, 6]);
});

test('meters: the Messages API stays the default (Copilot`s Claude models, Claude routes)', () => {
  const meter = createRouteMeter();
  feed(meter, '/v1/messages', sse([{ type: 'message_start', message: { model: 'claude-sonnet-4.5', usage: { input_tokens: 30, output_tokens: 1 } } },
    { type: 'message_delta', usage: { output_tokens: 4 } }, { type: 'message_stop' }]));
  assert.equal(meter.take().byModel['claude-sonnet-4.5'].output_tokens, 4);
});

const varint = (n) => { const o = []; do { let b = n & 0x7f; n >>>= 7; if (n) b |= 0x80; o.push(b); } while (n); return Buffer.from(o); };
const pbLen = (no, b) => Buffer.concat([Buffer.from([(no << 3) | 2]), varint(b.length), b]);
const pbInt = (no, n) => Buffer.concat([Buffer.from([(no << 3) | 0]), varint(n)]);
const env = (flag, b) => { const h = Buffer.alloc(5); h[0] = flag; h.writeUInt32BE(b.length, 1); return Buffer.concat([h, b]); };
const ended = (i, o, r = 0, w = 0) => pbLen(1, pbLen(14, Buffer.concat([pbInt(1, i), pbInt(2, o), pbInt(3, r), pbInt(4, w)])));

test('meters: Cursor`s RunSSE turn_ended counts, across chunks and gzip envelopes; other Connect calls and junk report nothing', () => {
  assert.deepEqual(cursorTurnUsage(ended(300, 20, 5, 1)), { input_tokens: 300, output_tokens: 20, cache_read_input_tokens: 5, cache_creation_input_tokens: 1,
    cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 0 } });
  assert.equal(cursorTurnUsage(pbLen(1, pbLen(1, pbLen(1, Buffer.from('text'))))), null, 'a text delta is no turn end');
  assert.equal(cursorTurnUsage(Buffer.from([0xff, 0xff])), null, 'a malformed proto');
  const meter = createRouteMeter();
  const stream = Buffer.concat([env(0, pbLen(1, pbLen(1, pbLen(1, Buffer.from('hi'))))), env(0, ended(100, 10)), env(1, gzipSync(ended(50, 5))), env(2, Buffer.from('{}'))]);
  feed(meter, '/agent.v1.AgentService/RunSSE', stream, 3);
  feed(meter, '/aiserver.v1.AiService/GetUsableModels', ended(999, 999));
  const got = meter.take();
  assert.equal(got.messages, 2);
  assert.equal(got.byModel[''].input_tokens, 150, 'no model in the reply: the dispatched one prices it');
  assert.equal(got.byModel[''].output_tokens, 15);
});
