// test/secrets-os-store.test.mjs — the OS key store seam: the test switch, the time limit and the error mapping.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  selectOsStore, unavailableOsStore, callStore, TEST_OS_STORE_ENV, BACKEND_LABELS, osItemName, osProbeItemName, storeTimeoutMs, STORE_TIMEOUT_MS,
  canonicalHomePath,
} from '../src/core/secrets/os-store.mjs';
import { VaultError } from '../src/core/secrets/refs.mjs';
import { fakeAccounts, readFakeCalls, writeFakeState } from './helpers/os-store-fake.mjs';

const REPO = fileURLToPath(new URL('..', import.meta.url));
const ROOT = mkdtempSync(join(tmpdir(), 'worca-os-store-'));
after(() => rmSync(ROOT, { recursive: true, force: true, maxRetries: 5 }));
const STATE = join(ROOT, 'fake', 'state.json');
writeFakeState(STATE, { state: 'available' });

test('the switch name', () => assert.equal(TEST_OS_STORE_ENV, 'WORCA_TEST_OS_STORE'));

test('unavailableOsStore: kind none, both calls throw unavailable', async () => {
  const s = unavailableOsStore();
  assert.equal(s.kind, 'none');
  await assert.rejects(s.getKey(), { code: 'unavailable' });
  await assert.rejects(s.setKey(Buffer.alloc(32)), { code: 'unavailable' });
});

test('the switch is honoured only with the runner marker and an absolute path', async () => {
  assert.equal((await selectOsStore({ env: { [TEST_OS_STORE_ENV]: STATE, NODE_TEST_CONTEXT: 'child-v8' } })).kind, 'fake');
  // Without the marker the real selection runs: these deps stand in for a machine with no OS key store, so a test
  // never loads the native binding of a developer machine that has it installed (where this said 'keychain').
  const noStore = { platform: 'darwin', loadKeyring: () => null };
  assert.equal((await selectOsStore({ env: { [TEST_OS_STORE_ENV]: STATE }, deps: noStore })).kind, 'none');
  assert.equal((await selectOsStore({ env: { [TEST_OS_STORE_ENV]: STATE, NODE_TEST_CONTEXT: '' }, deps: noStore })).kind, 'none');
  assert.equal((await selectOsStore({ env: { [TEST_OS_STORE_ENV]: 'fake/state.json', NODE_TEST_CONTEXT: 'child-v8' } })).kind, 'none');
  assert.equal((await selectOsStore({ env: { NODE_TEST_CONTEXT: 'child-v8' } })).kind, 'none');
});

test('a copy of src/ with no test/ beside it (a published install) gives kind none', async () => {
  const tree = join(ROOT, 'published');
  cpSync(join(REPO, 'src'), join(tree, 'src'), { recursive: true });
  const mod = await import(pathToFileURL(join(tree, 'src/core/secrets/os-store.mjs')).href);
  assert.equal((await mod.selectOsStore({ env: { [TEST_OS_STORE_ENV]: STATE, NODE_TEST_CONTEXT: 'child-v8' } })).kind, 'none');

  // Any other import error is rethrown: a fake present but broken.
  const broken = join(ROOT, 'broken');
  cpSync(join(REPO, 'src'), join(broken, 'src'), { recursive: true });
  mkdirSync(join(broken, 'test/helpers'), { recursive: true });
  writeFileSync(join(broken, 'test/helpers/os-store-fake.mjs'), "import './not-there.mjs';\nexport const fileFakeOsStore = () => ({ kind: 'fake' });\n");
  const mod2 = await import(pathToFileURL(join(broken, 'src/core/secrets/os-store.mjs')).href);
  await assert.rejects(mod2.selectOsStore({ env: { [TEST_OS_STORE_ENV]: STATE, NODE_TEST_CONTEXT: 'child-v8' } }), { code: 'ERR_MODULE_NOT_FOUND' });
});

test('callStore: a store that never answers is store-locked/timeout within the time limit', async () => {
  const t0 = Date.now();
  const err = await callStore({ getKey: () => new Promise(() => {}) }, 'getKey', [], { timeoutMs: 50 }).catch((e) => e);
  assert.ok(err instanceof VaultError);
  assert.equal(err.code, 'store-locked');
  assert.equal(err.reason, 'timeout');
  assert.ok(Date.now() - t0 < 5000);
});

test('callStore: a getKey result other than null or a 32-byte Buffer is store-unavailable', async () => {
  for (const v of [Buffer.alloc(31), Buffer.alloc(33), 'k'.repeat(32), undefined, new Uint8Array(32)]) {
    await assert.rejects(callStore({ getKey: async () => v }, 'getKey', [], { timeoutMs: 1000 }), { code: 'store-unavailable' });
  }
  assert.equal(await callStore({ getKey: async () => null }, 'getKey', [], { timeoutMs: 1000 }), null);
  const k = Buffer.alloc(32, 7);
  assert.ok((await callStore({ getKey: async () => k }, 'getKey', [], { timeoutMs: 1000 })).equals(k));
});

