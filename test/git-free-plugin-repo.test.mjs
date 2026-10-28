// test/git-free-plugin-repo.test.mjs — plugin repositories without git: a per-commit snapshot of the plugin folders,
// discovery and the consent inventory equal to the git path's (P6 Task 3).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, sep } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import { useTempHome } from './helpers/temp-home.mjs';
import { addPluginRepo, repoSnapshotRoot, removeSnapshotRoot } from '../src/core/plugin-repo.mjs';
import { inventoryFromCache } from '../src/core/plugin-inventory.mjs';
import { readPluginsLock, writePluginsLock } from '../src/core/plugins-lock.mjs';
import { _testing as ghTesting } from '../src/core/git-free/github.mjs';
import { fakeGithub } from './helpers/fake-github.mjs';
import { withNoGit } from './helpers/git-off.mjs';
import { tarGz } from './helpers/tar-writer.mjs';
import { BITBUCKET_NEEDS_GIT } from '../src/core/git-available.mjs';

useTempHome(after);
const WIN_SYMLINK = { skip: process.platform === 'win32' ? 'creating symlinks needs a privilege on Windows' : false };
// A read-only folder stops a removal half-way (what a killed process leaves) only for a POSIX user other than root.
const STUCK = { skip: process.platform === 'win32' || process.getuid?.() === 0 ? 'a read-only folder blocks a removal only for a non-root POSIX user' : false };
const tarballs = (n) => gh.calls.slice(n).filter((c) => c.path.includes('/tarball/')).length;
const snapshotFolders = (root) => readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory() && !e.name.startsWith('.')).map((e) => e.name).sort();
const gh = await fakeGithub();
ghTesting.setFetch(gh.fetch);
after(() => { ghTesting.reset(); gh.close(); });

const MANIFEST = (name) => JSON.stringify({ name, version: '0.1.0',
  taskSources: [{ id: 'src', module: './index.mjs', inputs: [{ key: 'task', type: 'task-browser' }] }] });
const MARKET = {
  'worca-cc-marketplace.json': JSON.stringify({ name: 'Acme Market', description: 'd', plugins: ['plugins/alpha', 'plugins/beta'] }),
  'plugins/alpha/worca-cc-plugin.json': MANIFEST('alpha-plugin'), 'plugins/alpha/index.mjs': 'export default () => ({});\n',
  'plugins/beta/worca-cc-plugin.json': MANIFEST('beta-plugin'), 'plugins/beta/index.mjs': 'export default () => ({});\n',
  'docs/big.md': 'x'.repeat(1000),
};

test('discovery over HTTPS equals discovery over git for the same commit; only plugin folders reach the disk', async (t) => {
  const { bare, sha } = gh.repo('acme/market', { files: MARKET });
  const gitEvents = []; const viaGit = await addPluginRepo(bare, { onProgress: (e) => gitEvents.push(e) });
  withNoGit(t);
  const httpsEvents = []; const viaHttps = await addPluginRepo('acme/market', { onProgress: (e) => httpsEvents.push(e) });
  assert.equal(viaHttps.repoUrl, 'https://github.com/acme/market');
  assert.equal(viaHttps.sha, sha);
  assert.deepEqual([viaHttps.discovered, viaHttps.warnings, viaHttps.marketplace], [viaGit.discovered, viaGit.warnings, viaGit.marketplace]);
  assert.ok(viaHttps.discovered.every((d) => Array.isArray(d.warnings)), 'G14: each discovered plugin carries its own notes over HTTPS too');
  assert.deepEqual([gitEvents, httpsEvents], [[{ phase: 'reading', sha }], [{ phase: 'reading', sha }]]);
  assert.deepEqual(viaHttps.discovered.map((d) => [d.name, d.subdir]), [['alpha-plugin', 'plugins/alpha'], ['beta-plugin', 'plugins/beta']]);
  const snap = join(repoSnapshotRoot('https://github.com/acme/market'), sha);
  assert.equal(existsSync(join(snap, 'plugins', 'alpha', 'index.mjs')), true);
  assert.equal(existsSync(join(snap, 'docs', 'big.md')), false);
});

