// test/git-info-remotes.test.mjs
// Fork support in git-info: remote URL parsing, `git remote -v` listing, and the
// argv shapes for same-repo vs cross-repo PRs (push / create / recover / view).
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseRemoteUrl, remoteRepoSlug, sameRepo, listRemotes, prHeadRef,
  pushBranch, createPr, prMergeable, findPrForBranch, _testing as gitInfo,
} from '../src/core/git-info.mjs';

afterEach(() => gitInfo.reset());

const okOut = (stdout) => Promise.resolve({ ok: true, stdout, stderr: '', code: 0 });
const fail = (stderr, code = 1) => Promise.resolve({ ok: false, stdout: '', stderr, code });

test('parseRemoteUrl handles https, ssh://, scp-style and git:// forms', () => {
  assert.deepEqual(parseRemoteUrl('https://github.com/Owner/Repo.git'), { host: 'github.com', owner: 'Owner', repo: 'Repo' });
  assert.deepEqual(parseRemoteUrl('https://me@github.com/o/r'), { host: 'github.com', owner: 'o', repo: 'r' });
  assert.deepEqual(parseRemoteUrl('ssh://git@github.com/o/r.git'), { host: 'github.com', owner: 'o', repo: 'r' });
  assert.deepEqual(parseRemoteUrl('ssh://git@ghe.corp:2222/o/r.git'), { host: 'ghe.corp', owner: 'o', repo: 'r' });
  assert.deepEqual(parseRemoteUrl('git@github.com:o/r.git'), { host: 'github.com', owner: 'o', repo: 'r' });
  assert.deepEqual(parseRemoteUrl('git@github.com:o/r'), { host: 'github.com', owner: 'o', repo: 'r' });
  assert.deepEqual(parseRemoteUrl('git@github.com:/o/r.git'), { host: 'github.com', owner: 'o', repo: 'r' }, 'scp-style with an absolute path');
  assert.deepEqual(parseRemoteUrl('github.com:o/r'), { host: 'github.com', owner: 'o', repo: 'r' }, 'scp-style without a user');
  assert.deepEqual(parseRemoteUrl('git://GitHub.com/o/r.git/'), { host: 'github.com', owner: 'o', repo: 'r' });
});

test('parseRemoteUrl returns null for local paths and junk', () => {
  for (const u of ['', '/srv/git/repo.git', '../other', 'C:\\repos\\x', 'C:/repos/x', 'file:///srv/git/repo.git', 'https://github.com/only-owner', null]) {
    assert.equal(parseRemoteUrl(u), null, String(u));
  }
});

test('remoteRepoSlug omits github.com and keeps other hosts; sameRepo is case-insensitive', () => {
  assert.equal(remoteRepoSlug({ host: 'github.com', owner: 'o', repo: 'r' }), 'o/r');
  assert.equal(remoteRepoSlug({ host: 'ghe.corp', owner: 'o', repo: 'r' }), 'ghe.corp/o/r');
  assert.equal(remoteRepoSlug(null), null);
  assert.ok(sameRepo({ host: 'github.com', owner: 'Me', repo: 'Repo' }, { host: 'github.com', owner: 'me', repo: 'repo' }));
  assert.ok(!sameRepo({ host: 'github.com', owner: 'me', repo: 'repo' }, { host: 'github.com', owner: 'up', repo: 'repo' }));
  assert.ok(!sameRepo({ host: 'ghe.corp', owner: 'me', repo: 'repo' }, { host: 'github.com', owner: 'me', repo: 'repo' }));
  assert.ok(!sameRepo(null, { host: 'github.com', owner: 'me', repo: 'repo' }));
  assert.equal(prHeadRef('feat/x', 'me'), 'me:feat/x');
  assert.equal(prHeadRef('feat/x', null), 'feat/x');
});

test('listRemotes parses `git remote -v` (fetch + push per name, push URL wins for owner/repo)', async () => {
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
  });
  assert.equal(r.remotes[1].slug, 'up/repo');
  assert.equal(r.remotes[2].owner, 'y', 'push URL wins for the owner');
  assert.deepEqual([r.remotes[3].owner, r.remotes[3].slug], [null, null], 'unparseable stays listed, unparsed');
});

test('listRemotes: empty output is an empty list; git failures are reported without throwing', async () => {
  gitInfo.setRunner(() => okOut(''));
  assert.deepEqual(await listRemotes('/repo'), { ok: true, remotes: [] });
  gitInfo.setRunner(() => fail('fatal: not a git repository', 128));
  assert.deepEqual(await listRemotes('/nope'), { ok: false, remotes: [], error: 'fatal: not a git repository' });
  assert.deepEqual(await listRemotes(''), { ok: false, remotes: [], error: 'projectDir is required' });
});

