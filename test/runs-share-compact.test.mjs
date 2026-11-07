// test/runs-share-compact.test.mjs — squashing `worca-runs` to one root commit (run sharing s3, D9–D13): past the
// commit limit the publisher pushes a parentless commit of the tip's tree with an explicit-sha force-with-lease; a
// teammate's push meanwhile makes git refuse it. Local bare origins only.
import { test, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, chmodSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { git, makeOrigin, cloneAs, branchFiles, useGitSandbox } from './helpers/metrics-git.mjs';
import { shareHarness, gitCounter } from './helpers/runs-share.mjs';
import { addProject } from '../src/core/projects.mjs';
import { projectKey } from '../src/core/store.mjs';
import { writeProjectSettings } from '../src/core/settings-cascade.mjs';
import { readRunsSharePrefs } from '../src/core/config.mjs';
import { runGit } from '../src/core/metrics/sync.mjs';
import { publishFiles, RUNS_BRANCH, RUNS_REMOTE_REF, RUNS_SHARE_COMPACT_HINT } from '../src/core/runs-share/branch.mjs';
import { compactIfNeeded, commitCount, COMPACT_COMMIT_LIMIT, COMPACT_RETRY_MS } from '../src/core/runs-share/compact.mjs';
import { attachRunShare, SHARE_WINDOW_MS, _testing } from '../src/core/runs-share/publish.mjs';

useGitSandbox(before, after);
useTempHome(after);
const skip = process.platform === 'win32' ? 'sh hooks not portable to win32' : false;
const prevEnv = {};
let root;
before(() => {
  for (const k of ['WORCA_MOCK', 'ORCH_MOCK', 'WORCA_FLAGS']) { prevEnv[k] = process.env[k]; delete process.env[k]; }
  process.env.WORCA_FLAGS = 'runSharing';
  root = mkdtempSync(join(tmpdir(), 'worca-runs-compact-'));
});
after(() => {
  for (const [k, v] of Object.entries(prevEnv)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  rmSync(root, { recursive: true, force: true });
});
afterEach(() => _testing.reset());

const PA = 'aaaaaaaaaaaaaaaa';
const PB = 'bbbbbbbbbbbbbbbb';
const file = (person, id) => ({ [`runs/${person}/${id}.json`]: `{"runId":"${id}"}\n` });
const noSleep = async () => {};
let n = 0;
let runSeq = 0xd0000000;
const nextRun = () => (runSeq++).toString(16);

function fakeClock(start = 1_000_000) {
  let t = start;
  const timers = new Set();
  return {
    now: () => t,
    setTimer: (fn, ms) => { const x = { at: t + Math.max(0, ms), fn }; timers.add(x); return x; },
    clearTimer: (x) => { timers.delete(x); },
    advance(ms) {
      const end = t + ms;
      for (;;) {
        const due = [...timers].filter((x) => x.at <= end).sort((a, b) => a.at - b.at)[0];
        if (!due) break;
        t = due.at; timers.delete(due); due.fn();
      }
      t = end;
    },
  };
}

/** A bare origin and two plain clones (plumbing-level rows). */
function pair() {
  n += 1;
  const bare = makeOrigin(root, `shop${n}`);
  const a = cloneAs(root, `a${n}`, bare, 'shop');
  return { bare, a, b: () => cloneAs(root, `b${n}`, bare, 'shop') };
}
const put = async (dir, files) => {
  const r = await publishFiles(dir, { files, message: 'worca-runs: 1 run(s)', sleep: noSleep });
  assert.equal(r.ok, true, JSON.stringify(r));
  return r;
};
const originTip = (bare) => git(bare, 'rev-parse', `refs/heads/${RUNS_BRANCH}`);
const originCount = (bare) => Number(git(bare, 'rev-list', '--count', RUNS_BRANCH));
const localRef = (dir) => git(dir, 'rev-parse', RUNS_REMOTE_REF);

/** A registered project with the switch on (publisher-level rows). */
async function world() {
  n += 1;
  const bare = makeOrigin(root, `shop${n}`);
  const dir = cloneAs(root, `m${n}`, bare, `shop${n}`);
  await addProject({ name: `shop${n}`, path: dir });
  const key = projectKey(dir);
  writeProjectSettings({ projectDir: dir }, { 'runs.share': true });
  const clock = fakeClock();
  _testing.setClock(clock);
  const counter = gitCounter();
  _testing.setGit(counter);
  const run = () => shareHarness({ projectDir: dir, projectKey: key, runId: nextRun(), status: 'running' });
  const mate = () => cloneAs(root, `mate${n}`, bare, `shop${n}`);
  return { bare, dir, key, clock, counter, run, mate };
}
const settle = () => _testing.idle();
/** One finished run: one pushed commit. */
async function finish(w, deps) {
  const h = w.run();
  attachRunShare(h, deps);
  h.emitDone('done');
  await settle();
  return h;
}
const leasePushes = (counter) => counter.calls.filter((a) => a[0] === 'push' && a.some((x) => x.startsWith('--force-with-lease'))).length;
function captureWarn() {
  const lines = [];
  const prev = console.warn;
  console.warn = (...a) => { lines.push(a.join(' ')); };
  return { lines, restore: () => { console.warn = prev; } };
}
/** A pre-receive hook on the origin that refuses every non-fast-forward (a "block force pushes" rule). */
function refuseForcePushes(bare) {
  const hook = join(bare, 'hooks', 'pre-receive');
  mkdirSync(join(bare, 'hooks'), { recursive: true });
  writeFileSync(hook, [
    '#!/bin/sh',
    'zero=0000000000000000000000000000000000000000',
    'while read old new ref; do',
    '  if [ "$old" != "$zero" ] && ! git merge-base --is-ancestor "$old" "$new"; then',
    '    echo "protected branch hook declined: force push" >&2',
    '    exit 1',
    '  fi',
    'done',
    'exit 0',
    '',
  ].join('\n'));
  chmodSync(hook, 0o755);
}

test('under the limit makes no commit-tree and no push', { skip }, async () => {
  const { a } = pair();
  const r1 = await put(a, file(PA, '11111111'));
  await put(a, file(PA, '22222222'));
  assert.equal(COMPACT_COMMIT_LIMIT, 200);
  assert.equal(await commitCount(a, localRef(a), { git: runGit }), 2);
  const counter = gitCounter();
  const r = await compactIfNeeded(a, { tip: localRef(a), git: counter });
  assert.deepEqual(r, { ok: true, compacted: false, count: 2 });
  const atLimit = await compactIfNeeded(a, { tip: localRef(a), limit: 2, git: counter });
  assert.deepEqual([atLimit.compacted, atLimit.count], [false, 2], 'at the limit is not past it');
  assert.equal(counter.calls.filter((c) => c[0] === 'commit-tree' || c[0] === 'push').length, 0);
  assert.equal(await commitCount(a, 'f'.repeat(40), { git: runGit }), null);
  assert.ok(r1.sha);
});

test('past the limit the branch is one root commit holding every record', { skip }, async () => {
  const w = await world();
  _testing.setCompactLimit(3);
  const head = git(w.dir, 'rev-parse', 'HEAD');
  const runs = [];
  for (let i = 0; i < 3; i++) { runs.push(await finish(w)); w.clock.advance(SHARE_WINDOW_MS); }
  assert.equal(originCount(w.bare), 3, 'at the limit: not compacted');
  assert.equal(leasePushes(w.counter), 0);
  runs.push(await finish(w));
  assert.equal(originCount(w.bare), 1);
  assert.equal(git(w.bare, 'rev-list', '--parents', '-n1', RUNS_BRANCH).split(' ').length, 1, 'the tip has no parent');
  const files = branchFiles(w.bare, RUNS_BRANCH);
  assert.equal(files.length, 5);
  assert.ok(files.includes('README.md'));
  for (const h of runs) assert.ok(files.some((f) => f.endsWith(`/${h.pipeline.id}.json`)), h.pipeline.id);
  assert.match(git(w.bare, 'log', '-1', '--format=%s', RUNS_BRANCH), /^worca-runs: compacted 4 commits$/);
  assert.equal(localRef(w.dir), originTip(w.bare), 'the remote-tracking ref follows the root');
  assert.equal(git(w.dir, 'status', '--porcelain'), '');
  assert.equal(git(w.dir, 'rev-parse', 'HEAD'), head);
});

test('root tree equals the tip tree', { skip }, async () => {
  const { bare, a } = pair();
  await put(a, file(PA, '11111111'));
  await put(a, file(PA, '22222222'));
  const tip = localRef(a);
  const r = await compactIfNeeded(a, { tip, limit: 1 });
  assert.deepEqual([r.ok, r.compacted, r.from, r.count], [true, true, tip, 2], JSON.stringify(r));
  assert.equal(r.sha, originTip(bare));
  assert.equal(git(a, 'rev-parse', `${r.sha}^{tree}`), git(a, 'rev-parse', `${tip}^{tree}`));
  assert.equal(originCount(bare), 1);
});

test('a stale lease is refused and keeps the teammate\'s commit', { skip }, async () => {
  const { bare, a, b } = pair();
  await put(a, file(PA, '11111111'));
  await put(a, file(PA, '22222222'));
  const mate = b();
  let teammate = null;
  const r = await compactIfNeeded(a, { tip: localRef(a), limit: 1, hooks: { beforeCompactPush: async () => { teammate = await put(mate, file(PB, '33333333')); } } });
  assert.deepEqual([r.ok, r.code], [false, 'COMPACT_STALE'], JSON.stringify(r));
  assert.equal(originTip(bare), teammate.sha);
  assert.ok(branchFiles(bare, RUNS_BRANCH).includes(`runs/${PB}/33333333.json`));
  assert.equal(originCount(bare), 3);
});

test('after a stale lease the next publish compacts and keeps the teammate\'s record', { skip }, async () => {
  const w = await world();
  _testing.setCompactLimit(1);
  const mate = w.mate();
  let teammate = null;
  const hooks = { beforeCompactPush: async () => { if (!teammate) teammate = await put(mate, file(PB, '33333333')); } };
  await finish(w, { hooks });   // count 1: not past the limit
  assert.equal(teammate, null);
  w.clock.advance(SHARE_WINDOW_MS);
  const warn = captureWarn();
  try { await finish(w, { hooks }); } finally { warn.restore(); }
  assert.ok(teammate, 'the compaction was attempted');
  assert.equal(originTip(w.bare), teammate.sha, 'the teammate\'s commit stays');
  assert.ok(warn.lines.some((l) => l.startsWith('run sharing:') && l.includes('COMPACT_STALE')), warn.lines.join('\n'));
  const prefs = readRunsSharePrefs(w.key);
  assert.deepEqual([prefs.lastError, prefs.lastErrorCode], [null, null]);
  w.clock.advance(SHARE_WINDOW_MS);
  const last = await finish(w, { hooks });
  assert.equal(originCount(w.bare), 1);
  const files = branchFiles(w.bare, RUNS_BRANCH);
  assert.ok(files.includes(`runs/${PB}/33333333.json`), 'the teammate\'s record survives the compaction');
  assert.ok(files.some((f) => f.endsWith(`/${last.pipeline.id}.json`)));
});

test('a failed remote-tracking CAS still returns compacted: true', { skip }, async () => {
  const { bare, a } = pair();
  await put(a, file(PA, '11111111'));
  await put(a, file(PA, '22222222'));
  const tip = localRef(a);
  let casTried = 0;
  const failing = (cwd, args, o) => (args[0] === 'update-ref' && ++casTried
    ? Promise.resolve({ ok: false, code: 1, stdout: '', stderr: 'fatal: cannot lock ref' })
    : runGit(cwd, args, o));
  const r = await compactIfNeeded(a, { tip, limit: 1, git: failing });
  assert.deepEqual([r.ok, r.compacted], [true, true], JSON.stringify(r));
  assert.equal(originCount(bare), 1);
  assert.equal(casTried, 1, 'the CAS ran and failed');
});

test('a rejected force push returns COMPACT_REJECTED with the hint, leaves lastError null and is not retried for an hour', { skip }, async () => {
  const direct = pair();
  await put(direct.a, file(PA, '11111111'));
  await put(direct.a, file(PA, '22222222'));
  refuseForcePushes(direct.bare);
  const d = await compactIfNeeded(direct.a, { tip: localRef(direct.a), limit: 1 });
  assert.deepEqual([d.ok, d.code, d.hint], [false, 'COMPACT_REJECTED', RUNS_SHARE_COMPACT_HINT], JSON.stringify(d));
  assert.equal(originCount(direct.bare), 2);

  const w = await world();
  refuseForcePushes(w.bare);
  _testing.setCompactLimit(1);
  const warn = captureWarn();
  try {
    await finish(w);
    w.clock.advance(SHARE_WINDOW_MS);
    await finish(w);   // count 2: the compaction is refused
    assert.equal(leasePushes(w.counter), 1);
    assert.ok(warn.lines.some((l) => l.includes('COMPACT_REJECTED') && l.includes(RUNS_SHARE_COMPACT_HINT)), warn.lines.join('\n'));
    const prefs = readRunsSharePrefs(w.key);
    assert.deepEqual([prefs.lastError, prefs.lastErrorCode], [null, null]);
    w.clock.advance(SHARE_WINDOW_MS);
    await finish(w);   // within the hour: no second compaction push
    assert.equal(leasePushes(w.counter), 1);
    assert.equal(originCount(w.bare), 3, 'publishing goes on');
    w.clock.advance(COMPACT_RETRY_MS);
    await finish(w);   // past the hour: tried once more
    assert.equal(leasePushes(w.counter), 2);
    assert.equal(originCount(w.bare), 4);
  } finally { warn.restore(); }
});

test('both compaction warnings mask a credential in the remote URL', { skip }, async () => {
  const isLease = (args) => args[0] === 'push' && args.some((x) => x.startsWith('--force-with-lease'));
  const leak = "fatal: unable to access 'https://u:tok@h/r': denied";
  for (const [arm, override] of [
    ['COMPACT_REJECTED', () => Promise.resolve({ ok: false, code: 128, stdout: '', stderr: leak })],
    ['compaction failed', () => { throw new Error(leak); }],
  ]) {
    const w = await world();
    _testing.setCompactLimit(1);
    _testing.setGit((cwd, args, o) => (isLease(args) ? override() : runGit(cwd, args, o)));
    const warn = captureWarn();
    try {
      await finish(w);
      w.clock.advance(SHARE_WINDOW_MS);
      await finish(w);   // count 2: the compaction push fails
    } finally { warn.restore(); }
    const lines = warn.lines.filter((l) => l.startsWith('run sharing:') && l.includes(arm));
    assert.equal(lines.length, 1, `${arm}: ${warn.lines.join('\n')}`);
    for (const l of warn.lines) assert.equal(l.includes('tok'), false, l);
    const prefs = readRunsSharePrefs(w.key);
    assert.deepEqual([prefs.lastError, prefs.lastErrorCode], [null, null], arm);
  }
});

test('a clone with the old tip lands on the root', { skip }, async () => {
  const { bare, a, b } = pair();
  await put(a, file(PA, '11111111'));
  await put(a, file(PA, '22222222'));
  const old = b();   // cloned now: its remote-tracking ref is the pre-compaction tip
  const r = await compactIfNeeded(a, { tip: localRef(a), limit: 1 });
  assert.equal(r.compacted, true);
  const p = await publishFiles(old, { files: file(PB, '33333333'), message: 'worca-runs: 1 run(s)', sleep: noSleep });
  assert.deepEqual([p.ok, p.pushed, p.attempts], [true, true, 2], JSON.stringify(p));
  assert.equal(originCount(bare), 2);
  assert.equal(git(bare, 'rev-parse', `${RUNS_BRANCH}^`), r.sha);
  assert.deepEqual(branchFiles(bare, RUNS_BRANCH), ['README.md', `runs/${PA}/11111111.json`, `runs/${PA}/22222222.json`, `runs/${PB}/33333333.json`]);
});

test('the compaction push carries --force-with-lease=refs/heads/worca-runs:<tip> and never --force', { skip }, async () => {
  const { a } = pair();
  await put(a, file(PA, '11111111'));
  await put(a, file(PA, '22222222'));
  const tip = localRef(a);
  const counter = gitCounter();
  const r = await compactIfNeeded(a, { tip, limit: 1, git: counter });
  assert.equal(r.compacted, true);
  const pushArgs = counter.calls.filter((c) => c[0] === 'push');
  assert.equal(pushArgs.length, 1);
  assert.deepEqual(pushArgs[0], ['push', '--no-verify', `--force-with-lease=refs/heads/${RUNS_BRANCH}:${tip}`, 'origin', `${r.sha}:refs/heads/${RUNS_BRANCH}`]);
  for (const args of counter.calls) {
    assert.equal(args.some((x) => x === '--force' || x === '-f' || x === '--force-with-lease' || /^\+/.test(x)), false, args.join(' '));
  }
  const ct = counter.calls.find((c) => c.includes('commit-tree'));
  assert.equal(ct.includes('-p'), false, 'a parentless commit');
});
