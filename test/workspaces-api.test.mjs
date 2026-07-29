// test/workspaces-api.test.mjs
// Integration coverage for the Milestone 2 server surface in ui/server.mjs:
// workspace CRUD routes, the POST /api/run workspace target (mutual-exclusion +
// member resolution/sort + the D2 no-isValidSourceRef divergence), the
// ?workspaceId= list/detail/delete arms, summarizeRuns' kind discriminator, and
// single-project regression guards.
//
// A *fully executing* workspace run needs the M3 multi-worktree orchestrator, so
// these tests scope to the server contract only: validation, status mapping,
// {runId} return, and the registry entry the route creates (mock mode). They do
// NOT await a multi-project run to completion (deferred to M3).
//
// Sandboxing mirrors api-workflows.test.mjs: WORCA_HOME points at a temp dir
// and WORCA_MOCK=1 keeps /api/run offline. The outer useTempHome(after) guards
// against an async store write landing in ~ after this file's teardown.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import { mkdtemp, rm, mkdir, writeFile, readdir } from 'node:fs/promises';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

import { useTempHome } from './helpers/temp-home.mjs';
import { seedWorkspacePipeline } from './helpers/db-seed.mjs';
import { writeStoreMeta, recordArtifact } from '../src/core/artifacts.mjs';
import { _resetForTests } from '../src/core/db.mjs';

// ── Robust temp-repo teardown (fixes a full-suite-only ENOTEMPTY flake) ──────
// The two run-returns-200 workspace tests POST a workspace run; the route fires
// orch.run() fire-and-forget. A workspace run creates a per-member worktree under
// <member>/.git/worktrees/<id>, and run()'s finally tears it down with
// `git worktree remove` that runs with ignoreAbort:true (orchestrator._commitWork
// / removeWorktree) — i.e. it deliberately OUTLIVES orch.stop(). So after stop()
// a git child can still be mutating <member>/.git when after() begins the
// recursive rm of created[], and the final `rmdir .git` loses the race ->
// ENOTEMPTY. It only surfaces under full-suite event-loop load (the teardown git
// finishes promptly when this file runs alone). Two layers, defense-in-depth:
//   (1) drainWorktrees(): after stopping, wait (bounded) for each member's
//       .git/worktrees to drain + git lock files to clear, so the teardown
//       `worktree remove` is done before we touch the dir;
//   (2) rmWithRetry(): a bounded ENOTEMPTY/EBUSY retry on the recursive rm, so a
//       teardown git that lands in the residual window can't fail cleanup.

/** True while a member repo still has a live worktree entry or a git lock. */
async function gitBusy(dir) {
  try {
    if (!existsSync(join(dir, '.git'))) return false;
    const wt = join(dir, '.git', 'worktrees');
    if (existsSync(wt) && (await readdir(wt)).length > 0) return true;
    for (const lock of ['index.lock', 'HEAD.lock', 'config.lock']) {
      if (existsSync(join(dir, '.git', lock))) return true;
    }
    return false;
  } catch {
    return false; // a dir vanishing mid-check is not "busy"
  }
}

/** Wait (bounded) for in-flight teardown git to release every member repo. */
async function drainWorktrees(dirs, { timeoutMs = 4000, stepMs = 25 } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const busy = [];
    for (const d of dirs) if (await gitBusy(d)) busy.push(d);
    if (busy.length === 0 || Date.now() >= deadline) return;
    await delay(stepMs);
  }
}

/** Recursive rm that retries on ENOTEMPTY/EBUSY (late git writes into .git). */
async function rmWithRetry(dir, { attempts = 12, stepMs = 25 } = {}) {
  for (let i = 0; ; i++) {
    try {
      await rm(dir, { recursive: true, force: true });
      return;
    } catch (err) {
      const code = err?.code || '';
      if ((code === 'ENOTEMPTY' || code === 'EBUSY' || code === 'ENOENT') && i < attempts) {
        await delay(stepMs);
        continue;
      }
      throw err;
    }
  }
}

