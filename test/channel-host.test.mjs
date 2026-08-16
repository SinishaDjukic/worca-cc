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
  // oversize state VALUE: encodeFrame throws inside the child, so the delta never
  // reaches the pipe -- the child must say so instead of dropping it silently.
  "      if (chatId === 'BIGSTATE') { await ctx.state.set('big', 'x'.repeat(2 * 1024 * 1024)); return { ok: true }; }",
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

// Shared fake-proc harness — T2 and T4 reuse it; define ONCE at the top of the
// new test section. The host wraps proc.stdout in readline (createInterface at
// channel-host.mjs:236), so stdout/stderr MUST be real streams (PassThrough) —
// a bare EventEmitter throws `input.resume is not a function`. kill() must emit
// 'exit', or host.stop() waits the full 5 s SHUTDOWN_GRACE_MS per worker.
import { PassThrough } from 'node:stream';
import { EventEmitter } from 'node:events';

function makeFakeProc({ backpressure = false, spawnFailed = false } = {}) {
  const p = new EventEmitter();
  p.pid = spawnFailed ? undefined : 12345;
  p.killed = false;
  p.exitCode = null;
  p.stdout = new PassThrough();
  p.stderr = new PassThrough();
  p.stdin = Object.assign(new EventEmitter(), {
    written: [],
    write(chunk) { this.written.push(String(chunk)); return !backpressure; },
  });
  p.kill = (sig) => {
    if (p.killed) return true;
    p.killed = true;
    p.exitCode = 0;
    queueMicrotask(() => p.emit('exit', 0, sig || 'SIGKILL'));
    return true;
  };
  return p;
}

/** Fake-spawn host over the discovery fixture (installFixture() registers
 *  fixture-chat/main). Returns {host, spawned, logs}. */
function makeFakeHost({ backoffMs = [10, 10, 10, 10], healthyAfterMs, procOpts } = {}) {
  installFixture();
  const spawned = [];
  const logs = [];
  const host = createChannelHost({
    logger: (level, msg) => logs.push({ level, msg }),
    _backoffMs: backoffMs,
    ...(healthyAfterMs ? { _healthyAfterMs: healthyAfterMs } : {}),
    _spawn: () => { const p = makeFakeProc(procOpts); spawned.push(p); return p; },
  });
  return { host, spawned, logs };
}
const endWorkers = (spawned) => { for (const p of spawned) if (!p.killed && p.exitCode === null) p.emit('exit', 0, null); };
const MSG = { title: null, body: [], severity: 'info' }; // minimal valid NormalizedMessage (T4 reuses it)

// Worker frames go in via p.stdout.write(line) — the host wraps it in readline.
const frameLine = (obj) => JSON.stringify(obj) + '\n';

test('ready after a worker "disconnected" status keeps the channel disconnected', async () => {
  const { host, spawned } = makeFakeHost();
  host.start();
  const p = spawned[0];
  p.stdout.write(frameLine({ type: 'status', state: 'disconnected', detail: 'auth failed — check botToken' }));
  p.stdout.write(frameLine({ type: 'ready', identity: null }));
  await new Promise((r) => setTimeout(r, 20));
  const row = host.status()[0];
  assert.equal(row.state, 'disconnected');
  assert.match(row.detail, /auth failed/);
  endWorkers(spawned);
  await host.stop();
});

test('ready alone still flips a fresh worker to connected', async () => {
  const { host, spawned } = makeFakeHost();
  host.start();
  spawned[0].stdout.write(frameLine({ type: 'ready', identity: '@bot' }));
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(host.status()[0].state, 'connected');
  endWorkers(spawned);
  await host.stop();
});

test('a connect-then-crash worker escalates backoff instead of looping at the floor', async () => {
  // Assert on the logged restart delays — deterministic; timestamp spreads are flaky.
  const { host, spawned, logs } = makeFakeHost({ backoffMs: [10, 40, 40, 40] });
  host.start();
  for (let i = 0; i < 3; i++) {
    const p = spawned[i];
    p.stdout.write(frameLine({ type: 'ready', identity: '@bot' }));
    await new Promise((r) => setTimeout(r, 5));
    p.emit('exit', 1, null);
    await new Promise((r) => setTimeout(r, 60)); // let the restart timer fire
  }
  const delays = logs.map((l) => /restart in (\d+)ms/.exec(l.msg)).filter(Boolean).map((m) => Number(m[1]));
  assert.deepEqual(delays.slice(0, 3), [10, 40, 40], 'ready must not reset the failure counter');
  endWorkers(spawned);
  await host.stop();
});

test('a masked ready must not buy HEALTHY_AFTER_MS forgiveness', async () => {
  // status:disconnected → ready (masked) → outlive _healthyAfterMs → crash twice:
  // the second restart must escalate (forgiveness would keep it at the floor).
  const { host, spawned, logs } = makeFakeHost({ backoffMs: [10, 40, 40, 40], healthyAfterMs: 15 });
  host.start();
  for (let i = 0; i < 2; i++) {
    const p = spawned[i];
    p.stdout.write(frameLine({ type: 'status', state: 'disconnected', detail: 'auth failed' }));
    p.stdout.write(frameLine({ type: 'ready', identity: null }));
    await new Promise((r) => setTimeout(r, 30)); // > healthyAfterMs while "masked"
    p.emit('exit', 1, null);
    await new Promise((r) => setTimeout(r, 60));
  }
  const delays = logs.map((l) => /restart in (\d+)ms/.exec(l.msg)).filter(Boolean).map((m) => Number(m[1]));
  assert.deepEqual(delays.slice(0, 2), [10, 40], 'masked ready stamped healthySince — finding #5 is back');
  endWorkers(spawned);
  await host.stop();
});

