// test/broker-units.test.mjs
// Pure parts of the credential broker (plans/credential-broker-design.html §8.1):
// config, slots, vault, tokens, usage, scrub, and worca's guard, billing, redaction
// and error-class wiring.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readBrokerConfig, parseDuration, decodeVaultKey } from '../src/broker/config.mjs';
import { builtinSlots, mergeSlots, pathIssue, isAllowedPath, upstreamIssue } from '../src/broker/slots.mjs';
import { seal, open, keyId, suffixOf } from '../src/broker/vault.mjs';
import { openStore } from '../src/broker/store.mjs';
import { mintToken, resolveToken, parseMintRequest, tokenFromHeaders, hashToken, TOKEN_RE } from '../src/broker/tokens.mjs';
import { createUsageTap, priceUsage } from '../src/broker/usage.mjs';
import { scrubText, REMOVED } from '../src/broker/scrub.mjs';
import { findLocalCredentials, guardMessage } from '../src/core/broker-guard.mjs';
import { withBillTo, currentBillTo, resolveBillTo, normalizeBillTo } from '../src/core/billing.mjs';
import { redactSecrets, redactDeep } from '../src/core/redact.mjs';
import { classifyError, brokerHint } from '../src/core/recoverable-error.mjs';
import { retryAfterMs } from '../src/core/recovery-backoff.mjs';
import { brokerError } from '../src/broker/service.mjs';
import { PREDEFINED_LIST_PRICES, listPriceFor } from '../src/core/list-prices.mjs';
import { PREDEFINED_LIST_PRICES as FROM_CONFIG } from '../src/core/config.mjs';

const SECRET = 'x'.repeat(40);
const VK = randomBytes(32).toString('base64');

// ── config ───────────────────────────────────────────────────────────────────

test('config: single mode needs only the mode and the secret', () => {
  const { config, errors } = readBrokerConfig({ WORCA_BROKER_MODE: 'single', WORCA_BROKER_SECRET: SECRET, WORCA_BROKER_KEY_ANTHROPIC: 'sk-ant-abc123456789' });
  assert.deepEqual(errors, []);
  assert.equal(config.mode, 'single');
  assert.equal(config.uiEnabled, false);
  assert.equal(config.singleKeys.anthropic, 'sk-ant-abc123456789');
  assert.equal(config.port, 8080);
  assert.equal(config.uiPort, 8081);
});

test('config: multi mode lists every missing piece at once', () => {
  const { errors } = readBrokerConfig({ WORCA_BROKER_MODE: 'multi', WORCA_BROKER_SECRET: SECRET });
  assert.ok(errors.some((e) => /VAULT_KEY is required/.test(e)));
  assert.ok(errors.some((e) => /PUBLIC_URL is required/.test(e)));
  assert.ok(errors.some((e) => /identity check/.test(e)));
});

test('config: rejects a short secret, a bad vault key, equal ports, a non-origin public URL, half an Access config', () => {
  const { errors } = readBrokerConfig({
    WORCA_BROKER_MODE: 'multi', WORCA_BROKER_SECRET: 'short', WORCA_BROKER_VAULT_KEY: 'bm9wZQ==',
    WORCA_BROKER_PORT: '9000', WORCA_BROKER_UI_PORT: '9000', WORCA_BROKER_PUBLIC_URL: 'https://keys.example.com/path',
    WORCA_CF_ACCESS_TEAM_DOMAIN: 'acme.cloudflareaccess.com',
  });
  for (const re of [/too short/, /32 bytes/, /must differ/, /origin only/, /set both/]) assert.ok(errors.some((e) => re.test(e)), `expected ${re}`);
});

test('config: a complete multi config passes; *_FILE wins over the plain variable', () => {
  const files = { '/s': `${SECRET}\n`, '/v': VK };
  const { config, errors } = readBrokerConfig({
    WORCA_BROKER_MODE: 'multi', WORCA_BROKER_SECRET: 'ignored-because-file-wins', WORCA_BROKER_SECRET_FILE: '/s',
    WORCA_BROKER_VAULT_KEY_FILE: '/v', WORCA_BROKER_PUBLIC_URL: 'https://worca-01-keys.example.com',
    WORCA_CF_ACCESS_TEAM_DOMAIN: 'https://acme.cloudflareaccess.com/', WORCA_CF_ACCESS_AUD: 'aud-keys',
  }, { readFile: (p) => files[p] });
  assert.deepEqual(errors, []);
  assert.equal(config.secret, SECRET);
  assert.equal(config.vaultKey.length, 32);
  assert.deepEqual(config.identity, { kind: 'access', teamDomain: 'acme.cloudflareaccess.com', aud: 'aud-keys' });
  assert.equal(config.publicUrl, 'https://worca-01-keys.example.com');
});