test('callStore: the error mapping drops the store\'s own text', async () => {
  const canary = 'CANARY-store-text-91c2';
  const thrower = (code) => ({ setKey: async () => { throw Object.assign(new Error(canary), code ? { code } : {}); } });
  for (const [code, want] of [['unavailable', 'store-unavailable'], ['locked', 'store-locked'], ['EWHATEVER', 'store-unavailable'], [undefined, 'store-unavailable']]) {
    const err = await callStore(thrower(code), 'setKey', [Buffer.alloc(32)], { timeoutMs: 1000 }).catch((e) => e);
    assert.ok(err instanceof VaultError);
    assert.equal(err.code, want);
    assert.equal(err.cause, undefined);
    for (const s of [err.message, err.stack, String(err), JSON.stringify(Object.getOwnPropertyDescriptors(err))]) assert.ok(!s.includes(canary));
  }
  // A synchronous throw maps the same way.
  const sync = await callStore({ getKey: () => { throw Object.assign(new Error(canary), { code: 'locked' }); } }, 'getKey', [], { timeoutMs: 1000 }).catch((e) => e);
  assert.equal(sync.code, 'store-locked');
});

// ---- Real selection, through injected deps (no real OS store is ever reached) ----

// A fake @napi-rs/keyring: each entry answers per `mode` (null, a key, 'unavailable', 'locked' or 'never').
function fakeKeyring(mode = null) {
  const log = { entries: [], gets: 0, sets: 0 };
  class AsyncEntry {
    constructor(service, account, options) { log.entries.push({ service, account, options }); }
    async getSecret() {
      log.gets++;
      if (mode === 'never') return new Promise(() => {});
      if (mode === 'unavailable') throw new Error('Platform secure storage failure: no Secret Service');
      if (mode === 'locked') throw new Error('NoStorageAccess: collection is locked');
      return mode ? [...mode] : null;
    }
    async setSecret() { log.sets++; }
  }
  return { AsyncEntry, log };
}

const HOME_A = join(ROOT, 'home-a');
mkdirSync(HOME_A, { recursive: true });
const PS = '/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe';
const depsFor = ({ platform, wsl = false, keyring = null, powershell = null, wrapped = false }) => ({
  platform,
  isWsl: async () => wsl,
  loadKeyring: () => keyring,
  findPowershell: () => powershell,
  run: async () => ({ code: 1, stdout: '' }),
  existsWrapped: () => wrapped,
});
const ENV = { WORCA_TEST_STORE_TIMEOUT_MS: '200', NODE_TEST_CONTEXT: 'child-v8' };
const select = (o) => selectOsStore({ env: ENV, home: HOME_A, deps: depsFor(o) });

test('selection: the 9 platform rows', async () => {
  const rows = [
    [{ platform: 'darwin', keyring: fakeKeyring() }, 'keychain'],
    [{ platform: 'win32', keyring: fakeKeyring() }, 'credential-manager'],
    [{ platform: 'linux', keyring: fakeKeyring() }, 'secret-service'],
    [{ platform: 'linux', keyring: fakeKeyring('unavailable') }, 'none'],
    [{ platform: 'linux', keyring: fakeKeyring('locked') }, 'secret-service'],
    [{ platform: 'linux', wsl: true, keyring: fakeKeyring(), powershell: PS }, 'secret-service'],
    [{ platform: 'linux', wsl: true, keyring: fakeKeyring('unavailable'), powershell: PS }, 'wsl-dpapi'],
    [{ platform: 'linux', wsl: true, keyring: fakeKeyring('unavailable'), powershell: null }, 'none'],
    [{ platform: 'freebsd', keyring: fakeKeyring() }, 'none'],
  ];
  for (const [o, kind] of rows) {
    const s = await select(o);
    assert.equal(s.kind, kind, JSON.stringify({ ...o, keyring: !!o.keyring }));
    assert.equal(s.label, BACKEND_LABELS[kind]);
  }
});

test('selection: a never-answering Secret Service counts as present but locked', async () => {
  const s = await select({ platform: 'linux', keyring: fakeKeyring('never') });
  assert.equal(s.kind, 'secret-service');
});

