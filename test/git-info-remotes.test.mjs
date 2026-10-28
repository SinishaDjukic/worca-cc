// test/git-info-remotes.test.mjs
// Fork support in git-info: remote URL parsing, `git remote -v` listing, and the
// argv shapes for same-repo vs cross-repo PRs (push / create / recover / view).
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseRemoteUrl, remoteRepoSlug, sameRepo, listRemotes, listRemoteBranches, prBaseBranch, prHeadRef,
  pushBranch, createPr, ghRepoAccess, ghForkRepo, prMergeable, findPrForBranch, prLifecycleState, prProviderFor, prHostsAvailable, anyPrHost,
  markPrReady, closePr, _testing as gitInfo,
} from '../src/core/git-info.mjs';
import { forgeOf, forgeOfPrUrl, prNumberFromUrl } from '../src/core/forge.mjs';
import * as azurePr from '../src/core/pr/azure.mjs';
import * as bitbucketPr from '../src/core/pr/bitbucket.mjs';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkRows } from './helpers/rows.mjs';
import { withEnv } from './helpers/with-env.mjs';

const NO_ADO = { WORCA_ADO_TOKEN: undefined, WORCA_ADO_READ_TOKEN: undefined, WORCA_ADO_WRITE_TOKEN: undefined, AZURE_DEVOPS_EXT_PAT: undefined, WORCA_BB_TOKEN: undefined, WORCA_BB_READ_TOKEN: undefined, WORCA_BB_WRITE_TOKEN: undefined };
/** Every ambient variable that opens a D6/D7/D20 host-lookup gate: Azure credentials, push-as-person, App mode. */
const CLOSED_GATES = { ...NO_ADO, WORCA_GH_AS_PERSON: undefined, WORCA_BROKER_URL: undefined,
  WORCA_GH_APP_ID: undefined, WORCA_GH_APP_KEY_FILE: undefined, WORCA_GH_APP_KEY_B64: undefined };

afterEach(() => gitInfo.reset());

const okOut = (stdout) => Promise.resolve({ ok: true, stdout, stderr: '', code: 0 });
const fail = (stderr, code = 1) => Promise.resolve({ ok: false, stdout: '', stderr, code });

test('remote URL helpers: parseRemoteUrl forms/nulls, remoteRepoSlug, sameRepo, prHeadRef', async () => {
  await checkRows([
    { name: 'parseRemoteUrl handles https, ssh://, scp-style and git:// forms', run: () => {
      assert.deepEqual(parseRemoteUrl('https://github.com/Owner/Repo.git'), { host: 'github.com', owner: 'Owner', repo: 'Repo' });
      assert.deepEqual(parseRemoteUrl('https://me@github.com/o/r'), { host: 'github.com', owner: 'o', repo: 'r' });
      assert.deepEqual(parseRemoteUrl('ssh://git@github.com/o/r.git'), { host: 'github.com', owner: 'o', repo: 'r' });
      assert.deepEqual(parseRemoteUrl('ssh://git@ghe.corp:2222/o/r.git'), { host: 'ghe.corp', owner: 'o', repo: 'r' });
      assert.deepEqual(parseRemoteUrl('git@github.com:o/r.git'), { host: 'github.com', owner: 'o', repo: 'r' });
      assert.deepEqual(parseRemoteUrl('git@github.com:o/r'), { host: 'github.com', owner: 'o', repo: 'r' });
      assert.deepEqual(parseRemoteUrl('git@github.com:/o/r.git'), { host: 'github.com', owner: 'o', repo: 'r' }, 'scp-style with an absolute path');
      assert.deepEqual(parseRemoteUrl('github.com:o/r'), { host: 'github.com', owner: 'o', repo: 'r' }, 'scp-style without a user');
      assert.deepEqual(parseRemoteUrl('git://GitHub.com/o/r.git/'), { host: 'github.com', owner: 'o', repo: 'r' });
      // GitHub's SSH-over-443 alias names the same repo; gh's --repo only accepts the real host.
      assert.deepEqual(parseRemoteUrl('ssh://git@ssh.github.com:443/o/r.git'), { host: 'github.com', owner: 'o', repo: 'r' });
      assert.equal(remoteRepoSlug(parseRemoteUrl('ssh://git@ssh.github.com:443/o/r.git')), 'o/r');
      assert.ok(sameRepo(parseRemoteUrl('ssh://git@ssh.github.com:443/o/r.git'), parseRemoteUrl('https://github.com/o/r')));
    } },
    { name: 'parseRemoteUrl returns null for local paths and junk', run: () => {
      for (const u of ['', '/srv/git/repo.git', '../other', 'C:\\repos\\x', 'C:/repos/x', 'file:///srv/git/repo.git', 'https://github.com/only-owner', null]) {
        assert.equal(parseRemoteUrl(u), null, String(u));
      }
    } },
    { name: 'remoteRepoSlug omits github.com and keeps other hosts; sameRepo is case-insensitive', run: () => {
      assert.equal(remoteRepoSlug({ host: 'github.com', owner: 'o', repo: 'r' }), 'o/r');
      assert.equal(remoteRepoSlug({ host: 'ghe.corp', owner: 'o', repo: 'r' }), 'ghe.corp/o/r');
      assert.equal(remoteRepoSlug(null), null);
      assert.ok(sameRepo({ host: 'github.com', owner: 'Me', repo: 'Repo' }, { host: 'github.com', owner: 'me', repo: 'repo' }));
      assert.ok(!sameRepo({ host: 'github.com', owner: 'me', repo: 'repo' }, { host: 'github.com', owner: 'up', repo: 'repo' }));
      assert.ok(!sameRepo({ host: 'ghe.corp', owner: 'me', repo: 'repo' }, { host: 'github.com', owner: 'me', repo: 'repo' }));
      assert.ok(!sameRepo(null, { host: 'github.com', owner: 'me', repo: 'repo' }));
      assert.equal(prHeadRef('feat/x', 'me'), 'me:feat/x');
      assert.equal(prHeadRef('feat/x', null), 'feat/x');
    } },
  ]);
});

