// A setup command saved after a checkout ran with none runs before that checkout's next start (D10a, `setupLate`),
// but never under a live action of the same project and never by itself in a linked folder (docs/actions.md).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, realpath } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import { spawnSync } from 'node:child_process';
import { _resetForTests, getDb } from '../src/core/db.mjs';
import { templateRepo } from './helpers/git-dir.mjs';

const prev = { WORCA_HOME: process.env.WORCA_HOME, HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };
const created = [];
let homeDir, srv, base, repo, key, id, SRV, RUN, TASK;
const JSONH = { 'Content-Type': 'application/json' };
const NODE = `"${process.execPath}"`;
const git = (cwd, args) => spawnSync('git', args, { cwd, encoding: 'utf8' });
const post = (p, body) => fetch(`${base}${p}`, { method: 'POST', headers: JSONH, body: JSON.stringify(body) });
const put = (p, body) => fetch(`${base}${p}`, { method: 'PUT', headers: JSONH, body: JSON.stringify(body) });
const getJson = async (p) => (await fetch(`${base}${p}`)).json();
async function waitFor(pred, timeoutMs = 20000) {
  const t0 = Date.now();
  for (;;) { const v = await pred(); if (v) return v; if (Date.now() - t0 > timeoutMs) throw new Error('waitFor timed out'); await new Promise((r) => setTimeout(r, 25)); }
}
/** The lint task (`node -e 0`) ran to its end: a setup queued ahead of it would have run by now. */
const lintDone = (instanceId) => waitFor(async () => {
  assert.ok(instanceId, 'the start answered with its instance');
  return !(await getJson('/api/actions/running')).some((x) => x.instanceId === instanceId);
});
const seed = async (feature) => {
  const { seedPipeline } = await import('./helpers/db-seed.mjs');
  const { worcaHome } = await import('../src/core/projects.mjs');
  git(repo, ['branch', feature]);
  const s = await seedPipeline(repo, { status: 'done', branch: { source: 'main', feature, runRootMode: 'detached', worktreeRemoved: true, branchKept: true } });
  getDb().prepare(`UPDATE pipelines SET branch = json_set(branch, '$.worktreeDir', ?) WHERE id = ?`).run(join(worcaHome(), 'runs', s.id, 'repos', s.key), s.id);
  return s;
};

