// test/git-free-plugin-export.test.mjs — a pinned install and an update preview without git (P6 Task 4).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { structuredPatch } from 'diff';
import { chmodSync, existsSync, readFileSync, readdirSync, lstatSync, readlinkSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, sep } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { addPluginRepo, exportVersion, fetchCandidate, repoSnapshotRoot, emptyManifestDelta } from '../src/core/plugin-repo.mjs';
import { inventoryFromCache } from '../src/core/plugin-inventory.mjs';
import { installPlugin, runSetup, uninstallPlugin } from '../src/core/plugin-store.mjs';
import { readPluginsLock, writePluginsLock, pluginDir } from '../src/core/plugins-lock.mjs';
import { _testing as ghTesting } from '../src/core/git-free/github.mjs';
import { fakeGithub } from './helpers/fake-github.mjs';
import { withNoGit } from './helpers/git-off.mjs';
import { PATCH_MAX_EDIT_LENGTH, PATCH_DIFF_TIMEOUT_MS } from '../src/core/folder-copy.mjs';
import { noGitBinDir, _testing as stubTesting } from '../src/core/nogit-stub.mjs';

useTempHome(after);
const POSIX = process.platform !== 'win32';
// A read-only folder stops a removal half-way (what a killed process leaves) only for a POSIX user other than root.
const STUCK = { skip: !POSIX || process.getuid?.() === 0 ? 'a read-only folder blocks a removal only for a non-root POSIX user' : false };
const gh = await fakeGithub();
ghTesting.setFetch(gh.fetch);
after(() => { ghTesting.reset(); gh.close(); });
const MANIFEST = (name) => JSON.stringify({ name, version: '0.1.0',
  taskSources: [{ id: 'src', module: './index.mjs', inputs: [{ key: 'task', type: 'task-browser' }] }] });
const INDEX = 'export default () => ({ async validateConfig(){return {ok:true};} });\n';

/** rel path → { kind, mode, text | target } for every entry under `dir` (mtimes ignored). */
function treeOf(dir) {
  const out = {};
  for (const e of readdirSync(dir, { recursive: true, withFileTypes: true })) {
    const p = join(e.parentPath ?? e.path, e.name);
    const rel = p.slice(dir.length + 1).split('\\').join('/');
    const st = lstatSync(p);
    out[rel] = st.isSymbolicLink() ? { kind: 'link', target: readlinkSync(p) }
      : st.isDirectory() ? { kind: 'dir' } : { kind: 'file', mode: st.mode & 0o777, text: readFileSync(p, 'utf8') };
  }
  return out;
}

test('exportVersion over HTTPS writes the tree git archive writes: files, modes, CRLF, internal links; escaping links removed', async (t) => {
  const files = {
    'plugins/alpha/worca-cc-plugin.json': MANIFEST('alpha-plugin'), 'plugins/alpha/index.mjs': INDEX,
    'plugins/alpha/bin/run.sh': { exec: '#!/bin/sh\necho hi\n' }, 'plugins/alpha/docs/a.md': 'a\r\nb\r\n',
    ...(POSIX ? { 'plugins/alpha/docs/link.md': { link: 'a.md' }, 'plugins/alpha/out': { link: '../../../outside' }, 'plugins/alpha/lib': { link: '../beta' } } : {}),
    'plugins/beta/x.mjs': 'x\n',
  };
  const { bare, sha } = gh.repo('acme/exp', { files });
  gh.tag('acme/exp', 'v1', sha);
  const viaGit = await exportVersion('alpha-git', sha, { repoUrl: bare, subdir: 'plugins/alpha' });
  withNoGit(t);
  const viaHttps = await exportVersion('alpha-https', sha, { repoUrl: 'https://github.com/acme/exp', subdir: 'plugins/alpha' });
  assert.deepEqual(treeOf(viaHttps.versionDir), treeOf(viaGit.versionDir));
  assert.deepEqual([...viaHttps.warnings].sort(), [...viaGit.warnings].sort());
  assert.deepEqual(viaHttps.warnings, POSIX ? ['removed symlink escaping the export dir: lib', 'removed symlink escaping the export dir: out'] : []);
  const byTag = await exportVersion('alpha-tag', 'v1', { repoUrl: 'https://github.com/acme/exp', subdir: 'plugins/alpha' });
  assert.deepEqual([treeOf(byTag.versionDir), byTag.warnings], [treeOf(viaHttps.versionDir), viaHttps.warnings]);
  assert.equal(readFileSync(join(viaHttps.versionDir, 'docs', 'a.md'), 'utf8'), 'a\r\nb\r\n');
  assert.equal(existsSync(join(viaHttps.versionDir, '.git')), false);
  assert.equal(viaHttps.versionDir.endsWith(join('alpha-https', 'versions', sha.slice(0, 7))), true);
});

