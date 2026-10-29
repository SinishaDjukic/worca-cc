// test/git-free-marketplace-api.test.mjs — /api/marketplaces* and plugin install/update without git (P6 Task 5).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { useTempHome } from './helpers/temp-home.mjs';
import { seedBuiltinMarketplace, readMarketplaces, writeMarketplaces, marketplaceId } from '../src/core/marketplaces.mjs';
import { readPluginsLock, pluginDir } from '../src/core/plugins-lock.mjs';
import { repoSnapshotRoot } from '../src/core/plugin-repo.mjs';
import { _testing as ghTesting } from '../src/core/git-free/github.mjs';
import { fakeGithub } from './helpers/fake-github.mjs';
import { withNoGit } from './helpers/git-off.mjs';
import { withEnv } from './helpers/with-env.mjs';

const NO_CREDS = { GH_TOKEN: undefined, GITHUB_TOKEN: undefined, WORCA_GH_READ_TOKEN: undefined, WORCA_GH_WRITE_TOKEN: undefined,
  WORCA_GH_APP_ID: undefined, WORCA_GH_APP_KEY_FILE: undefined, WORCA_GH_APP_KEY_B64: undefined };
useTempHome(after);
// A read-only folder stops a removal half-way (what a killed process leaves) only for a POSIX user other than root.
const STUCK = { skip: process.platform === 'win32' || process.getuid?.() === 0 ? 'a read-only folder blocks a removal only for a non-root POSIX user' : false };
const ROOT = mkdtempSync(join(tmpdir(), 'worca-gf-mkt-'));   // every fixture folder of this file
after(() => rmSync(ROOT, { recursive: true, force: true }));
const gh = await fakeGithub();
ghTesting.setFetch(gh.fetch);
let srv, base;
const JSONH = { 'Content-Type': 'application/json' };
const get = (p) => fetch(`${base}${p}`);
const post = (p, b) => fetch(`${base}${p}`, { method: 'POST', headers: JSONH, body: JSON.stringify(b) });
before(async () => {
  const { app } = await import('../ui/server.mjs');
  srv = http.createServer(app);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
});
after(async () => { ghTesting.reset(); gh.close(); if (srv) await new Promise((r) => srv.close(r)); });

const MANIFEST = (name) => JSON.stringify({ name, version: '0.1.0', description: `${name} fixture`,
  taskSources: [{ id: 'main', displayName: name, module: './index.mjs', inputs: [{ key: 'task', type: 'task-browser', label: 'Task' }] }] });
const INDEX = 'export default () => ({ async validateConfig(){return {ok:true};} });\n';
const MARKET = {
  'worca-cc-marketplace.json': JSON.stringify({ name: 'Acme Market', description: 'd', plugins: ['plugins/alpha', 'plugins/beta'] }),
  'plugins/alpha/worca-cc-plugin.json': MANIFEST('alpha-plugin'), 'plugins/alpha/index.mjs': INDEX,
  'plugins/beta/worca-cc-plugin.json': MANIFEST('beta-plugin'), 'plugins/beta/index.mjs': INDEX,
};

test('the seeded builtin marketplace (GitHub, branch dev) refreshes, installs and updates without git', async (t) => {
  gh.repo('acme/worca', { files: MARKET });
  const dev = gh.commit('acme/worca', { branch: 'dev', from: 'main', message: 'dev tip', files: { 'plugins/beta/README.md': 'b\n' } });
  seedBuiltinMarketplace({ source: { url: 'https://github.com/acme/worca', ref: 'dev' } });
  withNoGit(t);
  let r = await post('/api/marketplaces/refresh', {});
  assert.equal(r.status, 200);
  const m = (await r.json()).marketplaces.find((x) => x.builtin);
  assert.deepEqual([m.lastSync.sha, m.name, 'needsGit' in m], [dev, 'Acme Market', false]);
  assert.deepEqual(m.plugins.map((p) => [p.name, p.installed]), [['alpha-plugin', false], ['beta-plugin', false]]);
  r = await post('/api/plugins/install', { repoUrl: m.url, subdir: 'plugins/alpha', name: 'alpha-plugin', sha: dev, marketplace: m.id });
  assert.equal(r.status, 200, await r.clone().text());
  const lock = readPluginsLock()['alpha-plugin'];
  assert.deepEqual([lock.repo, lock.subdir, lock.pinnedSha, lock.ref], ['https://github.com/acme/worca', 'plugins/alpha', dev, 'dev']);
  assert.equal(existsSync(join(pluginDir('alpha-plugin'), 'versions', dev.slice(0, 7), 'index.mjs')), true);
  const next = gh.commit('acme/worca', { branch: 'dev', message: 'alpha v2', files: { 'plugins/alpha/index.mjs': `${INDEX}// v2\n` } });
  r = await post('/api/plugins/alpha-plugin/update', {});
  assert.deepEqual((await r.json()).preview.commits.map((c) => c.subject), ['alpha v2']);
  r = await post('/api/plugins/alpha-plugin/update', { confirm: true, candidateSha: next });
  assert.equal(r.status, 200);
  assert.equal(readPluginsLock()['alpha-plugin'].pinnedSha, next);
  r = await fetch(`${base}/api/plugins/alpha-plugin`, { method: 'DELETE' });
  assert.equal(r.status, 200);
  assert.equal(existsSync(repoSnapshotRoot('https://github.com/acme/worca')), false);
});