test('listRemotes: parses git remote -v (push URL wins); empty output and git failures never throw', async () => {
  await checkRows([
    { name: 'listRemotes parses `git remote -v` (fetch + push per name, push URL wins for owner/repo)', run: async () => {
      const seen = [];
      gitInfo.setRunner((cmd, args, opts) => {
        seen.push([cmd, ...args, opts?.cwd]);
        return okOut([
          'origin\thttps://github.com/me/repo.git (fetch)',
          'origin\thttps://github.com/me/repo.git (push)',
          'upstream\tgit@github.com:up/repo.git (fetch)',
          'upstream\tgit@github.com:up/repo.git (push)',
          'mirror\thttps://github.com/x/repo.git (fetch)',
          'mirror\tgit@github.com:y/repo.git (push)',
          'local\t/srv/git/repo.git (fetch)',
          'local\t/srv/git/repo.git (push)',
          '',
        ].join('\n'));
      });
      const r = await listRemotes('/repo');
      assert.deepEqual(seen[0], ['git', 'remote', '-v', '/repo']);
      assert.equal(r.ok, true);
      assert.deepEqual(r.remotes.map((x) => x.name), ['origin', 'upstream', 'mirror', 'local']);
      assert.deepEqual(r.remotes[0], {
        name: 'origin', fetchUrl: 'https://github.com/me/repo.git', pushUrl: 'https://github.com/me/repo.git',
        host: 'github.com', owner: 'me', repo: 'repo', slug: 'me/repo',
        forge: 'github', org: null, project: null,
      });
      assert.equal(r.remotes[1].slug, 'up/repo');
      assert.equal(r.remotes[2].owner, 'y', 'push URL wins for the owner');
      assert.deepEqual([r.remotes[3].owner, r.remotes[3].slug], [null, null], 'unparseable stays listed, unparsed');
    } },
    { name: 'listRemotes: empty output is an empty list; git failures are reported without throwing', run: async () => {
      gitInfo.setRunner(() => okOut(''));
      assert.deepEqual(await listRemotes('/repo'), { ok: true, remotes: [] });
      gitInfo.setRunner(() => fail('fatal: not a git repository', 128));
      assert.deepEqual(await listRemotes('/nope'), { ok: false, remotes: [], error: 'fatal: not a git repository' });
      assert.deepEqual(await listRemotes(''), { ok: false, remotes: [], error: 'projectDir is required' });
    } },
  ]);
});

test('Azure DevOps remotes: one identity for every spelling; sameRepo across ssh/https; forge', async () => {
  const want = { host: 'dev.azure.com', org: 'acme', project: 'Shop', owner: 'acme/Shop', repo: 'api' };
  await checkRows([
    { name: 'every URL shape parses to the same identity', run: () => {
      for (const u of [
        'https://dev.azure.com/acme/Shop/_git/api',
        'https://acme@dev.azure.com/acme/Shop/_git/api',
        'https://acme.visualstudio.com/Shop/_git/api',
        'https://acme.visualstudio.com/DefaultCollection/Shop/_git/api',
        'git@ssh.dev.azure.com:v3/acme/Shop/api',
        'ssh://git@ssh.dev.azure.com/v3/acme/Shop/api',
        'acme@vs-ssh.visualstudio.com:v3/acme/Shop/api',
      ]) assert.deepEqual(parseRemoteUrl(u), want, u);
    } },
    { name: 'slug and sameRepo', run: () => {
      const a = parseRemoteUrl('https://dev.azure.com/acme/Shop/_git/api');
      const b = parseRemoteUrl('git@ssh.dev.azure.com:v3/acme/shop/API');
      assert.equal(remoteRepoSlug(a), 'dev.azure.com/acme/Shop/api');
      assert.ok(sameRepo(a, b));
      assert.ok(!sameRepo(a, parseRemoteUrl('https://dev.azure.com/other/Shop/_git/api')));
    } },
    { name: '%20 names and the default-repo short form', run: () => {
      assert.equal(parseRemoteUrl('https://dev.azure.com/acme/My%20Project/_git/My%20Repo').project, 'My Project');
      assert.equal(parseRemoteUrl('https://dev.azure.com/acme/_git/Shop').repo, 'Shop');
    } },
    { name: 'forgeOf / forgeOfPrUrl / prNumberFromUrl', run: () => {
      assert.equal(forgeOf(parseRemoteUrl('https://github.com/o/r')), 'github');
      assert.equal(forgeOf(parseRemoteUrl('https://dev.azure.com/acme/Shop/_git/api')), 'azure');
      assert.equal(forgeOf(parseRemoteUrl('https://gitlab.com/g/r')), null);
      assert.equal(forgeOf(parseRemoteUrl('git@bitbucket.org:acme/api.git')), 'bitbucket');
      assert.equal(forgeOf(null), null);
      assert.equal(forgeOfPrUrl('https://github.com/o/r/pull/3'), 'github');
      assert.equal(forgeOfPrUrl('https://dev.azure.com/acme/Shop/_git/api/pullrequest/9'), 'azure');
      assert.equal(prNumberFromUrl('https://github.com/o/r/pull/3'), 3);
      assert.equal(prNumberFromUrl('https://dev.azure.com/acme/Shop/_git/api/pullrequest/9'), 9);
      assert.equal(prNumberFromUrl('nope'), null);
    } },
    { name: 'listRemotes adds forge/org/project', run: async () => {
      gitInfo.setRunner(() => okOut('origin\thttps://dev.azure.com/acme/Shop/_git/api (fetch)\norigin\thttps://dev.azure.com/acme/Shop/_git/api (push)\n'));
      const { remotes } = await listRemotes('/repo');
      assert.deepEqual(
        { forge: remotes[0].forge, org: remotes[0].org, project: remotes[0].project, slug: remotes[0].slug },
        { forge: 'azure', org: 'acme', project: 'Shop', slug: 'dev.azure.com/acme/Shop/api' });
    } },
  ]);
});

