// test/git-free-team-api.test.mjs — the Team metrics / Team policy routes without git (P6 Task 11).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { addProject } from '../src/core/projects.mjs';
import { projectKey } from '../src/core/store.mjs';
import { readTeamRepo, writeTeamRepo, readTeamMetricsPrefs } from '../src/core/config.mjs';
import { startTeamMetricsBackground, discoverProject } from '../src/core/metrics/sync.mjs';
import { readScope } from '../src/core/metrics/read.mjs';
import { _testing as ghTesting } from '../src/core/git-free/github.mjs';
import { fakeGithub } from './helpers/fake-github.mjs';
import { withNoGit } from './helpers/git-off.mjs';
import { withEnv } from './helpers/with-env.mjs';
import { discoverPolicy, enableTeamPolicy } from '../src/core/policy/sync.mjs';
import { createWorkspaceWithHomes } from '../src/core/workspace-scan-run.mjs';

const NO_CREDS = { GH_TOKEN: undefined, GITHUB_TOKEN: undefined, WORCA_GH_READ_TOKEN: undefined, WORCA_GH_WRITE_TOKEN: undefined,
  WORCA_GH_APP_ID: undefined, WORCA_GH_APP_KEY_FILE: undefined, WORCA_GH_APP_KEY_B64: undefined };
