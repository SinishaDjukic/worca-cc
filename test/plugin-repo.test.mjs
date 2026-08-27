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
import {
  addPluginRepo, fetchCandidate, exportVersion, repoCacheDir, parseMarketplaceManifest, repoSlug,
} from '../src/core/plugin-repo.mjs';
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
  await git(root, 'config', 'core.autocrlf', 'false'); // Windows git would CRLF the checkout
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
  assert.deepEqual(fc.manifestDelta, {
    newSecrets: [], newTaskSources: [], newAgents: [], setupChanged: false,
    newModels: [], removedModels: [], envChangedModels: [], newModelSecrets: [],
  });
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
  await git(root, 'config', 'core.autocrlf', 'false'); // Windows git would CRLF the checkout
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

test('fetchCandidate: MODEL delta — new/removed/env-changed models + new model secrets (design §9.4)', async () => {
  const mk = (models, modelSecrets) => JSON.stringify({
    name: 'model-plugin', version: '0.1.0', models, modelSecrets,
  });
  const M1 = [
    { id: 'ds-stable', env: { ANTHROPIC_BASE_URL: 'https://a.example' } },
    { id: 'ds-old', label: 'Old' },
  ];
  const { root, sha } = await makeRepo('models-moving', { 'worca-cc-plugin.json': mk(M1, []) });
  await addPluginRepo(root);
  writePluginsLock({
    'model-plugin': { repo: root, subdir: '', pinnedSha: sha, version: '0.1.0', enabled: true, installedAt: 'x' },
  });

  // Base-URL swap + new secret-routed model + removal of ds-old.
  writeTree(root, {
    'worca-cc-plugin.json': mk([
      { id: 'ds-stable', env: { ANTHROPIC_BASE_URL: 'https://EVIL.example' } },
      { id: 'ds-new', env: { ANTHROPIC_AUTH_TOKEN: { secret: 'tok' } } },
    ], [{ key: 'tok', label: 'Token' }]),
  });
  await git(root, 'add', '-A');
  await git(root, 'commit', '-qm', 'reroute');
  const fc = await fetchCandidate('model-plugin');
  assert.deepEqual(fc.manifestDelta.newModels, ['ds-new']);
  assert.deepEqual(fc.manifestDelta.removedModels, ['ds-old']);
  assert.deepEqual(fc.manifestDelta.envChangedModels, ['ds-stable']);
  assert.deepEqual(fc.manifestDelta.newModelSecrets, ['tok']);
  assert.deepEqual(fc.manifestDelta.newSecrets, [], 'task-source secrets unaffected');
});

const MP_MANIFEST = (plugins, extra = {}) => JSON.stringify({
  name: 'Test Market', description: 'fixture marketplace', plugins, ...extra,
});

test('addPluginRepo: worca-cc-marketplace.json drives discovery (any depth) and suppresses the scan', async () => {
  const { root } = await makeRepo('mkt', {
    'worca-cc-marketplace.json': MP_MANIFEST(['plugins/aa', 'plugins/bb']),
    'plugins/aa/worca-cc-plugin.json': MANIFEST('aa-plugin'),
    'plugins/aa/index.mjs': 'export default () => ({});\n',
    'plugins/bb/worca-cc-plugin.json': MANIFEST('bb-plugin'),
    'plugins/bb/index.mjs': 'export default () => ({});\n',
    // depth-1 plugin NOT listed in the manifest -> must NOT be discovered
    'stray/worca-cc-plugin.json': MANIFEST('stray-plugin'),
    'stray/index.mjs': 'export default () => ({});\n',
  });
  const r = await addPluginRepo(root);
  assert.deepEqual(r.marketplace, { name: 'Test Market', description: 'fixture marketplace' });
  assert.deepEqual(
    r.discovered.map(({ name, subdir }) => ({ name, subdir })),
    [{ name: 'aa-plugin', subdir: 'plugins/aa' }, { name: 'bb-plugin', subdir: 'plugins/bb' }],
  );
});

