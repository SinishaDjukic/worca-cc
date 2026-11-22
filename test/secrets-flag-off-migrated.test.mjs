// test/secrets-flag-off-migrated.test.mjs — a vault left in use after the secretVault flag is turned off (D1–D3): a
// migration through child processes over the file-backed OS-store fake, then the flag off. Every moved key still
// resolves, a key saved afterwards is written to the config file in all four stores, and replacing a vaulted key with a plain
// one marks its entry dropped.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { osItemName } from '../src/core/secrets/os-store.mjs';
import { isVaultRef } from '../src/core/secrets/refs.mjs';
import { createVault } from '../src/core/secrets/vault.mjs';
import { fileFakeOsStore, writeFakeState } from './helpers/os-store-fake.mjs';
import { secretFiles, secretSlots } from './helpers/secret-literals.mjs';

const REPO = fileURLToPath(new URL('..', import.meta.url));
const CHILD = 'test/fixtures/secrets/settings-child.mjs';
const ROOT = mkdtempSync(join(tmpdir(), 'worca-flag-off-migrated-'));
after(() => rmSync(ROOT, { recursive: true, force: true, maxRetries: 5 }));
const NEW = 'plain-after-flag-off-77';

function sandbox() {
  const dir = mkdtempSync(join(ROOT, 's-'));
  const home = join(dir, 'home');
  const worca = join(home, '.worca-cc');
  mkdirSync(worca, { recursive: true });
  const state = join(dir, 'fake', 'state.json');
  writeFakeState(state, { state: 'available' });
  const env = { ...process.env, HOME: home, USERPROFILE: home, WORCA_HOME: home, NODE_TEST_CONTEXT: 'child-v8',
    WORCA_TEST_ALLOW_HOME_FALLBACK: '1', WORCA_TEST_OS_STORE: state, WORCA_TEST_DEPLOYMENT: 'local' };
  delete env.WORCA_HOST_PID;
  const run = (args, flags) => {
    const r = spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', CHILD, ...args],
      { cwd: REPO, env: { ...env, WORCA_FLAGS: flags }, encoding: 'utf8', timeout: 60_000 });
    assert.equal(r.status, 0, `${args.join(' ')}: ${r.stderr}`);
    return r.stdout.trim().split('\n').pop();
  };
  const vault = createVault({ home: worca, store: fileFakeOsStore(state, { item: osItemName(worca) }) });
  return { home, worca, state, run, vault };
}

test('migrate, then flag off: all 9 slots resolve; new saves go to the config file; a replaced key is marked dropped', async () => {
  const sb = sandbox();
  sb.run(['seed-literals'], 'secretVault');
  const m = JSON.parse(sb.run(['migrate'], 'secretVault'));
  assert.equal(m.state, 'done');
  const files = secretFiles(sb.home, sb.worca);
  const openaiRef = JSON.parse(readFileSync(files.settings, 'utf8')).providers.openai.apiKey;
  assert.ok(isVaultRef(openaiRef));

  const got = JSON.parse(sb.run(['resolve-all'], '-secretVault'));
  for (const s of secretSlots()) assert.equal(got[s.id], s.value, `${s.id} resolves with the flag off`);

  assert.equal(sb.run(['save-plain', '--value', NEW], '-secretVault'), 'saved');
  const settings = JSON.parse(readFileSync(files.settings, 'utf8'));
  assert.equal(settings.providers.openai.apiKey, NEW, 'settings.json holds the typed literal');
  const mcp = JSON.parse(readFileSync(files.mcp, 'utf8'));
  assert.equal(mcp.sets.general['manual:gh'].password.value, NEW);
  const plugin = JSON.parse(readFileSync(join(sb.worca, 'plugins', 'vault-c', 'data', 'secrets.json'), 'utf8'));
  assert.equal(plugin.profiles.default.token, NEW);
  const proxy = JSON.parse(readFileSync(files.proxy, 'utf8'));
  assert.match(proxy.ntHash, /^[0-9a-f]{32}$/);

  const entries = await sb.vault.list();
  const old = entries.find((e) => e.ref === openaiRef);
  assert.ok(old, 'the replaced key keeps its entry for the grace period');
  assert.equal(typeof old.droppedAt, 'number', 'and it is marked dropped');
  // The other moved keys still resolve after the plain saves.
  const again = JSON.parse(sb.run(['resolve-all'], '-secretVault'));
  for (const s of secretSlots().filter((x) => x.store === 'settings' && x.id !== 'settings.openai')) assert.equal(again[s.id], s.value);
  assert.equal(again['mcp.password'], secretSlots().find((s) => s.id === 'mcp.password').value);
});
