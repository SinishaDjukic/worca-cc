// test/secrets-settings-resolver.test.mjs — the sync resolver for vault references in settings.json: locked before a
// key, one getKey for many reads, a re-read only on a file change, another process's write seen on the next read,
// owner binding, a tampered file never cached, the three-argument guard and the import closure.
// In process over the file-backed OS-store fake (secretVault on), plus settings-child.mjs for the other process.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createFakeOsStore, readFakeCalls, writeFakeState } from './helpers/os-store-fake.mjs';
import { importClosure } from './helpers/import-closure.mjs';

const REPO = fileURLToPath(new URL('../', import.meta.url));
const CHILD = fileURLToPath(new URL('./fixtures/secrets/settings-child.mjs', import.meta.url));
const ROOT = mkdtempSync(join(tmpdir(), 'worca-settings-resolver-'));
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
  rmSync(ROOT, { recursive: true, force: true, maxRetries: 5 });
});

const resolver = await import('../src/core/secrets/settings-resolver.mjs');
const { newVaultRef } = await import('../src/core/secrets/refs.mjs');
const { createVault, readVaultEntriesSync, vaultFile } = await import('../src/core/secrets/vault.mjs');
const { readSettings, resolveProviderSecret } = await import('../src/core/settings.mjs');
const { primeSettingsVault } = await import('../src/core/secrets/settings-vault.mjs');

const OPENAI = 'providers.openai.apiKey';
let n = 0;
async function memoryVault() {
  const home = mkdtempSync(join(ROOT, `mem${++n}-`));
  const fake = createFakeOsStore();
  const vault = createVault({ home, store: fake });
  return { home, fake, vault, file: vaultFile(home) };
}
const install = (file, key) => resolver.installSettingsVaultReader({ file, read: () => readVaultEntriesSync(file, key) });

function runChild(args, env = {}) {
  const r = spawnSync(process.execPath, [CHILD, ...args], { cwd: REPO, env: { ...process.env, ...env }, encoding: 'utf8', timeout: 60_000 });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout;
}

test('before a key is installed a reference resolves to \'\' and reports locked', () => {
  const ref = newVaultRef();
  assert.deepEqual(resolver.resolveSettingsRef(ref, OPENAI), { code: 'locked' });
  assert.equal(resolver.resolveSettingsSecretSync(ref, OPENAI), '');
  assert.equal(resolveProviderSecret(ref, process.env, OPENAI), '');
  assert.equal(resolver.resolveSettingsSecretSync('sk-plain', OPENAI), 'sk-plain');
  assert.deepEqual(resolver.resolveSettingsRef('sk-plain', OPENAI), { code: 'bad-ref' });
  assert.equal(resolver.settingsVaultState().loaded, false);
});

test('settingsSecretField names the D6 fields and throws on anything else', () => {
  assert.equal(resolver.settingsSecretField('providers', 'openai', 'apiKey'), OPENAI);
  assert.equal(resolver.settingsSecretField('providers', 'speech', 'tts', 'apiKey'), 'providers.speech.tts.apiKey');
  assert.equal(resolver.settingsSecretField('models', 'upstream', 'apiKey'), 'models.upstream.apiKey');
  assert.equal(resolver.settingsSecretField('models', 'env', 'ANTHROPIC_AUTH_TOKEN'), 'models.env.ANTHROPIC_AUTH_TOKEN');
  for (const bad of [['providers', 'openai', 'baseUrl'], ['mcp', 'x'], ['models', 'env', 'a b'], ['models', 'upstream', 'baseUrl']]) {
    assert.throws(() => resolver.settingsSecretField(...bad), /unknown settings secret field/);
  }
});

test('settingsSecretSlots yields the field set settingsSecretRefs reads, every slot a valid owner field', () => {
  const r = () => newVaultRef();
  const settings = {
    providers: { openai: { apiKey: r() }, anthropic: { apiKey: r() }, openrouter: { apiKey: r() }, images: { apiKey: r() }, sound: { apiKey: r() },
      copilot: { githubToken: r() }, speech: { stt: { apiKey: r() }, tts: { apiKey: r() } } },
    models: [{ id: 'm1', upstream: { apiKey: r() }, env: { ANTHROPIC_AUTH_TOKEN: r(), 'bad key': r() } }, { id: 'm2', env: { X_TOKEN: r() } }],
  };
  const slots = resolver.settingsSecretSlots(settings);
  const refs = resolver.settingsSecretRefs(settings);
  assert.deepEqual(refs, slots.filter((x) => x.value !== undefined).map((x) => ({ ref: x.value, field: x.field })));
  assert.equal(refs.length, 11, 'the bad env key name is never a slot');
  const at = (o, path) => path.reduce((x, k) => x?.[k], o);
  for (const x of slots) {
    assert.equal(at(settings, x.path), x.value);
    const [kind, ...parts] = x.field.split('.');
    assert.equal(resolver.settingsSecretField(kind, ...parts), x.field);
    if (x.path[0] === 'models') assert.equal(x.modelId, settings.models[x.path[1]].id);
  }
  assert.deepEqual(resolver.settingsSecretSlots({}).map((x) => x.value), Array(8).fill(undefined));
});

