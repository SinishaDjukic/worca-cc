// test/git-free-team-policy.test.mjs — Team policy on a GitHub team repository without git (P6 Task 10).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { addProject, getProjectByPath } from '../src/core/projects.mjs';
import { projectKey } from '../src/core/store.mjs';
import { writeTeamPolicyPrefs } from '../src/core/config.mjs';
import { discoverPolicy, enableTeamPolicy, publishPolicy, listPolicyScopes, projectPolicyStatus, resolveProjectPolicy, worktreePath, PROTECTION_HINT } from '../src/core/policy/sync.mjs';
import { normalizePolicyDoc, emptyPolicyDoc, serializePolicyDoc } from '../src/core/policy/registry.mjs';
import { DISCOVERY_RETRY_MS, _testing as syncTesting } from '../src/core/metrics/sync.mjs';
import { _testing as ghTesting } from '../src/core/git-free/github.mjs';
import { fakeGithub } from './helpers/fake-github.mjs';
import { withNoGit } from './helpers/git-off.mjs';
import { gitAvailable } from '../src/core/git-available.mjs';
import { workModeForStart } from '../src/core/project-kind.mjs';
import { teamCapsForTarget } from '../src/core/policy/gate.mjs';
import { teamRunDiscover } from '../src/core/git-free/team-repo.mjs';
import { RunHarness } from '../src/core/run-harness.mjs';
import { withEnv } from './helpers/with-env.mjs';

useTempHome(after);
const gh = await fakeGithub();
ghTesting.setFetch(gh.fetch);
const root = mkdtempSync(join(tmpdir(), 'worca-gf-tp-'));   // every fixture folder lives here
after(() => { ghTesting.reset(); gh.close(); rmSync(root, { recursive: true, force: true }); });
const NO_CREDS = { GH_TOKEN: undefined, GITHUB_TOKEN: undefined, WORCA_GH_READ_TOKEN: undefined, WORCA_GH_WRITE_TOKEN: undefined,
  WORCA_GH_APP_ID: undefined, WORCA_GH_APP_KEY_FILE: undefined, WORCA_GH_APP_KEY_B64: undefined };
const PF = '.worca-policy/policy.json';
async function project(slug, origin = `https://github.com/${slug}.git`) {
  gh.repo(slug, { files: { a: '1' } });
  const d = mkdtempSync(join(root, 'p-'));
  mkdirSync(join(d, '.git'));
  writeFileSync(join(d, '.git', 'config'), `[remote "origin"]\n\turl = ${origin}\n`);
  await addProject({ name: slug.split('/')[1], path: d });
  return d;
}
const titleOn = (slug) => normalizePolicyDoc(JSON.parse(gh.show(slug, 'worca-policy', PF))).doc.title;
const commits = (slug) => Number(gh.git(slug, 'rev-list', '--count', 'worca-policy'));

test('enable here creates the branch with README and an empty policy; discovery reads it', async (t) => {
  const home = await project('acme/pol');
  withNoGit(t);
  const r = await enableTeamPolicy(home, { mode: 'here', now: new Date('2026-10-17T10:00:00Z') });
  assert.deepEqual([r.action, r.slug], ['created', 'acme/pol']);
  assert.equal(gh.git('acme/pol', 'ls-tree', '-r', '--name-only', 'worca-policy'), `${PF}\nREADME.md`);
  assert.equal(titleOn('acme/pol'), 'acme/pol team policy');
  const prefs = await discoverPolicy(home, { force: true });
  assert.deepEqual([prefs.present, prefs.docKnown, prefs.doc.title, prefs.headSha], [true, true, 'acme/pol team policy', gh.sha('acme/pol', 'worca-policy')]);
});

