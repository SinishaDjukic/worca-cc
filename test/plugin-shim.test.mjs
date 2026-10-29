// test/plugin-shim.test.mjs — ephemeral child shim (spec §7.2).
// Real-spawn tests install a complete fixture plugin under the temp WORCA_HOME
// (lock entry + manifest + connector) and exercise the whole load path:
// lock -> manifest -> config/secrets -> state -> spawn -> ONE stdout frame.
// `current` is a plain directory here (production makes it a symlink; the shim
// only ever path-joins through it, so both work).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { useTempHome } from './helpers/temp-home.mjs';
import { writePluginsLock, pluginCurrentDir } from '../src/core/plugins-lock.mjs';
import { writePluginConfig, writePluginState, readPluginState, createProfile, deleteProfile } from '../src/core/plugin-config.mjs';
import { callSource, PluginOpError, setMockSourceResponses, _resetWithheldProxyNotice, scrubbedEnv } from '../src/core/plugin-shim.mjs';
import { egressChildEnv } from '../src/core/egress-policy.mjs';
import { startProxyNet, setProxyEnv, assertProxyRouting, NO_PROXY_HOST } from './helpers/proxy-net.mjs';
import { importClosure } from './helpers/import-closure.mjs';

useTempHome(after);
// The developer's own proxy variables never reach these real children (the proxy
// tests set their own) or spend the once-per-process withheld-proxy warning early.
after(setProxyEnv({}));

const NAME = 'mock-echo';
const SCHEMA = [{ key: 'token', type: 'text', label: 'Token', secret: true }];

// Connector fixture: default-export factory per plugin API v1. Deliberately
// backtick-free so it embeds as a plain string.
const CONNECTOR = [
  'export default function createTaskSource(ctx) {',
  '  return {',
  '    async echoOp(args) {',
  "      return { op: 'echoOp', args, token: ctx.config.token,",
  "               cursor: await ctx.state.get('cursor'), api: ctx.apiVersion };",
  '    },',
  '    async envKeys() { return Object.keys(process.env).sort(); },',
  '    async bumpState() {',
  "      await ctx.state.set('cursor', 'page-2');",
  "      ctx.log('info', 'cursor advanced');",
  '      return { moved: true, readBack: await ctx.state.get(\'cursor\') };',
  '    },',
  "    async boom() { const e = new Error('token expired'); e.kind = 'auth'; throw e; },",
  '    async never() { return new Promise(() => {}); },',
  "    async noisy() { console.log('junk before the frame'); return { fine: true }; },",
  '    async fetchAll(args) {',
  '      const out = [];',
  '      for (const url of args.urls) {',
  '        try { const res = await fetch(url); out.push({ url, status: res.status, body: await res.text() }); }',
  '        catch (err) { out.push({ url, error: String((err.cause && err.cause.code) || err.message) }); }',
  '      }',
  '      return out;',
  '    },',
  '  };',
  '}',
].join('\n');

function installFixture() {
  const cur = pluginCurrentDir(NAME);
  mkdirSync(join(cur, 'connector'), { recursive: true });
  writeFileSync(join(cur, 'worca-cc-plugin.json'), JSON.stringify({
    name: NAME,
    engines: { 'worca-cc-api': '>=1 <2' }, // API-1 plugin: must negotiate apiVersion 1 on an API-2 host
    taskSources: [{
      id: 'main',
      displayName: 'Mock Echo',
      module: './connector/index.mjs',
      configSchema: SCHEMA,
      inputs: [{ key: 'task', type: 'task-browser', label: 'Task' }],
    }, {
      // multiProfile sibling: callSource must refuse to run it profile-less
      // (the guard lives in the shim so the CLI is covered, not just the routes).
      id: 'prof',
      displayName: 'Mock Echo (profiled)',
      module: './connector/index.mjs',
      multiProfile: true,
      configSchema: SCHEMA,
      inputs: [{ key: 'task', type: 'task-browser', label: 'Task' }],
    }],
  }));
  writeFileSync(join(cur, 'connector', 'index.mjs'), CONNECTOR);
  writePluginsLock({
    [NAME]: {
      repo: 'local-fixture', subdir: null, pinnedSha: 'f'.repeat(40),
      version: null, enabled: true, installedAt: '2026-07-12T00:00:00.000Z',
    },
  });
  writePluginConfig(NAME, SCHEMA, { token: 'sekret' });
  writePluginState(NAME, { cursor: 'page-1' });
}
installFixture();

const rejectsKind = (p, kind, re) => assert.rejects(p, (err) => {
  assert.ok(err instanceof PluginOpError, `expected PluginOpError, got ${err?.name}: ${err?.message}`);
  assert.equal(err.kind, kind);
  if (re) assert.match(err.message, re);
  return true;
});

