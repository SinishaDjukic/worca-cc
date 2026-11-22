// test/secrets-vault-child.test.mjs — the vault across processes: two writers under one lock, and the test switch
// of the OS store honoured only with the node:test runner marker.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fileFakeOsStore, readFakeCalls, writeFakeState } from './helpers/os-store-fake.mjs';
import { createVault } from '../src/core/secrets/vault.mjs';
import { TEST_OS_STORE_ENV, osItemName } from '../src/core/secrets/os-store.mjs';

const CHILD = fileURLToPath(new URL('./fixtures/secrets/vault-child.mjs', import.meta.url));
const ROOT = mkdtempSync(join(tmpdir(), 'worca-vault-child-'));
const children = new Set();
after(async () => {
  await Promise.all([...children]);
  rmSync(ROOT, { recursive: true, force: true, maxRetries: 5 });
});

let n = 0;
function setup() {
  const dir = join(ROOT, `c${++n}`);
  const base = join(dir, 'worca');
  const home = join(dir, 'home');
  mkdirSync(home, { recursive: true });
  const state = join(dir, 'fake', 'state.json');
  writeFakeState(state, { state: 'available' });
  return { dir, state, worcaHome: join(base, '.worca-cc'), env: { WORCA_HOME: base, HOME: home, USERPROFILE: home } };
}

function runChild(args, env) {
  const childEnv = { ...process.env, ...env };
  for (const [k, v] of Object.entries(env)) if (v === undefined) delete childEnv[k];
  const p = new Promise((resolve, reject) => {
    const c = spawn(process.execPath, [CHILD, ...args], { env: childEnv, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = ''; let err = '';
    c.stdout.on('data', (d) => { out += d; });
    c.stderr.on('data', (d) => { err += d; });
    c.on('error', reject);
    c.on('close', (status) => resolve({ status, out, err }));
  });
  children.add(p);
  return p;
}

const waitFor = async (pred, ms = 20_000) => {
  const deadline = Date.now() + ms;
  while (!pred()) {
    if (Date.now() > deadline) throw new Error('timed out waiting');
    await new Promise((r) => setTimeout(r, 10));
  }
};

test('two processes writing different stores keep every entry, with exactly one setKey', async () => {
  const { dir, state, worcaHome, env } = setup();
  const go = join(dir, 'go');
  const sw = { ...env, [TEST_OS_STORE_ENV]: state, NODE_TEST_CONTEXT: 'child-v8' };
  const runs = ['settings', 'mcp'].map((store) => runChild(['put-many', '--store', store, '--count', '25', '--ready', join(dir, `ready-${store}`), '--go', go], sw));
  await waitFor(() => existsSync(join(dir, 'ready-settings')) && existsSync(join(dir, 'ready-mcp')));
  writeFileSync(go, '');
  const results = await Promise.all(runs);
  for (const r of results) assert.equal(r.status, 0, r.err);
  const [a, b] = results.map((r) => JSON.parse(r.out.trim()));
  assert.ok(a.start < b.end && b.start < a.end, `windows ${JSON.stringify([a, b])}`);

  const vault = createVault({ home: worcaHome, store: fileFakeOsStore(state, { item: osItemName(worcaHome) }) });
  const rows = await vault.list();
  assert.equal(rows.length, 50);
  for (const store of ['settings', 'mcp']) assert.equal(rows.filter((r) => r.store === store).length, 25);
  for (const r of rows) assert.equal(await vault.resolve(r.ref, r), `${r.store}-v${r.field.slice(1)}`);
  assert.equal(readFakeCalls(state).filter((c) => c.op === 'setKey').length, 1);
});

test('the switch without the runner marker: kind none, store-unavailable, 0 fake calls', async () => {
  const { state, env } = setup();
  const r = await runChild(['probe-store'], { ...env, [TEST_OS_STORE_ENV]: state, NODE_TEST_CONTEXT: undefined });
  assert.equal(r.status, 0, r.err);
  assert.deepEqual(JSON.parse(r.out.trim()), { kind: 'none', code: 'store-unavailable' });
  assert.deepEqual(readFakeCalls(state), []);
  assert.equal(existsSync(`${state}.calls`), false);
});

test('the switch with the runner marker: kind fake, and its put is visible to the parent', async () => {
  const { state, worcaHome, env } = setup();
  const r = await runChild(['probe-store'], { ...env, [TEST_OS_STORE_ENV]: state, NODE_TEST_CONTEXT: 'child-v8' });
  assert.equal(r.status, 0, r.err);
  const out = JSON.parse(r.out.trim());
  assert.equal(out.kind, 'fake');
  const vault = createVault({ home: worcaHome, store: fileFakeOsStore(state, { item: osItemName(worcaHome) }) });
  assert.equal(await vault.resolve(out.ref, { store: 'settings', field: 'probe' }), 'probe-value');
});
