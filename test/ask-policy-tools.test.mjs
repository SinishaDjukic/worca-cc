// test/ask-policy-tools.test.mjs
// The team-policy side of the Ask Worca tools (docs/team-policy.md "Ask Worca") over a fake
// deps.policy bundle: list_projects' `policy` field, get_team_policy's shape (rows, the
// workspaceRuns block, catalogs, plugins, deviations, the pinned default, the no-policy answer),
// propose_policy_change's pin fill, get_run's policy block and a team-cap pause, and the policy
// fields on the team-metrics tools.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAskTools, AskToolError } from '../src/core/ask/tools.mjs';
import { ASK_LIMITS } from '../src/core/ask/limits.mjs';
import { redactAskText } from '../src/core/ask/redact.mjs';
import { effectiveRows, capSummary } from '../src/core/policy/effective.mjs';
import { FIELDS } from '../src/core/policy/registry.mjs';
import { aggregate } from '../src/shared/team-metrics/aggregate.mjs';
import { makeRecord } from './fixtures/team-metrics/records.mjs';

const SECRET = 'ghp_abcdefghijklmnopqrstuvwxyz0123456789';
const DOC = {
  schema: 1, title: 'Gateway team policy', notes: `Ask Mara before raising caps. token ${SECRET}`, updatedAt: '2026-09-01T00:00:00Z', updatedBy: 'Mara Lindqvist',
  fields: {
    'cost.pipelineLimitUsd': { kind: 'soft', value: 10, onBreach: 'pause', requireReason: true },
    'guardrails.default': { kind: 'default', value: 'gp:gateway-normal' },
    'models.allowed': { kind: 'soft', value: ['claude-opus-5-5'] },
    'plugins.required': { kind: 'soft', value: [{ name: 'jira', marketplace: 'acme', minVersion: '1.2.0' }] },
  },
  workspaceRuns: { 'cost.pipelineLimitUsd': { kind: 'soft', value: 25 }, 'guardrails.default': { kind: 'default', value: 'secure' } },
  catalogs: { guardrailSets: [{ id: 'gateway-normal', name: 'Gateway normal' }], models: [{ id: 'acme-proxy-opus', label: 'Opus via Acme', efforts: ['medium', 'high'] }] },
};
const LOCAL = { 'cost.pipelineLimitUsd': { value: 50, set: true }, 'guardrails.default': { value: null, set: false } };
const payload = (scope, workspaceRun) => ({
  scope, policy: { home: 'acme/gateway', homeKey: 'gw-00000001', sha: '0123456789abcdef0123', delegated: scope.id === 'bl-00000002', from: scope.id === 'bl-00000002' ? 'acme/billing' : 'acme/gateway',
    warnings: [], checkedAt: '2026-09-18T10:00:00Z', doc: DOC, caps: capSummary(DOC, { workspaceRun }), workspaceRun },
  rows: effectiveRows({ doc: DOC, workspaceRun, local: LOCAL }), local: LOCAL,
  requirements: [{ name: 'jira', marketplace: 'acme', minVersion: '1.2.0', state: 'outdated', installed: { version: '1.1.0', enabled: true } }],
  blockedPlugins: [], worcaVersion: '1.4.0', registry: FIELDS, canPublish: scope.id === 'gw-00000001',
  deviations: [{ code: 'plugin-outdated:jira', level: 'warn', text: 'Required plugin jira is 1.1.0; the team expects at least 1.2.0.' }],
});
const STATUS = {
  projects: [
    { key: 'gw-00000001', exists: true, hasOrigin: true, present: true, delegateTo: null, delegateState: null, blocked: null, unknownSchema: false, slug: 'acme/gateway', home: 'acme/gateway', title: 'Gateway team policy', sha: '0123456789abcdef', fieldCount: 6, caps: capSummary(DOC) },
    { key: 'bl-00000002', exists: true, hasOrigin: true, present: true, delegateTo: 'acme/gateway', delegateState: 'ok', blocked: null, slug: 'acme/billing', home: 'acme/gateway', fieldCount: 6, caps: capSummary(DOC) },
    { key: 'ed-00000003', exists: true, hasOrigin: true, present: false, slug: 'acme/edge', home: null, fieldCount: 0, caps: null },
    { key: 'cs-00000004', exists: true, hasOrigin: true, present: true, delegateTo: 'acme/nowhere', delegateState: 'invalid', delegateDetail: 'follows acme/nowhere, which is not a project in Worca on this machine', blocked: 'DELEGATE_UNKNOWN', slug: 'acme/console', home: null },
    { key: 'nb-00000005', exists: true, hasOrigin: false, present: false, slug: null, home: null },
  ],
  workspaces: [{ id: 'wks-iot-0000abcd', name: 'IoT', home: { state: 'ok', path: '/p/gateway', slug: 'acme/gateway', follows: null, workspaceRuns: [{ key: 'cost.pipelineLimitUsd', label: 'Per-pipeline cap (USD)', display: '$25.00' }] },
    members: [{ path: '/p/gateway', slug: 'acme/gateway', state: 'home', policyFrom: 'acme/gateway' }, { path: '/p/edge', slug: 'acme/edge', state: 'none', policyFrom: null }] }],
};
const calls = [];
let pin = null;
const fakePolicy = {
  status: async () => { calls.push(['status']); return STATUS; },
  async read(scope) {
    calls.push(['read', scope]);
    if (scope.id === 'missing-00000000') throw Object.assign(new Error('unknown project missing-00000000'), { code: 'NOT_FOUND' });
    if (scope.id === 'ed-00000003') return { scope: { kind: 'project', id: scope.id, name: 'edge' }, policy: null, reason: 'not-enabled', code: null, detail: null };
    const name = scope.kind === 'workspace' ? 'IoT' : scope.id === 'gw-00000001' ? 'gateway' : 'billing';
    return payload({ kind: scope.kind, id: scope.id, name }, scope.kind === 'workspace');
  },
  validateChange: async (input) => { calls.push(['validate', input]); return { ok: true, card: { type: 'policy', ...input } }; },
};
const CATALOG = {
  projects: [{ key: 'gw-00000001', name: 'gateway', path: '/p/gw' }, { key: 'bl-00000002', name: 'billing', path: '/p/bl' }, { key: 'ed-00000003', name: 'edge', path: '/p/ed' },
    { key: 'cs-00000004', name: 'console', path: '/p/cs' }, { key: 'nb-00000005', name: 'notes', path: '/p/nb' }],
  workspaces: [{ id: 'wks-iot-0000abcd', name: 'IoT', projectKeys: ['gw-00000001', 'ed-00000003'] }], workflows: [],
};
const RUN_ROW = (over = {}) => ({ id: 'aaaa0001', project_key: 'gw-00000001', title: 'Fix login', status: 'paused', started_at: '2026-09-18T09:00:00Z', branch: '{}', ...over });
const base = {
  buildCatalog: async () => CATALOG, pinnedScope: () => pin, redact: redactAskText, limits: ASK_LIMITS,
  readStoreMeta: () => ({ name: 'gateway' }), totalsFor: () => ({ cost: 10.4 }), hasDiffPatch: async () => false,
  findPipelineRowById: (id) => ROWS[id] || null, lookupPipelineRow: () => null,
};
const ROWS = {
  aaaa0001: RUN_ROW({ policy_state: JSON.stringify({ home: 'acme/gateway', sha: 'abc1234def5678', overrides: [], exceeded: [], deviations: ['model:claude-opus-4-8'], unattended: false, reason: null }),
    resume_point: JSON.stringify({ pauseReason: 'cost_pipeline_policy', pauseDetail: 'team cost cap reached ($10.00 >= $10.00, acme/gateway)' }) }),
  aaaa0002: RUN_ROW({ id: 'aaaa0002', status: 'done', policy_state: JSON.stringify({ home: 'acme/gateway', overrides: ['pipeline'], reason: `release hotfix ${SECRET}` }), resume_point: JSON.stringify({ pauseReason: 'cost_pipeline_policy' }) }),
  aaaa0003: RUN_ROW({ id: 'aaaa0003', status: 'paused', resume_point: JSON.stringify({ pauseReason: 'cost_total_policy', pauseDetail: 'team total cap reached ($160.00 >= $150.00 this month, acme/gateway)' }) }),
  aaaa0004: RUN_ROW({ id: 'aaaa0004', status: 'paused', resume_point: JSON.stringify({ pauseReason: 'cost_pipeline' }) }),
};
const tools = createAskTools({ ...base, policy: fakePolicy });

