// test/broker-slots-engines.test.mjs
// Codex, Copilot and Cursor sign in through the credential broker (core protection layer, Task 8): Codex's API key in
// the openai slot, Copilot's fine-grained PAT in the copilot-pat slot, Cursor's API key in the cursor slot, whose key
// exchange (src/broker/cursor.mjs) is the relay's own. A loopback fake stands in for each vendor's API.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readBrokerConfig } from '../src/broker/config.mjs';
import { builtinSlots, mergeSlots, engineOnlyAuth } from '../src/broker/slots.mjs';
import { startBroker } from '../src/broker/main.mjs';
import { priceUsage } from '../src/broker/usage.mjs';
import { cursorAccessToken, CURSOR_PATHS } from '../src/broker/cursor.mjs';
import { slotForBaseUrl } from '../src/core/broker-routing.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SECRET = 's'.repeat(48);
const CURSOR_KEY = 'crsr-person-key-0123456789abcdef';
const PAT = `github_pat_${'R2d2'.repeat(10)}`;
const OPENAI_KEY = 'sk-openai-person-0123456789abcdef';
const closers = [];
after(async () => { for (const c of closers.reverse()) await c(); });

// The JWT helper of test/exec-env-engine-route.test.mjs: a token whose payload names `exp`.
const exp = (ms) => `h.${Buffer.from(JSON.stringify({ exp: Math.floor(ms / 1000) })).toString('base64url')}.s`;
const envelope = (flag, b) => { const h = Buffer.alloc(5); h[0] = flag; h.writeUInt32BE(b.length, 1); return Buffer.concat([h, b]); };
const varint = (n) => { const o = []; do { let b = n & 0x7f; n >>>= 7; if (n) b |= 0x80; o.push(b); } while (n); return Buffer.from(o); };
const pbLen = (no, b) => Buffer.concat([Buffer.from([(no << 3) | 2]), varint(b.length), b]);
const pbInt = (no, n) => Buffer.concat([Buffer.from([(no << 3) | 0]), varint(n)]);
/** One Connect reply: optional text (a message echoing `echo`), a turn-ended usage message, the end-of-stream trailer. */
const runSseReply = ({ echo = null, usage = [60, 8, 5] } = {}) => Buffer.concat([
  ...(echo ? [envelope(0, pbLen(1, pbLen(1, pbLen(1, Buffer.from(`echo ${echo}`)))))] : []),
  envelope(0, pbLen(1, pbLen(14, Buffer.concat([pbInt(1, usage[0]), pbInt(2, usage[1]), pbInt(3, usage[2])])))),
  envelope(2, Buffer.from('{}')),
]);

/** A loopback stand-in for api2.cursor.sh, the Copilot API (and GitHub's account lookup) and OpenAI. `handlers` maps a
 *  path to (req, res, body) and overrides the defaults; every request is recorded in `calls`. */
