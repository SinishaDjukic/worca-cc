// test/channel-host.test.mjs — persistent channel-worker supervisor
// (chat-connectivity-design.md §4.4). Real-spawn tests install a fixture chat
// plugin under the temp WORCA_HOME and exercise the whole path: discovery ->
// hello via stdin -> ready/status -> send RPC -> state-delta persistence ->
// inbound fan-in -> crash/backoff restart -> shutdown. Mock-mode hooks mirror
// setMockSourceResponses.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { writePluginsLock, pluginCurrentDir } from '../src/core/plugins-lock.mjs';
import { writePluginConfig, readPluginState } from '../src/core/plugin-config.mjs';
import { PluginOpError, _resetWithheldProxyNotice } from '../src/core/plugin-shim.mjs';
import { checkRows } from './helpers/rows.mjs';
import { startProxyNet, setProxyEnv, assertProxyRouting, NO_PROXY_HOST } from './helpers/proxy-net.mjs';
import { importClosure } from './helpers/import-closure.mjs';
import {
  createChannelHost, discoverChannels,
  setMockChannelBehavior, mockSentMessages, clearMockSentMessages,
} from '../src/core/chat/channel-host.mjs';

useTempHome(after);
// The developer's own proxy variables never reach these real children (the proxy
// tests set their own) or spend the once-per-process withheld-proxy warning early.
after(setProxyEnv({}));

// The fake child processes below (makeFakeProc) are plain EventEmitters over
// in-memory PassThroughs: unlike a real spawned child, they hold no libuv
// handle. channel-host's rpc() unrefs its timeout timer — correct in
// production, where an in-flight RPC must not keep the process alive — so with
// nothing else ref'd the loop drains before the timer can fire, and any test
// awaiting an RPC timeout is cancelled with "Promise resolution is still
// pending but the event loop has already resolved". Hold one ref'd handle for
// the lifetime of the file to model what a real child would keep open.
const keepLoopAlive = setInterval(() => {}, 60_000);
after(() => clearInterval(keepLoopAlive));

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
  "      if (chatId === 'REFUSED') { const e = new Error('channel or message not found'); e.kind = 'plugin'; e.permanent = true; throw e; }",
  "      if (chatId === 'PLUGINERR') { const e = new Error('send failed'); e.kind = 'plugin'; throw e; }",
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

test('the worker child loads no worca module but channel-protocol and env-proxy (its scrubbed env has no WORCA_HOME)', () => {
  assert.deepEqual(importClosure('src/core/chat/channel-worker-child.mjs'), {
    modules: ['src/core/chat/channel-protocol.mjs', 'src/core/env-proxy.mjs'],
    bare: ['node:module', 'node:readline', 'node:url'],
  });
});

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

  // a platform refusal the worker marks permanent reaches the caller as permanent; an unmarked plugin error does not
  // (a 5xx or a worker bug must be retried, never dropped), and a network error never is.
  const asks = (chatId) => host.sendMessage({ plugin: NAME, channelId: 'main', chatId, message: { title: null, body: [], severity: 'info' } });
  await assert.rejects(asks('REFUSED'), (err) => err.kind === 'plugin' && err.permanent === true);
  await assert.rejects(asks('PLUGINERR'), (err) => err.kind === 'plugin' && err.permanent !== true);
  await assert.rejects(asks('FAIL'), (err) => err.kind === 'rate-limit' && err.permanent !== true);

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

  // an oversize state-delta warns instead of vanishing (and stays unpersisted)
  await host.sendMessage({ plugin: NAME, channelId: 'main', chatId: 'BIGSTATE', message: MSG });
  await waitFor(
    () => seen.logs.some((l) => l.level === 'warn' && /exceeds the 1 MiB frame cap/.test(l.msg)),
    { label: 'oversize state-delta warning' },
  );
  assert.equal(readPluginState(NAME).big, undefined, 'the oversize delta must stay unpersisted');

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
  assert.deepEqual(row.missingConfig, ['token'], 'CONTRACT §1.6: the keys, not only the sentence');
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
  assert.deepEqual(host.status()[0].missingConfig, []);
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

