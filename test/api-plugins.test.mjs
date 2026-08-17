// test/api-plugins.test.mjs — /api/plugins* lifecycle surface. Boots the real
// express app (imported => no port bind; harness = test/api-workflows.test.mjs)
// against a sandboxed WORCA_HOME. The fixture plugin is a REAL local git repo
// built with execFile('git'): addPluginRepo/installPlugin clone from a
// filesystem path, so everything stays offline. WORCA_MOCK=1 so any connector
// op a doctor check performs is canned by plugin-shim.mjs (no child spawn).
// No /api/run here -> no async orchestrator work -> the single useTempHome()
// home is sufficient isolation (no late-write hazard).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pluginDir, pluginDataDir } from '../src/core/plugins-lock.mjs';
import { useTempHome } from './helpers/temp-home.mjs';

useTempHome(after);
const run = promisify(execFile);

let srv, base, repoDir, repoSha;
const JSONH = { 'Content-Type': 'application/json' };
const get = (p) => fetch(`${base}${p}`);
const post = (p, b) => fetch(`${base}${p}`, { method: 'POST', headers: JSONH, body: JSON.stringify(b) });
const put = (p, b) => fetch(`${base}${p}`, { method: 'PUT', headers: JSONH, body: JSON.stringify(b) });
const del = (p, b) => fetch(`${base}${p}`, {
  method: 'DELETE', ...(b ? { headers: JSONH, body: JSON.stringify(b) } : {}),
});

// One plugin, manifest at repo root (depth-0 discovery -> subdir ''). Ships a
// task source (one secret config key, one optionsFrom input, the mandatory
// task-browser input) + one agent pair so the uninstall guard has a key to
// trip on. No workflows/, no setup facts -> install runs no npm/uv.
const MANIFEST = {
  name: 'local-src',
  version: '0.1.0',
  description: 'test fixture plugin',
  taskSources: [{
    id: 'main',
    displayName: 'Local Source',
    module: './connector/index.mjs',
    configSchema: [
      { key: 'token', type: 'text', label: 'Token', secret: true, required: true },
      { key: 'endpoint', type: 'text', label: 'Endpoint' },
    ],
    inputs: [
      { key: 'repo', type: 'remote-select', label: 'Repo', optionsFrom: 'listRepos' },
      { key: 'task', type: 'task-browser', label: 'Task' },
    ],
  }],
};
const CONNECTOR = `export default function createTaskSource(ctx) {
  return {
    async validateConfig() { return { ok: true }; },
    async listTasks() { return { tasks: [{ id: 't1', title: 'Fixture task', state: 'open', updatedAt: '2026-07-12T00:00:00Z' }] }; },
    async getTask(id) { return { id, title: 'Fixture task', state: 'open', updatedAt: '2026-07-12T00:00:00Z', body: 'Do the thing.' }; },
    async reportResult() {},
    async listRepos() { return [{ value: 'a/b', label: 'a/b' }]; },
  };
}
`;
const AGENT_META = {
  key: 'localHelper', agentFile: 'localHelper.md',
  displayName: 'Local Helper', description: 'fixture agent', color: 'blue',
  runnerType: 'producer', consumes: [], produces: ['plan'], order: 90,
};

async function makeFixtureRepo() {
  const dir = await mkdtemp(join(tmpdir(), 'worca-cc-plugrepo-'));
  await writeFile(join(dir, 'worca-cc-plugin.json'), JSON.stringify(MANIFEST, null, 2));
  await mkdir(join(dir, 'connector'), { recursive: true });
  await writeFile(join(dir, 'connector', 'index.mjs'), CONNECTOR);
  await mkdir(join(dir, 'agents'), { recursive: true });
  await writeFile(join(dir, 'agents', 'localHelper.md'), '# Agent: Local Helper\n\nYou help locally.\n');
  await writeFile(join(dir, 'agents', 'localHelper.meta.json'), JSON.stringify(AGENT_META, null, 2));
  const git = (...args) => run('git', ['-C', dir, ...args]);
  await run('git', ['init', '-q', '-b', 'main', dir]); // -b main: no default-branch warning
  await git('config', 'user.email', 't@t');
  await git('config', 'user.name', 't');
  await git('add', '-A');
  await git('commit', '-q', '-m', 'fixture plugin');
  const { stdout } = await git('rev-parse', 'HEAD');
  return { dir, sha: stdout.trim() };
}