useTempHome(after);
const gh = await fakeGithub();
ghTesting.setFetch(gh.fetch);
const root = mkdtempSync(join(tmpdir(), 'worca-gf-api-'));   // every fixture folder lives here
let srv, base;
const post = (p, b) => fetch(`${base}${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) });
before(async () => {
  const { app } = await import('../ui/server.mjs');
  srv = http.createServer(app);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
});
after(async () => { ghTesting.reset(); gh.close(); if (srv) await new Promise((r) => srv.close(r)); rmSync(root, { recursive: true, force: true }); });
async function plainProject(name) { const d = mkdtempSync(join(root, `${name}-`)); await addProject({ name, path: d }); return { dir: d, key: projectKey(d) }; }
async function waitFor(fn, what) { const t0 = Date.now(); for (;;) { const v = fn(); if (v) return v; if (Date.now() - t0 > 3000) throw new Error(`timed out: ${what}`); await new Promise((r) => setTimeout(r, 10)); } }

test('Set up team metrics on a folder without git: the repo is asked for, checked, stored, and the branch created', async (t) => {
  gh.repo('acme/typed-api', { files: { a: '1' } });
  const { key } = await plainProject('typed-api');
  withNoGit(t);
  let r = await post(`/api/projects/${key}/team-metrics/enable`, { mode: 'here' });
  assert.deepEqual([r.status, await r.json()], [400, { error: 'type the GitHub repository (owner/name)', code: 'REPO_REQUIRED' }]);
  r = await withEnv(NO_CREDS, () => post(`/api/projects/${key}/team-metrics/enable`, { mode: 'here', repo: 'acme/missing' }));
  assert.deepEqual([r.status, (await r.json()).error, readTeamRepo(key)], [400, 'not found on GitHub: acme/missing (a private repository needs GH_TOKEN)', null]);
  r = await post(`/api/projects/${key}/team-metrics/enable`, { mode: 'here', repo: 'https://github.com/acme/typed-api' });
  const j = await r.json();
  assert.equal(r.status, 200, JSON.stringify(j));
  assert.deepEqual([j.action, j.slug, j.status.enabled, readTeamRepo(key)], ['created', 'acme/typed-api', true, 'acme/typed-api']);
  r = await post(`/api/projects/${key}/policy/enable`, { mode: 'here' });
  assert.deepEqual([r.status, (await r.json()).action], [200, 'created']);
});

test('a failed enable forgets the typed repo; another host is 409 GIT_MISSING on both routes', async (t) => {
  gh.repo('acme/locked', { files: { a: '1' } });
  const { key } = await plainProject('locked');
  const gl = mkdtempSync(join(root, 'gl-'));
  mkdirSync(join(gl, '.git'));
  writeFileSync(join(gl, '.git', 'config'), '[remote "origin"]\n\turl = https://gitlab.com/acme/gl.git\n');
  await addProject({ name: 'gl', path: gl });
  withNoGit(t);
  gh.failOnce(403, 'Resource not accessible by integration', { method: 'POST', match: '/git/refs' });
  const r = await post(`/api/projects/${key}/team-metrics/enable`, { mode: 'here', repo: 'acme/locked' });
  assert.deepEqual([r.status, (await r.json()).code, readTeamRepo(key)], [502, 'PUSH_REJECTED', null]);
  for (const route of ['team-metrics', 'policy']) {
    const g = await post(`/api/projects/${projectKey(gl)}/${route}/enable`, { mode: 'here' });
    assert.deepEqual([g.status, (await g.json()).code], [409, 'GIT_MISSING']);
  }
});

test('the team metrics loop runs over HTTPS without git: its first tick discovers a GitHub origin', async (t) => {
  gh.repo('acme/loop', { files: { a: '1' } });
  gh.commit('acme/loop', { branch: 'worca-metrics', orphan: true, files: { '.worca-metrics/config.json': '{"schema":1}' } });
  const d = mkdtempSync(join(root, 'loop-'));
  mkdirSync(join(d, '.git'));
  writeFileSync(join(d, '.git', 'config'), '[remote "origin"]\n\turl = https://github.com/acme/loop.git\n');
  await addProject({ name: 'loop', path: d });
  withNoGit(t);
  const stop = startTeamMetricsBackground({ log: () => {} });
  try { await waitFor(() => readTeamMetricsPrefs(projectKey(d))?.enabled, 'the loop to discover acme/loop'); } finally { stop(); }
});

test('metrics-scan accepts a GitHub member without git', async (t) => {
  const d = mkdtempSync(join(root, 'scan-'));
  mkdirSync(join(d, '.git'));
  writeFileSync(join(d, '.git', 'config'), '[remote "origin"]\n\turl = https://github.com/acme/loop.git\n');
  withNoGit(t);
  const r = await post('/api/workspaces/metrics-scan', { projectPaths: [d] });
  const j = await r.json();
  assert.equal(r.status, 200, JSON.stringify(j));
  assert.deepEqual([j.members[0].slug, j.members[0].hasOrigin], ['acme/loop', true]);
});

test('a project whose .git names its origin ignores a typed repo', async (t) => {
  gh.repo('acme/hasorigin', { files: { a: '1' } });
  const dir = mkdtempSync(join(root, 'hasorigin-'));
  mkdirSync(join(dir, '.git'));
  writeFileSync(join(dir, '.git', 'config'), '[remote "origin"]\n\turl = https://github.com/acme/hasorigin.git\n');
  await addProject({ name: 'hasorigin', path: dir });
  const key = projectKey(dir);
  withNoGit(t);
  const r = await post(`/api/projects/${key}/policy/enable`, { mode: 'here', repo: 'acme/other' });
  assert.deepEqual([r.status, (await r.json()).action, readTeamRepo(key)], [200, 'created', null]);
});

test('a typed repo that is not a string is 400 on both routes, never stored', async (t) => {
  const { key } = await plainProject('nonstring');
  withNoGit(t);
  for (const route of ['team-metrics', 'policy']) {
    for (const repo of [{ toString: 0 }, ['acme/arr']]) {
      const r = await post(`/api/projects/${key}/${route}/enable`, { mode: 'here', repo });
      assert.deepEqual([r.status, (await r.json()).error, readTeamRepo(key)], [400, 'repo must be a string', null], `${route} ${JSON.stringify(repo)}`);
    }
  }
});

test('with git installed a typed repo is never taken', async () => {
  gh.repo('acme/withgit', { files: { a: '1' } });
  const { key } = await plainProject('withgit');
  const r = await post(`/api/projects/${key}/team-metrics/enable`, { mode: 'here', repo: 'acme/withgit' });
  assert.deepEqual([r.status, (await r.json()).code, readTeamRepo(key)], [400, 'NO_ORIGIN', null]);
});

test('policy: a failed enable forgets the typed repo; GITHUB_* is 502 on both routes; REPO_REQUIRED is 400', async (t) => {
  gh.repo('acme/codes', { files: { a: '1' } });
  const { key } = await plainProject('codes');
  withNoGit(t);
  let r = await post(`/api/projects/${key}/policy/enable`, { mode: 'here' });
  assert.deepEqual([r.status, (await r.json()).code], [400, 'REPO_REQUIRED']);
  gh.failOnce(403, 'Resource not accessible by integration', { method: 'POST', match: '/git/refs' });
  r = await post(`/api/projects/${key}/policy/enable`, { mode: 'here', repo: 'acme/codes' });
  assert.deepEqual([(await r.json()).code, readTeamRepo(key)], ['PUSH_REJECTED', null]);
  for (const route of ['team-metrics', 'policy']) {
    gh.rateLimitOnce(1_800_000_000);
    r = await post(`/api/projects/${key}/${route}/enable`, { mode: 'here', repo: 'acme/codes' });
    assert.deepEqual([r.status, (await r.json()).code], [502, 'GITHUB_RATE_LIMITED'], route);
    ghTesting.reset(); ghTesting.setFetch(gh.fetch);   // the rate limit refuses every later request for the hour otherwise
  }
});

test('two setup dialogs on one Folder at once never cross repositories: the second enables where the first stored its repo', async (t) => {
  gh.repo('acme/cross1', { files: { a: '1' } });
  gh.repo('acme/cross2', { files: { a: '1' } });
  const { key } = await plainProject('cross');
  withNoGit(t);
  // The metrics request's repository check answers late: the policy request, unserialized, would store acme/cross2 meanwhile.
  ghTesting.setFetch(async (url, init) => {
    if (new URL(url).pathname === '/repos/acme/cross1') await new Promise((r) => setTimeout(r, 150));
    return gh.fetch(url, init);
  });
  try {
    const m = post(`/api/projects/${key}/team-metrics/enable`, { mode: 'here', repo: 'acme/cross1' });
    await new Promise((r) => setTimeout(r, 20));
    const [a, b] = await Promise.all([m, post(`/api/projects/${key}/policy/enable`, { mode: 'here', repo: 'acme/cross2' })]);
    const [ja, jb] = [await a.json(), await b.json()];
    assert.deepEqual([a.status, ja.slug, b.status, jb.slug, readTeamRepo(key)], [200, 'acme/cross1', 200, 'acme/cross1', 'acme/cross1'], JSON.stringify([ja, jb]));
    assert.deepEqual([!!gh.show('acme/cross1', 'worca-policy', '.worca-policy/policy.json'), gh.show('acme/cross2', 'worca-policy', '.worca-policy/policy.json')], [true, null]);
  } finally { ghTesting.setFetch(gh.fetch); }
});

test('a failed setup forgets only the repo it stored: a policy setup at the same time keeps its repository', async (t) => {
  gh.repo('acme/cross3', { files: { a: '1' } });
  const { key } = await plainProject('cross3');
  withNoGit(t);
  // The metrics branch is refused late (HTTP 500 after 150 ms); the policy request comes in meanwhile.
  ghTesting.setFetch(async (url, init = {}) => {
    if (init.method === 'POST' && new URL(url).pathname === '/repos/acme/cross3/git/trees' && String(init.body).includes('.worca-metrics')) {
      await new Promise((r) => setTimeout(r, 150));
      return new Response(JSON.stringify({ message: 'boom' }), { status: 500, headers: { 'content-type': 'application/json' } });
    }
    return gh.fetch(url, init);
  });
  try {
    const m = post(`/api/projects/${key}/team-metrics/enable`, { mode: 'here', repo: 'acme/cross3' });
    await new Promise((r) => setTimeout(r, 20));
    const [a, b] = await Promise.all([m, post(`/api/projects/${key}/policy/enable`, { mode: 'here', repo: 'acme/cross3' })]);
    const [ja, jb] = [await a.json(), await b.json()];
    assert.deepEqual([a.status, ja.code, b.status, jb.action, jb.status?.present, readTeamRepo(key)], [502, 'PUSH_REJECTED', 200, 'created', true, 'acme/cross3'], JSON.stringify([ja, jb]));
  } finally { ghTesting.setFetch(gh.fetch); }
});

test('a new workspace without git finds its metrics and policy home among GitHub members; the member routes write markers', async (t) => {
  gh.repo('acme/ws-home', { files: { a: '1' } });
  gh.repo('acme/ws-mem', { files: { a: '1' } });
  gh.commit('acme/ws-home', { branch: 'worca-metrics', orphan: true, files: { '.worca-metrics/config.json': '{"schema":1}' } });
  const ghDir = (name) => {
    const d = mkdtempSync(join(root, `${name}-`));
    mkdirSync(join(d, '.git'));
    writeFileSync(join(d, '.git', 'config'), `[remote "origin"]\n\turl = https://github.com/acme/${name}.git\n`);
    return d;
  };
  const home = ghDir('ws-home');
  const mem = ghDir('ws-mem');
  await addProject({ name: 'ws-home', path: home });
  await addProject({ name: 'ws-mem', path: mem });
  withNoGit(t);
  await enableTeamPolicy(home, { mode: 'here' });
  await discoverPolicy(home, { force: true });
  const { workspace, metricsHomeAuto } = await createWorkspaceWithHomes({ name: 'gf-ws', projectPaths: [home, mem] });
  assert.deepEqual([workspace.metricsProject, workspace.policyProject, metricsHomeAuto], [home, home, true]);
  let r = await post(`/api/workspaces/${workspace.id}/metrics-route`, {});
  assert.equal(r.status, 200, JSON.stringify(await r.clone().json()));
  assert.equal(JSON.parse(gh.show('acme/ws-mem', 'worca-metrics', '.worca-metrics/config.json')).delegateTo, 'acme/ws-home');
  r = await post(`/api/workspaces/${workspace.id}/policy-route`, {});
  assert.equal(r.status, 200, JSON.stringify(await r.clone().json()));
  assert.equal(JSON.parse(gh.show('acme/ws-mem', 'worca-policy', '.worca-policy/policy.json')).delegateTo, 'acme/ws-home');
});

