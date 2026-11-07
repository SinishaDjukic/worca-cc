// test/runs-share-branch.test.mjs — plumbing commits and fast-forward pushes on `worca-runs` (run sharing s1, D5/D7).
// Every origin is a local bare repository (makeOrigin); the developer's checkout is never touched.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { git, makeOrigin, cloneAs, branchFiles, rejectAllPushes, useGitSandbox } from './helpers/metrics-git.mjs';
import { buildCommit, publishFiles, RUNS_BRANCH, RUNS_REMOTE_REF, RUNS_SHARE_PROTECTION_HINT, RUNS_SHARE_COMPACT_HINT, README_TEXT } from '../src/core/runs-share/branch.mjs';
import { runGit, identityArgs } from '../src/core/metrics/sync.mjs';
import { worcaHome } from '../src/core/projects.mjs';

useGitSandbox(before, after);
useTempHome(after);
const skip = process.platform === 'win32' ? 'sh hooks not portable to win32' : false;
let root;
before(() => { root = mkdtempSync(join(tmpdir(), 'worca-runs-branch-')); });
after(() => rmSync(root, { recursive: true, force: true }));

const PA = 'aaaaaaaaaaaaaaaa';
const PB = 'bbbbbbbbbbbbbbbb';
const rec = (person, id, extra = '') => ({ [`runs/${person}/${id}.json`]: `{"runId":"${id}"${extra}}\n` });
const noSleep = async () => {};
let n = 0;
function world() {
  n += 1;
  const bare = makeOrigin(root, `shop${n}`);
  const a = cloneAs(root, `machineA${n}`, bare, 'shop');
  return { bare, a };
}
const publish = async (dir, files, opts = {}) => publishFiles(dir, { files, message: 'worca-runs: 1 run(s)', identity: await identityArgs(dir, 'git-user'), sleep: noSleep, ...opts });
const tip = (bare) => git(bare, 'rev-parse', `refs/heads/${RUNS_BRANCH}`);
const localRef = (dir) => { try { return git(dir, 'rev-parse', '--verify', '--quiet', RUNS_REMOTE_REF); } catch { return null; } };

test('the root commit holds README.md and the record; the next commit has it as parent', { skip }, async () => {
  const { bare, a } = world();
  const r1 = await publish(a, rec(PA, '11111111'));
  assert.equal(r1.ok, true, JSON.stringify(r1));
  assert.equal(r1.pushed, true);
  assert.deepEqual(branchFiles(bare, RUNS_BRANCH), ['README.md', `runs/${PA}/11111111.json`]);
  assert.equal(git(bare, 'show', `${RUNS_BRANCH}:README.md`), README_TEXT.trim());
  assert.equal(tip(bare), r1.sha);
  assert.equal(localRef(a), r1.sha, 'the remote-tracking ref follows the push');
  const r2 = await publish(a, rec(PA, '22222222'));
  assert.equal(r2.pushed, true);
  assert.equal(git(bare, 'rev-parse', `${r2.sha}^`), r1.sha);
  assert.deepEqual(branchFiles(bare, RUNS_BRANCH), ['README.md', `runs/${PA}/11111111.json`, `runs/${PA}/22222222.json`]);
  assert.equal(git(bare, 'rev-list', '--count', RUNS_BRANCH), '2');
});

test('identical files: unchanged, no commit object, the ref unmoved', { skip }, async () => {
  const { bare, a } = world();
  const r1 = await publish(a, rec(PA, '11111111'));
  const objects = git(a, 'count-objects', '-v');
  const b = await buildCommit(a, { parent: r1.sha, files: rec(PA, '11111111'), message: 'm', identity: [], git: runGit });
  assert.deepEqual([b.ok, b.unchanged], [true, true]);
  const r2 = await publish(a, rec(PA, '11111111'));
  assert.deepEqual([r2.ok, r2.pushed], [true, false]);
  assert.equal(tip(bare), r1.sha);
  assert.equal(localRef(a), r1.sha);
  assert.equal(git(a, 'count-objects', '-v'), objects, 'no new object');
});

