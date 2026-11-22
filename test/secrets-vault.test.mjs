// test/secrets-vault.test.mjs — the encrypted vault, in process, with the memory OS-store fake and temp homes.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createCipheriv, createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { createFakeOsStore, fakeAccounts, peekKey, writeFakeState } from './helpers/os-store-fake.mjs';
import { VAULT_FILE, VAULT_LOCK_FILE } from '../src/core/secrets/files.mjs';
import { VAULT_REF_PREFIX, VaultError as RefsVaultError } from '../src/core/secrets/refs.mjs';
import { TEST_OS_STORE_ENV, osItemName } from '../src/core/secrets/os-store.mjs';
import { createVault, vaultFile, assertVaultLockFree, openVaultIfEnabled, readVaultEntriesSync, VaultError } from '../src/core/secrets/vault.mjs';
import { withMcpLock } from '../src/core/mcp/store.mjs';

useTempHome(after, 'worca-vault-test-');
const ROOT = mkdtempSync(join(tmpdir(), 'worca-vault-'));
after(() => rmSync(ROOT, { recursive: true, force: true, maxRetries: 5 }));
const POSIX = process.platform !== 'win32';
let n = 0;
const newHome = () => mkdtempSync(join(ROOT, `h${++n}-`));
const fixture = (opts = {}, fakeOpts = {}) => {
  const home = newHome();
  const fake = createFakeOsStore(fakeOpts);
  return { home, fake, file: vaultFile(home), lock: join(home, VAULT_LOCK_FILE), vault: createVault({ home, store: fake, ...opts }) };
};
const ops = (fake) => fake.calls.map((c) => c.op);
const S = { store: 'settings', field: 'providers.openai.apiKey' };
const bytes = (f) => readFileSync(f);
const code = async (p) => { try { await p; } catch (e) { assert.ok(e instanceof VaultError, String(e)); return e; } assert.fail('expected a VaultError'); };
const within = (t0, ms = 5000) => assert.ok(Date.now() - t0 < ms, `took ${Date.now() - t0} ms`);

test('VaultError is the refs module\'s, and vaultFile is the home\'s VAULT_FILE', () => {
  assert.equal(VaultError, RefsVaultError);
  assert.equal(vaultFile('/h'), join('/h', VAULT_FILE));
});

test('round trip: 3 entries over 2 stores resolve, and list has no values', async () => {
  const { vault } = fixture();
  const items = [{ ...S, value: 'sk-one' }, { store: 'settings', field: 'providers.anthropic.apiKey', value: 'sk-two' }, { store: 'mcp', field: 'github.token', value: 'ghp-three' }];
  const refs = [];
  for (const it of items) refs.push(await vault.put(it));
  for (let i = 0; i < 3; i++) assert.equal(await vault.resolve(refs[i], items[i]), items[i].value);
  const rows = await vault.list();
  assert.equal(rows.length, 3);
  for (const r of rows) assert.deepEqual(Object.keys(r).sort(), ['field', 'ref', 'store']);
  assert.deepEqual(rows.map((r) => r.ref).sort(), [...refs].sort());
});

test('put with its own ref rewrites in place; remove gives true then false', async () => {
  const { vault } = fixture();
  const ref = await vault.put({ ...S, value: 'a' });
  assert.equal(await vault.put({ ...S, value: 'b', ref }), ref);
  assert.equal(await vault.resolve(ref, S), 'b');
  assert.equal((await vault.list()).length, 1);
  assert.equal(await vault.remove(ref, S), true);
  assert.equal(await vault.remove(ref, S), false);
  assert.deepEqual(await vault.list(), []);
});

test('mark sets and clears droppedAt; a marked entry still resolves, and a put in place drops the mark', async () => {
  const { vault } = fixture();
  const ref = await vault.put({ ...S, value: 'a' });
  assert.equal(await vault.transaction((tx) => tx.mark(ref, S, 1000)), true);
  assert.deepEqual(await vault.list(), [{ ref, ...S, droppedAt: 1000 }]);
  assert.equal(await vault.resolve(ref, S), 'a');
  assert.equal(await vault.transaction((tx) => tx.mark(ref, S, null)), true);
  assert.deepEqual(await vault.list(), [{ ref, ...S }]);
  await vault.transaction((tx) => tx.mark(ref, S, 2000));
  await vault.put({ ...S, value: 'b', ref });
  assert.deepEqual(await vault.list(), [{ ref, ...S }]);
  assert.equal(await vault.transaction((tx) => tx.mark(`${VAULT_REF_PREFIX}${'B'.repeat(22)}`, S, 1)), false);
  assert.equal((await code(vault.transaction((tx) => tx.mark(ref, { ...S, field: 'other' }, 1)))).code, 'cross-owner');
});

