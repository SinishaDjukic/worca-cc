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
import { delimiter, join, dirname } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { checkRows } from './helpers/rows.mjs';
import {
  addPluginRepo, discoverAtCommit, fetchCandidate, exportVersion, repoCacheDir, parseMarketplaceManifest, repoSlug, pluginGitEnv,
  emptyManifestDelta, manifestVersion,
} from '../src/core/plugin-repo.mjs';
import { ADO_GIT_CREDENTIAL_HELPER } from '../src/core/azure-credentials.mjs';
import { BB_GIT_CREDENTIAL_HELPER } from '../src/core/bitbucket-credentials.mjs';
import { withEnv } from './helpers/with-env.mjs';
import { writePluginsLock } from '../src/core/plugins-lock.mjs';

const WIN_SYMLINK = { skip: process.platform === 'win32' ? 'creating symlinks needs a privilege (Developer Mode / admin) on Windows' : false };

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

test('addPluginRepo: no marketplace manifest -> depth 0-1 scan finds both subdirs, marketplace: null, bare cache created', async () => {
  const { root, sha } = await makeRepo('multi', {
    'README.md': 'not a plugin\n',
    'alpha/worca-cc-plugin.json': MANIFEST('alpha-plugin'),
    'alpha/index.mjs': 'export default () => ({});\n',
    'beta/worca-cc-plugin.json': MANIFEST('beta-plugin'),
    'beta/index.mjs': 'export default () => ({});\n',
  });
  const r = await addPluginRepo(root);
  await checkRows([
    { name: 'addPluginRepo: multi-plugin discovery at depth 1 (two subdirs)', run: () => {
      assert.equal(r.repoUrl, root);
      assert.equal(r.sha, sha);
      assert.match(r.sha, /^[0-9a-f]{40}$/);
      assert.deepEqual(
        r.discovered.map(({ name, subdir }) => ({ name, subdir })),
        [{ name: 'alpha-plugin', subdir: 'alpha' }, { name: 'beta-plugin', subdir: 'beta' }],
      );
      assert.equal(r.discovered[0].manifest.taskSources[0].id, 'src');
      assert.ok(existsSync(repoCacheDir(root)), 'bare fetch cache created under <pluginsRoot>/.cache');
    } },
    { name: 'addPluginRepo: no marketplace manifest -> depth 0-1 scan, marketplace: null', run: () => {
      assert.equal(r.marketplace, null);
      assert.deepEqual(r.discovered.map((d) => d.name), ['alpha-plugin', 'beta-plugin']);
    } },
  ]);
});

test('plugin repo git runs in the C locale, so a failed sync reads the same on every host (G12)', { skip: process.platform === 'win32' && 'a POSIX shell script stands in for git' }, async () => {
  const bin = mkdtempSync(join(tmpdir(), 'worca-cc-fakegit-'));
  writeFileSync(join(bin, 'git'), '#!/bin/sh\necho "fatal: LC_ALL=$LC_ALL" >&2\nexit 128\n', { mode: 0o755 });
  const saved = { PATH: process.env.PATH, LC_ALL: process.env.LC_ALL };
  process.env.PATH = `${bin}${delimiter}${saved.PATH}`;
  process.env.LC_ALL = 'de_DE.UTF-8';
  try {
    await assert.rejects(addPluginRepo(join(bin, 'no-such-repo')), (e) => /^fatal: LC_ALL=C$/m.test(String(e.stderr)));
  } finally {
    process.env.PATH = saved.PATH;
    if (saved.LC_ALL === undefined) delete process.env.LC_ALL; else process.env.LC_ALL = saved.LC_ALL;
    rmSync(bin, { recursive: true, force: true });
  }
});

