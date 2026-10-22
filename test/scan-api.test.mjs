// test/scan-api.test.mjs
// The Workspace scan as a pipeline run, server side:
//   - POST /api/workspaces/scan validates like a create (400/409) and starts a
//     wf_workspace_scan run on the future workspace id; on done the workspace exists,
//     workspaces-changed{scan-created} is broadcast and no member keeps a run branch.
//   - POST /api/workspaces/:id/scan re-scans (404 unknown, 409 live run) and updates.
//   - POST /api/run refuses the scan workflow without the internal target.
//   - The off-pipeline scan surface is gone (/api/scan/stop, scanId in summaries).
// Mock-driven (WORCA_MOCK=1), chdir-sandboxed, temp WORCA_HOME.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { WebSocket } from 'ws';

import { useTempHome } from './helpers/temp-home.mjs';
import { workspaceKey, addWorkspaceMembers } from '../src/core/workspaces.mjs';
import { checkRows } from './helpers/rows.mjs';
import { templateRepo } from './helpers/git-dir.mjs';

useTempHome(after);

const origCwd = process.cwd();
let cwdSandbox = null;
let homeDir, srv, base, wsBase, runs, summarizeRuns, scanRequest, prevHome;
const JSONH = { 'Content-Type': 'application/json' };
const created = [];

before(async () => {
  cwdSandbox = mkdtempSync(join(tmpdir(), 'worca-cc-scanapi-cwd-'));
  const g = (a) => spawnSync('git', a, { cwd: cwdSandbox });
  g(['init', '-q', '-b', 'main']); g(['config', 'user.email', 't@t']); g(['config', 'user.name', 't']);
  writeFileSync(join(cwdSandbox, 'README.md'), '# sandbox\n');
  g(['add', '-A']); g(['commit', '-qm', 'init']);
  process.chdir(cwdSandbox);

  homeDir = await mkdtemp(join(tmpdir(), 'worca-cc-scanapi-'));
  prevHome = process.env.WORCA_HOME;
  process.env.WORCA_HOME = homeDir;
  process.env.WORCA_MOCK = '1';
  const mod = await import('../ui/server.mjs');
  runs = mod.runs;
  summarizeRuns = mod._testing.summarizeRuns;
  scanRequest = mod._testing.scanRequest;
  srv = mod.server;
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const port = srv.address().port;
  base = `http://127.0.0.1:${port}`;
  wsBase = `ws://127.0.0.1:${port}/ws`;
});

after(async () => {
  if (srv) await new Promise((r) => srv.close(r));
  for (const r of runs.values()) {
    try { r.orch && typeof r.orch.stop === 'function' && r.orch.stop(); } catch { /* best-effort */ }
  }
  runs.clear();
  if (prevHome === undefined) delete process.env.WORCA_HOME; else process.env.WORCA_HOME = prevHome;
  delete process.env.WORCA_MOCK;
  process.chdir(origCwd);
  // A run's teardown can still be removing checkouts (the known ENOTEMPTY flake): retry.
  const RM = { recursive: true, force: true, maxRetries: 10, retryDelay: 100 };
  if (cwdSandbox) await rm(cwdSandbox, RM);
  await rm(homeDir, RM);
  await Promise.all(created.map((d) => rm(d, RM)));
});

async function freshRepo() {
  const dir = templateRepo('scanapi-repo', { branch: 'main', user: true, files: { 'README.md': '# hi\n' } });
  created.push(dir);
  return dir;
}
async function freshDir() {
  const dir = await mkdtemp(join(tmpdir(), 'worca-cc-scanapi-plain-'));
  created.push(dir);
  return dir;
}
const post = (p, body) => fetch(`${base}${p}`, { method: 'POST', headers: JSONH, body: JSON.stringify(body) });
const branches = (dir) => spawnSync('git', ['-C', dir, 'branch', '--format=%(refname:short)'])
  .stdout.toString().split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
