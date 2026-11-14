// test/ui-workspace-readiness-route.test.mjs — GET /api/workspaces/:id/readiness and POST /api/workspaces/:id/readiness-run:
// the workspace's "Evaluate with AI" / "Set up with AI". Available only with the ai-readiness plugin's workflow installed,
// a member with code and a non-mock server; refused while a scan, another workspace run or a member's project run is live.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import { stubHome, restoreStubEnv } from './helpers/stub-engine-env.mjs';   // FIRST: sets HOME + the stub engine before any bin is read
import { homedir } from 'node:os';
import { getDb } from '../src/core/db.mjs';
import { templateRepo } from './helpers/git-dir.mjs';
import { useTempHome } from './helpers/temp-home.mjs';
import { writeGraphWorkflow, deleteWorkflow } from '../src/core/workflows.mjs';
import { createWorkspace } from '../src/core/workspaces.mjs';
import { READINESS_SETUP_WORKFLOW_ID, READINESS_CHECK_WORKFLOW_ID, isLiveReadinessStatus } from '../src/core/repo-readiness/projects.mjs';

useTempHome(after);

let srv, mod, base, prevMock, prevKill, dirA, dirB, dirC, wsId, ws2Id, projA;
const JSONH = { 'Content-Type': 'application/json' };
const call = (method, p, body) => fetch(`${base}${p}`, { method, headers: JSONH, body: body === undefined ? undefined : JSON.stringify(body) });
const files = { 'README.md': '# hi\n', 'src/index.js': 'export {};\n' };

before(async () => {
  prevMock = process.env.WORCA_MOCK; prevKill = process.env.WORCA_READINESS;
  delete process.env.WORCA_MOCK; delete process.env.WORCA_READINESS;
  mod = await import('../ui/server.mjs');
  srv = mod.server;
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
  dirA = templateRepo('wsrd-a', { branch: 'main', user: true, files });
  dirB = templateRepo('wsrd-b', { branch: 'main', user: true, files });
  const list = (await (await call('POST', '/api/projects', { name: 'wsrd-a', path: dirA })).json()).projects;
  projA = list.find((p) => p.name === 'wsrd-a');
  await call('POST', '/api/projects', { name: 'wsrd-b', path: dirB });
  wsId = (await createWorkspace({ name: 'Readiness ws', projectPaths: [dirA, dirB] })).id;
  dirC = templateRepo('wsrd-c', { branch: 'main', user: true, files });
  await call('POST', '/api/projects', { name: 'wsrd-c', path: dirC });
  ws2Id = (await createWorkspace({ name: 'Readiness ws 2', projectPaths: [dirA, dirC] })).id;   // shares member A
});
after(async () => {
  if (srv) await new Promise((r) => { srv.close(r); srv.closeAllConnections?.(); });
  if (prevMock === undefined) delete process.env.WORCA_MOCK; else process.env.WORCA_MOCK = prevMock;
  if (prevKill === undefined) delete process.env.WORCA_READINESS; else process.env.WORCA_READINESS = prevKill;
  for (const d of [dirA, dirB, dirC].filter(Boolean)) await rm(d, { recursive: true, force: true, maxRetries: 3 });
  restoreStubEnv();
});

const installFlow = (id, name) => writeGraphWorkflow({
  id, name, domain: 'readiness', origin: 'plugin:ai-readiness',
  nodes: [{ id: 'n_task', kind: 'task', x: 0, y: 0, config: {} }, { id: 'n_plan', kind: 'agent', key: 'planner', x: 300, y: 0, config: {} }, { id: 'n_end', kind: 'end', x: 600, y: 0, config: {} }],
  wires: [{ id: 'w1', from: { node: 'n_task', port: 'task' }, to: { node: 'n_plan', port: 'task' } }, { id: 'w2', from: { node: 'n_plan', port: 'plan' }, to: { node: 'n_end', port: 'result' } }],
});
const installBoth = async () => { await installFlow(READINESS_SETUP_WORKFLOW_ID, 'AI readiness setup'); await installFlow(READINESS_CHECK_WORKFLOW_ID, 'AI readiness check'); };
// Stop what a test started and wait until each stop has really ended: a stopped run still writes its own row and
// settles its entry after stopRun returns, and on a slow runner that came after the clear, so the next test's start
// met the last test's run (409). Then forget the rows and drop the workspace and readiness entries.
const clearRuns = async () => {
  for (const r of [...mod.runs.values()]) { try { await mod.stopRun(r.id); } catch { /* already over */ } }
  for (let i = 0; i < 100 && [...mod.runs.values()].some((r) => isLiveReadinessStatus(r.status)); i++) {
    await new Promise((r) => setTimeout(r, 50));
  }
  await new Promise((r) => setTimeout(r, 100));
  getDb().prepare('DELETE FROM pipelines').run();
  const readinessFlows = new Set([READINESS_SETUP_WORKFLOW_ID, READINESS_CHECK_WORKFLOW_ID]);
  for (const [k, r] of [...mod.runs.entries()]) {
    if (r.kind === 'workspace-run' || r.workspaceId || readinessFlows.has(r.orch && r.orch.workflowId)) mod.runs.delete(k);
  }
};
const info = async () => (await call('GET', `/api/workspaces/${wsId}/readiness`)).json();
const waitFor = async (pick) => { for (let i = 0; i < 300; i++) { const v = await info(); if (pick(v)) return v; await new Promise((r) => setTimeout(r, 50)); } return info(); };

