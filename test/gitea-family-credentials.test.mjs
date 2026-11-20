// test/gitea-family-credentials.test.mjs — the Gitea family's credentials: per-host tokens under a prefix, Codeberg's
// fixed set, the git helper per host, the strips, the startup warnings and the cross-forge helpers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeHostListCredentials, withFamilyToken, withFamilyReadTokens, stripFamilyCredentials, stripAllForgeCredentials, isFamilyCredentialKey, hostSuffix, familyCredentialsOf, familyConfigured, FAMILY_GIT_USER } from '../src/core/gitea-family-credentials.mjs';
import { giteaHosts, readGiteaCredentials, giteaEnv, giteaAuthHeader, giteaConfigured, giteaCredentialWarnings } from '../src/core/gitea-credentials.mjs';
import { forgejoEnv, forgejoAuthHeader, forgejoConfigured } from '../src/core/forgejo-credentials.mjs';
import { readCodebergCredentials, codebergEnv, codebergAuthHeader, codebergConfigured } from '../src/core/codeberg-credentials.mjs';
import { checkRows } from './helpers/rows.mjs';
import { withEnv } from './helpers/with-env.mjs';

const ENV = { WORCA_GITEA_HOSTS: 'pgit.example.org, git.example.org', WORCA_GITEA_TOKEN_PGIT_EXAMPLE_ORG: 'pg-tok', WORCA_GITEA_READ_TOKEN_GIT_EXAMPLE_ORG: 'g-read',
  WORCA_FORGEJO_HOSTS: 'forge.example.org', WORCA_FORGEJO_TOKEN_FORGE_EXAMPLE_ORG: 'fj-tok', WORCA_CODEBERG_TOKEN: 'cb-tok',
  GH_TOKEN: 'gh', WORCA_ADO_TOKEN: 'ado', WORCA_BB_TOKEN: 'bb', GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'a.b', GIT_CONFIG_VALUE_0: 'c' };
const helperKeys = (env) => Object.keys(env).filter((k) => /^GIT_CONFIG_KEY_/.test(k)).map((k) => env[k]);

