// test/bitbucket-credentials.test.mjs
// src/core/bitbucket-credentials.mjs: worca's own Bitbucket calls get the token for their role, per call, through a
// credential helper scoped to https://bitbucket.org (git) or a header (REST); no other host and no child ever gets one.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { BITBUCKET_CREDENTIAL_KEYS, readBitbucketCredentials, stripBitbucketCredentials, bitbucketEnv, bitbucketAuthHeader,
  BB_HELPER_KEY, BB_GIT_CREDENTIAL_HELPER } from '../src/core/bitbucket-credentials.mjs';
import { checkRows } from './helpers/rows.mjs';

test('readBitbucketCredentials / bitbucketEnv / bitbucketAuthHeader', async () => {
  await checkRows([
    { name: 'modes and kinds', run: () => {
      assert.deepEqual(readBitbucketCredentials({}), { mode: 'none', read: null, write: null, email: null, kind: null });
      assert.deepEqual(readBitbucketCredentials({ WORCA_BB_TOKEN: ' t ' }), { mode: 'single', read: 't', write: 't', email: null, kind: 'access-token' });
      assert.deepEqual(readBitbucketCredentials({ WORCA_BB_READ_TOKEN: 'r', WORCA_BB_WRITE_TOKEN: 'w', WORCA_BB_EMAIL: 'me@acme.com' }),
        { mode: 'split', read: 'r', write: 'w', email: 'me@acme.com', kind: 'api-token' });
      assert.deepEqual(readBitbucketCredentials({ WORCA_BB_TOKEN: 't', WORCA_BB_WRITE_TOKEN: 'w' }).read, 't');
    } },
    { name: 'bitbucketEnv layers the helper after existing GIT_CONFIG entries and strips every host credential', run: () => {
      const env = bitbucketEnv('write', { PATH: '/bin', GH_TOKEN: 'g', WORCA_ADO_TOKEN: 'a', WORCA_BB_READ_TOKEN: 'r', WORCA_BB_WRITE_TOKEN: 'w',
        GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'core.hooksPath', GIT_CONFIG_VALUE_0: '/dev/null' });
      assert.equal(env.GH_TOKEN, undefined);
      assert.equal(env.WORCA_ADO_TOKEN, undefined);
      assert.equal(env.WORCA_BB_READ_TOKEN, undefined);
      assert.equal(env.WORCA_BB_WRITE_TOKEN, undefined);
      assert.equal(env.WORCA_BB_GIT_TOKEN, 'w');
      assert.equal(env.WORCA_BB_GIT_USER, 'x-token-auth');
      assert.equal(env.GIT_CONFIG_KEY_0, 'core.hooksPath');
      assert.equal(env.GIT_CONFIG_COUNT, '3');
      assert.deepEqual([[env.GIT_CONFIG_KEY_1, env.GIT_CONFIG_VALUE_1], [env.GIT_CONFIG_KEY_2, env.GIT_CONFIG_VALUE_2]],
        [[BB_HELPER_KEY, ''], [BB_HELPER_KEY, BB_GIT_CREDENTIAL_HELPER]]);
      assert.equal(bitbucketEnv('read', { WORCA_BB_TOKEN: 't', WORCA_BB_EMAIL: 'me@acme.com' }).WORCA_BB_GIT_USER, 'x-bitbucket-api-token-auth');
    } },
    { name: 'no token: stripped env, no helper', run: () => {
      const env = bitbucketEnv('read', { PATH: '/bin', WORCA_BB_EMAIL: 'me@acme.com' });
      assert.deepEqual(env, { PATH: '/bin' });
    } },
    { name: 'auth header: Bearer for an access token, Basic email:token for an API token, by role', run: () => {
      assert.equal(bitbucketAuthHeader('read', {}), null);
      assert.deepEqual(bitbucketAuthHeader('read', { WORCA_BB_TOKEN: 'tok' }), { authorization: 'Bearer tok' });
      assert.deepEqual(bitbucketAuthHeader('write', { WORCA_BB_READ_TOKEN: 'r', WORCA_BB_WRITE_TOKEN: 'w', WORCA_BB_EMAIL: 'me@acme.com' }),
        { authorization: `Basic ${Buffer.from('me@acme.com:w').toString('base64')}` });
    } },
    { name: 'strip list', run: () => {
      const all = Object.fromEntries(BITBUCKET_CREDENTIAL_KEYS.map((k) => [k, 'x']));
      assert.deepEqual(stripBitbucketCredentials({ ...all, KEEP: '1' }), { KEEP: '1' });
    } },
  ]);
});

// The helper is a POSIX shell function: skip on Windows, as azure-credentials.test.mjs does.
const POSIX = { skip: process.platform === 'win32' ? 'the helper is a POSIX shell function' : false };
const fill = (env, input) => spawnSync('git', ['credential', 'fill'], { input, env, encoding: 'utf8' });
const gitEnv = (extra) => ({ ...bitbucketEnv('read', { PATH: process.env.PATH, HOME: process.env.HOME, ...extra }),
  GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: '', SSH_ASKPASS: '' });

test('git answers a bitbucket.org credential prompt from the helper, with the token kind\'s user name', POSIX, () => {
  const access = fill(gitEnv({ WORCA_BB_TOKEN: 'bbtok123' }), 'protocol=https\nhost=bitbucket.org\nusername=jdoe\n\n');
  assert.equal(access.status, 0, access.stderr);
  assert.match(access.stdout, /^password=bbtok123$/m);
  assert.match(access.stdout, /^username=x-token-auth$/m, 'the helper\'s user wins over the one in the remote URL');
  const api = fill(gitEnv({ WORCA_BB_TOKEN: 'bbtok123', WORCA_BB_EMAIL: 'me@acme.com' }), 'protocol=https\nhost=bitbucket.org\n\n');
  assert.match(api.stdout, /^username=x-bitbucket-api-token-auth$/m);
});

test('the Bitbucket token is never answered for another host', POSIX, () => {
  for (const host of ['github.com', 'api.bitbucket.org', 'bitbucket.org.evil.io', 'dev.azure.com']) {
    const r = fill(gitEnv({ WORCA_BB_TOKEN: 'bbtok123' }), `protocol=https\nhost=${host}\n\n`);
    assert.doesNotMatch(r.stdout || '', /bbtok123/, host);
  }
});
