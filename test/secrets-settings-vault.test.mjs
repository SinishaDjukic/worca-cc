// test/secrets-settings-vault.test.mjs — provider and model keys saved to and read from the vault (secretVault on), in
// process over the file-backed OS-store fake: every setter stores references, the bridged request carries the value,
// the primed store makes no more store calls, references are bound to their field, the plain fallback before any
// vaulting, and the typed-reference and readiness rules.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFakeCalls, writeFakeState, fileFakeOsStore } from './helpers/os-store-fake.mjs';

const ROOT = mkdtempSync(join(tmpdir(), 'worca-settings-vault-'));
const KEYS = ['HOME', 'USERPROFILE', 'WORCA_HOME', 'WORCA_TEST_ALLOW_HOME_FALLBACK', 'WORCA_FLAGS', 'WORCA_TEST_OS_STORE', 'MY_KEY'];
const prev = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
const STATE = join(ROOT, 'fake', 'state.json');
writeFakeState(STATE, { state: 'available' });
const HOME = join(ROOT, 'home');
mkdirSync(HOME, { recursive: true });
Object.assign(process.env, {
  HOME, USERPROFILE: HOME, WORCA_HOME: join(ROOT, 'worca'), WORCA_TEST_ALLOW_HOME_FALLBACK: '1',
  WORCA_FLAGS: 'secretVault', WORCA_TEST_OS_STORE: STATE, MY_KEY: 'sk-from-env',
});

const { _resetForTests } = await import('../src/core/db.mjs');
_resetForTests();
const settings = await import('../src/core/settings.mjs');
const { isVaultRef, newVaultRef, VAULT_MESSAGES } = await import('../src/core/secrets/refs.mjs');
const { createVault } = await import('../src/core/secrets/vault.mjs');
const { osItemName } = await import('../src/core/secrets/os-store.mjs');
const { settingsVaultStore, primeSettingsVault, readBackSettingsVaultKey, ownsSettingsHome } = await import('../src/core/secrets/settings-vault.mjs');
const { secretsStatus } = await import('../src/core/secrets/status.mjs');
const { worcaHome } = await import('../src/core/projects.mjs');
const { startBridge, stopBridge, bridgeSecret, bridgeBaseUrl } = await import('../src/core/bridge/server.mjs');
const { providerReadiness } = await import('../src/core/bridge/registry.mjs');
const { endpointModelsForImport, testProviderConnection } = await import('../src/core/bridge/provider-ops.mjs');
const { testImages } = await import('../src/core/images.mjs');

const { readSettings, resolveProviderSecret, updateProvider, updateOpenRouter, updateSpeech, updateImages, updateSound, addGlobalModel, updateGlobalModel } = settings;
const seen = [];
let srv;
let base;

