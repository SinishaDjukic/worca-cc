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
import { readPluginsLock, pluginsLockFile } from '../src/core/plugins-lock.mjs';

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

test('installPlugin stamps marketplace id; listInstalledPlugins returns provenance', async () => {
  const root = join(scratch, 'repo');
  mkdirSync(join(root, 'plugins', 'prov', 'connector'), { recursive: true });
  writeFileSync(join(root, 'worca-cc-marketplace.json'), JSON.stringify({ name: 'M', plugins: ['plugins/prov'] }));
  writeFileSync(join(root, 'plugins', 'prov', 'worca-cc-plugin.json'), JSON.stringify({
    name: 'prov-plugin', version: '0.1.0',
    taskSources: [{ id: 'main', displayName: 'P', module: './connector/index.mjs',
      inputs: [{ key: 'task', type: 'task-browser', label: 'Task' }] }],
  }));
  writeFileSync(join(root, 'plugins', 'prov', 'connector', 'index.mjs'), 'export default () => ({});\n');
  await git(root, 'init', '-q', '-b', 'main');
  await git(root, 'add', '-A');
  await git(root, 'commit', '-qm', 'c1');
  const sha = await git(root, 'rev-parse', 'HEAD');

  const res = await installPlugin({ repoUrl: root, subdir: 'plugins/prov', name: 'prov-plugin', sha, marketplace: 'm-id' });
  assert.equal(res.ok, true);
  assert.equal(readPluginsLock()['prov-plugin'].marketplace, 'm-id');

  const row = listInstalledPlugins().find((p) => p.name === 'prov-plugin');
  assert.equal(row.repo, root);
  assert.equal(row.subdir, 'plugins/prov');
  assert.equal(row.marketplace, 'm-id');
  assert.equal(row.broken, false, 'depth-2 install resolves through current/');
});

test('installPlugin without marketplace writes no marketplace key', async () => {
  // reuse the same repo; second plugin name via a fresh subdir is overkill —
  // uninstall is heavier than a second fixture, so make a tiny root-level repo.
  const root2 = join(scratch, 'repo2');
  mkdirSync(root2, { recursive: true });
  writeFileSync(join(root2, 'worca-cc-plugin.json'), JSON.stringify({
    name: 'plain-plugin', version: '0.1.0',
    taskSources: [{ id: 'main', displayName: 'P', module: './index.mjs',
      inputs: [{ key: 'task', type: 'task-browser', label: 'Task' }] }],
  }));
  writeFileSync(join(root2, 'index.mjs'), 'export default () => ({});\n');
  await git(root2, 'init', '-q', '-b', 'main');
  await git(root2, 'add', '-A');
  await git(root2, 'commit', '-qm', 'c1');
  const sha2 = await git(root2, 'rev-parse', 'HEAD');
  await installPlugin({ repoUrl: root2, subdir: '', name: 'plain-plugin', sha: sha2 });
  assert.ok(!('marketplace' in readPluginsLock()['plain-plugin']));
  assert.equal(listInstalledPlugins().find((p) => p.name === 'plain-plugin').marketplace, null);
  // E4: not even a null "marketplace" key reaches disk. Scope to THIS plugin's entry —
  // the whole lock legitimately contains other plugins' marketplace keys in the shared home.
  const onDisk = JSON.parse(readFileSync(pluginsLockFile(), 'utf8'))['plain-plugin'];
  assert.doesNotMatch(JSON.stringify(onDisk), /"marketplace"/);
});