test('publish leaves HEAD, index and status untouched on a dirty checkout', { skip }, async () => {
  const { a } = world();
  writeFileSync(join(a, 'staged.txt'), 'staged\n'); git(a, 'add', 'staged.txt');
  writeFileSync(join(a, 'README.md'), 'modified\n');
  writeFileSync(join(a, 'untracked.txt'), 'u\n');
  const snap = () => ({
    head: git(a, 'rev-parse', 'HEAD'),
    index: createHash('sha256').update(readFileSync(join(a, '.git', 'index'))).digest('hex'),
    status: git(a, 'status', '--porcelain'),
    refs: git(a, 'for-each-ref', '--format=%(refname) %(objectname)').split('\n').filter((l) => !l.startsWith(`${RUNS_REMOTE_REF} `)).join('\n'),
  });
  const pre = snap();
  assert.equal((await publish(a, rec(PA, '11111111'))).pushed, true);
  assert.equal((await publish(a, rec(PA, '22222222'))).pushed, true);
  assert.deepEqual(snap(), pre);
});

test('a teammate push first: the retried fast-forward keeps both', { skip }, async () => {
  const { bare, a } = world();
  await publish(a, rec(PA, '11111111'));
  const b = cloneAs(root, `machineB${n}`, bare, 'shop');
  let teammate = null;
  const r = await publish(a, rec(PA, '22222222'), {
    hooks: { beforePush: async (attempt) => { if (attempt === 1) teammate = await publish(b, rec(PB, '33333333')); } },
  });
  assert.equal(teammate.ok, true, JSON.stringify(teammate));
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.attempts, 2);
  assert.deepEqual(branchFiles(bare, RUNS_BRANCH), ['README.md', `runs/${PA}/11111111.json`, `runs/${PA}/22222222.json`, `runs/${PB}/33333333.json`]);
  assert.equal(git(bare, 'rev-list', '--count', RUNS_BRANCH), '3');
  git(bare, 'merge-base', '--is-ancestor', teammate.sha, RUNS_BRANCH);
  assert.equal(localRef(a), tip(bare), 'the CAS moved the local ref to the pushed sha');
});

test('a single-branch clone (fetch refspec without worca-runs): the CAS moves the local ref to the pushed sha after a retry', { skip }, async () => {
  const { bare, a } = world();
  git(a, 'config', 'remote.origin.fetch', '+refs/heads/main:refs/remotes/origin/main');
  const r1 = await publish(a, rec(PA, '11111111'));
  assert.equal(localRef(a), r1.sha, 'a root push: CAS from no ref');
  const b = cloneAs(root, `machineB${n}`, bare, 'shop');
  const r = await publish(a, rec(PA, '22222222'), { hooks: { beforePush: async (attempt) => { if (attempt === 1) await publish(b, rec(PB, '33333333')); } } });
  assert.deepEqual([r.ok, r.attempts], [true, 2]);
  assert.equal(localRef(a), tip(bare), 'old value = the fetched tip the retry was built on');
});

test('a branch-protection rejection returns PUSH_REJECTED with the worca-runs hint', { skip }, async () => {
  const { bare, a } = world();
  rejectAllPushes(bare);
  const r = await publish(a, rec(PA, '11111111'));
  assert.equal(r.ok, false);
  assert.equal(r.code, 'PUSH_REJECTED');
  assert.equal(r.hint, RUNS_SHARE_PROTECTION_HINT);
  assert.match(r.hint, /worca-runs/);
  assert.match(r.stderr, /hook declined/);
  assert.equal(localRef(a), null);
});

const NFF = { ok: false, code: 1, stdout: '', stderr: ' ! [rejected]        abc -> worca-runs (fetch first)\n' };

test('non-fast-forward on every attempt: PUSH_RETRIES_EXHAUSTED after 5 attempts', { skip }, async () => {
  const { a } = world();
  let pushes = 0;
  const fake = (cwd, args, o) => (args[0] === 'push' ? (pushes++, Promise.resolve(NFF)) : runGit(cwd, args, o));
  const r = await publish(a, rec(PA, '11111111'), { git: fake });
  assert.deepEqual([r.ok, r.code, r.attempts, pushes], [false, 'PUSH_RETRIES_EXHAUSTED', 5, 5]);
  assert.equal(r.hint, null);
});

