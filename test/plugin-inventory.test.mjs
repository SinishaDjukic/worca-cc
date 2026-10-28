// test/plugin-inventory.test.mjs — inventoryFromCache exports a pinned SHA from
// the bare cache into a temp dir, inventories it, deletes it. Offline: local git.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { checkRows } from './helpers/rows.mjs';
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

test('inventoryFromCache: depth-2 subdir inventory matches the manifest; throwaway tmp path in setup commands is rewritten to <plugin-dir> (C6)', async () => {
  // One marketplace repo listing both depth-2 plugins, one addPluginRepo (one bare
  // cache); each row exports and inventories its own subdir.
  const root = join(scratch, 'repo');
  mkdirSync(join(root, 'plugins', 'demo', 'connector'), { recursive: true });
  mkdirSync(join(root, 'plugins', 'withdep'), { recursive: true });
  writeFileSync(join(root, 'worca-cc-marketplace.json'),
    JSON.stringify({ name: 'M', plugins: ['plugins/demo', 'plugins/withdep'] }));
  writeFileSync(join(root, 'plugins', 'demo', 'worca-cc-plugin.json'), JSON.stringify({
    name: 'demo', version: '1.0.0',
    taskSources: [{ id: 'main', displayName: 'Demo', module: './connector/index.mjs',
      configSchema: [{ key: 'token', type: 'text', label: 'Token', secret: true }],
      inputs: [{ key: 'task', type: 'task-browser', label: 'Task' }] }],
  }));
  writeFileSync(join(root, 'plugins', 'demo', 'connector', 'index.mjs'), 'export default () => ({});\n');
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
  await checkRows([
    { name: 'inventoryFromCache: depth-2 subdir inventory matches the plugin manifest', run: async () => {
      const inv = await inventoryFromCache(found.repoUrl, found.sha, 'plugins/demo');
      assert.deepEqual(inv.taskSources, [{ id: 'main', displayName: 'Demo', secrets: ['token'] }]);
      assert.deepEqual(inv.setupCommands, []);
      assert.equal(inv.depCount, null);
    } },
    { name: 'inventoryFromCache: throwaway tmp path in setup commands is rewritten to <plugin-dir> (C6)', run: async () => {
      const inv = await inventoryFromCache(found.repoUrl, found.sha, 'plugins/withdep');
      const joined = (inv.setupCommands || []).join('\n');
      assert.ok(inv.setupCommands.length > 0, 'setup commands present');
      assert.doesNotMatch(joined, /\/var\/folders|\/tmp/); // no leaked throwaway path
      assert.match(joined, /<plugin-dir>/);
    } },
  ]);
});

test('inventory git runs in the C locale, so a failed sync reads the same on every host (G12)', { skip: process.platform === 'win32' && 'a POSIX shell script stands in for git' }, async () => {
  const bin = mkdtempSync(join(tmpdir(), 'worca-cc-fakegit-'));
  writeFileSync(join(bin, 'git'), '#!/bin/sh\necho "fatal: LC_ALL=$LC_ALL" >&2\nexit 128\n', { mode: 0o755 });
  const saved = { PATH: process.env.PATH, LC_ALL: process.env.LC_ALL };
  process.env.PATH = `${bin}${delimiter}${saved.PATH}`;
  process.env.LC_ALL = 'de_DE.UTF-8';
  try {
    await assert.rejects(inventoryFromCache('https://git.acme.dev/a/b', 'a'.repeat(40), 'plugins/x'), (e) => /^fatal: LC_ALL=C$/m.test(String(e.stderr)));
  } finally {
    process.env.PATH = saved.PATH;
    if (saved.LC_ALL === undefined) delete process.env.LC_ALL; else process.env.LC_ALL = saved.LC_ALL;
    rmSync(bin, { recursive: true, force: true });
  }
});
