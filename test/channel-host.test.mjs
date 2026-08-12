// test/channel-host.test.mjs — persistent channel-worker supervisor
// (chat-connectivity-design.md §4.4). Real-spawn tests install a fixture chat
// plugin under the temp WORCA_HOME and exercise the whole path: discovery ->
// hello via stdin -> ready/status -> send RPC -> state-delta persistence ->
// inbound fan-in -> crash/backoff restart -> shutdown. Mock-mode hooks mirror
// setMockSourceResponses.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { writePluginsLock, pluginCurrentDir } from '../src/core/plugins-lock.mjs';
import { writePluginConfig, readPluginState } from '../src/core/plugin-config.mjs';
import { PluginOpError } from '../src/core/plugin-shim.mjs';
import {
  createChannelHost, discoverChannels,
  setMockChannelBehavior, mockSentMessages, clearMockSentMessages,
} from '../src/core/chat/channel-host.mjs';

useTempHome(after);

const NAME = 'fixture-chat';
const SCHEMA = [{ key: 'token', type: 'text', label: 'Token', secret: true, required: true }];

// Fixture worker: every branch of the protocol, driven by magic chatIds.
// Backtick-free so it embeds as a plain string.
const WORKER = [
  'export function createChannelWorker(ctx) {',
  '  return {',
  '    async start() {',
  "      ctx.log('info', 'starting with token ' + ctx.config.token);",
  "      return { identity: 'fixture-bot' };",
  '    },',
  '    async stop() {},',
  '    async send(chatId, message) {',
  "      if (chatId === 'FAIL') { const e = new Error('slow down bot123456:AAHtokentokentokentokentoken'); e.kind = 'rate-limit'; e.retryAfterMs = 250; throw e; }",
  "      if (chatId === 'CRASH') { process.exit(3); }",
  "      if (chatId === 'STATE') { await ctx.state.set('cursor', 41 + 1); return { ok: true }; }",
  "      if (chatId === 'EMIT') { ctx.emitMessage({ chatId: '77', userId: 'u9', text: '/status', meta: { platform: ctx.platform } }); return { ok: true }; }",
  "      if (chatId === 'DEGRADE') { ctx.setStatus('degraded', 'partial outage'); return { ok: true }; }",
  // raw stdout write bypasses ctx.log's 8KB clamp -> genuine oversize protocol line
  "      if (chatId === 'HUGE') { process.stdout.write(JSON.stringify({ type: 'log', level: 'info', msg: 'x'.repeat(2 * 1024 * 1024) }) + String.fromCharCode(10)); return { ok: true }; }",
  '      return { ok: true };',
  '    },',
  '    async handleWebhook(req) {',
  "      if ((req.headers.authorization || '') === 'Bearer good') return { statusCode: 200, bodyB64: req.bodyB64 };",
  '      return { statusCode: 401 };',
  '    },',
  '  };',
  '}',
  'export async function validateConfig(config) {',
  "  if (config.token === 'sekret') return { ok: true, identity: 'fixture-bot' };",
  "  return { ok: false, errors: [{ field: 'token', message: 'bad token' }] };",
  '}',
].join('\n');

function installFixture({ worker = WORKER, config = { token: 'sekret' } } = {}) {
  const cur = pluginCurrentDir(NAME);
  mkdirSync(join(cur, 'channel'), { recursive: true });
  writeFileSync(join(cur, 'worca-cc-plugin.json'), JSON.stringify({
    name: NAME,
    engines: { 'worca-cc-api': '>=2 <3' },
    chatChannels: [{
      id: 'main', displayName: 'Fixture', platform: 'testchat',
      module: './channel/worker.mjs', configSchema: SCHEMA,
    }],
  }));
  writeFileSync(join(cur, 'channel', 'worker.mjs'), worker);
  writePluginsLock({
    [NAME]: { repoUrl: 'https://example.test/fixture.git', subdir: '', pinnedSha: 'f'.repeat(40), version: null, enabled: true, installedAt: '2026-08-12T00:00:00.000Z' },
  });
  if (config) writePluginConfig(NAME, SCHEMA, config);
}

async function waitFor(fn, { timeoutMs = 8000, stepMs = 25, label = 'condition' } = {}) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const v = await fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, stepMs));
  }
  throw new Error(`timed out waiting for ${label}`);
}

function collectingHost() {
  const seen = { inbound: [], status: [], logs: [] };
  const host = createChannelHost({
    logger: (level, msg) => seen.logs.push({ level, msg }),
    onInbound: (ev) => seen.inbound.push(ev),
    onStatus: (ev) => seen.status.push(ev),
  });
  return { host, seen };
}