async function fakeVendor(handlers = {}) {
  const calls = [];
  const srv = http.createServer((req, res) => {
    const parts = []; req.on('data', (c) => parts.push(c));
    req.on('end', () => {
      const body = Buffer.concat(parts);
      calls.push({ method: req.method, url: req.url, headers: req.headers, body });
      const h = handlers[req.url];
      if (h) return h(req, res, body);
      const json = (status, o) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
      if (req.url === '/copilot_internal/user') return json(200, { login: 'ada' });
      if (req.url === '/v1/models') return json(200, { data: [] });
      res.writeHead(404); res.end();
    });
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  closers.push(() => new Promise((r) => { srv.closeAllConnections?.(); srv.close(r); }));
  return { url: `http://127.0.0.1:${srv.address().port}`, calls };
}

/** A broker over `up` with the cursor, copilot-pat and openai slots pointed at it; `keys` are single-mode keys. */
async function broker(up, { mode = 'single', keys = {}, slotsExtra = [] } = {}) {
  const env = mode === 'multi'
    ? { WORCA_BROKER_MODE: 'multi', WORCA_BROKER_VAULT_KEY: randomBytes(32).toString('base64'), WORCA_BROKER_PUBLIC_URL: 'http://localhost:7071',
      WORCA_IDENTITY_HEADER: 'x-email', WORCA_IDENTITY_TRUSTED_PROXIES: '127.0.0.1' }
    : { WORCA_BROKER_MODE: 'single', ...keys };
  const { config, errors } = readBrokerConfig({ ...env, WORCA_BROKER_SECRET: SECRET, WORCA_BROKER_HOST: '127.0.0.1', WORCA_BROKER_PORT: '0', WORCA_BROKER_UI_PORT: '1' });
  assert.deepEqual(errors, []);
  const slots = mergeSlots(builtinSlots(), [{ id: 'cursor', upstream: up.url }, { id: 'copilot-pat', upstream: up.url, lookupUrl: up.url }, { id: 'openai', upstream: up.url }, ...slotsExtra]);
  const b = await startBroker({ config: { ...config, port: 0, uiEnabled: false }, slots, log: () => {} });
  closers.push(() => b.close());
  const port = b.ports.private;
  const internal = async (method, path, body) => (await fetch(`http://127.0.0.1:${port}${path}`, {
    method, headers: { authorization: `Bearer ${SECRET}`, 'content-type': 'application/json' }, body: body && JSON.stringify(body) })).json();
  let seq = 0;
  const mint = async (slot, billTo = 'local') => (await internal('POST', '/internal/tokens', { billTo, slots: [slot], spawnId: `sp-${++seq}`, kind: 'phase', issuer: 'srv-test' })).token;
  const call = (token, path, { body = envelope(0, Buffer.alloc(0)), headers = { 'content-type': 'application/connect+proto' } } = {}) => fetch(`http://127.0.0.1:${port}${path}`, {
    method: 'POST', headers: { authorization: `Bearer ${token}`, ...headers }, body });
  return { b, port, mint, call, service: b.service, store: b.store };
}

const exchangeOk = (accessToken, extra = {}) => (_req, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ accessToken, ...extra })); };

test('cursor slot exchanges the key once per expiry', async () => {
  const access = exp(Date.now() + 3600_000);
  const up = await fakeVendor({
    '/auth/exchange_user_api_key': exchangeOk(access),
    '/agent.v1.AgentService/RunSSE': (_req, res) => { res.writeHead(200, { 'content-type': 'application/connect+proto' }); res.end(runSseReply()); },
  });
  const { mint, call } = await broker(up, { keys: { WORCA_BROKER_KEY_CURSOR: CURSOR_KEY } });
  const token = await mint('cursor');
  for (let i = 0; i < 2; i++) {
    const r = await call(token, '/p/cursor/agent.v1.AgentService/RunSSE');
    assert.equal(r.status, 200);
    const body = Buffer.from(await r.arrayBuffer()).toString('latin1');
    assert.ok(!body.includes(access) && !JSON.stringify([...r.headers]).includes(access), 'the access token never reaches the client');
  }
  const exchanges = up.calls.filter((c) => c.url === '/auth/exchange_user_api_key');
  assert.equal(exchanges.length, 1, 'one exchange for both calls');
  assert.equal(exchanges[0].headers.authorization, `Bearer ${CURSOR_KEY}`);
  const runs = up.calls.filter((c) => c.url === '/agent.v1.AgentService/RunSSE');
  assert.equal(runs.length, 2);
  assert.equal(runs[1].headers.authorization, `Bearer ${access}`);
});

test('cursor slot re-exchanges once on a 401', async () => {
  let runs = 0;
  const up = await fakeVendor({
    '/auth/exchange_user_api_key': exchangeOk(exp(Date.now() + 3600_000)),
    '/agent.v1.AgentService/RunSSE': (_req, res) => {
      if (++runs === 1) { res.writeHead(401, { 'content-type': 'application/json' }); res.end('{"error":"expired"}'); return; }
      res.writeHead(200, { 'content-type': 'application/connect+proto' }); res.end(runSseReply());
    },
  });
  const { mint, call, service, store } = await broker(up, { mode: 'multi' });
  const saved = await service.saveCredential('ada@acme.dev', 'cursor', CURSOR_KEY);
  assert.equal(saved.ok, true, JSON.stringify(saved));
  const afterSave = up.calls.filter((c) => c.url === '/auth/exchange_user_api_key').length;
  const r = await call(await mint('cursor', 'ada@acme.dev'), '/p/cursor/agent.v1.AgentService/RunSSE');
  assert.equal(r.status, 200, 'the client sees the retried call');
  assert.equal(up.calls.filter((c) => c.url === '/auth/exchange_user_api_key').length - afterSave, 2, 'the first exchange, then one after the 401');
  const row = store.getCredential('ada@acme.dev', 'cursor');
  assert.ok(!row.verify_error, 'the stored key is not marked rejected');
});

