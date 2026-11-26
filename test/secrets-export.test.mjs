// test/secrets-export.test.mjs — `worca secrets export`'s core (exportSecrets), in process over the file-backed OS-store
// fake, after a real migration: a full restore at 0600 with the vault, the item and the flag gone; leftover entries go
// with the vault; every refusal changes no byte; an entry sealed after the snapshot refuses `changed`; the no-vault
// branch; and two child-process crash points that a rerun completes. The flag is turned on in settings.json (setFlags)
// with WORCA_FLAGS deleted, so export can turn it off.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fileFakeOsStore, peekKey, readFakeCalls, writeFakeState } from './helpers/os-store-fake.mjs';
import { diffTrees, snapshotTree } from './helpers/flag-off.mjs';
import { readSecrets, secretFiles, secretSlots, seedLiterals } from './helpers/secret-literals.mjs';

const REPO = fileURLToPath(new URL('..', import.meta.url));
const ROOT = mkdtempSync(join(tmpdir(), 'worca-export-'));
const KEYS = ['HOME', 'USERPROFILE', 'WORCA_HOME', 'WORCA_TEST_ALLOW_HOME_FALLBACK', 'WORCA_FLAGS', 'WORCA_TEST_OS_STORE'];
const prev = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = '1';
delete process.env.WORCA_FLAGS;
after(() => {
  for (const [k, v] of Object.entries(prev)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  rmSync(ROOT, { recursive: true, force: true, maxRetries: 5 });
});

const { exportSecrets } = await import('../src/core/secrets/export.mjs');
const { migrateSecretsIfEnabled } = await import('../src/core/secrets/flag.mjs');
const { flagEnabled, setFlags } = await import('../src/core/flags.mjs');
const { osItemName } = await import('../src/core/secrets/os-store.mjs');
const { createVault } = await import('../src/core/secrets/vault.mjs');
const { newVaultRef } = await import('../src/core/secrets/refs.mjs');
const { vaultForHome } = await import('../src/core/secrets/settings-vault.mjs');
const { MIGRATE_LOCK_FILE } = await import('../src/core/secrets/files.mjs');

const POSIX = process.platform !== 'win32';
const yes = async () => true;
let n = 0;

/** A fresh install with the flag on in settings.json; seeded and migrated unless told otherwise. */
async function fresh({ migrate = true, seed = true } = {}) {
  const dir = mkdtempSync(join(ROOT, `c${++n}-`));
  const tree = join(dir, 'tree');
  const home = join(tree, 'home');
  const worca = join(home, '.worca-cc');
  mkdirSync(worca, { recursive: true });
  const state = join(dir, 'fake', 'state.json');
  writeFakeState(state, { state: 'available' });
  Object.assign(process.env, { HOME: home, USERPROFILE: home, WORCA_HOME: home, WORCA_TEST_OS_STORE: state });
  delete process.env.WORCA_FLAGS;
  if (seed) seedLiterals({ home, worca });
  await setFlags({ secretVault: true });
  if (migrate) assert.equal((await migrateSecretsIfEnabled({ deployment: 'local', log: () => {} })).state, 'done');
  const item = osItemName(worca);
  const vault = createVault({ home: worca, store: fileFakeOsStore(state, { item }) });
  return { dir, tree, home, worca, state, item, vault, snap: () => snapshotTree(tree) };
}

const vaultFile = (c) => join(c.worca, 'worca-vault.enc');
const ops = (c, op) => readFakeCalls(c.state).filter((x) => x.op === op).length;

async function assertPlain(c) {
  const got = await readSecrets({ ...c, vault: c.vault });
  for (const s of secretSlots()) {
    assert.equal(got[s.id].ref, false, `${s.id} is a literal value`);
    assert.equal(got[s.id].raw, s.value, `${s.id} equals its literal byte for byte`);
  }
}

test('full restore: 9 literals back at 0600, no vault, no item, the flag off', async () => {
  const c = await fresh();
  assert.ok(existsSync(vaultFile(c)));
  const r = await exportSecrets({ confirm: yes });
  assert.equal(r.outcome, 'exported');
  assert.deepEqual(r.restored, { settings: 4, mcp: 2, plugin: 2, proxy: 1 });
  assert.equal(r.keyRemoved, true);
  assert.equal(r.flag, 'off');
  await assertPlain(c);
  assert.equal(existsSync(vaultFile(c)), false);
  assert.equal(peekKey(c.state, c.item), null, 'the fake item is gone');
  assert.equal(flagEnabled('secretVault'), false);
  assert.notEqual(JSON.parse(readFileSync(secretFiles(c.home, c.worca).settings, 'utf8')).flags?.secretVault, true);
  if (POSIX) for (const f of Object.values(secretFiles(c.home, c.worca))) assert.equal(statSync(f).mode & 0o777, 0o600, f);
  for (const s of secretSlots()) assert.ok(!JSON.stringify(r).includes(s.value));
});

test('leftover entries: a dropped entry and an MCP orphan go with the vault', async () => {
  const c = await fresh();
  await c.vault.put({ store: 'settings', field: 'providers.sound.apiKey', value: 'old-dropped', droppedAt: 1 });
  await c.vault.put({ store: 'mcp', field: 'manual:gone/token', value: 'orphan' });
  const r = await exportSecrets({ confirm: yes });
  assert.equal(r.outcome, 'exported');
  assert.equal(existsSync(vaultFile(c)), false);
  assert.equal(peekKey(c.state, c.item), null);
  await assertPlain(c);
});

test('no-change refusals: cancel, unreadable, server-running, flag-locked, unresolved and a held migrate lock', async () => {
  const cases = {
    cancelled: async () => ({ confirm: async () => false }),
    unreadable: async (c) => {
      const env = JSON.parse(readFileSync(vaultFile(c), 'utf8'));
      writeFileSync(vaultFile(c), JSON.stringify({ ...env, tag: Buffer.alloc(16, 9).toString('base64') }), { mode: 0o600 });
      return {};
    },
    'server-running': async (c) => {
      writeFileSync(join(c.worca, 'ui.json'), JSON.stringify({ pid: process.pid, port: 4999, host: '127.0.0.1' }));
      return {};
    },
    'flag-locked': async () => { process.env.WORCA_FLAGS = 'secretVault'; return {}; },
    unresolved: async (c) => {
      const f = secretFiles(c.home, c.worca).settings;
      const raw = JSON.parse(readFileSync(f, 'utf8'));
      raw.providers.anthropic.apiKey = newVaultRef();
      writeFileSync(f, JSON.stringify(raw), { mode: 0o600 });
      return {};
    },
    'lock-busy': async (c) => {
      writeFileSync(join(c.worca, MIGRATE_LOCK_FILE), JSON.stringify({ pid: process.ppid, token: 'foreign', at: new Date().toISOString() }));
      return { lockWaitMs: 100 };
    },
  };
  const want = { cancelled: ['cancelled', undefined], unreadable: ['refused', 'tampered'], 'server-running': ['refused', 'server-running'],
    'flag-locked': ['refused', 'flag-locked'], unresolved: ['refused', 'unresolved'], 'lock-busy': ['refused', 'lock-busy'] };
  for (const [name, arrange] of Object.entries(cases)) {
    const c = await fresh();
    const opts = await arrange(c);
    const before = c.snap();
    const key = peekKey(c.state, c.item);
    const r = await exportSecrets({ confirm: yes, ...opts });
    delete process.env.WORCA_FLAGS;
    assert.deepEqual([r.outcome, r.reason], want[name], name);
    assert.deepEqual(diffTrees(before, c.snap()), [], `${name}: no byte changed`);
    assert.deepEqual(peekKey(c.state, c.item), key, `${name}: the item is kept`);
    assert.equal(ops(c, 'deleteKey'), 0, name);
    if (name === 'unresolved') assert.deepEqual(r.unresolved, ['Provider key: anthropic']);
  }
});

test('changed: an entry sealed after the snapshot keeps the vault and the item; every slot reads its original; a rerun completes', async () => {
  const c = await fresh();
  const v = await vaultForHome({ home: c.worca });
  const real = v.transaction;
  let first = true;
  v.transaction = async (fn) => {
    const r = await real(fn);
    if (first) { first = false; await real((tx) => tx.put({ store: 'proxy', field: 'login.ntHash', value: 'f'.repeat(32) })); }
    return r;
  };
  let r;
  try { r = await exportSecrets({ confirm: yes }); } finally { v.transaction = real; }
  assert.deepEqual([r.outcome, r.reason], ['refused', 'changed']);
  assert.ok(existsSync(vaultFile(c)), 'the vault stays');
  assert.ok(peekKey(c.state, c.item), 'the item stays');
  const got = await readSecrets({ ...c, vault: c.vault });
  for (const s of secretSlots()) assert.equal(got[s.id].value, s.value, `${s.id} reads its original`);
  const again = await exportSecrets({ confirm: yes });
  assert.equal(again.outcome, 'exported');
  assert.equal(existsSync(vaultFile(c)), false);
  assert.equal(peekKey(c.state, c.item), null);
  await assertPlain(c);
});

test('no vault file: a reference left refuses unresolved with 0 deleteKey; zero references and the flag on remove the item once; flag off and empty is nothing', async () => {
  const c = await fresh({ migrate: false, seed: false });
  const f = secretFiles(c.home, c.worca).settings;
  const raw = JSON.parse(readFileSync(f, 'utf8'));
  raw.providers = { openai: { apiKey: newVaultRef() } };
  writeFileSync(f, JSON.stringify(raw), { mode: 0o600 });
  const r = await exportSecrets({ confirm: yes });
  assert.deepEqual([r.outcome, r.reason, r.unresolved], ['refused', 'unresolved', ['Provider key: openai']]);
  assert.equal(ops(c, 'deleteKey'), 0);

  const k = await fresh({ migrate: false, seed: false });
  writeFakeState(k.state, { state: 'available', item: k.item, key: Buffer.alloc(32, 7) });
  // Asked first, and under the migration lock: a cancel or a held lock keeps the item.
  assert.equal((await exportSecrets({ confirm: async () => false })).outcome, 'cancelled');
  writeFileSync(join(k.worca, MIGRATE_LOCK_FILE), JSON.stringify({ pid: process.ppid, token: 'foreign', at: new Date().toISOString() }));
  assert.deepEqual([(await exportSecrets({ confirm: yes, lockWaitMs: 100 })).reason], ['lock-busy']);
  rmSync(join(k.worca, MIGRATE_LOCK_FILE), { force: true });
  assert.equal(ops(k, 'deleteKey'), 0);
  const kr = await exportSecrets({ confirm: yes });
  assert.equal(kr.outcome, 'key-removed');
  assert.equal(kr.flag, 'off');
  assert.equal(ops(k, 'deleteKey'), 1);
  assert.equal(peekKey(k.state, k.item), null);

  const e = await fresh({ migrate: false, seed: false });
  await setFlags({ secretVault: false });
  const er = await exportSecrets({ confirm: yes });
  assert.equal(er.outcome, 'nothing');
  assert.deepEqual(readFakeCalls(e.state), []);
});

for (const point of ['after-restore', 'after-vault-unlink']) {
  test(`crash at ${point}@export (child process): a rerun ends with no vault, no item, 9 plain values and the flag off`, async () => {
    const c = await fresh();
    const env = { ...process.env, NODE_TEST_CONTEXT: 'child-v8', WORCA_TEST_SECRETS_CRASH: `${point}@export` };
    delete env.WORCA_FLAGS;
    const child = (e) => spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', 'test/fixtures/secrets/settings-child.mjs', 'export', '--yes'],
      { cwd: REPO, env: e, encoding: 'utf8', timeout: 60_000 });
    const crashed = child(env);
    assert.equal(crashed.signal, 'SIGKILL', crashed.stderr);
    delete env.WORCA_TEST_SECRETS_CRASH;
    const rerun = child(env);
    assert.equal(rerun.status, 0, rerun.stderr);
    const out = JSON.parse(rerun.stdout.trim().split('\n').pop());
    assert.equal(out.outcome, point === 'after-restore' ? 'exported' : 'key-removed');
    assert.equal(existsSync(vaultFile(c)), false);
    assert.equal(peekKey(c.state, c.item), null);
    await assertPlain(c);
    assert.equal(flagEnabled('secretVault'), false);
  });
}
