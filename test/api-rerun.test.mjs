// test/api-rerun.test.mjs — Rerun over HTTP (docs/runs.md): rerunOf on POST /api/run (the guard, the stored link, the
// source left alone, a schedule that keeps it) and the two read routes behind the form
// (GET /api/pipelines/:id/rerun, POST .../rerun/check).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { gitDir } from './helpers/git-dir.mjs';

useTempHome(after);

let sandboxHome, projectsRoot, srv, base, runs, project, projectDir, other, otherDir, scratch, db;
const prevEnv = {};
const JSONH = { 'Content-Type': 'application/json' };
const get = (p) => fetch(`${base}${p}`);
const post = (p, b) => fetch(`${base}${p}`, { method: 'POST', headers: JSONH, body: JSON.stringify(b ?? {}) });
const DAY = () => new Date(Date.now() + 86400000).toISOString();
const rowOf = (id) => db.prepare('SELECT * FROM pipelines WHERE id = ?').get(id);
const count = () => db.prepare('SELECT COUNT(*) AS n FROM pipelines').get().n;

before(async () => {
  sandboxHome = await mkdtemp(join(tmpdir(), 'worca-cc-rerun-home-'));
  projectsRoot = await mkdtemp(join(tmpdir(), 'worca-cc-rerun-proot-'));
  scratch = await mkdtemp(join(tmpdir(), 'worca-cc-rerun-files-'));
  for (const k of ['HOME', 'USERPROFILE', 'WORCA_TEST_ALLOW_HOME_FALLBACK', 'WORCA_PROJECTS_ROOT', 'WORCA_MOCK']) prevEnv[k] = process.env[k];
  process.env.HOME = sandboxHome; process.env.USERPROFILE = sandboxHome;
  process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = '1';
  process.env.WORCA_PROJECTS_ROOT = projectsRoot;
  process.env.WORCA_MOCK = '1';
  const mod = await import('../ui/server.mjs');
  ({ runs } = mod);
  srv = mod.server;
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
  const { addProject } = await import('../src/core/projects.mjs');
  projectDir = gitDir('rerunapi');
  otherDir = gitDir('rerunother');
  project = (await addProject({ name: 'rerunapi', path: projectDir })).find((p) => p.name === 'rerunapi');
  other = (await addProject({ name: 'rerunother', path: otherDir })).find((p) => p.name === 'rerunother');
  ({ getDb: db } = await import('../src/core/db.mjs'));
  db = db();
});
after(async () => {
  if (srv) await Promise.race([
    new Promise((r) => { srv.close(r); srv.closeAllConnections?.(); }),
    new Promise((r) => { const t = setTimeout(r, 500); t.unref?.(); }),
  ]);
  for (const k of Object.keys(prevEnv)) { if (prevEnv[k] === undefined) delete process.env[k]; else process.env[k] = prevEnv[k]; }
  for (const d of [sandboxHome, projectsRoot, scratch, projectDir, otherDir]) if (d) await rm(d, { recursive: true, force: true, maxRetries: 10 });
});

/** A run row with a real run dir: createPipeline as a start would, then ended as `status`. */
async function seed({ status = 'done', setup, extras = [], title = 'Fix login', prompt = 'fix login' } = {}) {
  const { createPipeline } = await import('../src/core/artifacts.mjs');
  const files = [];
  for (const [name, text] of extras) { const f = join(scratch, name); await writeFile(f, text); files.push(f); }
  const { id } = await createPipeline(projectDir, { prompt, title, extras: files, ...(setup ? { runSetup: JSON.stringify(setup) } : {}) });
  db.prepare('UPDATE pipelines SET status = ? WHERE id = ?').run(status, id);
  return id;
}
const waitPipeline = async (runId, ms = 30000) => {
  const end = Date.now() + ms;
  for (;;) {
    const id = runs.get(runId)?.pipelineId;
    if (id) return id;
    if (Date.now() > end) throw new Error('no pipeline id');
    await new Promise((r) => setTimeout(r, 50));
  }
};
const START = () => ({ projectDir, prompt: 'again', mock: true, workflowId: 'wf_default', guardrailsId: 'normal' });

