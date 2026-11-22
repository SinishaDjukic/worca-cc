// test/secrets-keyring-backend.test.mjs — the @napi-rs/keyring backend, over a fake module: the Secret Service pin
// on every entry, create-only setKey, the error mapping, the lazy load, the in-flight guard and the primed answer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { keyringOsStore, loadKeyring, _resetKeyringForTests } from '../src/core/secrets/keyring-backend.mjs';
import { callStore } from '../src/core/secrets/os-store.mjs';

const ITEM = { service: 'worca-cc', account: 'vault-key-0123456789abcdef' };

// A controllable fake: `held` is the stored secret; `getImpl` overrides getSecret.
function fakeModule({ held = null, getImpl, setImpl } = {}) {
  const log = { entries: [], gets: 0, sets: 0 };
  const state = { held };
  class AsyncEntry {
    constructor(service, account, options) { log.entries.push({ service, account, options }); }
    getSecret(signal) { log.gets++; return getImpl ? getImpl(signal) : Promise.resolve(state.held ? [...state.held] : null); }
    setSecret(secret) { log.sets++; if (setImpl) return setImpl(secret); state.held = Buffer.from(secret); return Promise.resolve(); }
    deleteCredential() { log.deletes = (log.deletes ?? 0) + 1; const had = !!state.held; state.held = null; return Promise.resolve(had); }
  }
  return { keyring: { AsyncEntry }, log, state };
}

test('every entry is pinned to the Secret Service; getKey maps the secret to a Buffer', async () => {
  const key = randomBytes(32);
  const { keyring, log } = fakeModule({ held: key });
  const s = keyringOsStore({ keyring, item: ITEM, kind: 'keychain' });
  assert.equal(s.kind, 'keychain');
  const got = await s.getKey();
  assert.ok(Buffer.isBuffer(got) && got.equals(key));
  await s.setKey(randomBytes(32)).catch(() => {});
  for (const e of log.entries) assert.deepEqual(e, { service: 'worca-cc', account: ITEM.account, options: { linux: { store: 'secret-service' } } });
});

test('a wrong-length secret is passed through and callStore rejects it', async () => {
  const { keyring } = fakeModule({ held: Buffer.alloc(16, 1) });
  const s = keyringOsStore({ keyring, item: ITEM, kind: 'keychain' });
  await assert.rejects(callStore(s, 'getKey', [], { timeoutMs: 1000 }), { code: 'store-unavailable' });
});

test('setKey is create-only: an existing item rejects exists with 0 setSecret calls', async () => {
  const { keyring, log, state } = fakeModule({ held: randomBytes(32) });
  const before = Buffer.from(state.held);
  const s = keyringOsStore({ keyring, item: ITEM, kind: 'keychain' });
  await assert.rejects(s.setKey(randomBytes(32)), { code: 'exists' });
  assert.equal(log.sets, 0);
  assert.ok(state.held.equals(before));
  const empty = fakeModule();
  const key = randomBytes(32);
  await keyringOsStore({ keyring: empty.keyring, item: ITEM, kind: 'keychain' }).setKey(key);
  assert.ok(empty.state.held.equals(key));
});

test('library errors map to locked or unavailable and keep no library text', async () => {
  const canary = 'CANARY-keyring-text-7f1e';
  const rows = [
    ['NoStorageAccess: ' + canary, 'locked'], ['the collection is Locked ' + canary, 'locked'], ['access denied ' + canary, 'locked'],
    ['user cancelled the prompt ' + canary, 'locked'], ['PlatformFailure ' + canary, 'unavailable'], [canary, 'unavailable'],
  ];
  for (const [msg, code] of rows) {
    const { keyring } = fakeModule({ getImpl: () => Promise.reject(new Error(msg)) });
    const err = await keyringOsStore({ keyring, item: ITEM, kind: 'secret-service' }).getKey().catch((e) => e);
    assert.equal(err.code, code, msg);
    for (const s of [err.message, err.stack, JSON.stringify(Object.getOwnPropertyDescriptors(err))]) assert.ok(!s.includes(canary));
  }
  // A constructor that throws (no Secret Service on Linux) maps too.
  class Throwing { constructor() { throw new Error('no secret service ' + canary); } }
  const err = await keyringOsStore({ keyring: { AsyncEntry: Throwing }, item: ITEM, kind: 'secret-service' }).getKey().catch((e) => e);
  assert.equal(err.code, 'unavailable');
  assert.ok(!err.message.includes(canary));
});

