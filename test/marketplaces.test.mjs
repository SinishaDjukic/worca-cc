// test/marketplaces.test.mjs — persisted marketplace registry. Real local git
// fixture repos (offline); WORCA_HOME sandboxed via useTempHome.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { withNoGit } from './helpers/git-off.mjs';
import { useTempHome } from './helpers/temp-home.mjs';
import {
  readMarketplaces, writeMarketplaces, normalizeMarketplaceUrl, marketplaceId,
  addMarketplace, syncMarketplace, refreshAllMarketplaces, removeMarketplace,
  listMarketplaces, resolveInstallSource, marketplacesFile,
  seedBuiltinMarketplace, builtinMarketplaceSource, BUILTIN_MARKETPLACE_REF,
  marketplaceDisplayName, syncErrorOf, checkMarketplaceAdd,
} from '../src/core/marketplaces.mjs';
import { repoCacheDir, repoSlug } from '../src/core/plugin-repo.mjs';
import { writePluginsLock, pluginsRoot } from '../src/core/plugins-lock.mjs';
import { checkRows } from './helpers/rows.mjs';
import { GithubError } from '../src/core/git-free/github.mjs';

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

test('normalizeMarketplaceUrl + marketplaceId: shorthand, trailing junk, local paths, scp SSH; id = repoSlug of the normalized url', async () => {
  await checkRows([
    { name: 'normalizeMarketplaceUrl: shorthand, trailing junk, local paths', run: () => {
      assert.equal(normalizeMarketplaceUrl('owner/repo'), 'https://github.com/owner/repo');
      assert.equal(normalizeMarketplaceUrl('https://github.com/o/r.git'), 'https://github.com/o/r');
      assert.equal(normalizeMarketplaceUrl('https://github.com/o/r/'), 'https://github.com/o/r');
      assert.equal(normalizeMarketplaceUrl(''), null);
      assert.equal(normalizeMarketplaceUrl(scratch), scratch); // absolute local path stays
      assert.equal(normalizeMarketplaceUrl('git@github.com:o/r.git'), 'git@github.com:o/r'); // scp-style SSH (C2)
    } },
    { name: 'marketplaceId equals repoSlug of the normalized url (E5)', run: () => {
      assert.equal(marketplaceId('owner/repo'), repoSlug('https://github.com/owner/repo'));
      assert.match(marketplaceId('owner/repo'), /^github\.com-owner-repo-/); // readable prefix survives
    } },
  ]);
});

test('read tolerates a garbage file and returns a prototype-free map; write is atomic and round-trips', async () => {
  await checkRows([
    { name: 'read tolerates a garbage file; write is atomic and round-trips', run: () => {
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
    } },
    { name: 'readMarketplaces returns a prototype-free marketplaces map (pollution-safe) (A5)', run: () => {
      writeMarketplaces({ seededBuiltin: false, marketplaces: {} });
      assert.equal(Object.getPrototypeOf(readMarketplaces().marketplaces), null);
    } },
  ]);
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
  await assert.rejects(() => addMarketplace(join(scratch, 'no-such-repo')),
    (e) => e.code === 'BAD_REQUEST' && e.syncError?.code === 'UNREACHABLE' && /does not exist/.test(e.syncError.message));
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
  assert.equal(synced.lastError, null, 'G12: a good sync has no lastError');
  assert.deepEqual(synced.plugins.map((p) => p.name), ['cc', 'dd']);
  assert.equal(synced.lastSync.sha, sha2); // E3
  rmSync(root, { recursive: true, force: true }); // repo vanishes
  rmSync(repoCacheDir(root), { recursive: true, force: true }); // and its cache
  const stale = await syncMarketplace(entry.id);
  assert.deepEqual(stale.plugins.map((p) => p.name), ['cc', 'dd'], 'stale snapshot kept');
  assert.equal(stale.lastSync.sha, sha2, 'stale sync keeps the last good sha'); // E3
  assert.match(stale.warnings.join('\n'), /refresh failed:/); // C4 wording
  assert.match(stale.warnings.join('\n'), /last sync|never synced/);
  assert.equal(stale.lastError.code, 'UNREACHABLE', 'G12: a vanished repo cannot be reached');
  assert.match(stale.lastError.message, /does not exist|does not appear to be a git repository/);
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
  assert.equal(entry.name, 'no-manifest', 'G6: no marketplace manifest -> the folder name, never the hashed id');
  assert.equal(readMarketplaces().marketplaces[entry.id].name, 'no-manifest', 'stored on add');
});

