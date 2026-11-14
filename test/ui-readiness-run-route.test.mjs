// test/ui-readiness-run-route.test.mjs — POST /api/projects/:key/readiness-run and the `run` block of
// GET /api/projects/:key/readiness: the chip's "Check" / "Set up with AI" offers, available only with the ai-readiness
// plugin's workflow installed, a project with code, and a non-mock server.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { rm, readFile } from 'node:fs/promises';
import { stubHome, STUB_BIN, STUB_MARKER, restoreStubEnv } from './helpers/stub-engine-env.mjs';   // FIRST: sets HOME + the stub engine before any bin is read
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { DEFAULT_BIN } from '../src/core/engines/claude.mjs';
import { getDb } from '../src/core/db.mjs';

import { templateRepo } from './helpers/git-dir.mjs';
import { useTempHome } from './helpers/temp-home.mjs';
import { writeGraphWorkflow, deleteWorkflow } from '../src/core/workflows.mjs';
import { readinessRunInfo, READINESS_SETUP_WORKFLOW_ID, READINESS_CHECK_WORKFLOW_ID } from '../src/core/repo-readiness/projects.mjs';

useTempHome(after);

let srv, mod, base, prevMock, prevKill, project, dir;
const JSONH = { 'Content-Type': 'application/json' };
const call = (method, p, body) => fetch(`${base}${p}`, { method, headers: JSONH, body: body === undefined ? undefined : JSON.stringify(body) });

before(async () => {
  prevMock = process.env.WORCA_MOCK; prevKill = process.env.WORCA_READINESS;
  delete process.env.WORCA_MOCK; delete process.env.WORCA_READINESS;   // an available offer needs a non-mock server
  mod = await import('../ui/server.mjs');
  srv = mod.server;
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
  dir = templateRepo('readiness-setup', { branch: 'main', user: true, files: { 'README.md': '# hi\n', 'src/index.js': 'export {};\n' } });
  const res = await call('POST', '/api/projects', { name: 'setup-proj', path: dir });
  project = (await res.json()).projects.find((p) => p.name === 'setup-proj');
});
after(async () => {
  if (srv) await new Promise((r) => { srv.close(r); srv.closeAllConnections?.(); });
  if (prevMock === undefined) delete process.env.WORCA_MOCK; else process.env.WORCA_MOCK = prevMock;
  if (prevKill === undefined) delete process.env.WORCA_READINESS; else process.env.WORCA_READINESS = prevKill;
  await rm(dir, { recursive: true, force: true, maxRetries: 3 });
  restoreStubEnv();
});

test('the file runs in the scratch home and every engine spawn is the stub', () => {
  assert.equal(homedir(), stubHome);
  assert.equal(process.env.HOME, stubHome);
  assert.equal(DEFAULT_BIN, STUB_BIN, 'the engine bin the runner spawns is the stub, fixed at import');
});

const installFlow = (id, name) => writeGraphWorkflow({
  id, name, domain: 'readiness', origin: 'plugin:ai-readiness',
  nodes: [{ id: 'n_task', kind: 'task', x: 0, y: 0, config: {} }, { id: 'n_plan', kind: 'agent', key: 'planner', x: 300, y: 0, config: {} }, { id: 'n_end', kind: 'end', x: 600, y: 0, config: {} }],
  wires: [{ id: 'w1', from: { node: 'n_task', port: 'task' }, to: { node: 'n_plan', port: 'task' } }, { id: 'w2', from: { node: 'n_plan', port: 'plan' }, to: { node: 'n_end', port: 'result' } }],
});
const installSetupWorkflow = () => installFlow(READINESS_SETUP_WORKFLOW_ID, 'AI readiness setup');
const installCheckWorkflow = () => installFlow(READINESS_CHECK_WORKFLOW_ID, 'AI readiness check');
const runInfo = async () => (await (await call('GET', `/api/projects/${project.key}/readiness`)).json()).run;
const NONE = { available: { check: false, setup: false }, hasCode: true, lastCheck: null, lastSetup: null, live: null };

