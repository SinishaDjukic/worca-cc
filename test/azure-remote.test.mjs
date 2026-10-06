// test/azure-remote.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isAzureHost, parseAzurePath, parseAzurePrUrl, azurePrUrl } from '../src/shared/azure-remote.mjs';
import { checkRows } from './helpers/rows.mjs';

const X = { host: 'dev.azure.com', org: 'acme', project: 'Shop', owner: 'acme/Shop', repo: 'api' };

test('azure-remote: hosts, path shapes, PR URLs', async () => {
  await checkRows([
    { name: 'isAzureHost', run: () => {
      for (const h of ['dev.azure.com', 'ssh.dev.azure.com', 'vs-ssh.visualstudio.com', 'acme.visualstudio.com', 'ACME.VisualStudio.com']) assert.ok(isAzureHost(h), h);
      for (const h of ['github.com', 'azure.com', 'visualstudio.com', 'evil.dev.azure.com.attacker.io']) assert.ok(!isAzureHost(h), h);
    } },
    { name: 'parseAzurePath: every spelling folds to one identity', run: () => {
      assert.deepEqual(parseAzurePath('dev.azure.com', ['acme', 'Shop', '_git', 'api']), X);
      assert.deepEqual(parseAzurePath('ssh.dev.azure.com', ['v3', 'acme', 'Shop', 'api']), X);
      assert.deepEqual(parseAzurePath('vs-ssh.visualstudio.com', ['v3', 'acme', 'Shop', 'api']), X);
      assert.deepEqual(parseAzurePath('acme.visualstudio.com', ['Shop', '_git', 'api']), X);
      assert.deepEqual(parseAzurePath('acme.visualstudio.com', ['DefaultCollection', 'Shop', '_git', 'api']), X);
      assert.deepEqual(parseAzurePath('dev.azure.com', ['acme', '_git', 'Shop']), { ...X, repo: 'Shop' }, 'default repo named after the project');
      assert.deepEqual(parseAzurePath('dev.azure.com', ['acme', 'My%20Project', '_git', 'My%20Repo']),
        { host: 'dev.azure.com', org: 'acme', project: 'My Project', owner: 'acme/My Project', repo: 'My Repo' });
    } },
    { name: 'parseAzurePath: wrong shapes are null', run: () => {
      assert.equal(parseAzurePath('dev.azure.com', ['acme', 'Shop', 'api']), null, 'https without _git');
      assert.equal(parseAzurePath('dev.azure.com', ['acme', 'Shop', '_git', 'api', 'extra']), null);
      assert.equal(parseAzurePath('ssh.dev.azure.com', ['acme', 'Shop', 'api']), null, 'ssh without v3');
      assert.equal(parseAzurePath('github.com', ['o', 'r']), null);
    } },
    { name: 'PR URLs round-trip; legacy spelling parses', run: () => {
      const url = azurePrUrl({ org: 'acme', project: 'My Project', repo: 'api' }, 42);
      assert.equal(url, 'https://dev.azure.com/acme/My%20Project/_git/api/pullrequest/42');
      assert.deepEqual(parseAzurePrUrl(url), { host: 'dev.azure.com', org: 'acme', project: 'My Project', owner: 'acme/My Project', repo: 'api', number: 42 });
      assert.equal(parseAzurePrUrl('https://acme.visualstudio.com/Shop/_git/api/pullrequest/7').number, 7);
      assert.equal(parseAzurePrUrl('https://github.com/o/r/pull/1'), null);
    } },
  ]);
});
