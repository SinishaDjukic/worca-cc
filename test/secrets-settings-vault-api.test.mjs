// test/secrets-settings-vault-api.test.mjs — the HTTP surfaces with vaulted provider and model keys (secretVault on):
// one getKey for a server start, masks and never a reference or a resolved value in a response, the env-value reveal,
// and a masked PATCH echo that keeps the stored reference. In process over the file-backed OS-store fake.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fileFakeOsStore, readFakeCalls, writeFakeState } from './helpers/os-store-fake.mjs';
import { readSecrets, secretFiles, secretSlots, seedLiterals } from './helpers/secret-literals.mjs';
import { diffTrees, snapshotTree } from './helpers/flag-off.mjs';

const REPO = fileURLToPath(new URL('../', import.meta.url));
const ROOT = mkdtempSync(join(tmpdir(), 'worca-settings-vault-api-'));
const KEYS = ['HOME', 'USERPROFILE', 'WORCA_HOME', 'WORCA_TEST_ALLOW_HOME_FALLBACK', 'WORCA_FLAGS', 'WORCA_TEST_OS_STORE', 'WORCA_PROJECTS_ROOT'];
const prev = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
const STATE = join(ROOT, 'fake', 'state.json');
const HOME = join(ROOT, 'home');
let srv;
let base;
let settings;
let isVaultRef;

before(async () => {
  writeFakeState(STATE, { state: 'available' });
  mkdirSync(HOME, { recursive: true });
  Object.assign(process.env, {
    HOME, USERPROFILE: HOME, WORCA_HOME: HOME, WORCA_TEST_ALLOW_HOME_FALLBACK: '1', WORCA_FLAGS: 'secretVault', WORCA_TEST_OS_STORE: STATE,
  });
  delete process.env.WORCA_PROJECTS_ROOT;
  // Another process vaults first, so this one starts against a present vault and key.
  const r = spawnSync(process.execPath, ['test/fixtures/secrets/settings-child.mjs', 'save-settings-keys', '--value', 'sk-child-value-5555'],
    { cwd: REPO, env: process.env, encoding: 'utf8', timeout: 60_000 });
  assert.equal(r.status, 0, r.stderr);
  const { _resetForTests } = await import('../src/core/db.mjs');
  _resetForTests();
  settings = await import('../src/core/settings.mjs');
  ({ isVaultRef } = await import('../src/core/secrets/refs.mjs'));
  const { app } = await import('../ui/server.mjs');
  srv = http.createServer(app);
  await new Promise((res) => srv.listen(0, '127.0.0.1', res));
  base = `http://127.0.0.1:${srv.address().port}`;
});