test('a fetch failure after a rejection returns FETCH_FAILED', { skip }, async () => {
  const { a } = world();
  git(a, 'remote', 'set-url', 'origin', join(root, 'nowhere.git'));
  const fake = (cwd, args, o) => (args[0] === 'push' ? Promise.resolve(NFF) : runGit(cwd, args, o));
  const r = await publish(a, rec(PA, '11111111'), { git: fake });
  assert.deepEqual([r.ok, r.code, r.attempts], [false, 'FETCH_FAILED', 1]);
  assert.equal(r.hint, null);
});

test('the branch deleted on origin while a local tip remains: recovered with a new root', { skip }, async () => {
  const { bare, a } = world();
  await publish(a, rec(PA, '11111111'));
  git(bare, 'update-ref', '-d', `refs/heads/${RUNS_BRANCH}`);
  // A teammate recreates it: our stale local tip is no ancestor of theirs.
  const b = cloneAs(root, `machineB${n}`, bare, 'shop');
  await publish(b, rec(PB, '33333333'));
  const r = await publish(a, rec(PA, '22222222'));
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(branchFiles(bare, RUNS_BRANCH), ['README.md', `runs/${PA}/22222222.json`, `runs/${PB}/33333333.json`], 'rebuilt on the new root');
});

test('an ambient GIT_AUTHOR_NAME never reaches the commit; the temp dir is left empty; no forbidden command runs', { skip }, async () => {
  const { bare, a } = world();
  const prev = process.env.GIT_AUTHOR_NAME;
  process.env.GIT_AUTHOR_NAME = 'Env Person';
  const seen = [];
  const counting = (cwd, args, o) => { seen.push(args); return runGit(cwd, args, o); };
  try {
    const r = await publish(a, rec(PA, '11111111'), { git: counting });
    assert.equal(r.pushed, true);
  } finally { if (prev === undefined) delete process.env.GIT_AUTHOR_NAME; else process.env.GIT_AUTHOR_NAME = prev; }
  assert.equal(git(bare, 'log', '-1', '--format=%an <%ae>', RUNS_BRANCH), `machineA${n} dev <machineA${n}@t>`);
  const tmp = join(worcaHome(), 'runs-share', 'tmp');
  assert.ok(existsSync(tmp));
  assert.deepEqual(readdirSync(tmp), []);
  const cmds = new Set(seen.map((args) => args.find((x) => !x.startsWith('-') && !x.includes('='))));
  for (const bad of ['checkout', 'reset', 'worktree', 'commit', 'merge', 'mktree']) assert.equal(cmds.has(bad), false, bad);
  for (const args of seen) {
    assert.equal(args.some((x) => x === '--force' || x.startsWith('--force-with-lease') || /^\+/.test(x)), false, args.join(' '));
  }
  const ups = seen.filter((args) => args.includes('update-ref'));
  assert.ok(ups.length >= 1 && ups.every((args) => args.includes(RUNS_REMOTE_REF)));
});

const ids = (dir, sha) => git(dir, 'ls-tree', '-r', '--name-only', sha).split('\n').filter(Boolean).sort();

test('buildCommit removes listed paths and keeps written ones', { skip }, async () => {
  const { a } = world();
  const r1 = await publish(a, { ...rec(PA, '11111111'), ...rec(PA, '22222222'), ...rec(PB, '33333333') });
  const b = await buildCommit(a, {
    parent: r1.sha, files: rec(PA, '22222222', ',"x":1'), remove: [`runs/${PA}/11111111.json`, `runs/${PA}/22222222.json`], message: 'm', identity: [], git: runGit,
  });
  assert.deepEqual([b.ok, b.unchanged, b.removed], [true, false, 1]);
  assert.deepEqual(ids(a, b.sha), ['README.md', `runs/${PA}/22222222.json`, `runs/${PB}/33333333.json`]);
  assert.equal(git(a, 'show', `${b.sha}:runs/${PA}/22222222.json`), '{"runId":"22222222","x":1}', 'a written path is never removed');
});