test('real child round-trip: op/args echo back; config+state arrive via stdin', async () => {
  const result = await callSource({ plugin: NAME, sourceId: 'main', op: 'echoOp', args: { a: 1, s: 'x' } });
  assert.equal(result.op, 'echoOp');
  assert.deepEqual(result.args, { a: 1, s: 'x' });
  assert.equal(result.token, 'sekret', 'secret config travelled via stdin, not env/argv');
  assert.equal(result.cursor, 'page-1', 'state snapshot readable through ctx.state.get');
  assert.equal(result.api, 1, 'ctx.apiVersion negotiated down to 1 for a ">=1 <2" manifest');
});

test('connector-thrown error maps to PluginOpError with the connector kind', async () => {
  await rejectsKind(
    callSource({ plugin: NAME, sourceId: 'main', op: 'boom' }),
    'auth', /token expired/,
  );
});

test("unimplemented op yields kind 'unimplemented' + a 'does not implement' message", async () => {
  // Task 13's capabilities tolerant-default keys on exactly this kind — it must
  // stay distinguishable from an IMPLEMENTED op that crashed (kind 'plugin'),
  // or a crash would force writeBack:true past a pinned per-run opt-out.
  await rejectsKind(
    callSource({ plugin: NAME, sourceId: 'main', op: 'capabilities' }),
    'unimplemented', /does not implement op "capabilities"/,
  );
});

test('profile invariant is enforced in callSource itself (CLI-safe, not just the routes)', async () => {
  // A multi-profile source silently defaulting to the empty default bucket
  // would report false "not configured" verdicts and persist state into a
  // bucket no real run reads — refuse before any spawn.
  await rejectsKind(
    callSource({ plugin: NAME, sourceId: 'prof', op: 'echoOp' }),
    'plugin', /per-profile configuration/,
  );
  // A profile on a single-profile source would read a phantom bucket.
  await rejectsKind(
    callSource({ plugin: NAME, sourceId: 'main', op: 'echoOp', profile: 'work' }),
    'plugin', /does not use profiles/,
  );
  // Naming the implicit bucket explicitly is fine — it is the one that runs.
  const viaDefault = await callSource({ plugin: NAME, sourceId: 'main', op: 'echoOp', profile: 'default' });
  assert.equal(viaDefault.token, 'sekret');
  // And a named ROSTER profile reaches ITS bucket, not the default one.
  createProfile(NAME, 'work', 'Work');
  writePluginConfig(NAME, SCHEMA, { token: 'work-tok' }, 'work');
  const viaWork = await callSource({ plugin: NAME, sourceId: 'prof', op: 'echoOp', profile: 'work' });
  assert.equal(viaWork.token, 'work-tok');
});

test('profile MEMBERSHIP is enforced too: typo, reserved default, deleted — all refused', async () => {
  // Presence alone is not enough (`worca plugin exec … --profile wokr`): a
  // typo'd profile would run against an EMPTY bucket, yield a false "not
  // configured" verdict, and then MINT a phantom state bucket the DELETE route
  // can never purge. The roster is the source of truth.
  await rejectsKind(
    callSource({ plugin: NAME, sourceId: 'prof', op: 'echoOp', profile: 'wokr' }),
    'plugin', /has no profile "wokr"/,
  );
  // "default" on a multiProfile source is the reserved shared bucket (chat
  // channels, model secrets, migrated legacy config) — never a profile.
  await rejectsKind(
    callSource({ plugin: NAME, sourceId: 'prof', op: 'echoOp', profile: 'default' }),
    'plugin', /reserved shared bucket/,
  );
  // A profile deleted between submit and a later call is caught at call time,
  // not read as an empty bucket mid-run.
  createProfile(NAME, 'gone', 'Doomed');
  deleteProfile(NAME, 'gone');
  await rejectsKind(
    callSource({ plugin: NAME, sourceId: 'prof', op: 'echoOp', profile: 'gone' }),
    'plugin', /has no profile "gone"/,
  );
});

test('timeout kills the child and rejects with kind timeout', async () => {
  const t0 = Date.now();
  await rejectsKind(
    callSource({ plugin: NAME, sourceId: 'main', op: 'never', timeoutMs: 300 }),
    'timeout', /300ms/,
  );
  assert.ok(Date.now() - t0 < 5000, 'rejected promptly after the kill, not at some default');
});

test('the connector child loads no worca module but env-proxy, and no node:http until a proxy is set', () => {
  // It runs with no WORCA_HOME, so a module that reached the store would resolve wrong paths;
  // and every connector op starts one, so a proxy-less op pays for no http stack.
  assert.deepEqual(importClosure('src/core/plugin-shim-child.mjs'), {
    modules: ['src/core/env-proxy.mjs'],
    bare: ['node:module', 'node:url'],
  });
});