test('listRemoteBranches: groups local refs by remote (longest prefix), drops HEAD; failures never throw', async () => {
  await checkRows([
    { name: 'listRemoteBranches groups the LOCAL remote-tracking refs by remote and drops HEAD', run: async () => {
      const seen = [];
      gitInfo.setRunner((cmd, args, opts) => {
        seen.push([cmd, ...args, opts?.cwd]);
        return okOut([
          'refs/remotes/origin/HEAD',
          'refs/remotes/origin/dev',
          'refs/remotes/origin/feat/x',
          'refs/remotes/origin/main',
          'refs/remotes/team/fork/main',          // a remote whose NAME holds a slash: longest prefix wins
          'refs/remotes/team/other',
          'refs/remotes/gone/main',               // a remote that is not in the list any more
          '',
        ].join('\n'));
      });
      const r = await listRemoteBranches('/repo', ['origin', 'team', 'team/fork', 'upstream']);
      assert.deepEqual(seen, [['git', 'for-each-ref', '--format=%(refname)', 'refs/remotes/', '/repo']], 'local refs only — no fetch, no ls-remote');
      assert.deepEqual(r, { ok: true, byRemote: {
        origin: ['dev', 'feat/x', 'main'], team: ['other'], 'team/fork': ['main'], upstream: [],
      } });
    } },
    { name: 'listRemoteBranches: git failures are reported without throwing', run: async () => {
      gitInfo.setRunner(() => fail('fatal: not a git repository', 128));
      assert.deepEqual(await listRemoteBranches('/nope', ['origin']), { ok: false, byRemote: {}, error: 'fatal: not a git repository' });
      assert.deepEqual(await listRemoteBranches('', ['origin']), { ok: false, byRemote: {}, error: 'projectDir is required' });
    } },
  ]);
});

test('prBaseBranch: a remote-tracking source names its branch on the remote; local branches stay (real git)', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'worca-cc-prbase-'));
  try {
    const git = (...a) => execFileSync('git', a, { cwd: dir, stdio: 'pipe' });
    git('init', '-q', '-b', 'main');
    git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'init');
    for (const ref of ['origin/dev', 'origin/feat/x', 'origin/origin/kept', 'origin/kept', 'team/fork/main']) git('update-ref', `refs/remotes/${ref}`, 'HEAD');
    git('branch', 'origin/kept');                     // a real local branch that only LOOKS like a remote ref
    const names = ['origin', 'team', 'team/fork'];
    await checkRows([
      { name: 'origin/dev (no local branch, refs/remotes/origin/dev) -> dev', run: async () => assert.equal(await prBaseBranch(dir, 'origin/dev', names), 'dev') },
      { name: 'a nested branch keeps its slashes', run: async () => assert.equal(await prBaseBranch(dir, 'origin/feat/x', names), 'feat/x') },
      { name: 'a remote whose name holds a slash: the longest prefix wins', run: async () => assert.equal(await prBaseBranch(dir, 'team/fork/main', names), 'main') },
      { name: 'a local branch named origin/kept stays', run: async () => assert.equal(await prBaseBranch(dir, 'origin/kept', names), 'origin/kept') },
      { name: 'a bare branch, an unknown remote, a missing ref and a bare remote stay', run: async () => {
        assert.equal(await prBaseBranch(dir, 'main', names), 'main');
        assert.equal(await prBaseBranch(dir, 'upstream/dev', names), 'upstream/dev');
        assert.equal(await prBaseBranch(dir, 'origin/gone', names), 'origin/gone');
        assert.equal(await prBaseBranch(dir, 'origin/', names), 'origin/');
      } },
      { name: 'no git call unless the name starts with a remote; a git failure keeps the name', run: async () => {
        const seen = [];
        gitInfo.setRunner((cmd, args) => { seen.push([cmd, ...args]); return fail('fatal: not a git repository', 128); });
        assert.equal(await prBaseBranch('/nope', 'dev', names), 'dev');
        assert.deepEqual(seen, []);
        assert.equal(await prBaseBranch('/nope', 'origin/dev', names), 'origin/dev');
        assert.deepEqual(seen, [['git', 'for-each-ref', '--format=%(refname)', 'refs/heads/origin/dev', 'refs/remotes/origin/dev']]);
        gitInfo.reset();
      } },
    ]);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('fork argv: pushBranch remote (default origin); createPr no repo / same-repo / cross-repo', async () => {
  await checkRows([
    { name: 'pushBranch pushes to the chosen remote (origin by default)', run: async () => {
      const seen = [];
      gitInfo.setRunner((cmd, args) => { seen.push([cmd, ...args]); return okOut(''); });
      await pushBranch('/repo', 'feat/x', 'fork');
      await pushBranch('/repo', 'feat/x');
      assert.deepEqual(seen, [['git', 'push', '-u', 'fork', 'feat/x'], ['git', 'push', '-u', 'origin', 'feat/x']]);
    } },
    { name: 'createPr: same-repo passes --repo with a bare head; cross-repo uses owner:branch', run: async () => {
      const seen = [];
      gitInfo.setRunner((cmd, args) => { seen.push([cmd, ...args]); return okOut('https://github.com/up/repo/pull/5\n'); });
      const same = await createPr({ projectDir: '/repo', base: 'main', head: 'feat/x', title: 'T', repo: 'up/repo' });
      assert.deepEqual(same, { ok: true, url: 'https://github.com/up/repo/pull/5', existed: false });
      assert.deepEqual(seen[0], ['gh', 'pr', 'create', '--repo', 'up/repo', '--base', 'main', '--head', 'feat/x', '--title', 'T', '--body', 'T']);
      await createPr({ projectDir: '/repo', base: 'main', head: 'feat/x', title: 'T', repo: 'up/repo', headOwner: 'me' });
      assert.deepEqual(seen[1], ['gh', 'pr', 'create', '--repo', 'up/repo', '--base', 'main', '--head', 'me:feat/x', '--title', 'T', '--body', 'T']);
    } },
    { name: 'createPr without a repo keeps the legacy argv (no --repo, bare head)', run: async () => {
      const seen = [];
      gitInfo.setRunner((cmd, args) => { seen.push([cmd, ...args]); return okOut('https://github.com/o/r/pull/1\n'); });
      await createPr({ projectDir: '/repo', base: 'main', head: 'feat/x', title: 'T' });
      assert.deepEqual(seen[0], ['gh', 'pr', 'create', '--base', 'main', '--head', 'feat/x', '--title', 'T', '--body', 'T']);
    } },
    { name: 'createPr appends --draft only when draft: true; nothing else in the argv changes', run: async () => {
      const seen = [];
      gitInfo.setRunner((cmd, args) => { seen.push([cmd, ...args]); return okOut('https://github.com/up/repo/pull/5\n'); });
      await createPr({ projectDir: '/repo', base: 'main', head: 'feat/x', title: 'T', repo: 'up/repo', draft: true });
      await createPr({ projectDir: '/repo', base: 'main', head: 'feat/x', title: 'T', repo: 'up/repo', draft: false });
      await createPr({ projectDir: '/repo', base: 'main', head: 'feat/x', title: 'T', repo: 'up/repo' });
      const plain = ['gh', 'pr', 'create', '--repo', 'up/repo', '--base', 'main', '--head', 'feat/x', '--title', 'T', '--body', 'T'];
      assert.deepEqual(seen[0], [...plain, '--draft']);
      assert.deepEqual(seen[1], plain);
      assert.deepEqual(seen[2], plain);
    } },
  ]);
});