test('listMarketplaces sorts by the name a read shows; an entry with neither name nor url reads as its id (G6)', () => {
  const off = 'https://gitlab.com/acme/zeta';
  const offId = marketplaceId(off);
  const row = (eid, url, name) => ({ id: eid, url, name, description: '', addedAt: '2026-09-03T00:00:00.000Z', lastSync: null, plugins: [], warnings: [] });
  writeMarketplaces({ seededBuiltin: true, marketplaces: {
    [offId]: row(offId, off, offId), 'beta-0000eeee': row('beta-0000eeee', 'https://github.com/acme/beta', 'Beta'), 'bare-0000dddd': row('bare-0000dddd', '', ''),
  } });
  try {
    assert.deepEqual(listMarketplaces().map((m) => m.name), ['acme/zeta', 'bare-0000dddd', 'Beta']);
  } finally {
    writeMarketplaces({ seededBuiltin: true, marketplaces: {} });
  }
});

test('refresh-all without git keeps an off-GitHub marketplace as a read shows it (G6)', async (t) => {
  const url = 'https://gitlab.com/acme/offgit';
  const id = marketplaceId(url);
  writeMarketplaces({ seededBuiltin: true, marketplaces: { [id]: { id, url, name: id, description: '', addedAt: '2026-09-03T00:00:00.000Z', lastSync: null, plugins: [{ name: 'og', subdir: '' }], warnings: [] } } });
  withNoGit(t);
  try {
    const out = await refreshAllMarketplaces();
    assert.deepEqual(out, [listMarketplaces().find((m) => m.id === id)]);
    assert.equal(out[0].name, 'acme/offgit');
  } finally {
    writeMarketplaces({ seededBuiltin: true, marketplaces: {} });
  }
});

// The builtin marketplace is this package's GitHub repo on its `dev` branch — never the checkout
// worca runs from — so npm and container installs get it too. Seeding does no git work.
const GH = { url: 'https://github.com/o/worca', ref: 'dev' };

test('builtinMarketplaceSource: the package repository on GitHub, branch dev; WORCA_BUILTIN_MARKETPLACE replaces it at HEAD', () => {
  assert.equal(BUILTIN_MARKETPLACE_REF, 'dev');
  assert.deepEqual(builtinMarketplaceSource({}), { url: 'https://github.com/SinishaDjukic/worca-cc', ref: 'dev' });
  assert.deepEqual(builtinMarketplaceSource({ WORCA_BUILTIN_MARKETPLACE: '  ' }), builtinMarketplaceSource({}), 'blank = unset');
  assert.deepEqual(builtinMarketplaceSource({ WORCA_BUILTIN_MARKETPLACE: scratch }), { url: scratch, ref: null });
  assert.deepEqual(builtinMarketplaceSource({ WORCA_BUILTIN_MARKETPLACE: 'https://github.com/o/r.git' }),
    { url: 'https://github.com/o/r', ref: null });
});

test('seedBuiltinMarketplace: registers once with its branch, no git work, removal never resurrects; no source -> not seeded', async () => {
  await checkRows([
    { name: 'seedBuiltinMarketplace: registers the source once with its branch and no git work; removal never resurrects', run: () => {
      writeMarketplaces({ seededBuiltin: false, marketplaces: {} });
      const r1 = seedBuiltinMarketplace({ source: GH });
      assert.equal(r1.seeded, true);
      assert.equal(r1.id, marketplaceId(GH.url));
      const entry = readMarketplaces().marketplaces[r1.id];
      assert.equal(entry.url, GH.url);
      assert.equal(entry.ref, 'dev');
      assert.equal(entry.builtin, true);
      assert.equal(entry.name, 'Worca CC Official');
      assert.equal(entry.lastSync, null);
      assert.deepEqual(entry.plugins, []);
      assert.ok(!existsSync(repoCacheDir(GH.url)), 'seeding never clones');
      assert.equal(seedBuiltinMarketplace({ source: GH }).seeded, false, 'idempotent');
      removeMarketplace(r1.id);
      assert.equal(seedBuiltinMarketplace({ source: GH }).seeded, false, 'removal never resurrects');
      assert.ok(!readMarketplaces().marketplaces[r1.id]);
    } },
    { name: 'seedBuiltinMarketplace: no source -> not seeded, flag stays false', run: () => {
      writeMarketplaces({ seededBuiltin: false, marketplaces: {} });
      assert.equal(seedBuiltinMarketplace({ source: null }).seeded, false);
      assert.equal(readMarketplaces().seededBuiltin, false);
    } },
  ]);
});