test('defs: get_team_policy and propose_policy_change sit after the metrics tools; propose requires kind; nested set/unset schemas', () => {
  const names = tools.list().map((d) => d.name);
  assert.deepEqual(names.slice(names.indexOf('propose_metrics_change'), names.indexOf('propose_metrics_change') + 3), ['propose_metrics_change', 'get_team_policy', 'propose_policy_change']);
  const byName = (n) => tools.list().find((d) => d.name === n);
  assert.deepEqual(byName('propose_policy_change').inputSchema.required, ['kind']);
  assert.equal(byName('propose_policy_change').inputSchema.additionalProperties, false);
  assert.deepEqual(byName('propose_policy_change').inputSchema.properties.set.items.required, ['key', 'value']);
  assert.match(byName('propose_policy_change').description, /never changes anything itself/);
  assert.match(byName('get_team_policy').description, /Read-only/);
  assert.match(byName('get_team_metrics').description, /offPolicyRuns, capOverrides/);
  assert.match(byName('list_team_metrics_runs').description, /`policy` on a run recorded under a team policy/);
});

test('list_projects: every project and workspace carries its policy status; no bundle = the old shape', async () => {
  const out = await tools.call('list_projects', {});
  const by = Object.fromEntries(out.projects.map((p) => [p.key, p.policy]));
  assert.deepEqual(by['gw-00000001'], { state: 'carries', slug: 'acme/gateway', home: 'acme/gateway', follows: null, title: 'Gateway team policy', sha: '0123456789ab', fieldCount: 6,
    caps: { pipeline: { kind: 'soft', value: 10, onBreach: 'pause', requireReason: true }, total: null, resetPeriod: null, pooled: null }, detail: null });
  assert.equal(by['bl-00000002'].state, 'follows'); assert.equal(by['bl-00000002'].follows, 'acme/gateway');
  assert.equal(by['ed-00000003'].state, 'off');
  assert.equal(by['cs-00000004'].state, 'follow-invalid'); assert.match(by['cs-00000004'].detail, /not a project in Worca/);
  assert.equal(by['nb-00000005'].state, 'no-origin');
  assert.deepEqual(out.workspaces[0].policy, {
    home: { state: 'ok', slug: 'acme/gateway', project: 'gateway', follows: null, detail: null, workspaceRuns: [{ key: 'cost.pipelineLimitUsd', label: 'Per-pipeline cap (USD)', value: '$25.00' }] },
    members: [{ slug: 'acme/gateway', state: 'home', policyFrom: 'acme/gateway' }, { slug: 'acme/edge', state: 'none', policyFrom: null }],
  });
  assert.equal(out.metrics, undefined, 'no metrics bundle, no metrics key');
  const failing = createAskTools({ ...base, policy: { ...fakePolicy, status: async () => { throw new Error('db locked'); } } });
  const f = await failing.call('list_projects', {});
  assert.deepEqual(f.policy, { error: 'team policy status unavailable' });
  assert.equal(f.projects.length, 5, 'a status failure never hides the projects');
  assert.deepEqual(await createAskTools(base).call('list_projects', {}), { projects: CATALOG.projects, workspaces: CATALOG.workspaces });
});