// Proxy fixture: fetches the URLs its token lists (JSON), in order, and reports
// each outcome. A send stores them in the state; --check returns them.
const PROXY_WORKER = [
  'async function probe(token) {',
  '  const out = [];',
  '  for (const url of JSON.parse(token)) {',
  '    try { const res = await fetch(url); out.push({ url, status: res.status, body: await res.text() }); }',
  '    catch (err) { out.push({ url, error: String((err.cause && err.cause.code) || err.message) }); }',
  '  }',
  '  return out;',
  '}',
  'export function createChannelWorker(ctx) {',
  '  return {',
  "    async start() { return { identity: 'proxy-bot' }; },",
  '    async stop() {},',
  "    async send() { await ctx.state.set('probe', await probe(ctx.config.token)); return { ok: true }; },",
  '  };',
  '}',
  'export async function validateConfig(config) { return { ok: true, probe: await probe(config.token) }; }',
].join('\n');

test('real worker and --check child: with the proxy variables set, fetch() goes through the proxy; loopback and NO_PROXY go direct', async () => {
  const net = await startProxyNet();
  // HTTP_PROXY too: a loopback http fetch would reach the proxy if the child did not bypass it.
  const restore = setProxyEnv({ https_proxy: net.proxyUrl, HTTP_PROXY: net.proxyUrl, NO_PROXY: NO_PROXY_HOST });
  installFixture({ worker: PROXY_WORKER, config: { token: JSON.stringify(net.targets) } });
  const { host, seen } = collectingHost();
  try {
    await checkRows([
      { name: 'a send from the persistent worker', run: async () => {
        host.start();
        await waitFor(() => host.status()[0]?.state === 'connected', { label: 'worker connected' });
        await host.sendMessage({ plugin: NAME, channelId: 'main', chatId: 'PROBE', message: MSG });
        assertProxyRouting(net, readPluginState(NAME).probe);
        const proxyLogs = seen.logs.filter((l) => /outbound requests|proxy:/.test(l.msg));
        assert.deepEqual(proxyLogs, [], 'an applied proxy is no news: the worker logs warnings only');
      } },
      { name: 'validateConfig in the --check child', run: async () => {
        net.seen.length = 0;
        assertProxyRouting(net, (await host.checkChannel(NAME, 'main')).probe);
      } },
    ]);
  } finally {
    await host.stop();
    restore();
    await net.close();
    writePluginConfig(NAME, SCHEMA, { token: 'sekret' });
  }
});

test('a proxy the worker cannot apply is a warn line in the channel log; --check keeps its stdout to the result line', async () => {
  const restore = setProxyEnv({ HTTPS_PROXY: 'http://[not-a-host' });
  const { host, seen } = collectingHost();
  try {
    await checkRows([
      { name: 'the persistent worker logs it instead of a bare "fetch failed"', run: async () => {
        installFixture();
        host.start();
        const line = await waitFor(() => seen.logs.find((l) => /proxy:/.test(l.msg)), { label: 'proxy warning' });
        assert.equal(line.level, 'warn');
        assert.match(line.msg, /^\[chat:fixture-chat\/main\] proxy: .*not a valid proxy URL; outbound requests go direct$/);
        await host.stop();
      } },
      { name: '--check writes no warning line: a child that dies before its result still reads as no result', run: async () => {
        installFixture({ worker: "throw new Error('broken at import');" });
        await assert.rejects(host.checkChannel(NAME, 'main'), (err) => err instanceof PluginOpError && /no result frame/.test(err.message));
      } },
    ]);
  } finally {
    await host.stop();
    restore();
  }
});