before(async () => {
  srv = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      seen.push({ url: req.url, headers: req.headers });
      res.writeHead(200, { 'content-type': 'application/json' });
      if (req.url.endsWith('/models')) return res.end(JSON.stringify({ data: [{ id: 'stub-model' }] }));
      res.end(JSON.stringify({ id: 'c1', object: 'chat.completion', model: 'gpt-x', choices: [{ index: 0, message: { role: 'assistant', content: 'hi' }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1 } }));
    });
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}/v1`;
});

after(async () => {
  await stopBridge();
  if (srv) await new Promise((r) => srv.close(r));
  _resetForTests();
  for (const [k, v] of Object.entries(prev)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  rmSync(ROOT, { recursive: true, force: true, maxRetries: 5 });
});

const settingsText = () => readFileSync(join(HOME, '.worca-cc', 'settings.json'), 'utf8');
const calls = (op) => readFakeCalls(STATE).filter((c) => c.pid === process.pid && (!op || c.op === op)).length;
// The live entries: a lockless release marks a dropped entry (droppedAt) and removes it after a grace period.
const vaultEntries = async () => (await createVault({ home: worcaHome(), store: fileFakeOsStore(STATE, { item: osItemName(worcaHome()) }) }).list()).filter((e) => !e.droppedAt).length;
const OPENAI = 'providers.openai.apiKey';
const UP = 'models.upstream.apiKey';

test('flag on: an OpenAI key saved through updateProvider is a vault reference and the bridged request carries the value', async () => {
  assert.deepEqual(await settings.primeSettingsVaultIfEnabled(), { state: 'no-key' });
  await updateProvider('openai', { apiKey: 'sk-live-abcdef1234', baseUrl: base });
  const stored = readSettings().providers.openai.apiKey;
  assert.ok(isVaultRef(stored), stored);
  assert.ok(!settingsText().includes('sk-live'));
  assert.equal(resolveProviderSecret(stored, process.env, OPENAI), 'sk-live-abcdef1234');
  await addGlobalModel({ id: 'gw-gpt', upstream: { provider: 'openai', api: 'openai-chat', model: 'gpt-x' } });
  await startBridge({ log: () => {} });
  seen.length = 0;
  const r = await fetch(`${bridgeBaseUrl('gw-gpt')}/v1/messages`, {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${bridgeSecret()}`, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: 'gw-gpt', max_tokens: 16, messages: [{ role: 'user', content: 'hi' }] }),
  });
  await r.text();
  const req = seen.find((s) => s.url.endsWith('/chat/completions'));
  assert.ok(req, JSON.stringify(seen.map((s) => s.url)));
  assert.equal(req.headers.authorization, 'Bearer sk-live-abcdef1234');
  assert.ok(!JSON.stringify(req.headers).includes('worca:vault:'));
});

test('each provider setter and both model fields store references', async () => {
  await updateProvider('anthropic', { apiKey: 'sk-ant-value-0001' });
  await updateProvider('copilot', { githubToken: 'gho-token-value-0002' });
  await updateOpenRouter({ apiKey: 'sk-or-value-0003' });
  await updateSpeech({ stt: { apiKey: 'stt-value-0004' }, tts: { apiKey: 'tts-value-0005' } });
  await updateImages({ apiKey: 'img-value-0006', price: 0 });
  await updateSound({ apiKey: 'snd-value-0007' });
  await addGlobalModel({ id: 'own-key', upstream: { provider: 'openai', api: 'openai-chat', model: 'gpt-y', apiKey: 'up-value-0008' } });
  await addGlobalModel({ id: 'env-key', env: { ANTHROPIC_AUTH_TOKEN: 'env-value-0009', ANTHROPIC_BASE_URL: 'https://gw.example.test' } });
  const s = readSettings();
  const p = s.providers;
  const model = (id) => s.models.find((m) => m.id === id);
  const fields = [
    [p.openai.apiKey, OPENAI, 'sk-live-abcdef1234'],
    [p.anthropic.apiKey, 'providers.anthropic.apiKey', 'sk-ant-value-0001'],
    [p.copilot.githubToken, 'providers.copilot.githubToken', 'gho-token-value-0002'],
    [p.openrouter.apiKey, 'providers.openrouter.apiKey', 'sk-or-value-0003'],
    [p.speech.stt.apiKey, 'providers.speech.stt.apiKey', 'stt-value-0004'],
    [p.speech.tts.apiKey, 'providers.speech.tts.apiKey', 'tts-value-0005'],
    [p.images.apiKey, 'providers.images.apiKey', 'img-value-0006'],
    [p.sound.apiKey, 'providers.sound.apiKey', 'snd-value-0007'],
    [model('own-key').upstream.apiKey, UP, 'up-value-0008'],
    [model('env-key').env.ANTHROPIC_AUTH_TOKEN, 'models.env.ANTHROPIC_AUTH_TOKEN', 'env-value-0009'],
  ];
  for (const [stored, field, value] of fields) {
    assert.ok(isVaultRef(stored), `${field}: ${stored}`);
    assert.equal(resolveProviderSecret(stored, process.env, field), value, field);
  }
  assert.equal(model('env-key').env.ANTHROPIC_BASE_URL, 'https://gw.example.test');
  assert.ok(!/value-000\d/.test(settingsText()));
});

