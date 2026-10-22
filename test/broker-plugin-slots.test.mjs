// test/broker-plugin-slots.test.mjs
// Plugin slots (docs/credential-broker.md "Plugin slots"): on a shared instance with a
// curated plugin set, a plugin model whose key is a plugin secret gets its own
// per-person broker slot, derived by worca and registered with the broker; no operator
// slots file. Covers the derivation, the broker's validation and storage, a saved key
// that stays bound to the host it was saved for, the boot guard, and a spawn end to end.
import { test, describe, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm, writeFile, chmod } from 'node:fs/promises';
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readBrokerConfig } from '../src/broker/config.mjs';
import { builtinSlots, mergeSlots, validatePluginSlots } from '../src/broker/slots.mjs';
import { openStore } from '../src/broker/store.mjs';
import { createBrokerService } from '../src/broker/service.mjs';
import { startBroker, loadBroker } from '../src/broker/main.mjs';
import { derivePluginSlots, pluginSlotId, pluginModelRoute, resetPluginSlotSync, syncPluginSlots } from '../src/core/plugin-broker-slots.mjs';
import { findLocalCredentials } from '../src/core/broker-guard.mjs';
import { resetBrokerClient } from '../src/core/broker-client.mjs';
import { modelSlot } from '../src/core/broker-routing.mjs';
import { runClaude } from '../src/core/claude-runner.mjs';
import { resolveModelEnv } from '../src/core/config.mjs';
import { withBillTo } from '../src/core/billing.mjs';
import { _resetForTests } from '../src/core/db.mjs';
import { readPluginsLock, writePluginsLock, pluginCurrentDir } from '../src/core/plugins-lock.mjs';
import { writePluginConfig } from '../src/core/plugin-config.mjs';
import { modelSecretsSchema } from '../src/core/plugin-models.mjs';

const POSIX = { skip: process.platform === 'win32' ? 'the stub CLI is a POSIX script' : false };
const SECRET = 'q'.repeat(48);
const KEY = 'acme-key-0123456789abcdef';
const VK = Buffer.alloc(32, 9).toString('base64');