test('the Timeline routes read PR events from the snapshot without git', async (t) => {
  gh.repo('acme/tl', { files: { a: '1' } });
  const ev = JSON.stringify({ v: 1, kind: 'pr', repo: 'acme/tl', number: 7, head: 'feat/x', state: 'MERGED',
    createdAt: '2026-10-01T09:00:00Z', mergedAt: '2026-10-02T09:00:00Z' });
  gh.commit('acme/tl', { branch: 'worca-metrics', orphan: true, files: { '.worca-metrics/config.json': '{"schema":1}', '.worca-metrics/prs/7.json': ev } });
  const d = mkdtempSync(join(root, 'tl-'));
  mkdirSync(join(d, '.git'));
  writeFileSync(join(d, '.git', 'config'), '[remote "origin"]\n\turl = https://github.com/acme/tl.git\n');
  await addProject({ name: 'tl', path: d });
  withNoGit(t);
  await discoverProject(d, { force: true });
  await readScope({ kind: 'project', id: projectKey(d) });   // the snapshot, as the Timeline page's first read builds it
  const scope = `project:${projectKey(d)}`;
  const events = await (await fetch(`${base}/api/team-metrics/pr-events?scope=${encodeURIComponent(scope)}`)).json();
  assert.deepEqual(events.prs.map((p) => [p.repo, p.number]), [['acme/tl', 7]]);
  const prs = await (await post('/api/team-metrics/prs', { scope, runs: [] })).json();
  assert.deepEqual(prs.status.actionRepos, ['acme/tl']);
});