test('push and PR creation get the write token, PR lookups the read token, per call', async () => {
  const keys = ['GH_TOKEN', 'GITHUB_TOKEN', 'WORCA_GH_READ_TOKEN', 'WORCA_GH_WRITE_TOKEN'];
  const prev = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  delete process.env.GH_TOKEN; delete process.env.GITHUB_TOKEN;
  process.env.WORCA_GH_READ_TOKEN = 'R'; process.env.WORCA_GH_WRITE_TOKEN = 'W';
  const seen = [];
  gitInfo.setRunner((cmd, args, opts = {}) => { seen.push({ call: `${cmd} ${args[0]} ${args[1] || ''}`.trim(), env: opts.env }); return fail('already exists', 1); });
  try {
    await pushBranch('/repo', 'feat/x');
    await createPr({ projectDir: '/repo', base: 'main', head: 'feat/x', title: 'T', repo: 'up/repo' });
  } finally {
    for (const k of keys) if (prev[k] === undefined) delete process.env[k]; else process.env[k] = prev[k];
  }
  const byCall = Object.fromEntries(seen.map((s) => [s.call, s.env]));
  assert.equal(byCall['git push -u'].GH_TOKEN, 'W');
  assert.equal(byCall['git push -u'].WORCA_GIT_TOKEN, 'W');
  assert.equal(byCall['gh pr create'].GH_TOKEN, 'W');
  assert.equal(byCall['gh pr view'].GH_TOKEN, 'R', 'the "already exists" lookup reads only');
  for (const e of Object.values(byCall)) {
    assert.equal(e.WORCA_GH_READ_TOKEN, undefined);
    assert.equal(e.WORCA_GH_WRITE_TOKEN, undefined);
  }
});

const EXISTS = 'a pull request for branch "me:feat/x" into branch "main" already exists:\nhttps://github.com/up/repo/pull/9';

test('createPr "already exists": recovered via gh pr view owner:branch --repo, else the URL from stderr; other failures pass through', async () => {
  await checkRows([
    { name: 'createPr recovers an existing cross-repo PR via gh pr view owner:branch --repo', run: async () => {
      const seen = [];
      gitInfo.setRunner((cmd, args) => {
        seen.push([cmd, ...args]);
        if (args[1] === 'create') return fail(EXISTS);
        return okOut('https://github.com/up/repo/pull/9\n');
      });
      const r = await createPr({ projectDir: '/repo', base: 'main', head: 'feat/x', title: 'T', repo: 'up/repo', headOwner: 'me' });
      assert.deepEqual(r, { ok: true, url: 'https://github.com/up/repo/pull/9', existed: true });
      assert.deepEqual(seen[1], ['gh', 'pr', 'view', 'me:feat/x', '--repo', 'up/repo', '--json', 'url', '-q', '.url']);
    } },
    { name: 'createPr falls back to the URL gh printed in stderr when the recovery view fails', run: async () => {
      gitInfo.setRunner((cmd, args) => (args[1] === 'create' ? fail(EXISTS) : fail('no pull requests found')));
      const r = await createPr({ projectDir: '/repo', base: 'main', head: 'feat/x', title: 'T', repo: 'up/repo', headOwner: 'me' });
      assert.deepEqual(r, { ok: true, url: 'https://github.com/up/repo/pull/9', existed: true });
      gitInfo.setRunner(() => fail('boom'));
      assert.deepEqual(await createPr({ projectDir: '/repo', base: 'main', head: 'feat/x', title: 'T' }), { ok: false, error: 'boom' });
    } },
    { name: 'createPr with draft: true on "already exists" still recovers the open PR (existed: true)', run: async () => {
      const seen = [];
      gitInfo.setRunner((cmd, args) => {
        seen.push([cmd, ...args]);
        if (args[1] === 'create') return fail('a pull request for branch "feat/x" into branch "main" already exists:\nhttps://github.com/up/repo/pull/3');
        return okOut('https://github.com/up/repo/pull/3\n');
      });
      const r = await createPr({ projectDir: '/repo', base: 'main', head: 'feat/x', title: 'T', repo: 'up/repo', draft: true });
      assert.deepEqual(r, { ok: true, url: 'https://github.com/up/repo/pull/3', existed: true });
      assert.ok(seen[0].includes('--draft'));
      assert.deepEqual(seen[1].slice(0, 3), ['gh', 'pr', 'view'], 'the recovery view never carries --draft');
      assert.ok(!seen[1].includes('--draft'));
    } },
  ]);
});