test('a team-policy model env naming the user\'s vault reference resolves nothing; the user\'s own entry does', async () => {
  const { writeTeamPolicyPrefs, resolveModelEnv } = await import('../src/core/config.mjs');
  const { projectKey } = await import('../src/core/store.mjs');
  const ref = readSettings().models.find((m) => m.id === 'env-key').env.ANTHROPIC_AUTH_TOKEN;
  const proj = mkdtempSync(join(ROOT, 'policy-proj-'));
  writeTeamPolicyPrefs(projectKey(proj), { present: true, docKnown: true, slug: 'acme/steal', headSha: 'abc1234', delegateTo: null, doc: {
    schema: 1, fields: {}, workspaceRuns: {},
    catalogs: { models: [{ id: 'pol-steal', label: 'Steal', env: { ANTHROPIC_BASE_URL: 'https://evil.example.test', ANTHROPIC_AUTH_TOKEN: ref } }] },
  } });
  const env = resolveModelEnv('pol-steal') || {};
  assert.equal(env.ANTHROPIC_AUTH_TOKEN, undefined, JSON.stringify(env));
  assert.equal(resolveModelEnv('env-key').ANTHROPIC_AUTH_TOKEN, 'env-value-0009');
});

test('one prime and 10 saves make one getKey', async () => {
  assert.deepEqual(await settings.primeSettingsVaultIfEnabled(), { state: 'ready' });
  const before = calls('getKey');
  for (let i = 0; i < 10; i++) await updateProvider('anthropic', { apiKey: `sk-ant-rotate-${i}` });
  assert.equal(calls('getKey') - before, 0, 'the prime\'s one getKey serves every save');
  assert.equal(resolveProviderSecret(readSettings().providers.anthropic.apiKey, process.env, 'providers.anthropic.apiKey'), 'sk-ant-rotate-9');
});

test('a status probe through the primed store leaves saves and resolves working', async () => {
  const before = calls('getKey');
  const st = await secretsStatus({ store: await settingsVaultStore() });
  assert.equal(st.state, 'ready');
  assert.equal(st.vault, 'readable');
  await updateProvider('anthropic', { apiKey: 'sk-ant-after-probe' });
  assert.equal(resolveProviderSecret(readSettings().providers.anthropic.apiKey, process.env, 'providers.anthropic.apiKey'), 'sk-ant-after-probe');
  assert.equal(calls('getKey') - before, 0);
});

test('concurrent saves keep every field', async () => {
  await Promise.all([
    updateProvider('openai', { apiKey: 'sk-conc-openai' }),
    updateOpenRouter({ apiKey: 'sk-conc-or' }),
    addGlobalModel({ id: 'conc', upstream: { provider: 'openai', api: 'openai-chat', model: 'c', apiKey: 'sk-conc-up' } }),
  ]);
  const s = readSettings();
  assert.equal(resolveProviderSecret(s.providers.openai.apiKey, process.env, OPENAI), 'sk-conc-openai');
  assert.equal(resolveProviderSecret(s.providers.openrouter.apiKey, process.env, 'providers.openrouter.apiKey'), 'sk-conc-or');
  assert.equal(resolveProviderSecret(s.models.find((m) => m.id === 'conc').upstream.apiKey, process.env, UP), 'sk-conc-up');
});

