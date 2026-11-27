// test/secrets-migrate-lock.test.mjs — the migration lock across processes (test/fixtures/secrets/settings-child.mjs
// `migrate`): a dead holder's lock is taken over, two overlapping starts migrate once, and a live holder past the wait
// gives `busy` with nothing written, after which the next start completes.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fileFakeOsStore, readFakeCalls, writeFakeState } from './helpers/os-store-fake.mjs';
import { diffTrees, snapshotTree } from './helpers/flag-off.mjs';
import { CANARY, liveEntries, readSecrets, secretSlots, seedLiterals } from './helpers/secret-literals.mjs';
import { acquireLock } from '../src/core/metrics/lock.mjs';
import { MIGRATE_LOCK_FILE, VAULT_FILE } from '../src/core/secrets/files.mjs';
import { osItemName } from '../src/core/secrets/os-store.mjs';
import { createVault } from '../src/core/secrets/vault.mjs';

const REPO = fileURLToPath(new URL('../', import.meta.url));
const CHILD = fileURLToPath(new URL('./fixtures/secrets/settings-child.mjs', import.meta.url));
const ROOT = mkdtempSync(join(tmpdir(), 'worca-migrate-lock-'));
after(() => rmSync(ROOT, { recursive: true, force: true, maxRetries: 5 }));
const SECRETS = secretSlots().length;

let n = 0;
function fresh() {
  const dir = mkdtempSync(join(ROOT, `c${++n}-`));
  const tree = join(dir, 'tree');
  const home = join(tree, 'home');
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
  const vault = createVault({ home: worca, store: fileFakeOsStore(state, { item: osItemName(worca) }) });
  return { tree, home, worca, state, env, vault, lock: join(worca, MIGRATE_LOCK_FILE), snap: () => snapshotTree(tree) };
}

const parse = (stdout) => JSON.parse(stdout.trim().split('\n').at(-1));
function migrateSync(c, extra = {}) {
  const r = spawnSync(process.execPath, [CHILD, 'migrate'], { cwd: REPO, env: { ...c.env, ...extra }, encoding: 'utf8', timeout: 60_000 });
  assert.equal(r.status, 0, r.stderr);
  return { result: parse(r.stdout), stderr: r.stderr, stdout: r.stdout };
}
function migrateAsync(c, extra = {}) {
  const child = spawn(process.execPath, [CHILD, 'migrate'], { cwd: REPO, env: { ...c.env, ...extra }, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (b) => { stdout += b; });
  child.stderr.on('data', (b) => { stderr += b; });
  const done = new Promise((resolve) => child.on('close', (code) => resolve({ code, stdout, stderr })));
  return { pid: child.pid, done };
}
async function waitFor(fn, ms = 30_000) {
  for (const t0 = Date.now(); Date.now() - t0 < ms; await new Promise((r) => setTimeout(r, 25))) if (fn()) return true;
  return false;
}
const total = (r) => Object.values(r.moved).reduce((a, b) => a + b, 0);
async function assertAllReferences(c) {
  const got = await readSecrets(c);
  for (const s of secretSlots()) {
    assert.equal(got[s.id].ref, true, s.id);
    assert.equal(got[s.id].value, s.value, s.id);
  }
}

test('a dead-PID lock file is taken over and the run is done', async () => {
  const c = fresh();
  const dead = spawnSync(process.execPath, ['-e', 'process.stdout.write(String(process.pid))'], { encoding: 'utf8' });
  writeFileSync(c.lock, JSON.stringify({ pid: Number(dead.stdout), token: 'deadbeefdeadbeef', at: new Date().toISOString() }));
  const { result } = migrateSync(c);
  assert.equal(result.state, 'done');
  assert.equal(total(result), SECRETS);
  assert.equal(existsSync(c.lock), false);
  await assertAllReferences(c);
});

test('two overlapping starts: done with N and done with 0, one live entry per secret, one setKey', async () => {
  const c = fresh();
  const release = await acquireLock(c.lock, { timeoutMs: 5000 });
  const wait = { WORCA_TEST_MIGRATE_WAIT_MS: '30000' };
  const a = migrateAsync(c, wait);
  const b = migrateAsync(c, wait);
  try {
    assert.ok(await waitFor(() => {
      const pids = new Set(readFakeCalls(c.state).map((x) => x.pid));
      return pids.has(a.pid) && pids.has(b.pid);
    }), 'both children primed while the lock was held');
  } finally {
    await release();
  }
  const [ra, rb] = await Promise.all([a.done, b.done]);
  assert.equal(ra.code, 0, ra.stderr);
  assert.equal(rb.code, 0, rb.stderr);
  const results = [parse(ra.stdout), parse(rb.stdout)];
  assert.deepEqual(results.map((r) => r.state), ['done', 'done']);
  assert.deepEqual(results.map(total).sort((x, y) => x - y), [0, SECRETS]);
  assert.equal((await liveEntries(c.vault)).length, SECRETS);
  assert.equal(readFakeCalls(c.state).filter((x) => x.op === 'setKey').length, 1);
  await assertAllReferences(c);
});

for (const seeded of [false, true]) {
  test(`a live holder past a 300 ms wait: busy, one stderr line, files unchanged${seeded ? ' (vault seeded)' : ''}; the next start completes`, async () => {
    const c = fresh();
    if (seeded) await c.vault.put({ store: 'settings', field: 'providers.sound.apiKey', value: 'already-vaulted' });
    const vaultBytes = seeded ? readFileSync(join(c.worca, VAULT_FILE)) : null;
    const setKeys = () => readFakeCalls(c.state).filter((x) => x.op === 'setKey').length;
    const keysBefore = setKeys();
    const release = await acquireLock(c.lock, { timeoutMs: 5000 });
    const snap = c.snap();
    let r;
    try { r = migrateSync(c, { WORCA_TEST_MIGRATE_WAIT_MS: '300' }); } finally { await release(); }
    assert.equal(r.result.state, 'busy');
    assert.equal(total(r.result), 0);
    const busy = r.stderr.split('\n').filter((l) => l.startsWith('[worca] vault:'));
    assert.deepEqual(busy, ['[worca] vault: secrets were not moved: another Worca process is moving them (busy); Worca tries again at the next start']);
    const diff = diffTrees(snap, c.snap()).filter((d) => !d.path.endsWith(MIGRATE_LOCK_FILE));
    assert.deepEqual(diff, []);
    if (seeded) assert.deepEqual(readFileSync(join(c.worca, VAULT_FILE)), vaultBytes);
    else assert.equal(existsSync(join(c.worca, VAULT_FILE)), false);
    assert.equal(setKeys(), keysBefore);
    for (const t of [r.stdout, r.stderr]) assert.ok(!t.includes(CANARY) && !t.includes(ROOT));

    const next = migrateSync(c);
    assert.equal(next.result.state, 'done');
    assert.equal(total(next.result), SECRETS);
    await assertAllReferences(c);
  });
}