before(async () => {
  homeDir = await mkdtemp(join(tmpdir(), 'worca-cc-setuplate-home-'));
  Object.assign(process.env, { WORCA_HOME: homeDir, HOME: homeDir, USERPROFILE: homeDir });
  _resetForTests();
  SRV = join(homeDir, 'srv.mjs');
  await writeFile(SRV, `import http from 'node:http';\nhttp.createServer((q, s) => s.end('ok')).listen(Number(process.env.PORT), '127.0.0.1');\n`);
  RUN = { id: 'run', label: 'Run', kind: 'service', cmd: `${NODE} "${SRV}"`, env: [{ name: 'PORT', type: 'port', value: 'auto' }], openUrl: 'http://localhost:{PORT}', ready: { kind: 'port' } };
  TASK = { id: 'lint', label: 'Lint', kind: 'task', cmd: `${NODE} -e 0`, ready: { kind: 'immediate' } };
  const { addProject } = await import('../src/core/projects.mjs');
  repo = await realpath(templateRepo('setuplate', { branch: 'main', user: true, files: { 'README.md': '# hi\n' }, prefix: 'worca-cc-setuplate-' }));
  created.push(repo);
  await addProject({ name: basename(repo), path: repo });
  const mod = await import('../ui/server.mjs');
  srv = mod.server;
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
  assert.equal((await post('/api/settings', { actions: { portLow: 4450, portHigh: 4469 } })).status, 200);
  ({ id, key } = await seed('worca-cc/a'));
  assert.equal((await put(`/api/projects/${key}/actions`, { actions: [RUN, TASK] })).status, 200);
});
after(async () => {
  if (base) for (const s of await getJson('/api/actions/running').catch(() => [])) await post(`/api/actions/instances/${encodeURIComponent(s.instanceId)}/stop`, {}).catch(() => {});
  if (srv) await new Promise((r) => srv.close(r));
  _resetForTests();
  for (const [k, v] of Object.entries(prev)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  await Promise.all([homeDir, ...created].map((d) => rm(d, { recursive: true, force: true, maxRetries: 3 })));
});

test('a setup command added while a service runs in the checkout never runs under it (as Run setup refuses, SERVICES_RUNNING)', async () => {
  const q = `projectKey=${key}`;
  assert.equal((await post(`/api/runs/${id}/checkout?${q}`, {})).status, 200);
  await waitFor(async () => (await getJson(`/api/runs/${id}/actions?${q}`)).members[0].checkout?.setup?.status === 'none');
  const s = await (await post(`/api/runs/${id}/actions/run/start?${q}`, {})).json();
  await waitFor(async () => (await getJson('/api/actions/running')).some((x) => x.instanceId === s.instanceId && x.status === 'ready'));
  // The person adds a setup command (Use this does the same) while the service runs.
  const marker = join(homeDir, 'setup-ran');
  assert.equal((await put(`/api/projects/${key}/actions`, { setup: `${NODE} -e "require('fs').writeFileSync(${JSON.stringify(marker).replace(/"/g, "'")}, 'x')"`, actions: [RUN, TASK] })).status, 200);
  const lint = await post(`/api/runs/${id}/actions/lint/start?${q}`, {});
  assert.equal(lint.status, 200, 'started now, not queued behind setup');
  await lintDone((await lint.json()).instanceId);
  assert.equal((await getJson(`/api/runs/${id}/actions?${q}`)).members[0].checkout?.setup?.status, 'none', 'no setup started');
  assert.equal(existsSync(marker), false, 'setup ran while the service was live');
  await post(`/api/runs/${id}/actions/run/stop?${q}`, {});
});

test('a linked folder (the person\'s own clone) never runs a setup command by itself, even one added since', async () => {
  const q = `projectKey=${key}`;
  assert.equal((await put(`/api/projects/${key}/actions`, { actions: [RUN, TASK] })).status, 200);   // no setup
  git(repo, ['switch', '-q', '-c', 'worca-cc/held']);
  try {
    const { seedPipeline } = await import('./helpers/db-seed.mjs');
    const { worcaHome } = await import('../src/core/projects.mjs');
    const s = await seedPipeline(repo, { status: 'done', branch: { source: 'main', feature: 'worca-cc/held', runRootMode: 'detached', worktreeRemoved: true, branchKept: true } });
    getDb().prepare(`UPDATE pipelines SET branch = json_set(branch, '$.worktreeDir', ?) WHERE id = ?`).run(join(worcaHome(), 'runs', s.id, 'repos', s.key), s.id);
    assert.equal((await post(`/api/runs/${s.id}/checkout?${q}`, { useExisting: true })).status, 200);
    // "Run setup" on the card while the project has none: recorded as none.
    assert.equal((await post(`/api/runs/${s.id}/setup?${q}`, {})).status, 202);
    await waitFor(async () => (await getJson(`/api/runs/${s.id}/actions?${q}`)).members[0].checkout?.setup?.status === 'none');
    const marker = join(repo, 'setup-ran-in-own-clone');
    assert.equal((await put(`/api/projects/${key}/actions`, { setup: `${NODE} -e "require('fs').writeFileSync('setup-ran-in-own-clone', 'x')"`, actions: [RUN, TASK] })).status, 200);
    const lint = await post(`/api/runs/${s.id}/actions/lint/start?${q}`, {});
    assert.equal(lint.status, 200, 'started now, not queued behind setup');
    await lintDone((await lint.json()).instanceId);
    assert.equal((await getJson(`/api/runs/${s.id}/actions?${q}`)).members[0].checkout?.setup?.status, 'none', 'no setup started');
    assert.equal(existsSync(marker), false, 'setup ran by itself in the person\'s own folder');
    await fetch(`${base}/api/runs/${s.id}/checkout?${q}`, { method: 'DELETE', headers: JSONH, body: '{}' });
  } finally { git(repo, ['switch', '-q', 'main']); }
});
