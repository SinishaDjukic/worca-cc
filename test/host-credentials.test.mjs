import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gitEnvFor, stripHostCredentials, hostLookupNeeded, githubOnlyEnv, TRACKER_STRIP_ONLY_KEYS, isTrackerTokenKey } from '../src/core/host-credentials.mjs';
import { checkRows } from './helpers/rows.mjs';
import { withEnv } from './helpers/with-env.mjs';

const NO_ADO = { WORCA_ADO_TOKEN: undefined, WORCA_ADO_READ_TOKEN: undefined, WORCA_ADO_WRITE_TOKEN: undefined, AZURE_DEVOPS_EXT_PAT: undefined,
  WORCA_BB_TOKEN: undefined, WORCA_BB_READ_TOKEN: undefined, WORCA_BB_WRITE_TOKEN: undefined };
/** Every ambient variable that opens a D6/D7/D20 host-lookup gate: Azure credentials, push-as-person, App mode. */
const CLOSED_GATES = { ...NO_ADO, WORCA_GH_AS_PERSON: undefined, WORCA_BROKER_URL: undefined,
  WORCA_GH_APP_ID: undefined, WORCA_GH_APP_KEY_FILE: undefined, WORCA_GH_APP_KEY_B64: undefined };

const base = { PATH: '/bin', GH_TOKEN: 'g', WORCA_ADO_TOKEN: 'a', WORCA_BB_TOKEN: 'b' };

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
  assert.equal(gh.env.WORCA_BB_TOKEN, undefined, 'no Bitbucket token on a GitHub call');
  assert.equal(az.env.WORCA_BB_TOKEN, undefined, 'no Bitbucket token on an Azure call');

  const bb = await gitEnvFor('write', 'git@bitbucket.org:acme/api.git', { base, githubEnvImpl });
  assert.equal(bb.error, null);
  assert.equal(bb.env.WORCA_BB_GIT_TOKEN, 'b');
  assert.equal(bb.env.WORCA_BB_TOKEN, undefined);
  assert.equal(bb.env.GH_TOKEN, undefined);
  assert.equal(bb.env.WORCA_ADO_TOKEN, undefined);
  assert.equal(seen.length, 1, 'no GitHub mint for Bitbucket');

  const other = await gitEnvFor('write', 'https://gitlab.com/g/r.git', { base, githubEnvImpl });
  assert.deepEqual(other, { env: { PATH: '/bin' }, error: null });
});

test('gitEnvFor passes base to the GitHub env only when the caller gave one (runClone seam keeps {role, repo})', async () => {
  const seen = [];
  await gitEnvFor('read', 'https://github.com/acme/ok1.git', { githubEnvImpl: async (role, o) => { seen.push({ role, ...o }); return { env: {}, error: null }; } });
  assert.deepEqual(seen, [{ role: 'read', repo: 'acme/ok1' }]);
});

test('stripHostCredentials removes GitHub, Azure and Bitbucket keys, including the strip-only Boards token (M1)', () => {
  assert.deepEqual(stripHostCredentials({ ...base, WORCA_ADO_GIT_TOKEN: 'x', WORCA_GIT_TOKEN: 'y', WORCA_ADO_BOARDS_TOKEN: 'b', WORCA_BB_GIT_TOKEN: 'x', WORCA_BB_EMAIL: 'e' }), { PATH: '/bin' });
});

test('stripHostCredentials and every git env drop the strip-only tracker tokens (jira-source)', async () => {
  assert.ok(TRACKER_STRIP_ONLY_KEYS.includes('WORCA_JIRA_TOKEN'));
  // One variable per Jira profile: WORCA_JIRA_TOKEN and WORCA_JIRA_TOKEN_<NAME>, any case (Windows).
  const jira = { WORCA_JIRA_TOKEN: 'j', WORCA_JIRA_TOKEN_DC: 'd', worca_jira_token_cloud: 'c' };
  assert.deepEqual(stripHostCredentials({ ...base, ...jira, WORCA_JIRA_TOKENX: 'kept', WORCA_JIRA_TOKEN_: 'kept too' }),
    { PATH: '/bin', WORCA_JIRA_TOKENX: 'kept', WORCA_JIRA_TOKEN_: 'kept too' });
  assert.deepEqual(['WORCA_JIRA_TOKEN', 'WORCA_JIRA_TOKEN_DC', 'worca_jira_token_cloud', 'WORCA_JIRA_TOKENX', 'WORCA_JIRA_TOKEN_', 'JIRA_TOKEN'].map(isTrackerTokenKey),
    [true, true, true, false, false, false]);
  const gh = await gitEnvFor('read', 'https://github.com/acme/ok1.git', { githubEnvImpl: async () => ({ env: { ...jira }, error: null }) });
  const az = await gitEnvFor('read', 'https://dev.azure.com/acme/Shop/_git/api', { base: { ...base, ...jira } });
  const bb = await gitEnvFor('read', 'git@bitbucket.org:acme/api.git', { base: { ...base, ...jira } });
  const other = await gitEnvFor('read', 'https://example.com/x.git', { base: { ...base, ...jira } });
  assert.equal(bb.env.WORCA_BB_GIT_TOKEN, 'b');
  for (const r of [gh, az, bb, other]) assert.deepEqual(Object.keys(r.env).filter(isTrackerTokenKey), []);
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
    { name: 'Bitbucket credential: open', run: () => {
      assert.equal(hostLookupNeeded({ env: { WORCA_BB_TOKEN: 'b' } }), true);
      assert.equal(hostLookupNeeded({ env: { WORCA_BB_READ_TOKEN: 'b' } }), true);
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
    GH_TOKEN: 'ghp_x', WORCA_ADO_BOARDS_TOKEN: 'b', WORCA_BB_GIT_TOKEN: 'x' },
  () => githubOnlyEnv('write', { repo: null }));
  assert.equal(r.error, null);
  assert.equal(r.env.GH_TOKEN, 'ghp_x');
  assert.equal(r.env.WORCA_ADO_BOARDS_TOKEN, undefined);
  assert.equal(r.env.WORCA_BB_GIT_TOKEN, undefined, 'no Bitbucket helper variable on a GitHub-only env');
});
