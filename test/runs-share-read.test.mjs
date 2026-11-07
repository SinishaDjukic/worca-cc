// test/runs-share-read.test.mjs — the run-sharing reader (run sharing s2): teammates' records on `worca-runs`, read
// without a checkout through a per-project fetch cache, every record validated, my own keys dropped. Local bare origins.
import { test, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, renameSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { git, makeOrigin, cloneAs, useGitSandbox } from './helpers/metrics-git.mjs';
import { addProject } from '../src/core/projects.mjs';
import { projectKey } from '../src/core/store.mjs';
import { writeRunsSharePrefs, writeTeamMetricsPrefs } from '../src/core/config.mjs';
import { personKey } from '../src/core/metrics/record.mjs';
import { runGit, fetchTeamBranch } from '../src/core/metrics/sync.mjs';
import { serializeRecord } from '../src/core/runs-share/record.mjs';
import { publishFiles } from '../src/core/runs-share/branch.mjs';
import { compactIfNeeded } from '../src/core/runs-share/compact.mjs';
import {
  listTeamRuns, readProjectTeamRuns, parseTreeListing, myPersonKeys, teamRunRow,
  TEAM_RUNS_FETCH_TTL_MS, TEAM_RUNS_FAIL_TTL_MS, TEAM_RUN_STALE_MS, MAX_TEAM_RECORDS, _testing,
} from '../src/core/runs-share/read.mjs';

useGitSandbox(before, after);
useTempHome(after);
const prevEnv = {};
let root;
before(() => {
  for (const k of ['WORCA_MOCK', 'ORCH_MOCK', 'WORCA_FLAGS']) { prevEnv[k] = process.env[k]; delete process.env[k]; }
  process.env.WORCA_FLAGS = 'runSharing';
  root = mkdtempSync(join(tmpdir(), 'worca-runs-read-'));
});
after(() => {
  for (const [k, v] of Object.entries(prevEnv)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  rmSync(root, { recursive: true, force: true });
});
afterEach(() => _testing.reset());

const MATE = personKey('mate@example.com');
const ME = personKey('me@example.com');
let n = 0;
let runSeq = 0xb0000000;
const nextRun = () => (runSeq++).toString(16);
const T0 = Date.parse('2026-11-07T10:00:00.000Z');

/** A valid v1 record (every key of RECORD_KEYS). */
function rec({ personKey: pk = MATE, runId = nextRun(), ...rest } = {}) {
  return {
    v: 1, runId, personKey: pk, workflowId: 'wf_default', status: 'done', phase: 'done', stage: null, progress: null,
    costUsd: 1.23, startedBy: 'Mate Dev', startedAt: '2026-11-07T09:00:00.000Z', updatedAt: '2026-11-07T09:30:00.000Z',
    finishedAt: '2026-11-07T09:30:00.000Z', prUrl: 'https://github.com/o/r/pull/7', ...rest,
  };
}
const fileOf = (r) => `runs/${r.personKey}/${r.runId}.json`;

/** The teammate publishes records with slice 1's plumbing. */
async function publish(mate, recs) {
  const files = Object.fromEntries(recs.map((r) => [fileOf(r), serializeRecord(r)]));
  const r = await publishFiles(mate, { files, message: 'worca-runs: seed' });
  assert.equal(r.ok, true, JSON.stringify(r));
}

function gitIn(cwd, args, { env = {}, input } = {}) {
  const r = spawnSync('git', ['-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8', input, env: { ...process.env, ...env } });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
}

/** Raw entries ({mode, path, text}) committed onto the branch tip (or a root commit with `orphan`), pushed from `mate`. */
function pushRaw(mate, entries, { orphan = false } = {}) {
  spawnSync('git', ['fetch', '-q', 'origin', '+refs/heads/worca-runs:refs/remotes/origin/worca-runs'], { cwd: mate });
  let parent = null;
  if (!orphan) { try { parent = gitIn(mate, ['rev-parse', '--verify', '-q', 'refs/remotes/origin/worca-runs']); } catch { parent = null; } }
  const idx = join(mkdtempSync(join(root, 'idx-')), 'index');
  const env = { GIT_INDEX_FILE: idx };
  gitIn(mate, parent ? ['read-tree', parent] : ['read-tree', '--empty'], { env });
  for (const e of entries) {
    const blob = gitIn(mate, ['hash-object', '-w', '--stdin'], { input: e.text });
    gitIn(mate, ['update-index', '--add', '--cacheinfo', `${e.mode || '100644'},${blob},${e.path}`], { env });
  }
  const tree = gitIn(mate, ['write-tree'], { env });
  const sha = gitIn(mate, ['commit-tree', tree, ...(parent ? ['-p', parent] : []), '-m', 'raw'], { env });
  gitIn(mate, ['push', '-q', '--force', 'origin', `${sha}:refs/heads/worca-runs`]);
  return sha;
}

/** A bare origin, a teammate clone and my registered clone; a fake clock and a counting fetch seam. */
async function world({ origin = true } = {}) {
  n += 1;
  const bare = makeOrigin(root, `shop${n}`);
  const mate = cloneAs(root, `mate${n}`, bare, `shop${n}`);
  git(mate, 'config', 'user.email', 'mate@example.com');
  const me = cloneAs(root, `me${n}`, bare, `shop${n}`);
  git(me, 'config', 'user.email', 'me@example.com');
  if (!origin) git(me, 'remote', 'remove', 'origin');
  await addProject({ name: `shop${n}`, path: me });
  const key = projectKey(me);
  let t = T0;
  const clock = { now: () => t, advance: (ms) => { t += ms; } };
  _testing.setClock(() => t);
  const fetches = [];
  _testing.setFetch((dir, branch, opts) => { fetches.push({ dir, branch, opts }); return fetchTeamBranch(dir, branch, opts); });
  const project = { key, name: `shop${n}`, path: me };
  const read = () => readProjectTeamRuns(project);
  return { bare, mate, me, key, clock, fetches, project, read };
}

test('lists a teammate\'s runs with local: false', async () => {
  const w = await world();
  const a = rec(); const b = rec({ startedBy: 'Other Mate' });
  await publish(w.mate, [a, b]);
  const out = await listTeamRuns({ projectKey: w.key });
  assert.equal(out.rows.length, 2);
  assert.ok(out.rows.every((r) => r.local === false));
  assert.deepEqual(out.rows.map((r) => r.startedBy).sort(), ['Mate Dev', 'Other Mate']);
  assert.deepEqual(Object.keys(out.rows[0]).sort(), ['costUsd', 'finishedAt', 'local', 'personKey', 'phase', 'prUrl', 'progress',
    'projectKey', 'projectName', 'runId', 'stage', 'stale', 'startedAt', 'startedBy', 'status', 'updatedAt', 'workflowId'].sort());
  assert.equal(out.rows[0].projectKey, w.key);
  assert.equal(out.projects.find((p) => p.key === w.key).state, 'ok');
});

test('never returns my own person key', async () => {
  const w = await world();
  const machine = 'abcdef0123456789';
  writeRunsSharePrefs(w.key, { machineKey: machine });
  const keys = await myPersonKeys(w.key, w.me, { git: runGit });
  assert.deepEqual([...keys].sort(), [ME, machine].sort());
  const mate = rec();
  await publish(w.mate, [mate, rec({ personKey: ME }), rec({ personKey: machine })]);
  const r = await w.read();
  assert.deepEqual(r.rows.map((x) => x.runId), [mate.runId]);
  assert.equal(r.rows.filter((x) => x.personKey === ME || x.personKey === machine).length, 0);
});

test('my git-user records stay dropped after attribution switches to none', async () => {
  const w = await world();
  writeTeamMetricsPrefs(w.key, { config: { attribution: 'git-user' } });
  const mate = rec();
  await publish(w.mate, [mate, rec({ personKey: ME })]);
  writeTeamMetricsPrefs(w.key, { config: { attribution: 'none' } });
  assert.ok((await myPersonKeys(w.key, w.me, { git: runGit })).has(ME));
  const r = await w.read();
  assert.deepEqual(r.rows.map((x) => x.runId), [mate.runId]);
});

test('a machineKey stored after a cached read is dropped at once', async () => {
  const w = await world();
  const other = 'fedcba9876543210';
  await publish(w.mate, [rec(), rec({ personKey: other })]);
  assert.equal((await w.read()).rows.length, 2);
  writeRunsSharePrefs(w.key, { machineKey: other });
  w.clock.advance(1_000);
  const r = await w.read();
  assert.equal(w.fetches.length, 1, 'answered from the cache');
  assert.equal(r.rows.length, 1);
  assert.equal(r.rows.some((x) => x.personKey === other), false);
});

test('two calls within 60 s make one fetch', async () => {
  const w = await world();
  await publish(w.mate, [rec()]);
  assert.equal(TEAM_RUNS_FETCH_TTL_MS, 60_000);
  assert.equal(TEAM_RUNS_FAIL_TTL_MS, 15_000);
  await w.read();
  w.clock.advance(59_000);
  await w.read();
  assert.equal(w.fetches.length, 1);
  w.clock.advance(2_000);
  await w.read();
  assert.equal(w.fetches.length, 2);
  assert.deepEqual(w.fetches[0].opts, { timeoutMs: 30_000 });
  assert.equal(w.fetches[0].branch, 'worca-runs');
});

test('concurrent calls join one fetch', async () => {
  const w = await world();
  await publish(w.mate, [rec()]);
  const all = await Promise.all([1, 2, 3, 4, 5].map(() => w.read()));
  assert.equal(w.fetches.length, 1);
  assert.ok(all.every((r) => r.rows.length === 1));
});

test('drops bad records; good rows in the same tree still list', async () => {
  const w = await world();
  const good = rec();
  await publish(w.mate, [good]);
  const extra = rec(); const http = rec({ prUrl: 'http://github.com/o/r/pull/1' });
  const big = rec(); const bigText = `${serializeRecord(big).trimEnd()}${' '.repeat(2100)}\n`;
  const link = rec(); const moved = rec();
  pushRaw(w.mate, [
    { path: fileOf(extra), text: JSON.stringify({ ...extra, prompt: '<img src=x onerror=alert(1)>' }) },
    { path: fileOf(http), text: JSON.stringify(http) },
    { path: fileOf(big), text: bigText },
    { path: fileOf(link), text: serializeRecord(link), mode: '120000' },
    { path: `runs/aaaaaaaaaaaaaaaa/${moved.runId}.json`, text: serializeRecord(moved) },
    { path: `runs/${MATE}/0000beef.json`, text: serializeRecord(rec()) },
    { path: `runs/${MATE}/deadbeef.json`, text: '{not json' },
  ]);
  const calls = [];
  _testing.setGit((cwd, args, opts) => { calls.push(args); return runGit(cwd, args, opts); });
  const r = await w.read();
  assert.deepEqual(r.rows.map((x) => x.runId), [good.runId]);
  assert.equal(r.state, 'ok');
  const bigSha = git(w.bare, 'rev-parse', `worca-runs:${fileOf(big)}`);
  assert.equal(calls.some((a) => a[0] === 'cat-file' && a.includes(bigSha)), false, 'the over-size blob is never read');
});

test('drops unparsable JSON; other rows listed', async () => {
  const w = await world();
  const good = rec();
  await publish(w.mate, [good]);
  pushRaw(w.mate, [{ path: `runs/${MATE}/0badbad0.json`, text: '{"v":1,' }]);
  const r = await w.read();
  assert.deepEqual(r.rows.map((x) => x.runId), [good.runId]);
});

test('no branch on origin is state no-branch with 0 rows', async () => {
  const w = await world();
  const r = await w.read();
  assert.equal(r.state, 'no-branch');
  assert.deepEqual(r.rows, []);
  await publish(w.mate, [rec()]);
  w.clock.advance(30_000);
  assert.equal((await w.read()).rows.length, 0, 'cached for the success TTL');
  w.clock.advance(31_000);
  const later = await w.read();
  assert.equal(later.state, 'ok');
  assert.equal(later.rows.length, 1);
});

test('a project without origin is never fetched', async () => {
  const w = await world({ origin: false });
  const r = await w.read();
  assert.equal(r.state, 'no-origin');
  assert.equal(w.fetches.length, 0);
  const listed = await listTeamRuns({ projectKey: w.key });
  assert.equal(listed.projects.find((p) => p.key === w.key).state, 'no-origin');
  assert.equal(w.fetches.length, 0);
});

test('a failed fetch keeps the last good rows', async () => {
  const w = await world();
  await publish(w.mate, [rec()]);
  const first = await w.read();
  renameSync(w.bare, `${w.bare}.gone`);
  w.clock.advance(61_000);
  const r = await w.read();
  assert.equal(r.state, 'fetch-failed');
  assert.deepEqual(r.rows, first.rows);
  assert.ok(r.error);
  w.clock.advance(10_000);
  await w.read();
  assert.equal(w.fetches.length, 2, '+10 s: within the failure TTL');
  w.clock.advance(6_000);
  _testing.setFetch(async (dir, branch, opts) => {
    w.fetches.push({ dir, branch, opts });
    return { ok: false, code: 128, stdout: '', stderr: "fatal: unable to access 'https://user:token@git.example.com/o/r.git/': Could not resolve host" };
  });
  const again = await w.read();
  assert.equal(w.fetches.length, 3, '+16 s: a new fetch');
  assert.equal(again.state, 'fetch-failed');
  assert.deepEqual(again.rows, first.rows);
  assert.equal(again.error.includes('user:token'), false, again.error);
  assert.equal(again.error.includes('token@'), false, again.error);
});

test('a failed ls-tree is read-failed with fixed text', async () => {
  const w = await world();
  await publish(w.mate, [rec()]);
  const first = await w.read();
  await publish(w.mate, [rec()]);   // a new tip, so the next read lists the tree again
  for (const fail of [
    { ok: false, code: 128, stdout: '', stderr: 'fatal: not a tree object at /Users/x/repo via https://user:token@h/r' },
    { ok: false, code: -1, stdout: '', stderr: 'ENOBUFS: stdout maxBuffer length exceeded' },
  ]) {
    _testing.setGit((cwd, args, opts) => (args[0] === 'ls-tree' ? Promise.resolve(fail) : runGit(cwd, args, opts)));
    w.clock.advance(61_000);
    const r = await w.read();
    assert.equal(r.state, 'read-failed');
    assert.equal(r.error, 'Could not read the worca-runs branch.');
    assert.deepEqual(r.rows, first.rows);
  }
});

test('lists rows with Share my runs off', async () => {
  const w = await world();   // runs.share is never set: the default is off
  await publish(w.mate, [rec()]);
  const out = await listTeamRuns({ projectKey: w.key });
  assert.equal(out.rows.length, 1);
});

test('an unchanged tip reads no blobs', async () => {
  const w = await world();
  await publish(w.mate, [rec(), rec()]);
  await w.read();
  const calls = [];
  _testing.setGit((cwd, args, opts) => { calls.push(args); return runGit(cwd, args, opts); });
  w.clock.advance(61_000);
  const r = await w.read();
  assert.equal(w.fetches.length, 2);
  assert.equal(r.rows.length, 2);
  assert.equal(calls.filter((a) => a[0] === 'cat-file').length, 0);
  assert.equal(calls.filter((a) => a[0] === 'ls-tree').length, 0);
});

test('a rewritten branch is listed', async () => {
  const w = await world();
  await publish(w.mate, [rec(), rec()]);
  assert.equal((await w.read()).rows.length, 2);
  const only = rec();
  pushRaw(w.mate, [{ path: fileOf(only), text: serializeRecord(only) }], { orphan: true });
  w.clock.advance(61_000);
  const r = await w.read();
  assert.deepEqual(r.rows.map((x) => x.runId), [only.runId]);
});

test('stale is true for a running record not updated for 21 minutes', () => {
  const p = { key: 'k', name: 'n' };
  const at = T0;
  const running = rec({ status: 'running', finishedAt: null, updatedAt: new Date(at).toISOString() });
  assert.equal(TEAM_RUN_STALE_MS, 20 * 60_000);
  assert.equal(teamRunRow(running, p, at + 21 * 60_000).stale, true);
  assert.equal(teamRunRow(running, p, at + 19 * 60_000).stale, false);
  assert.equal(teamRunRow({ ...running, status: 'pausing' }, p, at + 21 * 60_000).stale, true);
  assert.equal(teamRunRow(rec({ updatedAt: new Date(at).toISOString() }), p, at + 21 * 60_000).stale, false, 'done is never stale');
  assert.equal('v' in teamRunRow(running, p, at), false);
});

test('caps at 500 records', async () => {
  assert.equal(MAX_TEAM_RECORDS, 500);
  const w = await world();
  await publish(w.mate, [rec(), rec(), rec(), rec(), rec()]);
  _testing.setMax(3);
  const r = await w.read();
  assert.equal(r.rows.length, 3);
  assert.equal(r.truncated, true);
});

test('junk paths do not count to the cap', async () => {
  const w = await world();
  const a = rec(); const b = rec();
  await publish(w.mate, [a, b]);
  pushRaw(w.mate, ['0', '1', '2', '3'].map((d) => ({ path: `runs/0${d}/x.json`, text: '{}' })));
  _testing.setMax(3);
  const r = await w.read();
  assert.deepEqual(r.rows.map((x) => x.runId).sort(), [a.runId, b.runId].sort());
  assert.equal(r.truncated, false);
});

test('a read leaves the worktree untouched', async () => {
  const w = await world();
  await publish(w.mate, [rec()]);
  const head = git(w.me, 'rev-parse', 'HEAD');
  await w.read();
  assert.equal(git(w.me, 'status', '--porcelain'), '');
  assert.equal(git(w.me, 'rev-parse', 'HEAD'), head);
  assert.equal(existsSync(join(w.me, '.git', 'FETCH_HEAD')), false);
});

test('parseTreeListing reads -z -l output', () => {
  const sha = 'a'.repeat(40);
  const out = `100644 blob ${sha}     123\truns/x.json\u0000160000 commit ${sha}       -\truns/sub\u0000`;
  assert.deepEqual(parseTreeListing(out)[0], { mode: '100644', type: 'blob', sha, size: 123, path: 'runs/x.json' });
  assert.ok(Number.isNaN(parseTreeListing(out)[1].size));
  assert.deepEqual(parseTreeListing(''), []);
});

// ---- route --------------------------------------------------------------------
let srv, base;
async function server() {
  if (!srv) {
    const { app } = await import('../ui/server.mjs');   // imported ⇒ no port bind
    srv = http.createServer(app);
    await new Promise((r) => srv.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${srv.address().port}`;
  }
  return base;
}
after(async () => { if (srv) await new Promise((r) => srv.close(r)); });
const get = async (path) => { const r = await fetch(`${await server()}${path}`, { headers: { Connection: 'close' } }); return { status: r.status, body: await r.json() }; };

test('GET /api/team-runs returns the teammate\'s rows', async () => {
  const w = await world();
  await publish(w.mate, [rec(), rec({ personKey: ME })]);
  const r = await get(`/api/team-runs?project=${w.key}`);
  assert.equal(r.status, 200);
  assert.equal(r.body.rows.length, 1);
  assert.ok(r.body.rows.every((x) => x.local === false && x.personKey !== ME));
  assert.equal(r.body.projects.length, 1);
  await get(`/api/team-runs?project=${w.key}`);
  assert.equal(w.fetches.length, 1, 'two GETs within 60 s make one fetch');
});

test('GET /api/team-runs answers 404 with the flag off', async () => {
  const w = await world();
  process.env.WORCA_FLAGS = '-runSharing';
  try {
    const r = await get('/api/team-runs');
    assert.equal(r.status, 404);
    assert.deepEqual(r.body, { error: 'not found' });
    assert.equal(w.fetches.length, 0);
  } finally { process.env.WORCA_FLAGS = 'runSharing'; }
});

test('GET /api/team-runs: ?project=bad answers 400, unknown project 404', async () => {
  await world();
  const bad = await get('/api/team-runs?project=..%2Fx');
  assert.equal(bad.status, 400);
  assert.equal(bad.body.error, 'invalid project key');
  const unknown = await get('/api/team-runs?project=nope-0000ffff');
  assert.equal(unknown.status, 404);
  assert.equal(unknown.body.code, 'NOT_FOUND');
});

test('GET /api/team-runs: an unexpected throw answers a fixed 500', async () => {
  await world();
  _testing.setProjects(async () => { throw new Error('boom at /Users/x/repo'); });
  const prevErr = console.error; const prevWarn = console.warn;
  console.error = () => {}; console.warn = () => {};
  try {
    const r = await get('/api/team-runs');
    assert.equal(r.status, 500);
    assert.deepEqual(r.body, { error: 'could not list team runs' });
  } finally { console.error = prevErr; console.warn = prevWarn; }
});

test('a compacted branch still lists every row', async () => {
  const w = await world();
  const recs = [rec(), rec(), rec(), rec()];
  for (const r of recs) await publish(w.mate, [r]);
  const before = await w.read();
  assert.equal(before.state, 'ok');
  const ids = before.rows.map((r) => r.runId).sort();
  assert.deepEqual(ids, recs.map((r) => r.runId).sort());
  const tip = git(w.mate, 'rev-parse', 'refs/remotes/origin/worca-runs');
  const c = await compactIfNeeded(w.mate, { tip, limit: 1 });
  assert.equal(c.compacted, true, JSON.stringify(c));
  w.clock.advance(61_000);
  const after = await w.read();
  assert.equal(after.state, 'ok');
  assert.deepEqual(after.rows.map((r) => r.runId).sort(), ids);
  assert.equal(git(w.me, 'rev-parse', 'refs/remotes/origin/worca-runs'), c.sha, 'the + refspec follows the rewrite');
});
