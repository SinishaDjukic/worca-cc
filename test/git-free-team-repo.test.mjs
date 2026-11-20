// test/git-free-team-repo.test.mjs — the team repository of a project without git: .git/config, or typed once (P6 Task 7).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { addProject } from '../src/core/projects.mjs';
import { projectKey } from '../src/core/store.mjs';
import { readTeamRepo, writeTeamRepo } from '../src/core/config.mjs';
import { metricsSlugFromUrl } from '../src/core/metrics/sync.mjs';
import { readOriginUrl, teamRepoState, teamOverHttps, projectSlugHttps, setTypedTeamRepo, teamRunDiscover } from '../src/core/git-free/team-repo.mjs';
import { _testing as ghTesting } from '../src/core/git-free/github.mjs';
import { fakeGithub } from './helpers/fake-github.mjs';
import { withNoGit } from './helpers/git-off.mjs';
import { withEnv } from './helpers/with-env.mjs';
import { BITBUCKET_NEEDS_GIT } from '../src/core/git-available.mjs';

const NO_CREDS = { GH_TOKEN: undefined, GITHUB_TOKEN: undefined, WORCA_GH_READ_TOKEN: undefined, WORCA_GH_WRITE_TOKEN: undefined,
  WORCA_GH_APP_ID: undefined, WORCA_GH_APP_KEY_FILE: undefined, WORCA_GH_APP_KEY_B64: undefined };
useTempHome(after);
const gh = await fakeGithub();
ghTesting.setFetch(gh.fetch);
after(() => { ghTesting.reset(); gh.close(); });
const root = mkdtempSync(join(tmpdir(), 'worca-gf-repo-'));   // every fixture folder of this file, removed at the end
after(() => rmSync(root, { recursive: true, force: true }));
function folder(files = {}) {
  const d = mkdtempSync(join(root, 'f-'));
  for (const [rel, c] of Object.entries(files)) { mkdirSync(dirname(join(d, rel)), { recursive: true }); writeFileSync(join(d, rel), c); }
  return d;
}
const ORIGIN = (url) => ({ '.git/config': `[remote "origin"]\n\turl = ${url}\n` });

test('readOriginUrl reads .git/config without git: pushurl over url, quotes, comments, CRLF, the exact remote name', () => {
  assert.equal(readOriginUrl(folder({ '.git/config': '[core]\n\tbare = false\n[remote "upstream"]\n\turl = https://github.com/up/x.git\n[remote "origin"]\n\turl = https://github.com/acme/billing.git\n\tfetch = +refs/heads/*:refs/remotes/origin/*\n' })), 'https://github.com/acme/billing.git');
  assert.equal(readOriginUrl(folder({ '.git/config': '[remote "origin"]\r\n\turl = "git@github.com:acme/billing.git" ; trailing\r\n\tpushurl = https://github.com/acme/billing-push\r\n' })), 'https://github.com/acme/billing-push');
  assert.equal(readOriginUrl(folder({ '.git/config': '# c\n[Remote "origin"]\n  URL = https://github.com/acme/ci.git\n' })), 'https://github.com/acme/ci.git');
  assert.equal(readOriginUrl(folder({ '.git/config': '[remote "Origin"]\n\turl = https://github.com/acme/other.git\n' })), null);
  assert.equal(readOriginUrl(folder({ 'README.md': 'x' })), null);
});

test('a .git file (worktree or submodule) leads to the config that holds the remotes', () => {
  const main = folder({ ...ORIGIN('https://github.com/acme/wt.git'), '.git/worktrees/w1/commondir': '../..\n' });
  assert.equal(readOriginUrl(folder({ '.git': `gitdir: ${join(main, '.git', 'worktrees', 'w1')}\n` })), 'https://github.com/acme/wt.git');
  const sup = folder({ '.git/modules/lib/config': '[remote "origin"]\n\turl = https://github.com/acme/lib.git\n', 'lib/.git': 'gitdir: ../.git/modules/lib\n' });
  assert.equal(readOriginUrl(join(sup, 'lib')), 'https://github.com/acme/lib.git');
});