test('cursor slot keeps connect-content-encoding and answers errors in the Connect shape', async () => {
  const up = await fakeVendor({
    '/auth/exchange_user_api_key': exchangeOk(exp(Date.now() + 3600_000)),
    '/agent.v1.AgentService/RunSSE': (_req, res) => {
      res.writeHead(200, { 'content-type': 'application/connect+proto', 'connect-content-encoding': 'gzip' }); res.end(runSseReply());
    },
  });
  const { mint, call } = await broker(up, { keys: { WORCA_BROKER_KEY_CURSOR: CURSOR_KEY } });
  const token = await mint('cursor');
  const ok = await call(token, '/p/cursor/agent.v1.AgentService/RunSSE');
  assert.equal(ok.headers.get('connect-content-encoding'), 'gzip');
  await ok.arrayBuffer();
  const refused = await call(token, '/p/cursor/aiserver.v1.Nope/X');
  assert.equal(refused.status, 403);
  const body = await refused.json();
  assert.equal(body.code, 'permission_denied');
  assert.match(body.message, /^worca-broker: POST \/aiserver\.v1\.Nope\/X is not allowed for slot cursor/);
});

test('cursor slot passes only the calls a headless turn makes, and never the caller`s privacy mode', async () => {
  const ok = (_req, res) => { res.writeHead(200, { 'content-type': 'application/proto' }); res.end(); };
  const up = await fakeVendor({
    '/auth/exchange_user_api_key': exchangeOk(exp(Date.now() + 3600_000)),
    '/agent.v1.AgentService/RunSSE': (_req, res) => { res.writeHead(200, { 'content-type': 'application/connect+proto' }); res.end(runSseReply()); },
    '/aiserver.v1.AiService/GetUsableModels': ok, '/aiserver.v1.DashboardService/GetMe': ok, '/aiserver.v1.BidiService/BidiAppend': ok,
    '/aiserver.v1.DashboardService/GetTeams': ok, '/aiserver.v1.AiService/StreamChat': ok,
  });
  const { mint, call } = await broker(up, { keys: { WORCA_BROKER_KEY_CURSOR: CURSOR_KEY } });
  const token = await mint('cursor');
  const headers = { 'content-type': 'application/proto', 'x-ghost-mode': 'false' };
  for (const [method, p] of CURSOR_PATHS) {
    assert.equal(method, 'POST');
    const r = await call(token, `/p/cursor${p}`, p.endsWith('/RunSSE') ? { headers: { ...headers, 'content-type': 'application/connect+proto' } } : { headers, body: Buffer.alloc(0) });
    assert.equal(r.status, 200, p); await r.arrayBuffer();
  }
  for (const p of ['/aiserver.v1.DashboardService/GetTeams', '/aiserver.v1.AiService/StreamChat']) {
    const r = await call(token, `/p/cursor${p}`, { headers, body: Buffer.alloc(0) });
    assert.equal(r.status, 403, p);
    assert.equal((await r.json()).code, 'permission_denied');
  }
  const sent = up.calls.filter((c) => c.url !== '/auth/exchange_user_api_key');
  assert.deepEqual(sent.map((c) => c.url), CURSOR_PATHS.map(([, p]) => p), 'nothing unlisted reaches Cursor');
  assert.ok(sent.every((c) => c.headers['x-ghost-mode'] === undefined), 'x-ghost-mode is not forwarded');
});