test('put with droppedAt is born marked in the same save; an invalid mark is bad-value and the file is unchanged', async () => {
  const { vault, fake, file } = fixture();
  const ref = await vault.transaction((tx) => tx.put({ ...S, value: 'pending', droppedAt: 1234 }));
  assert.deepEqual(await vault.list(), [{ ref, ...S, droppedAt: 1234 }]);
  assert.equal(await vault.resolve(ref, S), 'pending');
  const before = bytes(file);
  const sets = ops(fake).length;
  for (const droppedAt of [-1, 1.5, '1', Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal((await code(vault.transaction((tx) => tx.put({ ...S, value: 'x', droppedAt })))).code, 'bad-value');
  }
  assert.deepEqual(bytes(file), before);
  assert.ok(ops(fake).slice(sets).every((op) => op === 'getKey'), 'no setKey for a refused mark');
});

test('bad owner and bad value are refused', async () => {
  const { vault } = fixture();
  assert.equal((await code(vault.put({ store: 'nope', field: 'x', value: 'v' }))).code, 'bad-owner');
  for (const value of ['', 42, null, 'x'.repeat(65537), 'é'.repeat(32769)]) assert.equal((await code(vault.put({ ...S, value }))).code, 'bad-value');
  assert.ok(await vault.put({ ...S, value: 'x'.repeat(65536) }));
});

test('mode: 0600 after the first and the tenth write, under umask 022', { skip: !POSIX }, async () => {
  const prev = process.umask(0o022);
  try {
    const { vault, file } = fixture();
    await vault.put({ ...S, value: 'v0' });
    assert.equal(statSync(file).mode & 0o777, 0o600);
    for (let i = 1; i < 10; i++) await vault.put({ ...S, value: `v${i}` });
    assert.equal(statSync(file).mode & 0o777, 0o600);
  } finally { process.umask(prev); }
});

test('fresh nonce: 50 writes of the same content give 50 distinct nonces and data', async () => {
  const { vault, file } = fixture();
  const ref = await vault.put({ ...S, value: 'same' });
  const nonces = new Set(); const datas = new Set();
  for (let i = 0; i < 50; i++) {
    await vault.put({ ...S, value: 'same', ref });
    const env = JSON.parse(readFileSync(file, 'utf8'));
    nonces.add(env.nonce); datas.add(env.data);
  }
  assert.equal(nonces.size, 50);
  assert.equal(datas.size, 50);
});

test('envelope: exactly format, keyId, nonce, tag, data; no value in the bytes', async () => {
  const { vault, file, fake } = fixture();
  await vault.put({ ...S, value: 'sk-visible-if-plain' });
  const raw = readFileSync(file, 'utf8');
  const env = JSON.parse(raw);
  assert.deepEqual(Object.keys(env).sort(), ['data', 'format', 'keyId', 'nonce', 'tag']);
  assert.equal(env.format, 1);
  assert.match(env.keyId, /^[0-9a-f]{16}$/);
  assert.equal(env.keyId, createHash('sha256').update(Buffer.concat([Buffer.from('worca vault key id'), Buffer.from([0]), fake.peekKey()])).digest('hex').slice(0, 16));
  assert.equal(Buffer.from(env.nonce, 'base64').length, 12);
  assert.equal(Buffer.from(env.tag, 'base64').length, 16);
  assert.ok(!raw.includes('sk-visible-if-plain') && !raw.includes('providers.openai'));
});

const flip = (b64) => { const b = Buffer.from(b64, 'base64'); b[b.length >> 1] ^= 0x01; return b.toString('base64'); };

test('tamper: each damaged vault is refused, a put after it too, and the bytes stay unchanged', async () => {
  const variants = {
    data: (raw) => { const e = JSON.parse(raw); e.data = flip(e.data); return JSON.stringify(e); },
    tag: (raw) => { const e = JSON.parse(raw); e.tag = flip(e.tag); return JSON.stringify(e); },
    nonce: (raw) => { const e = JSON.parse(raw); e.nonce = flip(e.nonce); return JSON.stringify(e); },
    'tag 12 bytes': (raw) => { const e = JSON.parse(raw); e.tag = Buffer.from(e.tag, 'base64').subarray(0, 12).toString('base64'); return JSON.stringify(e); },
    truncated: (raw) => raw.slice(0, raw.length >> 1),
    'not JSON': () => 'hello, vault',
  };
  for (const [name, edit] of Object.entries(variants)) {
    const { vault, file } = fixture();
    const ref = await vault.put({ ...S, value: 'v' });
    writeFileSync(file, edit(readFileSync(file, 'utf8')));
    const before = bytes(file);
    assert.equal((await code(vault.resolve(ref, S))).code, 'tampered', name);
    assert.equal((await code(vault.put({ ...S, value: 'w' }))).code, 'tampered', name);
    assert.ok(bytes(file).equals(before), name);
  }
});

test('header: an edited keyId is wrong-key, format 2 is unsupported-format', async () => {
  const { vault, file } = fixture();
  const ref = await vault.put({ ...S, value: 'v' });
  const env = JSON.parse(readFileSync(file, 'utf8'));
  writeFileSync(file, JSON.stringify({ ...env, keyId: env.keyId.replace(/^./, (c) => (c === '0' ? '1' : '0')) }));
  assert.equal((await code(vault.resolve(ref, S))).code, 'wrong-key');
  writeFileSync(file, JSON.stringify({ ...env, format: 2 }));
  const e = await code(vault.resolve(ref, S));
  assert.equal(e.code, 'unsupported-format');
  assert.equal(e.message, 'the vault file was written by a newer Worca (format 2)');
});

test('wrong key: a vault written under fake A, read with different-key, is refused and unchanged', async () => {
  const { home, file, vault } = fixture();
  const ref = await vault.put({ ...S, value: 'v' });
  const before = bytes(file);
  const other = createVault({ home, store: createFakeOsStore({ state: 'different-key' }) });
  assert.equal((await code(other.resolve(ref, S))).code, 'wrong-key');
  assert.equal((await code(other.put({ ...S, value: 'w' }))).code, 'wrong-key');
  assert.ok(bytes(file).equals(before));
});

test('item missing: a present vault with no key is refused and setKey is never called', async () => {
  const { home, file, vault } = fixture();
  const ref = await vault.put({ ...S, value: 'v' });
  const before = bytes(file);
  const fake = createFakeOsStore({ state: 'item-missing' });
  const v2 = createVault({ home, store: fake });
  assert.equal((await code(v2.resolve(ref, S))).code, 'item-missing');
  assert.equal((await code(v2.put({ ...S, value: 'w' }))).code, 'item-missing');
  assert.equal(ops(fake).filter((o) => o === 'setKey').length, 0);
  assert.ok(bytes(file).equals(before));
});

test('first key: getKey, setKey, getKey read-back, then the vault', async () => {
  const { vault, fake, file } = fixture();
  await vault.put({ ...S, value: 'v' });
  assert.deepEqual(ops(fake), ['getKey', 'setKey', 'getKey']);
  assert.ok(existsSync(file));
});

test('first key: a failing, hanging or dropped setKey leaves no vault, no lock, and a later put works', async () => {
  const cases = [
    { failSetKey: 'locked', want: 'store-locked', calls: ['getKey', 'setKey'] },
    { failSetKey: 'never-answers', want: 'store-locked', reason: 'timeout', calls: ['getKey', 'setKey'] },
    { failSetKey: 'drop', want: 'store-unavailable', calls: ['getKey', 'setKey', 'getKey'] },
  ];
  for (const c of cases) {
    const home = newHome();
    const fake = createFakeOsStore({ failSetKey: c.failSetKey });
    const vault = createVault({ home, store: fake, storeTimeoutMs: 50 });
    const t0 = Date.now();
    const e = await code(vault.put({ ...S, value: 'v' }));
    within(t0);
    assert.equal(e.code, c.want, c.failSetKey);
    assert.equal(e.reason, c.reason, c.failSetKey);
    assert.deepEqual(ops(fake), c.calls, c.failSetKey);
    assert.ok(!existsSync(vaultFile(home)) && !existsSync(join(home, VAULT_LOCK_FILE)), c.failSetKey);
    const healthy = createFakeOsStore();
    const v2 = createVault({ home, store: healthy });
    const ref = await v2.put({ ...S, value: 'ok' });
    assert.equal(await v2.resolve(ref, S), 'ok');
  }
});

test('late setKey: a timed-out first setKey that lands later never replaces the key a later write used', async () => {
  const home = newHome();
  const fake = createFakeOsStore({ failSetKey: 'late' });
  const vault = createVault({ home, store: fake, storeTimeoutMs: 50 });
  const e = await code(vault.put({ ...S, value: 'first' }));
  assert.equal(e.code, 'store-locked');
  assert.ok(!existsSync(vaultFile(home)));
  const ref = await vault.put({ ...S, value: 'second' });
  const used = fake.peekKey();
  await fake.landLate();
  assert.ok(fake.peekKey().equals(used));
  const fresh = createVault({ home, store: fake });
  assert.equal(await fresh.resolve(ref, S), 'second');
});

test('first key: a setKey refused because the item exists re-reads getKey and uses that key', async () => {
  const home = newHome();
  const held = randomBytes(32);
  const fake = createFakeOsStore();
  // Another writer's key lands between our getKey (null) and our setKey.
  const store = { kind: 'fake', getKey: () => fake.getKey(), setKey: async (k) => { await fake.setKey(held); return fake.setKey(k); } };
  const vault = createVault({ home, store });
  const ref = await vault.put({ ...S, value: 'v' });
  assert.ok(fake.peekKey().equals(held));
  assert.equal(await createVault({ home, store: fake }).resolve(ref, S), 'v');
});

test('transaction: an un-awaited tx.put whose getKey is slow rejects, and the next writer\'s entry survives', async () => {
  const { vault, fake } = fixture();
  const seed = await vault.put({ ...S, value: 'seed' });
  let gate = null; let release;
  const slowGetKey = fake.getKey.bind(fake);
  fake.getKey = async () => { if (gate) { const g = gate; gate = null; await g; } return slowGetKey(); };
  gate = new Promise((r) => { release = r; });
  let late;
  await vault.transaction(async (tx) => { late = tx.put({ store: 'mcp', field: 'a', value: 'late' }); late.catch(() => {}); });
  const next = await vault.put({ store: 'mcp', field: 'b', value: 'next' });
  release();
  await assert.rejects(late, /after the transaction/);
  const list = await vault.list();
  assert.deepEqual(list.map((e) => e.ref).sort(), [seed, next].sort());
  assert.equal(await vault.resolve(next, { store: 'mcp', field: 'b' }), 'next');
});

test('write re-check: the key item deleted after a put makes the next put item-missing, unchanged bytes', async () => {
  const { vault, fake, file } = fixture();
  await vault.put({ ...S, value: 'v' });
  const before = bytes(file);
  fake.setState('item-missing');
  assert.equal((await code(vault.put({ ...S, value: 'w' }))).code, 'item-missing');
  assert.ok(bytes(file).equals(before));
});

test('missing vault: resolve is unknown-ref and the store is never asked', async () => {
  const { vault, fake } = fixture();
  assert.equal((await code(vault.resolve(VAULT_REF_PREFIX + 'A'.repeat(22), S))).code, 'unknown-ref');
  assert.deepEqual(await vault.list(), []);
  assert.equal(fake.calls.length, 0);
});

test('cross owner: another store or field is refused for resolve, put(ref) and remove', async () => {
  const { vault } = fixture();
  const ref = await vault.put({ ...S, value: 'secret' });
  for (const owner of [{ store: 'mcp', field: S.field }, { store: 'settings', field: 'providers.anthropic.apiKey' }]) {
    assert.equal((await code(vault.resolve(ref, owner))).code, 'cross-owner');
    assert.equal((await code(vault.put({ ...owner, value: 'x', ref }))).code, 'cross-owner');
    assert.equal((await code(vault.remove(ref, owner))).code, 'cross-owner');
  }
  assert.equal(await vault.resolve(ref, S), 'secret');
});

test('bad ref and unknown ref: refused, never adopted', async () => {
  const { vault } = fixture();
  await vault.put({ ...S, value: 'v' });
  const before = await vault.list();
  assert.equal((await code(vault.resolve('sk-abc', S))).code, 'bad-ref');
  assert.equal((await code(vault.put({ ...S, value: 'x', ref: 'sk-abc' }))).code, 'bad-ref');
  const unknown = VAULT_REF_PREFIX + 'B'.repeat(22);
  assert.equal((await code(vault.resolve(unknown, S))).code, 'unknown-ref');
  assert.equal((await code(vault.put({ ...S, value: 'x', ref: unknown }))).code, 'unknown-ref');
  assert.deepEqual(await vault.list(), before);
});

test('store states: refusals are not cached, a later call succeeds', async () => {
  for (const [state, want, reason] of [['unavailable', 'store-unavailable'], ['locked', 'store-locked'], ['never-answers', 'store-locked', 'timeout']]) {
    const home = newHome();
    const fake = createFakeOsStore({ state });
    const vault = createVault({ home, store: fake, storeTimeoutMs: 50 });
    const t0 = Date.now();
    const e = await code(vault.put({ ...S, value: 'v' }));
    within(t0);
    assert.equal(e.code, want, state);
    assert.equal(e.reason, reason, state);
    fake.setState('available');
    const ref = await vault.put({ ...S, value: 'v' });
    // And on a present vault, a read under a failing store is refused, then works again.
    const v2 = createVault({ home, store: fake, storeTimeoutMs: 50 });
    fake.setState(state);
    assert.equal((await code(v2.resolve(ref, S))).code, want, state);
    fake.setState('available');
    assert.equal(await v2.resolve(ref, S), 'v');
  }
});

test('key cache: 20 resolves make exactly 1 getKey', async () => {
  const { home, vault, fake } = fixture();
  const ref = await vault.put({ ...S, value: 'v' });
  const reader = createVault({ home, store: fake });
  const before = fake.calls.length;
  for (let i = 0; i < 20; i++) assert.equal(await reader.resolve(ref, S), 'v');
  assert.deepEqual(fake.calls.slice(before).map((c) => c.op), ['getKey']);
});

test('key cache: a cached key that no longer matches is dropped and fetched once more', async () => {
  const { home, vault, fake } = fixture();
  const ref = await vault.put({ ...S, value: 'v' });
  // Another writer replaces the vault under a new key the shared fake now holds.
  rmSync(vaultFile(home));
  fake.setState('item-missing');
  const writer = createVault({ home, store: fake });
  const ref2 = await writer.put({ ...S, value: 'w' });
  const before = fake.calls.length;
  assert.equal((await code(vault.resolve(ref, S))).code, 'unknown-ref');
  assert.equal(await vault.resolve(ref2, S), 'w');
  assert.deepEqual(fake.calls.slice(before).map((c) => c.op), ['getKey']);
});

// The plaintext an attacker with the right key could plant: non-JSON text, under a correct envelope.
function plantPlaintext(file, key, text) {
  const keyId = createHash('sha256').update(Buffer.concat([Buffer.from('worca vault key id'), Buffer.from([0]), key])).digest('hex').slice(0, 16);
  const nonce = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key, nonce, { authTagLength: 16 });
  c.setAAD(Buffer.from(`worca vault format=1 keyId=${keyId}`, 'utf8'));
  const data = Buffer.concat([c.update(text, 'utf8'), c.final()]);
  writeFileSync(file, JSON.stringify({ format: 1, keyId, nonce: nonce.toString('base64'), tag: c.getAuthTag().toString('base64'), data: data.toString('base64') }));
}