test('config: durations and vault keys', () => {
  assert.equal(parseDuration('48h'), 48 * 3_600_000);
  assert.equal(parseDuration('90m'), 90 * 60_000);
  assert.equal(parseDuration('nope'), null);
  assert.equal(decodeVaultKey(randomBytes(16).toString('base64')), null);
  assert.equal(decodeVaultKey(randomBytes(32).toString('base64url')).length, 32);
});

// ── slots ────────────────────────────────────────────────────────────────────

test('slots: built-ins pin their upstreams; local exists only when named', () => {
  const ids = builtinSlots().map((s) => s.id);
  assert.deepEqual(ids, ['anthropic', 'openai', 'openrouter', 'copilot']);
  const cp = builtinSlots().find((s) => s.id === 'copilot');
  assert.equal(cp.auth, 'copilot');
  assert.ok(cp.headers.includes('copilot-integration-id'));
  const local = builtinSlots({ localUrl: 'http://host.docker.internal:11434' }).find((s) => s.id === 'local');
  assert.equal(local.credential, 'none');
  assert.equal(builtinSlots()[0].upstream, 'https://api.anthropic.com');
});

test('slots: upstream must be an origin, https unless private', () => {
  assert.equal(upstreamIssue('https://llm.acme.dev'), null);
  assert.equal(upstreamIssue('http://ollama:11434'), null);
  assert.equal(upstreamIssue('http://10.1.2.3:8000'), null);
  assert.match(upstreamIssue('http://llm.acme.dev'), /https/);
  assert.match(upstreamIssue('https://llm.acme.dev/v1'), /origin only/);
  assert.match(upstreamIssue('https://u:p@llm.acme.dev'), /credentials/);
});

test('slots: a file entry overrides a built-in field by field and validates', () => {
  const merged = mergeSlots(builtinSlots(), [{ id: 'anthropic', upstream: 'http://127.0.0.1:9999' }, { id: 'gateway', label: 'Gateway', protocol: 'openai', auth: 'bearer', credential: 'per-person', upstream: 'https://gw.acme.dev' }]);
  const a = merged.find((s) => s.id === 'anthropic');
  assert.equal(a.upstream, 'http://127.0.0.1:9999');
  assert.equal(a.auth, 'x-api-key');
  assert.ok(merged.find((s) => s.id === 'gateway').paths.some(([m, p]) => m === 'POST' && p === '/v1/chat/completions'));
  assert.throws(() => mergeSlots(builtinSlots(), [{ id: 'bad', protocol: 'anthropic', auth: 'x-api-key', credential: 'per-person', upstream: 'http://evil.example' }]), /https/);
  assert.throws(() => mergeSlots(builtinSlots(), [{ id: 'Bad Id' }]), /id must match/);
});

test('slots: the path allowlist is exact and refuses anything a normaliser could rewrite', () => {
  const a = builtinSlots()[0];
  assert.equal(isAllowedPath(a, 'POST', '/v1/messages'), true);
  assert.equal(isAllowedPath(a, 'GET', '/v1/messages'), false);
  assert.equal(isAllowedPath(a, 'POST', '/v1/files'), false);
  assert.equal(isAllowedPath(a, 'POST', '/v1/messages/'), false);
  for (const p of ['/v1/../internal', '/v1//messages', '/v1/%2e%2e/x', '/v1%2fmessages', '/v1\\messages', '/v1/./messages']) {
    assert.ok(pathIssue(p), `must refuse ${p}`);
  }
});

// ── vault ────────────────────────────────────────────────────────────────────

test('vault: round trip; a row moved to another person or slot, a tampered row, or another key all fail', () => {
  const key = randomBytes(32);
  const s = seal(key, 'sk-ant-secret-value-1234', { billTo: 'ada@acme.dev', slot: 'anthropic' });
  assert.equal(open(key, s, { billTo: 'ada@acme.dev', slot: 'anthropic' }), 'sk-ant-secret-value-1234');
  assert.throws(() => open(key, s, { billTo: 'bob@acme.dev', slot: 'anthropic' }));
  assert.throws(() => open(key, s, { billTo: 'ada@acme.dev', slot: 'openai' }));
  assert.throws(() => open(randomBytes(32), s, { billTo: 'ada@acme.dev', slot: 'anthropic' }));
  const flipped = Buffer.from(s.ciphertext); flipped[0] ^= 0xff; // always a change (fill(1) was a no-op 1 time in 256)
  const tampered = { ...s, ciphertext: flipped };
  assert.throws(() => open(key, tampered, { billTo: 'ada@acme.dev', slot: 'anthropic' }));
  assert.equal(s.keyId, keyId(key));
  assert.equal(suffixOf('sk-ant-secret-value-1234'), '1234');
  assert.equal(suffixOf('short'), '');
});

