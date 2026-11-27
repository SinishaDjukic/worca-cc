// test/cli-secrets.test.mjs — `worca secrets status|reset` and the doctor line, spawned with the file-backed OS-store
// fake (WORCA_TEST_OS_STORE under the runner marker) and a 300 ms store time limit.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { VAULT_NAME_PREFIX } from '../src/core/secrets/files.mjs';
import { osItemName } from '../src/core/secrets/os-store.mjs';
import { createVault, vaultFile } from '../src/core/secrets/vault.mjs';
import { dropItem, fileFakeOsStore, peekKey, readFakeCalls, writeFakeState } from './helpers/os-store-fake.mjs';
import { readSecrets, secretFiles, secretSlots, seedLiterals } from './helpers/secret-literals.mjs';
import { ptyAvailable, runInTerminal } from './helpers/terminal-cli.mjs';
import { NEEDS_TERMINAL_TEXT, NO_YES_TEXT } from '../src/cli/secrets.mjs';
const PTY = { skip: !ptyAvailable() };
// A terminal run's one stream, in run()'s shape, for the checks that read stdout and stderr.
const asRun = (r) => ({ code: r.code, stdout: r.output, stderr: '' });

const CLI = resolve(fileURLToPath(new URL('..', import.meta.url)), 'src', 'cli', 'worca-cc.mjs');
const ROOT = mkdtempSync(join(tmpdir(), 'worca-cli-secrets-'));
after(() => rmSync(ROOT, { recursive: true, force: true, maxRetries: 5 }));
const CANARY = 'CANARY-cli-secret-0d4c';
const S = { store: 'settings', field: 'providers.openai.apiKey' };
let n = 0;

// A fresh sandbox: HOME = WORCA_HOME (whose vault home is WORCA_HOME/.worca-cc, settings.json's own), and a fake state
// file outside it.
function sandbox() {
  const dir = mkdtempSync(join(ROOT, `s${++n}-`));
  const worca = join(dir, 'worca');
  const home = join(worca, '.worca-cc');
  mkdirSync(home, { recursive: true });
  const state = join(dir, 'fake', 'state.json');
  writeFakeState(state, { state: 'available' });
  const item = osItemName(home);
  const env = {
    ...process.env, HOME: worca, USERPROFILE: worca, WORCA_HOME: worca,
    NODE_TEST_CONTEXT: 'child-v8', WORCA_TEST_ALLOW_HOME_FALLBACK: '1', WORCA_TEST_OS_STORE: state,
    WORCA_TEST_STORE_TIMEOUT_MS: '300', WORCA_FLAGS: 'secretVault',
  };
  delete env.WORCA_HOST_PID;   // an agent host sets it; only the D17 cases do here
  return { dir, home, state, item, env };
}

function run(sb, args, extraEnv = {}) {
  return new Promise((res) => {
    const t0 = Date.now();
    const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', CLI, ...args], { env: { ...sb.env, ...extraEnv }, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (b) => (stdout += b));
    child.stderr.on('data', (b) => (stderr += b));
    child.on('exit', (code) => res({ code, stdout, stderr, ms: Date.now() - t0 }));
  });
}

async function withVault(sb) {
  await createVault({ home: sb.home, store: fileFakeOsStore(sb.state, { item: sb.item }) }).put({ ...S, value: CANARY });
}

// Every worca-vault* entry under the home, with its bytes.
const vaultEntries = (home) => Object.fromEntries(readdirSync(home).filter((f) => f.startsWith(VAULT_NAME_PREFIX)).map((f) => [f, readFileSync(join(home, f), 'hex')]));
const setKeys = (sb) => readFakeCalls(sb.state).filter((c) => c.op === 'setKey').length;
const noCanary = (r) => { for (const t of [r.stdout, r.stderr]) assert.ok(!t.includes(CANARY)); };

test('status on an empty home: ready, Vault: none, exit 0, nothing written', async () => {
  const sb = sandbox();
  const r = await run(sb, ['secrets', 'status']);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.stdout, 'Secrets backend: test store (ready)\nVault: none\n');
  assert.deepEqual(vaultEntries(sb.home), {});
  assert.equal(setKeys(sb), 0);
});