test('a proxy URL with credentials never reaches a worker or the --check child: they go direct, and worca says why on stderr', async (t) => {
  const net = await startProxyNet();
  const restore = setProxyEnv({ HTTPS_PROXY: net.proxyUrl.replace('://', '://user:s3cret@'), NO_PROXY: NO_PROXY_HOST });
  installFixture({ worker: PROXY_WORKER, config: { token: JSON.stringify(net.targets.slice(0, 1)) } });
  // The CLI's --check host logs nowhere, so the warning goes to the process's stderr, never a logger.
  const stderr = t.mock.method(console, 'error', () => {});
  const assertWarnedOnce = () => {
    const warned = stderr.mock.calls.map((c) => String(c.arguments[0]));
    assert.equal(warned.length, 1, JSON.stringify(warned));
    assert.match(warned[0], /^worca: proxy: HTTP\(S\)_PROXY carries credentials.*go direct$/);
    assert.doesNotMatch(warned[0], /s3cret/);
  };
  const host = createChannelHost({ logger: () => {} });
  try {
    await checkRows([
      { name: 'the persistent worker', run: async () => {
        _resetWithheldProxyNotice();
        stderr.mock.resetCalls();
        host.start();
        await waitFor(() => host.status()[0]?.state === 'connected', { label: 'worker connected' });
        await host.sendMessage({ plugin: NAME, channelId: 'main', chatId: 'PROBE', message: MSG });
        assert.ok(readPluginState(NAME).probe[0].error, 'the outside host was fetched directly, and failed in DNS');
        assert.deepEqual(net.seen, [], 'nothing reached the proxy');
        assertWarnedOnce();
      } },
      { name: 'the --check child', run: async () => {
        _resetWithheldProxyNotice();
        stderr.mock.resetCalls();
        assert.ok((await host.checkChannel(NAME, 'main')).probe[0].error, 'the outside host was fetched directly, and failed in DNS');
        assert.deepEqual(net.seen, [], 'nothing reached the proxy');
        assertWarnedOnce();
      } },
    ]);
  } finally {
    await host.stop();
    restore();
    await net.close();
    writePluginConfig(NAME, SCHEMA, { token: 'sekret' });
  }
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

test('ready frame: flips a fresh worker to connected, but not one that reported "disconnected"', async () => {
  await checkRows([
    { name: 'ready after a worker "disconnected" status keeps the channel disconnected', run: async () => {
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
    } },
    { name: 'ready alone still flips a fresh worker to connected', run: async () => {
      const { host, spawned } = makeFakeHost();
      host.start();
      spawned[0].stdout.write(frameLine({ type: 'ready', identity: '@bot' }));
      await new Promise((r) => setTimeout(r, 20));
      assert.equal(host.status()[0].state, 'connected');
      endWorkers(spawned);
      await host.stop();
    } },
  ]);
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

test('start(): a {plugin, channelId} filter spawns only that channel; no filter starts every channel', async () => {
  await checkRows([
    { name: 'start({plugin, channelId}) spawns only the requested channel', run: async () => {
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
    } },
    { name: 'start() with no filter still starts every channel', run: async () => {
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
    } },
  ]);
});

// G12: on a container with a plugin user, chat workers and the --check child run as that user
// (sudo -u worca-plugin, its own HOME, own process group), never as worca.
test('workers and --check spawn as the container plugin user when there is one', async () => {
  installFixture();
  const calls = [];
  const saved = { ...process.env };
  Object.assign(process.env, { WORCA_PLUGIN_USER: 'worca-plugin', WORCA_PLUGIN_HOME: '/data/plugin-home', WORCA_AGENT_GID: '1001' });
  try {
    const host = createChannelHost({
      logger: () => {}, _backoffMs: [10_000],
      _spawn: (file, args, opts) => { calls.push({ file, args, opts }); return makeFakeProc(); },
    });
    host.start();
    const check = host.checkChannel(NAME, 'main', { timeoutMs: 50 }).catch(() => null);
    await check;
    assert.equal(calls.length, 2, 'one worker, one --check');
    for (const c of calls) {
      assert.equal(c.file, 'sudo');
      assert.deepEqual(c.args.slice(0, 5), ['-n', '-E', '-u', 'worca-plugin', '--']);
      assert.equal(c.opts.env.HOME, '/data/plugin-home');
      assert.ok(!Object.keys(c.opts.env).some((k) => k.startsWith('WORCA_')), 'still scrubbed');
      assert.equal(c.opts.detached, true);
    }
    assert.ok(calls[1].args.includes('--check'));
    calls[0].emit?.('exit', 0, null);
    await host.stop();
  } finally {
    for (const k of ['WORCA_PLUGIN_USER', 'WORCA_PLUGIN_HOME', 'WORCA_AGENT_GID']) {
      if (k in saved) process.env[k] = saved[k]; else delete process.env[k];
    }
  }
});

// Freeform chat (v2 interactive): the real child forwards send options, returns the worker's detail,
// emits interactions and answers interaction-reply; a non-interactive channel never sees options or controls.
const INTERACTIVE_WORKER = [
  'export function createChannelWorker(ctx) {',
  '  const seen = [];',
  '  return {',
  "    async start() { return { identity: 'fixture-bot' }; },",
  '    async stop() {},',
  '    async send(chatId, message, options) {',
  "      if (chatId === 'CLICK') { ctx.emitInteraction({ id: 'i1', chatId: 'T1', userId: 'U1', ref: 'AbCdEfGhIjKlMnOpQrStUvWx', kind: 'select', values: ['a'], meta: { platform: 'testchat' } }); return { ok: true }; }",
  "      return { ok: true, messageIds: ['M1'], echo: { options, controls: message.controls || null } };",
  '    },',
  "    async replyInteraction(id, text) { if (id !== 'i1') { const e = new Error('interaction expired'); e.kind = 'plugin'; throw e; } seen.push(text); return { ok: true }; },",
  "    async react(chatId, messageId, emoji, on) { if (messageId === 'GONE') { const e = new Error('message not found (GONE)'); e.kind = 'plugin'; e.permanent = true; throw e; } if (messageId === 'BUSY') { const e = new Error('slow down'); e.kind = 'rate-limit'; e.retryAfterMs = 700; throw e; } ctx.log('info', 'react ' + JSON.stringify([chatId, messageId, emoji, on])); return { ok: true }; },",
  "    async typing(chatId, on) { if (chatId === 'GONE') { const e = new Error('channel not found (GONE)'); e.kind = 'plugin'; e.permanent = true; throw e; } ctx.log('info', 'typing ' + JSON.stringify([chatId, on])); return { ok: true }; },",
  '  };',
  '}',
].join('\n');

test('interactive channel: options + controls reach the worker, detail comes back, interactions round-trip', async () => {
  installFixture({ worker: INTERACTIVE_WORKER });
  const cur = pluginCurrentDir(NAME);
  const manifest = JSON.parse(readFileSync(join(cur, 'worca-cc-plugin.json'), 'utf8'));
  manifest.chatChannels[0].capabilities = { inbound: true, outbound: true, interactive: true };
  writeFileSync(join(cur, 'worca-cc-plugin.json'), JSON.stringify(manifest));
  const seenI = [];
  const host = createChannelHost({ logger: () => {}, onInteraction: (ev) => seenI.push(ev) });
  host.start();
  after(() => host.stop());
  await waitFor(() => host.status()[0]?.state === 'connected', { label: 'worker connected' });
  const controls = [{ kind: 'button', ref: 'AbCdEfGhIjKlMnOpQrStUvWx', label: 'Start run', style: 'primary' }];
  const r = await host.sendMessage({ plugin: NAME, channelId: 'main', chatId: 'T1',
    message: { title: null, body: [{ kind: 'text', value: 'x' }], severity: 'info', controls }, options: { edit: { messageId: 'M1' } } });
  assert.deepEqual(r, { ok: true, detail: { ok: true, messageIds: ['M1'], echo: { options: { edit: { messageId: 'M1' } }, controls } } });
  await host.sendMessage({ plugin: NAME, channelId: 'main', chatId: 'CLICK', message: { title: null, body: [], severity: 'info' } });
  const ev = await waitFor(() => seenI[0], { label: 'interaction' });
  assert.deepEqual(ev, { plugin: NAME, channelId: 'main', platform: 'testchat',
    evt: { id: 'i1', chatId: 'T1', userId: 'U1', ref: 'AbCdEfGhIjKlMnOpQrStUvWx', kind: 'select', values: ['a'], meta: { platform: 'testchat' } } });
  assert.deepEqual(await host.replyInteraction({ plugin: NAME, channelId: 'main', interactionId: 'i1', text: 'Done' }), { ok: true });
  await assert.rejects(host.replyInteraction({ plugin: NAME, channelId: 'main', interactionId: 'nope', text: 'x' }), /interaction expired/);
  await host.stop();
});

test('non-interactive channel: options refused, executable controls dropped, links become text, interactions ignored', async () => {
  installFixture({ worker: INTERACTIVE_WORKER });
  const seenI = [];
  const host = createChannelHost({ logger: () => {}, onInteraction: (ev) => seenI.push(ev) });
  host.start();
  after(() => host.stop());
  await waitFor(() => host.status()[0]?.state === 'connected', { label: 'worker connected' });
  const message = { title: null, body: [{ kind: 'text', value: 'x' }], severity: 'info', controls: [
    { kind: 'button', ref: 'AbCdEfGhIjKlMnOpQrStUvWx', label: 'Start run', style: 'primary' },
    { kind: 'link', label: 'Open in worca', url: 'https://w.example/#chat/ask_1' }] };
  await assert.rejects(host.sendMessage({ plugin: NAME, channelId: 'main', chatId: 'T1', message, options: { edit: { messageId: 'M1' } } }), /not interactive/);
  const r = await host.sendMessage({ plugin: NAME, channelId: 'main', chatId: 'T1', message });
  assert.equal(r.detail.echo.controls, null, 'no controls cross to a non-interactive worker');
  await host.sendMessage({ plugin: NAME, channelId: 'main', chatId: 'CLICK', message: { title: null, body: [], severity: 'info' } });
  await new Promise((res) => setTimeout(res, 200));
  assert.equal(seenI.length, 0, 'interaction frames from a non-interactive channel are dropped');
  await assert.rejects(host.replyInteraction({ plugin: NAME, channelId: 'main', interactionId: 'i1', text: 'x' }), /not interactive/);
  await host.stop();
});

test('react: reaches an interactive worker; refusals keep permanent / retryAfterMs; a worker without react is unsupported; a plain channel is refused', async () => {
  const interactive = () => {
    const cur = pluginCurrentDir(NAME);
    const manifest = JSON.parse(readFileSync(join(cur, 'worca-cc-plugin.json'), 'utf8'));
    manifest.chatChannels[0].capabilities = { inbound: true, outbound: true, interactive: true };
    writeFileSync(join(cur, 'worca-cc-plugin.json'), JSON.stringify(manifest));
  };
  const target = { plugin: NAME, channelId: 'main', chatId: 'T1', messageId: 'M7', emoji: '⏳', on: true };
  installFixture({ worker: INTERACTIVE_WORKER });
  interactive();
  const logs = [];
  let host = createChannelHost({ logger: (level, msg) => logs.push(msg) });
  host.start();
  after(() => host.stop());
  await waitFor(() => host.status()[0]?.state === 'connected', { label: 'worker connected' });
  assert.deepEqual(await host.react(target), { ok: true });
  await waitFor(() => logs.some((m) => m.includes('react ["T1","M7","⏳",true]')), { label: 'the worker saw the call' });
  await assert.rejects(host.react({ ...target, messageId: 'GONE' }), (e) => e instanceof PluginOpError && e.permanent === true && /not found/.test(e.message));
  await assert.rejects(host.react({ ...target, messageId: 'BUSY' }), (e) => e.kind === 'rate-limit' && e.retryAfterMs === 700 && e.permanent !== true);
  await host.stop();

  installFixture();            // the plain fixture worker has no react()
  interactive();
  host = createChannelHost({ logger: () => {} });
  host.start();
  await waitFor(() => host.status()[0]?.state === 'connected', { label: 'worker connected' });
  await assert.rejects(host.react(target), (e) => e.permanent === true && /cannot add reactions/.test(e.message));
  await host.stop();

  installFixture();            // not interactive
  host = createChannelHost({ logger: () => {} });
  host.start();
  await waitFor(() => host.status()[0]?.state === 'connected', { label: 'worker connected' });
  await assert.rejects(host.react(target), (e) => e.permanent === true && /not interactive/.test(e.message));
  await host.stop();
});

test('typing: reaches an interactive worker; a refusal keeps permanent; a worker without typing is unsupported; a plain channel is refused', async () => {
  const interactive = () => {
    const cur = pluginCurrentDir(NAME);
    const manifest = JSON.parse(readFileSync(join(cur, 'worca-cc-plugin.json'), 'utf8'));
    manifest.chatChannels[0].capabilities = { inbound: true, outbound: true, interactive: true };
    writeFileSync(join(cur, 'worca-cc-plugin.json'), JSON.stringify(manifest));
  };
  const target = { plugin: NAME, channelId: 'main', chatId: 'T1', on: true };
  installFixture({ worker: INTERACTIVE_WORKER });
  interactive();
  const logs = [];
  let host = createChannelHost({ logger: (level, msg) => logs.push(msg) });
  host.start();
  after(() => host.stop());
  await waitFor(() => host.status()[0]?.state === 'connected', { label: 'worker connected' });
  assert.deepEqual(await host.typing(target), { ok: true });
  assert.deepEqual(await host.typing({ ...target, on: false }), { ok: true });
  await waitFor(() => logs.some((m) => m.includes('typing ["T1",true]')) && logs.some((m) => m.includes('typing ["T1",false]')), { label: 'the worker saw both calls' });
  await assert.rejects(host.typing({ ...target, chatId: 'GONE' }), (e) => e instanceof PluginOpError && e.permanent === true && /not found/.test(e.message));
  await host.stop();

  installFixture();            // the plain fixture worker has no typing()
  interactive();
  host = createChannelHost({ logger: () => {} });
  host.start();
  await waitFor(() => host.status()[0]?.state === 'connected', { label: 'worker connected' });
  await assert.rejects(host.typing(target), (e) => e.permanent === true && /cannot show typing/.test(e.message));
  await host.stop();

  installFixture();            // not interactive
  host = createChannelHost({ logger: () => {} });
  host.start();
  await waitFor(() => host.status()[0]?.state === 'connected', { label: 'worker connected' });
  await assert.rejects(host.typing(target), (e) => e.permanent === true && /not interactive/.test(e.message));
  await host.stop();
});

// Chat context (discord-chat 0.4.0): the child copies replyTo/history/attachments, drops a refused or oversize context
// but still delivers the message, and answers the host's history() RPC.
const CONTEXT_WORKER = [
  'export function createChannelWorker(ctx) {',
  "  const q = { author: 'Alice', text: 'quoted', at: '2026-11-03T09:58:00.000Z', link: 'https://discord.com/channels/G1/C1/r1' };",
  "  const file = (u) => ({ name: 'a.md', contentType: null, size: 3, url: 'https://cdn.example.com/' + u });",
  '  return {',
  "    async start() { return { identity: 'fixture-bot' }; },",
  '    async stop() {},',
  '    async send(chatId) {',
  "      if (chatId === 'CTX') ctx.emitMessage({ chatId: 'C1', userId: 'U1', text: 'with context', meta: {}, replyTo: q, history: [q], attachments: [file('a.md')] });",
  "      if (chatId === 'BADCTX') ctx.emitMessage({ chatId: 'C1', userId: 'U1', text: 'bad context', meta: {}, replyTo: { ...q, at: 'yesterday' } });",
  "      if (chatId === 'HUGECTX') ctx.emitMessage({ chatId: 'C1', userId: 'U1', text: 'huge context', meta: {}, history: Array.from({ length: 50 }, () => ({ ...q, text: 'x'.repeat(4000), attachments: Array.from({ length: 10 }, () => file('a'.repeat(2000))) })) });",
  '      return { ok: true };',
  '    },',
  "    async history(chatId, before, limit) { if (chatId === 'NOPE') { const e = new Error('missing access'); e.kind = 'plugin'; e.permanent = true; throw e; } if (chatId === 'JUNK') return [{ author: '' }]; ctx.log('info', 'history ' + JSON.stringify([chatId, before, limit])); return [q, { ...q, text: 'second' }]; },",
  '  };',
  '}',
].join('\n');

test('chat context: replyTo/history/attachments cross the child; a refused or oversize context keeps the message; history() RPC', async () => {
  const interactive = (hosts) => {
    const cur = pluginCurrentDir(NAME);
    const manifest = JSON.parse(readFileSync(join(cur, 'worca-cc-plugin.json'), 'utf8'));
    manifest.chatChannels[0].capabilities = { inbound: true, outbound: true, interactive: true };
    if (hosts) manifest.chatChannels[0].attachmentHosts = hosts;
    writeFileSync(join(cur, 'worca-cc-plugin.json'), JSON.stringify(manifest));
  };
  installFixture({ worker: CONTEXT_WORKER });
  interactive(['cdn.example.com']);
  const inbound = [];
  const logs = [];
  let host = createChannelHost({ logger: (level, msg) => logs.push(msg), onInbound: (ev) => inbound.push(ev.msg) });
  host.start();
  after(() => host.stop());
  await waitFor(() => host.status()[0]?.state === 'connected', { label: 'worker connected' });
  assert.deepEqual(host.list()[0].attachmentHosts, ['cdn.example.com']);
  const send = (chatId) => host.sendMessage({ plugin: NAME, channelId: 'main', chatId, message: { title: null, body: [{ kind: 'text', value: 'x' }], severity: 'info' } });
  await send('CTX');
  await waitFor(() => inbound.length === 1, { label: 'the context message' });
  assert.equal(inbound[0].replyTo.author, 'Alice');
  assert.equal(inbound[0].history.length, 1);
  assert.equal(inbound[0].attachments[0].url, 'https://cdn.example.com/a.md');
  await send('BADCTX');
  await waitFor(() => inbound.length === 2, { label: 'the refused-context message' });
  assert.deepEqual(inbound[1], { chatId: 'C1', userId: 'U1', text: 'bad context', meta: {} });
  await send('HUGECTX');
  await waitFor(() => inbound.length === 3, { label: 'the oversize-context message' });
  assert.deepEqual(Object.keys(inbound[2]).sort(), ['chatId', 'meta', 'text', 'userId']);
  assert.ok(logs.some((m) => /invalid reply, history or attachments dropped/.test(m)));
  assert.ok(logs.some((m) => /chat context over the frame cap dropped/.test(m)));

  const h = await host.history({ plugin: NAME, channelId: 'main', chatId: 'C1', before: 'm1', limit: 1 });
  assert.deepEqual(h.map((x) => x.text), ['second'], 'at most `limit`, the newest');
  await waitFor(() => logs.some((m) => m.includes('history ["C1","m1",1]')), { label: 'the worker saw the call' });
  await assert.rejects(host.history({ plugin: NAME, channelId: 'main', chatId: 'NOPE', before: 'm1', limit: 5 }),
    (e) => e instanceof PluginOpError && e.permanent === true && /missing access/.test(e.message));
  await assert.rejects(host.history({ plugin: NAME, channelId: 'main', chatId: 'JUNK', before: 'm1', limit: 5 }), (e) => e.kind === 'protocol');
  await host.stop();

  installFixture({ worker: INTERACTIVE_WORKER });   // interactive, but its worker has no history()
  interactive(null);
  host = createChannelHost({ logger: () => {} });
  host.start();
  await waitFor(() => host.status()[0]?.state === 'connected', { label: 'worker connected' });
  assert.equal('attachmentHosts' in host.list()[0], false);
  await assert.rejects(host.history({ plugin: NAME, channelId: 'main', chatId: 'C1', before: 'm1', limit: 5 }),
    (e) => e.permanent === true && /cannot read channel history/.test(e.message));
  await host.stop();

  installFixture();                                  // not interactive
  host = createChannelHost({ logger: () => {} });
  host.start();
  await waitFor(() => host.status()[0]?.state === 'connected', { label: 'worker connected' });
  await assert.rejects(host.history({ plugin: NAME, channelId: 'main', chatId: 'C1', before: 'm1', limit: 5 }),
    (e) => e.permanent === true && /not interactive/.test(e.message));
  await host.stop();
});