test('a commit that only removes paths is not unchanged', { skip }, async () => {
  const { a } = world();
  const r1 = await publish(a, { ...rec(PA, '11111111'), ...rec(PA, '22222222') });
  const b = await buildCommit(a, { parent: r1.sha, files: {}, remove: [`runs/${PA}/11111111.json`], message: 'm', identity: [], git: runGit });
  assert.deepEqual([b.ok, b.unchanged, b.removed], [true, false, 1]);
  assert.equal(git(a, 'rev-parse', `${b.sha}^`), r1.sha);
  assert.deepEqual(ids(a, b.sha), ['README.md', `runs/${PA}/22222222.json`]);
});

test('buildCommit ignores remove paths outside runs/', { skip }, async () => {
  const { a } = world();
  const r1 = await publish(a, { ...rec(PA, '11111111'), [`runs/${PA}/11111111.json.bak`]: 'x\n', [`runs/${PA}/notes.txt`]: 'y\n' });
  const seen = [];
  const counting = (cwd, args, o) => { seen.push(args); return runGit(cwd, args, o); };
  const b = await buildCommit(a, {
    parent: r1.sha, files: {}, remove: ['README.md', '-x', `runs/${PA}/11111111.json.bak`, `runs/${PA}/notes.txt`, `runs/${PA}/../README.md`], message: 'm', identity: [], git: counting,
  });
  assert.deepEqual([b.ok, b.unchanged, b.removed], [true, true, 0]);
  assert.equal(seen.some((args) => args.includes('--force-remove')), false);
});

test('a root commit ignores remove', { skip }, async () => {
  const { a } = world();
  const b = await buildCommit(a, { parent: null, files: rec(PA, '11111111'), remove: [`runs/${PB}/33333333.json`, `runs/${PA}/11111111.json`], message: 'm', identity: [], git: runGit });
  assert.deepEqual([b.ok, b.unchanged, b.removed], [true, false, 0]);
  assert.deepEqual(ids(a, b.sha), ['README.md', `runs/${PA}/11111111.json`]);
});

test('a throwing prune still publishes without removals', { skip }, async () => {
  const { bare, a } = world();
  await publish(a, rec(PA, '11111111'));
  const seen = [];
  const r = await publish(a, rec(PA, '22222222'), { prune: async (parent) => { seen.push(parent); throw new Error('boom'); } });
  assert.deepEqual([r.ok, r.pushed, r.removed], [true, true, 0], JSON.stringify(r));
  assert.equal(seen.length, 1);
  assert.deepEqual(branchFiles(bare, RUNS_BRANCH), ['README.md', `runs/${PA}/11111111.json`, `runs/${PA}/22222222.json`]);
  const r3 = await publish(a, rec(PA, '33333333'), { prune: async () => ({ ok: false, stderr: 'x' }) });
  assert.deepEqual([r3.ok, r3.removed], [true, 0]);
  const r4 = await publish(a, rec(PA, '44444444'), { prune: async () => ({ ok: true, paths: [`runs/${PA}/11111111.json`] }), message: (k) => `worca-runs: 1 run(s)${k ? `, ${k} expired` : ''}` });
  assert.deepEqual([r4.ok, r4.removed], [true, 1]);
  assert.equal(git(bare, 'log', '-1', '--format=%s', RUNS_BRANCH), 'worca-runs: 1 run(s), 1 expired');
  assert.equal(branchFiles(bare, RUNS_BRANCH).includes(`runs/${PA}/11111111.json`), false);
});

test('the compaction hint names worca-runs and force pushes', () => {
  assert.equal(RUNS_SHARE_COMPACT_HINT, 'allow `worca-runs` to be force-pushed by Worca (exempt it from branch protection): it squashes the branch to one commit');
});

test('buildCommit counts only removed paths the parent held', { skip }, async () => {
  const { a } = world();
  const r1 = await publish(a, { ...rec(PA, '11111111'), ...rec(PA, '22222222') });
  const b = await buildCommit(a, { parent: r1.sha, files: {}, remove: [`runs/${PA}/11111111.json`, `runs/${PB}/99999999.json`], message: 'm', identity: [], git: runGit });
  assert.deepEqual([b.ok, b.unchanged, b.removed], [true, false, 1]);
  const none = await buildCommit(a, { parent: r1.sha, files: {}, remove: [`runs/${PB}/99999999.json`], message: 'm', identity: [], git: runGit });
  assert.deepEqual([none.ok, none.unchanged, none.removed], [true, true, 0]);
});
