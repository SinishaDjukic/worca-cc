// test/plugin-inventory.test.mjs — inventoryFromCache exports a pinned SHA from
// the bare cache into a temp dir, inventories it, deletes it. Offline: local git.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { addPluginRepo } from '../src/core/plugin-repo.mjs';
import { inventoryFromCache } from '../src/core/plugin-inventory.mjs';

useTempHome(after);
const execFileP = promisify(execFile);
const scratch = mkdtempSync(join(tmpdir(), 'worca-cc-inv-'));
after(() => rmSync(scratch, { recursive: true, force: true }));

async function git(cwd, ...args) {
  const { stdout } = await execFileP('git', [
    '-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...args,
  ], { cwd });
  return stdout.trim();
}

test('inventoryFromCache: depth-2 subdir inventory matches the plugin manifest', async () => {
  const root = join(scratch, 'repo');
  mkdirSync(join(root, 'plugins', 'demo', 'connector'), { recursive: true });
  writeFileSync(join(root, 'worca-cc-marketplace.json'),
    JSON.stringify({ name: 'M', plugins: ['plugins/demo'] }));
  writeFileSync(join(root, 'plugins', 'demo', 'worca-cc-plugin.json'), JSON.stringify({
    name: 'demo', version: '1.0.0',
    taskSources: [{ id: 'main', displayName: 'Demo', module: './connector/index.mjs',
      configSchema: [{ key: 'token', type: 'text', label: 'Token', secret: true }],
      inputs: [{ key: 'task', type: 'task-browser', label: 'Task' }] }],
  }));
  writeFileSync(join(root, 'plugins', 'demo', 'connector', 'index.mjs'), 'export default () => ({});\n');
  await git(root, 'init', '-q', '-b', 'main');
  await git(root, 'add', '-A');
  await git(root, 'commit', '-qm', 'c1');
  const found = await addPluginRepo(root);
  const inv = await inventoryFromCache(found.repoUrl, found.sha, 'plugins/demo');
  assert.deepEqual(inv.taskSources, [{ id: 'main', displayName: 'Demo', secrets: ['token'] }]);
  assert.deepEqual(inv.setupCommands, []);
  assert.equal(inv.depCount, null);
});

test('inventoryFromCache: throwaway tmp path in setup commands is rewritten to <plugin-dir> (C6)', async () => {
  const root = join(scratch, 'repo-setup');
  mkdirSync(join(root, 'plugins', 'withdep'), { recursive: true });
  writeFileSync(join(root, 'worca-cc-marketplace.json'),
    JSON.stringify({ name: 'M', plugins: ['plugins/withdep'] }));
  writeFileSync(join(root, 'plugins', 'withdep', 'worca-cc-plugin.json'), JSON.stringify({
    name: 'withdep', version: '1.0.0', setup: { node: true },
    taskSources: [{ id: 'main', displayName: 'W', module: './index.mjs',
      inputs: [{ key: 'task', type: 'task-browser', label: 'Task' }] }],
  }));
  writeFileSync(join(root, 'plugins', 'withdep', 'index.mjs'), 'export default () => ({});\n');
  writeFileSync(join(root, 'plugins', 'withdep', 'package.json'),
    JSON.stringify({ name: 'withdep', version: '1.0.0', dependencies: {} }));
  await git(root, 'init', '-q', '-b', 'main');
  await git(root, 'add', '-A');
  await git(root, 'commit', '-qm', 'c1');
  const found = await addPluginRepo(root);
  const inv = await inventoryFromCache(found.repoUrl, found.sha, 'plugins/withdep');
  const joined = (inv.setupCommands || []).join('\n');
  assert.ok(inv.setupCommands.length > 0, 'setup commands present');
  assert.doesNotMatch(joined, /\/var\/folders|\/tmp/); // no leaked throwaway path
  assert.match(joined, /<plugin-dir>/);
});
