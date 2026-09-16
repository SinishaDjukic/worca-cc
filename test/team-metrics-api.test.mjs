// test/team-metrics-api.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { makeOrigin, cloneAs, useGitSandbox } from './helpers/metrics-git.mjs';
import { makeRecord } from './fixtures/team-metrics/records.mjs';
import { seedPipeline } from './helpers/db-seed.mjs';
import { writeRunLedger } from '../src/core/metrics/ledger.mjs';

const skip = process.platform === 'win32';
useTempHome(after);
const root = mkdtempSync(join(tmpdir(), 'worca-tm-api-'));
let srv, base, mod, sync;
const JSONH = { 'Content-Type': 'application/json' };
const get = (p) => fetch(`${base}${p}`);
const post = (p, body) => fetch(`${base}${p}`, { method: 'POST', headers: JSONH, body: JSON.stringify(body ?? {}) });
const patch = (p, body) => fetch(`${base}${p}`, { method: 'PATCH', headers: JSONH, body: JSON.stringify(body) });

// ---- environment sandbox: THIS MUST BE THE FIRST HOOK REGISTRATION IN THE FILE. ----
// node:test runs before-hooks in registration order. `ui/server.mjs` (and everything
// settingsFile() touches) resolves under HOME, not WORCA_HOME, so importing it ahead of this
// hook evaluates the server against the developer's REAL home directory.
useGitSandbox(before, after);

before(async () => {
  mod = await import('../ui/server.mjs');
  sync = await import('../src/core/metrics/sync.mjs');
  srv = http.createServer(mod.app);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
});
after(async () => { if (srv) await new Promise((r) => srv.close(r)); mod?.runs.clear(); rmSync(root, { recursive: true, force: true }); });

let gw, dr, gwKey, drKey, wsId;

test('empty scopes: nothing enabled anywhere', async () => {
  const r = await get('/api/team-metrics/scopes');
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.deepEqual(j.scopes, { projects: [], workspaces: [] });
  assert.equal(j.anyEnabled, false);
});

test('validation: bad scope/range/groupBy → 400; unknown project → 404; not enabled → 404', async () => {
  assert.equal((await get('/api/team-metrics')).status, 400);
  assert.equal((await get('/api/team-metrics?scope=project:bogus')).status, 400);
  assert.equal((await get('/api/team-metrics?scope=project:abc-0123abcd&range=week')).status, 400);
  assert.equal((await get('/api/team-metrics?scope=project:abc-0123abcd&groupBy=model')).status, 400);
  const r = await get('/api/team-metrics?scope=project:abc-0123abcd');
  assert.equal(r.status, 404);
});

test('enable (here) → scopes lists the project → GET /api/team-metrics shape', { skip }, async () => {
  gw = cloneAs(root, 'm', makeOrigin(root, 'gateway'), 'gateway');
  dr = cloneAs(root, 'm', makeOrigin(root, 'device-registry'), 'device-registry');
  for (const [name, path] of [['gateway', gw], ['device-registry', dr]]) {
    assert.equal((await post('/api/projects', { name, path })).status, 200);
  }
  const projects = (await (await get('/api/projects')).json()).projects;
  gwKey = projects.find((p) => p.name === 'gateway').key;
  drKey = projects.find((p) => p.name === 'device-registry').key;

  assert.equal((await post(`/api/projects/${gwKey}/team-metrics/enable`, { mode: 'here', attribution: 'maybe' })).status, 400);
  const en = await post(`/api/projects/${gwKey}/team-metrics/enable`, { mode: 'here', attribution: 'git-user' });
  assert.equal(en.status, 200, await en.clone().text());
  const ej = await en.json();
  assert.equal(ej.action, 'created'); assert.equal(ej.status.enabled, true); assert.equal(ej.status.recordsLocally, true);

  await sync.writeOutbox('gateway', makeRecord({ id: 'r1', project: 'gateway', startedAt: new Date().toISOString(), usd: 2.5 }));
  await sync.flushSlug('gateway');

  const scopes = await (await get('/api/team-metrics/scopes')).json();
  assert.deepEqual(scopes.scopes.projects.map((s) => s.id), [`project:${gwKey}`]);
  assert.equal(scopes.anyEnabled, true);

  const r = await get(`/api/team-metrics?scope=project:${gwKey}&range=this-month`);
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.deepEqual(Object.keys(j).sort(), ['aggregate', 'fetchError', 'records', 'refresh', 'scope', 'stats', 'sync']);
  assert.equal(j.scope.slug, 'gateway');
  assert.equal(j.records.length, 1);
  assert.equal(j.aggregate.kpis.runs, 1); assert.equal(j.aggregate.kpis.spendUsd, 2.5);
  assert.deepEqual(j.stats, { files: 1, malformed: 0, unknownV: 0 });
  assert.equal(j.sync[0].pending, 0);
});

