// test/git-available.test.mjs — R3 on every OS by injection (the real git and the macOS shim never run),
// WORCA_GIT, the cache / single-flight / flip events, and gitAvailable() before the first probe.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { checkRows } from './helpers/rows.mjs';
import { probeGit, gitState, gitAvailable, currentGitState, onGitChange, GIT_MISSING, gitMissingResult, gitMissingError, gitMissingMessage, BITBUCKET_NEEDS_GIT,
  _testing } from '../src/core/git-available.mjs';
import { withNoGit, gitArrives } from './helpers/git-off.mjs';

afterEach(() => _testing.reset());
const fakeExec = (answers) => {
  const calls = [];
  const exec = async (file, args, { timeoutMs }) => { calls.push([file, args, timeoutMs]); return answers[file] ?? { code: -1, stdout: '', timedOut: false }; };
  return { exec, calls };
};
const only = (paths) => (p) => paths.includes(p);
const same = (p) => p;
const OK = (stdout) => ({ code: 0, stdout, timedOut: false });
const CLT = '/Library/Developer/CommandLineTools';

test('probeGit: R3 on Linux, macOS and Windows', async () => {
  await checkRows([
    { name: 'linux: the first PATH hit, git --version → ok', run: async () => {
      const { exec, calls } = fakeExec({ '/usr/bin/git': OK('git version 2.43.0\n') });
      const s = await probeGit({ env: { PATH: '/usr/local/bin:/usr/bin' }, platform: 'linux', exec, exists: only(['/usr/bin/git']) });
      assert.deepEqual({ ...s, checkedAt: 0 }, { available: true, path: '/usr/bin/git', version: '2.43.0', reason: 'ok', checkedAt: 0 });
      assert.ok(s.checkedAt > 0);
      assert.deepEqual(calls, [['/usr/bin/git', ['--version'], 5000]]);
    } },
    { name: 'linux: nothing on PATH → not-on-path, nothing executed', run: async () => {
      const { exec, calls } = fakeExec({});
      const s = await probeGit({ env: { PATH: '/usr/bin' }, platform: 'linux', exec, exists: only([]) });
      assert.deepEqual([s.available, s.reason, s.path], [false, 'not-on-path', null]);
      assert.equal(calls.length, 0);
    } },
    { name: 'darwin: /usr/bin/git without the Command Line Tools → xcode-clt-missing; /usr/bin/git is never executed', run: async () => {
      const { exec, calls } = fakeExec({ '/usr/bin/xcode-select': { code: 2, stdout: '', timedOut: false } });
      const s = await probeGit({ env: { PATH: '/usr/bin:/bin' }, platform: 'darwin', exec, exists: only(['/usr/bin/git']), realpath: same });
      assert.deepEqual([s.available, s.reason, s.path], [false, 'xcode-clt-missing', '/usr/bin/git']);
      assert.deepEqual(calls, [['/usr/bin/xcode-select', ['-p'], 5000]]);
    } },
    { name: 'darwin: xcode-select names a folder without usr/bin/git → xcode-clt-missing; git never executed', run: async () => {
      const { exec, calls } = fakeExec({ '/usr/bin/xcode-select': OK(`${CLT}\n`) });
      const s = await probeGit({ env: { PATH: '/usr/bin' }, platform: 'darwin', exec, exists: only(['/usr/bin/git']), realpath: same });
      assert.equal(s.reason, 'xcode-clt-missing');
      assert.deepEqual(calls.map((c) => c[0]), ['/usr/bin/xcode-select']);
    } },
    { name: 'darwin: a symlink that resolves to /usr/bin/git is gated the same way', run: async () => {
      const { exec, calls } = fakeExec({ '/usr/bin/xcode-select': { code: 2, stdout: '', timedOut: false } });
      const s = await probeGit({ env: { PATH: '/Users/me/bin:/usr/bin' }, platform: 'darwin', exec,
        exists: only(['/Users/me/bin/git', '/usr/bin/git']), realpath: (p) => (p === '/Users/me/bin/git' ? '/usr/bin/git' : p) });
      assert.equal(s.reason, 'xcode-clt-missing');
      assert.deepEqual(calls.map((c) => c[0]), ['/usr/bin/xcode-select']);
    } },
    { name: 'darwin: a PATH spelled in another case (/USR/BIN on case-insensitive APFS) reaches the shim and is gated the same way', run: async () => {
      const { exec, calls } = fakeExec({ '/usr/bin/xcode-select': { code: 2, stdout: '', timedOut: false } });
      const s = await probeGit({ env: { PATH: '/USR/BIN:/bin' }, platform: 'darwin', exec, exists: only(['/USR/BIN/git']), realpath: same });
      assert.deepEqual([s.available, s.reason], [false, 'xcode-clt-missing']);
      assert.deepEqual(calls.map((c) => c[0]), ['/usr/bin/xcode-select']);
    } },
    { name: 'darwin: CLT present → xcode-select first, then /usr/bin/git --version', run: async () => {
      const { exec, calls } = fakeExec({ '/usr/bin/xcode-select': OK(`${CLT}\n`), '/usr/bin/git': OK('git version 2.39.5 (Apple Git-154)\n') });
      const s = await probeGit({ env: { PATH: '/usr/bin' }, platform: 'darwin', exec, exists: only(['/usr/bin/git', `${CLT}/usr/bin/git`]), realpath: same });
      assert.deepEqual([s.available, s.version, s.reason], [true, '2.39.5', 'ok']);
      assert.deepEqual(calls.map((c) => c[0]), ['/usr/bin/xcode-select', '/usr/bin/git']);
    } },
    { name: 'darwin: Homebrew git before /usr/bin runs directly; xcode-select is not asked', run: async () => {
      const { exec, calls } = fakeExec({ '/opt/homebrew/bin/git': OK('git version 2.47.0\n') });
      const s = await probeGit({ env: { PATH: '/opt/homebrew/bin:/usr/bin' }, platform: 'darwin', exec,
        exists: only(['/opt/homebrew/bin/git', '/usr/bin/git']), realpath: same });
      assert.deepEqual([s.available, s.path], [true, '/opt/homebrew/bin/git']);
      assert.deepEqual(calls.map((c) => c[0]), ['/opt/homebrew/bin/git']);
    } },
    { name: 'win32: PATHEXT lookup finds git.exe (CRLF output); a git.cmd-only folder does not count', run: async () => {
      const exe = 'C:\\Program Files\\Git\\cmd\\git.exe';
      const { exec } = fakeExec({ [exe]: OK('git version 2.47.1.windows.1\r\n') });
      const env = { Path: 'C:\\Tools;C:\\Program Files\\Git\\cmd', PATHEXT: '.COM;.EXE;.BAT;.CMD' };
      const s = await probeGit({ env, platform: 'win32', exec, exists: only(['C:\\Tools\\git.cmd', exe]) });
      assert.deepEqual([s.available, s.path, s.version], [true, exe, '2.47.1.windows.1']);
      const cmdOnly = await probeGit({ env, platform: 'win32', exec, exists: only(['C:\\Tools\\git.cmd']) });
      assert.deepEqual([cmdOnly.available, cmdOnly.reason], [false, 'not-on-path']);
    } },
    { name: 'win32: a quoted PATH entry is searched unquoted, as libuv does', run: async () => {
      const exe = 'C:\\Program Files\\Git\\cmd\\git.exe';
      const { exec } = fakeExec({ [exe]: OK('git version 2.47.1.windows.1\r\n') });
      const s = await probeGit({ env: { Path: 'C:\\Windows;"C:\\Program Files\\Git\\cmd"' }, platform: 'win32', exec, exists: only([exe]) });
      assert.deepEqual([s.available, s.path], [true, exe]);
    } },
    { name: '--version failing, unparseable or timing out → probe-failed', run: async () => {
      for (const ans of [{ code: 1, stdout: '', timedOut: false }, OK('hello\n'), { code: -1, stdout: '', timedOut: true }]) {
        const { exec } = fakeExec({ '/usr/bin/git': ans });
        const s = await probeGit({ env: { PATH: '/usr/bin' }, platform: 'linux', exec, exists: only(['/usr/bin/git']) });
        assert.deepEqual([s.available, s.reason, s.path], [false, 'probe-failed', '/usr/bin/git']);
      }
    } },
    { name: 'WORCA_GIT=0 → forced-off, =1 → forced-on; neither looks anything up nor runs anything', run: async () => {
      const { exec, calls } = fakeExec({});
      const look = () => { throw new Error('no lookup'); };
      const off = await probeGit({ env: { WORCA_GIT: '0', PATH: '/usr/bin' }, platform: 'darwin', exec, findOnPath: look });
      const on = await probeGit({ env: { WORCA_GIT: '1' }, platform: 'linux', exec, findOnPath: look });
      assert.deepEqual([off.available, off.reason, on.available, on.reason, on.version], [false, 'forced-off', true, 'forced-on', null]);
      assert.equal(calls.length, 0);
    } },
  ]);
});

