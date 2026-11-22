// test/secrets-settings-vault-locked.test.mjs — a process whose prime found the OS store locked after another process
// vaulted a key: every save is refused with a plain message and settings.json stays byte-identical. Its own file
// because a process primes once. Over the file-backed OS-store fake, with settings-child.mjs as the other process.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { peekKey, writeFakeState } from './helpers/os-store-fake.mjs';

const REPO = fileURLToPath(new URL('../', import.meta.url));
const ROOT = mkdtempSync(join(tmpdir(), 'worca-settings-locked-'));
const KEYS = ['HOME', 'USERPROFILE', 'WORCA_HOME', 'WORCA_TEST_ALLOW_HOME_FALLBACK', 'WORCA_FLAGS', 'WORCA_TEST_OS_STORE', 'WORCA_PROJECTS_ROOT'];
const prev = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
const STATE = join(ROOT, 'fake', 'state.json');
const HOME = join(ROOT, 'home');
const WORCA = join(ROOT, 'worca');
const SETTINGS = join(HOME, '.worca-cc', 'settings.json');
let srv;
let base;
let settings;

before(async () => {
  writeFakeState(STATE, { state: 'available' });
  mkdirSync(HOME, { recursive: true });
  Object.assign(process.env, {
    HOME, USERPROFILE: HOME, WORCA_HOME: WORCA, WORCA_TEST_ALLOW_HOME_FALLBACK: '1', WORCA_FLAGS: 'secretVault', WORCA_TEST_OS_STORE: STATE,
  });
  delete process.env.WORCA_PROJECTS_ROOT;
  const r = spawnSync(process.execPath, ['test/fixtures/secrets/settings-child.mjs', 'save-settings-keys', '--value', 'sk-old-value'],
    { cwd: REPO, env: process.env, encoding: 'utf8', timeout: 60_000 });
  assert.equal(r.status, 0, r.stderr);
  const { osItemName } = await import('../src/core/secrets/os-store.mjs');
  const item = osItemName(join(WORCA, '.worca-cc'));
  writeFakeState(STATE, { state: 'locked', items: { [item.account]: peekKey(STATE, item) } });
  const { _resetForTests } = await import('../src/core/db.mjs');
  _resetForTests();
  settings = await import('../src/core/settings.mjs');
  const { app } = await import('../ui/server.mjs');
  assert.deepEqual(await settings.primeSettingsVaultIfEnabled(), { state: 'locked' });
  srv = http.createServer(app);
  await new Promise((res) => srv.listen(0, '127.0.0.1', res));
  base = `http://127.0.0.1:${srv.address().port}`;
});

after(async () => {
  if (srv) await new Promise((r) => srv.close(r));
  for (const [k, v] of Object.entries(prev)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  rmSync(ROOT, { recursive: true, force: true, maxRetries: 5 });
});

const noLeak = (text) => {
  for (const bad of ['sk-new', 'sk-old', 'worca:vault:', WORCA, HOME, ROOT]) assert.ok(!text.includes(bad), `leaks ${bad}: ${text}`);
};

test('locked store after vaulting: PATCH provider key is 400 and settings.json is unchanged', async () => {
  const before = readFileSync(SETTINGS);
  const r = await fetch(`${base}/api/providers/openai`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ apiKey: 'sk-new-value' }) });
  assert.equal(r.status, 400);
  const { error } = await r.json();
  assert.ok(error.startsWith('The key was not saved: '), error);
  assert.match(error, /Unlock the OS key store/);
  noLeak(error);
  assert.deepEqual(readFileSync(SETTINGS), before);
});

test('locked store after vaulting: updateProvider rejects with VAULT_UNREACHABLE and the message holds no value, reference or path', async () => {
  const before = readFileSync(SETTINGS);
  for (const save of [
    () => settings.updateProvider('openai', { apiKey: 'sk-new-1' }),
    () => settings.updateGlobalModel('child-bridged', { upstream: { provider: 'openai', api: 'openai-chat', model: 'gpt-child', apiKey: 'sk-new-2' } }),
    () => settings.updateOpenRouter({ apiKey: 'sk-new-3' }),
  ]) {
    await assert.rejects(save(), (e) => {
      assert.equal(e.code, 'VAULT_UNREACHABLE');
      assert.equal(e.reason, 'store-locked');
      assert.equal(e.message, 'The key was not saved: the OS key store is locked or did not answer in time. Unlock the OS key store, then run `worca secrets status` again.');
      noLeak(e.message);
      return true;
    });
  }
  assert.deepEqual(readFileSync(SETTINGS), before);
});

test('unavailable store after vaulting: the message points to worca secrets status, not to unlocking', async () => {
  const { osItemName } = await import('../src/core/secrets/os-store.mjs');
  const item = osItemName(join(WORCA, '.worca-cc'));
  writeFakeState(STATE, { state: 'unavailable', items: { [item.account]: peekKey(STATE, item) } });
  const before = readFileSync(SETTINGS);
  await assert.rejects(settings.updateProvider('anthropic', { apiKey: 'sk-new-4' }), (e) => {
    assert.equal(e.code, 'VAULT_UNREACHABLE');
    assert.equal(e.message, 'The key was not saved: no OS key store is available for the Worca vault. Run `worca secrets status` to see why.');
    assert.ok(!/Unlock/.test(e.message));
    return true;
  });
  assert.deepEqual(readFileSync(SETTINGS), before);
});