test('readOriginUrl reads only regular files of at most 1 MiB: a FIFO or a device never blocks the server', { skip: process.platform === 'win32' }, () => {
  const fifoConfig = folder({ '.git/HEAD': 'ref: refs/heads/main\n' });
  execFileSync('mkfifo', [join(fifoConfig, '.git', 'config')]);
  const fifoCommon = folder({ 'wt/config': '[remote "origin"]\n\turl = https://github.com/acme/wt.git\n', '.git': 'gitdir: wt\n' });
  execFileSync('mkfifo', [join(fifoCommon, 'wt', 'commondir')]);
  const device = folder({ '.git/HEAD': 'ref: refs/heads/main\n' });
  symlinkSync('/dev/zero', join(device, '.git', 'config'));
  const huge = folder({ '.git/config': `[remote "origin"]\n\turl = https://github.com/acme/huge.git\n${'#'.repeat(1 << 20)}\n` });
  // In a child with a time limit: a read that blocks would hang this whole file.
  const mod = new URL('../src/core/git-free/team-repo.mjs', import.meta.url).href;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e',
    `const { readOriginUrl } = await import(${JSON.stringify(mod)}); console.log(JSON.stringify(process.argv.slice(1).map((d) => readOriginUrl(d))));`,
    fifoConfig, fifoCommon, device, huge], { encoding: 'utf8', timeout: 10_000 });
  assert.equal(r.error?.code, undefined, 'a read blocked');
  assert.deepEqual(JSON.parse(r.stdout), [null, 'https://github.com/acme/wt.git', null, null], r.stderr);
});

test('teamOverHttps truth table: without git always; with git only a folder whose team repo was typed', async (t) => {
  const withOrigin = folder(ORIGIN('https://github.com/acme/billing.git'));
  const plain = folder({ 'a.txt': 'a' });
  const typed = folder({ 'a.txt': 'a' });
  await addProject({ name: 'typed', path: typed });
  writeTeamRepo(projectKey(typed), 'acme/typed');
  assert.deepEqual([withOrigin, plain, typed].map(teamOverHttps), [false, false, true]);
  withNoGit(t);
  assert.deepEqual([withOrigin, plain, typed].map(teamOverHttps), [true, true, true]);
  assert.deepEqual(teamRepoState(withOrigin), { kind: 'origin', url: 'https://github.com/acme/billing.git' });
  assert.deepEqual(teamRepoState(folder({ '.git/config': '[core]\n' })), { kind: 'git-no-origin' });
  assert.deepEqual(teamRepoState(plain), { kind: 'none' });
  assert.deepEqual(teamRepoState(typed), { kind: 'typed', repo: 'acme/typed' });
});

test('projectSlugHttps: a GitHub origin, another host, a typed repo, a repo without origin, nothing known', async () => {
  const o = { slugFromUrl: metricsSlugFromUrl, fallbackSlug: () => 'fallback' };
  const typed = folder({ 'a.txt': 'a' });
  await addProject({ name: 'typed2', path: typed });
  writeTeamRepo(projectKey(typed), 'Acme/Typed');
  assert.deepEqual(projectSlugHttps(folder(ORIGIN('https://github.com/acme/billing.git')), o),
    { slug: 'acme/billing', hasOrigin: true, originUrl: 'https://github.com/acme/billing.git', remotesOk: true });
  assert.deepEqual(projectSlugHttps(folder(ORIGIN('https://gitlab.com/acme/billing.git')), o),
    { slug: 'gitlab.com/acme/billing', hasOrigin: true, originUrl: 'https://gitlab.com/acme/billing.git', remotesOk: true, needsGit: true });
  assert.deepEqual(projectSlugHttps(typed, o), { slug: 'acme/typed', hasOrigin: true, originUrl: 'https://github.com/Acme/Typed', remotesOk: true });
  assert.deepEqual(projectSlugHttps(folder({ '.git/config': '[core]\n' }), o), { slug: 'fallback', hasOrigin: false, originUrl: null, remotesOk: true });
  assert.deepEqual(projectSlugHttps(folder({ 'a.txt': 'a' }), o), { slug: 'fallback', hasOrigin: false, originUrl: null, remotesOk: false, repoInput: true });
});

test('projectSlugHttps: a GitHub repository whose name the metrics slug changes (a leading . or -, a trailing -) needs git', () => {
  const o = { slugFromUrl: metricsSlugFromUrl, fallbackSlug: () => 'fallback' };
  assert.deepEqual(projectSlugHttps(folder(ORIGIN('https://github.com/acme/.github.git')), o),
    { slug: 'acme/github', hasOrigin: true, originUrl: 'https://github.com/acme/.github.git', remotesOk: true, needsGit: true });
  assert.deepEqual(projectSlugHttps(folder(ORIGIN('git@github.com:acme/tools-.git')), o),
    { slug: 'acme/tools', hasOrigin: true, originUrl: 'git@github.com:acme/tools-.git', remotesOk: true, needsGit: true });
  assert.equal(projectSlugHttps(folder(ORIGIN('https://github.com/acme/-x')), o).needsGit, true);
  assert.equal(projectSlugHttps(folder(ORIGIN('https://github.com/Acme/Some.Name_x.git')), o).needsGit, undefined);   // case alone changes nothing
});

