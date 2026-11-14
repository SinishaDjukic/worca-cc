// test/api-run-pr-auto.test.mjs — "open a PR when a run finishes" over HTTP: the decision a run saves at its start,
// a refused body, schedules, GET /api/run-defaults, GET /api/pipelines/:id/pr-auto, and the server's afterRunSettled step.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { gitDir } from './helpers/git-dir.mjs';
import { withEnv } from './helpers/with-env.mjs';
import { NO_ADO, REMOTES_V, okRun } from './helpers/ship-world.mjs';

useTempHome(after);
let sandboxHome, srv, base, runs, mod, projectDir, wsId, K;
const prevEnv = {};
const JSONH = { 'Content-Type': 'application/json' };
const post = (p, b) => fetch(`${base}${p}`, { method: 'POST', headers: JSONH, body: JSON.stringify(b ?? {}) });
const get = async (p) => { const r = await fetch(`${base}${p}`); return { status: r.status, body: await r.json() }; };
const patch = async (p, b) => { const r = await fetch(`${base}${p}`, { method: 'PATCH', headers: JSONH, body: JSON.stringify(b) }); return { status: r.status, body: await r.json() }; };
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
const row = (id) => K.getDb().prepare('SELECT pr_auto FROM pipelines WHERE id = ?').get(id);
const prAutoOf = (id) => JSON.parse(row(id).pr_auto);
const BODY = (extra = {}) => ({ projectDir, prompt: 'demo task', mock: true, guardrailsId: 'normal', humanInLoop: false, ...extra });
async function startRun(extra) {
  const r = await post('/api/run', BODY(extra));
  assert.equal(r.status, 200, await r.clone().text());
  const { runId } = await r.json();
  const e = runs.get(runId);
  const t0 = Date.now();
  while (!e.orch.getState().id && Date.now() - t0 < 10000) await new Promise((x) => setTimeout(x, 20));
  return { runId, id: e.orch.getState().id };
}
async function startAndStop(extra) {
  const r = await startRun(extra);
  await post('/api/stop', { runId: r.runId });
  await untilSettled(r.runId);
  return r.id;
}

before(async () => {
  sandboxHome = await mkdtemp(join(tmpdir(), 'worca-cc-prauto-home-'));
  for (const k of ['HOME', 'USERPROFILE', 'WORCA_TEST_ALLOW_HOME_FALLBACK', 'WORCA_MOCK']) prevEnv[k] = process.env[k];
  process.env.HOME = sandboxHome; process.env.USERPROFILE = sandboxHome;
  process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = '1';
  process.env.WORCA_MOCK = '1';
  mod = await import('../ui/server.mjs');
  ({ runs } = mod);
  srv = mod.server;
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
  const { addProject } = await import('../src/core/projects.mjs');
  K = { ...(await import('../src/core/db.mjs')), ...(await import('../src/core/settings-cascade.mjs')), ...(await import('../src/core/artifacts.mjs')),
    ...(await import('../src/core/scheduler.mjs')), ...(await import('../src/core/workspaces.mjs')), ...(await import('../src/core/store.mjs')) };
  projectDir = gitDir('prauto');
  await addProject({ name: 'prauto', path: projectDir });
  const other = gitDir('prauto-b');
  await addProject({ name: 'prauto-b', path: other });
  wsId = (await K.createWorkspace({ name: 'PR auto', projectPaths: [projectDir, other] })).id;
});
after(async () => {
  if (srv) await Promise.race([
    new Promise((r) => { srv.close(r); srv.closeAllConnections?.(); }),
    new Promise((r) => { const t = setTimeout(r, 500); t.unref?.(); }),
  ]);
  for (const k of Object.keys(prevEnv)) { if (prevEnv[k] === undefined) delete process.env[k]; else process.env[k] = prevEnv[k]; }
  await rm(sandboxHome, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }).catch(() => {});
});

test('POST /api/run saves pr_auto with source project, or run when the body chose; a later PATCH leaves it unchanged', async () => {
  K.writeProjectSettings({ projectDir }, { 'pr.open': 'draft' });
  try {
    const a = await startAndStop();
    const pa = prAutoOf(a);
    assert.deepEqual([pa.open, pa.slices, pa.scope, pa.source], ['draft', 'each', 'project', { open: 'project', slices: 'default' }]);
    const b = await startAndStop({ pr: { open: 'ready', slices: 'one' } });
    assert.deepEqual([prAutoOf(b).open, prAutoOf(b).slices, prAutoOf(b).source], ['ready', 'one', { open: 'run', slices: 'run' }]);
    const key = K.projectKey(projectDir);
    const changed = await patch(`/api/projects/${key}/settings`, { 'pr.open': 'none' });
    assert.equal(changed.status, 200);
    assert.equal(prAutoOf(a).open, 'draft', 'a started run keeps its decision');
    const c = await startAndStop();
    assert.deepEqual([prAutoOf(c).open, prAutoOf(c).source.open], ['none', 'project']);
  } finally { K.writeProjectSettings({ projectDir }, { 'pr.open': null }); }
});

