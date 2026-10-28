// test/api-plugins-detail.test.mjs — the redesign's plugin data over HTTP (CONTRACT §1): row fields, the detail route,
// the references dry run, the update preview's top level, the stale-preview 409 and the plugins-changed frames.
// The module's own server (the WS endpoint lives there), a sandboxed WORCA_HOME, a local git repo as plugin source and
// marketplace: offline. WORCA_MOCK=1 so no connector ever spawns.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { readPluginsLock, writePluginsLock } from '../src/core/plugins-lock.mjs';
import { WebSocket } from 'ws';

useTempHome(after);
const run = promisify(execFile);
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
let server, base, repoDir, v1, v2, mktId;
const frames = []; let ws;
const call = async (method, p, body) => {
  const r = await fetch(`${base}${p}`, { method, ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) });
  const text = await r.text();
  return { status: r.status, body: text ? JSON.parse(text) : null };
};
const SOURCE = (extra = []) => ({ id: 'main', displayName: 'Detail Source', module: './connector/index.mjs',
  configSchema: [{ key: 'token', type: 'text', label: 'Token', secret: true, required: true }, ...extra],
  inputs: [{ key: 'task', type: 'task-browser', label: 'Task' }] });
const MANIFEST = (version, extra) => ({ name: 'detail-src', version, description: 'detail fixture', taskSources: [SOURCE(extra)] });
const git = (...args) => run('git', ['-C', repoDir, ...args]);
async function commit(manifest, message) {
  await writeFile(join(repoDir, 'worca-cc-plugin.json'), JSON.stringify(manifest, null, 2));
  await git('add', '-A');
  await git('commit', '-q', '-m', message);
  return (await git('rev-parse', 'HEAD')).stdout.trim();
}

before(async () => {
  process.env.WORCA_MOCK = '1';
  repoDir = await mkdtemp(join(tmpdir(), 'worca-cc-detailrepo-'));
  await mkdir(join(repoDir, 'connector'), { recursive: true });
  await writeFile(join(repoDir, 'connector', 'index.mjs'), 'export default () => ({ async validateConfig() { return { ok: true }; } });\n');
  await mkdir(join(repoDir, 'agents'), { recursive: true });
  await writeFile(join(repoDir, 'agents', 'detailHelper.md'), '# Detail Helper\n');
  await writeFile(join(repoDir, 'agents', 'detailHelper.meta.json'), JSON.stringify({ metaVersion: 2, key: 'detailHelper',
    agentFile: 'detailHelper.md', displayName: 'Detail Helper', runnerType: 'producer', order: 90,
    inputs: [{ id: 'task', type: 'md' }], outputs: [{ id: 'plan', type: 'md', filename: '{base}.md' }] }));
  await run('git', ['init', '-q', '-b', 'main', repoDir]);
  await git('config', 'user.email', 't@t');
  await git('config', 'user.name', 't');
  v1 = await commit(MANIFEST('0.1.0'), 'v1');
  ({ server } = await import('../ui/server.mjs'));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  ws = new WebSocket(`ws://127.0.0.1:${server.address().port}/ws`, { headers: { host: '127.0.0.1', origin: 'http://127.0.0.1' } });
  ws.on('message', (d) => { try { frames.push(JSON.parse(String(d))); } catch { /* not JSON */ } });
  await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
});
after(async () => {
  ws?.close();
  server?.closeAllConnections?.();
  if (server) await new Promise((r) => server.close(r));
  delete process.env.WORCA_MOCK;
  await rm(repoDir, { recursive: true, force: true });
});

test('GET /api/plugins: rows carry description, ref, notes, setup and latest; the top level stays { plugins, orphans }', async () => {
  const added = await call('POST', '/api/marketplaces', { url: repoDir });
  assert.equal(added.status, 200);
  mktId = added.body.marketplace.id;
  assert.equal((await call('POST', '/api/plugins/install', { repoUrl: repoDir, subdir: '', name: 'detail-src', sha: v1, marketplace: mktId })).status, 200);
  v2 = await commit(MANIFEST('0.2.0', [{ key: 'webhookSecret', type: 'text', label: 'Webhook secret', secret: true }]), 'v2: webhook secret');
  assert.equal((await call('POST', `/api/marketplaces/${mktId}/refresh`)).status, 200);
  const list = await call('GET', '/api/plugins');
  assert.deepEqual(Object.keys(list.body).sort(), ['orphans', 'plugins']);
  const row = list.body.plugins.find((p) => p.name === 'detail-src');
  assert.deepEqual({ description: row.description, ref: row.ref, notes: row.notes, setup: row.setup, latest: row.latest }, {
    description: 'detail fixture', ref: null, notes: [],
    setup: { ok: false, missing: [{ kind: 'taskSource', id: 'main', keys: ['token'] }], noProfiles: [] },
    latest: { version: '0.2.0', sha: v2, marketplace: mktId, access: [{ kind: 'secret', id: 'main.webhookSecret', red: true }] },
  });
  assert.equal((await call('PUT', '/api/plugins/detail-src/config', { sourceId: 'main', values: { token: 'sekret-detail' } })).status, 200);
  const saved = (await call('GET', '/api/plugins')).body.plugins.find((p) => p.name === 'detail-src');
  assert.deepEqual(saved.setup, { ok: true, missing: [], noProfiles: [] });
});

