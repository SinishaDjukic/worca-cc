// test/plugin-repo.test.mjs — bare-cache clone/fetch, manifest discovery at
// depth 0/1, candidate preview, git-archive export. REAL local git repos in a
// temp dir (no network); WORCA_HOME sandboxed via useTempHome.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, symlinkSync, lstatSync, readFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { addPluginRepo, fetchCandidate, exportVersion, repoCacheDir } from '../src/core/plugin-repo.mjs';
import { writePluginsLock, pluginDir } from '../src/core/plugins-lock.mjs';

useTempHome(after);
const execFileP = promisify(execFile);
const scratch = mkdtempSync(join(tmpdir(), 'worca-cc-repo-'));
after(() => rmSync(scratch, { recursive: true, force: true }));

async function git(cwd, ...args) {
  const { stdout } = await execFileP('git', [
    '-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...args,
  ], { cwd });
  return stdout.trim();
}
function writeTree(root, files) {
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), content);
  }
}
const MANIFEST = (name) => JSON.stringify({
  name, version: '0.1.0',
  taskSources: [{ id: 'src', module: './index.mjs', inputs: [{ key: 'task', type: 'task-browser' }] }],
});
async function makeRepo(dirName, files) {
  const root = join(scratch, dirName);
  mkdirSync(root, { recursive: true });
  await git(root, 'init', '-q', '-b', 'main');
  writeTree(root, files);
  await git(root, 'add', '-A');
  await git(root, 'commit', '-qm', 'c1');
  return { root, sha: await git(root, 'rev-parse', 'HEAD') };
}

test('addPluginRepo: multi-plugin discovery at depth 1 (two subdirs)', async () => {
  const { root, sha } = await makeRepo('multi', {
    'README.md': 'not a plugin\n',
    'alpha/worca-cc-plugin.json': MANIFEST('alpha-plugin'),
    'alpha/index.mjs': 'export default () => ({});\n',
    'beta/worca-cc-plugin.json': MANIFEST('beta-plugin'),
    'beta/index.mjs': 'export default () => ({});\n',
  });
  const r = await addPluginRepo(root);
  assert.equal(r.repoUrl, root);
  assert.equal(r.sha, sha);
  assert.match(r.sha, /^[0-9a-f]{40}$/);
  assert.deepEqual(
    r.discovered.map(({ name, subdir }) => ({ name, subdir })),
    [{ name: 'alpha-plugin', subdir: 'alpha' }, { name: 'beta-plugin', subdir: 'beta' }],
  );
  assert.equal(r.discovered[0].manifest.taskSources[0].id, 'src');
  assert.ok(existsSync(repoCacheDir(root)), 'bare fetch cache created under <pluginsRoot>/.cache');
});

test('addPluginRepo: root-level single plugin -> subdir ""', async () => {
  const { root } = await makeRepo('single', {
    'worca-cc-plugin.json': MANIFEST('solo-plugin'),
    'index.mjs': 'export default () => ({});\n',
  });
  const r = await addPluginRepo(root);
  assert.deepEqual(r.discovered.map(({ name, subdir }) => ({ name, subdir })),
    [{ name: 'solo-plugin', subdir: '' }]);
});

test('addPluginRepo: no manifest anywhere -> empty discovery; invalid manifest skipped with warning', async () => {
  const none = await makeRepo('bare', { 'README.md': 'x\n' });
  assert.deepEqual((await addPluginRepo(none.root)).discovered, []);
  const bad = await makeRepo('badjson', { 'worca-cc-plugin.json': '{nope' });
  const r = await addPluginRepo(bad.root);
  assert.deepEqual(r.discovered, []);
  assert.match(r.warnings.join('\n'), /invalid JSON/);
});