test('the same commit again downloads nothing: two revalidated requests', async (t) => {
  gh.repo('acme/again', { files: MARKET });
  withNoGit(t);
  await addPluginRepo('https://github.com/acme/again');
  const n = gh.calls.length;
  await addPluginRepo('https://github.com/acme/again');
  assert.deepEqual(gh.calls.slice(n).map((c) => [c.path, c.status]), [['/repos/acme/again', 304], ['/repos/acme/again/commits/main', 304]]);
});

test('a followed branch is read at its tip; a missing branch is named', async (t) => {
  const { bare } = gh.repo('acme/branchy', { files: MARKET });
  const dev = gh.commit('acme/branchy', { branch: 'dev', from: 'main', files: { 'plugins/alpha/extra.md': 'e\n' } });
  gh.commit('acme/branchy', { branch: 'rel/v2', from: 'main', files: { 'plugins/alpha/v2.md': '2\n' } });
  await assert.rejects(addPluginRepo(bare, { ref: 'rel/./v2' }), /^Error: branch "rel\/\.\/v2" not found$/);
  withNoGit(t);
  assert.equal((await addPluginRepo('https://github.com/acme/branchy', { ref: 'dev' })).sha, dev);
  await assert.rejects(addPluginRepo('https://github.com/acme/branchy', { ref: 'nope' }), /^Error: branch "nope" not found$/);
  // no branch is named `rel/./v2` (git refuses the name); a URL would fold it into rel/v2
  await assert.rejects(addPluginRepo('https://github.com/acme/branchy', { ref: 'rel/./v2' }), /^Error: branch "rel\/\.\/v2" not found$/);
});

test('a source that is not on github.com needs git', async (t) => {
  const local = gh.repo('acme/local', { files: MARKET }).bare;
  withNoGit(t);
  for (const url of ['https://gitlab.com/acme/market', local]) {
    await assert.rejects(addPluginRepo(url), { code: 'GIT_MISSING', message: 'git is not installed on this machine' });
  }
});

test('a Bitbucket source without git names Bitbucket', async (t) => {
  withNoGit(t);
  await assert.rejects(addPluginRepo('https://bitbucket.org/acme/market'), { code: 'GIT_MISSING', message: BITBUCKET_NEEDS_GIT });
});

test('a manifest committed as a symlink is read the way git reads it: not JSON, skipped', WIN_SYMLINK, async (t) => {
  gh.repo('acme/linky', { files: { 'alpha/worca-cc-plugin.json': { link: '../../../../etc/hosts' },
    'beta/worca-cc-plugin.json': MANIFEST('beta-plugin'), 'beta/index.mjs': 'export default () => ({});\n' } });
  withNoGit(t);
  const viaHttps = await addPluginRepo('https://github.com/acme/linky');
  assert.deepEqual(viaHttps.discovered.map((d) => d.name), ['beta-plugin']);
  assert.deepEqual(viaHttps.warnings, ['alpha/worca-cc-plugin.json: invalid JSON — skipped']);
});

test('the consent inventory over HTTPS equals the git one', async (t) => {
  const files = { ...MARKET, 'plugins/alpha/agents/helper.meta.json': '{}', 'plugins/alpha/agents/helper.md': '---\ntools: [Read]\n---\nHi\n' };
  const { bare, sha } = gh.repo('acme/inv', { files });
  await addPluginRepo(bare);
  const viaGit = await inventoryFromCache(bare, sha, 'plugins/alpha');
  withNoGit(t);
  await addPluginRepo('https://github.com/acme/inv');
  const viaHttps = await inventoryFromCache('https://github.com/acme/inv', sha, 'plugins/alpha');
  assert.deepEqual(viaHttps, viaGit);
  assert.equal(viaHttps.agents.length, 1);
});

