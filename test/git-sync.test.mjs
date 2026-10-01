// test/git-sync.test.mjs
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readFile, chmod, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  fetchRemote, syncStatus, fastForward, fastForwardTo, ensureLocalBranch, syncBaseForRun, listBranches,
  resolveSourceRef, incomingCommits, commitsBetween, isSafeBranchName, isSafeRemoteName,
  classifyFetchError, scrubGitText, syncState, runSyncOptions, lastFetchedAt, fetchHeadUrls, syncRepo, _testing,
} from '../src/core/git-sync.mjs';

let root; const saved = {};
before(async () => {
  root = await mkdtemp(join(tmpdir(), 'git-sync-'));
  for (const k of ['HOME', 'GIT_CONFIG_GLOBAL', 'GIT_CONFIG_NOSYSTEM']) saved[k] = process.env[k];
  process.env.HOME = root; process.env.GIT_CONFIG_GLOBAL = join(root, 'gitconfig'); process.env.GIT_CONFIG_NOSYSTEM = '1';
  await writeFile(process.env.GIT_CONFIG_GLOBAL, '[user]\n\tname = t\n\temail = t@t\n[commit]\n\tgpgsign = false\n[init]\n\tdefaultBranch = dev\n');
});
after(async () => {
  for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  await rm(root, { recursive: true, force: true });
});
beforeEach(() => _testing.reset());

const g = (cwd, ...args) => {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
};
let n = 0;
/** bare origin + clone A (the "project") + clone B (a teammate who pushes). */
async function world() {
  const dir = join(root, `w${++n}`);
  g(root, 'init', '-q', '--bare', `${dir}-origin.git`);
  g(root, 'clone', '-q', `${dir}-origin.git`, `${dir}-a`);
  await writeFile(join(`${dir}-a`, 'f.txt'), 'one\n');
  g(`${dir}-a`, 'add', '-A'); g(`${dir}-a`, 'commit', '-qm', 'init'); g(`${dir}-a`, 'push', '-q', 'origin', 'dev');
  g(root, 'clone', '-q', `${dir}-origin.git`, `${dir}-b`);
  const push = async (file, msg, branch = 'dev') => {
    const b = `${dir}-b`;
    g(b, 'fetch', '-q', '--prune', 'origin');
    // An existing remote branch continues from its tip; a NEW branch starts from origin/dev.
    const known = spawnSync('git', ['rev-parse', '--verify', '-q', `origin/${branch}`], { cwd: b }).status === 0;
    g(b, 'checkout', '-q', '-B', branch, known ? `origin/${branch}` : 'origin/dev');
    await writeFile(join(b, file), `${msg}\n`); g(b, 'add', '-A'); g(b, 'commit', '-qm', msg);
    g(b, 'push', '-q', 'origin', branch);
  };
  return { a: `${dir}-a`, b: `${dir}-b`, push };
}

test('names: safe branch/remote names; SHAs and options are not branches', () => {
  for (const ok of ['dev', 'feat/x-1', 'release/2.0']) assert.equal(isSafeBranchName(ok), true, ok);
  for (const bad of ['', '-x', 'a..b', 'a//b', 'x/', 'x.lock', '.x', 'a b', 'x:y', '+x', 'a'.repeat(40).replace(/a/g, 'f')]) assert.equal(isSafeBranchName(bad), false, bad);
  assert.equal(isSafeRemoteName('origin'), true);
  assert.equal(isSafeRemoteName('https://github.com/a/b'), false);
  assert.equal(isSafeRemoteName('-o'), false);
});

test('up to date → state up-to-date, 0/0', async () => {
  const { a } = await world();
  const f = await fetchRemote(a, { remote: 'origin' }); assert.equal(f.ok, true);
  const s = await syncStatus(a, { base: 'dev' });
  assert.equal(s.ok, true); assert.equal(s.state, 'up-to-date'); assert.equal(s.ahead, 0); assert.equal(s.behind, 0);
  assert.ok(s.fetchedAt);
});

test('behind → fast-forward (checked out, clean) moves the branch and the working tree', async () => {
  const { a, push } = await world();
  await push('g.txt', 'two'); await push('h.txt', 'three');
  await fetchRemote(a);
  const s = await syncStatus(a, { base: 'dev' });
  assert.equal(s.state, 'behind'); assert.equal(s.behind, 2);
  assert.equal((await incomingCommits(a, { base: 'dev' })).map((c) => c.subject).join(','), 'three,two');
  const r = await fastForward(a, { base: 'dev' });
  assert.equal(r.ok, true); assert.equal(r.commits, 2);
  assert.equal(g(a, 'rev-parse', 'dev'), g(a, 'rev-parse', 'origin/dev'));
});