test('prMergeable prefers the PR url, else owner:branch --repo, else the bare head', async () => {
  const seen = [];
  gitInfo.setRunner((cmd, args) => { seen.push([cmd, ...args]); return okOut('MERGEABLE\n'); });
  assert.equal(await prMergeable({
    projectDir: '/repo', head: 'feat/x', repo: 'up/repo', headOwner: 'me', prUrl: 'https://github.com/up/repo/pull/9',
  }), 'MERGEABLE');
  await prMergeable({ projectDir: '/repo', head: 'feat/x', repo: 'up/repo', headOwner: 'me' });
  await prMergeable({ projectDir: '/repo', head: 'feat/x' });
  assert.deepEqual(seen, [
    ['gh', 'pr', 'view', 'https://github.com/up/repo/pull/9', '--json', 'mergeable', '-q', '.mergeable'],
    ['gh', 'pr', 'view', 'me:feat/x', '--repo', 'up/repo', '--json', 'mergeable', '-q', '.mergeable'],
    ['gh', 'pr', 'view', 'feat/x', '--json', 'mergeable', '-q', '.mergeable'],
  ]);
  assert.equal(await prMergeable({ projectDir: '/repo', head: '' }), 'UNKNOWN');
});

test('findPrForBranch with a persisted url: view wins; unreadable/empty/CLOSED falls through to the bare-branch search', async () => {
  await checkRows([
    { name: 'findPrForBranch resolves a persisted url with gh pr view and skips the branch search', run: async () => {
      const seen = [];
      gitInfo.setRunner((cmd, args) => {
        seen.push([cmd, ...args]);
        return okOut(JSON.stringify({ number: 9, state: 'MERGED', url: 'https://github.com/up/repo/pull/9', isDraft: false, mergeable: 'UNKNOWN' }));
      });
      const pr = await findPrForBranch({ projectDir: '/repo', head: 'feat/x', prUrl: 'https://github.com/up/repo/pull/9' });
      assert.deepEqual(pr, { state: 'MERGED', url: 'https://github.com/up/repo/pull/9', number: 9, isDraft: false, mergeable: 'UNKNOWN' });
      assert.deepEqual(seen, [['gh', 'pr', 'view', 'https://github.com/up/repo/pull/9', '--json', 'number,state,url,isDraft,mergeable']]);
    } },
    { name: 'findPrForBranch falls back to the branch search when the url cannot be read or is empty', run: async () => {
      const seen = [];
      let viewOut = null;                       // null → the view call fails
      gitInfo.setRunner((cmd, args) => {
        seen.push([cmd, ...args]);
        if (args[1] === 'view') return viewOut === null ? fail('GraphQL: Could not resolve to a PullRequest') : okOut(viewOut);
        return okOut(JSON.stringify([{ number: 3, state: 'OPEN', url: 'https://github.com/o/r/pull/3' }]));
      });
      const pr = await findPrForBranch({ projectDir: '/repo', head: 'feat/x', prUrl: 'https://github.com/o/r/pull/999' });
      assert.deepEqual(pr, { state: 'OPEN', url: 'https://github.com/o/r/pull/3', number: 3, isDraft: false, mergeable: 'UNKNOWN' });
      assert.deepEqual(seen[1].slice(0, 5), ['gh', 'pr', 'list', '--head', 'feat/x'], 'the list keeps the BARE branch (owner:branch returns nothing from gh pr list)');
      viewOut = '';                              // ok exit, empty stdout (what a catch-all stub answers)
      assert.deepEqual(await findPrForBranch({ projectDir: '/repo', head: 'feat/x', prUrl: 'https://github.com/o/r/pull/999' }),
        { state: 'OPEN', url: 'https://github.com/o/r/pull/3', number: 3, isDraft: false, mergeable: 'UNKNOWN' });
    } },
    { name: 'findPrForBranch: a CLOSED PR behind the url falls through to the branch search', run: async () => {
      const seen = [];
      let listRows = [];
      gitInfo.setRunner((cmd, args) => {
        seen.push([cmd, ...args]);
        if (args[1] === 'view') return okOut(JSON.stringify({ number: 9, state: 'CLOSED', url: 'https://github.com/up/repo/pull/9' }));
        return okOut(JSON.stringify(listRows));
      });
      // Nothing newer for the branch → null (button offered again), and the list WAS consulted.
      assert.equal(await findPrForBranch({ projectDir: '/repo', head: 'feat/x', prUrl: 'https://github.com/up/repo/pull/9' }), null);
      assert.equal(seen[1][2], 'list');
      // A newer OPEN PR for the same branch wins over the stale closed url.
      listRows = [{ number: 12, state: 'OPEN', url: 'https://github.com/up/repo/pull/12' }];
      assert.deepEqual(await findPrForBranch({ projectDir: '/repo', head: 'feat/x', prUrl: 'https://github.com/up/repo/pull/9' }),
        { state: 'OPEN', url: 'https://github.com/up/repo/pull/12', number: 12, isDraft: false, mergeable: 'UNKNOWN' });
    } },
    { name: 'findPrForBranch includeClosed: the closed PR behind the url when the branch search finds nothing live', run: async () => {
      let listRows = [];
      gitInfo.setRunner((cmd, args) => (args[1] === 'view'
        ? okOut(JSON.stringify({ number: 9, state: 'CLOSED', url: 'https://github.com/up/repo/pull/9' }))
        : okOut(JSON.stringify(listRows))));
      const opts = { projectDir: '/repo', head: 'feat/x', prUrl: 'https://github.com/up/repo/pull/9', includeClosed: true };
      // A fork PR lives in the upstream repo: the cwd's branch search cannot see it.
      assert.deepEqual(await findPrForBranch(opts),
        { state: 'CLOSED', url: 'https://github.com/up/repo/pull/9', number: 9, isDraft: false, mergeable: 'UNKNOWN' });
      listRows = [{ number: 12, state: 'OPEN', url: 'https://github.com/up/repo/pull/12' }];
      assert.equal((await findPrForBranch(opts)).number, 12, 'a newer open PR still wins');
    } },
  ]);
});

