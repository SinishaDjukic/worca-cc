// test/api-run-presets.test.mjs — run presets over HTTP (docs/run-presets.md, #712): CRUD,
// the pick-time check, the start-time check on POST /api/run (409 preset-broken), the pin check, per-person presets
// on a shared deployment, and a preset run that equals the hand-made run and writes no project config.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { gitDir } from './helpers/git-dir.mjs';

useTempHome(after);

const H = 'X-Forwarded-Email';
let sandboxHome, projectsRoot, srv, base, runs, project, projectDir;
const extraDirs = [];
const prevEnv = {};
const JSONH = { 'Content-Type': 'application/json' };
const get = (p) => fetch(`${base}${p}`);
const send = (method, p, b, who) => fetch(`${base}${p}`, { method, headers: { ...JSONH, ...(who ? { [H]: who } : {}) }, body: b === undefined ? undefined : JSON.stringify(b) });
const post = (p, b, who) => send('POST', p, b ?? {}, who);
const DAY = () => new Date(Date.now() + 86400000).toISOString();

before(async () => {
  sandboxHome = await mkdtemp(join(tmpdir(), 'worca-cc-presets-home-'));
  projectsRoot = await mkdtemp(join(tmpdir(), 'worca-cc-presets-proot-'));
  for (const k of ['HOME', 'USERPROFILE', 'WORCA_TEST_ALLOW_HOME_FALLBACK', 'WORCA_PROJECTS_ROOT', 'WORCA_MOCK', 'WORCA_IDENTITY_HEADER']) prevEnv[k] = process.env[k];
  process.env.HOME = sandboxHome; process.env.USERPROFILE = sandboxHome;
  process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = '1';
  process.env.WORCA_PROJECTS_ROOT = projectsRoot;
  process.env.WORCA_MOCK = '1';
  process.env.WORCA_IDENTITY_HEADER = H;   // a request without the header is the local install (sees every preset)
  process.env.WORCA_IDENTITY_TRUSTED_PROXIES = '127.0.0.1,::1';   // X1: the in-process server's callers are loopback
  const mod = await import('../ui/server.mjs');
  ({ runs } = mod);
  srv = mod.server;
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
  const { addProject } = await import('../src/core/projects.mjs');
  projectDir = gitDir('presetsapi');
  project = (await addProject({ name: 'presetsapi', path: projectDir })).find((p) => p.name === 'presetsapi');
});
after(async () => {
  if (srv) await Promise.race([
    new Promise((r) => { srv.close(r); srv.closeAllConnections?.(); }),
    new Promise((r) => { const t = setTimeout(r, 500); t.unref?.(); }),
  ]);
  for (const k of Object.keys(prevEnv)) { if (prevEnv[k] === undefined) delete process.env[k]; else process.env[k] = prevEnv[k]; }
  await rm(sandboxHome, { recursive: true, force: true, maxRetries: 10 });
  await rm(projectsRoot, { recursive: true, force: true, maxRetries: 10 });
  for (const d of [projectDir, ...extraDirs]) if (d) await rm(d, { recursive: true, force: true, maxRetries: 10 });
});

test('CRUD: create, list, duplicate, rename, delete', async () => {
  const c = await post('/api/presets', { name: 'Quick fix', setup: { workflowId: 'wf_default' }, basis: { projectDir: project.path } });
  assert.equal(c.status, 201, await c.clone().text());
  const { preset } = await c.json();
  const list = await (await get('/api/presets')).json();
  assert.equal(list.presets.length, 1);
  assert.equal(list.presets[0].id, preset.id);
  const d = await post(`/api/presets/${preset.id}/duplicate`, {});
  assert.equal(d.status, 201);
  const copy = (await d.json()).preset;
  assert.equal(copy.name, 'Quick fix (copy)');
  const u = await send('PUT', `/api/presets/${copy.id}`, { name: 'Renamed' });
  assert.equal(u.status, 200);
  assert.equal((await u.json()).preset.name, 'Renamed');
  assert.equal((await send('PUT', `/api/presets/${copy.id}`, { name: 'quick FIX' })).status, 409, 'names are unique ignoring case');
  for (const p of [preset, copy]) assert.equal((await send('DELETE', `/api/presets/${p.id}`)).status, 200);
  assert.equal((await post(`/api/presets/${preset.id}/check`, { projectDir: project.path })).status, 404);
});