test('selection: an existing wrapped key on WSL2 keeps DPAPI, with 0 probe calls', async () => {
  const k1 = fakeKeyring();
  assert.equal((await select({ platform: 'linux', wsl: true, keyring: k1, powershell: PS, wrapped: true })).kind, 'wsl-dpapi');
  assert.equal(k1.log.gets, 0);
  const k2 = fakeKeyring();
  assert.equal((await select({ platform: 'linux', wsl: true, keyring: k2, powershell: null, wrapped: true })).kind, 'none');
  assert.equal(k2.log.gets, 0);
});

test('selection: the 4 missing-module rows', async () => {
  for (const platform of ['darwin', 'win32', 'linux']) assert.equal((await select({ platform, keyring: null, powershell: PS })).kind, 'none', platform);
  assert.equal((await select({ platform: 'linux', wsl: true, keyring: null, powershell: PS })).kind, 'wsl-dpapi');
});

test('selection: the Linux probe answer is reused, so a status read costs 1 getSecret', async () => {
  const key = randomBytes(32);
  const k = fakeKeyring(key);
  const s = await select({ platform: 'linux', keyring: k });
  assert.ok((await callStore(s, 'getKey', [], { timeoutMs: 1000 })).equals(key));
  assert.equal(k.log.gets, 1);
  assert.deepEqual(k.log.entries.map((e) => e.options), [{ linux: { store: 'secret-service' } }]);
  assert.equal(k.log.entries[0].account, osItemName(HOME_A).account);
});

test('osItemName: stable, distinct per home, one item for a trailing slash and a symlink', () => {
  const b = join(ROOT, 'home-b');
  mkdirSync(b, { recursive: true });
  const link = join(ROOT, 'home-a-link');
  symlinkSync(HOME_A, link);
  const a = osItemName(HOME_A);
  assert.equal(a.service, 'worca-cc');
  assert.match(a.account, /^vault-key-[0-9a-f]{16}$/);
  assert.deepEqual(osItemName(HOME_A), a);
  assert.notEqual(osItemName(b).account, a.account);
  assert.equal(osItemName(HOME_A + '/').account, a.account);
  assert.equal(osItemName(link).account, a.account);
  assert.ok(!a.account.includes('home-a'));
  // A home that does not exist yet resolves its path; win32 ignores case.
  const missing = join(ROOT, 'Not-Yet');
  assert.equal(osItemName(missing, { platform: 'win32' }).account, osItemName(missing.toLowerCase(), { platform: 'win32' }).account);
  assert.notEqual(osItemName(missing).account, osItemName(missing.toLowerCase()).account);
});

test('osItemName: a home under a symlinked parent names the same item before and after it is created', () => {
  const real = join(ROOT, 'canon-real');
  mkdirSync(real, { recursive: true });
  const link = join(ROOT, 'canon-link');
  symlinkSync(real, link);
  for (const rel of [['new-home'], ['a', 'b']]) {
    const home = join(link, ...rel);
    const before = { key: osItemName(home), probe: osProbeItemName(home) };
    assert.deepEqual(osItemName(join(real, ...rel)), before.key, 'the real spelling names the same item');
    assert.deepEqual(osProbeItemName(join(real, ...rel)), before.probe);
    mkdirSync(home, { recursive: true });
    assert.deepEqual(osItemName(home), before.key, 'the same key item once the home exists');
    assert.deepEqual(osProbeItemName(home), before.probe, 'the same probe item once the home exists');
  }
});

test('canonicalHomePath: an existing path is its realpath; a missing one is its nearest real ancestor plus the rest', () => {
  const real = join(ROOT, 'canon-path-real');
  mkdirSync(real, { recursive: true });
  const link = join(ROOT, 'canon-path-link');
  symlinkSync(real, link);
  assert.equal(canonicalHomePath(link), realpathSync.native(real));
  assert.equal(canonicalHomePath(link + '/'), realpathSync.native(real));
  assert.equal(canonicalHomePath(join(link, 'x', 'Y')), join(realpathSync.native(real), 'x', 'Y'));
  assert.equal(canonicalHomePath('relative-missing-dir'), join(realpathSync.native(process.cwd()), 'relative-missing-dir'));
});

test('the test guard: inside a test run with no switch and no deps, the unavailable store', async () => {
  const s = await selectOsStore({ env: { NODE_TEST_CONTEXT: 'child-v8' }, home: HOME_A });
  assert.equal(s.kind, 'none');
  assert.equal(s.label, 'No OS key store');
});

