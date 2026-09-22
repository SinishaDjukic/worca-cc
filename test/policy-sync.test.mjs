// test/policy-sync.test.mjs
// The worca-policy branch end to end against real bare origins (src/core/policy/sync.mjs):
// enable here / follow, discovery cache, the resolver (own, followed, chains refused), publish
// (commit + push, unchanged, rejected verbatim), statuses, workspace home + routing.
import { test, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { git, makeOrigin, cloneAs, branchFiles, rejectAllPushes, useGitSandbox } from './helpers/metrics-git.mjs';
import { addProject } from '../src/core/projects.mjs';
import { createWorkspace, updateWorkspace, readWorkspace } from '../src/core/workspaces.mjs';
import { projectKey } from '../src/core/store.mjs';
import { readTeamPolicyPrefs, writeTeamPolicyPrefs } from '../src/core/config.mjs';
import {
  enableTeamPolicy, discoverPolicy, resolveProjectPolicy, resolveWorkspacePolicy, publishPolicy, projectPolicyStatus,
  workspacePolicyStatus, listPolicyScopes, routeWorkspaceMembersPolicy, autoPolicyHome, policyEvents, worktreePath,
  POLICY_BRANCH, POLICY_FILE, PROTECTION_HINT, _testing,
} from '../src/core/policy/sync.mjs';
import { _testing as metricsTesting } from '../src/core/metrics/sync.mjs';

const skip = process.platform === 'win32' ? 'pre-receive hooks / sh not portable to win32' : false;
const root = mkdtempSync(join(tmpdir(), 'worca-policy-sync-'));
useGitSandbox(before, after);   // FIRST: pins HOME / USERPROFILE / GIT_CONFIG_GLOBAL
useTempHome(after);
after(() => rmSync(root, { recursive: true, force: true }));
afterEach(() => { _testing.reset(); metricsTesting.reset(); policyEvents.removeAllListeners('changed'); });

const policyOn = (bare) => JSON.parse(git(bare, 'show', `${POLICY_BRANCH}:${POLICY_FILE}`));

let gwBare, gw, billingBare, billing, edgeBare, edge;
before(async () => {
  gwBare = makeOrigin(root, 'gateway');       gw = cloneAs(root, 'm', gwBare, 'gateway');
  billingBare = makeOrigin(root, 'billing');  billing = cloneAs(root, 'm', billingBare, 'billing');
  edgeBare = makeOrigin(root, 'edge');        edge = cloneAs(root, 'm', edgeBare, 'edge');
  for (const [name, path] of [['gateway', gw], ['billing', billing], ['edge', edge]]) await addProject({ name, path });
});

test('nothing enabled: discovery caches present:false, the resolver says not-enabled, statuses are Off', { skip }, async () => {
  const prefs = await discoverPolicy(gw, { force: true });
  assert.equal(prefs.present, false); assert.equal(prefs.slug, 'gateway'); assert.ok(prefs.checkedAt);
  assert.deepEqual(await resolveProjectPolicy(gw), { ok: false, reason: 'not-enabled' });
  const s = await projectPolicyStatus({ key: projectKey(gw), name: 'gateway', path: gw, exists: true });
  assert.equal(s.present, false); assert.equal(s.hasOrigin, true); assert.equal(s.home, null);
  const scopes = await listPolicyScopes();
  assert.equal(scopes.anyEnabled, false); assert.deepEqual(scopes.homes, []);
});

test('enable here: orphan branch with README + an EMPTY policy, worktree, cache; the resolver returns the doc', { skip }, async () => {
  const events = []; policyEvents.on('changed', (e) => events.push(e.action));
  const r = await enableTeamPolicy(gw, { mode: 'here', title: 'Gateway team policy' });
  assert.equal(r.action, 'created'); assert.equal(r.slug, 'gateway');
  assert.deepEqual(branchFiles(gwBare, POLICY_BRANCH), [POLICY_FILE, 'README.md']);
  assert.equal(git(gwBare, 'rev-list', '--count', POLICY_BRANCH), '1');
  const doc = policyOn(gwBare);
  assert.equal(doc.schema, 1); assert.equal(doc.title, 'Gateway team policy'); assert.equal(doc.updatedBy, 'm dev'); assert.deepEqual(doc.fields, {});
  assert.ok(existsSync(join(worktreePath('gateway'), '.git')));
  assert.equal(git(gw, 'branch', '--list', POLICY_BRANCH), '', 'no local branch pollution');
  const prefs = readTeamPolicyPrefs(projectKey(gw));
  assert.equal(prefs.present, true); assert.equal(prefs.docKnown, true); assert.equal(prefs.delegateTo, null);
  const res = await resolveProjectPolicy(gw);
  assert.equal(res.ok, true); assert.equal(res.home, 'gateway'); assert.equal(res.delegated, false); assert.equal(res.homeDir, gw);
  assert.ok(events.includes('created'));
  // A second enable joins.
  assert.equal((await enableTeamPolicy(gw, { mode: 'here' })).action, 'joined');
});

test('enable is refused without an origin remote; follow refuses self, unknown and non-carrying targets', { skip }, async () => {
  const dir = join(root, 'scratch'); git(root, 'init', '-q', dir);
  await assert.rejects(enableTeamPolicy(dir, {}), { code: 'NO_ORIGIN' });
  await assert.rejects(enableTeamPolicy(billing, { mode: 'follow', delegateTo: 'billing' }), { code: 'DELEGATE_INVALID' });
  await assert.rejects(enableTeamPolicy(billing, { mode: 'follow', delegateTo: 'nowhere/x' }), { code: 'DELEGATE_INVALID' });
  await assert.rejects(enableTeamPolicy(billing, { mode: 'follow', delegateTo: 'edge' }), { code: 'DELEGATE_INVALID' }); // edge carries no policy
  await assert.rejects(enableTeamPolicy(billing, { mode: 'nope' }), { code: 'BAD_REQUEST' });
});

test('publish: validates strictly, commits one file, discovery sees the new head, unchanged is a no-op', { skip }, async () => {
  await assert.rejects(publishPolicy(gw, { schema: 1, fields: { 'cost.pipelineLimitUsd': { kind: 'soft', value: -1 } } }), (e) => e.code === 'BAD_REQUEST' && e.warnings.length === 1);
  await assert.rejects(publishPolicy(gw, 'x'), { code: 'BAD_REQUEST' });
  const out = await publishPolicy(gw, {
    schema: 1, title: 'Gateway team policy', notes: 'Q4',
    fields: { 'cost.pipelineLimitUsd': { kind: 'soft', value: 10, onBreach: 'pause' }, 'cost.totalLimitUsd': { kind: 'soft', value: 150 }, 'models.allowed': { kind: 'soft', value: ['claude-opus-5-5'] } },
    workspaceRuns: { 'cost.pipelineLimitUsd': { kind: 'soft', value: 25 } },
  }, { message: 'Q4 caps' });
  assert.equal(out.ok, true); assert.equal(out.unchanged, false); assert.ok(out.sha);
  assert.equal(git(gwBare, 'rev-list', '--count', POLICY_BRANCH), '2');
  assert.match(git(gwBare, 'log', '-1', '--format=%s', POLICY_BRANCH), /policy: Q4 caps/);
  const doc = policyOn(gwBare);
  assert.equal(doc.fields['cost.pipelineLimitUsd'].value, 10); assert.equal(doc.workspaceRuns['cost.pipelineLimitUsd'].value, 25);
  assert.equal(doc.updatedBy, 'm dev'); assert.ok(doc.updatedAt);
  const prefs = readTeamPolicyPrefs(projectKey(gw));
  assert.equal(prefs.headSha, out.sha); assert.equal(prefs.doc.fields['cost.totalLimitUsd'].value, 150);
  // Publishing the same document again commits nothing.
  const again = await publishPolicy(gw, prefs.doc);
  assert.equal(again.unchanged, true);
  assert.equal(git(gwBare, 'rev-list', '--count', POLICY_BRANCH), '2');
});

test('follow: a marker branch on billing; the resolver returns the home doc; billing cannot publish', { skip }, async () => {
  const r = await enableTeamPolicy(billing, { mode: 'follow', delegateTo: 'gateway' });
  assert.equal(r.action, 'created');
  const marker = policyOn(billingBare);
  assert.equal(marker.delegateTo, 'gateway'); assert.equal(marker.fields, undefined);
  const res = await resolveProjectPolicy(billing);
  assert.equal(res.ok, true); assert.equal(res.delegated, true); assert.equal(res.home, 'gateway'); assert.equal(res.from, 'billing'); assert.equal(res.homeDir, gw);
  assert.equal(res.doc.fields['cost.pipelineLimitUsd'].value, 10);
  await assert.rejects(publishPolicy(billing, res.doc), { code: 'NOT_HOME' });
  const s = await projectPolicyStatus({ key: projectKey(billing), name: 'billing', path: billing, exists: true });
  assert.equal(s.delegateState, 'ok'); assert.equal(s.home, 'gateway'); assert.equal(s.homeKey, projectKey(gw)); assert.equal(s.caps.pipeline.value, 10); assert.equal(s.fieldCount, 4);
  // No chains: edge may not follow billing.
  await assert.rejects(enableTeamPolicy(edge, { mode: 'follow', delegateTo: 'billing' }), { code: 'DELEGATE_INVALID' });
});

test('a hand-edited branch: bad JSON reads as a policy with warnings, a newer schema is unsupported', { skip }, async () => {
  const bare = makeOrigin(root, 'handy'); const dir = cloneAs(root, 'm', bare, 'handy');
  await addProject({ name: 'handy', path: dir });
  await enableTeamPolicy(dir, { mode: 'here' });
  const push = (content) => {
    git(dir, 'fetch', '-q', 'origin', POLICY_BRANCH); git(dir, 'checkout', '-q', '--detach', `origin/${POLICY_BRANCH}`);
    writeFileSync(join(dir, POLICY_FILE), content);
    git(dir, 'add', '-A'); git(dir, 'commit', '-qm', 'hand edit'); git(dir, 'push', '-q', 'origin', `HEAD:refs/heads/${POLICY_BRANCH}`); git(dir, 'checkout', '-q', 'main');
  };
  push('{"schema":1,"fields":{"cost.pipelineLimitUsd":{"kind":"soft","value":"ten"},"worca.minVersion":{"kind":"soft","value":"1.4.0"}}}');
  let r = await resolveProjectPolicy(dir, { discover: true });
  await discoverPolicy(dir, { force: true });
  r = await resolveProjectPolicy(dir, { discover: false });
  assert.equal(r.ok, true); assert.deepEqual(Object.keys(r.doc.fields), ['worca.minVersion']); assert.equal(r.warnings.length, 1);
  push('{"schema":9,"fields":{}}');
  await discoverPolicy(dir, { force: true });
  r = await resolveProjectPolicy(dir, { discover: false });
  assert.equal(r.ok, false); assert.equal(r.reason, 'unsupported'); assert.equal(r.code, 'SCHEMA_UNKNOWN');
  push('not json');
  await discoverPolicy(dir, { force: true });
  r = await resolveProjectPolicy(dir, { discover: false });
  assert.equal(r.ok, true, 'invalid JSON degrades to an empty policy, never a 500'); assert.match(r.warnings[0], /not valid JSON/);
});

test('publish against a protected branch: PUSH_REJECTED, stderr verbatim, the rights hint; local state untouched', { skip }, async () => {
  const bare = makeOrigin(root, 'locked'); const dir = cloneAs(root, 'm', bare, 'locked');
  await addProject({ name: 'locked', path: dir });
  await enableTeamPolicy(dir, { mode: 'here' });
  rejectAllPushes(bare, 'GH006: Protected branch update failed');
  await assert.rejects(publishPolicy(dir, { schema: 1, fields: { 'worca.minVersion': { kind: 'soft', value: '1.4.0' } } }),
    (e) => e.code === 'PUSH_REJECTED' && /GH006/.test(e.stderr) && e.hint === PROTECTION_HINT);
  assert.equal(git(bare, 'rev-list', '--count', POLICY_BRANCH), '1');
  assert.deepEqual(readTeamPolicyPrefs(projectKey(dir)).doc.fields, {});
});

test('discovery: TTL-gated, offline keeps the verdict, a moved head refetches and emits updated', { skip }, async () => {
  const before = readTeamPolicyPrefs(projectKey(gw));
  const cached = await discoverPolicy(gw);            // within TTL: no git
  assert.equal(cached.checkedAt, before.checkedAt);
  const events = []; policyEvents.on('changed', (e) => events.push(e.action));
  // Simulate a teammate's publish: push a new commit on the branch from another clone.
  const other = cloneAs(root, 'other', gwBare, 'gateway');
  git(other, 'fetch', '-q', 'origin', POLICY_BRANCH); git(other, 'checkout', '-q', '--detach', `origin/${POLICY_BRANCH}`);
  const doc = policyOn(gwBare); doc.fields['cost.pipelineLimitUsd'].value = 12;
  writeFileSync(join(other, POLICY_FILE), JSON.stringify(doc, null, 2) + '\n');
  git(other, 'add', '-A'); git(other, 'commit', '-qm', 'teammate'); git(other, 'push', '-q', 'origin', `HEAD:refs/heads/${POLICY_BRANCH}`);
  const fresh = await discoverPolicy(gw, { force: true });
  assert.equal(fresh.doc.fields['cost.pipelineLimitUsd'].value, 12);
  assert.ok(events.includes('updated'));
  // Offline: the ls-remote fails; verdict and checkedAt are kept, the error is noted.
  metricsTesting.setGit(async (cwd, args) => (args[0] === 'ls-remote' ? { ok: false, code: 128, stdout: '', stderr: 'fatal: unable to access' } : metricsTesting.defaultGit(cwd, args)));
  const off = await discoverPolicy(gw, { force: true });
  assert.equal(off.present, true); assert.equal(off.checkedAt, fresh.checkedAt); assert.match(off.lastDiscoveryError, /unable to access/);
});

test('workspace: home pointer, resolve through a following member, autoPolicyHome, route all members', { skip }, async () => {
  const ws = await createWorkspace({ name: 'IoT Platform', projectPaths: [gw, billing, edge] });
  assert.equal(ws.policyProject, null);
  assert.deepEqual(await resolveWorkspacePolicy(ws.id), { ok: false, reason: 'no-home' });
  // Every resolving member (gw own, billing follows gw) shares one home → auto-pick.
  assert.equal(await autoPolicyHome(ws), gw);
  await updateWorkspace(ws.id, { policyProject: billing });   // a FOLLOWING member is a valid home
  const r = await resolveWorkspacePolicy(ws.id);
  assert.equal(r.ok, true); assert.equal(r.home, 'gateway'); assert.equal(r.delegated, true); assert.equal(r.workspace.id, ws.id);
  const st = await workspacePolicyStatus(await readWorkspace(ws.id));
  assert.equal(st.home.state, 'ok'); assert.equal(st.home.slug, 'gateway'); assert.equal(st.home.follows, 'billing');
  assert.equal(st.home.workspaceCaps.pipeline.value, 25); assert.equal(st.home.workspaceFields, 1);
  assert.deepEqual(st.members.map((m) => [m.slug, m.state]).sort(), [['billing', 'home'], ['edge', 'none'], ['gateway', 'is-home']]);
  const routed = await routeWorkspaceMembersPolicy(ws.id);
  assert.equal(routed.home, 'gateway');
  assert.deepEqual(routed.results.map((x) => [x.slug, x.result]).sort(), [['edge', 'routed'], ['gateway', 'skipped']]);
  assert.equal(policyOn(edgeBare).delegateTo, 'gateway');
  const scopes = await listPolicyScopes();
  assert.equal(scopes.anyEnabled, true);
  assert.deepEqual(scopes.scopes.workspaces.map((w) => w.home), ['gateway']);
  const gwHome = scopes.homes.find((h) => h.slug === 'gateway');
  assert.ok(gwHome, 'gateway is a home (the earlier hand-edited fixtures are homes of their own)');
  assert.deepEqual([...gwHome.usedBy].sort(), ['billing', 'edge', 'gateway']);
  // Not a member → BAD_REQUEST from the workspace store; a stale home → home-stale.
  await assert.rejects(updateWorkspace(ws.id, { policyProject: '/nope' }), { code: 'BAD_REQUEST' });
  writeTeamPolicyPrefs(projectKey(billing), { delegateTo: 'gateway', present: true, docKnown: true, doc: { schema: 1, fields: {}, delegateTo: 'gateway' } });
});