test('fetchCandidate: commit list + diffstat between pinned and new HEAD', async () => {
  const { root, sha } = await makeRepo('moving', {
    'worca-cc-plugin.json': MANIFEST('moving-plugin'),
    'index.mjs': 'export default () => ({});\n',
  });
  await addPluginRepo(root); // seed the cache at c1
  writePluginsLock({
    'moving-plugin': {
      repo: root, subdir: '', pinnedSha: sha, version: '0.1.0',
      enabled: true, installedAt: new Date().toISOString(),
    },
  });
  writeFileSync(join(root, 'index.mjs'), 'export default () => ({ v: 2 });\n');
  await git(root, 'add', '-A');
  await git(root, 'commit', '-qm', 'tweak connector');
  const sha2 = await git(root, 'rev-parse', 'HEAD');
  const fc = await fetchCandidate('moving-plugin');
  assert.equal(fc.pinnedSha, sha);
  assert.equal(fc.candidateSha, sha2);
  assert.deepEqual(fc.commits, [{ sha: sha2, subject: 'tweak connector' }]);
  assert.match(fc.diffstat, /index\.mjs/);
  assert.deepEqual(fc.manifestDelta, { newSecrets: [], newTaskSources: [], newAgents: [], setupChanged: false });
  // No-change candidate: re-fetch after nothing moved.
  const again = await fetchCandidate('moving-plugin');
  assert.equal(again.candidateSha, sha2);
  // Manifest delta (§6.2): a commit adding a secret field + an agent is flagged.
  const m = JSON.parse(readFileSync(join(root, 'worca-cc-plugin.json'), 'utf8'));
  m.taskSources[0].configSchema = [{ key: 'apiKey', type: 'text', secret: true, label: 'API key' }];
  writeFileSync(join(root, 'worca-cc-plugin.json'), JSON.stringify(m));
  writeTree(root, { 'agents/newGuy.meta.json': '{"key":"newGuy"}', 'agents/newGuy.md': '# n\n' });
  await git(root, 'add', '-A');
  await git(root, 'commit', '-qm', 'add secret + agent');
  const fc2 = await fetchCandidate('moving-plugin');
  assert.deepEqual(fc2.manifestDelta.newSecrets, ['src.apiKey']);
  assert.deepEqual(fc2.manifestDelta.newAgents, ['newGuy']);
  assert.equal(fc2.diffFull, '', 'full diff only on demand');
  const full = await fetchCandidate('moving-plugin', { fullDiff: true });
  assert.match(full.diffFull, /apiKey/);
});

test('exportVersion: root layout -> versions/<sha7> holds the tree', async () => {
  const { root, sha } = await makeRepo('exp-root', {
    'worca-cc-plugin.json': MANIFEST('exp-root-plugin'),
    'index.mjs': 'export default () => ({});\n',
    'nested/deep.txt': 'deep\n',
  });
  const { versionDir, warnings } = await exportVersion('exp-root-plugin', sha, { repoUrl: root, subdir: '' });
  assert.equal(versionDir, join(pluginDir('exp-root-plugin'), 'versions', sha.slice(0, 7)));
  assert.deepEqual(warnings, []);
  assert.equal(JSON.parse(readFileSync(join(versionDir, 'worca-cc-plugin.json'), 'utf8')).name, 'exp-root-plugin');
  assert.equal(readFileSync(join(versionDir, 'nested/deep.txt'), 'utf8'), 'deep\n');
  assert.ok(!existsSync(join(versionDir, '.git')), 'archive export has no .git');
});

test('exportVersion: subdir layout is extracted at the version root (strip-components)', async () => {
  const { root, sha } = await makeRepo('exp-sub', {
    'alpha/worca-cc-plugin.json': MANIFEST('exp-sub-plugin'),
    'alpha/index.mjs': 'export default () => ({});\n',
    'README.md': 'repo readme\n',
  });
  const { versionDir } = await exportVersion('exp-sub-plugin', sha, { repoUrl: root, subdir: 'alpha' });
  assert.ok(existsSync(join(versionDir, 'worca-cc-plugin.json')), 'manifest sits at the version root');
  assert.ok(!existsSync(join(versionDir, 'alpha')), 'subdir prefix stripped');
  assert.ok(!existsSync(join(versionDir, 'README.md')), 'sibling repo files not exported');
});

test('exportVersion: escaping symlink deleted with warning; internal symlink kept', async () => {
  const root = join(scratch, 'exp-link');
  mkdirSync(root, { recursive: true });
  await git(root, 'init', '-q', '-b', 'main');
  writeTree(root, {
    'worca-cc-plugin.json': MANIFEST('exp-link-plugin'),
    'index.mjs': 'export default () => ({});\n',
  });
  symlinkSync('../../outside', join(root, 'evil'));
  symlinkSync('./index.mjs', join(root, 'ok'));
  await git(root, 'add', '-A');
  await git(root, 'commit', '-qm', 'c1');
  const sha = await git(root, 'rev-parse', 'HEAD');
  const { versionDir, warnings } = await exportVersion('exp-link-plugin', sha, { repoUrl: root, subdir: '' });
  assert.equal(existsSync(join(versionDir, 'evil')), false);
  assert.equal(lstatSync(join(versionDir, 'evil'), { throwIfNoEntry: false }), undefined, 'escaping link removed');
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /escap/i);
  assert.ok(lstatSync(join(versionDir, 'ok')).isSymbolicLink(), 'internal symlink survives');
});