test('seedBuiltinMarketplace: a local-checkout builtin (older worca) is replaced by the GitHub one; its unused cache goes', async () => {
  const { root } = await makeMarketRepo('old-builtin', ['x1']);
  writeMarketplaces({ seededBuiltin: false, marketplaces: {} });
  const legacy = await addMarketplace(root);
  const state = readMarketplaces();
  state.seededBuiltin = true;
  state.marketplaces[legacy.id].builtin = true;
  writeMarketplaces(state);
  assert.ok(existsSync(repoCacheDir(root)));
  const r = seedBuiltinMarketplace({ source: GH });
  assert.equal(r.seeded, true);
  assert.equal(r.replaced, legacy.id);
  const now = readMarketplaces().marketplaces;
  assert.ok(!now[legacy.id]);
  assert.equal(now[r.id].builtin, true);
  assert.equal(now[r.id].ref, 'dev');
  assert.ok(!existsSync(repoCacheDir(root)), 'no installed plugin shares it');
});

test('seedBuiltinMarketplace: WORCA_BUILTIN_MARKETPLACE swaps the builtin to a checkout at HEAD, and back', () => {
  writeMarketplaces({ seededBuiltin: false, marketplaces: {} });
  const gh = seedBuiltinMarketplace({ source: GH });
  const local = seedBuiltinMarketplace({ source: { url: scratch, ref: null } });
  assert.equal(local.replaced, gh.id);
  assert.equal(Object.hasOwn(readMarketplaces().marketplaces[local.id], 'ref'), false, 'a checkout is followed at HEAD');
  assert.equal(seedBuiltinMarketplace({ source: GH }).replaced, local.id);
  assert.deepEqual(Object.keys(readMarketplaces().marketplaces), [gh.id]);
});

test('seedBuiltinMarketplace: the same repo added by hand becomes the builtin on the branch, its HEAD snapshot dropped', () => {
  const id = marketplaceId(GH.url);
  writeMarketplaces({ seededBuiltin: false, marketplaces: { [id]: {
    id, url: GH.url, name: 'Mine', description: '', addedAt: '2026-09-01T00:00:00Z',
    lastSync: { sha: 'a'.repeat(40), at: '2026-09-01T00:00:00Z' }, plugins: [{ name: 'old' }], warnings: [],
    lastError: { message: 'HTTP 403', code: 'UNREACHABLE', at: '2026-09-01T00:00:00Z' },
  } } });
  assert.equal(seedBuiltinMarketplace({ source: GH }).seeded, true);
  const entry = readMarketplaces().marketplaces[id];
  assert.equal(entry.builtin, true);
  assert.equal(entry.ref, 'dev');
  assert.equal(entry.name, 'Mine');
  assert.equal(entry.lastSync, null);
  assert.deepEqual(entry.plugins, []);
  assert.equal(Object.hasOwn(entry, 'lastError'), false, 'G12: the new branch has not failed yet');
});

test('a marketplace with a ref discovers that branch, not HEAD; a missing branch is a sync warning', async () => {
  const { root } = await makeMarketRepo('branchy', ['on-main']);
  await git(root, 'checkout', '-q', '-b', 'dev');
  writeTree(root, {
    'worca-cc-marketplace.json': JSON.stringify({ name: 'branchy market', plugins: ['plugins/on-main', 'plugins/on-dev'] }),
    'plugins/on-dev/worca-cc-plugin.json': PLUGIN('on-dev'),
    'plugins/on-dev/index.mjs': 'export default () => ({});\n',
  });
  await git(root, 'add', '-A');
  await git(root, 'commit', '-qm', 'dev only');
  const devSha = await git(root, 'rev-parse', 'HEAD');
  await git(root, 'checkout', '-q', 'main'); // HEAD, the default branch, lags dev
  writeMarketplaces({ seededBuiltin: false, marketplaces: {} });
  const { id } = seedBuiltinMarketplace({ source: { url: root, ref: 'dev' } });
  const synced = await syncMarketplace(id);
  assert.equal(synced.lastSync.sha, devSha);
  assert.deepEqual(synced.plugins.map((p) => p.name).sort(), ['on-dev', 'on-main']);
  assert.deepEqual(resolveInstallSource('on-dev'), { repoUrl: root, subdir: 'plugins/on-dev', sha: devSha, marketplace: id });
  const state = readMarketplaces();
  state.marketplaces[id].ref = 'nope';
  writeMarketplaces(state);
  const bad = await syncMarketplace(id);
  assert.match(bad.warnings[0], /refresh failed: branch "nope" not found/);
  assert.equal(bad.lastSync.sha, devSha, 'the last snapshot stays usable');
  assert.deepEqual([bad.lastError.code, bad.lastError.message], ['SYNC_FAILED', 'branch "nope" not found']);
  assert.match(bad.lastError.at, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d/);
  assert.deepEqual(readMarketplaces().marketplaces[id].lastError, bad.lastError, 'stored through mutateEntry');
  const back = readMarketplaces();
  back.marketplaces[id].ref = 'dev';
  writeMarketplaces(back);
  assert.equal((await syncMarketplace(id)).lastError, null, 'a good sync clears it');
  assert.equal(Object.hasOwn(readMarketplaces().marketplaces[id], 'lastError'), false, 'the key is deleted, not nulled');
});