function openWs() {
  const ws = new WebSocket(wsBase, { headers: { host: '127.0.0.1', origin: 'http://127.0.0.1' } });
  const msgs = [];
  ws.on('message', (d) => { try { msgs.push(JSON.parse(String(d))); } catch { /* ignore */ } });
  const opened = new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
  return { ws, msgs, opened };
}
function waitFor(pred, timeoutMs = 30000) {
  return new Promise((res, rej) => {
    const t0 = Date.now();
    const tick = () => {
      const v = pred();
      if (v) return res(v);
      if (Date.now() - t0 > timeoutMs) return rej(new Error('waitFor timed out'));
      setTimeout(tick, 25);
    };
    tick();
  });
}
const settled = (runId) => waitFor(() => ['done', 'error', 'stopped'].includes(runs.get(runId)?.status) && runs.get(runId));
// `settled` resolves when the status flips to done, which is BEFORE run()'s `finally` tears the
// checkouts down and deletes the scan branches — wait for that before asserting on branches.
const branchesGone = (...dirs) => waitFor(() => dirs.every((d) => branches(d).length === 1));
const fakeLiveScan = (id, workspaceId) => runs.set(id, {
  id, kind: 'workspace-run', workspaceId, status: 'running', events: [], orch: { workflowId: 'wf_workspace_scan' },
});
const put = (p, body) => fetch(`${base}${p}`, { method: 'PUT', headers: JSONH, body: JSON.stringify(body) });
// A pick-less workspace's re-scan answers 428 SCAN_MODEL_REQUIRED by design (the page asks the
// user). The ownership/description tests below are about the LIVE-RUN guard and the re-scan
// itself, so give the fresh workspace a saved pick first — exactly what the prompted page does.
const savePick = async (wsId) => {
  const r = await put(`/api/workspaces/${wsId}/scan-models`, {
    workspaceScan: { scanModel: 'claude-opus-5-5', scanEffort: 'high', agentModel: 'opus', agentEffort: 'xhigh' },
  });
  assert.equal(r.status, 200, `PUT /scan-models: ${(await r.json()).error || r.status}`);
};

test('POST /api/workspaces/scan: 400 for fewer than 2 members, no name, a missing dir or a non-git dir', async () => {
  const a = await freshRepo();
  const b = await freshRepo();
  assert.equal((await post('/api/workspaces/scan', { name: 'X', projectPaths: [a] })).status, 400);
  assert.equal((await post('/api/workspaces/scan', { projectPaths: [a, b] })).status, 400);
  assert.equal((await post('/api/workspaces/scan', { name: 'X', projectPaths: [a, join(a, 'nope')] })).status, 400);
  assert.equal((await post('/api/workspaces/scan', { name: 'X', projectPaths: [a, await freshDir()] })).status, 400);
});

test('POST /api/workspaces/scan: 409 for a taken name or project set', async () => {
  const a = await freshRepo();
  const b = await freshRepo();
  const c = await freshRepo();
  const cr = await post('/api/workspaces', { name: 'Taken', projectPaths: [a, b] });
  assert.equal(cr.status, 201);
  assert.equal((await post('/api/workspaces/scan', { name: 'taken', projectPaths: [a, c] })).status, 409);
  assert.equal((await post('/api/workspaces/scan', { name: 'Other', projectPaths: [b, a] })).status, 409);
});

test('POST /api/workspaces/scan: 409 while a live scan targets the same project set (any name)', async () => {
  const a = await freshRepo();
  const b = await freshRepo();
  const id = workspaceKey({ name: 'First', projectPaths: [a, b] });
  fakeLiveScan('fake-live-scan', id);
  try {
    const res = await post('/api/workspaces/scan', { name: 'Second', projectPaths: [a, b] });
    assert.equal(res.status, 409);
    assert.match((await res.json()).error, /already running/);
  } finally { runs.delete('fake-live-scan'); }
});

