// test/ask-metrics-tools.test.mjs
// The four team-metrics tools (docs/team-metrics.md "Ask Worca") and list_projects' metrics field,
// over a fake deps.metrics bundle: shapes, the pinned-scope default, paging, the coded-error mapping,
// and the graceful "unavailable" without the bundle.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createAskTools, AskToolError } from '../src/core/ask/tools.mjs';
import { ASK_LIMITS } from '../src/core/ask/limits.mjs';
import { redactAskText } from '../src/core/ask/redact.mjs';
import { aggregate } from '../src/shared/team-metrics/aggregate.mjs';
import { makeRecord } from './fixtures/team-metrics/records.mjs';

const NOW = Date.parse('2026-09-16T12:00:00Z');
const RECORDS = [
  makeRecord({ id: 'aaaa0001', startedAt: '2026-09-10T10:00:00Z', usd: 2.5, actor: 'Ana', title: 'Fix login ghp_abcdefghijklmnopqrstuvwxyz0123456789' }),
  makeRecord({ id: 'aaaa0002', startedAt: '2026-09-11T10:00:00Z', usd: 1, result: 'failed', actor: 'Ben', workflow: { id: 'wf_review', name: 'Review' } }),
  makeRecord({ id: 'aaaa0003', startedAt: '2026-08-05T10:00:00Z', usd: 4, actor: 'Ana' }),   // inside the previous period (Aug 1 → Aug 16, the elapsed part of last month)
];
const READ = {
  scope: { kind: 'project', id: 'gw-00000001', name: 'gateway', slug: 'acme/gateway', recordedIn: null },
  records: RECORDS, stats: { files: 3, malformed: 1, unknownV: 0 }, sinks: ['acme/gateway'],
  sync: [{ slug: 'acme/gateway', pending: 2, lastSyncAt: '2026-09-16T11:00:00Z', lastError: 'remote: token ghp_abcdefghijklmnopqrstuvwxyz0123456789 rejected', lastErrorCode: 'PUSH_REJECTED', hint: 'exempt worca-metrics', fetchedAt: '2026-09-16T11:59:00Z' }],
  refresh: { requested: false, fetched: true, limited: false, retryInMs: 0 }, fetchError: null,
};
const STATUS = {
  projects: [
    { key: 'gw-00000001', name: 'gateway', slug: 'acme/gateway', hasOrigin: true, enabled: true, delegateTo: null, delegateState: null, blocked: null, attribution: 'git-user', record: true, pending: 2, runs: 3, lastError: null, homeFor: ['Team'] },
    { key: 'cs-00000002', name: 'console', slug: null, hasOrigin: false, enabled: false, record: true, pending: 0, runs: null, lastError: null, homeFor: [] },
    { key: 'nb-00000003', name: 'notes', hasOrigin: false, noGit: true, enabled: false, record: true, pending: 0, runs: null, homeFor: [] },
    { key: 'bl-00000004', name: 'billing', slug: 'acme/billing', hasOrigin: true, enabled: true, delegateTo: 'acme/gateway', delegateState: 'ok', blocked: null, record: false, pending: 0, runs: 0, lastError: 'ghp_abcdefghijklmnopqrstuvwxyz0123456789', homeFor: [] },
  ],
  workspaces: [{ id: 'wks-team-0000abcd', name: 'Team', home: { state: 'ok', slug: 'acme/gateway', runs: 12, record: true, detail: null },
    members: [{ slug: 'acme/gateway', state: 'home', recordsOn: 'acme/gateway', reason: null }, { slug: 'acme/console', state: 'not-recording', recordsOn: null, reason: 'no origin remote' }] }],
};
const calls = [];
let pin = null;
const fakeMetrics = {
  status: async () => { calls.push(['status']); return STATUS; },
  async read(scope, opts) {
    calls.push(['read', scope, opts]);
    if (scope.id === 'missing-00000000') throw Object.assign(new Error('unknown project missing-00000000'), { code: 'NOT_FOUND' });
    if (scope.id === 'off-00000000') throw Object.assign(new Error('team metrics are not enabled for off'), { code: 'NOT_ENABLED' });
    if (opts.range === 'week') throw new RangeError('unknown range "week"');
    if (scope.id === 'boom-00000000') throw new Error('disk on fire');
    return { read: READ, agg: aggregate(RECORDS, { ...opts, now: NOW }) };
  },
  isLocalRun: (id) => id === 'aaaa0002',
  validateChange: async (input) => { calls.push(['validate', input]); return input.kind === 'record' ? { ok: true, card: { type: 'metrics', ...input } } : { ok: false, errors: ['nope'] }; },
  flush: async (arg) => { calls.push(['flush', arg]); return [{ ok: false, slug: 'acme/gateway', code: 'PUSH_REJECTED', stderr: 'remote: ghp_abcdefghijklmnopqrstuvwxyz0123456789', pending: 2, pushed: 0, hint: 'exempt worca-metrics' }]; },
};
const base = {
  buildCatalog: async () => ({ projects: [{ key: 'gw-00000001', name: 'gateway', path: '/p/gw' }, { key: 'cs-00000002', name: 'console', path: '/p/cs' }, { key: 'nb-00000003', name: 'notes', path: '/p/nb' }, { key: 'bl-00000004', name: 'billing', path: '/p/bl' }],
    workspaces: [{ id: 'wks-team-0000abcd', name: 'Team', projectKeys: ['gw-00000001', 'cs-00000002'] }], workflows: [] }),
  pinnedScope: () => pin,
  redact: redactAskText, limits: ASK_LIMITS,
};
const tools = createAskTools({ ...base, metrics: fakeMetrics });