test('storeTimeoutMs: 10 s, the test override honoured only under the runner, clamped to 50–10 000', () => {
  assert.equal(STORE_TIMEOUT_MS, 10_000);
  assert.equal(storeTimeoutMs({}), 10_000);
  assert.equal(storeTimeoutMs({ WORCA_TEST_STORE_TIMEOUT_MS: '300' }), 10_000);
  assert.equal(storeTimeoutMs({ WORCA_TEST_STORE_TIMEOUT_MS: '300', NODE_TEST_CONTEXT: '1' }), 300);
  assert.equal(storeTimeoutMs({ WORCA_TEST_STORE_TIMEOUT_MS: '1', NODE_TEST_CONTEXT: '1' }), 50);
  assert.equal(storeTimeoutMs({ WORCA_TEST_STORE_TIMEOUT_MS: '99999', NODE_TEST_CONTEXT: '1' }), 10_000);
  assert.equal(storeTimeoutMs({ WORCA_TEST_STORE_TIMEOUT_MS: 'soon', NODE_TEST_CONTEXT: '1' }), 10_000);
});

test('callStore: passes a signal and aborts it on timeout', async () => {
  let seen;
  await assert.rejects(callStore({ getKey: ({ signal }) => { seen = signal; return new Promise(() => {}); } }, 'getKey', [], { timeoutMs: 50 }), { code: 'store-locked' });
  assert.equal(seen.aborted, true);
  let key;
  await callStore({ setKey: async (k, { signal }) => { key = k; seen = signal; } }, 'setKey', [Buffer.alloc(32, 1)], { timeoutMs: 1000 });
  assert.equal(key.length, 32);
  assert.equal(seen.aborted, false);
});

test('selection: one store per home and module, so 3 sequential selections of a hung keychain make 1 native call', async () => {
  const k = fakeKeyring('never');
  for (let i = 0; i < 3; i++) {
    const s = await select({ platform: 'darwin', keyring: k });
    await assert.rejects(callStore(s, 'getKey', [], { timeoutMs: 50 }), { code: 'store-locked' });
  }
  assert.equal(k.log.gets, 1);
  const linux = fakeKeyring('never');
  for (let i = 0; i < 3; i++) assert.equal((await select({ platform: 'linux', keyring: linux })).kind, 'secret-service');
  assert.equal(linux.log.gets, 1);
});

test('osProbeItemName: its own per-home item, never the key item', () => {
  const b = join(ROOT, 'home-probe-b');
  mkdirSync(b, { recursive: true });
  const probe = osProbeItemName(HOME_A);
  assert.equal(probe.service, 'worca-cc');
  assert.match(probe.account, /^vault-probe-[0-9a-f]{16}$/);
  assert.notEqual(probe.account, osItemName(HOME_A).account);
  assert.deepEqual(osProbeItemName(HOME_A + '/'), probe);
  assert.notEqual(osProbeItemName(b).account, probe.account);
});

test('unavailableOsStore: probe throws unavailable', async () => {
  await assert.rejects(unavailableOsStore().probe(), { code: 'unavailable' });
});

test('callStore probe: each probe code and a timeout map to store-locked or store-unavailable with that reason', async () => {
  const canary = 'CANARY-probe-text-4d2a';
  const rows = [['locked', 'store-locked'], ['unavailable', 'store-unavailable'], ['probe-mismatch', 'store-unavailable'],
    ['probe-missing', 'store-unavailable'], ['probe-delete', 'store-unavailable']];
  for (const [code, want] of rows) {
    const err = await callStore({ probe: async () => { throw Object.assign(new Error(canary), { code }); } }, 'probe', [], { timeoutMs: 1000 }).catch((e) => e);
    assert.ok(err instanceof VaultError);
    assert.equal(err.code, want, code);
    assert.equal(err.reason, code);
    assert.ok(!err.message.includes(canary));
  }
  const t = await callStore({ probe: () => new Promise(() => {}) }, 'probe', [], { timeoutMs: 50 }).catch((e) => e);
  assert.equal(t.code, 'store-locked');
  assert.equal(t.reason, 'timeout');
  assert.equal(await callStore({ probe: async () => undefined }, 'probe', [], { timeoutMs: 1000 }), undefined);
});

test('the fake selected for a home probes on the home\'s probe item and leaves no item behind', async () => {
  const state = join(ROOT, 'fake-probe', 'state.json');
  writeFakeState(state, { state: 'available' });
  const s = await selectOsStore({ env: { [TEST_OS_STORE_ENV]: state, NODE_TEST_CONTEXT: 'child-v8' }, home: HOME_A });
  await callStore(s, 'probe', [], { timeoutMs: 1000 });
  assert.deepEqual(readFakeCalls(state).map((c) => c.op), ['probe']);
  assert.deepEqual(fakeAccounts(state), []);
  writeFakeState(state, { state: 'available', failProbe: 'delete-failed' });
  await assert.rejects(callStore(s, 'probe', [], { timeoutMs: 1000 }), { code: 'store-unavailable', reason: 'probe-delete' });
  assert.deepEqual(fakeAccounts(state), [osProbeItemName(HOME_A).account]);
});
