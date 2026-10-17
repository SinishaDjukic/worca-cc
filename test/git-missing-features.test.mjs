// test/git-missing-features.test.mjs — U2a features stay; with git missing their git actions refuse GIT_MISSING
// before any spawn (the injected exec / fetchGit / spawnImpl count 0).
import { test, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkRows } from './helpers/rows.mjs';
import { useTempHome } from './helpers/temp-home.mjs';
import { gitDir } from './helpers/git-dir.mjs';
import { _testing as cap } from '../src/core/git-available.mjs';
import { withNoGit, gitArrives } from './helpers/git-off.mjs';
import { addPluginRepo, fetchCandidate, exportVersion } from '../src/core/plugin-repo.mjs';
import { inventoryFromCache } from '../src/core/plugin-inventory.mjs';
import { addMarketplace, syncMarketplace, refreshAllMarketplaces, seedBuiltinMarketplace } from '../src/core/marketplaces.mjs';
import { stageImport } from '../src/core/skills-registry/import.mjs';
import { runClone } from '../src/core/clone-project.mjs';
import { projectMetricsStatus, enableTeamMetrics, _testing as metricsGit } from '../src/core/metrics/sync.mjs';
import { projectPolicyStatus, enableTeamPolicy, publishPolicy } from '../src/core/policy/sync.mjs';
import { marketplaceSeedCandidates, seedPolicyMarketplaces } from '../src/core/policy/local.mjs';
import { normalizePolicyDoc } from '../src/core/policy/registry.mjs';
import { writePluginsLock } from '../src/core/plugins-lock.mjs';

useTempHome(after);
afterEach(() => { cap.reset(); metricsGit.reset(); });
const counting = () => { const calls = []; return { calls, fn: async (...a) => { calls.push(a); return { stdout: '' }; } }; };
const URL_ = 'https://github.com/acme/plugins';

test('U2a features while git is missing', async (t) => {
  withNoGit(t);
  await checkRows([
    { name: 'plugins: repo add, update check, export and inventory refuse GIT_MISSING, no exec', run: async () => {
      const x = counting();
      await assert.rejects(addPluginRepo(URL_, { exec: x.fn }), { code: 'GIT_MISSING' });
      writePluginsLock({ p: { repo: URL_, subdir: '', pinnedSha: 'a'.repeat(40), version: '1', enabled: true } });   // a locked plugin: the refusal is about git, not an unknown name
      await assert.rejects(fetchCandidate('p', { exec: x.fn }), { code: 'GIT_MISSING' });
      await assert.rejects(exportVersion('p', 'a'.repeat(40), { exec: x.fn, repoUrl: URL_ }), { code: 'GIT_MISSING' });
      await assert.rejects(inventoryFromCache(URL_, 'a'.repeat(40), '', { exec: x.fn }), { code: 'GIT_MISSING' });
      assert.equal(x.calls.length, 0);
    } },
    { name: 'marketplaces: add refuses, a plugin folder still links, refresh-all is a quiet no-op, one refresh refuses', run: async () => {
      const x = counting(); seedBuiltinMarketplace();
      await assert.rejects(addMarketplace(URL_, { exec: x.fn }), { code: 'GIT_MISSING', message: 'git is not installed on this machine' });
      const folder = mkdtempSync(join(tmpdir(), 'worca-p0-plugin-'));
      writeFileSync(join(folder, 'worca-cc-plugin.json'), '{"name":"p0"}');
      await assert.rejects(addMarketplace(folder, { exec: x.fn }), { code: 'PLUGIN_FOLDER' });
      const all = await refreshAllMarketplaces({ exec: x.fn });
      assert.ok(all.length >= 1 && all.every((m) => m.lastSync === null));
      await assert.rejects(syncMarketplace(all[0].id, { exec: x.fn }), { code: 'GIT_MISSING' });
      assert.equal(x.calls.length, 0);
    } },
    { name: 'skills: a Git URL import is 409 GIT_MISSING, fetchGit never called', run: async () => {
      let n = 0;
      await assert.rejects(stageImport({ kind: 'git', url: 'https://github.com/acme/skills' }, { fetchGit: async () => { n += 1; return {}; } }),
        { status: 409, code: 'GIT_MISSING', message: 'git is not installed on this machine' });
      assert.equal(n, 0);
    } },
    { name: 'clone: CloneError git-missing, nothing spawned, no folder', run: async () => {
      let n = 0; const dir = join(mkdtempSync(join(tmpdir(), 'worca-p0-clone-')), 'repo');
      await assert.rejects(runClone({ url: URL_, host: 'github.com', dir, branch: null }, { spawnImpl: () => { n += 1; throw new Error('spawned'); } }), { code: 'git-missing' });
      assert.equal(n, 0); assert.equal(existsSync(dir), false);
    } },
    { name: 'team metrics / policy: status settles nothing (setup stays offered), enable and publish refuse', run: async () => {
      const repo = gitDir('p0-team'); const g = counting(); metricsGit.setGit(g.fn);
      const p = { key: 'p0team-00000001', name: 'p0team', path: repo, exists: true };
      const m = await projectMetricsStatus(p);
      assert.deepEqual([m.hasOrigin, m.noGit], [null, undefined]);
      assert.equal((await projectPolicyStatus(p)).hasOrigin, null);
      await assert.rejects(enableTeamMetrics(repo), { code: 'GIT_MISSING' });
      await assert.rejects(enableTeamPolicy(repo), { code: 'GIT_MISSING' });
      await assert.rejects(publishPolicy(repo, {}), { code: 'GIT_MISSING' });
      assert.equal(g.calls.length, 0);
    } },
    { name: 'policy marketplace seeding while git is missing is not remembered (it seeds once git arrives)', run: async () => {
      const homes = [{ slug: 'acme/gw', doc: normalizePolicyDoc({ schema: 1, fields: { 'plugins.marketplaces': { kind: 'default', value: ['https://gitlab.com/acme/seeded'] } } }).doc }];
      const res = await seedPolicyMarketplaces(homes);
      assert.deepEqual(res.map((r) => [r.added, r.error]), [[false, 'git is not installed on this machine']]);
      assert.deepEqual(marketplaceSeedCandidates(homes).map((c) => c.url), ['https://gitlab.com/acme/seeded']);
    } },
  ]);
});