test('addPluginRepo: reserved model-env key -> plugin still discovered, warning surfaced', async () => {
  const { root } = await makeRepo('reserved-env', {
    'ds/worca-cc-plugin.json': JSON.stringify({
      name: 'ds-models', version: '0.4.0',
      models: [{ id: 'ds-stable', env: { ANTHROPIC_MODEL: 'ds-stable', CLAUDE_CODE_SUBAGENT_MODEL: 'ds-stable' } }],
    }),
  });
  const r = await addPluginRepo(root);
  assert.deepEqual(r.discovered.map((d) => d.name), ['ds-models'], 'not bricked by the reserved key');
  assert.equal(r.discovered[0].manifest.models[0].env.CLAUDE_CODE_SUBAGENT_MODEL, undefined, 'key stripped');
  assert.equal(r.discovered[0].manifest.models[0].env.ANTHROPIC_MODEL, 'ds-stable', 'legal key kept');
  assert.match(r.warnings.join('\n'), /env key "CLAUDE_CODE_SUBAGENT_MODEL" is reserved — ignored/);
  assert.deepEqual(r.discovered[0].warnings,
    ['ds/worca-cc-plugin.json: models[0] ("ds-stable"): env key "CLAUDE_CODE_SUBAGENT_MODEL" is reserved — ignored'],
    'G14: the plugin carries its own notes');
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
    newSecrets: [], newTaskSources: [], newChatChannels: [], newChannelSecrets: [], newAgents: [], setupChanged: false,
    newModels: [], removedModels: [], envChangedModels: [], newModelSecrets: [],
    newMcpServers: [], removedMcpServers: [], changedMcpServers: [], mcpLines: [],
    newSkills: [], removedSkills: [], changedSkills: [], skillLines: [],
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

test('exportVersion: depth-1 and depth-2 subdirs extract at the version root (strip-components regression lock)', async () => {
  // One repo: alpha/ (depth 1) and plugins/deep/ (depth 2), one exportVersion call each.
  const { root, sha } = await makeRepo('exp-sub', {
    'alpha/worca-cc-plugin.json': MANIFEST('exp-sub-plugin'),
    'alpha/index.mjs': 'export default () => ({});\n',
    'README.md': 'repo readme\n',
    'plugins/deep/worca-cc-plugin.json': MANIFEST('deep-plugin'),
    'plugins/deep/index.mjs': 'export default () => ({});\n',
  });
  await checkRows([
    { name: 'exportVersion: subdir layout is extracted at the version root (strip-components)', run: async () => {
      const { versionDir } = await exportVersion('exp-sub-plugin', sha, { repoUrl: root, subdir: 'alpha' });
      assert.ok(existsSync(join(versionDir, 'worca-cc-plugin.json')), 'manifest sits at the version root');
      assert.ok(!existsSync(join(versionDir, 'alpha')), 'subdir prefix stripped');
      assert.ok(!existsSync(join(versionDir, 'README.md')), 'sibling repo files not exported');
    } },
    { name: 'exportVersion: depth-2 subdir strips components correctly (regression lock)', run: async () => {
      await addPluginRepo(root); // seed cache
      const { versionDir } = await exportVersion('deep-plugin', sha, { repoUrl: root, subdir: 'plugins/deep' });
      assert.ok(existsSync(join(versionDir, 'worca-cc-plugin.json')), 'manifest at export ROOT (strip-components = subdir depth)');
      assert.ok(existsSync(join(versionDir, 'index.mjs')));
    } },
  ]);
});

test('exportVersion: escaping symlink deleted with warning; internal symlink kept', WIN_SYMLINK, async () => {
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
test('parseMarketplaceManifest: bad segments rejected; empty plugins ok; non-array plugins -> ok:false', async () => {
  await checkRows([
    { name: 'parseMarketplaceManifest: bad segments all rejected; empty plugins is authoritative-ok', run: () => {
      assert.deepEqual(
        parseMarketplaceManifest({ name: 'x', plugins: ['../a', '/b', 'c/./d', 'e\\f', '', ' -x'] }).plugins, []);
      assert.ok(parseMarketplaceManifest({ name: 'x', plugins: [] }).ok);
    } },
    { name: 'parseMarketplaceManifest: structurally invalid (plugins not an array) -> ok:false', run: () => {
      const res = parseMarketplaceManifest({ plugins: 'nope' });
      assert.equal(res.ok, false);
      assert.ok(res.errors.length);
    } },
  ]);
});

test('repoSlug is injective across near-miss urls (no id/cache collision)', () => {
  const pairs = [['https://github.com/o/r', 'http://github.com/o/r'],
    ['/tmp/a/b', '/tmp/a-b'], ['https://h/o/r.git.git', 'https://h/o/r'],
    ['https://github.com/foo/bar', 'https://github.com-foo-bar']];
  for (const [a, b] of pairs) assert.notEqual(repoSlug(a), repoSlug(b), `${a} vs ${b}`);
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

test('plugin repo git calls carry worca\'s GitHub read env plus the host-scoped Azure helper', async () => {
  const NO_APP = { WORCA_GH_APP_ID: undefined, WORCA_GH_APP_KEY_FILE: undefined, WORCA_GH_APP_KEY_B64: undefined };
  const env = await withEnv({ ...NO_APP, WORCA_ADO_TOKEN: 'pat', WORCA_ADO_READ_TOKEN: undefined, WORCA_ADO_WRITE_TOKEN: undefined,
    AZURE_DEVOPS_EXT_PAT: undefined, GH_TOKEN: 'ghp_x' }, () => pluginGitEnv());
  assert.equal(env.WORCA_ADO_GIT_TOKEN, 'pat');
  assert.equal(env.WORCA_ADO_TOKEN, undefined, 'the raw PAT variable is stripped');
  assert.ok(Object.values(env).includes(ADO_GIT_CREDENTIAL_HELPER));
  const none = await withEnv({ ...NO_APP, WORCA_ADO_TOKEN: undefined, WORCA_ADO_READ_TOKEN: undefined, WORCA_ADO_WRITE_TOKEN: undefined,
    AZURE_DEVOPS_EXT_PAT: undefined }, () => pluginGitEnv());
  assert.equal(none.WORCA_ADO_GIT_TOKEN, undefined);
  assert.equal(Object.values(none).includes(ADO_GIT_CREDENTIAL_HELPER), false);
});

test('plugin repo git calls carry the host-scoped Bitbucket helper too (a git-backed Bitbucket marketplace, D11)', async () => {
  const NO_APP = { WORCA_GH_APP_ID: undefined, WORCA_GH_APP_KEY_FILE: undefined, WORCA_GH_APP_KEY_B64: undefined };
  const env = await withEnv({ ...NO_APP, WORCA_BB_TOKEN: 'bbtok', WORCA_BB_READ_TOKEN: undefined, WORCA_BB_WRITE_TOKEN: undefined,
    WORCA_BB_EMAIL: undefined }, () => pluginGitEnv());
  assert.equal(env.WORCA_BB_GIT_TOKEN, 'bbtok');
  assert.equal(env.WORCA_BB_TOKEN, undefined, 'the raw token variable is stripped');
  assert.ok(Object.values(env).includes(BB_GIT_CREDENTIAL_HELPER));
});

test('discoverAtCommit: discovery at a given commit of a checkout — index authoritative, version read from that commit', async () => {
  const root = mkdtempSync(join(scratch, 'disc-'));
  await git(root, 'init', '-q', '-b', 'main');
  writeTree(root, {
    'worca-cc-marketplace.json': JSON.stringify({ name: 'M', plugins: ['plugins/aa'] }),
    'plugins/aa/worca-cc-plugin.json': JSON.stringify({ name: 'aa', version: '0.1.0' }),
  });
  await git(root, 'add', '-A'); await git(root, 'commit', '-qm', 'c1');
  const first = await git(root, 'rev-parse', 'HEAD');
  writeTree(root, { 'plugins/aa/worca-cc-plugin.json': JSON.stringify({ name: 'aa', version: '0.1.1' }) });
  await git(root, 'commit', '-qam', 'c2');
  const gitDirAbs = await git(root, 'rev-parse', '--absolute-git-dir');      // <root>/.git — a NON-bare checkout's git dir

  const atFirst = await discoverAtCommit(gitDirAbs, first);
  assert.equal(atFirst.sha, first);
  assert.deepEqual(atFirst.discovered.map((p) => [p.name, p.subdir, p.manifest.version]), [['aa', 'plugins/aa', '0.1.0']]);
  assert.deepEqual(atFirst.marketplace, { name: 'M', description: '' });
  const atHead = await discoverAtCommit(gitDirAbs, await git(root, 'rev-parse', 'HEAD'));
  assert.equal(atHead.discovered[0].manifest.version, '0.1.1');
});

test('fetchCandidate: versions, previewedAt and access ride at the top level; a new chat channel and its secret are in the delta', async () => {
  const { root, sha } = await makeRepo('chan-moving', { 'worca-cc-plugin.json': JSON.stringify({ name: 'chan-plugin', version: '0.1.0' }) });
  await addPluginRepo(root);
  writePluginsLock({ 'chan-plugin': { repo: root, subdir: '', pinnedSha: sha, version: '0.1.0', enabled: true, installedAt: 'x' } });
  writeTree(root, {
    'worca-cc-plugin.json': JSON.stringify({ name: 'chan-plugin', version: '0.2.0', chatChannels: [{ id: 'main', platform: 'slack',
      module: './w.mjs', configSchema: [{ key: 'botToken', secret: true, required: true }, { key: 'notifyChatIds' }] }] }),
    'w.mjs': 'export {};\n',
  });
  await git(root, 'add', '-A');
  await git(root, 'commit', '-qm', 'add slack');
  const sha2 = await git(root, 'rev-parse', 'HEAD');
  const fc = await fetchCandidate('chan-plugin');
  assert.deepEqual([fc.pinnedVersion, fc.candidateVersion], ['0.1.0', '0.2.0']);
  assert.match(fc.previewedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  assert.deepEqual([fc.manifestDelta.newChatChannels, fc.manifestDelta.newChannelSecrets], [['main'], ['main.botToken']]);
  assert.deepEqual(fc.access, [{ kind: 'channelSecret', id: 'main.botToken', red: true }, { kind: 'chatChannel', id: 'main', red: false }]);
  writePluginsLock({ 'chan-plugin': { repo: root, subdir: '', pinnedSha: sha2, version: '0.2.0', enabled: true, installedAt: 'x' } });
  const same = await fetchCandidate('chan-plugin');
  assert.deepEqual(Object.keys(same.manifestDelta).sort(), Object.keys(fc.manifestDelta).sort(), 'an equal candidate\'s delta has every key a moved one has');
  assert.deepEqual([manifestVersion({ version: ' 0.3.0 ' }), manifestVersion({ version: '  ' }), manifestVersion(null)], ['0.3.0', null, null],
    'normalizeManifest\'s reading: trimmed, a blank or missing version is none');
  assert.deepEqual([same.pinnedVersion, same.candidateVersion, same.access, same.manifestDelta], ['0.2.0', '0.2.0', [], emptyManifestDelta()]);
  writeFileSync(join(root, 'w.mjs'), 'export const v = 3;\n');   // the channel on both sides: not new
  await git(root, 'commit', '-qam', 'touch the worker');
  const kept = await fetchCandidate('chan-plugin');
  assert.deepEqual([kept.candidateVersion, kept.manifestDelta.newChatChannels, kept.manifestDelta.newChannelSecrets, kept.access], ['0.2.0', [], [], []]);
});

test('addPluginRepo reports reading once the commit is fetched (onProgress, G4)', async () => {
  const { root, sha } = await makeRepo('progress', { 'worca-cc-plugin.json': MANIFEST('progress-plugin'), 'index.mjs': 'export default () => ({});\n' });
  const events = [];
  await addPluginRepo(root, { onProgress: (e) => events.push(e) });
  assert.deepEqual(events, [{ phase: 'reading', sha }]);
});
