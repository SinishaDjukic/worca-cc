// test/secrets-store-vault.test.mjs — the MCP, plugin and proxy stores' seal and release (store-vault.mjs), in
// process over the file-backed OS-store fake (secretVault on). Each case gets its own Worca home and fake state file,
// passed through the `env` option, so one home's primed key never answers for another.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFakeOsStore, fileFakeOsStore, readFakeCalls, writeFakeState } from './helpers/os-store-fake.mjs';

const ROOT = mkdtempSync(join(tmpdir(), 'worca-store-vault-'));
const KEYS = ['HOME', 'USERPROFILE', 'WORCA_HOME', 'WORCA_TEST_ALLOW_HOME_FALLBACK', 'WORCA_FLAGS', 'WORCA_TEST_OS_STORE'];
const prev = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
const STATE = join(ROOT, 'fake', 'state.json');
writeFakeState(STATE, { state: 'available' });
Object.assign(process.env, {
  HOME: join(ROOT, 'home'), USERPROFILE: join(ROOT, 'home'), WORCA_HOME: join(ROOT, 'worca'),
  WORCA_TEST_ALLOW_HOME_FALLBACK: '1', WORCA_FLAGS: 'secretVault', WORCA_TEST_OS_STORE: STATE,
});
mkdirSync(process.env.HOME, { recursive: true });
after(() => {
  for (const [k, v] of Object.entries(prev)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  chmodSync(ROOT, 0o700);
  rmSync(ROOT, { recursive: true, force: true, maxRetries: 5 });
});

const { sealStoreSecrets, releaseStoreRefs, refsDropped, LOCKLESS_GRACE_MS } = await import('../src/core/secrets/store-vault.mjs');
const { isVaultRef, newVaultRef, ownerField } = await import('../src/core/secrets/refs.mjs');
const { createVault, vaultFile } = await import('../src/core/secrets/vault.mjs');
const { osItemName } = await import('../src/core/secrets/os-store.mjs');
const { resolveVaultRefSync } = await import('../src/core/secrets/settings-resolver.mjs');

let n = 0;
/** A fresh Worca home with its own fake state file; `state` the fake's state. */
function fresh(state = 'available') {
  const dir = mkdtempSync(join(ROOT, `case${++n}-`));
  const home = join(dir, 'worca');
  mkdirSync(home);
  const statePath = join(dir, 'fake.json');
  writeFakeState(statePath, { state });
  const env = { ...process.env, WORCA_TEST_OS_STORE: statePath };
  const vault = () => createVault({ home, store: fileFakeOsStore(statePath, { item: osItemName(home) }) });
  return { dir, home, statePath, env, vault, calls: () => readFakeCalls(statePath).length };
}
const entries = (c) => c.vault().list();

test('seal puts one fresh entry per item, and a re-save of a field puts a fresh reference', async () => {
  const c = fresh();
  const { values } = await sealStoreSecrets('mcp', [
    { field: 'manual:gh/token', value: 'ghp-value-0001', current: undefined },
    { field: 'manual:gh/other', value: '  padded-0002  ', current: undefined },
  ], { home: c.home, env: c.env });
  assert.ok(values.every(isVaultRef), JSON.stringify(values));
  assert.notEqual(values[0], values[1]);
  const list = await entries(c);
  assert.equal(list.length, 2);
  assert.deepEqual(list.map((e) => e.store), ['mcp', 'mcp']);
  assert.equal(await c.vault().resolve(values[1], { store: 'mcp', field: 'manual:gh/other' }), 'padded-0002');
  const again = await sealStoreSecrets('mcp', [{ field: 'manual:gh/token', value: 'ghp-value-0003', current: values[0] }], { home: c.home, env: c.env });
  assert.ok(isVaultRef(again.values[0]));
  assert.notEqual(again.values[0], values[0]);
  assert.equal(await c.vault().resolve(values[0], { store: 'mcp', field: 'manual:gh/token' }), 'ghp-value-0001', 'the old entry is left for the release');
});

test('{$env}, empty, null and unchanged items make no store call', async () => {
  const c = fresh();
  const ref = newVaultRef();
  const items = [
    { field: 'a/b', value: { $env: 'MCP_TOKEN' }, current: undefined },
    { field: 'a/c', value: '', current: undefined },
    { field: 'a/d', value: null, current: undefined },
    { field: 'a/e', value: ref, current: ref },
    { field: 'a/f', value: 'same', current: 'same' },
  ];
  const r = await sealStoreSecrets('plugin', items, { home: c.home, env: c.env });
  assert.deepEqual(r.values, items.map((it) => it.value));
  assert.equal(c.calls(), 0);
});

test('a foreign or space-padded foreign reference is refused before any write', async () => {
  const c = fresh();
  const foreign = newVaultRef();
  for (const value of [foreign, `  ${foreign} `]) {
    await assert.rejects(sealStoreSecrets('plugin', [{ field: 'p/default/token', value, current: undefined }], { home: c.home, env: c.env }),
      (err) => err.name === 'SettingsVaultError' && err.code === 'VAULT_REF_REFUSED' && /^The secret was not saved: /.test(err.message));
  }
  assert.equal(c.calls(), 0);
});

test('a locked store with nothing vaulted falls back to the config file, and the recheck refuses once a vault appears', async () => {
  const c = fresh('locked');
  const r = await sealStoreSecrets('proxy', [{ field: 'login.ntHash', value: 'ab'.repeat(16), current: undefined }],
    { home: c.home, env: c.env, nothingVaulted: () => true, subject: 'The login' });
  assert.deepEqual(r.values, ['ab'.repeat(16)]);
  r.recheck();
  writeFileSync(vaultFile(c.home), '{}');
  assert.throws(() => r.recheck(), (err) => err.code === 'VAULT_UNREACHABLE' && /^The login was not saved: /.test(err.message));
});

test('a reference in the store file refuses the plain fallback', async () => {
  const c = fresh('unavailable');
  await assert.rejects(sealStoreSecrets('mcp', [{ field: 'a/b', value: 'v-0001', current: undefined }],
    { home: c.home, env: c.env, nothingVaulted: () => false }), (err) => err.code === 'VAULT_UNREACHABLE');
});

test('a refusal outside the availability codes never falls back, even with nothing vaulted', async () => {
  const c = fresh();
  // A seal inside a vault transaction is refused lock-nested: not a store-availability code.
  await c.vault().transaction(async () => {
    await assert.rejects(sealStoreSecrets('mcp', [{ field: 'a/b', value: 'v-0002', current: undefined }], { home: c.home, env: c.env }),
      (err) => err.code === 'VAULT_UNREACHABLE' && err.reason === 'lock-nested');
  });
});

test('a locked store with a vault file refuses: "The secret was not saved"', async () => {
  const c = fresh('locked');
  await createVault({ home: c.home, store: createFakeOsStore() }).put({ store: 'mcp', field: 'a/z', value: 'other-key' });
  await assert.rejects(sealStoreSecrets('mcp', [{ field: 'a/b', value: 'v-0003', current: undefined }], { home: c.home, env: c.env }),
    (err) => err.code === 'VAULT_UNREACHABLE' && err.reason === 'store-locked' && /^The secret was not saved: .*Unlock the OS key store/.test(err.message));
});

test('release removes a dropped entry, keeps a still-referenced and a cross-owner one', async () => {
  const c = fresh();
  const { values: [a, b, x] } = await sealStoreSecrets('mcp', [
    { field: 's/a', value: 'va-0001' }, { field: 's/b', value: 'vb-0002' }, { field: 's/x', value: 'vx-0003' },
  ], { home: c.home, env: c.env });
  const r = await releaseStoreRefs('mcp', [{ ref: a, field: 's/a' }, { ref: b, field: 's/b' }, { ref: x, field: 's/WRONG' }],
    { home: c.home, env: c.env, stillReferenced: (ref) => ref === b });
  assert.deepEqual(r, { removed: 1, kept: 2 });
  assert.deepEqual((await entries(c)).map((e) => e.ref).sort(), [b, x].sort());
  assert.deepEqual(await releaseStoreRefs('mcp', [], { home: c.home, env: c.env }), { removed: 0, kept: 0 });
});

test('a lockless release (graceMs) marks a dropped entry, unmarks it when written back, removes it after the grace', async () => {
  const c = fresh();
  const F = 'login.ntHash';
  const { values: [r1] } = await sealStoreSecrets('proxy', [{ field: F, value: 'h1-0001' }], { home: c.home, env: c.env });
  const { values: [other] } = await sealStoreSecrets('proxy', [{ field: 'other', value: 'o-0002' }], { home: c.home, env: c.env });
  let held = new Set();
  let t = 1_000_000;
  const release = (dropped) => releaseStoreRefs('proxy', dropped, { home: c.home, env: c.env, graceMs: 600_000, now: () => t,
    stillReferenced: (ref) => held.has(ref) });
  const marks = async () => Object.fromEntries((await entries(c)).map((e) => [e.ref, e.droppedAt ?? null]));
  assert.deepEqual(await release([{ ref: r1, field: F }]), { removed: 0, kept: 0, marked: 1 });
  assert.deepEqual(await marks(), { [r1]: t, [other]: null });
  assert.deepEqual(resolveVaultRefSync(r1, { store: 'proxy', field: F }), { value: 'h1-0001' }, 'a marked entry still resolves');
  held = new Set([r1]);   // a stale writer wrote r1 back: the next release of the field clears the mark
  const { values: [r2] } = await sealStoreSecrets('proxy', [{ field: F, value: 'h2-0003' }], { home: c.home, env: c.env });
  t += 1000;
  assert.deepEqual(await release([{ ref: r2, field: F }]), { removed: 0, kept: 1, marked: 1 });
  assert.deepEqual(await marks(), { [r1]: null, [r2]: t, [other]: null });
  held = new Set();
  t += 1000;
  assert.deepEqual(await release([{ ref: r1, field: F }]), { removed: 0, kept: 0, marked: 1 }, 'r2 is still inside its grace');
  t += 600_000;
  assert.deepEqual(await release([]), { removed: 0, kept: 0, marked: 0 }, 'an empty list makes no call');
  const { values: [r3] } = await sealStoreSecrets('proxy', [{ field: F, value: 'h3-0004' }], { home: c.home, env: c.env });
  held = new Set([r3]);
  assert.deepEqual(await release([{ ref: r3, field: F }]), { removed: 2, kept: 1, marked: 0 }, 'r1 and r2 are past the grace');
  assert.deepEqual(await release([{ ref: other, field: F }]), { removed: 0, kept: 1, marked: 0 }, 'cross-owner is kept');
  assert.deepEqual(await marks(), { [r3]: null, [other]: null }, 'an entry of another field is never touched');
});

test('a scoped lockless release settles a marked entry of a deleted owner on another field, past the grace', async () => {
  const c = fresh();
  const { values: [gone, live, other] } = await sealStoreSecrets('plugin',
    [{ field: 'p/old/k', value: 'g-0001' }, { field: 'p/default/k', value: 'l-0002' }, { field: 'q/default/k', value: 'o-0003' }], { home: c.home, env: c.env });
  let t = 1_000_000;
  const held = new Set([live, other]);
  const release = (dropped) => releaseStoreRefs('plugin', dropped, { home: c.home, env: c.env, graceMs: 600_000, now: () => t,
    stillReferenced: (ref) => held.has(ref), scope: (field) => field.startsWith('p/') });
  assert.deepEqual(await release([{ ref: gone, field: 'p/old/k' }]), { removed: 0, kept: 0, marked: 1 });
  const { values: [next] } = await sealStoreSecrets('plugin', [{ field: 'p/default/k', value: 'l-0004' }], { home: c.home, env: c.env });
  held.delete(live); held.add(next);
  t += 600_000;
  assert.deepEqual(await release([{ ref: live, field: 'p/default/k' }]), { removed: 1, kept: 0, marked: 1 });
  assert.deepEqual((await entries(c)).map((e) => e.ref).sort(), [live, next, other].sort(), 'the deleted owner has no entry left; q is out of scope');
});

test('settleDroppedOnPrime removes a past-grace marked entry no file holds and unmarks a held one, once per home', async () => {
  const c = fresh();
  const { settleDroppedOnPrime } = await import('../src/core/secrets/store-vault.mjs');
  const { values: [gone, held] } = await sealStoreSecrets('proxy', [{ field: 'login.ntHash', value: 'h-0001' }, { field: 'login.ntHash', value: 'h-0002' }], { home: c.home, env: c.env });
  const { values: [s1] } = await sealStoreSecrets('settings', [{ field: 'providers.openai.apiKey', value: 's-0003' }], { home: c.home, env: c.env });
  const t = 1_000_000;
  for (const [store, ref] of [['proxy', gone], ['proxy', held], ['settings', s1]]) {
    await releaseStoreRefs(store, [{ ref, field: store === 'proxy' ? 'login.ntHash' : 'providers.openai.apiKey' }], { home: c.home, env: c.env, graceMs: 600_000, now: () => t });
  }
  writeFileSync(join(c.home, 'proxy-login.json'), JSON.stringify({ v: 1, user: 'u', ntHash: held }));
  assert.deepEqual(await settleDroppedOnPrime({ home: c.home, env: c.env, now: () => t + 600_000 }), { removed: 2, kept: 1 });
  assert.deepEqual((await entries(c)).map((e) => [e.ref, e.droppedAt ?? null]), [[held, null]]);
  assert.equal(await settleDroppedOnPrime({ home: c.home, env: c.env }), null, 'once per home and process');
});

/** A home whose vault (made through the direct fake, so this process never primed it) holds one proxy entry marked
 * past the grace; `setState(state)` switches the fake and keeps its items. */
async function pendingCase() {
  const c = fresh();
  const owner = { store: 'proxy', field: 'login.ntHash' };
  const ref = await c.vault().transaction(async (tx) => {
    const r = await tx.put({ ...owner, value: 'h-past-grace' });
    await tx.mark(r, owner, Date.now() - LOCKLESS_GRACE_MS - 1);
    return r;
  });
  const items = Object.fromEntries(Object.entries(JSON.parse(readFileSync(c.statePath, 'utf8')).items).map(([a, k]) => [a, Buffer.from(k, 'base64')]));
  const setState = (state) => writeFakeState(c.statePath, { state, items });
  return { c, ref, setState, refs: async () => (await entries(c)).map((e) => e.ref) };
}

test('settleDroppedOnPrime: a failed first attempt is retried by a later write and then succeeds', async () => {
  const { settleDroppedOnPrime } = await import('../src/core/secrets/store-vault.mjs');
  const { c, ref, setState, refs } = await pendingCase();
  setState('locked');
  const first = await settleDroppedOnPrime({ home: c.home, env: c.env });
  assert.ok(first?.error, JSON.stringify(first));
  setState('available');
  assert.deepEqual(await refs(), [ref], 'the failed attempt removed nothing');
  assert.deepEqual(await releaseStoreRefs('mcp', [], { home: c.home, env: c.env, sweep: true }), { removed: 0, kept: 0 },
    'the write returns its own result');
  assert.deepEqual(await refs(), [], 'the retry removed the past-grace entry');
  assert.equal(await settleDroppedOnPrime({ home: c.home, env: c.env }), null, 'done once it succeeded');
});

test('settleDroppedOnPrime: a still-failing retry stays pending; the next write tries again', async () => {
  const { settleDroppedOnPrime } = await import('../src/core/secrets/store-vault.mjs');
  const { c, ref, setState, refs } = await pendingCase();
  setState('locked');
  assert.ok((await settleDroppedOnPrime({ home: c.home, env: c.env }))?.error);
  const r = await releaseStoreRefs('settings', [{ ref, field: 'providers.openai.apiKey' }], { home: c.home, env: c.env });
  assert.equal(r.error, 'store-locked', 'the write\'s own failure, unchanged by the retry');
  setState('available');
  assert.deepEqual(await refs(), [ref], 'both failed attempts removed nothing');
  const { values: [v] } = await sealStoreSecrets('mcp', [{ field: 's/a', value: 'm-0001' }], { home: c.home, env: c.env });
  assert.ok(isVaultRef(v));
  assert.deepEqual(await refs(), [v], 'the third attempt, after a seal, removed the past-grace entry');
  assert.equal(await settleDroppedOnPrime({ home: c.home, env: c.env }), null);
});

test('settleDroppedOnPrime: a settled home makes no retry store call', async () => {
  const { settleDroppedOnPrime } = await import('../src/core/secrets/store-vault.mjs');
  const { c, refs } = await pendingCase();
  assert.deepEqual(await settleDroppedOnPrime({ home: c.home, env: c.env }), { removed: 1, kept: 0 });
  assert.deepEqual(await refs(), []);
  const calls = c.calls();
  assert.deepEqual(await releaseStoreRefs('settings', [], { home: c.home, env: c.env }), { removed: 0, kept: 0 });
  assert.equal(c.calls(), calls, 'no store call');
});

test('sweep removes an unheld mcp entry and keeps a plugin one', async () => {
  const c = fresh();
  const { values: [m1, m2] } = await sealStoreSecrets('mcp', [{ field: 's/a', value: 'm-0001' }, { field: 's/b', value: 'm-0002' }], { home: c.home, env: c.env });
  const { values: [p] } = await sealStoreSecrets('plugin', [{ field: 'p/default/k', value: 'p-0003' }], { home: c.home, env: c.env });
  const r = await releaseStoreRefs('mcp', [], { home: c.home, env: c.env, sweep: true, stillReferenced: (ref) => ref === m2 });
  assert.equal(r.removed, 1);
  assert.deepEqual((await entries(c)).map((e) => e.ref).sort(), [m2, p].sort());
  assert.ok(m1);
});

test('a failure in the transaction or in stillReferenced returns error without throwing, and logs only the code', async () => {
  const c = fresh();
  const secret = 'leak-me-0001';
  const { values: [ref] } = await sealStoreSecrets('mcp', [{ field: 's/a', value: secret }], { home: c.home, env: c.env });
  const lines = [];
  const log = (l) => lines.push(l);
  const thrown = await releaseStoreRefs('mcp', [{ ref, field: 's/a' }], { home: c.home, env: c.env, log,
    stillReferenced: () => { throw Object.assign(new Error(`EACCES ${c.home} ${secret} ${ref}`), { code: 'EACCES' }); } });
  assert.deepEqual(thrown, { removed: 0, kept: 0, error: 'io' });
  chmodSync(c.home, 0o500);
  try {
    const fs = await releaseStoreRefs('mcp', [{ ref, field: 's/a' }], { home: c.home, env: c.env, log });
    assert.equal(fs.removed, 0);
    assert.ok(fs.error, JSON.stringify(fs));
  } finally { chmodSync(c.home, 0o700); }
  assert.equal(lines.length, 2);
  for (const l of lines) {
    assert.match(l, /vault cleanup skipped \([a-z-]+\)$/);
    for (const bad of [secret, 'worca:vault:', c.home, c.dir]) assert.ok(!l.includes(bad), l);
  }
  assert.equal((await entries(c)).length, 1);
});

test('a 300-character MCP server id gets a sha256: owner field that round-trips', async () => {
  const c = fresh();
  const field = ownerField([`policy:${'x'.repeat(300)}`, 'token']);
  assert.match(field, /^sha256:[0-9a-f]{64}$/);
  assert.equal(ownerField(['manual:gh', 'token']), 'manual:gh/token');
  const { values: [ref] } = await sealStoreSecrets('mcp', [{ field, value: 'long-0001' }], { home: c.home, env: c.env });
  assert.ok(isVaultRef(ref));
  assert.equal(await c.vault().resolve(ref, { store: 'mcp', field }), 'long-0001');
  assert.deepEqual(resolveVaultRefSync(ref, { store: 'mcp', field }), { value: 'long-0001' });
});

test('refsDropped lists the references the second list no longer holds', () => {
  const [a, b, c] = [newVaultRef(), newVaultRef(), newVaultRef()];
  assert.deepEqual(refsDropped([{ ref: a, field: 'x' }, { ref: b, field: 'y' }], [{ ref: b, field: 'y' }, { ref: c, field: 'z' }]), [{ ref: a, field: 'x' }]);
});