test('follow writes a marker; Change… rewrites it', async (t) => {
  const home2 = await project('acme/pol2');
  const f = await project('acme/follower');
  withNoGit(t);
  await enableTeamPolicy(home2, { mode: 'here' });
  assert.equal((await enableTeamPolicy(f, { mode: 'follow', delegateTo: 'acme/pol' })).action, 'created');
  assert.deepEqual([JSON.parse(gh.show('acme/follower', 'worca-policy', PF)).delegateTo, gh.git('acme/follower', 'log', '-1', '--format=%s', 'worca-policy')], ['acme/pol', 'policy: follow acme/pol']);
  assert.equal((await enableTeamPolicy(f, { mode: 'follow', delegateTo: 'acme/pol2', change: true })).action, 'changed');
  assert.deepEqual([JSON.parse(gh.show('acme/follower', 'worca-policy', PF)).delegateTo, gh.git('acme/follower', 'log', '-1', '--format=%s', 'worca-policy')], ['acme/pol2', 'policy: follow acme/pol2']);
});

test('publish over HTTPS: the same content makes no commit; a change makes one, retried past a teammate', async (t) => {
  const home = await project('acme/pub');
  withNoGit(t);
  await enableTeamPolicy(home, { mode: 'here' });
  const doc = (await discoverPolicy(home, { force: true })).doc;
  const before = commits('acme/pub');
  assert.equal((await publishPolicy(home, doc, { now: new Date(Date.now() + 5_000) })).unchanged, true);   // a later stamp: only the content counts
  assert.equal(commits('acme/pub'), before);
  gh.beforeRefUpdate(() => gh.commit('acme/pub', { branch: 'worca-policy', files: { 'NOTE.md': 'n\n' } }));
  const r = await publishPolicy(home, { ...doc, title: 'Acme rules' });
  assert.deepEqual([r.ok, r.unchanged, titleOn('acme/pub'), gh.show('acme/pub', 'worca-policy', 'NOTE.md')], [true, false, 'Acme rules', 'n\n']);
});

test('publish adds the README a hand-made branch lacks; a protected branch answers PUSH_REJECTED with the rights hint', async (t) => {
  const home = await project('acme/bare-pol');
  gh.commit('acme/bare-pol', { branch: 'worca-policy', orphan: true, files: { [PF]: serializePolicyDoc(emptyPolicyDoc({ title: 'x', now: new Date('2026-10-01T00:00:00Z') })) } });
  withNoGit(t);
  const doc = (await discoverPolicy(home, { force: true })).doc;
  await publishPolicy(home, { ...doc, title: 'y' });
  assert.equal(gh.git('acme/bare-pol', 'ls-tree', '-r', '--name-only', 'worca-policy'), `${PF}\nREADME.md`);
  gh.commit('acme/bare-pol', { branch: 'worca-policy', files: { 'README.md': 'our own words\n' } });
  await publishPolicy(home, { ...doc, title: 'y2' });
  assert.deepEqual([titleOn('acme/bare-pol'), gh.show('acme/bare-pol', 'worca-policy', 'README.md')], ['y2', 'our own words\n']);   // a team's README stays
  gh.protect('acme/bare-pol', 'worca-policy');
  await assert.rejects(publishPolicy(home, { ...doc, title: 'z' }), { code: 'PUSH_REJECTED', hint: PROTECTION_HINT });
});

test('GitHub refusing a write the credential may not make (HTTP 403, a 404 after the reads) answers PUSH_REJECTED with the rights hint: enable, Change… and publish', async (t) => {
  const home = await project('acme/ro-pol');
  const home2 = await project('acme/ro-pol2');
  const f = await project('acme/ro-fol');
  const fresh = await project('acme/ro-new');
  withNoGit(t);
  await enableTeamPolicy(home, { mode: 'here' });
  await enableTeamPolicy(home2, { mode: 'here' });
  await enableTeamPolicy(f, { mode: 'follow', delegateTo: 'acme/ro-pol' });
  const doc = (await discoverPolicy(home, { force: true })).doc;
  const denied = 'Resource not accessible by personal access token';
  gh.failOnce(403, denied, { method: 'POST', match: '/git/trees' });
  await assert.rejects(publishPolicy(home, { ...doc, title: 'x' }), { code: 'PUSH_REJECTED', message: `GitHub refused (HTTP 403): ${denied}`, hint: PROTECTION_HINT });
  gh.failOnce(403, denied, { method: 'POST', match: '/git/trees' });
  await assert.rejects(enableTeamPolicy(fresh, { mode: 'here' }), { code: 'PUSH_REJECTED', hint: PROTECTION_HINT });
  gh.failOnce(404, 'Not Found', { method: 'POST', match: '/git/trees' });
  await assert.rejects(enableTeamPolicy(f, { mode: 'follow', delegateTo: 'acme/ro-pol2', change: true }), { code: 'PUSH_REJECTED', message: /^not found on GitHub: acme\/ro-fol\b/, hint: PROTECTION_HINT });
  assert.equal(JSON.parse(gh.show('acme/ro-fol', 'worca-policy', PF)).delegateTo, 'acme/ro-pol');
});