test('route 404s without the plugin, and the report says neither run is available', async () => {
  await deleteWorkflow(READINESS_SETUP_WORKFLOW_ID).catch(() => {});
  await deleteWorkflow(READINESS_CHECK_WORKFLOW_ID).catch(() => {});
  const r = await call('POST', `/api/projects/${project.key}/readiness-run`, { kind: 'setup', mock: true });
  assert.equal(r.status, 404);
  assert.deepEqual(await runInfo(), NONE);
});

test('route 404s for an unknown project', async () => {
  const r = await call('POST', '/api/projects/nope-00000000/readiness-run', { kind: 'check' });
  assert.equal(r.status, 404);
});

test('route 400s for another kind', async () => {
  await installSetupWorkflow();
  const r = await call('POST', `/api/projects/${project.key}/readiness-run`, { kind: 'other', mock: true });
  assert.equal(r.status, 400);
});

const waitFor = async (pick) => {
  let v;
  for (let i = 0; i < 100; i++) { v = pick(await runInfo()); if (v) return v; await new Promise((r) => setTimeout(r, 50)); }
  return v;
};

test('POST readiness-run kind=setup starts wfp_ai-readiness_setup for the project', async () => {
  clearRuns();
  await installSetupWorkflow();
  const g = await runInfo();
  assert.deepEqual(g.available, { check: false, setup: true });
  const r = await call('POST', `/api/projects/${project.key}/readiness-run`, { kind: 'setup', mock: true });
  assert.ok(r.status === 200 || r.status === 202, `started: ${r.status} ${await r.clone().text()}`);
  const { runId } = await r.json();
  assert.ok(runId, 'answers the run id');
  const last = await waitFor((i) => i.lastSetup);
  assert.ok(last?.pipelineId, 'the new run is the last setup run');
  assert.notEqual(last.pipelineId, runId, 'the pipeline id is not the live run id');
  assert.ok(last.runId === runId || last.runId === null);
  assert.equal(last.title, 'AI readiness setup');
  assert.equal(last.workflowId, READINESS_SETUP_WORKFLOW_ID);
});

// A run the previous test started is still live in the run registry (the one-run guard sees it without its row): stop it.
const stopLive = async () => {
  for (const r of [...mod.runs.values()]) { try { await mod.stopRun(r.id); } catch { /* already over */ } }
  await new Promise((r) => setTimeout(r, 100));
};

test('POST readiness-run kind=check starts wfp_ai-readiness_check for the project', async () => {
  await stopLive();
  clearRuns();
  await installCheckWorkflow();
  const g = await runInfo();
  assert.equal(g.available.check, true);
  const r = await call('POST', `/api/projects/${project.key}/readiness-run`, { kind: 'check', mock: true });
  assert.ok(r.status === 200 || r.status === 202, `started: ${r.status} ${await r.clone().text()}`);
  const last = await waitFor((i) => i.lastCheck);
  assert.equal(last?.title, 'AI readiness check');
  assert.equal(last.workflowId, READINESS_CHECK_WORKFLOW_ID);
});

test('readinessRunInfo: a run carries the pipeline id, and the live run id only while the run is live here', async () => {
  const rows = [{ id: 'p1', status: 'running', title: 't', workflow_id: READINESS_SETUP_WORKFLOW_ID, started_at: 'x' }];
  const deps = { mock: false, hasCode: () => true, listWorkflows: async () => [{ id: READINESS_SETUP_WORKFLOW_ID }], latestRuns: () => rows };
  const a = await readinessRunInfo(project, { ...deps, liveRunId: (pid) => (pid === 'p1' ? 'live-1' : null) });
  assert.equal(a.lastSetup.runId, 'live-1'); assert.equal(a.lastSetup.pipelineId, 'p1'); assert.equal(a.live.pipelineId, 'p1');
  const b = await readinessRunInfo(project, { ...deps, liveRunId: () => null });
  assert.equal(b.lastSetup.runId, null); assert.equal(b.lastSetup.pipelineId, 'p1');
});

test('readinessRunInfo is unavailable on a mock server even with the workflow', async () => {
  const info = await readinessRunInfo(project, { mock: true });
  assert.deepEqual(info, { available: { check: false, setup: false }, hasCode: false, lastCheck: null, lastSetup: null, live: null });
});

