// test/sync-api.test.mjs — the sync routes, the settings key and the run-start pre-check (#527,
// plan §5.2-§5.4) against a real bare origin. HOME/USERPROFILE are sandboxed BEFORE the server
// import so "sync on by default" is the built-in default, never the developer's settings.json.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { appServer } from './helpers/app-server.mjs';
import { mkdtemp, rm, writeFile, stat } from 'node:fs/promises';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { useTempHome } from './helpers/temp-home.mjs';
import { templateWorld } from './helpers/git-dir.mjs';

const home = useTempHome(after, 'worca-cc-sync-api-');
const saved = {};
for (const k of ['HOME', 'USERPROFILE', 'GIT_CONFIG_GLOBAL', 'GIT_CONFIG_NOSYSTEM']) saved[k] = process.env[k];
process.env.HOME = home; process.env.USERPROFILE = home;

let srv, base, root, app, runSyncOpts, addProject, createWorkspace, gitSync, projectKey, writeSyncPrefs;
before(async () => {
  root = await mkdtemp(join(tmpdir(), 'sync-api-'));
  process.env.GIT_CONFIG_GLOBAL = join(root, 'gitconfig'); process.env.GIT_CONFIG_NOSYSTEM = '1';
  await writeFile(process.env.GIT_CONFIG_GLOBAL, '[user]\n\tname = t\n\temail = t@t\n[commit]\n\tgpgsign = false\n[init]\n\tdefaultBranch = dev\n');
  ({ app, runSyncOpts } = await import('../ui/server.mjs'));
  ({ addProject } = await import('../src/core/projects.mjs'));
  ({ createWorkspace } = await import('../src/core/workspaces.mjs'));
  ({ _testing: gitSync } = await import('../src/core/git-sync.mjs'));
  ({ projectKey } = await import('../src/core/store.mjs'));
  ({ writeSyncPrefs } = await import('../src/core/config.mjs'));
  srv = appServer(app);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
});
after(async () => {
  if (srv) await new Promise((r) => srv.close(r));
  gitSync.reset();
  for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  // A stopped mock run may still be writing into a clone's .git: retry ENOTEMPTY.
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  await Promise.all(worlds.map((d) => rm(d, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })));
});
beforeEach(() => gitSync.reset());

