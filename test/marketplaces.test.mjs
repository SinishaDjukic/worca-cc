// test/marketplaces.test.mjs — persisted marketplace registry. Real local git
// fixture repos (offline); WORCA_HOME sandboxed via useTempHome.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import {
  readMarketplaces, writeMarketplaces, normalizeMarketplaceUrl, marketplaceId,
  addMarketplace, syncMarketplace, refreshAllMarketplaces, removeMarketplace,
  listMarketplaces, resolveInstallSource, marketplacesFile,
} from '../src/core/marketplaces.mjs';
import { repoCacheDir, repoSlug } from '../src/core/plugin-repo.mjs';
import { writePluginsLock, pluginsRoot } from '../src/core/plugins-lock.mjs';

useTempHome(after);
const execFileP = promisify(execFile);
const scratch = mkdtempSync(join(tmpdir(), 'worca-cc-mkt-'));
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
const PLUGIN = (name) => JSON.stringify({
  name, version: '0.1.0', description: `${name} fixture`,
  taskSources: [{ id: 'main', displayName: name, module: './index.mjs',
    inputs: [{ key: 'task', type: 'task-browser', label: 'Task' }] }],
});
async function makeMarketRepo(dirName, pluginNames) {
  const root = join(scratch, dirName);
  const files = {
    'worca-cc-marketplace.json': JSON.stringify({
      name: `${dirName} market`, description: 'fixture', plugins: pluginNames.map((n) => `plugins/${n}`),
    }),
  };
  for (const n of pluginNames) {
    files[`plugins/${n}/worca-cc-plugin.json`] = PLUGIN(n);
    files[`plugins/${n}/index.mjs`] = 'export default () => ({});\n';
  }
  mkdirSync(root, { recursive: true });
  await git(root, 'init', '-q', '-b', 'main');
  writeTree(root, files);
  await git(root, 'add', '-A');
  await git(root, 'commit', '-qm', 'c1');
  return { root, sha: await git(root, 'rev-parse', 'HEAD') };
}

test('normalizeMarketplaceUrl: shorthand, trailing junk, local paths', () => {
  assert.equal(normalizeMarketplaceUrl('owner/repo'), 'https://github.com/owner/repo');
  assert.equal(normalizeMarketplaceUrl('https://github.com/o/r.git'), 'https://github.com/o/r');
  assert.equal(normalizeMarketplaceUrl('https://github.com/o/r/'), 'https://github.com/o/r');
  assert.equal(normalizeMarketplaceUrl(''), null);
  assert.equal(normalizeMarketplaceUrl(scratch), scratch); // absolute local path stays
  assert.equal(normalizeMarketplaceUrl('git@github.com:o/r.git'), 'git@github.com:o/r'); // scp-style SSH (C2)
});

test('read tolerates a garbage file; write is atomic and round-trips', () => {
  mkdirSync(dirname(marketplacesFile()), { recursive: true }); // B2: first write predates the plugins dir
  writeFileSync(marketplacesFile(), '{broken', 'utf8');
  const empty = readMarketplaces();
  assert.equal(empty.seededBuiltin, false);
  assert.deepEqual({ ...empty.marketplaces }, {}); // A5: null-proto map -> spread to compare under assert/strict
  const state = { seededBuiltin: true, marketplaces: { x: { id: 'x', url: '/tmp/x', name: 'X', plugins: [], warnings: [], lastSync: null, addedAt: 'now' } } };
  writeMarketplaces(state);
  const rt = readMarketplaces();
  assert.equal(rt.seededBuiltin, true);
  assert.deepEqual({ ...rt.marketplaces }, state.marketplaces);
  assert.deepEqual(readdirSync(pluginsRoot()).filter((f) => f.endsWith('.tmp')), [], 'atomic write leaves no .tmp (E6)');
});

test('addMarketplace: syncs the snapshot; duplicate add -> EXISTS; junk url not recorded', async () => {
  const { root, sha } = await makeMarketRepo('m1', ['aa', 'bb']);
  const entry = await addMarketplace(root);
  assert.equal(entry.name, 'm1 market');
  assert.equal(entry.id, marketplaceId(root));
  assert.equal(entry.lastSync.sha, sha);
  assert.deepEqual(entry.plugins.map((p) => ({ name: p.name, subdir: p.subdir })),
    [{ name: 'aa', subdir: 'plugins/aa' }, { name: 'bb', subdir: 'plugins/bb' }]);
  assert.equal(entry.plugins[0].inventory.taskSources[0].id, 'main');
  assert.equal(entry.plugins[0].description, 'aa fixture'); // E8: discovery carries manifest fields
  assert.equal(entry.plugins[0].version, '0.1.0');
  await assert.rejects(() => addMarketplace(root), (e) => e.code === 'EXISTS');
  await assert.rejects(() => addMarketplace(join(scratch, 'no-such-repo')));
  assert.equal(readMarketplaces().marketplaces[marketplaceId(join(scratch, 'no-such-repo'))], undefined,
    'failed add records nothing'); // B3: order-independent (no length-vs-polluted-state coupling)
});

