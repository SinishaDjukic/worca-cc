// test/terminal-pty.test.mjs — one handle over node-pty or plain pipes (#573).
import { test, afterEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadPty, _resetPtyForTests, spawnTerminal, descendantPids, killDescendants, pidAlive, ensureSpawnHelper, spawnHelperStatus, spawnHelperDoctorLine,
  parseWinRows, parseWmicRows, shellPidFrom, winShellPidSync, winShellPid, parseMsysPs, msysPsFor, msysCommandPids, killTree, killWinPids,
  killWinCommands, endWinTerminal, winReapable, signalDescendants } from '../src/core/terminal/pty.mjs';

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

// Over pipes Git for Windows' bin\bash.exe (10) has TWO children: conhost.exe and usr\bin\bash.exe (11, the real shell).
const LAUNCH = [[10, 1, 100, 'bash.exe'], [12, 10, 110, 'conhost.exe'], [11, 10, 111, 'bash.exe']];

test('parseWinRows / parseWmicRows read the CIM and wmic listings', () => {
  assert.deepEqual(parseWinRows('36016 40072 134377545617076180 bash.exe\r\nnoise\r\n12 10 0 System Idle Process\r\n'),
    [[36016, 40072, 134377545617076180, 'bash.exe'], [12, 10, 0, 'System Idle Process']]);
  assert.deepEqual(parseWmicRows('\r\nNode,Name,ParentProcessId,ProcessId\r\nHOST,bash.exe,40072,36016\r\n'), [[36016, 40072, 0, 'bash.exe']]);
});

test('shellPidFrom: the launcher\'s one bash.exe child (conhost.exe beside it is fine); else the pid itself', () => {
  assert.equal(shellPidFrom(10, LAUNCH), 11);
  assert.equal(shellPidFrom(11, LAUNCH), 11, 'the real shell has no bash.exe child');
  assert.equal(shellPidFrom(10, [[10, 1, 100, 'cmd.exe'], [12, 10, 110, 'conhost.exe']]), 10, 'cmd.exe: itself');
  assert.equal(shellPidFrom(10, [[10, 1, 100, 'bash.exe'], [11, 10, 50, 'bash.exe']]), 10, 'a "child" older than the launcher is a reused pid\'s orphan');
  assert.equal(shellPidFrom(10, [[10, 1, 100, 'bash.exe'], [11, 10, 110, 'bash.exe'], [13, 10, 120, 'BASH.EXE']]), 10, 'two bash children: unknown');
});

test('winShellPidSync asks CIM for the pid and its children, falls back to wmic, then to the pid', () => {
  const seen = [];
  const cim = (file, args) => { seen.push([file, args.at(-1)]); return { status: 0, stdout: '10 1 100 bash.exe\r\n12 10 110 conhost.exe\r\n11 10 111 bash.exe\r\n' }; };
  assert.equal(winShellPidSync(10, cim), 11);
  assert.equal(seen[0][0], 'powershell.exe');
  assert.match(seen[0][1], /ProcessId=10 OR ParentProcessId=10/);
  const wmic = (file) => (file === 'powershell.exe' ? { status: 1, stdout: '' } : { status: 0, stdout: 'Node,Name,ParentProcessId,ProcessId\nH,bash.exe,1,10\nH,bash.exe,10,11\n' });
  assert.equal(winShellPidSync(10, wmic), 11);
  assert.equal(winShellPidSync(10, () => ({ status: 1, stdout: '' })), 10);
  assert.equal(winShellPidSync(null, () => { throw new Error('never'); }), null);
  assert.equal(winShellPidSync('10; calc', () => { throw new Error('never'); }), null, 'only a literal integer pid reaches the command');
});

test('winShellPid (async) gives the same answer through an async runner', async () => {
  assert.equal(await winShellPid(10, async () => ({ status: 0, stdout: '10 1 100 bash.exe\n11 10 111 bash.exe\n' })), 11);
});

// `ps -a` of Git for Windows (a status letter may lead a row), captured on Windows 11 with `sleep 21 | cat` running.
const MSYS_PS = [
  '      PID    PPID    PGID     WINPID   TTY         UID    STIME COMMAND',
  '     1452       1    1452      19752  ?        1867213 12:17:51 /usr/bin/bash',
  'I    1449       1    1449      36868  ?        1867213 12:17:51 /usr/bin/bash',
  '     1455    1452    1452       7120  ?        1867213 12:17:53 /usr/bin/cat',
  '     1454    1452    1452      36316  ?        1867213 12:17:53 /usr/bin/sleep',
  '     1451    1449    1449      41928  ?        1867213 12:17:51 /c/Program Files/nodejs/node',
].join('\r\n');

test('parseMsysPs and msysCommandPids: the commands under the shell, as Windows pids, deepest first', () => {
  const rows = parseMsysPs(MSYS_PS);
  assert.deepEqual(rows[1], [1449, 1, 1449, 36868]);
  assert.deepEqual(msysCommandPids(19752, rows), [7120, 36316]);
  assert.deepEqual(msysCommandPids(36868, rows), [41928]);
  assert.deepEqual(msysCommandPids(99999, rows), [], 'no MSYS row for that pid (the launcher, cmd.exe): nothing');
  assert.deepEqual(msysCommandPids(19752, [...rows, [1460, 1455, 1452, 5000]]), [5000, 7120, 36316], 'a grandchild before its parent');
  assert.deepEqual(msysCommandPids(19752, [...rows, [1452, 1452, 1452, 19752]]), [7120, 36316], 'a self-parented row does not loop');
  assert.deepEqual(msysCommandPids(19752, [...rows, [1470, 1471, 1452, 6000], [1471, 1470, 1452, 6001]]), [7120, 36316], 'a PPID cycle off the shell is never reached');
  assert.deepEqual(msysCommandPids(19752, [...rows, [1452, 1455, 1452, 19752]]), [7120, 36316], 'a cycle back to the shell ends at the shell');
});