test('behind, base NOT checked out → update-ref CAS, HEAD untouched', async () => {
  const { a, push } = await world();
  g(a, 'checkout', '-q', '-b', 'other');
  await push('g.txt', 'two'); await fetchRemote(a);
  const r = await fastForward(a, { base: 'dev' });
  assert.equal(r.ok, true);
  assert.equal(g(a, 'rev-parse', 'dev'), g(a, 'rev-parse', 'origin/dev'));
  assert.equal(g(a, 'rev-parse', '--abbrev-ref', 'HEAD'), 'other');
});

test('checked out here but git spells the path differently → merge --ff-only, never update-ref', async () => {
  const { a, push } = await world();
  await push('g.txt', 'two'); await fetchRemote(a);
  const seen = [];
  _testing.setRunner((args, opts) => {
    seen.push(args[0]);
    // Simulate a Windows-style spelling mismatch: the only checkout of dev under another name.
    if (args[0] === 'worktree') {
      return Promise.resolve({ ok: true, stdout: 'worktree /Some/OTHER/Spelling\nHEAD 0000000000000000000000000000000000000000\nbranch refs/heads/dev\n\n', stderr: '', code: 0, timedOut: false });
    }
    return _testing.defaultRun(args, opts);
  });
  const s = await syncStatus(a, { base: 'dev' });
  assert.equal(s.checkedOutHere, true); assert.deepEqual(s.checkedOutElsewhere, []);
  const r = await fastForward(a, { base: 'dev' });
  _testing.setRunner(null);
  assert.equal(r.ok, true);
  assert.ok(seen.includes('merge')); assert.ok(!seen.includes('update-ref'));
  assert.equal(g(a, 'rev-parse', 'dev'), g(a, 'rev-parse', 'origin/dev'));
  assert.equal(g(a, 'status', '--porcelain', '--untracked-files=no'), '');   // index + files moved with HEAD
});

test('update-ref guard: a branch that becomes checked out between status and write is refused (in-use)', async () => {
  const { a, push } = await world();
  g(a, 'checkout', '-q', '-b', 'other');
  await push('g.txt', 'two'); await fetchRemote(a);
  const before = g(a, 'rev-parse', 'dev');
  let lists = 0;
  _testing.setRunner((args, opts) => {
    // 1st worktree list (syncStatus): dev checked out nowhere. 2nd (the guard): it now is.
    if (args[0] === 'worktree' && ++lists === 2) {
      return Promise.resolve({ ok: true, stdout: 'worktree /elsewhere\nHEAD 0000000000000000000000000000000000000000\nbranch refs/heads/dev\n\n', stderr: '', code: 0, timedOut: false });
    }
    return _testing.defaultRun(args, opts);
  });
  const r = await fastForward(a, { base: 'dev' });
  _testing.setRunner(null);
  assert.equal(r.ok, false); assert.equal(r.kind, 'in-use');
  assert.equal(g(a, 'rev-parse', 'dev'), before);
});

test('diverged → never merged; kind diverged', async () => {
  const { a, push } = await world();
  await push('g.txt', 'remote'); await writeFile(join(a, 'l.txt'), 'local\n');
  g(a, 'add', '-A'); g(a, 'commit', '-qm', 'local'); const before = g(a, 'rev-parse', 'dev');
  await fetchRemote(a);
  assert.equal((await syncStatus(a, { base: 'dev' })).state, 'diverged');
  const r = await fastForward(a, { base: 'dev' });
  assert.equal(r.ok, false); assert.equal(r.kind, 'diverged');
  assert.equal(g(a, 'rev-parse', 'dev'), before);
});

test('dirty checked-out base → refused (kind dirty); the file stays', async () => {
  const { a, push } = await world();
  await push('g.txt', 'two'); await fetchRemote(a);
  await writeFile(join(a, 'f.txt'), 'edited\n');
  const r = await fastForward(a, { base: 'dev' });
  assert.equal(r.ok, false); assert.equal(r.kind, 'dirty');
  assert.match(g(a, 'status', '--porcelain'), /f\.txt/);
});

test('deleted on the remote → --prune drops it; status no-upstream', async () => {
  const { a, b, push } = await world();
  await push('x.txt', 'x', 'feat/gone'); await fetchRemote(a);
  g(a, 'branch', 'feat/gone', 'origin/feat/gone');
  g(b, 'push', '-q', 'origin', '--delete', 'feat/gone');
  await fetchRemote(a);
  const s = await syncStatus(a, { base: 'feat/gone' });
  assert.equal(s.state, 'no-upstream');
});