test('defs: the four tools are listed with JSON-Schema inputs; propose_metrics_change requires kind', () => {
  const byName = (n) => tools.list().find((d) => d.name === n);
  for (const n of ['get_team_metrics', 'list_team_metrics_runs', 'push_team_metrics', 'propose_metrics_change']) {
    const d = byName(n);
    assert.ok(d && d.inputSchema.type === 'object' && d.inputSchema.additionalProperties === false, n);
    assert.ok(d.description.length > 100, `${n} explains itself`);
  }
  assert.deepEqual(byName('propose_metrics_change').inputSchema.required, ['kind']);
  assert.equal(byName('list_team_metrics_runs').inputSchema.properties.limit.maximum, 100);
  assert.match(byName('get_team_metrics').description, /TEAM numbers/);
  assert.match(byName('propose_metrics_change').description, /never changes anything itself/);
});

test('list_projects: the metrics status rides along — one state word per project, home + members per workspace, redacted', async () => {
  const out = await tools.call('list_projects', {});
  assert.deepEqual(out.projects.map((p) => [p.key, p.metrics.state]), [['gw-00000001', 'on'], ['cs-00000002', 'no-origin'], ['nb-00000003', 'not-git'], ['bl-00000004', 'delegated']]);
  assert.deepEqual(out.projects[0].metrics, { state: 'on', slug: 'acme/gateway', delegateTo: null, attribution: 'git-user', record: true, pending: 2, runs: 3, lastError: null, metricsHomeFor: ['Team'] });
  assert.equal(out.projects[3].metrics.record, false);
  assert.ok(!out.projects[3].metrics.lastError.includes('ghp_abcdefghijklmnopqrstuvwxyz'), 'redacted');
  assert.deepEqual(out.workspaces[0].metrics, { home: { state: 'ok', slug: 'acme/gateway', workspaceRuns: 12, record: true, detail: null },
    members: [{ slug: 'acme/gateway', state: 'home', recordsOn: 'acme/gateway', reason: null }, { slug: 'acme/console', state: 'not-recording', recordsOn: null, reason: 'no origin remote' }] });
  // Without the bundle the catalog is unchanged (the pre-metrics shape); a failing status never hides the projects.
  const bare = createAskTools(base);
  assert.deepEqual(Object.keys((await bare.call('list_projects', {})).projects[0]), ['key', 'name', 'path']);
  const broken = createAskTools({ ...base, metrics: { ...fakeMetrics, status: async () => { throw new Error('x'); } } });
  const b = await broken.call('list_projects', {});
  assert.equal(b.projects.length, 4); assert.deepEqual(b.metrics, { error: 'team metrics status unavailable' });
});