test('a lost item: Vault: unreadable with the missing-key message, exit 0, no stack', async () => {
  const sb = sandbox();
  await withVault(sb);
  dropItem(sb.state, sb.item);
  const before = vaultEntries(sb.home);
  const calls = setKeys(sb);
  const r = await run(sb, ['secrets', 'status']);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /^Vault: unreadable: the vault key is missing from the OS key store/m);
  assert.match(r.stdout, /worca secrets reset/);
  assert.ok(!/\n\s+at /.test(r.stderr), r.stderr);
  assert.deepEqual(vaultEntries(sb.home), before);
  assert.equal(setKeys(sb), calls);
  noCanary(r);
});

test('a never-answering store prints locked and exits on its own within 5 s; once it answers, ready', async () => {
  const sb = sandbox();
  writeFakeState(sb.state, { state: 'never-answers' });
  const r = await run(sb, ['secrets', 'status']);
  assert.equal(r.code, 0, r.stderr);
  assert.ok(r.ms < 5000, `took ${r.ms} ms`);
  assert.match(r.stdout, /^Secrets backend: test store \(locked\)$/m);
  assert.match(r.stdout, /^Vault: not checked$/m);
  assert.ok(readFakeCalls(sb.state).some((c) => c.op === 'getKey'));
  writeFakeState(sb.state, { state: 'available' });
  assert.match((await run(sb, ['secrets', 'status'])).stdout, /\(ready\)/);
});

test('doctor: a secrets line per state, exit 0, the vault and the OS item untouched; flag off: the export line with a vault, nothing without', async () => {
  const sb = sandbox();
  await withVault(sb);
  const before = vaultEntries(sb.home);
  const key = peekKey(sb.state, sb.item);
  const calls = setKeys(sb);
  const ready = await run(sb, ['doctor']);
  assert.equal(ready.code, 0, ready.stderr);
  assert.match(ready.stdout, /^secrets: test store \(ready\)$/m);
  for (const st of ['locked', 'unavailable']) {
    writeFakeState(sb.state, { state: st, items: { [sb.item.account]: key } });
    const r = await run(sb, ['doctor']);
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, new RegExp(`^secrets: ! test store \\(${st}\\)`, 'm'));
  }
  writeFakeState(sb.state, { state: 'available', items: { [sb.item.account]: key } });
  const callsBefore = readFakeCalls(sb.state).length;
  // Flag off with a vault left in use (D1, D14): still reported, plus the line naming export.
  const offInUse = await run(sb, ['doctor'], { WORCA_FLAGS: '-secretVault' });
  assert.equal(offInUse.code, 0, offInUse.stderr);
  assert.match(offInUse.stdout, /^secrets: test store \(ready\)$/m);
  assert.match(offInUse.stdout, /Run `worca secrets export` to move the vaulted ones back to their config files\./);
  // Flag off and no vault file (never migrated): nothing, and no store call.
  const fresh = sandbox();
  const off = await run(fresh, ['doctor'], { WORCA_FLAGS: '-secretVault' });
  assert.equal(off.code, 0, off.stderr);
  assert.ok(!/^secrets:/m.test(off.stdout));
  assert.equal(readFakeCalls(fresh.state).length, 0, 'flag off, no vault: 0 store calls');
  assert.ok(callsBefore >= 0);
  assert.deepEqual(vaultEntries(sb.home), before);
  assert.ok(peekKey(sb.state, sb.item).equals(key));
  assert.equal(setKeys(sb), calls);
  noCanary(ready);
});

test('reset: terminal-only: no TTY refuses (1) and --yes is refused (2), both before anything is read; nothing moves', async () => {
  const sb = sandbox();
  await withVault(sb);
  dropItem(sb.state, sb.item);
  const calls = readFakeCalls(sb.state).length;
  const piped = await run(sb, ['secrets', 'reset']);
  assert.equal(piped.code, 1);
  assert.equal(piped.stderr, `${NEEDS_TERMINAL_TEXT}\n`);
  const yes = await run(sb, ['secrets', 'reset', '--yes']);
  assert.equal(yes.code, 2);
  assert.equal(yes.stderr, `${NO_YES_TEXT}\n`);
  assert.ok(existsSync(vaultFile(sb.home)));
  assert.equal(readFakeCalls(sb.state).length, calls, 'the key store was not asked');
  for (const r of [piped, yes]) noCanary(r);
});

