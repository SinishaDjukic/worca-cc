// test/marketplace-provenance.test.mjs — install stamps marketplace provenance
// into the lock; listInstalledPlugins surfaces repo/subdir/marketplace.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { installPlugin, listInstalledPlugins } from '../src/core/plugin-store.mjs';
import { fetchCandidate } from '../src/core/plugin-repo.mjs';
import { writeMarketplaces, seedBuiltinMarketplace } from '../src/core/marketplaces.mjs';
import { readPluginsLock, pluginsLockFile } from '../src/core/plugins-lock.mjs';
import { checkRows } from './helpers/rows.mjs';

useTempHome(after);
const execFileP = promisify(execFile);
const scratch = mkdtempSync(join(tmpdir(), 'worca-cc-prov-'));
after(() => rmSync(scratch, { recursive: true, force: true }));

async function git(cwd, ...args) {
  const { stdout } = await execFileP('git', [
    '-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...args,
  ], { cwd });
  return stdout.trim();
}

// One fixture repo holds both plugins: plugins/prov is installed with a marketplace,
// plugins/plain without one.
test('installPlugin stamps marketplace provenance when given one and writes no marketplace key otherwise', async () => {
  const root = join(scratch, 'repo');
  mkdirSync(join(root, 'plugins', 'prov', 'connector'), { recursive: true });
  mkdirSync(join(root, 'plugins', 'plain'), { recursive: true });
  writeFileSync(join(root, 'worca-cc-marketplace.json'), JSON.stringify({ name: 'M', plugins: ['plugins/prov'] }));
  writeFileSync(join(root, 'plugins', 'prov', 'worca-cc-plugin.json'), JSON.stringify({
    name: 'prov-plugin', version: '0.1.0',
    taskSources: [{ id: 'main', displayName: 'P', module: './connector/index.mjs',
      inputs: [{ key: 'task', type: 'task-browser', label: 'Task' }] }],
  }));
  writeFileSync(join(root, 'plugins', 'prov', 'connector', 'index.mjs'), 'export default () => ({});\n');
  writeFileSync(join(root, 'plugins', 'plain', 'worca-cc-plugin.json'), JSON.stringify({
    name: 'plain-plugin', version: '0.1.0',
    taskSources: [{ id: 'main', displayName: 'P', module: './index.mjs',
      inputs: [{ key: 'task', type: 'task-browser', label: 'Task' }] }],
  }));
  writeFileSync(join(root, 'plugins', 'plain', 'index.mjs'), 'export default () => ({});\n');
  await git(root, 'init', '-q', '-b', 'main');
  await git(root, 'add', '-A');
  await git(root, 'commit', '-qm', 'c1');
  const sha = await git(root, 'rev-parse', 'HEAD');

  await checkRows([
    { name: 'installPlugin stamps marketplace id; listInstalledPlugins returns provenance', run: async () => {
      const res = await installPlugin({ repoUrl: root, subdir: 'plugins/prov', name: 'prov-plugin', sha, marketplace: 'm-id' });
      assert.equal(res.ok, true);
      assert.equal(readPluginsLock()['prov-plugin'].marketplace, 'm-id');

      const row = listInstalledPlugins().find((p) => p.name === 'prov-plugin');
      assert.equal(row.repo, root);
      assert.equal(row.subdir, 'plugins/prov');
      assert.equal(row.marketplace, 'm-id');
      assert.equal(row.broken, false, 'depth-2 install resolves through current/');
    } },
    { name: 'installPlugin without marketplace writes no marketplace key', run: async () => {
      await installPlugin({ repoUrl: root, subdir: 'plugins/plain', name: 'plain-plugin', sha });
      assert.ok(!('marketplace' in readPluginsLock()['plain-plugin']));
      assert.equal(listInstalledPlugins().find((p) => p.name === 'plain-plugin').marketplace, null);
      // E4: not even a null "marketplace" key reaches disk. Scope to THIS plugin's entry —
      // the whole lock legitimately contains other plugins' marketplace keys in the shared home.
      const onDisk = JSON.parse(readFileSync(pluginsLockFile(), 'utf8'))['plain-plugin'];
      assert.doesNotMatch(JSON.stringify(onDisk), /"marketplace"/);
    } },
  ]);
});

test('installing from a marketplace that tracks a branch pins that branch and records it; updates follow it, not HEAD', async () => {
  const root = join(scratch, 'branch-repo');
  mkdirSync(join(root, 'plugins', 'br'), { recursive: true });
  writeFileSync(join(root, 'worca-cc-marketplace.json'), JSON.stringify({ name: 'B', plugins: ['plugins/br'] }));
  writeFileSync(join(root, 'plugins', 'br', 'worca-cc-plugin.json'), JSON.stringify({
    name: 'branch-plugin', version: '0.1.0',
    taskSources: [{ id: 'main', displayName: 'B', module: './index.mjs',
      inputs: [{ key: 'task', type: 'task-browser', label: 'Task' }] }],
  }));
  writeFileSync(join(root, 'plugins', 'br', 'index.mjs'), 'export default () => ({});\n');
  await git(root, 'init', '-q', '-b', 'main');
  await git(root, 'add', '-A');
  await git(root, 'commit', '-qm', 'c1');
  await git(root, 'checkout', '-q', '-b', 'dev');
  await git(root, 'commit', '-q', '--allow-empty', '-m', 'dev 1');
  const dev1 = await git(root, 'rev-parse', 'HEAD');
  await git(root, 'checkout', '-q', 'main');
  writeMarketplaces({ seededBuiltin: false, marketplaces: {} });
  const { id } = seedBuiltinMarketplace({ source: { url: root, ref: 'dev' } });

  await installPlugin({ repoUrl: root, subdir: 'plugins/br', name: 'branch-plugin', marketplace: id });
  const entry = readPluginsLock()['branch-plugin'];
  assert.equal(entry.pinnedSha, dev1, 'no sha given: the branch tip, not HEAD');
  assert.equal(entry.ref, 'dev');

  await git(root, 'commit', '-q', '--allow-empty', '-m', 'main 2');
  await git(root, 'checkout', '-q', 'dev');
  writeFileSync(join(root, 'plugins', 'br', 'index.mjs'), 'export default () => ({ v: 2 });\n');
  await git(root, 'commit', '-qam', 'dev 2');
  const dev2 = await git(root, 'rev-parse', 'HEAD');
  await git(root, 'checkout', '-q', 'main');
  const cand = await fetchCandidate('branch-plugin');
  assert.equal(cand.candidateSha, dev2);
  assert.deepEqual(cand.commits.map((c) => c.subject), ['dev 2']);
});