test('the consent inventory of a folder with no manifest at that commit equals git\'s, never a cache path', async (t) => {
  const files = { 'p/index.mjs': 'export default () => ({});\n', 'q/worca-cc-plugin.json': MANIFEST('q-plugin') };   // p: no manifest yet
  const { bare, sha } = gh.repo('acme/nomani', { files });
  await addPluginRepo(bare);
  const viaGit = await inventoryFromCache(bare, sha, 'p');
  withNoGit(t);
  assert.deepEqual(await inventoryFromCache('https://github.com/acme/nomani', sha, 'p'), viaGit);
});

test('a subdir that leaves the repository is refused as git archive refuses it: no local folder is read', async (t) => {
  const url = 'https://github.com/acme/updir';
  const { bare, sha } = gh.repo('acme/updir', { files: MARKET });
  const local = join(process.env.WORCA_HOME, 'local-plugin');
  mkdirSync(local, { recursive: true });
  writeFileSync(join(local, 'worca-cc-plugin.json'), MANIFEST('local-plugin'));
  writeFileSync(join(local, 'index.mjs'), 'export default () => ({});\n');
  const up = relative(join(repoSnapshotRoot(url), sha), local).split(sep).join('/');   // ../../../../local-plugin
  await addPluginRepo(bare);
  await assert.rejects(inventoryFromCache(bare, sha, up), /outside repository/);
  withNoGit(t);
  await addPluginRepo(url);
  for (const subdir of [up, 'plugins/alpha/../beta', './plugins/alpha']) {
    await assert.rejects(inventoryFromCache(url, sha, subdir), { code: 'BAD_REQUEST', message: 'invalid subdir' }, subdir);
  }
});

test('with git installed the git path runs: the fake GitHub sees no request', async () => {
  const n = gh.calls.length;
  const seen = [];
  const exec = async (cmd, args) => { seen.push([cmd, args[0]]); throw Object.assign(new Error('stop'), { stderr: 'fatal: stop' }); };
  await assert.rejects(addPluginRepo('https://github.com/acme/market', { exec }), /stop/);
  assert.deepEqual(seen, [['git', 'clone']]);
  assert.equal(gh.calls.length, n);
});

test('a manifest symlinked inside the repository is not followed either: the same discovery and warnings as git', WIN_SYMLINK, async (t) => {
  const files = { 'alpha/worca-cc-plugin.json': { link: '../beta/worca-cc-plugin.json' },
    'beta/worca-cc-plugin.json': MANIFEST('beta-plugin'), 'beta/index.mjs': 'export default () => ({});\n' };
  gh.repo('acme/inlink', { files });
  const viaGit = await addPluginRepo(gh.repo('acme/inlink-g', { files }).bare);
  withNoGit(t);
  const viaHttps = await addPluginRepo('https://github.com/acme/inlink');
  assert.deepEqual([viaHttps.discovered.map((d) => d.name), viaHttps.warnings], [viaGit.discovered.map((d) => d.name), viaGit.warnings]);
  assert.deepEqual(viaHttps.warnings, ['alpha/worca-cc-plugin.json: invalid JSON — skipped']);
});

test('a truncated tree listing is refused with its own message', async (t) => {
  gh.repo('acme/huge', { files: { 'worca-cc-plugin.json': MANIFEST('huge'), 'index.mjs': 'export default () => ({});\n' } });
  withNoGit(t);
  gh.truncateTrees(true);
  try {
    await assert.rejects(addPluginRepo('https://github.com/acme/huge'), { code: 'GITHUB_HTTP', message: 'the repository is too large to read without git' });
  } finally { gh.truncateTrees(false); }
});

