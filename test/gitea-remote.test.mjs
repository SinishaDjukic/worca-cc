// test/gitea-remote.test.mjs — the Gitea family's identity: host lists, PR URLs, Codeberg's fixed host, and the forge
// helpers that resolve a remote or PR URL by the configured lists.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseGiteaHosts, isGiteaHost, giteaApiOrigin, giteaPrUrl, parseGiteaPrUrl } from '../src/shared/gitea-remote.mjs';
import { CODEBERG_HOST, isCodebergHost, codebergPrUrl, parseCodebergPrUrl } from '../src/shared/codeberg-remote.mjs';
import { parseRemoteUrl, forgeOf, forgeOfPrUrl, prNumberFromUrl, prIdentity, parsePrRef, watchablePrUrl, remoteRepoSlug, sameRepo, familyForgeOfHost, isFamilyForge, FAMILY_FORGES, FORGE_LABEL } from '../src/core/forge.mjs';
import { checkRows } from './helpers/rows.mjs';
import { withEnv } from './helpers/with-env.mjs';

const HOSTS = ['pgit.example.org', 'git.example.org'];
const ID = { host: 'pgit.example.org', owner: 'tests', repo: 'worca-tests' };
const LISTS = { WORCA_GITEA_HOSTS: 'pgit.example.org', WORCA_FORGEJO_HOSTS: 'forge.example.org' };

test('gitea-remote: host lists and PR URLs', async () => {
  await checkRows([
    { name: 'parseGiteaHosts: lowercase, deduplicated, scheme/port/path entries dropped', run: () => {
      assert.deepEqual(parseGiteaHosts(' Pgit.Example.org, git.example.org,pgit.example.org'), HOSTS);
      assert.deepEqual(parseGiteaHosts('https://a.org, b.org:3000, c.org/x, -bad.org, ok-host.org'), ['ok-host.org']);
      assert.deepEqual(parseGiteaHosts(undefined), []);
    } },
    { name: 'isGiteaHost is a list membership, case-insensitive', run: () => {
      assert.ok(isGiteaHost('PGIT.example.org', HOSTS));
      assert.ok(!isGiteaHost('other.org', HOSTS) && !isGiteaHost('', HOSTS) && !isGiteaHost('pgit.example.org', null));
    } },
    { name: 'PR URLs: canonical form, tabs dropped, only listed hosts, wrong shapes null', run: () => {
      const url = giteaPrUrl(ID, 7);
      assert.equal(url, 'https://pgit.example.org/tests/worca-tests/pulls/7');
      assert.equal(giteaApiOrigin(ID.host), 'https://pgit.example.org/api/v1');
      assert.deepEqual(parseGiteaPrUrl(url, HOSTS), { ...ID, number: 7, url });
      assert.equal(parseGiteaPrUrl(`${url}/files`, HOSTS).url, url);
      assert.equal(parseGiteaPrUrl(`${url}/commits#x`, HOSTS).url, url);
      assert.equal(parseGiteaPrUrl('https://PGIT.example.org/tests/worca-tests/pulls/7', HOSTS).host, 'pgit.example.org');
      for (const bad of [`${url}`.replace('pgit', 'other'), 'http://pgit.example.org/tests/worca-tests/pulls/7', 'https://pgit.example.org/tests/pulls/7',
        'https://pgit.example.org/tests/worca-tests/pulls/0', 'https://pgit.example.org/tests/worca-tests/issues/7']) assert.equal(parseGiteaPrUrl(bad, HOSTS), null, bad);
    } },
    { name: 'codeberg: a fixed host on the same helpers', run: () => {
      assert.equal(CODEBERG_HOST, 'codeberg.org');
      assert.ok(isCodebergHost('Codeberg.org') && !isCodebergHost('codeberg.org.evil.io'));
      const url = codebergPrUrl({ owner: 'acme', repo: 'api' }, 3);
      assert.equal(url, 'https://codeberg.org/acme/api/pulls/3');
      assert.deepEqual(parseCodebergPrUrl(`${url}/files`), { host: 'codeberg.org', owner: 'acme', repo: 'api', number: 3, url });
      assert.equal(parseCodebergPrUrl('https://pgit.example.org/acme/api/pulls/3'), null);
    } },
  ]);
});