test('canary: no refusal carries a value, the store\'s text or the key', async () => {
  const VALUE = 'CANARY-value-5d1e';
  const STORE_TEXT = 'CANARY-store-text-0b7a';
  const PLAIN = 'CANARY-plaintext-a3f9';
  const errs = [];
  const { home, vault, fake, file } = fixture();
  const ref = await vault.put({ ...S, value: VALUE });
  const key = fake.peekKey();
  errs.push(await code(vault.resolve(ref, { store: 'mcp', field: 'x' })));
  errs.push(await code(vault.put({ store: 'mcp', field: 'x', value: VALUE, ref })));
  const throwing = { kind: 'fake', getKey: async () => { throw Object.assign(new Error(STORE_TEXT), { code: 'locked' }); }, setKey: async () => { throw new Error(STORE_TEXT); } };
  errs.push(await code(createVault({ home, store: throwing }).resolve(ref, S)));
  errs.push(await code(createVault({ home: newHome(), store: throwing }).put({ ...S, value: VALUE })));
  errs.push(await code(createVault({ home, store: createFakeOsStore({ state: 'different-key' }) }).resolve(ref, S)));
  plantPlaintext(file, key, `${PLAIN} not json`);
  const e = await code(createVault({ home, store: fake }).resolve(ref, S));
  assert.equal(e.code, 'tampered');
  errs.push(e);
  const needles = [VALUE, STORE_TEXT, PLAIN, key.toString('hex'), key.toString('base64'), key.toString('base64url')];
  for (const err of errs) {
    assert.equal(err.cause, undefined);
    const own = Object.fromEntries(Object.getOwnPropertyNames(err).map((k) => [k, String(err[k])]));
    for (const s of [err.message, err.stack, String(err), JSON.stringify(own)]) {
      for (const nd of needles) assert.ok(!s.includes(nd), `${err.code} leaks ${nd.slice(0, 12)}`);
    }
  }
});