test('a start with rerunOf stores the link at insert, is not archived, and leaves the source row untouched', { timeout: 120000 }, async () => {
  const src = await seed();
  const before = rowOf(src);
  const r = await post('/api/run', { ...START(), rerunOf: src });
  assert.equal(r.status, 200, await r.clone().text());
  const runId = (await r.json()).runId;
  const id = await waitPipeline(runId);
  const row = rowOf(id);
  assert.equal(row.rerun_of, src);
  assert.deepEqual(runs.get(runId).orch.state.rerunOf, { id: src, key: project.key, title: 'Fix login', exists: true },
    'the live state carries the link, so the live run page needs no read of the saved run');
  assert.equal(row.archived_at, null);
  assert.deepEqual(rowOf(src), before, 'I2: the source row is deep-equal before and after');
  const { readPipelineStateById } = await import('../src/core/artifacts.mjs');
  assert.deepEqual(readPipelineStateById(id).rerunOf, { id: src, key: project.key, title: 'Fix login', exists: true });
  assert.equal('rerunOf' in readPipelineStateById(src), false, 'I6: the source never lists its reruns');
  assert.equal(JSON.stringify(readPipelineStateById(src)).includes(id), false);
});

test('an unknown or non-string rerunOf is a 400 and writes no row', async () => {
  const n = count();
  for (const rerunOf of ['nope0000', 42, { id: 'x' }]) {
    const r = await post('/api/run', { ...START(), rerunOf });
    assert.equal(r.status, 400, JSON.stringify(rerunOf));
    assert.equal((await r.json()).error, 'rerun-source-not-found');
  }
  assert.equal(count(), n);
});

test('a deleted source is accepted: it still has a row, and the new run reads it as gone', { timeout: 120000 }, async () => {
  const src = await seed();
  const { purgePipeline } = await import('../src/core/pipeline-delete.mjs');
  await purgePipeline({ key: project.key, id: src });
  assert.ok(rowOf(src).deleted_at);
  const r = await post('/api/run', { ...START(), rerunOf: src });
  assert.equal(r.status, 200, await r.clone().text());
  const id = await waitPipeline((await r.json()).runId);
  assert.equal(rowOf(id).rerun_of, src);
  const { resolveRerunOf } = await import('../src/core/artifacts.mjs');
  assert.deepEqual(resolveRerunOf(src), { id: src, key: null, title: null, exists: false });
});

test('a null or empty rerunOf is a plain start: no link, no refusal', { timeout: 120000 }, async () => {
  for (const rerunOf of [null, '']) {
    const r = await post('/api/run', { ...START(), rerunOf });
    assert.equal(r.status, 200, `${JSON.stringify(rerunOf)}: ${await r.clone().text()}`);
    assert.equal(rowOf(await waitPipeline((await r.json()).runId)).rerun_of, null);
  }
});

test('a scheduled request keeps rerunOf, so the fired run links back; an overlay naming an unknown model is the usual 400 with no row', async () => {
  const src = await seed();
  const s = await post('/api/run', { ...START(), rerunOf: src, scheduledFor: DAY() });
  assert.equal(s.status, 202, await s.clone().text());
  const { getTicket } = await import('../src/core/scheduler.mjs');
  assert.equal(getTicket((await s.json()).runId, { withRequest: true }).request.rerunOf, src);

  const n = count();
  const bad = await post('/api/run', { ...START(), rerunOf: src, overlay: { nodes: { n_plan: { model: 'claude-gone-9', effort: 'medium' } } } });
  assert.equal(bad.status, 400, await bad.clone().text());
  assert.match((await bad.json()).error, /claude-gone-9/);
  assert.equal(count(), n, 'I4/I5: refused at the commit point, nothing written');
});

test('a source that has not ended is a 409 at start, as on the read routes; a deleted one is still accepted', async () => {
  const n = count();
  for (const status of ['running', 'paused', 'interrupted']) {
    const r = await post('/api/run', { ...START(), rerunOf: await seed({ status }) });
    assert.equal(r.status, 409, status);
    assert.deepEqual(await r.json(), { error: 'run-not-ended', message: 'Rerun is available once the run has ended.' });
  }
  assert.equal(count(), n + 3, 'only the three seeded sources: no run was started');
});