test('syncMarketplace: picks up new commits; failure keeps stale snapshot + warning', async () => {
  const { root } = await makeMarketRepo('m2', ['cc']);
  const entry = await addMarketplace(root);
  writeTree(root, {
    'worca-cc-marketplace.json': JSON.stringify({ name: 'm2 market', plugins: ['plugins/cc', 'plugins/dd'] }),
    'plugins/dd/worca-cc-plugin.json': PLUGIN('dd'),
    'plugins/dd/index.mjs': 'export default () => ({});\n',
  });
  await git(root, 'add', '-A');
  await git(root, 'commit', '-qm', 'c2');
  const sha2 = await git(root, 'rev-parse', 'HEAD');
  const synced = await syncMarketplace(entry.id);
  assert.deepEqual(synced.plugins.map((p) => p.name), ['cc', 'dd']);
  assert.equal(synced.lastSync.sha, sha2); // E3
  rmSync(root, { recursive: true, force: true }); // repo vanishes
  rmSync(repoCacheDir(root), { recursive: true, force: true }); // and its cache
  const stale = await syncMarketplace(entry.id);
  assert.deepEqual(stale.plugins.map((p) => p.name), ['cc', 'dd'], 'stale snapshot kept');
  assert.equal(stale.lastSync.sha, sha2, 'stale sync keeps the last good sha'); // E3
  assert.match(stale.warnings.join('\n'), /refresh failed:/); // C4 wording
  assert.match(stale.warnings.join('\n'), /last sync|never synced/);
});

test('removeMarketplace: entry gone, installed plugins keep the cache; unknown -> NOT_FOUND', async () => {
  const { root } = await makeMarketRepo('m3', ['ee']);
  const entry = await addMarketplace(root);
  // simulate an installed plugin from this repo
  writePluginsLock({ ee: { repo: root, subdir: 'plugins/ee', pinnedSha: 'x'.repeat(40), version: '0.1.0', enabled: true, installedAt: 'now' } });
  removeMarketplace(entry.id);
  assert.ok(!readMarketplaces().marketplaces[entry.id]);
  assert.ok(existsSync(repoCacheDir(root)), 'cache kept while a lock entry references the repo');
  // no lock reference -> cache goes too
  writePluginsLock({});
  const entry2 = await addMarketplace(root);
  removeMarketplace(entry2.id);
  assert.ok(!existsSync(repoCacheDir(root)), 'cache removed with the last reference');
  assert.throws(() => removeMarketplace('nope'), (e) => e.code === 'NOT_FOUND');
});

test('resolveInstallSource: lock first, then unique marketplace hit, ambiguity -> candidates', async () => {
  const a = await makeMarketRepo('m4a', ['shared', 'only-a']);
  const b = await makeMarketRepo('m4b', ['shared']);
  await addMarketplace(a.root);
  await addMarketplace(b.root);
  const unique = resolveInstallSource('only-a', {});
  assert.equal(unique.repoUrl, a.root);
  assert.equal(unique.marketplace, marketplaceId(a.root));
  const ambiguous = resolveInstallSource('shared', {});
  assert.equal(ambiguous.candidates.length, 2);
  writePluginsLock({ shared: { repo: b.root, subdir: 'plugins/shared', pinnedSha: 'x'.repeat(40), version: '0.1.0', enabled: true, installedAt: 'now' } });
  assert.equal(resolveInstallSource('shared', {}).repoUrl, b.root, 'lock wins over marketplaces');
  assert.equal(resolveInstallSource('ghost', {}), null);
});

// v2 additions (E2/E5/E9/B7/C8/E15/A5). repoSlug (plugin-repo), readdirSync (node:fs)
// and pluginsRoot (plugins-lock) are wired into the imports at the top of this file.
test('refreshAllMarketplaces re-syncs every registered marketplace, picking up new commits (E2)', async () => {
  writeMarketplaces({ seededBuiltin: false, marketplaces: {} }); // isolate from earlier tests' shared registry
  const a = await makeMarketRepo('m5a', ['xa']);
  const b = await makeMarketRepo('m5b', ['xb']);
  await addMarketplace(a.root);
  await addMarketplace(b.root);
  // add a NEW plugin to `a` AFTER its first sync — a real re-sync (not a stale return) must find it
  mkdirSync(join(a.root, 'plugins', 'xa2'), { recursive: true });
  writeFileSync(join(a.root, 'worca-cc-marketplace.json'),
    JSON.stringify({ name: 'm5a market', plugins: ['plugins/xa', 'plugins/xa2'] }));
  writeFileSync(join(a.root, 'plugins', 'xa2', 'worca-cc-plugin.json'), PLUGIN('xa2'));
  writeFileSync(join(a.root, 'plugins', 'xa2', 'index.mjs'), 'export default () => ({});\n');
  await git(a.root, 'add', '-A');
  await git(a.root, 'commit', '-qm', 'c2');
  const out = await refreshAllMarketplaces();
  const byId = Object.fromEntries(out.map((m) => [m.id, m.plugins.map((p) => p.name).sort()]));
  assert.deepEqual(byId[marketplaceId(a.root)], ['xa', 'xa2'], 're-synced: the new plugin is discovered');
  assert.deepEqual(byId[marketplaceId(b.root)], ['xb']);
});