// Outermost temp home. NOTE node:test after-hooks run FIFO, so this helper's
// cleanup fires BEFORE the suite after() below — a fire-and-forget orch.run()
// stopped there can still write to the store afterwards. Safety comes from the
// helper never re-exposing the real home (quarantine path when no outer
// WORCA_HOME) plus the worcaHome() test-runner guard, not from ordering.
useTempHome(after);

// CONTAINMENT (test-leak guard). The two run-returns-200 workspace tests POST a
// workspace run that fires orch.run() in the background. The orchestrator now
// consumes the workspace and creates one worktree PER MEMBER under each member's
// own <member>/.git/worktrees/<id> (mock mode short-circuits the graph build +
// claude spawn, NOT worktree setup) — the members are the freshRepo() dirs in
// created[]. As a belt for the scalar primary/cwd resolution, we ALSO chdir the
// whole file's process into a throwaway git repo for the duration (node runs each
// test FILE in its own process and tests within this file run sequentially, so a
// process-wide chdir is safe and isolated); any worktree resolved against cwd
// lands inside the sandbox and dies with the rm in after(). All other paths in
// this file are absolute, so chdir is otherwise inert. The defensive after()
// stops every registered orch, then drains the in-flight (ignoreAbort) teardown
// git before removing the member repos + sandbox (see drainWorktrees/rmWithRetry).
const origCwd = process.cwd();
let cwdSandbox = null;

let homeDir, srv, base, runs, summarizeRuns, prevHome;
const JSONH = { 'Content-Type': 'application/json' };
const created = [];

before(async () => {
  // A throwaway git repo to absorb any orch.run() worktree (see CONTAINMENT).
  cwdSandbox = mkdtempSync(join(tmpdir(), 'worca-cc-wsapi-cwd-'));
  const g = (a) => spawnSync('git', a, { cwd: cwdSandbox });
  g(['init', '-q', '-b', 'main']);
  g(['config', 'user.email', 't@t']);
  g(['config', 'user.name', 't']);
  writeFileSync(join(cwdSandbox, 'README.md'), '# sandbox\n');
  g(['add', '-A']);
  g(['commit', '-qm', 'init']);
  process.chdir(cwdSandbox);

  homeDir = await mkdtemp(join(tmpdir(), 'worca-cc-wsapi-'));
  prevHome = process.env.WORCA_HOME;
  process.env.WORCA_HOME = homeDir;
  _resetForTests(); // reopen the DB singleton against THIS home before any /api/workspaces call
  process.env.WORCA_MOCK = '1'; // keep /api/run offline
  const mod = await import('../ui/server.mjs'); // imported => no port bind
  runs = mod.runs;
  summarizeRuns = mod._testing.summarizeRuns;
  srv = http.createServer(mod.app);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
});

after(async () => {
  if (srv) await new Promise((r) => srv.close(r));
  // Defensive: abort every still-registered orch so no background worktree
  // creation outlives this file (belt to the chdir-sandbox suspenders).
  for (const r of runs.values()) {
    try { r.orch && typeof r.orch.stop === 'function' && r.orch.stop(); } catch { /* best-effort */ }
  }
  runs.clear();
  // stop() aborts the run, but run()'s finally tears down each member worktree with
  // ignoreAbort git that outlives the abort. Wait for that teardown to release the
  // member repos BEFORE removing them, so `git worktree remove` can't race the rm
  // and leave .git non-empty (the full-suite-only ENOTEMPTY flake). See header.
  await drainWorktrees([...created, cwdSandbox].filter(Boolean));
  if (prevHome === undefined) delete process.env.WORCA_HOME; else process.env.WORCA_HOME = prevHome;
  delete process.env.WORCA_MOCK;
  _resetForTests(); // next file reopens the DB singleton clean
  // Restore cwd BEFORE removing the sandbox so the rm cannot fail on a cwd that
  // is being deleted; the sandbox (with any worktree inside it) goes with it.
  process.chdir(origCwd);
  // rmWithRetry absorbs any teardown git that lands in the residual window after
  // the drain (bounded ENOTEMPTY/EBUSY retry) so cleanup is resilient regardless.
  if (cwdSandbox) await rmWithRetry(cwdSandbox);
  await rmWithRetry(homeDir);
  await Promise.all(created.map((d) => rmWithRetry(d)));
});

