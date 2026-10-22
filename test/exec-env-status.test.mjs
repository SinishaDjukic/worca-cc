// test/exec-env-status.test.mjs — the live status of an execution environment (docs/e2b.md "Which E2B server
// Worca uses"): the E2B backend's status() over an injected SDK, the waiting count from the slot gate, and the
// backend-neutral entry (servers: [one]) with the cap and a short cache.
import { test, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { createLoopbackBackend } from './helpers/loopback-backend.mjs';
import { createFakeE2b } from '../src/core/exec-env/e2b-fake.mjs';
import { _setE2bForTests } from '../src/core/exec-env/e2b-sdk.mjs';
import { e2bBackend, e2bServerIdentity } from '../src/core/exec-env/backends/e2b.mjs';
import { acquireSandboxSlot, slotWaiters, _resetSlotsForTests } from '../src/core/exec-env/slots.mjs';
import { execEnvStatus, execEnvStatuses, _resetExecEnvStatusForTests } from '../src/core/exec-env/status.mjs';
import { _registerExecBackendForTests } from '../src/core/exec-env/registry.mjs';

useTempHome(after);
const scratch = mkdtempSync(join(tmpdir(), 'worca-exec-status-'));
const prevEnv = {};
before(() => {
  // settings.json lives under $HOME/.worca-cc: never the real one.
  for (const k of ['HOME', 'USERPROFILE', 'WORCA_TEST_ALLOW_HOME_FALLBACK']) prevEnv[k] = process.env[k];
  process.env.HOME = join(scratch, 'home'); process.env.USERPROFILE = process.env.HOME;
  process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = '1';
  mkdirSync(join(process.env.HOME, '.worca-cc'), { recursive: true });
});
after(() => {
  for (const k of Object.keys(prevEnv)) { if (prevEnv[k] === undefined) delete process.env[k]; else process.env[k] = prevEnv[k]; }
  rmSync(scratch, { recursive: true, force: true });
});
afterEach(() => { _setE2bForTests(null); _resetSlotsForTests(); _resetExecEnvStatusForTests(); });

const ENV = { E2B_API_KEY: 'e2b_test_key_abcd1234', E2B_API_URL: 'http://localhost:3000' };
const fakeSdk = () => createFakeE2b({ root: mkdtempSync(join(scratch, 'fake-')) });
const writeSettings = (s) => writeFileSync(join(process.env.HOME, '.worca-cc', 'settings.json'), JSON.stringify(s));

test('e2b status: connected names the server and counts running sandboxes', async () => {
  const sdk = fakeSdk(); _setE2bForTests(sdk);
  await sdk.Sandbox.create('worca-agent'); await sdk.Sandbox.create('worca-agent');
  const s = await e2bBackend.status({ env: ENV });
  assert.deepEqual(s, { state: 'connected', server: e2bServerIdentity(ENV).label, running: 2 });
  assert.match(s.server, /^http:\/\/localhost:3000 \(key /);
});

test('e2b status asks for running sandboxes only, with a short request timeout', async () => {
  let seen = null;
  _setE2bForTests({ Sandbox: { list: (opts) => { seen = opts; let done = false;
    return { get hasNext() { return !done; }, async nextItems() { done = true; return [{ sandboxId: 'a' }]; } }; } } });
  assert.equal((await e2bBackend.status({ env: ENV })).running, 1);
  assert.deepEqual(seen.query, { state: ['running'] });
  assert.ok(seen.requestTimeoutMs > 0 && seen.requestTimeoutMs <= 30_000, 'a time-limited call');
  assert.equal(seen.apiKey, ENV.E2B_API_KEY);
});

const failingSdk = (err) => ({ Sandbox: { list: () => ({ hasNext: true, nextItems: async () => { throw err; } }) } });
class AuthenticationError extends Error { constructor(m) { super(m); this.name = 'AuthenticationError'; } }

test('e2b status: a refused key and an unreachable server, never a throw and never the key', async () => {
  _setE2bForTests(failingSdk(new AuthenticationError('Unauthorized, please check your credentials. - Invalid API key')));
  let s = await e2bBackend.status({ env: ENV });
  assert.equal(s.state, 'key-refused'); assert.equal(s.running, undefined);
  assert.match(s.error, /Unauthorized/);
  _setE2bForTests(failingSdk(Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } })));
  s = await e2bBackend.status({ env: ENV });
  assert.equal(s.state, 'unreachable'); assert.match(s.error, /ECONNREFUSED/);
  assert.equal(s.server, e2bServerIdentity(ENV).label);
  assert.doesNotMatch(JSON.stringify(s), /e2b_test_key_abcd1234/);
});