test('projectSlugHttps: an origin URL carrying user:password (a CI token URL) names its GitHub repository; judged without it', () => {
  const o = { slugFromUrl: metricsSlugFromUrl, fallbackSlug: () => 'fallback' };
  const url = 'https://x-access-token:ghp_ORIGIN0123456789@github.com/acme/ci-token.git';
  assert.deepEqual(projectSlugHttps(folder(ORIGIN(url)), o), { slug: 'acme/ci-token', hasOrigin: true, originUrl: url, remotesOk: true });
  assert.equal(projectSlugHttps(folder(ORIGIN('http://user:p%40ss@GitHub.com/Acme/B')), o).needsGit, undefined);
  assert.equal(projectSlugHttps(folder(ORIGIN('https://user:pass@gitlab.com/acme/b.git')), o).needsGit, true);
});

test('setTypedTeamRepo: owner/name or a github.com URL, checked on GitHub, stored as GitHub spells it', async (t) => {
  gh.repo('Acme/Billing-API', { files: { a: '1' } });
  const dir = folder({ 'a.txt': 'a' });
  await addProject({ name: 'b', path: dir });
  const key = projectKey(dir);
  withNoGit(t);
  assert.equal(await setTypedTeamRepo(key, dir, 'acme/billing-api'), 'Acme/Billing-API');
  assert.equal(readTeamRepo(key), 'Acme/Billing-API');
  await assert.rejects(setTypedTeamRepo(key, dir, 'https://gitlab.com/a/b'), { code: 'GIT_MISSING' });
  await assert.rejects(setTypedTeamRepo(key, dir, 'https://jdoe@bitbucket.org/acme/api.git'), { code: 'GIT_MISSING', message: BITBUCKET_NEEDS_GIT });
  await assert.rejects(setTypedTeamRepo(key, dir, 'not a repo'), { code: 'BAD_REQUEST', message: 'repo must be owner/name or a github.com URL' });
  await withEnv(NO_CREDS, () => assert.rejects(setTypedTeamRepo(key, dir, 'acme/missing'),
    { code: 'BAD_REQUEST', message: 'not found on GitHub: acme/missing (a private repository needs GH_TOKEN)' }));
  const named = folder(ORIGIN('https://github.com/acme/billing.git'));
  await assert.rejects(setTypedTeamRepo(projectKey(named), named, 'acme/x'), { code: 'BAD_REQUEST', message: 'this project already names its repository in .git/config' });
  writeTeamRepo(key, null);
  assert.equal(readTeamRepo(key), null);
});

test('setTypedTeamRepo refuses a repository the metrics slug would misname (acme/.github, a trailing -): GIT_MISSING, nothing stored', async (t) => {
  gh.repo('acme/.github', { files: { a: '1' } });
  gh.repo('acme/tools-', { files: { a: '1' } });
  const dir = folder({ 'a.txt': 'a' });
  await addProject({ name: 'misnamed', path: dir });
  const key = projectKey(dir);
  withNoGit(t);
  for (const raw of ['acme/.github', 'https://github.com/acme/tools-']) {
    await assert.rejects(setTypedTeamRepo(key, dir, raw), { code: 'GIT_MISSING', message: 'git is not installed on this machine' }, raw);
  }
  assert.equal(readTeamRepo(key), null);
});

test('a typed folder that gains a .git goes back to git', async () => {
  const dir = folder();
  await addProject({ name: 'gains-git', path: dir });
  writeTeamRepo(projectKey(dir), 'acme/gains-git');
  assert.equal(teamOverHttps(dir), true);
  mkdirSync(join(dir, '.git'));
  assert.equal(teamOverHttps(dir), false);
});

test('an unquoted url keeps its value before a ; comment', () => {
  assert.equal(readOriginUrl(folder({ '.git/config': '[remote "origin"]\n\turl = https://github.com/acme/c.git ; note\n' })), 'https://github.com/acme/c.git');
});

test('setTypedTeamRepo names the repository as parsed, never the text pasted; the private-repository hint only without a token', async (t) => {
  const dir = folder({ 'a.txt': 'a' });
  await addProject({ name: 'priv', path: dir });
  const key = projectKey(dir);
  withNoGit(t);
  await withEnv(NO_CREDS, () => assert.rejects(setTypedTeamRepo(key, dir, ' https://github.com/acme/private-one '),
    { code: 'BAD_REQUEST', message: 'not found on GitHub: acme/private-one (a private repository needs GH_TOKEN)' }));
  await withEnv({ ...NO_CREDS, GH_TOKEN: 'tok-x' }, () => assert.rejects(setTypedTeamRepo(key, dir, 'acme/private-one'),
    { code: 'BAD_REQUEST', message: 'not found on GitHub: acme/private-one' }));
  const n = gh.calls.length;
  await withEnv(NO_CREDS, () => assert.rejects(setTypedTeamRepo(key, dir, 'https://ghp_PASTED0123456789@github.com/acme/private-one'),
    { code: 'BAD_REQUEST', message: 'not found on GitHub: acme/private-one (a private repository needs GH_TOKEN)' }));
  assert.deepEqual(gh.calls.slice(n).map((c) => [c.path, c.auth]), [['/repos/acme/private-one', null]]);   // the pasted token is never sent
  assert.equal(readTeamRepo(key), null);
});

