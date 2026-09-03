// test/folder-dialog.test.mjs
// Unit tests for the native folder dialog wrapper. The runner is injected so
// no real dialog ever opens; platform/env are forced per test.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { pickFolderNative, _testing } from '../src/core/folder-dialog.mjs';

afterEach(() => _testing.reset());

function runner(result) {
  const calls = [];
  _testing.set({ runner: async (cmd, args) => { calls.push({ cmd, args }); return result; } });
  return calls;
}

test('darwin: picked path is trimmed of newline and trailing slash', async () => {
  _testing.set({ platform: 'darwin', env: {} });
  const calls = runner({ ok: true, stdout: '/Users/me/dev/app/\n', stderr: '', code: 0, timedOut: false });
  assert.deepEqual(await pickFolderNative(), { status: 'picked', path: '/Users/me/dev/app' });
  assert.equal(calls[0].cmd, 'osascript');
});

test('darwin: user cancel (-128) maps to canceled', async () => {
  _testing.set({ platform: 'darwin', env: {} });
  runner({ ok: false, stdout: '', stderr: 'execution error: User canceled. (-128)', code: 1, timedOut: false });
  assert.deepEqual(await pickFolderNative(), { status: 'canceled' });
});

test('darwin: non-cancel failure (no GUI session) maps to unsupported', async () => {
  _testing.set({ platform: 'darwin', env: {} });
  runner({ ok: false, stdout: '', stderr: 'execution error: No user interaction allowed. (-1713)', code: 1, timedOut: false });
  assert.deepEqual(await pickFolderNative(), { status: 'unsupported' });
});

test('darwin: picking the filesystem root keeps "/"', async () => {
  _testing.set({ platform: 'darwin', env: {} });
  runner({ ok: true, stdout: '/\n', stderr: '', code: 0, timedOut: false });
  assert.deepEqual(await pickFolderNative(), { status: 'picked', path: '/' });
});

test('win32: empty stdout with ok exit maps to canceled; dialog runs on an STA thread', async () => {
  _testing.set({ platform: 'win32', env: {} });
  const calls = runner({ ok: true, stdout: '', stderr: '', code: 0, timedOut: false });
  assert.deepEqual(await pickFolderNative(), { status: 'canceled' });
  assert.equal(calls[0].cmd, 'powershell.exe');
  assert.ok(calls[0].args.includes('-STA'));
});

test('linux: headless (no DISPLAY/WAYLAND_DISPLAY) is unsupported without spawning', async () => {
  let spawned = 0;
  _testing.set({ platform: 'linux', env: {}, runner: async () => { spawned += 1; return { ok: false, stdout: '', stderr: '', code: -1, timedOut: false }; } });
  assert.deepEqual(await pickFolderNative(), { status: 'unsupported' });
  assert.equal(spawned, 0);
});

test('linux: zenity missing falls back to kdialog', async () => {
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
});

test('linux: zenity exit 1 is a user cancel; kdialog is not tried', async () => {
  const calls = [];
  _testing.set({
    platform: 'linux', env: { DISPLAY: ':0' },
    runner: async (cmd) => { calls.push(cmd); return { ok: false, stdout: '', stderr: '', code: 1, timedOut: false }; },
  });
  assert.deepEqual(await pickFolderNative(), { status: 'canceled' });
  assert.deepEqual(calls, ['zenity']);
});

test('WORCA_NO_NATIVE_DIALOG=1 forces unsupported without spawning', async () => {
  let spawned = 0;
  _testing.set({ platform: 'darwin', env: { WORCA_NO_NATIVE_DIALOG: '1' }, runner: async () => { spawned += 1; return { ok: true, stdout: '/x\n', stderr: '', code: 0, timedOut: false }; } });
  assert.deepEqual(await pickFolderNative(), { status: 'unsupported' });
  assert.equal(spawned, 0);
});

test('a second concurrent pick reports busy', async () => {
  let release;
  _testing.set({ platform: 'darwin', env: {}, runner: () => new Promise((r) => { release = r; }) });
  const first = pickFolderNative();
  assert.deepEqual(await pickFolderNative(), { status: 'busy' });
  release({ ok: true, stdout: '/tmp\n', stderr: '', code: 0, timedOut: false });
  assert.deepEqual(await first, { status: 'picked', path: '/tmp' });
});

test('a timed-out dialog maps to unsupported', async () => {
  _testing.set({ platform: 'darwin', env: {} });
  runner({ ok: false, stdout: '', stderr: 'dialog timed out', code: -1, timedOut: true });
  assert.deepEqual(await pickFolderNative(), { status: 'unsupported' });
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