test('plaintext that is JSON but not the entry shape is tampered', async () => {
  for (const text of ['{}', '{"entries":[]}', '{"entries":{"short":{"store":"settings","field":"f","value":"v"}}}',
    `{"entries":{"${'A'.repeat(22)}":{"store":"nope","field":"f","value":"v"}}}`, `{"entries":{"${'A'.repeat(22)}":{"store":"settings","field":"f","value":""}}}`,
    `{"entries":{"${'A'.repeat(22)}":{"store":"settings","field":"f","value":"v","droppedAt":"soon"}}}`]) {
    const { vault, fake, file } = fixture();
    await vault.put({ ...S, value: 'v' });
    plantPlaintext(file, fake.peekKey(), text);
    assert.equal((await code(vault.list())).code, 'tampered', text);
  }
});

test('transaction: put, resolve and a caller callback under one lock; a kept tx throws', async () => {
  const { vault, lock } = fixture();
  let kept; const tokens = [];
  const tok = () => JSON.parse(readFileSync(lock, 'utf8')).token;
  const out = await vault.transaction(async (tx) => {
    kept = tx;
    tokens.push(tok());
    const ref = await tx.put({ ...S, value: 'v' });
    tokens.push(tok());
    const val = await tx.resolve(ref, S);
    const cb = await (async () => { tokens.push(tok()); return 'callback ran'; })();
    assert.equal((await tx.list()).length, 1);
    return { ref, val, cb };
  });
  assert.equal(out.val, 'v');
  assert.equal(out.cb, 'callback ran');
  assert.equal(new Set(tokens).size, 1);
  assert.ok(!existsSync(lock));
  for (const call of [() => kept.put({ ...S, value: 'x' }), () => kept.resolve(out.ref, S), () => kept.remove(out.ref, S), () => kept.list()]) {
    await assert.rejects(async () => call(), /after the transaction/);
  }
});