test('without git: owner/repo is GitHub; a local repository or another host answers 409 GIT_MISSING; a plugin folder is linked even with a .git', async (t) => {
  gh.repo('acme/short', { files: MARKET });
  withNoGit(t);
  let r = await post('/api/marketplaces', { url: 'acme/short' });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).marketplace.url, 'https://github.com/acme/short');
  for (const url of ['https://gitlab.com/acme/market', gh.repo('acme/localrepo', { files: MARKET }).bare]) {
    for (const body of [{ url }, { url, progress: true }]) {   // the add job never defers this refusal (CONTRACT §2.1)
      r = await post('/api/marketplaces', body);
      assert.equal(r.status, 409);
      assert.deepEqual(await r.json(), { error: 'git is not installed on this machine', code: 'GIT_MISSING' });
    }
  }
  const folder = mkdtempSync(join(ROOT, 'plugdir-'));
  writeFileSync(join(folder, 'worca-cc-plugin.json'), MANIFEST('folder-plugin'));
  writeFileSync(join(folder, 'index.mjs'), INDEX);
  mkdirSync(join(folder, '.git'));
  r = await post('/api/marketplaces', { url: folder });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).linked, true);
});

test('a marketplace on another host stays listed without git: needsGit, untouched by refresh-all; its own refresh and install answer 409', async (t) => {
  const url = 'https://gitlab.com/acme/market';
  const id = marketplaceId(url);
  const st = readMarketplaces();
  st.marketplaces[id] = { id, url, name: 'GL', description: '', addedAt: '2026-10-01T00:00:00.000Z',
    lastSync: { sha: 'a'.repeat(40), at: '2026-10-01T00:00:00.000Z' }, plugins: [{ name: 'gl-plugin', subdir: 'p', description: '', version: null, inventory: {} }], warnings: [],
    lastError: { message: 'HTTP 403', code: 'UNREACHABLE', at: '2026-10-01T00:00:00.000Z' } };
  writeMarketplaces(st);
  withNoGit(t);
  const list = await (await get('/api/marketplaces')).json();
  const listed = list.marketplaces.find((m) => m.id === id);
  assert.deepEqual([listed.needsGit, listed.lastError], [true, null], 'SM4: a source that needs git is never shown unreachable');
  const all = await (await post('/api/marketplaces/refresh', {})).json();
  const kept = all.marketplaces.find((m) => m.id === id);
  assert.deepEqual([kept.needsGit, kept.warnings, kept.lastSync.sha, kept.lastError], [true, [], 'a'.repeat(40), null]);
  const one = await post(`/api/marketplaces/${id}/refresh`, {});
  assert.deepEqual([one.status, await one.json()], [409, { error: 'git is not installed on this machine', code: 'GIT_MISSING' }]);
  assert.equal(readMarketplaces().marketplaces[id].lastSync.sha, 'a'.repeat(40));
  const r = await post('/api/plugins/install', { repoUrl: url, subdir: 'p', name: 'gl-plugin', sha: 'a'.repeat(40), marketplace: id });
  assert.deepEqual([r.status, (await r.json()).code], [409, 'GIT_MISSING']);
});

test('with git installed the same list carries no needsGit key (byte-identical payload)', async () => {
  const withGit = await (await get('/api/marketplaces')).json();
  assert.equal(withGit.marketplaces.some((m) => m.url === 'https://gitlab.com/acme/market'), true);
  assert.equal(withGit.marketplaces.some((m) => 'needsGit' in m), false);
});