// ── tokens ───────────────────────────────────────────────────────────────────

test('tokens: mint stores only a hash; resolve refuses unknown, revoked and expired tokens', () => {
  const store = openStore();
  const { req } = parseMintRequest({ billTo: 'Ada@Acme.dev', slots: ['anthropic'], spawnId: 'sp-1', kind: 'aux', issuer: 'srv-1' }, { slotIds: ['anthropic'], maxTtlMs: 48 * 3_600_000 });
  assert.equal(req.billTo, 'ada@acme.dev');
  assert.equal(req.ttlMs, 10 * 60_000, 'aux tokens live 10 minutes');
  const t0 = 1_000_000;
  const { token } = mintToken(store, req, t0);
  assert.match(token, TOKEN_RE);
  const raw = JSON.stringify(store.db.prepare('SELECT * FROM tokens').all());
  assert.ok(!raw.includes(token), 'the token itself is never stored');
  assert.ok(raw.includes(hashToken(token)));
  assert.equal(resolveToken(store, token, t0 + 1000).row.bill_to, 'ada@acme.dev');
  assert.equal(resolveToken(store, token, t0 + 11 * 60_000).error, 'expired');
  assert.equal(resolveToken(store, `wbt_${'A'.repeat(43)}`, t0).error, 'unknown');
  assert.equal(resolveToken(store, 'sk-ant-something', t0).error, 'malformed');
  store.revokeSpawn('sp-1', t0 + 2000);
  assert.equal(resolveToken(store, token, t0 + 3000).error, 'revoked');
  store.close();
});

test('tokens: bulk revoke by issuer keeps the current server\'s tokens', () => {
  const store = openStore();
  const mk = (spawnId, issuer) => mintToken(store, parseMintRequest({ billTo: 'local', slots: ['anthropic'], spawnId, kind: 'phase', issuer }, { slotIds: ['anthropic'], maxTtlMs: 1e9 }).req).token;
  const old = mk('a', 'srv-old');
  const cur = mk('b', 'srv-new');
  assert.equal(store.revokeWhere({ exceptIssuer: 'srv-new' }), 1);
  assert.equal(resolveToken(store, old).error, 'revoked');
  assert.ok(resolveToken(store, cur).row);
  store.close();
});

test('tokens: mint request validation', () => {
  const o = { slotIds: ['anthropic'], maxTtlMs: 3_600_000 };
  assert.match(parseMintRequest({ billTo: 'not an email', slots: ['anthropic'], spawnId: 'x', kind: 'phase', issuer: 'i' }, o).error, /billTo/);
  assert.match(parseMintRequest({ billTo: 'local', slots: ['openai'], spawnId: 'x', kind: 'phase', issuer: 'i' }, o).error, /slots/);
  assert.match(parseMintRequest({ billTo: 'local', slots: ['anthropic'], spawnId: 'x y', kind: 'phase', issuer: 'i' }, o).error, /spawnId/);
  assert.equal(parseMintRequest({ billTo: 'local', slots: ['anthropic'], spawnId: 'x', kind: 'phase', issuer: 'i' }, o).req.ttlMs, 3_600_000, 'capped by the operator maximum');
});

test('tokens: read from x-api-key or a Bearer header', () => {
  assert.equal(tokenFromHeaders({ 'x-api-key': ' wbt_abc ' }), 'wbt_abc');
  assert.equal(tokenFromHeaders({ authorization: 'Bearer wbt_def' }), 'wbt_def');
  assert.equal(tokenFromHeaders({}), null);
});

// ── usage ────────────────────────────────────────────────────────────────────