test('reset in a terminal: a readable vault refuses (1); a wrong word cancels (2); the shown word moves a lost item aside (0); flag off (2)', { skip: !ptyAvailable() }, async () => {
  const sb = sandbox();
  await withVault(sb);
  const readable = await runInTerminal(['secrets', 'reset'], { env: sb.env });
  assert.equal(readable.code, 1, readable.output);
  assert.match(readable.output, /worca: cannot reset: the vault can be read/);
  assert.equal(readable.word, null, 'refused before the prompt');
  assert.ok(existsSync(vaultFile(sb.home)));

  dropItem(sb.state, sb.item);
  const wrong = await runInTerminal(['secrets', 'reset'], { env: sb.env, answer: 'wrong' });
  assert.equal(wrong.code, 2, wrong.output);
  assert.match(wrong.word, /^RESET-[A-Z2-9]{4}$/);
  assert.match(wrong.output, /worca: reset cancelled; nothing was moved/);
  assert.ok(existsSync(vaultFile(sb.home)));

  const moved = await runInTerminal(['secrets', 'reset'], { env: sb.env });
  assert.equal(moved.code, 0, moved.output);
  assert.equal(existsSync(vaultFile(sb.home)), false);
  assert.ok(readdirSync(sb.home).some((f) => f.startsWith('worca-vault.enc.unreadable-')));
  assert.match(moved.output, /Moved the vault aside to worca-vault\.enc\.unreadable-/);

  const off = await runInTerminal(['secrets', 'reset'], { env: { ...sb.env, WORCA_FLAGS: '-secretVault' } });
  assert.equal(off.code, 2);
  assert.match(off.output, /the secretVault flag is off; nothing to reset/);
  for (const r of [readable, wrong, moved, off]) noCanary({ stdout: r.output, stderr: '' });
});

test('flag off: status says off and exits 0', async () => {
  const sb = sandbox();
  const r = await run(sb, ['secrets', 'status'], { WORCA_FLAGS: '-secretVault' });
  assert.equal(r.code, 0);
  assert.equal(r.stdout, 'Secrets vault: off (the secretVault flag is off)\n');
  assert.deepEqual(readFakeCalls(sb.state), []);
});

test('a command outside CLI_PRIME_COMMANDS under a never-answering store exits before the time limit', async () => {
  const sb = sandbox();
  await withVault(sb);
  writeFakeState(sb.state, { state: 'never-answers', items: { [sb.item.account]: peekKey(sb.state, sb.item) } });
  const before = readFakeCalls(sb.state).length;
  const r = await run(sb, ['list'], { WORCA_TEST_STORE_TIMEOUT_MS: '10000' });
  assert.equal(r.code, 0, r.stderr);
  assert.ok(r.ms < 8000, `took ${r.ms} ms`);
  assert.equal(readFakeCalls(sb.state).length - before, 0, 'no store call');
  // The CLI module runs main() on import, so its prime list is read from the source.
  assert.match(readFileSync(CLI, 'utf8'), /export const CLI_PRIME_COMMANDS = Object\.freeze\(\['', 'resume', 'models', 'proxy', 'container'\]\);/);
});