test('GET /api/plugins/:name: the row plus the installed inventory and its source; 404 when not installed', async () => {
  const d = await call('GET', '/api/plugins/detail-src');
  assert.equal(d.status, 200);
  assert.deepEqual(Object.keys(d.body).sort(), ['installedAt', 'inventory', 'plugin', 'repo', 'sha', 'subdir', 'updatedAt', 'webUrl']);
  assert.deepEqual([d.body.plugin.name, d.body.plugin.latest.version, d.body.plugin.marketplace], ['detail-src', '0.2.0', mktId]);
  assert.deepEqual(d.body.inventory.taskSources, [{ id: 'main', displayName: 'Detail Source', secrets: ['token'] }]);
  assert.deepEqual(d.body.inventory.agents.map((a) => a.key), ['detailHelper']);
  assert.deepEqual([d.body.repo, d.body.subdir, d.body.sha, d.body.updatedAt, d.body.webUrl], [repoDir, '', v1, null, null]);
  assert.match(d.body.installedAt, ISO);
  // A GitHub source links to its pinned tree, subdir included (CONTRACT §1.2 webUrl): a lock entry is enough.
  const PIN = 'c'.repeat(40);
  writePluginsLock({ ...readPluginsLock(), 'detail-gh': { repo: 'https://github.com/acme/tools', subdir: 'plugins/detail-gh', pinnedSha: PIN,
    version: '0.1.0', enabled: true, installedAt: '2026-10-20T00:00:00.000Z' } });
  try {
    const gh = (await call('GET', '/api/plugins/detail-gh')).body;
    assert.deepEqual([gh.repo, gh.subdir, gh.sha, gh.webUrl],
      ['https://github.com/acme/tools', 'plugins/detail-gh', PIN, `https://github.com/acme/tools/tree/${PIN}/plugins/detail-gh`]);
    assert.equal((await call('GET', '/api/plugins/detail-src')).body.plugin.name, 'detail-src', 'the named plugin\'s row, not the first installed one');
  } finally {
    const { 'detail-gh': _gone, ...rest } = readPluginsLock();
    writePluginsLock(rest);
  }
  assert.deepEqual(await call('GET', '/api/plugins/nope'), { status: 404, body: { error: 'plugin not found' } });
  assert.deepEqual(await call('GET', '/api/plugins/constructor'), { status: 404, body: { error: 'plugin not found' } }, 'an inherited name is not installed');
});

test('GET /api/plugins/:name/references: empty when removable; a workflow placing the plugin agent is listed with where to clear it', async () => {
  assert.deepEqual(await call('GET', '/api/plugins/detail-src/references'), { status: 200, body: { references: [] } });
  const wf = await call('POST', '/api/workflows', { version: 2, name: 'Uses Detail Helper', domain: 'coding',
    nodes: [{ id: 'n_task', kind: 'task', x: 0, y: 0, config: {} }, { id: 'n_help', kind: 'agent', key: 'detailHelper', x: 300, y: 0, config: {} },
      { id: 'n_end', kind: 'end', x: 600, y: 0, config: {} }],
    wires: [{ id: 'w1', from: { node: 'n_task', port: 'task' }, to: { node: 'n_help', port: 'task' } },
      { id: 'w2', from: { node: 'n_help', port: 'plan' }, to: { node: 'n_end', port: 'result' } }] });
  assert.equal(wf.status, 201);
  const id = wf.body.workflow.id;
  assert.deepEqual((await call('GET', '/api/plugins/detail-src/references')).body.references,
    [{ kind: 'workflow', contributionKind: 'agents', contribution: 'detailHelper', label: 'Uses Detail Helper', count: 1, href: `#workflows/${encodeURIComponent(id)}` }]);
  assert.equal((await call('DELETE', `/api/workflows/${id}`)).status, 200);
  assert.deepEqual((await call('GET', '/api/plugins/detail-src/references')).body.references, []);
  assert.equal((await call('GET', '/api/plugins/nope/references')).status, 404);
  assert.equal((await call('GET', '/api/plugins/constructor/references')).status, 404, 'an inherited name is not installed');
});