test('cursor slot scrubs an echoed token', async () => {
  const access = exp(Date.now() + 3600_000);
  const refresh = 'refresh-token-0123456789abcdef';
  const up = await fakeVendor({
    '/auth/exchange_user_api_key': exchangeOk(access, { refreshToken: refresh }),
    '/agent.v1.AgentService/RunSSE': (_req, res) => {
      res.writeHead(200, { 'content-type': 'application/connect+proto' });
      res.end(Buffer.concat([runSseReply({ echo: access }), runSseReply({ echo: `${refresh} ${CURSOR_KEY}` })]));
    },
  });
  const { mint, call } = await broker(up, { keys: { WORCA_BROKER_KEY_CURSOR: CURSOR_KEY } });
  const r = await call(await mint('cursor'), '/p/cursor/agent.v1.AgentService/RunSSE');
  const body = Buffer.from(await r.arrayBuffer()).toString('latin1');
  assert.equal(r.status, 200);
  for (const s of [access, refresh, CURSOR_KEY]) assert.ok(!body.includes(s), 'a token echoed inside a proto is scrubbed');
  assert.ok(body.includes('[removed by worca broker]'));
});

/** The messages of a Connect stream, each inflated when its flag says compressed; throws unless the envelopes cover
 *  `buf` exactly (a replaced value must not break the framing). */
const messagesOf = (buf) => {
  const out = [];
  for (let i = 0; i < buf.length;) {
    assert.ok(i + 5 <= buf.length, 'a whole envelope head');
    const flag = buf[i]; const len = buf.readUInt32BE(i + 1);
    assert.ok(i + 5 + len <= buf.length, 'the envelope length matches its message');
    const raw = buf.subarray(i + 5, i + 5 + len);
    out.push({ flag, msg: flag & 1 ? gunzipSync(raw) : raw });
    i += 5 + len;
  }
  return out;
};

test('cursor slot asks for uncompressed replies, scrubs a token inside a gzip message and refuses what it cannot read', async () => {
  const access = exp(Date.now() + 3600_000);
  const echo = (s) => pbLen(1, pbLen(1, pbLen(1, Buffer.from(`echo ${s}`))));
  let enc = 'gzip'; let reply = null;
  const up = await fakeVendor({
    '/auth/exchange_user_api_key': exchangeOk(access),
    '/agent.v1.AgentService/RunSSE': (_req, res) => {
      res.writeHead(200, { 'content-type': 'application/connect+proto', 'connect-content-encoding': enc });
      res.end(reply ?? Buffer.concat([envelope(1, gzipSync(echo(`${access} ${CURSOR_KEY}`))), runSseReply()]));
    },
    '/aiserver.v1.AiService/GetUsableModels': (_req, res) => {
      res.writeHead(200, { 'content-type': 'application/proto', 'content-encoding': 'gzip' }); res.end(gzipSync(echo(access)));
    },
  });
  const { mint, call } = await broker(up, { keys: { WORCA_BROKER_KEY_CURSOR: CURSOR_KEY } });
  const token = await mint('cursor');
  const path = '/p/cursor/agent.v1.AgentService/RunSSE';
  // A Connect server may answer in the request's own compression, whatever the client accepts: the broker reads it.
  const r = await call(token, path, { headers: { 'content-type': 'application/connect+proto', 'connect-accept-encoding': 'gzip, br' } });
  assert.equal(up.calls.at(-1).headers['connect-accept-encoding'], 'identity', 'identity, whatever the client accepts');
  assert.equal(r.status, 200);
  const msgs = messagesOf(Buffer.from(await r.arrayBuffer()));
  assert.ok(msgs.every((m) => !(m.flag & 1)), 'every message goes out uncompressed, with its own length');
  const text = Buffer.concat(msgs.map((m) => m.msg)).toString('latin1');
  for (const s of [access, CURSOR_KEY]) assert.ok(!text.includes(s), 'a token inside a gzip message is scrubbed');
  assert.ok(text.includes('[removed by worca broker]'));
  // A message that claims gzip and is not: the stream is cut, nothing of it passes.
  reply = Buffer.concat([envelope(0, echo('before')), envelope(1, Buffer.from(`not gzip ${access}`))]);
  await assert.rejects(call(token, path).then((x) => x.arrayBuffer()), 'the stream is cut, never ended cleanly');
  // An encoding the broker cannot read, on a stream or on a unary body: refused before anything reaches the client.
  reply = null; enc = 'br';
  const br = await call(token, path);
  assert.equal(br.status, 502);
  const j = await br.json();
  assert.equal(j.code, 'unavailable');
  assert.match(j.message, /^worca-broker: Cursor sent .*br.* the broker cannot check for credentials/);
  enc = access;   // a header value is the upstream's: never echoed in the refusal
  const odd = await call(token, path);
  assert.equal(odd.status, 502);
  const oddText = await odd.text();
  assert.ok(!oddText.includes(access) && /an unknown encoding/.test(oddText), oddText);
  const unary = await call(token, '/p/cursor/aiserver.v1.AiService/GetUsableModels', { headers: { 'content-type': 'application/proto' }, body: Buffer.alloc(0) });
  assert.equal(unary.status, 502);
  assert.match((await unary.json()).message, /gzip/);
});

