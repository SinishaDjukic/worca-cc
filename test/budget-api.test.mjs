// test/budget-api.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { app, runs } from '../ui/server.mjs';
import { _resetForTests, getDb } from '../src/core/db.mjs';
import { recordCostDelta } from '../src/core/cost-budget.mjs';
import { seedPipeline } from './helpers/db-seed.mjs';
import { checkRows } from './helpers/rows.mjs';

let srv, base, home, sandboxHome, seededProjectDir;
const prevEnv = {};

function postJson(p, body) {
  return fetch(`${base}${p}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
}
const postSettings = (body) => postJson('/api/settings', body);

before(async () => {
  home = await mkdtemp(join(tmpdir(), 'worca-cc-budget-api-'));
  // settings sandbox: settingsFile() resolves under HOME, not WORCA_HOME. WORCA_HOME
  // stays set so the DB stays pinned to the temp home for the whole suite.
  sandboxHome = await mkdtemp(join(tmpdir(), 'worca-cost-'));
  for (const k of ['WORCA_HOME', 'HOME', 'USERPROFILE']) prevEnv[k] = process.env[k];
  process.env.WORCA_HOME = home;        // store.mjs appends '.worca-cc'
  process.env.HOME = sandboxHome;
  process.env.USERPROFILE = sandboxHome;
  _resetForTests();                     // DB singleton opens under this home
  // Any real directory works as a run/seed target: POST /api/run never consults
  // the projects registry, and the resume gates below fire before its lookup.
  seededProjectDir = await mkdtemp(join(tmpdir(), 'worca-cc-budget-proj-'));
  srv = http.createServer(app);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
});
after(async () => {
  if (srv) await new Promise((r) => srv.close(r));
  runs.clear();
  _resetForTests();
  for (const k of ['WORCA_HOME', 'HOME', 'USERPROFILE']) {
    if (prevEnv[k] === undefined) delete process.env[k]; else process.env[k] = prevEnv[k];
  }
  await rm(home, { recursive: true, force: true });
  await rm(sandboxHome, { recursive: true, force: true });
  if (seededProjectDir) await rm(seededProjectDir, { recursive: true, force: true });
});

test('GET /api/budget returns the budgetStatus shape with window savings', async () => {
  await checkRows([
    { name: 'GET /api/budget returns the budgetStatus shape', run: async () => {
      const res = await fetch(`${base}/api/budget`);
      assert.equal(res.status, 200);
      const b = await res.json();
      for (const k of ['pipelineLimitUsd', 'totalLimitUsd', 'resetPeriod', 'windowStartMs',
        'windowEndMs', 'msUntilReset', 'windowSpendUsd', 'allTimeSpendUsd', 'remainingUsd', 'blocked']) {
        assert.ok(k in b, `budget.${k}`);
      }
      assert.equal(b.blocked, false);
    } },
    { name: 'GET /api/budget also carries the window savings the sidebar shows', run: async () => {
      // A run started now lands in the current window; its hours price at the default $35/h
      // (the HOME sandbox has no stored rate).
      await seedPipeline(seededProjectDir, { status: 'done', humanHours: 2 });
      const b = await (await fetch(`${base}/api/budget`)).json();
      assert.equal(b.windowHumanHours, 2);
      assert.equal(b.windowSavedUsd, Math.round((2 * 35 - b.windowSpendUsd) * 100) / 100);
    } },
  ]);
});

test('settings roundtrip for the three budget keys', async () => {
  let res = await fetch(`${base}/api/settings`, { method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pipelineCostLimitUsd: 2.5, totalCostLimitUsd: 50, costLimitResetPeriod: 'weekly' }) });
  assert.equal(res.status, 200);
  const state = await res.json();
  assert.equal(state.pipelineCostLimitUsd, 2.5);
  assert.equal(state.totalCostLimitUsd, 50);
  assert.equal(state.costLimitResetPeriod, 'weekly');
  res = await fetch(`${base}/api/settings`);
  const got = await res.json();
  assert.equal(got.totalCostLimitUsd, 50);
});

test('invalid budget values -> 400 {error}; clearing via empty string', async () => {
  let res = await fetch(`${base}/api/settings`, { method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ totalCostLimitUsd: -5 }) });
  assert.equal(res.status, 400);
  assert.ok((await res.json()).error);
  res = await fetch(`${base}/api/settings`, { method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ totalCostLimitUsd: '' }) });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).totalCostLimitUsd, null);
});

test('REGRESSION: a budget-only POST must not clear the root setting', async () => {
  await fetch(`${base}/api/settings`, { method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ root: sandboxHome }) });        // set a custom root first
  await fetch(`${base}/api/settings`, { method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ totalCostLimitUsd: 5 }) });     // budget-only write
  const state = await (await fetch(`${base}/api/settings`)).json();
  assert.equal(state.root, sandboxHome);                    // root untouched
});

test('REGRESSION: a multi-key budget POST is all-or-nothing — one bad key persists none', async () => {
  await postSettings({ pipelineCostLimitUsd: '', totalCostLimitUsd: '', costLimitResetPeriod: '' });
  // The setters run in body order and each persists on its own, so a later throw
  // used to leave the earlier keys written while the client kept its pre-save paint.
  let res = await postSettings({ pipelineCostLimitUsd: 3, totalCostLimitUsd: -1 });
  assert.equal(res.status, 400);
  let state = await (await fetch(`${base}/api/settings`)).json();
  assert.equal(state.pipelineCostLimitUsd, null, 'the earlier valid key must not persist');

  res = await postSettings({ totalCostLimitUsd: 10, costLimitResetPeriod: 'daily' });
  assert.equal(res.status, 400);
  state = await (await fetch(`${base}/api/settings`)).json();
  assert.equal(state.totalCostLimitUsd, null, 'a bad period rejects the whole write');
  assert.equal(state.costLimitResetPeriod, 'monthly');

  // …and a fully valid multi-key POST still lands.
  res = await postSettings({ pipelineCostLimitUsd: 1.5, totalCostLimitUsd: 20, costLimitResetPeriod: 'weekly' });
  assert.equal(res.status, 200);
  state = await res.json();
  assert.equal(state.pipelineCostLimitUsd, 1.5);
  assert.equal(state.totalCostLimitUsd, 20);
  assert.equal(state.costLimitResetPeriod, 'weekly');
  await postSettings({ pipelineCostLimitUsd: '', totalCostLimitUsd: '', costLimitResetPeriod: '' });
});

test('POST /api/run refuses with 403 + budget payload when total-blocked', async () => {
  await postSettings({ totalCostLimitUsd: 1 });
  recordCostDelta({ pipelineId: 'x', amountUsd: 2, tsMs: Date.now() });
  const res = await fetch(`${base}/api/run`, { method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectDir: seededProjectDir, prompt: 'x', mock: true }) });
  assert.equal(res.status, 403);
  const body = await res.json();
  assert.match(body.error, /total cost limit/);
  assert.equal(body.budget.blocked, true);
  await postSettings({ totalCostLimitUsd: '' });
  getDb().exec('DELETE FROM cost_ledger');
});

test('POST /api/resume: 409 archived; 403 total; 403 needsOverride; ignoreCostCap proceeds', async () => {
  // archived
  const { id: archivedId } = await seedPipeline(seededProjectDir, { status: 'paused',
    resumePoint: { version: 2, kind: 'boundary' } });
  getDb().prepare('UPDATE pipelines SET archived_at = ? WHERE id = ?')
    .run(new Date().toISOString(), archivedId);
  let res = await postJson('/api/resume', { pipelineId: archivedId });
  assert.equal(res.status, 409);

  // pipeline-cap: paused pipeline whose spend exceeds the cap
  await postSettings({ pipelineCostLimitUsd: 1 });
  const { id: cappedId } = await seedPipeline(seededProjectDir, { status: 'paused', totalCostUsd: 2,
    resumePoint: { version: 2, kind: 'boundary', pauseReason: 'cost_pipeline' } });
  res = await postJson('/api/resume', { pipelineId: cappedId });
  assert.equal(res.status, 403);
  assert.equal((await res.json()).needsOverride, true);

  // ignoreCostCap sets the override column (resume may then fail later on
  // worktree checks in this sandbox — assert the column, not full resume)
  res = await postJson('/api/resume', { pipelineId: cappedId, ignoreCostCap: true });
  assert.equal(getDb().prepare('SELECT cost_cap_override FROM pipelines WHERE id = ?')
    .get(cappedId).cost_cap_override, 1);

  // total-blocked beats everything except archived
  await postSettings({ totalCostLimitUsd: 1 });
  recordCostDelta({ pipelineId: 'y', amountUsd: 2, tsMs: Date.now() });
  res = await postJson('/api/resume', { pipelineId: cappedId, ignoreCostCap: true });
  assert.equal(res.status, 403);
  assert.match((await res.json()).error, /total cost limit/);

  // Ordering lock: cappedId's override was ALREADY 1 above, so that refusal
  // cannot tell us when the override is armed. Repeat against a FRESH pipeline
  // — the total gate must 403 before ignoreCostCap ever touches the column.
  const { id: freshId } = await seedPipeline(seededProjectDir, { status: 'paused', totalCostUsd: 2,
    resumePoint: { version: 2, kind: 'boundary', pauseReason: 'cost_total' } });
  res = await postJson('/api/resume', { pipelineId: freshId, ignoreCostCap: true });
  assert.equal(res.status, 403);
  assert.match((await res.json()).error, /total cost limit/);
  assert.equal(getDb().prepare('SELECT cost_cap_override FROM pipelines WHERE id = ?')
    .get(freshId).cost_cap_override, 0, 'a refused resume must not arm the override');

  await postSettings({ pipelineCostLimitUsd: '', totalCostLimitUsd: '' });
  getDb().exec('DELETE FROM cost_ledger');
});

// Raise the cap (Stillhet): POST /api/resume { costCapUsd } resumes held to a new cap for this run. The column is
// written only after every resume gate; a later plain resume is held to the stored cap, not the settings cap.
test('POST /api/resume costCapUsd: its 400s, no write on any refused gate, the write on success, the stored cap gates a plain resume', async () => {
  const { addProject } = await import('../src/core/projects.mjs');
  const { graphResumePoint } = await import('./helpers/graph-templates.mjs');
  const { setRunCostCap } = await import('../src/core/cost-budget.mjs');
  const capOf = (id) => getDb().prepare('SELECT cost_cap_usd, cost_cap_override FROM pipelines WHERE id = ?').get(id);
  await postSettings({ pipelineCostLimitUsd: 1 });
  const goneWt = join(seededProjectDir, 'gone-worktree');
  const noWt = (spent) => seedPipeline(seededProjectDir, { status: 'paused', totalCostUsd: spent,
    branch: { source: 'main', feature: 'f', worktreeDir: goneWt, reusedExisting: false },
    resumePoint: { version: 2, kind: 'boundary', pauseReason: 'cost_pipeline' } });

  const { id } = await noWt(2);
  for (const [body, error] of [
    [{ costCapUsd: '5' }, 'costCapUsd must be a number above 0'],
    [{ costCapUsd: 0 }, 'costCapUsd must be a number above 0'],
    [{ costCapUsd: 5, ignoreCostCap: true }, 'costCapUsd and ignoreCostCap cannot be combined'],
    [{ costCapUsd: 2 }, 'The new cap must be above what this task has spent ($2.00).'],
  ]) {
    const res = await postJson('/api/resume', { pipelineId: id, ...body });
    assert.deepEqual([res.status, (await res.json()).error], [400, error], JSON.stringify(body));
  }
  // A later gate refuses (the worktree is gone): nothing written.
  let res = await postJson('/api/resume', { pipelineId: id, costCapUsd: 5 });
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /worktree missing/);
  assert.deepEqual({ ...capOf(id) }, { cost_cap_usd: null, cost_cap_override: 0 });
  // The double-resume guard refuses: nothing written.
  runs.set('live-dup', { id: 'live-dup', pipelineId: id, status: 'running', events: [] });
  res = await postJson('/api/resume', { pipelineId: id, costCapUsd: 5 });
  runs.delete('live-dup');
  assert.deepEqual([res.status, (await res.json()).error], [400, 'pipeline is already live']);
  assert.equal(capOf(id).cost_cap_usd, null);

  // A stored cap: a plain resume under it passes the cap gate (and stops at the worktree), over it is 403.
  setRunCostCap(id, 5);
  res = await postJson('/api/resume', { pipelineId: id });
  assert.equal(res.status, 400, 'held to the stored $5, not the settings $1');
  getDb().prepare('UPDATE pipelines SET total_cost_usd = 6 WHERE id = ?').run(id);
  res = await postJson('/api/resume', { pipelineId: id });
  assert.deepEqual([res.status, (await res.json()).error], [403, 'pipeline cost limit reached']);

  // Every gate passes: the cap is written and the override cleared.
  const projDir = await mkdtemp(join(tmpdir(), 'worca-cc-budget-raise-'));
  const liveWt = await mkdtemp(join(tmpdir(), 'worca-cc-budget-raise-wt-'));
  await addProject({ name: 'budget-raise', path: projDir });
  const { id: okId } = await seedPipeline(projDir, { status: 'paused', totalCostUsd: 2,
    branch: { source: 'main', feature: 'f', worktreeDir: liveWt, reusedExisting: false }, resumePoint: graphResumePoint({ pipelineDir: projDir }) });
  getDb().prepare('UPDATE pipelines SET cost_cap_override = 1 WHERE id = ?').run(okId);
  res = await postJson('/api/resume', { pipelineId: okId, costCapUsd: 7.5, mock: true });
  const out = await res.json();
  assert.equal(res.status, 200, JSON.stringify(out));
  assert.deepEqual({ ...capOf(okId) }, { cost_cap_usd: 7.5, cost_cap_override: 0 });
  assert.equal(runs.get(out.runId).orch.runCostCapUsd, 7.5);
  await postJson('/api/stop', { runId: out.runId });
  for (let i = 0; i < 100 && !['stopped', 'done', 'error', 'paused'].includes(runs.get(out.runId)?.status); i++) await new Promise((r) => setTimeout(r, 50));

  // The engine refuses (a guardrail set codex cannot enforce): nothing written.
  const engWt = await mkdtemp(join(tmpdir(), 'worca-cc-budget-eng-wt-'));
  const { id: engId } = await seedPipeline(projDir, { status: 'paused', totalCostUsd: 2,
    branch: { source: 'main', feature: 'f', worktreeDir: engWt, reusedExisting: false }, resumePoint: graphResumePoint({ pipelineDir: projDir, guardrailsId: 'normal' }) });
  res = await postJson('/api/resume', { pipelineId: engId, costCapUsd: 9, mock: true, engine: 'codex' });
  assert.deepEqual([res.status, (await res.json()).code], [409, 'engine-refused']);
  assert.equal(capOf(engId).cost_cap_usd, null);
  // The base check refuses (baseCheck with a source branch the repository does not have): nothing written.
  const { gitDir } = await import('./helpers/git-dir.mjs');
  const repo = gitDir('budget-base');
  const bare = await mkdtemp(join(tmpdir(), 'worca-cc-budget-origin-'));
  const { execSync } = await import('node:child_process');
  execSync('git init -q --bare', { cwd: bare });
  execSync(`git remote add origin "${bare}" && git push -q origin HEAD:refs/heads/main`, { cwd: repo });   // the check measures a remote
  await addProject({ name: 'budget-base', path: repo });
  const baseWt = await mkdtemp(join(tmpdir(), 'worca-cc-budget-base-wt-'));
  const { id: baseId } = await seedPipeline(repo, { status: 'paused', totalCostUsd: 2,
    branch: { source: 'gone-branch', feature: 'f', baseSha: 'HEAD', worktreeDir: baseWt, reusedExisting: false }, resumePoint: { version: 2, kind: 'boundary' } });
  res = await postJson('/api/resume', { pipelineId: baseId, costCapUsd: 9, baseCheck: true });
  const baseOut = await res.json();
  assert.deepEqual([res.status, baseOut.code], [409, 'base-missing'], JSON.stringify(baseOut));
  assert.equal(capOf(baseId).cost_cap_usd, null);
  await rm(engWt, { recursive: true, force: true }); await rm(baseWt, { recursive: true, force: true }); await rm(repo, { recursive: true, force: true }); await rm(bare, { recursive: true, force: true });

  // The total budget still refuses first, and writes nothing.
  const { id: totalId } = await noWt(2);
  await postSettings({ totalCostLimitUsd: 1 });
  recordCostDelta({ pipelineId: 'y', amountUsd: 2, tsMs: Date.now() });
  res = await postJson('/api/resume', { pipelineId: totalId, costCapUsd: 9 });
  assert.deepEqual([res.status, (await res.json()).error], [403, 'total cost limit reached']);
  assert.equal(capOf(totalId).cost_cap_usd, null);

  await postSettings({ pipelineCostLimitUsd: '', totalCostLimitUsd: '' });
  getDb().exec('DELETE FROM cost_ledger');
  await rm(liveWt, { recursive: true, force: true }); await rm(projDir, { recursive: true, force: true });
});

test('POST /api/run costCapUsd: the cap set at the start gets one audit line once the pipeline row exists', async () => {
  const res = await fetch(`${base}/api/run`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectDir: seededProjectDir, prompt: 'x', mock: true, costCapUsd: 2 }) });
  const { runId } = await res.json();
  assert.equal(res.status, 200);
  const entry = runs.get(runId);
  const lines = () => (entry?.pipelineId ? getDb().prepare('SELECT text FROM pipeline_events WHERE pipeline_id = ?').all(entry.pipelineId).map((e) => e.text) : [])
    .filter((t) => /^Pipeline cost limit set/.test(t));
  for (let i = 0; i < 200 && !lines().length; i++) await new Promise((r) => setTimeout(r, 25));
  try { entry.orch.stop('test'); } catch { /* already settled */ }
  for (let i = 0; i < 200 && !runs.get(runId)?.settled; i++) await new Promise((r) => setTimeout(r, 25));
  assert.deepEqual(lines(), ['Pipeline cost limit set to $2.00 for this run.']);
});