test('update preview over HTTPS: commits newest first, the plugin-scoped diffstat, new agents; only the candidate is downloaded', async (t) => {
  const { sha: v1 } = gh.repo('acme/upd', { files: {
    'plugins/alpha/worca-cc-plugin.json': MANIFEST('alpha-plugin'), 'plugins/alpha/index.mjs': INDEX, 'other/x.md': 'x\n' } });
  withNoGit(t);
  await installPlugin({ repoUrl: 'https://github.com/acme/upd', subdir: 'plugins/alpha', name: 'alpha-plugin', sha: v1 });
  const c2 = gh.commit('acme/upd', { message: 'add helper agent', files: {
    'plugins/alpha/agents/helper.meta.json': '{}', 'plugins/alpha/agents/helper.md': '---\n---\nx\n' } });
  const c3 = gh.commit('acme/upd', { message: 'touch other', files: { 'other/x.md': 'y\n', 'plugins/alpha/index.mjs': `${INDEX}// v2\n` } });
  const n = gh.calls.length;
  const p = await fetchCandidate('alpha-plugin');
  assert.deepEqual([p.pinnedSha, p.candidateSha], [v1, c3]);
  assert.deepEqual(p.commits.map((c) => [c.sha, c.subject]), [[c3, 'touch other'], [c2, 'add helper agent']]);
  const row = (name, changes, bar) => ` ${name.padEnd(37)} | ${changes} ${bar}`;
  assert.equal(p.diffstat, [row('plugins/alpha/agents/helper.md', 3, '+++').trimStart(), row('plugins/alpha/agents/helper.meta.json', 1, '+'),
    row('plugins/alpha/index.mjs', 1, '+'), ' 3 files changed, 5 insertions(+)'].join('\n'));
  assert.equal(p.diffFull, '');
  assert.deepEqual(p.manifestDelta.newAgents, ['helper']);
  assert.deepEqual([p.pinnedVersion, p.candidateVersion, p.access], ['0.1.0', '0.1.0', [{ kind: 'agent', id: 'helper', red: false }]]);
  assert.match(p.previewedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.deepEqual(gh.calls.slice(n).filter((c) => c.path.includes('/tarball/')).map((c) => c.path), [`/repos/acme/upd/tarball/${c3}`]);
  const full = await fetchCandidate('alpha-plugin', { fullDiff: true });
  assert.match(full.diffFull, /^diff --git a\/plugins\/alpha\/agents\/helper\.md b\/plugins\/alpha\/agents\/helper\.md\n/);
  writePluginsLock({ ...readPluginsLock(), 'alpha-plugin': { ...readPluginsLock()['alpha-plugin'], pinnedSha: c3 } });
  const same = await fetchCandidate('alpha-plugin');
  assert.deepEqual([same.commits, same.candidateVersion, same.access, same.manifestDelta], [[], '0.1.0', [], emptyManifestDelta()]);
});

test('formatDiffstat: git\'s summary words; a large change scales its bar to 50 columns', async () => {
  const { formatDiffstat } = await import('../src/core/git-free/plugin-repo.mjs');
  assert.equal(formatDiffstat([{ filename: 'a', additions: 1, deletions: 2, changes: 3 }]), ' a | 3 +--\n 1 file changed, 1 insertion(+), 2 deletions(-)');
  assert.equal(formatDiffstat([{ filename: 'b', additions: 100, deletions: 0, changes: 100 }]), ` b | 100 ${'+'.repeat(50)}\n 1 file changed, 100 insertions(+)`);
  assert.equal(formatDiffstat([]), '');
});

test('a root plugin exports the same tree over HTTPS as over git (no worca listing files inside the export)', async (t) => {
  const files = { 'worca-cc-plugin.json': MANIFEST('root-plugin'), 'index.mjs': INDEX, 'paths.json': '{"mine":true}\n' };
  const { bare, sha } = gh.repo('acme/rootp', { files });
  const viaGit = await exportVersion('root-git', sha, { repoUrl: bare, subdir: '' });
  withNoGit(t);
  const viaHttps = await exportVersion('root-https', sha, { repoUrl: 'https://github.com/acme/rootp', subdir: '' });
  assert.deepEqual(treeOf(viaHttps.versionDir), treeOf(viaGit.versionDir));
});

test('an install whose subdir leaves the repository is refused as git archive refuses it: no local folder is copied', async (t) => {
  const url = 'https://github.com/acme/upinst';
  const { bare, sha } = gh.repo('acme/upinst', { files: { 'p/worca-cc-plugin.json': MANIFEST('upinst'), 'p/index.mjs': INDEX } });
  const local = join(process.env.WORCA_HOME, 'local-folder');
  mkdirSync(local, { recursive: true });
  writeFileSync(join(local, 'worca-cc-plugin.json'), MANIFEST('local-folder'));
  writeFileSync(join(local, 'index.mjs'), INDEX);
  const up = relative(join(repoSnapshotRoot(url), sha), local).split(sep).join('/');   // passes the install route's segment rule
  await assert.rejects(installPlugin({ repoUrl: bare, subdir: up, name: 'up-git', sha }), /outside repository/);
  withNoGit(t);
  await assert.rejects(installPlugin({ repoUrl: url, subdir: up, name: 'up-https', sha }), { code: 'BAD_REQUEST', message: 'invalid subdir' });
  assert.deepEqual([readPluginsLock()['up-git'], readPluginsLock()['up-https']], [undefined, undefined]);
  assert.equal(existsSync(join(pluginDir('up-https'), 'versions', sha.slice(0, 7))), false);
});

test('an install at a commit where the plugin folder has no manifest fails validation as over git, never naming a cache path', async (t) => {
  const { bare, sha: old } = gh.repo('acme/early', { files: { 'p/index.mjs': INDEX, 'q/worca-cc-plugin.json': MANIFEST('q-plugin') } });
  gh.commit('acme/early', { files: { 'p/worca-cc-plugin.json': MANIFEST('early-plugin') } });
  const viaGit = await installPlugin({ repoUrl: bare, subdir: 'p', name: 'early-plugin', sha: old }).catch((e) => e);
  withNoGit(t);
  const viaHttps = await installPlugin({ repoUrl: 'https://github.com/acme/early', subdir: 'p', name: 'early-plugin', sha: old }).catch((e) => e);
  assert.deepEqual([viaHttps.message, viaGit.message], Array(2).fill('plugin "early-plugin" failed validation:\n  - worca-cc-plugin.json: missing'));
});

test('formatDiffstat right-aligns the change counts; a modified agent is not a new one; only the candidate is downloaded', async (t) => {
  const { formatDiffstat } = await import('../src/core/git-free/plugin-repo.mjs');
  assert.equal(formatDiffstat([{ filename: 'a', additions: 3, deletions: 0, changes: 3 }, { filename: 'b', additions: 12, deletions: 0, changes: 12 }]),
    ` a |  3 +++\n b | 12 ${'+'.repeat(12)}\n 2 files changed, 15 insertions(+)`);
  const meta = (order) => JSON.stringify({ metaVersion: 2, key: 'old', agentFile: 'old.md', displayName: 'Old', runnerType: 'producer', order,
    inputs: [{ id: 'task', type: 'md' }], outputs: [{ id: 'plan', type: 'md', filename: 'plan.md' }] });
  const { sha: v1 } = gh.repo('acme/agents', { files: { 'p/worca-cc-plugin.json': MANIFEST('ag-plugin'), 'p/index.mjs': INDEX,
    'p/agents/old.meta.json': meta(90), 'p/agents/old.md': '---\n---\nx\n' } });
  withNoGit(t);
  await installPlugin({ repoUrl: 'https://github.com/acme/agents', subdir: 'p', name: 'ag-plugin', sha: v1 });
  gh.commit('acme/agents', { message: 'touch agent', files: { 'p/agents/old.meta.json': meta(91) } });
  rmSync(join(repoSnapshotRoot('https://github.com/acme/agents'), v1), { recursive: true, force: true });   // as if installed with git
  const tarballs = (from) => gh.calls.slice(from).filter((c) => c.path.includes('/tarball/')).length;
  const n = gh.calls.length;
  const pv = await fetchCandidate('ag-plugin');
  assert.deepEqual(pv.manifestDelta.newAgents, []);
  assert.equal(tarballs(n), 2);   // the pinned commit once (its snapshot then stays while the plugin is pinned to it), the candidate
  const m = gh.calls.length;
  await fetchCandidate('ag-plugin');
  assert.equal(tarballs(m), 0);
});

test('consent inventory parity: escaping links dropped, setup commands carry the placeholder', async (t) => {
  const man = JSON.stringify({ ...JSON.parse(MANIFEST('inv-plugin')), setup: { node: true } });
  const files = { 'plugins/alpha/worca-cc-plugin.json': man, 'plugins/alpha/index.mjs': INDEX,
    'plugins/alpha/package.json': '{"name":"x","version":"1.0.0"}', 'plugins/alpha/package-lock.json': '{"lockfileVersion":3,"packages":{}}',
    ...(POSIX ? { 'plugins/alpha/agents/evil.meta.json': { link: '../../../../outside.meta.json' } } : {}) };
  const { bare, sha } = gh.repo('acme/inv7', { files });
  await addPluginRepo(bare);
  const viaGit = await inventoryFromCache(bare, sha, 'plugins/alpha');
  withNoGit(t);
  await addPluginRepo('https://github.com/acme/inv7');
  const viaHttps = await inventoryFromCache('https://github.com/acme/inv7', sha, 'plugins/alpha');
  assert.deepEqual(viaHttps, viaGit);
  assert.equal(viaHttps.agents.length, 0);
  assert.ok(viaHttps.setupCommands.length > 0 && viaHttps.setupCommands.every((c) => !c.includes('worca-cc-consent-')), JSON.stringify(viaHttps.setupCommands));
});

test('consent inventory parity: a link leaving the plugin folder (still inside the repository) is dropped as git drops it', { skip: !POSIX && 'symlinks need a privilege on Windows' }, async (t) => {
  const agent = (key) => `${JSON.stringify({ metaVersion: 2, key, agentFile: `${key}.md`, displayName: key, runnerType: 'producer', order: 90,
    inputs: [{ id: 'task', type: 'md' }], outputs: [{ id: 'plan', type: 'md', filename: 'plan.md' }] })}\n`;
  const files = { 'plugins/alpha/worca-cc-plugin.json': MANIFEST('near-alpha'), 'plugins/alpha/index.mjs': INDEX, 'plugins/alpha/agents': { link: '../beta/agents' },
    'plugins/beta/worca-cc-plugin.json': MANIFEST('near-beta'), 'plugins/beta/index.mjs': INDEX,
    'plugins/beta/agents/near.meta.json': agent('near'), 'plugins/beta/agents/near.md': '---\n---\nn\n' };
  const { bare, sha } = gh.repo('acme/near', { files });
  await addPluginRepo(bare);
  const viaGit = await inventoryFromCache(bare, sha, 'plugins/alpha');
  withNoGit(t);
  await addPluginRepo('https://github.com/acme/near');
  const viaHttps = await inventoryFromCache('https://github.com/acme/near', sha, 'plugins/alpha');
  assert.deepEqual(viaHttps, viaGit);
  assert.equal(viaHttps.agents.length, 0);
});

test('update preview reads the plugin folder of both commits, as git does: an agent moved in is new, a renamed one is not', async (t) => {
  const files = { 'plugins/alpha/worca-cc-plugin.json': MANIFEST('mv-alpha'), 'plugins/alpha/index.mjs': INDEX,
    'plugins/alpha/bin/run.sh': '#!/bin/sh\n',
    'plugins/beta/worca-cc-plugin.json': MANIFEST('mv-beta'), 'plugins/beta/index.mjs': INDEX,
    'plugins/beta/agents/mover.meta.json': '{"k":1}\n', 'plugins/beta/agents/mover.md': '---\n---\nm\n' };
  const agent = (key) => `${JSON.stringify({ metaVersion: 2, key, agentFile: `${key}.md`, displayName: key, runnerType: 'producer', order: 90,
    inputs: [{ id: 'task', type: 'md' }], outputs: [{ id: 'plan', type: 'md', filename: 'plan.md' }] })}\n`;
  const twoSources = JSON.stringify({ ...JSON.parse(MANIFEST('mv-alpha')),
    taskSources: [...JSON.parse(MANIFEST('mv-alpha')).taskSources, { id: 'extra', module: './index.mjs', inputs: [{ key: 'task', type: 'task-browser' }] }] });
  files['plugins/alpha/agents/stay.meta.json'] = agent('stay');
  files['plugins/alpha/agents/stay.md'] = '---\n---\ns\n';
  const { bare, sha: v1 } = gh.repo('acme/mv', { files });
  await installPlugin({ repoUrl: bare, subdir: 'plugins/alpha', name: 'mv-git', sha: v1 });
  gh.commit('acme/mv', { message: 'move mover\ninto alpha\n\nbody', files: {
    'plugins/beta/agents/mover.meta.json': null, 'plugins/beta/agents/mover.md': null,
    'plugins/alpha/agents/mover.meta.json': '{"k":1}\n', 'plugins/alpha/agents/mover.md': '---\n---\nm\n',
    'plugins/alpha/agents/stay.meta.json': null, 'plugins/alpha/agents/stay.md': null,
    'plugins/alpha/agents/renamed.meta.json': agent('stay'), 'plugins/alpha/agents/renamed.md': '---\n---\ns\n',
    'plugins/alpha/worca-cc-plugin.json': twoSources, ...(POSIX ? { 'plugins/alpha/bin/run.sh': { exec: '#!/bin/sh\n' } } : {}) } });
  const viaGit = await fetchCandidate('mv-git');
  withNoGit(t);
  await installPlugin({ repoUrl: 'https://github.com/acme/mv', subdir: 'plugins/alpha', name: 'mv-https', sha: v1 });
  const viaHttps = await fetchCandidate('mv-https');
  assert.deepEqual(viaGit.manifestDelta.newAgents, ['mover']);
  assert.deepEqual([viaHttps.manifestDelta, viaHttps.commits], [viaGit.manifestDelta, viaGit.commits]);
  assert.deepEqual([viaHttps.commits.map((c) => c.subject), viaHttps.manifestDelta.newTaskSources.length], [['move mover into alpha'], 1]);
  // worca's diffstat lists a rename as its removal and its addition (git prints {stay.md => renamed.md}); a mode change is a 0 row.
  const rows = viaHttps.diffstat.split('\n').map((l) => l.trim().replace(/ +\| +/, ' | '));
  assert.deepEqual(rows, ['plugins/alpha/agents/mover.md | 3 +++', 'plugins/alpha/agents/mover.meta.json | 1 +', 'plugins/alpha/agents/renamed.md | 3 +++',
    'plugins/alpha/agents/renamed.meta.json | 1 +', 'plugins/alpha/agents/stay.md | 3 ---', 'plugins/alpha/agents/stay.meta.json | 1 -',
    ...(POSIX ? ['plugins/alpha/bin/run.sh | 0'] : []), 'plugins/alpha/worca-cc-plugin.json | 2 +-',
    `${POSIX ? 8 : 7} files changed, 9 insertions(+), 5 deletions(-)`]);
});

test('update preview after a rewritten history (no commit in common): no commit list, the review still read from both trees', async (t) => {
  const { sha: v1 } = gh.repo('acme/orph', { files: { 'p/worca-cc-plugin.json': MANIFEST('orph-plugin'), 'p/index.mjs': INDEX } });
  withNoGit(t);
  await installPlugin({ repoUrl: 'https://github.com/acme/orph', subdir: 'p', name: 'orph-plugin', sha: v1 });
  const c2 = gh.commit('acme/orph', { orphan: true, message: 'squashed', files: { 'p/worca-cc-plugin.json': MANIFEST('orph-plugin'),
    'p/index.mjs': `${INDEX}// v2\n`, 'p/agents/a.meta.json': '{}', 'p/agents/a.md': 'a\n' } });
  const p = await fetchCandidate('orph-plugin');
  assert.deepEqual([p.candidateSha, p.commits, p.manifestDelta.newAgents], [c2, [], ['a']]);
  const row = (name, changes, bar) => ` ${name.padEnd(20)} | ${changes} ${bar}`;
  assert.equal(p.diffstat, [row('p/agents/a.md', 1, '+').trimStart(), row('p/agents/a.meta.json', 1, '+'), row('p/index.mjs', 1, '+'),
    ' 3 files changed, 3 insertions(+)'].join('\n'));
});

test('update preview does not trust compare\'s file list (cut at 300 files): the plugin\'s change and its new agent still show', async (t) => {
  const { sha: v1 } = gh.repo('acme/cut', { files: { 'p/worca-cc-plugin.json': MANIFEST('cut-plugin'), 'p/index.mjs': INDEX } });
  withNoGit(t);
  await installPlugin({ repoUrl: 'https://github.com/acme/cut', subdir: 'p', name: 'cut-plugin', sha: v1 });
  gh.commit('acme/cut', { message: 'evil', files: { 'p/agents/evil.meta.json': '{}', 'p/agents/evil.md': 'x\n' } });
  ghTesting.setFetch(async (url, init) => {
    const r = await gh.fetch(url, init);
    if (!String(url).includes('/compare/')) return r;
    return new Response(JSON.stringify({ ...(await r.json()), files: [] }), { status: r.status, headers: { 'content-type': 'application/json' } });
  });
  try {
    const p = await fetchCandidate('cut-plugin');
    assert.deepEqual([p.manifestDelta.newAgents, p.commits.map((c) => c.subject)], [['evil'], ['evil']]);
    assert.match(p.diffstat, / 2 files changed, 2 insertions\(\+\)$/);
  } finally { ghTesting.setFetch(gh.fetch); }
});

test('formatDiffstat: a binary row says Bin with both sizes; a row without line changes ends at its count', async () => {
  const { formatDiffstat, formatPatch } = await import('../src/core/git-free/plugin-repo.mjs');
  assert.equal(formatDiffstat([{ filename: 'img.png', binary: true, oldSize: 10, newSize: 12, additions: 0, deletions: 0, changes: 0 },
    { filename: 'run.sh', additions: 0, deletions: 0, changes: 0 }]), ' img.png | Bin 10 -> 12 bytes\n run.sh  |   0\n 2 files changed, 0 insertions(+), 0 deletions(-)');
  assert.equal(formatPatch([{ filename: 'run.sh', status: 'modified', oldMode: '100644', newMode: '100755', hunk: [] },
    { filename: 'img.png', status: 'added', oldMode: null, newMode: '100644', binary: true }]),
  'diff --git a/run.sh b/run.sh\nold mode 100644\nnew mode 100755\ndiff --git a/img.png b/img.png\nnew file mode 100644\nBinary files /dev/null and b/img.png differ');
});

test('update preview: names with a newline, an escape, a tab, a quote or a non-ASCII letter print as git prints them (C-quoted)', { skip: !POSIX && 'such names cannot be written on Windows' }, async (t) => {
  const odd = ['p/notes\n 0 files changed.md', 'p/\u001b[8mhidden.md', 'p/a\tb.md', 'p/say "hi".md', 'p/café.md', 'p/plain.md'];
  const { bare, sha: v1 } = gh.repo('acme/names', { files: { 'p/worca-cc-plugin.json': MANIFEST('names'), 'p/index.mjs': INDEX } });
  await installPlugin({ repoUrl: bare, subdir: 'p', name: 'names-git', sha: v1 });
  gh.commit('acme/names', { message: 'odd names', files: { ...Object.fromEntries(odd.map((p, i) => [p, `${i}\n`])), 'p/agents/fresh.meta.json': '{}\n' } });
  const viaGit = await fetchCandidate('names-git', { fullDiff: true });
  withNoGit(t);
  await installPlugin({ repoUrl: 'https://github.com/acme/names', subdir: 'p', name: 'names-https', sha: v1 });
  const viaHttps = await fetchCandidate('names-https', { fullDiff: true });
  assert.equal(viaHttps.diffstat, viaGit.diffstat);
  assert.match(viaHttps.diffstat, /^ "p\/notes\\n 0 files changed\.md" \| 1 \+$/m);   // one row: the newline cannot forge another
  const heads = (diff) => diff.split('\n').filter((l) => /^(diff --git|new file mode|--- |\+\+\+ )/.test(l));
  assert.deepEqual(heads(viaHttps.diffFull), heads(viaGit.diffFull));
  assert.deepEqual([viaHttps.manifestDelta.newAgents, viaGit.manifestDelta.newAgents], [['fresh'], ['fresh']]);
});

test('formatDiffstat and formatPatch C-quote a name as git does: control characters, DEL, a quote, a backslash, bytes past ASCII', async () => {
  const { formatDiffstat, formatPatch } = await import('../src/core/git-free/plugin-repo.mjs');
  const row = (filename) => ({ filename, status: 'added', oldMode: null, newMode: '100644', additions: 1, deletions: 0, changes: 1, hunk: ['@@ -0,0 +1 @@', '+x'] });
  assert.equal(formatDiffstat(['a\nb', 'c\u001b[8m', 'é', 'q"\\', '\u0001\u007f', 'my file'].map(row)), [' "a\\nb"     | 1 +', ' "c\\033[8m" | 1 +',
    ' "\\303\\251" | 1 +', ' "q\\"\\\\"    | 1 +', ' "\\001\\177" | 1 +', ' my file    | 1 +', ' 6 files changed, 6 insertions(+)'].join('\n'));
  assert.equal(formatPatch([row('a\nb'), row('my file')]), ['diff --git "a/a\\nb" "b/a\\nb"', 'new file mode 100644', '--- /dev/null', '+++ "b/a\\nb"',
    '@@ -0,0 +1 @@', '+x', 'diff --git a/my file b/my file', 'new file mode 100644', '--- /dev/null', '+++ b/my file\t', '@@ -0,0 +1 @@', '+x'].join('\n'));
});

test('with git installed every plugin git function keeps git for a GitHub URL: the fake sees no request', async () => {
  const { sha } = gh.repo('acme/keep', { files: { 'worca-cc-plugin.json': '{}' } });
  const url = 'https://github.com/acme/keep';
  writePluginsLock({ ...readPluginsLock(), keep: { repo: url, subdir: '', pinnedSha: 'a'.repeat(40), version: '0.1.0', enabled: true } });
  const n = gh.calls.length;
  let spawns = 0;
  const exec = async () => { spawns += 1; throw Object.assign(new Error('stop'), { stderr: 'fatal: stop' }); };
  await assert.rejects(exportVersion('keep2', sha, { repoUrl: url, exec }), /stop/);
  await assert.rejects(fetchCandidate('keep', { exec }), /stop/);
  await assert.rejects(inventoryFromCache(url, sha, '', { exec }), /stop/);
  assert.deepEqual([spawns, gh.calls.length], [3, n]);
});

test('update preview: a candidate commit without the plugin\'s manifest is a bad request naming it, never a cache path', async (t) => {
  const { sha: v1 } = gh.repo('acme/gone', { files: { 'p/worca-cc-plugin.json': MANIFEST('gone-plugin'), 'p/index.mjs': INDEX, 'q/x.md': 'x\n' } });
  withNoGit(t);
  await installPlugin({ repoUrl: 'https://github.com/acme/gone', subdir: 'p', name: 'gone-plugin', sha: v1 });
  const c2 = gh.commit('acme/gone', { message: 'drop the manifest', files: { 'p/worca-cc-plugin.json': null } });
  await assert.rejects(fetchCandidate('gone-plugin'), (e) => e.code === 'BAD_REQUEST' && !e.message.includes('.cache')
    && e.message === `plugin "gone-plugin": p has no worca-cc-plugin.json at ${c2.slice(0, 7)}`);
});

test('update preview: a root plugin whose candidate commit drops its manifest is a bad request naming the repository root', async (t) => {
  const { sha: v1 } = gh.repo('acme/rootgone', { files: { 'worca-cc-plugin.json': MANIFEST('rootgone-plugin'), 'index.mjs': INDEX } });
  withNoGit(t);
  await installPlugin({ repoUrl: 'https://github.com/acme/rootgone', subdir: '', name: 'rootgone-plugin', sha: v1 });
  const c2 = gh.commit('acme/rootgone', { message: 'drop the manifest', files: { 'worca-cc-plugin.json': null } });
  await assert.rejects(fetchCandidate('rootgone-plugin'),
    { code: 'BAD_REQUEST', message: `plugin "rootgone-plugin": the repository root has no worca-cc-plugin.json at ${c2.slice(0, 7)}` });
});

test('with git, a malformed candidate manifest fails before the agents diff and the skills export, as it always did', async () => {
  const { bare, sha: v1 } = gh.repo('acme/order', { files: { 'worca-cc-plugin.json': MANIFEST('order-plugin'), 'index.mjs': INDEX,
    'skills/a/SKILL.md': '---\nname: a\ndescription: d\n---\n' } });
  await installPlugin({ repoUrl: bare, subdir: '', name: 'order-plugin', sha: v1 });
  gh.commit('acme/order', { files: { 'worca-cc-plugin.json': JSON.stringify({ name: 'order-plugin', version: '0.2.0', taskSources: { x: 1 } }) } });
  const calls = [];
  const exec = (cmd, args, opts = {}) => { calls.push([cmd, ...args].join(' ')); return promisify(execFile)(cmd, args, { maxBuffer: 2 ** 26, ...opts }); };
  await assert.rejects(fetchCandidate('order-plugin', { exec }), TypeError);
  assert.deepEqual(calls.filter((c) => /--name-status| archive |^tar /.test(c)), []);
  assert.match(calls.at(-1), / show [0-9a-f]{40}:worca-cc-plugin\.json$/);
});

test('a new scripts/*.meta.json is not a new agent, for a root plugin and a subdir one, as git reads it', async (t) => {
  const cases = [];
  for (const [repo, subdir] of [['scr-root', ''], ['scr-sub', 'p']]) {
    const at = (p) => (subdir ? `${subdir}/${p}` : p);
    const { bare, sha } = gh.repo(`acme/${repo}`, { files: { [at('worca-cc-plugin.json')]: MANIFEST(repo), [at('index.mjs')]: INDEX } });
    await installPlugin({ repoUrl: bare, subdir, name: `${repo}-git`, sha });
    gh.commit(`acme/${repo}`, { files: { [at('scripts/x.meta.json')]: '{}', [at('scripts/x.mjs')]: 'x\n' } });
    cases.push({ repo, subdir, sha, viaGit: await fetchCandidate(`${repo}-git`) });
  }
  withNoGit(t);
  for (const { repo, subdir, sha, viaGit } of cases) {
    await installPlugin({ repoUrl: `https://github.com/acme/${repo}`, subdir, name: `${repo}-https`, sha });
    const viaHttps = await fetchCandidate(`${repo}-https`);
    assert.deepEqual([viaHttps.manifestDelta.newAgents, viaHttps.manifestDelta], [[], viaGit.manifestDelta]);
  }
});

test('an escaping link in a sibling plugin is not in this plugin\'s export warnings', { skip: !POSIX && 'symlinks need a privilege on Windows' }, async (t) => {
  const { bare, sha } = gh.repo('acme/sib', { files: { 'plugins/alpha/worca-cc-plugin.json': MANIFEST('sib-alpha'), 'plugins/alpha/index.mjs': INDEX,
    'plugins/beta/worca-cc-plugin.json': MANIFEST('sib-beta'), 'plugins/beta/out': { link: '../../../x' },
    'plugins/alpha-x/worca-cc-plugin.json': MANIFEST('sib-alpha-x'), 'plugins/alpha-x/out': { link: '../../../x' } } });
  const viaGit = await exportVersion('sib-git', sha, { repoUrl: bare, subdir: 'plugins/alpha' });
  withNoGit(t);
  const url = 'https://github.com/acme/sib';
  const viaHttps = await exportVersion('sib-https', sha, { repoUrl: url, subdir: 'plugins/alpha' });
  assert.deepEqual([viaHttps.warnings, viaGit.warnings], [[], []]);
  assert.deepEqual((await exportVersion('sib-beta', sha, { repoUrl: url, subdir: 'plugins/beta' })).warnings, ['removed symlink escaping the export dir: out']);
});

test('a lock ref naming only a tag is not a branch: refused as git refuses it', async (t) => {
  const { bare, sha } = gh.repo('acme/tagref', { files: { 'p/worca-cc-plugin.json': MANIFEST('tagref'), 'p/index.mjs': INDEX } });
  gh.tag('acme/tagref', 'v1', sha);
  const pin = { subdir: 'p', pinnedSha: sha, version: '0.1.0', enabled: true, ref: 'v1' };
  writePluginsLock({ ...readPluginsLock(), 'tagref-git': { ...pin, repo: bare }, 'tagref-https': { ...pin, repo: 'https://github.com/acme/tagref' } });
  await assert.rejects(fetchCandidate('tagref-git'), /^Error: branch "v1" not found$/);
  withNoGit(t);
  await assert.rejects(fetchCandidate('tagref-https'), /^Error: branch "v1" not found$/);
});

test('an update preview of a plugin pinned by a tag or an abbreviated sha keeps its pinned snapshot while newer commits are read', async (t) => {
  withNoGit(t);
  for (const [repo, pinOf] of [['tagpin', () => 'v1'], ['abbrevpin', (sha) => sha.slice(0, 7)]]) {
    const url = `https://github.com/acme/${repo}`;
    const { sha: v1 } = gh.repo(`acme/${repo}`, { files: { 'p/worca-cc-plugin.json': MANIFEST(repo), 'p/index.mjs': INDEX } });
    gh.tag(`acme/${repo}`, 'v1', v1);
    await installPlugin({ repoUrl: url, subdir: 'p', name: repo, sha: pinOf(v1) });
    for (let i = 2; i <= 3; i++) {
      gh.commit(`acme/${repo}`, { files: { 'p/index.mjs': `${INDEX}// ${i}\n` } });
      await addPluginRepo(url);   // a marketplace refresh reads each new tip
    }
    gh.commit(`acme/${repo}`, { files: { 'p/index.mjs': `${INDEX}// 4\n` } });
    const p = await fetchCandidate(repo);   // the candidate's snapshot is the fourth: its build prunes
    assert.deepEqual([p.pinnedSha, p.diffstat.split('\n').at(-1)], [pinOf(v1), ' 1 file changed, 1 insertion(+)']);
  }
});

test('the update review diffs within one time budget, off the server\'s thread: many large changes never stall the server', async (t) => {
  const { _testing: reviewTesting } = await import('../src/core/git-free/plugin-repo.mjs');
  reviewTesting.setReviewBudget(800);
  t.after(() => reviewTesting.setReviewBudget(null));
  // ~78 kB of alternating lines with an edit every 50 lines: about 250 ms of diffing per file on a laptop, ~6 s for all 24
  const base = Array.from({ length: 40_000 }, (_, i) => (i % 2 ? 'b' : 'a')).join('\n') + '\n';
  const edited = base.split('\n').map((l, i) => (i % 50 === 0 && i < 39_990 ? 'c' : l)).join('\n');
  // One file's diff on this thread, as the review asks jsdiff for it: the yardstick for a stall, whatever the runner's speed.
  const t0 = performance.now();
  structuredPatch('', '', base, edited, '', '', { context: 3, maxEditLength: PATCH_MAX_EDIT_LENGTH, timeout: PATCH_DIFF_TIMEOUT_MS });
  const oneDiff = performance.now() - t0;
  const v1 = { 'p/worca-cc-plugin.json': MANIFEST('budget-plugin'), 'p/index.mjs': INDEX };
  const v2 = {};
  for (let i = 0; i < 24; i++) { const f = `p/data/f${String(i).padStart(2, '0')}.txt`; v1[f] = base; v2[f] = edited; }
  const url = 'https://github.com/acme/budget';
  const { sha } = gh.repo('acme/budget', { files: v1 });
  gh.commit('acme/budget', { message: 'regenerate', files: v2 });
  writePluginsLock({ ...readPluginsLock(), 'budget-plugin': { repo: url, subdir: 'p', pinnedSha: sha, version: '0.1.0', enabled: true } });
  withNoGit(t);
  // The fake server answers with a synchronous git call per request (tree listings, archives, compare): the clock starts at
  // the review's first yield, once both snapshots are built, so only worca's own work is timed.
  let stall = 0;
  let last;
  let tick;
  let yields = 0;
  const lap = () => { const now = performance.now(); stall = Math.max(stall, now - last); last = now; };
  reviewTesting.setReviewYield(async () => {
    if (!yields++) { last = performance.now(); tick = setInterval(lap, 10); }
    await new Promise((r) => setImmediate(r));
  });
  t.after(() => reviewTesting.setReviewYield(null));
  let p;
  try { p = await fetchCandidate('budget-plugin'); } finally { if (tick) { clearInterval(tick); lap(); } }
  assert.equal(yields, 24);   // one yield before each file's diff
  assert.ok(stall < oneDiff / 2, `the event loop stalled ${Math.round(stall)} ms; one file's diff takes ${Math.round(oneDiff)} ms`);
  // A file past the budget is one whole-file hunk, counted as a jsdiff timeout is: every old line out, every new one in.
  assert.match(p.diffstat.split('\n')[23], /^ p\/data\/f23\.txt \| 80000 /);
});

test('a read of another commit pruning the candidate\'s snapshot while the review yields never fails the preview', async (t) => {
  const { _testing: reviewTesting } = await import('../src/core/git-free/plugin-repo.mjs');
  const url = 'https://github.com/acme/prunerace';
  const { sha } = gh.repo('acme/prunerace', { files: { 'p/worca-cc-plugin.json': MANIFEST('prunerace'), 'p/index.mjs': INDEX, 'p/a.md': 'a\n' } });
  withNoGit(t);
  await installPlugin({ repoUrl: url, subdir: 'p', name: 'prunerace', sha });
  const tip = gh.commit('acme/prunerace', { message: 'edit', files: { 'p/index.mjs': `${INDEX}// v2\n`, 'p/a.md': 'b\n' } });
  // Another process builds a newer commit of this repository during the review, and its prune removes the candidate's
  // folder (a cache hit, older than the three newest): the meta file first, then the folder.
  let pruned = 0;
  reviewTesting.setReviewYield(async () => {
    if (!pruned++) {
      const root = repoSnapshotRoot(url);
      rmSync(join(root, `${tip}.meta.json`), { force: true });
      rmSync(join(root, tip), { recursive: true, force: true });
    }
    await new Promise((r) => setImmediate(r));
  });
  t.after(() => reviewTesting.setReviewYield(null));
  const p = await fetchCandidate('prunerace');
  assert.deepEqual([pruned, p.candidateSha, p.diffstat.split('\n').at(-1)], [2, tip, ' 2 files changed, 2 insertions(+), 1 deletion(-)']);
});

test('setup commands without git find worca\'s git stub first on PATH (macOS), so npm never reaches the CLT shim; with git the call is unchanged', async (t) => {
  const dir = join(process.env.WORCA_HOME, 'setup-env');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'package-lock.json'), '{}');
  const calls = [];
  const exec = async (cmd, args, opts) => { calls.push([cmd, opts]); return { stdout: '', stderr: '' }; };
  const manifest = { setup: { node: true, python: 'pyproject' } };
  await runSetup(dir, manifest, { exec });
  assert.deepEqual(calls.map(([cmd, o]) => [cmd, o.cwd, o.shell, o.env.PATH]), [['npm', dir, !POSIX, process.env.PATH], ['uv', dir, undefined, process.env.PATH]]);
  calls.length = 0;
  stubTesting.setPlatform('darwin');
  t.after(() => stubTesting.setPlatform(null));
  withNoGit(t);
  await runSetup(dir, manifest, { exec });
  assert.deepEqual(calls.map(([cmd, o]) => [cmd, o.cwd, o.env.PATH.split(':')[0]]), [['npm', dir, noGitBinDir()], ['uv', dir, noGitBinDir()]]);
});