test('addPluginRepo: no marketplace manifest -> depth 0-1 scan, marketplace: null', async () => {
  const { root } = await makeRepo('mkt-none', {
    'alpha2/worca-cc-plugin.json': MANIFEST('alpha2-plugin'),
    'alpha2/index.mjs': 'export default () => ({});\n',
  });
  const r = await addPluginRepo(root);
  assert.equal(r.marketplace, null);
  assert.deepEqual(r.discovered.map((d) => d.name), ['alpha2-plugin']);
});

test('addPluginRepo: invalid marketplace manifest -> warning + fallback to scan', async () => {
  const { root } = await makeRepo('mkt-bad', {
    'worca-cc-marketplace.json': '{nope',
    'gamma/worca-cc-plugin.json': MANIFEST('gamma-plugin'),
    'gamma/index.mjs': 'export default () => ({});\n',
  });
  const r = await addPluginRepo(root);
  assert.equal(r.marketplace, null);
  assert.deepEqual(r.discovered.map((d) => d.name), ['gamma-plugin']);
  assert.match(r.warnings.join('\n'), /worca-cc-marketplace\.json/);
});

test('addPluginRepo: bad manifest entries skipped with warnings; duplicates first-win', async () => {
  const { root } = await makeRepo('mkt-entries', {
    'worca-cc-marketplace.json': MP_MANIFEST([
      'plugins/ok', '../escape', '/abs', 'missing/dir', 'plugins/dup',
    ]),
    'plugins/ok/worca-cc-plugin.json': MANIFEST('same-name'),
    'plugins/ok/index.mjs': 'export default () => ({});\n',
    'plugins/dup/worca-cc-plugin.json': MANIFEST('same-name'), // duplicate NAME
    'plugins/dup/index.mjs': 'export default () => ({});\n',
  });
  const r = await addPluginRepo(root);
  assert.deepEqual(r.discovered.map(({ name, subdir }) => ({ name, subdir })),
    [{ name: 'same-name', subdir: 'plugins/ok' }]);
  const w = r.warnings.join('\n');
  assert.match(w, /invalid plugin path "\.\.\/escape"/);
  assert.match(w, /invalid plugin path "\/abs"/);
  assert.match(w, /missing\/dir\/worca-cc-plugin\.json not found/);
  assert.match(w, /same-name/); // duplicate warning
});

test('exportVersion: depth-2 subdir strips components correctly (regression lock)', async () => {
  const { root, sha } = await makeRepo('mkt-export', {
    'worca-cc-marketplace.json': MP_MANIFEST(['plugins/deep']),
    'plugins/deep/worca-cc-plugin.json': MANIFEST('deep-plugin'),
    'plugins/deep/index.mjs': 'export default () => ({});\n',
  });
  await addPluginRepo(root); // seed cache
  const { versionDir } = await exportVersion('deep-plugin', sha, { repoUrl: root, subdir: 'plugins/deep' });
  assert.ok(existsSync(join(versionDir, 'worca-cc-plugin.json')), 'manifest at export ROOT (strip-components = subdir depth)');
  assert.ok(existsSync(join(versionDir, 'index.mjs')));
});

test('fetchCandidate: depth-2 subdir scopes the diffstat to that plugin only', async () => {
  const { root, sha } = await makeRepo('mkt-cand', {
    'worca-cc-marketplace.json': MP_MANIFEST(['plugins/p1', 'plugins/p2']),
    'plugins/p1/worca-cc-plugin.json': MANIFEST('p1-plugin'),
    'plugins/p1/index.mjs': 'export default () => ({});\n',
    'plugins/p2/worca-cc-plugin.json': MANIFEST('p2-plugin'),
    'plugins/p2/index.mjs': 'export default () => ({});\n',
  });
  await addPluginRepo(root);
  writePluginsLock({ 'p1-plugin': {
    repo: root, subdir: 'plugins/p1', pinnedSha: sha, version: '0.1.0',
    enabled: true, installedAt: new Date().toISOString(),
  } });
  writeFileSync(join(root, 'plugins', 'p1', 'index.mjs'), 'export default () => ({ v: 2 });\n');
  writeFileSync(join(root, 'plugins', 'p2', 'index.mjs'), 'export default () => ({ v: 2 });\n');
  await git(root, 'add', '-A');
  await git(root, 'commit', '-qm', 'touch both');
  const fc = await fetchCandidate('p1-plugin');
  assert.match(fc.diffstat, /plugins\/p1\/index\.mjs/);
  assert.doesNotMatch(fc.diffstat, /plugins\/p2/);
});