/** A real git repo so the server's per-member isGitRepo resolution passes. */
async function freshRepo(prefix = 'worca-cc-wsapi-repo-') {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  created.push(dir);
  const g = (a) => spawnSync('git', a, { cwd: dir });
  g(['init', '-q', '-b', 'main']);
  g(['config', 'user.email', 't@t']);
  g(['config', 'user.name', 't']);
  await writeFile(join(dir, 'README.md'), '# hi\n');
  g(['add', '-A']);
  g(['commit', '-qm', 'init']);
  return dir;
}

/** A plain (non-git) directory. */
async function freshDir(prefix = 'worca-cc-wsapi-plain-') {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  created.push(dir);
  return dir;
}

const get = (p) => fetch(`${base}${p}`);
const post = (p, body) => fetch(`${base}${p}`, { method: 'POST', headers: JSONH, body: JSON.stringify(body) });
const patch = (p, body) => fetch(`${base}${p}`, { method: 'PATCH', headers: JSONH, body: JSON.stringify(body) });
const del = (p) => fetch(`${base}${p}`, { method: 'DELETE' });

// ───────────────────────────────────────────────────────────────────────────
// Workspace CRUD
// ───────────────────────────────────────────────────────────────────────────

test('GET /api/workspaces lists empty initially', async () => {
  const r = await get('/api/workspaces');
  assert.equal(r.status, 200);
  assert.deepEqual((await r.json()).workspaces, []);
});

test('POST /api/workspaces creates -> 201 with the annotated workspace; then it lists', async () => {
  const a = await freshRepo();
  const b = await freshRepo();
  const r = await post('/api/workspaces', { name: 'Create WS', projectPaths: [a, b], description: 'desc' });
  assert.equal(r.status, 201);
  const { workspace } = await r.json();
  assert.match(workspace.id, /^wks-create-ws-[0-9a-f]{8}$/);
  assert.equal(workspace.name, 'Create WS');
  assert.equal(workspace.description, 'desc');
  // Read-model carries derived fields.
  assert.ok(Array.isArray(workspace.projectKeys) && workspace.projectKeys.length === 2);
  assert.deepEqual(workspace.exists, [true, true]);

  const list = await (await get('/api/workspaces')).json();
  assert.ok(list.workspaces.some((w) => w.id === workspace.id));
});

test('POST /api/workspaces with <2 paths -> 400', async () => {
  const a = await freshRepo();
  const r = await post('/api/workspaces', { name: 'Too Few', projectPaths: [a] });
  assert.equal(r.status, 400);
  assert.ok((await r.json()).error);
});

test('POST /api/workspaces with a non-git member -> 400', async () => {
  const a = await freshRepo();
  const plain = await freshDir();
  const r = await post('/api/workspaces', { name: 'Not Git', projectPaths: [a, plain] });
  assert.equal(r.status, 400);
});

test('POST /api/workspaces duplicate name (case-insensitive) -> 409', async () => {
  const a = await freshRepo();
  const b = await freshRepo();
  const c = await freshRepo();
  assert.equal((await post('/api/workspaces', { name: 'DupName', projectPaths: [a, b] })).status, 201);
  const r = await post('/api/workspaces', { name: 'dupname', projectPaths: [a, c] });
  assert.equal(r.status, 409);
});

test('POST /api/workspaces duplicate project set (D1) -> 409', async () => {
  const a = await freshRepo();
  const b = await freshRepo();
  assert.equal((await post('/api/workspaces', { name: 'SetOne', projectPaths: [a, b] })).status, 201);
  // Different name, same set -> DUPLICATE_SET -> 409.
  const r = await post('/api/workspaces', { name: 'SetTwo', projectPaths: [b, a] });
  assert.equal(r.status, 409);
});