test('remote-only branch → ensureLocalBranch creates a tracking branch; resolveSourceRef says remoteOnly', async () => {
  const { a, push } = await world();
  await push('x.txt', 'x', 'feat/new');
  const r = await resolveSourceRef(a, 'feat/new', { remote: 'origin' });   // fetches (TTL) itself
  assert.equal(r.ok, true); assert.equal(r.remoteOnly, true); assert.equal(r.ref, 'origin/feat/new');
  const c = await ensureLocalBranch(a, { base: 'feat/new' });
  assert.equal(c.ok, true); assert.equal(c.created, true);
  assert.equal(g(a, 'rev-parse', '--abbrev-ref', 'feat/new@{upstream}'), 'origin/feat/new');
  assert.equal((await resolveSourceRef(a, 'nope-nowhere')).ok, false);
});

test('ten concurrent callers → ONE git fetch; a call inside the TTL → none', async () => {
  const { a } = await world();
  let fetches = 0;
  _testing.setRunner((args, opts) => { if (args[0] === 'fetch') fetches += 1; return _testing.defaultRun(args, opts); });
  const all = await Promise.all(Array.from({ length: 10 }, () => fetchRemote(a, { maxAgeMs: 0 })));
  assert.equal(fetches, 1); assert.ok(all.every((r) => r.ok));
  const again = await fetchRemote(a, { maxAgeMs: 45_000 });
  assert.equal(fetches, 1); assert.equal(again.cached, true);
  // TTL is disk-based (FETCH_HEAD mtime), so an aged FETCH_HEAD forces a fetch.
  const old = new Date(Date.now() - 60_000);
  await utimes(join(a, '.git', 'FETCH_HEAD'), old, old);
  await fetchRemote(a, { maxAgeMs: 45_000 });
  assert.equal(fetches, 2);
});

test('seam: auth / network / timeout kinds; cached refs still answer; tokens scrubbed', async () => {
  const { a } = await world();
  await fetchRemote(a);
  for (const [stderr, kind, timedOut] of [
    ["fatal: could not read Username for 'https://github.com': terminal prompts disabled", 'auth', false],
    ['remote: Repository not found.\nfatal: repository \'https://x-access-token:ghs_abcdefghijklmnopqrstuvwxyz0123@github.com/a/b/\' not found', 'auth', false],
    ["fatal: unable to access 'https://github.com/a/b/': Could not resolve host: github.com", 'network', false],
    ['', 'timeout', true],
  ]) {
    _testing.setRunner((args, opts) => (args[0] === 'fetch'
      ? Promise.resolve({ ok: false, stdout: '', stderr, code: 128, timedOut })
      : _testing.defaultRun(args, opts)));
    const r = await fetchRemote(a, { maxAgeMs: 0 });
    assert.equal(r.ok, false); assert.equal(r.kind, kind);
    assert.doesNotMatch(r.error || '', /ghs_|x-access-token:/);
    const s = await syncStatus(a, { base: 'dev' });           // offline: cached refs still answer
    assert.equal(s.ok, true); assert.equal(s.state, 'up-to-date');
  }
});

test('syncBaseForRun: behind→fast-forwarded; diverged+fail→diverged; diverged+origin→remote-start; dirty→remote-start', async () => {
  const w1 = await world(); await w1.push('g.txt', 'two');
  const r1 = await syncBaseForRun(w1.a, { base: 'dev' });
  assert.equal(r1.result, 'fast-forwarded'); assert.equal(r1.commits, 1); assert.equal(r1.startRef, undefined);

  const w2 = await world(); await w2.push('g.txt', 'r');
  await writeFile(join(w2.a, 'l.txt'), 'l\n'); g(w2.a, 'add', '-A'); g(w2.a, 'commit', '-qm', 'l');
  assert.equal((await syncBaseForRun(w2.a, { base: 'dev', onDiverged: 'fail' })).result, 'diverged');
  const r2 = await syncBaseForRun(w2.a, { base: 'dev', onDiverged: 'origin' });
  assert.equal(r2.result, 'remote-start'); assert.equal(r2.startRef, g(w2.a, 'rev-parse', 'origin/dev'));

  const w3 = await world(); await w3.push('g.txt', 'two'); await writeFile(join(w3.a, 'f.txt'), 'dirty\n');
  const r3 = await syncBaseForRun(w3.a, { base: 'dev' });
  assert.equal(r3.result, 'remote-start'); assert.equal(r3.reason, 'dirty');
  assert.ok(r3.log.some((l) => /git fetch/.test(l)));
});

test('listBranches: local + remote rows, ahead/behind, pattern, truncation', async () => {
  const { a, push } = await world();
  await push('x.txt', 'x', 'feat/one'); await push('y.txt', 'y', 'feat/two'); await push('z.txt', 'z');
  const r = await listBranches(a, { remote: 'origin', fresh: true, limit: 2 });
  assert.equal(r.ok, true); assert.equal(r.total, 3); assert.equal(r.truncated, true);
  const dev = (await listBranches(a, { fresh: false, pattern: 'DEV' })).branches.find((b) => b.name === 'dev');
  assert.deepEqual([dev.hasLocal, dev.hasRemote, dev.behind, dev.ahead], [true, true, 1, 0]);
  const one = (await listBranches(a, { fresh: false, pattern: 'one' })).branches[0];
  assert.deepEqual([one.hasLocal, one.hasRemote], [false, true]);
});