test('copilot slot refuses a classic token', async () => {
  const up = await fakeVendor();
  const { service } = await broker(up, { mode: 'multi' });
  const saved = await service.saveCredential('ada@acme.dev', 'copilot-pat', `ghp_${'a'.repeat(36)}`);
  assert.equal(saved.ok, false);
  assert.equal(saved.status, 422);
  // The save-time check's own words, not verifyCredential's "… was not accepted: …" copy of the same rule.
  assert.match(saved.error, /^This token is a classic token \(ghp_\).*fine-grained/);
  assert.equal(up.calls.length, 0, 'nothing was sent to GitHub');

  const single = await fakeVendor();
  const s = await broker(single, { keys: { WORCA_BROKER_KEY_COPILOT_PAT: `ghp_${'b'.repeat(36)}` } });
  const r = await s.call(await s.mint('copilot-pat'), '/p/copilot-pat/chat/completions', {
    headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model: 'gpt-4.1', messages: [] }) });
  assert.equal(r.status, 403);
  assert.match((await r.json()).error.message, /This token is a classic token/);
  assert.equal(single.calls.length, 0, 'the upstream was never contacted');
  // The key page's Test button (testCredential) on a single-mode key: refused before anything is sent.
  const tested = await s.service.testCredential('local', 'copilot-pat');
  assert.equal(tested.ok, false);
  assert.equal(tested.status, 422);
  assert.match(tested.error, /^This token is a classic token \(ghp_\)/);
  assert.equal(single.calls.length, 0, 'GitHub was never asked');
});

test('copilot-pat and cursor calls book their tokens on the seat plan, at $0 (B9)', async () => {
  const up = await fakeVendor({
    '/chat/completions': (_req, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ object: 'chat.completion', model: 'gpt-4.1', usage: { prompt_tokens: 3, completion_tokens: 1 } })); },
    '/auth/exchange_user_api_key': exchangeOk(exp(Date.now() + 3600_000)),
    '/agent.v1.AgentService/RunSSE': (_req, res) => { res.writeHead(200, { 'content-type': 'application/connect+proto' }); res.end(runSseReply()); },
  });
  const { mint, call, store } = await broker(up, { keys: { WORCA_BROKER_KEY_COPILOT_PAT: PAT, WORCA_BROKER_KEY_CURSOR: CURSOR_KEY } });
  const pat = await call(await mint('copilot-pat'), '/p/copilot-pat/chat/completions', {
    headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model: 'gpt-4.1', messages: [] }) });
  assert.equal(pat.status, 200); await pat.text();
  const cur = await call(await mint('cursor'), '/p/cursor/agent.v1.AgentService/RunSSE');
  assert.equal(cur.status, 200); await cur.arrayBuffer();
  // queryUsage() leaves `plan` out: read the rows themselves (node:sqlite rows have a null prototype).
  const rows = store.db.prepare(`SELECT slot, plan, usd, input_tokens AS inputTokens, output_tokens AS outputTokens,
    cache_read_tokens AS cacheReadTokens FROM usage ORDER BY id`).all().map((r) => ({ ...r }));
  assert.deepEqual(rows, [
    { slot: 'copilot-pat', plan: 'copilot', usd: 0, inputTokens: 3, outputTokens: 1, cacheReadTokens: 0 },
    { slot: 'cursor', plan: 'cursor', usd: 0, inputTokens: 60, outputTokens: 8, cacheReadTokens: 5 },
  ]);
});