test('marketplaceDisplayName: owner/repo on GitHub, the last two path segments of another URL (its host when it has none), else the folder name — never a credential; / and \\ both separate (G6)', async () => {
  await checkRows([
    ['https://github.com/example/worca-marketplace', 'example/worca-marketplace'],
    ['git@github.com:acme/plugins', 'acme/plugins'],
    ['https://u:tok@gitlab.com/group/sub/market', 'sub/market'],
    ['ssh://git@git.acme.dev:2222/team/market', 'team/market'],
    ['git@gitlab.com:team/market', 'team/market'],
    ['https://dev.azure.com/acme/Shop/_git/market', 'Shop/market'],
    ['https://git.acme.dev/market', 'market'],
    ['/Users/dp/exports/release-notes', 'release-notes'],
    ['/srv/markets/acme/', 'acme'],
    ['C:\\Users\\dp\\markets\\acme', 'acme'],
    ['\\\\server\\share\\team-market', 'team-market'],
    ['https://gitlab.com/team/market.git', 'team/market'],
    ['git@gitlab.com:team/market.git/', 'team/market'],
    ['https://git.acme.dev/a/b?private_token=SECRET#top', 'a/b'],
    ['https://u:tok-secret@git.acme.dev:8443', 'git.acme.dev'],
    ['https://u:tok-secret@git.acme.dev:8443?private_token=SECRET#top', 'git.acme.dev'],
    ['https://git.acme.dev#top', 'git.acme.dev'],
    ['https://git.acme.dev?private_token=/SECRET', 'git.acme.dev'],
    ['file:///srv/markets/acme', 'acme'],
    ['FILE:///srv/markets/acme', 'acme'],
    ['file://u:tok-secret@host', ''],
    ['file://u:tok-secret@host/', ''],
    ['/srv/git/acme.git', 'acme'],
    ['', ''],
    [undefined, ''],
    [null, ''],
    [{ toString: 0 }, ''],
  ].map(([url, want]) => ({ name: `${JSON.stringify(url)} -> ${JSON.stringify(want)}`, run: () => assert.equal(marketplaceDisplayName(url), want) })));
});

test('a marketplace an older worca named by its hashed id: read shows the fallback at once, its next good sync stores it; a given name is never replaced (G6)', async () => {
  const root = join(scratch, 'old-nameless');
  writeTree(root, { 'solo2/worca-cc-plugin.json': PLUGIN('solo2'), 'solo2/index.mjs': 'export default () => ({});\n' });
  await git(root, 'init', '-q', '-b', 'main');
  await git(root, 'add', '-A');
  await git(root, 'commit', '-qm', 'c1');
  const id = marketplaceId(root);
  const row = (eid, url, name) => ({ id: eid, url, name, description: '', addedAt: '2026-09-03T00:00:00.000Z', lastSync: null, plugins: [], warnings: [] });
  writeMarketplaces({ seededBuiltin: true, marketplaces: {
    [id]: row(id, root, id),
    'github.com-acme-nameless-0000aaaa': row('github.com-acme-nameless-0000aaaa', 'https://github.com/acme/nameless', 'github.com-acme-nameless-0000aaaa'),
    'named-0000bbbb': row('named-0000bbbb', 'https://github.com/acme/named', 'Acme Named'),
  } });
  try {
    const byId = Object.fromEntries(listMarketplaces().map((m) => [m.id, m.name]));
    assert.deepEqual([byId[id], byId['github.com-acme-nameless-0000aaaa'], byId['named-0000bbbb']],
      ['old-nameless', 'acme/nameless', 'Acme Named']);
    assert.equal(readMarketplaces().marketplaces[id].name, id, 'a read never writes');
    assert.equal((await syncMarketplace(id)).name, 'old-nameless');
    assert.equal(readMarketplaces().marketplaces[id].name, 'old-nameless', 'the good sync stored it');
  } finally {
    writeMarketplaces({ seededBuiltin: true, marketplaces: {} });
  }
});