test('negative cache: a failed fetch is remembered for the TTL; maxAgeMs 0 always retries', async () => {
  const { a } = await world();
  let fetches = 0;
  _testing.setRunner((args, opts) => {
    if (args[0] !== 'fetch') return _testing.defaultRun(args, opts);
    fetches += 1;
    return Promise.resolve({ ok: false, stdout: '', stderr: 'fatal: Authentication failed for x', code: 128, timedOut: false });
  });
  assert.equal((await fetchRemote(a, { maxAgeMs: 45_000 })).kind, 'auth');
  const again = await fetchRemote(a, { maxAgeMs: 45_000 });
  assert.equal(fetches, 1); assert.equal(again.ok, false); assert.equal(again.cached, true);
  await fetchRemote(a, { maxAgeMs: 0 });                       // the run's Sync stage never uses it
  assert.equal(fetches, 2);
  _testing.setRunner(null);
  assert.equal((await fetchRemote(a, { maxAgeMs: 0 })).ok, true);  // success clears it
  assert.equal((await fetchRemote(a, { maxAgeMs: 45_000 })).cached, true);
});

test('status reads report a failed fetch newer than the last good one; a later good fetch clears it', async () => {
  const { a } = await world();
  assert.equal((await fetchRemote(a, { maxAgeMs: 0 })).ok, true);
  assert.equal((await syncRepo(a, { base: 'dev', mode: 'status' })).stale, false);
  _testing.setRunner((args, opts) => (args[0] === 'fetch'
    ? Promise.resolve({ ok: false, stdout: '', stderr: 'fatal: Could not resolve host: x', code: 128, timedOut: false })
    : _testing.defaultRun(args, opts)));
  await syncRepo(a, { base: 'dev', mode: 'fetch', maxAgeMs: 0 });   // the background tick's path
  const off = await syncRepo(a, { base: 'dev', mode: 'status' });
  assert.equal(off.stale, true);
  assert.equal(off.fetchError.kind, 'network');
  assert.equal(off.fetch, null, 'a status read still never fetches');
  assert.equal((await syncRepo(a, { base: 'feat/other', mode: 'status' })).stale, true, 'per remote, not per branch');
  _testing.setRunner(null);
  assert.equal((await fetchRemote(a, { maxAgeMs: 0 })).ok, true);
  const back = await syncRepo(a, { base: 'dev', mode: 'status' });
  assert.equal(back.stale, false);
  assert.equal(back.fetchError, undefined);
});

test('runSyncOptions: absent → disabled; per-member settings', () => {
  assert.equal(runSyncOptions(undefined).enabled, false);
  const o = runSyncOptions({ members: { a: { enabled: true, remote: 'upstream', onDiverged: 'origin', policySource: 'user' }, b: { enabled: false, remote: 'https://x' } } });
  assert.equal(o.enabled, true);
  assert.deepEqual(o.memberFor('a'), { enabled: true, remote: 'upstream', onDiverged: 'origin', policySource: 'user' });
  assert.deepEqual(o.memberFor('b'), { enabled: false, remote: 'origin', onDiverged: 'fail', policySource: 'setting' });
  assert.equal(o.memberFor('zzz').enabled, false);
});

test('commitsBetween: count, or null when a ref is missing', async () => {
  const { a, push } = await world();
  const base = g(a, 'rev-parse', 'HEAD');
  await push('g.txt', 'two'); await fetchRemote(a);
  assert.equal(await commitsBetween(a, base, 'refs/remotes/origin/dev'), 1);
  assert.equal(await commitsBetween(a, base, 'refs/remotes/origin/nope'), null);
});

test('TTL is per remote: fetching another remote never makes this one fresh; a person\'s fetch of it does', async () => {
  const { a } = await world();
  const url = g(a, 'remote', 'get-url', 'origin');
  const mirror = join(root, `m${++n}.git`);
  g(root, 'clone', '-q', '--bare', url, mirror);
  g(a, 'remote', 'add', 'up', mirror);
  let fetches = 0;
  const count = () => _testing.setRunner((args, opts) => { if (args[0] === 'fetch') fetches += 1; return _testing.defaultRun(args, opts); });
  count();
  assert.equal((await fetchRemote(a, { remote: 'origin', maxAgeMs: 0 })).ok, true);
  assert.ok(await lastFetchedAt(a, { remote: 'origin' }));
  // Another process (or a person) fetches upstream: FETCH_HEAD now names only up's URL.
  _testing.forgetProcess(); g(a, 'fetch', '-q', 'up');
  assert.equal(await lastFetchedAt(a, { remote: 'origin' }), null);
  assert.ok(await lastFetchedAt(a, { remote: 'up' }));
  const r = await fetchRemote(a, { remote: 'origin', maxAgeMs: 45_000 });
  assert.equal(r.cached, false); assert.equal(fetches, 2);
  // A person's plain `git fetch origin` in the project dir counts across processes (URL match).
  _testing.forgetProcess(); g(a, 'fetch', '-q', 'origin');
  assert.equal((await fetchRemote(a, { remote: 'origin', maxAgeMs: 45_000 })).cached, true);
  assert.equal(fetches, 2);
});