test('POST /api/run costCapUsd: the run keeps its own cap (pipelines.cost_cap_usd); a refused cap starts nothing', async () => {
  const id = await startAndStop({ costCapUsd: 7 });
  assert.equal(K.getDb().prepare('SELECT cost_cap_usd FROM pipelines WHERE id = ?').get(id).cost_cap_usd, 7);
  const none = await startAndStop({});
  assert.equal(K.getDb().prepare('SELECT cost_cap_usd FROM pipelines WHERE id = ?').get(none).cost_cap_usd, null, 'no cap sent: none stored');
  const before = runs.size;
  for (const bad of [-1, 0, '5']) {
    const r = await post('/api/run', BODY({ costCapUsd: bad }));
    assert.equal(r.status, 400, String(bad));
    assert.match((await r.json()).error, /costCapUsd must be a number above 0/);
  }
  assert.equal(runs.size, before, 'a refused cap creates no run');
});

test('exempt starts save open none and the kind, even when the project setting would open a PR', async () => {
  K.writeProjectSettings({ projectDir }, { 'pr.open': 'ready' });
  try {
    const same = await startAndStop({ sameAsSource: true });
    const pa = prAutoOf(same);
    assert.deepEqual([pa.open, pa.exempt], ['none', 'same-as-source']);
    const out = await mod._testing.invokeStartRun(BODY(), null, { automation: true });
    assert.equal(out.status, 200, JSON.stringify(out.body));
    const e = runs.get(out.body.runId);
    while (!e.orch.getState().id) await new Promise((x) => setTimeout(x, 20));
    const auto = prAutoOf(e.orch.getState().id);
    assert.deepEqual([auto.open, auto.exempt], ['none', 'automation']);
    await post('/api/stop', { runId: out.body.runId });
    await untilSettled(out.body.runId);
  } finally { K.writeProjectSettings({ projectDir }, { 'pr.open': null }); }
});

test('a workspace run resolves from the workspace setting and drops slices', async () => {
  const set = await patch(`/api/workspaces/${wsId}/settings`, { 'pr.open': 'ready' });
  assert.equal(set.status, 200, JSON.stringify(set.body));
  const r = await post('/api/run', { workspaceId: wsId, prompt: 'ws task', mock: true, guardrailsId: 'normal', humanInLoop: false, pr: { slices: 'one' } });
  assert.equal(r.status, 200, await r.clone().text());
  const { runId } = await r.json();
  const e = runs.get(runId);
  while (!e.orch.getState().id) await new Promise((x) => setTimeout(x, 20));
  const pa = prAutoOf(e.orch.getState().id);
  assert.deepEqual([pa.open, pa.slices, pa.scope, pa.source], ['ready', null, 'workspace', { open: 'workspace', slices: null }]);
  await post('/api/stop', { runId });
  await untilSettled(runId);
  await patch(`/api/workspaces/${wsId}/settings`, { 'pr.open': null });
});

test('a 400 for a malformed pr creates no run and no ticket', async () => {
  const before = { runs: runs.size, rows: K.getDb().prepare('SELECT COUNT(*) AS n FROM pipelines').get().n, tickets: K.getDb().prepare('SELECT COUNT(*) AS n FROM scheduled_runs').get().n };
  for (const [pr, error] of [['draft', 'pr must be an object like { "open": "draft" }'], [{ open: 'always' }, 'pr.open must be one of none | draft | ready'],
    [{ slices: 'both' }, 'pr.slices must be one of each | one'], [{ x: 1 }, 'pr: unknown key "x"']]) {
    for (const extra of [{}, { scheduledFor: new Date(Date.now() + 86400000).toISOString() }]) {
      const r = await post('/api/run', BODY({ pr, ...extra }));
      assert.equal(r.status, 400);
      assert.equal((await r.json()).error, error);
    }
  }
  assert.deepEqual({ runs: runs.size, rows: K.getDb().prepare('SELECT COUNT(*) AS n FROM pipelines').get().n, tickets: K.getDb().prepare('SELECT COUNT(*) AS n FROM scheduled_runs').get().n }, before);
});