test('a stored setup never holds a consent, and a setup over 32 KB is a 400', async () => {
  const r = await post('/api/presets', { name: 'Consent', setup: { workflowId: 'wf_default', allowUnguardedEngine: true, prompt: 'p' }, basis: { projectDir: project.path } });
  assert.equal(r.status, 201);
  const { preset } = await r.json();
  assert.equal('allowUnguardedEngine' in preset.setup, false);
  assert.equal('prompt' in preset.setup, false);
  const big = await post('/api/presets', { name: 'Big', setup: { tags: ['x'.repeat(40000)] }, basis: { projectDir: project.path } });
  assert.equal(big.status, 400);
  assert.match((await big.json()).error, /setup too large/);
});

test('a preset run with only a prompt sends the hand-made body plus the run-only lane, and writes no config', { timeout: 120000 }, async () => {
  const cfgBefore = (await (await get(`/api/config?projectDir=${encodeURIComponent(project.path)}`)).json()).config;
  const hand = { projectDir: project.path, workflowId: 'wf_default', guardrailsId: 'normal', nightMode: true, mock: true, prompt: 'fix it', scheduledFor: DAY() };
  const created = await (await post('/api/presets', { name: 'Quick fix', scope: { kind: 'project', projectDir: project.path },
    setup: { ...hand, overlay: { nodes: { n_plan: { model: 'claude-haiku-4-5', effort: 'medium' } } }, humanInLoop: false }, basis: { projectDir: project.path } })).json();
  const preset = created.preset;
  assert.equal(preset.setup.overlay.nodes.n_plan.model, 'claude-haiku-4-5');
  assert.ok(Object.keys(preset.setup.overlay.nodes).length >= 4, 'full picks: every agent node of wf_default');
  for (const k of ['prompt', 'scheduledFor', 'title']) assert.equal(k in preset.setup, false, k);

  // What the New run form sends after a pick: the hand-made keys + overlay + humanInLoop + presetId.
  const fromPreset = { ...hand, overlay: preset.setup.overlay, humanInLoop: preset.setup.humanInLoop, presetId: preset.id };
  const ra0 = await post('/api/run', hand);
  const a = await ra0.json();
  assert.equal(ra0.status, 202, JSON.stringify(a));
  const rb0 = await post('/api/run', fromPreset);
  const b = await rb0.json();
  assert.equal(rb0.status, 202, JSON.stringify(b));
  const { getTicket } = await import('../src/core/scheduler.mjs');
  const ra = getTicket(a.runId, { withRequest: true }).request;
  const rb = getTicket(b.runId, { withRequest: true }).request;
  const strip = ({ overlay, humanInLoop, presetId, internal, ...rest }) => rest;
  assert.deepEqual(strip(rb), strip(ra));
  assert.equal(rb.presetId, undefined, 'the link lives in preset_id, never in the stored request');
  assert.equal(getTicket(b.runId).presetId, preset.id, 'slice 3: the ticket follows the preset');
  assert.equal(rb.overlay.nodes.n_plan.model, 'claude-haiku-4-5');

  const cfgAfter = (await (await get(`/api/config?projectDir=${encodeURIComponent(project.path)}`)).json()).config;
  assert.deepEqual(cfgAfter, cfgBefore, 'Agents rows, active workflow and human-in-the-loop unchanged');
});

test('a preset whose guardrail set or model is gone is refused with named items', async () => {
  const gr = await (await post('/api/guardrails', { name: 'Tight', settings: {} })).json();
  const { preset } = await (await post('/api/presets', { name: 'Tight run', setup: { workflowId: 'wf_default', guardrailsId: gr.guardrails.id,
    overlay: { nodes: { n_plan: { model: 'claude-haiku-4-5' } } } }, basis: { projectDir: project.path } })).json();
  await fetch(`${base}/api/guardrails/${gr.guardrails.id}`, { method: 'DELETE' });
  const check = await (await post(`/api/presets/${preset.id}/check`, { projectDir: project.path })).json();
  assert.deepEqual(check.broken.map((b) => b.message), [`Guardrail set ${gr.guardrails.id} no longer exists`]);

  const r = await post('/api/run', { projectDir: project.path, prompt: 'x', presetId: preset.id, workflowId: 'wf_default', guardrailsId: gr.guardrails.id,
    overlay: { nodes: { n_plan: { model: 'my-gateway-opus' } } } });
  assert.equal(r.status, 409);
  const j = await r.json();
  assert.equal(j.code, 'preset-broken');
  assert.deepEqual(j.broken.map((b) => b.message), [`Guardrail set ${gr.guardrails.id} no longer exists`, 'Planner: model my-gateway-opus is no longer in the catalog']);
  assert.equal([...runs.values()].some((e) => e.prompt === 'x'), false, 'no run registered');
});