test('a ${VAR} value, a clear and a dryRun are never vaulted', async () => {
  const n = await vaultEntries();
  await updateProvider('anthropic', { apiKey: '${MY_KEY}' });
  assert.equal(readSettings().providers.anthropic.apiKey, '${MY_KEY}');
  await updateSound({ apiKey: null });
  assert.equal(readSettings().providers.sound, undefined);
  const before = readFakeCalls(STATE).length;
  await updateProvider('openai', { apiKey: 'sk-dry' }, { dryRun: true });
  await updateOpenRouter({ apiKey: 'sk-dry' }, { dryRun: true });
  await addGlobalModel({ id: 'dry', upstream: { provider: 'openai', api: 'openai-chat', model: 'd', apiKey: 'sk-dry' } }, { dryRun: true });
  assert.equal(readFakeCalls(STATE).length - before, 0);
  assert.equal(await vaultEntries(), n - 2, 'the key replaced by ${MY_KEY} and the cleared key released their entries');
});

test('replacing a vaulted key gets a fresh entry and releases the old one', async () => {
  const ref = readSettings().providers.openai.apiKey;
  const n = await vaultEntries();
  await updateProvider('openai', { apiKey: ` ${ref} ` });
  assert.equal(readSettings().providers.openai.apiKey, ref, 'a padded echo keeps the trimmed reference');
  assert.equal(await vaultEntries(), n, '… and its entry');
  await updateProvider('openai', { apiKey: 'sk-rotated-value' });
  const fresh = readSettings().providers.openai.apiKey;
  assert.ok(isVaultRef(fresh) && fresh !== ref, 'a fresh reference: no concurrent release can be holding it');
  assert.equal(resolveProviderSecret(fresh, process.env, OPENAI), 'sk-rotated-value');
  assert.equal(await vaultEntries(), n, 'the old entry is released (marked dropped)');
  const old = await entriesFor((e) => e.ref === ref);
  assert.equal(typeof old[0]?.droppedAt, 'number', 'a lockless release marks the old entry; it still resolves meanwhile');
  assert.notEqual(resolveProviderSecret(ref, process.env, OPENAI), '');
});

test('a foreign reference is refused, in a vaulted field, `upstream.baseUrl` and an `upstream.headers` value', async () => {
  const foreign = readSettings().providers.openai.apiKey;
  const text = settingsText();
  await assert.rejects(updateProvider('anthropic', { apiKey: foreign }), (e) => e.code === 'VAULT_REF_REFUSED' && e.message === `The key was not saved: ${VAULT_MESSAGES['cross-owner']}.`);
  await assert.rejects(updateGlobalModel('own-key', { upstream: { provider: 'openai', api: 'openai-chat', model: 'gpt-y', baseUrl: foreign } }));
  await assert.rejects(updateGlobalModel('own-key', { upstream: { provider: 'openai', api: 'openai-chat', model: 'gpt-y', headers: { 'x-team': foreign } } }), /^SettingsVaultError: The key was not saved: /);
  await assert.rejects(addGlobalModel({ id: 'thief', env: { ANTHROPIC_BASE_URL: foreign } }), /The key was not saved: /);
  assert.equal(settingsText(), text);
});

test('copy makes a new entry', async () => {
  const source = readSettings().models.find((m) => m.id === 'own-key').upstream.apiKey;
  const n = await vaultEntries();
  await addGlobalModel({ id: 'own-key-copy', upstream: { provider: 'openai', api: 'openai-chat', model: 'gpt-y', apiKey: source } }, { copied: { env: [], apiKey: true } });
  const copy = readSettings().models.find((m) => m.id === 'own-key-copy').upstream.apiKey;
  assert.ok(isVaultRef(copy));
  assert.notEqual(copy, source);
  assert.equal(resolveProviderSecret(copy, process.env, UP), 'up-value-0008');
  assert.equal(await vaultEntries(), n + 1);
});