test('gitAvailable, gitState, onGitChange, GIT_MISSING, the git-off helper', async (t) => {
  // These rows exercise the stored / probed state, so the suite's WORCA_GIT=1 is lifted for this test only.
  const saved = process.env.WORCA_GIT; delete process.env.WORCA_GIT;
  t.after(() => { if (saved === undefined) delete process.env.WORCA_GIT; else process.env.WORCA_GIT = saved; _testing.reset(); });
  await checkRows([
    { name: 'false before the first probe; WORCA_GIT is read on every call and wins over the cache (S1)', run: async () => {
      assert.equal(gitAvailable(), false);
      assert.equal(currentGitState().reason, 'not-probed');
      process.env.WORCA_GIT = '1';
      assert.equal(gitAvailable(), true);
      assert.equal(currentGitState().reason, 'forced-on');
      _testing.set({ available: false });
      assert.equal(gitAvailable(), true, '1 wins over a stored false');
      process.env.WORCA_GIT = '0'; _testing.set({ available: true });
      assert.equal(gitAvailable(), false, '0 wins over a stored true');
      let n = 0; _testing.useProbe(async () => { n += 1; return { available: true, path: '/g', version: '2', reason: 'ok', checkedAt: Date.now() }; });
      assert.equal((await gitState({ fresh: true })).reason, 'forced-off'); assert.equal(n, 0, 'no probe while forced');
      delete process.env.WORCA_GIT;
      assert.equal(gitAvailable(), true, 'the stored state again');
    } },
    { name: 'withNoGit / gitArrives (test/helpers/git-off.mjs): off while held, restored after; arriving fires listeners', run: () => {
      _testing.reset();
      const seen = []; const off = onGitChange((s) => seen.push(s.available));
      const restore = withNoGit();
      try {
        assert.deepEqual([gitAvailable(), process.env.WORCA_GIT], [false, '0']);
        const arrived = gitArrives();
        assert.deepEqual([gitAvailable(), process.env.WORCA_GIT, arrived.version, arrived.reason], [true, '1', '2.43.0', 'ok']);
        assert.equal(currentGitState().reason, 'forced-on', 'WORCA_GIT=1 wins: the env answer, not the stored one');
      } finally { restore(); off(); }
      assert.equal(process.env.WORCA_GIT, undefined);
      assert.deepEqual(seen, [true]);
    } },
    { name: 'single-flight, cached for maxAgeMs, fresh and maxAgeMs:0 re-probe', run: async () => {
      let n = 0; let open; const gate = new Promise((r) => { open = r; });
      _testing.set({ available: false, checkedAt: 1 });            // stale: older than any maxAgeMs below
      _testing.useProbe(async () => { n += 1; await gate; return { available: true, path: '/g', version: '2.0', reason: 'ok', checkedAt: Date.now() }; });
      const both = Promise.all([gitState(), gitState({ fresh: true })]);
      open(); const [a, b] = await both;
      assert.equal(n, 1, 'two concurrent callers share one probe');
      assert.deepEqual([a.available, b.available], [true, true]);
      await gitState(); assert.equal(n, 1, 'inside 60 s: the cache');
      await gitState({ maxAgeMs: 0 }); assert.equal(n, 2);
      await gitState({ fresh: true }); assert.equal(n, 3);
    } },
    { name: 'onGitChange fires once per flip (set and probe both), unsubscribe stops it', run: async () => {
      _testing.reset();
      const seen = []; const off = onGitChange((s) => seen.push(s.available));
      _testing.set({ available: true }); _testing.set({ available: true }); _testing.set({ available: false });
      _testing.useProbe(async () => ({ available: true, path: '/g', version: '2.1', reason: 'ok', checkedAt: Date.now() }));
      await gitState({ fresh: true });
      off(); _testing.set({ available: false });
      assert.deepEqual(seen, [true, false, true]);
    } },
    { name: '_testing.set fills a whole state from available', run: () => {
      assert.deepEqual({ ..._testing.set({ available: false }), checkedAt: 0 }, { available: false, path: null, version: null, reason: 'forced-off', checkedAt: 0 });
      assert.equal(_testing.set({ available: true, version: '2.43.0' }).reason, 'forced-on');
    } },
    { name: 'GIT_MISSING and its two shapes', run: () => {
      assert.deepEqual(GIT_MISSING, { code: 'GIT_MISSING', message: 'git is not installed on this machine' });
      assert.deepEqual(gitMissingResult(), { ok: false, stdout: '', stderr: 'git is not installed on this machine', code: -1 });
      assert.equal(gitMissingMessage('bitbucket.org/acme/api'), BITBUCKET_NEEDS_GIT);
      assert.equal(gitMissingMessage('git@bitbucket.org:acme/api.git'), BITBUCKET_NEEDS_GIT);
      assert.equal(gitMissingMessage('gitlab.com/acme/api'), GIT_MISSING.message);
      assert.equal(gitMissingMessage('acme/bitbucket.org-mirror'), GIT_MISSING.message);
      assert.equal(gitMissingMessage('https://github.com/acme/bitbucket.org'), GIT_MISSING.message, 'a path segment is not the host');
      assert.equal(gitMissingMessage('https://evilbitbucket.org/a/b'), GIT_MISSING.message);
      assert.equal(gitMissingMessage('ssh://git@altssh.bitbucket.org:443/acme/api.git'), BITBUCKET_NEEDS_GIT);
      assert.equal(gitMissingError().message, GIT_MISSING.message);
      const e = gitMissingError();
      assert.deepEqual([e.message, e.code], ['git is not installed on this machine', 'GIT_MISSING']);
    } },
  ]);
});