const g = (cwd, ...args) => {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
};
let n = 0;
/** bare origin + clone A (the registered project) + clone B (a teammate who pushes), under one root. */
function buildWorld(dir) {
  g(dir, 'init', '-q', '--bare', 'origin.git');
  g(dir, 'clone', '-q', join(dir, 'origin.git'), 'a');
  const a = join(dir, 'a');
  writeFileSync(join(a, 'f.txt'), 'one\n');
  g(a, 'add', '-A'); g(a, 'commit', '-qm', 'init'); g(a, 'push', '-q', 'origin', 'dev');
  g(dir, 'clone', '-q', join(dir, 'origin.git'), 'b');
}
const worlds = [];
async function world({ register = true } = {}) {
  n += 1;
  const dir = templateWorld('sync-api', buildWorld, 'sync-api');
  worlds.push(dir);
  const a = join(dir, 'a'), b = join(dir, 'b');
  const push = async (file, msg, branch = 'dev') => {
    g(b, 'fetch', '-q', 'origin');
    g(b, 'checkout', '-q', '-B', branch, 'origin/dev');      // every branch starts from the latest dev
    await writeFile(join(b, file), `${msg}\n`); g(b, 'add', '-A'); g(b, 'commit', '-qm', msg);
    g(b, 'push', '-q', 'origin', branch);
  };
  const localCommit = async (file, msg) => {
    await writeFile(join(a, file), `${msg}\n`); g(a, 'add', '-A'); g(a, 'commit', '-qm', msg);
  };
  const name = `p${n}`;
  if (register) await addProject({ name, path: a });
  return { a, b, push, localCommit, name, key: projectKey(a) };
}
const J = (method, url, body) => fetch(`${base}${url}`, {
  method, headers: { 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});
const fetchHeadMtime = (dir) => stat(join(dir, '.git', 'FETCH_HEAD')).then((s) => s.mtimeMs, () => null);
const inFuture = (ms) => new Date(Date.now() + ms).toISOString();
const liveRunIds = async () => {
  const j = await (await fetch(`${base}/api/runs`)).json();
  return (Array.isArray(j) ? j : j.runs || []).map((r) => r.id || r.runId).sort();
};

test('GET /api/sync reads status with no network; POST ff moves dev; an unregistered dir → 404', async () => {
  const w = await world();
  g(w.a, 'fetch', '-q', 'origin');
  await w.push('t.txt', 'teammate');
  g(w.a, 'fetch', '-q', 'origin');
  const before = await fetchHeadMtime(w.a);
  const r = await fetch(`${base}/api/sync?projectDir=${encodeURIComponent(w.a)}&base=dev`);
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.sync.state, 'behind');
  assert.equal(await fetchHeadMtime(w.a), before, 'status never fetches');

  const p = await J('POST', '/api/sync', { projectDir: w.a, mode: 'ff' });
  assert.equal(p.status, 200);
  assert.equal(g(w.a, 'rev-parse', 'dev'), g(w.a, 'rev-parse', 'origin/dev'));

  const other = await world({ register: false });
  assert.equal((await J('POST', '/api/sync', { projectDir: other.a, mode: 'ff' })).status, 404);
  // A base sync never touches: 200 'unknown' for THAT base (no failed request in the browser), no git with it.
  for (const bad of ['-x', 'plus+branch']) {
    const u = await fetch(`${base}/api/sync?projectDir=${encodeURIComponent(w.a)}&base=${encodeURIComponent(bad)}`);
    assert.equal(u.status, 200);
    const b = (await u.json()).sync;
    assert.deepEqual([b.base, b.remote, b.state, b.reason], [bad, 'origin', 'unknown', 'not-a-branch']);
    assert.equal(typeof b.settings.beforeRun, 'boolean');
  }
  assert.equal((await J('POST', '/api/sync', { projectDir: w.a, base: 'plus+branch' })).status, 400, 'a write still refuses it');
});

test('POST /api/sync never takes a remote or URL from the request', async () => {
  const w = await world();
  const r = await J('POST', '/api/sync', { projectDir: w.a, remote: 'https://evil' });
  assert.equal(r.status, 400);
  assert.equal((await J('POST', '/api/sync', { projectDir: w.a, mode: 'push' })).status, 400);
});

test('POST /api/projects/:key/sync fast-forwards the same way; GET by key reads status', async () => {
  const w = await world();
  await w.push('t.txt', 'teammate');
  const r = await J('POST', `/api/projects/${w.key}/sync`, { mode: 'ff' });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).sync.state, 'up-to-date');
  assert.equal(g(w.a, 'rev-parse', 'dev'), g(w.a, 'rev-parse', 'origin/dev'));
  const s = await (await fetch(`${base}/api/projects/${w.key}/sync?base=dev`)).json();
  assert.equal(s.sync.base, 'dev');
  assert.equal((await fetch(`${base}/api/projects/${projectKey(join(root, 'unregistered'))}/sync`)).status, 404);
});

test('PUT /api/projects/:key/sync/settings: set, null resets to the instance value, a URL remote → 400', async () => {
  const w = await world();
  let r = await J('PUT', `/api/projects/${w.key}/sync/settings`, { beforeRun: false });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).settings.beforeRun, false);
  r = await J('PUT', `/api/projects/${w.key}/sync/settings`, { beforeRun: null });
  assert.equal((await r.json()).settings.beforeRun, true, 'back to the instance default');
  r = await J('PUT', `/api/projects/${w.key}/sync/settings`, { remote: 'https://x' });
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /never a URL/);
  assert.equal((await J('PUT', `/api/projects/${w.key}/sync/settings`, { bogus: 1 })).status, 400);
});