test('forge: remotes and PR URLs resolve by the configured lists', () => withEnv(LISTS, async () => {
  await checkRows([
    { name: 'every remote spelling of a listed host is one repository; a custom SSH port is dropped', run: () => {
      for (const u of ['https://pgit.example.org/tests/worca-tests.git', 'ssh://git@pgit.example.org:6370/tests/worca-tests.git', 'git@pgit.example.org:tests/worca-tests.git']) {
        assert.deepEqual(parseRemoteUrl(u), ID, u);
        assert.equal(forgeOf(parseRemoteUrl(u)), 'gitea', u);
      }
      assert.equal(remoteRepoSlug(ID), 'pgit.example.org/tests/worca-tests');
      assert.ok(sameRepo(ID, parseRemoteUrl('git@pgit.example.org:Tests/Worca-Tests.git')));
    } },
    { name: 'forgeOf: codeberg before the Forgejo list before the Gitea list; an unlisted host is plain git', run: () => {
      assert.equal(forgeOf(parseRemoteUrl('git@codeberg.org:a/b.git')), 'codeberg');
      assert.equal(forgeOf(parseRemoteUrl('https://forge.example.org/a/b.git')), 'forgejo');
      assert.equal(forgeOf(parseRemoteUrl('https://other.example.org/a/b.git')), null);
      assert.deepEqual([familyForgeOfHost('codeberg.org'), familyForgeOfHost('forge.example.org'), familyForgeOfHost('PGIT.example.org'), familyForgeOfHost('other.org')], ['codeberg', 'forgejo', 'gitea', null]);
      assert.deepEqual(FAMILY_FORGES, ['gitea', 'forgejo', 'codeberg']);
      assert.ok(isFamilyForge('forgejo') && !isFamilyForge('bitbucket'));
      assert.deepEqual([FORGE_LABEL.gitea, FORGE_LABEL.forgejo, FORGE_LABEL.codeberg], ['Gitea', 'Forgejo', 'Codeberg']);
    } },
    { name: 'forgeOfPrUrl / prNumberFromUrl / prIdentity / parsePrRef / watchablePrUrl', run: () => {
      const url = 'https://forge.example.org/a/b/pulls/4/files';
      assert.equal(forgeOfPrUrl(url), 'forgejo');
      assert.equal(prNumberFromUrl(url), 4);
      assert.deepEqual(prIdentity(url), { forge: 'forgejo', host: 'forge.example.org', owner: 'a', repo: 'b', number: 4, key: 'forge.example.org/a/b/pulls/4' });
      assert.deepEqual(prIdentity('https://codeberg.org/A/B/pulls/5'), { forge: 'codeberg', host: 'codeberg.org', owner: 'A', repo: 'B', number: 5, key: 'codeberg.org/a/b/pulls/5' });
      assert.deepEqual(parsePrRef('https://pgit.example.org/tests/worca-tests/pulls/7'), { kind: 'url', number: 7, key: 'pgit.example.org/tests/worca-tests/pulls/7', forge: 'gitea' });
      assert.equal(watchablePrUrl(url), true);
      assert.equal(watchablePrUrl('https://other.example.org/a/b/pulls/4'), false, 'an unlisted host is not watchable');
      assert.equal(forgeOfPrUrl('https://other.example.org/a/b/pulls/4'), null);
    } },
    { name: 'a host listed under both forges is Forgejo (its list wins)', run: () => withEnv({ WORCA_GITEA_HOSTS: 'forge.example.org' }, () => {
      assert.equal(forgeOf(parseRemoteUrl('https://forge.example.org/a/b.git')), 'forgejo');
    }) },
  ]);
}));