test('a malformed overlay with a presetId is the overlay\'s 400, not a 500', async () => {
  const { preset } = await (await post('/api/presets', { name: 'Shape', setup: { workflowId: 'wf_default' }, basis: { projectDir: project.path } })).json();
  const r = await post('/api/run', { projectDir: project.path, prompt: 'y', presetId: preset.id, overlay: { nodes: { n_plan: 5 } } });
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /overlay\.nodes\.n_plan must be an object/);
});

test('a gone workflow is named; a pinned project removed from worca is named with no Reset; pins and scopes are checked', async () => {
  const { writeGraphWorkflow, deleteWorkflow } = await import('../src/core/workflows.mjs');
  const { addProject, removeProject } = await import('../src/core/projects.mjs');
  const { id: wfId } = await writeGraphWorkflow({
    id: 'wf_x', name: 'Preset X', domain: 'coding',
    nodes: [{ id: 'n_task', kind: 'task', x: 0, y: 0, config: {} }, { id: 'n_impl', kind: 'agent', key: 'implementer', x: 300, y: 0, config: {} },
      { id: 'n_end', kind: 'end', x: 600, y: 0, config: {} }],
    wires: [{ id: 'w1', from: { node: 'n_task', port: 'task' }, to: { node: 'n_impl', port: 'plan' } },
      { id: 'w2', from: { node: 'n_impl', port: 'done' }, to: { node: 'n_end', port: 'result' } }],
  });
  const wfPreset = (await (await post('/api/presets', { name: 'On X', setup: { workflowId: wfId }, basis: { projectDir: project.path } })).json()).preset;
  await deleteWorkflow(wfId);
  const wfCheck = await (await post(`/api/presets/${wfPreset.id}/check`, { projectDir: project.path })).json();
  assert.deepEqual(wfCheck.broken.map((b) => b.message), [`Workflow ${wfId} no longer exists`]);

  const otherDir = gitDir('presetsother');
  extraDirs.push(otherDir);
  await addProject({ name: 'presetsother', path: otherDir });
  const pinned = (await (await post('/api/presets', { name: 'Pinned', scope: { kind: 'project', projectDir: otherDir },
    setup: { workflowId: 'wf_default' }, basis: { projectDir: otherDir } })).json()).preset;
  assert.equal(pinned.scope.kind, 'project');
  const wrong = await post('/api/run', { projectDir: project.path, prompt: 'z', presetId: pinned.id });
  assert.equal(wrong.status, 400);
  assert.match((await wrong.json()).error, /is pinned to project/);

  await removeProject('presetsother', { pruneWaitMs: 0 });
  const gone = await (await post(`/api/presets/${pinned.id}/check`, {})).json();
  assert.equal(gone.broken.length, 1);
  assert.equal(gone.broken[0].message, `Project ${pinned.scope.ref} is no longer registered in worca`);
  assert.equal(gone.broken[0].reset, false);

  const unknown = await post('/api/presets', { name: 'Nowhere', scope: { kind: 'project', projectDir: otherDir }, setup: {} });
  assert.equal(unknown.status, 400);
  assert.match((await unknown.json()).error, /scope names a project or workspace worca does not know/);
});

test('on a shared deployment another person\'s preset answers 404 everywhere', async () => {
  const mine = await post('/api/presets', { name: 'Ana only', setup: { workflowId: 'wf_default' }, basis: { projectDir: project.path } }, 'ana@example.com');
  assert.equal(mine.status, 201);
  const { preset } = await mine.json();
  assert.equal(preset.createdBy, 'ana@example.com');
  const bo = 'bo@example.com';
  assert.equal((await (await send('GET', '/api/presets', undefined, bo)).json()).presets.length, 0);
  assert.equal((await post(`/api/presets/${preset.id}/check`, { projectDir: project.path }, bo)).status, 404);
  assert.equal((await send('PUT', `/api/presets/${preset.id}`, { name: 'Taken' }, bo)).status, 404);
  assert.equal((await send('DELETE', `/api/presets/${preset.id}`, undefined, bo)).status, 404);
  const run = await post('/api/run', { projectDir: project.path, prompt: 'w', presetId: preset.id }, bo);
  assert.equal(run.status, 404);
  assert.match((await run.json()).error, /not found/);
  assert.equal((await post(`/api/presets/${preset.id}/check`, { projectDir: project.path }, 'ana@example.com')).status, 200);
});