test('runs in the scratch home', () => { assert.equal(homedir(), stubHome); });

test('404 without the workflow, and the GET says nothing is available', async () => {
  await deleteWorkflow(READINESS_SETUP_WORKFLOW_ID).catch(() => {});
  await deleteWorkflow(READINESS_CHECK_WORKFLOW_ID).catch(() => {});
  const g = await info();
  assert.deepEqual(g.available, { check: false, setup: false });
  for (const kind of ['check', 'setup']) assert.equal((await call('POST', `/api/workspaces/${wsId}/readiness-run`, { kind, mock: true })).status, 404, kind);
  assert.equal((await call('POST', '/api/workspaces/nope-00000000/readiness-run', { kind: 'check' })).status, 404);
  assert.equal((await call('POST', `/api/workspaces/${wsId}/readiness-run`, { kind: 'other' })).status, 400);
});

test('starts the workspace check run', async () => {
  await clearRuns(); await installBoth();
  assert.deepEqual((await info()).available, { check: true, setup: true });
  const r = await call('POST', `/api/workspaces/${wsId}/readiness-run`, { kind: 'check', mock: true });
  assert.ok(r.status === 200 || r.status === 202, `${r.status} ${await r.clone().text()}`);
  const rb = await r.json(); assert.ok(rb.runId);
  const g = await waitFor((i) => i.lastCheck);
  assert.equal(g.lastCheck?.title, 'AI readiness check');
  assert.equal(g.lastCheck.workflowId, READINESS_CHECK_WORKFLOW_ID);
  assert.equal(g.lastCheck.workspaceId, wsId, 'the run is the workspace\'s');
  assert.equal(g.lastSetup, null);
});

test('starts the workspace setup run', async () => {
  await clearRuns(); await installBoth();
  const r = await call('POST', `/api/workspaces/${wsId}/readiness-run`, { kind: 'setup', mock: true });
  assert.ok(r.status === 200 || r.status === 202, `${r.status} ${await r.clone().text()}`);
  const g = await waitFor((i) => i.lastSetup);
  assert.equal(g.lastSetup?.title, 'AI readiness setup');
  assert.equal(g.lastSetup.workspaceId, wsId);
});

test('409 while a scan is live', async () => {
  await clearRuns(); await installBoth();
  mod.runs.set('scan-x', { id: 'scan-x', kind: 'workspace-run', workspaceId: wsId, status: 'running' });
  try {
    const r = await call('POST', `/api/workspaces/${wsId}/readiness-run`, { kind: 'check', mock: true });
    assert.equal(r.status, 409);
  } finally { mod.runs.delete('scan-x'); }
  const ok = await call('POST', `/api/workspaces/${wsId}/readiness-run`, { kind: 'check', mock: true });
  assert.ok(ok.status === 200 || ok.status === 202, 'answers again once the scan is over');
});