test('fetchHeadUrls: credential-free forms git writes into FETCH_HEAD', () => {
  assert.deepEqual(fetchHeadUrls('https://x-access-token:tok@github.com/a/b.git'), ['https://github.com/a/b']);
  assert.deepEqual(fetchHeadUrls('git@github.com:a/b.git'), ['git@github.com:a/b', 'github.com:a/b']);
  assert.deepEqual(fetchHeadUrls('/srv/repos/x.git/'), ['/srv/repos/x']);
});

test('git runs with GIT_OPTIONAL_LOCKS=0, so status never takes the user\'s index lock', () => {
  assert.equal(_testing.QUIET_ENV.GIT_OPTIONAL_LOCKS, '0');
});

test('a timed-out fetch kills its whole process group (no orphaned ssh left waiting on a tty)', { skip: process.platform === 'win32' }, async () => {
  const { a } = await world();
  // An "ssh" that never answers; it records its pid first.
  const pidFile = join(root, `ssh-${n}.pid`), fake = join(root, `fake-ssh-${n}.sh`);
  await writeFile(fake, `#!/bin/sh\necho $$ > "${pidFile}"\nexec sleep 30\n`); await chmod(fake, 0o755);
  g(a, 'config', 'core.sshCommand', fake);
  g(a, 'remote', 'set-url', 'origin', 'ssh://git@example.invalid/x.git');
  const r = await fetchRemote(a, { timeoutMs: 700, maxAgeMs: 0 });
  assert.equal(r.ok, false); assert.equal(r.kind, 'timeout');
  const pid = Number((await readFile(pidFile, 'utf8')).trim());
  const deadline = Date.now() + 5_000;
  let alive = true;
  while (alive && Date.now() < deadline) {
    try { process.kill(pid, 0); await new Promise((res) => setTimeout(res, 100)); } catch { alive = false; }
  }
  assert.equal(alive, false, 'the ssh stand-in must not outlive the timeout');
});

test('merge path re-checks HEAD: a checkout of another branch after status → in-use, nothing moves', async () => {
  const { a, push } = await world();
  await push('h.txt', 'two'); await fetchRemote(a);
  const devBefore = g(a, 'rev-parse', 'dev');
  _testing.setRunner((args, opts) => {
    // syncStatus's dirty check is the last call before fastForward writes: switch branch right after it.
    const p = _testing.defaultRun(args, opts);
    return args[0] === 'status' ? p.then((res) => { g(a, 'checkout', '-q', '-b', 'feat'); return res; }) : p;
  });
  const r = await fastForward(a, { base: 'dev' });
  _testing.setRunner(null);
  assert.equal(r.ok, false); assert.equal(r.kind, 'in-use');
  assert.equal(g(a, 'rev-parse', 'feat'), devBefore);   // feat was NOT fast-forwarded to origin/dev
  assert.equal(g(a, 'rev-parse', 'dev'), devBefore);
});

test('joining a longer in-flight fetch still answers within the caller\'s own bound (v8)', async () => {
  const { a } = await world();
  _testing.reset();
  _testing.setRunner((args, opts) => (args[0] === 'fetch'
    ? new Promise((res) => setTimeout(() => res(_testing.defaultRun(args, opts)), 1_500))
    : _testing.defaultRun(args, opts)));
  const long = fetchRemote(a, { timeoutMs: 60_000, maxAgeMs: 0 });          // e.g. the background tick
  const t0 = Date.now();
  const short = await fetchRemote(a, { timeoutMs: 300, maxAgeMs: 45_000 });  // a person's picker
  assert.ok(Date.now() - t0 < 1_000, 'the joiner must not wait for the 1.5 s fetch');
  assert.equal(short.ok, false); assert.equal(short.kind, 'timeout');
  assert.equal((await long).ok, true);                                       // the shared fetch was not cut
  _testing.setRunner(null);
});

test('a fast-forward that checks out files runs merge as a network command (own group, read credential env)', { skip: process.platform === 'win32' }, async () => {
  const { a, push } = await world();
  await push('m.txt', 'two'); await fetchRemote(a);
  let mergeOpts = null;
  _testing.setRunner((args, opts) => { if (args[0] === 'merge') mergeOpts = opts; return _testing.defaultRun(args, opts); });
  const r = await fastForward(a, { base: 'dev' });
  _testing.setRunner(null);
  assert.equal(r.ok, true);
  assert.ok(mergeOpts && mergeOpts.env === null, 'non-GitHub remote: machine git config, no worca credential');
  assert.ok(_testing.NETWORK_CMDS.has('merge'));
});