test('a first scan (with a models pick) is a recorded run that creates the workspace, pins its models, stores its map and leaves no branches', async () => {
  const a = await freshRepo();
  const b = await freshRepo();
  // The 400-on-bad-models half stays a cheap check before any run starts.
  const bad = await post('/api/workspaces/scan', { name: 'Bad Models', projectPaths: [a, b], models: { scanModel: 'claude-sonnet-5', scanEffort: 'medium', agentModel: 'haiku', agentEffort: 'medium' } });
  const sock = openWs();
  await sock.opened;
  try {
    // ONE full mock scan (a models pick, name "Platform") carries the three former happy-scan tests.
    const res = await post('/api/workspaces/scan', { name: 'Platform', projectPaths: [a, b], models: { scanModel: 'claude-opus-5-5', scanEffort: 'high', agentModel: 'opus', agentEffort: 'xhigh' } });
    const data = await res.json();
    assert.equal(res.status, 200, JSON.stringify(data));
    const entry = runs.get(data.runId);
    await settled(data.runId);
    await checkRows([
      { name: 'a first scan is a recorded pipeline run that creates the workspace on done', run: async () => {
        assert.equal(res.status, 200);
        const id = workspaceKey({ name: 'Platform', projectPaths: [a, b] });
        assert.equal(data.workspaceId, id);
        assert.equal(data.title, 'Workspace scan: Platform');
        assert.equal(data.projectNames.length, 2);
        assert.equal(entry.kind, 'workspace-run');
        assert.equal(entry.workspaceId, id);
        assert.equal(entry.orch.workflowId, 'wf_workspace_scan');
        const done = await settled(data.runId);
        assert.equal(done.status, 'done');
        const ws = await (await fetch(`${base}/api/workspaces/${id}`)).json();
        assert.match(ws.workspace.description, /## Interconnections/);
        await waitFor(() => sock.msgs.some((m) => m.type === 'workspaces-changed' && m.action === 'scan-created'));
        await branchesGone(a, b);
        assert.deepEqual(branches(a), ['main'], 'branches gone');
        assert.deepEqual(branches(b), ['main'], 'branches gone');
      } },
      { name: 'the scan request\'s models pin the run; a bad pick is a 400 before any run', run: async () => {
        assert.equal(bad.status, 400);
        assert.equal(res.status, 200);
        const { runId } = data;
        const done = await settled(runId);
        const n = done.orch.state.stepper.graph.nodes.find((x) => x.id === 'n_scan');
        assert.deepEqual([n.model, n.effort, n.subagentModel, n.subagentEffort], ['claude-opus-5-5', 'high', 'opus', 'xhigh']);
      } },
      { name: 'a scan stores its map: GET /map answers the members, the list carries mapSummary, origin generated', run: async () => {
        assert.equal(res.status, 200);
        const { runId, workspaceId } = data;
        assert.equal((await settled(runId)).status, 'done');
        const m = await (await fetch(`${base}/api/workspaces/${workspaceId}/map`)).json();
        const ws = (await (await fetch(`${base}/api/workspaces/${workspaceId}`)).json()).workspace;
        assert.ok(m.map, 'the scan stored its map');
        assert.deepEqual(m.map.members.map((x) => x.key).sort(), [...ws.projectKeys].sort(),
          'map member keys are the workspace projectKeys (manual edges validate against them)');
        assert.equal(m.descriptionOrigin, 'generated');
        assert.equal(ws.mapSummary.members, 2);
        assert.match(ws.description, /^# Workspace: Platform/);
        await branchesGone(a, b);
      } },
    ]);
  } finally { sock.ws.close(); }
});

test('a scan created with an explicit model pick persists it on the workspace; it survives a member-add auto rescan', async () => {
  const a = await freshRepo();
  const b = await freshRepo();
  const c = await freshRepo(); // added to the workspace later
  const pick = { scanModel: 'claude-opus-5-5', scanEffort: 'high', agentModel: 'fable', agentEffort: 'max' };
  const created = await (await post('/api/workspaces/scan', { name: 'Auto WS', projectPaths: [a, b], models: pick })).json();
  assert.equal((await settled(created.runId)).status, 'done', JSON.stringify(created));
  // the wizard pick is stored on the workspace and served back through the API
  const wsBefore = (await (await fetch(`${base}/api/workspaces/${created.workspaceId}`)).json()).workspace;
  assert.deepEqual(wsBefore.scanModels, pick);

  // A member-add auto-rescan re-reads the stored pick: it resolves (no "no workspace scan model is
  // available" skip), a re-scan starts, and the stored pick survives the member UPDATE.
  const changed = await (await post(`/api/workspaces/${created.workspaceId}/members`, { add: [c] })).json();
  assert.ok(changed.rescan && changed.rescan.runId, `the member-add starts a re-scan: ${JSON.stringify(changed.rescan)}`);
  assert.deepEqual(changed.workspace.scanModels, pick, 'the stored pick survives addWorkspaceMembers');
});

test('two first scans of the same set in the same tick: the launch reservation refuses the second', async () => {
  const a = await freshRepo();
  const b = await freshRepo();
  // A minimal Express res: status() chains, json() records. startRunHandler touches nothing else.
  const fakeRes = () => ({
    statusCode: 200, body: null, headersSent: false,
    status(c) { this.statusCode = c; return this; },
    json(v) { this.body = v; this.headersSent = true; return this; },
  });
  const target = (name, projectPaths) => ({ id: workspaceKey({ name, projectPaths }), name, projectPaths, rescan: false });
  const r1 = fakeRes();
  const r2 = fakeRes();
  // Both calls start in ONE synchronous tick: the first is parked at its first await inside
  // startRunHandler (no runs entry yet) when the second checks — only the reservation refuses it.
  // Over HTTP the second request usually lands after runs.set, which proves nothing.
  const p1 = scanRequest({ body: {}, headers: {} }, r1, target('Tick One', [a, b]));
  const p2 = scanRequest({ body: {}, headers: {} }, r2, target('Tick Two', [b, a]));
  await Promise.all([p1, p2]);
  assert.deepEqual([r1.statusCode, r2.statusCode], [200, 409], JSON.stringify([r1.body, r2.body]));
  assert.match(r2.body.error, /already running/);
  assert.equal((await settled(r1.body.runId)).status, 'done');
  await branchesGone(a, b);
});

test('re-scan: 404 unknown, 409 live run, else a run that replaces the description', async () => {
  assert.equal((await post('/api/workspaces/wks-nope-00000000/scan', {})).status, 404);
  const a = await freshRepo();
  const b = await freshRepo();
  const cr = await post('/api/workspaces', { name: 'Rescan', projectPaths: [a, b], description: 'old' });
  const { workspace } = await cr.json();
  await savePick(workspace.id);
  fakeLiveScan('fake-live-run', workspace.id);
  try {
    assert.equal((await post(`/api/workspaces/${workspace.id}/scan`, {})).status, 409);
  } finally { runs.delete('fake-live-run'); }
  const res = await post(`/api/workspaces/${workspace.id}/scan`, {});
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.workspaceId, workspace.id);
  assert.equal((await settled(data.runId)).status, 'done');
  const after_ = await (await fetch(`${base}/api/workspaces/${workspace.id}`)).json();
  assert.notEqual(after_.workspace.description, 'old');
  assert.match(after_.workspace.description, /## Interconnections/);
  await branchesGone(a, b);
  // The launch reservation is released once the run is registered: the next re-scan starts too.
  const again = await post(`/api/workspaces/${workspace.id}/scan`, {});
  assert.equal(again.status, 200);
  assert.equal((await settled((await again.json()).runId)).status, 'done');
  await branchesGone(a, b);
});

test('a workspace whose members changed keeps its id, but the scan guard follows its CURRENT set', async () => {
  const a = await freshRepo();
  const b = await freshRepo();
  const c = await freshRepo();
  const { workspace } = await (await post('/api/workspaces', { name: 'Grown', projectPaths: [a, b] })).json();
  await addWorkspaceMembers(workspace.id, [c]);   // id still ends in the hash of {a, b}
  await savePick(workspace.id);
  // A live run of the grown workspace does not block a first scan of its ORIGINAL set: no
  // workspace spans {a, b} any more, and no scan of {a, b} is running.
  fakeLiveScan('fake-grown-run', workspace.id);
  try {
    const res = await post('/api/workspaces/scan', { name: 'Original Pair', projectPaths: [a, b] });
    const body = await res.json();
    assert.equal(res.status, 200, body.error);
    // ...while the grown workspace itself stays guarded by its own live run.
    assert.equal((await post(`/api/workspaces/${workspace.id}/scan`, {})).status, 409);
    assert.equal((await settled(body.runId)).status, 'done');
    await branchesGone(a, b);
  } finally { runs.delete('fake-grown-run'); }
});

test('a live first scan of a set a grown workspace once spanned does not block that workspace\'s re-scan', async () => {
  const a = await freshRepo();
  const b = await freshRepo();
  const c = await freshRepo();
  const { workspace } = await (await post('/api/workspaces', { name: 'Grown Too', projectPaths: [a, b] })).json();
  await addWorkspaceMembers(workspace.id, [c]);
  await savePick(workspace.id);
  fakeLiveScan('fake-pair-scan', workspaceKey({ name: 'Pair', projectPaths: [a, b] }));
  try {
    const res = await post(`/api/workspaces/${workspace.id}/scan`, {});
    const body = await res.json();
    assert.equal(res.status, 200, body.error);
    assert.equal((await settled(body.runId)).status, 'done');
    await branchesGone(a, b, c);
  } finally { runs.delete('fake-pair-scan'); }
});

test('a paused scan blocks a re-scan and a delete; a paused ordinary run blocks neither', async () => {
  const a = await freshRepo();
  const b = await freshRepo();
  const { workspace } = await (await post('/api/workspaces', { name: 'Paused Owner', projectPaths: [a, b] })).json();
  await savePick(workspace.id);
  const fakePaused = (id, workflowId) => runs.set(id, {
    id, kind: 'workspace-run', workspaceId: workspace.id, status: 'paused', events: [], orch: { workflowId },
  });
  const del = () => fetch(`${base}/api/workspaces/${workspace.id}`, { method: 'DELETE' });
  fakePaused('fake-paused-scan', 'wf_workspace_scan');
  try {
    assert.equal((await post(`/api/workspaces/${workspace.id}/scan`, {})).status, 409, 'a paused scan still owns the workspace');
    assert.equal((await del()).status, 409, 'deleting would let the paused scan re-create it on resume');
  } finally { runs.delete('fake-paused-scan'); }
  fakePaused('fake-paused-run', 'wf_default');
  try {
    const res = await post(`/api/workspaces/${workspace.id}/scan`, {});
    assert.equal(res.status, 200, 'a paused ordinary run does not block a re-scan');
    assert.equal((await settled((await res.json()).runId)).status, 'done');
    await branchesGone(a, b);
    assert.equal((await del()).status, 200, 'nor a delete');
  } finally { runs.delete('fake-paused-run'); }
});

test('POST /api/run refuses the scan workflow without the internal target', async () => {
  const a = await freshRepo();
  const b = await freshRepo();
  const cr = await post('/api/workspaces', { name: 'Direct', projectPaths: [a, b] });
  const { workspace } = await cr.json();
  const res = await post('/api/run', { workspaceId: workspace.id, prompt: 'x', workflowId: 'wf_workspace_scan' });
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /Workspaces view/);
});

test('the scan workflow is never listed; the off-pipeline scan surface is gone', async () => {
  const wf = await (await fetch(`${base}/api/workflows`)).json();
  assert.ok(!wf.workflows.some((w) => w.id === 'wf_workspace_scan'));
  assert.equal((await post('/api/scan/stop', { scanId: 'scan_x' })).status, 404);
  runs.set('r-sum', { id: 'r-sum', projectDir: '/x', title: 't', status: 'running', startedAt: 'now', kind: 'run' });
  try {
    assert.ok(!('scanId' in summarizeRuns().find((r) => r.runId === 'r-sum')));
  } finally { runs.delete('r-sum'); }
});

test('41 member projects: 400 from both create routes, before any run or row exists', async () => {
  const root = await freshDir();
  const dirs = Array.from({ length: 41 }, (_, i) => join(root, `m${i}`));
  for (const d of dirs) spawnSync('git', ['init', '-q', d]);
  for (const route of ['/api/workspaces/scan', '/api/workspaces']) {
    const res = await post(route, { name: 'Too big', projectPaths: dirs });
    assert.equal(res.status, 400, route);
    assert.match((await res.json()).error, /at most 40 member projects \(41 given\)/, route);
  }
  assert.ok(![...runs.values()].some((r) => r.title === 'Workspace scan: Too big'), 'no run registered');
  const { workspaces } = await (await fetch(`${base}/api/workspaces`)).json();
  assert.ok(!workspaces.some((w) => w.name === 'Too big'), 'no workspace row');
});