test('a repeating schedule made from a rerun does not link its fires; a one-off one does', async () => {
  const src = await seed();
  const s = await post('/api/run', { ...START(), rerunOf: src, repeat: { rule: { freq: 'daily', time: '02:00', tz: 'UTC' } } });
  assert.ok(s.status >= 200 && s.status < 300, await s.clone().text());
  const { getTicket } = await import('../src/core/scheduler.mjs');
  const body = await s.json();
  const ticket = getTicket(body.runId || body.id, { withRequest: true });
  assert.ok(ticket, JSON.stringify(body));
  assert.equal('rerunOf' in ticket.request, false);
});

const GOOD_SETUP = { workflowId: 'wf_default', guardrailsId: 'normal', mock: true, nightMode: true, tags: ['t1'] };

test('GET /rerun answers the task, target, settings, files and nothing broken for a healthy ended run', async () => {
  const id = await seed({ setup: GOOD_SETUP, extras: [['spec.md', 'hello']] });
  const r = await get(`/api/pipelines/${id}/rerun`);
  assert.equal(r.status, 200, await r.clone().text());
  const j = await r.json();
  assert.equal(j.prompt, 'fix login');
  assert.equal(j.title, 'Fix login');
  assert.deepEqual(j.target, { kind: 'project', ref: project.key, projectDir: project.path, workspaceId: null });
  assert.equal(j.setup.workflowId, 'wf_default');
  assert.equal(j.setup.mock, true);
  assert.deepEqual(j.broken, []);
  assert.deepEqual(j.extras, [{ name: 'spec.md', available: true }]);
  assert.equal(j.extrasLost, false);
});

test('GET /rerun: 404 for an unknown or deleted run, 409 until the run has ended', async () => {
  assert.equal((await get('/api/pipelines/nope0000/rerun')).status, 404);
  assert.equal((await post('/api/pipelines/nope0000/rerun/check', { projectDir })).status, 404);
  const gone = await seed();
  const { purgePipeline } = await import('../src/core/pipeline-delete.mjs');
  await purgePipeline({ key: project.key, id: gone });
  assert.equal((await get(`/api/pipelines/${gone}/rerun`)).status, 404);
  for (const status of ['running', 'paused', 'interrupted', 'created']) {
    const id = await seed({ status });
    const r = await get(`/api/pipelines/${id}/rerun`);
    assert.equal(r.status, 409, status);
    assert.deepEqual(await r.json(), { error: 'run-not-ended', message: 'Rerun is available once the run has ended.' });
    assert.equal((await post(`/api/pipelines/${id}/rerun/check`, { projectDir })).status, 409, `${status} check`);
  }
  for (const status of ['done', 'stopped', 'error']) assert.equal((await get(`/api/pipelines/${await seed({ status })}/rerun`)).status, 200, status);
});

test('a file deleted from the run folder is listed as unavailable', async () => {
  const id = await seed({ extras: [['keep.md', 'k'], ['lost.md', 'l']] });
  const { runDirForRow } = await import('../src/core/artifacts.mjs');
  await unlink(join(await runDirForRow(rowOf(id)), 'extras', 'lost.md'));
  const j = await (await get(`/api/pipelines/${id}/rerun`)).json();
  assert.deepEqual(j.extras, [{ name: 'keep.md', available: true }, { name: 'lost.md', available: false }]);
});

test('two attachments with one file name share one extras file and are listed once', async () => {
  const { createPipeline } = await import('../src/core/artifacts.mjs');
  const { mkdir } = await import('node:fs/promises');
  const files = [];
  for (const d of ['a', 'b']) { await mkdir(join(scratch, d), { recursive: true }); const f = join(scratch, d, 'spec.md'); await writeFile(f, d); files.push(f); }
  const { id } = await createPipeline(projectDir, { prompt: 'p', title: 't', extras: files });
  db.prepare("UPDATE pipelines SET status = 'done' WHERE id = ?").run(id);
  assert.equal(rowOf(id).extras_names, '["spec.md"]');
  assert.deepEqual((await (await get(`/api/pipelines/${id}/rerun`)).json()).extras, [{ name: 'spec.md', available: true }]);
});