test('a GitHub failure on install answers 502 { error }', async (t) => {
  withNoGit(t);
  const r = await withEnv(NO_CREDS, () => post('/api/plugins/install', { repoUrl: 'https://github.com/acme/nope', name: 'nope-plugin', sha: 'b'.repeat(40) }));
  assert.deepEqual([r.status, await r.json()], [502, { error: 'not found on GitHub: acme/nope (a private repository needs GH_TOKEN)' }]);
});

test('removing a GitHub marketplace without git drops its snapshots', async (t) => {
  gh.repo('acme/mk', { files: { 'worca-cc-plugin.json': MANIFEST('mk-plugin'), 'index.mjs': INDEX } });
  withNoGit(t);
  const m = (await (await post('/api/marketplaces', { url: 'https://github.com/acme/mk' })).json()).marketplace;
  assert.equal(existsSync(repoSnapshotRoot(m.url)), true);
  assert.equal((await fetch(`${base}/api/marketplaces/${m.id}`, { method: 'DELETE' })).status, 200);
  assert.equal(existsSync(repoSnapshotRoot(m.url)), false);
});

test('a marketplace removal that stops half-way leaves no snapshot behind: the root is renamed aside first', STUCK, async (t) => {
  const { sha } = gh.repo('acme/mkro', { files: { 'worca-cc-plugin.json': MANIFEST('mkro-plugin'), 'index.mjs': INDEX } });
  withNoGit(t);
  const m = (await (await post('/api/marketplaces', { url: 'https://github.com/acme/mkro' })).json()).marketplace;
  const root = repoSnapshotRoot(m.url);
  chmodSync(join(root, sha), 0o555);   // a root plugin: the snapshot folder holds its files, which cannot be removed
  try {
    assert.equal((await fetch(`${base}/api/marketplaces/${m.id}`, { method: 'DELETE' })).status, 200);
    assert.equal(existsSync(root), false);
  } finally {
    const trash = readdirSync(dirname(root)).filter((n) => n.startsWith(`${basename(root)}.trash-`)).map((n) => join(dirname(root), n));
    for (const d of [root, ...trash]) if (existsSync(join(d, sha))) chmodSync(join(d, sha), 0o755);
  }
});

test('worca marketplace list / refresh without git say "needs git" for a marketplace off GitHub; with git the line is unchanged', async () => {
  const home = mkdtempSync(join(ROOT, 'cli-home-'));
  const url = 'https://gitlab.com/acme/market';
  const id = marketplaceId(url);
  // seededBuiltin with no builtin entry: the CLI seeds nothing, so refresh-all reads no network
  await withEnv({ WORCA_HOME: home }, () => writeMarketplaces({ seededBuiltin: true, marketplaces: { [id]: { id, url, name: 'GL', description: '',
    addedAt: '2026-10-01T00:00:00.000Z', lastSync: { sha: 'a'.repeat(40), at: '2026-10-01T00:00:00.000Z' },
    plugins: [{ name: 'gl-plugin', subdir: 'p', description: '', version: null, inventory: {} }], warnings: [] } } }));
  const cli = (git, ...args) => promisify(execFile)(process.execPath, [fileURLToPath(new URL('../src/cli/worca-cc.mjs', import.meta.url)), 'marketplace', ...args],
    { cwd: home, env: { ...process.env, WORCA_HOME: home, WORCA_MOCK: '1', WORCA_GIT: git } });
  assert.equal((await cli('0', 'list')).stdout, `GL\t${id}\t${url}\taaaaaaa (1 plugins)\tneeds git\n`);
  assert.equal((await cli('0', 'refresh')).stdout, 'GL\taaaaaaa (1 plugins)\tneeds git\n');
  assert.equal((await cli('1', 'list')).stdout, `GL\t${id}\t${url}\taaaaaaa (1 plugins)\n`);
});

test('without git the add job reads GitHub over HTTPS and ends done with the marketplace', async (t) => {
  const { sha } = gh.repo('acme/jobbed', { files: MARKET });
  withNoGit(t);
  const r = await post('/api/marketplaces', { url: 'acme/jobbed', progress: true });
  assert.equal(r.status, 202);
  const { jobId } = await r.json();
  let job;
  for (let i = 0; i < 200; i++) {
    job = (await (await get(`/api/marketplaces/jobs/${jobId}`)).json()).job;
    if (job.state !== 'running') break;
    await new Promise((res) => setTimeout(res, 50));
  }
  assert.deepEqual([job.state, job.phase, job.resolvedUrl, job.sha, job.done, job.total, job.marketplace.name],
    ['done', 'saved', 'https://github.com/acme/jobbed', sha, 2, 2, 'Acme Market']);
});