test('snapshots: the three newest stay, and every commit an installed plugin is pinned to; a tag names its commit\'s folder', async (t) => {
  const url = 'https://github.com/acme/prune';
  const { sha: s1 } = gh.repo('acme/prune', { files: MARKET });
  gh.tag('acme/prune', 'v1', s1);
  withNoGit(t);
  await addPluginRepo(url);
  writePluginsLock({ ...readPluginsLock(), pruned: { repo: url, subdir: 'plugins/alpha', pinnedSha: s1, version: '0.1.0', enabled: true } });
  const later = [];
  for (let i = 2; i <= 5; i++) {
    later.push(gh.commit('acme/prune', { files: { 'plugins/alpha/n.md': `${i}\n` } }));
    await addPluginRepo(url);
  }
  const root = repoSnapshotRoot(url);
  const folders = () => readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory() && !e.name.startsWith('.')).map((e) => e.name).sort();
  assert.deepEqual(folders(), [s1, ...later.slice(-3)].sort());
  assert.deepEqual(await inventoryFromCache(url, 'v1', 'plugins/alpha'), await inventoryFromCache(url, s1, 'plugins/alpha'));
  assert.deepEqual(folders(), [s1, ...later.slice(-3)].sort());
  await assert.rejects(inventoryFromCache(url, '../../.', 'plugins/alpha'), /^Error: branch "\.\.\/\.\.\/\." not found$/);
});

test('a pin naming its commit by a tag or an abbreviated sha keeps that commit\'s snapshot too', async (t) => {
  const url = 'https://github.com/acme/namepin';
  const { sha: s1 } = gh.repo('acme/namepin', { files: MARKET });
  gh.tag('acme/namepin', 'v1', s1);
  const s2 = gh.commit('acme/namepin', { files: { 'plugins/beta/n.md': '2\n' } });
  withNoGit(t);
  // `worca plugin install --ref v1` (or `--ref <sha7>`) pins the name: the export reads the snapshot by it, as this does.
  for (const rev of ['v1', s2.slice(0, 7)]) await inventoryFromCache(url, rev, 'plugins/alpha');
  const pin = { repo: url, subdir: 'plugins/alpha', version: '0.1.0', enabled: true };
  writePluginsLock({ ...readPluginsLock(), 'pin-tag': { ...pin, pinnedSha: 'v1' }, 'pin-abbrev': { ...pin, pinnedSha: s2.slice(0, 7) } });
  const later = [];
  for (let i = 3; i <= 6; i++) {
    later.push(gh.commit('acme/namepin', { files: { 'plugins/alpha/n.md': `${i}\n` } }));
    await addPluginRepo(url);
  }
  assert.deepEqual(snapshotFolders(repoSnapshotRoot(url)), [s1, s2, ...later.slice(-3)].sort());
});

test('a snapshot folder without its meta file (a removal cut short) is rebuilt, never read as complete', async (t) => {
  const url = 'https://github.com/acme/halfgone';
  const { sha } = gh.repo('acme/halfgone', { files: MARKET });
  withNoGit(t);
  await addPluginRepo(url);
  const snap = join(repoSnapshotRoot(url), sha);
  const whole = await inventoryFromCache(url, sha, 'plugins/beta');
  rmSync(`${snap}.meta.json`);
  rmSync(join(snap, 'plugins', 'beta'), { recursive: true });
  const n = gh.calls.length;
  assert.deepEqual(await inventoryFromCache(url, sha, 'plugins/beta'), whole);
  assert.equal(tarballs(n), 1);
  assert.equal(existsSync(join(snap, 'plugins', 'beta', 'index.mjs')), true);
});