test('pushBranch spends a remote lookup only when the host can change the credential (D7)', async () => {
  await checkRows([
    { name: 'token mode, no Azure credential: no lookup, pushes only (same as today)', run: async () => {
      const seen = [];
      await withEnv({ ...CLOSED_GATES, GH_TOKEN: 't' }, async () => {
        gitInfo.setRunner((cmd, args) => { seen.push([cmd, ...args]); return okOut(''); });
        await pushBranch('/repo', 'feat/x');
      });
      assert.deepEqual(seen, [['git', 'push', '-u', 'origin', 'feat/x']]);
    } },
    { name: 'Azure credential + Azure remote: lookup (with an env), then the push carries the ADO helper, not GH_TOKEN', run: async () => {
      const seen = [];
      await withEnv({ ...CLOSED_GATES, WORCA_ADO_TOKEN: 'pat', GH_TOKEN: 'ghp_x' }, async () => {
        gitInfo.setRunner((cmd, args, opts = {}) => {
          seen.push({ argv: [cmd, ...args], env: opts.env });
          if (args[0] === 'remote') return okOut('https://dev.azure.com/acme/Shop/_git/api\n');
          return okOut('');
        });
        assert.equal((await pushBranch('/repo', 'feat/x')).ok, true);
      });
      assert.deepEqual(seen.map((s) => s.argv), [['git', 'remote', 'get-url', '--push', 'origin'], ['git', 'push', '-u', 'origin', 'feat/x']]);
      assert.ok(seen[0].env, 'the lookup runs with an env');
      assert.equal(seen[0].env.WORCA_ADO_TOKEN, undefined);
      assert.equal(seen[0].env.GH_TOKEN, undefined);
      assert.equal(seen[1].env.WORCA_ADO_GIT_TOKEN, 'pat');
      assert.equal(seen[1].env.GH_TOKEN, undefined);
    } },
    { name: 'Azure credential + GitHub remote: GitHub token as before, no Azure token', run: async () => {
      const seen = [];
      await withEnv({ ...CLOSED_GATES, WORCA_ADO_TOKEN: 'pat', GH_TOKEN: 'ghp_x' }, async () => {
        gitInfo.setRunner((cmd, args, opts = {}) => {
          seen.push({ argv: [cmd, ...args], env: opts.env });
          return args[0] === 'remote' ? okOut('https://github.com/o/r.git\n') : okOut('');
        });
        await pushBranch('/repo', 'feat/x');
      });
      const push = seen.find((s) => s.argv[1] === 'push');
      assert.equal(push.env.GH_TOKEN, 'ghp_x');
      assert.equal(push.env.WORCA_ADO_TOKEN, undefined);
      assert.equal(push.env.WORCA_ADO_GIT_TOKEN, undefined);
    } },
    { name: 'WORCA_GH_AS_PERSON=required no longer refuses an Azure push', run: async () => {
      let r;
      await withEnv({ ...NO_ADO, WORCA_GH_AS_PERSON: 'required', WORCA_BROKER_URL: 'http://127.0.0.1:9' }, async () => {
        gitInfo.setRunner((cmd, args) => (args[0] === 'remote' ? okOut('git@ssh.dev.azure.com:v3/acme/Shop/api\n') : okOut('')));
        r = await pushBranch('/repo', 'feat/x');
      });
      assert.equal(r.ok, true, r.stderr);
    } },
  ]);
});

test('findPrForBranch: the gh pr list branch search reads with the read token', async () => {
  const seen = [];
  await withEnv({ ...CLOSED_GATES, GH_TOKEN: undefined, GITHUB_TOKEN: undefined, WORCA_GH_READ_TOKEN: 'R', WORCA_GH_WRITE_TOKEN: 'W' }, async () => {
    gitInfo.setRunner((cmd, args, opts = {}) => { seen.push({ argv: [cmd, ...args], env: opts.env }); return okOut('[]'); });
    await findPrForBranch({ projectDir: '/r', head: 'feat' });
  });
  const list = seen.find((s) => s.argv[1] === 'pr' && s.argv[2] === 'list');
  assert.ok(list?.env, 'gh pr list runs with an env');
  assert.equal(list.env.GH_TOKEN, 'R');
});

test('PR functions dispatch Azure URLs/remotes to the Azure provider; everything else stays on gh', async () => {
  const calls = [];
  gitInfo.setRunner((cmd, args) => {
    calls.push(`${cmd} ${args.join(' ')}`);
    if (cmd === 'git' && args[0] === 'remote') return okOut('origin\thttps://dev.azure.com/acme/Shop/_git/api (fetch)\norigin\thttps://dev.azure.com/acme/Shop/_git/api (push)\n');
    return fail('gh must not run', 1);
  });
  azurePr._testing.setFetch(async (url) => ({ status: 200, ok: true, json: async () => (String(url).includes('/pullrequests/9')
    ? { pullRequestId: 9, status: 'completed', mergeStatus: 'succeeded' }
    : { value: [{ pullRequestId: 4, status: 'active', mergeStatus: 'conflicts' }] }) }));
  try {
    await withEnv({ ...NO_ADO, WORCA_ADO_TOKEN: 'pat' }, async () => {
      const url = 'https://dev.azure.com/acme/Shop/_git/api/pullrequest/9';
      assert.equal(await prLifecycleState({ projectDir: '/r', prUrl: url }), 'MERGED');
      assert.equal(await prMergeable({ projectDir: '/r', head: 'feat', prUrl: url }), 'MERGEABLE');
      assert.deepEqual(await findPrForBranch({ projectDir: '/r', head: 'feat', prUrl: url }),
        { state: 'MERGED', url, number: 9, isDraft: false, mergeable: 'MERGEABLE' });
      assert.equal((await findPrForBranch({ projectDir: '/r', head: 'feat' })).number, 4);   // forge learned from the remotes
      assert.equal(await prMergeable({ projectDir: '/r', head: 'feat' }), 'CONFLICTING');
    });
    assert.ok(calls.every((c) => c.startsWith('git ')), calls.join('\n'));
  } finally { azurePr._testing.reset(); }
});