test('setup (npm ci, uv sync) runs with the plugin child env: no secret of worca\'s, the cache, index, proxy and CA names kept (audit 3.5)', async (t) => {
  const dir = join(process.env.WORCA_HOME, 'setup-secrets');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'package-lock.json'), '{}');
  const secrets = { GH_TOKEN: 'gh', ANTHROPIC_API_KEY: 'ak', OPENAI_API_KEY: 'ok', E2B_API_KEY: 'e2b', NPM_TOKEN: 'npm',
    WORCA_HEARTBEAT_TOKEN: 'hb', AWS_SECRET_ACCESS_KEY: 'aws', SOME_PROJECT_VAR: 'x', UV_INDEX_URL: 'https://u:tok@pypi.corp/simple' };
  const kept = { npm_config_cache: '/c/npm', UV_CACHE_DIR: '/c/uv', npm_config_registry: 'https://registry.corp/', HTTPS_PROXY: 'http://p:3128',
    npm_config_cafile: '/ca/npm.pem', NPM_CONFIG_CAFILE: '/ca/NPM.pem', npm_config_https_proxy: 'http://p:3128', UV_NATIVE_TLS: '1',
    REQUESTS_CA_BUNDLE: '/ca/req.pem', SSL_CERT_FILE: '/ca/ssl.pem', ALL_PROXY: 'socks5://p:1080' };
  const saved = Object.fromEntries(Object.keys({ ...secrets, ...kept }).map((k) => [k, process.env[k]]));
  Object.assign(process.env, secrets, kept);
  t.after(() => { for (const [k, v] of Object.entries(saved)) if (v === undefined) delete process.env[k]; else process.env[k] = v; });
  const calls = [];
  await runSetup(dir, { setup: { node: true, python: 'pyproject' } }, { exec: async (cmd, args, opts) => { calls.push([cmd, opts.env]); return { stdout: '', stderr: '' }; } });
  assert.deepEqual(calls.map(([cmd]) => cmd), ['npm', 'uv']);
  for (const [cmd, env] of calls) {
    for (const k of Object.keys(secrets)) assert.equal(env[k], undefined, `${cmd}: ${k}`);
    for (const [k, v] of Object.entries(kept)) assert.equal(env[k], v, `${cmd}: ${k}`);
    assert.ok(env.PATH && env.HOME, `${cmd}: PATH and HOME`);
  }
});

