// test/api-run-overlay.test.mjs — POST /api/run's per-run overlay (docs/models.md "Per-agent models for one run"):
// checked against the workflow and the catalog (400s), resolved over the project layer for THAT run, recorded on the
// manifest, stored as checked on a schedule — and never written into the project config.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { gitDir } from './helpers/git-dir.mjs';

useTempHome(after);   // outer isolation: the mock run below works ASYNC in-process

let sandboxHome, projectsRoot, srv, base, runs, project, projectDir;
const prevEnv = {};
const JSONH = { 'Content-Type': 'application/json' };
const get = (p) => fetch(`${base}${p}`);
const post = (p, b) => fetch(`${base}${p}`, { method: 'POST', headers: JSONH, body: JSON.stringify(b ?? {}) });
const DAY = () => new Date(Date.now() + 86400000).toISOString();
const settled = new Set(['done', 'stopped', 'error', 'paused', 'interrupted']);
async function untilSettled(runId, ms = 90000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const e = runs.get(runId);
    if (e && settled.has(String(e.status || ''))) return e;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`run ${runId} never settled`);
}
async function untilStepper(entry, ms = 30000) {
  const t0 = Date.now();
  for (;;) {
    const s = entry.orch.getState().stepper;
    if (s && s.graph && Array.isArray(s.graph.nodes) && s.graph.nodes.length) return s;
    if (Date.now() - t0 > ms) throw new Error('the run never built its manifest');
    await new Promise((r) => setTimeout(r, 50));
  }
}

before(async () => {
  sandboxHome = await mkdtemp(join(tmpdir(), 'worca-cc-overlay-home-'));
  projectsRoot = await mkdtemp(join(tmpdir(), 'worca-cc-overlay-proot-'));
  for (const k of ['HOME', 'USERPROFILE', 'WORCA_TEST_ALLOW_HOME_FALLBACK', 'WORCA_PROJECTS_ROOT', 'WORCA_MOCK']) prevEnv[k] = process.env[k];
  process.env.HOME = sandboxHome; process.env.USERPROFILE = sandboxHome;
  process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = '1';
  process.env.WORCA_PROJECTS_ROOT = projectsRoot;
  process.env.WORCA_MOCK = '1';
  const mod = await import('../ui/server.mjs');       // imported ⇒ no port bind
  ({ runs } = mod);
  srv = mod.server;
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
  const { addProject } = await import('../src/core/projects.mjs');
  projectDir = gitDir('overlayapi');
  project = (await addProject({ name: 'overlayapi', path: projectDir })).find((p) => p.name === 'overlayapi');
});
after(async () => {
  if (srv) await Promise.race([
    new Promise((r) => { srv.close(r); srv.closeAllConnections?.(); }),
    new Promise((r) => { const t = setTimeout(r, 500); t.unref?.(); }),
  ]);
  for (const k of Object.keys(prevEnv)) { if (prevEnv[k] === undefined) delete process.env[k]; else process.env[k] = prevEnv[k]; }
  await rm(sandboxHome, { recursive: true, force: true, maxRetries: 10 });
  await rm(projectsRoot, { recursive: true, force: true, maxRetries: 10 });
  if (projectDir) await rm(projectDir, { recursive: true, force: true, maxRetries: 10 });
});

test('POST /api/run: overlay.nodes is checked against the workflow and the catalog — a bad one is a 400', { timeout: 60000 }, async () => {
  const body = { projectDir: project.path, workflowId: 'wf_default', guardrailsId: 'normal', prompt: 'demo task', scheduledFor: DAY() };
  for (const [overlay, re] of [
    [[], /^overlay must be an object/],
    [{ nodes: {}, foo: {} }, /^overlay takes nodes and wires only/],
    [{ nodes: { n_ghost: { model: 'claude-opus-5-5' } } }, /node "n_ghost" is not an agent node of workflow wf_default/],
    [{ nodes: { n_task: { model: 'claude-opus-5-5' } } }, /node "n_task" is not an agent node of workflow wf_default/],
    [{ nodes: { n_plan: { model: 'gone-model' } } }, /node "n_plan": unknown model "gone-model"/],
    [{ nodes: { n_plan: { model: 'claude-haiku-4-5', effort: 'max' } } }, /node "n_plan": model claude-haiku-4-5 has no effort "max"/],
    [{ nodes: { n_plan: { effort: 'high' } } }, /node "n_plan": an effort needs a model/],
    [{ nodes: { n_plan: { model: 'gpt-5.5' } } }, /node "n_plan": gpt-5\.5 runs on Codex, not on Claude/],
    [{ nodes: { n_plan: { model: 'claude-opus-5-5', reason: 'x' } } }, /overlay\.nodes\.n_plan: unknown key "reason"/],
    [{ nodes: { n_plan: { fanOut: 'yes' } } }, /node "n_plan": fanOut must be true or false/],
  ]) {
    const r = await post('/api/run', { ...body, overlay });
    assert.equal(r.status, 400, JSON.stringify(overlay));
    assert.match((await r.json()).error, re);
  }
  const auto = await post('/api/run', { ...body, workflowId: 'wf_auto', overlay: { nodes: { n_plan: { model: 'claude-opus-5-5' } } } });
  assert.equal(auto.status, 400);
  assert.match((await auto.json()).error, /^overlay needs a saved workflow/);
});

