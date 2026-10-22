// test/api-workspace-scan-models.test.mjs — Settings › Runs › Workspaces over HTTP plus the
// per-workspace scan-model pick: a re-scan of a workspace with NO usable saved model answers 428
// SCAN_MODEL_REQUIRED (the page opens the pick-a-model window) instead of silently falling to
// Settings/default — the reported 403 loop. PUT /api/workspaces/:id/scan-models persists / clears
// the workspace's own pick; with one saved, re-scans (and add/remove auto re-scans) run on it.
// settings.json lives under HOME: HOME sandboxed, the runner's HOME guard lifted.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { checkRows } from './helpers/rows.mjs';
import { templateRepo } from './helpers/git-dir.mjs';
import { setWorkspaceScanPick } from '../src/core/workspaces.mjs';

useTempHome(after);

let sandboxHome, srv, base, runs;
const prevEnv = {};
const created = [];
const JSONH = { 'Content-Type': 'application/json' };
const post = (p, b) => fetch(`${base}${p}`, { method: 'POST', headers: JSONH, body: JSON.stringify(b ?? {}) });
const put = (p, b) => fetch(`${base}${p}`, { method: 'PUT', headers: JSONH, body: JSON.stringify(b ?? {}) });
const readSettingsJson = async () => JSON.parse(await readFile(join(sandboxHome, '.worca-cc', 'settings.json'), 'utf8'));
function freshRepo() {
  const dir = templateRepo('wsm-repo', { branch: 'main', user: true, files: { 'README.md': '# hi\n' } });
  created.push(dir);
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
const pickOf = (done) => {
  const n = done.orch.state.stepper.graph.nodes.find((x) => x.id === 'n_scan');
  return [n.model, n.effort, n.subagentModel, n.subagentEffort];
};

test('workspaceScan settings: unset + default pair, round trip, 400 on a bad pick (nothing written), null clears, root untouched', async () => {
  await checkRows([
    { name: 'GET /api/settings: workspaceScan unset + the default pair', run: async () => {
      const j = await (await fetch(`${base}/api/settings`)).json();
      assert.equal(j.workspaceScan, null);
      assert.deepEqual(j.workspaceScanDefault, { scanModel: 'claude-sonnet-5', scanEffort: 'medium', agentModel: 'sonnet', agentEffort: 'medium' });
    } },
    { name: 'POST /api/settings workspaceScan: round trip, 400 on a bad pick (nothing written), null clears, root untouched', run: async () => {
      const root = await mkdtemp(join(tmpdir(), 'worca-cc-wsm-root-'));
      created.push(root);
      assert.equal((await (await post('/api/settings', { root })).json()).root, root);
      const ok = await (await post('/api/settings', { workspaceScan: PICK })).json();
      assert.deepEqual(ok.workspaceScan, PICK);
      assert.equal(ok.root, root, 'a workspaceScan-only save leaves the root');
      assert.deepEqual((await readSettingsJson()).workspaces.scan, PICK);
      const bad = await post('/api/settings', { workspaceScan: { ...PICK, agentModel: 'haiku' } });
      assert.equal(bad.status, 400);
      const badBody = await bad.json();
      assert.match(badBody.error, /Project agents/);
      assert.equal(badBody.field, 'workspaceScan.agentModel');
      assert.deepEqual((await readSettingsJson()).workspaces.scan, PICK, 'nothing written on a 400');
      assert.equal((await (await post('/api/settings', { workspaceScan: null })).json()).workspaceScan, null);
      await post('/api/settings', { root: '' });
    } },
  ]);
});

test('a pick-less workspace\'s re-scan answers 428 SCAN_MODEL_REQUIRED (never a silent Settings/default); with a saved pick it runs on it', async () => {
  // The Settings pick is only the pick-a-model window's PRE-FILL now — it must not be what a
  // re-scan silently runs on. The reported bug: a legacy workspace + the default claude-sonnet-5
  // → 403 at the endpoint → a run that never ends.
  await post('/api/settings', { workspaceScan: PICK });
  const a = await freshRepo();
  const b = await freshRepo();
  const { workspace } = await (await post('/api/workspaces', { name: 'No Saved Pick', projectPaths: [a, b] })).json();
  const req = await post(`/api/workspaces/${workspace.id}/scan`, {});
  assert.equal(req.status, 428, 'no saved pick → the server asks, it does not resolve silently');
  const body = await req.json();
  assert.equal(body.code, 'SCAN_MODEL_REQUIRED');
  assert.match(body.error, /no scan model saved/);
  assert.equal((await (await fetch(`${base}/api/workspaces/${workspace.id}`)).json()).workspace.scanModels, null,
    'the 428 changes nothing: the workspace stays pick-less');

  // Save a pick the way the prompted page does (PUT /scan-models), then the re-scan runs on it.
  const saved = await (await put(`/api/workspaces/${workspace.id}/scan-models`, { workspaceScan: PICK })).json();
  assert.deepEqual(saved.workspace.scanModels, PICK);
  const { runId } = await (await post(`/api/workspaces/${workspace.id}/scan`, {})).json();
  const done = await untilSettled(runId);
  assert.equal(done.status, 'done');
  assert.deepEqual(pickOf(done), ['claude-opus-5-5', 'high', 'opus', 'xhigh'], 'the workspace\'s own pick runs the re-scan');
  const after = (await (await fetch(`${base}/api/workspaces/${workspace.id}`)).json()).workspace;
  assert.deepEqual(after.scanModels, PICK);
  await post('/api/settings', { workspaceScan: null });
});

test('a member-add auto-rescan of a pick-less workspace answers needsModel; the prompted flow saves the pick and the re-scan runs on it (the "add a new agent" bug)', async () => {
  const a = await freshRepo();
  const b = await freshRepo();
  const c = await freshRepo();   // the new agent being added
  const { workspace } = await (await post('/api/workspaces', { name: 'Legacy Add', projectPaths: [a, b] })).json();
  assert.equal(workspace.scanModels, null, 'pre-fix workspace: no stored pick');
  // member-add auto-rescan resolves the workspace pick (NULL) — and must NOT fall to the default:
  // the members route answers { rescan: { needsModel: true } } and the page opens the window.
  const changed = await (await post(`/api/workspaces/${workspace.id}/members`, { add: [c] })).json();
  assert.deepEqual(changed.rescan, { needsModel: true }, 'the member change stands but asks for a model');
  assert.equal(changed.workspace.scanModels, null, 'nothing persisted by the pause');
  // The prompted flow: PUT the pick, then start the auto-tagged re-scan with it.
  assert.ok((await put(`/api/workspaces/${workspace.id}/scan-models`, { workspaceScan: PICK })).ok);
  const { runId } = await (await post(`/api/workspaces/${workspace.id}/scan`, { models: PICK, autoRescan: true })).json();
  const done = await untilSettled(runId);
  assert.equal(done.status, 'done', `auto-rescan ${runId} settled with ${done.status}`);
  assert.deepEqual(pickOf(done), ['claude-opus-5-5', 'high', 'opus', 'xhigh']);
  const after = (await (await fetch(`${base}/api/workspaces/${workspace.id}`)).json()).workspace;
  assert.deepEqual(after.scanModels, PICK, 'the chosen model is now the workspace pick — later re-scans reuse it silently');
  // A second member-add now re-scans silently on the saved pick (the workspace pick is usable).
  const d = await freshRepo();
  const again = await (await post(`/api/workspaces/${workspace.id}/members`, { add: [d] })).json();
  assert.ok(again.rescan && again.rescan.runId, `the saved pick lets the auto re-scan start: ${JSON.stringify(again.rescan)}`);
  const done2 = await untilSettled(again.rescan.runId);
  assert.equal(done2.status, 'done');
});

test('PUT /:id/scan-models: persists, 400 on a model the catalog does not have (nothing written), null clears', async () => {
  const a = await freshRepo();
  const b = await freshRepo();
  const { workspace } = await (await post('/api/workspaces', { name: 'Scan Models CRUD', projectPaths: [a, b] })).json();
  const bad = await put(`/api/workspaces/${workspace.id}/scan-models`, { workspaceScan: { ...PICK, scanModel: 'claude-surely-not-a-model-939' } });
  assert.equal(bad.status, 400);
  assert.match((await bad.json()).error, /Unknown model|no .*model|scan model/i);
  assert.equal((await (await fetch(`${base}/api/workspaces/${workspace.id}`)).json()).workspace.scanModels, null, 'nothing written on a 400');
  const noKey = await put(`/api/workspaces/${workspace.id}/scan-models`, {});
  assert.equal(noKey.status, 400);
  const ok = await (await put(`/api/workspaces/${workspace.id}/scan-models`, { workspaceScan: PICK })).json();
  assert.deepEqual(ok.workspace.scanModels, PICK);
  assert.equal((await (await put(`/api/workspaces/${workspace.id}/scan-models`, { workspaceScan: null })).json()).workspace.scanModels, null,
    'null clears the saved pick');
});

test('a STALE saved pick (its model left the catalog) answers 428; an explicit pick in the request runs regardless', async () => {
  const a = await freshRepo();
  const b = await freshRepo();
  const { workspace } = await (await post('/api/workspaces', { name: 'Stale Pick', projectPaths: [a, b] })).json();
  // The saved model stops being in the catalog (removed from the deployment later): the API's PUT
  // route would refuse it at write time, so this is a model that WAS saved before it left — seed
  // it the way the DB holds it.
  await setWorkspaceScanPick(workspace.id, { scanModel: 'claude-gone-model-77', scanEffort: 'high', agentModel: 'opus', agentEffort: 'xhigh' });
  assert.deepEqual((await (await fetch(`${base}/api/workspaces/${workspace.id}`)).json()).workspace.scanModels,
    { scanModel: 'claude-gone-model-77', scanEffort: 'high', agentModel: 'opus', agentEffort: 'xhigh' });
  const req = await post(`/api/workspaces/${workspace.id}/scan`, {});
  assert.equal(req.status, 428, 'a pick whose model left the catalog is unusable → ask, don\'t silently degrade');
  assert.equal((await req.json()).code, 'SCAN_MODEL_REQUIRED');
  // The prompted page sends its fresh pick in the request: explicit always wins.
  const { runId } = await (await post(`/api/workspaces/${workspace.id}/scan`, { models: PICK })).json();
  const done = await untilSettled(runId);
  assert.equal(done.status, 'done');
  assert.deepEqual(pickOf(done), ['claude-opus-5-5', 'high', 'opus', 'xhigh']);
});
