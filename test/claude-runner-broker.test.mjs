// test/claude-runner-broker.test.mjs
// runClaude with the credential broker on (plans/credential-broker-design.html §5.2,
// §8.2): a token is minted per spawn, reaches the CLI as its only credential, is
// revoked when the process exits, and never survives in anything worca keeps. The
// "CLI" is a stub that calls ANTHROPIC_BASE_URL with ANTHROPIC_AUTH_TOKEN, the way
// the real one does, and prints stream-json.
import { test, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readBrokerConfig } from '../src/broker/config.mjs';
import { builtinSlots, mergeSlots } from '../src/broker/slots.mjs';
import { startBroker } from '../src/broker/main.mjs';
import { runClaude, brokerRouteFor } from '../src/core/claude-runner.mjs';
import { resetBrokerClient } from '../src/core/broker-client.mjs';
import { withBillTo } from '../src/core/billing.mjs';
import { probeClaudeAuth } from '../src/core/preflight.mjs';
import { classifyError } from '../src/core/recoverable-error.mjs';
import { startFakeUpstream, GOOD_KEY } from './helpers/fake-model-upstream.mjs';

const POSIX = { skip: process.platform === 'win32' ? 'the stub CLI is a POSIX script' : false };
const SECRET = 'r'.repeat(48);
let up; let single; let multi; let dir; let stub;
const saved = {};
const ENV_KEYS = ['WORCA_MOCK', 'ORCH_MOCK', 'WORCA_BROKER_URL', 'WORCA_BROKER_SECRET', 'ANTHROPIC_API_KEY', 'CLAUDE_CODE_OAUTH_TOKEN', 'WORCA_HOST_GUARD', 'WORCA_BROKER_SYSTEM_BILL_TO'];

async function brokerFor(mode) {
  const env = { WORCA_BROKER_MODE: mode, WORCA_BROKER_SECRET: SECRET, WORCA_BROKER_HOST: '127.0.0.1', WORCA_BROKER_PORT: '0', WORCA_BROKER_UI_PORT: '0' };
  if (mode === 'single') env.WORCA_BROKER_KEY_ANTHROPIC = GOOD_KEY;
  else Object.assign(env, { WORCA_BROKER_VAULT_KEY: Buffer.alloc(32, 7).toString('base64'), WORCA_BROKER_PUBLIC_URL: 'https://keys.example.com', WORCA_IDENTITY_HEADER: 'x-email' });
  const { config, errors } = readBrokerConfig(env);
  assert.deepEqual(errors, []);
  return startBroker({ config: { ...config, uiPort: 0 }, slots: mergeSlots(builtinSlots(), [{ id: 'anthropic', upstream: up.url }]), log: () => {} });
}

before(async () => {
  up = await startFakeUpstream();
  single = await brokerFor('single');
  multi = await brokerFor('multi');
  dir = await mkdtemp(join(tmpdir(), 'worca-broker-runner-'));
  stub = join(dir, 'claude-stub.mjs');
  // The stub: report what credentials it can see, call the broker like the CLI does,
  // echo its own token into the transcript (a prompt injection would), exit.
  await writeFile(stub, `#!/usr/bin/env node
const base = process.env.ANTHROPIC_BASE_URL;
const tok = process.env.ANTHROPIC_AUTH_TOKEN || '';
const out = (o) => process.stdout.write(JSON.stringify(o) + '\\n');
out({ type: 'system', subtype: 'init', session_id: 's1' });
const seen = { apiKey: !!process.env.ANTHROPIC_API_KEY, oauth: !!process.env.CLAUDE_CODE_OAUTH_TOKEN, secret: !!process.env.WORCA_BROKER_SECRET, base };
const r = await fetch(base + '/v1/messages', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + tok, 'anthropic-version': '2023-06-01' }, body: JSON.stringify({ model: 'claude-sonnet-5', max_tokens: 5, messages: [{ role: 'user', content: 'hi' }] }) });
const body = await r.text();
if (!r.ok) { out({ type: 'result', is_error: true, result: 'API Error: ' + r.status + ' ' + body }); process.exit(1); }
out({ type: 'assistant', message: { content: [{ type: 'text', text: 'my token is ' + tok + ' ' + JSON.stringify(seen) }] } });
out({ type: 'result', result: 'done ' + tok + ' ' + JSON.stringify(seen), total_cost_usd: 0 });
`, 'utf8');
  await chmod(stub, 0o755);
});
after(async () => { await single?.close(); await multi?.close(); await up?.close(); await rm(dir, { recursive: true, force: true }); });