test('a spawn "error" event never throws out of the host and schedules recovery', async () => {
  const { host, spawned } = makeFakeHost({ procOpts: { spawnFailed: true } });
  host.start();
  assert.equal(spawned.length, 1);
  spawned[0].emit('error', Object.assign(new Error('spawn EMFILE'), { code: 'EMFILE' }));
  // Read the badge SYNCHRONOUSLY: the 10ms-backoff respawn calls
  // setStatus('connecting', null), which wipes the detail again.
  assert.match(host.status()[0].detail || '', /EMFILE/, 'spawn error text reaches the badge detail');
  await new Promise((r) => setTimeout(r, 50)); // > 10ms backoff → respawn happened
  assert.ok(spawned.length >= 2, 'error event routed into the restart path');
  assert.notEqual(host.status()[0].state, 'connected');
  endWorkers(spawned);
  await host.stop();
});

test('a timed-out RPC frame is dequeued — a later drain cannot deliver it', async () => {
  const { host, spawned } = makeFakeHost({ procOpts: { backpressure: true } });
  host.start();
  const p = spawned[0];
  p.stdout.write(frameLine({ type: 'ready', identity: '@bot' }));
  await new Promise((r) => setTimeout(r, 20));
  const before = p.stdin.written.length; // hello (+ possibly a ping) already queued/written
  await assert.rejects(
    () => host.sendMessage({ plugin: NAME, channelId: 'main', chatId: 'A', message: MSG, timeoutMs: 30 }),
    (e) => e.kind === 'timeout');
  const second = host.sendMessage({ plugin: NAME, channelId: 'main', chatId: 'B', message: MSG, timeoutMs: 5000 });
  p.stdin.write = function (chunk) { this.written.push(String(chunk)); return true; }; // lift backpressure
  p.stdin.emit('drain');
  await new Promise((r) => setTimeout(r, 20));
  const flushed = p.stdin.written.slice(before).join('');
  assert.ok(!flushed.includes('"chatId":"A"'), 'timed-out frame must not be delivered later');
  assert.ok(flushed.includes('"chatId":"B"'), 'live frames still flush');
  // Answer the B frame by finding it explicitly — do NOT take the last flushed
  // line: a ping frame flushed after B would strand the awaited RPC.
  const bFrame = flushed.trim().split('\n').map((l) => JSON.parse(l)).find((f) => f.chatId === 'B');
  p.stdout.write(frameLine({ type: 'send-result', id: bFrame.id, ok: true }));
  await second;
  endWorkers(spawned);
  await host.stop();
});

test('an oversize state-delta warns instead of vanishing', async () => {
  installFixture();
  const { host, seen } = collectingHost();
  host.start();
  after(() => host.stop());
  await waitFor(() => host.status()[0]?.state === 'connected', { label: 'worker connected' });

  await host.sendMessage({ plugin: NAME, channelId: 'main', chatId: 'BIGSTATE', message: MSG });
  await waitFor(
    () => seen.logs.some((l) => l.level === 'warn' && /exceeds the 1 MiB frame cap/.test(l.msg)),
    { label: 'oversize state-delta warning' },
  );
  assert.equal(readPluginState(NAME).big, undefined, 'the oversize delta must stay unpersisted');
  await host.stop();
});

// Two channels on the SAME plugin: writePluginsLock OVERWRITES, so a second
// plugin would evict the first. Both channels share SCHEMA, so installFixture's
// single config write leaves neither row `unconfigured`.
function installFixtureTwoChannels() {
  installFixture();
  const cur = pluginCurrentDir(NAME);
  writeFileSync(join(cur, 'worca-cc-plugin.json'), JSON.stringify({
    name: NAME,
    engines: { 'worca-cc-api': '>=2 <3' },
    chatChannels: [
      { id: 'main', displayName: 'Fixture', platform: 'testchat', module: './channel/worker.mjs', configSchema: SCHEMA },
      { id: 'alt', displayName: 'Fixture alt', platform: 'testchat', module: './channel/worker.mjs', configSchema: SCHEMA },
    ],
  }));
}

test('start({plugin, channelId}) spawns only the requested channel', async () => {
  installFixtureTwoChannels();
  process.env.WORCA_MOCK = '1';
  try {
    assert.equal(discoverChannels().length, 2, 'fixture must offer two channels');
    const host = createChannelHost({ logger: () => {} });
    host.start({ plugin: NAME, channelId: 'main' });
    const rows = host.status();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].channelId, 'main');
    await host.stop();
  } finally {
    delete process.env.WORCA_MOCK;
  }
});

test('start() with no filter still starts every channel', async () => {
  installFixtureTwoChannels();
  process.env.WORCA_MOCK = '1';
  try {
    const host = createChannelHost({ logger: () => {} });
    host.start();
    assert.deepEqual(host.status().map((r) => r.channelId).sort(), ['alt', 'main']);
    await host.stop();
  } finally {
    delete process.env.WORCA_MOCK;
  }
});
