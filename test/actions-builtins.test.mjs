import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findOnPath, detectBuiltins, builtinLaunch, revealLaunch, copyCommandText } from '../src/core/actions/builtins.mjs';

const fsWith = (files) => (p) => files.includes(p);

test('findOnPath honours PATHEXT on win32', () => {
  const env = { Path: 'C:\\bin;C:\\tools', PATHEXT: '.COM;.EXE;.BAT;.CMD' };
  assert.equal(findOnPath('code', { env, platform: 'win32', exists: fsWith(['C:\\tools\\code.CMD']) }), 'C:\\tools\\code.CMD');
  assert.equal(findOnPath('code', { env: { PATH: '/usr/bin' }, platform: 'linux', exists: fsWith(['/usr/bin/code']) }), '/usr/bin/code');
});

test('macOS: first editor found, Terminal and Finder always', () => {
  const d = detectBuiltins({ platform: 'darwin', env: { PATH: '/usr/local/bin' }, exists: fsWith(['/usr/local/bin/cursor']) });
  assert.deepEqual(d.editor, { id: 'cursor', label: 'Cursor', cmd: '/usr/local/bin/cursor' });
  assert.equal(d.terminal.label, 'Terminal');
  assert.equal(d.fileManager.label, 'Finder');
});

test('headless Linux hides terminal and file manager; override wins for editor', () => {
  const d = detectBuiltins({ platform: 'linux', env: { PATH: '/usr/bin' }, exists: fsWith(['/usr/bin/xdg-open', '/usr/bin/gnome-terminal']), overrides: { editor: 'zed' } });
  assert.equal(d.terminal, null);
  assert.equal(d.fileManager, null);
  assert.deepEqual(d.editor, { label: 'zed', line: 'zed', kind: 'line' }, 'a saved editor is a command line');
  const l = builtinLaunch('editor', '/w/my repo', d, { platform: 'linux', env: {} });
  assert.deepEqual([l.file, l.args], ['/bin/sh', ['-c', "zed '/w/my repo'"]], 'run through the shell, the folder quoted and appended');
});

test('Windows: wt then cmd; code.cmd launches through cmd.exe', () => {
  const d = detectBuiltins({ platform: 'win32', env: { Path: 'C:\\b', PATHEXT: '.EXE;.CMD', ComSpec: 'C:\\W\\cmd.exe' }, exists: fsWith(['C:\\b\\code.CMD']) });
  assert.equal(d.terminal.label, 'Command Prompt');
  const l = builtinLaunch('editor', 'C:\\w\\repo', d, { platform: 'win32', env: { ComSpec: 'C:\\W\\cmd.exe' } });
  assert.equal(l.file, 'C:\\W\\cmd.exe');
  assert.deepEqual(l.args, ['/d', '/s', '/c', '""C:\\b\\code.CMD" "C:\\w\\repo""']);
  assert.equal(l.opts.windowsVerbatimArguments, true);
  const t = builtinLaunch('terminal', 'C:\\w\\repo', d, { platform: 'win32', env: { ComSpec: 'C:\\W\\cmd.exe' } });
  assert.deepEqual(t.args, ['/d', '/s', '/c', 'start "" /D "C:\\w\\repo" cmd.exe']);
  assert.equal(t.opts.windowsVerbatimArguments, true);
});

test('editor target: per-editor argv for a file at a line, folder first; no line drops the line flag', () => {
  const ed = (id) => ({ editor: { id, label: id, cmd: `/bin/${id}` } });
  const t = { file: '/w/repo/src/a.mjs', line: 12 };
  const argv = (id, target) => builtinLaunch('editor', '/w/repo', ed(id), { platform: 'linux', env: {}, target }).args;
  assert.deepEqual(argv('code', t), ['/w/repo', '-g', '/w/repo/src/a.mjs:12']);
  assert.deepEqual(argv('cursor', t), ['/w/repo', '-g', '/w/repo/src/a.mjs:12']);
  assert.deepEqual(argv('code', { file: t.file, line: null }), ['/w/repo', '-g', '/w/repo/src/a.mjs']);
  assert.deepEqual(argv('idea', t), ['/w/repo', '--line', '12', '/w/repo/src/a.mjs']);
  assert.deepEqual(argv('webstorm', t), ['/w/repo', '--line', '12', '/w/repo/src/a.mjs']);
  assert.deepEqual(argv('webstorm', { file: t.file, line: null }), ['/w/repo', '/w/repo/src/a.mjs']);
  assert.deepEqual(argv('code', null), ['/w/repo'], 'no target: the folder only, as today');
  const noId = builtinLaunch('editor', '/w/repo', { editor: { label: 'X', cmd: '/bin/x' } }, { platform: 'linux', env: {}, target: t });
  assert.deepEqual(noId.args, ['/w/repo'], 'an editor without an id opens the folder only');
});