test('copilot-pat: a lookup naming a host that is not Copilot\'s is ignored; the PAT goes to the slot upstream only', async () => {
  const other = await fakeVendor();
  const up = await fakeVendor({
    '/copilot_internal/user': (_req, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ login: 'ada', endpoints: { api: other.url } })); },
    '/chat/completions': (_req, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ model: 'gpt-4.1', usage: { prompt_tokens: 3, completion_tokens: 1 } })); },
  });
  const { mint, call } = await broker(up, { keys: { WORCA_BROKER_KEY_COPILOT_PAT: PAT } });
  const r = await call(await mint('copilot-pat'), '/p/copilot-pat/chat/completions', {
    headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model: 'gpt-4.1', messages: [] }) });
  assert.equal(r.status, 200); await r.text();
  assert.deepEqual(other.calls, [], 'the host the lookup named (not *.githubcopilot.com over https) never sees the PAT');
  assert.equal(up.calls.find((c) => c.url === '/chat/completions')?.headers.authorization, `Bearer ${PAT}`);
});

test('a reply header a slot passes is dropped when its value holds the slot\'s key', async () => {
  let trace = OPENAI_KEY;
  const up = await fakeVendor({
    '/v1/responses': (_req, res) => { res.writeHead(200, { 'content-type': 'application/json', 'x-trace': trace }); res.end(JSON.stringify({ model: 'gpt-5.5', usage: { input_tokens: 1, output_tokens: 1 } })); },
  });
  const { mint, call } = await broker(up, { keys: { WORCA_BROKER_KEY_OPENAI: OPENAI_KEY }, slotsExtra: [{ id: 'openai', responseHeaders: ['x-trace'] }] });
  const token = await mint('openai');
  const send = () => call(token, '/p/openai/v1/responses', { headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model: 'gpt-5.5', input: 'x' }) });
  const bad = await send(); await bad.text();
  assert.equal(bad.headers.get('x-trace'), null, 'a listed header whose value holds the key is dropped');
  trace = 'req-123456789';
  const ok = await send(); await ok.text();
  assert.equal(ok.headers.get('x-trace'), 'req-123456789', 'a clean one passes');
});

test('copilot-pat slot sends the PAT as Bearer with the CLI\'s headers', async () => {
  const up = await fakeVendor({
    '/chat/completions': (_req, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ object: 'chat.completion', model: 'gpt-4.1', usage: { prompt_tokens: 3, completion_tokens: 1 } })); },
  });
  const { mint, call } = await broker(up, { keys: { WORCA_BROKER_KEY_COPILOT_PAT: PAT } });
  const r = await call(await mint('copilot-pat'), '/p/copilot-pat/chat/completions', {
    headers: { 'content-type': 'application/json', 'x-initiator': 'agent' }, body: JSON.stringify({ model: 'gpt-4.1', messages: [] }) });
  assert.equal(r.status, 200);
  await r.text();
  const lookup = up.calls.find((c) => c.url === '/copilot_internal/user');
  assert.equal(lookup.headers.authorization, `Bearer ${PAT}`);
  const sent = up.calls.find((c) => c.url === '/chat/completions');
  assert.equal(sent.headers.authorization, `Bearer ${PAT}`);
  assert.equal(sent.headers['copilot-integration-id'], 'copilot-developer-cli');
  assert.equal(sent.headers['x-initiator'], 'agent', 'its premium-request headers pass');
});