test('an empty GitHub repository field is no repository: REPO_REQUIRED on both enable routes, nothing stored', async (t) => {
  const { key } = await plainProject('emptyrepo');
  withNoGit(t);
  for (const route of ['team-metrics', 'policy']) {
    const r = await post(`/api/projects/${key}/${route}/enable`, { mode: 'here', repo: '' });
    assert.deepEqual([r.status, await r.json(), readTeamRepo(key)], [400, { error: 'type the GitHub repository (owner/name)', code: 'REPO_REQUIRED' }, null], route);
  }
});

test('memberHasTeamRepo with git installed: a Folder member whose .git names an origin has none; a typed Folder member has one', async () => {
  const fo = mkdtempSync(join(root, 'member-fo-'));
  mkdirSync(join(fo, '.git'));
  writeFileSync(join(fo, '.git', 'config'), '[remote "origin"]\n\turl = https://github.com/acme/member-fo.git\n');
  await addProject({ name: 'member-fo', path: fo, vcs: 'none' });
  const { dir: typed, key } = await plainProject('member-typed');
  writeTeamRepo(key, 'acme/member-typed');
  const { memberHasTeamRepo } = await import('../src/core/workspaces.mjs');   // lazy: a missing export would fail every test in the file, not this one
  assert.deepEqual([memberHasTeamRepo(fo), memberHasTeamRepo(typed)], [false, true]);
});

test('a private team repository read without a token: the policy enable answer is one line, no stderr repeating it', async (t) => {
  const d = mkdtempSync(join(root, 'hidden-'));
  mkdirSync(join(d, '.git'));
  writeFileSync(join(d, '.git', 'config'), '[remote "origin"]\n\turl = https://github.com/acme/hidden-api.git\n');   // not on the fake
  await addProject({ name: 'hidden-api', path: d });
  withNoGit(t);
  const r = await withEnv(NO_CREDS, () => post(`/api/projects/${projectKey(d)}/policy/enable`, { mode: 'here' }));
  assert.deepEqual([r.status, await r.json()], [502, { error: 'not found on GitHub: acme/hidden-api (a private repository needs GH_TOKEN)', code: 'REMOTE_UNREACHABLE' }]);
});