/** A gateway that serves Messages under any prefix, has no model list, and records requests. */
async function startGateway() {
  const requests = [];
  const server = http.createServer((req, res) => {
    const parts = [];
    req.on('data', (c) => parts.push(c));
    req.on('end', () => {
      requests.push({ method: req.method, url: req.url, headers: { ...req.headers } });
      const key = req.headers['x-api-key'] || String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
      if (key !== KEY) { res.writeHead(401, { 'content-type': 'application/json' }); res.end('{"error":{"message":"bad key"}}'); return; }
      if (req.method === 'POST' && /\/v1\/messages$/.test(req.url.split('?')[0])) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ id: 'm1', type: 'message', role: 'assistant', model: 'acme-1', content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn', usage: { input_tokens: 3, output_tokens: 1 } }));
        return;
      }
      res.writeHead(404, { 'content-type': 'application/json' }); res.end('{"error":{"message":"not found"}}');
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${server.address().port}`, requests, close: () => new Promise((r) => { server.close(r); server.closeAllConnections?.(); }) };
}

const envModel = (base, extra = {}) => ({
  plugin: 'acme', id: 'acme-1', env: { ANTHROPIC_BASE_URL: base, ANTHROPIC_AUTH_TOKEN: { secret: 'acmeKey' }, ...extra },
});

// ── derivation (pure) ───────────────────────────────────────────────────────

test('derive: an env-style model gets p-<plugin>-<secret>, pinned to its origin, paths under its base path', () => {
  const d = derivePluginSlots([envModel('https://llm.acme.dev/anthropic')], { secretLabel: () => 'Acme key' });
  assert.deepEqual(d.problems, []);
  assert.equal(d.slots.length, 1);
  const s = d.slots[0];
  assert.equal(s.id, 'p-acme-acmekey');
  assert.equal(s.label, 'Acme key (acme)');
  assert.equal(s.upstream, 'https://llm.acme.dev');
  assert.equal(s.auth, 'bearer');
  assert.deepEqual(s.paths, [['POST', '/anthropic/v1/messages'], ['POST', '/anthropic/v1/messages/count_tokens'], ['GET', '/anthropic/v1/models']]);
  assert.deepEqual(d.routes.get('acme-1'), { slot: 'p-acme-acmekey', prefix: '/anthropic' });
  // ANTHROPIC_API_KEY goes as x-api-key; two models on one secret share the slot.
  const two = derivePluginSlots([
    { plugin: 'acme', id: 'a', env: { ANTHROPIC_BASE_URL: 'https://llm.acme.dev', ANTHROPIC_API_KEY: { secret: 'k' } } },
    { plugin: 'acme', id: 'b', env: { ANTHROPIC_BASE_URL: 'https://llm.acme.dev', ANTHROPIC_API_KEY: { secret: 'k' } } },
  ]);
  assert.equal(two.slots.length, 1);
  assert.equal(two.slots[0].auth, 'x-api-key');
  assert.equal(two.routes.get('b').slot, two.slots[0].id);
});

test('derive: what the broker cannot serve is refused by name, never routed', () => {
  const d = derivePluginSlots([
    envModel('${ACME_URL}'),
    { ...envModel('https://llm.acme.dev'), id: 'two-keys', env: { ANTHROPIC_BASE_URL: 'https://llm.acme.dev', ANTHROPIC_AUTH_TOKEN: { secret: 'a' }, ANTHROPIC_API_KEY: { secret: 'b' } } },
    { ...envModel('https://llm.acme.dev'), id: 'hdr', env: { ANTHROPIC_BASE_URL: 'https://llm.acme.dev', ANTHROPIC_CUSTOM_HEADERS: { secret: 'h' } } },
    { ...envModel('http://llm.acme.dev'), id: 'plain-http' },
    { ...envModel('https://other.example'), id: 'same-secret-other-host' },
  ]);
  assert.equal(d.problems.length, 4, d.problems.join('\n'));
  assert.match(d.routes.get('acme-1').error, /must be a literal URL/);
  assert.match(d.routes.get('two-keys').error, /sets both/);
  assert.match(d.routes.get('hdr').error, /not ANTHROPIC_CUSTOM_HEADERS/);
  assert.match(d.routes.get('plain-http').error, /https/);
  // The first model on a secret wins its host; the second can't send that secret elsewhere.
  assert.ok(d.routes.get('same-secret-other-host').slot);
  // A model with no plugin secret is left alone (a keyless local server, say).
  assert.equal(derivePluginSlots([{ plugin: 'x', id: 'local', env: { ANTHROPIC_BASE_URL: 'http://127.0.0.1:11434' } }]).slots.length, 0);
});

test('derive: a bridged plugin model gets a slot only for an origin nobody else pins', () => {
  const up = (baseUrl, api = 'openai-chat') => ({ plugin: 'acme', id: `b-${baseUrl}`, upstream: { provider: 'openai', api, model: 'm', baseUrl } });
  const d = derivePluginSlots([up('https://gw.acme.dev/v1'), up('https://api.openai.com/v1'), up('http://127.0.0.1:8000/v1')], { takenOrigins: ['https://api.openai.com'] });
  assert.equal(d.slots.length, 1);
  assert.equal(d.slots[0].upstream, 'https://gw.acme.dev');
  assert.equal(d.slots[0].auth, 'bearer');
  assert.deepEqual(d.slots[0].paths[0], ['POST', '/v1/chat/completions']);
  assert.equal(d.routes.size, 0, 'the bridge finds a bridged slot by origin');
});

test('slot ids stay inside the broker\'s id rule, however long the names', () => {
  const id = pluginSlotId('a-very-long-plugin-name-indeed', 'and-a-long-secret-key-too');
  assert.match(id, /^p-[a-z0-9-]{1,30}$/);
  assert.ok(id.length <= 32);
  assert.notEqual(id, pluginSlotId('a-very-long-plugin-name-indeed', 'and-a-long-secret-key-2'));
});

// ── broker: validation, storage, binding ─────────────────────────────────────

test('broker: plugin slots are narrow, can\'t shadow a slot, and an operator can\'t use p- ids', () => {
  const ok = { id: 'p-acme-k', protocol: 'anthropic', upstream: 'https://llm.acme.dev', auth: 'bearer', paths: [['POST', '/v1/messages']] };
  assert.equal(validatePluginSlots([ok])[0].credential, 'per-person');
  for (const [bad, re] of [
    [{ ...ok, id: 'acme' }, /must start with "p-"/],
    [{ ...ok, auth: 'none' }, /auth must be/],
    [{ ...ok, auth: 'copilot' }, /auth must be/],
    [{ ...ok, upstream: 'https://llm.acme.dev/path' }, /origin only/],
    [{ ...ok, upstream: 'http://llm.acme.dev' }, /https/],
    [{ ...ok, paths: [['DELETE', '/v1/x']] }, /GET or POST/],
  ]) assert.throws(() => validatePluginSlots([bad]), re);
  assert.throws(() => validatePluginSlots([ok, ok]), /duplicate/);
  assert.throws(() => validatePluginSlots([ok], ['p-acme-k']), /duplicate/);
  assert.throws(() => mergeSlots(builtinSlots(), [{ ...ok, credential: 'per-person' }]), /belong to plugin slots/);
  // Single mode may name a plugin slot's key before worca has registered it.
  const { errors } = loadBroker({ WORCA_BROKER_MODE: 'single', WORCA_BROKER_SECRET: SECRET, WORCA_BROKER_KEY_P_ACME_K: KEY });
  assert.deepEqual(errors, []);
});

test('broker: registered over /internal, kept across a restart, a saved key never follows the slot to a new host', async () => {
  const gw = await startGateway();
  const gw2 = await startGateway();
  const { config, errors } = readBrokerConfig({
    WORCA_BROKER_MODE: 'multi', WORCA_BROKER_SECRET: SECRET, WORCA_BROKER_VAULT_KEY: VK,
    WORCA_BROKER_PUBLIC_URL: 'https://keys.example.com', WORCA_IDENTITY_HEADER: 'x-email', WORCA_IDENTITY_TRUSTED_PROXIES: '127.0.0.1',
  });
  assert.deepEqual(errors, []);
  const store = openStore();
  const service = createBrokerService({ config, slots: builtinSlots(), store });
  const server = http.createServer((req, res) => service.handlePrivate(req, res));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const internal = async (method, path, body, secret = SECRET) => {
    const res = await fetch(`${base}${path}`, { method, headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, body: await res.json() };
  };
  const slot = (upstream) => ({ id: 'p-acme-acmekey', label: 'Acme key (acme)', plugin: 'acme', protocol: 'anthropic', upstream, auth: 'bearer', paths: [['POST', '/gw/v1/messages'], ['GET', '/gw/v1/models']], verify: { path: '/gw/v1/models' } });
  try {
    assert.equal((await internal('PUT', '/internal/plugin-slots', { slots: [slot(gw.url)] }, 'wrong')).status, 401);
    assert.equal((await internal('PUT', '/internal/plugin-slots', { slots: [{ ...slot(gw.url), id: 'anthropic' }] })).status, 400);
    const put = await internal('PUT', '/internal/plugin-slots', { slots: [slot(gw.url)] });
    assert.deepEqual(put.body.slots, ['p-acme-acmekey']);
    const info = await internal('GET', '/internal/info');
    assert.equal(info.body.slots.find((s) => s.id === 'p-acme-acmekey').plugin, 'acme');

    // The gateway has no model list: the key is still accepted (only a refusal rejects it).
    assert.equal((await service.saveCredential('alice@acme.dev', 'p-acme-acmekey', 'wrong-key-0123456789')).ok, false);
    assert.equal((await service.saveCredential('alice@acme.dev', 'p-acme-acmekey', KEY)).ok, true);
    const st = service.slotStatus('alice@acme.dev').find((s) => s.id === 'p-acme-acmekey');
    assert.equal(st.state, 'set');
    assert.equal(st.host, new URL(gw.url).host);

    const mint = await internal('POST', '/internal/tokens', { billTo: 'alice@acme.dev', slots: ['p-acme-acmekey'], spawnId: 'sp-1', kind: 'phase', issuer: 'srv-t' });
    const call = () => fetch(`${base}/p/p-acme-acmekey/gw/v1/messages`, {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${mint.body.token}` },
      body: JSON.stringify({ model: 'acme-1', max_tokens: 5, messages: [] }),
    });
    const ok = await call();
    assert.equal(ok.status, 200);
    assert.equal(gw.requests.at(-1).url, '/gw/v1/messages');
    assert.equal(gw.requests.at(-1).headers.authorization, `Bearer ${KEY}`, 'the broker added alice\'s key');

    // A restart over the same store still knows the slot.
    const again = createBrokerService({ config, slots: builtinSlots(), store });
    assert.ok(again.slotById.has('p-acme-acmekey'));

    // The plugin now points somewhere else: alice's key is not sent there.
    await internal('PUT', '/internal/plugin-slots', { slots: [slot(gw2.url)] });
    const moved = await call();
    assert.equal(moved.status, 403);
    assert.match((await moved.json()).error.message, /saved for 127\.0\.0\.1:\d+, and Acme key \(acme\) now points at 127\.0\.0\.1:\d+: enter it again/);
    assert.equal(gw2.requests.length, 0);
    assert.equal(service.slotStatus('alice@acme.dev').find((s) => s.id === 'p-acme-acmekey').state, 'invalid');

    // A disabled plugin's slot goes away.
    await internal('PUT', '/internal/plugin-slots', { slots: [] });
    assert.ok(!service.slotById.has('p-acme-acmekey'));
  } finally {
    server.close(); server.closeAllConnections?.(); store.close(); await gw.close(); await gw2.close();
  }
});