test('a schedule stores an explicit pr in its request, and a ticket without one resolves when it fires', async () => {
  const when = () => new Date(Date.now() + 86400000).toISOString();
  const withPr = await post('/api/run', BODY({ scheduledFor: when(), pr: { open: 'draft' } }));
  assert.equal(withPr.status, 202, await withPr.clone().text());
  const a = K.getTicket((await withPr.json()).runId, { withRequest: true });
  assert.deepEqual(a.request.pr, { open: 'draft' });
  const without = await post('/api/run', BODY({ scheduledFor: when() }));
  assert.equal(without.status, 202);
  const t = K.getTicket((await without.json()).runId, { withRequest: true });
  assert.equal('pr' in t.request, false);
  assert.equal('prAuto' in t.request, false, 'nothing is resolved before it fires');
  K.writeProjectSettings({ projectDir }, { 'pr.open': 'ready' });
  try {
    await mod.schedulerTick({ now: Date.parse(t.runAt) + 2000 });
    const e = runs.get(t.id);
    assert.ok(e, 'the ticket fired as a run');
    while (!e.orch.getState().id) await new Promise((x) => setTimeout(x, 20));
    assert.deepEqual([prAutoOf(e.orch.getState().id).open, prAutoOf(e.orch.getState().id).source.open], ['ready', 'project']);
    await post('/api/stop', { runId: t.id });
    await untilSettled(t.id);
  } finally { K.writeProjectSettings({ projectDir }, { 'pr.open': null }); }
});

test('GET /api/run-defaults returns pr with its source for a project and a workspace', async () => {
  K.writeProjectSettings({ projectDir }, { 'pr.open': 'draft' });
  try {
    const p = (await get(`/api/run-defaults?projectDir=${encodeURIComponent(projectDir)}`)).body.pr;
    assert.deepEqual(p, { scope: 'project', open: { value: 'draft', source: 'project' }, slices: { value: 'each', source: 'default' } });
    const w = (await get(`/api/run-defaults?workspaceId=${wsId}`)).body.pr;
    assert.deepEqual(w, { scope: 'workspace', open: { value: 'none', source: 'default' }, slices: null });
    assert.equal((await get('/api/run-defaults?workspaceId=wks-nope-00000000')).status, 400);
    assert.deepEqual((await get('/api/run-defaults')).body.pr, { scope: 'none', open: { value: 'none', source: 'default' }, slices: null });
  } finally { K.writeProjectSettings({ projectDir }, { 'pr.open': null }); }
});

test('GET /api/pipelines/:id/pr-auto: a slice run shows the feature\'s values read-only; 404 unknown', async () => {
  const { createSliceFeature } = await import('../src/core/shape/features.mjs');
  const id = await startAndStop({ pr: { open: 'none' } });
  const own = (await get(`/api/pipelines/${id}/pr-auto`)).body.prAuto;
  assert.deepEqual([own.open, own.readOnly], ['none', true]);
  const s = (n) => ({ id: `s${n}`, title: `S${n}`, goal: 'g', inScope: [], outOfScope: [], acceptance: [], dependsOn: [], estimate: 'S' });
  const f = createSliceFeature({ pipelineId: id, projectDir, title: 'Feat', outline: { why: 'w', slices: [s(1), s(2)] }, perspectives: [], workflowId: 'wf_x',
    pr: { open: 'draft', slices: 'one', source: { open: 'team', slices: 'team' } } });
  const v = (await get(`/api/pipelines/${id}/pr-auto`)).body.prAuto;
  assert.deepEqual([v.open, v.slices, v.source, v.readOnly, v.feature.id, v.feature.source], ['draft', 'one', { open: 'feature', slices: 'feature' }, true, f.id, { open: 'team', slices: 'team' }]);
  assert.equal((await get('/api/pipelines/ffffffff/pr-auto')).status, 404);
  const old = await K.createPipeline(projectDir, { prompt: 'old', title: 'old' });
  assert.deepEqual((await get(`/api/pipelines/${old.id}/pr-auto`)).body, { prAuto: null }, 'a run from before v86');
});