test('status without git: another host → needsGit; a plain folder → repoInput', async (t) => {
  const gl = await project('acme/glpol', 'https://gitlab.com/acme/glpol.git');
  const plain = mkdtempSync(join(root, 'plain-'));
  await addProject({ name: 'plainpol', path: plain });
  withNoGit(t);
  const byKey = new Map((await listPolicyScopes()).projects.map((s) => [s.key, s]));
  assert.deepEqual([byKey.get(projectKey(gl)).needsGit, byKey.get(projectKey(plain)).repoInput], [true, true]);
  await assert.rejects(enableTeamPolicy(gl, { mode: 'here' }), { code: 'GIT_MISSING' });
  await assert.rejects(enableTeamPolicy(plain, { mode: 'here' }), { code: 'REPO_REQUIRED' });
});

test('policy status of a folder without git or a typed repo: hasOrigin stays null, the repository is asked for', async (t) => {
  const d = mkdtempSync(join(root, 'p-'));
  await addProject({ name: 'plainstatus', path: d });
  withNoGit(t);
  const s = await projectPolicyStatus({ key: projectKey(d), name: 'plainstatus', path: d, exists: true });
  assert.deepEqual([s.hasOrigin, s.repoInput], [null, true]);
});

test('publish to a policy branch on another host without git: GIT_MISSING', async (t) => {
  const dir = await project('acme/offhost', 'https://gitlab.com/acme/offhost.git');
  const doc = normalizePolicyDoc(emptyPolicyDoc({ title: 't', now: new Date('2026-10-01T00:00:00Z') })).doc;
  writeTeamPolicyPrefs(projectKey(dir), { present: true, docKnown: true, hasOrigin: true, slug: 'gitlab.com/acme/offhost', doc, delegateTo: null,
    checkedAt: new Date().toISOString() });
  withNoGit(t);
  await assert.rejects(publishPolicy(dir, { ...doc, title: 'u' }), { code: 'GIT_MISSING' });
});

test('a GitHub repository the policy slug misnames (acme/.github → acme/github) needs git: no enable, discovery or publish reaches acme/github', async (t) => {
  gh.repo('acme/.github', { files: { 'profile/README.md': 'org\n' } });
  gh.repo('acme/github', { files: { a: '1' } });   // another repository: the one the slug names
  gh.commit('acme/github', { branch: 'worca-policy', orphan: true, files: { [PF]: serializePolicyDoc(emptyPolicyDoc({ title: 'other team', now: new Date('2026-10-01T00:00:00Z') })) } });
  const dot = mkdtempSync(join(root, 'p-'));
  mkdirSync(join(dot, '.git'));
  writeFileSync(join(dot, '.git', 'config'), '[remote "origin"]\n\turl = https://github.com/acme/.github.git\n');
  await addProject({ name: 'dot-github-pol', path: dot });
  withNoGit(t);
  const n = gh.calls.length;
  await assert.rejects(enableTeamPolicy(dot, { mode: 'here' }), { code: 'GIT_MISSING', message: 'git is not installed on this machine' });
  const prefs = await discoverPolicy(dot, { force: true });
  assert.deepEqual([prefs.present, prefs.slug, prefs.lastDiscoveryError], [undefined, 'acme/github', 'git is not installed on this machine']);
  const s = (await listPolicyScopes()).projects.find((x) => x.key === projectKey(dot));
  assert.deepEqual([s.needsGit, s.unread], [true, undefined]);   // as a host slug: never "On · not read yet"
  assert.deepEqual(await resolveProjectPolicy(dot, { discover: false }), { ok: false, reason: 'not-enabled' });
  // Enabled while git was installed: publish fails as for a host slug, without a request.
  const doc = normalizePolicyDoc(emptyPolicyDoc({ title: 't', now: new Date('2026-10-01T00:00:00Z') })).doc;
  writeTeamPolicyPrefs(projectKey(dot), { present: true, docKnown: true, hasOrigin: true, slug: 'acme/github', doc, delegateTo: null, checkedAt: new Date().toISOString() });
  await assert.rejects(publishPolicy(dot, { ...doc, title: 'u' }), { code: 'GIT_MISSING', message: 'git is not installed on this machine' });
  assert.deepEqual([gh.calls.length - n, commits('acme/github'), titleOn('acme/github')], [0, 1, 'other team']);
});