before(async () => {
  process.env.WORCA_MOCK = '1';
  ({ dir: repoDir, sha: repoSha } = await makeFixtureRepo());
  const { app } = await import('../ui/server.mjs'); // imported => no port bind
  srv = http.createServer(app);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
});
after(async () => {
  if (srv) await new Promise((r) => srv.close(r));
  delete process.env.WORCA_MOCK;
  await rm(repoDir, { recursive: true, force: true });
});

test('GET /api/plugins with zero plugins -> { plugins: [], orphans: [] } (feature-off bar)', async () => {
  const r = await get('/api/plugins');
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { plugins: [], orphans: [] });
});

test('POST /api/marketplaces discovers the fixture + manifest-derived preview', async () => {
  assert.equal((await post('/api/marketplaces', {})).status, 400, 'missing url -> 400');
  const r = await post('/api/marketplaces', { url: repoDir });
  assert.equal(r.status, 200);
  const { marketplace } = await r.json();
  assert.match(marketplace.lastSync.sha, /^[0-9a-f]{40}$/);
  assert.equal(marketplace.lastSync.sha, repoSha);
  const p = marketplace.plugins.find((x) => x.name === 'local-src');
  assert.ok(p, 'fixture plugin discovered at depth 0 (fallback scan — no marketplace manifest)');
  assert.equal(p.subdir, '');
  assert.equal(p.installed, false, 'installed flag merged onto the snapshot');
  assert.equal(p.inventory.taskSources[0].id, 'main');
  assert.deepEqual(p.inventory.taskSources[0].secrets, ['token'], 'secret keys surfaced pre-install');
  assert.ok(p.inventory.agents.some((a) => a.key === 'localHelper'), 'agents (with tools) inventoried pre-install');
});

test('POST /api/plugins/install -> { ok, inventory }; plugin then lists', async () => {
  assert.equal((await post('/api/plugins/install', { name: 'local-src' })).status, 400, 'missing repoUrl/sha -> 400');
  const r = await post('/api/plugins/install', { repoUrl: repoDir, subdir: '', name: 'local-src', sha: repoSha });
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.ok, true);
  assert.equal(j.inventory.taskSources[0].id, 'main');
  assert.deepEqual(j.inventory.taskSources[0].secrets, ['token']);
  assert.ok(j.inventory.agents.some((a) => a.key === 'localHelper'), 'agent in the consent inventory');

  const list = await (await get('/api/plugins')).json();
  const p = list.plugins.find((x) => x.name === 'local-src');
  assert.ok(p, 'installed plugin listed');
  assert.equal(p.enabled, true);
  assert.equal(p.pinnedSha, repoSha);
});

test('POST /api/plugins/:name/enable toggles; 404/400 guards hold', async () => {
  assert.equal((await post('/api/plugins/local-src/enable', {})).status, 400, 'non-boolean enabled -> 400');
  assert.equal((await post('/api/plugins/nope/enable', { enabled: true })).status, 404);
  assert.equal((await post(`/api/plugins/${encodeURIComponent('../etc')}/enable`, { enabled: true })).status, 404, 'traversal name reads as not-found');

  let r = await post('/api/plugins/local-src/enable', { enabled: false });
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true, enabled: false });
  let list = await (await get('/api/plugins')).json();
  assert.equal(list.plugins.find((x) => x.name === 'local-src').enabled, false);

  r = await post('/api/plugins/local-src/enable', { enabled: true }); // re-enable for later tests
  assert.equal(r.status, 200);
  list = await (await get('/api/plugins')).json();
  assert.equal(list.plugins.find((x) => x.name === 'local-src').enabled, true);
});

