// test/ask-policy-deps.test.mjs
// The real policy bundle of the Ask Worca tools (src/core/ask/policy-deps.mjs) against real bare
// origins: the validator over the real readers, and applyPolicyChange for every kind — enable here,
// follow, an edit published as one commit (and replayed on top of a teammate's newer publish),
// the workspace policy home, routing — plus defaultPolicyDeps().policy.read.
import { test, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { git, makeOrigin, cloneAs, useGitSandbox } from './helpers/metrics-git.mjs';
import { addProject, listProjects } from '../src/core/projects.mjs';
import { createWorkspace, readWorkspace } from '../src/core/workspaces.mjs';
import { projectKey } from '../src/core/store.mjs';
import { POLICY_BRANCH, POLICY_FILE, publishPolicy, resolveProjectPolicy, policyEvents, _testing } from '../src/core/policy/sync.mjs';
import { _testing as metricsTesting } from '../src/core/metrics/sync.mjs';
import { validatePolicyChange, applyPolicyChange, defaultPolicyDeps } from '../src/core/ask/policy-deps.mjs';

const skip = process.platform === 'win32' ? 'pre-receive hooks / sh not portable to win32' : false;
const root = mkdtempSync(join(tmpdir(), 'worca-ask-policy-deps-'));
useGitSandbox(before, after);
useTempHome(after);
after(() => rmSync(root, { recursive: true, force: true }));
afterEach(() => { _testing.reset(); metricsTesting.reset(); policyEvents.removeAllListeners('changed'); });

const policyOn = (bare) => JSON.parse(git(bare, 'show', `${POLICY_BRANCH}:${POLICY_FILE}`));
const commits = (bare) => Number(git(bare, 'rev-list', '--count', POLICY_BRANCH));
/** Validate like the parent turn, then apply like the cards route. */
async function propose(input) {
  const r = await validatePolicyChange(input);
  assert.equal(r.ok, true, JSON.stringify(r));
  return r.card;
}

let gwBare, gw, blBare, bl, edBare, ed, gwKey, blKey, edKey, ws;
before(async () => {
  gwBare = makeOrigin(root, 'gateway'); gw = cloneAs(root, 'm', gwBare, 'gateway');
  blBare = makeOrigin(root, 'billing'); bl = cloneAs(root, 'm', blBare, 'billing');
  edBare = makeOrigin(root, 'edge');    ed = cloneAs(root, 'm', edBare, 'edge');
  for (const [name, path] of [['gateway', gw], ['billing', bl], ['edge', ed]]) await addProject({ name, path });
  [gwKey, blKey, edKey] = [gw, bl, ed].map((p) => projectKey(p));
});

test('enable here: the card, then the branch with an empty policy', { skip }, async () => {
  const card = await propose({ kind: 'enable', projectKey: gwKey, title: 'Gateway team policy' });
  assert.equal(card.summary, 'Set up a team policy on gateway — on its own worca-policy branch');
  const r = await applyPolicyChange(card);
  assert.deepEqual(r, { ok: true, action: 'created', detail: 'branch created on origin' });
  const doc = policyOn(gwBare);
  assert.equal(doc.title, 'Gateway team policy'); assert.deepEqual(doc.fields, {});
  // A second proposal is refused by the real status.
  assert.match((await validatePolicyChange({ kind: 'enable', projectKey: gwKey })).errors[0], /already carries its own team policy/);
});

test('edit: publishes ONE commit with the change; a no-op edit is refused at proposal', { skip }, async () => {
  const card = await propose({ kind: 'edit', projectKey: gwKey, message: 'set the team caps',
    set: [{ key: 'cost.pipelineLimitUsd', value: 10, kind: 'soft', requireReason: true }, { key: 'cost.totalLimitUsd', value: 150, kind: 'soft' }, { key: 'cost.pipelineLimitUsd', value: 25, kind: 'soft', forWorkspaceRuns: true }] });
  assert.equal(card.summary, "Edit gateway's team policy — 3 changes");
  assert.deepEqual(card.changes.map((c) => [c.label, c.before, c.after]), [
    ['Per-pipeline cap (USD)', null, 'soft $10.00 · reason required'],
    ['Total cap per period (USD)', null, 'soft $150.00'],
    ['Per-pipeline cap (USD) (workspace runs)', null, 'soft $25.00'],
  ]);
  const n = commits(gwBare);
  const r = await applyPolicyChange(card);
  assert.equal(r.ok, true); assert.equal(r.unchanged, false);
  assert.match(r.detail, /^published [0-9a-f]{7} to gateway$/);
  assert.equal(commits(gwBare), n + 1, 'one commit');
  assert.equal(git(gwBare, 'log', '-1', '--format=%s', POLICY_BRANCH), 'policy: set the team caps');
  const doc = policyOn(gwBare);
  assert.deepEqual(doc.fields['cost.pipelineLimitUsd'], { kind: 'soft', value: 10, requireReason: true });
  assert.deepEqual(doc.workspaceRuns['cost.pipelineLimitUsd'], { kind: 'soft', value: 25 });
  assert.match((await validatePolicyChange({ kind: 'edit', projectKey: gwKey, set: [{ key: 'cost.totalLimitUsd', value: 150 }] })).errors[0], /nothing changes/);
});

test('edit: a teammate\'s publish between proposal and Apply is kept — the ops replay on the newer policy', { skip }, async () => {
  const card = await propose({ kind: 'edit', projectKey: gwKey, set: [{ key: 'cost.pipelineLimitUsd', value: 12 }] });
  assert.equal(card.ops.set[0].entry.requireReason, true, 'the current entry\'s attributes are kept');
  // A teammate publishes an unrelated field first (the branch moves under the card).
  const cur = (await resolveProjectPolicy(gw)).doc;
  await publishPolicy(gw, { ...cur, fields: { ...cur.fields, 'guardrails.minimum': { kind: 'soft', value: 'normal' } } });
  const r = await applyPolicyChange(card);
  assert.equal(r.ok, true);
  assert.match(r.detail, /on top of a newer version a teammate published/);
  const doc = policyOn(gwBare);
  assert.equal(doc.fields['cost.pipelineLimitUsd'].value, 12, 'the card\'s change landed');
  assert.deepEqual(doc.fields['guardrails.minimum'], { kind: 'soft', value: 'normal' }, 'the teammate\'s change survived');
});

test('follow: billing follows gateway; an edit proposed on billing publishes to gateway', { skip }, async () => {
  const card = await propose({ kind: 'enable', projectKey: blKey, mode: 'follow', delegateTo: 'gateway' });
  assert.equal(card.summary, "Make billing follow gateway's team policy");
  const r = await applyPolicyChange(card);
  assert.equal(r.ok, true); assert.equal(r.detail, 'now follows gateway');
  assert.equal(policyOn(blBare).delegateTo, 'gateway');
  const edit = await propose({ kind: 'edit', projectKey: blKey, set: [{ key: 'run.humanInLoop', value: false, kind: 'default' }] });
  assert.equal(edit.home, 'gateway');
  assert.match(edit.effects[1], /Governs gateway and the projects that follow it: billing/);
  await applyPolicyChange(edit);
  assert.deepEqual(policyOn(gwBare).fields['run.humanInLoop'], { kind: 'default', value: false });
  assert.equal(policyOn(blBare).fields, undefined, 'the marker is untouched');
});

test('workspace: set the policy home, read it for workspace runs, route the rest, clear the home', { skip }, async () => {
  ws = await createWorkspace({ name: 'IoT Platform', projectPaths: [gw, bl, ed] });
  assert.match((await validatePolicyChange({ kind: 'workspace_home', workspaceId: ws.id, homeProjectKey: edKey })).errors[0], /no team policy of its own/);
  assert.match((await validatePolicyChange({ kind: 'route_members', workspaceId: ws.id })).errors[0], /no valid policy home/);
  const events = []; policyEvents.on('changed', (e) => events.push(e.action));
  const home = await propose({ kind: 'workspace_home', workspaceId: ws.id, homeProjectKey: gwKey });
  assert.deepEqual(await applyPolicyChange(home), { ok: true, detail: 'policy home is now gateway' });
  assert.ok(events.includes('policy-home'), 'the Projects cells and workspace cards hear about it');
  assert.equal((await readWorkspace(ws.id)).policyProject, gw);

  const read = await defaultPolicyDeps().policy.read({ kind: 'workspace', id: ws.id });
  assert.equal(read.policy.home, 'gateway'); assert.equal(read.policy.workspaceRun, true);
  assert.equal(read.rows.find((x) => x.key === 'cost.pipelineLimitUsd').team.value, 25, 'the workspaceRuns block applies to workspace runs');
  assert.ok(Array.isArray(read.deviations));
  const none = await defaultPolicyDeps().policy.read({ kind: 'project', id: edKey });
  assert.deepEqual([none.policy, none.reason], [null, 'not-enabled']);
  await assert.rejects(defaultPolicyDeps().policy.read({ kind: 'project', id: 'nope-00000000' }), { code: 'NOT_FOUND' });

  const route = await propose({ kind: 'route_members', workspaceId: ws.id });
  const rr = await applyPolicyChange(route);
  assert.equal(rr.ok, true); assert.equal(rr.home, 'gateway');
  assert.equal(rr.detail, '1 routed · 1 skipped · 0 failed');
  assert.equal(policyOn(edBare).delegateTo, 'gateway');

  const clear = await propose({ kind: 'workspace_home', workspaceId: ws.id, homeProjectKey: '' });
  assert.deepEqual(await applyPolicyChange(clear), { ok: true, detail: 'policy home cleared' });
  assert.equal((await readWorkspace(ws.id)).policyProject, null);
});

test('apply refuses a card whose world moved: unknown project, a home that changed', { skip }, async () => {
  await assert.rejects(applyPolicyChange({ kind: 'enable', projectKey: 'nope-00000000', mode: 'here' }), { code: 'NOT_FOUND' });
  await assert.rejects(applyPolicyChange({ kind: 'edit', projectKey: blKey, home: 'acme/elsewhere', ops: { set: [], unset: [] } }), /the policy home changed from acme\/elsewhere to gateway/);
  await assert.rejects(applyPolicyChange({ kind: 'bogus' }), { code: 'BAD_REQUEST' });
  assert.ok((await listProjects()).length >= 3);
});