test('worca resume with the fake store resolves a vaulted bridged key in-process', async () => {
  const sb = sandbox();
  const child = fileURLToPath(new URL('./fixtures/secrets/settings-child.mjs', import.meta.url));
  const saved = await new Promise((res) => {
    const c = spawn(process.execPath, [child, 'save-settings-keys', '--value', 'sk-cli-bridged-1'], { env: sb.env, stdio: ['ignore', 'pipe', 'pipe'] });
    let err = '';
    c.stderr.on('data', (b) => (err += b));
    c.on('exit', (code) => res({ code, err }));
  });
  assert.equal(saved.code, 0, saved.err);
  const getKeys = () => readFakeCalls(sb.state).filter((c) => c.op === 'getKey').length;
  // resume primes before it looks the pipeline up: one getKey in the resume process.
  let before = getKeys();
  const resume = await run(sb, ['resume', 'no-such-pipeline']);
  assert.equal(resume.code, 1);
  assert.match(resume.stderr, /pipeline no-such-pipeline not found/);
  assert.equal(getKeys() - before, 1);
  // A primed CLI resolves the vaulted bridged key: the model is ready. Unprimed (flag off), it would need a key.
  before = getKeys();
  const list = await run(sb, ['models', 'list']);
  assert.equal(list.code, 0, list.stderr);
  assert.equal(getKeys() - before, 1);
  const line = list.stdout.split('\n').find((l) => l.startsWith('child-bridged'));
  assert.ok(line && !/NEEDS/.test(line), list.stdout);
  // Flag off with the vault in use (D1): the CLI still primes, so the vaulted key still resolves.
  const off = await run(sb, ['models', 'list'], { WORCA_FLAGS: '-secretVault' });
  assert.ok(!/NEEDS/.test(off.stdout.split('\n').find((l) => l.startsWith('child-bridged'))), off.stdout);
  assert.ok(!(list.stdout + list.stderr + resume.stdout + resume.stderr).includes('sk-cli-bridged'));
});

// A sandbox whose settings turn the corporate proxy on (so `proxy status` exits 0 with or without a usable login), with
// a login saved through `worca proxy login` (a vault reference with the flag on).
async function proxySandbox() {
  const sb = sandbox();
  const { writeFileSync } = await import('node:fs');
  mkdirSync(join(sb.env.HOME, '.worca-cc'), { recursive: true });
  writeFileSync(join(sb.env.HOME, '.worca-cc', 'settings.json'), JSON.stringify({ networkProxy: { enabled: true, upstream: 'http://proxy.acme.example:8080' } }));
  const saved = await new Promise((res) => {
    const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', CLI, 'proxy', 'login'], { env: sb.env, stdio: ['pipe', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (b) => (stderr += b));
    child.on('exit', (code) => res({ code, stderr }));
    child.stdin.end('ACME\\jdoe\nS3cret!\n');
  });
  assert.equal(saved.code, 0, saved.stderr);
  return sb;
}
const getKeys = (sb) => readFakeCalls(sb.state).filter((c) => c.op === 'getKey').length;

test('proxy and container prime the vault while it is in use; proxy status reads the vaulted login', async () => {
  const sb = await proxySandbox();
  const raw = JSON.parse(readFileSync(join(sb.home, 'proxy-login.json'), 'utf8'));
  assert.match(raw.ntHash, /^worca:vault:v1:/);
  for (const args of [['proxy', 'status'], ['container', 'ls']]) {
    // Flag off with the vault in use (D1): the prime still runs, one getKey.
    let before = getKeys(sb);
    const off = await run(sb, args, { WORCA_FLAGS: '-secretVault' });
    assert.equal(getKeys(sb) - before, 1, `${args.join(' ')} flag off, vault in use: one getKey`);
    if (args[0] === 'proxy') assert.equal(off.code, 0, off.stderr);
    before = getKeys(sb);
    const on = await run(sb, args);
    // `container ls`: only the store-call delta (its exit code and output depend on this host's container runtime).
    assert.equal(getKeys(sb) - before, 1, `${args.join(' ')} flag on: one getKey`);
    if (args[0] !== 'proxy') continue;
    assert.equal(on.code, 0, on.stderr);
    const st = JSON.parse((await run(sb, ['proxy', 'status', '--json'])).stdout);
    assert.equal(st.state, 'ready');
    assert.equal(st.login.label, 'ACME\\jdoe');
    assert.equal(st.loginError, null);
  }
});