test('editor target: win32 code.cmd carries -g file:line through cmd.exe; a terminal ignores a target; a line editor forwards it', () => {
  const env = { ComSpec: 'C:\\W\\cmd.exe' };
  const d = { editor: { id: 'code', label: 'VS Code', cmd: 'C:\\b\\code.CMD' }, terminal: { label: 'Command Prompt', kind: 'cmd' } };
  const l = builtinLaunch('editor', 'C:\\w\\repo', d, { platform: 'win32', env, target: { file: 'C:\\w\\repo\\a.mjs', line: 12 } });
  assert.deepEqual(l.args, ['/d', '/s', '/c', '""C:\\b\\code.CMD" "C:\\w\\repo" "-g" "C:\\w\\repo\\a.mjs:12""']);
  const plain = builtinLaunch('terminal', 'C:\\w\\repo', d, { platform: 'win32', env });
  const targeted = builtinLaunch('terminal', 'C:\\w\\repo', d, { platform: 'win32', env, target: { file: 'C:\\w\\repo\\a.mjs', line: 1 } });
  assert.deepEqual(targeted, plain);
  const line = { editor: { label: 'subl', line: 'subl {file}:{line}', kind: 'line' } };
  const s = builtinLaunch('editor', '/w/repo', line, { platform: 'linux', env: {}, target: { file: '/w/repo/a.mjs', line: 5 } });
  assert.deepEqual(s.args, ['-c', "subl '/w/repo/a.mjs':5"]);
});

test('copy command: not pushed vs pushed, two lines, never &&', () => {
  assert.equal(copyCommandText({ projectDir: '/p/app', branch: 'worca-cc/x', pushed: null }), 'cd "/p/app"\ngit switch worca-cc/x');
  assert.equal(copyCommandText({ projectDir: '/p/app', branch: 'worca-cc/x', pushed: { remote: 'upstream' } }), 'git fetch upstream worca-cc/x\ngit switch worca-cc/x');
});

test('revealLaunch: Finder and Explorer select the file, a Linux file manager opens its folder, none found throws', () => {
  const mac = detectBuiltins({ platform: 'darwin', env: { PATH: '' }, exists: fsWith([]) });
  assert.deepEqual(revealLaunch('/w/out/home page.png', '/w/out', mac), { file: 'open', args: ['-R', '/w/out/home page.png'], opts: { detached: true, stdio: 'ignore', windowsHide: false } });
  const win = detectBuiltins({ platform: 'win32', env: { Path: '' }, exists: fsWith([]) });
  const w = revealLaunch('C:\\w\\out\\home page.png', 'C:\\w\\out', win);
  assert.deepEqual([w.file, w.args, w.opts.windowsVerbatimArguments], ['explorer.exe', ['/select,"C:\\w\\out\\home page.png"'], true]);
  assert.deepEqual(w.okExitCodes, [0, 1], 'Explorer exits 1 even when it opened');
  const f = builtinLaunch('fileManager', 'C:\\w\\out', win, { platform: 'win32', env: {} });
  assert.deepEqual([f.file, f.args, f.okExitCodes], ['explorer.exe', ['C:\\w\\out'], [0, 1]]);
  const lin = detectBuiltins({ platform: 'linux', env: { PATH: '/usr/bin', DISPLAY: ':0' }, exists: fsWith(['/usr/bin/xdg-open']) });
  assert.deepEqual([revealLaunch('/w/out/a.png', '/w/out', lin).file, revealLaunch('/w/out/a.png', '/w/out', lin).args], ['/usr/bin/xdg-open', ['/w/out']]);
  const headless = detectBuiltins({ platform: 'linux', env: { PATH: '/usr/bin' }, exists: fsWith(['/usr/bin/xdg-open']) });
  assert.throws(() => revealLaunch('/w/out/a.png', '/w/out', headless), (e) => e.code === 'NOT_AVAILABLE');
});
