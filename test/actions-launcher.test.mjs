// test/actions-launcher.test.mjs — the Editor / Terminal command lines of Settings › Runs › Actions
// (src/core/actions/launcher.mjs): the shell command per OS, {folder} and the other placeholders, the
// conveniences (a macOS .app, an unquoted path with spaces), the label, the save warning, what "Choose…"
// lists, and the watched launch. Every OS is tested from any OS (injected fs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { checkRows } from './helpers/rows.mjs';
import {
  shellQuote, quoteLeadingPath, buildLauncherCommand, launcherWarning, installedLaunchers, launchAndWatch,
} from '../src/core/actions/launcher.mjs';

const has = (paths) => (p) => paths.includes(p);
const MAC = { platform: 'darwin', env: { HOME: '/Users/ada' } };
const WIN = { platform: 'win32', env: { ComSpec: 'C:\\Windows\\system32\\cmd.exe', LOCALAPPDATA: 'C:\\Users\\ada\\AppData\\Local', ProgramFiles: 'C:\\Program Files' } };
const LINUX = { platform: 'linux', env: { HOME: '/home/ada' } };

test('shellQuote: single quotes on POSIX (with an embedded quote), double quotes on Windows', () => {
  assert.equal(shellQuote("/a/it's here", 'darwin'), "'/a/it'\\''s here'");
  assert.equal(shellQuote('C:\\a b', 'win32'), '"C:\\a b"');
});

test('POSIX: a bare command gets the folder appended, quoted; the line runs through /bin/sh -c', () => {
  const c = buildLauncherCommand('xed', { folder: '/Users/ada/runs/x y/repo', ...MAC, exists: () => false });
  assert.equal(c.file, '/bin/sh');
  assert.deepEqual(c.args, ['-c', "xed '/Users/ada/runs/x y/repo'"]);
  assert.equal(c.opts.detached, true);
});

test('{folder} and {worktree} go where they are written (a quoted one is not quoted twice); {branch} {project} {runId} too', () => {
  const vars = { branch: 'feat/a b', project: 'app-1', runId: 'ab12' };
  const c = buildLauncherCommand('code --new-window "{folder}" --goto {worktree} {branch} {project} {runId} {unknown}', { folder: '/r', vars, ...MAC, exists: () => false });
  assert.equal(c.line, "code --new-window '/r' --goto '/r' 'feat/a b' 'app-1' 'ab12' {unknown}");
  assert.ok(!c.line.endsWith("'/r' '/r'"), 'no extra folder at the end when {folder} is used');
});

test('macOS: a path to an app, or just its name, opens with open -a', () => {
  assert.equal(buildLauncherCommand('/Applications/Xcode.app', { folder: '/r', ...MAC, exists: has(['/Applications/Xcode.app']) }).line,
    "open -a '/Applications/Xcode.app' '/r'");
  assert.equal(buildLauncherCommand('Nova.app', { folder: '/r', ...MAC, exists: has(['/Users/ada/Applications/Nova.app']) }).line,
    "open -a '/Users/ada/Applications/Nova.app' '/r'");
  assert.equal(buildLauncherCommand('Missing.app', { folder: '/r', ...MAC, exists: () => false }).line, "Missing.app '/r'", 'an app that is not there stays as typed');
});

test('an unquoted path with spaces at the start is quoted (longest existing prefix); ~ is written out', () => {
  const code = '/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code';
  assert.equal(quoteLeadingPath(`${code} --new-window`, { ...MAC, exists: has([code]) }), `'${code}' --new-window`);
  assert.equal(quoteLeadingPath('~/my tools/ed -n', { ...MAC, exists: has(['/Users/ada/my tools/ed']) }), "'/Users/ada/my tools/ed' -n");
  assert.equal(quoteLeadingPath('"/already quoted" -x', { ...MAC, exists: () => true }), '"/already quoted" -x');
  assert.equal(quoteLeadingPath('code --x', { ...MAC, exists: () => true }), 'code --x', 'no space in the program: left alone');
});