test('lock: a nested transaction rejects lock-nested at once, the token unchanged; the outer completes', async () => {
  const { vault, lock } = fixture({ lockTimeoutMs: 30_000 });
  const other = createVault({ home: newHome(), store: createFakeOsStore(), lockTimeoutMs: 30_000 });
  const out = await vault.transaction(async (tx) => {
    const before = readFileSync(lock, 'utf8');
    for (const p of [() => vault.transaction(() => 1), () => vault.put({ ...S, value: 'x' }), () => other.transaction(() => 1), () => other.list()]) {
      const t0 = Date.now();
      assert.equal((await code(p())).code, 'lock-nested');
      within(t0);
    }
    assert.equal(readFileSync(lock, 'utf8'), before);
    assert.throws(() => assertVaultLockFree('mcp'), (e) => e instanceof VaultError && e.code === 'lock-order' &&
      e.message === 'cannot wait on the mcp lock while holding the vault lock');
    return tx.put({ ...S, value: 'outer' });
  });
  assert.equal(await vault.resolve(out, S), 'outer');
  assert.doesNotThrow(() => assertVaultLockFree('mcp'));
});

test('lock: the store lock first, then the vault lock, works', async () => {
  const { vault } = fixture();
  const ref = await withMcpLock(() => vault.put({ ...S, value: 'v' }));
  assert.equal(await vault.resolve(ref, S), 'v');
});