test('409 while a member\'s project setup run is live, and while the workspace\'s own run is', async () => {
  await clearRuns(); await installBoth();
  const p = await call('POST', `/api/projects/${projA.key}/readiness-run`, { kind: 'setup', mock: true });
  assert.ok(p.status === 200 || p.status === 202, `${p.status} ${await p.clone().text()}`);
  await new Promise((r) => setTimeout(r, 500));
  getDb().prepare("UPDATE pipelines SET status = 'running'").run();
  const g = await info();
  assert.ok(g.live, 'the member\'s live run shows as the workspace\'s live');
  for (const kind of ['check', 'setup']) assert.equal((await call('POST', `/api/workspaces/${wsId}/readiness-run`, { kind, mock: true })).status, 409, kind);
  // The run ends: its row and its live entry (the guard reads both; a slow mock run may still be in the registry).
  for (const r of [...mod.runs.values()]) { try { await mod.stopRun(r.id); } catch { /* already over */ } }
  await new Promise((r) => setTimeout(r, 100));
  getDb().prepare("UPDATE pipelines SET status = 'done'").run();
  const ok = await call('POST', `/api/workspaces/${wsId}/readiness-run`, { kind: 'check', mock: true });
  assert.ok(ok.status === 200 || ok.status === 202, `${ok.status} ${await ok.clone().text()}`);
});

test('409 on a second start while the workspace\'s own run is live', async () => {
  await clearRuns(); await installBoth();
  const first = await call('POST', `/api/workspaces/${wsId}/readiness-run`, { kind: 'check', mock: true });
  assert.ok(first.status === 200 || first.status === 202, `${first.status} ${await first.clone().text()}`);
  assert.equal((await call('POST', `/api/workspaces/${wsId}/readiness-run`, { kind: 'setup', mock: true })).status, 409);
  await clearRuns();
});

test('a member\'s project readiness run is refused right after the workspace run started (before its row exists)', async () => {
  await clearRuns(); await installBoth();
  const first = await call('POST', `/api/workspaces/${wsId}/readiness-run`, { kind: 'check', mock: true });
  assert.ok(first.status === 200 || first.status === 202, `${first.status} ${await first.clone().text()}`);
  const r = await call('POST', `/api/projects/${projA.key}/readiness-run`, { kind: 'setup', mock: true });
  assert.equal(r.status, 409, await r.clone().text());
  await clearRuns();
});

// Back to back, nothing awaited between: the second start sees neither a row nor (maybe) a run entry yet. One wins, one is 409.
const started = (r) => r.status === 200 || r.status === 202;
const oneWins = async (a, b, label) => {
  const [x, y] = await Promise.all([a(), b()]);
  const codes = [x.status, y.status].sort();
  assert.equal(codes.filter((c) => c === 409).length, 1, `${label}: ${codes}`);
  assert.ok(started(x) || started(y), `${label}: one started (${codes})`);
};

test('a project POST and a workspace POST fired back to back: the second is 409', async () => {
  await clearRuns(); await installBoth();
  await oneWins(() => call('POST', `/api/projects/${projA.key}/readiness-run`, { kind: 'setup', mock: true }),
    () => call('POST', `/api/workspaces/${wsId}/readiness-run`, { kind: 'check', mock: true }), 'project then workspace');
  await clearRuns();
  await oneWins(() => call('POST', `/api/workspaces/${wsId}/readiness-run`, { kind: 'check', mock: true }),
    () => call('POST', `/api/projects/${projA.key}/readiness-run`, { kind: 'setup', mock: true }), 'workspace then project');
  await clearRuns();
});

test('two project POSTs back to back: the second is 409', async () => {
  await clearRuns(); await installBoth();
  await oneWins(() => call('POST', `/api/projects/${projA.key}/readiness-run`, { kind: 'check', mock: true }),
    () => call('POST', `/api/projects/${projA.key}/readiness-run`, { kind: 'setup', mock: true }), 'two project starts');
  await clearRuns();
});

test('two workspaces sharing a member, back to back: the second is 409', async () => {
  await clearRuns(); await installBoth();
  await oneWins(() => call('POST', `/api/workspaces/${wsId}/readiness-run`, { kind: 'check', mock: true }),
    () => call('POST', `/api/workspaces/${ws2Id}/readiness-run`, { kind: 'setup', mock: true }), 'two workspaces');
  await clearRuns();
});

test('a project run just registered (no row yet) refuses a workspace start over that member', async () => {
  await clearRuns(); await installBoth();
  mod.runs.set('proj-x', { id: 'proj-x', kind: 'run', projectDir: dirA, status: 'starting', orch: { workflowId: READINESS_CHECK_WORKFLOW_ID } });
  try {
    assert.equal((await call('POST', `/api/workspaces/${wsId}/readiness-run`, { kind: 'setup', mock: true })).status, 409);
    assert.equal((await call('POST', `/api/projects/${projA.key}/readiness-run`, { kind: 'setup', mock: true })).status, 409);
  } finally { mod.runs.delete('proj-x'); }
});