test('Change… of a policy marker is retried past a teammate', async (t) => {
  const h1 = await project('acme/chhome');
  const h2 = await project('acme/chhome2');
  const f = await project('acme/chf');
  withNoGit(t);
  await enableTeamPolicy(h1, { mode: 'here' });
  await enableTeamPolicy(h2, { mode: 'here' });
  await enableTeamPolicy(f, { mode: 'follow', delegateTo: 'acme/chhome' });
  gh.beforeRefUpdate(() => gh.commit('acme/chf', { branch: 'worca-policy', files: { 'NOTE.md': 'n\n' } }));
  assert.equal((await enableTeamPolicy(f, { mode: 'follow', delegateTo: 'acme/chhome2', change: true })).action, 'changed');
});

test('a failed HTTPS policy discovery is not asked again by an unforced trigger for DISCOVERY_RETRY_MS; force asks', async (t) => {
  const priv = mkdtempSync(join(root, 'priv-'));
  mkdirSync(join(priv, '.git'));
  writeFileSync(join(priv, '.git', 'config'), '[remote "origin"]\n\turl = https://github.com/acme/private-pol.git\n');   // not on the fake
  await addProject({ name: 'private-pol', path: priv });
  withNoGit(t);
  let n = gh.calls.length;
  const first = await discoverPolicy(priv);
  assert.equal(gh.calls.length > n, true);
  assert.match(first.lastDiscoveryError, /^not found on GitHub: acme\/private-pol/);
  n = gh.calls.length;
  const again = await discoverPolicy(priv);
  assert.deepEqual([gh.calls.length - n, again.lastDiscoveryAt], [0, first.lastDiscoveryAt]);
  await discoverPolicy(priv, { now: Date.now() + DISCOVERY_RETRY_MS + 1_000 });
  assert.equal(gh.calls.length > n, true);
  n = gh.calls.length;
  await discoverPolicy(priv, { force: true });
  assert.equal(gh.calls.length > n, true);
});

const capDoc = (usd) => serializePolicyDoc(normalizePolicyDoc({ schema: 1, fields: { 'cost.pipelineLimitUsd': { kind: 'soft', value: usd } } }).doc);

test('a run start without git (a Folder run) discovers a GitHub team policy no discovery has read yet', async (t) => {
  const d = await project('acme/cli');                   // `worca add` discovers team metrics only, never the policy
  gh.commit('acme/cli', { branch: 'worca-policy', orphan: true, files: { [PF]: capDoc(2) } });
  withNoGit(t);
  const workMode = workModeForStart({ projectDir: d }, { getProjectByPath, gitAvailable });
  const caps = await teamCapsForTarget({ projectDir: d }, { discover: teamRunDiscover(workMode, d) });
  assert.deepEqual([workMode, caps.policy?.home, caps.pipeline.cap], ['folder', 'acme/cli', 2]);
  const plain = mkdtempSync(join(root, 'plain-run-'));   // no .git, no typed repository: nothing to ask GitHub
  t.after(() => rmSync(plain, { recursive: true, force: true }));
  await addProject({ name: 'plain-run', path: plain });
  const n = gh.calls.length;
  assert.equal((await teamCapsForTarget({ projectDir: plain }, { discover: teamRunDiscover('folder', plain) })).policy, null);
  assert.equal(gh.calls.length, n);
});