test('pushBranch pushes to the chosen remote (origin by default)', async () => {
  const seen = [];
  gitInfo.setRunner((cmd, args) => { seen.push([cmd, ...args]); return okOut(''); });
  await pushBranch('/repo', 'feat/x', 'fork');
  await pushBranch('/repo', 'feat/x');
  assert.deepEqual(seen, [['git', 'push', '-u', 'fork', 'feat/x'], ['git', 'push', '-u', 'origin', 'feat/x']]);
});

test('createPr: same-repo passes --repo with a bare head; cross-repo uses owner:branch', async () => {
  const seen = [];
  gitInfo.setRunner((cmd, args) => { seen.push([cmd, ...args]); return okOut('https://github.com/up/repo/pull/5\n'); });
  const same = await createPr({ projectDir: '/repo', base: 'main', head: 'feat/x', title: 'T', repo: 'up/repo' });
  assert.deepEqual(same, { ok: true, url: 'https://github.com/up/repo/pull/5', existed: false });
  assert.deepEqual(seen[0], ['gh', 'pr', 'create', '--repo', 'up/repo', '--base', 'main', '--head', 'feat/x', '--title', 'T', '--body', 'T']);
  await createPr({ projectDir: '/repo', base: 'main', head: 'feat/x', title: 'T', repo: 'up/repo', headOwner: 'me' });
  assert.deepEqual(seen[1], ['gh', 'pr', 'create', '--repo', 'up/repo', '--base', 'main', '--head', 'me:feat/x', '--title', 'T', '--body', 'T']);
});

test('createPr without a repo keeps the legacy argv (no --repo, bare head)', async () => {
  const seen = [];
  gitInfo.setRunner((cmd, args) => { seen.push([cmd, ...args]); return okOut('https://github.com/o/r/pull/1\n'); });
  await createPr({ projectDir: '/repo', base: 'main', head: 'feat/x', title: 'T' });
  assert.deepEqual(seen[0], ['gh', 'pr', 'create', '--base', 'main', '--head', 'feat/x', '--title', 'T', '--body', 'T']);
});

const EXISTS = 'a pull request for branch "me:feat/x" into branch "main" already exists:\nhttps://github.com/up/repo/pull/9';

test('createPr recovers an existing cross-repo PR via gh pr view owner:branch --repo', async () => {
  const seen = [];
  gitInfo.setRunner((cmd, args) => {
    seen.push([cmd, ...args]);
    if (args[1] === 'create') return fail(EXISTS);
    return okOut('https://github.com/up/repo/pull/9\n');
  });
  const r = await createPr({ projectDir: '/repo', base: 'main', head: 'feat/x', title: 'T', repo: 'up/repo', headOwner: 'me' });
  assert.deepEqual(r, { ok: true, url: 'https://github.com/up/repo/pull/9', existed: true });
  assert.deepEqual(seen[1], ['gh', 'pr', 'view', 'me:feat/x', '--repo', 'up/repo', '--json', 'url', '-q', '.url']);
});

test('createPr falls back to the URL gh printed in stderr when the recovery view fails', async () => {
  gitInfo.setRunner((cmd, args) => (args[1] === 'create' ? fail(EXISTS) : fail('no pull requests found')));
  const r = await createPr({ projectDir: '/repo', base: 'main', head: 'feat/x', title: 'T', repo: 'up/repo', headOwner: 'me' });
  assert.deepEqual(r, { ok: true, url: 'https://github.com/up/repo/pull/9', existed: true });
  gitInfo.setRunner(() => fail('boom'));
  assert.deepEqual(await createPr({ projectDir: '/repo', base: 'main', head: 'feat/x', title: 'T' }), { ok: false, error: 'boom' });
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

test('findPrForBranch resolves a persisted url with gh pr view and skips the branch search', async () => {
  const seen = [];
  gitInfo.setRunner((cmd, args) => {
    seen.push([cmd, ...args]);
    return okOut(JSON.stringify({ number: 9, state: 'MERGED', url: 'https://github.com/up/repo/pull/9' }));
  });
  const pr = await findPrForBranch({ projectDir: '/repo', head: 'feat/x', prUrl: 'https://github.com/up/repo/pull/9' });
  assert.deepEqual(pr, { state: 'MERGED', url: 'https://github.com/up/repo/pull/9', number: 9 });
  assert.deepEqual(seen, [['gh', 'pr', 'view', 'https://github.com/up/repo/pull/9', '--json', 'number,state,url']]);
});

test('findPrForBranch falls back to the branch search when the url cannot be read or is empty', async () => {
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
});

test('findPrForBranch: a CLOSED PR behind the url falls through to the branch search', async () => {
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
});