const startRun = async (body) => {
  const r = await call('POST', '/api/run', { projectDir: dir, prompt: 'x', guardrailsId: 'normal', mock: true, ...body });
  assert.ok(r.status === 200 || r.status === 202, `${r.status} ${await r.clone().text()}`);
};
const lastSetupOf = async () => {
  for (let i = 0; i < 40; i++) await new Promise((r) => setTimeout(r, 25));
  return (await runInfo()).lastSetup;
};
const clearRuns = () => getDb().prepare('DELETE FROM pipelines').run();

test('lastSetup is the run of the setup workflow, whatever its title; a same-titled run of another workflow is not', async () => {
  await installSetupWorkflow();
  clearRuns();
  await startRun({ workflowId: 'wf_default', title: 'AI readiness setup' });
  assert.equal(await lastSetupOf(), null, 'a user run that only shares the title');
  await startRun({ workflowId: READINESS_SETUP_WORKFLOW_ID, title: 'my own title' });
  assert.equal((await lastSetupOf())?.title, 'my own title');
});

test('the lookup does no git work: it does not go through listPipelines', async () => {
  const src = await readFile(new URL('../src/core/repo-readiness/projects.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /listPipelines/);
});

test('route 409s while a run is live (a check run blocks setup too), and answers again once it is over', async () => {
  await installSetupWorkflow(); await installCheckWorkflow();
  clearRuns();
  await startRun({ workflowId: READINESS_CHECK_WORKFLOW_ID, title: 'check' });
  // The mock run writes its row in stages and then finishes by itself, rewriting its status; runs of earlier tests may still
  // be writing too. Wait (bounded) until this run's row is there, over, and unchanged for a while, so nothing rewrites the
  // 'running' status this test then sets.
  const snap = () => JSON.stringify(getDb().prepare("SELECT id, status, run_setup FROM pipelines WHERE json_extract(CASE WHEN json_valid(run_setup) THEN run_setup END, '$.workflowId') = ?").all(READINESS_CHECK_WORKFLOW_ID));
  const over = () => { const rows = JSON.parse(snap()); return rows.length > 0 && rows.every((r) => ['done', 'error', 'failed', 'stopped', 'completed'].includes(r.status)); };
  let last = '', stableSince = 0;
  for (let i = 0; i < 800; i++) {
    const now = snap();
    if (now !== last) { last = now; stableSince = Date.now(); } else if (over() && Date.now() - stableSince >= 400) break;
    await new Promise((r) => setTimeout(r, 25));
  }
  assert.ok(over(), 'the run settled');
  getDb().prepare("UPDATE pipelines SET status = 'running'").run();
  for (const kind of ['check', 'setup']) {
    const r = await call('POST', `/api/projects/${project.key}/readiness-run`, { kind, mock: true });
    assert.equal(r.status, 409, kind);
    assert.match((await r.json()).error, /already live/);
  }
  getDb().prepare("UPDATE pipelines SET status = 'done'").run();
  const ok = await call('POST', `/api/projects/${project.key}/readiness-run`, { kind: 'check', mock: true });
  assert.ok(ok.status === 200 || ok.status === 202);
});

test('route 404s for a README-only project', async () => {
  await installSetupWorkflow(); await installCheckWorkflow();
  const d2 = templateRepo('readiness-readme-only', { branch: 'main', user: true, files: { 'README.md': '# hi\n' } });
  try {
    const res = await call('POST', '/api/projects', { name: 'readme-only', path: d2 });
    const p2 = (await res.json()).projects.find((p) => p.name === 'readme-only');
    for (const kind of ['check', 'setup']) {
      assert.equal((await call('POST', `/api/projects/${p2.key}/readiness-run`, { kind, mock: true })).status, 404, kind);
    }
  } finally { await rm(d2, { recursive: true, force: true, maxRetries: 3 }); }
});

test('any engine start was the stub, which did no work', () => {
  if (existsSync(STUB_MARKER)) assert.match(readFileSync(STUB_MARKER, 'utf8'), /^(spawned \d+\n)+$/);
});