test('Windows: cmd.exe /d /s /c with the whole line quoted; an unquoted C:\\Program Files path to an .exe is quoted', () => {
  const exe = 'C:\\Program Files\\Microsoft VS Code\\Code.exe';
  const c = buildLauncherCommand(`${exe} --new-window`, { folder: 'C:\\Users\\ada\\runs\\repo', ...WIN, exists: has([exe]) });
  assert.equal(c.file, 'C:\\Windows\\system32\\cmd.exe');
  assert.equal(c.line, `"${exe}" --new-window "C:\\Users\\ada\\runs\\repo"`);
  assert.deepEqual(c.args, ['/d', '/s', '/c', `"${c.line}"`]);
  assert.equal(c.opts.windowsVerbatimArguments, true);
  // %VAR% paths are looked up expanded and written as typed (cmd expands them).
  const viaVar = buildLauncherCommand('%LOCALAPPDATA%\\Programs\\My Ed\\ed.exe', { folder: 'C:\\r', ...WIN, exists: has(['C:\\Users\\ada\\AppData\\Local\\Programs\\My Ed\\ed.exe']) });
  assert.equal(viaVar.line, '"%LOCALAPPDATA%\\Programs\\My Ed\\ed.exe" "C:\\r"');
  // A folder is never taken as the program on Windows.
  assert.equal(quoteLeadingPath('C:\\Program Files\\x', { ...WIN, exists: () => true }), 'C:\\Program Files\\x');
  assert.equal(buildLauncherCommand('start "" /D {folder} cmd', { folder: 'C:\\r', ...WIN, exists: () => false }).line, 'start "" /D "C:\\r" cmd');
});

test('an empty line is refused', () => {
  assert.throws(() => buildLauncherCommand('  ', { folder: '/r', ...MAC }), (e) => e.code === 'EMPTY');
});

test('launcherWarning: a program not on PATH or not on disk warns; found, open -a, an app and cmd builtins do not', () => {
  const off = { ...MAC, exists: () => false, findOnPath: () => null };
  assert.match(launcherWarning('zedd {folder}', off), /^zedd was not found on this machine\. It is saved anyway; use Try to check it\.$/);
  assert.equal(launcherWarning('xed', { ...MAC, exists: () => false, findOnPath: () => '/usr/bin/xed' }), null);
  assert.equal(launcherWarning('open -a Xcode {folder}', off), null);
  assert.equal(launcherWarning('/Applications/Xcode.app', { ...MAC, exists: has(['/Applications/Xcode.app']), findOnPath: () => null }), null);
  assert.match(launcherWarning('/opt/none/ed', off), /^\/opt\/none\/ed was not found/);
  assert.equal(launcherWarning('start "" /D {folder} cmd', { ...WIN, exists: () => false, findOnPath: () => null }), null);
  assert.equal(launcherWarning('', off), null);
});

