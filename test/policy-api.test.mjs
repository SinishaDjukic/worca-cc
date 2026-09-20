// test/policy-api.test.mjs
// The team-policy routes (team-policy design §11) against a real bare origin: enable / follow,
// scopes, the effective payload, notes, validate, publish (and a verbatim rejection), the
// workspace policy home, and the run / resume gates' refusals.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { makeOrigin, cloneAs, useGitSandbox, rejectAllPushes, git } from './helpers/metrics-git.mjs';
import { seedPipeline } from './helpers/db-seed.mjs';
import { graphResumePoint } from './helpers/graph-templates.mjs';
import { projectKey } from '../src/core/store.mjs';
import { writeTeamPolicyPrefs } from '../src/core/config.mjs';
import { recordCostDelta } from '../src/core/cost-budget.mjs';
import { readPolicyState } from '../src/core/policy/state.mjs';
import { POLICY_BRANCH, POLICY_FILE } from '../src/core/policy/sync.mjs';

const skip = process.platform === 'win32';
useTempHome(after);
const root = mkdtempSync(join(tmpdir(), 'worca-policy-api-'));
let srv, base, mod;
const JSONH = { 'Content-Type': 'application/json' };
const get = (p) => fetch(`${base}${p}`);
const post = (p, body) => fetch(`${base}${p}`, { method: 'POST', headers: JSONH, body: JSON.stringify(body ?? {}) });
const put = (p, body) => fetch(`${base}${p}`, { method: 'PUT', headers: JSONH, body: JSON.stringify(body ?? {}) });
const patch = (p, body) => fetch(`${base}${p}`, { method: 'PATCH', headers: JSONH, body: JSON.stringify(body) });

useGitSandbox(before, after);   // FIRST: the server resolves settings under HOME
before(async () => {
  mod = await import('../ui/server.mjs');
  srv = http.createServer(mod.app);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
});
after(async () => { if (srv) await new Promise((r) => srv.close(r)); mod?.runs.clear(); rmSync(root, { recursive: true, force: true }); });

let gwBare, gw, bl, gwKey, blKey, wsId;

test('empty: scopes says nothing enabled; GET /api/policy answers 404 with a code', async () => {
  const r = await get('/api/policy/scopes');
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.anyEnabled, false); assert.deepEqual(j.homes, []); assert.deepEqual(j.requirements, []);
  assert.equal((await get('/api/policy')).status, 400);
  assert.equal((await get('/api/policy?scope=project:bogus')).status, 400);
  const nf = await get('/api/policy?scope=project:abc-0123abcd');
  assert.equal(nf.status, 404);
});

test('enable here → scopes → the effective payload; notes; validate', { skip }, async () => {
  gwBare = makeOrigin(root, 'gateway'); gw = cloneAs(root, 'm', gwBare, 'gateway');
  bl = cloneAs(root, 'm', makeOrigin(root, 'billing'), 'billing');
  for (const [name, path] of [['gateway', gw], ['billing', bl]]) assert.equal((await post('/api/projects', { name, path })).status, 200);
  const projects = (await (await get('/api/projects')).json()).projects;
  gwKey = projects.find((p) => p.name === 'gateway').key; blKey = projects.find((p) => p.name === 'billing').key;

  assert.equal((await post(`/api/projects/${gwKey}/policy/enable`, { mode: 'nope' })).status, 400);
  const en = await post(`/api/projects/${gwKey}/policy/enable`, { mode: 'here', title: 'Gateway team policy' });
  assert.equal(en.status, 200, await en.clone().text());
  const ej = await en.json();
  assert.equal(ej.action, 'created'); assert.equal(ej.status.present, true); assert.equal(ej.status.home, 'gateway'); assert.equal(ej.status.carries, true);

  const scopes = await (await get('/api/policy/scopes')).json();
  assert.equal(scopes.anyEnabled, true);
  assert.deepEqual(scopes.scopes.projects.map((s) => s.id), [`project:${gwKey}`]);
  assert.deepEqual(scopes.homes.map((h) => h.slug), ['gateway']);

  const r = await get(`/api/policy?scope=project:${gwKey}`);
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.scope.kind, 'project'); assert.equal(j.policy.home, 'gateway'); assert.equal(j.policy.delegated, false); assert.equal(j.canPublish, true);
  assert.ok(Array.isArray(j.rows) && j.rows.length >= 18); assert.ok(j.registry.length === j.rows.length);
  assert.equal(j.rows.filter((x) => x.shown).length, 0, 'an empty policy shows no rows');
  assert.equal(j.policy.doc.title, 'Gateway team policy');

  const notes = await (await get(`/api/policy/notes?scope=project:${gwKey}&guardrailsId=permissive`)).json();
  assert.equal(notes.policy.home, 'gateway'); assert.deepEqual(notes.notes, []);
  const v = await (await post('/api/policy/validate', { doc: { schema: 1, fields: { 'cost.pipelineLimitUsd': { kind: 'soft', value: 'x' } } } })).json();
  assert.equal(v.ok, false); assert.equal(v.warnings.length, 1);
});

