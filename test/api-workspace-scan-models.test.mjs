// test/api-workspace-scan-models.test.mjs — Settings › General › Workspaces over HTTP: the
// workspaceScan round trip (root left alone), 400s, null clears, and a Re-scan that starts on
// the stored pick. settings.json lives under HOME: HOME sandboxed, the runner's HOME guard lifted.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';

useTempHome(after);

let sandboxHome, srv, base, runs;
const prevEnv = {};
const created = [];
const JSONH = { 'Content-Type': 'application/json' };
const post = (p, b) => fetch(`${base}${p}`, { method: 'POST', headers: JSONH, body: JSON.stringify(b ?? {}) });
const readSettingsJson = async () => JSON.parse(await readFile(join(sandboxHome, '.worca-cc', 'settings.json'), 'utf8'));
async function freshRepo() {
  const dir = await mkdtemp(join(tmpdir(), 'worca-cc-wsm-repo-'));
  created.push(dir);
  const g = (a) => spawnSync('git', a, { cwd: dir });
  g(['init', '-q', '-b', 'main']); g(['config', 'user.email', 't@t']); g(['config', 'user.name', 't']);
  await writeFile(join(dir, 'README.md'), '# hi\n');
  g(['add', '-A']); g(['commit', '-qm', 'init']);
  return dir;
}
async function untilSettled(runId, ms = 60000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const e = runs.get(runId);
    if (e && ['done', 'error', 'stopped'].includes(e.status)) return e;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`run ${runId} never settled`);
}

before(async () => {
  sandboxHome = await mkdtemp(join(tmpdir(), 'worca-cc-wsm-home-'));
  for (const k of ['HOME', 'USERPROFILE', 'WORCA_TEST_ALLOW_HOME_FALLBACK', 'WORCA_MOCK']) prevEnv[k] = process.env[k];
  process.env.HOME = sandboxHome; process.env.USERPROFILE = sandboxHome;
  process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = '1';
  process.env.WORCA_MOCK = '1';
  const mod = await import('../ui/server.mjs');
  ({ runs } = mod);
  srv = mod.server;
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
});
after(async () => {
  if (srv) await new Promise((r) => { srv.close(r); srv.closeAllConnections?.(); });
  for (const k of Object.keys(prevEnv)) { if (prevEnv[k] === undefined) delete process.env[k]; else process.env[k] = prevEnv[k]; }
  // The last scan run may still be tearing its checkouts down (ENOTEMPTY flake): retry.
  const RM = { recursive: true, force: true, maxRetries: 10, retryDelay: 100 };
  await rm(sandboxHome, RM);
  await Promise.all(created.map((d) => rm(d, RM)));
});

const PICK = { scanModel: 'claude-opus-5-5', scanEffort: 'high', agentModel: 'opus', agentEffort: 'xhigh' };

test('GET /api/settings: workspaceScan unset + the default pair', async () => {
  const j = await (await fetch(`${base}/api/settings`)).json();
  assert.equal(j.workspaceScan, null);
  assert.deepEqual(j.workspaceScanDefault, { scanModel: 'claude-sonnet-5', scanEffort: 'medium', agentModel: 'sonnet', agentEffort: 'medium' });
});

test('POST /api/settings workspaceScan: round trip, 400 on a bad pick (nothing written), null clears, root untouched', async () => {
  const root = await mkdtemp(join(tmpdir(), 'worca-cc-wsm-root-'));
  created.push(root);
  assert.equal((await (await post('/api/settings', { root })).json()).root, root);
  const ok = await (await post('/api/settings', { workspaceScan: PICK })).json();
  assert.deepEqual(ok.workspaceScan, PICK);
  assert.equal(ok.root, root, 'a workspaceScan-only save leaves the root');
  assert.deepEqual((await readSettingsJson()).workspaces.scan, PICK);
  const bad = await post('/api/settings', { workspaceScan: { ...PICK, agentModel: 'haiku' } });
  assert.equal(bad.status, 400);
  assert.match((await bad.json()).error, /agentModel/);
  assert.deepEqual((await readSettingsJson()).workspaces.scan, PICK, 'nothing written on a 400');
  assert.equal((await (await post('/api/settings', { workspaceScan: null })).json()).workspaceScan, null);
  await post('/api/settings', { root: '' });
});

test('Re-scan starts on the stored pick', async () => {
  await post('/api/settings', { workspaceScan: PICK });
  const a = await freshRepo();
  const b = await freshRepo();
  const { workspace } = await (await post('/api/workspaces', { name: 'Stored Pick', projectPaths: [a, b] })).json();
  const { runId } = await (await post(`/api/workspaces/${workspace.id}/scan`, {})).json();
  const done = await untilSettled(runId);
  const n = done.orch.state.stepper.graph.nodes.find((x) => x.id === 'n_scan');
  assert.deepEqual([n.model, n.effort, n.subagentModel, n.subagentEffort], ['claude-opus-5-5', 'high', 'opus', 'xhigh']);
  await post('/api/settings', { workspaceScan: null });
});