test('get_team_metrics: scope from input or the pin, defaults, KPIs + deltas + breakdowns + weekly series + sync, redacted', async () => {
  calls.length = 0; pin = null;
  const out = await tools.call('get_team_metrics', { projectKey: 'gw-00000001', range: 'this-month' });
  assert.deepEqual(calls[0], ['read', { kind: 'project', id: 'gw-00000001' }, { range: 'this-month', from: null, to: null, groupBy: 'workflow', filter: {}, refresh: false }]);
  assert.deepEqual(out.scope, { kind: 'project', id: 'gw-00000001', name: 'gateway', slug: 'acme/gateway', recordedIn: null });
  assert.equal(out.range.name, 'this-month'); assert.ok(out.range.from && out.range.to && out.range.previousFrom);
  assert.deepEqual([out.totalRecords, out.runsInRange, out.kpis.runs, out.kpis.spendUsd, out.kpis.failed], [3, 2, 2, 3.5, 1]);
  assert.equal(out.previous.runs, 1, 'the previous period (August) has the third record');
  assert.equal(typeof out.deltas.spendPct, 'number');
  assert.deepEqual(out.breakdowns.workflow.map((b) => [b.label, b.runs, b.usd]), [['Auto', 1, 2.5], ['Review', 1, 1]]);
  assert.deepEqual(out.breakdowns.actor.map((b) => b.label), ['Ana', 'Ben']);
  assert.equal(out.breakdowns.project, null, 'no workspace records → no project breakdown');
  assert.equal(out.attribution, true);
  assert.ok(out.spendByWeek.length >= 1 && typeof out.spendByWeek[0].weekStart === 'string' && out.spendByWeek.every((w) => typeof w.totalUsd === 'number'));
  assert.equal(out.runsByWeek.length, out.spendByWeek.length);
  assert.deepEqual(out.stackKeys.map((k) => k.key), ['wf_auto', 'wf_review']);
  assert.deepEqual(out.sync.sources[0].pending, 2);
  assert.ok(!out.sync.sources[0].lastError.includes('ghp_abcdefghijklmnopqrstuvwxyz'), 'push errors are redacted');
  assert.deepEqual(out.sync.skipped, { malformed: 1, unknownVersion: 0 });
  assert.equal(out.sync.refreshed, true);
  // The pinned scope is the default; groupBy defaults to workflow for every scope kind (never project).
  calls.length = 0; pin = { workspaceId: 'wks-team-0000abcd' };
  await tools.call('get_team_metrics', { range: 'quarter', groupBy: '', filter: { actor: 'Ana', bogus: 'x' }, refresh: true });
  assert.deepEqual(calls[0][1], { kind: 'workspace', id: 'wks-team-0000abcd' });
  assert.deepEqual(calls[0][2], { range: 'quarter', from: null, to: null, groupBy: 'workflow', filter: { actor: 'Ana', bogus: 'x' }, refresh: true });
  pin = null;
});

test('get_team_metrics: errors the model can act on are AskToolErrors; a real failure is not', async () => {
  await assert.rejects(tools.call('get_team_metrics', {}), (e) => e instanceof AskToolError && /nothing is pinned/.test(e.message));
  await assert.rejects(tools.call('get_team_metrics', { projectKey: 'a-00000001', workspaceId: 'wks-b-00000002' }), (e) => e instanceof AskToolError && /not both/.test(e.message));
  await assert.rejects(tools.call('get_team_metrics', { projectKey: 'missing-00000000' }), (e) => e instanceof AskToolError && /unknown project/.test(e.message));
  await assert.rejects(tools.call('get_team_metrics', { projectKey: 'off-00000000' }), (e) => e instanceof AskToolError && /not enabled/.test(e.message) && /list_projects/.test(e.message));
  await assert.rejects(tools.call('get_team_metrics', { projectKey: 'gw-00000001', range: 'week' }), (e) => e instanceof AskToolError && /unknown range/.test(e.message));
  await assert.rejects(tools.call('get_team_metrics', { projectKey: 'boom-00000000' }), (e) => !(e instanceof AskToolError) && /disk on fire/.test(e.message));
  const bare = createAskTools(base);
  await assert.rejects(bare.call('get_team_metrics', { projectKey: 'gw-00000001' }), (e) => e instanceof AskToolError && /unavailable/.test(e.message));
});