const waitPipeline = async (runId, ms = 30000) => {
  const end = Date.now() + ms;
  for (;;) {
    const id = runs.get(runId)?.pipelineId;
    if (id) return id;
    if (Date.now() > end) throw new Error('no pipeline id');
    await new Promise((r) => setTimeout(r, 50));
  }
};

test('a run started before the migration returns no run setup and the save action is refused with 409', async () => {
  const { getDb } = await import('../src/core/db.mjs');
  getDb().prepare("INSERT INTO pipelines (id, project_key, target, status) VALUES ('legacy0001', ?, 'project', 'done')").run(project.key);
  const g = await get('/api/pipelines/legacy0001/setup');
  assert.equal(g.status, 200);
  assert.deepEqual((await g.json()).setup, null);
  const s = await post('/api/pipelines/legacy0001/preset', { name: 'Old run', scope: { kind: 'project' } });
  assert.equal(s.status, 409);
  const j = await s.json();
  assert.equal(j.code, 'no-run-setup');
  assert.match(j.error, /started before Worca kept run setups/);
  assert.equal((await get('/api/pipelines/nope00000/setup')).status, 404);
  assert.equal((await post('/api/pipelines/nope00000/preset', { name: 'x' })).status, 404);
});

test('a preset saved from a run equals one saved in New run from the same picks; the setup holds no task', { timeout: 120000 }, async () => {
  // n_plan is a model-only pick on purpose (D4): the checked overlay would carry effort '' for it, a New run save does not.
  const picks = { workflowId: 'wf_default', guardrailsId: 'normal', mock: true,
    overlay: { nodes: { n_plan: { model: 'claude-haiku-4-5' } } } };
  const r = await post('/api/run', { projectDir: project.path, prompt: 'keep my picks', title: 'T', featureBranch: 'feat/x', allowUnguardedEngine: true, ...picks });
  // An immediate start answers 200 { runId }; only a scheduled start (scheduledFor / repeat / after) answers 202, and it
  // creates no pipelines row, so it would store no setup.
  assert.equal(r.status, 200, await r.clone().text());
  const pid = await waitPipeline((await r.json()).runId);
  const { setup } = await (await get(`/api/pipelines/${pid}/setup`)).json();
  for (const k of ['prompt', 'title', 'featureBranch', 'allowUnguardedEngine']) assert.equal(k in setup, false, k);
  assert.ok(Object.keys(setup.overlay.nodes).length >= 4, 'full picks at start');

  const fromRun = await post(`/api/pipelines/${pid}/preset`, { name: 'From run', scope: { kind: 'project' } });
  assert.equal(fromRun.status, 201, await fromRun.clone().text());
  const byHand = await post('/api/presets', { name: 'From form', scope: { kind: 'project', projectDir: project.path }, setup: picks, basis: { projectDir: project.path } });
  assert.equal(byHand.status, 201, await byHand.clone().text());
  const a = (await fromRun.json()).preset;
  const b = (await byHand.json()).preset;
  assert.equal(a.setup.overlay.nodes.n_plan.effort, b.setup.overlay.nodes.n_plan.effort, 'no effort "" from the checked overlay');
  assert.deepEqual(a.setup, b.setup);
  assert.deepEqual(a.scope, { kind: 'project', ref: project.key });
  assert.equal((await post(`/api/pipelines/${pid}/preset`, { name: 'from RUN' })).status, 409, 'duplicate name');
});

test('on a shared deployment the preset saved from a run belongs to the person who saved it', async () => {
  const { getDb } = await import('../src/core/db.mjs');
  getDb().prepare("INSERT INTO pipelines (id, project_key, target, status, started_by, run_setup) VALUES ('shared001', ?, 'project', 'done', 'ana@example.com', ?)")
    .run(project.key, JSON.stringify({ workflowId: 'wf_default' }));
  const s = await post('/api/pipelines/shared001/preset', { name: 'Bo copy', scope: { kind: 'global' } }, 'bo@example.com');
  assert.equal(s.status, 201);
  assert.equal((await s.json()).preset.createdBy, 'bo@example.com');
  assert.equal((await (await send('GET', '/api/presets', undefined, 'ana@example.com')).json()).presets.some((p) => p.name === 'Bo copy'), false);
});