test('loadKeyring: null when the require throws, cached either way', () => {
  _resetKeyringForTests();
  let calls = 0;
  const throwing = () => { calls++; throw new Error('Cannot find module @napi-rs/keyring-darwin-arm64'); };
  assert.equal(loadKeyring({ requireImpl: throwing }), null);
  assert.equal(loadKeyring({ requireImpl: throwing }), null);
  assert.equal(calls, 1);
  _resetKeyringForTests();
  const mod = { AsyncEntry: class {} };
  assert.equal(loadKeyring({ requireImpl: (name) => (name === '@napi-rs/keyring' ? mod : null) }), mod);
  assert.equal(loadKeyring({ requireImpl: () => null }), mod);
  _resetKeyringForTests();
});

test('in-flight guard: 3 timed-out getKey calls on a hung store make 1 native call; once it settles, the next one reaches it', async () => {
  let release;
  let hang = true;
  const { keyring, log } = fakeModule({ getImpl: () => (hang ? new Promise((r) => { release = r; }) : Promise.resolve(null)) });
  const s = keyringOsStore({ keyring, item: ITEM, kind: 'secret-service' });
  for (let i = 0; i < 3; i++) await assert.rejects(callStore(s, 'getKey', [], { timeoutMs: 50 }), { code: 'store-locked', reason: 'timeout' });
  assert.equal(log.gets, 1);
  // A setKey waits on the pending read too: no native call while it is pending.
  await assert.rejects(callStore(s, 'setKey', [randomBytes(32)], { timeoutMs: 50 }), { code: 'store-locked' });
  assert.equal(log.gets, 1);
  assert.equal(log.sets, 0);
  hang = false;
  release(null);
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(await callStore(s, 'getKey', [], { timeoutMs: 1000 }), null);
  assert.ok(log.gets >= 2);
});

test('a timed-out setKey never writes later: the hung read is released, and 0 setSecret calls follow', async () => {
  let release;
  const { keyring, log } = fakeModule({ getImpl: () => new Promise((r) => { release = r; }) });
  const s = keyringOsStore({ keyring, item: ITEM, kind: 'keychain' });
  await assert.rejects(callStore(s, 'setKey', [randomBytes(32)], { timeoutMs: 50 }), { code: 'store-locked', reason: 'timeout' });
  release(null);
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(log.sets, 0);
});

test('primed: returned once within 1000 ms; a second getKey, or one after 1000 ms, asks the library', async () => {
  let t = 1_000_000;
  const now = () => t;
  const stored = randomBytes(32);
  const { keyring, log } = fakeModule({ held: stored });
  const s = keyringOsStore({ keyring, item: ITEM, kind: 'secret-service', now });
  const primedKey = Buffer.from(stored);
  s.prime(primedKey);
  t += 999;
  assert.equal(await s.getKey(), primedKey);
  assert.equal(log.gets, 0);
  assert.ok((await s.getKey()).equals(stored));
  assert.equal(log.gets, 1);
  const late = Buffer.from(stored);
  s.prime(late);
  t += 1001;
  const got = await s.getKey();
  assert.notEqual(got, late);
  assert.equal(log.gets, 2);
  assert.ok(late.equals(Buffer.alloc(32)), 'a dropped primed key is zeroed');
  // setKey drops a primed answer: a fresh item is never hidden behind a stale null.
  const fresh = fakeModule();
  const s2 = keyringOsStore({ keyring: fresh.keyring, item: ITEM, kind: 'secret-service', now });
  s2.prime(null);
  const key = randomBytes(32);
  await s2.setKey(key);
  assert.ok((await s2.getKey()).equals(key));
});

const PROBE_ITEM = { service: 'worca-cc', account: 'vault-probe-0123456789abcdef' };

