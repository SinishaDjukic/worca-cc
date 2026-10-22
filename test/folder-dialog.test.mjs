// test/folder-dialog.test.mjs
// Unit tests for the native folder dialog wrapper. The runner is injected so
// no real dialog ever opens; platform/env are forced per test.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pickFolderNative, pickAppNative, _testing } from '../src/core/folder-dialog.mjs';
import { checkRows } from './helpers/rows.mjs';

afterEach(() => _testing.reset());

function runner(result) {
  const calls = [];
  _testing.set({ runner: async (cmd, args) => { calls.push({ cmd, args }); return result; } });
  return calls;
}

test('darwin: osascript results map to picked (trimmed, "/" kept), canceled (-128) or unsupported (no GUI, timeout)', async () => {
  // afterEach resets only between tests: each row starts from a reset, as its own test did.
  await checkRows([
    { name: 'darwin: picked path is trimmed of newline and trailing slash', run: async () => {
      _testing.set({ platform: 'darwin', env: {} });
      const calls = runner({ ok: true, stdout: '/Users/me/dev/app/\n', stderr: '', code: 0, timedOut: false });
      assert.deepEqual(await pickFolderNative(), { status: 'picked', path: '/Users/me/dev/app' });
      assert.equal(calls[0].cmd, 'osascript');
    } },
    { name: 'darwin: user cancel (-128) maps to canceled', run: async () => {
      _testing.reset();
      _testing.set({ platform: 'darwin', env: {} });
      runner({ ok: false, stdout: '', stderr: 'execution error: User canceled. (-128)', code: 1, timedOut: false });
      assert.deepEqual(await pickFolderNative(), { status: 'canceled' });
    } },
    { name: 'darwin: non-cancel failure (no GUI session) maps to unsupported', run: async () => {
      _testing.reset();
      _testing.set({ platform: 'darwin', env: {} });
      runner({ ok: false, stdout: '', stderr: 'execution error: No user interaction allowed. (-1713)', code: 1, timedOut: false });
      assert.deepEqual(await pickFolderNative(), { status: 'unsupported' });
    } },
    { name: 'darwin: picking the filesystem root keeps "/"', run: async () => {
      _testing.reset();
      _testing.set({ platform: 'darwin', env: {} });
      runner({ ok: true, stdout: '/\n', stderr: '', code: 0, timedOut: false });
      assert.deepEqual(await pickFolderNative(), { status: 'picked', path: '/' });
    } },
    { name: 'a timed-out dialog maps to unsupported', run: async () => {
      _testing.reset();
      _testing.set({ platform: 'darwin', env: {} });
      runner({ ok: false, stdout: '', stderr: 'dialog timed out', code: -1, timedOut: true });
      assert.deepEqual(await pickFolderNative(), { status: 'unsupported' });
    } },
  ]);
});

test('win32: STA powershell, TopMost-owned dialog, empty stdout is a cancel, multiple returns a one-element list', async () => {
  // afterEach resets only between tests: each row starts from a reset, as its own test did.
  await checkRows([
    { name: 'win32: empty stdout with ok exit maps to canceled; dialog runs on an STA thread', run: async () => {
      _testing.set({ platform: 'win32', env: {} });
      const calls = runner({ ok: true, stdout: '', stderr: '', code: 0, timedOut: false });
      assert.deepEqual(await pickFolderNative(), { status: 'canceled' });
      assert.equal(calls[0].cmd, 'powershell.exe');
      assert.ok(calls[0].args.includes('-STA'));
    } },
    { name: 'win32: the dialog is owned by a SHOWN TopMost form, so it opens above the browser', run: async () => {
      _testing.reset();
      // The server's PowerShell child is never the foreground process, so an unowned dialog (or one
      // whose TopMost owner is never shown) opens BEHIND the browser window: the user sees nothing.
      _testing.set({ platform: 'win32', env: {} });
      const calls = runner({ ok: true, stdout: '', stderr: '', code: 0, timedOut: false });
      await pickFolderNative();
      const script = calls[0].args[calls[0].args.indexOf('-Command') + 1];
      assert.match(script, /\$o\.TopMost = \$true/);
      assert.match(script, /\$o\.Show\(\)/);
      assert.match(script, /\$d\.ShowDialog\(\$o\)/);
    } },
    { name: 'win32 multiple: FolderBrowserDialog is single-select; one path comes back as a list', run: async () => {
      _testing.reset();
      _testing.set({ platform: 'win32', env: {} });
      runner({ ok: true, stdout: 'C:\\dev\\app\r\n', stderr: '', code: 0, timedOut: false });
      assert.deepEqual(await pickFolderNative({ multiple: true }), { status: 'picked', path: 'C:\\dev\\app', paths: ['C:\\dev\\app'] });
    } },
  ]);
});