test('GET /api/workspaces/:id returns detail; bad/unknown id -> 404', async () => {
  const a = await freshRepo();
  const b = await freshRepo();
  const { workspace } = await (await post('/api/workspaces', { name: 'Detail WS', projectPaths: [a, b] })).json();
  const r = await get(`/api/workspaces/${workspace.id}`);
  assert.equal(r.status, 200);
  assert.equal((await r.json()).workspace.name, 'Detail WS');

  // Unknown but well-formed id -> 404.
  assert.equal((await get('/api/workspaces/wks-nope-00000000')).status, 404);
  // Malformed id (fails WORKSPACE_ID_RE) -> 404 (stale bookmark reads as not-found).
  assert.equal((await get('/api/workspaces/not-a-ws-id')).status, 404);
});

test('GET /api/workspaces/:id rejects a traversing/malformed id -> 404', async () => {
  for (const bad of ['..%2f..%2fevil', 'alpha-00000001', 'wks-BAD-UPPER-00000000']) {
    assert.equal((await get(`/api/workspaces/${bad}`)).status, 404, `id ${bad} must be rejected`);
  }
});

test('PATCH /api/workspaces/:id updates description and name; id is STABLE across rename', async () => {
  const a = await freshRepo();
  const b = await freshRepo();
  const { workspace } = await (await post('/api/workspaces', { name: 'Before', projectPaths: [a, b] })).json();
  const origId = workspace.id;

  // Description-only patch.
  let r = await patch(`/api/workspaces/${origId}`, { description: 'new text' });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).workspace.description, 'new text');

  // Rename: id must NOT change (D1).
  r = await patch(`/api/workspaces/${origId}`, { name: 'After Rename' });
  assert.equal(r.status, 200);
  const renamed = (await r.json()).workspace;
  assert.equal(renamed.name, 'After Rename');
  assert.equal(renamed.id, origId, 'rename never recomputes the id');
  // The old id still resolves (the store dir/key is unchanged).
  assert.equal((await get(`/api/workspaces/${origId}`)).status, 200);
});

test('PATCH /api/workspaces/:id rejects projectPaths in the body -> 400 (immutability)', async () => {
  const a = await freshRepo();
  const b = await freshRepo();
  const c = await freshRepo();
  const { workspace } = await (await post('/api/workspaces', { name: 'Immutable', projectPaths: [a, b] })).json();

  let r = await patch(`/api/workspaces/${workspace.id}`, { projectPaths: [a, b, c] });
  assert.equal(r.status, 400, 'projectPaths in PATCH body is rejected');
  // projectKeys is likewise a derived field and must be rejected.
  r = await patch(`/api/workspaces/${workspace.id}`, { projectKeys: ['x', 'y'] });
  assert.equal(r.status, 400);

  // The set is unchanged on disk.
  const got = (await (await get(`/api/workspaces/${workspace.id}`)).json()).workspace;
  assert.equal(got.projectPaths.length, 2);
});

test('PATCH /api/workspaces/:id rename to a clashing name -> 409; unknown id -> 404', async () => {
  const a = await freshRepo();
  const b = await freshRepo();
  const c = await freshRepo();
  const d = await freshRepo();
  await post('/api/workspaces', { name: 'Taken', projectPaths: [a, b] });
  const { workspace } = await (await post('/api/workspaces', { name: 'Mover', projectPaths: [c, d] })).json();

  const r = await patch(`/api/workspaces/${workspace.id}`, { name: 'taken' });
  assert.equal(r.status, 409);

  assert.equal((await patch('/api/workspaces/wks-nope-00000000', { description: 'x' })).status, 404);
  assert.equal((await patch('/api/workspaces/not-a-ws-id', { description: 'x' })).status, 404);
});

test('DELETE /api/workspaces/:id removes it -> {ok:true}; bad/unknown id -> 404', async () => {
  const a = await freshRepo();
  const b = await freshRepo();
  const { workspace } = await (await post('/api/workspaces', { name: 'Deletable', projectPaths: [a, b] })).json();

  const r = await del(`/api/workspaces/${workspace.id}`);
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.equal(body.ok, true);
  assert.ok(Array.isArray(body.warnings));
  assert.equal((await get(`/api/workspaces/${workspace.id}`)).status, 404, 'gone after delete');

  // Unknown / malformed id -> 404.
  assert.equal((await del('/api/workspaces/wks-nope-00000000')).status, 404);
  assert.equal((await del('/api/workspaces/not-a-ws-id')).status, 404);
});