test('uninstall renames the snapshot root aside before removing it: a removal that stops half-way leaves no snapshot behind', STUCK, async (t) => {
  const url = 'https://github.com/acme/unaside';
  const { sha } = gh.repo('acme/unaside', { files: { 'p/worca-cc-plugin.json': MANIFEST('unaside'), 'p/index.mjs': INDEX } });
  withNoGit(t);
  await installPlugin({ repoUrl: url, subdir: 'p', name: 'unaside', sha });
  const root = repoSnapshotRoot(url);
  const ro = (d) => join(d, sha, 'p');
  chmodSync(ro(root), 0o555);   // its files cannot be removed
  try {
    assert.equal((await uninstallPlugin('unaside')).ok, true);
    assert.equal(existsSync(root), false);
  } finally {
    const trash = readdirSync(dirname(root)).filter((n) => n.startsWith(`${basename(root)}.trash-`)).map((n) => join(dirname(root), n));
    for (const d of [root, ...trash]) if (existsSync(ro(d))) chmodSync(ro(d), 0o755);
  }
});

test('update preview lists only the plugin folder\'s commits, over git and over HTTPS alike', async (t) => {
  const { bare, sha: v1 } = gh.repo('acme/scope', { files: {
    'plugins/alpha/worca-cc-plugin.json': MANIFEST('scope-alpha'), 'plugins/alpha/index.mjs': INDEX, 'other/x.md': 'x\n' } });
  await installPlugin({ repoUrl: bare, subdir: 'plugins/alpha', name: 'scope-git', sha: v1 });
  const c2 = gh.commit('acme/scope', { message: 'alpha change', files: { 'plugins/alpha/index.mjs': `${INDEX}// v2\n` } });
  gh.commit('acme/scope', { message: 'other only', files: { 'other/x.md': 'y\n' } });
  const c4 = gh.commit('acme/scope', { message: 'both', files: { 'other/x.md': 'z\n', 'plugins/alpha/index.mjs': `${INDEX}// v3\n`,
    'plugins/alpha/worca-cc-plugin.json': MANIFEST('scope-alpha').replace('0.1.0', '0.2.0') } });
  const viaGit = await fetchCandidate('scope-git');
  withNoGit(t);
  await installPlugin({ repoUrl: 'https://github.com/acme/scope', subdir: 'plugins/alpha', name: 'scope-https', sha: v1 });
  const n = gh.calls.length;
  const viaHttps = await fetchCandidate('scope-https');
  const pick = (p) => [p.commits, p.manifestDelta, p.access, p.pinnedVersion, p.candidateVersion];
  assert.deepEqual(viaGit.commits.map((c) => [c.sha, c.subject]), [[c4, 'both'], [c2, 'alpha change']]);
  assert.deepEqual([viaGit.pinnedVersion, viaGit.candidateVersion], ['0.1.0', '0.2.0'], 'the candidate commit\'s own version');
  assert.deepEqual(pick(viaHttps), pick(viaGit));
  assert.ok(gh.calls.slice(n).some((c) => c.path === '/repos/acme/scope/commits' && /path=plugins%2Falpha/.test(c.query)),
    'the folder\'s commits came from GitHub\'s commit list');
});