test('GET /api/projects/:key/sync/settings: own keys, the instance defaults and the effective result; PUT answers the same shape', async () => {
  const w = await world();
  let j = await (await fetch(`${base}/api/projects/${w.key}/sync/settings`)).json();
  assert.deepEqual(j.own, {}, 'nothing overridden yet');
  assert.equal(j.defaults.onDiverged, j.settings.onDiverged);
  let r = await J('PUT', `/api/projects/${w.key}/sync/settings`, { onDiverged: 'fail', beforeRun: false });
  j = await r.json();
  assert.deepEqual(j.own, { onDiverged: 'fail', beforeRun: false });
  assert.deepEqual([j.settings.onDiverged, j.settings.beforeRun], ['fail', false]);
  assert.ok(j.defaults && 'remote' in j.defaults);
  r = await J('PUT', `/api/projects/${w.key}/sync/settings`, { onDiverged: null, beforeRun: null });
  j = await r.json();
  assert.deepEqual(j.own, {});
  assert.deepEqual(j.settings, j.defaults, 'back to following the instance');
  assert.equal((await fetch(`${base}/api/projects/no-such-key/sync/settings`)).status, 400, "an unknown key is refused like every project route (tmProject)");
});

test('POST /api/settings { sync } sets the instance defaults and GET echoes them', async () => {
  let r = await J('POST', '/api/settings', { sync: { refreshMinutes: 5 } });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).sync.refreshMinutes, 5);
  assert.equal((await (await fetch(`${base}/api/settings`)).json()).sync.refreshMinutes, 5);
  r = await J('POST', '/api/settings', { sync: { remote: 'https://x' } });
  assert.equal(r.status, 400);
  r = await J('POST', '/api/settings', { sync: null });
  assert.equal((await r.json()).sync.refreshMinutes, 10, 'null resets to the built-in defaults');
});

test('GET /api/sync/projects has every registered key; POST /api/sync/all answers 200', async () => {
  const w = await world();
  const j = await (await fetch(`${base}/api/sync/projects`)).json();
  assert.ok(Object.hasOwn(j.projects, w.key));
  const r = await J('POST', '/api/sync/all', { mode: 'fetch' });
  assert.equal(r.status, 200);
  assert.ok(Object.hasOwn((await r.json()).projects, w.key));
  assert.equal((await J('POST', '/api/sync/all', { mode: 'x' })).status, 400);
});

test('POST /api/workspaces/:id/sync fast-forwards both members', async () => {
  const w1 = await world(); const w2 = await world();
  await w1.push('t.txt', 'one'); await w2.push('t.txt', 'two');
  const ws = await createWorkspace({ name: `ws${n}`, projectPaths: [w1.a, w2.a] });
  const r = await J('POST', `/api/workspaces/${ws.id}/sync`, { mode: 'ff' });
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.members.length, 2);
  for (const w of [w1, w2]) assert.equal(g(w.a, 'rev-parse', 'dev'), g(w.a, 'rev-parse', 'origin/dev'));
  assert.equal((await fetch(`${base}/api/workspaces/${ws.id}/sync`)).status, 200);
  assert.equal((await J('POST', `/api/workspaces/${ws.id}/sync`, { bases: { x: '-bad' } })).status, 400);
  assert.equal((await fetch(`${base}/api/workspaces/wks-nope-00000000/sync`)).status, 404);
});