test('probeGit and gitState edges', async (t) => {
  const saved = process.env.WORCA_GIT; delete process.env.WORCA_GIT;
  t.after(() => { if (saved === undefined) delete process.env.WORCA_GIT; else process.env.WORCA_GIT = saved; _testing.reset(); });
  await checkRows([
    { name: 'darwin: xcode-select failing while it prints a folder that has usr/bin/git → xcode-clt-missing; git never executed', run: async () => {
      const { exec, calls } = fakeExec({ '/usr/bin/xcode-select': { code: 2, stdout: `${CLT}\n`, timedOut: false } });
      const s = await probeGit({ env: { PATH: '/usr/bin' }, platform: 'darwin', exec, exists: only(['/usr/bin/git', `${CLT}/usr/bin/git`]), realpath: same });
      assert.equal(s.reason, 'xcode-clt-missing');
      assert.deepEqual(calls.map((c) => c[0]), ['/usr/bin/xcode-select']);
    } },
    { name: 'a probe that throws reads as missing (probe-failed)', run: async () => {
      _testing.useProbe(async () => { throw new Error('boom'); });
      const s = await gitState({ fresh: true });
      assert.deepEqual([s.available, s.reason, gitAvailable()], [false, 'probe-failed', false]);
    } },
  ]);
});