test('syncErrorOf: each git phrase for a source it cannot reach is enough on its own; every GitHub access code is UNREACHABLE (G12)', async () => {
  const gitErr = (stderr) => Object.assign(new Error('Command failed: git fetch'), { code: 128, stderr });
  const code = (err) => syncErrorOf(err).code;
  const RPC = 'error: RPC failed; HTTP 502 curl 22 The requested URL returned error: 502\nfatal: expected flush after ref listing\n';
  const rows = [
    ['unable to access', "fatal: unable to access 'https://git.acme.dev/a/b/': Failed to connect to git.acme.dev port 443 after 2 ms: Couldn't connect to server\n"],
    ['could not resolve host', 'fatal: Could not resolve host: git.acme.dev\n'],
    ['does not appear to be a git repository', "fatal: '/srv/gone' does not appear to be a git repository\n"],
    ['could not read from remote repository', 'git@git.acme.dev: Permission denied.\nfatal: Could not read from remote repository.\n'],
    ['could not read Username', "fatal: could not read Username for 'https://git.acme.dev': No such device or address\n"],
    ['could not read Password', "fatal: could not read Password for 'https://u@git.acme.dev': No such device or address\n"],
    ['authentication failed', "remote: Invalid username or password.\nfatal: Authentication failed for 'https://git.acme.dev/a/b/'\n"],
    ['terminal prompts disabled', 'fatal: terminal prompts disabled\n'],
    ['permission denied (publickey)', 'git@git.acme.dev: Permission denied (publickey).\n'],
    ['host key verification failed', 'Host key verification failed.\n'],
    ['connection refused', 'ssh: connect to host git.acme.dev port 22: Connection refused\n'],
    ['connection timed out', 'ssh: connect to host git.acme.dev port 22: Connection timed out\n'],
    ['connection reset', 'kex_exchange_identification: read: Connection reset by peer\n'],
    ['network is unreachable', 'ssh: connect to host git.acme.dev port 22: Network is unreachable\n'],
    ['repository not exported', 'fatal: remote error: repository not exported: /a/b\n'],
    ['smart-HTTP status', RPC],
  ].map(([name, stderr]) => ({ name, run: () => assert.equal(code(gitErr(stderr)), 'UNREACHABLE') }));
  rows.push({ name: 'smart-HTTP status message', run: () => assert.equal(syncErrorOf(gitErr(RPC)).message, 'HTTP 502') });
  for (const c of ['GITHUB_AUTH', 'GITHUB_FORBIDDEN', 'GITHUB_RATE_LIMITED']) rows.push({ name: c, run: () => assert.equal(code(new GithubError(c, `${c} text`)), 'UNREACHABLE') });
  rows.push({ name: 'a plain failure stays SYNC_FAILED', run: () => assert.equal(code(gitErr('fatal: bad object 0123\n')), 'SYNC_FAILED') });
  await checkRows(rows);
});

test('a failed sync is cleaned in linear time: a 200 kB line comes back masked in well under a second (G12)', () => {
  const gitErr = (stderr) => Object.assign(new Error('Command failed: git clone'), { code: 128, stderr });
  const t0 = Date.now();
  for (const s of ['a'.repeat(200_000), 'a.'.repeat(100_000), `https://${'u'.repeat(200_000)}@git.acme.dev/a`]) syncErrorOf(gitErr(`fatal: repository '${s}' not found\n`));
  assert.ok(Date.now() - t0 < 1000, `took ${Date.now() - t0} ms`);
});