test('POST /api/run on a diverged base → 409 asking once, no run created; fail/origin settings', async () => {
  const w = await world();
  await w.push('t.txt', 'teammate');
  await w.localCommit('l.txt', 'mine');
  const runsBefore = await liveRunIds();
  let r = await J('POST', '/api/run', { projectDir: w.a, prompt: 'x', mock: true });
  assert.equal(r.status, 409);
  let j = await r.json();
  assert.equal(j.code, 'sync-diverged');
  assert.equal(j.kind, 'diverged');
  assert.deepEqual(j.options, ['origin', 'cancel']);
  assert.equal(j.members[0].base, 'dev');
  assert.deepEqual(await liveRunIds(), runsBefore, 'no run created');

  await J('PUT', `/api/projects/${w.key}/sync/settings`, { onDiverged: 'fail' });
  r = await J('POST', '/api/run', { projectDir: w.a, prompt: 'x', mock: true });
  assert.equal(r.status, 409);
  j = await r.json();
  assert.deepEqual(j.options, ['cancel']);
  assert.equal(j.forbidden, true);

  // The form's switch turned off for this run: no pre-check at all.
  r = await J('POST', '/api/run', { projectDir: w.a, prompt: 'x', mock: true, syncBeforeStart: false, scheduledFor: inFuture(3600_000) });
  assert.notEqual(r.status, 409);

  await J('PUT', `/api/projects/${w.key}/sync/settings`, { onDiverged: 'origin' });
  r = await J('POST', '/api/run', { projectDir: w.a, prompt: 'x', mock: true });
  assert.notEqual(r.status, 409, 'onDiverged origin never asks');
  j = await r.json();
  if (j.runId) await J('POST', '/api/stop', { runId: j.runId });
});

test('POST /api/run with syncBeforeStart:false on a diverged base → not 409 (and the run is stopped)', async () => {
  const w = await world();
  await w.push('t.txt', 'teammate');
  await w.localCommit('l.txt', 'mine');
  const r = await J('POST', '/api/run', { projectDir: w.a, prompt: 'x', mock: true, syncBeforeStart: false });
  assert.notEqual(r.status, 409);
  const j = await r.json();
  if (j.runId) await J('POST', '/api/stop', { runId: j.runId });
});

test('POST /api/run with a failing fetch → 409 sync-fetch-failed; a retry fetches again (a Start is explicit)', async () => {
  const w = await world();
  const fetches = [];
  gitSync.setRunner((args, opts) => {
    if (args[0] === 'fetch') {
      fetches.push(args);
      return Promise.resolve({ ok: false, stdout: '', stderr: 'fatal: Authentication failed for \'https://example.invalid/\'', code: 128 });
    }
    return gitSync.defaultRun(args, opts);
  });
  let r = await J('POST', '/api/run', { projectDir: w.a, prompt: 'x', mock: true });
  assert.equal(r.status, 409);
  let j = await r.json();
  assert.equal(j.code, 'sync-fetch-failed');
  assert.equal(j.fetchKind, 'auth');
  assert.deepEqual(j.options, ['last-fetch', 'cancel']);
  assert.equal(fetches.length, 1);
  r = await J('POST', '/api/run', { projectDir: w.a, prompt: 'x', mock: true });
  assert.equal(r.status, 409);
  j = await r.json();
  assert.equal(j.fetchKind, 'auth');
  assert.equal(fetches.length, 2, 'no negative cache at Start: a remote that came back is seen at once');
  gitSync.reset();                                 // the remote is back: the next Start is not asked
  r = await J('POST', '/api/run', { projectDir: w.a, prompt: 'x', mock: true });
  assert.notEqual(r.status, 409);
  j = await r.json();
  if (j.runId) await J('POST', '/api/stop', { runId: j.runId });
});

test('POST /api/run: a push that diverges the base inside the 45 s cache is still caught at Start', async () => {
  const w = await world();
  g(w.a, 'fetch', '-q', 'origin');                 // a fresh FETCH_HEAD: well inside the TTL
  await w.push('t.txt', 'teammate');
  await w.localCommit('l.txt', 'mine');
  const r = await J('POST', '/api/run', { projectDir: w.a, prompt: 'x', mock: true });
  assert.equal(r.status, 409);
  assert.equal((await r.json()).code, 'sync-diverged');
});