test('e2b status: no key is not set up, with no SDK call; mock mode reads the loopback fake', async () => {
  let called = false;
  _setE2bForTests({ Sandbox: { list: () => { called = true; throw new Error('no'); } } });
  const s = await e2bBackend.status({ env: {} });
  assert.equal(s.state, 'not-configured'); assert.match(s.error, /E2B_API_KEY/); assert.equal(called, false);
  _setE2bForTests(null);
  const m = await e2bBackend.status({ env: {}, mock: true });
  assert.equal(m.state, 'connected'); assert.equal(typeof m.running, 'number'); assert.match(m.server, /mock/);
});

test('slotWaiters counts runs queued for a pool until they get a slot or give up', async () => {
  const release = await acquireSandboxSlot({ pool: 'p', cap: 1 });
  assert.equal(slotWaiters('p'), 0);
  const ac = new AbortController();
  const queued = acquireSandboxSlot({ pool: 'p', cap: 1, pollMs: 60_000 });
  const gaveUp = acquireSandboxSlot({ pool: 'p', cap: 1, pollMs: 60_000, signal: ac.signal }).catch((e) => e.name);
  await new Promise((r) => setImmediate(r));
  assert.equal(slotWaiters('p'), 2); assert.equal(slotWaiters('other'), 0);
  ac.abort(); assert.equal(await gaveUp, 'AbortError');
  assert.equal(slotWaiters('p'), 1);
  release(); (await queued)();
  assert.equal(slotWaiters('p'), 0);
});

test('execEnvStatus: one server entry with the cap from settings and the waiting runs', async () => {
  writeSettings({ e2bMaxSandboxes: 3 });
  const sdk = fakeSdk(); _setE2bForTests(sdk); await sdk.Sandbox.create('worca-agent');
  const release = await acquireSandboxSlot({ pool: 'e2b', cap: 1 });
  const queued = acquireSandboxSlot({ pool: 'e2b', cap: 1, pollMs: 60_000 });
  await new Promise((r) => setImmediate(r));
  try {
    const e = await execEnvStatus(e2bBackend, { env: ENV });
    assert.deepEqual(e, { name: 'e2b', label: 'E2B sandbox', title: 'E2B', state: 'connected',
      servers: [{ label: e2bServerIdentity(ENV).label, state: 'connected', running: 1, cap: 3, waiting: 1 }] });
  } finally { release(); (await queued)(); writeSettings({}); }
});

test('execEnvStatus: a hanging or throwing backend reads unreachable within the time limit', async () => {
  const { backend } = createLoopbackBackend({ root: scratch });
  const hang = { ...backend, status: () => new Promise(() => {}) };
  const t0 = Date.now();
  let e = await execEnvStatus(hang, { timeoutMs: 50 });
  assert.ok(Date.now() - t0 < 2000);
  assert.equal(e.state, 'unreachable'); assert.equal(e.servers[0].state, 'unreachable');
  assert.match(e.servers[0].error, /timed out/); assert.equal(e.servers[0].running, null);
  assert.equal(e.servers[0].label, 'loopback here', 'falls back to serverIdentity');
  e = await execEnvStatus({ ...backend, status: async () => { throw new Error('boom'); } });
  assert.equal(e.state, 'unreachable'); assert.equal(e.servers[0].error, 'boom');
});

test('execEnvStatuses lists only backends with status() and caches for a few seconds', async () => {
  const sdk = fakeSdk(); _setE2bForTests(sdk);
  const lb = createLoopbackBackend({ root: scratch, name: 'loopstat' });
  let calls = 0;
  const unregister = _registerExecBackendForTests({ ...lb.backend, status: async () => { calls++; return { state: 'connected', server: 'loopback here', running: 0 }; } });
  const { status: _status, ...noStatus } = createLoopbackBackend({ root: scratch, name: 'nostatus' }).backend;
  const silent = _registerExecBackendForTests(noStatus);
  try {
    let now = 1_000;
    const first = await execEnvStatuses({ env: ENV, now: () => now });
    assert.deepEqual(first.map((e) => e.name), ['e2b', 'loopstat']);
    assert.equal(first[1].servers[0].cap, 2, "the backend's own default when it has no setting");
    now += 2_000; await execEnvStatuses({ env: ENV, now: () => now });
    assert.equal(calls, 1, 'served from the cache');
    now += 10_000; await execEnvStatuses({ env: ENV, now: () => now });
    assert.equal(calls, 2, 'refreshed after the cache expires');
  } finally { unregister(); silent(); }
});
