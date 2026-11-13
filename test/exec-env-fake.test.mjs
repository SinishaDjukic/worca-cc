// test/exec-env-fake.test.mjs
// The lazy e2b loader and the loopback fake SDK (src/core/exec-env/e2b-sdk.mjs, e2b-fake.mjs).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFakeE2b } from '../src/core/exec-env/e2b-fake.mjs';
import { loadE2b, _setE2bForTests } from '../src/core/exec-env/e2b-sdk.mjs';
import { e2bClient } from '../src/core/exec-env/backends/e2b.mjs';

const POSIX = { skip: process.platform === 'win32' ? 'e2b mode is POSIX-only' : false };
const scratch = []; after(() => scratch.forEach((d) => rmSync(d, { recursive: true, force: true })));
const tmp = (p) => { const d = mkdtempSync(join(tmpdir(), p)); scratch.push(d); return d; };

test('loadE2b returns the test override', async () => {
  const mod = { Sandbox: {} };
  _setE2bForTests(mod);
  try { assert.equal(await loadE2b(), mod); assert.equal(await loadE2b({ mock: true }), mod); }
  finally { _setE2bForTests(null); }
});

test('loadE2b({ mock: true }) returns one built-in fake per fake root', async () => {
  const prev = process.env.WORCA_HOME;
  try {
    process.env.WORCA_HOME = tmp('worca-e2b-home-');
    const a = await loadE2b({ mock: true });
    assert.equal(typeof a.Sandbox.create, 'function');
    assert.equal(await loadE2b({ mock: true }), a, 'same root, same fake');
    process.env.WORCA_HOME = tmp('worca-e2b-home-');
    const b = await loadE2b({ mock: true });
    assert.notEqual(b, a, 'another WORCA_HOME gets a new fake');
  } finally {
    if (prev === undefined) delete process.env.WORCA_HOME; else process.env.WORCA_HOME = prev;
  }
});

test('a missing e2b package raises the install hint', async (t) => {
  let installed = true;
  try { import.meta.resolve('e2b'); } catch { installed = false; }
  if (installed) { t.skip('the e2b package is installed here'); return; }
  await assert.rejects(loadE2b(), /npm install e2b@2\.56\.0/);
});

test('fake lifecycle: files, foreground/background commands, timeout, info, list, kill', POSIX, async () => {
  const sdk = createFakeE2b({ root: tmp('worca-e2b-root-') });
  const sb = await sdk.Sandbox.create('worca-agent', { metadata: { worca: '1', worcaRunId: 'r1' }, timeoutMs: 1000 });
  const p = `${sb.pathPrefix}/work/x.txt`;
  await sb.files.write(p, 'hello');
  assert.equal(await sb.files.read(p), 'hello');
  await sb.files.write(p, new Blob([Buffer.from([1, 2, 3])]));
  assert.deepEqual([...await sb.files.read(p, { format: 'bytes' })], [1, 2, 3]);

  const ok = await sb.commands.run('echo hi');
  assert.equal(ok.exitCode, 0); assert.equal(ok.stdout, 'hi\n');
  await assert.rejects(sb.commands.run('echo bad >&2; exit 3'), (e) => e.name === 'CommandExitError' && e.exitCode === 3 && e.stderr === 'bad\n');

  const h = await sb.commands.run('echo bg', { background: true });
  assert.equal(typeof h.pid, 'number');
  assert.equal((await h.wait()).stdout, 'bg\n');

  await sb.setTimeout(5000);
  assert.ok(sdk.events.some((e) => e.type === 'setTimeout' && e.ms === 5000));
  const info = await sdk.Sandbox.getInfo(sb.sandboxId);
  assert.equal(info.state, 'running'); assert.equal(info.metadata.worcaRunId, 'r1');
  const other = await sdk.Sandbox.create('worca-agent', { metadata: { worca: '1', worcaRunId: 'r2' } });
  const listed = await sdk.Sandbox.list({ query: { metadata: { worcaRunId: 'r1' } } }).nextItems();
  assert.deepEqual(listed.map((s) => s.sandboxId), [sb.sandboxId]);

  assert.equal(await sdk.Sandbox.kill(sb.sandboxId), true);
  assert.equal(await sdk.Sandbox.kill(sb.sandboxId), false);
  assert.equal(existsSync(sb.pathPrefix), false);
  await assert.rejects(sb.files.read(p), (e) => e.name === 'SandboxNotRunningError');
  await assert.rejects(sb.files.write(p, 'x'), (e) => e.name === 'SandboxNotRunningError');
  await assert.rejects(sb.commands.run('true'), (e) => e.name === 'SandboxNotRunningError');
  await assert.rejects(sdk.Sandbox.connect(sb.sandboxId), (e) => e.name === 'SandboxNotFoundError');
  await assert.rejects(sdk.Sandbox.getInfo(sb.sandboxId), (e) => e.name === 'SandboxNotFoundError');
  await assert.rejects(sb.setTimeout(10), (e) => e.name === 'SandboxNotFoundError');
  await other.kill();
});