test('publish → rows show the fold with local settings; a hand-posted bad doc is 400 with warnings', { skip }, async () => {
  const doc = { schema: 1, title: 'Gateway team policy', fields: {
    'cost.pipelineLimitUsd': { kind: 'soft', value: 10, onBreach: 'pause' },
    'guardrails.minimum': { kind: 'soft', value: 'normal' },
    'models.allowed': { kind: 'soft', value: ['claude-opus-5'] },
    'plugins.required': { kind: 'soft', value: [{ name: 'acme-jira', minVersion: '1.2.0' }] },
  }, workspaceRuns: { 'cost.pipelineLimitUsd': { kind: 'soft', value: 25 } } };
  const bad = await put('/api/policy', { scope: `project:${gwKey}`, doc: { schema: 1, fields: { 'cost.pipelineLimitUsd': { kind: 'soft', value: -1 } } } });
  assert.equal(bad.status, 400); assert.equal((await bad.json()).warnings.length, 1);
  const pub = await put('/api/policy', { scope: `project:${gwKey}`, doc, message: 'caps' });
  assert.equal(pub.status, 200, await pub.clone().text());
  const pj = await pub.json();
  assert.equal(pj.ok, true); assert.equal(pj.unchanged, false); assert.ok(pj.sha);
  assert.equal(git(gwBare, 'rev-list', '--count', POLICY_BRANCH), '2');

  await (await post('/api/settings', { pipelineCostLimitUsd: 25 })).json();
  const j = await (await get(`/api/policy?scope=project:${gwKey}`)).json();
  const cap = j.rows.find((x) => x.key === 'cost.pipelineLimitUsd');
  assert.equal(cap.team.display, '$10.00'); assert.equal(cap.local.display, '$25.00'); assert.equal(cap.effective.source, 'team'); assert.match(cap.note, /looser/);
  assert.deepEqual(j.requirements.map((q) => [q.name, q.state]), [['acme-jira', 'missing']]);
  assert.equal(j.policy.caps.pipeline.value, 10);

  const notes = await (await get(`/api/policy/notes?scope=project:${gwKey}&guardrailsId=permissive&models=claude-opus-4-8`)).json();
  assert.deepEqual(notes.notes.map((n) => n.code), ['guardrails:permissive<normal', 'model:claude-opus-4-8', 'plugin-missing:acme-jira']);
  await post('/api/settings', { pipelineCostLimitUsd: '' });
});

test('follow: billing follows gateway; its scope reads the home doc and cannot publish', { skip }, async () => {
  const en = await post(`/api/projects/${blKey}/policy/enable`, { mode: 'follow', delegateTo: 'gateway' });
  assert.equal(en.status, 200, await en.clone().text());
  const ej = await en.json();
  assert.equal(ej.status.delegateState, 'ok'); assert.equal(ej.status.home, 'gateway'); assert.equal(ej.status.homeKey, gwKey);
  const j = await (await get(`/api/policy?scope=project:${blKey}`)).json();
  assert.equal(j.policy.delegated, true); assert.equal(j.policy.from, 'billing'); assert.equal(j.policy.home, 'gateway');
  assert.equal(j.canPublish, true, 'the home is checked out here, so publishing goes to the home');
  const st = await (await get(`/api/projects/${blKey}/policy`)).json();
  assert.equal(st.status.fieldCount, 5);
  assert.equal((await post(`/api/projects/${blKey}/policy/enable`, { mode: 'follow', delegateTo: 'billing' })).status, 400);
});

