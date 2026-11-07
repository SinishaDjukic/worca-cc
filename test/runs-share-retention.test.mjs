// test/runs-share-retention.test.mjs — keeping `worca-runs` small (run sharing s3): the 14-day expiry rule, the
// expired-path scan over a raw tree, and the publisher pruning old records inside its normal commit. Local bare origins.
import { test, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { git, makeOrigin, cloneAs, useGitSandbox } from './helpers/metrics-git.mjs';
import { shareHarness, gitCounter } from './helpers/runs-share.mjs';
import { addProject, listProjects } from '../src/core/projects.mjs';
import { projectKey } from '../src/core/store.mjs';
import { writeProjectSettings } from '../src/core/settings-cascade.mjs';
import { writeRunsSharePrefs, readRunsSharePrefs } from '../src/core/config.mjs';
import { persistPrState } from '../src/core/artifacts.mjs';
import { getDb } from '../src/core/db.mjs';
import { personKey } from '../src/core/metrics/record.mjs';
import { runGit } from '../src/core/metrics/sync.mjs';
import { serializeRecord, RECORD_MAX_BYTES } from '../src/core/runs-share/record.mjs';
import { publishFiles } from '../src/core/runs-share/branch.mjs';
import {
  recordExpired, expiredPaths, RETENTION_DAYS, RETENTION_MS, RETENTION_SCAN_MAX, _testing as retentionTesting,
} from '../src/core/runs-share/retention.mjs';
import { attachRunShare, flushProject, SHARE_WINDOW_MS, _testing } from '../src/core/runs-share/publish.mjs';

useGitSandbox(before, after);
useTempHome(after);
const skip = process.platform === 'win32' ? 'sh hooks not portable to win32' : false;
const prevEnv = {};
let root;
before(() => {
  for (const k of ['WORCA_MOCK', 'ORCH_MOCK', 'WORCA_FLAGS']) { prevEnv[k] = process.env[k]; delete process.env[k]; }
  process.env.WORCA_FLAGS = 'runSharing';
  root = mkdtempSync(join(tmpdir(), 'worca-runs-retention-'));
});
after(() => {
  for (const [k, v] of Object.entries(prevEnv)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  rmSync(root, { recursive: true, force: true });
});
afterEach(() => { _testing.reset(); retentionTesting.reset(); });

const DAY = 86_400_000;
const T = Date.parse('2026-11-07T10:00:00.000Z');
const iso = (ms) => new Date(ms).toISOString();
const MATE = personKey('mate@example.com');
let runSeq = 0xc0000000;
const nextRun = () => (runSeq++).toString(16);

/** A valid v1 record (every key of RECORD_KEYS), done at `finishedAt`. */
function rec({ personKey: pk = MATE, runId = nextRun(), ...rest } = {}) {
  return {
    v: 1, runId, personKey: pk, workflowId: 'wf_default', status: 'done', phase: 'done', stage: null, progress: null,
    costUsd: 1, startedBy: 'Mate Dev', startedAt: iso(T - 30 * DAY), updatedAt: iso(T - DAY), finishedAt: iso(T - DAY),
    prUrl: null, ...rest,
  };
}
const fileOf = (r) => `runs/${r.personKey}/${r.runId}.json`;

function gitIn(cwd, args, { env = {}, input } = {}) {
  const r = spawnSync('git', ['-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8', input, env: { ...process.env, ...env } });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
}

/** A local repo holding one commit of raw entries ({mode, path, text}); returns { dir, sha }. */
function rawTree(entries) {
  const dir = mkdtempSync(join(root, 'raw-'));
  gitIn(dir, ['init', '-q']);
  gitIn(dir, ['config', 'user.name', 'raw']); gitIn(dir, ['config', 'user.email', 'raw@t']);
  const env = { GIT_INDEX_FILE: join(mkdtempSync(join(root, 'idx-')), 'index') };
  gitIn(dir, ['read-tree', '--empty'], { env });
  for (const e of entries) {
    const blob = gitIn(dir, ['hash-object', '-w', '--stdin'], { input: e.text });
    gitIn(dir, ['update-index', '--add', '--cacheinfo', `${e.mode || '100644'},${blob},${e.path}`], { env });
  }
  const tree = gitIn(dir, ['write-tree'], { env });
  return { dir, sha: gitIn(dir, ['commit-tree', tree, '-m', 'raw']) };
}

test('recordExpired: done finished 15 days ago returns true, 13 days returns false', () => {
  assert.equal(RETENTION_DAYS, 14);
  assert.equal(RETENTION_MS, 14 * 86_400_000);
  assert.equal(recordExpired(rec({ finishedAt: iso(T - 15 * DAY) }), T), true);
  assert.equal(recordExpired(rec({ finishedAt: iso(T - 13 * DAY) }), T), false);
  // terminal: finishedAt decides, a fresh updatedAt (a PR link added later) does not keep it
  assert.equal(recordExpired(rec({ status: 'error', finishedAt: iso(T - 15 * DAY), updatedAt: iso(T) }), T), true);
  assert.equal(recordExpired(rec({ status: 'stopped', finishedAt: iso(T - 13 * DAY), updatedAt: iso(T - 20 * DAY) }), T), false);
});

test('recordExpired: a running record not updated for 15 days returns true; a paused one updated 13 days ago returns false', () => {
  assert.equal(recordExpired(rec({ status: 'running', finishedAt: null, updatedAt: iso(T - 15 * DAY) }), T), true);
  assert.equal(recordExpired(rec({ status: 'paused', finishedAt: null, updatedAt: iso(T - 13 * DAY) }), T), false);
  assert.equal(recordExpired(rec({ status: 'pausing', finishedAt: null, updatedAt: iso(T - 15 * DAY) }), T), true);
});

test('recordExpired: an unparsable timestamp returns false', () => {
  assert.equal(recordExpired(rec({ finishedAt: null }), T), false);
  assert.equal(recordExpired(rec({ finishedAt: 'yesterday' }), T), false);
  assert.equal(recordExpired(rec({ status: 'running', finishedAt: null, updatedAt: 'never' }), T), false);
});

test('expiredPaths lists only valid expired records; junk paths, bad JSON, mismatched paths, symlinks, README.md, a version+1 record finished 30 days ago and a blob over RECORD_MAX_BYTES are never listed', async () => {
  const old = iso(T - 30 * DAY);
  const expired = rec({ finishedAt: old });
  const live = rec({ finishedAt: iso(T - 13 * DAY) });
  const mismatch = rec({ finishedAt: old });
  const symlinked = rec({ finishedAt: old });
  const future = rec({ finishedAt: old });
  const big = rec({ finishedAt: old });
  const bigText = `${JSON.stringify(big)}${' '.repeat(RECORD_MAX_BYTES)}\n`;
  const { dir, sha } = rawTree([
    { path: 'README.md', text: serializeRecord(rec({ finishedAt: old })) },
    { path: fileOf(expired), text: serializeRecord(expired) },
    { path: fileOf(live), text: serializeRecord(live) },
    { path: `runs/${MATE}/junk.json`, text: serializeRecord(rec({ finishedAt: old })) },
    { path: `runs/${MATE}/notes/${nextRun()}.json`, text: serializeRecord(rec({ finishedAt: old })) },
    { path: `runs/${MATE}/${nextRun()}.json`, text: '{not json' },
    { path: `runs/${MATE}/${nextRun()}.json`, text: serializeRecord(mismatch) },
    { path: fileOf(symlinked), mode: '120000', text: serializeRecord(symlinked) },
    { path: fileOf(future), text: `${JSON.stringify({ ...future, v: 2 })}\n` },
    { path: fileOf(big), text: bigText },
  ]);
  const p = await expiredPaths(dir, sha, { now: T });
  assert.equal(p.ok, true, JSON.stringify(p));
  assert.deepEqual(p.paths, [fileOf(expired)]);
  assert.equal(p.deferred, 0);
});

test('expiredPaths reads each blob once (a second call makes 0 cat-file calls)', async () => {
  const a = rec({ finishedAt: iso(T - 20 * DAY) });
  const b = rec({ finishedAt: iso(T - 10 * DAY) });
  const { dir, sha } = rawTree([{ path: fileOf(a), text: serializeRecord(a) }, { path: fileOf(b), text: serializeRecord(b) }]);
  const first = gitCounter();
  const p1 = await expiredPaths(dir, sha, { now: T, git: first });
  assert.deepEqual([p1.paths, p1.scanned], [[fileOf(a)], 2]);
  assert.equal(first.calls.filter((c) => c[0] === 'cat-file').length, 2);
  const second = gitCounter();
  // the cache holds the timestamp, not the verdict: 5 days later b has expired too
  const p2 = await expiredPaths(dir, sha, { now: T + 5 * DAY, git: second });
  assert.deepEqual(p2.paths, [fileOf(a), fileOf(b)]);
  assert.equal(second.calls.filter((c) => c[0] === 'cat-file').length, 0);
});

test('expiredPaths defers blobs past scanMax and reports them in deferred', async () => {
  const recs = [0, 1, 2].map(() => rec({ finishedAt: iso(T - 20 * DAY) }));
  const { dir, sha } = rawTree(recs.map((r) => ({ path: fileOf(r), text: serializeRecord(r) })));
  assert.equal(RETENTION_SCAN_MAX, 2000);
  const counter = gitCounter();
  const p = await expiredPaths(dir, sha, { now: T, git: counter, scanMax: 1 });
  assert.deepEqual([p.ok, p.paths.length, p.scanned, p.deferred], [true, 1, 1, 2]);
  assert.equal(counter.calls.filter((c) => c[0] === 'cat-file').length, 1);
  const next = await expiredPaths(dir, sha, { now: T, scanMax: 1 });
  assert.deepEqual([next.paths.length, next.deferred], [2, 1], 'the next publish judges the next blob');
});

test('expiredPaths answers ok: false on a failed ls-tree', async () => {
  const { dir } = rawTree([]);
  const p = await expiredPaths(dir, 'f'.repeat(40), { now: T });
  assert.equal(p.ok, false);
  assert.ok(p.stderr);
});

function fakeClock(start) {
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

let n = 0;
/** My registered clone with the switch on, a teammate's clone, a fake clock at the real time and a counting git. */
async function world() {
  n += 1;
  const bare = makeOrigin(root, `shop${n}`);
  const dir = cloneAs(root, `me${n}`, bare, `shop${n}`);
  const mate = cloneAs(root, `mate${n}`, bare, `shop${n}`);
  git(mate, 'config', 'user.email', 'mate@example.com');
  await addProject({ name: `shop${n}`, path: dir });
  const key = projectKey(dir);
  writeProjectSettings({ projectDir: dir }, { 'runs.share': true });
  const clock = fakeClock(Date.now());
  _testing.setClock(clock);
  const counter = gitCounter();
  _testing.setGit(counter);
  const run = (status = 'running') => shareHarness({ projectDir: dir, projectKey: key, runId: nextRun(), status });
  return { bare, dir, mate, key, clock, counter, run };
}
/** The teammate publishes records with slice 1's plumbing; my clone fetches them. */
async function seed(w, recs, { fetch = true } = {}) {
  const r = await publishFiles(w.mate, { files: Object.fromEntries(recs.map((x) => [fileOf(x), serializeRecord(x)])), message: 'worca-runs: seed' });
  assert.equal(r.ok, true, JSON.stringify(r));
  if (fetch) git(w.dir, 'fetch', '-q', 'origin', '+refs/heads/worca-runs:refs/remotes/origin/worca-runs');
  return r;
}
const tipFiles = (bare) => git(bare, 'ls-tree', '-r', '--name-only', 'worca-runs').split('\n').filter(Boolean);
const myKey = (dir) => personKey(git(dir, 'config', 'user.email'));
const settle = () => _testing.idle();
const lookedUp = async () => { await listProjects(); await new Promise((r) => setImmediate(r)); };
const pushes = (counter) => counter.calls.filter((a) => a[0] === 'push').length;

test('a publish drops a record finished 15 days ago', { skip }, async () => {
  const w = await world();
  const now = w.clock.now();
  const old = rec({ finishedAt: iso(now - 15 * DAY) });
  const recent = rec({ finishedAt: iso(now - 13 * DAY) });
  await seed(w, [old, recent]);
  const h = w.run();
  attachRunShare(h);
  h.emitState({ totalCostUsd: 1 });
  const r = await flushProject(w.key);
  assert.deepEqual([r.ok, r.pushed, r.removed], [true, true, 1], JSON.stringify(r));
  const files = tipFiles(w.bare);
  assert.equal(files.includes(fileOf(old)), false, 'the 15-day record is gone');
  assert.equal(files.includes(fileOf(recent)), true, 'the 13-day record stays');
  assert.equal(files.includes(`runs/${myKey(w.dir)}/${h.pipeline.id}.json`), true, 'the new run is written');
  assert.equal(git(w.bare, 'log', '-1', '--format=%s', 'worca-runs'), 'worca-runs: 1 run(s), 1 expired');
});

test('a retry after a teammate\'s push prunes the fetched tip', { skip }, async () => {
  const w = await world();
  const now = w.clock.now();
  await seed(w, [rec({ finishedAt: iso(now - DAY) })]);
  const late = rec({ finishedAt: iso(now - 20 * DAY) });
  const h = w.run();
  attachRunShare(h, { hooks: { beforePush: async (attempt) => { if (attempt === 1) await seed(w, [late], { fetch: false }); } } });
  h.emitState({ totalCostUsd: 1 });
  const r = await flushProject(w.key);
  assert.deepEqual([r.ok, r.attempts, r.removed], [true, 2, 1], JSON.stringify(r));
  assert.equal(tipFiles(w.bare).includes(fileOf(late)), false, 'the record the teammate pushed meanwhile is pruned');
  assert.equal(tipFiles(w.bare).includes(`runs/${myKey(w.dir)}/${h.pipeline.id}.json`), true);
});

test('an own record finished 15 days ago is not published', { skip }, async () => {
  const w = await world();
  const h = w.run('done');
  const old = iso(w.clock.now() - 15 * DAY);
  getDb().prepare('UPDATE pipelines SET updated_at = ?, started_at = ? WHERE id = ?').run(old, old, h.pipeline.id);
  writeRunsSharePrefs(w.key, { shared: { [h.pipeline.id]: null } });   // this machine shared it back then
  persistPrState(h.pipeline.id, { url: 'https://github.com/o/r/pull/12', number: 12 });
  await lookedUp();
  w.clock.advance(SHARE_WINDOW_MS);
  await settle();
  assert.equal(pushes(w.counter), 0);
  assert.equal(readRunsSharePrefs(w.key).shared[h.pipeline.id], null, 'no shared update');
});

test('a failed ls-tree still publishes the record without removals', { skip }, async () => {
  const w = await world();
  const old = rec({ finishedAt: iso(w.clock.now() - 20 * DAY) });
  await seed(w, [old]);
  _testing.setGit((cwd, args, o) => (args[0] === 'ls-tree'
    ? Promise.resolve({ ok: false, code: 128, stdout: '', stderr: 'fatal: unable to access \'https://u:tok@h/r\': denied\n' })
    : runGit(cwd, args, o)));
  const h = w.run();
  attachRunShare(h);
  h.emitState({ totalCostUsd: 1 });
  const logged = [];
  const prevWarn = console.warn;
  console.warn = (...a) => { logged.push(a.join(' ')); };
  let r;
  try { r = await flushProject(w.key); } finally { console.warn = prevWarn; }
  assert.deepEqual([r.ok, r.pushed, r.removed], [true, true, 0], JSON.stringify(r));
  assert.equal(tipFiles(w.bare).includes(fileOf(old)), true);
  assert.equal(tipFiles(w.bare).includes(`runs/${myKey(w.dir)}/${h.pipeline.id}.json`), true);
  assert.ok(logged.some((l) => l.startsWith('run sharing: retention skipped: ')), logged.join('\n'));
  assert.equal(logged.some((l) => l.includes('tok')), false, 'the URL login is masked');
  assert.equal(readRunsSharePrefs(w.key).lastError, null);
});

test('the project worktree is unchanged after a pruning publish', { skip }, async () => {
  const w = await world();
  const head = git(w.dir, 'rev-parse', 'HEAD');
  await seed(w, [rec({ finishedAt: iso(w.clock.now() - 20 * DAY) })]);
  const h = w.run();
  attachRunShare(h);
  h.emitState({ totalCostUsd: 1 });
  const r = await flushProject(w.key);
  assert.deepEqual([r.ok, r.removed], [true, 1]);
  assert.equal(git(w.dir, 'status', '--porcelain'), '');
  assert.equal(git(w.dir, 'rev-parse', 'HEAD'), head);
});
