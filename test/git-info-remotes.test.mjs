// test/git-info-remotes.test.mjs
// Fork support in git-info: remote URL parsing, `git remote -v` listing, and the
// argv shapes for same-repo vs cross-repo PRs (push / create / recover / view).
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseRemoteUrl, remoteRepoSlug, sameRepo, listRemotes, listRemoteBranches, prHeadRef,
  pushBranch, createPr, prMergeable, findPrForBranch, prLifecycleState, prProviderFor, prHostsAvailable, anyPrHost,
  _testing as gitInfo,
} from '../src/core/git-info.mjs';
import { forgeOf, forgeOfPrUrl, prNumberFromUrl } from '../src/core/forge.mjs';
import * as azurePr from '../src/core/pr/azure.mjs';
import { checkRows } from './helpers/rows.mjs';
import { withEnv } from './helpers/with-env.mjs';

const NO_ADO = { WORCA_ADO_TOKEN: undefined, WORCA_ADO_READ_TOKEN: undefined, WORCA_ADO_WRITE_TOKEN: undefined, AZURE_DEVOPS_EXT_PAT: undefined };
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
        return okOut(JSON.stringify({ number: 9, state: 'MERGED', url: 'https://github.com/up/repo/pull/9' }));
      });
      const pr = await findPrForBranch({ projectDir: '/repo', head: 'feat/x', prUrl: 'https://github.com/up/repo/pull/9' });
      assert.deepEqual(pr, { state: 'MERGED', url: 'https://github.com/up/repo/pull/9', number: 9 });
      assert.deepEqual(seen, [['gh', 'pr', 'view', 'https://github.com/up/repo/pull/9', '--json', 'number,state,url']]);
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
      assert.deepEqual(pr, { state: 'OPEN', url: 'https://github.com/o/r/pull/3', number: 3 });
      assert.deepEqual(seen[1].slice(0, 5), ['gh', 'pr', 'list', '--head', 'feat/x'], 'the list keeps the BARE branch (owner:branch returns nothing from gh pr list)');
      viewOut = '';                              // ok exit, empty stdout (what a catch-all stub answers)
      assert.deepEqual(await findPrForBranch({ projectDir: '/repo', head: 'feat/x', prUrl: 'https://github.com/o/r/pull/999' }),
        { state: 'OPEN', url: 'https://github.com/o/r/pull/3', number: 3 });
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
        { state: 'OPEN', url: 'https://github.com/up/repo/pull/12', number: 12 });
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
      assert.deepEqual(await findPrForBranch({ projectDir: '/r', head: 'feat', prUrl: url }), { state: 'MERGED', url, number: 9 });
      assert.equal((await findPrForBranch({ projectDir: '/r', head: 'feat' })).number, 4);   // forge learned from the remotes
      assert.equal(await prMergeable({ projectDir: '/r', head: 'feat' }), 'CONFLICTING');
    });
    assert.ok(calls.every((c) => c.startsWith('git ')), calls.join('\n'));
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
    assert.deepEqual(await prHostsAvailable(), { github: false, azure: false });
    assert.equal(await anyPrHost(), false);
  });
});