test('installedLaunchers per OS (macOS, Windows, Linux)', async () => {
  await checkRows([
    { name: 'installedLaunchers on macOS: xed with Xcode, an app CLI when present else open -a, Terminal always', run: () => {
      const found = installedLaunchers({ ...MAC, findOnPath: () => null, exists: has(['/usr/bin/xed', '/Applications/Xcode.app',
        '/Applications/Visual Studio Code.app', '/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code',
        '/Applications/Nova.app', '/Applications/iTerm.app', '/Applications/kitty.app', '/Applications/kitty.app/Contents/MacOS/kitty']) });
      assert.deepEqual(found.editor, [
        { label: 'Xcode', line: 'xed {folder}' },
        { label: 'Visual Studio Code', line: "'/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code' {folder}" },
        { label: 'Nova', line: "open -a '/Applications/Nova.app' {folder}" },
      ]);
      assert.deepEqual(found.terminal, [
        { label: 'Terminal', line: 'open -a Terminal {folder}' },
        { label: 'iTerm', line: "open -a '/Applications/iTerm.app' {folder}" },
        { label: 'kitty', line: "'/Applications/kitty.app/Contents/MacOS/kitty' --directory {folder}" },
      ]);
    } },
    { name: 'installedLaunchers on Windows: known install paths and PATH commands; the built-in terminals', run: () => {
      const code = 'C:\\Users\\ada\\AppData\\Local\\Programs\\Microsoft VS Code\\Code.exe';
      const found = installedLaunchers({ ...WIN, exists: has([code, 'C:\\Program Files\\Git\\git-bash.exe']), findOnPath: (n) => (n === 'wt' ? 'C:\\x\\wt.exe' : null) });
      assert.deepEqual(found.editor, [{ label: 'VS Code', line: `"${code}" {folder}` }]);
      assert.deepEqual(found.terminal.map((t) => t.label), ['Windows Terminal', 'Windows PowerShell', 'Command Prompt', 'Git Bash']);
      assert.equal(found.terminal[0].line, 'wt -d {folder}');
    } },
    { name: 'installedLaunchers on Linux: commands on PATH', run: () => {
      const found = installedLaunchers({ ...LINUX, exists: () => false, findOnPath: (n) => (['code', 'konsole'].includes(n) ? `/usr/bin/${n}` : null) });
      assert.deepEqual(found, { editor: [{ label: 'VS Code', line: 'code {folder}' }], terminal: [{ label: 'Konsole', line: 'konsole --workdir {folder}' }] });
    } },
  ]);
});

// ── the watched launch ───────────────────────────────────────────────────────

function fakeSpawn(script) {
  const calls = [];
  const spawn = (file, args, opts) => {
    calls.push({ file, args, opts });
    const child = new EventEmitter();
    child.stderr = new EventEmitter();
    child.stderr.resume = () => {}; child.stderr.unref = () => {};
    child.unref = () => { child.unrefd = true; };
    setImmediate(() => script(child));
    return child;
  };
  return { spawn, calls };
}
const CMD = { file: '/bin/sh', args: ['-c', 'x'], opts: { detached: true } };

test('launchAndWatch: exit 0 is ok; a quick failure reports its stderr; still running after the window is ok', async () => {
  const ok = fakeSpawn((c) => c.emit('exit', 0));
  assert.deepEqual(await launchAndWatch(CMD, { spawn: ok.spawn, watchMs: 500 }), { ok: true });
  assert.deepEqual(ok.calls[0].opts.stdio, ['ignore', 'ignore', 'pipe']);

  const bad = fakeSpawn((c) => { c.stderr.emit('data', 'sh: zedd: command not found\n'); c.emit('exit', 127); });
  assert.deepEqual(await launchAndWatch(CMD, { spawn: bad.spawn, watchMs: 500 }), { ok: false, code: 127, error: 'sh: zedd: command not found' });

  const quiet = fakeSpawn((c) => c.emit('exit', 3));
  assert.deepEqual(await launchAndWatch(CMD, { spawn: quiet.spawn, watchMs: 500 }), { ok: false, code: 3, error: 'the command exited with code 3' });

  let child;
  const long = fakeSpawn((c) => { child = c; });
  assert.deepEqual(await launchAndWatch(CMD, { spawn: long.spawn, watchMs: 30 }), { ok: true });
  assert.equal(child.unrefd, true, 'left running on its own');

  const err = fakeSpawn((c) => c.emit('error', new Error('spawn /bin/sh ENOENT')));
  assert.deepEqual(await launchAndWatch(CMD, { spawn: err.spawn, watchMs: 500 }), { ok: false, code: null, error: 'spawn /bin/sh ENOENT' });
});