test('the run harness of a Folder run without git takes the team policy of a project never discovered', async (t) => {
  const d = await project('acme/harness-pol');
  gh.commit('acme/harness-pol', { branch: 'worca-policy', orphan: true, files: { [PF]: capDoc(3) } });
  withNoGit(t);
  const h = Object.assign(Object.create(RunHarness.prototype), { workMode: 'folder', projectDir: d, isWorkspace: false, opts: {}, state: {}, stepModels: {}, _log() {} });
  await h._resolvePolicy();
  assert.deepEqual([h.policyRun?.home, h.policyRun?.fields['cost.pipelineLimitUsd']?.value], ['acme/harness-pol', 3]);
});

test('a run start\'s policy discovery over HTTPS is bounded by its ls / fetch timeouts', { timeout: 15_000 }, async (t) => {
  const d = await project('acme/hang-pol');
  gh.commit('acme/hang-pol', { branch: 'worca-policy', orphan: true, files: { [PF]: capDoc(2) } });
  withNoGit(t);
  // Never answers the matching requests until its signal aborts (3 s at most, so a failure ends the test).
  const hangOn = (re) => (url, init) => (re.test(new URL(url).pathname)
    ? new Promise((_, reject) => { const tm = setTimeout(() => reject(new Error('hung')), 3_000); init.signal.addEventListener('abort', () => { clearTimeout(tm); reject(init.signal.reason); }); })
    : gh.fetch(url, init));
  try {
    const t0 = Date.now();
    ghTesting.setFetch(hangOn(/\/git\/ref\/heads\/worca-policy$/));
    assert.equal((await discoverPolicy(d, { force: true, lsTimeoutMs: 50 })).lastDiscoveryError, 'GitHub unreachable (timeout)');
    ghTesting.setFetch(hangOn(/\/contents\//));
    const b = await discoverPolicy(d, { force: true, fetchTimeoutMs: 50 });
    assert.deepEqual([b.present, b.docKnown, b.lastDiscoveryError], [true, false, 'GitHub unreachable (timeout)']);
    assert.ok(Date.now() - t0 < 2_000);
  } finally { ghTesting.setFetch(gh.fetch); }
});

async function unlisted(name, origin) {   // a GitHub repository the fake does not know: a 404, as a private one answers without a token
  const d = mkdtempSync(join(root, `${name}-`));
  mkdirSync(join(d, '.git'));
  writeFileSync(join(d, '.git', 'config'), `[remote "origin"]\n\turl = ${origin}\n`);
  await addProject({ name, path: d });
  return d;
}
const statusOf = (d, name) => projectPolicyStatus({ key: projectKey(d), name, path: d, exists: true });

test('a GitHub team repository never read (private, no token) is not read yet — DOC_UNKNOWN for the run, never Off; one without the branch, one read before and another host stay as they were', async (t) => {
  const priv = await unlisted('secret-team', 'git@github.com:acme/secret-team.git');
  const open = await project('acme/no-pol');
  const gl = await project('acme/gl-unread', 'https://gitlab.com/acme/gl-unread.git');
  withNoGit(t);
  await withEnv(NO_CREDS, async () => { await discoverPolicy(priv, { force: true }); await discoverPolicy(open, { force: true }); await discoverPolicy(gl, { force: true }); });
  const why = 'not found on GitHub: acme/secret-team (a private repository needs GH_TOKEN)';
  const s = await statusOf(priv, 'secret-team');
  assert.deepEqual([s.present, s.checkedAt, s.unread, s.blocked, s.delegateCode, s.delegateDetail], [false, null, true, 'DOC_UNKNOWN', 'DOC_UNKNOWN', why]);
  assert.deepEqual(await resolveProjectPolicy(priv, { discover: false }), { ok: false, reason: 'not-enabled', code: 'DOC_UNKNOWN', detail: why });
  const o = await statusOf(open, 'no-pol');
  assert.deepEqual([o.present, o.unread, o.blocked], [false, undefined, null]);
  assert.deepEqual(await resolveProjectPolicy(open, { discover: false }), { ok: false, reason: 'not-enabled' });
  gh.failOnce(500, 'down', { method: 'GET' });
  const later = await discoverPolicy(open, { force: true });   // read once already: a later failure keeps the verdict
  const o2 = await statusOf(open, 'no-pol');
  assert.deepEqual([later.lastDiscoveryError, !!later.checkedAt, o2.unread, o2.blocked], ['GitHub (HTTP 500): down', true, undefined, null]);
  const g = await statusOf(gl, 'gl-unread');
  assert.deepEqual([g.needsGit, g.lastDiscoveryError, g.unread, g.blocked], [true, 'git is not installed on this machine', undefined, null]);
  assert.deepEqual(await resolveProjectPolicy(gl, { discover: false }), { ok: false, reason: 'not-enabled' });
});

test('a follower of a GitHub home never read (private, no token) is not read yet — DOC_UNKNOWN, never dangling; following that home is FETCH_FAILED', async (t) => {
  await unlisted('secret-home', 'https://github.com/acme/secret-home.git');
  const fol = await project('acme/fol-secret');
  gh.commit('acme/fol-secret', { branch: 'worca-policy', orphan: true, files: { [PF]: JSON.stringify({ schema: 1, delegateTo: 'acme/secret-home' }) } });
  const fol2 = await project('acme/fol-secret2');
  withNoGit(t);
  const why = 'not found on GitHub: acme/secret-home (a private repository needs GH_TOKEN)';
  await withEnv(NO_CREDS, async () => {
    assert.deepEqual(await resolveProjectPolicy(fol, { discover: 'if-missing' }),   // the run start: the home is read once, and fails
      { ok: false, reason: 'not-enabled', code: 'DOC_UNKNOWN', detail: `follows acme/secret-home: ${why}` });
    const s = await statusOf(fol, 'fol-secret');
    assert.deepEqual([s.present, s.delegateState, s.blocked, s.delegateDetail], [true, null, 'DOC_UNKNOWN', `follows acme/secret-home: ${why}`]);
    await assert.rejects(enableTeamPolicy(fol2, { mode: 'follow', delegateTo: 'acme/secret-home' }),
      { code: 'FETCH_FAILED', message: `could not read the worca-policy branch of acme/secret-home: ${why}` });
  });
  assert.equal(gh.show('acme/fol-secret2', 'worca-policy', PF), null);   // no marker was written
});

test('with git installed a first discovery that failed stays Off: no unread, no DOC_UNKNOWN', async () => {
  const d = await project('acme/git-unread');
  writeTeamPolicyPrefs(projectKey(d), { present: false, hasOrigin: true, slug: 'acme/git-unread', lastDiscoveryError: 'fatal: could not read from remote repository', lastDiscoveryAt: new Date().toISOString() });
  const s = await statusOf(d, 'git-unread');
  assert.deepEqual([s.present, s.unread, s.blocked], [false, undefined, null]);
  assert.deepEqual(await resolveProjectPolicy(d, { discover: false }), { ok: false, reason: 'not-enabled' });
});

test('another host\'s first discovery that failed while git was installed stays Off without git: no unread, no DOC_UNKNOWN', async (t) => {
  const d = await project('acme/gl-old', 'https://gitlab.com/acme/gl-old.git');
  writeTeamPolicyPrefs(projectKey(d), { present: false, hasOrigin: true, slug: 'gitlab.com/acme/gl-old', lastDiscoveryError: 'fatal: could not read from remote repository', lastDiscoveryAt: new Date().toISOString() });
  withNoGit(t);
  const s = await statusOf(d, 'gl-old');
  assert.deepEqual([s.present, s.needsGit, s.unread, s.blocked], [false, true, undefined, null]);
  assert.deepEqual(await resolveProjectPolicy(d, { discover: false }), { ok: false, reason: 'not-enabled' });
});

test('an HTTPS failure is one line: the coded error carries no stderr repeating it', async (t) => {
  const priv = await unlisted('hidden-pol', 'https://github.com/acme/hidden-pol.git');
  withNoGit(t);
  const e = await withEnv(NO_CREDS, () => enableTeamPolicy(priv, { mode: 'here' })).catch((x) => x);
  assert.deepEqual([e.code, e.message, Object.hasOwn(e, 'stderr')], ['REMOTE_UNREACHABLE', 'not found on GitHub: acme/hidden-pol (a private repository needs GH_TOKEN)', false]);
});

test('enable here over HTTPS joins a teammate\'s branch — one already there, and one made while Worca created it; no worktree', async (t) => {
  const a = await project('acme/join-a');
  const b = await project('acme/join-b');
  const theirs = serializePolicyDoc(emptyPolicyDoc({ title: 'theirs', now: new Date('2026-10-01T00:00:00Z') }));
  gh.commit('acme/join-a', { branch: 'worca-policy', orphan: true, files: { [PF]: theirs } });
  withNoGit(t);
  assert.equal((await enableTeamPolicy(a, { mode: 'here' })).action, 'joined');
  gh.beforeRefUpdate(() => gh.commit('acme/join-b', { branch: 'worca-policy', orphan: true, files: { [PF]: theirs } }));
  assert.equal((await enableTeamPolicy(b, { mode: 'here' })).action, 'joined');
  assert.deepEqual([titleOn('acme/join-a'), titleOn('acme/join-b'), existsSync(worktreePath('acme/join-a')), existsSync(worktreePath('acme/join-b'))], ['theirs', 'theirs', false, false]);
});

test('Change… over HTTPS on a project that carries its own policy: DELEGATE_INVALID, its branch untouched', async (t) => {
  const h = await project('acme/own-home');
  const other = await project('acme/own-other');
  withNoGit(t);
  await enableTeamPolicy(h, { mode: 'here' });
  await enableTeamPolicy(other, { mode: 'here' });
  const head = gh.sha('acme/own-home', 'worca-policy');
  await assert.rejects(enableTeamPolicy(h, { mode: 'follow', delegateTo: 'acme/own-other', change: true }),
    { code: 'DELEGATE_INVALID', message: 'this project carries its own policy; its branch is not a marker' });
  assert.equal(gh.sha('acme/own-home', 'worca-policy'), head);
});

test('publish over HTTPS stops when the README cannot be read: FETCH_FAILED, the team\'s README and the branch stay', async (t) => {
  const h = await project('acme/readme-fail');
  withNoGit(t);
  await enableTeamPolicy(h, { mode: 'here' });
  gh.commit('acme/readme-fail', { branch: 'worca-policy', files: { 'README.md': 'our own words\n' } });
  const doc = (await discoverPolicy(h, { force: true })).doc;
  const head = gh.sha('acme/readme-fail', 'worca-policy');
  gh.failOnce(500, 'boom', { method: 'GET', match: 'README.md' });
  const e = await publishPolicy(h, { ...doc, title: 'new' }).catch((x) => x);
  assert.deepEqual([e.code, e.message, Object.hasOwn(e, 'stderr'), gh.sha('acme/readme-fail', 'worca-policy'), gh.show('acme/readme-fail', 'worca-policy', 'README.md')],
    ['FETCH_FAILED', 'GitHub (HTTP 500): boom', false, head, 'our own words\n']);
});

test('with git installed a failed discovery is asked again by the next unforced trigger: the retry throttle is HTTPS-only', async () => {
  const real = mkdtempSync(join(root, 'real-'));
  execFileSync('git', ['init', '-q', real]);
  execFileSync('git', ['-C', real, 'remote', 'add', 'origin', 'https://github.com/acme/git-pol.git']);
  await addProject({ name: 'git-pol', path: real });
  writeTeamPolicyPrefs(projectKey(real), { hasOrigin: true, slug: 'acme/git-pol', lastDiscoveryError: 'fatal: stubbed', lastDiscoveryAt: new Date().toISOString() });
  const calls = [];
  syncTesting.setGit(async (_cwd, args) => { calls.push(args[0]); return { ok: false, code: 128, stdout: '', stderr: 'fatal: stubbed' }; });
  try { await discoverPolicy(real); } finally { syncTesting.reset(); }
  assert.deepEqual(calls, ['ls-remote']);
});