test('git-sync never runs the project\'s hooks: reference-transaction / post-merge stay silent on fetch, fast-forward and update-ref', { skip: process.platform === 'win32' }, async () => {
  const prevHome = process.env.WORCA_HOME;
  process.env.WORCA_HOME = root;
  try {
    const { a, push } = await world();
    const marker = join(root, `hook-ran-${n}`);
    for (const hook of ['reference-transaction', 'post-merge']) {
      const p = join(a, '.git', 'hooks', hook);
      await writeFile(p, `#!/bin/sh\necho ${hook} >> "${marker}"\nexit 0\n`);
      await chmod(p, 0o755);
    }
    await push('h.txt', 'two');
    assert.equal((await fetchRemote(a, { maxAgeMs: 0 })).ok, true);
    assert.equal((await fastForward(a, { base: 'dev' })).ok, true, 'checked-out base: merge --ff-only');
    await push('h2.txt', 'three');
    g(a, '-c', 'core.hooksPath=/dev/null', 'checkout', '-q', '-b', 'side');   // the test's own step must not trip the hook
    assert.equal((await fetchRemote(a, { maxAgeMs: 0 })).ok, true);
    assert.equal((await fastForward(a, { base: 'dev' })).ok, true, 'base not checked out: update-ref');
    await assert.rejects(readFile(marker, 'utf8'), { code: 'ENOENT' }, 'a project hook ran inside git-sync');
    g(a, 'update-ref', 'refs/heads/probe', 'HEAD');
    assert.match(await readFile(marker, 'utf8'), /reference-transaction/, 'control: the planted hook does run under plain git');
  } finally {
    if (prevHome === undefined) delete process.env.WORCA_HOME; else process.env.WORCA_HOME = prevHome;
  }
});

test('pure helpers', () => {
  assert.equal(classifyFetchError('fatal: Authentication failed for ...'), 'auth');
  assert.equal(classifyFetchError("fatal: 'upstream' does not appear to be a git repository"), 'no-remote');
  // A configured remote whose path/URL is not a repository: git adds the "access rights" line, but
  // it is unreachable, not a sign-in problem.
  assert.equal(classifyFetchError("fatal: '/gone/x.git' does not appear to be a git repository\nfatal: Could not read from remote repository.\n\nPlease make sure you have the correct access rights\nand the repository exists."), 'network');
  assert.equal(classifyFetchError("fatal: 'git@host:o/r.git' does not appear to be a git repository"), 'network');
  assert.equal(scrubGitText('https://u:secret@host/x ghp_abcdefghijklmnopqrstuv1234'), 'https://***@host/x <redacted>');
  assert.equal(syncState({ ok: true, hasLocal: true, hasRemote: true, ahead: 1, behind: 2 }), 'diverged');
});

test('a planted core.fsmonitor command in .git/config never runs from a git-sync status read', { skip: process.platform === 'win32' }, async () => {
  const { a } = await world();
  const marker = join(root, `fsmon-${n}`);
  const script = join(root, `fsmon-${n}.sh`);
  await writeFile(script, `#!/bin/sh\necho ran >> "${marker}"\n`); await chmod(script, 0o755);
  g(a, 'config', 'core.fsmonitor', script);
  await fetchRemote(a);
  const s = await syncStatus(a, { base: 'dev' });
  assert.equal(s.ok, true); assert.equal(s.checkedOutHere, true);
  await assert.rejects(readFile(marker, 'utf8'), 'git-sync status must not run core.fsmonitor');
  spawnSync('git', ['status', '--porcelain'], { cwd: a });
  assert.match(await readFile(marker, 'utf8'), /ran/, 'control: plain git status runs it');
});

test('a failed `git worktree list` counts as in use: update-ref never moves the base', async () => {
  const { a, push } = await world();
  g(a, 'checkout', '-q', '-b', 'other');
  await push('g.txt', 'two'); await fetchRemote(a);
  const before = g(a, 'rev-parse', 'dev');
  _testing.setRunner((args, opts) => (args[0] === 'worktree'
    ? Promise.resolve({ ok: false, stdout: '', stderr: 'fatal: boom', code: 128, timedOut: false })
    : _testing.defaultRun(args, opts)));
  const r = await fastForward(a, { base: 'dev' });
  _testing.setRunner(null);
  assert.equal(r.ok, false); assert.equal(r.kind, 'in-use');
  assert.equal(g(a, 'rev-parse', 'dev'), before);
});

