// test/api-memory-defrag-model.test.mjs — Settings › Memory's defragment model over HTTP: the
// settings round trip (and the root it must leave alone), the workflow view New pipeline and an
// Ask card read, the health card's model, and a Memory-button defragment that runs on the setting.
// settings.json lives under HOME, so HOME is sandboxed and the test runner's HOME guard lifted.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { gitDir } from './helpers/git-dir.mjs';
import { memoryRoot, projectScope, writeMemory, readScopeState } from '../src/core/memory-store.mjs';
import { GRAPH_MEMORY_DEFRAG_WORKFLOW } from '../src/core/graph/builtin-workflows.mjs';

useTempHome(after);   // outer isolation: the mock run below finishes ASYNC in-process

let sandboxHome, projectsRoot, srv, base, runs, project;
const prevEnv = {};
const JSONH = { 'Content-Type': 'application/json' };
const get = (p) => fetch(`${base}${p}`);
const post = (p, b) => fetch(`${base}${p}`, { method: 'POST', headers: JSONH, body: JSON.stringify(b ?? {}) });
const settingsFile = () => join(sandboxHome, '.worca-cc', 'settings.json');
const readSettingsJson = async () => JSON.parse(await readFile(settingsFile(), 'utf8'));
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
/** The runs-Map status flips BEFORE the final sync stamps the scope — wait for the stamp, or the
 *  after hook restores the env under a still-running write (test/api-memory.test.mjs). */
async function untilStamped(scope, pipelineId, ms = 30000) {
  const t0 = Date.now();
  for (;;) {
    if ((await readScopeState(memoryRoot(), scope)).lastDefragRunId === pipelineId) return;
    if (Date.now() - t0 > ms) throw new Error(`scope never stamped by ${pipelineId}`);
    await new Promise((r) => setTimeout(r, 50));
  }
}

before(async () => {
  sandboxHome = await mkdtemp(join(tmpdir(), 'worca-cc-dmodel-home-'));
  projectsRoot = await mkdtemp(join(tmpdir(), 'worca-cc-dmodel-proot-'));
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
  const dir = gitDir('dmodelapi');
  project = (await addProject({ name: 'dmodelapi', path: dir })).find((p) => p.name === 'dmodelapi');
});
after(async () => {
  if (srv) await Promise.race([
    new Promise((r) => { srv.close(r); srv.closeAllConnections?.(); }),
    new Promise((r) => { const t = setTimeout(r, 500); t.unref?.(); }),
  ]);
  for (const k of Object.keys(prevEnv)) { if (prevEnv[k] === undefined) delete process.env[k]; else process.env[k] = prevEnv[k]; }
  await rm(sandboxHome, { recursive: true, force: true });
  await rm(projectsRoot, { recursive: true, force: true });
});

test('POST /api/settings memoryDefrag: round trip through GET and settings.json; a memoryDefrag-only save leaves the root intact', async () => {
  const root = await mkdtemp(join(tmpdir(), 'worca-cc-dmodel-root-'));
  try {
    assert.equal((await (await post('/api/settings', { root })).json()).root, root);
    let r = await post('/api/settings', { memoryDefrag: { model: 'CLAUDE-OPUS-5-5', effort: 'high' } });
    let j = await r.json();
    assert.equal(r.status, 200, JSON.stringify(j));
    assert.equal(j.root, root, 'a memoryDefrag-only POST must not clear the projects root (the legacy fallback)');
    assert.deepEqual(j.memoryDefrag, { model: 'claude-opus-5-5', effort: 'high' }, 'stored in the catalog\'s casing');
    assert.equal(j.memoryDefragDefault, 'claude-sonnet-5');
    assert.deepEqual((await readSettingsJson()).memory, { defrag: { model: 'claude-opus-5-5', effort: 'high' } });
    j = await (await get('/api/settings')).json();
    assert.deepEqual(j.memoryDefrag, { model: 'claude-opus-5-5', effort: 'high' });
    // Refusals change nothing on disk.
    for (const [bad, re] of [
      [{ model: 'gone-model' }, /unknown model "gone-model"/],
      [{ model: 'claude-haiku-4-5', effort: 'max' }, /does not offer effort "max"/],
      [{ model: '', effort: 'high' }, /effort needs a model/],
      ['claude-opus-5-5', /must be \{ model, effort \}/],
    ]) {
      r = await post('/api/settings', { memoryDefrag: bad });
      assert.equal(r.status, 400, JSON.stringify(bad));
      assert.match((await r.json()).error, re);
    }
    assert.deepEqual((await readSettingsJson()).memory, { defrag: { model: 'claude-opus-5-5', effort: 'high' } });
    j = await (await post('/api/settings', { memoryDefrag: null })).json();
    assert.deepEqual(j.memoryDefrag, { model: null, effort: null });
    assert.equal('memory' in (await readSettingsJson()), false, 'cleared tidily');
    assert.equal(j.root, root, 'and the root is still intact');
  } finally {
    await post('/api/settings', { root: '' });
    await rm(root, { recursive: true, force: true });
  }
});