test('DELETE /api/workspaces/:id is 409 while a live run/scan for it exists', async () => {
  const a = await freshRepo();
  const b = await freshRepo();
  const { workspace } = await (await post('/api/workspaces', { name: 'Busy', projectPaths: [a, b] })).json();

  // Simulate a live workspace run/scan for this id in the runs Map. 'pausing'
  // (mid-graceful-pause, orchestrator still persisting into the store) is live too.
  for (const status of ['running', 'pausing']) {
    runs.set('live-ws-1', { id: 'live-ws-1', workspaceId: workspace.id, status });
    const r = await del(`/api/workspaces/${workspace.id}`);
    assert.equal(r.status, 409, `status=${status} blocks deletion`);
  }
  runs.delete('live-ws-1');

  // After the live entry clears, deletion proceeds.
  assert.equal((await del(`/api/workspaces/${workspace.id}`)).status, 200);
});

// ───────────────────────────────────────────────────────────────────────────
// POST /api/run — workspace target (§2.6)
// ───────────────────────────────────────────────────────────────────────────

test('POST /api/run with BOTH workspaceId and projectDir -> 400', async () => {
  const a = await freshRepo();
  const b = await freshRepo();
  const { workspace } = await (await post('/api/workspaces', { name: 'BothTarget', projectPaths: [a, b] })).json();
  const r = await post('/api/run', { workspaceId: workspace.id, projectDir: a, prompt: 'x', mock: true });
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /not both|workspaceId|projectDir/i);
});

test('POST /api/run with NEITHER workspaceId nor projectDir -> 400', async () => {
  const r = await post('/api/run', { prompt: 'x', mock: true });
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /workspaceId or projectDir/i);
});

test('POST /api/run with a malformed workspaceId -> 404', async () => {
  const r = await post('/api/run', { workspaceId: 'not-a-ws-id', prompt: 'x', mock: true });
  assert.equal(r.status, 404);
});

test('POST /api/run with an unknown (well-formed) workspaceId -> 404', async () => {
  const r = await post('/api/run', { workspaceId: 'wks-nope-00000000', prompt: 'x', mock: true });
  assert.equal(r.status, 404);
});

test('POST /api/run on a workspace requires a prompt -> 400', async () => {
  const a = await freshRepo();
  const b = await freshRepo();
  const { workspace } = await (await post('/api/workspaces', { name: 'NoPrompt', projectPaths: [a, b] })).json();
  const r = await post('/api/run', { workspaceId: workspace.id, mock: true });
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /prompt/i);
});

test('POST /api/run on a workspace with a vanished member -> 400 "workspace member path is missing"', async () => {
  const a = await freshRepo();
  const b = await freshRepo();
  const { workspace } = await (await post('/api/workspaces', { name: 'Vanish Run', projectPaths: [a, b] })).json();
  // Remove a member after creation; the run target requires the full set.
  await rm(b, { recursive: true, force: true });
  const r = await post('/api/run', { workspaceId: workspace.id, prompt: 'x', mock: true });
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /workspace member path is missing/i);
});

test('POST /api/run on a workspace whose member exists but is no longer a git repo -> 400', async () => {
  const a = await freshRepo();
  const b = await freshRepo();
  const { workspace } = await (await post('/api/workspaces', { name: 'DeGit Run', projectPaths: [a, b] })).json();
  // The member dir still exists, but its .git is gone (createWorkspace enforced
  // isGitRepo; this only bites a member that BECAME a non-repo). The run target
  // must reject it with a clean 400, not a mid-run worktree error event.
  await rm(join(b, '.git'), { recursive: true, force: true });
  const r = await post('/api/run', { workspaceId: workspace.id, prompt: 'x', mock: true });
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /not a git repository|member path is missing/i);
});

test('POST /api/run on a workspace rejects an option-injection sourceBranch (leading dash) -> 400', async () => {
  const a = await freshRepo();
  const b = await freshRepo();
  const { workspace } = await (await post('/api/workspaces', { name: 'Inject WS', projectPaths: [a, b] })).json();
  const r = await post('/api/run', { workspaceId: workspace.id, prompt: 'x', mock: true, sourceBranch: '--force' });
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /sourceBranch/i);
});

