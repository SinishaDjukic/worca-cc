// test/bitbucket-remote.test.mjs — Bitbucket Cloud identity: hosts, PR URLs, and the forge helpers that use them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isBitbucketHost, parseBitbucketPrUrl, bitbucketPrUrl } from '../src/shared/bitbucket-remote.mjs';
import { parseRemoteUrl, forgeOf, forgeOfPrUrl, prNumberFromUrl, watchablePrUrl, remoteRepoSlug, sameRepo, FORGE_LABEL } from '../src/core/forge.mjs';
import { checkRows } from './helpers/rows.mjs';

const ID = { host: 'bitbucket.org', owner: 'acme', repo: 'api' };

test('bitbucket-remote: hosts, PR URLs, forge detection', async () => {
  await checkRows([
    { name: 'isBitbucketHost', run: () => {
      for (const h of ['bitbucket.org', 'BitBucket.org', 'altssh.bitbucket.org']) assert.ok(isBitbucketHost(h), h);
      for (const h of ['api.bitbucket.org', 'bitbucket.org.evil.io', 'bitbucket.example.com', 'github.com']) assert.ok(!isBitbucketHost(h), h);
    } },
    { name: 'every remote spelling is one repository, forge bitbucket', run: () => {
      for (const u of ['https://bitbucket.org/acme/api.git', 'https://jdoe@bitbucket.org/acme/api.git', 'git@bitbucket.org:acme/api.git',
        'ssh://git@bitbucket.org/acme/api.git', 'ssh://git@altssh.bitbucket.org:443/acme/api.git']) {
        assert.deepEqual(parseRemoteUrl(u), ID, u);
        assert.equal(forgeOf(parseRemoteUrl(u)), 'bitbucket', u);
      }
      assert.equal(remoteRepoSlug(ID), 'bitbucket.org/acme/api');
      assert.ok(sameRepo(ID, parseRemoteUrl('git@bitbucket.org:ACME/Api.git')));
      assert.equal(forgeOf(parseRemoteUrl('https://bitbucket.example.com/scm/acme/api.git')), null, 'Data Center is not Cloud');
      assert.equal(FORGE_LABEL.bitbucket, 'Bitbucket');
    } },
    { name: 'PR URLs: canonical form, tabs dropped, wrong shapes null', run: () => {
      const url = bitbucketPrUrl(ID, 12);
      assert.equal(url, 'https://bitbucket.org/acme/api/pull-requests/12');
      assert.deepEqual(parseBitbucketPrUrl(url), { ...ID, number: 12, url });
      assert.equal(parseBitbucketPrUrl(`${url}/overview`).url, url);
      assert.equal(parseBitbucketPrUrl(`${url}/diff#chg-a.js`).url, url);
      for (const bad of ['https://bitbucket.org/acme/api/pull-requests/0', 'https://bitbucket.org/acme/pull-requests/1',
        'http://bitbucket.org/acme/api/pull-requests/1', 'https://bitbucket.example.com/acme/api/pull-requests/1',
        'https://github.com/acme/api/pull/1']) assert.equal(parseBitbucketPrUrl(bad), null, bad);
    } },
    { name: 'forgeOfPrUrl / prNumberFromUrl / watchablePrUrl', run: () => {
      const url = 'https://bitbucket.org/acme/api/pull-requests/12';
      assert.equal(forgeOfPrUrl(url), 'bitbucket');
      assert.equal(prNumberFromUrl(url), 12);
      assert.equal(watchablePrUrl(url), true);
      assert.equal(forgeOfPrUrl('https://github.com/o/r/pull/3'), 'github');
      assert.equal(forgeOfPrUrl('https://dev.azure.com/acme/Shop/_git/api/pullrequest/9'), 'azure');
    } },
  ]);
});