test('list_team_metrics_runs: newest first, paged, `local` per row, titles redacted', async () => {
  const out = await tools.call('list_team_metrics_runs', { projectKey: 'gw-00000001', range: 'all', limit: 2 });
  assert.deepEqual([out.total, out.offset, out.nextOffset, out.truncated], [3, 0, 2, true]);
  assert.deepEqual(out.rows.map((r) => [r.id, r.local, r.result, r.usd, r.actor]), [['aaaa0002', true, 'failed', 1, 'Ben'], ['aaaa0001', false, 'done', 2.5, 'Ana']]);
  assert.ok(!out.rows[1].title.includes('ghp_abcdefghijklmnopqrstuvwxyz'), 'titles are redacted');
  assert.equal(out.rows[0].workflow, 'Review');
  const page2 = await tools.call('list_team_metrics_runs', { projectKey: 'gw-00000001', range: 'all', limit: 2, offset: 2 });
  assert.deepEqual([page2.rows.map((r) => r.id), page2.truncated, page2.nextOffset], [['aaaa0003'], false, 3]);
  const clamped = await tools.call('list_team_metrics_runs', { projectKey: 'gw-00000001', range: 'all', limit: 999 });
  assert.equal(clamped.rows.length, 3);
});

test('push_team_metrics: a scope, the pin, or all:true; results redacted; a bad request is an AskToolError', async () => {
  calls.length = 0;
  const out = await tools.call('push_team_metrics', { workspaceId: 'wks-team-0000abcd' });
  assert.deepEqual(calls[0], ['flush', { scope: { kind: 'workspace', id: 'wks-team-0000abcd' }, all: false }]);
  assert.deepEqual(out.results.map((r) => [r.slug, r.ok, r.code, r.pending, r.pushed, r.hint]), [['acme/gateway', false, 'PUSH_REJECTED', 2, 0, 'exempt worca-metrics']]);
  assert.ok(!out.results[0].error.includes('ghp_abcdefghijklmnopqrstuvwxyz'));
  calls.length = 0;
  await tools.call('push_team_metrics', { all: true });
  assert.deepEqual(calls[0], ['flush', { scope: null, all: true }]);
  await assert.rejects(tools.call('push_team_metrics', {}), (e) => e instanceof AskToolError && /nothing is pinned/.test(e.message));
  const failing = createAskTools({ ...base, metrics: { ...fakeMetrics, flush: async () => { throw Object.assign(new Error('a project, a workspace or all:true is required'), { code: 'BAD_REQUEST' }); } } });
  await assert.rejects(failing.call('push_team_metrics', { projectKey: 'gw-00000001' }), (e) => e instanceof AskToolError);
});

test('propose_metrics_change: validates only, the pinned scope fills the matching target kind, {ok:false} passes through', async () => {
  calls.length = 0; pin = null;
  const r = await tools.call('propose_metrics_change', { kind: 'record', projectKey: 'gw-00000001', record: false });
  assert.deepEqual(r, { ok: true, card: { type: 'metrics', kind: 'record', projectKey: 'gw-00000001', record: false } });
  assert.deepEqual(await tools.call('propose_metrics_change', { kind: 'enable', projectKey: 'gw-00000001' }), { ok: false, errors: ['nope'] });
  pin = { projectKey: 'gw-00000001' }; calls.length = 0;
  await tools.call('propose_metrics_change', { kind: 'record', record: true });
  assert.deepEqual(calls[0][1], { kind: 'record', record: true, projectKey: 'gw-00000001' }, 'a pinned project fills enable/record');
  calls.length = 0;
  await tools.call('propose_metrics_change', { kind: 'route_members' });
  assert.deepEqual(calls[0][1], { kind: 'route_members' }, 'a pinned project is no target for a workspace kind');
  pin = { workspaceId: 'wks-team-0000abcd' }; calls.length = 0;
  await tools.call('propose_metrics_change', { kind: 'workspace_home', homeProjectKey: '' });
  assert.deepEqual(calls[0][1], { kind: 'workspace_home', homeProjectKey: '', workspaceId: 'wks-team-0000abcd' });
  pin = null;
  await assert.rejects(tools.call('propose_metrics_change', 'x'), (e) => e instanceof AskToolError);
});

test('source scan: the tools module still issues no writes; the deps bundle is the only file naming the metrics core', () => {
  const src = readFileSync(new URL('../src/core/ask/tools.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /\b(INSERT|UPDATE|DELETE)\b/);
  assert.doesNotMatch(src, /metrics\/(sync|read)\.mjs|outboxDir|slugDirName|worca-metrics\//, 'no metrics mechanics leak into the tool layer');
  const deps = readFileSync(new URL('../src/core/ask/metrics-deps.mjs', import.meta.url), 'utf8');
  assert.match(deps, /export async function applyMetricsChange/);
  assert.match(deps, /export function defaultMetricsDeps/);
});