test('codex through the openai slot books spend per person', async () => {
  const usage = { input_tokens: 1000, output_tokens: 100, input_tokens_details: { cached_tokens: 400 } };
  const up = await fakeVendor({
    '/v1/responses': (_req, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.end([{ type: 'response.created', response: { model: 'gpt-5.5' } }, { type: 'response.output_text.delta', delta: 'hi' },
        { type: 'response.completed', response: { model: 'gpt-5.5', usage } }].map((e) => `data: ${JSON.stringify(e)}\n\n`).join(''));
    },
  });
  const { mint, call, service, store } = await broker(up, { mode: 'multi' });
  assert.equal((await service.saveCredential('ada@acme.dev', 'openai', OPENAI_KEY)).ok, true);
  const r = await call(await mint('openai', 'ada@acme.dev'), '/p/openai/v1/responses', {
    headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model: 'gpt-5.5', stream: true, input: 'x' }) });
  assert.equal(r.status, 200);
  await r.text();
  const rows = store.queryUsage({ billTo: 'ada@acme.dev' });
  assert.equal(rows.length, 1);
  const [row] = rows;
  assert.equal(row.billTo ?? row.bill_to, 'ada@acme.dev');
  assert.equal(row.model, 'gpt-5.5');
  assert.equal(row.inputTokens ?? row.input_tokens, 600);
  assert.equal(row.cacheReadTokens ?? row.cache_read_tokens, 400);
  const want = priceUsage({ model: 'gpt-5.5', inputTokens: 600, outputTokens: 100, cacheReadTokens: 400, cacheWriteTokens: 0 });
  assert.ok(Math.abs(want - (600 * 5 / 1e6 + 100 * 30 / 1e6 + 400 * 0.5 / 1e6)) < 1e-12, 'gpt-5.5 list price');
  assert.ok(Math.abs((row.usd) - want) < 1e-9, `${row.usd} vs ${want}`);
});

test('relay and broker share one Cursor exchange', () => {
  assert.equal(typeof cursorAccessToken, 'function');
  const relay = readFileSync(join(ROOT, 'src/core/exec-env/relay-route.mjs'), 'utf8');
  assert.ok(!relay.includes('exchange_user_api_key'), 'relay-route.mjs carries no copy of the exchange');
});

test('engine-only slots are skipped by routing, the boot guard and plugin slots', () => {
  for (const auth of ['copilot', 'github-user', 'copilot-pat', 'cursor-exchange']) assert.equal(engineOnlyAuth({ auth }), true, auth);
  for (const auth of ['bearer', 'x-api-key', 'none']) assert.equal(engineOnlyAuth({ auth }), false, auth);
  const slots = builtinSlots();
  assert.equal(slotForBaseUrl('https://api2.cursor.sh/v1', slots), null, 'a catalog model never routes to the cursor slot');
  assert.equal(slotForBaseUrl('https://api.githubcopilot.com', slots), null, 'nor to a Copilot slot');
  assert.deepEqual(slotForBaseUrl('https://api.openai.com/v1', slots), { slot: 'openai', prefix: '/v1' });
  // The boot guard's slot origins and the plugin slots' taken origins read the same rule.
  for (const f of ['src/core/broker-boot.mjs', 'src/core/plugin-broker-slots.mjs', 'src/core/broker-routing.mjs']) {
    const src = readFileSync(join(ROOT, f), 'utf8');
    assert.ok(src.includes('engineOnlyAuth('), `${f} uses engineOnlyAuth`);
    assert.ok(!/auth !== 'copilot' && \w+\.auth !== 'github-user'/.test(src), `${f} keeps no copy of the list`);
  }
});

test('slots file: a Connect slot is built-in only; response headers and the lookup URL are checked', () => {
  const base = builtinSlots();
  assert.doesNotThrow(() => mergeSlots(base, [{ id: 'cursor', upstream: 'http://127.0.0.1:5' }]), 'the built-in cursor slot moves to a loopback fake');
  assert.deepEqual(mergeSlots(base, [{ id: 'cursor', upstream: 'http://127.0.0.1:5' }]).find((s) => s.id === 'cursor').paths, CURSOR_PATHS, 'an override keeps the exact calls');
  assert.throws(() => mergeSlots(base, [{ id: 'my-connect', protocol: 'connect', auth: 'bearer', credential: 'per-person', upstream: 'https://c.example', paths: [['POST', '/x']] }]),
    /protocol connect is built-in only/);
  assert.throws(() => mergeSlots(base, [{ id: 'openai', protocol: 'connect' }]), /protocol connect is built-in only/, 'nor by turning another built-in into one');
  assert.equal(mergeSlots(base, []).find((s) => s.id === 'cursor').pathPattern, undefined, 'the cursor slot has no pattern');
  assert.throws(() => mergeSlots(base, [{ id: 'cursor', pathPattern: '/.*/' }]), /pathPattern is built-in only/);
  assert.throws(() => mergeSlots(base, [{ id: 'cursor', responseHeaders: ['set-cookie'] }]), /responseHeaders may not include/);
  assert.throws(() => mergeSlots(base, [{ id: 'cursor', responseHeaders: ['bad header'] }]), /responseHeaders must be a list of header names/);
  assert.throws(() => mergeSlots(base, [{ id: 'copilot-pat', lookupUrl: 'http://example.com' }]), /lookupUrl: upstream must be https/);
  assert.equal(mergeSlots(base, [{ id: 'copilot-pat', lookupUrl: 'https://ghe.example/api/v3/' }]).find((s) => s.id === 'copilot-pat').lookupUrl, 'https://ghe.example/api/v3');
});