test('POST /api/plugins/:name/update: versions, previewedAt and access in the preview; a stale candidateSha is a 409 that applies nothing', async () => {
  const p = (await call('POST', '/api/plugins/detail-src/update', {})).body.preview;
  assert.deepEqual([p.pinnedSha, p.candidateSha, p.pinnedVersion, p.candidateVersion], [v1, v2, '0.1.0', '0.2.0']);
  assert.match(p.previewedAt, ISO);
  assert.deepEqual(p.access, [{ kind: 'secret', id: 'main.webhookSecret', red: true }]);
  assert.deepEqual(p.commits.map((c) => c.subject), ['v2: webhook secret']);
  assert.deepEqual(await call('POST', '/api/plugins/detail-src/update', { confirm: true, candidateSha: 'not-a-sha' }),
    { status: 400, body: { error: 'candidateSha must be a commit sha' } });
  for (const bad of [v1.slice(0, 7), `x${v2}`]) assert.equal((await call('POST', '/api/plugins/detail-src/update', { confirm: true, candidateSha: bad })).status, 400, bad);
  assert.equal((await call('POST', '/api/plugins/detail-src/update', { candidateSha: 'not-a-sha' })).status, 200, 'a preview never validates candidateSha');
  assert.deepEqual(await call('POST', '/api/plugins/detail-src/update', { confirm: true, candidateSha: v1 }), { status: 409, body: {
    error: `plugin "detail-src" moved on since the preview (${v1.slice(0, 7)} → ${v2.slice(0, 7)}) — review the update again`,
    code: 'STALE_PREVIEW', candidateSha: v2 } });
  assert.equal((await call('GET', '/api/plugins/detail-src')).body.sha, v1, 'nothing applied');
  const ok = await call('POST', '/api/plugins/detail-src/update', { confirm: true, candidateSha: v2 });
  assert.deepEqual([ok.status, ok.body.updated], [200, true]);
  const d = (await call('GET', '/api/plugins/detail-src')).body;
  assert.deepEqual([d.sha, d.plugin.latest], [v2, null]);
  assert.match(d.updatedAt, ISO);
});

test('plugins-changed reaches every open tab after install, config, update, enable, remove, purge and link', async () => {
  assert.equal((await call('POST', '/api/plugins/detail-src/enable', { enabled: false })).status, 200);
  assert.equal((await call('POST', '/api/plugins/detail-src/enable', { enabled: true })).status, 200);
  assert.equal((await call('DELETE', '/api/plugins/detail-src')).status, 200);   // its saved token stays: an orphan
  assert.deepEqual(await call('DELETE', '/api/plugins/detail-src/data'), { status: 200, body: { ok: true, name: 'detail-src' } });
  assert.equal((await call('DELETE', '/api/plugins/detail-src/data')).status, 404, 'nothing left to purge');
  const dir = await mkdtemp(join(tmpdir(), 'worca-cc-detail-link-'));
  const folder = await mkdtemp(join(tmpdir(), 'worca-cc-detail-folder-'));
  after(() => Promise.all([dir, folder].map((d) => rm(d, { recursive: true, force: true }))));
  await writeFile(join(dir, 'worca-cc-plugin.json'), JSON.stringify({ name: 'detail-linked', version: '0.1.0' }));
  assert.equal((await call('POST', '/api/plugins/link', { dir })).status, 200);
  // A plugin folder (no .git) pasted into Add marketplace is linked by the same helper: one more 'link' (SEAMS SM3).
  await writeFile(join(folder, 'worca-cc-plugin.json'), JSON.stringify({ name: 'detail-folder', version: '0.1.0',
    taskSources: [{ id: 'src', module: './index.mjs', multiProfile: true, configSchema: [{ key: 'pat', secret: true, required: true }],
      inputs: [{ key: 'task', type: 'task-browser' }] }],
    modelSecrets: [{ key: 'df-token', label: 'Token' }], models: [{ id: 'df-model', label: 'DF', env: { ANTHROPIC_AUTH_TOKEN: { secret: 'df-token' } } }] }));
  await writeFile(join(folder, 'index.mjs'), 'export default () => ({ async validateConfig() { return { ok: true }; } });\n');
  const pasted = await call('POST', '/api/marketplaces', { url: folder });
  assert.deepEqual([pasted.status, pasted.body.linked], [200, true]);
  // Profile create / delete and the model-secrets form are config saves too (SEAMS SM14).
  const count = (a) => frames.filter((f) => f.type === 'plugins-changed' && f.action === a).length;
  assert.equal((await call('POST', '/api/plugins/detail-folder/profiles', { sourceId: 'src', id: 'work', label: 'Work' })).status, 200);
  assert.equal((await call('DELETE', '/api/plugins/detail-folder/profiles/work?sourceId=src')).status, 200);
  assert.equal((await call('PUT', '/api/plugins/detail-folder/config', { target: 'modelSecrets', values: { 'df-token': 'x' } })).status, 200);
  const want = ['config', 'enable', 'install', 'link', 'purge', 'remove', 'update'];
  const missing = () => want.filter((a) => !frames.some((f) => f.type === 'plugins-changed' && f.action === a));
  const t0 = Date.now();
  while ((missing().length || count('link') < 2 || count('config') < 4) && Date.now() - t0 < 5000) await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(missing(), [], `frames: ${JSON.stringify(frames.filter((f) => f.type === 'plugins-changed'))}`);
  await new Promise((r) => setTimeout(r, 100));
  // config: the first test's token save, then these three.
  assert.deepEqual([count('link'), count('config')], [2, 4], 'one link per linked folder, whichever route linked it; one config per save');
  assert.equal(count('purge'), 1, 'a refused purge changed nothing: no frame');
});