test('POST /api/run from a tag while offline → no sync-fetch-failed 409 (the harness never syncs a tag)', async () => {
  const w = await world();
  g(w.a, 'tag', 'v1.0');
  gitSync.setRunner((args, opts) => (args[0] === 'fetch'
    ? Promise.resolve({ ok: false, stdout: '', stderr: 'fatal: unable to access: Could not resolve host', code: 128 })
    : gitSync.defaultRun(args, opts)));
  const r = await J('POST', '/api/run', { projectDir: w.a, prompt: 'x', mock: true, sourceBranch: 'v1.0' });
  assert.notEqual(r.status, 409);
  const j = await r.json();
  if (j.runId) await J('POST', '/api/stop', { runId: j.runId });
});

test('POST /api/run: a remote-only sourceBranch is accepted (schedule → 202); a nowhere branch → 400', async () => {
  const w = await world();
  await w.push('r.txt', 'remote only', 'feat/remote');
  let r = await J('POST', '/api/run', { projectDir: w.a, prompt: 'x', mock: true, sourceBranch: 'feat/remote', scheduledFor: inFuture(3600_000) });
  assert.equal(r.status, 202);
  r = await J('POST', '/api/run', { projectDir: w.a, prompt: 'x', mock: true, sourceBranch: 'no-such-branch' });
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /sourceBranch/);
});

test('runSyncOpts resolves each member (D2, D14)', async () => {
  const k1 = projectKey(join(root, 'opts-1')); const k2 = projectKey(join(root, 'opts-2'));
  const m = (k) => ({ projectKey: k, projectDir: '/x' });
  // default setting 'ask': a scheduled run cannot ask → origin, from the setting
  let o = runSyncOpts([m(k1)], { allowed: true, before: null, policy: null, scheduled: true, onDiverged: null });
  assert.deepEqual([o.members[k1].onDiverged, o.members[k1].policySource], ['origin', 'setting']);
  o = runSyncOpts([m(k1)], { allowed: true, before: null, policy: null, scheduled: true, onDiverged: 'fail' });
  assert.deepEqual([o.members[k1].onDiverged, o.members[k1].policySource], ['fail', 'schedule']);
  writeSyncPrefs(k1, { onDiverged: 'origin' });
  o = runSyncOpts([m(k1)], { allowed: true, before: null, policy: null, scheduled: false, onDiverged: null });
  assert.deepEqual([o.members[k1].onDiverged, o.members[k1].policySource], ['origin', 'setting']);
  writeSyncPrefs(k1, { onDiverged: 'fail' });
  o = runSyncOpts([m(k1)], { allowed: true, before: null, policy: 'origin', scheduled: false, onDiverged: null });
  assert.equal(o.members[k1].onDiverged, 'fail', 'a project that forbids it is never started from the remote');
  writeSyncPrefs(k1, { onDiverged: null, beforeRun: true });
  writeSyncPrefs(k2, { beforeRun: false });
  o = runSyncOpts([m(k1), m(k2)], { allowed: true, before: null, policy: null, scheduled: false, onDiverged: null });
  assert.deepEqual([o.members[k1].enabled, o.members[k2].enabled, o.enabled], [true, false, true]);
  o = runSyncOpts([m(k1), m(k2)], { allowed: false, before: true, policy: null, scheduled: false, onDiverged: null });
  assert.equal(o.enabled, false, 'scans and defrag never sync');
});

test('an async sync route that throws answers 500 JSON and the server stays up', async () => {
  const prev = process.env.WORCA_HOME;
  const { _resetForTests } = await import('../src/core/db.mjs');
  const bad = join(root, 'not-a-dir');
  await writeFile(bad, 'x');                       // WORCA_HOME is a FILE: the DB cannot open
  process.env.WORCA_HOME = bad; _resetForTests();
  try {
    const r = await fetch(`${base}/api/sync/projects`);
    assert.equal(r.status, 500);
    assert.ok((await r.json()).error);
  } finally {
    process.env.WORCA_HOME = prev; _resetForTests();
  }
  assert.equal((await fetch(`${base}/api/sync/projects`)).status, 200, 'still serving');
});