test('an archived run lists its recorded files as unavailable; one archived before extras_names exists says extrasLost', async () => {
  const { archivePipeline } = await import('../src/core/pipeline-delete.mjs');
  const a = await seed({ extras: [['a.md', 'a'], ['b.md', 'b']] });
  await archivePipeline({ key: project.key, id: a });
  const ja = await (await get(`/api/pipelines/${a}/rerun`)).json();
  assert.deepEqual(ja.extras, [{ name: 'a.md', available: false }, { name: 'b.md', available: false }]);
  assert.equal(ja.extrasLost, false);

  const old = await seed({ extras: [['c.md', 'c']] });
  db.prepare('UPDATE pipelines SET extras_names = NULL WHERE id = ?').run(old);
  await archivePipeline({ key: project.key, id: old });
  const jo = await (await get(`/api/pipelines/${old}/rerun`)).json();
  assert.deepEqual(jo.extras, []);
  assert.equal(jo.extrasLost, true);

  const none = await seed();
  await archivePipeline({ key: project.key, id: none });
  assert.equal((await (await get(`/api/pipelines/${none}/rerun`)).json()).extrasLost, false, 'a run that had no files lost none');
});

test('a setting that is gone shows as a broken item; no recorded setup passes through as null', async () => {
  const id = await seed({ setup: { ...GOOD_SETUP, overlay: { nodes: { n_plan: { model: 'claude-gone-9', effort: 'medium' } } } } });
  const j = await (await get(`/api/pipelines/${id}/rerun`)).json();
  assert.equal(j.broken.length, 1, JSON.stringify(j.broken));
  assert.equal(j.broken[0].item, 'model');
  assert.equal(j.broken[0].ref, 'n_plan');
  assert.equal(j.broken[0].reset, true);

  const bare = await (await get(`/api/pipelines/${await seed()}/rerun`)).json();
  assert.equal(bare.setup, null);
  assert.deepEqual(bare.broken, []);

  // The form holds none of the run's picks (a preset replaced them): targetOnly judges the target alone.
  const held = await (await post(`/api/pipelines/${id}/rerun/check`, { projectDir })).json();
  assert.equal(held.broken.length, 1);
  assert.deepEqual((await (await post(`/api/pipelines/${id}/rerun/check`, { projectDir, targetOnly: true })).json()).broken, []);
});

test('a project that is no longer registered leaves the target empty and is a project item that cannot be reset', async () => {
  const id = await seed({ setup: GOOD_SETUP });
  db.prepare('UPDATE pipelines SET project_key = ? WHERE id = ?').run('vanished-00000000', id);
  const j = await (await get(`/api/pipelines/${id}/rerun`)).json();
  assert.equal(j.target.projectDir, null);
  assert.equal(j.target.kind, 'project');
  assert.deepEqual(j.broken.map((b) => [b.item, b.reset]), [['project', false]]);
});

test('POST /rerun/check re-judges the settings against another project', async () => {
  const id = await seed({ setup: { ...GOOD_SETUP, overlay: { nodes: { n_plan: { model: 'claude-gone-9', effort: 'medium' } } } } });
  const r = await post(`/api/pipelines/${id}/rerun/check`, { projectDir: other.path });
  assert.equal(r.status, 200, await r.clone().text());
  assert.equal((await r.json()).broken[0].item, 'model');
  const ok = await seed({ setup: GOOD_SETUP });
  assert.deepEqual(await (await post(`/api/pipelines/${ok}/rerun/check`, { projectDir: other.path })).json(), { broken: [] });
  assert.equal((await post(`/api/pipelines/${ok}/rerun/check`, { projectDir: '/nowhere/at/all' })).status, 400);
});

test('a No-project run is a none target, judged with no project; its check and a start on No project keep the link', { timeout: 120000 }, async () => {
  const { NO_PROJECT_KEY } = await import('../src/core/store.mjs');
  const id = await seed({ setup: GOOD_SETUP });
  db.prepare('UPDATE pipelines SET project_key = ? WHERE id = ?').run(NO_PROJECT_KEY, id);
  const j = await (await get(`/api/pipelines/${id}/rerun`)).json();
  assert.deepEqual(j.target, { kind: 'none', ref: null, projectDir: null, workspaceId: null });
  assert.deepEqual(j.broken, []);
  const bare = await seed();
  db.prepare('UPDATE pipelines SET project_key = ? WHERE id = ?').run(NO_PROJECT_KEY, bare);
  assert.deepEqual((await (await get(`/api/pipelines/${bare}/rerun`)).json()).broken, [], 'no recorded setup and no project: nothing to refuse');

  const c = await post(`/api/pipelines/${id}/rerun/check`, { noProject: true });
  assert.equal(c.status, 200, await c.clone().text());
  assert.deepEqual(await c.json(), { broken: [] });
  assert.equal((await post(`/api/pipelines/${id}/rerun/check`, { projectDir: '' })).status, 400, 'an empty projectDir is still no target');

  const r = await post('/api/run', { noProject: true, prompt: 'again', mock: true, workflowId: 'wf_default', guardrailsId: 'normal', rerunOf: id });
  assert.equal(r.status, 200, await r.clone().text());
  const newId = await waitPipeline((await r.json()).runId);
  for (let i = 0; i < 200 && !rowOf(newId); i++) await new Promise((res) => setTimeout(res, 50));   // the No-project entry exists before its row
  assert.equal(rowOf(newId).rerun_of, id);
  // A No-project start keeps its setup as the other arms do (a global one: no branch keys), so its own Rerun copies it.
  const kept = JSON.parse(rowOf(newId).run_setup || 'null');
  assert.ok(kept, 'a No-project run records its setup');
  assert.deepEqual([kept.workflowId, kept.guardrailsId, kept.mock], ['wf_default', 'normal', true]);
  assert.equal(kept.sourceBranch, undefined);
});