test('discoverChannels: enabled + configured -> spawnable entry; missing config flagged', () => {
  installFixture();
  const [entry] = discoverChannels();
  assert.equal(entry.plugin, NAME);
  assert.equal(entry.channelId, 'main');
  assert.equal(entry.platform, 'testchat');
  assert.equal(entry.apiVersion, 2, 'negotiated from >=2 <3');
  assert.deepEqual(entry.missingConfig, []);
  writePluginConfig(NAME, SCHEMA, { token: null }); // clear the secret
  assert.deepEqual(discoverChannels()[0].missingConfig, ['token']);
  writePluginConfig(NAME, SCHEMA, { token: 'sekret' });
});

test('full worker lifecycle: hello -> ready -> send RPC -> errors -> state -> inbound -> webhook -> stop', async () => {
  installFixture();
  const { host, seen } = collectingHost();
  host.start();
  after(() => host.stop());

  await waitFor(() => host.status()[0]?.state === 'connected', { label: 'worker connected' });
  const row = host.status()[0];
  assert.equal(row.identity, 'fixture-bot');
  assert.equal(row.platform, 'testchat');

  // secrets in worker logs are redacted before reaching the host logger
  const startLog = await waitFor(() => seen.logs.find((l) => /starting with token/.test(l.msg)), { label: 'start log' });
  assert.doesNotMatch(startLog.msg, /sekret/);

  const ok = await host.sendMessage({
    plugin: NAME, channelId: 'main', chatId: '42',
    message: { title: 'hi', body: [{ kind: 'text', value: 'x' }], severity: 'info' },
  });
  assert.equal(ok.ok, true);

  // worker-thrown kinds surface as PluginOpError with retryAfterMs, redacted
  await assert.rejects(
    host.sendMessage({ plugin: NAME, channelId: 'main', chatId: 'FAIL', message: { title: null, body: [], severity: 'info' } }),
    (err) => {
      assert.ok(err instanceof PluginOpError);
      assert.equal(err.kind, 'rate-limit');
      assert.equal(err.retryAfterMs, 250);
      assert.doesNotMatch(err.message, /AAHtokentoken/);
      return true;
    },
  );

  // state-delta persisted host-side via writePluginState
  await host.sendMessage({ plugin: NAME, channelId: 'main', chatId: 'STATE', message: { title: null, body: [], severity: 'info' } });
  await waitFor(() => readPluginState(NAME).cursor === 42, { label: 'state persisted' });

  // inbound frames reach onInbound with plugin/channel tags
  await host.sendMessage({ plugin: NAME, channelId: 'main', chatId: 'EMIT', message: { title: null, body: [], severity: 'info' } });
  const inbound = await waitFor(() => seen.inbound[0], { label: 'inbound message' });
  assert.equal(inbound.plugin, NAME);
  assert.equal(inbound.channelId, 'main');
  assert.deepEqual(inbound.msg, { chatId: '77', userId: 'u9', text: '/status', meta: { platform: 'testchat' } });

  // status frames fan out on transitions
  await host.sendMessage({ plugin: NAME, channelId: 'main', chatId: 'DEGRADE', message: { title: null, body: [], severity: 'info' } });
  await waitFor(() => host.status()[0].state === 'degraded', { label: 'degraded status' });
  assert.ok(seen.status.some((s) => s.state === 'degraded' && s.detail === 'partial outage'));

  // webhook RPC round-trip (Teams path)
  const res = await host.handleWebhook({
    plugin: NAME, channelId: 'main', method: 'POST', path: '/api/ingress/teams',
    headers: { authorization: 'Bearer good' }, bodyB64: Buffer.from('{"a":1}').toString('base64'),
  });
  assert.equal(res.statusCode, 200);
  assert.equal(Buffer.from(res.bodyB64, 'base64').toString(), '{"a":1}');
  const bad = await host.handleWebhook({
    plugin: NAME, channelId: 'main', method: 'POST', path: '/x', headers: {}, bodyB64: '',
  });
  assert.equal(bad.statusCode, 401);

  // deliveries ring records outcomes
  const withDeliveries = host.status()[0];
  assert.ok(withDeliveries.deliveries.some((d) => d.ok === false && d.errorKind === 'rate-limit'));

  await host.stop();
  assert.equal(host.status().length, 0);
});