test('linux: headless is unsupported unspawned; a zenity cancel stops there, a missing zenity falls back to kdialog', async () => {
  // afterEach resets only between tests: each row starts from a reset, as its own test did.
  await checkRows([
    { name: 'linux: headless (no DISPLAY/WAYLAND_DISPLAY) is unsupported without spawning', run: async () => {
      let spawned = 0;
      _testing.set({ platform: 'linux', env: {}, runner: async () => { spawned += 1; return { ok: false, stdout: '', stderr: '', code: -1, timedOut: false }; } });
      assert.deepEqual(await pickFolderNative(), { status: 'unsupported' });
      assert.equal(spawned, 0);
    } },
    { name: 'linux: zenity missing falls back to kdialog', run: async () => {
      _testing.reset();
      const calls = [];
      _testing.set({
        platform: 'linux',
        env: { DISPLAY: ':0', HOME: '/home/me' },
        runner: async (cmd) => {
          calls.push(cmd);
          if (cmd === 'zenity') return { ok: false, stdout: '', stderr: 'spawn zenity ENOENT', code: -1, timedOut: false };
          return { ok: true, stdout: '/home/me/dev\n', stderr: '', code: 0, timedOut: false };
        },
      });
      assert.deepEqual(await pickFolderNative(), { status: 'picked', path: '/home/me/dev' });
      assert.deepEqual(calls, ['zenity', 'kdialog']);
    } },
    { name: 'linux: zenity exit 1 is a user cancel; kdialog is not tried', run: async () => {
      _testing.reset();
      const calls = [];
      _testing.set({
        platform: 'linux', env: { DISPLAY: ':0' },
        runner: async (cmd) => { calls.push(cmd); return { ok: false, stdout: '', stderr: '', code: 1, timedOut: false }; },
      });
      assert.deepEqual(await pickFolderNative(), { status: 'canceled' });
      assert.deepEqual(calls, ['zenity']);
    } },
  ]);
});

test('guards: WORCA_NO_NATIVE_DIALOG forces unsupported unspawned; a concurrent pick is busy', async () => {
  // afterEach resets only between tests: each row starts from a reset, as its own test did.
  await checkRows([
    { name: 'WORCA_NO_NATIVE_DIALOG=1 forces unsupported without spawning', run: async () => {
      let spawned = 0;
      _testing.set({ platform: 'darwin', env: { WORCA_NO_NATIVE_DIALOG: '1' }, runner: async () => { spawned += 1; return { ok: true, stdout: '/x\n', stderr: '', code: 0, timedOut: false }; } });
      assert.deepEqual(await pickFolderNative(), { status: 'unsupported' });
      assert.equal(spawned, 0);
    } },
    { name: 'a second concurrent pick reports busy', run: async () => {
      _testing.reset();
      let release;
      _testing.set({ platform: 'darwin', env: {}, runner: () => new Promise((r) => { release = r; }) });
      const first = pickFolderNative();
      assert.deepEqual(await pickFolderNative(), { status: 'busy' });
      release({ ok: true, stdout: '/tmp\n', stderr: '', code: 0, timedOut: false });
      assert.deepEqual(await first, { status: 'picked', path: '/tmp' });
    } },
  ]);
});