// A per-account fake keyring for the probe: `items` maps account → bytes; `failGet` makes getSecret reject.
function accountKeyring({ failGet = false, readBack } = {}) {
  const items = new Map();
  const log = [];
  class AsyncEntry {
    constructor(service, account, options) { this.account = account; log.push({ op: 'new', account, options }); }
    async setSecret(secret) { log.push({ op: 'set', account: this.account }); items.set(this.account, Buffer.from(secret)); }
    async getSecret() {
      log.push({ op: 'get', account: this.account });
      if (failGet) throw new Error('PlatformFailure');
      const held = items.get(this.account);
      const back = held && readBack ? readBack(held) : held;
      return back ? [...back] : null;
    }
    async deleteCredential() { log.push({ op: 'delete', account: this.account }); return items.delete(this.account); }
  }
  return { keyring: { AsyncEntry }, items, log };
}

test('probe: writes, reads back, compares and deletes the probe entry only; the key item is never touched', async () => {
  const k = accountKeyring();
  const key = randomBytes(32);
  k.items.set(ITEM.account, key);
  const s = keyringOsStore({ keyring: k.keyring, item: ITEM, kind: 'keychain', probeItem: PROBE_ITEM });
  await s.probe();
  assert.deepEqual(k.log.filter((l) => l.op !== 'new').map((l) => `${l.op}:${l.account}`),
    ['set', 'get', 'delete'].map((op) => `${op}:${PROBE_ITEM.account}`));
  assert.ok(k.log.filter((l) => l.op === 'new').every((l) => l.account === PROBE_ITEM.account && l.options.linux.store === 'secret-service'));
  assert.deepEqual([...k.items.keys()], [ITEM.account]);
  assert.ok(k.items.get(ITEM.account).equals(key));
});

test('probe: a read failure, a missing or a different value still deletes the probe entry', async () => {
  for (const [opts, code] of [[{ failGet: true }, 'unavailable'], [{ readBack: () => null }, 'probe-missing'],
    [{ readBack: (b) => Buffer.from(b.map((x) => x ^ 1)) }, 'probe-mismatch']]) {
    const k = accountKeyring(opts);
    const s = keyringOsStore({ keyring: k.keyring, item: ITEM, kind: 'keychain', probeItem: PROBE_ITEM });
    await assert.rejects(s.probe(), { code });
    assert.equal(k.log.at(-1).op, 'delete', code);
    assert.equal(k.items.size, 0, code);
  }
});

test('probe: drops the one-shot primed key, so the next getKey asks the library', async () => {
  const k = accountKeyring();
  const key = randomBytes(32);
  k.items.set(ITEM.account, key);
  const s = keyringOsStore({ keyring: k.keyring, item: ITEM, kind: 'secret-service', probeItem: PROBE_ITEM });
  s.prime(Buffer.from(key));
  await s.probe();
  const gets = k.log.filter((l) => l.op === 'get' && l.account === ITEM.account).length;
  assert.ok((await s.getKey()).equals(key));
  assert.equal(k.log.filter((l) => l.op === 'get' && l.account === ITEM.account).length, gets + 1);
});

test('deleteKey: one native delete through the in-flight guard, after a pending get settles; errors keep no library text', async () => {
  let release;
  const key = randomBytes(32);
  const { keyring, log, state } = fakeModule({ held: key, getImpl: () => new Promise((r) => { release = () => r([...key]); }) });
  const s = keyringOsStore({ keyring, item: ITEM, kind: 'keychain' });
  const get = s.getKey();
  const del = s.deleteKey();
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(log.deletes ?? 0, 0, 'the delete waits for the pending get');
  release();
  assert.ok((await get).equals(key));
  assert.equal(await del, true);
  assert.equal(log.deletes, 1);
  assert.equal(state.held, null);
  const failing = fakeModule({ held: key });
  failing.keyring.AsyncEntry.prototype.deleteCredential = () => Promise.reject(new Error('NoStorageAccess CANARY-del'));
  const f = keyringOsStore({ keyring: failing.keyring, item: ITEM, kind: 'keychain' });
  await assert.rejects(f.deleteKey(), (err) => err.code === 'locked' && !String(err.message).includes('CANARY'));
});