test('launchAndWatch: okExitCodes on the spec widens success (Explorer exits 1); a spawn error still fails', async () => {
  const EXPLORER = { file: 'explorer.exe', args: ['C:\\w'], opts: { detached: true }, okExitCodes: [0, 1] };
  const one = fakeSpawn((c) => c.emit('exit', 1));
  assert.deepEqual(await launchAndWatch(EXPLORER, { spawn: one.spawn, watchMs: 500 }), { ok: true });
  assert.equal('okExitCodes' in one.calls[0].opts, false, 'not passed on to spawn');

  const two = fakeSpawn((c) => c.emit('exit', 2));
  assert.deepEqual(await launchAndWatch(EXPLORER, { spawn: two.spawn, watchMs: 500 }), { ok: false, code: 2, error: 'the command exited with code 2' });

  const plain = fakeSpawn((c) => c.emit('exit', 1));
  assert.deepEqual(await launchAndWatch(CMD, { spawn: plain.spawn, watchMs: 500 }), { ok: false, code: 1, error: 'the command exited with code 1' });

  const err = fakeSpawn((c) => c.emit('error', new Error('spawn explorer.exe ENOENT')));
  assert.deepEqual(await launchAndWatch(EXPLORER, { spawn: err.spawn, watchMs: 500 }), { ok: false, code: null, error: 'spawn explorer.exe ENOENT' });
});

test('launchAndWatch runs a real shell line (POSIX): a missing program fails with the shell\'s message', { skip: process.platform === 'win32' }, async () => {
  const { spawn } = await import('node:child_process');
  const good = buildLauncherCommand(`"${process.execPath}" -e 0`, { folder: '/tmp' });
  assert.deepEqual(await launchAndWatch(good, { spawn, watchMs: 4000 }), { ok: true });
  const missing = buildLauncherCommand('worca-no-such-editor-xyz', { folder: '/tmp' });
  const r = await launchAndWatch(missing, { spawn, watchMs: 4000 });
  assert.equal(r.ok, false);
  assert.match(r.error, /worca-no-such-editor-xyz/);
});

test('lineForPickedApp: a known app gets its own command; any other app opens the folder the general way', async () => {
  const { lineForPickedApp } = await import('../src/core/actions/launcher.mjs');
  assert.deepEqual(lineForPickedApp('/Applications/Xcode.app/', { platform: 'darwin', exists: has(['/usr/bin/xed']) }), { label: 'Xcode', line: 'xed {folder}' });
  assert.deepEqual(lineForPickedApp('/Applications/Visual Studio Code.app', { platform: 'darwin', exists: has(['/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code']) }),
    { label: 'Visual Studio Code', line: "'/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code' {folder}" });
  assert.deepEqual(lineForPickedApp('/Applications/Nova.app', { platform: 'darwin', exists: () => false }), { label: 'Nova', line: "open -a '/Applications/Nova.app' {folder}" });
  assert.deepEqual(lineForPickedApp('/Applications/kitty.app', { kind: 'terminal', platform: 'darwin', exists: () => true }),
    { label: 'kitty', line: "'/Applications/kitty.app/Contents/MacOS/kitty' --directory {folder}" });
  assert.deepEqual(lineForPickedApp('/System/Applications/Utilities/Terminal.app', { kind: 'terminal', platform: 'darwin', exists: () => false }), { label: 'Terminal', line: 'open -a Terminal {folder}' });
  assert.deepEqual(lineForPickedApp('C:\\Program Files\\Git\\git-bash.exe', { kind: 'terminal', platform: 'win32' }), { label: 'git-bash', line: '"C:\\Program Files\\Git\\git-bash.exe" --cd={folder}' });
  assert.deepEqual(lineForPickedApp('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe', { kind: 'terminal', platform: 'win32' }).line,
    'start "" /D {folder} "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe" -NoExit');
  assert.deepEqual(lineForPickedApp('C:\\Tools\\My Ed\\ed.exe', { platform: 'win32' }), { label: 'ed', line: '"C:\\Tools\\My Ed\\ed.exe" {folder}' });
  assert.deepEqual(lineForPickedApp('/usr/bin/konsole', { kind: 'terminal', platform: 'linux' }), { label: 'konsole', line: "'/usr/bin/konsole' --workdir {folder}" });
  assert.throws(() => lineForPickedApp('', { platform: 'darwin' }), (e) => e.code === 'EMPTY');
});