test('readMarketplaces returns a prototype-free marketplaces map (pollution-safe) (A5)', () => {
  writeMarketplaces({ seededBuiltin: false, marketplaces: {} });
  assert.equal(Object.getPrototypeOf(readMarketplaces().marketplaces), null);
});

test('marketplaceId equals repoSlug of the normalized url (E5)', () => {
  assert.equal(marketplaceId('owner/repo'), repoSlug('https://github.com/owner/repo'));
  assert.match(marketplaceId('owner/repo'), /^github\.com-owner-repo-/); // readable prefix survives
});

test('addMarketplace threads an injected exec (injection seam is real) (E9)', async () => {
  const { root } = await makeMarketRepo('m6', ['ya']);
  let calls = 0;
  const exec = (cmd, args, opts) => { calls++; return execFileP(cmd, args, opts); };
  await addMarketplace(root, { exec });
  assert.ok(calls > 0, 'the injected exec ran the git work');
});

test('syncMarketplace drops its write when the entry is removed mid-sync (B7)', async () => {
  const { root } = await makeMarketRepo('m-race', ['zz']);
  const entry = await addMarketplace(root);
  // TRUE race: syncMarketplace reads `cur`, then runs syncEntry (git work via exec);
  // the injected exec removes the entry DURING that work, so the trailing mutateEntry
  // sees a vanished entry and must refuse to write it back (never resurrect it).
  // This exercises the mutateEntry-returns-null branch — the marquee concurrency guard —
  // which a remove-BEFORE-sync test can't reach (that hits the early `if (!cur)` throw).
  let removed = false;
  const exec = (cmd, args, opts) => {
    if (!removed) { removed = true; removeMarketplace(entry.id); }
    return execFileP(cmd, args, opts);
  };
  const saved = await syncMarketplace(entry.id, { exec }).catch((e) => e);
  assert.equal(saved.code, 'NOT_FOUND', 'sync refuses to write a vanished entry');
  assert.ok(!readMarketplaces().marketplaces[entry.id], 'stays removed — no resurrection');
});

test('addMarketplace does not resurrect a marketplace removed during its sync (B8)', async () => {
  // Same shape as B7 but for the ADD path: the insert must re-read the registry
  // AFTER the long git sync, not write back the pre-sync snapshot.
  const other = await makeMarketRepo('m-b8-other', ['q1']);
  const otherEntry = await addMarketplace(other.root);
  const { root } = await makeMarketRepo('m-b8', ['q2']);
  let removed = false;
  const exec = (cmd, args, opts) => {
    if (!removed) { removed = true; removeMarketplace(otherEntry.id); }
    return execFileP(cmd, args, opts);
  };
  const entry = await addMarketplace(root, { exec });
  assert.ok(readMarketplaces().marketplaces[entry.id], 'new marketplace recorded');
  assert.ok(!readMarketplaces().marketplaces[otherEntry.id],
    'marketplace removed mid-add stays removed — no resurrection from the stale snapshot');
});

test('addMarketplace of an empty (no-commit) repo rejects; no orphan cache, no entry (C8)', async () => {
  const root = join(scratch, 'empty-repo');
  mkdirSync(root, { recursive: true });
  await git(root, 'init', '-q', '-b', 'main');
  await assert.rejects(() => addMarketplace(root), /no commits yet/);
  assert.ok(!existsSync(repoCacheDir(root)), 'orphan bare cache cleaned up');
  assert.equal(readMarketplaces().marketplaces[marketplaceId(root)], undefined, 'no registry entry');
});

test('addMarketplace of a manifest-less repo falls back to the scan (E15)', async () => {
  const root = join(scratch, 'no-manifest');
  mkdirSync(join(root, 'solo'), { recursive: true });
  writeFileSync(join(root, 'solo', 'worca-cc-plugin.json'), PLUGIN('solo'));
  writeFileSync(join(root, 'solo', 'index.mjs'), 'export default () => ({});\n');
  await git(root, 'init', '-q', '-b', 'main');
  await git(root, 'add', '-A');
  await git(root, 'commit', '-qm', 'c1');
  const entry = await addMarketplace(root);
  assert.equal(entry.plugins.length, 1); // discovered by the depth 0-1 scan
  assert.equal(entry.plugins[0].name, 'solo');
});