test('usage: Anthropic SSE split across chunks, cumulative output from the last delta', () => {
  const tap = createUsageTap('anthropic', 'text/event-stream');
  const sse = [
    `event: message_start\ndata: ${JSON.stringify({ type: 'message_start', message: { model: 'claude-sonnet-5', usage: { input_tokens: 1000, output_tokens: 1, cache_read_input_tokens: 200, cache_creation_input_tokens: 50 } } })}\n\n`,
    `event: message_delta\ndata: ${JSON.stringify({ type: 'message_delta', usage: { output_tokens: 500 } })}\n\n`,
  ].join('');
  for (let i = 0; i < sse.length; i += 7) tap.write(Buffer.from(sse.slice(i, i + 7)));
  const u = tap.end();
  assert.deepEqual([u.model, u.inputTokens, u.outputTokens, u.cacheReadTokens, u.cacheWriteTokens], ['claude-sonnet-5', 1000, 500, 200, 50]);
  // sonnet-5: $2 in, $10 out, $0.2 cache read, $2.5 cache write per Mtok
  assert.equal(priceUsage(u).toFixed(6), ((1000 * 2 + 500 * 10 + 200 * 0.2 + 50 * 2.5) / 1e6).toFixed(6));
});

test('usage: JSON bodies, OpenAI shapes, and an upstream-reported cost winning over the list price', () => {
  const a = createUsageTap('anthropic', 'application/json');
  a.write(JSON.stringify({ type: 'message', model: 'claude-haiku-4-5', usage: { input_tokens: 10, output_tokens: 5 } }));
  assert.equal(a.end().outputTokens, 5);
  const o = createUsageTap('openai', 'application/json');
  o.write(JSON.stringify({ model: 'x/y', usage: { prompt_tokens: 7, completion_tokens: 3, cost: 0.0123, prompt_tokens_details: { cached_tokens: 2 } } }));
  const u = o.end();
  assert.deepEqual([u.inputTokens, u.outputTokens, u.cacheReadTokens], [7, 3, 2]);
  assert.equal(priceUsage(u), 0.0123);
  assert.equal(priceUsage({ model: 'unknown', inputTokens: 1e6 }), 0, 'no price, no guess');
});

test('list prices: one table, re-exported by config.mjs', () => {
  assert.equal(FROM_CONFIG, PREDEFINED_LIST_PRICES);
  assert.equal(listPriceFor('claude-opus-4-8[1m]'), PREDEFINED_LIST_PRICES['claude-opus-4-8']);
  assert.equal(listPriceFor('claude-haiku-4-5-20251001'), PREDEFINED_LIST_PRICES['claude-haiku-4-5']);
});

// ── scrub ────────────────────────────────────────────────────────────────────

test('scrub: exact secrets, 12-character windows of them, and every known key shape', () => {
  const secret = 'sk-live-ABCDEFGHIJKLMNOPQRSTUV';
  const out = scrubText(`bad key ${secret}; truncated ${secret.slice(3, 20)}; masked sk-ab****wxyz; anthropic sk-ant-api03-aaaaaaaaaaaa; gh ghp_${'a'.repeat(36)}; aws AKIAABCDEFGHIJKLMNOP; token wbt_${'b'.repeat(43)}`, [secret]);
  for (const leak of [secret, secret.slice(3, 20), 'sk-ab****wxyz', 'sk-ant-api03', 'ghp_', 'AKIAABCD', 'wbt_b']) assert.ok(!out.includes(leak), `leaked ${leak}: ${out}`);
  assert.ok(out.includes(REMOVED));
  assert.equal(scrubText('nothing secret here, 12345'), 'nothing secret here, 12345');
});

// ── worca side: guard, billing, redaction, error classes ─────────────────────

