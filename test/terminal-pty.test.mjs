// test/terminal-pty.test.mjs — one handle over node-pty or plain pipes (#573).
import { test, afterEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadPty, _resetPtyForTests, spawnTerminal, descendantPids, killDescendants, pidAlive, ensureSpawnHelper, spawnHelperStatus, spawnHelperDoctorLine } from '../src/core/terminal/pty.mjs';

afterEach(() => _resetPtyForTests());
const scratch = mkdtempSync(join(tmpdir(), 'term-pty-'));
after(() => rmSync(scratch, { recursive: true, force: true }));

const collect = (h) => new Promise((resolve) => { let out = ''; h.onData((d) => { out += d; }); h.onExit((e) => resolve({ out, ...e })); });

test('WORCA_TERMINAL_PTY=0 forces pipes and says why', () => {
  assert.deepEqual(loadPty({ WORCA_TERMINAL_PTY: '0' }), { pty: null, reason: 'turned off with WORCA_TERMINAL_PTY=0' });
});

test('ensureSpawnHelper sets the exec bit node-pty 1.1.0 ships without; absent helpers are fine', { skip: process.platform === 'win32' }, () => {
  const dir = join(scratch, 'pkg', 'prebuilds', 'darwin-arm64');
  mkdirSync(dir, { recursive: true });
  const helper = join(dir, 'spawn-helper');
  writeFileSync(helper, '');
  chmodSync(helper, 0o644);
  assert.equal(ensureSpawnHelper(join(scratch, 'pkg'), { platform: 'darwin', arch: 'arm64' }), null);
  assert.equal(statSync(helper).mode & 0o111, 0o111);
  assert.equal(ensureSpawnHelper(join(scratch, 'none'), { platform: 'linux', arch: 'x64' }), null);
});

test('spawnHelperStatus finds the platform helper and reports its exec bit; doctor line prints the chmod fix', { skip: process.platform === 'win32' }, () => {
  const pkg = join(scratch, 'status-pkg');
  const dir = join(pkg, 'prebuilds', 'darwin-x64');
  mkdirSync(dir, { recursive: true });
  const helper = join(dir, 'spawn-helper');
  writeFileSync(helper, '');
  chmodSync(helper, 0o644);

  const bad = spawnHelperStatus(pkg, { platform: 'darwin', arch: 'x64' });
  assert.deepEqual(bad, [{ path: helper, executable: false }]);
  assert.equal(
    spawnHelperDoctorLine(bad),
    `node-pty spawn-helper: NOT executable — fix with: chmod +x '${helper}'`,
  );

  chmodSync(helper, 0o755);
  const good = spawnHelperStatus(pkg, { platform: 'darwin', arch: 'x64' });
  assert.deepEqual(good, [{ path: helper, executable: true }]);
  assert.equal(spawnHelperDoctorLine(good), `node-pty spawn-helper: ok (${helper})`);

  // No helper shipped for this platform (Linux without a build, Windows): nothing to check.
  assert.deepEqual(spawnHelperStatus(join(scratch, 'none'), { platform: 'linux', arch: 'x64' }), []);
  assert.equal(spawnHelperDoctorLine([]), 'node-pty spawn-helper: none for this platform (nothing to check)');
});

test('spawnHelperDoctorLine single-quotes a path with a quote in it', () => {
  assert.equal(
    spawnHelperDoctorLine([{ path: "/opt/it's/spawn-helper", executable: false }]),
    `node-pty spawn-helper: NOT executable — fix with: chmod +x '/opt/it'\\''s/spawn-helper'`,
  );
});

test('pipes: stdout and stderr both arrive; CR becomes LF on the way in; exit code reported', async () => {
  const h = spawnTerminal({ file: '/bin/sh', args: [], cwd: tmpdir(), env: { PATH: process.env.PATH }, pty: null });
  assert.equal(h.mode, 'pipes');
  const done = collect(h);
  h.write('echo out; echo err 1>&2\r');
  h.write('exit 3\r');
  const r = await done;
  assert.match(r.out, /out/);
  assert.match(r.out, /err/);
  assert.equal(r.exitCode, 3);
});

test('pipes: a lone Ctrl+D closes stdin, so the program reading it sees end-of-input', async () => {
  const h = spawnTerminal({ file: '/bin/sh', args: [], cwd: tmpdir(), env: { PATH: process.env.PATH }, pty: null });
  // A shell reading a pipe may take the next line with this one (dash does), and then run it itself
  // ("hello: not found", exit 127). The whole line is parsed before it runs, so once "ready" is out the
  // shell is not reading, and what comes next goes to cat.
  let seen = '';
  const ready = new Promise((resolve) => h.onData((d) => { seen += d; if (seen.includes('ready')) resolve(); }));
  const done = collect(h);
  h.write('echo ready; cat; echo "cat-done"\r');
  await ready;
  h.write('hello\r');
  h.write('\x04');
  const r = await done;
  assert.match(r.out, /hello/);
  assert.doesNotMatch(r.out, /not found/, 'cat read the line, not the shell');
  assert.match(r.out, /cat-done/, 'cat ended on EOF and the rest of the line ran');
  assert.equal(r.exitCode, 0, 'the shell then ends too, as at a tty prompt');
});

test('a missing shell reports an exit instead of throwing', async () => {
  const h = spawnTerminal({ file: '/nope/sh', args: [], cwd: tmpdir(), env: {}, pty: null });
  const r = await collect(h);
  assert.equal(r.exitCode, -1);
});

test('descendantPids walks the tree, deepest first', () => {
  const rows = [[10, 1], [11, 10], [12, 11], [13, 10], [99, 1]];
  assert.deepEqual(descendantPids(10, () => rows), [12, 11, 13]);
});

test('killDescendants ends a child the shell started, and leaves the shell', { skip: process.platform === 'win32' }, async () => {
  const h = spawnTerminal({ file: '/bin/sh', args: [], cwd: tmpdir(), env: { PATH: process.env.PATH }, pty: null });
  const done = collect(h);
  h.write('sleep 30\n');
  await new Promise((r) => setTimeout(r, 300));
  assert.ok(killDescendants(h.pid) >= 1);
  h.write('echo alive; exit 0\n');
  const r = await done;
  assert.match(r.out, /alive/);
  assert.equal(pidAlive(h.pid), false);
});

test('pty: the real thing, when node-pty is installed here', { skip: !loadPty({}).pty }, async () => {
  const h = spawnTerminal({ file: '/bin/sh', args: [], cwd: tmpdir(), env: { PATH: process.env.PATH, TERM: 'xterm-256color' }, cols: 80, rows: 24 });
  assert.equal(h.mode, 'pty');
  const done = collect(h);
  h.write('tty; exit 0\r');
  const r = await done;
  assert.match(r.out, /\/dev\//);
  assert.equal(r.exitCode, 0);
});