test('defer=1: the page read answers from the worktree and reports refresh.pending for the fetch it left running', { skip }, async () => {
  const readTesting = (await import('../src/core/metrics/read.mjs'))._testing;
  let t = Date.now() + 120_000;                     // a fetch is due again (> 60 s since the inline one above)
  readTesting.setNow(() => t);
  try {
    const r = await get(`/api/team-metrics?scope=project:${gwKey}&range=this-month&defer=1`);
    assert.equal(r.status, 200);
    const j = await r.json();
    assert.equal(j.records.length, 1, 'the worktree\'s records, at once');
    assert.equal(j.refresh.pending, true, 'the fetch runs after the response');
    await readTesting.settleDeferred();
    const again = await (await get(`/api/team-metrics?scope=project:${gwKey}&range=this-month&defer=1`)).json();
    assert.equal(again.refresh.pending, false, 'settled: nothing due within 60 s');
    const inline = await (await get(`/api/team-metrics?scope=project:${gwKey}&range=this-month`)).json();
    assert.equal(inline.refresh.pending, false, 'an inline read never reports pending');
  } finally { readTesting.reset(); }
});

test('GET /api/history/:key/:id surfaces the run ledger state (§6.5)', { skip }, async () => {
  const { id, key } = await seedPipeline(gw, { title: 'ledger run', status: 'done' });
  writeRunLedger(id, { state: 'pending' });
  const r = await get(`/api/history/${key}/${id}`);
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.teamMetrics.state, 'pending');
});

test('refresh=1 rate limiting surfaces refresh.limited on the second call', { skip }, async () => {
  const a = await (await get(`/api/team-metrics?scope=project:${gwKey}&refresh=1`)).json();
  const b = await (await get(`/api/team-metrics?scope=project:${gwKey}&refresh=1`)).json();
  assert.equal(a.refresh.limited, false);
  assert.equal(b.refresh.limited, true);
});

test('enable without origin → 400 NO_ORIGIN; record opt-out PATCH validates', { skip }, async () => {
  const lone = join(root, 'm', 'scratch');
  (await import('node:child_process')).spawnSync('git', ['init', '-q', lone]);
  await post('/api/projects', { name: 'scratch', path: lone });
  const key = (await (await get('/api/projects')).json()).projects.find((p) => p.name === 'scratch').key;
  const r = await post(`/api/projects/${key}/team-metrics/enable`, { mode: 'here' });
  assert.equal(r.status, 400); assert.equal((await r.json()).code, 'NO_ORIGIN');
  assert.equal((await patch(`/api/projects/${gwKey}/team-metrics`, { record: 'no' })).status, 400);
  const ok = await patch(`/api/projects/${gwKey}/team-metrics`, { record: false });
  assert.equal((await ok.json()).status.record, false);
  await patch(`/api/projects/${gwKey}/team-metrics`, { record: true });
});

test('metrics-scan reports per-member enabled state', { skip }, async () => {
  assert.equal((await post('/api/workspaces/metrics-scan', {})).status, 400);
  const j = await (await post('/api/workspaces/metrics-scan', { projectPaths: [gw, dr] })).json();
  const byName = Object.fromEntries(j.members.map((m) => [m.slug, m]));
  assert.equal(byName.gateway.enabled, true); assert.equal(byName.gateway.recordsLocally, true);
  assert.equal(byName['device-registry'].enabled, false); assert.equal(byName['device-registry'].hasOrigin, true);
});

