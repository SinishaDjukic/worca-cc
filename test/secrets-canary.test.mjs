// test/secrets-canary.test.mjs — a canary seeded into all four stores never leaves them as text: not in any stdout,
// stderr or log line, error, the notice file, nor any recorded runner call, across migrate, status, `status --check`,
// doctor, ack, a refused and a successful export, and the WSL2 DPAPI path. The master key (base64 and hex) never shows
// either, except as a DPAPI runner's stdin.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { osItemName } from '../src/core/secrets/os-store.mjs';
import { peekKey, readFakeCalls, writeFakeState } from './helpers/os-store-fake.mjs';
import { fakeVault } from './helpers/vault-on.mjs';
import { CANARY, secretSlots, seedLiterals } from './helpers/secret-literals.mjs';

const CLI = fileURLToPath(new URL('../src/cli/worca-cc.mjs', import.meta.url));
const ROOT = mkdtempSync(join(tmpdir(), 'worca-canary-'));
const KEYS = ['HOME', 'USERPROFILE', 'WORCA_HOME', 'WORCA_TEST_ALLOW_HOME_FALLBACK', 'WORCA_FLAGS', 'WORCA_TEST_OS_STORE'];
const prev = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = '1';
after(() => {
  for (const [k, v] of Object.entries(prev)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  rmSync(ROOT, { recursive: true, force: true, maxRetries: 5 });
});
const TAG = CANARY;
const REF = 'worca:vault:v1:';

/** No canary, no seeded value, no reference and none of `secrets` (key forms) in `texts`. */
function assertClean(texts, secrets = []) {
  const all = texts.join('\n');
  for (const s of secretSlots(TAG)) assert.ok(!all.includes(s.value), `leaked ${s.id}`);
  for (const needle of [CANARY, REF, ...secrets]) assert.ok(!all.includes(needle), `leaked ${needle.slice(0, 12)}…`);
}
const keyForms = (key) => (key ? [Buffer.from(key).toString('base64'), Buffer.from(key).toString('hex')] : []);

function run(env, args) {
  return new Promise((res) => {
    const c = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', CLI, ...args], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    c.stdout.on('data', (b) => (stdout += b));
    c.stderr.on('data', (b) => (stderr += b));
    c.on('exit', (code) => res({ code, stdout, stderr }));
  });
}

test('the spawned CLI: migrate, status, status --check, doctor, a refused export, ack and export print no canary and no key', async () => {
  const dir = mkdtempSync(join(ROOT, 'cli-'));
  const worca = join(dir, 'worca');
  const home = join(worca, '.worca-cc');
  mkdirSync(home, { recursive: true });
  const state = join(dir, 'fake', 'state.json');
  writeFakeState(state, { state: 'available' });
  seedLiterals({ home: worca, worca: home, tag: TAG });
  const settings = join(home, 'settings.json');
  const raw = JSON.parse(readFileSync(settings, 'utf8'));
  raw.flags = { secretVault: true };
  const { writeFileSync } = await import('node:fs');
  writeFileSync(settings, JSON.stringify(raw), { mode: 0o600 });
  const env = { ...process.env, HOME: worca, USERPROFILE: worca, WORCA_HOME: worca, NODE_TEST_CONTEXT: 'child-v8',
    WORCA_TEST_ALLOW_HOME_FALLBACK: '1', WORCA_TEST_OS_STORE: state, WORCA_TEST_STORE_TIMEOUT_MS: '300' };
  delete env.WORCA_FLAGS;
  delete env.WORCA_HOST_PID;
  const outs = [];
  const step = async (args, code = 0) => {
    const r = await run(env, args);
    assert.equal(r.code, code, `${args.join(' ')}: ${r.stderr}`);
    outs.push(r.stdout, r.stderr);
    return r;
  };
  const migrated = await step(['models', 'list']);
  assert.match(migrated.stderr, /Worca moved 9 saved secrets/, 'the migration ran');
  const item = osItemName(home);
  const key = peekKey(state, item);
  assert.ok(key);
  const notice = readFileSync(join(home, 'secrets-notice.json'), 'utf8');
  await step(['secrets', 'status']);
  await step(['secrets', 'status', '--check']);
  await step(['doctor']);
  writeFakeState(state, { state: 'locked', items: { [item.account]: key } });
  const refused = await step(['secrets', 'export', '--yes'], 1);
  assert.match(refused.stderr, /^worca: cannot export: the OS key store is locked/);
  writeFakeState(state, { state: 'available', items: { [item.account]: key } });
  await step(['secrets', 'ack']);
  const exported = await step(['secrets', 'export', '--yes']);
  assert.match(exported.stdout, /Turned the secretVault flag off\./);
  assert.equal(existsSync(join(home, 'worca-vault.enc')), false);
  assertClean([...outs, notice, JSON.stringify(readFakeCalls(state))], keyForms(key));
});

test('in process: migrateSecrets log lines hold no canary', async () => {
  const dir = mkdtempSync(join(ROOT, 'inproc-'));
  const worca = join(dir, 'home');
  const home = join(worca, '.worca-cc');
  mkdirSync(home, { recursive: true });
  Object.assign(process.env, { HOME: worca, USERPROFILE: worca, WORCA_HOME: worca });
  seedLiterals({ home: worca, worca: home, tag: TAG });
  const { vaultOn } = fakeVault(dir);
  const lines = [];
  const r = await vaultOn(async () => {
    const { migrateSecretsIfEnabled } = await import('../src/core/secrets/flag.mjs');
    return migrateSecretsIfEnabled({ deployment: 'local', reason: 'start', log: (l) => lines.push(l) });
  });
  assert.ok(Object.values(r.moved).reduce((a, b) => a + b, 0) > 0, 'positive control: secrets moved');
  assert.ok(lines.length > 0);
  assertClean([...lines, JSON.stringify(r), readFileSync(join(home, 'secrets-notice.json'), 'utf8')]);
});

test('the WSL2 DPAPI path: a put and an export record no canary and no key outside the runner input', async () => {
  const dir = mkdtempSync(join(ROOT, 'wsl-'));
  const worca = join(dir, 'worca');
  const home = join(worca, '.worca-cc');
  mkdirSync(home, { recursive: true });
  Object.assign(process.env, { HOME: worca, USERPROFILE: worca, WORCA_HOME: worca });
  delete process.env.WORCA_FLAGS;
  const { dpapiOsStore } = await import('../src/core/secrets/wsl-dpapi.mjs');
  const { createVault } = await import('../src/core/secrets/vault.mjs');
  const { exportSecrets } = await import('../src/core/secrets/export.mjs');
  const calls = [];
  const xor = (b) => Buffer.from(b.map((x) => x ^ 0xa5));
  const run = async (file, args, { input }) => {
    calls.push({ file, args: [...args], env: { ...process.env }, input });
    return { code: 0, stdout: xor(Buffer.from(String(input).trim(), 'base64')).toString('base64') };
  };
  const store = Object.assign(dpapiOsStore({ home, powershell: '/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe', run }), { label: 'Windows DPAPI (WSL2)' });
  await createVault({ home, store }).put({ store: 'settings', field: 'providers.openai.apiKey', value: `${CANARY}-wsl` });
  const key = Buffer.from(String(calls[0].input).trim(), 'base64');
  assert.equal(key.length, 32, 'the first protect call carries the key on stdin');
  const lines = [];
  const r = await exportSecrets({ home, store, confirm: async () => true, log: (l) => lines.push(l) });
  assert.equal(r.outcome, 'exported', JSON.stringify(r));
  assert.equal(existsSync(join(home, 'worca-vault.key')), false);
  assertClean([JSON.stringify(r), ...lines, JSON.stringify(calls.map(({ file, args, env }) => ({ file, args, env })))], keyForms(key));
});