test('proxy status under a never-answering store exits 0 within the store time limit plus a margin', async () => {
  const sb = await proxySandbox();
  writeFakeState(sb.state, { state: 'never-answers', items: { [sb.item.account]: peekKey(sb.state, sb.item) } });
  const r = await run(sb, ['proxy', 'status']);
  assert.equal(r.code, 0, r.stderr);
  assert.ok(r.ms < 300 + 3000, `took ${r.ms} ms`);
  assert.match(r.stdout, /Login: none saved \(The saved login cannot be read: /);
  assert.ok(!(r.stdout + r.stderr).includes('worca:vault:'));
});

// Literals in all four stores plus a vault: the bytes of the secret files and every worca-vault* file.
async function literalSandbox() {
  const sb = sandbox();
  await withVault(sb);
  seedLiterals({ home: sb.env.HOME, worca: sb.home });
  const files = secretFiles(sb.env.HOME, sb.home);
  const bytes = () => ({ ...Object.fromEntries(Object.entries(files).map(([k, f]) => [k, readFileSync(f, 'hex')])), ...vaultEntries(sb.home) });
  const ops = (op) => readFakeCalls(sb.state).filter((c) => c.op === op).length;
  return { ...sb, bytes, ops, vault: createVault({ home: sb.home, store: fileFakeOsStore(sb.state, { item: sb.item }) }) };
}

test('secrets status and doctor never migrate: every literal kept, 0 changed bytes, 0 setKey and 0 probe; models list migrates', async () => {
  const sb = await literalSandbox();
  const before = sb.bytes();
  for (const args of [['secrets', 'status'], ['doctor']]) {
    const r = await run(sb, args);
    assert.equal(r.code, 0, `${args.join(' ')}: ${r.stderr}`);
  }
  assert.deepEqual(sb.bytes(), before);
  assert.equal(sb.ops('setKey'), 1, 'only the seeding vault\'s key');
  assert.equal(sb.ops('probe'), 0);
  const checked = await run(sb, ['secrets', 'status', '--check']);
  assert.equal(checked.code, 0, checked.stderr);
  assert.deepEqual(sb.bytes(), before, 'status --check moves nothing');
  assert.equal(existsSync(join(sb.home, 'secrets-notice.json')), false, 'status, --check and doctor write no notice');
  const listed = await run(sb, ['models', 'list']);
  assert.equal(listed.code, 0, listed.stderr);
  assert.equal(sb.ops('probe'), 2);
  const got = await readSecrets({ home: sb.env.HOME, worca: sb.home, vault: sb.vault });
  for (const x of secretSlots()) {
    assert.equal(got[x.id].ref, true, x.id);
    assert.equal(got[x.id].value, x.value, x.id);
  }
  for (const t of [listed.stdout, listed.stderr]) assert.ok(!t.includes('cnry7d3f') && !t.includes('worca:vault:v1:'));
});

test('models list in a container or a hosted install: 0 probe, 0 setKey, 0 changed bytes', async () => {
  for (const extra of [{ WORCA_CONTAINER: '1' }, { WORCA_ALLOWED_HOSTS: 'worca.example.com' }]) {
    const sb = await literalSandbox();
    const before = sb.bytes();
    const setKeysBefore = sb.ops('setKey');
    const r = await run(sb, ['models', 'list'], extra);
    assert.equal(r.code, 0, r.stderr);
    assert.deepEqual(sb.bytes(), before, JSON.stringify(extra));
    assert.equal(sb.ops('probe'), 0);
    assert.equal(sb.ops('setKey'), setKeysBefore);
  }
});

// ---- export, ack, status --check and the agent backstop ----

const SEED = 'cnry7d3f';
const NOTICE = (sb) => join(sb.home, 'secrets-notice.json');
// The secretVault flag stored in settings.json (WORCA_FLAGS dropped), so export can turn it off.
function storeFlag(sb, on) {
  const f = secretFiles(sb.env.HOME, sb.home).settings;
  const raw = JSON.parse(readFileSync(f, 'utf8'));
  raw.flags = { ...(raw.flags ?? {}), secretVault: on };
  writeFileSync(f, JSON.stringify(raw), { mode: 0o600 });
  delete sb.env.WORCA_FLAGS;
}
// Literals seeded, then migrated by a `models list` start (which records the notice).
async function migratedSandbox() {
  const sb = await literalSandbox();
  storeFlag(sb, true);
  const r = await run(sb, ['models', 'list']);
  assert.equal(r.code, 0, r.stderr);
  assert.ok(existsSync(NOTICE(sb)), 'the migration recorded the notice');
  return { ...sb, first: r };
}
const noSeed = (r) => { for (const t of [r.stdout, r.stderr]) assert.ok(!t.includes(SEED) && !t.includes('worca:vault:v1:')); };

test('export in a terminal, with the word typed: 9 plain literals at 0600, no vault, no item, the notice gone and the flag off; exit 0', PTY, async () => {
  const sb = await migratedSandbox();
  const r = asRun(await runInTerminal(['secrets', 'export'], { env: sb.env }));
  assert.equal(r.code, 0, r.stdout);
  assert.match(r.stdout, /^Provider and model keys: 4 written back to the config file\.$/m);
  assert.match(r.stdout, /Removed the vault and its key from test store\.\nTurned the secretVault flag off\.\n$/);
  const got = await readSecrets({ home: sb.env.HOME, worca: sb.home, vault: sb.vault });
  for (const x of secretSlots()) assert.equal(got[x.id].raw, x.value, x.id);
  if (process.platform !== 'win32') for (const f of Object.values(secretFiles(sb.env.HOME, sb.home))) assert.equal(statSync(f).mode & 0o777, 0o600, f);
  assert.deepEqual(vaultEntries(sb.home), {});
  assert.equal(peekKey(sb.state, sb.item), null);
  assert.equal(existsSync(NOTICE(sb)), false);
  assert.notEqual(JSON.parse(readFileSync(secretFiles(sb.env.HOME, sb.home).settings, 'utf8')).flags?.secretVault, true);
  noSeed(r);
  const again = asRun(await runInTerminal(['secrets', 'export'], { env: sb.env }));
  assert.equal(again.code, 0, again.stdout);
  assert.match(again.stdout, /Nothing to export: no vault\.\n$/);
});

test('export: no TTY refuses (1), --yes is refused (2), an unknown option (2); no file changed', async () => {
  const sb = await migratedSandbox();
  const before = sb.bytes();
  const piped = await run(sb, ['secrets', 'export']);
  assert.equal(piped.code, 1);
  assert.equal(piped.stderr, `${NEEDS_TERMINAL_TEXT}\n`);
  // An environment variable never stands in for the terminal: none of these lifts the refusal.
  const env = await run(sb, ['secrets', 'export'], { CI: '1', WORCA_YES: '1', TERM: 'xterm-256color', FORCE_TTY: '1' });
  assert.equal(env.code, 1);
  const yes = await run(sb, ['secrets', 'export', '--yes']);
  assert.equal(yes.code, 2);
  assert.equal(yes.stderr, `${NO_YES_TEXT}\n`);
  const bad = await run(sb, ['secrets', 'export', '--force']);
  assert.equal(bad.code, 2);
  assert.deepEqual(sb.bytes(), before);
  assert.ok(peekKey(sb.state, sb.item));
  for (const r of [piped, env, yes, bad]) noSeed(r);
});

test('export in a terminal: flag-locked refuses (1) before the prompt; Enter or a wrong word cancels (2); no file changed', PTY, async () => {
  const sb = await migratedSandbox();
  const before = sb.bytes();
  const locked = asRun(await runInTerminal(['secrets', 'export'], { env: { ...sb.env, WORCA_FLAGS: 'secretVault' } }));
  assert.equal(locked.code, 1);
  assert.match(locked.stdout, /worca: cannot export: the secretVault flag is set by WORCA_FLAGS; remove it there, then run export again/);
  for (const answer of ['enter', 'wrong']) {
    const r = await runInTerminal(['secrets', 'export'], { env: sb.env, answer });
    assert.equal(r.code, 2, r.output);
    assert.match(r.word, /^EXPORT-[A-Z2-9]{4}$/);
    assert.match(r.output, /worca: export cancelled; nothing was changed/);
    noSeed(asRun(r));
  }
  assert.deepEqual(sb.bytes(), before);
  assert.ok(peekKey(sb.state, sb.item));
  noSeed(locked);
});

test('flag off with a vault: status shows the entry count and the export line; export works', PTY, async () => {
  const sb = await migratedSandbox();
  storeFlag(sb, false);
  const st = await run(sb, ['secrets', 'status']);
  assert.equal(st.code, 0, st.stderr);
  assert.match(st.stdout, /^Vault: readable \(\d+ entries\)$/m);
  assert.match(st.stdout, /Run `worca secrets export` to move the vaulted ones back to their config files\./);
  const r = asRun(await runInTerminal(['secrets', 'export'], { env: sb.env }));
  assert.equal(r.code, 0, r.stdout);
  assert.deepEqual(vaultEntries(sb.home), {});
  noSeed(st);
  noSeed(r);
});

test('CLI notice: a migrating start prints the names and the label on stderr only, again on the next start; ack clears it', PTY, async () => {
  const sb = await migratedSandbox();
  for (const r of [sb.first, await run(sb, ['models', 'list'])]) {
    assert.match(r.stderr, /Worca moved 9 saved secrets into the vault\. Its key is kept in test store\./);
    assert.match(r.stderr, /  - Provider key: openai\n/);
    assert.match(r.stderr, /  - Proxy login\n/);
    assert.ok(!r.stdout.includes('Worca moved'));
    noSeed(r);
  }
  const piped = await run(sb, ['secrets', 'ack']);
  assert.equal(piped.code, 1, 'ack is terminal-only too');
  assert.ok(existsSync(NOTICE(sb)));
  const kept = await runInTerminal(['secrets', 'ack'], { env: sb.env, answer: 'wrong' });
  assert.equal(kept.code, 2, kept.output);
  assert.ok(existsSync(NOTICE(sb)), 'a wrong word keeps the message');
  const acked = await runInTerminal(['secrets', 'ack'], { env: sb.env });
  assert.equal(acked.code, 0, acked.output);
  assert.match(acked.word, /^ACK-[A-Z2-9]{4}$/);
  assert.match(acked.output, /Done: the message will not be shown again\.\n$/);
  assert.equal(existsSync(NOTICE(sb)), false);
  const quiet = await run(sb, ['models', 'list']);
  assert.ok(!quiet.stderr.includes('Worca moved'));
  assert.equal(quiet.stdout, sb.first.stdout, 'stdout is the same with and without the notice');
  const none = await runInTerminal(['secrets', 'ack'], { env: sb.env });
  assert.equal(none.word, null, 'nothing to acknowledge: no prompt');
  assert.match(none.output, /No message to acknowledge\.\n$/);
});

test('status --check: passed on the fake (0), failed on a locked fake (1); no file changed', async () => {
  const sb = await literalSandbox();
  const before = sb.bytes();
  const ok = await run(sb, ['secrets', 'status', '--check']);
  assert.equal(ok.code, 0, ok.stderr);
  assert.equal(ok.stdout, 'OS store check: passed (test store)\n');
  writeFakeState(sb.state, { state: 'locked' });
  const bad = await run(sb, ['secrets', 'status', '--check']);
  assert.equal(bad.code, 1, bad.stderr);
  assert.equal(bad.stdout, '');
  assert.equal(bad.stderr, 'OS store check: failed (the OS key store is locked or did not answer in time)\n');
  assert.deepEqual(sb.bytes(), before);
  noSeed(ok);
  noSeed(bad);
});

test('under WORCA_HOST_PID, export, reset, ack and status --check exit 1 and change nothing', async () => {
  const sb = await migratedSandbox();
  const before = { ...sb.bytes(), notice: readFileSync(NOTICE(sb), 'hex') };
  for (const args of [['export'], ['reset'], ['ack'], ['status', '--check']]) {
    const r = await run(sb, ['secrets', ...args], { WORCA_HOST_PID: '1' });
    assert.equal(r.code, 1, args.join(' '));
    assert.equal(r.stderr, 'worca: run this in your own terminal, not from an agent\n');
    noSeed(r);
  }
  assert.deepEqual({ ...sb.bytes(), notice: readFileSync(NOTICE(sb), 'hex') }, before);
  assert.equal((await run(sb, ['secrets', 'status'], { WORCA_HOST_PID: '1' })).code, 0, 'plain status stays allowed');
});