test('PATCH workspaces metricsProject: home must be a member; stale home is reported', { skip }, async () => {
  const c = await post('/api/workspaces', { name: 'IoT SP Platform', projectPaths: [gw, dr], description: 'x' });
  assert.equal(c.status, 201);
  wsId = (await c.json()).workspace.id;
  assert.equal((await patch(`/api/workspaces/${wsId}`, { metricsProject: join(root, 'elsewhere') })).status, 400);
  assert.equal((await patch(`/api/workspaces/${wsId}`, { metricsProject: 42 })).status, 400);
  const ok = await patch(`/api/workspaces/${wsId}`, { metricsProject: gw });
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).workspace.metricsProject, gw);
  const scopes = await (await get('/api/team-metrics/scopes')).json();
  const w = scopes.workspaces.find((x) => x.id === wsId);
  assert.equal(w.home.state, 'ok'); assert.equal(w.home.slug, 'gateway');
  assert.ok(scopes.scopes.workspaces.some((s) => s.id === `workspace:${wsId}`));
  await patch(`/api/workspaces/${wsId}`, { metricsProject: dr });                  // dr has no branch → stale
  const w2 = (await (await get('/api/team-metrics/scopes')).json()).workspaces.find((x) => x.id === wsId);
  assert.equal(w2.home.state, 'stale'); assert.equal(w2.home.code, 'HOME_BRANCH_MISSING');
  await patch(`/api/workspaces/${wsId}`, { metricsProject: null });
});

test('GET /api/team-metrics in workspace scope groups by workspace name', { skip }, async () => {
  await patch(`/api/workspaces/${wsId}`, { metricsProject: gw });
  await sync.writeOutbox('gateway', makeRecord({ id: 'ws1', kind: 'workspace', workspace: 'IoT SP Platform', touched: ['gateway'], startedAt: new Date().toISOString() }));
  await sync.flushSlug('gateway');
  assert.equal((await get(`/api/team-metrics?scope=workspace:${wsId}&range=this-month&groupBy=project`)).status, 400, 'spend is never stacked by project');
  const j = await (await get(`/api/team-metrics?scope=workspace:${wsId}&range=this-month`)).json();
  assert.equal(j.scope.kind, 'workspace'); assert.equal(j.scope.home, 'gateway');
  assert.deepEqual(j.records.map((r) => r.id), ['ws1']);
  assert.ok(j.aggregate.breakdowns.project.some((r) => r.key === 'gateway'));
  await patch(`/api/workspaces/${wsId}`, { metricsProject: null });
});

test('route all members creates a delegation marker per member and lists results', { skip }, async () => {
  await patch(`/api/workspaces/${wsId}`, { metricsProject: gw });
  const j = await (await post(`/api/workspaces/${wsId}/metrics-route`)).json();
  assert.deepEqual(j.results.map((r) => [r.slug, r.result]), [['device-registry', 'routed']]);
  const st = await (await get(`/api/projects/${drKey}/team-metrics`)).json();
  assert.equal(st.status.delegateTo, 'gateway'); assert.equal(st.status.delegateState, 'ok');
});

test('flush route returns per-slug results; metrics files are not statically served', { skip }, async () => {
  const j = await (await post('/api/team-metrics/flush', { scope: `project:${gwKey}` })).json();
  assert.equal(j.results[0].ok, true);
  // Unmatched non-/api GETs fall back to index.html (server.mjs:~5926), which itself mentions
  // `worca-metrics` after Step 6 — so assert on the branch README's own sentence and the content type.
  const r = await get('/metrics/repos/gateway/README.md');
  assert.match(r.headers.get('content-type') || '', /text\/html/);
  assert.ok(!(await r.text()).includes('This branch is written by Worca team metrics'));
});