test('syncErrorOf: a failed sync as { message, code, at } — an HTTP status, network, auth or a missing repo is UNREACHABLE, the rest SYNC_FAILED; a URL credential never survives (G12)', async () => {
  const AT = '2026-10-20T00:00:00.000Z';
  const gitErr = (stderr) => Object.assign(new Error('Command failed: git clone'), { code: 128, stderr });
  const want = (message, code) => ({ message, code, at: AT });
  await checkRows([
    { name: 'git HTTP 403 -> "HTTP 403"', run: () => assert.deepEqual(syncErrorOf(gitErr("Cloning into bare repository 'x'...\nfatal: unable to access 'https://github.com/example/worca-marketplace/': The requested URL returned error: 403\n"), AT), want('HTTP 403', 'UNREACHABLE')) },
    { name: 'a lone user name in a URL git prints is masked', run: () => assert.deepEqual(syncErrorOf(gitErr("fatal: could not read Password for 'http://tok-secret-123@127.0.0.1:5': terminal prompts disabled\n"), AT), want("could not read Password for 'http://***@127.0.0.1:5': terminal prompts disabled", 'UNREACHABLE')) },
    { name: 'a raw @ in a password keeps no tail', run: () => assert.deepEqual(syncErrorOf(gitErr("fatal: repository 'https://u:p@ss@git.acme.dev/a/b/' not found\n"), AT), want("repository 'https://***@git.acme.dev/a/b/' not found", 'UNREACHABLE')) },
    { name: 'a timeout: no command line, no cache folder', run: () => assert.deepEqual(syncErrorOf(Object.assign(new Error(`Command failed: git clone --quiet --bare https://u:tok@git.acme.dev/a/b ${join(pluginsRoot(), '.cache', 'u-tok-git.acme.dev-a-b-1234abcd.git')}`), { killed: true, signal: 'SIGKILL', code: null, stderr: '' }), AT), want('timed out', 'UNREACHABLE')) },
    { name: "worca's cache folder never shows, with either slash", run: () => assert.deepEqual([join(pluginsRoot(), '.cache', 'u-tok-x-1234abcd.git'), `${pluginsRoot().replace(/\\/g, '/')}/.cache/u-tok-x-1234abcd.git`].map((p) => syncErrorOf(gitErr(`fatal: not a git repository: '${p}'\n`), AT)), [want("not a git repository: '<worca cache>'", 'SYNC_FAILED'), want("not a git repository: '<worca cache>'", 'SYNC_FAILED')]) },
    { name: 'a file-system error names no worca folder', run: () => assert.deepEqual(syncErrorOf(Object.assign(new Error(`EACCES: permission denied, mkdir '${join(pluginsRoot(), '.cache')}'`), { code: 'EACCES' }), AT), want("EACCES: permission denied, mkdir '<worca cache>'", 'SYNC_FAILED')) },
    { name: 'a git daemon refusal', run: () => assert.deepEqual(syncErrorOf(gitErr('fatal: remote error: access denied or repository not exported: /a/b\n'), AT), want('remote error: access denied or repository not exported: /a/b', 'UNREACHABLE')) },
    { name: 'a long message is cut to 300 characters', run: () => { const m = syncErrorOf(gitErr(`fatal: remote error: ${'x'.repeat(5000)}\n`), AT).message; assert.deepEqual([m.length, m.endsWith('…'), m.startsWith('remote error: xxx')], [300, true, true]); } },
    { name: 'GitHub 5xx is reachability', run: () => assert.deepEqual(syncErrorOf(new GithubError('GITHUB_HTTP', 'GitHub (HTTP 502)', { status: 502 }), AT), want('GitHub (HTTP 502)', 'UNREACHABLE')) },
    { name: 'git DNS -> the reason, URL prefix dropped', run: () => assert.deepEqual(syncErrorOf(gitErr("fatal: unable to access 'https://git.worca-test.invalid/a/b/': Could not resolve host: git.worca-test.invalid\n"), AT), want('Could not resolve host: git.worca-test.invalid', 'UNREACHABLE')) },
    { name: 'git: a local repo that is gone', run: () => assert.deepEqual(syncErrorOf(gitErr("fatal: repository '/srv/gone' does not exist\n"), AT), want("repository '/srv/gone' does not exist", 'UNREACHABLE')) },
    { name: 'git: an origin that is not a repository', run: () => assert.deepEqual(syncErrorOf(gitErr("fatal: '/srv/gone' does not appear to be a git repository\nfatal: Could not read from remote repository.\n"), AT), want("'/srv/gone' does not appear to be a git repository", 'UNREACHABLE')) },
    { name: 'git: credentials in a URL are masked', run: () => assert.deepEqual(syncErrorOf(gitErr("fatal: repository 'https://u:tok123@git.acme.dev/a/b/' not found\n"), AT), want("repository 'https://***@git.acme.dev/a/b/' not found", 'UNREACHABLE')) },
    { name: 'git: an empty repo', run: () => assert.deepEqual(syncErrorOf(gitErr("fatal: ambiguous argument 'HEAD': unknown revision or path not in the working tree.\n"), AT), want('repository has no commits yet', 'SYNC_FAILED')) },
    { name: 'a missing branch', run: () => assert.deepEqual(syncErrorOf(new Error('branch "nope" not found'), AT), want('branch "nope" not found', 'SYNC_FAILED')) },
    { name: 'GitHub over HTTPS: its own message', run: () => assert.deepEqual(syncErrorOf(new GithubError('GITHUB_NETWORK', 'GitHub unreachable (ENOTFOUND)'), AT), want('GitHub unreachable (ENOTFOUND)', 'UNREACHABLE')) },
    { name: 'GitHub 404 keeps its private-repo hint', run: () => assert.deepEqual(syncErrorOf(new GithubError('GITHUB_NOT_FOUND', 'not found on GitHub: acme/nope (a private repository needs GH_TOKEN)', { status: 404 }), AT), want('not found on GitHub: acme/nope (a private repository needs GH_TOKEN)', 'UNREACHABLE')) },
    { name: 'GitHub: too large is not reachability', run: () => assert.deepEqual(syncErrorOf(new GithubError('GITHUB_HTTP', 'the repository is too large to read without git'), AT), want('the repository is too large to read without git', 'SYNC_FAILED')) },
  ]);
});