test('POST /api/run on a workspace does NOT pre-validate sourceBranch existence (D2 divergence)', async () => {
  const a = await freshRepo();
  const b = await freshRepo();
  const { workspace } = await (await post('/api/workspaces', { name: 'D2 WS', projectPaths: [a, b] })).json();
  // A source ref that does not exist in any member is NOT rejected (the
  // orchestrator resolves each member's default branch at run time). This is the
  // single intentional divergence from the single-project line-320 guard.
  const r = await post('/api/run', { workspaceId: workspace.id, prompt: 'x', mock: true, sourceBranch: 'no-such-branch' });
  assert.equal(r.status, 200, 'a non-existent sourceBranch is accepted for a workspace run (D2)');
  const { runId } = await r.json();
  assert.ok(runId);
});

test('POST /api/run on a valid workspace returns {runId} and registers a kind:"workspace-run" entry', async () => {
  const a = await freshRepo();
  const b = await freshRepo();
  const { workspace } = await (await post('/api/workspaces', { name: 'Valid Run', projectPaths: [a, b] })).json();
  const r = await post('/api/run', { workspaceId: workspace.id, prompt: 'demo task', mock: true });
  assert.equal(r.status, 200);
  const { runId } = await r.json();
  assert.match(runId, /[0-9a-f-]{8,}/);

  // The route registered a workspace-run entry tagged with the workspace id and a
  // primary projectDir = projects[0].projectDir (lowest projectKey).
  const entry = runs.get(runId);
  assert.ok(entry, 'run is registered in the runs Map');
  assert.equal(entry.workspaceId, workspace.id);
  assert.ok(workspace.projectPaths.includes(entry.projectDir), 'projectDir is a member (the primary)');
});

// ───────────────────────────────────────────────────────────────────────────
// summarizeRuns kind discriminator (the WS hello snapshot payload)
// ───────────────────────────────────────────────────────────────────────────

test('summarizeRuns carries a kind discriminator + scanId/workspaceId fields', async () => {
  runs.clear();
  // A single-project run entry (as POST /api/run registers it).
  runs.set('r-proj', { id: 'r-proj', projectDir: '/x/proj', title: 't', status: 'running', startedAt: 'now', kind: 'run' });
  // A workspace run entry.
  runs.set('r-ws', { id: 'r-ws', projectDir: '/x/prim', title: 't', status: 'running', startedAt: 'now', kind: 'workspace-run', workspaceId: 'wks-x-00000000' });
  // A legacy entry with no kind defaults to 'run'.
  runs.set('r-legacy', { id: 'r-legacy', projectDir: '/x/legacy', title: 't', status: 'running', startedAt: 'now' });

  const byId = Object.fromEntries(summarizeRuns().map((r) => [r.runId, r]));
  assert.equal(byId['r-proj'].kind, 'run');
  assert.equal(byId['r-proj'].workspaceId, null);
  assert.equal(byId['r-ws'].kind, 'workspace-run');
  assert.equal(byId['r-ws'].workspaceId, 'wks-x-00000000');
  assert.equal(byId['r-legacy'].kind, 'run', 'entries without a kind default to "run"');
  // The new fields are present on every summary (scanId reserved for M5 scans).
  assert.ok('scanId' in byId['r-proj']);
  runs.clear();
});

// ───────────────────────────────────────────────────────────────────────────
// ?workspaceId= list / detail / delete (route through the M1 ws-store helpers)
// ───────────────────────────────────────────────────────────────────────────

/** Seed a workspace + a finished pipeline in its store namespace through the
 *  PRODUCTION writers. Phase 3.6/3.7: the list (listWorkspacePipelines) + detail
 *  (readWorkspacePipeline) read the DB; seedWorkspacePipeline -> createPipeline +
 *  writeState inserts the workspace pipelines row, writes the REAL run dir (prompt.md
 *  + workspace-description.md) under store/workspaces/<id>/pipelines, AND writes the
 *  workspace store_meta. The run id is MINTED (A15(3)) — capture it; createPipeline's
 *  dir basename ends in -<id> so runDirIndex/lookupPipelineRow resolve it. Phase 3.13:
 *  the delete is INDEX-BASED, so we add the shared plans/reviews markdown on the FS +
 *  recordArtifact (store-root-relative) — that is what deletePipeline unlinks. */