test('setTypedTeamRepo takes github.com/owner/name without a scheme and owner/name.git', async (t) => {
  gh.repo('acme/spelled', { files: { a: '1' } });
  const dir = folder({ 'a.txt': 'a' });
  await addProject({ name: 'spelled', path: dir });
  const key = projectKey(dir);
  withNoGit(t);
  for (const u of ['github.com/acme/spelled', 'www.github.com/acme/spelled', 'GitHub.com/acme/spelled.git', 'acme/spelled.git', 'github.com/acme/spelled/tree/main']) {
    assert.equal(await setTypedTeamRepo(key, dir, u), 'acme/spelled', u);
  }
  await assert.rejects(setTypedTeamRepo(key, dir, 'github.com/acme'), { code: 'BAD_REQUEST', message: 'repo must be owner/name or a github.com URL' });
});

test('setTypedTeamRepo checks the repository with the write credential, the one the team branches use', async (t) => {
  gh.repo('acme/w-only', { files: { a: '1' } });
  const dir = folder({ 'a.txt': 'a' });
  await addProject({ name: 'wonly', path: dir });
  withNoGit(t);
  const n = gh.calls.length;
  await withEnv({ ...NO_CREDS, WORCA_GH_READ_TOKEN: 'tok-r', WORCA_GH_WRITE_TOKEN: 'tok-w' }, () => setTypedTeamRepo(projectKey(dir), dir, 'acme/w-only'));
  assert.deepEqual(gh.calls.slice(n).map((c) => [c.path, c.auth]), [['/repos/acme/w-only', 'Bearer tok-w']]);
});

test('a typed repo is read only for a registered project: an unregistered folder never reads one by its key', () => {
  const dir = folder({ 'a.txt': 'a' });
  writeTeamRepo(projectKey(dir), 'acme/stale');
  assert.deepEqual([teamOverHttps(dir), teamRepoState(dir)], [false, { kind: 'none' }]);
  writeTeamRepo(projectKey(dir), null);
});

test('setTypedTeamRepo takes a repository URL copied from the browser; a github.com URL never answers GIT_MISSING', async (t) => {
  gh.repo('acme/browser', { files: { a: '1' } });
  const dir = folder({ 'a.txt': 'a' });
  await addProject({ name: 'browser', path: dir });
  const key = projectKey(dir);
  withNoGit(t);
  for (const u of ['https://github.com/acme/browser/tree/main', 'https://www.github.com/acme/browser', 'https://github.com/acme/browser/blob/main/src/a.js',
    'https://github.com/acme/browser/pull/3/files', 'https://WWW.GitHub.com/acme/browser/issues', 'https://github.com/acme/browser/commits/main/']) {
    assert.equal(await setTypedTeamRepo(key, dir, u), 'acme/browser', u);
  }
  for (const u of ['https://github.com/acme/browser/settings/access', 'https://www.github.com/acme', 'git@github.com:acme/browser/x']) {
    await assert.rejects(setTypedTeamRepo(key, dir, u), { code: 'BAD_REQUEST', message: 'repo must be owner/name or a github.com URL' }, u);
  }
  await assert.rejects(setTypedTeamRepo(key, dir, 'https://gitlab.com/acme/browser/tree/main'), { code: 'GIT_MISSING' });
});

test('teamRunDiscover: a run discovers its team policy / metrics for a Git run, and whenever the team branches go over HTTPS; a no-project run never', async (t) => {
  const withOrigin = folder(ORIGIN('https://github.com/acme/billing.git'));
  const plain = folder({ 'a.txt': 'a' });
  const typed = folder({ 'a.txt': 'a' });
  await addProject({ name: 'typed-run', path: typed });
  writeTeamRepo(projectKey(typed), 'acme/typed-run');
  const row = (mode) => [withOrigin, plain, typed].map((d) => teamRunDiscover(mode, d));
  assert.deepEqual([row('git'), row('folder'), row('none')], [['if-missing', 'if-missing', 'if-missing'], [false, false, 'if-missing'], [false, false, false]]);
  withNoGit(t);
  // Every no-project run shares one project key: its work folder's .git/config must not name a team repository for all.
  assert.deepEqual([row('git'), row('folder'), row('none')], [['if-missing', 'if-missing', 'if-missing'], ['if-missing', 'if-missing', 'if-missing'], [false, false, false]]);
});