test('GET /api/workflows/wf_memory_defrag pins the setting for New pipeline and an Ask card; a stale setting pins nothing', async () => {
  await post('/api/settings', { memoryDefrag: { model: 'claude-opus-5-5', effort: 'high' } });
  try {
    let wf = await (await get('/api/workflows/wf_memory_defrag')).json();
    assert.deepEqual(wf.pinnedAgentModel, { model: 'claude-opus-5-5', effort: 'high', source: 'settings' });
    assert.deepEqual(wf.nodes, JSON.parse(JSON.stringify(GRAPH_MEMORY_DEFRAG_WORKFLOW.nodes)), 'the topology is the built-in\'s own');
    assert.equal('pinnedAgentModel' in (await (await get('/api/workflows/wf_default')).json()), false, 'only the defragment built-in');
    // A model removed from the catalog since it was saved: nothing to pin (the run degrades too).
    await mkdir(join(sandboxHome, '.worca-cc'), { recursive: true });
    await writeFile(settingsFile(), JSON.stringify({ memory: { defrag: { model: 'gone-model' } } }));
    wf = await (await get('/api/workflows/wf_memory_defrag')).json();
    assert.equal('pinnedAgentModel' in wf, false);
  } finally { await post('/api/settings', { memoryDefrag: null }); }
  assert.equal('pinnedAgentModel' in (await (await get('/api/workflows/wf_memory_defrag')).json()), false, 'unset: nothing pinned');
});

test('the memory report carries the defragment model for the health card (label, effort, stale)', async () => {
  assert.equal((await (await get('/api/memory/global')).json()).defragModel, null, 'unset');
  await post('/api/settings', { memoryDefrag: { model: 'claude-opus-5-5', effort: 'high' } });
  try {
    assert.deepEqual((await (await get('/api/memory/global')).json()).defragModel, { model: 'claude-opus-5-5', effort: 'high', label: 'Opus 5.5', stale: false });
    assert.deepEqual((await (await get(`/api/memory/projects/${project.key}`)).json()).defragModel.model, 'claude-opus-5-5');
    await writeFile(settingsFile(), JSON.stringify({ memory: { defrag: { model: 'gone-model' } } }));
    assert.deepEqual((await (await get('/api/memory/global')).json()).defragModel, { model: 'gone-model', effort: null, label: 'gone-model', stale: true });
  } finally { await post('/api/settings', { memoryDefrag: null }); }
});