test('lock: 20 concurrent puts leave 20 entries', async () => {
  const { vault } = fixture();
  const refs = await Promise.all(Array.from({ length: 20 }, (_, i) => vault.put({ store: 'plugin', field: `f${i}`, value: `v${i}` })));
  assert.equal(new Set(refs).size, 20);
  assert.equal((await vault.list()).length, 20);
});

test('lock busy: a foreign live lock gives lock-busy with the fixed message, bytes unchanged', async () => {
  const { vault, file, lock } = fixture({ lockTimeoutMs: 200 });
  await vault.put({ ...S, value: 'v' });
  const before = bytes(file);
  writeFileSync(lock, JSON.stringify({ pid: process.ppid, token: 'foreign', at: new Date().toISOString() }));
  try {
    const e = await code(vault.put({ ...S, value: 'w' }));
    assert.equal(e.code, 'lock-busy');
    assert.equal(e.message, 'another Worca process holds the vault lock; try again');
    assert.ok(!e.stack.includes(lock));
    assert.ok(bytes(file).equals(before));
  } finally { rmSync(lock, { force: true }); }
});

test('flag gate: off returns null without resolving the home; on with the switch returns a vault', async () => {
  const prev = { FLAGS: process.env.WORCA_FLAGS, HOME: process.env.WORCA_HOME, SW: process.env[TEST_OS_STORE_ENV] };
  after(() => {
    for (const [k, v] of [['WORCA_FLAGS', prev.FLAGS], ['WORCA_HOME', prev.HOME], [TEST_OS_STORE_ENV, prev.SW]]) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  });
  process.env.WORCA_FLAGS = '-secretVault';
  delete process.env.WORCA_HOME;
  assert.equal(await openVaultIfEnabled(), null);
  process.env.WORCA_HOME = prev.HOME;
  process.env.WORCA_FLAGS = 'secretVault';
  const state = join(ROOT, 'flag-fake', 'state.json');
  process.env[TEST_OS_STORE_ENV] = state;
  const home = newHome();
  const v = await openVaultIfEnabled({ home });
  assert.ok(v);
  const ref = await v.put({ ...S, value: 'v' });
  assert.equal(await v.resolve(ref, S), 'v');
  assert.ok(existsSync(vaultFile(home)));
});