beforeEach(() => {
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  delete process.env.WORCA_MOCK; delete process.env.ORCH_MOCK;
  process.env.WORCA_HOST_GUARD = '0';
  process.env.WORCA_BROKER_SECRET = SECRET;
  resetBrokerClient();
});
afterEach(() => {
  for (const k of ENV_KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  resetBrokerClient();
});

const useBroker = (b) => { process.env.WORCA_BROKER_URL = `http://127.0.0.1:${b.ports.private}`; resetBrokerClient(); };

test('a spawn gets its own token, and the CLI sees no other credential', POSIX, async () => {
  useBroker(single);
  process.env.ANTHROPIC_API_KEY = 'sk-ant-ambient-should-be-stripped';
  process.env.CLAUDE_CODE_OAUTH_TOKEN = 'sk-ant-oat-ambient';
  const events = [];
  up.requests.length = 0;
  const r = await runClaude({ bin: stub, prompt: 'hi', model: 'claude-sonnet-5', onEvent: (e) => events.push(e) });
  const seen = JSON.parse(r.text.slice(r.text.indexOf('{')));
  assert.deepEqual({ apiKey: seen.apiKey, oauth: seen.oauth, secret: seen.secret }, { apiKey: false, oauth: false, secret: false });
  assert.equal(seen.base, `${process.env.WORCA_BROKER_URL}/p/anthropic`);
  assert.equal(up.requests.at(-1).headers['x-api-key'], GOOD_KEY, 'the broker added the real key');
  // Redaction: the token the stub printed is gone from the result and every event.
  assert.match(r.text, /done wbt_\[redacted\]/);
  assert.ok(!JSON.stringify(events).match(/wbt_[A-Za-z0-9_-]{20,}/), 'no live token in any event');
  // Revoked on exit: the broker has it revoked.
  await new Promise((res) => setTimeout(res, 50));
  const row = single.store.db.prepare('SELECT revoked_at, bill_to, kind FROM tokens ORDER BY created_at DESC LIMIT 1').get();
  assert.ok(row.revoked_at, 'revoked after the process exited');
  assert.equal(row.bill_to, 'local');
});

test('the person in the async context is who the broker bills (multi mode); no person is refused', POSIX, async () => {
  useBroker(multi);
  // No key saved for ada: the broker's "no key" error comes back as an auth failure.
  const err = await withBillTo('ada@acme.dev', () => runClaude({ bin: stub, prompt: 'hi', model: 'claude-sonnet-5' })).catch((e) => e);
  assert.ok(err instanceof Error);
  assert.match(err.message, /worca-broker: no Anthropic API key or Claude subscription for ada@acme\.dev/);
  assert.equal(classifyError(err), 'auth');
  const row = multi.store.db.prepare('SELECT bill_to FROM tokens ORDER BY created_at DESC LIMIT 1').get();
  assert.equal(row.bill_to, 'ada@acme.dev');
  const none = await runClaude({ bin: stub, prompt: 'hi', model: 'claude-sonnet-5' }).catch((e) => e);
  assert.match(none.message, /no signed-in person to bill/);
  assert.equal(classifyError(none), 'auth');
  process.env.WORCA_BROKER_SYSTEM_BILL_TO = 'ops@acme.dev';
  await runClaude({ bin: stub, prompt: 'hi', model: 'claude-sonnet-5' }).catch(() => {});
  assert.equal(multi.store.db.prepare('SELECT bill_to FROM tokens ORDER BY created_at DESC LIMIT 1').get().bill_to, 'ops@acme.dev');
});

test('a model routed straight to a provider is refused (keys must not bypass the broker)', POSIX, async () => {
  useBroker(single);
  const err = await runClaude({ bin: stub, prompt: 'hi', model: 'gw', modelEnv: { ANTHROPIC_BASE_URL: 'https://gw.example.com' } }).catch((e) => e);
  assert.match(err.message, /routes to gw\.example\.com directly/);
  assert.equal(classifyError(err), 'auth');
});

test('routing: broker slot URLs, the loopback bridge, and everything else', () => {
  process.env.WORCA_BROKER_URL = 'http://broker:8080';
  assert.deepEqual(brokerRouteFor(undefined), { slot: 'anthropic' });
  assert.deepEqual(brokerRouteFor({ ANTHROPIC_BASE_URL: 'http://broker:8080/p/openrouter' }), { slot: 'openrouter' });
  assert.deepEqual(brokerRouteFor({ ANTHROPIC_BASE_URL: 'http://127.0.0.1:5123/m/local-qwen' }), { bridge: true });
  assert.ok(brokerRouteFor({ ANTHROPIC_BASE_URL: 'http://broker:8080/p/../x' }).error);
});

test('a broker that cannot be reached is a network-class failure, not a crash', POSIX, async () => {
  process.env.WORCA_BROKER_URL = 'http://127.0.0.1:9';
  resetBrokerClient();
  const err = await runClaude({ bin: stub, prompt: 'hi', model: 'claude-sonnet-5' }).catch((e) => e);
  assert.match(err.message, /worca-broker: cannot reach the credential broker/);
  assert.equal(err.errorClass, 'network');
});

test('the sign-in probe says signed in via the broker, without running `claude auth status`', async () => {
  let ran = false;
  const r = await probeClaudeAuth({ env: { WORCA_BROKER_URL: 'http://broker:8080' }, run: async () => { ran = true; return null; } });
  assert.deepEqual(r, { state: 'signed-in', source: 'broker', detail: 'broker' });
  assert.equal(ran, false);
});

test('run preflight: every node\'s model is checked against the paying person\'s keys before anything spawns', async () => {
  const { RunHarness } = await import('../src/core/run-harness.mjs');
  useBroker(multi);
  const fake = { claude: { model: null, mock: false } };
  const manifest = { nodes: [{ kind: 'agent', model: 'claude-sonnet-5' }, { kind: 'agent', model: '' }] };
  // Ada has no Anthropic key in this broker: refused, naming the key and the model.
  const err = await withBillTo('ada@acme.dev', () => RunHarness.prototype._brokerPreflight.call(fake, manifest, {})).catch((e) => e);
  assert.ok(err instanceof Error);
  assert.match(err.message, /^Preflight failed: missing credentials: Anthropic API key or Claude subscription \(not added; needed by claude-sonnet-5\)/);
  assert.equal(err.errorClass, 'auth');
  // No person behind the run in multi mode: refused.
  const none = await RunHarness.prototype._brokerPreflight.call(fake, manifest, {}).catch((e) => e);
  assert.match(none.message, /no signed-in person to charge/);
  // Single mode with the key: passes.
  useBroker(single);
  await RunHarness.prototype._brokerPreflight.call(fake, manifest, {});
});
