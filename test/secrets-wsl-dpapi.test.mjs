// test/secrets-wsl-dpapi.test.mjs — the WSL2 DPAPI backend over a recording runner that stands in for PowerShell
// (an XOR instead of DPAPI): fixed arguments, the key only on stdin, the create-only 0600 wrapped file, and the
// refusals that never reach the runner.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DPAPI_ARGS, dpapiOsStore, findPowershell, runWithInput } from '../src/core/secrets/wsl-dpapi.mjs';
import { WSL_POWERSHELL } from '../src/core/system-proxy.mjs';
import { WRAPPED_KEY_FILE } from '../src/core/secrets/files.mjs';
import { secretsStatus } from '../src/core/secrets/status.mjs';
import { callStore } from '../src/core/secrets/os-store.mjs';

const ROOT = mkdtempSync(join(tmpdir(), 'worca-dpapi-'));
after(() => rmSync(ROOT, { recursive: true, force: true, maxRetries: 5 }));
let n = 0;
const newHome = () => mkdtempSync(join(ROOT, `h${++n}-`));
const PS = '/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe';
const POSIX = process.platform !== 'win32';

const xor = (b) => Buffer.from(b.map((x) => x ^ 0xa5));
// Records every call and round-trips through the XOR stand-in.
function recordingRunner({ answer } = {}) {
  const calls = [];
  const run = async (file, args, { input }) => {
    calls.push({ file, args: [...args], env: { ...process.env }, input });
    if (answer) return answer(args);
    const data = Buffer.from(String(input).trim(), 'base64');
    return { code: 0, stdout: xor(data).toString('base64') };
  };
  return { run, calls };
}

test('the arguments are the two fixed constants, with an encoded script', () => {
  for (const args of [DPAPI_ARGS.protect, DPAPI_ARGS.unprotect]) {
    assert.ok(Object.isFrozen(args));
    assert.deepEqual(args.slice(0, 5), ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand']);
    const script = Buffer.from(args[5], 'base64').toString('utf16le');
    assert.match(script, /ProtectedData\]::(Protect|Unprotect)\(/);
    assert.match(script, /DataProtectionScope\]::CurrentUser/);
    assert.match(script, /\[Console\]::In\.ReadToEnd\(\)/);
  }
  assert.notDeepEqual(DPAPI_ARGS.protect, DPAPI_ARGS.unprotect);
});

test('findPowershell checks only the fixed absolute path', () => {
  const seen = [];
  assert.equal(findPowershell({ accessImpl: (p) => { seen.push(p); } }), WSL_POWERSHELL);
  assert.equal(findPowershell({ accessImpl: (p) => { seen.push(p); throw new Error('ENOENT'); } }), null);
  assert.deepEqual(seen, [WSL_POWERSHELL, WSL_POWERSHELL]);
  assert.ok(WSL_POWERSHELL.startsWith('/mnt/c/'));
});

test('round trip: the key travels only on stdin, in no argument or environment value', async () => {
  const home = newHome();
  const { run, calls } = recordingRunner();
  const s = dpapiOsStore({ home, powershell: PS, run });
  assert.equal(s.kind, 'wsl-dpapi');
  assert.equal(await s.getKey(), null);
  assert.equal(calls.length, 0, 'an absent wrapped key costs no runner call');
  const key = randomBytes(32);
  await s.setKey(key);
  const got = await s.getKey();
  assert.ok(got.equals(key));
  assert.deepEqual(calls.map((c) => c.args), [DPAPI_ARGS.protect, DPAPI_ARGS.unprotect]);
  assert.ok(calls.every((c) => c.file === PS));
  const forms = [key.toString('hex'), key.toString('base64'), key.toString('base64url'), key.toString('latin1')];
  for (const c of calls) {
    for (const f of forms) {
      for (const a of c.args) assert.ok(!a.includes(f));
      for (const v of Object.values(c.env)) assert.ok(!String(v).includes(f));
    }
  }
  assert.equal(calls[0].input, key.toString('base64'), 'protect gets the key on stdin');
  const file = join(home, WRAPPED_KEY_FILE);
  assert.ok(!readFileSync(file, 'utf8').includes(key.toString('base64')));
  if (POSIX) assert.equal(statSync(file).mode & 0o777, 0o600);
  assert.deepEqual(readdirSync(home), [WRAPPED_KEY_FILE], 'no temp file left behind');
});

test('setKey is create-only: a second setKey rejects exists and leaves the bytes', async () => {
  const home = newHome();
  const { run, calls } = recordingRunner();
  const s = dpapiOsStore({ home, powershell: PS, run });
  await s.setKey(randomBytes(32));
  const file = join(home, WRAPPED_KEY_FILE);
  const before = readFileSync(file);
  await assert.rejects(s.setKey(randomBytes(32)), { code: 'exists' });
  assert.ok(readFileSync(file).equals(before));
  assert.equal(calls.length, 1);
});