test('two homes on one shared fake state file: each vault reads its own value, and the file holds exactly 2 items', async () => {
  const prev = process.env.WORCA_FLAGS;
  process.env.WORCA_FLAGS = 'secretVault';
  try {
    const state = join(ROOT, 'two-homes', 'state.json');
    writeFakeState(state, { state: 'available' });
    const env = { [TEST_OS_STORE_ENV]: state, NODE_TEST_CONTEXT: 'child-v8', WORCA_FLAGS: 'secretVault' };
    const [homeA, homeB] = [newHome(), newHome()];
    const a = await openVaultIfEnabled({ home: homeA, env });
    const b = await openVaultIfEnabled({ home: homeB, env });
    const refA = await a.put({ ...S, value: 'value-a' });
    const refB = await b.put({ ...S, value: 'value-b' });
    assert.equal(await a.resolve(refA, S), 'value-a');
    assert.equal(await b.resolve(refB, S), 'value-b');
    assert.deepEqual(fakeAccounts(state), [osItemName(homeA).account, osItemName(homeB).account].sort());
    assert.ok(!peekKey(state, osItemName(homeA)).equals(peekKey(state, osItemName(homeB))));
  } finally {
    if (prev === undefined) delete process.env.WORCA_FLAGS; else process.env.WORCA_FLAGS = prev;
  }
});

test('an unreadable vault never mints a key: item-missing, wrong-key and tampered each make 0 setKey calls on put', async () => {
  for (const want of ['item-missing', 'wrong-key', 'tampered']) {
    const { vault, fake, file, home } = fixture();
    await vault.put({ ...S, value: 'v' });
    if (want === 'tampered') writeFileSync(file, JSON.stringify({ ...JSON.parse(readFileSync(file, 'utf8')), tag: Buffer.alloc(16, 9).toString('base64') }));
    let store = fake;
    if (want === 'item-missing') fake.setState('item-missing');
    if (want === 'wrong-key') store = createFakeOsStore({ state: 'different-key' });
    const before = readFileSync(file);
    const again = createVault({ home, store });
    const calls = store.calls.length;
    assert.equal((await code(again.put({ ...S, value: 'w' }))).code, want);
    assert.ok(!store.calls.slice(calls).some((c) => c.op === 'setKey'), want);
    assert.ok(readFileSync(file).equals(before), want);
  }
});

test('the call after a timeout asks the store again', async () => {
  const { vault, fake } = fixture({ storeTimeoutMs: 50 });
  const ref = await vault.put({ ...S, value: 'v' });
  fake.setState('never-answers');
  const e = await code(vault.put({ ...S, value: 'w' }));
  assert.equal(e.code, 'store-locked');
  assert.equal(e.reason, 'timeout');
  fake.setState('available');
  const before = fake.calls.filter((c) => c.op === 'getKey').length;
  assert.equal(await vault.resolve(ref, S), 'v');
  assert.equal(fake.calls.filter((c) => c.op === 'getKey').length, before + 1, 'the timed-out key is not reused from a cache');
});

test('readVaultEntriesSync round-trips and refuses a wrong key and a tampered file', async () => {
  const { fake, file, vault } = fixture();
  assert.equal(readVaultEntriesSync(file, randomBytes(32)), null);   // missing file
  const ref = await vault.put({ ...S, value: 'sk-sync' });
  const key = fake.peekKey();
  const r = readVaultEntriesSync(file, key);
  assert.match(r.keyId, /^[0-9a-f]{16}$/);
  assert.deepEqual(r.entries[ref.slice(VAULT_REF_PREFIX.length)], { ...S, value: 'sk-sync' });
  assert.equal((() => { try { readVaultEntriesSync(file, randomBytes(32)); } catch (e) { return e.code; } })(), 'wrong-key');
  const buf = readFileSync(file);
  const env = JSON.parse(buf);
  const data = Buffer.from(env.data, 'base64');
  data[0] ^= 1;
  writeFileSync(file, JSON.stringify({ ...env, data: data.toString('base64') }));
  assert.equal((() => { try { readVaultEntriesSync(file, key); } catch (e) { return e instanceof VaultError && e.code; } })(), 'tampered');
});

// ---- deleteVault (export) ----

const { deleteVault, entryDigest, inspectVault } = await import('../src/core/secrets/vault.mjs');
const { refId } = await import('../src/core/secrets/refs.mjs');

// The step-5 snapshot export takes: every entry id → its digest, read through a transaction.
async function snapshotOf(vault) {
  return vault.transaction(async (tx) => {
    const m = new Map();
    for (const e of await tx.list()) m.set(refId(e.ref), entryDigest({ ...e, value: await tx.resolve(e.ref, e) }));
    return m;
  });
}