test('an onCommand that throws rejects commands.run with that error; canned results stream', POSIX, async () => {
  const sdk = createFakeE2b({ root: tmp('worca-e2b-root-'), onCommand: (cmd) => {
    if (cmd === 'boom') { const e = new Error('tunnel'); e.name = 'SandboxUnreachableError'; throw e; }
    if (cmd === 'canned') return { lines: ['a', 'b'], stderr: 'warn', exitCode: 0 };
    return null;
  } });
  const sb = await sdk.Sandbox.create('worca-agent');
  await assert.rejects(sb.commands.run('boom'), (e) => e.name === 'SandboxUnreachableError');
  const out = [];
  const r = await sb.commands.run('canned', { onStdout: (d) => out.push(d) });
  assert.equal(r.stdout, 'a\nb\n'); assert.equal(r.stderr, 'warn'); assert.deepEqual(out, ['a\n', 'b\n']);
  await sdk.Sandbox.kill(sb.sandboxId);
});

test('fake: background command streams chunks, kill ends it, killed sandbox is gone', POSIX, async () => {
  const root = tmp('worca-e2b-fake-');
  const sdk = createFakeE2b({ root });
  const sb = await sdk.Sandbox.create('worca-agent', { metadata: { worca: '1', worcaRunId: 'r1' }, timeoutMs: 1000 });
  const chunks = [];
  const h = await sb.commands.run('echo a; sleep 5', { background: true, onStdout: (d) => chunks.push(d) });
  await new Promise((r) => setTimeout(r, 100));
  await h.kill();
  await assert.rejects(h.wait(), (e) => e.name === 'CommandExitError');
  assert.equal(chunks.join(''), 'a\n');
  const p = sdk.Sandbox.list({ query: { metadata: { worcaRunId: 'r1' } } });
  assert.equal((await p.nextItems()).length, 1);
  assert.equal((await sdk.Sandbox.getInfo(sb.sandboxId)).state, 'running');
  assert.equal(await sdk.Sandbox.kill(sb.sandboxId), true);
  assert.equal(await sdk.Sandbox.kill(sb.sandboxId), false);
  await assert.rejects(sb.files.read(`${sb.pathPrefix}/x`), (e) => e.name === 'SandboxNotRunningError');
  await assert.rejects(sdk.Sandbox.getInfo(sb.sandboxId), (e) => e.name === 'SandboxNotFoundError');
});

test('killing a sandbox kills its running background commands', POSIX, async () => {
  const sdk = createFakeE2b({ root: tmp('worca-e2b-root-') });
  const sb = await sdk.Sandbox.create('worca-agent');
  const h = await sb.commands.run('sleep 30', { background: true });
  const t0 = Date.now();
  await sdk.Sandbox.kill(sb.sandboxId);
  await assert.rejects(h.wait(), (e) => e.name === 'CommandExitError');
  assert.ok(Date.now() - t0 < 5000);
});

test('e2bClient.run passes timeoutMs 0 (no deadline) through to commands.run', async () => {
  const seen = [];
  const box = { commands: { run: async (cmd, o) => { seen.push(o); return {}; } } };
  const client = e2bClient({}, { opts: {} }, { mock: true });
  await client.run(box, 'true', { background: true, timeoutMs: 0 });
  await client.run(box, 'true');
  assert.equal(seen[0].timeoutMs, 0);
  assert.equal('timeoutMs' in seen[1], false, 'no option, the SDK default');
});

test('a background command with stdin: true reads what sendStdin writes', POSIX, async () => {
  const sdk = createFakeE2b({ root: tmp('worca-e2b-root-') });
  const client = e2bClient(sdk, { opts: {} }, { mock: true });
  const box = await client.create({ environment: 'worca-agent', tags: {}, timeoutMs: 1000 });
  let out = '';
  const h = await client.run(box.box, 'head -n 2', { background: true, stdin: true, onStdout: (d) => { out += d; } });
  await h.sendStdin('a\nb\n');
  await h.wait();
  assert.equal(out, 'a\nb\n');
  const plain = await client.run(box.box, 'echo hi', { background: true });
  assert.equal(plain.sendStdin, undefined, 'no stdin option, no sendStdin');
  await plain.wait();
});

// The e2b SDK's CommandHandle appends every stdout/stderr chunk to `_stdout`/`_stderr` for the command's whole life and
// calls onStdout/onStderr with the handle as `this` (node_modules/e2b dist, CommandHandle.iterateEvents/handleEvents).
class SdkLikeHandle {
  constructor(onStdout, onStderr) { this.onStdout = onStdout; this.onStderr = onStderr; this._stdout = ''; this._stderr = ''; }
  get stdout() { return this._stdout; }
  get stderr() { return this._stderr; }
  async emit(out, err) {
    if (out) { this._stdout += out; await this.onStdout?.call(this, out); }
    if (err) { this._stderr += err; await this.onStderr?.call(this, err); }
  }
}