after(async () => {
  if (srv) await new Promise((r) => srv.close(r));
  for (const [k, v] of Object.entries(prev)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  rmSync(ROOT, { recursive: true, force: true, maxRetries: 5 });
});

const call = async (method, path, body) => {
  const r = await fetch(`${base}${path}`, { method, headers: { 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
  return { status: r.status, text: await r.text() };
};
const VALUES = ['sk-child-value', 'sk-api-live', 'img-api-value', 'stt-api-value', 'snd-api-value', 'up-api-value', 'env-api-value'];
const clean = (label, text) => {
  assert.ok(!text.includes('worca:vault:'), `${label} holds a reference: ${text}`);
  for (const v of VALUES) assert.ok(!text.includes(v), `${label} holds ${v}`);
};

test('a flag-on server start makes one getKey', async () => {
  // The server start: the prime (not awaited there), then the Settings status probe through its primed store.
  assert.deepEqual(await settings.primeSettingsVaultIfEnabled(), { state: 'ready' });
  const st = JSON.parse((await call('GET', '/api/secrets/status')).text);
  assert.equal(st.state, 'ready');
  assert.equal(st.vault, 'readable');
  assert.equal(readFakeCalls(STATE).filter((c) => c.pid === process.pid && c.op === 'getKey').length, 1);
  assert.equal(settings.resolveProviderSecret(settings.readSettings().providers.openai.apiKey, process.env, 'providers.openai.apiKey'), 'sk-child-value-5555');
});

test('provider, model, images, speech and sound responses hold no vault reference and no resolved value', async () => {
  const patches = [
    ['PATCH', '/api/providers/openai', { apiKey: 'sk-api-live-7777' }],
    ['PATCH', '/api/providers/images', { apiKey: 'img-api-value-1', price: 0 }],
    ['PATCH', '/api/providers/speech', { stt: { apiKey: 'stt-api-value-1' } }],
    ['PATCH', '/api/providers/sound', { apiKey: 'snd-api-value-1' }],
    ['POST', '/api/models', { id: 'api-up', upstream: { provider: 'openai', api: 'openai-chat', model: 'm', apiKey: 'up-api-value-1' } }],
    ['POST', '/api/models', { id: 'api-env', env: { ANTHROPIC_AUTH_TOKEN: 'env-api-value-1', ANTHROPIC_BASE_URL: 'https://gw.example.test' } }],
  ];
  for (const [method, path, body] of patches) {
    const r = await call(method, path, body);
    assert.equal(r.status, 200, `${path}: ${r.text}`);
    clean(`${method} ${path}`, r.text);
  }
  const s = settings.readSettings();
  assert.ok(isVaultRef(s.providers.openai.apiKey) && isVaultRef(s.providers.images.apiKey) && isVaultRef(s.providers.sound.apiKey));
  for (const path of ['/api/providers', '/api/models', '/api/images', '/api/speech', '/api/sound']) {
    const r = await call('GET', path);
    assert.equal(r.status, 200, path);
    clean(`GET ${path}`, r.text);
  }
  const p = JSON.parse((await call('GET', '/api/providers')).text);
  assert.equal(p.openai.keyMasked, '••••••7777');
  assert.equal(p.openai.keySource, 'stored');
  assert.equal(p.openai.keyRef, null);
  assert.equal(p.images.keyMasked, '••••••ue-1');
  const models = JSON.parse((await call('GET', '/api/models')).text).models;
  assert.equal(models.find((m) => m.id === 'api-up').upstream.apiKey, '••••••ue-1');
  assert.equal(models.find((m) => m.id === 'api-env').env.ANTHROPIC_AUTH_TOKEN, '••••••ue-1');
});

test('env-value reveal, by key and whole map, returns resolved values, and 400 when not resolvable', async () => {
  let r = await call('GET', '/api/models/api-env/env-value?key=ANTHROPIC_AUTH_TOKEN');
  assert.deepEqual(JSON.parse(r.text), { key: 'ANTHROPIC_AUTH_TOKEN', value: 'env-api-value-1' });
  r = await call('GET', '/api/models/api-env/env-value');
  assert.deepEqual(JSON.parse(r.text), { env: { ANTHROPIC_AUTH_TOKEN: 'env-api-value-1', ANTHROPIC_BASE_URL: 'https://gw.example.test' } });
  // A reference that does not resolve here (no entry behind it).
  const { newVaultRef, VAULT_MESSAGES } = await import('../src/core/secrets/refs.mjs');
  const { writeSettingsKeys } = settings;
  const s = settings.readSettings();
  await writeSettingsKeys({ models: s.models.map((m) => (m.id === 'api-env' ? { ...m, env: { ...m.env, ANTHROPIC_AUTH_TOKEN: newVaultRef() } } : m)) });
  for (const path of ['/api/models/api-env/env-value?key=ANTHROPIC_AUTH_TOKEN', '/api/models/api-env/env-value']) {
    r = await call('GET', path);
    assert.equal(r.status, 400, path);
    assert.deepEqual(JSON.parse(r.text), { error: `The key was not revealed: ${VAULT_MESSAGES['store-locked']}` });
  }
});

test('PATCH /api/models with a masked echo keeps the stored reference', async () => {
  const ref = settings.readSettings().models.find((m) => m.id === 'api-up').upstream.apiKey;
  const r = await call('PATCH', '/api/models/api-up', { label: 'Renamed', upstream: { provider: 'openai', api: 'openai-chat', model: 'm', apiKey: '••••••ue-1' } });
  assert.equal(r.status, 200, r.text);
  clean('PATCH /api/models', r.text);
  const after = settings.readSettings().models.find((m) => m.id === 'api-up');
  assert.equal(after.label, 'Renamed');
  assert.equal(after.upstream.apiKey, ref);
  // A copy through the route seals a new entry with the same value.
  const c = await call('POST', '/api/models', { id: 'api-up-copy', copyFrom: 'api-up', upstream: { provider: 'openai', api: 'openai-chat', model: 'm', apiKey: '••••••ue-1' } });
  assert.equal(c.status, 200, c.text);
  const copy = settings.readSettings().models.find((m) => m.id === 'api-up-copy').upstream.apiKey;
  assert.ok(isVaultRef(copy) && copy !== ref);
  assert.equal(settings.resolveProviderSecret(copy, process.env, 'models.upstream.apiKey'), 'up-api-value-1');
});

// ---- the secret migration through the server (these reseed settings.json, so they run last) ----

async function poll(fn, ms = 30_000) {
  for (const t0 = Date.now(); Date.now() - t0 < ms; await new Promise((r) => setTimeout(r, 50))) if (await fn()) return true;
  return false;
}
// An off-to-on edge of the flag, as Labs sends it (WORCA_FLAGS no longer pins it).
async function flagEdge() {
  delete process.env.WORCA_FLAGS;
  assert.equal((await call('PATCH', '/api/flags', { secretVault: false })).status, 200);
  assert.equal((await call('PATCH', '/api/flags', { secretVault: true })).status, 200);
}

test('turning secretVault on moves seeded literals in all four stores into the vault; a later flag PATCH writes nothing', async () => {
  const { worcaHome } = await import('../src/core/projects.mjs');
  const { createVault, vaultFile } = await import('../src/core/secrets/vault.mjs');
  const { osItemName } = await import('../src/core/secrets/os-store.mjs');
  const worca = worcaHome();
  delete process.env.WORCA_FLAGS;
  assert.equal((await call('PATCH', '/api/flags', { secretVault: false })).status, 200);
  seedLiterals({ home: HOME, worca });
  assert.equal((await call('PATCH', '/api/flags', { secretVault: true })).status, 200);
  const vault = createVault({ home: worca, store: fileFakeOsStore(STATE, { item: osItemName(worca) }) });
  let got;
  assert.ok(await poll(async () => { got = await readSecrets({ home: HOME, worca, vault }); return Object.values(got).every((g) => g.ref); }),
    'all four files hold references');
  for (const x of secretSlots()) assert.equal(got[x.id].value, x.value, x.id);
  const bytes = readFileSync(vaultFile(worca));
  const probes = readFakeCalls(STATE).filter((c) => c.op === 'probe').length;
  assert.equal((await call('PATCH', '/api/flags', { flagsDemo: true })).status, 200);
  assert.equal((await call('PATCH', '/api/flags', { flagsDemo: false })).status, 200);
  await new Promise((r) => setTimeout(r, 200));
  assert.deepEqual(readFileSync(vaultFile(worca)), bytes, 'no vault write without an off-to-on edge');
  assert.equal(readFakeCalls(STATE).filter((c) => c.op === 'probe').length, probes);
});

test('a failed preflight shows store-check on the Settings secrets route, with no secret, reference or path in the body', async () => {
  const { STORE_CHECK_MESSAGE } = await import('../ui/routes/settings/secrets.mjs');
  const { VAULT_MESSAGES } = await import('../src/core/secrets/refs.mjs');
  assert.equal(STORE_CHECK_MESSAGE, VAULT_MESSAGES['store-check']);
  const { worcaHome } = await import('../src/core/projects.mjs');
  seedLiterals({ home: HOME, worca: worcaHome(), tag: 'b' });
  const saved = readFileSync(STATE, 'utf8');
  writeFileSync(STATE, JSON.stringify({ ...JSON.parse(saved), failProbe: 'wrong-value' }));
  try {
    await flagEdge();
    let body;
    assert.ok(await poll(async () => { body = await call('GET', '/api/secrets/status'); return JSON.parse(body.text).reason === 'store-check'; }));
    const st = JSON.parse(body.text);
    assert.equal(st.state, 'unavailable');
    assert.equal(st.message, VAULT_MESSAGES['store-check']);
    assert.equal(st.code, 'probe-mismatch');
    for (const x of secretSlots('b')) assert.ok(!body.text.includes(x.value));
    for (const needle of ['cnry7d3f', 'worca:vault:v1:', 'vault-probe-', ROOT]) assert.ok(!body.text.includes(needle), needle);
    // Nothing moved.
    const raw = JSON.parse(readFileSync(secretFiles(HOME, worcaHome()).settings, 'utf8'));
    assert.equal(raw.providers.openai.apiKey, secretSlots('b')[0].value);
  } finally {
    writeFileSync(STATE, saved);
  }
});

test('a container server (WORCA_CONTAINER=1) turned on makes no OS key store call at all and changes no byte', async () => {
  const dir = mkdtempSync(join(ROOT, 'container-'));
  const home = join(dir, 'tree', 'home');
  const worca = join(dir, 'tree', 'worca', '.worca-cc');
  mkdirSync(home, { recursive: true });
  mkdirSync(worca, { recursive: true });
  const state = join(dir, 'fake', 'state.json');
  writeFakeState(state, { state: 'available' });
  seedLiterals({ home, worca });
  const env = { ...process.env, HOME: home, USERPROFILE: home, WORCA_HOME: join(dir, 'tree', 'worca'), WORCA_TEST_ALLOW_HOME_FALLBACK: '1',
    WORCA_TEST_OS_STORE: state, WORCA_CONTAINER: '1' };
  delete env.WORCA_FLAGS;
  const script = "const { app } = await import('./ui/server.mjs'); const http = await import('node:http');"
    + " const s = http.createServer(app); s.listen(0, '127.0.0.1', () => console.log('port ' + s.address().port));";
  const child = spawn(process.execPath, ['--input-type=module', '-e', script], { cwd: REPO, env, stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    let out = '';
    child.stdout.on('data', (b) => { out += b; });
    assert.ok(await poll(() => /port \d+/.test(out), 60_000), 'the server child listens');
    const port = out.match(/port (\d+)/)[1];
    const before = snapshotTree(join(dir, 'tree'));
    const r = await fetch(`http://127.0.0.1:${port}/api/flags`, { method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ secretVault: true }) });
    assert.equal(r.status, 200);
    // A container has no OS key store (secrets/place.mjs): the flag edge neither primes nor migrates, so the fake is never asked.
    await new Promise((res) => setTimeout(res, 1500));
    assert.deepEqual(readFakeCalls(state), []);
    const diff = diffTrees(before, snapshotTree(join(dir, 'tree'))).filter((d) => !/settings\.json$|worca-cc\.db/.test(d.path));
    assert.deepEqual(diff, []);
    const raw = JSON.parse(readFileSync(secretFiles(home, worca).settings, 'utf8'));
    assert.equal(raw.providers.openai.apiKey, secretSlots()[0].value, 'the literal stays');
  } finally {
    child.kill();
  }
});