test('a reference resolved under another field returns \'\'', async () => {
  const { fake, vault, file } = await memoryVault();
  const ref = await vault.put({ store: 'settings', field: OPENAI, value: 'sk-own' });
  const mcp = await vault.put({ store: 'mcp', field: OPENAI, value: 'mcp-value' });
  install(file, fake.peekKey());
  assert.deepEqual(resolver.resolveSettingsRef(ref, OPENAI), { value: 'sk-own' });
  assert.deepEqual(resolver.resolveSettingsRef(ref, 'providers.anthropic.apiKey'), { code: 'cross-owner' });
  assert.deepEqual(resolver.resolveSettingsRef(mcp, OPENAI), { code: 'cross-owner' }, 'another store');
  assert.equal(resolveProviderSecret(ref, process.env, 'providers.anthropic.apiKey'), '');
  assert.equal(resolveProviderSecret(ref, process.env, null), '', 'a typed reference never resolves');
  assert.deepEqual(resolver.resolveSettingsRef(newVaultRef(), OPENAI), { code: 'unknown-ref' });
  resolver.clearSettingsVaultReader();
});

test('resolveVaultRefSync resolves an mcp entry for its own owner only', async () => {
  const { fake, vault, file } = await memoryVault();
  const owner = { store: 'mcp', field: 'manual:gh/token' };
  const ref = await vault.put({ ...owner, value: 'ghp-own' });
  install(file, fake.peekKey());
  assert.deepEqual(resolver.resolveVaultRefSync(ref, owner), { value: 'ghp-own' });
  assert.deepEqual(resolver.resolveVaultRefSync(ref, { store: 'settings', field: owner.field }), { code: 'cross-owner' });
  assert.deepEqual(resolver.resolveVaultRefSync(ref, { store: 'mcp', field: 'manual:gh/other' }), { code: 'cross-owner' });
  assert.deepEqual(resolver.resolveSettingsRef(ref, owner.field), { code: 'cross-owner' });
  resolver.clearSettingsVaultReader();
});

test('decrypts again only when the vault file changes', async () => {
  const { fake, vault, file } = await memoryVault();
  const ref = await vault.put({ store: 'settings', field: OPENAI, value: 'sk-a' });
  install(file, fake.peekKey());
  const d0 = resolver.settingsResolverStats().decrypts;
  for (let i = 0; i < 100; i++) assert.equal(resolver.resolveSettingsSecretSync(ref, OPENAI), 'sk-a');
  assert.equal(resolver.settingsResolverStats().decrypts - d0, 1);
  await vault.put({ store: 'settings', field: OPENAI, value: 'sk-b', ref });
  for (let i = 0; i < 10; i++) assert.equal(resolver.resolveSettingsSecretSync(ref, OPENAI), 'sk-b');
  assert.equal(resolver.settingsResolverStats().decrypts - d0, 2);
  resolver.clearSettingsVaultReader();
});

test('a tampered vault resolves \'\' and is not cached as good', async () => {
  const { fake, vault, file } = await memoryVault();
  const ref = await vault.put({ store: 'settings', field: OPENAI, value: 'sk-t' });
  install(file, fake.peekKey());
  assert.equal(resolver.resolveSettingsSecretSync(ref, OPENAI), 'sk-t');
  const good = readFileSync(file);
  const env = JSON.parse(good);
  const data = Buffer.from(env.data, 'base64');
  data[3] ^= 0xff;
  writeFileSync(file, JSON.stringify({ ...env, data: data.toString('base64') }));
  assert.deepEqual(resolver.resolveSettingsRef(ref, OPENAI), { code: 'tampered' });
  assert.deepEqual(resolver.resolveSettingsRef(ref, OPENAI), { code: 'tampered' }, 'read again, not cached');
  writeFileSync(file, good);
  assert.equal(resolver.resolveSettingsSecretSync(ref, OPENAI), 'sk-t');
  resolver.clearSettingsVaultReader();
});