test('gitea family credentials', async () => {
  await checkRows([
    { name: 'hosts and per-host roles: single, split, none; no host-less token', run: () => {
      assert.deepEqual(giteaHosts(ENV), ['pgit.example.org', 'git.example.org']);
      assert.deepEqual(readGiteaCredentials('pgit.example.org', ENV), { mode: 'single', read: 'pg-tok', write: 'pg-tok' });
      assert.deepEqual(readGiteaCredentials('GIT.example.org', ENV), { mode: 'split', read: 'g-read', write: null });
      assert.deepEqual(readGiteaCredentials('other.org', { ...ENV, WORCA_GITEA_TOKEN: 'ignored' }), { mode: 'none', read: null, write: null });
      assert.equal(hostSuffix('pgit.example-two.org'), 'PGIT_EXAMPLE_TWO_ORG');
    } },
    { name: 'authHeader per host and role; configured when any listed host has a token', run: () => {
      assert.deepEqual(giteaAuthHeader('read', 'git.example.org', ENV), { authorization: 'token g-read' });
      assert.equal(giteaAuthHeader('write', 'git.example.org', ENV), null);
      assert.deepEqual(forgejoAuthHeader('write', 'forge.example.org', ENV), { authorization: 'token fj-tok' });
      assert.deepEqual(codebergAuthHeader('read', undefined, ENV), { authorization: 'token cb-tok' });
      assert.ok(giteaConfigured(ENV) && forgejoConfigured(ENV) && codebergConfigured(ENV));
      assert.ok(!giteaConfigured({ WORCA_GITEA_HOSTS: 'x.org', WORCA_GITEA_TOKEN_Y_ORG: 't' }), 'a token for an unlisted host configures nothing');
    } },
    { name: 'gitEnv: every forge credential stripped, the host list kept, one helper for the one host, layered after GIT_CONFIG_*', run: () => {
      const e = giteaEnv('write', 'pgit.example.org', ENV);
      assert.deepEqual(Object.keys(e).filter((k) => /^(GH_|WORCA_)/.test(k)).sort(), ['WORCA_FORGEJO_HOSTS', 'WORCA_GITEA_GIT_TOKEN_PGIT_EXAMPLE_ORG', 'WORCA_GITEA_HOSTS'], 'the host lists are configuration and stay');
      assert.equal(e.WORCA_GITEA_GIT_TOKEN_PGIT_EXAMPLE_ORG, 'pg-tok');
      assert.deepEqual(helperKeys(e), ['a.b', 'credential.https://pgit.example.org.helper', 'credential.https://pgit.example.org.helper']);
      assert.equal(e.GIT_CONFIG_VALUE_1, '', 'the first entry clears the machine\'s helpers for that host');
      assert.match(e.GIT_CONFIG_VALUE_2, new RegExp(`username=${FAMILY_GIT_USER}.*password=\\$WORCA_GITEA_GIT_TOKEN_PGIT_EXAMPLE_ORG`));
      assert.equal(e.GIT_CONFIG_COUNT, '3');
      assert.deepEqual(helperKeys(giteaEnv('write', 'git.example.org', ENV)), ['a.b'], 'no write token for that host: stripped, no helper');
      const f = forgejoEnv('read', 'forge.example.org', ENV);
      assert.equal(f.WORCA_FORGEJO_GIT_TOKEN_FORGE_EXAMPLE_ORG, 'fj-tok');
      const c = codebergEnv('read', ENV);
      assert.deepEqual(helperKeys(c).slice(1), ['credential.https://codeberg.org.helper', 'credential.https://codeberg.org.helper']);
      assert.equal(c.WORCA_CODEBERG_GIT_TOKEN, 'cb-tok');
      assert.ok(!('WORCA_CODEBERG_TOKEN' in c) && !('GH_TOKEN' in c));
    } },
    { name: 'strips: isFamilyCredentialKey keeps the host lists; stripAllForgeCredentials covers four forges', run: () => {
      assert.ok(isFamilyCredentialKey('WORCA_GITEA_TOKEN_X') && isFamilyCredentialKey('WORCA_CODEBERG_READ_TOKEN') && isFamilyCredentialKey('WORCA_FORGEJO_GIT_TOKEN_X'));
      assert.ok(!isFamilyCredentialKey('WORCA_GITEA_HOSTS') && !isFamilyCredentialKey('WORCA_BB_TOKEN'));
      const s = stripFamilyCredentials(ENV);
      assert.deepEqual(Object.keys(s).filter((k) => k.startsWith('WORCA_')).sort(), ['WORCA_ADO_TOKEN', 'WORCA_BB_TOKEN', 'WORCA_FORGEJO_HOSTS', 'WORCA_GITEA_HOSTS']);
      assert.deepEqual(Object.keys(stripAllForgeCredentials(ENV)).filter((k) => /^(GH_|WORCA_)/.test(k)).sort(), ['WORCA_FORGEJO_HOSTS', 'WORCA_GITEA_HOSTS']);
    } },
    { name: 'withFamilyReadTokens: tokens from the source env, one helper per host with a read token, Codeberg included', run: () => {
      const e = withFamilyReadTokens(stripAllForgeCredentials(ENV), ENV);
      assert.deepEqual(helperKeys(e).filter((k) => k !== 'a.b'), ['credential.https://pgit.example.org.helper', 'credential.https://pgit.example.org.helper',
        'credential.https://git.example.org.helper', 'credential.https://git.example.org.helper', 'credential.https://forge.example.org.helper', 'credential.https://forge.example.org.helper',
        'credential.https://codeberg.org.helper', 'credential.https://codeberg.org.helper']);
      assert.deepEqual([e.WORCA_GITEA_GIT_TOKEN_PGIT_EXAMPLE_ORG, e.WORCA_GITEA_GIT_TOKEN_GIT_EXAMPLE_ORG, e.WORCA_FORGEJO_GIT_TOKEN_FORGE_EXAMPLE_ORG, e.WORCA_CODEBERG_GIT_TOKEN], ['pg-tok', 'g-read', 'fj-tok', 'cb-tok']);
      assert.equal(withFamilyToken({ GIT_CONFIG_COUNT: 'x' }, 'h.org', null, 'K').GIT_CONFIG_COUNT, 'x', 'no token: untouched');
      const raw = withFamilyReadTokens(ENV, ENV);
      assert.ok(!Object.keys(raw).some((k) => /^WORCA_(?:GITEA|FORGEJO)_(?:READ_|WRITE_)?TOKEN_|^WORCA_CODEBERG_(?:READ_|WRITE_)?TOKEN$/.test(k)), 'the raw tokens never ride along, only the per-call helper keys');
    } },
    { name: 'familyCredentialsOf / familyConfigured', run: () => withEnv(ENV, () => {
      assert.deepEqual(familyCredentialsOf('pgit.example.org'), { forge: 'gitea', mode: 'single', tokenName: 'WORCA_GITEA_TOKEN_PGIT_EXAMPLE_ORG' });
      assert.deepEqual(familyCredentialsOf('forge.example.org', { WORCA_FORGEJO_HOSTS: 'forge.example.org' }), { forge: 'forgejo', mode: 'none', tokenName: 'WORCA_FORGEJO_TOKEN_FORGE_EXAMPLE_ORG' });
      assert.deepEqual(familyCredentialsOf('codeberg.org', {}), { forge: 'codeberg', mode: 'none', tokenName: 'WORCA_CODEBERG_TOKEN' });
      assert.equal(familyCredentialsOf('other.org'), null);
      assert.ok(familyConfigured({ WORCA_CODEBERG_WRITE_TOKEN: 't' }) && familyConfigured({ WORCA_FORGEJO_HOSTS: 'x.org', WORCA_FORGEJO_READ_TOKEN_X_ORG: 't' }));
      assert.ok(!familyConfigured({ WORCA_GITEA_TOKEN: 't', WORCA_GITEA_HOSTS: 'x' }), 'no host-less token');
      assert.ok(!familyConfigured({ WORCA_FORGEJO_READ_TOKEN_X_ORG: 't' }), 'a token for an unlisted host configures nothing');
      assert.ok(!familyConfigured({ WORCA_CODEBERG_TOKEN: '', WORCA_GITEA_HOSTS: 'x.org', WORCA_GITEA_TOKEN_X_ORG: ' ' }), 'empty values, as compose passes them, configure nothing');
    }) },
    { name: 'warnings name the variable, never the value: a host-less token and a token for an unlisted host', run: () => {
      const w = giteaCredentialWarnings({ ...ENV, WORCA_GITEA_TOKEN: 'secret-value', WORCA_GITEA_WRITE_TOKEN_OTHER_ORG: 'secret-two' });
      assert.deepEqual(w, ['WORCA_GITEA_TOKEN is not read: tokens are per host (WORCA_GITEA_TOKEN_<HOST>)', 'WORCA_GITEA_WRITE_TOKEN_OTHER_ORG names a host that is not in WORCA_GITEA_HOSTS']);
      assert.ok(!w.join(' ').includes('secret'));
      assert.deepEqual(giteaCredentialWarnings(ENV), []);
      assert.deepEqual(giteaCredentialWarnings({ WORCA_GITEA_HOSTS: 'git.example.org,git-example.org' }),
        ['WORCA_GITEA_HOSTS: git.example.org and git-example.org share the suffix GIT_EXAMPLE_ORG, so one WORCA_GITEA_TOKEN_GIT_EXAMPLE_ORG would serve both']);
      assert.deepEqual(readCodebergCredentials({ WORCA_CODEBERG_READ_TOKEN: ' r ' }), { mode: 'split', read: 'r', write: null });
      assert.equal(makeHostListCredentials('GITEA').hostsKey, 'WORCA_GITEA_HOSTS');
    } },
  ]);
});