test('a non-zero exit or a wrong length is unavailable; runner text reaches neither the error nor the status', async () => {
  const canary = 'CANARY-dpapi-out-3b9d';
  for (const answer of [() => ({ code: 1, stdout: canary }), () => ({ code: 0, stdout: Buffer.from(canary).toString('base64') })]) {
    const home = newHome();
    writeFileSync(join(home, WRAPPED_KEY_FILE), 'AAAA', { mode: 0o600 });
    const s = dpapiOsStore({ home, powershell: PS, run: recordingRunner({ answer }).run });
    const err = await s.getKey().catch((e) => e);
    assert.equal(err.code, 'unavailable');
    for (const t of [err.message, err.stack]) assert.ok(!t.includes(canary));
    const st = await secretsStatus({ home, env: {}, store: Object.assign(s, { label: 'Windows DPAPI (WSL2)' }) });
    assert.equal(st.state, 'unavailable');
    assert.ok(!JSON.stringify(st).includes(canary));
  }
  // setKey: a failing protect writes nothing.
  const home = newHome();
  const s = dpapiOsStore({ home, powershell: PS, run: recordingRunner({ answer: () => ({ code: 1, stdout: canary }) }).run });
  const err = await s.setKey(randomBytes(32)).catch((e) => e);
  assert.equal(err.code, 'unavailable');
  assert.ok(!err.message.includes(canary));
  assert.equal(existsSync(join(home, WRAPPED_KEY_FILE)), false);
});

test('an oversized file or a symlinked wrapped key is unavailable with 0 runner calls', { skip: !POSIX }, async () => {
  const big = newHome();
  writeFileSync(join(big, WRAPPED_KEY_FILE), 'A'.repeat(4097));
  const r1 = recordingRunner();
  await assert.rejects(dpapiOsStore({ home: big, powershell: PS, run: r1.run }).getKey(), { code: 'unavailable' });
  const linked = newHome();
  const target = join(linked, 'elsewhere');
  writeFileSync(target, 'AAAA');
  symlinkSync(target, join(linked, WRAPPED_KEY_FILE));
  const r2 = recordingRunner();
  const s = dpapiOsStore({ home: linked, powershell: PS, run: r2.run });
  await assert.rejects(s.getKey(), { code: 'unavailable' });
  await assert.rejects(s.setKey(randomBytes(32)), { code: 'exists' });
  assert.equal(r1.calls.length + r2.calls.length, 0);
});

test('runWithInput: stdin in, stdout out, stderr dropped, missing binary and timeout give code null', { skip: !POSIX }, async () => {
  const echo = await runWithInput(process.execPath, ['-e', "process.stdin.pipe(process.stdout); process.stderr.write('noise')"], { input: 'hello', timeoutMs: 5000 });
  assert.deepEqual(echo, { code: 0, stdout: 'hello' });
  assert.deepEqual(await runWithInput(join(ROOT, 'no-such-binary'), [], { input: 'x', timeoutMs: 1000 }), { code: null, stdout: '' });
  const t0 = Date.now();
  assert.deepEqual(await runWithInput(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { input: '', timeoutMs: 200 }), { code: null, stdout: '' });
  assert.ok(Date.now() - t0 < 5000);
  const ac = new AbortController();
  const p = runWithInput(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { input: '', timeoutMs: 10_000, signal: ac.signal });
  ac.abort();
  assert.deepEqual(await p, { code: null, stdout: '' });
});

test('callStore bounds a hung runner and aborts it', async () => {
  const home = newHome();
  writeFileSync(join(home, WRAPPED_KEY_FILE), 'AAAA', { mode: 0o600 });
  let signal;
  const s = dpapiOsStore({ home, powershell: PS, run: (_f, _a, o) => { signal = o.signal; return new Promise(() => {}); } });
  await assert.rejects(callStore(s, 'getKey', [], { timeoutMs: 50 }), { code: 'store-locked' });
  assert.equal(signal.aborted, true);
});

test('probe: exactly 2 runner calls with the fixed arguments; the random bytes travel on stdin only; no file is created', async () => {
  const home = newHome();
  const { run, calls } = recordingRunner();
  const s = dpapiOsStore({ home, powershell: PS, run });
  await s.probe();
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0].args, [...DPAPI_ARGS.protect]);
  assert.deepEqual(calls[1].args, [...DPAPI_ARGS.unprotect]);
  const bytes = Buffer.from(calls[0].input, 'base64');
  assert.equal(bytes.length, 32);
  for (const c of calls) for (const a of c.args) assert.ok(!a.includes(calls[0].input));
  assert.deepEqual(readdirSync(home), []);
});

test('probe: a different or missing unprotected value and a failed run are refused', async () => {
  const rows = [
    [(args) => (args === DPAPI_ARGS.protect ? { code: 0, stdout: 'AAAA' } : { code: 0, stdout: Buffer.alloc(32, 9).toString('base64') }), 'probe-mismatch'],
    [(args) => (args === DPAPI_ARGS.protect ? { code: 0, stdout: 'AAAA' } : { code: 0, stdout: '' }), 'probe-missing'],
    [() => ({ code: 1, stdout: '' }), 'unavailable'],
  ];
  for (const [answer, code] of rows) {
    const home = newHome();
    const { run } = recordingRunner({ answer });
    await assert.rejects(dpapiOsStore({ home, powershell: PS, run }).probe(), { code });
    assert.deepEqual(readdirSync(home), []);
  }
});

test('deleteKey unlinks the wrapped key file with 0 runner calls; a second delete answers false', async () => {
  const home = newHome();
  const { run, calls } = recordingRunner();
  const s = dpapiOsStore({ home, powershell: PS, run });
  await s.setKey(randomBytes(32));
  const before = calls.length;
  assert.ok(existsSync(join(home, WRAPPED_KEY_FILE)));
  assert.equal(await callStore(s, 'deleteKey', [], { timeoutMs: 1000 }), true);
  assert.equal(existsSync(join(home, WRAPPED_KEY_FILE)), false);
  assert.equal(await s.deleteKey(), false);
  assert.equal(calls.length, before, 'no PowerShell call');
});
