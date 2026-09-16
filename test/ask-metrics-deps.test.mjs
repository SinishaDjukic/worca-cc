// test/ask-metrics-deps.test.mjs
// The REAL team-metrics bundle behind the Ask tools (docs/team-metrics.md "Ask Worca") over real
// git: status / read / isLocalRun / flush, the bound validator over the real readers, and
// applyMetricsChange for the two kinds that need no origin (record, workspace_home) plus a real
// route_members over file remotes.
import { test, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { makeOrigin, cloneAs, useGitSandbox } from './helpers/metrics-git.mjs';
import { makeRecord } from './fixtures/team-metrics/records.mjs';

const skip = process.platform === 'win32';
const root = mkdtempSync(join(tmpdir(), 'worca-ask-metrics-deps-'));
useTempHome(after);
useGitSandbox(before, after);
after(() => rmSync(root, { recursive: true, force: true }));

let projects, workspaces, sync, readTesting, config, deps, applyMetricsChange, validateMetricsChange;
before(async () => {
  projects = await import('../src/core/projects.mjs');
  workspaces = await import('../src/core/workspaces.mjs');
  sync = await import('../src/core/metrics/sync.mjs');
  readTesting = (await import('../src/core/metrics/read.mjs'))._testing;
  config = await import('../src/core/config.mjs');
  ({ defaultMetricsDeps, applyMetricsChange, validateMetricsChange } = await import('../src/core/ask/metrics-deps.mjs'));
  deps = defaultMetricsDeps({ threadId: null }).metrics;
});
let defaultMetricsDeps;
afterEach(() => { readTesting.reset(); sync._testing.reset(); });

let gw, dr, gwKey, drKey, wsId;

test('status + read + isLocalRun over a project that records on its own branch', { skip }, async () => {
  gw = cloneAs(root, 'm', makeOrigin(root, 'gateway'), 'gateway');
  dr = cloneAs(root, 'm', makeOrigin(root, 'device-registry'), 'device-registry');
  await projects.addProject({ name: 'gateway', path: gw });
  await projects.addProject({ name: 'device-registry', path: dr });
  const rows = await projects.listProjects();
  gwKey = rows.find((p) => p.name === 'gateway').key;
  drKey = rows.find((p) => p.name === 'device-registry').key;
  // Before anything is enabled the read side refuses with the coded error the tool maps.
  await assert.rejects(deps.read({ kind: 'project', id: gwKey }), (e) => e.code === 'NOT_ENABLED');
  await assert.rejects(deps.read({ kind: 'project', id: 'nope-00000000' }), (e) => e.code === 'NOT_FOUND');
  await assert.rejects(deps.read({ kind: 'project', id: gwKey }, { range: 'week' }), RangeError);
  await assert.rejects(deps.read({ kind: 'project', id: gwKey }, { groupBy: 'model' }), RangeError);

  assert.equal((await sync.enableTeamMetrics(gw, { mode: 'here' })).action, 'created');
  await sync.writeOutbox('gateway', makeRecord({ id: 'r1', project: 'gateway', startedAt: new Date().toISOString(), usd: 2.5, actor: 'Ana' }));
  await sync.writeOutbox('gateway', makeRecord({ id: 'r2', project: 'gateway', startedAt: new Date().toISOString(), usd: 1, result: 'failed', actor: 'Ben' }));
  const flushed = await deps.flush({ scope: { kind: 'project', id: gwKey } });
  assert.equal(flushed.length, 1); assert.equal(flushed[0].ok, true); assert.equal(flushed[0].pushed, 2);
  const st = await deps.status();
  const gwSt = st.projects.find((p) => p.key === gwKey);
  assert.deepEqual([gwSt.enabled, gwSt.recordsLocally, gwSt.record, gwSt.pending, gwSt.runs], [true, true, true, 0, 2]);
  assert.equal(st.projects.find((p) => p.key === drKey).enabled, false);

  const { read, agg } = await deps.read({ kind: 'project', id: gwKey }, { range: 'this-month', groupBy: 'actor', filter: { bogus: 'x', actor: 'Ana' } });
  assert.equal(read.scope.slug, 'gateway');
  assert.deepEqual([agg.totalRecords, agg.kpis.runs, agg.kpis.spendUsd, agg.groupBy], [2, 1, 2.5, 'actor'], 'the filter is cleaned to known dims and applied');
  assert.deepEqual(agg.filter, { actor: 'Ana' });
  assert.equal(deps.isLocalRun('r1'), false, 'a record id with no pipeline row on this machine');
  await assert.rejects(deps.flush({}), (e) => e.code === 'BAD_REQUEST');
  assert.deepEqual(await deps.flush({ all: true }), [], 'nothing pending anywhere');
});

test('the bound validator reads the real prefs; applyMetricsChange flips the record switch and the workspace home', { skip }, async () => {
  const same = await validateMetricsChange({ kind: 'enable', projectKey: gwKey });
  assert.deepEqual(same, { ok: false, errors: ['gateway already records team metrics on its own branch'] });
  const off = await validateMetricsChange({ kind: 'record', projectKey: gwKey, record: false });
  assert.equal(off.ok, true);
  const r = await applyMetricsChange(off.card);
  assert.deepEqual(r, { ok: true, detail: '"Include my runs" is now off' });
  assert.equal(config.readTeamMetricsPrefs(gwKey).record, false);
  assert.deepEqual(await validateMetricsChange({ kind: 'record', projectKey: gwKey, record: false }), { ok: false, errors: ['"Include my runs" is already off for gateway'] });
  await applyMetricsChange((await validateMetricsChange({ kind: 'record', projectKey: gwKey, record: true })).card);
  assert.equal(config.readTeamMetricsPrefs(gwKey).record, true);

  const ws = await workspaces.createWorkspace({ name: 'Team', projectPaths: [gw, dr] });
  wsId = ws.id;
  assert.deepEqual(await validateMetricsChange({ kind: 'workspace_home', workspaceId: wsId, homeProjectKey: drKey }), { ok: false, errors: ['device-registry does not record team metrics locally, so it cannot be a metrics home — enable it first'] });
  const home = await validateMetricsChange({ kind: 'workspace_home', workspaceId: wsId, homeProjectKey: gwKey });
  assert.equal(home.ok, true); assert.equal(home.card.homePath, gw);
  const applied = await applyMetricsChange(home.card);
  assert.equal(applied.ok, true); assert.match(applied.detail, /metrics home is now gateway/);
  assert.equal((await workspaces.readWorkspace(wsId)).metricsProject, gw);
  assert.deepEqual(await validateMetricsChange({ kind: 'workspace_home', workspaceId: wsId, homeProjectKey: gwKey }), { ok: false, errors: ['gateway is already the metrics home'] });
  const wsSt = (await deps.status()).workspaces.find((w) => w.id === wsId);
  assert.equal(wsSt.home.state, 'ok'); assert.equal(wsSt.home.slug, 'gateway');
});

test('route_members over file remotes: the member without a branch gets a marker, the result names it', { skip }, async () => {
  const route = await validateMetricsChange({ kind: 'route_members', workspaceId: wsId });
  assert.equal(route.ok, true); assert.equal(route.card.homeProjectName, 'gateway');
  const r = await applyMetricsChange(route.card);
  assert.equal(r.ok, true); assert.equal(r.home, 'gateway');
  assert.deepEqual(r.results.map((x) => [x.slug, x.result]), [['device-registry', 'routed']]);
  assert.equal(r.detail, '1 routed · 0 skipped · 0 failed');
  const st = (await deps.status()).workspaces.find((w) => w.id === wsId);
  assert.deepEqual(st.members.map((m) => [m.slug, m.state, m.recordsOn]).sort(), [['device-registry', 'routed', 'gateway'], ['gateway', 'home', 'gateway']]);
  // Clearing the home works through the same path.
  const clear = await validateMetricsChange({ kind: 'workspace_home', workspaceId: wsId, homeProjectKey: '' });
  assert.equal(clear.ok, true);
  assert.deepEqual(await applyMetricsChange(clear.card), { ok: true, detail: 'metrics home cleared' });
  assert.equal((await workspaces.readWorkspace(wsId)).metricsProject, null);
  await assert.rejects(applyMetricsChange({ kind: 'bogus' }), (e) => e.code === 'BAD_REQUEST');
  await assert.rejects(applyMetricsChange({ kind: 'record', projectKey: 'zzz-00000000', record: true }), (e) => e.code === 'NOT_FOUND');
});