test('the Memory view\'s Defragment button starts a run on the Settings › Memory pair', { timeout: 120000 }, async () => {
  await post('/api/settings', { memoryDefrag: { model: 'claude-haiku-4-5', effort: 'high' } });
  try {
    await writeMemory(memoryRoot(), projectScope(project.key), 'first', 'First rule.\n', { source: 'user' });
    await writeMemory(memoryRoot(), projectScope(project.key), 'second', 'Second rule.\n', { source: 'user' });
    const r = await post(`/api/memory/projects/${project.key}/defragment`);
    const raw = await r.text();
    assert.equal(r.status, 200, raw);
    const { runId } = JSON.parse(raw);
    const entry = runs.get(runId);
    const done = await untilSettled(runId);
    assert.equal(done.status, 'done', JSON.stringify({ status: done.status, detail: done.pauseDetail }));
    await untilStamped(projectScope(project.key), entry.pipelineId);
    const node = entry.orch.getState().stepper.graph.nodes.find((n) => n.id === 'n_defrag');
    assert.deepEqual([node.model, node.effort], ['claude-haiku-4-5', 'high'], 'the wrapper sends no pair; the run resolved the setting');
  } finally { await post('/api/settings', { memoryDefrag: null }); }
});

test('POST /api/run: a pair named at the start of a defragment run beats the setting; a bad pair is a 400; an ordinary run still ignores a body model', { timeout: 180000 }, async () => {
  await post('/api/settings', { memoryDefrag: { model: 'claude-haiku-4-5', effort: 'high' } });
  try {
    const body = { projectDir: project.path, workflowId: 'wf_memory_defrag', memoryScope: 'project', guardrailsId: 'normal', prompt: 'Defragment the memory of project dmodelapi.' };
    for (const [extra, re] of [
      [{ model: 'gone-model' }, /unknown model "gone-model"/],
      [{ model: 'claude-haiku-4-5', effort: 'max' }, /claude-haiku-4-5 does not offer effort "max"/],
      [{ effort: 'high' }, /effort needs a model/],
      [{ model: 42 }, /catalog model id/],
    ]) {
      const r = await post('/api/run', { ...body, ...extra });
      assert.equal(r.status, 400, JSON.stringify(extra));
      assert.match((await r.json()).error, re);
    }
    const r = await post('/api/run', { ...body, model: 'CLAUDE-OPUS-5-5', effort: 'medium' });
    const raw = await r.text();
    assert.equal(r.status, 200, raw);
    const { runId } = JSON.parse(raw);
    const entry = runs.get(runId);
    const done = await untilSettled(runId);
    assert.equal(done.status, 'done', JSON.stringify({ status: done.status, detail: done.pauseDetail }));
    await untilStamped(projectScope(project.key), entry.pipelineId);
    const node = entry.orch.getState().stepper.graph.nodes.find((n) => n.id === 'n_defrag');
    assert.deepEqual([node.model, node.effort], ['claude-opus-5-5', 'medium'], 'the pair named at start, in the catalog\'s casing — not the setting');
    // Every other workflow picks its models per node: a body model there is not even parsed, as before
    // (scheduled a day out, so no run starts — a defragment run would 400 on this model).
    const o = await post('/api/run', { projectDir: project.path, workflowId: 'wf_default', prompt: 'demo task', model: 42, effort: 'max', scheduledFor: new Date(Date.now() + 86400000).toISOString() });
    assert.equal(o.status, 202, await o.text());
  } finally { await post('/api/settings', { memoryDefrag: null }); }
});

test('POST /api/run: a SCHEDULED defragment run stores its start pair as checked — the catalog\'s casing, trimmed', async () => {
  const { getTicket } = await import('../src/core/scheduler.mjs');
  const r = await post('/api/run', { projectDir: project.path, workflowId: 'wf_memory_defrag', memoryScope: 'project', guardrailsId: 'normal', prompt: 'Defragment.', model: ' CLAUDE-OPUS-5-5 ', effort: ' high ', scheduledFor: new Date(Date.now() + 86400000).toISOString() });
  const j = await r.json();
  assert.equal(r.status, 202, JSON.stringify(j));
  const { request } = getTicket(j.runId, { withRequest: true });
  assert.deepEqual([request.model, request.effort], ['claude-opus-5-5', 'high'], 'the ticket fires verbatim, so it must store the checked pair');
});