test('no recorded setup: the workflow and guardrail set the run recorded elsewhere come back, the gone ones are named', async () => {
  const rec = await seed();
  db.prepare('UPDATE pipelines SET stepper = ?, guardrails_id = ? WHERE id = ?')
    .run(JSON.stringify({ version: 2, template: { id: 'wf_default', name: 'Default' } }), 'normal', rec);
  const j = await (await get(`/api/pipelines/${rec}/rerun`)).json();
  assert.equal(j.setup, null);
  assert.deepEqual([j.recovered, j.lost], [{ workflowId: 'wf_default', guardrailsId: 'normal' }, []]);

  const gone = await seed();
  db.prepare('UPDATE pipelines SET stepper = ?, guardrails_id = ? WHERE id = ?')
    .run(JSON.stringify({ version: 2, template: { id: 'wf_gone-check', name: 'Old check' } }), 'gone-set', gone);
  const g = await (await get(`/api/pipelines/${gone}/rerun`)).json();
  assert.deepEqual([g.recovered, g.lost], [{}, ['workflow "Old check"', 'guardrails "gone-set"']]);

  const recorded = await (await get(`/api/pipelines/${await seed({ setup: GOOD_SETUP })}/rerun`)).json();
  assert.equal(recorded.recovered, undefined, 'a recorded setup needs no fallback');
});

test('resolveRerunOf: a rerun of a rerun names its direct source; an archived source still exists; no id is no link', async () => {
  const { resolveRerunOf, readPipelineStateById } = await import('../src/core/artifacts.mjs');
  const { archivePipeline } = await import('../src/core/pipeline-delete.mjs');
  const first = await seed({ title: 'First' });
  const second = await seed({ title: 'Second' });
  db.prepare('UPDATE pipelines SET rerun_of = ? WHERE id = ?').run(first, second);
  const third = await seed({ title: 'Third' });
  db.prepare('UPDATE pipelines SET rerun_of = ? WHERE id = ?').run(second, third);
  assert.deepEqual(readPipelineStateById(third).rerunOf, { id: second, key: project.key, title: 'Second', exists: true }, 'A-4: the direct source');
  assert.equal(readPipelineStateById(first).rerunOf, undefined);
  await archivePipeline({ key: project.key, id: second });
  assert.equal(resolveRerunOf(second).exists, true, 'an archived source still opens');
  assert.equal(resolveRerunOf(null), null);
  assert.equal(resolveRerunOf('nope0000').exists, false);
});

test('workflow tests: a test try is not rerun as a run, on the read routes or at start, and no row is written', async () => {
  const src = await seed();
  db.prepare('UPDATE pipelines SET is_test = 1 WHERE id = ?').run(src);
  const { RERUN_TEST_TRY } = await import('../src/shared/run-rerun.mjs');
  const read = await fetch(`${base}/api/pipelines/${src}/rerun`);
  assert.equal(read.status, 409);
  assert.deepEqual(await read.json(), { error: 'rerun-test-try', message: RERUN_TEST_TRY });
  const n = count();
  const start = await post('/api/run', { ...START(), rerunOf: src });
  assert.equal(start.status, 409);
  assert.equal((await start.json()).error, 'rerun-test-try');
  assert.equal(count(), n, 'no run was started from it');
});