test('crash -> backoff restart; oversize frame -> protocol violation restart', async () => {
  installFixture();
  const { host, seen } = collectingHost();
  host.start();
  after(() => host.stop());
  await waitFor(() => host.status()[0]?.state === 'connected', { label: 'initial connect' });

  // worker process.exit(3) mid-send: RPC rejects, then backoff (1s) respawns
  await assert.rejects(
    host.sendMessage({ plugin: NAME, channelId: 'main', chatId: 'CRASH', message: { title: null, body: [], severity: 'info' }, timeoutMs: 5000 }),
    (err) => err instanceof PluginOpError,
  );
  await waitFor(() => host.status()[0]?.state === 'disconnected' || host.status()[0]?.state === 'connecting', { label: 'crash noticed' });
  await waitFor(() => host.status()[0]?.state === 'connected', { label: 'restart after backoff' });
  assert.ok(seen.logs.some((l) => /restart in \d+ms/.test(l.msg)));

  // oversize worker frame: killed + restarted, violation logged
  await host.sendMessage({ plugin: NAME, channelId: 'main', chatId: 'HUGE', message: { title: null, body: [], severity: 'info' } }).catch(() => {});
  await waitFor(() => seen.logs.some((l) => /oversize frame/.test(l.msg)), { label: 'oversize log' });
  await waitFor(() => host.status()[0]?.state === 'connected', { label: 'restart after violation' });
  await host.stop();
});

test('unconfigured channel: not spawned, sendMessage fails closed', async () => {
  installFixture({ config: null });
  writePluginConfig(NAME, SCHEMA, { token: null });
  const { host } = collectingHost();
  host.start();
  after(() => host.stop());
  const row = host.status()[0];
  assert.equal(row.state, 'unconfigured');
  assert.match(row.detail, /missing config: token/);
  await assert.rejects(
    host.sendMessage({ plugin: NAME, channelId: 'main', chatId: '1', message: { title: null, body: [], severity: 'info' } }),
    /unconfigured/,
  );
  await host.stop();
  writePluginConfig(NAME, SCHEMA, { token: 'sekret' });
});

test('reloadPlugin restarts workers against fresh config', async () => {
  installFixture();
  const { host } = collectingHost();
  host.start();
  after(() => host.stop());
  await waitFor(() => host.status()[0]?.state === 'connected', { label: 'connect' });
  await host.reloadPlugin(NAME);
  await waitFor(() => host.status()[0]?.state === 'connected', { label: 'reconnect after reload' });
  assert.equal(host.status().length, 1, 'no duplicate workers after reload');
  await host.stop();
});

test('checkChannel: one-shot --check runs the module validateConfig offline', async () => {
  installFixture();
  const { host } = collectingHost();
  const good = await host.checkChannel(NAME, 'main');
  assert.deepEqual(good, { ok: true, identity: 'fixture-bot' });
  writePluginConfig(NAME, SCHEMA, { token: 'wrong' });
  const bad = await host.checkChannel(NAME, 'main');
  assert.equal(bad.ok, false);
  assert.equal(bad.errors[0].field, 'token');
  writePluginConfig(NAME, SCHEMA, { token: 'sekret' });
});

test('WORCA_MOCK=1: no spawn, instant connected, hooks drive both directions', async () => {
  installFixture();
  process.env.WORCA_MOCK = '1';
  try {
    clearMockSentMessages();
    const { host, seen } = collectingHost();
    host.start();
    const row = host.status()[0];
    assert.equal(row.state, 'connected');
    assert.equal(row.identity, 'mock');

    const r = await host.sendMessage({
      plugin: NAME, channelId: 'main', chatId: 'MOCK-CHAT',
      message: { title: 't', body: [{ kind: 'text', value: 'b' }], severity: 'info' },
    });
    assert.equal(r.ok, true);
    assert.equal(mockSentMessages().length, 1);
    assert.equal(mockSentMessages()[0].chatId, 'MOCK-CHAT');

    setMockChannelBehavior({
      '*': { send: () => { throw Object.assign(new Error('quota'), { kind: 'rate-limit' }); } },
    });
    await assert.rejects(
      host.sendMessage({ plugin: NAME, channelId: 'main', chatId: 'MOCK-FAIL', message: { title: null, body: [], severity: 'info' } }),
      /quota/,
    );
    setMockChannelBehavior(null);

    host.injectInboundMessage(NAME, 'main', { chatId: '5', userId: 'u', text: '/status', meta: {} });
    assert.equal(seen.inbound.length, 1);
    assert.equal(seen.inbound[0].msg.text, '/status');

    const wh = await host.handleWebhook({ plugin: NAME, channelId: 'main', method: 'POST', path: '/x', headers: {}, bodyB64: '' });
    assert.equal(wh.statusCode, 200);
    await host.stop();
  } finally {
    delete process.env.WORCA_MOCK;
    clearMockSentMessages();
    setMockChannelBehavior(null);
  }
});