test('update preview over HTTPS pages GitHub\'s folder commit list: a range of 101 folder commits needs a second page', async (t) => {
  const { sha: v1 } = gh.repo('acme/pages', { files: { 'p/worca-cc-plugin.json': MANIFEST('pages-plugin'), 'p/index.mjs': INDEX } });
  const shas = [];
  for (let i = 0; i < 101; i++) shas.unshift(gh.commit('acme/pages', { message: `c${i}`, files: { 'p/index.mjs': `${INDEX}// ${i}\n` } }));
  withNoGit(t);
  await installPlugin({ repoUrl: 'https://github.com/acme/pages', subdir: 'p', name: 'pages-plugin', sha: v1 });
  const n = gh.calls.length;
  const p = await fetchCandidate('pages-plugin');
  assert.deepEqual(p.commits.map((c) => c.sha), shas);
  assert.deepEqual(gh.calls.slice(n).filter((c) => c.path === '/repos/acme/pages/commits').map((c) => new URLSearchParams(c.query).get('page')), ['1', '2']);
});

test('update preview over HTTPS: an answer that is not a commit list scopes nothing — the range stays whole, never empty', async (t) => {
  const { sha: v1 } = gh.repo('acme/odd', { files: { 'p/worca-cc-plugin.json': MANIFEST('odd-plugin'), 'p/index.mjs': INDEX, 'q.md': 'q\n' } });
  withNoGit(t);
  await installPlugin({ repoUrl: 'https://github.com/acme/odd', subdir: 'p', name: 'odd-plugin', sha: v1 });
  const c2 = gh.commit('acme/odd', { message: 'p change', files: { 'p/index.mjs': `${INDEX}// v2\n` } });
  const c3 = gh.commit('acme/odd', { message: 'q only', files: { 'q.md': 'r\n' } });
  ghTesting.setFetch(async (url, init) => {
    if (!new URL(String(url)).pathname.endsWith('/commits')) return gh.fetch(url, init);
    return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
  });
  try {
    const p = await fetchCandidate('odd-plugin');
    assert.deepEqual(p.commits.map((c) => [c.sha, c.subject]), [[c3, 'q only'], [c2, 'p change']]);
  } finally { ghTesting.setFetch(gh.fetch); }
});

test('without git too, a pin whose version dir would leave versions/ is refused before anything is read or removed (G8)', async (t) => {
  const { sha } = gh.repo('acme/trav', { files: { 'p/worca-cc-plugin.json': MANIFEST('trav-plugin'), 'p/index.mjs': INDEX } });
  writePluginsLock({ ...readPluginsLock(), canary: { repo: 'https://github.com/acme/trav', subdir: 'p', pinnedSha: sha, version: '0.1.0', enabled: true } });
  withNoGit(t);
  for (const rev of ['../../.', '..', 'a/../..', '-c']) {
    await assert.rejects(exportVersion('trav-plugin', rev, { repoUrl: 'https://github.com/acme/trav', subdir: 'p' }), /invalid revision/, rev);
  }
  assert.equal(readPluginsLock().canary.pinnedSha, sha, 'plugins store untouched');
});