test('purpose picks the dialog title from a closed set; unknown purpose falls back to the project title', async () => {
  _testing.set({ platform: 'darwin', env: {} });
  const calls = runner({ ok: true, stdout: '/x\n', stderr: '', code: 0, timedOut: false });
  await pickFolderNative({ purpose: 'plugin' });
  await pickFolderNative({ purpose: 'export' });
  await pickFolderNative({ purpose: 'rm -rf /' });           // never interpolated: not in the set
  await pickFolderNative();
  const prompts = calls.map((c) => /prompt "([^"]+)"/.exec(c.args[3])[1]);
  assert.deepEqual(prompts, [
    'Select the plugin folder',
    'Select the project folder to export into',
    'Select a project folder',
    'Select a project folder',
  ]);
});

test('darwin multiple: every path returned, duplicates collapsed, cancel still canceled', async () => {
  // afterEach resets only between tests: each row starts from a reset, as its own test did.
  await checkRows([
    { name: 'darwin multiple: runs choose folder with multiple selections and returns every path', run: async () => {
      _testing.set({ platform: 'darwin', env: {} });
      const calls = runner({ ok: true, stdout: '/Users/me/dev/a/\n/Users/me/dev/b/\n\n', stderr: '', code: 0, timedOut: false });
      assert.deepEqual(await pickFolderNative({ multiple: true }), {
        status: 'picked', path: '/Users/me/dev/a', paths: ['/Users/me/dev/a', '/Users/me/dev/b'],
      });
      const script = calls[0].args.join('\n');
      assert.match(script, /with multiple selections allowed/);
      assert.match(script, /prompt "Select a project folder"/, 'title still comes from the closed set');
    } },
    { name: 'darwin multiple: cancel (-128) still maps to canceled', run: async () => {
      _testing.reset();
      _testing.set({ platform: 'darwin', env: {} });
      runner({ ok: false, stdout: '', stderr: 'execution error: User canceled. (-128)', code: 1, timedOut: false });
      assert.deepEqual(await pickFolderNative({ multiple: true }), { status: 'canceled' });
    } },
    { name: 'multiple: duplicate lines are collapsed', run: async () => {
      _testing.reset();
      _testing.set({ platform: 'darwin', env: {} });
      runner({ ok: true, stdout: '/x/a\n/x/a/\n', stderr: '', code: 0, timedOut: false });
      assert.deepEqual(await pickFolderNative({ multiple: true }), { status: 'picked', path: '/x/a', paths: ['/x/a'] });
    } },
  ]);
});

test('linux multiple: zenity --multiple, kdialog fallback single-select as a one-element list', async () => {
  // afterEach resets only between tests: each row starts from a reset, as its own test did.
  await checkRows([
    { name: 'linux multiple: zenity gets --multiple with a newline separator', run: async () => {
      const calls = [];
      _testing.set({
        platform: 'linux', env: { DISPLAY: ':0' },
        runner: async (cmd, args) => { calls.push({ cmd, args }); return { ok: true, stdout: '/home/me/a\n/home/me/b\n', stderr: '', code: 0, timedOut: false }; },
      });
      assert.deepEqual(await pickFolderNative({ multiple: true }), { status: 'picked', path: '/home/me/a', paths: ['/home/me/a', '/home/me/b'] });
      assert.ok(calls[0].args.includes('--multiple'));
      assert.ok(calls[0].args.includes('--separator=\n'));
    } },
    { name: 'linux multiple: kdialog fallback is single-select and returns a one-element list', run: async () => {
      _testing.reset();
      const calls = [];
      _testing.set({
        platform: 'linux', env: { DISPLAY: ':0', HOME: '/home/me' },
        runner: async (cmd, args) => {
          calls.push({ cmd, args });
          if (cmd === 'zenity') return { ok: false, stdout: '', stderr: 'spawn zenity ENOENT', code: -1, timedOut: false };
          return { ok: true, stdout: '/home/me/dev\n', stderr: '', code: 0, timedOut: false };
        },
      });
      assert.deepEqual(await pickFolderNative({ multiple: true }), { status: 'picked', path: '/home/me/dev', paths: ['/home/me/dev'] });
      assert.ok(!calls[1].args.includes('--multiple'));
    } },
  ]);
});

