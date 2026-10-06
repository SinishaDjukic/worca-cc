// test/azure-credentials.test.mjs
// src/core/azure-credentials.mjs: worca's own Azure DevOps calls get the PAT for their role, per call,
// through a credential helper (git) or a Basic header (REST); no child ever gets one.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { AZURE_DEVOPS_CREDENTIAL_KEYS, AZURE_DEVOPS_STRIP_ONLY_KEYS, readAzureCredentials, stripAzureCredentials, azureEnv,
  azureAuthHeader, ADO_HELPER_KEYS } from '../src/core/azure-credentials.mjs';
import { checkRows } from './helpers/rows.mjs';

test('readAzureCredentials / azureEnv / azureAuthHeader', async () => {
  await checkRows([
    { name: 'modes', run: () => {
      assert.deepEqual(readAzureCredentials({}), { mode: 'none', read: null, write: null });
      assert.deepEqual(readAzureCredentials({ WORCA_ADO_TOKEN: ' t ' }), { mode: 'single', read: 't', write: 't' });
      assert.deepEqual(readAzureCredentials({ AZURE_DEVOPS_EXT_PAT: 'x' }), { mode: 'single', read: 'x', write: 'x' });
      assert.equal(readAzureCredentials({ WORCA_ADO_TOKEN: 't', AZURE_DEVOPS_EXT_PAT: 'x' }).read, 't');
      assert.deepEqual(readAzureCredentials({ WORCA_ADO_READ_TOKEN: 'r', WORCA_ADO_WRITE_TOKEN: 'w' }), { mode: 'split', read: 'r', write: 'w' });
      assert.deepEqual(readAzureCredentials({ WORCA_ADO_TOKEN: 't', WORCA_ADO_WRITE_TOKEN: 'w' }), { mode: 'split', read: 't', write: 'w' });
    } },
    { name: 'azureEnv layers the helper after existing GIT_CONFIG entries and strips every host credential', run: () => {
      const env = azureEnv('write', { PATH: '/bin', GH_TOKEN: 'g', WORCA_ADO_READ_TOKEN: 'r', WORCA_ADO_WRITE_TOKEN: 'w',
        GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'core.hooksPath', GIT_CONFIG_VALUE_0: '/dev/null' });
      assert.equal(env.GH_TOKEN, undefined);
      assert.equal(env.WORCA_ADO_READ_TOKEN, undefined);
      assert.equal(env.WORCA_ADO_WRITE_TOKEN, undefined);
      assert.equal(env.WORCA_ADO_GIT_TOKEN, 'w');
      assert.equal(env.GIT_CONFIG_KEY_0, 'core.hooksPath');
      assert.equal(env.GIT_CONFIG_COUNT, '5');
      assert.deepEqual([1, 2, 3, 4].map((i) => [env[`GIT_CONFIG_KEY_${i}`], env[`GIT_CONFIG_VALUE_${i}`] === '' ? '' : 'helper']),
        [[ADO_HELPER_KEYS[0], ''], [ADO_HELPER_KEYS[0], 'helper'], [ADO_HELPER_KEYS[1], ''], [ADO_HELPER_KEYS[1], 'helper']]);
    } },
    { name: 'no token: stripped env, no helper', run: () => {
      const env = azureEnv('read', { PATH: '/bin' });
      assert.equal(env.GIT_CONFIG_COUNT, undefined);
      assert.equal(env.WORCA_ADO_GIT_TOKEN, undefined);
    } },
    { name: 'auth header', run: () => {
      assert.equal(azureAuthHeader('read', {}), null);
      assert.deepEqual(azureAuthHeader('read', { WORCA_ADO_TOKEN: 'pat' }), { authorization: `Basic ${Buffer.from(':pat').toString('base64')}` });
    } },
    { name: 'strip list (credential keys + the strip-only Boards token)', run: () => {
      const all = Object.fromEntries([...AZURE_DEVOPS_CREDENTIAL_KEYS, ...AZURE_DEVOPS_STRIP_ONLY_KEYS].map((k) => [k, 'x']));
      assert.deepEqual(stripAzureCredentials({ ...all, KEEP: '1' }), { KEEP: '1' });
      assert.ok(AZURE_DEVOPS_STRIP_ONLY_KEYS.includes('WORCA_ADO_BOARDS_TOKEN'));
    } },
    { name: 'M1: the Boards token is stripped but never read as worca\'s own credential', run: () => {
      assert.deepEqual(readAzureCredentials({ WORCA_ADO_BOARDS_TOKEN: 'b' }), { mode: 'none', read: null, write: null });
      assert.equal(azureAuthHeader('read', { WORCA_ADO_BOARDS_TOKEN: 'b' }), null);
      assert.equal(azureEnv('write', { PATH: '/bin', WORCA_ADO_BOARDS_TOKEN: 'b' }).WORCA_ADO_BOARDS_TOKEN, undefined);
    } },
  ]);
});

// Design §8: the *.visualstudio.com credential key must match through git's urlmatch (git ≥ 2.13).
// The helper is a POSIX shell function: skip on Windows, exactly as github-credentials.test.mjs does.
const POSIX = { skip: process.platform === 'win32' ? 'the helper is a POSIX shell function' : false };
test('git answers an Azure credential prompt from the helper, for dev.azure.com and *.visualstudio.com', POSIX, () => {
  for (const host of ['dev.azure.com', 'acme.visualstudio.com']) {
    const env = { ...azureEnv('read', { PATH: process.env.PATH, HOME: process.env.HOME, WORCA_ADO_TOKEN: 'pat123' }),
      GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0' };
    const r = spawnSync('git', ['credential', 'fill'], { input: `protocol=https\nhost=${host}\n\n`, env, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /^password=pat123$/m, host);
  }
});