test('deleteVault removes the file and the item; inspectVault counts entries, dropped ones too', async () => {
  const { home, fake, file, vault } = fixture();
  const a = await vault.put({ ...S, value: 'sk-a' });
  await vault.put({ store: 'mcp', field: 'gh/token', value: 'ghp-b', droppedAt: 5 });
  assert.equal((await inspectVault({ home, store: fake })).entries, 2);
  const snap = await snapshotOf(vault);
  assert.equal(snap.size, 2);
  assert.ok(!JSON.stringify([...snap]).includes('sk-a'));
  const r = await deleteVault({ home, store: fake, snapshot: snap });
  assert.deepEqual(r, { vaultRemoved: true, keyRemoved: true });
  assert.equal(existsSync(file), false);
  assert.equal(fake.peekKey(), null);
  assert.ok(ops(fake).includes('deleteKey'));
  assert.ok(a);
});

test('deleteVault refuses changed for an entry sealed or re-marked after the snapshot; one removed since is fine', async () => {
  for (const change of ['sealed', 'marked']) {
    const { home, fake, file, vault } = fixture();
    const ref = await vault.put({ ...S, value: 'sk-a' });
    const snap = await snapshotOf(vault);
    if (change === 'sealed') await vault.put({ store: 'proxy', field: 'login.ntHash', value: 'f'.repeat(32) });
    else await vault.transaction((tx) => tx.mark(ref, S, 7));
    const before = bytes(file);
    const e = await code(deleteVault({ home, store: fake, snapshot: snap }));
    assert.equal(e.code, 'changed', change);
    assert.deepEqual(bytes(file), before, `${change}: the vault stays`);
    assert.ok(fake.peekKey(), `${change}: the item stays`);
    assert.ok(!ops(fake).includes('deleteKey'));
  }
  const { home, fake, file, vault } = fixture();
  const keep = await vault.put({ ...S, value: 'sk-keep' });
  const gone = await vault.put({ store: 'settings', field: 'providers.anthropic.apiKey', value: 'sk-gone' });
  const snap = await snapshotOf(vault);
  await vault.remove(gone, { store: 'settings', field: 'providers.anthropic.apiKey' });
  assert.deepEqual(await deleteVault({ home, store: fake, snapshot: snap }), { vaultRemoved: true, keyRemoved: true });
  assert.equal(existsSync(file), false);
  assert.ok(keep);
});

test('deleteVault: a busy lock removes nothing (lock-busy); a failed key delete is returned as keyError', async () => {
  const { home, fake, file, lock, vault } = fixture();
  await vault.put({ ...S, value: 'sk-a' });
  const snap = await snapshotOf(vault);
  writeFileSync(lock, JSON.stringify({ pid: process.ppid, token: 'foreign', at: new Date().toISOString() }));
  const e = await code(deleteVault({ home, store: fake, snapshot: snap, lockTimeoutMs: 150 }));
  assert.equal(e.code, 'lock-busy');
  assert.ok(existsSync(file));
  assert.ok(fake.peekKey());
  rmSync(lock, { force: true });
  const failing = Object.assign(Object.create(fake), { deleteKey: async () => { throw Object.assign(new Error('x'), { code: 'locked' }); } });
  const r = await deleteVault({ home, store: failing, snapshot: snap });
  assert.deepEqual(r, { vaultRemoved: true, keyRemoved: false, keyError: 'store-locked' });
  assert.equal(existsSync(file), false);
});

test('deleteVault deletes the key under the vault lock: a seal racing it waits, then lands in a fresh vault under a fresh key', async () => {
  const { home, fake, file, lock, vault } = fixture();
  await vault.put({ ...S, value: 'sk-a' });
  const snap = await snapshotOf(vault);
  const other = createVault({ home, store: fake });
  let racing = null;
  let lockHeld = null;
  const hooked = Object.assign(Object.create(fake), {
    deleteKey: async (...a) => {
      lockHeld = existsSync(lock);
      racing = other.put({ store: 'proxy', field: 'login.ntHash', value: 'f'.repeat(32) });
      await new Promise((r) => setTimeout(r, 100));
      assert.equal(existsSync(file), false, 'the seal has not written while the key is being deleted');
      return fake.deleteKey(...a);
    },
  });
  assert.deepEqual(await deleteVault({ home, store: hooked, snapshot: snap }), { vaultRemoved: true, keyRemoved: true });
  assert.equal(lockHeld, true, 'deleteKey ran under the vault lock');
  const ref = await racing;
  assert.ok(existsSync(file), 'the racing seal wrote a new vault');
  assert.equal(await createVault({ home, store: fake }).resolve(ref, { store: 'proxy', field: 'login.ntHash' }), 'f'.repeat(32));
});