test('workspace: PATCH policyProject, scope payload uses workspaceRuns, route all members', { skip }, async () => {
  const edge = cloneAs(root, 'm', makeOrigin(root, 'edge'), 'edge');
  assert.equal((await post('/api/projects', { name: 'edge', path: edge })).status, 200);
  const cr = await post('/api/workspaces', { name: 'IoT Platform', projectPaths: [gw, bl, edge] });
  assert.equal(cr.status, 201, await cr.clone().text());
  const ws = (await cr.json()).workspace; wsId = ws.id;
  assert.equal(ws.policyProject, gw, 'auto-picked: every resolving member shares the gateway home');
  assert.equal((await patch(`/api/workspaces/${wsId}`, { policyProject: 42 })).status, 400);
  assert.equal((await patch(`/api/workspaces/${wsId}`, { policyProject: '/nope' })).status, 400);
  const up = await patch(`/api/workspaces/${wsId}`, { policyProject: bl });
  assert.equal(up.status, 200); assert.equal((await up.json()).workspace.policyProject, bl);
  const j = await (await get(`/api/policy?scope=workspace:${wsId}`)).json();
  assert.equal(j.policy.workspaceRun, true); assert.equal(j.policy.caps.pipeline.value, 25);
  assert.equal(j.rows.find((x) => x.key === 'cost.pipelineLimitUsd').team.fromWorkspaceRuns, true);
  const scopes = await (await get('/api/policy/scopes')).json();
  const w = scopes.workspaces.find((x) => x.id === wsId);
  assert.equal(w.home.state, 'ok'); assert.equal(w.home.slug, 'gateway'); assert.equal(w.home.follows, 'billing');
  const routed = await (await post(`/api/workspaces/${wsId}/policy-route`)).json();
  assert.deepEqual(routed.results.map((x) => [x.slug, x.result]).sort(), [['edge', 'routed'], ['gateway', 'skipped']]);
});

test('publish against a protected branch: 409 PUSH_REJECTED with stderr and the rights hint', { skip }, async () => {
  rejectAllPushes(gwBare, 'GH006: Protected branch update failed');
  const r = await put('/api/policy', { scope: `project:${gwKey}`, doc: { schema: 1, fields: { 'worca.minVersion': { kind: 'soft', value: '1.4.0' } } } });
  assert.equal(r.status, 409);
  const j = await r.json();
  assert.equal(j.code, 'PUSH_REJECTED'); assert.match(j.stderr, /GH006/); assert.match(j.hint, /push rights/);
});

test('run and resume gates: 403 with needsPolicyAck / needsPolicyOverride, 400 reason_required, then through', { skip }, async () => {
  // Cache a policy with a tiny total cap that requires a reason (no git: the resolver reads the cache).
  writeTeamPolicyPrefs(projectKey(gw), { doc: { schema: 1, fields: { 'cost.totalLimitUsd': { kind: 'soft', value: 1, requireReason: true }, 'cost.pipelineLimitUsd': { kind: 'soft', value: 1 } }, workspaceRuns: {}, catalogs: { guardrailSets: [], models: [] } }, acks: {} });
  const { id: spent } = await seedPipeline(gw, { title: 'spent', status: 'done' });
  recordCostDelta({ pipelineId: spent, amountUsd: 1.5, tsMs: Date.now() });
  let r = await post('/api/run', { projectDir: gw, prompt: 'x', mock: true });
  assert.equal(r.status, 403);
  let j = await r.json();
  assert.equal(j.code, 'team_total'); assert.equal(j.needsPolicyAck, true); assert.equal(j.policy.home, 'gateway'); assert.equal(j.policy.requireReason, true);
  r = await post('/api/run', { projectDir: gw, prompt: 'x', mock: true, pastTeamCap: true });
  assert.equal(r.status, 400); assert.equal((await r.json()).code, 'reason_required');
  // Resume: the total ack + the pipeline override, both recorded.
  const liveWt = mkdtempSync(join(tmpdir(), 'worca-policy-api-wt-'));
  const { id: paused } = await seedPipeline(gw, { title: 'paused', status: 'paused', totalCostUsd: 3,
    branch: { source: 'main', feature: 'f', worktreeDir: liveWt, reusedExisting: false }, resumePoint: graphResumePoint({ pipelineDir: gw }) });
  r = await post('/api/resume', { pipelineId: paused });
  assert.equal(r.status, 403); j = await r.json(); assert.equal(j.code, 'team_total');
  r = await post('/api/resume', { pipelineId: paused, pastTeamCap: true, policyReason: 'agreed with Mara', mock: true });
  // The total ack is recorded; the pipeline cap is overridden in the same request. The resume itself may
  // proceed (mock) — only the gate outcome is asserted here.
  assert.notEqual(r.status, 403, await r.clone().text());
  const st = readPolicyState(paused);
  assert.deepEqual(st.overrides, ['pipeline']); assert.equal(st.reason, 'agreed with Mara');
  for (const e of [...mod.runs.values()]) { try { await e.orch?.stop?.(); } catch { /* best-effort */ } }
  rmSync(liveWt, { recursive: true, force: true });
});