test('a lost update-ref compare-and-swap is diverged, with the counts re-read after the refusal', async () => {
  const { a, push } = await world();
  g(a, 'checkout', '-q', '-b', 'other');
  await push('g.txt', 'two'); await fetchRemote(a);
  const commitOnDev = () => {
    // Someone commits on dev (not checked out anywhere) between the status read and the write.
    const tree = g(a, 'rev-parse', 'dev^{tree}');
    const c = g(a, 'commit-tree', tree, '-p', 'dev', '-m', 'local');
    g(a, '-c', 'core.hooksPath=/dev/null', 'update-ref', 'refs/heads/dev', c);
  };
  _testing.setRunner((args, opts) => {
    if (args.includes('update-ref') && !args.includes('commit-tree')) commitOnDev();
    return _testing.defaultRun(args, opts);
  });
  const r = await fastForward(a, { base: 'dev' });
  assert.equal(r.ok, false); assert.equal(r.kind, 'diverged');
  assert.equal(r.ahead, 1); assert.equal(r.behind, 1);
  _testing.setRunner(null);
});

test('syncBaseForRun: a base that diverges during the fast-forward reports the re-read ahead count', async () => {
  const { a, push } = await world();
  g(a, 'checkout', '-q', '-b', 'other');
  await push('g.txt', 'two');
  let armed = true;
  _testing.setRunner((args, opts) => {
    if (armed && args[0] === 'update-ref') {
      armed = false;
      const tree = g(a, 'rev-parse', 'dev^{tree}');
      const c = g(a, 'commit-tree', tree, '-p', 'dev', '-m', 'local');
      g(a, '-c', 'core.hooksPath=/dev/null', 'update-ref', 'refs/heads/dev', c);
    }
    return _testing.defaultRun(args, opts);
  });
  const r = await syncBaseForRun(a, { base: 'dev', onDiverged: 'fail' });
  _testing.setRunner(null);
  assert.equal(r.result, 'diverged');
  assert.equal(r.ahead, 1, 'not the pre-merge "0 ahead"'); assert.equal(r.behind, 1);
});

test('merge path re-checks HEAD AFTER the credential mint: a checkout during it → in-use', async () => {
  const { a, push } = await world();
  await push('h.txt', 'two'); await fetchRemote(a);
  const devBefore = g(a, 'rev-parse', 'dev');
  let statusSeen = false, switched = false;
  _testing.setRunner((args, opts) => {
    // fastForward's own `remote get-url` (the mint's input) comes after syncStatus's `status`.
    if (args[0] === 'status') statusSeen = true;
    else if (statusSeen && !switched && args[0] === 'remote') { switched = true; g(a, 'checkout', '-q', '-b', 'feat'); }
    return _testing.defaultRun(args, opts);
  });
  const r = await fastForward(a, { base: 'dev' });
  _testing.setRunner(null);
  assert.equal(switched, true);
  assert.equal(r.ok, false); assert.equal(r.kind, 'in-use');
  assert.equal(g(a, 'rev-parse', 'feat'), devBefore);
});

test('resolveSourceRef accepts a just-fetched <remote>/<name>', async () => {
  const { a, push } = await world();
  await fetchRemote(a);
  await push('n.txt', 'new', 'feat-new');   // pushed after the last fetch
  const r = await resolveSourceRef(a, 'origin/feat-new', { maxAgeMs: 0 });
  assert.equal(r.ok, true); assert.equal(r.ref, 'origin/feat-new'); assert.equal(r.remoteOnly, true);
});

test('a failed fetch keeps the last good fetch time (git empties FETCH_HEAD) and classifies a gone path as network', async () => {
  const { a } = await world();
  const good = await fetchRemote(a);
  assert.equal(good.ok, true);
  g(a, 'remote', 'set-url', 'origin', join(root, 'no-such-origin.git'));
  const bad = await fetchRemote(a, { maxAgeMs: 0 });
  assert.equal(bad.ok, false); assert.equal(bad.kind, 'network');
  assert.equal(bad.fetchedAt, good.fetchedAt);
  const st = await syncRepo(a, { base: 'dev', mode: 'status' });
  assert.equal(st.stale, true); assert.equal(st.fetchedAt, good.fetchedAt);
});

test('status reads spawn no extra git for the negative cache when nothing failed', async () => {
  const { a } = await world();
  await fetchRemote(a);
  const calls = [];
  _testing.setRunner((args, opts) => { calls.push(args.join(' ')); return _testing.defaultRun(args, opts); });
  await syncRepo(a, { base: 'dev', mode: 'status' });
  _testing.setRunner(null);
  // syncStatus reads the remote once (lastFetchedMs); standingFailure adds none.
  assert.equal(calls.filter((c) => c.startsWith('remote get-url')).length, 1);
});