test('get_team_policy (project): home, follows, rows with kind / team / local / effective / source, the workspaceRuns block, catalogs, plugins, deviations', async () => {
  calls.length = 0; pin = null;
  const out = await tools.call('get_team_policy', { projectKey: 'bl-00000002' });
  assert.deepEqual(calls[0], ['read', { kind: 'project', id: 'bl-00000002' }]);
  assert.deepEqual(out.scope, { kind: 'project', id: 'bl-00000002', name: 'billing' });
  assert.equal(out.runKind, 'single-project runs');
  assert.deepEqual([out.policy.home, out.policy.follows, out.policy.from, out.policy.sha, out.policy.updatedBy], ['acme/gateway', 'acme/gateway', 'acme/billing', '0123456789ab', 'Mara Lindqvist']);
  assert.ok(!out.policy.notes.includes(SECRET), 'notes are untrusted and redacted');
  assert.deepEqual(out.fields.map((f) => f.key), ['cost.pipelineLimitUsd', 'guardrails.default', 'models.allowed', 'plugins.required'], 'only the fields the policy sets');
  const cap = out.fields[0];
  assert.deepEqual([cap.kind, cap.team, cap.teamValue, cap.local, cap.effective, cap.source, cap.onBreach, cap.requireReason], ['soft', '$10.00', 10, '$50.00', '$10.00', 'team', 'pause', true]);
  assert.match(cap.note, /yours \(\$50\.00\) is looser; the team cap applies/);
  assert.equal(cap.fromWorkspaceRuns, undefined, 'a project scope has no workspace-run flag');
  const gd = out.fields[1];
  assert.deepEqual([gd.kind, gd.team, gd.local, gd.effective, gd.source], ['default', 'gp:gateway-normal', '—', 'gp:gateway-normal', 'team-default']);
  assert.deepEqual(out.workspaceRuns.map((w) => [w.key, w.kind, w.value]), [['cost.pipelineLimitUsd', 'soft', 25], ['guardrails.default', 'default', 'secure']]);
  assert.deepEqual(out.catalogs, { guardrailSets: [{ id: 'gp:gateway-normal', name: 'Gateway normal' }], models: [{ id: 'acme-proxy-opus', label: 'Opus via Acme', efforts: ['medium', 'high'] }] });
  assert.deepEqual(out.plugins.required, [{ name: 'jira', marketplace: 'acme', minVersion: '1.2.0', state: 'outdated', installedVersion: '1.1.0' }]);
  assert.deepEqual(out.deviations.map((d) => d.code), ['plugin-outdated:jira']);
  assert.equal(out.canPublish, false, 'billing follows; the home is where publishing happens');
  const all = await tools.call('get_team_policy', { projectKey: 'gw-00000001', all: true });
  assert.equal(all.fields.length, FIELDS.length, 'all:true lists every field');
  assert.equal(all.fields.find((f) => f.key === 'run.humanInLoop').kind, null);
  assert.equal(all.canPublish, true);
});