// The team-metrics checkout (metrics/repos/<slug>) is the cache the Team metrics page and Ask read offline. Its health
// check needs git: while git is missing a failed check must not read as "corrupted: remove it and clone again".
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { worktreePath as metricsCheckout, ensureWorktree as ensureMetricsCheckout } from '../src/core/metrics/sync.mjs';
import { readScope } from '../src/core/metrics/read.mjs';
import { addProject, listProjects } from '../src/core/projects.mjs';
import { writeTeamMetricsPrefs } from '../src/core/config.mjs';

test('the team-metrics checkout survives git going missing (the page keeps reading it)', async (t) => {
  withNoGit(t);
  gitArrives();
  const repo = gitDir('p0-tm-cache');
  const name = `p0tmcache-${Date.now()}`;
  await addProject({ name, path: repo });
  const { key } = (await listProjects()).find((p) => p.name === name);
  const slug = 'github.com/acme/p0-tm-cache';
  writeTeamMetricsPrefs(key, { enabled: true, hasOrigin: true, remote: 'origin', slug, configKnown: true, config: { attribution: 'git-user' }, checkedAt: new Date().toISOString() });
  const dir = metricsCheckout(slug);
  mkdirSync(dirname(dir), { recursive: true });
  execFileSync('git', ['worktree', 'add', '--detach', dir, 'HEAD'], { cwd: repo });
  withNoGit();
  await checkRows([
    { name: 'readScope (GET /api/team-metrics, Ask metrics) leaves the checkout in place', run: async () => {
      await readScope({ kind: 'project', id: key }).catch(() => {});   // P0 serves it offline; after P6 it reads over HTTPS
      assert.ok(existsSync(dir));
    } },
    { name: 'ensureWorktree hands the checkout back unchecked', run: async () => {
      assert.equal(await ensureMetricsCheckout(slug, repo), dir);
      assert.ok(existsSync(dir));
    } },
  ]);
});