async function seedWorkspaceWithPipeline(name) {
  const a = await freshRepo();
  const b = await freshRepo();
  const { workspace } = await (await post('/api/workspaces', { name, projectPaths: [a, b] })).json();
  const wsRoot = join(homeDir, '.worca-cc', 'store', 'workspaces', workspace.id);
  // Production-writer seed: createPipeline mints the id + writes the run dir, writeState
  // persists the workspace row. projects[] (index-aligned with the workspace) supplies
  // the workspace superset. The returned dir IS the on-disk run dir (ends in -<id>).
  const projects = workspace.projectKeys.map((k, i) => ({
    projectKey: k, projectDir: workspace.projectPaths[i], projectName: 'm',
  }));
  const { id: runId, dir: pdir } = await seedWorkspacePipeline(a, workspace.id, {
    title: 'WS feature', status: 'done', workspaceName: name,
    baseName: 'ws-feature', datePrefix: '04-06-26',
    startedAt: '2026-06-04T00:00:00Z',
  }, projects);
  // Pin the ws store_meta (createPipeline wrote one already) so name + projectPaths
  // (the primaryDir / projectDir the list+detail routes resolve) are deterministic.
  writeStoreMeta(workspace.id, 'workspace', {
    key: workspace.id, id: workspace.id, name,
    projectKeys: workspace.projectKeys, projectPaths: workspace.projectPaths,
  });
  // Shared markdown on the FS + indexed so the index-based delete (3.13) unlinks it.
  // createPipeline does NOT write plan/review md (only the orchestrator does), so add
  // them here at the paths the delete asserts, keyed on the MINTED run id.
  await mkdir(join(wsRoot, 'plans'), { recursive: true });
  await mkdir(join(wsRoot, 'reviews'), { recursive: true });
  await writeFile(join(wsRoot, 'plans', '04-06-26-ws-feature.md'), '# p', 'utf8');
  await writeFile(join(wsRoot, 'reviews', '04-06-26-ws-feature-impl-review.md'), '# r', 'utf8');
  recordArtifact(runId, 'plan', 'plans/04-06-26-ws-feature.md');
  recordArtifact(runId, 'review', 'reviews/04-06-26-ws-feature-impl-review.md');
  return { workspace, wsRoot, runId, pdir };
}

test('GET /api/runs?workspaceId= lists workspace-store pipelines; bad/unknown id -> 404', async () => {
  const { workspace, runId } = await seedWorkspaceWithPipeline('List WS Runs');
  const r = await get(`/api/runs?workspaceId=${encodeURIComponent(workspace.id)}`);
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.ok(Array.isArray(j.pipelines));
  assert.ok(j.pipelines.some((p) => p.id === runId), 'lists the seeded workspace pipeline');

  // Malformed / unknown workspaceId -> 404.
  assert.equal((await get('/api/runs?workspaceId=not-a-ws-id')).status, 404);
  assert.equal((await get('/api/runs?workspaceId=wks-nope-00000000')).status, 404);
});

test('GET /api/runs?workspaceId= includes live workspace runs filtered by workspaceId', async () => {
  const { workspace } = await seedWorkspaceWithPipeline('Live WS Runs');
  runs.set('live-ws-2', {
    id: 'live-ws-2', pipelineId: null, projectDir: workspace.projectPaths[0],
    title: 'live', status: 'running', workspaceId: workspace.id, kind: 'workspace-run',
  });
  // A live run for ANOTHER workspace must not leak in.
  runs.set('live-other', { id: 'live-other', title: 'other', status: 'running', workspaceId: 'wks-other-00000000', kind: 'workspace-run' });

  const j = await (await get(`/api/runs?workspaceId=${encodeURIComponent(workspace.id)}`)).json();
  assert.ok(Array.isArray(j.live));
  assert.ok(j.live.some((r) => r.runId === 'live-ws-2'), 'live workspace run surfaced');
  assert.ok(!j.live.some((r) => r.runId === 'live-other'), 'other workspace live run filtered out');
  runs.clear();
});