test('get_team_policy (workspace, pinned): rows for workspace runs flag what the block changes', async () => {
  pin = { workspaceId: 'wks-iot-0000abcd' }; calls.length = 0;
  const out = await tools.call('get_team_policy', {});
  assert.deepEqual(calls[0], ['read', { kind: 'workspace', id: 'wks-iot-0000abcd' }]);
  assert.equal(out.runKind, 'workspace runs');
  const cap = out.fields.find((f) => f.key === 'cost.pipelineLimitUsd');
  assert.deepEqual([cap.team, cap.fromWorkspaceRuns], ['$25.00', true]);
  assert.equal(out.fields.find((f) => f.key === 'models.allowed').fromWorkspaceRuns, false);
  assert.equal(out.workspaceRuns.find((w) => w.key === 'guardrails.default').display, 'Strict');
  assert.deepEqual(out.caps.pipeline, { kind: 'soft', value: 25, onBreach: 'pause', requireReason: false });
  pin = null;
});

test('get_team_policy: no policy answers policy:null with the reason; scope errors are AskToolErrors; no bundle = unavailable', async () => {
  assert.deepEqual(await tools.call('get_team_policy', { projectKey: 'ed-00000003' }), { scope: { kind: 'project', id: 'ed-00000003', name: 'edge' }, policy: null, reason: 'not-enabled', code: null, detail: null });
  await assert.rejects(tools.call('get_team_policy', {}), (e) => e instanceof AskToolError && /nothing is pinned/.test(e.message));
  await assert.rejects(tools.call('get_team_policy', { projectKey: 'a-00000001', workspaceId: 'wks-b-00000002' }), (e) => e instanceof AskToolError && /not both/.test(e.message));
  await assert.rejects(tools.call('get_team_policy', { projectKey: 'missing-00000000' }), (e) => e instanceof AskToolError && /unknown project/.test(e.message));
  await assert.rejects(createAskTools(base).call('get_team_policy', { projectKey: 'gw-00000001' }), (e) => e instanceof AskToolError && /team policy is unavailable/.test(e.message));
  await assert.rejects(createAskTools(base).call('propose_policy_change', { kind: 'edit' }), (e) => e instanceof AskToolError && /unavailable/.test(e.message));
});

test('propose_policy_change: validates only; the pin fills a target of a fitting kind', async () => {
  calls.length = 0; pin = null;
  const r = await tools.call('propose_policy_change', { kind: 'edit', projectKey: 'gw-00000001', set: [{ key: 'cost.pipelineLimitUsd', value: 30 }] });
  assert.equal(r.ok, true); assert.equal(r.card.type, 'policy');
  pin = { projectKey: 'gw-00000001' }; calls.length = 0;
  await tools.call('propose_policy_change', { kind: 'edit', set: [] });
  assert.equal(calls[0][1].projectKey, 'gw-00000001', 'a pinned project fills edit');
  calls.length = 0;
  await tools.call('propose_policy_change', { kind: 'route_members' });
  assert.equal(calls[0][1].projectKey, undefined, 'a pinned project is no target for a workspace kind');
  assert.equal(calls[0][1].workspaceId, undefined);
  pin = { workspaceId: 'wks-iot-0000abcd' }; calls.length = 0;
  await tools.call('propose_policy_change', { kind: 'edit' });
  await tools.call('propose_policy_change', { kind: 'enable' });
  assert.equal(calls[0][1].workspaceId, 'wks-iot-0000abcd', 'a pinned workspace fills edit');
  assert.equal(calls[1][1].workspaceId, undefined, 'a pinned workspace is no target for enable');
  await tools.call('propose_policy_change', { kind: 'edit', projectKey: 'bl-00000002' });
  assert.equal(calls[2][1].projectKey, 'bl-00000002'); assert.equal(calls[2][1].workspaceId, undefined, 'an explicit target wins');
  pin = null;
});