// ── the google slot: Gemini CLI's API key, and the google provider of Qwen Code, Goose and OpenCode (R11) ──
const GEMINI_KEY = 'AIza-person-key-0123456789abcdef';

test('google slot: a Gemini call names its model in the path; the spawn token rides x-goog-api-key, the person\'s key goes out there too, and the usage is booked', async () => {
  const path = '/v1beta/models/gemini-2.5-flash:streamGenerateContent';
  const up = await fakeVendor({
    '/v1beta/models': (req, res) => { res.writeHead(req.headers['x-goog-api-key'] === GEMINI_KEY ? 200 : 403, { 'content-type': 'application/json' }); res.end('{"models":[]}'); },
    [`${path}?alt=sse`]: (req, res) => {
      if (req.headers['x-goog-api-key'] !== GEMINI_KEY || req.headers.authorization) { res.writeHead(403); res.end(); return; }
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.end([{ candidates: [{ content: { parts: [{ text: 'h' }] } }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 1 }, modelVersion: 'gemini-2.5-flash' },
        { candidates: [{ content: { parts: [{ text: 'i' }] } }], usageMetadata: { promptTokenCount: 500, cachedContentTokenCount: 200, candidatesTokenCount: 40, thoughtsTokenCount: 10 }, modelVersion: 'gemini-2.5-flash' }]
        .map((e) => `data: ${JSON.stringify(e)}\n\n`).join(''));
    },
  });
  const { mint, port, service, store } = await broker(up, { mode: 'multi', slotsExtra: [{ id: 'google', upstream: up.url }] });
  assert.equal((await service.saveCredential('ada@acme.dev', 'google', GEMINI_KEY)).ok, true, 'the key verifies against GET /v1beta/models');
  const token = await mint('google', 'ada@acme.dev');
  const r = await fetch(`http://127.0.0.1:${port}/p/google${path}?alt=sse`, { method: 'POST', headers: { 'x-goog-api-key': token, 'content-type': 'application/json' },
    body: JSON.stringify({ contents: [] }) });
  assert.equal(r.status, 200);
  await r.text();
  const [row] = store.queryUsage({ billTo: 'ada@acme.dev' });
  assert.equal(row.model, 'gemini-2.5-flash');
  assert.deepEqual([row.inputTokens ?? row.input_tokens, row.cacheReadTokens ?? row.cache_read_tokens, row.outputTokens ?? row.output_tokens], [300, 200, 50], 'the last running total; thinking is output');
  assert.ok(row.usd > 0, 'an unlisted model is priced at the fallback rate, never $0');
  // Another Gemini API call is not the slot's: refused in Google's error shape, before any key leaves.
  const files = await fetch(`http://127.0.0.1:${port}/p/google/v1beta/files`, { method: 'POST', headers: { 'x-goog-api-key': token } });
  assert.equal(files.status, 403);
  const body = await files.json();
  assert.equal(body.error.status, 'PERMISSION_DENIED');
  assert.match(body.error.message, /^worca-broker: POST \/v1beta\/files is not allowed for slot google/);
  assert.equal(up.calls.filter((c) => c.url.startsWith('/v1beta/files')).length, 0);
});

test('slots file: a Gemini slot is built-in only', () => {
  const base = builtinSlots();
  assert.ok(mergeSlots(base, [{ id: 'google', upstream: 'http://127.0.0.1:5' }]).find((s) => s.id === 'google').pathPattern instanceof RegExp, 'an override keeps the pattern');
  assert.throws(() => mergeSlots(base, [{ id: 'my-gemini', protocol: 'gemini', auth: 'x-goog-api-key', credential: 'per-person', upstream: 'https://g.example', paths: [['POST', '/x']] }]),
    /protocol gemini is built-in only/);
});
