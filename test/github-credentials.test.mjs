// test/github-credentials.test.mjs
// src/core/github-credentials.mjs: no agent gets a GitHub credential; worca's own
// git/gh calls get the one for their role, per call, through a credential helper.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  GITHUB_CREDENTIAL_KEYS, stripGithubCredentials, readGithubCredentials, credentialEnv,
} from '../src/core/github-credentials.mjs';

const POSIX = { skip: process.platform === 'win32' ? 'the helper is a POSIX shell function' : false };

test('stripGithubCredentials removes every credential variable and nothing else', () => {
  const env = { PATH: '/bin', HOME: '/h', ANTHROPIC_API_KEY: 'a' };
  for (const k of GITHUB_CREDENTIAL_KEYS) env[k] = 'secret';
  assert.deepEqual(stripGithubCredentials(env), { PATH: '/bin', HOME: '/h', ANTHROPIC_API_KEY: 'a' });
  assert.equal(env.GH_TOKEN, 'secret', 'the input is not mutated');
});

test('readGithubCredentials: none, single, split, and split falling back to the single token', () => {
  assert.deepEqual(readGithubCredentials({}), { mode: 'none', read: null, write: null });
  assert.deepEqual(readGithubCredentials({ GH_TOKEN: 'g' }), { mode: 'single', read: 'g', write: 'g' });
  assert.deepEqual(readGithubCredentials({ GITHUB_TOKEN: 'h' }), { mode: 'single', read: 'h', write: 'h' });
  assert.deepEqual(readGithubCredentials({ WORCA_GH_READ_TOKEN: 'r', WORCA_GH_WRITE_TOKEN: 'w', GH_TOKEN: 'g' }),
    { mode: 'split', read: 'r', write: 'w' });
  assert.deepEqual(readGithubCredentials({ WORCA_GH_READ_TOKEN: 'r', GH_TOKEN: 'g' }), { mode: 'split', read: 'r', write: 'g' });
  assert.deepEqual(readGithubCredentials({ WORCA_GH_READ_TOKEN: 'r' }), { mode: 'split', read: 'r', write: null });
  assert.deepEqual(readGithubCredentials({ GH_TOKEN: '  ' }), { mode: 'none', read: null, write: null });
});

test('credentialEnv: the role\'s token only, as GH_TOKEN and a github.com helper appended to GIT_CONFIG_*', () => {
  const base = { PATH: '/bin', WORCA_GH_READ_TOKEN: 'r', WORCA_GH_WRITE_TOKEN: 'w', GITHUB_TOKEN: 'x',
    GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'core.hooksPath', GIT_CONFIG_VALUE_0: '/nohooks' };
  const read = credentialEnv('read', base);
  assert.equal(read.GH_TOKEN, 'r');
  assert.equal(read.WORCA_GIT_TOKEN, 'r');
  for (const k of ['WORCA_GH_READ_TOKEN', 'WORCA_GH_WRITE_TOKEN', 'GITHUB_TOKEN']) assert.equal(read[k], undefined, k);
  assert.equal(read.GIT_CONFIG_COUNT, '3');
  assert.equal(read.GIT_CONFIG_KEY_0, 'core.hooksPath', 'the caller\'s config is kept');
  assert.equal(read.GIT_CONFIG_KEY_1, 'credential.https://github.com.helper');
  assert.equal(read.GIT_CONFIG_VALUE_1, '', 'first clears the user\'s helpers');
  assert.match(read.GIT_CONFIG_VALUE_2, /WORCA_GIT_TOKEN/);
  assert.ok(!read.GIT_CONFIG_VALUE_2.includes('r"'), 'the helper reads the variable; the token is not in the config');
  assert.equal(credentialEnv('write', base).GH_TOKEN, 'w');
});

test('credentialEnv with no token: credential-free env, git config untouched', () => {
  const env = credentialEnv('write', { PATH: '/bin', HOME: '/h' });
  assert.deepEqual(env, { PATH: '/bin', HOME: '/h' });
});

test('git uses the role\'s token over a helper in the user\'s config (real git credential fill)', POSIX, () => {
  const dir = mkdtempSync(join(tmpdir(), 'worca-ghcred-'));
  const userCfg = join(dir, 'gitconfig');
  // A user helper that would answer with another account: worca's env must win.
  writeFileSync(userCfg, '[credential "https://github.com"]\n\thelper = "!f() { echo username=someone; echo password=USER-TOKEN; }; f"\n');
  const base = { PATH: process.env.PATH, HOME: dir, GIT_CONFIG_GLOBAL: userCfg, GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0',
    WORCA_GH_READ_TOKEN: 'READ-TOKEN', WORCA_GH_WRITE_TOKEN: 'WRITE-TOKEN' };
  const fill = (env) => spawnSync('git', ['credential', 'fill'], { env, input: 'protocol=https\nhost=github.com\n\n', encoding: 'utf8' });
  const w = fill(credentialEnv('write', base));
  assert.equal(w.status, 0, w.stderr);
  assert.match(w.stdout, /^username=x-access-token$/m);
  assert.match(w.stdout, /^password=WRITE-TOKEN$/m);
  assert.match(fill(credentialEnv('read', base)).stdout, /^password=READ-TOKEN$/m);
  // Another host is not handed the GitHub token.
  const other = spawnSync('git', ['credential', 'fill'], { env: credentialEnv('write', base), input: 'protocol=https\nhost=gitlab.com\n\n', encoding: 'utf8' });
  assert.ok(!/READ-TOKEN|WRITE-TOKEN/.test(other.stdout));
  // Without worca's env the user's own helper answers, exactly as before.
  assert.match(fill(stripGithubCredentials(base)).stdout, /^password=USER-TOKEN$/m);
});
