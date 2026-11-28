// test/secrets-status.test.mjs — the status and reset core, in process over the memory OS-store fake: the state
// mapping, read-only status, every reset outcome, the lock, the aside name, the single-flight cache and the wording.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFakeOsStore } from './helpers/os-store-fake.mjs';
import { snapshotTree, diffTrees } from './helpers/flag-off.mjs';
import { VAULT_FILE, VAULT_LOCK_FILE } from '../src/core/secrets/files.mjs';
import { unavailableOsStore } from '../src/core/secrets/os-store.mjs';
import { createVault, vaultFile } from '../src/core/secrets/vault.mjs';
import {
  secretsStatus, resetVault, statusLines, doctorLine, createStatusCache, unavailableStatus,
} from '../src/core/secrets/status.mjs';

const ROOT = mkdtempSync(join(tmpdir(), 'worca-secrets-status-'));
after(() => rmSync(ROOT, { recursive: true, force: true, maxRetries: 5 }));
let n = 0;
const newHome = () => mkdtempSync(join(ROOT, `h${++n}-`));
const ENV = { NODE_TEST_CONTEXT: 'child-v8', WORCA_TEST_STORE_TIMEOUT_MS: '200' };
const S = { store: 'settings', field: 'providers.openai.apiKey' };
const CANARY = 'CANARY-secret-value-5e2a';
const NOW = new Date('2026-11-21T10:00:00.000Z');
const ASIDE = `${VAULT_FILE}.unreadable-2026-11-21T10-00-00-000Z`;
const setKeys = (fake) => fake.calls.filter((c) => c.op === 'setKey').length;

// A home with a vault written by `fake`, then put into `kind`.
async function homeWith(kind) {
  const home = newHome();
  const fake = createFakeOsStore();
  if (kind === 'empty') return { home, fake, store: fake };
  await createVault({ home, store: fake }).put({ ...S, value: CANARY });
  const file = vaultFile(home);
  let store = fake;
  if (kind === 'item-missing') fake.setState('item-missing');
  if (kind === 'wrong-key') store = createFakeOsStore({ state: 'different-key' });
  if (kind === 'tampered') writeFileSync(file, JSON.stringify({ ...JSON.parse(readFileSync(file, 'utf8')), tag: Buffer.alloc(16, 9).toString('base64') }));
  if (kind === 'unsupported-format') writeFileSync(file, JSON.stringify({ format: 9 }));
  if (['locked', 'unavailable', 'never-answers'].includes(kind)) fake.setState(kind);
  return { home, fake, store, file };
}

test('each state maps to the documented { state, vault, reason }', async () => {
  const rows = [
    ['empty', { state: 'ready', vault: 'none', reason: null }],
    ['readable', { state: 'ready', vault: 'readable', reason: null }],
    ['item-missing', { state: 'ready', vault: 'unreadable', reason: 'item-missing' }],
    ['wrong-key', { state: 'ready', vault: 'unreadable', reason: 'wrong-key' }],
    ['tampered', { state: 'ready', vault: 'unreadable', reason: 'tampered' }],
    ['unsupported-format', { state: 'ready', vault: 'unreadable', reason: 'unsupported-format' }],
    ['locked', { state: 'locked', vault: 'unknown', reason: 'store-locked' }],
    ['never-answers', { state: 'locked', vault: 'unknown', reason: 'store-locked' }],
    ['unavailable', { state: 'unavailable', vault: 'unknown', reason: 'store-unavailable' }],
  ];
  for (const [kind, want] of rows) {
    const { home, fake, store } = await homeWith(kind);
    const before = snapshotTree(home);
    const callsBefore = setKeys(fake);
    const st = await secretsStatus({ home, env: ENV, store });
    assert.deepEqual({ state: st.state, vault: st.vault, reason: st.reason }, want, kind);
    assert.equal(st.backend, 'fake');
    assert.equal(st.label, 'test store');
    assert.ok(!Number.isNaN(Date.parse(st.checkedAt)));
    assert.equal(typeof st.message, want.reason ? 'string' : 'object', kind);
    assert.deepEqual(diffTrees(before, snapshotTree(home)), [], `${kind}: status leaves the home unchanged`);
    assert.equal(setKeys(fake), callsBefore, `${kind}: 0 setKey`);
    assert.equal(setKeys(store), store === fake ? callsBefore : 0);
    assert.ok(!JSON.stringify(st).includes(CANARY));
  }
  const lost = await secretsStatus({ ...(await homeWith('item-missing')), env: ENV });
  assert.equal(lost.message, 'the vault key is missing from the OS key store; the vault cannot be read');
});

test('backend none: unavailable with no store call; locked with no vault reads vault none', async () => {
  const home = newHome();
  const st = await secretsStatus({ home, env: ENV, store: unavailableOsStore() });
  assert.deepEqual([st.backend, st.label, st.state, st.vault], ['none', 'No OS key store', 'unavailable', 'none']);
  const locked = createFakeOsStore({ state: 'locked' });
  assert.equal((await secretsStatus({ home, env: ENV, store: locked })).vault, 'none');
});