test('a hand-edited snapshot whose plugins is not a list reads as no plugins (G14)', () => {
  const id = 'handmade-0000ffff';
  writeMarketplaces({ seededBuiltin: true, marketplaces: { [id]: { id, url: 'https://github.com/acme/handmade', name: 'Handmade', plugins: { not: 'a list' }, warnings: [] } } });
  try {
    assert.deepEqual(listMarketplaces().map((m) => [m.name, m.plugins]), [['Handmade', []]]);
  } finally {
    writeMarketplaces({ seededBuiltin: true, marketplaces: {} });
  }
});

test('each snapshot plugin carries its own manifest notes; warnings stay as today; an older snapshot reads notes: [] (G14)', async () => {
  const NOTE = 'plugins/ds/worca-cc-plugin.json: models[0] ("ds-stable"): env key "CLAUDE_CODE_SUBAGENT_MODEL" is reserved — ignored';
  const root = join(scratch, 'noted');
  writeTree(root, {
    'worca-cc-marketplace.json': JSON.stringify({ name: 'noted market', plugins: ['plugins/clean', 'plugins/ds'] }),
    'plugins/clean/worca-cc-plugin.json': PLUGIN('clean'),
    'plugins/clean/index.mjs': 'export default () => ({});\n',
    'plugins/ds/worca-cc-plugin.json': JSON.stringify({ name: 'noted-ds', version: '0.4.0',
      models: [{ id: 'ds-stable', env: { ANTHROPIC_MODEL: 'ds-stable', CLAUDE_CODE_SUBAGENT_MODEL: 'ds-stable' } }] }),
  });
  await git(root, 'init', '-q', '-b', 'main');
  await git(root, 'add', '-A');
  await git(root, 'commit', '-qm', 'c1');
  const entry = await addMarketplace(root);
  assert.deepEqual(entry.plugins.map((p) => [p.name, p.notes]), [['clean', []], ['noted-ds', [NOTE]]]);
  assert.deepEqual(entry.warnings, [NOTE], 'the marketplace-level list is unchanged');
  const st = readMarketplaces();
  for (const p of st.marketplaces[entry.id].plugins) delete p.notes;
  writeMarketplaces(st);
  assert.deepEqual(listMarketplaces().find((m) => m.id === entry.id).plugins.map((p) => p.notes), [[], []]);
});

test('addMarketplace reports its phases through onProgress: resolving, fetching, reading, checking per plugin, saved (G4)', async () => {
  const { root, sha } = await makeMarketRepo('m-phases', ['p1', 'p2']);
  const events = [];
  const entry = await addMarketplace(root, { onProgress: (e) => events.push(e) });
  assert.deepEqual(events, [
    { phase: 'resolving', resolvedUrl: root },
    { phase: 'fetching' },
    { phase: 'reading', sha },
    { phase: 'checking', done: 0, total: 2, plugin: null },
    { phase: 'checking', done: 1, total: 2, plugin: 'p1' },
    { phase: 'checking', done: 2, total: 2, plugin: 'p2' },
    { phase: 'saved' },
  ]);
  assert.equal(entry.lastSync.sha, sha);
  const { root: root2 } = await makeMarketRepo('m-phases-throw', ['p3']);
  assert.ok((await addMarketplace(root2, { onProgress: () => { throw new Error('listener bug'); } })).lastSync,
    'a listener that throws never breaks the add');
});