test('get_run: the policy state and a team-cap pause with its meaning; nothing for a run without either', async () => {
  const a = await tools.call('get_run', { id: 'aaaa0001' });
  assert.deepEqual(a.policy, {
    home: 'acme/gateway', sha: 'abc1234def56', overrides: [], exceeded: [], deviations: ['model:claude-opus-4-8'], unattended: false, reason: null,
    pause: { reason: 'cost_pipeline_policy', detail: 'team cost cap reached ($10.00 >= $10.00, acme/gateway)', meaning: a.policy.pause.meaning },
  });
  assert.match(a.policy.pause.meaning, /per-pipeline cap.*Continue past team cap/);
  const b = await tools.call('get_run', { id: 'aaaa0002' });
  assert.equal(b.policy.pause, undefined, 'a done run shows no pause');
  assert.deepEqual(b.policy.overrides, ['pipeline']);
  assert.ok(!b.policy.reason.includes(SECRET), 'the override reason is redacted');
  const c = await tools.call('get_run', { id: 'aaaa0003' });
  assert.equal(c.policy.home, null); assert.match(c.policy.pause.meaning, /total cap for this period/);
  const d = await tools.call('get_run', { id: 'aaaa0004' });
  assert.equal('policy' in d, false, 'the developer\'s own cap is not a policy pause');
});

test('team metrics: runs rows carry the run\'s policy; breakdown rows carry overrides / offPolicy', async () => {
  const NOW = Date.parse('2026-09-16T12:00:00Z');
  const records = [
    { ...makeRecord({ id: 'polrec01', startedAt: '2026-09-10T10:00:00Z', usd: 12.4, actor: 'Mara' }), policy: { home: 'acme/gateway', sha: 'abc', overrides: ['pipeline'], exceeded: [], deviations: ['model:x'], unattended: false, reason: `hotfix ${SECRET}` } },
    makeRecord({ id: 'polrec02', startedAt: '2026-09-11T10:00:00Z', usd: 3, actor: 'Jonas' }),
  ];
  const READ = { scope: { kind: 'project', id: 'gw-00000001', name: 'gateway', slug: 'acme/gateway', recordedIn: null }, records, stats: { files: 2, malformed: 0, unknownV: 0 }, sinks: ['acme/gateway'], sync: [], refresh: null, fetchError: null };
  const metrics = { read: async (scope, opts) => ({ read: READ, agg: aggregate(records, { ...opts, now: NOW }) }), isLocalRun: () => false, status: async () => ({ projects: [], workspaces: [] }) };
  const t = createAskTools({ ...base, metrics });
  const runs = await t.call('list_team_metrics_runs', { projectKey: 'gw-00000001', range: 'all' });
  const r1 = runs.rows.find((r) => r.id === 'polrec01');
  assert.deepEqual({ ...r1.policy, reason: r1.policy.reason.includes(SECRET) }, { home: 'acme/gateway', overrides: ['pipeline'], exceeded: [], deviations: ['model:x'], unattended: false, reason: false });
  assert.equal('policy' in runs.rows.find((r) => r.id === 'polrec02'), false);
  const m = await t.call('get_team_metrics', { projectKey: 'gw-00000001', range: 'all', groupBy: 'actor' });
  assert.deepEqual([m.kpis.offPolicyRuns, m.kpis.capOverrides, m.kpis.deviations, m.kpis.policyRuns], [1, 1, 1, 1]);
  const mara = m.breakdowns.actor.find((b) => b.label === 'Mara');
  assert.deepEqual([mara.overrides, mara.offPolicy], [1, 1]);
  assert.equal('overrides' in m.breakdowns.actor.find((b) => b.label === 'Jonas'), false);
});