test('GET /api/workspaces/:id/runs/:runId returns detail; unknown -> 404; bad key -> 404', async () => {
  const { workspace, runId } = await seedWorkspaceWithPipeline('Detail WS Runs');
  const r = await get(`/api/workspaces/${workspace.id}/runs/${runId}`);
  assert.equal(r.status, 200);
  assert.equal((await r.json()).state.title, 'WS feature');

  // Unknown run id under a known workspace -> 404.
  assert.equal((await get(`/api/workspaces/${workspace.id}/runs/nope`)).status, 404);
  // Malformed workspace id -> 404 (no path-traversal surface; key validated).
  assert.equal((await get(`/api/workspaces/not-a-ws-id/runs/${runId}`)).status, 404);
  assert.equal((await get(`/api/workspaces/wks-nope-00000000/runs/${runId}`)).status, 404);
});

test('DELETE /api/runs/:id?workspaceId= removes the workspace pipeline dir + shared files', async () => {
  const { workspace, wsRoot, runId, pdir } = await seedWorkspaceWithPipeline('Delete WS Run');
  const r = await del(`/api/runs/${runId}?workspaceId=${encodeURIComponent(workspace.id)}`);
  assert.equal(r.status, 200);
  assert.equal(existsSync(pdir), false, 'pipeline dir removed');
  assert.equal(existsSync(join(wsRoot, 'plans', '04-06-26-ws-feature.md')), false, 'shared plan removed');
  assert.equal(existsSync(join(wsRoot, 'reviews', '04-06-26-ws-feature-impl-review.md')), false, 'shared review removed');
});

test('DELETE /api/runs/:id?workspaceId= with a malformed workspaceId -> 404', async () => {
  const r = await del('/api/runs/ww?workspaceId=not-a-ws-id');
  assert.equal(r.status, 404);
});

test('DELETE /api/runs/:id?workspaceId= is 409 while the workspace pipeline is live', async () => {
  const { workspace, runId } = await seedWorkspaceWithPipeline('Delete Live WS Run');
  runs.set('uuid-ws', { id: 'uuid-ws', pipelineId: runId, status: 'running', workspaceId: workspace.id, kind: 'workspace-run' });
  const r = await del(`/api/runs/${runId}?workspaceId=${encodeURIComponent(workspace.id)}`);
  assert.equal(r.status, 409, 'a live workspace pipeline cannot be deleted');
  runs.clear();
});

// ───────────────────────────────────────────────────────────────────────────
// Single-project regression (byte-identical behavior when no workspaceId)
// ───────────────────────────────────────────────────────────────────────────

test('regression: single-project POST /api/run still returns {runId} (no workspaceId)', async () => {
  const repo = await freshRepo();
  const r = await post('/api/run', { projectDir: repo, prompt: 'demo task', mock: true });
  assert.equal(r.status, 200);
  const { runId } = await r.json();
  assert.match(runId, /[0-9a-f-]{8,}/);
  const entry = runs.get(runId);
  assert.ok(entry);
  assert.equal(entry.workspaceId, undefined, 'single-project entries carry no workspaceId');
});

test('regression: single-project POST /api/run still rejects an unknown sourceBranch -> 400', async () => {
  const repo = await freshRepo();
  const r = await post('/api/run', { projectDir: repo, prompt: 'x', mock: true, sourceBranch: 'no-such-branch' });
  assert.equal(r.status, 400, 'single-project path keeps the isValidSourceRef guard');
  assert.match((await r.json()).error, /sourceBranch/i);
});

test('regression: GET /api/runs?projectDir= still 400s without projectDir/workspaceId', async () => {
  const r = await get('/api/runs');
  assert.equal(r.status, 400);
});

test('regression: DELETE /api/runs/:id still 400s without any key', async () => {
  const r = await del('/api/runs/whatever');
  assert.equal(r.status, 400);
});