test('msysPsFor: usr\\bin\\ps.exe of the Git install, or next to an MSYS2 bash', () => {
  const has = (...f) => (p) => f.includes(p);
  assert.equal(msysPsFor('C:\\Program Files\\Git\\bin\\bash.exe', has('C:\\Program Files\\Git\\usr\\bin\\ps.exe')), 'C:\\Program Files\\Git\\usr\\bin\\ps.exe');
  assert.equal(msysPsFor('C:\\msys64\\usr\\bin\\bash.exe', has('C:\\msys64\\usr\\bin\\ps.exe')), 'C:\\msys64\\usr\\bin\\ps.exe');
  assert.equal(msysPsFor('C:\\Windows\\system32\\cmd.exe', () => false), null);
  assert.equal(msysPsFor(null, () => true), null);
});

test('killTree / killWinPids: one taskkill /PID <pid> /T /F per literal pid; a failed one is not counted', () => {
  const calls = [];
  const run = (f, a) => { calls.push([f, ...a]); return { status: a[1] === '14' ? 128 : 0 }; };
  assert.equal(killTree(10, run), true);
  assert.equal(killWinPids([12, 14, 0, -1, 1.5], run), 1);
  assert.deepEqual(calls, [['taskkill', '/PID', '10', '/T', '/F'], ['taskkill', '/PID', '12', '/T', '/F'], ['taskkill', '/PID', '14', '/T', '/F']]);
  assert.equal(killTree(null, () => { throw new Error('never'); }), false);
});

test('killWinCommands ends the shell\'s commands, never the shell; endWinTerminal then ends the launcher\'s tree', () => {
  const calls = [];
  const run = (f, a) => { calls.push([f, ...a]); return f.endsWith('ps.exe') ? { status: 0, stdout: MSYS_PS } : { status: 0 }; };
  const exists = (p) => p === 'C:\\Git\\usr\\bin\\ps.exe';
  assert.equal(killWinCommands(19752, 'C:\\Git\\bin\\bash.exe', { run, exists }), 2);
  assert.deepEqual(calls.map((c) => c.join(' ')), ['C:\\Git\\usr\\bin\\ps.exe -a', 'taskkill /PID 7120 /T /F', 'taskkill /PID 36316 /T /F']);
  calls.length = 0;
  endWinTerminal(500, 'C:\\Git\\bin\\bash.exe', 19752, { run, exists });
  assert.deepEqual(calls.map((c) => c.join(' ')), ['C:\\Git\\usr\\bin\\ps.exe -a', 'taskkill /PID 7120 /T /F', 'taskkill /PID 36316 /T /F', 'taskkill /PID 500 /T /F'],
    'commands first (while the shell still owns them in MSYS\'s table), then the launcher');
});

test('winReapable (boot reap): only the recorded shell, started before the pid file was last written', () => {
  const sinceMs = Date.UTC(2026, 9, 30, 12, 0, 0);
  const ft = (ms) => (ms + 11644473600000) * 10000;              // a FILETIME, as the CIM line prints it
  const cim = (createdMs, name = 'bash.exe') => (file, args) => {
    assert.equal(file, 'powershell.exe');
    assert.match(args.at(-1), /ProcessId=10 OR ParentProcessId=10/);
    return { status: 0, stdout: `10 1 ${ft(createdMs)} ${name}\r\n11 10 ${ft(createdMs + 5)} bash.exe\r\n` };
  };
  const shell = 'C:\\Program Files\\Git\\bin\\bash.exe';
  assert.equal(winReapable(10, { shell, sinceMs, run: cim(sinceMs - 60000) }), true);
  assert.equal(winReapable(10, { shell, sinceMs, run: cim(sinceMs - 60000, 'BASH.EXE') }), true, 'image names compare case-insensitively');
  assert.equal(winReapable(10, { shell, sinceMs, run: cim(sinceMs + 60000) }), false, 'started after the file was written: a recycled pid');
  assert.equal(winReapable(10, { shell, sinceMs, run: cim(sinceMs - 60000, 'notepad.exe') }), false, 'another program has the pid');
  assert.equal(winReapable(10, { shell, sinceMs, run: () => ({ status: 1, stdout: '' }) }), false, 'CIM failed: unknown, never killed');
  assert.equal(winReapable(10, { shell: null, sinceMs, run: () => { throw new Error('never'); } }), false, 'an old row without a shell');
  assert.equal(winReapable('10; x', { shell, sinceMs, run: () => { throw new Error('never'); } }), false);
});

test('Windows: SIGINT and the POSIX killers stay no-ops on win32', () => {
  assert.equal(signalDescendants(10, 'SIGINT', 'win32', () => { throw new Error('never'); }), 0);
  assert.equal(killDescendants(10, 'win32', () => { throw new Error('never'); }), 0);
});