test('100 reads make one getKey, and another process\'s write is read on the next read', async () => {
  runChild(['save-settings-keys', '--value', 'sk-1']);
  const mine = () => readFakeCalls(STATE).filter((c) => c.pid === process.pid && c.op === 'getKey').length;
  const before = mine();
  assert.deepEqual(await primeSettingsVault(), { state: 'ready' });
  const ref = readSettings().providers.openai.apiKey;
  assert.match(ref, /^worca:vault:v1:/);
  for (let i = 0; i < 100; i++) {
    assert.equal(resolveProviderSecret(readSettings().providers.openai.apiKey, process.env, OPENAI), 'sk-1');
  }
  assert.equal(mine() - before, 1);
  runChild(['save-settings-keys', '--value', 'sk-2']);
  assert.notEqual(readSettings().providers.openai.apiKey, ref, 'a re-save seals a fresh entry');
  assert.equal(resolveProviderSecret(readSettings().providers.openai.apiKey, process.env, OPENAI), 'sk-2');
  assert.equal(mine() - before, 1);
});

test('a process primed with no key reads a vault another process created', async () => {
  const base = join(ROOT, 'second');
  const home = join(ROOT, 'second-home');
  mkdirSync(home, { recursive: true });
  const worcaDir = join(base, '.worca-cc');
  assert.deepEqual(await primeSettingsVault({ home: worcaDir }), { state: 'no-key' });
  runChild(['save-settings-keys', '--value', 'sk-1'], { WORCA_HOME: base, HOME: home, USERPROFILE: home });
  const ref = JSON.parse(readFileSync(join(home, '.worca-cc', 'settings.json'), 'utf8')).providers.openai.apiKey;
  assert.equal(resolver.resolveSettingsSecretSync(ref, OPENAI), '', 'locked until the scheduled re-prime');
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(await primeSettingsVault({ home: worcaDir }), { state: 'ready' });
  assert.equal(resolver.resolveSettingsSecretSync(ref, OPENAI), 'sk-1');
});

/** Every `resolveProviderSecret(` call in `text` with fewer than 3 top-level arguments, as `name:line`. */
function shortCalls(name, text) {
  const out = [];
  const re = /\bresolveProviderSecret\(/g;
  for (let m; (m = re.exec(text));) {
    const before = text.slice(text.lastIndexOf('\n', m.index) + 1, m.index);
    if (/function\s+$/.test(before) || before.trimStart().startsWith('//') || before.trimStart().startsWith('*')) continue;
    let depth = 1;
    let commas = 0;
    let quote = null;
    let i = m.index + m[0].length;
    for (; i < text.length && depth > 0; i++) {
      const c = text[i];
      if (quote) { if (c === '\\') i++; else if (c === quote) quote = null; continue; }
      if (c === '"' || c === "'" || c === '`') quote = c;
      else if ('([{'.includes(c)) depth++;
      else if (')]}'.includes(c)) depth--;
      else if (c === ',' && depth === 1) commas++;
    }
    if (commas < 2) out.push(`${name}:${text.slice(0, m.index).split('\n').length}`);
  }
  return out;
}

test('every resolveProviderSecret call passes three arguments', () => {
  assert.deepEqual(shortCalls('fixture', 'const x = resolveProviderSecret(f(a, b), env);\n'), ['fixture:1']);
  assert.deepEqual(shortCalls('fixture', 'const x = resolveProviderSecret(f(a, b), env, null);\n'), []);
  const offending = [];
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) { if (e.name !== 'node_modules') walk(p); continue; }
      if (!e.name.endsWith('.mjs') || !statSync(p).isFile()) continue;
      const text = readFileSync(p, 'utf8');
      if (text.includes('resolveProviderSecret(')) offending.push(...shortCalls(relative(REPO, p).split('\\').join('/'), text));
    }
  };
  walk(join(REPO, 'src'));
  walk(join(REPO, 'ui'));
  assert.deepEqual(offending, []);
});

test('the resolver imports only node:fs and refs.mjs', () => {
  assert.deepEqual(importClosure('src/core/secrets/settings-resolver.mjs'), { modules: ['src/core/secrets/refs.mjs'], bare: ['node:crypto', 'node:fs'] });
});