test('child env is scrubbed to PATH, HOME and the network variables — no WORCA_*/npm_* leakage', async () => {
  const keys = await callSource({ plugin: NAME, sourceId: 'main', op: 'envKeys' });
  assert.ok(Array.isArray(keys) && keys.includes('PATH'), 'PATH is passed through');
  assert.ok(!keys.includes('WORCA_HOME'), 'WORCA_HOME must NOT leak (it IS set in this test process)');
  assert.ok(!keys.some((k) => k.startsWith('WORCA_') || k.startsWith('npm_')),
    `unexpected env leak: ${keys.join(',')}`);
});

test('real child: with the proxy variables set, a connector fetch() goes through the proxy; loopback and NO_PROXY go direct', async (t) => {
  const net = await startProxyNet();
  // http_proxy too: a loopback http fetch would reach the proxy if the child did not bypass it.
  const restore = setProxyEnv({ HTTPS_PROXY: net.proxyUrl, http_proxy: net.proxyUrl, no_proxy: NO_PROXY_HOST });
  const stderr = t.mock.method(console, 'error', () => {});
  _resetWithheldProxyNotice();
  try {
    const logLines = [];
    const results = await callSource({ plugin: NAME, sourceId: 'main', op: 'fetchAll', args: { urls: net.targets }, logger: (level, msg) => logLines.push(`${level}:${msg}`) });
    assertProxyRouting(net, results);
    assert.deepEqual(logLines, [], 'an applied proxy is no news: the child logs warnings only');
    assert.deepEqual(stderr.mock.calls.map((c) => c.arguments[0]), [], 'a proxy without credentials is passed, so nothing was withheld');
  } finally {
    restore();
    await net.close();
  }
});

test('a proxy URL with credentials never reaches the connector child; worca warns once on stderr, even when the first caller logs nowhere', async (t) => {
  const restore = setProxyEnv({ HTTPS_PROXY: 'http://user:s3cret@proxy.corp:8080', http_proxy: 'http://proxy.corp:3128', NO_PROXY: 'corp.example' });
  const stderr = t.mock.method(console, 'error', () => {});
  _resetWithheldProxyNotice();
  try {
    // Ask's task lookups pass a no-op logger: the once-per-process warning must not be spent there unseen.
    const keys = await callSource({ plugin: NAME, sourceId: 'main', op: 'envKeys', logger: () => {} });
    assert.ok(keys.includes('NO_PROXY'), `NO_PROXY still passes: ${keys}`);
    assert.ok(!keys.some((k) => /^https?_proxy$/i.test(k)), `no proxy URL may reach the child: ${keys}`);
    const logLines = [];
    await callSource({ plugin: NAME, sourceId: 'main', op: 'envKeys', logger: (level, msg) => logLines.push(`${level}:${msg}`) });
    const warned = stderr.mock.calls.map((c) => String(c.arguments[0]));
    assert.equal(warned.length, 1, `one warning per process, got: ${JSON.stringify(warned)}`);
    assert.match(warned[0], /^worca: proxy: .*credentials.*go direct$/);
    assert.doesNotMatch(warned[0], /s3cret|proxy\.corp/);
    assert.deepEqual(logLines, [], 'the warning is the process\'s, not an op log line');
  } finally {
    restore();
  }
});

const SERVER = fileURLToPath(new URL('../ui/server.mjs', import.meta.url));
// PORT=0 means "default" to the server (4317, maybe the user's own UI): pick a free one.
const freePort = () => new Promise((r) => { const s = createServer().listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => r(port)); }); });