// test/git-sync.test.mjs  (append)
/** A local repo on dev (the file's gitconfig; NO remote) + a linked worktree on `run`, the hidden branch. */
async function hidden() {
  const dir = join(root, `ff${++n}`);
  g(root, 'init', '-q', dir);
  await writeFile(join(dir, 'f.txt'), 'one\n'); g(dir, 'add', '-A'); g(dir, 'commit', '-qm', 'init');
  const wt = `${dir}-run`;
  g(dir, 'worktree', 'add', '-q', '-b', 'run', wt);
  const work = async (file) => { await writeFile(join(wt, file), `${file}\n`); g(wt, 'add', '-A'); g(wt, 'commit', '-qm', file); return g(wt, 'rev-parse', 'HEAD'); };
  return { dir, wt, work };
}

test('fastForwardTo: checked out here + clean → merge --ff-only moves dev and the working tree', async () => {
  const { dir, work } = await hidden();
  const to = await work('a.txt');
  const r = await fastForwardTo(dir, { base: 'dev', to });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.commits, 1);
  assert.equal(g(dir, 'rev-parse', 'dev'), to);
  assert.equal(await readFile(join(dir, 'a.txt'), 'utf8'), 'a.txt\n', 'the main checkout got the file');
});

test('fastForwardTo: a dirty checkout of the base is refused and left untouched', async () => {
  const { dir, work } = await hidden();
  const before = g(dir, 'rev-parse', 'dev');
  const to = await work('a.txt');
  await writeFile(join(dir, 'f.txt'), 'local edit\n');
  const r = await fastForwardTo(dir, { base: 'dev', to });
  assert.equal(r.ok, false); assert.equal(r.kind, 'dirty');
  assert.equal(g(dir, 'rev-parse', 'dev'), before);
  assert.equal(await readFile(join(dir, 'f.txt'), 'utf8'), 'local edit\n');
});

test('fastForwardTo: base not checked out anywhere → CAS update-ref; HEAD stays where it was', async () => {
  const { dir, work } = await hidden();
  g(dir, 'checkout', '-q', '-b', 'elsewhere');
  const to = await work('a.txt');
  const r = await fastForwardTo(dir, { base: 'dev', to });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(g(dir, 'rev-parse', 'dev'), to);
  assert.equal(g(dir, 'rev-parse', '--abbrev-ref', 'HEAD'), 'elsewhere');
});

test('fastForwardTo: base moved since the run started → diverged, nothing moves', async () => {
  const { dir, work } = await hidden();
  const to = await work('a.txt');
  await writeFile(join(dir, 'm.txt'), 'm\n'); g(dir, 'add', 'm.txt'); g(dir, 'commit', '-qm', 'moved');
  const moved = g(dir, 'rev-parse', 'dev');
  const r = await fastForwardTo(dir, { base: 'dev', to });
  assert.equal(r.ok, false); assert.equal(r.kind, 'diverged');
  assert.equal(g(dir, 'rev-parse', 'dev'), moved);
});

test('fastForwardTo: base checked out in ANOTHER worktree → in-use; missing base; bad target; no-op', async () => {
  const { dir, work } = await hidden();
  const to = await work('a.txt');
  g(dir, 'checkout', '-q', '-b', 'elsewhere');
  g(dir, 'worktree', 'add', '-q', `${dir}-other`, 'dev');
  assert.equal((await fastForwardTo(dir, { base: 'dev', to })).kind, 'in-use');
  assert.equal((await fastForwardTo(dir, { base: 'nope', to })).kind, 'missing');
  assert.equal((await fastForwardTo(dir, { base: 'dev', to: '--force' })).kind, 'bad-target');
  const same = await fastForwardTo(dir, { base: 'run', to });
  assert.deepEqual([same.ok, same.commits], [true, 0]);
});

test('fastForwardTo: never replaces an IGNORED local file that the run\'s commits add → dirty, file untouched', async () => {
  const { dir, wt } = await hidden();
  const excl = join(root, `excl${n}`);
  await writeFile(excl, 'secret.json\n');
  g(dir, 'config', 'core.excludesFile', excl);               // the user ignores secret.json …
  await writeFile(join(dir, 'secret.json'), 'mine\n');        // … and keeps a local one git has no copy of
  await writeFile(join(wt, 'secret.json'), 'run\n');
  g(wt, 'add', '-f', 'secret.json'); g(wt, 'commit', '-qm', 'secret');   // the agent force-added it
  const to = g(wt, 'rev-parse', 'HEAD');
  const r = await fastForwardTo(dir, { base: 'dev', to });
  assert.equal(r.ok, false); assert.equal(r.kind, 'dirty', JSON.stringify(r));
  assert.notEqual(g(dir, 'rev-parse', 'dev'), to, 'dev did not move');
  assert.equal(await readFile(join(dir, 'secret.json'), 'utf8'), 'mine\n');
});