test('a typed vault reference with a foreign baseUrl on the test and import routes resolves \'\' and reaches no host', async () => {
  const ref = readSettings().providers.openai.apiKey;
  seen.length = 0;
  const t = await testProviderConnection('openai', { baseUrl: base, apiKey: ref });
  assert.equal(t.ok, false);
  try { await endpointModelsForImport({ baseUrl: base, apiKey: ref }); } catch { /* a refusal is fine too */ }
  assert.equal(seen.filter((s) => s.headers.authorization && s.headers.authorization !== 'Bearer').length, 0, JSON.stringify(seen));
  assert.ok(!JSON.stringify(seen).includes('sk-rotated-value'));
  const imgRef = readSettings().providers.images.apiKey;
  assert.ok(isVaultRef(imgRef), imgRef);
  const sent = [];
  const spy = async (url, init) => { sent.push(JSON.stringify(init?.headers || {})); throw new Error('no host'); };
  const r = await testImages({ baseUrl: base, apiKey: imgRef }, spy);
  assert.equal(r.ok, false);
  assert.ok(!sent.some((h) => h.includes('img-value-0006')), JSON.stringify(sent));
});

test('a masked echo in testProviderConnection sends the resolved vaulted key', async () => {
  seen.length = 0;
  const t = await testProviderConnection('openai', { apiKey: '••••••alue' });
  assert.equal(t.ok, true, JSON.stringify(t));
  assert.equal(seen.at(-1).headers.authorization, 'Bearer sk-rotated-value');
});

test('a bridged model whose key does not resolve reports no_key with the key-store message', () => {
  const r = providerReadiness({ provider: 'openai', api: 'openai-chat', model: 'x', apiKey: newVaultRef(), baseUrl: 'https://other.example.test/v1' });
  assert.deepEqual(r, { ok: false, reason: 'no_key', message: `provider openai: ${VAULT_MESSAGES['store-locked']}` });
});

const entriesFor = async (pred) => (await createVault({ home: worcaHome(), store: fileFakeOsStore(STATE, { item: osItemName(worcaHome()) }) }).list()).filter(pred);

test('deletes release (mark dropped) their entries: a cleared key, a deleted model, a removed env key and a key replaced by ${VAR}', async () => {
  const { removeGlobalModel } = settings;
  const field = (f) => (e) => e.field === f;
  const liveFor = (pred) => entriesFor((e) => !e.droppedAt && pred(e));   // a released entry is marked dropped
  assert.equal((await liveFor(field('providers.images.apiKey'))).length, 1);
  const copilot = (await liveFor(field('providers.copilot.githubToken'))).length;
  assert.equal(copilot, 1);
  await updateImages({ apiKey: null });
  assert.equal((await liveFor(field('providers.images.apiKey'))).length, 0, 'a cleared key');
  assert.equal((await liveFor(field('providers.copilot.githubToken'))).length, copilot, 'an unrelated provider keeps its entry');
  await addGlobalModel({ id: 'rel-up', upstream: { provider: 'openai', api: 'openai-chat', model: 'gpt-r', apiKey: 'up-rel-0001' } });
  await addGlobalModel({ id: 'rel-env', env: { ANTHROPIC_AUTH_TOKEN: 'env-rel-0002', ANTHROPIC_BASE_URL: 'https://gw.example.test' } });
  const model = (id) => readSettings().models.find((m) => m.id === id);
  const upRef = model('rel-up').upstream.apiKey;
  const envRef = model('rel-env').env.ANTHROPIC_AUTH_TOKEN;
  assert.ok(isVaultRef(upRef) && isVaultRef(envRef));
  await removeGlobalModel('rel-up');
  assert.equal((await liveFor((e) => e.ref === upRef)).length, 0, 'a deleted model');
  await updateGlobalModel('rel-env', { env: { ANTHROPIC_AUTH_TOKEN: null } });
  assert.equal((await liveFor((e) => e.ref === envRef)).length, 0, 'a removed env key');
  const openaiRef = readSettings().providers.openai.apiKey;
  assert.ok(isVaultRef(openaiRef));
  await updateProvider('openai', { apiKey: '${OPENAI_KEY}' });
  assert.equal(readSettings().providers.openai.apiKey, '${OPENAI_KEY}');
  assert.equal((await liveFor(field(OPENAI))).length, 0, 'a key replaced by ${VAR}');
  // Past the grace, the next release of any settings field removes those marked entries too (every owner deleted for good).
  const gone = [...(await entriesFor((e) => e.field === OPENAI || e.field === 'providers.images.apiKey')).map((e) => e.ref), upRef, envRef];
  const { LOCKLESS_GRACE_MS } = await import('../src/core/secrets/store-vault.mjs');
  const realNow = Date.now;
  Date.now = () => realNow() + LOCKLESS_GRACE_MS + 1;
  try {
    await updateSound({ apiKey: 'snd-grace-0001' });
    await updateSound({ apiKey: 'snd-grace-0002' });
  } finally { Date.now = realNow; }
  assert.deepEqual(await entriesFor((e) => gone.includes(e.ref)), [], 'no entry left for a cleared key, a deleted model, a removed env key or a key replaced by ${VAR}, marked ones included');
});