test('a stdin: true handle keeps no stdout/stderr accumulator across many frames (C1)', async () => {
  const handles = [];
  // One chunk arrives before commands.run resolves (the SDK's event loop starts in the constructor).
  const box = { commands: { run: async (cmd, o) => { const h = new SdkLikeHandle(o.onStdout, o.onStderr); handles.push(h); await h.emit('early\n', 'warn\n'); return h; } } };
  const client = e2bClient({}, { opts: {} }, { mock: true });
  let got = 0; let errs = 0;
  const h = await client.run(box, 'node relay', { background: true, stdin: true, onStdout: (d) => { got += d.length; }, onStderr: (d) => { errs += d.length; } });
  assert.equal(h, handles[0], 'the SDK handle itself, so wait/kill/sendStdin are untouched');
  assert.equal(h._stdout, ''); assert.equal(h._stderr, '');
  const frame = `{"t":"req","b64":"${'A'.repeat(64 << 10)}"}\n`;
  for (let i = 0; i < 500; i++) {
    await h.emit(frame, i % 50 ? '' : 'note\n');
    assert.ok(h._stdout.length <= frame.length, `bounded after frame ${i}: ${h._stdout.length}`);
  }
  assert.equal(h._stdout, ''); assert.equal(h._stderr, '');
  assert.equal(got, 'early\n'.length + 500 * frame.length, 'every chunk still reaches onStdout');
  assert.equal(errs, 'warn\n'.length + 10 * 'note\n'.length);
  // A command without stdin keeps the SDK's accumulator (foreground commands read result.stdout).
  const plain = await client.run(box, 'echo', { background: true, onStdout: () => {} });
  await plain.emit('x\n');
  assert.equal(plain._stdout, 'early\nx\n');
});

test('e2bClient.readFile with maxBytes streams the file and stops past it (audit 2.7)', POSIX, async () => {
  const sdk = createFakeE2b({ root: tmp('worca-fake-read-') });
  const client = e2bClient(sdk, { opts: {} }, { mock: true });
  const box = await client.create({ environment: 'worca-agent', tags: {}, timeoutMs: 60_000 });
  const p = join(box.pathPrefix, 'big.bin');
  writeFileSync(p, Buffer.alloc(300_000, 7));
  assert.equal((await client.readFile(box.box, p, { maxBytes: 300_000 })).length, 300_000);
  await assert.rejects(client.readFile(box.box, p, { maxBytes: 100_000 }), (e) => e.code === 'E_TOO_LARGE');
  assert.equal((await client.readFile(box.box, p)).length, 300_000, 'no cap without maxBytes');
  await sdk.Sandbox.kill(box.id);
});

test('the pinned e2b SDK reads a file as a stream (readFile maxBytes, audit 2.7)', (t) => {
  let file;
  try { file = fileURLToPath(import.meta.resolve('e2b')); } catch { t.skip('the e2b package is not installed'); return; }
  assert.match(readFileSync(file, 'utf8'), /format === "stream"|case "stream"/, `${file}: files.read lost format 'stream'; e2bClient.readFile's capped read needs revisiting`);
});

test('the pinned e2b SDK still keeps its stdout accumulator in CommandHandle._stdout (C1 guard)', (t) => {
  let file;
  try { file = fileURLToPath(import.meta.resolve('e2b')); } catch { t.skip('the e2b package is not installed'); return; }
  const src = readFileSync(file, 'utf8');
  const start = src.indexOf('var CommandHandle = class {');
  assert.ok(start >= 0, `${file}: no CommandHandle class; e2bClient.run's accumulator reset (C1) needs revisiting`);
  const body = src.slice(start, src.indexOf('//#endregion', start));
  for (const want of ['_defineProperty(this, "_stdout", "")', '_defineProperty(this, "_stderr", "")', '._stdout += out', '._stderr += out',
    'onStdout.call(', 'onStderr.call(']) {
    assert.ok(body.includes(want), `CommandHandle no longer has "${want}": an e2b upgrade renamed the private accumulator e2bClient.run resets (C1)`);
  }
  assert.match(body, /get stdout\(\) \{\s*return this\._stdout;/);
});

test('a stdin write after the command closed its stdin does not crash the process (fake EPIPE)', POSIX, async () => {
  const sdk = createFakeE2b({ root: tmp('worca-e2b-root-') });
  const client = e2bClient(sdk, { opts: {} }, { mock: true });
  const box = await client.create({ environment: 'worca-agent', tags: {}, timeoutMs: 1000 });
  // The command closed its stdin and is about to exit: a write hits a closed pipe.
  const h = await client.run(box.box, 'exec 0<&-; sleep 0.5', { background: true, stdin: true });
  await new Promise((r) => setTimeout(r, 100));
  for (let i = 0; i < 20; i++) await h.sendStdin('x'.repeat(1 << 16)).catch(() => {});
  await h.wait();
  await new Promise((r) => setTimeout(r, 100));
  await sdk.Sandbox.kill(box.id);
});