test('purpose repos: macOS opens one NSOpenPanel (folders and .code-workspace files) through JXA; a broken bridge falls back to choose folder; Linux opens its folder dialog', async () => {
  // afterEach resets only between tests: each row starts from a reset, as its own test did.
  await checkRows([
    { name: 'darwin: one JXA panel; every picked path comes back', run: async () => {
      _testing.set({ platform: 'darwin', env: {} });
      const calls = runner({ ok: true, stdout: '/Users/me/dev/api\n/Users/me/dev/acme.code-workspace\n', stderr: '', code: 0, timedOut: false });
      assert.deepEqual(await pickFolderNative({ purpose: 'repos', multiple: true }), {
        status: 'picked', path: '/Users/me/dev/api', paths: ['/Users/me/dev/api', '/Users/me/dev/acme.code-workspace'],
      });
      assert.equal(calls.length, 1);
      assert.equal(calls[0].cmd, 'osascript');
      assert.deepEqual(calls[0].args.slice(0, 3), ['-l', 'JavaScript', '-e']);
      for (const bit of ['NSOpenPanel', 'setCanChooseFiles(true)', 'setCanChooseDirectories(true)',
        'setAllowsMultipleSelection(true)', "setAllowedFileTypes($(['code-workspace']))"]) {
        assert.ok(calls[0].args[3].includes(bit), `the panel script has ${bit}`);
      }
    } },
    { name: 'darwin: an empty answer is a cancel', run: async () => {
      _testing.reset();
      _testing.set({ platform: 'darwin', env: {} });
      runner({ ok: true, stdout: '\n', stderr: '', code: 0, timedOut: false });
      assert.deepEqual(await pickFolderNative({ purpose: 'repos', multiple: true }), { status: 'canceled' });
    } },
    { name: 'darwin: a non-cancel failure falls back to the folders-only choose folder dialog', run: async () => {
      _testing.reset();
      const calls = [];
      _testing.set({ platform: 'darwin', env: {}, runner: async (cmd, args) => {
        calls.push({ cmd, args });
        return calls.length === 1
          ? { ok: false, stdout: '', stderr: 'execution error: Error: TypeError: undefined is not an object (-2700)', code: 1, timedOut: false }
          : { ok: true, stdout: '/Users/me/dev/api\n', stderr: '', code: 0, timedOut: false };
      } });
      assert.deepEqual(await pickFolderNative({ purpose: 'repos', multiple: true }), { status: 'picked', path: '/Users/me/dev/api', paths: ['/Users/me/dev/api'] });
      assert.equal(calls.length, 2);
      assert.ok(calls[1].args.includes('set picked to (choose folder with prompt "Select repositories or a folder of repositories" with multiple selections allowed)'));
    } },
    { name: 'darwin: a timed-out panel is unsupported, and no second dialog opens', run: async () => {
      _testing.reset();
      _testing.set({ platform: 'darwin', env: {} });
      const calls = runner({ ok: false, stdout: '', stderr: 'dialog timed out', code: -1, timedOut: true });
      assert.deepEqual(await pickFolderNative({ purpose: 'repos', multiple: true }), { status: 'unsupported' });
      assert.equal(calls.length, 1);
    } },
    { name: 'linux: zenity folder multi-select titled for the wizard', run: async () => {
      _testing.reset();
      _testing.set({ platform: 'linux', env: { DISPLAY: ':0' } });
      const calls = runner({ ok: true, stdout: '/home/me/api\n/home/me/web\n', stderr: '', code: 0, timedOut: false });
      assert.deepEqual(await pickFolderNative({ purpose: 'repos', multiple: true }), { status: 'picked', path: '/home/me/api', paths: ['/home/me/api', '/home/me/web'] });
      assert.deepEqual(calls[0].args, ['--file-selection', '--directory', '--title=Select repositories or a folder of repositories', '--multiple', '--separator=\n']);
    } },
  ]);
});