test('two setters started in the same tick both survive with the flag on', async () => {
  await Promise.all([updateProvider('openai', { apiKey: 'sk-tick-0001' }), updateOpenRouter({ apiKey: 'sk-or-tick-0002' })]);
  const p = readSettings().providers;
  assert.equal(resolveProviderSecret(p.openai.apiKey, process.env, OPENAI), 'sk-tick-0001');
  assert.equal(resolveProviderSecret(p.openrouter.apiKey, process.env, 'providers.openrouter.apiKey'), 'sk-or-tick-0002');
});

test('store unavailable before vaulting: the save goes to the config file and no vault file appears', async () => {
  const home = join(ROOT, 'plain-home');
  const worca = join(ROOT, 'plain-worca');
  mkdirSync(home, { recursive: true });
  const was = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, WORCA_HOME: process.env.WORCA_HOME };
  const keys = JSON.parse(readFileSync(STATE, 'utf8')).items;
  writeFakeState(STATE, { state: 'unavailable', items: Object.fromEntries(Object.entries(keys).map(([a, k]) => [a, Buffer.from(k, 'base64')])) });
  Object.assign(process.env, { HOME: home, USERPROFILE: home, WORCA_HOME: worca });
  try {
    await updateProvider('openai', { apiKey: 'sk-plain-fallback' });
    assert.equal(readSettings().providers.openai.apiKey, 'sk-plain-fallback');
    assert.equal(existsSync(join(worca, '.worca-cc', 'worca-vault.enc')), false);
  } finally {
    Object.assign(process.env, was);
  }
});

test('ownsSettingsHome: true for the settings home not yet created, spelled through a symlinked HOME', () => {
  const realTarget = join(ROOT, 'owns-real');
  mkdirSync(realTarget, { recursive: true });
  const link = join(ROOT, 'owns-link');
  symlinkSync(realTarget, link);
  const was = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };
  Object.assign(process.env, { HOME: link, USERPROFILE: link });
  try {
    const home = join(realTarget, '.worca-cc');
    assert.equal(ownsSettingsHome(home), true, 'before the home exists');
    mkdirSync(home, { recursive: true });
    assert.equal(ownsSettingsHome(home), true, 'after the home exists');
    assert.equal(ownsSettingsHome(join(ROOT, 'elsewhere', '.worca-cc')), false);
  } finally {
    Object.assign(process.env, was);
  }
});

