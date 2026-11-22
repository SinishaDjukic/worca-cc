// test/secrets-migrate-crash.test.mjs — a migration killed at each named crash point (WORCA_TEST_SECRETS_CRASH, a
// SIGKILL under the runner marker) loses no secret: every one still reads as its literal or as a reference resolving to
// it, a rerun completes with references only and exactly one live entry per secret, and a settle past the lockless
// grace still resolves every reference.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fileFakeOsStore, writeFakeState } from './helpers/os-store-fake.mjs';
import { CANARY, liveEntries, readSecrets, secretSlots, seedLiterals } from './helpers/secret-literals.mjs';
import { osItemName } from '../src/core/secrets/os-store.mjs';
import { createVault } from '../src/core/secrets/vault.mjs';

const REPO = fileURLToPath(new URL('../', import.meta.url));
const CHILD = fileURLToPath(new URL('./fixtures/secrets/settings-child.mjs', import.meta.url));
const ROOT = mkdtempSync(join(tmpdir(), 'worca-migrate-crash-'));
const KEYS = ['HOME', 'USERPROFILE', 'WORCA_HOME', 'WORCA_TEST_ALLOW_HOME_FALLBACK', 'WORCA_FLAGS', 'WORCA_TEST_OS_STORE'];
const prev = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
after(() => {
  for (const [k, v] of Object.entries(prev)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  rmSync(ROOT, { recursive: true, force: true, maxRetries: 5 });
});
const WIN = process.platform === 'win32';
const SECRETS = secretSlots().length;

const ALL = ['after-vault-write', 'after-read-back', 'before-config-rewrite', 'after-swap', 'between-stores', 'mid-vault-write'];
const CASES = [
  ...ALL.map((p) => `${p}@settings`), ...ALL.map((p) => `${p}@mcp`),
  'before-config-rewrite@plugin', 'before-config-rewrite@proxy',
  'after-swap@plugin', 'after-swap@proxy',
  'between-stores@plugin',
];

let n = 0;
function fresh() {
  const dir = mkdtempSync(join(ROOT, `c${++n}-`));
  const home = join(dir, 'home');
  const worca = join(home, '.worca-cc');
  mkdirSync(home, { recursive: true });
  mkdirSync(worca, { recursive: true });
  const state = join(dir, 'fake', 'state.json');
  writeFakeState(state, { state: 'available' });
  seedLiterals({ home, worca });
  const env = {
    ...process.env, HOME: home, USERPROFILE: home, WORCA_HOME: home, WORCA_TEST_ALLOW_HOME_FALLBACK: '1',
    WORCA_FLAGS: 'secretVault', WORCA_TEST_OS_STORE: state, WORCA_TEST_DEPLOYMENT: 'local',
  };
  delete env.WORCA_TEST_SECRETS_CRASH;
  const vault = createVault({ home: worca, store: fileFakeOsStore(state, { item: osItemName(worca) }) });
  return { dir, home, worca, state, env, vault };
}

const run = (c, extra = {}) => spawnSync(process.execPath, [CHILD, 'migrate'], { cwd: REPO, env: { ...c.env, ...extra }, encoding: 'utf8', timeout: 60_000 });

for (const point of CASES) {
  test(`crash at ${point}: every secret still reads, and a rerun completes with one live entry per secret`, async () => {
    const c = fresh();
    const crashed = run(c, { WORCA_TEST_SECRETS_CRASH: point });
    if (WIN) assert.notEqual(crashed.status, 0);
    else assert.equal(crashed.signal, 'SIGKILL', `${crashed.status} ${crashed.stderr}`);
    assert.equal(crashed.stdout.trim(), '', 'no result line');

    const mid = await readSecrets(c);
    for (const s of secretSlots()) assert.equal(mid[s.id].value, s.value, `${s.id} readable after the crash (${mid[s.id].ref ? 'reference' : 'literal'})`);

    const again = run(c);
    assert.equal(again.status, 0, again.stderr);
    const result = JSON.parse(again.stdout.trim().split('\n').at(-1));
    assert.equal(result.state, 'done');
    for (const t of [again.stdout, again.stderr, crashed.stderr]) assert.ok(!t.includes(CANARY) && !t.includes('worca:vault:v1:') && !t.includes(ROOT));
    const got = await readSecrets(c);
    for (const s of secretSlots()) {
      assert.equal(got[s.id].ref, true, `${s.id} holds a reference`);
      assert.equal(got[s.id].value, s.value, s.id);
    }
    const live = await liveEntries(c.vault);
    assert.equal(live.length, SECRETS, 'exactly one live entry per secret');
    const held = new Set(Object.values(got).map((g) => g.raw));
    assert.ok(live.every((e) => held.has(e.ref)), 'every live entry is held by a file');

    // A settle past the lockless grace (a later start) removes the crash's orphans and keeps every reference.
    Object.assign(process.env, { HOME: c.home, USERPROFILE: c.home, WORCA_HOME: c.env.WORCA_HOME, WORCA_TEST_ALLOW_HOME_FALLBACK: '1',
      WORCA_FLAGS: 'secretVault', WORCA_TEST_OS_STORE: c.state });
    const { settleDroppedRefs, LOCKLESS_GRACE_MS } = await import('../src/core/secrets/store-vault.mjs');
    const byStore = (store) => new Set(secretSlots().filter((s) => s.store === store).map((s) => got[s.id].raw));
    const r = await settleDroppedRefs(byStore, { home: c.worca, now: () => Date.now() + LOCKLESS_GRACE_MS + 1, log: () => {} });
    assert.equal(r.error, undefined);
    const after = await readSecrets(c);
    for (const s of secretSlots()) assert.equal(after[s.id].value, s.value, `${s.id} after the settle`);
    assert.ok((await c.vault.list()).every((e) => e.droppedAt === undefined), 'no orphan left after the grace');
  });
}