test('POST /api/run: a normal run resolves the overlay over the project layer for THAT run, records it, writes no config', { timeout: 120000 }, async () => {
  const r = await post('/api/run', { projectDir: project.path, workflowId: 'wf_default', guardrailsId: 'normal', prompt: 'demo task',
    overlay: { nodes: { n_plan: { model: 'CLAUDE-HAIKU-4-5', effort: 'medium' }, n_impl: { model: 'claude-opus-5-5' } } } });
  const raw = await r.text();
  assert.equal(r.status, 200, raw);
  const { runId } = JSON.parse(raw);
  const entry = runs.get(runId);
  const canonical = { nodes: { n_plan: { model: 'claude-haiku-4-5', effort: 'medium' }, n_impl: { model: 'claude-opus-5-5', effort: '' } } };
  assert.deepEqual(entry.orch.opts.overlay, canonical, 'the catalog\'s casing; every model names its effort');
  try {
    const stepper = await untilStepper(entry);
    const cell = (id) => stepper.graph.nodes.find((n) => n.id === id);
    assert.deepEqual([cell('n_plan').model, cell('n_plan').effort], ['claude-haiku-4-5', 'medium']);
    assert.deepEqual([cell('n_impl').model, cell('n_impl').effort], ['claude-opus-5-5', '']);
    assert.deepEqual(stepper.runOverlay, canonical);
  } finally {
    await post('/api/stop', { runId });
    await untilSettled(runId);
  }
  const cfg = (await (await get(`/api/config?projectDir=${encodeURIComponent(project.path)}`)).json()).config || {};
  assert.equal(((cfg.steps || {}).planner || {}).model, undefined, 'no per-role model was saved');
  assert.equal((((cfg.workflows || {}).wf_default || {}).nodes || {}).n_plan, undefined, 'no node override was saved');
});

test('POST /api/run: overlay.wires sets a loop budget for THAT run and is recorded on the manifest', { timeout: 120000 }, async () => {
  const wf = await (await get('/api/workflows/wf_default')).json();
  const loop = (wf.wires || []).find((w) => w && w.config && Number.isInteger(w.config.maxCycles));
  assert.ok(loop, 'wf_default has a loop wire');
  const r = await post('/api/run', { projectDir: project.path, workflowId: 'wf_default', guardrailsId: 'normal', prompt: 'loop budget',
    overlay: { wires: { [loop.id]: { maxCycles: 1 } } } });
  const raw = await r.text();
  assert.equal(r.status, 200, raw);
  const { runId } = JSON.parse(raw);
  try {
    const stepper = await untilStepper(runs.get(runId));
    assert.deepEqual(stepper.runOverlay, { wires: { [loop.id]: { maxCycles: 1 } } });
  } finally {
    await post('/api/stop', { runId });
    await untilSettled(runId);
  }
});

test('POST /api/run: a SCHEDULED run stores the overlay as checked (its ticket fires it verbatim)', async () => {
  const { getTicket } = await import('../src/core/scheduler.mjs');
  const r = await post('/api/run', { projectDir: project.path, workflowId: 'wf_default', guardrailsId: 'normal', prompt: 'later', scheduledFor: DAY(),
    overlay: { nodes: { n_plan: { model: ' Claude-Haiku-4-5 ', effort: 'high' } } } });
  const j = await r.json();
  assert.equal(r.status, 202, JSON.stringify(j));
  const { request } = getTicket(j.runId, { withRequest: true });
  assert.deepEqual(request.overlay, { nodes: { n_plan: { model: 'claude-haiku-4-5', effort: 'high' } } });
});

test('POST /api/run: a WORKSPACE run resolves the overlay over its primary member\'s layer; a workspace schedule stores it as checked', { timeout: 120000 }, async () => {
  const { addProject } = await import('../src/core/projects.mjs');
  const { createWorkspace } = await import('../src/core/workspaces.mjs');
  const { setNodeModel } = await import('../src/core/config.mjs');
  const { getTicket } = await import('../src/core/scheduler.mjs');
  const dirs = [gitDir('overlayws-a'), gitDir('overlayws-b')];
  try {
    for (const [i, d] of dirs.entries()) {
      await addProject({ name: `overlayws${i}`, path: d });
      await setNodeModel(d, 'wf_default', 'n_impl', { model: 'claude-sonnet-5', effort: 'max' });   // each member's own pick
    }
    const ws = await createWorkspace({ name: 'overlay ws', projectPaths: dirs });
    const overlay = { nodes: { n_impl: { model: 'CLAUDE-HAIKU-4-5' } } };
    const canonical = { nodes: { n_impl: { model: 'claude-haiku-4-5', effort: '' } } };
    const s = await post('/api/run', { workspaceId: ws.id, workflowId: 'wf_default', guardrailsId: 'normal', prompt: 'later', scheduledFor: DAY(), overlay });
    const sj = await s.json();
    assert.equal(s.status, 202, JSON.stringify(sj));
    assert.deepEqual(getTicket(sj.runId, { withRequest: true }).request.overlay, canonical, 'stored as checked');
    const r = await post('/api/run', { workspaceId: ws.id, workflowId: 'wf_default', guardrailsId: 'normal', prompt: 'now', overlay });
    const raw = await r.text();
    assert.equal(r.status, 200, raw);
    const { runId } = JSON.parse(raw);
    try {
      const stepper = await untilStepper(runs.get(runId));
      const cell = stepper.graph.nodes.find((n) => n.id === 'n_impl');
      assert.deepEqual([cell.model, cell.effort], ['claude-haiku-4-5', ''], 'the pick, and the member\'s stored max never rides under it');
      assert.deepEqual(stepper.runOverlay, canonical);
    } finally {
      await post('/api/stop', { runId });
      await untilSettled(runId);
    }
  } finally {
    for (const d of dirs) await rm(d, { recursive: true, force: true, maxRetries: 10 });
  }
});