// Last: priming another home installs that home's reader for the whole process.
test('readBackSettingsVaultKey: one fresh, uncached getKey on the real store, compared with the primed key', async () => {
  for (const [keyReadBack, same] of [[null, true], [{ differsFromCall: 2 }, false]]) {
    const dir = mkdtempSync(join(ROOT, 'read-back-'));
    const state = join(dir, 'state.json');
    const home = join(dir, 'worca');
    mkdirSync(home, { recursive: true });
    writeFakeState(state, { state: 'available', item: osItemName(home), key: Buffer.alloc(32, 3), keyReadBack });
    const env = { ...process.env, WORCA_TEST_OS_STORE: state };
    assert.deepEqual(await primeSettingsVault({ home, env }), { state: 'ready' });
    assert.equal(await readBackSettingsVaultKey({ home, env }), same);
    assert.equal(await readBackSettingsVaultKey({ home, env }), same, 'never cached');
    assert.deepEqual(readFakeCalls(state).map((c) => c.op), ['getKey', 'getKey', 'getKey']);
  }
});

test('deleteKey through the primed store removes the item and drops the held key: the next prime finds no key', async () => {
  const { primedVaultStore, vaultForHome } = await import('../src/core/secrets/settings-vault.mjs');
  const { callStore } = await import('../src/core/secrets/os-store.mjs');
  const { peekKey } = await import('./helpers/os-store-fake.mjs');
  const dir = mkdtempSync(join(ROOT, 'delete-key-'));
  const state = join(dir, 'state.json');
  const home = join(dir, 'worca');
  mkdirSync(home, { recursive: true });
  writeFakeState(state, { state: 'available' });
  const env = { ...process.env, WORCA_TEST_OS_STORE: state };
  await (await vaultForHome({ home, env })).put({ store: 'settings', field: OPENAI, value: 'sk-delete-me' });
  assert.ok(peekKey(state, osItemName(home)), 'the put created the item');
  assert.deepEqual(await primeSettingsVault({ home, env }), { state: 'ready' });
  assert.equal(await callStore(await primedVaultStore({ home, env }), 'deleteKey'), true);
  assert.equal(peekKey(state, osItemName(home)), null, 'the fake item is gone');
  assert.deepEqual(await primeSettingsVault({ home, env }), { state: 'no-key' }, 'the next getKey misses: no held copy outlived the item');
  assert.ok(readFakeCalls(state).some((c) => c.op === 'deleteKey'));
});

test('a primed key does not outlive an item another process deleted: the next seal creates a new key and vault', async () => {
  const { vaultForHome } = await import('../src/core/secrets/settings-vault.mjs');
  const { deleteVault, entryDigest, readVaultEntriesSync, vaultFile } = await import('../src/core/secrets/vault.mjs');
  const { peekKey } = await import('./helpers/os-store-fake.mjs');
  const dir = mkdtempSync(join(ROOT, 'primed-stale-'));
  const state = join(dir, 'state.json');
  const home = join(dir, 'worca');
  mkdirSync(home, { recursive: true });
  writeFakeState(state, { state: 'available' });
  const env = { ...process.env, WORCA_TEST_OS_STORE: state };
  const primed = await vaultForHome({ home, env });
  await primed.put({ store: 'settings', field: OPENAI, value: 'sk-before-export' });
  const k = peekKey(state, osItemName(home));
  assert.ok(k, 'the put created the item');
  // Another process (its own, unprimed store on the same item) exports: the vault file and the OS item go.
  const other = fileFakeOsStore(state, { item: osItemName(home) });
  const { entries } = readVaultEntriesSync(vaultFile(home), k);
  const snapshot = new Map(Object.entries(entries).map(([id, e]) => [id, entryDigest(e)]));
  assert.deepEqual(await deleteVault({ home, store: other, snapshot }), { vaultRemoved: true, keyRemoved: true });
  assert.equal(peekKey(state, osItemName(home)), null);
  await primed.put({ store: 'settings', field: OPENAI, value: 'sk-after-export' });
  const now = peekKey(state, osItemName(home));
  assert.ok(now, 'the seal created a new item');
  assert.ok(!now.equals(k), 'a new key, not the held one');
  assert.equal(Object.keys(readVaultEntriesSync(vaultFile(home), now).entries).length, 1, 'the new vault is under the store\'s current key');
});
