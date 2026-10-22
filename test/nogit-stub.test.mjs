// test/nogit-stub.test.mjs — SEAMS S6: darwin without git puts worca's git stub first on every engine spawn's PATH;
// Linux / Windows and darwin with git get nothing. The platform is injected, so every row runs on every host.
import { test, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync, existsSync, writeFileSync, chmodSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { checkRows } from './helpers/rows.mjs';
import { useTempHome } from './helpers/temp-home.mjs';
import { withNoGit } from './helpers/git-off.mjs';
import { _testing as cap } from '../src/core/git-available.mjs';
import { NOGIT_STUB, noGitBinDir, ensureNoGitStub, withNoGitPath, _testing as stub } from '../src/core/nogit-stub.mjs';
import { composeSpawnEnv } from '../src/core/engines/spawn.mjs';
import { scriptBaseEnv } from '../src/core/graph/script-runner.mjs';
import { terminalEnv } from '../src/core/terminal/context.mjs';
import { actionBaseEnv } from '../src/core/actions/spawn.mjs';
import { probeClaudeCapabilities } from '../src/core/preflight.mjs';

const home = useTempHome(after);
afterEach(() => stub.setPlatform(null));

test('the no-git stub', async (t) => {
  withNoGit(t);
  await checkRows([
    { name: 'darwin without git: <worcaHome>/nogit-bin/git, 755, idempotent', run: () => {
      const dir = ensureNoGitStub({ home, platform: 'darwin', available: false });
      assert.equal(dir, join(home, 'nogit-bin'));
      assert.equal(dir, noGitBinDir(home));
      assert.equal(readFileSync(join(dir, 'git'), 'utf8'), NOGIT_STUB);
      assert.equal(NOGIT_STUB, '#!/bin/sh\necho "git is not installed on this machine" >&2\nexit 127\n');
      if (process.platform !== 'win32') assert.equal(statSync(join(dir, 'git')).mode & 0o777, 0o755);
      const before = statSync(join(dir, 'git')).mtimeMs;
      assert.equal(ensureNoGitStub({ home, platform: 'darwin', available: false }), dir);
      assert.equal(statSync(join(dir, 'git')).mtimeMs, before, 'unchanged content is not rewritten');
    } },
    { name: 'Linux, Windows, and darwin with git: no stub, the env is untouched', run: () => {
      const other = join(home, 'elsewhere');
      for (const [platform, available] of [['linux', false], ['win32', false], ['darwin', true]]) {
        assert.equal(ensureNoGitStub({ home: other, platform, available }), null, platform);
        const env = { PATH: '/usr/bin:/bin' };
        assert.equal(withNoGitPath(env, { home: other, platform, available }), env, platform);
      }
      assert.equal(existsSync(join(other, 'nogit-bin')), false);
    } },
    { name: 'a process that never probed adds no stub on darwin (git may well be installed)', run: () => {
      const saved = process.env.WORCA_GIT; delete process.env.WORCA_GIT; cap.reset();
      try {
        stub.setPlatform('darwin');
        const env = { PATH: '/usr/bin:/bin' };
        assert.equal(withNoGitPath(env), env);
      } finally { process.env.WORCA_GIT = saved; cap.set({ available: false }); }
    } },
    { name: 'darwin without git: the stub dir leads PATH', run: () => {
      const env = withNoGitPath({ PATH: '/usr/bin:/bin', HOME: '/h' }, { home, platform: 'darwin', available: false });
      assert.deepEqual(env, { PATH: `${join(home, 'nogit-bin')}:/usr/bin:/bin`, HOME: '/h' });
    } },
    { name: 'composeSpawnEnv (every engine, runs and Ask turns) carries it while git is missing on darwin', run: () => {
      stub.setPlatform('darwin');
      assert.ok(composeSpawnEnv({}).env.PATH.startsWith(`${noGitBinDir()}:`), 'the default home is worcaHome() = <WORCA_HOME>/.worca-cc');
      stub.setPlatform('linux');
      assert.ok(!String(composeSpawnEnv({}).env.PATH).includes('nogit-bin'));
    } },
    { name: 'worca terminal (S66): run_command / agent terminals / launchers carry it once on darwin; Linux unchanged', run: () => {
      const dir = noGitBinDir();
      stub.setPlatform('darwin');
      const term = terminalEnv({ base: { PATH: '/usr/bin:/bin' }, sessionId: 's', mode: 'pipes', cwd: '/x', agent: true });
      assert.equal(term.PATH, `${dir}:/usr/bin:/bin`, 'once, though actionBaseEnv already added it');
      assert.ok(actionBaseEnv({ PATH: '/usr/bin' }).PATH.startsWith(`${dir}:`));
      assert.equal(withNoGitPath({ PATH: `${dir}:/usr/bin` }).PATH, `${dir}:/usr/bin`, 'idempotent');
      assert.equal(terminalEnv({ base: { PATH: '/usr/bin' }, shellEnv: { PATH: '/opt/shell:/usr/bin' }, sessionId: 's', mode: 'pty', cwd: '/x' }).PATH,
        `${dir}:/opt/shell:/usr/bin`, 'a shell PATH keeps the stub first');
      stub.setPlatform('linux');
      assert.equal(terminalEnv({ base: { PATH: '/usr/bin:/bin' }, sessionId: 's', mode: 'pipes', cwd: '/x', agent: true }).PATH, '/usr/bin:/bin');
    } },
    { name: 'script nodes (S37): scriptBaseEnv carries it on darwin, scrubbed or not; not on Linux / Windows', run: () => {
      for (const opts of [{}, { envScrub: true, envAllowlist: [] }]) {
        assert.ok(scriptBaseEnv(opts, 'darwin').PATH.startsWith(`${noGitBinDir()}:`), JSON.stringify(opts));
        for (const p of ['linux', 'win32']) assert.ok(!String(scriptBaseEnv(opts, p).PATH ?? scriptBaseEnv(opts, p).Path).includes('nogit-bin'), `${p} ${JSON.stringify(opts)}`);
      }
    } },
    { name: 'preflight claude probes (S66) carry it on darwin, not on Linux', run: async () => {
      if (process.platform === 'win32') return;   // a scripted claude needs a POSIX shell (checkRows ignores skip:)
      const bin = join(home, 'fake-claude');
      // A fixed answer per case: preflight keeps the FIRST x.y.z of the output, so an echoed $PATH breaks on a
      // version-named folder (CI's setup-node /opt/hostedtoolcache/node/22.x.y, nvm, a Homebrew Cellar).
      writeFileSync(bin, '#!/bin/sh\n[ "$1" = "--version" ] || exit 0\ncase ":$PATH:" in *nogit-bin*) echo 9.9.9 ;; *) echo 1.1.1 ;; esac\n'); chmodSync(bin, 0o755);
      stub.setPlatform('darwin');
      assert.equal((await probeClaudeCapabilities(bin)).version, '9.9.9');
      stub.setPlatform('linux');
      assert.equal((await probeClaudeCapabilities(bin)).version, '1.1.1');
    } },
    { name: 'a worca started where the stub leads PATH drops it: its probe and its own git spawns never reach the stub', run: () => {
      if (process.platform === 'win32') return;
      const dir = ensureNoGitStub({ home, platform: 'darwin', available: false });
      const env = { ...process.env, PATH: `${dir}:${process.env.PATH}` }; delete env.WORCA_GIT;
      const mod = new URL('../src/core/git-available.mjs', import.meta.url).href;
      const r = spawnSync(process.execPath, ['--input-type=module', '-e',
        `const g = await import(${JSON.stringify(mod)}); const s = await g.gitState(); console.log(JSON.stringify([process.env.PATH.includes('nogit-bin'), String(s.path).includes('nogit-bin')]));`],
        { env, encoding: 'utf8' });
      assert.equal(r.stdout.trim(), '[false,false]', r.stderr);
    } },
    { name: 'POSIX hosts: the stub answers like a missing tool', run: () => {
      if (process.platform === 'win32') return;
      const r = spawnSync(join(noGitBinDir(home), 'git'), ['status'], { encoding: 'utf8' });
      assert.deepEqual([r.status, r.stderr], [127, 'git is not installed on this machine\n']);
    } },
  ]);
});

import { probeClaudeAuth } from '../src/core/preflight.mjs';   // ESM hoists it; the lines above stay byte-identical

test('the no-git stub: the claude auth probe, and a PATH that is empty or spelled Path', async (t) => {
  withNoGit(t);
  await checkRows([
    { name: 'claude auth status (S66, execAnyExit) carries it on darwin, not on Linux', run: async () => {
      if (process.platform === 'win32') return;   // a scripted claude needs a POSIX shell (checkRows ignores skip:)
      const bin = join(home, 'fake-claude-auth');
      writeFileSync(bin, '#!/bin/sh\ncase ":$PATH:" in *nogit-bin*) echo \'{"loggedIn":true}\' ;; *) echo \'{"loggedIn":false}\' ;; esac\n'); chmodSync(bin, 0o755);
      stub.setPlatform('darwin');
      assert.equal((await probeClaudeAuth({ bin, env: {}, mock: false, force: true })).state, 'signed-in');
      stub.setPlatform('linux');
      assert.equal((await probeClaudeAuth({ bin, env: {}, mock: false, force: true })).state, 'signed-out');
    } },
    { name: 'no PATH: the stub dir alone (no trailing ":", which would put the cwd on PATH); a Path key is read', run: () => {
      const dir = join(home, 'nogit-bin');
      assert.equal(withNoGitPath({ HOME: '/h' }, { home, platform: 'darwin', available: false }).PATH, dir);
      assert.equal(withNoGitPath({ Path: '/usr/bin' }, { home, platform: 'darwin', available: false }).PATH, `${dir}:/usr/bin`);
    } },
  ]);
});

import { mkdtempSync, rmSync } from 'node:fs';   // ESM hoists it; the lines above stay byte-identical
import { tmpdir } from 'node:os';

test('the no-git stub: an unwritable home, a PATH that is the stub dir alone, a stub without its exec bit', async (t) => {
  withNoGit(t);
  const made = [];
  t.after(() => { for (const d of made) { chmodSync(d, 0o755); rmSync(d, { recursive: true, force: true }); } });
  await checkRows([
    { name: 'a home the stub cannot be written to answers null, and the spawn env goes out unchanged', run: () => {
      if (process.platform === 'win32' || process.getuid?.() === 0) return;   // a mode-555 dir stops neither Windows nor root
      const ro = mkdtempSync(join(tmpdir(), 'worca-p0-rohome-')); made.push(ro); chmodSync(ro, 0o555);
      assert.equal(ensureNoGitStub({ home: ro, platform: 'darwin', available: false }), null);
      const env = { PATH: '/usr/bin:/bin' };
      assert.equal(withNoGitPath(env, { home: ro, platform: 'darwin', available: false }), env);
    } },
    { name: 'a PATH that is the stub dir alone stays as it is (no second entry)', run: () => {
      const env = { PATH: noGitBinDir(home) };
      assert.equal(withNoGitPath(env, { home, platform: 'darwin', available: false }), env);
    } },
    { name: 'a stub with the right content but no exec bit is made executable again (PATH lookup skips a 644 file)', run: () => {
      if (process.platform === 'win32') return;
      const dir = ensureNoGitStub({ home, platform: 'darwin', available: false });
      chmodSync(join(dir, 'git'), 0o644);
      assert.equal(ensureNoGitStub({ home, platform: 'darwin', available: false }), dir);
      assert.equal(statSync(join(dir, 'git')).mode & 0o777, 0o755);
    } },
  ]);
});
