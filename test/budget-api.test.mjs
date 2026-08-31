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

test('GET /api/budget returns the budgetStatus shape', async () => {
  const res = await fetch(`${base}/api/budget`);
  assert.equal(res.status, 200);
  const b = await res.json();
  for (const k of ['pipelineLimitUsd', 'totalLimitUsd', 'resetPeriod', 'windowStartMs',
    'windowEndMs', 'msUntilReset', 'windowSpendUsd', 'allTimeSpendUsd', 'remainingUsd', 'blocked']) {
    assert.ok(k in b, `budget.${k}`);
  }
  assert.equal(b.blocked, false);
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
