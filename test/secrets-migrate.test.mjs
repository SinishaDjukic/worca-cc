// test/secrets-migrate.test.mjs — the one-time move of file-stored secrets into the vault (secretVault on), in process
// over the file-backed OS-store fake: the four stores end with references only, a second run is a no-op, every
// preflight and key read-back failure moves nothing, the skips change nothing, and no output carries a secret, a
// reference, the probe item or a path. Each case has a fresh HOME, Worca home and fake state file (kept outside the
// snapshotted tree, so a probe item left by `delete-failed` never carries over).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fakeAccounts, fileFakeOsStore, readFakeCalls, writeFakeState } from './helpers/os-store-fake.mjs';
import { diffTrees, snapshotTree } from './helpers/flag-off.mjs';
import { CANARY, MCP_SERVER, PLUGIN, SAVED_AT, liveEntries, readSecrets, secretFiles, secretSlots, seedLiterals } from './helpers/secret-literals.mjs';

const ROOT = mkdtempSync(join(tmpdir(), 'worca-migrate-'));
const KEYS = ['HOME', 'USERPROFILE', 'WORCA_HOME', 'WORCA_TEST_ALLOW_HOME_FALLBACK', 'WORCA_FLAGS', 'WORCA_TEST_OS_STORE', 'WORCA_TEST_MIGRATE_WAIT_MS'];
const prev = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
Object.assign(process.env, { WORCA_TEST_ALLOW_HOME_FALLBACK: '1', WORCA_FLAGS: 'secretVault' });
after(() => {
  for (const [k, v] of Object.entries(prev)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  rmSync(ROOT, { recursive: true, force: true, maxRetries: 5 });
});

const { migrateSecretsIfEnabled } = await import('../src/core/secrets/flag.mjs');
const { migrateWaitMs, MIGRATE_LOCK_WAIT_MS, MIGRATE_STORES } = await import('../src/core/secrets/migrate.mjs');
const { settingsSecretLiterals, swapSettingsSecretLiterals, readSettings } = await import('../src/core/settings.mjs');
const { mcpSecretLiteralCount, migrateMcpSecretLiterals } = await import('../src/core/mcp/store.mjs');
const { pluginSecretLiterals, swapPluginSecretLiterals } = await import('../src/core/plugin-config.mjs');
const { proxyLoginLiteral, swapProxyLoginLiteral } = await import('../src/core/proxy-credentials.mjs');
const { vaultForHome } = await import('../src/core/secrets/settings-vault.mjs');
const { osItemName, osProbeItemName } = await import('../src/core/secrets/os-store.mjs');
const { createVault } = await import('../src/core/secrets/vault.mjs');
const { newVaultRef } = await import('../src/core/secrets/refs.mjs');
const { readNotice } = await import('../src/core/secrets/notice.mjs');

const POSIX = process.platform !== 'win32';
let n = 0;
/** A fresh install: HOME, Worca home, and a fake state file outside the tree; seeded with literals unless `seed` is false. */
function fresh({ fake = { state: 'available' }, seed = true, big = false } = {}) {
  const dir = mkdtempSync(join(ROOT, `c${++n}-`));
  const tree = join(dir, 'tree');
  const home = join(tree, 'home');
  const worca = join(home, '.worca-cc');   // worcaHome() is WORCA_HOME/.worca-cc: the HOME's own Worca home
  mkdirSync(home, { recursive: true });
  mkdirSync(worca, { recursive: true });
  const state = join(dir, 'fake', 'state.json');
  writeFakeState(state, fake);
  Object.assign(process.env, { HOME: home, USERPROFILE: home, WORCA_HOME: home, WORCA_TEST_OS_STORE: state });
  if (seed) seedLiterals({ home, worca, big });
  const vault = createVault({ home: worca, store: fileFakeOsStore(state, { item: osItemName(worca) }) });
  return { dir, tree, home, worca, state, vault, snap: () => snapshotTree(tree) };
}

const lines = [];
const log = (l) => lines.push(l);
const migrate = (opts = {}) => migrateSecretsIfEnabled({ deployment: 'local', log, ...opts });
const ops = (state, op) => readFakeCalls(state).filter((c) => c.op === op).length;
const vaultFileOf = (worca) => join(worca, 'worca-vault.enc');
const ZERO = { settings: 0, mcp: 0, plugin: 0, proxy: 0 };

/** No canary, no reference, no probe item name and no temp path in `texts`. */
function assertNoLeak(texts, c) {
  const all = texts.join('\n');
  for (const s of secretSlots()) assert.ok(!all.includes(s.value), `leaked ${s.id}`);
  for (const needle of [CANARY, 'worca:vault:v1:', 'vault-probe-', ROOT, c?.worca, c?.home].filter(Boolean)) assert.ok(!all.includes(needle), `leaked ${needle}`);
}

test('the stores and the wait bound', () => {
  assert.deepEqual(MIGRATE_STORES, ['settings', 'mcp', 'plugin', 'proxy']);
  assert.equal(MIGRATE_LOCK_WAIT_MS, 5000);
});

test('migrateWaitMs: 5000 without the runner marker whatever the variable says; clamped to 50–30 000 with it', () => {
  assert.equal(migrateWaitMs({ WORCA_TEST_MIGRATE_WAIT_MS: '300' }), 5000);
  assert.equal(migrateWaitMs({ NODE_TEST_CONTEXT: '1' }), 5000);
  assert.equal(migrateWaitMs({ NODE_TEST_CONTEXT: '1', WORCA_TEST_MIGRATE_WAIT_MS: '300' }), 300);
  assert.equal(migrateWaitMs({ NODE_TEST_CONTEXT: '1', WORCA_TEST_MIGRATE_WAIT_MS: '1' }), 50);
  assert.equal(migrateWaitMs({ NODE_TEST_CONTEXT: '1', WORCA_TEST_MIGRATE_WAIT_MS: '99999' }), 30_000);
  assert.equal(migrateWaitMs({ NODE_TEST_CONTEXT: '1', WORCA_TEST_MIGRATE_WAIT_MS: 'soon' }), 5000);
});

// ---- the store exports ----

test('settingsSecretLiterals skips ${VAR}, a readable model env key, references, \'\' and non-strings', () => {
  const ref = newVaultRef();
  const got = settingsSecretLiterals({
    providers: { openai: { apiKey: 'sk-lit' }, anthropic: { apiKey: '${MY_KEY}' }, openrouter: { apiKey: ref }, images: { apiKey: '' },
      sound: { apiKey: 42 } },
    models: [{ id: 'm1', env: { ANTHROPIC_MODEL: 'claude-x', ANTHROPIC_AUTH_TOKEN: 'tok-lit', OTHER: { $env: 'X' } } }],
  });
  assert.deepEqual(got, [
    { path: ['providers', 'openai', 'apiKey'], field: 'providers.openai.apiKey', value: 'sk-lit' },
    { path: ['models', 0, 'env', 'ANTHROPIC_AUTH_TOKEN'], field: 'models.env.ANTHROPIC_AUTH_TOKEN', value: 'tok-lit', modelId: 'm1' },
  ]);
});

test('swaps write only fields still holding the vaulted literal, at 0600; MCP keeps updatedAt, proxy keeps id, savedAt and rejected', async () => {
  const c = fresh();
  const ref = () => newVaultRef();
  // settings: one unchanged, one edited since the listing, one model moved to another index.
  const lits = settingsSecretLiterals(readSettings());
  const files = secretFiles(c.home, c.worca);
  const raw = JSON.parse(readFileSync(files.settings, 'utf8'));
  raw.providers.speech.stt.apiKey = 'edited-meanwhile';
  raw.models.reverse();
  writeFileSync(files.settings, JSON.stringify(raw), { mode: 0o600 });
  const swaps = lits.map((l) => ({ ...l, ref: ref() }));
  let before = 0;
  const { adopted, write } = swapSettingsSecretLiterals(swaps, { beforeWrite: () => { before++; } });
  await write;
  assert.equal(before, 1);
  assert.deepEqual(adopted.map((a) => a.field), ['providers.openai.apiKey']);
  const after = readSettings();
  assert.equal(after.providers.openai.apiKey, swaps[0].ref);
  assert.equal(after.providers.speech.stt.apiKey, 'edited-meanwhile');
  if (POSIX) assert.equal(statSync(files.settings).mode & 0o777, 0o600);
  const none = swapSettingsSecretLiterals([], { beforeWrite: () => { before++; } });
  await none.write;
  assert.equal(before, 1, 'nothing matched writes nothing');

  // plugin
  const plits = pluginSecretLiterals(PLUGIN);
  assert.deepEqual(plits.map((p) => p.field).sort(), [`${PLUGIN}/default/token`, `${PLUGIN}/work/token`]);
  const pr = plits.map((p) => ({ ...p, ref: ref() }));
  pr[1].value = 'not-what-the-file-holds';
  const pdone = swapPluginSecretLiterals(PLUGIN, pr, { beforeWrite: () => {} });
  assert.equal(pdone.adopted.length, 1);
  if (POSIX) assert.equal(statSync(files.plugin).mode & 0o777, 0o600);

  // mcp
  assert.equal(mcpSecretLiteralCount(), 2);
  const mr = await migrateMcpSecretLiterals(async (items) => items.map((it) => (it.field.endsWith('/token') ? null : ref())), { beforeWrite: () => {} });
  assert.deepEqual(mr, { moved: 1, left: 1, names: [{ set: 'General', server: MCP_SERVER, key: 'password' }] });
  const mcp = JSON.parse(readFileSync(files.mcp, 'utf8')).sets.general[MCP_SERVER];
  assert.equal(mcp.password.updatedAt, SAVED_AT);
  assert.deepEqual(mcp.region.value, { $env: 'MCP_REGION' });
  assert.equal(mcpSecretLiteralCount(), 1);

  // proxy
  const lit = proxyLoginLiteral({ home: c.worca });
  assert.equal(lit.id, 'a1b2c3d4e5f60718');
  assert.equal(swapProxyLoginLiteral({ home: c.worca, id: lit.id, value: 'other', ref: ref() }, { beforeWrite: () => {} }), false);
  const pref = ref();
  assert.equal(swapProxyLoginLiteral({ home: c.worca, id: lit.id, value: lit.value, ref: pref }, { beforeWrite: () => {} }), true);
  const rec = JSON.parse(readFileSync(files.proxy, 'utf8'));
  assert.deepEqual(rec, { v: 1, id: 'a1b2c3d4e5f60718', domain: 'ACME', user: 'jdoe', ntHash: pref, savedAt: SAVED_AT, rejected: null });
  assert.equal(proxyLoginLiteral({ home: c.worca }), null);
  if (POSIX) {
    chmodSync(files.proxy, 0o644);
    assert.deepEqual(proxyLoginLiteral({ home: c.worca }), { insecure: true });
  }
});

// ---- the orchestrator ----

test('four stores end with references and a second run changes no byte', async () => {
  const c = fresh();
  lines.length = 0;
  const r = await migrate();
  const { keys, ...rest } = r;
  assert.deepEqual(rest, { state: 'done', moved: { settings: 4, mcp: 2, plugin: 2, proxy: 1 }, left: 0 });
  assert.deepEqual(keys.map((k) => k.name).sort(), [
    'MCP set General, server pg: password', 'MCP set General, server pg: token', 'Model m-bridged: upstream API key',
    'Model m-env: env ANTHROPIC_AUTH_TOKEN', 'Plugin vault-a, profile default: token', 'Plugin vault-a, profile work: token',
    'Provider key: openai', 'Provider key: speech stt', 'Proxy login',
  ]);
  const notice = readNotice({ home: c.worca });
  assert.equal(notice.keys.length, 9, 'the notice records all 9 keys');
  assert.equal(notice.label, 'test store');
  assertNoLeak([readFileSync(join(c.worca, 'secrets-notice.json'), 'utf8')], c);
  const got = await readSecrets(c);
  for (const s of secretSlots()) {
    assert.equal(got[s.id].ref, true, `${s.id} holds a reference`);
    assert.equal(got[s.id].value, s.value, `${s.id} resolves to its original`);
  }
  const live = await liveEntries(c.vault);
  assert.equal(live.length, secretSlots().length, 'exactly one live entry per secret');
  // The values a migration leaves alone.
  const st = readSettings();
  assert.equal(st.providers.anthropic.apiKey, '${MY_KEY}');
  assert.equal(st.models[1].env.ANTHROPIC_MODEL, 'claude-x');
  if (POSIX) for (const f of Object.values(secretFiles(c.home, c.worca))) assert.equal(statSync(f).mode & 0o777, 0o600, f);
  assert.equal(ops(c.state, 'probe'), 1);
  assertNoLeak([...lines, JSON.stringify(r)], c);

  const snap = c.snap();
  const calls = readFakeCalls(c.state).length;
  const again = await migrate();
  assert.deepEqual(again, { state: 'done', moved: ZERO, left: 0, keys: [] });
  assert.equal(readNotice({ home: c.worca }).id, notice.id, 'a run with nothing to move leaves the notice id unchanged');
  assert.deepEqual(diffTrees(snap, c.snap()), []);
  assert.equal(ops(c.state, 'probe'), 1, 'no second probe');
  assert.equal(ops(c.state, 'setKey'), 1);
  assert.equal(readFakeCalls(c.state).length, calls, 'no OS-store call at all');
});

test('no-key: one key is created, every literal moves, and references resolve in the same process', async () => {
  const c = fresh();
  const r = await migrate();
  assert.equal(r.state, 'done');
  assert.equal(ops(c.state, 'setKey'), 1);
  const { resolveProviderSecret } = await import('../src/core/settings.mjs');
  assert.equal(resolveProviderSecret(readSettings().providers.openai.apiKey, process.env, 'providers.openai.apiKey'), secretSlots()[0].value);
});

test('a key ready before the run: the read-back passes and everything moves', async () => {
  const c = fresh({ fake: { state: 'available' }, seed: false });
  await (await vaultForHome({ home: c.worca })).put({ store: 'settings', field: 'providers.sound.apiKey', value: 'already-vaulted' });
  seedLiterals({ home: c.home, worca: c.worca });
  const r = await migrate();
  assert.deepEqual(r.moved, { settings: 4, mcp: 2, plugin: 2, proxy: 1 });
});

test('a value over 64 KiB stays in the config file and counts in left; an insecure proxy login file counts in left', async () => {
  const c = fresh({ big: true });
  if (POSIX) chmodSync(secretFiles(c.home, c.worca).proxy, 0o640);
  const r = await migrate();
  assert.equal(r.state, 'done');
  assert.equal(r.left, POSIX ? 2 : 1);
  assert.equal(readSettings().providers.images.apiKey.length, 65537);
  assert.deepEqual(r.moved, { settings: 4, mcp: 2, plugin: 2, proxy: POSIX ? 0 : 1 });
});

test('a Worca home other than the HOME\'s own: settings.json stays byte-identical and its literals count in left', async () => {
  const c = fresh();
  const other = join(c.tree, 'other');
  const worca = join(other, '.worca-cc');
  mkdirSync(worca, { recursive: true });
  seedLiterals({ home: c.home, worca });
  process.env.WORCA_HOME = other;
  const settingsFile = secretFiles(c.home, c.worca).settings;
  const before = readFileSync(settingsFile);
  lines.length = 0;
  const r = await migrate();
  assert.deepEqual({ ...r, keys: r.keys.length }, { state: 'done', moved: { settings: 0, mcp: 2, plugin: 2, proxy: 1 }, left: 4, keys: 5 });
  assert.deepEqual(readFileSync(settingsFile), before);
  assertNoLeak([...lines, JSON.stringify(r)], { ...c, worca });
});

test('settings.root moved to a second folder and WORCA_HOME at the HOME base: settings.json stays byte-identical', async () => {
  const c = fresh();
  const settingsFile = secretFiles(c.home, c.worca).settings;
  const root = join(c.tree, 'moved-root');
  mkdirSync(root, { recursive: true });
  writeFileSync(settingsFile, JSON.stringify({ ...JSON.parse(readFileSync(settingsFile, 'utf8')), root }, null, 2));
  const before = readFileSync(settingsFile);
  lines.length = 0;
  const r = await migrate();
  assert.equal(r.state, 'done');
  assert.equal(r.moved.settings, 0);
  assert.equal(r.left, 4);
  assert.deepEqual(readFileSync(settingsFile), before);
  assertNoLeak([...lines, JSON.stringify(r)], c);
});

test('unmarkHeld clears the mark only of references the store\'s file still holds', async () => {
  const c = fresh({ seed: false });
  const { unmarkHeld } = await import('../src/core/secrets/migrate.mjs');
  const at = Date.now();
  const a = { field: 'providers.openai.apiKey' };
  const b = { field: 'providers.speech.stt.apiKey' };
  a.ref = await c.vault.put({ store: 'settings', field: a.field, value: 'va', droppedAt: at });
  b.ref = await c.vault.put({ store: 'settings', field: b.field, value: 'vb', droppedAt: at });
  await unmarkHeld(c.vault, 'settings', [a, b], () => new Set([a.ref]));
  const marks = Object.fromEntries((await c.vault.list()).map((e) => [e.ref, e.droppedAt]));
  assert.equal(marks[a.ref], undefined, 'held: live');
  assert.equal(marks[b.ref], at, 'replaced meanwhile: stays marked for the grace collection');
});

test('no literals: done with no probe, no key read and no vault call', async () => {
  const c = fresh({ seed: false });
  const r = await migrate();
  assert.deepEqual(r, { state: 'done', moved: ZERO, left: 0, keys: [] });
  assert.equal(readFakeCalls(c.state).filter((x) => x.op !== 'getKey').length, 0);
  assert.equal(existsSync(vaultFileOf(c.worca)), false);
});

for (const [failProbe, reason, code] of [['set-locked', 'locked', 'locked'], ['set-denied', 'unavailable', 'unavailable'],
  ['timeout', 'locked', 'timeout'], ['wrong-value', 'unavailable', 'probe-mismatch'], ['missing', 'unavailable', 'probe-missing'],
  ['delete-failed', 'unavailable', 'probe-delete']]) {
  test(`preflight ${failProbe}: skipped (${code}), 0 vault writes and 0 changed bytes`, async () => {
    const c = fresh({ fake: { state: 'available', failProbe } });
    if (failProbe === 'timeout') process.env.WORCA_TEST_STORE_TIMEOUT_MS = '100';
    lines.length = 0;
    const snap = c.snap();
    let r;
    try { r = await migrate(); } finally { delete process.env.WORCA_TEST_STORE_TIMEOUT_MS; }
    assert.deepEqual(r, { state: 'skipped', reason, code, moved: ZERO, left: 0, keys: [] });
    assert.deepEqual(diffTrees(snap, c.snap()), []);
    assert.equal(ops(c.state, 'setKey'), 0);
    const probe = osProbeItemName(c.worca).account;
    assert.equal(fakeAccounts(c.state).includes(probe), failProbe === 'delete-failed');
    assert.deepEqual(lines, [`[worca] vault: secrets were not moved: the OS key store failed its check (${code}); they keep working and Worca tries again at the next start`]);
    assertNoLeak([...lines, JSON.stringify(r)], c);
  });
}

test('ready, key read-back differs: skipped key-read-back, nothing written', async () => {
  const c = fresh({ seed: false });
  await (await vaultForHome({ home: c.worca })).put({ store: 'settings', field: 'providers.sound.apiKey', value: 'v' });
  seedLiterals({ home: c.home, worca: c.worca });
  const st = JSON.parse(readFileSync(c.state, 'utf8'));
  // The primed store holds the key since the put, so the next real getKey is the run's fresh read-back.
  const getKeys = ops(c.state, 'getKey');
  writeFileSync(c.state, JSON.stringify({ ...st, keyReadBack: { differsFromCall: getKeys + 1 } }));
  const snap = c.snap();
  const r = await migrate();
  assert.deepEqual(r, { state: 'skipped', reason: 'unavailable', code: 'key-read-back', moved: ZERO, left: 0, keys: [] });
  assert.deepEqual(diffTrees(snap, c.snap()), []);
});

test('no-key, the re-primed key read-back differs: failed key-read-back, 0 changed config bytes, every literal in its file', async () => {
  // getKey calls: 1 the prime, 2 the vault's prime (still no-key), 3 the first put's key check, 4 createKey's own
  // read-back (it must still match), 5 the fresh read-back after the re-prime.
  const c = fresh({ fake: { state: 'available', keyReadBack: { differsFromCall: 5 } } });
  const files = secretFiles(c.home, c.worca);
  const before = Object.fromEntries(Object.entries(files).map(([k, f]) => [k, readFileSync(f)]));
  const r = await migrate();
  assert.equal(r.state, 'failed');
  assert.equal(r.code, 'key-read-back');
  for (const [k, f] of Object.entries(files)) assert.deepEqual(readFileSync(f), before[k], k);
  const got = await readSecrets(c);
  for (const s of secretSlots()) assert.equal(got[s.id].raw, s.value);
});

test('deployment, locked and unavailable skips change nothing; a deployment skip makes 0 fake calls', async () => {
  for (const deployment of ['container', 'hosted']) {
    const c = fresh();
    const snap = c.snap();
    assert.deepEqual(await migrate({ deployment }), { state: 'skipped', reason: 'deployment', moved: ZERO, left: 0, keys: [] });
    assert.deepEqual(readFakeCalls(c.state), []);
    assert.deepEqual(diffTrees(snap, c.snap()), []);
  }
  for (const state of ['locked', 'unavailable']) {
    const c = fresh({ fake: { state } });
    const snap = c.snap();
    assert.deepEqual(await migrate(), { state: 'skipped', reason: state, moved: ZERO, left: 0, keys: [] });
    assert.deepEqual(diffTrees(snap, c.snap()), []);
  }
});

test('a read-back mismatch fails read-back and leaves that store\'s file unchanged', async () => {
  const c = fresh();
  const vault = await vaultForHome({ home: c.worca });
  const real = vault.transaction;
  let calls = 0;
  vault.transaction = (fn) => (++calls === 2 ? real((tx) => fn({ ...tx, resolve: async () => 'not-the-value' })) : real(fn));
  const files = secretFiles(c.home, c.worca);
  const before = readFileSync(files.settings);
  let r;
  try { r = await migrate(); } finally { vault.transaction = real; }
  assert.equal(r.state, 'failed');
  assert.equal(r.code, 'read-back');
  assert.deepEqual(readFileSync(files.settings), before);
  assertNoLeak([...lines, JSON.stringify(r)], c);
});

test('inside a vault transaction: failed lock-order, nothing written', async () => {
  const c = fresh({ seed: false });
  const vault = await vaultForHome({ home: c.worca });
  await vault.put({ store: 'settings', field: 'providers.sound.apiKey', value: 'v' });
  seedLiterals({ home: c.home, worca: c.worca });
  const snap = c.snap();
  const r = await vault.transaction(() => migrate());
  assert.equal(r.state, 'failed');
  assert.equal(r.code, 'lock-order');
  assert.deepEqual(diffTrees(snap, c.snap()), []);
});

test('flag off: the gate returns off', async () => {
  fresh();
  process.env.WORCA_FLAGS = '-secretVault';
  try { assert.deepEqual(await migrate(), { state: 'off' }); } finally { process.env.WORCA_FLAGS = 'secretVault'; }
});

// ---- the notice, round trips, flag off mid-run (D19) and the rename-time check (D20) ----

const { setFlags } = await import('../src/core/flags.mjs');
const { migrateSecrets } = await import('../src/core/secrets/migrate.mjs');

// The flag in settings.json (WORCA_FLAGS deleted), so a step can turn it off; restored to the env form after.
async function withStoredFlag(fn) {
  delete process.env.WORCA_FLAGS;
  try {
    await setFlags({ secretVault: true });
    return await fn();
  } finally { process.env.WORCA_FLAGS = 'secretVault'; }
}

test('a failure after the settings store records only the settings keys in the notice', async () => {
  const c = fresh();
  const vault = await vaultForHome({ home: c.worca });
  const real = vault.transaction;
  let calls = 0;
  vault.transaction = (fn) => (++calls === 4 ? Promise.reject(new Error('boom')) : real(fn));
  let r;
  try { r = await migrate(); } finally { vault.transaction = real; }
  assert.equal(r.state, 'failed');
  assert.equal(r.moved.settings, 4);
  const notice = readNotice({ home: c.worca });
  assert.deepEqual(notice.keys.map((k) => k.store), ['settings', 'settings', 'settings', 'settings']);
});

test('round trips: one unrelated edit per store keeps every reference, and each still resolves', async () => {
  const c = fresh();
  assert.equal((await migrate()).state, 'done');
  const before = await readSecrets(c);
  const { setTheme } = await import('../src/core/settings.mjs');
  await setTheme('dark');
  const mcp = await import('../src/core/mcp/store.mjs');
  const set = await mcp.createSet('Other');
  await mcp.renameSet(set.id ?? 'other', 'Other renamed');
  const { writePluginConfig } = await import('../src/core/plugin-config.mjs');
  await writePluginConfig(PLUGIN, [{ key: 'token', secret: true }, { key: 'url' }], { url: 'https://jira.example.test' });
  const { markLoginRejected } = await import('../src/core/proxy-credentials.mjs');
  assert.equal(markLoginRejected('a1b2c3d4e5f60718', { home: c.worca, upstream: 'proxy.example.test:8080' }), true);
  const after = await readSecrets(c);
  for (const s of secretSlots()) {
    assert.equal(after[s.id].raw, before[s.id].raw, `${s.id} keeps its reference`);
    assert.equal(after[s.id].value, s.value, `${s.id} still resolves`);
  }
  assert.equal((await liveEntries(c.vault)).length, secretSlots().length);
});

test('D19: the flag turned off after the settings swap stops the run as skipped/flag-off; the other stores keep their literals', async () => {
  const c = fresh();
  await withStoredFlag(async () => {
    const vault = await vaultForHome({ home: c.worca });
    const real = vault.transaction;
    let calls = 0;
    // Transactions 1–3 are the settings store's put, read-back and unmark; the flag goes off right after them.
    vault.transaction = async (fn) => { const out = await real(fn); if (++calls === 3) await setFlags({ secretVault: false }); return out; };
    let r;
    try { r = await migrate(); } finally { vault.transaction = real; }
    assert.equal(r.state, 'skipped');
    assert.equal(r.reason, 'flag-off');
    assert.equal(r.moved.settings, 4);
    const got = await readSecrets(c);
    for (const s of secretSlots()) {
      if (s.store === 'settings') { assert.equal(got[s.id].ref, true); assert.equal(got[s.id].value, s.value, `${s.id} resolves`); }
      else assert.equal(got[s.id].raw, s.value, `${s.id} stays a literal value`);
    }
  });
});

test('D19: the flag off before the first put leaves no vault file', async () => {
  const c = fresh();
  await withStoredFlag(async () => {
    await setFlags({ secretVault: false });
    const r = await migrateSecrets({ deployment: 'local', log });
    assert.equal(r.state, 'skipped');
    assert.equal(r.reason, 'flag-off');
    assert.equal(existsSync(vaultFileOf(c.worca)), false);
    for (const s of secretSlots()) assert.equal((await readSecrets(c))[s.id].raw, s.value);
  });
});

test('D20: a plugin or settings write landing inside the swap keeps the writer\'s value, and the swap reports stale', async () => {
  const c = fresh();
  const files = secretFiles(c.home, c.worca);
  const lits = pluginSecretLiterals(PLUGIN);
  const writer = () => {
    const raw = JSON.parse(readFileSync(files.plugin, 'utf8'));
    raw.profiles.work.token = 'written-by-the-server';
    writeFileSync(files.plugin, JSON.stringify(raw), { mode: 0o600 });
  };
  const r = swapPluginSecretLiterals(PLUGIN, lits.map((l) => ({ ...l, ref: newVaultRef() })), { beforeWrite: writer });
  assert.deepEqual(r.adopted, [], 'stale: nothing adopted');
  const after = JSON.parse(readFileSync(files.plugin, 'utf8'));
  assert.equal(after.profiles.work.token, 'written-by-the-server');
  assert.equal(after.profiles.default.token, lits.find((l) => l.profile === 'default').value);

  const slits = settingsSecretLiterals(readSettings());
  const sWriter = () => {
    const raw = JSON.parse(readFileSync(files.settings, 'utf8'));
    raw.providers.openai.apiKey = 'sk-written-meanwhile';
    writeFileSync(files.settings, JSON.stringify(raw), { mode: 0o600 });
  };
  const sw = swapSettingsSecretLiterals(slits.map((l) => ({ ...l, ref: newVaultRef() })), { beforeWrite: sWriter });
  await sw.write;
  assert.deepEqual(sw.adopted, []);
  assert.equal(readSettings().providers.openai.apiKey, 'sk-written-meanwhile');
});
