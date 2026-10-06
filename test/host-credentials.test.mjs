import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gitEnvFor, stripHostCredentials, hostLookupNeeded, githubOnlyEnv } from '../src/core/host-credentials.mjs';
import { checkRows } from './helpers/rows.mjs';
import { withEnv } from './helpers/with-env.mjs';

const NO_ADO = { WORCA_ADO_TOKEN: undefined, WORCA_ADO_READ_TOKEN: undefined, WORCA_ADO_WRITE_TOKEN: undefined, AZURE_DEVOPS_EXT_PAT: undefined };
/** Every ambient variable that opens a D6/D7/D20 host-lookup gate: Azure credentials, push-as-person, App mode. */
const CLOSED_GATES = { ...NO_ADO, WORCA_GH_AS_PERSON: undefined, WORCA_BROKER_URL: undefined,
  WORCA_GH_APP_ID: undefined, WORCA_GH_APP_KEY_FILE: undefined, WORCA_GH_APP_KEY_B64: undefined };

const base = { PATH: '/bin', GH_TOKEN: 'g', WORCA_ADO_TOKEN: 'a' };

test('gitEnvFor picks the credential by the remote host', async () => {
  const seen = [];
  const githubEnvImpl = async (role, o) => { seen.push({ role, repo: o.repo }); return { env: { ...o.base, MINTED: '1' }, error: null }; };
  const gh = await gitEnvFor('write', 'https://github.com/o/r.git', { base, githubEnvImpl });
  assert.deepEqual(seen, [{ role: 'write', repo: 'o/r' }]);
  assert.equal(gh.env.MINTED, '1');
  assert.equal(gh.env.WORCA_ADO_TOKEN, undefined, 'no Azure token on a GitHub call');

  const az = await gitEnvFor('read', 'git@ssh.dev.azure.com:v3/acme/Shop/api', { base, githubEnvImpl });
  assert.equal(az.error, null);
  assert.equal(az.env.WORCA_ADO_GIT_TOKEN, 'a');
  assert.equal(az.env.GH_TOKEN, undefined);
  assert.equal(seen.length, 1, 'no GitHub mint for Azure');

  const other = await gitEnvFor('write', 'https://gitlab.com/g/r.git', { base, githubEnvImpl });
  assert.deepEqual(other, { env: { PATH: '/bin' }, error: null });
});

test('gitEnvFor passes base to the GitHub env only when the caller gave one (runClone seam keeps {role, repo})', async () => {
  const seen = [];
  await gitEnvFor('read', 'https://github.com/acme/ok1.git', { githubEnvImpl: async (role, o) => { seen.push({ role, ...o }); return { env: {}, error: null }; } });
  assert.deepEqual(seen, [{ role: 'read', repo: 'acme/ok1' }]);
});

test('stripHostCredentials removes GitHub and Azure keys, including the strip-only Boards token (M1)', () => {
  assert.deepEqual(stripHostCredentials({ ...base, WORCA_ADO_GIT_TOKEN: 'x', WORCA_GIT_TOKEN: 'y', WORCA_ADO_BOARDS_TOKEN: 'b' }), { PATH: '/bin' });
});

test('hostLookupNeeded: only App mode, an Azure credential, or (for pushes) push-as-person', async () => {
  await checkRows([
    { name: 'token / none modes: closed', run: () => {
      assert.equal(hostLookupNeeded({ env: {} }), false);
      assert.equal(hostLookupNeeded({ push: true, env: { GH_TOKEN: 'g' } }), false);
      assert.equal(hostLookupNeeded({ push: true, env: { WORCA_GH_READ_TOKEN: 'R', WORCA_GH_WRITE_TOKEN: 'W' } }), false);
    } },
    { name: 'Azure credential: open', run: () => {
      assert.equal(hostLookupNeeded({ env: { WORCA_ADO_TOKEN: 'a' } }), true);
      assert.equal(hostLookupNeeded({ env: { AZURE_DEVOPS_EXT_PAT: 'a' } }), true);
    } },
    { name: 'App mode: open', run: () => {
      assert.equal(hostLookupNeeded({ env: { WORCA_GH_APP_ID: '1', WORCA_GH_APP_KEY_B64: 'eA==' } }), true);
    } },
    { name: 'push-as-person: open for pushes only, and only with a broker', run: () => {
      const env = { WORCA_GH_AS_PERSON: 'required', WORCA_BROKER_URL: 'http://127.0.0.1:9' };
      assert.equal(hostLookupNeeded({ push: true, env }), true);
      assert.equal(hostLookupNeeded({ push: false, env }), false);
      assert.equal(hostLookupNeeded({ push: true, env: { WORCA_GH_AS_PERSON: 'required' } }), false, 'asPersonMode is null without a broker');
    } },
  ]);
});

test('githubOnlyEnv: the closed-gate env keeps the GitHub token and drops the Boards token (s4)', async () => {
  // CLOSED_GATES also clears push-as-person + broker and App mode; the split GitHub tokens are cleared
  // so an ambient WORCA_GH_WRITE_TOKEN cannot replace GH_TOKEN.
  const r = await withEnv({ ...CLOSED_GATES, WORCA_GH_READ_TOKEN: undefined, WORCA_GH_WRITE_TOKEN: undefined,
    GH_TOKEN: 'ghp_x', WORCA_ADO_BOARDS_TOKEN: 'b' },
  () => githubOnlyEnv('write', { repo: null }));
  assert.equal(r.error, null);
  assert.equal(r.env.GH_TOKEN, 'ghp_x');
  assert.equal(r.env.WORCA_ADO_BOARDS_TOKEN, undefined);
});