test('checkMarketplaceAdd: the refusals an add makes before any git work; EXISTS names the marketplace it already is (G5)', async () => {
  const { root } = await makeMarketRepo('m-check', ['c1']);
  assert.deepEqual(checkMarketplaceAdd(root), { url: root, id: marketplaceId(root) });
  const entry = await addMarketplace(root);
  assert.throws(() => checkMarketplaceAdd(root),
    { code: 'EXISTS', message: `marketplace already added: ${root}`, existing: { id: entry.id, name: 'm-check market' } });
  assert.throws(() => checkMarketplaceAdd('  '), { code: 'BAD_REQUEST', message: 'marketplace url is required' });
  const folder = join(scratch, 'plain-plugin');
  writeTree(folder, { 'worca-cc-plugin.json': PLUGIN('plain'), 'index.mjs': 'export default () => ({});\n' });
  assert.throws(() => checkMarketplaceAdd(folder), (e) => e.code === 'PLUGIN_FOLDER' && e.dir === folder);
});

test('an add that loses a race to the same url refuses EXISTS naming the winner (B8 re-check, G5)', async () => {
  const { root } = await makeMarketRepo('m-race-add', ['r1']);
  const id = marketplaceId(root);
  let raced = false;
  const exec = (cmd, args, opts) => {
    if (!raced) {
      raced = true;
      const st = readMarketplaces();
      st.marketplaces[id] = { id, url: root, name: 'Winner', description: '', addedAt: '2026-10-20T00:00:00.000Z', lastSync: null, plugins: [], warnings: [] };
      writeMarketplaces(st);
    }
    return execFileP(cmd, args, opts);
  };
  await assert.rejects(addMarketplace(root, { exec }), { code: 'EXISTS', existing: { id, name: 'Winner' } });
});

test('a plugin is reported checked only after its inventory is read; saved once the entry is on disk; the add returns the entry as a read shows it (G4)', async () => {
  const { root } = await makeMarketRepo('m-order', ['o1', 'o2']);
  const log = [];
  const exec = (cmd, args, opts) => {
    if (cmd === 'git' && args.includes('archive')) log.push(`archive ${args.at(-1)}`);
    return execFileP(cmd, args, opts);
  };
  let savedSeen = null;
  const entry = await addMarketplace(root, { exec, onProgress: (e) => {
    if (e.phase === 'checking' && e.plugin) log.push(`checked ${e.plugin}`);
    if (e.phase === 'saved') savedSeen = Boolean(readMarketplaces().marketplaces[marketplaceId(root)]);
  } });
  assert.deepEqual(log, ['archive plugins/o1', 'checked o1', 'archive plugins/o2', 'checked o2']);
  assert.equal(savedSeen, true, 'saved is heard once the entry is on disk');
  assert.deepEqual(entry, listMarketplaces().find((m) => m.id === entry.id), 'the add returns the entry as a read shows it');
});

test('EXISTS names an older worca entry by the name a read shows (G5, G6)', () => {
  const oldDir = join(scratch, 'old-exists');
  const oldId = marketplaceId(oldDir);
  writeMarketplaces({ seededBuiltin: true, marketplaces: { [oldId]: { id: oldId, url: oldDir, name: oldId, description: '', addedAt: '2026-09-03T00:00:00.000Z', lastSync: null, plugins: [], warnings: [] } } });
  try {
    assert.throws(() => checkMarketplaceAdd(oldDir), { code: 'EXISTS', existing: { id: oldId, name: 'old-exists' } });
  } finally {
    writeMarketplaces({ seededBuiltin: true, marketplaces: {} });
  }
});

test('checkMarketplaceAdd reads a megabyte url in linear time: a long run of trailing slashes or dashes costs one pass', () => {
  const t0 = Date.now();
  for (const url of [`https://h.invalid/${'/'.repeat(100_000)}a`, `git@h.invalid:x${'/'.repeat(100_000)}a`, `https://h.invalid/${'-'.repeat(100_000)}a`]) checkMarketplaceAdd(url);
  assert.ok(Date.now() - t0 < 1000, `took ${Date.now() - t0} ms`);
  assert.equal(marketplaceId('https://git.acme.dev/a/b///'), marketplaceId('https://git.acme.dev/a/b'), 'trailing slashes still go');
  assert.match(marketplaceId('https://git.acme.dev/a/b--'), /^git\.acme\.dev-a-b-[0-9a-f]{8}$/, 'trailing dashes still go');
});