test('the UI server says it at boot, before any plugin spawn could spend it unseen', async () => {
  const home = mkdtempSync(join(tmpdir(), 'worca-proxy-boot-'));
  // The corporate proxy turned off by hand: otherwise the login in HTTPS_PROXY starts it (egress-policy.mjs).
  mkdirSync(join(home, '.worca-cc'), { recursive: true });
  writeFileSync(join(home, '.worca-cc', 'settings.json'), JSON.stringify({ networkProxy: { enabled: false } }));
  const child = spawn(process.execPath, [SERVER], {
    // No egress policy: it would replace the proxy variables before the line is printed.
    env: { ...process.env, WORCA_MOCK: '1', WORCA_HOME: home, HOME: home, USERPROFILE: home, PORT: String(await freePort()),
      WORCA_EGRESS_MODE: '', HTTPS_PROXY: 'http://user:s3cret@proxy.corp.invalid:8080' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  const onData = (c) => { out += c; if (/carries credentials|listening on/.test(out)) child.kill('SIGTERM'); };
  child.stdout.on('data', onData);
  child.stderr.on('data', onData);
  const timer = setTimeout(() => child.kill('SIGKILL'), 60_000);
  await new Promise((r) => child.on('exit', r));
  clearTimeout(timer);
  rmSync(home, { recursive: true, force: true, maxRetries: 5 });
  assert.match(out, /^\[worca-ui\] proxy: HTTP\(S\)_PROXY carries credentials, which plugin code never receives, .* go direct$/m, out);
  assert.doesNotMatch(out, /s3cret/);
});

test('a proxy the connector child cannot apply is a warning in the op logs, not a bare "fetch failed"', async () => {
  const restore = setProxyEnv({ HTTPS_PROXY: 'http://[not-a-host' });
  try {
    const logLines = [];
    await callSource({ plugin: NAME, sourceId: 'main', op: 'echoOp', logger: (level, msg) => logLines.push(`${level}:${msg}`) });
    assert.equal(logLines.length, 1, `one proxy warning, got: ${JSON.stringify(logLines)}`);
    assert.match(logLines[0], /^warn:proxy: .*not a valid proxy URL; outbound requests go direct$/);
  } finally {
    restore();
  }
});

test('stateDelta is applied host-side via writePluginState; logs route to the passed logger', async () => {
  const logLines = [];
  const result = await callSource({
    plugin: NAME, sourceId: 'main', op: 'bumpState',
    logger: (level, msg) => logLines.push(`${level}:${msg}`),
  });
  assert.deepEqual(result, { moved: true, readBack: 'page-2' }, 'ctx.state.get reads back its own set within the op');
  assert.deepEqual(readPluginState(NAME), { cursor: 'page-2' }, 'delta shallow-merged into data/state.json');
  assert.deepEqual(logLines, ['info:cursor advanced'], 'ctx.log lines returned in the frame and routed');
});

test('stdout is protocol-reserved: console.log junk => PluginOpError protocol', async () => {
  await rejectsKind(
    callSource({ plugin: NAME, sourceId: 'main', op: 'noisy' }),
    'protocol', /protocol-reserved/,
  );
});

test('WORCA_MOCK=1 short-circuits without spawning (plugin need not exist)', async () => {
  process.env.WORCA_MOCK = '1';
  try {
    // Built-in defaults (smoke path): 2 canned tasks, canned getTask, ok reportResult/validateConfig.
    const listed = await callSource({ plugin: 'not-installed', sourceId: 'x', op: 'listTasks' });
    assert.equal(listed.tasks.length, 2);
    const got = await callSource({ plugin: 'not-installed', sourceId: 'x', op: 'getTask', args: { id: 'T-42' } });
    assert.equal(got.id, 'T-42');
    assert.ok(typeof got.body === 'string' && got.body.length > 0);
    assert.deepEqual(await callSource({ plugin: 'x', sourceId: 'x', op: 'reportResult', args: { id: 'T-42', status: 'completed', summary: 's' } }), { ok: true });
    assert.deepEqual(await callSource({ plugin: 'x', sourceId: 'x', op: 'validateConfig' }), { ok: true });
    // Test override wins over the default…
    setMockSourceResponses({ listTasks: { tasks: [{ id: 'T-override', title: 't', state: 'open', updatedAt: 'now' }] } });
    const overridden = await callSource({ plugin: 'x', sourceId: 'x', op: 'listTasks' });
    assert.equal(overridden.tasks[0].id, 'T-override');
    // …and an op with NO canned response mirrors the real child's kind
    // 'unimplemented' (the capabilities tolerant-default keys on it).
    await rejectsKind(callSource({ plugin: 'x', sourceId: 'x', op: 'capabilities' }), 'unimplemented');
    // Behavioral parity: when the plugin IS installed, the profile invariant
    // holds in mock mode too — a mock run must catch a missing profile exactly
    // like a real one would.
    await rejectsKind(
      callSource({ plugin: NAME, sourceId: 'prof', op: 'listTasks' }),
      'plugin', /per-profile configuration/,
    );
  } finally {
    delete process.env.WORCA_MOCK;
    setMockSourceResponses(null);
  }
});

test('corporate proxy: the credential-free loopback URL reaches plugins, nothing is withheld', () => {
  const vars = egressChildEnv('http://127.0.0.1:41234', ['intranet.example']);
  const restore = setProxyEnv({ HTTPS_PROXY: vars.HTTPS_PROXY, HTTP_PROXY: vars.HTTP_PROXY, https_proxy: vars.https_proxy,
    http_proxy: vars.http_proxy, NO_PROXY: vars.NO_PROXY, no_proxy: vars.no_proxy });
  try {
    const env = scrubbedEnv('linux');
    for (const k of ['HTTPS_PROXY', 'HTTP_PROXY', 'https_proxy', 'http_proxy']) assert.equal(env[k], 'http://127.0.0.1:41234', k);
    assert.equal(env.NO_PROXY, '127.0.0.1,localhost,::1,intranet.example');
    assert.equal(scrubbedEnv('win32').HTTPS_PROXY, 'http://127.0.0.1:41234', 'same on Windows');
  } finally { restore(); }
});