test('reset moves the 3 resettable codes aside and leaves the OS item unchanged', async () => {
  for (const kind of ['item-missing', 'wrong-key', 'tampered']) {
    const { home, fake, store, file } = await homeWith(kind);
    const bytes = readFileSync(file);
    const key = fake.peekKey();
    const setKeysBefore = setKeys(store);
    let asked = 0;
    const r = await resetVault({ home, env: ENV, store, now: NOW, confirm: async () => { asked++; return true; } });
    assert.deepEqual(r, { outcome: 'moved', movedTo: ASIDE }, kind);
    assert.equal(asked, 1);
    assert.equal(existsSync(file), false);
    assert.ok(readFileSync(join(home, ASIDE)).equals(bytes));
    assert.equal(setKeys(store), setKeysBefore, `${kind}: reset makes 0 setKey calls`);
    if (kind !== 'item-missing') assert.ok(fake.peekKey().equals(key), `${kind}: the OS item is unchanged`);
  }
});

test('reset refuses readable, locked, unavailable and unsupported-format, moving nothing', async () => {
  for (const [kind, reason] of [['readable', 'readable'], ['locked', 'store-locked'], ['unavailable', 'store-unavailable'], ['unsupported-format', 'unsupported-format']]) {
    const { home, store, file } = await homeWith(kind);
    const before = readFileSync(file);
    let asked = 0;
    const r = await resetVault({ home, env: ENV, store, now: NOW, confirm: async () => { asked++; return true; } });
    assert.deepEqual(r, { outcome: 'refused', reason }, kind);
    assert.equal(asked, 0);
    assert.ok(readFileSync(file).equals(before));
    assert.ok(!readdirSync(home).some((f) => f.includes('.unreadable-')), kind);
  }
});

test('reset: nothing for an absent vault, and when the vault turns readable before the lock; cancelled on no', async () => {
  const empty = await homeWith('empty');
  assert.deepEqual(await resetVault({ ...empty, env: ENV, confirm: async () => true }), { outcome: 'nothing' });

  const { home, fake, file } = await homeWith('readable');
  const key = fake.peekKey();
  fake.setState('item-missing');
  const healed = await resetVault({
    home, env: ENV, store: fake, now: NOW,
    confirm: async () => { fake.setState('available'); await fake.setKey(key); return true; }, // the key came back
  });
  assert.deepEqual(healed, { outcome: 'nothing' });
  assert.ok(existsSync(file));

  const lost = await homeWith('item-missing');
  const before = readFileSync(lost.file);
  assert.deepEqual(await resetVault({ ...lost, env: ENV, confirm: async () => false }), { outcome: 'cancelled' });
  assert.ok(readFileSync(lost.file).equals(before));
});

test('reset with the vault lock held elsewhere refuses lock-busy, the vault byte-identical and no aside file', async () => {
  const { home, store, file } = await homeWith('item-missing');
  const before = readFileSync(file);
  writeFileSync(join(home, VAULT_LOCK_FILE), JSON.stringify({ pid: process.ppid, token: 'foreign', at: new Date().toISOString() }));
  const r = await resetVault({ home, env: ENV, store, now: NOW, lockTimeoutMs: 200, confirm: async () => true });
  assert.deepEqual(r, { outcome: 'refused', reason: 'lock-busy' });
  assert.ok(readFileSync(file).equals(before));
  assert.ok(!readdirSync(home).some((f) => f.includes('.unreadable-')));
});

test('reset never overwrites an earlier aside copy: it moves to the -1 name, then refuses', async () => {
  const { home, store, file } = await homeWith('item-missing');
  writeFileSync(join(home, ASIDE), 'earlier copy');
  const r = await resetVault({ home, env: ENV, store, now: NOW, confirm: async () => true });
  assert.deepEqual(r, { outcome: 'moved', movedTo: `${ASIDE}-1` });
  assert.equal(readFileSync(join(home, ASIDE), 'utf8'), 'earlier copy');
  assert.equal(existsSync(file), false);

  const again = await homeWith('item-missing');
  writeFileSync(join(again.home, ASIDE), 'one');
  writeFileSync(join(again.home, `${ASIDE}-1`), 'two');
  const before = readFileSync(again.file);
  assert.deepEqual(await resetVault({ ...again, env: ENV, now: NOW, confirm: async () => true }), { outcome: 'refused', reason: 'aside-exists' });
  assert.ok(readFileSync(again.file).equals(before));
});

test('the cache: 1 probe for 3 concurrent refreshes; a throwing probe settles to unavailable', async () => {
  let calls = 0;
  let release;
  const cache = createStatusCache({ probe: () => { calls++; return new Promise((r) => { release = r; }); } });
  assert.equal(cache.last(), null);
  const all = Promise.all([cache.refresh(), cache.refresh(), cache.refresh()]);
  await new Promise((r) => setImmediate(r));
  release({ state: 'ready' });
  assert.deepEqual(await all, [{ state: 'ready' }, { state: 'ready' }, { state: 'ready' }]);
  assert.equal(calls, 1);
  assert.deepEqual(cache.last(), { state: 'ready' });
  const later = cache.refresh();
  await new Promise((r) => setImmediate(r));
  release({ state: 'locked' });
  assert.deepEqual(await later, { state: 'locked' });
  assert.equal(calls, 2, 'a later refresh probes again');
  const thrower = createStatusCache({ probe: () => { throw new Error(CANARY); } });
  const st = await thrower.refresh();
  assert.equal(st.state, 'unavailable');
  assert.ok(!JSON.stringify(st).includes(CANARY));
  assert.equal(unavailableStatus().label, 'No OS key store');
});