test('the macOS repositories panel script compiles (osacompile only: nothing is shown)', { skip: process.platform !== 'darwin' && 'macOS only' }, async () => {
  _testing.set({ platform: 'darwin', env: {} });
  const calls = runner({ ok: true, stdout: '\n', stderr: '', code: 0, timedOut: false });
  await pickFolderNative({ purpose: 'repos', multiple: true });
  const dir = mkdtempSync(join(tmpdir(), 'worca-cc-jxa-'));
  try {
    const r = spawnSync('osacompile', ['-l', 'JavaScript', '-o', join(dir, 'pick.scpt'), '-e', calls[0].args[3]], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── Browse… for Settings › Runs › Actions › Editor / Terminal: pickAppNative ──

test('pickAppNative darwin: choose application as alias; the .app path comes back without its trailing slash', async () => {
  _testing.set({ platform: 'darwin', env: {} });
  const calls = runner({ ok: true, stdout: '/Applications/Zed.app/\n', stderr: '', code: 0, timedOut: false });
  assert.deepEqual(await pickAppNative({ kind: 'editor' }), { status: 'picked', path: '/Applications/Zed.app' });
  assert.equal(calls[0].cmd, 'osascript');
  assert.ok(calls[0].args.includes('POSIX path of (choose application with prompt "Select your editor or IDE" as alias)'));
});

test('pickAppNative: cancel, no GUI, busy, WORCA_NO_NATIVE_DIALOG, and the title comes from a closed set', async () => {
  _testing.set({ platform: 'darwin', env: {} });
  runner({ ok: false, stdout: '', stderr: 'execution error: User canceled. (-128)', code: 1, timedOut: false });
  assert.deepEqual(await pickAppNative({ kind: 'terminal' }), { status: 'canceled' });
  runner({ ok: false, stdout: '', stderr: 'no window server', code: 1, timedOut: false });
  assert.deepEqual(await pickAppNative({ kind: 'editor' }), { status: 'unsupported' });
  _testing.set({ platform: 'darwin', env: { WORCA_NO_NATIVE_DIALOG: '1' } });
  assert.deepEqual(await pickAppNative({ kind: 'editor' }), { status: 'unsupported' });
  _testing.set({ platform: 'darwin', env: {} });
  let release;
  _testing.set({ runner: () => new Promise((r) => { release = () => r({ ok: true, stdout: '/Applications/A.app/\n', stderr: '', code: 0 }); }) });
  const first = pickAppNative({ kind: 'editor' });
  assert.deepEqual(await pickAppNative({ kind: 'editor' }), { status: 'busy' });
  release();
  assert.equal((await first).status, 'picked');
  const seen = runner({ ok: false, stdout: '', stderr: '(-128)', code: 1 });
  await pickAppNative({ kind: '"; do shell script "x' });
  assert.ok(seen[0].args.some((a) => a.includes('"Select your editor or IDE"')), 'unknown kind: the editor title, never caller text');
});

test('pickAppNative win32: OpenFileDialog for programs from Program Files; empty output is a cancel', async () => {
  _testing.set({ platform: 'win32', env: {} });
  const calls = runner({ ok: true, stdout: 'C:\\Program Files\\Git\\git-bash.exe\r\n', stderr: '', code: 0 });
  assert.deepEqual(await pickAppNative({ kind: 'terminal' }), { status: 'picked', path: 'C:\\Program Files\\Git\\git-bash.exe' });
  assert.equal(calls[0].cmd, 'powershell.exe');
  const script = calls[0].args.at(-1);
  assert.match(script, /OpenFileDialog/);
  assert.match(script, /\*\.exe;\*\.cmd;\*\.bat/);
  assert.match(script, /InitialDirectory = \$env:ProgramFiles/);
  assert.match(script, /'Select your terminal app'/);
  runner({ ok: true, stdout: '\r\n', stderr: '', code: 0 });
  assert.deepEqual(await pickAppNative({ kind: 'terminal' }), { status: 'canceled' });
});

test('pickAppNative linux: headless is unsupported; zenity picks a file, kdialog is the fallback', async () => {
  _testing.set({ platform: 'linux', env: {} });
  assert.deepEqual(await pickAppNative({ kind: 'editor' }), { status: 'unsupported' });
  _testing.set({ platform: 'linux', env: { DISPLAY: ':0' } });
  const calls = runner({ ok: true, stdout: '/usr/bin/kate\n', stderr: '', code: 0 });
  assert.deepEqual(await pickAppNative({ kind: 'editor' }), { status: 'picked', path: '/usr/bin/kate' });
  assert.equal(calls[0].cmd, 'zenity');
  assert.ok(!calls[0].args.includes('--directory'), 'a file, not a folder');
});
