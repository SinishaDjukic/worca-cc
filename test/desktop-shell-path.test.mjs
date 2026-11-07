// test/desktop-shell-path.test.mjs — the login-shell PATH the desktop app hands its server (desktop/src/shell-path.mjs).
// A Dock-launched app gets launchd's short PATH; the server needs the user's tools. execFile is a fake.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PATH_MARK, FALLBACK_DIRS, loginShellCommand, parseLoginShellPath, mergePath, readLoginShellPath } from '../desktop/src/shell-path.mjs';

const M = PATH_MARK;

test('loginShellCommand: an interactive login shell printing PATH between markers', () => {
  const { file, args } = loginShellCommand('/bin/zsh');
  assert.equal(file, '/bin/zsh');
  assert.equal(args[0], '-ilc');
  assert.ok(args[1].includes(PATH_MARK));
  assert.ok(args[1].includes('"$PATH"'));
  assert.ok(FALLBACK_DIRS.includes('/opt/homebrew/bin'));
});

test('parseLoginShellPath: banner + markers, last pair wins, none/empty → null, trimmed, fish output', () => {
  assert.equal(parseLoginShellPath(`Welcome to zsh!\nlast login…\n${M}/usr/bin:/bin${M}\n`), '/usr/bin:/bin');
  assert.equal(parseLoginShellPath(`${M}/echo/of/cmd${M}\n${M}/real:/path${M}\n`), '/real:/path');
  assert.equal(parseLoginShellPath('no markers at all'), null);
  assert.equal(parseLoginShellPath(`${M}only one`), null);
  assert.equal(parseLoginShellPath(`${M}${M}`), null);
  assert.equal(parseLoginShellPath(`${M}   ${M}`), null);
  assert.equal(parseLoginShellPath(`${M}  /a:/b \n${M}`), '/a:/b');
  assert.equal(parseLoginShellPath(`fish greeting\n${M}/Users/u/.local/bin:/opt/homebrew/bin:/usr/bin${M}\n`), '/Users/u/.local/bin:/opt/homebrew/bin:/usr/bin');
  assert.equal(parseLoginShellPath(`${M}/a\n/b${M}`), null, 'never a value holding a newline');
});

test('mergePath: first wins the order, empties and duplicates dropped', () => {
  assert.equal(mergePath('/a:/b', '/b:/c'), '/a:/b:/c');
  assert.equal(mergePath('/a::/a', ':/c:'), '/a:/c');
  assert.equal(mergePath(null, '/x'), '/x');
  assert.equal(mergePath('/x', undefined), '/x');
  assert.equal(mergePath('C:\\a;C:\\b', 'C:\\b;C:\\c', ';'), 'C:\\a;C:\\b;C:\\c');
});

test('readLoginShellPath: win32 → skipped, no execFile call', async () => {
  let calls = 0;
  const r = await readLoginShellPath({ platform: 'win32', env: { PATH: 'C:\\x' }, home: 'C:\\u', execFile: (_f, _a, _o, cb) => { calls++; cb(null, ''); } });
  assert.equal(r.source, 'skipped');
  assert.equal(r.path, null);
  assert.equal(calls, 0);
});

test('readLoginShellPath: darwin, SHELL=/bin/zsh → runs it with -ilc and the marker command → login-shell', async () => {
  const seen = [];
  const execFile = (file, args, opts, cb) => { seen.push({ file, args, opts }); cb(null, `motd\n${M}/opt/homebrew/bin:/usr/bin${M}\n`, ''); };
  const r = await readLoginShellPath({ platform: 'darwin', env: { SHELL: '/bin/zsh', PATH: '/usr/bin' }, home: '/Users/u', execFile, timeoutMs: 5000 });
  assert.deepEqual(r, { path: '/opt/homebrew/bin:/usr/bin', source: 'login-shell' });
  assert.equal(seen[0].file, '/bin/zsh');
  assert.equal(seen[0].args[0], '-ilc');
  assert.ok(seen[0].args[1].includes(PATH_MARK));
  assert.equal(seen[0].opts.timeout, 5000);
  assert.equal(seen[0].opts.env.TERM, 'dumb');
  assert.equal(seen[0].opts.encoding, 'utf8');
});

test('readLoginShellPath: an error, a timeout or no markers → fallback with error, never throws', async () => {
  const env = { SHELL: '/bin/zsh', PATH: '/usr/bin:/bin' };
  const failing = [
    (f, a, o, cb) => cb(Object.assign(new Error('Command failed'), { code: 1 }), '', 'boom'),
    (f, a, o, cb) => cb(Object.assign(new Error('timed out'), { killed: true, signal: 'SIGTERM' }), '', ''),
    (f, a, o, cb) => cb(null, 'no markers', ''),
    () => { throw new Error('spawn EACCES'); },
  ];
  for (const execFile of failing) {
    const r = await readLoginShellPath({ platform: 'darwin', env, home: '/nonexistent-home-xyz', execFile });
    assert.equal(r.source, 'fallback');
    assert.ok(r.error, 'error set');
    assert.ok(r.path.split(':').includes('/usr/bin'), 'inherited PATH kept');
    assert.ok(!r.path.includes('/nonexistent-home-xyz/.local/bin'), 'only fallback dirs that exist');
  }
});

test('readLoginShellPath: a relative SHELL → /bin/zsh on darwin, /bin/sh on linux', async () => {
  const files = [];
  const execFile = (file, a, o, cb) => { files.push(file); cb(null, `${M}/x${M}`, ''); };
  await readLoginShellPath({ platform: 'darwin', env: { SHELL: 'zsh' }, home: '/h', execFile });
  await readLoginShellPath({ platform: 'linux', env: {}, home: '/h', execFile });
  assert.deepEqual(files, ['/bin/zsh', '/bin/sh']);
});