test('wording: status lines and doctor lines, each fact once', () => {
  const base = { backend: 'keychain', label: 'macOS Keychain', checkedAt: NOW.toISOString() };
  assert.deepEqual(statusLines({ ...base, state: 'ready', vault: 'readable' }), ['Secrets backend: macOS Keychain (ready)', 'Vault: readable']);
  assert.deepEqual(statusLines({ ...base, state: 'ready', vault: 'readable', entries: 9 }), ['Secrets backend: macOS Keychain (ready)', 'Vault: readable (9 entries)']);
  assert.deepEqual(statusLines({ ...base, state: 'ready', vault: 'readable', entries: 2 }, { flagOff: true }), [
    'Secrets backend: macOS Keychain (ready)', 'Vault: readable (2 entries)',
    'The secretVault flag is off: saved secrets are still read from the vault and new keys are saved in the config file. Run `worca secrets export` to move the vaulted ones back to their config files.',
  ]);
  assert.equal(statusLines({ ...base, state: 'ready', vault: 'none' }, { flagOff: true }).length, 2, 'no vault: no flag-off line');
  assert.deepEqual(statusLines({ ...base, state: 'ready', vault: 'unreadable', reason: 'item-missing', message: 'the vault key is missing from the OS key store; the vault cannot be read' }), [
    'Secrets backend: macOS Keychain (ready)',
    'Vault: unreadable: the vault key is missing from the OS key store; the vault cannot be read',
    'Run `worca secrets reset` to move it aside and start a new vault.',
  ]);
  const locked = statusLines({ ...base, label: 'Secret Service', state: 'locked', vault: 'unknown' });
  assert.deepEqual(locked, ['Secrets backend: Secret Service (locked)', 'Vault: not checked', 'Unlock the OS key store, then run `worca secrets status` again.']);
  assert.equal(locked.join('\n').match(/locked/g).length, 1);
  assert.deepEqual(statusLines({ backend: 'none', label: 'No OS key store', state: 'unavailable', vault: 'none' }), ['Secrets backend: No OS key store (unavailable)', 'Vault: not checked']);
  assert.deepEqual(doctorLine({ ...base, state: 'ready', vault: 'none' }), { text: 'secrets: macOS Keychain (ready)', warn: false });
  for (const st of [{ state: 'locked' }, { state: 'unavailable' }, { state: 'ready', vault: 'unreadable' }]) {
    const d = doctorLine({ ...base, ...st });
    assert.equal(d.warn, true);
    assert.match(d.text, /^secrets: ! /);
  }
});

test('flagOn, not ready, vault none adds: The vault is not active', () => {
  const NOTE = 'The vault is not active: keys are saved in settings.json, protected by its file permissions.';
  assert.deepEqual(statusLines({ backend: 'none', label: 'No OS key store', state: 'unavailable', vault: 'none' }, { flagOn: true }),
    ['Secrets backend: No OS key store (unavailable)', 'Vault: not checked', NOTE]);
  const locked = statusLines({ backend: 'keychain', label: 'macOS Keychain', state: 'locked', vault: 'none' }, { flagOn: true });
  assert.deepEqual(locked, ['Secrets backend: macOS Keychain (locked)', 'Vault: not checked', 'Unlock the OS key store, then run `worca secrets status` again.', NOTE]);
  assert.ok(!statusLines({ backend: 'none', label: 'No OS key store', state: 'unavailable', vault: 'none' }).includes(NOTE), 'flag off: no notice');
  assert.ok(!statusLines({ backend: 'keychain', label: 'macOS Keychain', state: 'ready', vault: 'none' }, { flagOn: true }).includes(NOTE), 'ready: no notice');
});

test('flagOn, locked, vault unknown does not', () => {
  const lines = statusLines({ backend: 'keychain', label: 'macOS Keychain', state: 'locked', vault: 'unknown' }, { flagOn: true });
  assert.deepEqual(lines, ['Secrets backend: macOS Keychain (locked)', 'Vault: not checked', 'Unlock the OS key store, then run `worca secrets status` again.']);
});

test('status of a readable vault carries its entry count and the lines hold no value', async () => {
  const { home, store } = await homeWith('readable');
  const st = await secretsStatus({ home, env: ENV, store });
  assert.equal(st.entries, 1);
  const lines = statusLines(st, { flagOff: true });
  assert.equal(lines[1], 'Vault: readable (1 entry)');
  assert.ok(!lines.join('\n').includes(CANARY));
  assert.ok(!JSON.stringify(st).includes(CANARY));
});