test('broker: single mode sends an operator plugin key only to the origin the operator approved', async () => {
  const gw = await startGateway();
  const gw2 = await startGateway();
  const origin = new URL(gw.url).origin;
  const slot = (upstream) => ({ id: 'p-acme-k', label: 'Acme key (acme)', plugin: 'acme', protocol: 'anthropic', upstream, auth: 'bearer', paths: [['POST', '/gw/v1/messages']] });
  const run = async (extraEnv, steps) => {
    const { config, errors } = readBrokerConfig({ WORCA_BROKER_MODE: 'single', WORCA_BROKER_SECRET: SECRET, WORCA_BROKER_KEY_P_ACME_K: KEY, ...extraEnv });
    assert.deepEqual(errors, []);
    const store = openStore();
    const service = createBrokerService({ config, slots: builtinSlots(), store });
    const server = http.createServer((req, res) => service.handlePrivate(req, res));
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${server.address().port}`;
    const internal = async (method, path, body) => (await fetch(`${base}${path}`, { method, headers: { authorization: `Bearer ${SECRET}`, 'content-type': 'application/json' }, body: JSON.stringify(body) })).json();
    const call = async () => {
      const { token } = await internal('POST', '/internal/tokens', { billTo: 'local', slots: ['p-acme-k'], spawnId: `sp-${Math.random()}`, kind: 'phase', issuer: 'srv-t' });
      return fetch(`${base}/p/p-acme-k/gw/v1/messages`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: '{"model":"acme-1","messages":[]}' });
    };
    try { await steps({ service, internal, call }); } finally { server.close(); server.closeAllConnections?.(); store.close(); }
  };
  try {
    // No approved origin: whoever registers the slot (worca, or anyone holding the shared secret) cannot aim the key.
    await run({}, async ({ service, internal, call }) => {
      await internal('PUT', '/internal/plugin-slots', { slots: [slot(gw.url)] });
      const r = await call();
      assert.equal(r.status, 403);
      assert.match((await r.json()).error.message, /set WORCA_BROKER_KEY_P_ACME_K_ORIGIN=http:\/\/127\.0\.0\.1:\d+ on the broker/);
      assert.equal(gw.requests.length, 0);
      assert.equal(service.slotStatus('local').find((s) => s.id === 'p-acme-k').state, 'invalid');
    });
    // Approved: the key goes there, and never follows the slot to another host.
    await run({ WORCA_BROKER_KEY_P_ACME_K_ORIGIN: `${origin}/` }, async ({ service, internal, call }) => {
      await internal('PUT', '/internal/plugin-slots', { slots: [slot(gw.url)] });
      assert.equal((await call()).status, 200);
      assert.equal(gw.requests.at(-1).headers.authorization, `Bearer ${KEY}`);
      assert.equal(service.slotStatus('local').find((s) => s.id === 'p-acme-k').state, 'set');
      await internal('PUT', '/internal/plugin-slots', { slots: [slot(gw2.url)] });
      const moved = await call();
      assert.equal(moved.status, 403);
      assert.match((await moved.json()).error.message, /approved for 127\.0\.0\.1:\d+, and Acme key \(acme\) now points at 127\.0\.0\.1:\d+/);
      assert.equal(gw2.requests.length, 0);
    });
    assert.match(readBrokerConfig({ WORCA_BROKER_MODE: 'single', WORCA_BROKER_SECRET: SECRET, WORCA_BROKER_KEY_P_ACME_K_ORIGIN: 'https://llm.acme.dev/v1' }).errors.join(' '), /WORCA_BROKER_KEY_P_ACME_K_ORIGIN: upstream must be an origin only/);
  } finally { await gw.close(); await gw2.close(); }
});

// ── boot guard ───────────────────────────────────────────────────────────────

test('guard: a brokered plugin model\'s base URL is fine; a plugin secret saved in worca is not', () => {
  const models = [{ id: 'Acme-1', plugin: 'acme', env: { ANTHROPIC_BASE_URL: 'https://llm.acme.dev' } }];
  assert.match(findLocalCredentials({ models, brokerUrl: 'http://broker:8080' }).join('\n'), /routes around the broker/);
  assert.deepEqual(findLocalCredentials({ models, brokerUrl: 'http://broker:8080', brokeredModels: ['acme-1'] }), []);
  const f = findLocalCredentials({ pluginSecrets: [{ plugin: 'acme', key: 'acmeKey' }] });
  assert.match(f[0], /plugin "acme": Model secret acmeKey is set/);
});

// ── end to end: an installed plugin, a spawn, the person's own key ─────────────

describe('end to end', () => {
  let gw; let broker; let dir; let stub; let homeDir; let worcaHome;
  const saved = {};
  const KEYS = ['HOME', 'USERPROFILE', 'WORCA_HOME', 'WORCA_TEST_ALLOW_HOME_FALLBACK', 'WORCA_MOCK', 'ORCH_MOCK', 'WORCA_BROKER_URL', 'WORCA_BROKER_SECRET', 'WORCA_HOST_GUARD'];

  before(async () => {
    for (const k of KEYS) saved[k] = process.env[k];
    gw = await startGateway();
    homeDir = await mkdtemp(join(tmpdir(), 'worca-pslots-home-'));
    worcaHome = await mkdtemp(join(tmpdir(), 'worca-pslots-whome-'));
    process.env.HOME = homeDir; process.env.USERPROFILE = homeDir; process.env.WORCA_HOME = worcaHome;
    process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = '1';
    _resetForTests();
    const cur = pluginCurrentDir('acme');
    mkdirSync(cur, { recursive: true });
    writeFileSync(join(cur, 'worca-cc-plugin.json'), JSON.stringify({
      name: 'acme', modelSecrets: [{ key: 'acmeKey', label: 'Acme key' }],
      models: [{ id: 'acme-1', label: 'Acme 1', env: { ANTHROPIC_BASE_URL: `${gw.url}/gw`, ANTHROPIC_AUTH_TOKEN: { secret: 'acmeKey' } } }],
    }));
    writePluginsLock({ ...readPluginsLock(), acme: { repo: 'https://example.com/r', subdir: '', pinnedSha: 'x'.repeat(40), version: '1', enabled: true } });
    // A key saved in the plugin before the broker was turned on: it must never reach a spawn.
    writePluginConfig('acme', modelSecretsSchema('acme'), { acmeKey: 'sk-plugin-saved-should-not-leak' });

    const { config, errors } = readBrokerConfig({
      WORCA_BROKER_MODE: 'multi', WORCA_BROKER_SECRET: SECRET, WORCA_BROKER_HOST: '127.0.0.1', WORCA_BROKER_PORT: '0', WORCA_BROKER_UI_PORT: '0',
      WORCA_BROKER_VAULT_KEY: VK, WORCA_BROKER_PUBLIC_URL: 'https://keys.example.com', WORCA_IDENTITY_HEADER: 'x-email', WORCA_IDENTITY_TRUSTED_PROXIES: '127.0.0.1',
    });
    assert.deepEqual(errors, []);
    broker = await startBroker({ config: { ...config, uiPort: 0 }, slots: builtinSlots(), log: () => {} });

    dir = await mkdtemp(join(tmpdir(), 'worca-pslots-stub-'));
    stub = join(dir, 'claude-stub.mjs');
    // Calls ANTHROPIC_BASE_URL like the CLI, and reports any plugin key it can see.
    await writeFile(stub, `#!/usr/bin/env node
const out = (o) => process.stdout.write(JSON.stringify(o) + '\\n');
out({ type: 'system', subtype: 'init', session_id: 's1' });
const leaked = Object.values(process.env).some((v) => String(v).includes('sk-plugin-saved'));
const r = await fetch(process.env.ANTHROPIC_BASE_URL + '/v1/messages', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + process.env.ANTHROPIC_AUTH_TOKEN }, body: JSON.stringify({ model: 'acme-1', max_tokens: 5, messages: [] }) });
const body = await r.text();
if (!r.ok) { out({ type: 'result', is_error: true, result: 'API Error: ' + r.status + ' ' + body }); process.exit(1); }
out({ type: 'result', result: JSON.stringify({ base: process.env.ANTHROPIC_BASE_URL, leaked }), total_cost_usd: 0 });
`, 'utf8');
    await chmod(stub, 0o755);
  });
  after(async () => {
    await broker?.close(); await gw?.close();
    _resetForTests();
    for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
    resetBrokerClient(); resetPluginSlotSync();
    for (const d of [dir, homeDir, worcaHome]) if (d) await rm(d, { recursive: true, force: true });
  });
  beforeEach(() => {
    delete process.env.WORCA_MOCK; delete process.env.ORCH_MOCK;
    process.env.WORCA_HOST_GUARD = '0';
    process.env.WORCA_BROKER_SECRET = SECRET;
    process.env.WORCA_BROKER_URL = `http://127.0.0.1:${broker.ports.private}`;
    resetBrokerClient(); resetPluginSlotSync();
  });
  afterEach(() => { delete process.env.WORCA_BROKER_URL; resetBrokerClient(); resetPluginSlotSync(); });

  test('spawn: worca registers the plugin slot, the spawn spends the person\'s own key, the plugin secret never travels', POSIX, async () => {
    const d = await syncPluginSlots();
    assert.deepEqual(d.slots.map((s) => s.id), ['p-acme-acmekey']);
    assert.ok(broker.service.slotById.has('p-acme-acmekey'));
    assert.deepEqual(modelSlot('acme-1'), { slot: 'p-acme-acmekey' });
    assert.deepEqual(pluginModelRoute('acme-1'), { slot: 'p-acme-acmekey', prefix: '/gw' });

    const modelEnv = resolveModelEnv('acme-1');
    assert.ok(!JSON.stringify(modelEnv).includes('sk-plugin-saved'), 'the plugin secret is not resolved with the broker on');

    // Bob has no key: refused with the slot's name.
    const err = await withBillTo('bob@acme.dev', () => runClaude({ bin: stub, prompt: 'hi', model: 'acme-1', modelEnv })).catch((e) => e);
    assert.match(err.message, /worca-broker: no Acme key \(acme\) for bob@acme\.dev/);

    // Alice adds hers on the key page; her spawn goes out with it, to the plugin's path.
    assert.equal((await broker.service.saveCredential('alice@acme.dev', 'p-acme-acmekey', KEY)).ok, true);
    gw.requests.length = 0;
    const r = await withBillTo('alice@acme.dev', () => runClaude({ bin: stub, prompt: 'hi', model: 'acme-1', modelEnv }));
    const seen = JSON.parse(r.text);
    assert.equal(seen.base, `${process.env.WORCA_BROKER_URL}/p/p-acme-acmekey/gw`);
    assert.equal(seen.leaked, false);
    const sent = gw.requests.find((q) => q.method === 'POST');
    assert.equal(sent.url, '/gw/v1/messages');
    assert.equal(sent.headers.authorization, `Bearer ${KEY}`);
    const usage = broker.store.db.prepare("SELECT bill_to, slot FROM usage WHERE slot = 'p-acme-acmekey' ORDER BY id DESC LIMIT 1").get();
    assert.deepEqual({ ...usage }, { bill_to: 'alice@acme.dev', slot: 'p-acme-acmekey' });
  });
});