test('Azure includeClosed: the abandoned PR behind the url is the last resort, after the branch search', async () => {
  gitInfo.setRunner((cmd, args) => (cmd === 'git' && args[0] === 'remote'
    ? okOut('origin\thttps://dev.azure.com/acme/Shop/_git/api (fetch)\norigin\thttps://dev.azure.com/acme/Shop/_git/api (push)\n')
    : fail('gh must not run', 1)));
  let branchPrs = [];
  azurePr._testing.setFetch(async (url) => ({ status: 200, ok: true, json: async () => (String(url).includes('/pullrequests/9')
    ? { pullRequestId: 9, status: 'abandoned', isDraft: true }
    : { value: branchPrs }) }));
  try {
    await withEnv({ ...NO_ADO, WORCA_ADO_TOKEN: 'pat' }, async () => {
      const url = 'https://dev.azure.com/acme/Shop/_git/api/pullrequest/9';
      const opts = { projectDir: '/r', head: 'feat', prUrl: url, includeClosed: true };
      assert.deepEqual(await findPrForBranch(opts), { state: 'CLOSED', url, number: 9, isDraft: true, mergeable: 'UNKNOWN' });
      assert.equal(await findPrForBranch({ ...opts, includeClosed: false }), null, 'every other caller reads no PR');
      branchPrs = [{ pullRequestId: 7, status: 'abandoned' }];
      const byRemote = { projectDir: '/r', head: 'feat', includeClosed: true };   // no stored url: the base remote's repo
      assert.deepEqual(await findPrForBranch(byRemote),
        { state: 'CLOSED', url: 'https://dev.azure.com/acme/Shop/_git/api/pullrequest/7', number: 7, isDraft: false, mergeable: 'UNKNOWN' });
      assert.equal(await findPrForBranch({ ...byRemote, includeClosed: false }), null);
      branchPrs = [{ pullRequestId: 11, status: 'abandoned' }, { pullRequestId: 10, status: 'active', isDraft: true }];
      assert.deepEqual(await findPrForBranch(opts),
        { state: 'OPEN', url: 'https://dev.azure.com/acme/Shop/_git/api/pullrequest/10', number: 10, isDraft: true, mergeable: 'UNKNOWN' },
        'a live PR on the branch wins');
    });
  } finally { azurePr._testing.reset(); }
});

test('without an Azure credential the branch lookup spends no git call (D6)', async () => {
  const calls = [];
  await withEnv(CLOSED_GATES, async () => {
    gitInfo.setRunner((cmd, args) => { calls.push(`${cmd} ${args[0]}`); return okOut('[]'); });
    await findPrForBranch({ projectDir: '/r', head: 'feat' });
  });
  assert.deepEqual(calls, ['gh pr']);
});

test("Azure-only machine (no gh): a GitHub project's PR lookups return null/UNKNOWN without spawning gh pr", async () => {
  const calls = [];
  await withEnv({ ...CLOSED_GATES, WORCA_ADO_TOKEN: 'pat' }, async () => {
    gitInfo.setRunner((cmd, args) => {
      calls.push(`${cmd} ${args[0]}`);
      if (cmd === 'gh') return fail('gh: command not found', 127);
      return okOut('origin\thttps://github.com/o/r.git (fetch)\norigin\thttps://github.com/o/r.git (push)\n');
    });
    assert.equal(await findPrForBranch({ projectDir: '/r', head: 'feat' }), null);
    assert.equal(await prLifecycleState({ projectDir: '/r', prUrl: 'https://github.com/o/r/pull/3' }), null);
    assert.equal(await prMergeable({ projectDir: '/r', head: 'feat' }), 'UNKNOWN');
  });
  assert.deepEqual(calls.filter((c) => c.startsWith('gh ')), ['gh --version'], 'one memoized probe, no gh pr');
});

test('prProviderFor / prHostsAvailable / anyPrHost', async () => {
  await withEnv(NO_ADO, async () => {
    gitInfo.setRunner((cmd) => (cmd === 'gh' ? fail('missing', 127) : okOut('')));
    assert.equal(prProviderFor({ host: 'dev.azure.com', org: 'a', owner: 'a/p', repo: 'r' }).label, 'Azure DevOps');
    assert.equal(prProviderFor(null).label, 'GitHub');
    assert.deepEqual(await prProviderFor(null).available(), { ok: false, reason: 'GitHub CLI (gh) is not available' });
    assert.equal(prProviderFor({ host: 'bitbucket.org', owner: 'acme', repo: 'api' }).label, 'Bitbucket');
    assert.deepEqual(await prProviderFor({ host: 'bitbucket.org', owner: 'acme', repo: 'api' }).available(),
      { ok: false, reason: 'Bitbucket is not configured: set WORCA_BB_TOKEN (an access token, or an Atlassian API token with WORCA_BB_EMAIL) with Repositories and Pull requests: Read & Write, and Pipelines: Read, where worca runs' });
    assert.deepEqual(await prHostsAvailable(), { github: false, azure: false, bitbucket: false });
    assert.equal(await anyPrHost(), false);
  });
});

test('ghRepoAccess: .permissions.push → canPush; no permissions block (App token) → null; gh failure → ok:false', async () => {
  await withEnv(CLOSED_GATES, () => checkRows([
    { name: 'push:true, exact argv', run: async () => {
      const seen = [];
      gitInfo.setRunner((cmd, args) => { seen.push([cmd, ...args]); return okOut('{"admin":false,"push":true,"pull":true}\n'); });
      assert.deepEqual(await ghRepoAccess({ repo: 'acme/market' }), { ok: true, canPush: true });
      assert.deepEqual(seen, [['gh', 'api', 'repos/acme/market', '--jq', '.permissions']]);
    } },
    { name: 'push:false', run: async () => {
      gitInfo.setRunner(() => okOut('{"push":false,"pull":true}\n'));
      assert.deepEqual(await ghRepoAccess({ repo: 'acme/market' }), { ok: true, canPush: false });
    } },
    { name: 'no permissions block → unknown', run: async () => {
      gitInfo.setRunner(() => okOut('null\n'));
      assert.deepEqual(await ghRepoAccess({ repo: 'acme/market' }), { ok: true, canPush: null });
    } },
    { name: 'gh fails', run: async () => {
      gitInfo.setRunner(() => fail('HTTP 404: Not Found (https://api.github.com/repos/acme/market)'));
      const r = await ghRepoAccess({ repo: 'acme/market' });
      assert.equal(r.ok, false);
      assert.match(r.error, /404/);
    } },
  ]));
});