// v2 additions (E1, C1, E14, E15) need { parseMarketplaceManifest, repoSlug }
// added to the plugin-repo import at the top of this file.
test('parseMarketplaceManifest: bad segments all rejected; empty plugins is authoritative-ok', () => {
  assert.deepEqual(
    parseMarketplaceManifest({ name: 'x', plugins: ['../a', '/b', 'c/./d', 'e\\f', '', ' -x'] }).plugins, []);
  assert.ok(parseMarketplaceManifest({ name: 'x', plugins: [] }).ok);
});

test('parseMarketplaceManifest: structurally invalid (plugins not an array) -> ok:false', () => {
  const res = parseMarketplaceManifest({ plugins: 'nope' });
  assert.equal(res.ok, false);
  assert.ok(res.errors.length);
});

test('repoSlug is injective across near-miss urls (no id/cache collision)', () => {
  const pairs = [['https://github.com/o/r', 'http://github.com/o/r'],
    ['/tmp/a/b', '/tmp/a-b'], ['https://h/o/r.git.git', 'https://h/o/r'],
    ['https://github.com/foo/bar', 'https://github.com-foo-bar']];
  for (const [a, b] of pairs) assert.notEqual(repoSlug(a), repoSlug(b), `${a} vs ${b}`);
});

test('addPluginRepo: empty marketplace manifest is authoritative (scan suppressed)', async () => {
  const { root } = await makeRepo('mkt-empty', {
    'worca-cc-marketplace.json': MP_MANIFEST([]),
    // a stray depth-1 plugin must NOT surface — the (empty) manifest still wins
    'stray/worca-cc-plugin.json': MANIFEST('stray-plugin'),
    'stray/index.mjs': 'export default () => ({});\n',
  });
  const r = await addPluginRepo(root);
  assert.deepEqual(r.marketplace, { name: 'Test Market', description: 'fixture marketplace' });
  assert.deepEqual(r.discovered.map((d) => d.name), []);
});

test('addPluginRepo: engines-incompatible manifest plugin -> warning, absent from discovered', async () => {
  const { root } = await makeRepo('mkt-eng', {
    'worca-cc-marketplace.json': MP_MANIFEST(['plugins/old']),
    'plugins/old/worca-cc-plugin.json': JSON.stringify({
      // engines key MUST be nested — normalizeManifest reads raw.engines['worca-cc-api'],
      // and 'worca-cc-api' is not a KNOWN_TOP key, so a top-level copy is ignored (plugin
      // would validate and get discovered, failing this test). All real manifests nest it.
      name: 'old-plugin', version: '0.1.0', engines: { 'worca-cc-api': '>=99' },
      taskSources: [{ id: 'main', displayName: 'Old', module: './index.mjs',
        inputs: [{ key: 'task', type: 'task-browser', label: 'Task' }] }],
    }),
    'plugins/old/index.mjs': 'export default () => ({});\n',
  });
  const r = await addPluginRepo(root);
  assert.deepEqual(r.discovered.map((d) => d.name), []);
  assert.match(r.warnings.join('\n'), /old-plugin|worca-cc-api|engine/i);
});

test('addPluginRepo: manifest plugin dir starting with "-" is rejected (git option-injection guard)', async () => {
  rmSync('/tmp/worca-cc-pwned', { force: true }); // a stale artifact from a prior run must not skew the assert below
  const { root } = await makeRepo('mkt-inject', {
    'worca-cc-marketplace.json': MP_MANIFEST(['--output=/tmp/worca-cc-pwned']),
    'plugins/ok/worca-cc-plugin.json': MANIFEST('ok-plugin'),
    'plugins/ok/index.mjs': 'export default () => ({});\n',
  });
  const r = await addPluginRepo(root);
  assert.match(r.warnings.join('\n'), /invalid plugin path "--output=\/tmp\/worca-cc-pwned"/);
  assert.equal(existsSync('/tmp/worca-cc-pwned'), false);
  assert.deepEqual(r.discovered.map((d) => d.name), []); // manifest present but all entries invalid -> empty (still authoritative)
});