test('guard: every reachable credential is a finding, named by where it is, never by value', () => {
  const findings = findLocalCredentials({
    env: { ANTHROPIC_API_KEY: 'sk-ant-REAL-VALUE-123', CLAUDE_CODE_OAUTH_TOKEN: '', OPENAI_API_KEY: '  ' },
    files: [{ path: '/home/worca/.claude/.credentials.json', kind: 'login' }, { path: '/x/settings.json', kind: 'settings', content: '{"apiKeyHelper":"cat k"}' }, { path: '/y/settings.json', kind: 'settings', content: '{}' }],
    models: [
      { id: 'gw', env: { ANTHROPIC_BASE_URL: 'https://gw.acme.dev', ANTHROPIC_AUTH_TOKEN: '${GW_TOKEN}', CLAUDE_CODE_MAX_OUTPUT_TOKENS: '8000' } },
      { id: 'routed', env: { ANTHROPIC_BASE_URL: 'http://broker:8080/p/anthropic' } },
      { id: 'local', upstream: { provider: 'openai', baseUrl: 'http://127.0.0.1:11434/v1' } },
      { id: 'oai', upstream: { provider: 'openai', baseUrl: 'https://api.openai.com/v1', apiKey: 'sk-XYZ' } },
    ],
    providers: { openai: { apiKey: '${OPENAI_KEY}' }, copilot: { githubToken: 'gho_x' } },
    brokerUrl: 'http://broker:8080',
  });
  const text = findings.join('\n');
  assert.ok(!text.includes('sk-ant-REAL-VALUE-123') && !text.includes('sk-XYZ') && !text.includes('gho_x'));
  for (const re of [/env ANTHROPIC_API_KEY \(set, 21 chars\)/, /credentials\.json: a stored Claude Code sign-in/, /\/x\/settings\.json: an apiKeyHelper/,
    /"gw": env ANTHROPIC_BASE_URL routes around the broker/, /"gw": env ANTHROPIC_AUTH_TOKEN = \$\{GW_TOKEN\}/, /"oai": upstream\.apiKey/,
    /"oai": upstream\.baseUrl api\.openai\.com/, /providers\.openai\.apiKey/, /providers\.copilot\.githubToken/]) {
    assert.match(text, re);
  }
  assert.ok(!/CLAUDE_CODE_OAUTH_TOKEN|OPENAI_API_KEY \(|MAX_OUTPUT|"routed"|"local"|\/y\/settings/.test(text), text);
  assert.match(guardMessage(findings, 'https://k'), /they belong in the broker: https:\/\/k/);
});

test('billing: the async context carries the person; explicit wins; the system fallback is last', async () => {
  assert.equal(currentBillTo(), null);
  await withBillTo('Ada@Acme.dev', async () => {
    await new Promise((r) => setTimeout(r, 5));
    assert.equal(currentBillTo(), 'ada@acme.dev');
    assert.equal(resolveBillTo('bob@acme.dev'), 'bob@acme.dev');
  });
  assert.equal(resolveBillTo(null, { WORCA_BROKER_SYSTEM_BILL_TO: 'ops@acme.dev' }), 'ops@acme.dev');
  assert.equal(normalizeBillTo('ada via Slack'), null);
  assert.equal(normalizeBillTo('LOCAL'), 'local');
});

test('redaction: broker tokens disappear from text and nested events', () => {
  const tok = `wbt_${'Z'.repeat(43)}`;
  assert.equal(redactSecrets(`ANTHROPIC_AUTH_TOKEN=${tok}`), 'ANTHROPIC_AUTH_TOKEN=wbt_[redacted]');
  const e = redactDeep({ type: 'assistant', raw: { message: { content: [{ type: 'text', text: `env: ${tok}` }] } } });
  assert.ok(!JSON.stringify(e).includes(tok));
  assert.equal(redactSecrets(42), 42);
});

test('broker errors land in the existing recovery classes, with a hint that says where to fix them', () => {
  const missing = brokerError('anthropic', 403, 'authentication_error', 'no Anthropic API key for ada@acme.dev. Add one at https://k');
  const msg = (b) => `claude exited with code 1: API Error: ${b.status} ${JSON.stringify(b.body)}`;
  assert.equal(classifyError(msg(missing)), 'auth');
  assert.match(brokerHint(msg(missing)), /key page/);
  // What the real CLI (2.1.283) prints for the broker's 403: no 401, no authentication_error.
  const printed = 'claude exited with code 1: Failed to authenticate. API Error: 403 worca-broker: no Anthropic API key for bob@acme.dev. Add one at https://keys';
  assert.equal(classifyError(printed), 'auth');
  assert.equal(classifyError('Failed to authenticate. API Error: 403 worca-broker: token expired or revoked'), 'auth');
  assert.equal(classifyError('API Error: 403 worca-broker: your Anthropic API key was rejected by the provider (invalid x-api-key). Replace it: add one at https://k'), 'auth');
  const budget = brokerError('anthropic', 403, 'permission_error', 'quota reached: daily budget of $50 for ada@acme.dev on anthropic');
  assert.equal(classifyError(msg(budget)), 'quota');
  assert.match(brokerHint(msg(budget)), /spending cap/);
  const busy = brokerError('anthropic', 429, 'rate_limit_error', 'too many concurrent requests, retry after 2 seconds');
  assert.equal(classifyError(msg(busy)), 'rate_limit');
  assert.equal(retryAfterMs(msg(busy)), 2000);
  assert.equal(brokerHint('some unrelated 401'), '');
  assert.deepEqual(brokerError('openai', 401, 'authentication_error', 'x').body, { error: { message: 'worca-broker: x', type: 'authentication_error', code: 'authentication_error' } });
});