test('ghForkRepo: POST /forks, then waits until the fork answers; times out with a reason', async () => {
  await withEnv(CLOSED_GATES, () => checkRows([
    { name: 'forks, polls once, returns the fork', run: async () => {
      const seen = []; let views = 0;
      gitInfo.setRunner((cmd, args) => {
        seen.push([cmd, ...args]);
        if (args.includes('POST')) return okOut('me/market\n');
        views += 1;
        return views === 1 ? fail('HTTP 404: Not Found') : okOut('me/market\n');
      });
      const r = await ghForkRepo({ repo: 'acme/market', sleep: async () => {} });
      assert.deepEqual(r, { ok: true, owner: 'me', repo: 'market', slug: 'me/market' });
      assert.deepEqual(seen[0], ['gh', 'api', '-X', 'POST', 'repos/acme/market/forks', '-F', 'default_branch_only=true', '--jq', '.full_name']);
      assert.deepEqual(seen[1], ['gh', 'api', 'repos/me/market', '--jq', '.full_name']);
      assert.equal(seen.length, 3);
    } },
    { name: 'fork refused (App installation token)', run: async () => {
      gitInfo.setRunner(() => fail('HTTP 403: Resource not accessible by integration'));
      const r = await ghForkRepo({ repo: 'acme/market', sleep: async () => {} });
      assert.equal(r.ok, false);
      assert.match(r.error, /403/);
    } },
    { name: 'never ready → timeout', run: async () => {
      gitInfo.setRunner((cmd, args) => (args.includes('POST') ? okOut('me/market\n') : fail('HTTP 404')));
      const r = await ghForkRepo({ repo: 'acme/market', waitMs: 0, sleep: async () => {} });
      assert.equal(r.ok, false);
      assert.match(r.error, /me\/market was not ready/);
    } },
  ]));
});

test('markPrReady and closePr: gh argv; an already-ready PR counts as ready; a missing URL is refused', () => withEnv(CLOSED_GATES, async () => {
  const seen = [];
  gitInfo.setRunner((cmd, args) => { seen.push([cmd, ...args]); return okOut(''); });
  assert.deepEqual(await markPrReady({ prUrl: 'https://github.com/o/r/pull/5' }), { ok: true });
  assert.deepEqual(await closePr({ prUrl: 'https://github.com/o/r/pull/5', comment: 'Shipped as one pull request: https://github.com/o/r/pull/9' }), { ok: true });
  assert.deepEqual(seen[0], ['gh', 'pr', 'ready', 'https://github.com/o/r/pull/5']);
  assert.deepEqual(seen[1], ['gh', 'pr', 'close', 'https://github.com/o/r/pull/5', '--comment', 'Shipped as one pull request: https://github.com/o/r/pull/9']);
  gitInfo.setRunner(() => fail('pull request #5 is not a draft'));
  assert.deepEqual(await markPrReady({ prUrl: 'https://github.com/o/r/pull/5' }), { ok: true });
  gitInfo.setRunner(() => fail('could not close'));
  assert.deepEqual(await closePr({ prUrl: 'https://github.com/o/r/pull/5' }), { ok: false, error: 'could not close' });
  assert.equal((await markPrReady({})).ok, false);
  assert.equal((await closePr({})).ok, false);
}));

test('Bitbucket base remote: createPr, mergeable and findPrForBranch go over REST, never gh', () => withEnv({ ...NO_ADO, WORCA_BB_TOKEN: 'bbtok' }, async () => {
  const calls = [];
  gitInfo.setRunner((cmd, args) => { calls.push([cmd, ...args].join(' ')); return cmd === 'git' && args[0] === 'remote'
    ? okOut('origin\tgit@bitbucket.org:acme/api.git (fetch)\norigin\tgit@bitbucket.org:acme/api.git (push)\n') : fail('gh must not run', 1); });
  const urls = [];
  bitbucketPr._testing.setFetch(async (url, init = {}) => {
    urls.push(`${init.method || 'GET'} ${new URL(url).pathname}`);
    const ok = (b) => ({ status: 200, ok: true, headers: { get: () => null }, json: async () => b });
    if (/\/pullrequests\/4\/conflicts\?/.test(url)) return ok({ values: [] });
    // #4 as Bitbucket answers it: abbreviated commits.
    const pr4 = { id: 4, state: 'OPEN', source: { branch: { name: 'feat' }, commit: { hash: 'a1b2c3d4e5f6' }, repository: { full_name: 'acme/api' } },
      destination: { branch: { name: 'main' }, commit: { hash: '0f9e8d7c6b5a' } } };
    if (/\/pullrequests\/4$/.test(url)) return ok(pr4);
    if ((init.method || 'GET') === 'POST') return { ...ok({ id: 4 }), status: 201 };
    // createPr's open-PR lookup (state=OPEN&pagelen=50) finds none; findPrForBranch's all-states listing finds #4.
    return ok({ values: /\?state=OPEN&pagelen=50&/.test(url) ? [] : [pr4] });
  });
  try {
    const { remotes } = await listRemotes('/r');
    assert.equal(remotes[0].forge, 'bitbucket');
    const pr = await createPr({ projectDir: '/r', base: 'main', head: 'feat', title: 'T', baseRemote: remotes[0], pushRemote: remotes[0] });
    assert.deepEqual(pr, { ok: true, url: 'https://bitbucket.org/acme/api/pull-requests/4', number: 4, existed: false });
    assert.equal(await prMergeable({ projectDir: '/r', head: 'feat' }), 'MERGEABLE');
    assert.deepEqual((({ number, mergeable }) => ({ number, mergeable }))(await findPrForBranch({ projectDir: '/r', head: 'feat' })),
      { number: 4, mergeable: 'MERGEABLE' }, 'the Runs list\'s PR chip can say "conflicts" for Bitbucket too');
    assert.ok(urls.includes('GET /2.0/repositories/acme/api/pullrequests/4/conflicts'), 'the PR\'s file conflicts');
    const prUrl = 'https://bitbucket.org/acme/api/pull-requests/4';
    assert.equal(await prMergeable({ projectDir: '/r', prUrl }), 'MERGEABLE', 'a stored Bitbucket PR URL reads its file conflicts');
    assert.equal(await prLifecycleState({ projectDir: '/r', prUrl }), 'OPEN');
    assert.ok(!calls.some((c) => c.startsWith('gh pr')), 'gh pr never ran');
  } finally { bitbucketPr._testing.reset(); }
}));