test('workspace settings: GET shows own, team and effective; PATCH sets, clears and refuses', async () => {
  assert.deepEqual((await get(`/api/workspaces/${wsId}/settings`)).body, { own: {}, effective: { 'pr.open': { value: 'none', source: 'default' } }, team: { 'pr.open': null } });
  const set = await patch(`/api/workspaces/${wsId}/settings`, { 'pr.open': 'draft' });
  assert.deepEqual([set.status, set.body.own, set.body.effective['pr.open']], [200, { 'pr.open': 'draft' }, { value: 'draft', source: 'workspace' }]);
  assert.equal((await patch(`/api/workspaces/${wsId}/settings`, { 'pr.open': 'sometimes' })).status, 400);
  assert.equal((await patch(`/api/workspaces/${wsId}/settings`, { 'pr.slices': 'one' })).body.error, 'pr.slices is set per project (workspace runs are never sliced)');
  assert.equal((await patch(`/api/workspaces/${wsId}/settings`, { nope: 1 })).body.error, 'unknown workspace setting "nope"');
  assert.equal((await patch(`/api/workspaces/${wsId}/settings`, { 'pr.open': 'none', 'pr.slices': 'one' })).status, 400);
  assert.equal((await get(`/api/workspaces/${wsId}/settings`)).body.own['pr.open'], 'draft', 'a refusal writes nothing');
  assert.equal((await patch('/api/workspaces/wks-nope-00000000/settings', { 'pr.open': 'none' })).status, 404);
  assert.equal((await get('/api/workspaces/wks-nope-00000000/settings')).status, 404);
  const cleared = await patch(`/api/workspaces/${wsId}/settings`, { 'pr.open': null });
  assert.deepEqual(cleared.body.own, {});
});

// ── afterRunSettled: the server's PR step ────────────────────────────────────────────────────────────────────
test('afterRunSettled: a done project run with commits opens a draft PR attributed to its starter; an error run logs why', () => withEnv(NO_ADO, async () => {
  const { _testing: gitInfo } = await import('../src/core/git-info.mjs');
  const { writeState, createPipeline } = K;
  try {
    const seen = [];
    gitInfo.setRunner((cmd, args) => {
      seen.push([cmd, ...args]);
      if (cmd === 'gh' && args[0] === '--version') return okRun('gh 2.x');
      if (cmd === 'git' && args[0] === 'remote') return okRun(REMOTES_V);
      if (cmd === 'git' && args[0] === 'for-each-ref') return okRun('refs/remotes/origin/main\n');
      if (cmd === 'git' && args[0] === 'rev-parse') return okRun('abc\n');
      if (cmd === 'git' && args[0] === 'rev-list') return okRun('2\n');
      if (cmd === 'gh' && args[0] === 'pr' && args[1] === 'create') return okRun('https://github.com/me/repo/pull/21\n');
      return okRun('');
    });
    const make = async (status) => {
      const pa = { open: 'draft', slices: 'each', scope: 'project', source: { open: 'project', slices: 'default' } };
      const p = await createPipeline(projectDir, { prompt: 'x', title: 'A run', startedBy: 'ann@acme.test', prAuto: pa });
      const state = { id: p.id, projectKey: K.projectKey(projectDir), status, startedBy: 'ann@acme.test', title: 'A run', branch: { source: 'main', feature: 'feat/a' } };
      await writeState(p.dir, state);
      return { id: p.id, dir: p.dir, orch: { runShape: null, getState: () => ({ ...state, projectDir, target: 'project' }) } };
    };
    const done = await make('done');
    await mod._testing.afterRunSettled(done.orch);
    const create = seen.find((a) => a[0] === 'gh' && a[1] === 'pr' && a[2] === 'create');
    assert.ok(create && create.includes('--draft'), 'a draft PR');
    const out = prAutoOf(done.id).outcome;
    assert.deepEqual([out.status, out.final, out.urls, out.draft], ['opened', true, ['https://github.com/me/repo/pull/21'], true]);
    const events = K.getDb().prepare('SELECT text, actor FROM pipeline_events WHERE pipeline_id = ?').all(done.id).map((r) => ({ ...r }));
    assert.ok(events.some((e) => /^PR created \(draft\) by ann@acme\.test: /.test(e.text) && e.actor === 'ann@acme.test'), JSON.stringify(events));
    const log = (await readFile(join(done.dir, 'live-log.ndjson'), 'utf8')).trim().split('\n').map((l) => JSON.parse(l));
    assert.deepEqual(log.map((l) => [l.source, l.text]), [['pr', 'Opened a draft pull request: https://github.com/me/repo/pull/21']]);
    const failed = await make('error');
    const before = seen.filter((a) => a[2] === 'create').length;
    await mod._testing.afterRunSettled(failed.orch);
    assert.equal(seen.filter((a) => a[2] === 'create').length, before, 'an errored run opens nothing');
    assert.deepEqual([prAutoOf(failed.id).outcome.status, prAutoOf(failed.id).outcome.final], ['skipped', false]);
    const flog = (await readFile(join(failed.dir, 'live-log.ndjson'), 'utf8')).trim().split('\n').map((l) => JSON.parse(l));
    assert.equal(flog[0].text, 'Pull request not opened: the run ended with status error');
  } finally { gitInfo.reset(); }
}));