test('prune removes a snapshot\'s meta file before its folder, and a removal that stops half-way fails no read', STUCK, async (t) => {
  const url = 'https://github.com/acme/stuck';
  const { sha: s1 } = gh.repo('acme/stuck', { files: MARKET });
  withNoGit(t);
  await addPluginRepo(url);
  const root = repoSnapshotRoot(url);
  const ro = join(root, s1, 'plugins', 'alpha');
  chmodSync(ro, 0o555);   // its files cannot be removed: pruning s1 stops inside its folder
  try {
    for (let i = 2; i <= 4; i++) {
      gh.commit('acme/stuck', { files: { 'plugins/beta/n.md': `${i}\n` } });
      await addPluginRepo(url);   // the fourth snapshot prunes s1
    }
    assert.equal(existsSync(join(root, `${s1}.meta.json`)), false);
  } finally { if (existsSync(ro)) chmodSync(ro, 0o755); }
  const n = gh.calls.length;
  await inventoryFromCache(url, s1, 'plugins/alpha');
  assert.equal(tarballs(n), 1);
});

test('a snapshot root is renamed aside before it is removed: a removal that stops half-way leaves no snapshot behind', STUCK, async (t) => {
  const url = 'https://github.com/acme/aside';
  const { sha } = gh.repo('acme/aside', { files: MARKET });
  withNoGit(t);
  await addPluginRepo(url);
  const root = repoSnapshotRoot(url);
  chmodSync(join(root, sha, 'plugins', 'alpha'), 0o555);
  let trash = [];
  try {
    removeSnapshotRoot(url);   // the rename lands; removing the renamed folder stops inside it
  } finally {
    trash = readdirSync(dirname(root)).filter((n) => n.startsWith(`${basename(root)}.trash-`));
    for (const d of [root, ...trash.map((n) => join(dirname(root), n))]) {
      if (existsSync(join(d, sha, 'plugins', 'alpha'))) chmodSync(join(d, sha, 'plugins', 'alpha'), 0o755);
    }
  }
  assert.equal(existsSync(root), false);
  assert.equal(trash.length, 1);
  const n = gh.calls.length;
  await addPluginRepo(url);
  assert.equal(tarballs(n), 1);
});

test('a snapshot root that cannot be renamed aside is left as it is: the uninstall or removal that asked never fails on it', STUCK, async (t) => {
  const url = 'https://github.com/acme/stays';
  gh.repo('acme/stays', { files: MARKET });
  withNoGit(t);
  await addPluginRepo(url);
  const root = repoSnapshotRoot(url);
  chmodSync(dirname(root), 0o555);
  try { removeSnapshotRoot(url); } finally { chmodSync(dirname(root), 0o755); }
  assert.equal(existsSync(root), true);
  assert.deepEqual(readdirSync(dirname(root)).filter((n) => n.startsWith(`${basename(root)}.trash-`)), []);
});

test('an archive past the size caps is the repository-too-large GitHub error, never an internal one', async (t) => {
  const { sha } = gh.repo('acme/toolarge', { files: { 'worca-cc-plugin.json': MANIFEST('toolarge'), 'index.mjs': 'export default () => ({});\n' } });
  // One header claiming a file past ARCHIVE_LIMITS.fileBytes (512 MiB): refused at the header, no body needed.
  const tar = gunzipSync(tarGz([{ path: `acme-toolarge-${sha.slice(0, 7)}/index.mjs`, body: 'x' }]));
  tar.write(`${(600 * 2 ** 20).toString(8).padStart(11, '0')}\0`, 124, 12, 'ascii');
  tar.fill(' ', 148, 156);
  tar.write(`${tar.subarray(0, 512).reduce((n, x) => n + x, 0).toString(8).padStart(6, '0')}\0 `, 148, 8, 'ascii');
  gh.tarballOverride('acme/toolarge', sha, gzipSync(tar));
  withNoGit(t);
  await assert.rejects(addPluginRepo('https://github.com/acme/toolarge'), { name: 'GithubError', code: 'GITHUB_HTTP', message: 'the repository is too large to read without git' });
  assert.equal(existsSync(join(repoSnapshotRoot('https://github.com/acme/toolarge'), sha)), false);
});