test('config: PUT stores, GET redacts secrets to { set: true }; value never echoed', async () => {
  const SECRET = 'sekret-token-123';
  const p = await put('/api/plugins/local-src/config', {
    sourceId: 'main', values: { token: SECRET, endpoint: 'https://x' },
  });
  assert.equal(p.status, 200);
  const pText = JSON.stringify(await p.json());
  assert.ok(!pText.includes(SECRET), 'PUT response never echoes the secret');

  const g = await get('/api/plugins/local-src/config');
  assert.equal(g.status, 200);
  const body = await g.text();
  assert.ok(!body.includes(SECRET), 'GET response never contains the stored secret');
  const j = JSON.parse(body);
  const src = j.sources.find((s) => s.id === 'main');
  assert.ok(Array.isArray(src.schema) && src.schema.some((f) => f.key === 'token' && f.secret === true));
  assert.deepEqual(src.values.token, { set: true }, 'secret redacted to a set-marker');
  assert.equal(src.values.endpoint, 'https://x', 'non-secret round-trips');

  assert.equal((await get('/api/plugins/nope/config')).status, 404);
  assert.equal((await put('/api/plugins/local-src/config', { sourceId: 'main' })).status, 400, 'missing values -> 400');
  assert.equal((await put('/api/plugins/local-src/config', { sourceId: 'bogus', values: {} })).status, 400, 'unknown sourceId -> 400');
});

test('POST /api/plugins/:name/doctor -> { ok, checks }', async () => {
  const r = await post('/api/plugins/local-src/doctor', {});
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(typeof j.ok, 'boolean');
  assert.ok(Array.isArray(j.checks) && j.checks.length >= 1);
  assert.equal((await post('/api/plugins/nope/doctor', {})).status, 404);
});

// --- orphan data: list + purge routes ---

test('GET /api/plugins reports orphan data dirs; DELETE :name/data purges them', async () => {
  // fabricate an orphan (past uninstall leftover): data/ dir, no lock entry
  await mkdir(join(pluginDataDir('ghost-src')), { recursive: true });
  await writeFile(join(pluginDataDir('ghost-src'), 'secrets.json'), '{"token":"x"}');

  let r = await get('/api/plugins');
  let body = await r.json();
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(body.orphans), 'orphans array present');
  assert.ok(body.orphans.some((o) => o.name === 'ghost-src'), 'ghost-src listed');
  assert.ok(!body.orphans.some((o) => o.name === 'local-src'), 'installed plugin not an orphan');

  const d = await del('/api/plugins/ghost-src/data');
  assert.equal(d.status, 200);
  assert.deepEqual(await d.json(), { ok: true, name: 'ghost-src' });
  assert.equal(existsSync(pluginDir('ghost-src')), false, 'orphan dir removed');

  r = await get('/api/plugins');
  body = await r.json();
  assert.ok(!body.orphans.some((o) => o.name === 'ghost-src'), 'orphan gone from list');
});

test('DELETE :name/data: 409 installed, 404 unknown, 404 bad name', async () => {
  const installed = await del('/api/plugins/local-src/data'); // fixture is installed
  assert.equal(installed.status, 409);

  const unknown = await del('/api/plugins/never-was/data');
  assert.equal(unknown.status, 404);

  const bad = await del('/api/plugins/Bad_Name/data');
  assert.equal(bad.status, 404);
});

test('DELETE /api/plugins/:name is guarded when a user workflow references a plugin agent (409 + references)', async () => {
  // Registry layer 3 (Task 6) serves localHelper while the plugin is enabled,
  // so POST /api/workflows (the production writer) accepts it — the simplest
  // way to seed a REAL referencing row.
  const wf = await post('/api/workflows', {
    name: 'Uses Local Helper',
    steps: [[{ id: 's0_0', key: 'planner' }], [{ id: 's1_0', key: 'localHelper' }]],
    feedbacks: [],
  });
  assert.equal(wf.status, 201, 'plugin agent key validates in a user workflow');
  const wfId = (await wf.json()).workflow.id;

  const blocked = await del('/api/plugins/local-src');
  assert.equal(blocked.status, 409);
  const j = await blocked.json();
  assert.ok(j.error, '409 carries an error message');
  assert.ok(Array.isArray(j.references) && j.references.length >= 1, '409 carries the referencing list');

  // Unblock, then uninstall (with purge) succeeds and the plugin vanishes.
  assert.equal((await fetch(`${base}/api/workflows/${wfId}`, { method: 'DELETE' })).status, 200);
  const ok = await del('/api/plugins/local-src', { purge: true });
  assert.equal(ok.status, 200);
  assert.deepEqual(await ok.json(), { ok: true, purged: true });
  assert.deepEqual(await (await get('/api/plugins')).json(), { plugins: [], orphans: [] });
  assert.equal((await get('/api/plugins/local-src/config')).status, 404, 'gone after uninstall');
  assert.equal((await del('/api/plugins/nope')).status, 404);
});
