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
import { checkRows } from './helpers/rows.mjs';
import { seedWorkspacePipeline } from './helpers/db-seed.mjs';
import { templateRepo } from './helpers/git-dir.mjs';
import { writeStoreMeta, recordArtifact } from '../src/core/artifacts.mjs';
import { _resetForTests } from '../src/core/db.mjs';

// ── Robust temp-repo teardown (fixes a full-suite-only ENOTEMPTY flake) ──────
// The run-returns-200 workspace test POSTs a workspace run; the route fires
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

// CONTAINMENT (test-leak guard). The run-returns-200 workspace test POSTs a
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

let homeDir, srv, base, runs, summarizeRuns, prevHome, testing;
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
  testing = mod._testing;
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
function freshRepo(prefix = 'worca-cc-wsapi-repo-') {
  const dir = templateRepo('wsapi-repo', { branch: 'main', user: true, files: { 'README.md': '# hi\n' }, prefix });
  created.push(dir);
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

test('POST /api/workspaces refusals: 400 for <2 paths / a non-git member, 409 for a duplicate name (NOCASE) or project set (D1)', async () => {
  const a = await freshRepo();
  const b = await freshRepo();
  const c = await freshRepo();
  await checkRows([
    { name: 'POST /api/workspaces with <2 paths -> 400', run: async () => {
      const r = await post('/api/workspaces', { name: 'Too Few', projectPaths: [a] });
      assert.equal(r.status, 400);
      assert.ok((await r.json()).error);
    } },
    { name: 'POST /api/workspaces with a non-git member -> 400', run: async () => {
      const plain = await freshDir();
      const r = await post('/api/workspaces', { name: 'Not Git', projectPaths: [a, plain] });
      assert.equal(r.status, 400);
    } },
    { name: 'POST /api/workspaces duplicate name (case-insensitive) -> 409', run: async () => {
      assert.equal((await post('/api/workspaces', { name: 'DupName', projectPaths: [a, b] })).status, 201);
      const r = await post('/api/workspaces', { name: 'dupname', projectPaths: [a, c] });
      assert.equal(r.status, 409);
    } },
    { name: 'POST /api/workspaces duplicate project set (D1) -> 409', run: async () => {
      assert.equal((await post('/api/workspaces', { name: 'SetOne', projectPaths: [b, c] })).status, 201);
      // Different name, same set -> DUPLICATE_SET -> 409.
      const r = await post('/api/workspaces', { name: 'SetTwo', projectPaths: [c, b] });
      assert.equal(r.status, 409);
    } },
  ]);
});

test('GET /api/workspaces/:id returns detail; unknown, malformed and traversing ids -> 404', async () => {
  await checkRows([
    { name: 'GET /api/workspaces/:id returns detail; bad/unknown id -> 404', run: async () => {
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
    } },
    { name: 'GET /api/workspaces/:id rejects a traversing/malformed id -> 404', run: async () => {
      for (const bad of ['..%2f..%2fevil', 'alpha-00000001', 'wks-BAD-UPPER-00000000']) {
        assert.equal((await get(`/api/workspaces/${bad}`)).status, 404, `id ${bad} must be rejected`);
      }
    } },
  ]);
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

test('PATCH /api/workspaces/:id refusals: projectPaths/projectKeys 400, clashing name 409, unknown id 404', async () => {
  const a = await freshRepo();
  const b = await freshRepo();
  const c = await freshRepo();
  const d = await freshRepo();
  await post('/api/workspaces', { name: 'Taken', projectPaths: [c, d] });
  const { workspace } = await (await post('/api/workspaces', { name: 'Immutable', projectPaths: [a, b] })).json();
  await checkRows([
    { name: 'PATCH /api/workspaces/:id rejects projectPaths in the body -> 400 (immutability)', run: async () => {
      let r = await patch(`/api/workspaces/${workspace.id}`, { projectPaths: [a, b, c] });
      assert.equal(r.status, 400, 'projectPaths in PATCH body is rejected');
      // projectKeys is likewise a derived field and must be rejected.
      r = await patch(`/api/workspaces/${workspace.id}`, { projectKeys: ['x', 'y'] });
      assert.equal(r.status, 400);

      // The set is unchanged on disk.
      const got = (await (await get(`/api/workspaces/${workspace.id}`)).json()).workspace;
      assert.equal(got.projectPaths.length, 2);
    } },
    { name: 'PATCH /api/workspaces/:id rename to a clashing name -> 409; unknown id -> 404', run: async () => {
      const r = await patch(`/api/workspaces/${workspace.id}`, { name: 'taken' });
      assert.equal(r.status, 409);

      assert.equal((await patch('/api/workspaces/wks-nope-00000000', { description: 'x' })).status, 404);
      assert.equal((await patch('/api/workspaces/not-a-ws-id', { description: 'x' })).status, 404);
    } },
  ]);
});

test('DELETE /api/workspaces/:id: 409 while a live run/scan owns it, then {ok:true}; bad/unknown id -> 404', async () => {
  await checkRows([
    { name: 'DELETE /api/workspaces/:id removes it -> {ok:true}; bad/unknown id -> 404', run: async () => {
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
    } },
    { name: 'DELETE /api/workspaces/:id is 409 while a live run/scan for it exists', run: async () => {
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
    } },
  ]);
});

test('POST /api/workspaces/:id/members adds and removes members (id frozen, homes cleared) and maps refusals 400/409/404', async () => {
  await checkRows([
    { name: 'POST /api/workspaces/:id/members adds and removes members; the id stays frozen', run: async () => {
      const a = await freshRepo();
      const b = await freshRepo();
      const c = await freshRepo();
      const { workspace } = await (await post('/api/workspaces', { name: 'Members', projectPaths: [a, b], metricsProject: a })).json();

      let r = await post(`/api/workspaces/${workspace.id}/members`, { add: [c] });
      assert.equal(r.status, 200, await r.clone().text());
      let body = await r.json();
      assert.equal(body.workspace.id, workspace.id);
      assert.equal(body.workspace.projectPaths.length, 3);
      assert.deepEqual(body.clearedHomes, []);

      r = await post(`/api/workspaces/${workspace.id}/members`, { remove: a });
      assert.equal(r.status, 200, await r.clone().text());
      body = await r.json();
      assert.equal(body.workspace.id, workspace.id);
      assert.equal(body.workspace.projectPaths.includes(a), false);
      assert.equal(body.workspace.metricsProject, null, 'the removed metrics home is cleared');
      assert.deepEqual(body.clearedHomes, ['metrics']);
      const got = (await (await get(`/api/workspaces/${workspace.id}`)).json()).workspace;
      assert.equal(got.projectPaths.length, 2);
    } },
    { name: 'POST /api/workspaces/:id/members maps refusals: 400 bad body / non-git / below 2, 409 duplicate set, 404 unknown', run: async () => {
      const a = await freshRepo();
      const b = await freshRepo();
      const c = await freshRepo();
      const plain = await freshDir();
      await post('/api/workspaces', { name: 'Trio Taken', projectPaths: [a, b, c] });
      const { workspace } = await (await post('/api/workspaces', { name: 'Duo', projectPaths: [a, b] })).json();
      const url = `/api/workspaces/${workspace.id}/members`;
      assert.equal((await post(url, {})).status, 400, 'neither add nor remove');
      assert.equal((await post(url, { add: [c], remove: a })).status, 400, 'both');
      assert.equal((await post(url, { add: [plain] })).status, 400, 'non-git member');
      assert.equal((await post(url, { remove: a })).status, 400, 'below 2 members');
      assert.equal((await post(url, { add: [c] })).status, 409, 'another workspace spans that set');
      assert.equal((await post('/api/workspaces/wks-nope-00000000/members', { add: [c] })).status, 404);
      assert.equal((await post('/api/workspaces/not-a-ws-id/members', { add: [c] })).status, 404);
    } },
  ]);
});

test('POST /api/workspaces/:id/members is 409 while a run owns the workspace (a paused Workspace scan included)', async () => {
  const { WORKSPACE_SCAN_WORKFLOW_ID } = await import('../src/core/graph/builtin-workflows.mjs');
  const a = await freshRepo();
  const b = await freshRepo();
  const c = await freshRepo();
  const { workspace } = await (await post('/api/workspaces', { name: 'Live Members', projectPaths: [a, b] })).json();
  const owners = [
    { status: 'running' }, { status: 'pausing' },
    { status: 'paused', orch: { workflowId: WORKSPACE_SCAN_WORKFLOW_ID } },
  ];
  for (const o of owners) {
    runs.set('live-ws-m', { id: 'live-ws-m', kind: 'workspace-run', workspaceId: workspace.id, ...o });
    const r = await post(`/api/workspaces/${workspace.id}/members`, { add: [c] });
    assert.equal(r.status, 409, `status=${o.status} blocks a membership change`);
  }
  // A paused ordinary run holds the target no more than it does for a re-scan or a delete.
  runs.set('live-ws-m', { id: 'live-ws-m', kind: 'workspace-run', workspaceId: workspace.id, status: 'paused', orch: { workflowId: 'wf_default' } });
  try {
    assert.equal((await post(`/api/workspaces/${workspace.id}/members`, { add: [c] })).status, 200);
  } finally { runs.delete('live-ws-m'); }
});

/** Poll until `fn` returns a truthy value (bounded). */
async function until(fn, ms = 15000) {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error('until: timed out');
    await delay(25);
  }
}

/** Stop and forget every run of a workspace the test started (mock scans included). */
function stopRunsOf(workspaceId) {
  for (const [id, r] of runs) {
    if (r.workspaceId !== workspaceId) continue;
    try { r.orch && typeof r.orch.stop === 'function' && r.orch.stop(); } catch { /* best-effort */ }
    runs.delete(id);
  }
}

test('a member change starts a Workspace scan run of the new set (graphs, map, description), saved when it ends done', async () => {
  const a = await freshRepo();
  const b = await freshRepo();
  const c = await freshRepo();
  const { workspace } = await (await post('/api/workspaces', { name: 'Rescanned', projectPaths: [a, b], description: 'old text' })).json();
  const r = await post(`/api/workspaces/${workspace.id}/members`, { add: [c] });
  assert.equal(r.status, 200, await r.clone().text());
  const body = await r.json();
  assert.ok(body.rescan && body.rescan.runId, `the change starts a re-scan: ${JSON.stringify(body.rescan)}`);
  const entry = runs.get(body.rescan.runId);
  assert.equal(entry.kind, 'workspace-run');
  assert.equal(entry.workspaceId, workspace.id);
  assert.equal(entry.autoRescan, true);
  assert.equal(entry.orch.workflowId, 'wf_workspace_scan', 'the Workspace scan workflow');
  const got = await until(async () => {
    const ws = (await (await get(`/api/workspaces/${workspace.id}`)).json()).workspace;
    return ws.description && ws.description !== 'old text' ? ws : null;
  }, 60000);
  assert.equal(got.projectPaths.length, 3);
  assert.equal(got.descriptionOrigin, 'generated');
  stopRunsOf(workspace.id);
});

test('a second member change supersedes the automatic re-scan; a scan the user started still blocks it', async () => {
  const a = await freshRepo();
  const b = await freshRepo();
  const c = await freshRepo();
  const { workspace } = await (await post('/api/workspaces', { name: 'Superseded', projectPaths: [a, b] })).json();
  const stopped = [];
  runs.set('auto-scan-1', { id: 'auto-scan-1', kind: 'workspace-run', workspaceId: workspace.id, status: 'running', autoRescan: true,
    events: [], orch: { stop() { stopped.push('auto-scan-1'); } } });
  const r = await post(`/api/workspaces/${workspace.id}/members`, { add: [c] });
  assert.equal(r.status, 200, await r.clone().text());
  assert.deepEqual(stopped, ['auto-scan-1'], 'the automatic re-scan of the old set is stopped');
  assert.equal(runs.get('auto-scan-1').superseded, true);
  const next = (await r.json()).rescan;
  assert.ok(next.runId && next.runId !== 'auto-scan-1', 'a fresh re-scan of the new set');
  stopRunsOf(workspace.id);
  runs.set('user-scan-1', { id: 'user-scan-1', kind: 'workspace-run', workspaceId: workspace.id, status: 'running', orch: { stop() {} } });
  try {
    assert.equal((await post(`/api/workspaces/${workspace.id}/members`, { remove: c })).status, 409, 'a scan the user started is theirs to finish');
  } finally { runs.delete('user-scan-1'); }
});

test('POST /api/workspaces/:id/members is 409 while ANOTHER process (the CLI) runs the workspace; a crashed one blocks nothing', async () => {
  const { seedPipelineRow } = await import('./helpers/db-seed.mjs');
  const { getDb } = await import('../src/core/db.mjs');
  const { hostname } = await import('node:os');
  const a = await freshRepo();
  const b = await freshRepo();
  const c = await freshRepo();
  const { workspace } = await (await post('/api/workspaces', { name: 'Cli Owned', projectPaths: [a, b] })).json();
  const now = new Date().toISOString();
  const row = (id, ownerPid) => seedPipelineRow({ id, projectKey: workspace.projectKeys[0], workspaceKey: workspace.id, target: 'workspace',
    status: 'running', startedAt: now, ownerPid, ownerHost: hostname(), heartbeatAt: now });
  try {
    row('c1100001', process.ppid);   // alive, and not this server
    const r = await post(`/api/workspaces/${workspace.id}/members`, { add: [c] });
    assert.equal(r.status, 409, 'a run the in-process runs map cannot see still owns the workspace');
    assert.match((await r.json()).error, /run or scan owns it/);
    getDb().prepare("DELETE FROM pipelines WHERE id = 'c1100001'").run();
    row('c1100002', 2 ** 22 + 12345);   // a pid no process holds: the CLI crashed mid-run
    const ok = await post(`/api/workspaces/${workspace.id}/members`, { add: [c] });
    assert.equal(ok.status, 200, 'a dead owner\'s row is reconciled, not obeyed');
    stopRunsOf(workspace.id);
  } finally {
    getDb().prepare("DELETE FROM pipelines WHERE id IN ('c1100001', 'c1100002')").run();
  }
});

test('the workspace list and detail name the automatic re-scan run while it owns the workspace', async () => {
  const a = await freshRepo();
  const b = await freshRepo();
  const { workspace } = await (await post('/api/workspaces', { name: 'Reported', projectPaths: [a, b] })).json();
  runs.set('auto-scan-r', { id: 'auto-scan-r', pipelineId: 'abcd1234', kind: 'workspace-run', workspaceId: workspace.id, status: 'running', autoRescan: true });
  try {
    const listed = (await (await get('/api/workspaces')).json()).workspaces.find((w) => w.id === workspace.id);
    assert.deepEqual(listed.rescan, { runId: 'auto-scan-r', pipelineId: 'abcd1234', paused: false });
    assert.deepEqual((await (await get(`/api/workspaces/${workspace.id}`)).json()).workspace.rescan, listed.rescan);
    // A paused automatic re-scan still owns the workspace (it resumes into it); a reloaded page
    // must show it paused, not spinning — its rescan-paused frame went out before the reload.
    Object.assign(runs.get('auto-scan-r'), { status: 'paused', orch: { workflowId: 'wf_workspace_scan' } });
    assert.deepEqual((await (await get(`/api/workspaces/${workspace.id}`)).json()).workspace.rescan,
      { runId: 'auto-scan-r', pipelineId: 'abcd1234', paused: true });
    runs.get('auto-scan-r').status = 'done';
    assert.equal((await (await get('/api/workspaces')).json()).workspaces.find((w) => w.id === workspace.id).rescan, undefined, 'gone once it ends');
  } finally { runs.delete('auto-scan-r'); }
});

test('a member change the scan cannot read skips the re-scan with the reason, and still applies', async () => {
  const a = await freshRepo();
  const b = await freshRepo();
  const { workspace } = await (await post('/api/workspaces', { name: 'Unscannable', projectPaths: [a, b] })).json();
  // A repository with no commit yet: createWorkspace accepts it, a scan never reads it (scan D5).
  const empty = await freshDir();
  spawnSync('git', ['init', '-q', '-b', 'main'], { cwd: empty });
  const r = await post(`/api/workspaces/${workspace.id}/members`, { add: [empty] });
  assert.equal(r.status, 200, await r.clone().text());
  const body = await r.json();
  assert.equal(body.workspace.projectPaths.length, 3);
  assert.match(body.rescan.skipped, /read-only workspace scan/);
});

test('a chained run that starts from the previous run\'s branches still fires after a member was added', async () => {
  const { createTicket, getTicket } = await import('../src/core/scheduler.mjs');
  const { seedPipelineRow } = await import('./helpers/db-seed.mjs');
  const { projectKey } = await import('../src/core/store.mjs');
  const a = await freshRepo();
  const b = await freshRepo();
  const c = await freshRepo();
  const { workspace } = await (await post('/api/workspaces', { name: 'Chained', projectPaths: [a, b] })).json();
  for (const d of [a, b]) spawnSync('git', ['branch', 'worca/prev-feature'], { cwd: d });
  seedPipelineRow({
    id: 'c0ffee01', projectKey: projectKey(a), workspaceKey: workspace.id, target: 'workspace', status: 'done',
    startedAt: new Date().toISOString(),
    workspaceMeta: { workspaceId: workspace.id, branches: { [projectKey(a)]: { feature: 'worca/prev-feature' }, [projectKey(b)]: { feature: 'worca/prev-feature' } } },
  });
  await post(`/api/workspaces/${workspace.id}/members`, { add: [c] });
  const t = createTicket({ workspaceId: workspace.id, after: { kind: 'pipeline', id: 'c0ffee01' }, afterPolicy: 'any', sourceFromPrevious: true,
    request: { workspaceId: workspace.id, prompt: 'next step', mock: true } });
  const out = await testing.fireTicket(getTicket(t.id, { withRequest: true }));
  assert.deepEqual(out, { ok: true }, 'the new member starts from its default branch instead of failing the ticket');
  for (const r of runs.values()) if (r.workspaceId === workspace.id && r.orch && r.kind !== 'scan') { try { r.orch.stop(); } catch { /* best-effort */ } }
});

test('a chained run still fires when a member\'s branch was dropped as unchanged (it starts from its source)', async () => {
  const { createTicket, getTicket } = await import('../src/core/scheduler.mjs');
  const { seedPipelineRow } = await import('./helpers/db-seed.mjs');
  const { projectKey } = await import('../src/core/store.mjs');
  const a = await freshRepo();
  const b = await freshRepo();
  const { workspace } = await (await post('/api/workspaces', { name: 'Dropped', projectPaths: [a, b] })).json();
  spawnSync('git', ['branch', 'worca/prev-kept'], { cwd: a });   // a changed: its branch exists
  // b changed nothing: teardown deleted 'worca/prev-dropped', so it does NOT exist in git.
  seedPipelineRow({
    id: 'c0ffee02', projectKey: projectKey(a), workspaceKey: workspace.id, target: 'workspace', status: 'done',
    startedAt: new Date().toISOString(),
    workspaceMeta: { workspaceId: workspace.id, branches: {
      [projectKey(a)]: { source: 'main', feature: 'worca/prev-kept', branchKept: true },
      [projectKey(b)]: { source: 'main', feature: 'worca/prev-dropped', branchKept: false,
        branchDeleted: { reason: 'unchanged', at: new Date().toISOString() } },
    } },
  });
  const t = createTicket({ workspaceId: workspace.id, after: { kind: 'pipeline', id: 'c0ffee02' }, afterPolicy: 'any', sourceFromPrevious: true,
    request: { workspaceId: workspace.id, prompt: 'next step', mock: true } });
  const out = await testing.fireTicket(getTicket(t.id, { withRequest: true }));
  assert.deepEqual(out, { ok: true }, 'the dropped member starts from main instead of failing the ticket');
  for (const r of runs.values()) if (r.workspaceId === workspace.id && r.orch && r.kind !== 'scan') { try { r.orch.stop(); } catch { /* best-effort */ } }
});

// ───────────────────────────────────────────────────────────────────────────
// POST /api/run — workspace target (§2.6)
// ───────────────────────────────────────────────────────────────────────────

test('POST /api/run workspace target validation: both/neither/no prompt -> 400, malformed/unknown workspaceId -> 404', async () => {
  const a = await freshRepo();
  const b = await freshRepo();
  const { workspace } = await (await post('/api/workspaces', { name: 'BothTarget', projectPaths: [a, b] })).json();
  const cases = [
    { name: 'POST /api/run with BOTH workspaceId and projectDir -> 400',
      body: { workspaceId: workspace.id, projectDir: a, prompt: 'x', mock: true }, status: 400, errorRe: /not both|workspaceId|projectDir/i },
    { name: 'POST /api/run with NEITHER workspaceId nor projectDir -> 400',
      body: { prompt: 'x', mock: true }, status: 400, errorRe: /workspaceId or projectDir/i },
    { name: 'POST /api/run with a malformed workspaceId -> 404',
      body: { workspaceId: 'not-a-ws-id', prompt: 'x', mock: true }, status: 404 },
    { name: 'POST /api/run with an unknown (well-formed) workspaceId -> 404',
      body: { workspaceId: 'wks-nope-00000000', prompt: 'x', mock: true }, status: 404 },
    { name: 'POST /api/run on a workspace requires a prompt -> 400',
      body: { workspaceId: workspace.id, mock: true }, status: 400, errorRe: /prompt/i },
  ];
  await checkRows(cases.map(({ name, body, status, errorRe }) => ({ name, run: async () => {
    const r = await post('/api/run', body);
    assert.equal(r.status, status);
    if (errorRe) assert.match((await r.json()).error, errorRe);
  } })));
});

test('POST /api/run on a workspace with a vanished or de-gitted member -> 400', async () => {
  await checkRows([
    { name: 'POST /api/run on a workspace with a vanished member -> 400 "workspace member path is missing"', run: async () => {
      const a = await freshRepo();
      const b = await freshRepo();
      const { workspace } = await (await post('/api/workspaces', { name: 'Vanish Run', projectPaths: [a, b] })).json();
      // Remove a member after creation; the run target requires the full set.
      await rm(b, { recursive: true, force: true });
      const r = await post('/api/run', { workspaceId: workspace.id, prompt: 'x', mock: true });
      assert.equal(r.status, 400);
      assert.match((await r.json()).error, /workspace member path is missing/i);
    } },
    { name: 'POST /api/run on a workspace whose member exists but is no longer a git repo -> 400', run: async () => {
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
    } },
  ]);
});

test('POST /api/run on a workspace rejects an option-injection sourceBranch (leading dash) -> 400', async () => {
  const a = await freshRepo();
  const b = await freshRepo();
  const { workspace } = await (await post('/api/workspaces', { name: 'Inject WS', projectPaths: [a, b] })).json();
  const r = await post('/api/run', { workspaceId: workspace.id, prompt: 'x', mock: true, sourceBranch: '--force' });
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /sourceBranch/i);
});

test('POST /api/run on a valid workspace returns {runId}, registers a workspace-run entry, and accepts an unknown sourceBranch (D2)', async () => {
  const a = await freshRepo();
  const b = await freshRepo();
  const { workspace } = await (await post('/api/workspaces', { name: 'Valid Run', projectPaths: [a, b] })).json();
  // A source ref that does not exist in any member is NOT rejected (the
  // orchestrator resolves each member's default branch at run time). This is the
  // single intentional divergence from the single-project line-320 guard.
  const r = await post('/api/run', { workspaceId: workspace.id, prompt: 'demo task', mock: true, sourceBranch: 'no-such-branch' });
  const { runId } = await r.json();
  await checkRows([
    { name: 'POST /api/run on a workspace does NOT pre-validate sourceBranch existence (D2 divergence)', run: () => {
      assert.equal(r.status, 200, 'a non-existent sourceBranch is accepted for a workspace run (D2)');
      assert.ok(runId);
    } },
    { name: 'POST /api/run on a valid workspace returns {runId} and registers a kind:"workspace-run" entry', run: () => {
      assert.equal(r.status, 200);
      assert.match(runId, /[0-9a-f-]{8,}/);

      // The route registered a workspace-run entry tagged with the workspace id and a
      // primary projectDir = projects[0].projectDir (lowest projectKey).
      const entry = runs.get(runId);
      assert.ok(entry, 'run is registered in the runs Map');
      assert.equal(entry.workspaceId, workspace.id);
      assert.ok(workspace.projectPaths.includes(entry.projectDir), 'projectDir is a member (the primary)');
    } },
  ]);
});

// ───────────────────────────────────────────────────────────────────────────
// summarizeRuns kind discriminator (the WS hello snapshot payload)
// ───────────────────────────────────────────────────────────────────────────

test('summarizeRuns carries a kind discriminator + workspaceId (no scanId)', async () => {
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
  // The off-pipeline scan and its scanId are retired: a scan is a workspace-run now.
  assert.ok(!('scanId' in byId['r-proj']));
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

test('GET /api/runs?workspaceId= lists stored and live workspace pipelines (other workspaces filtered); bad/unknown id -> 404', async () => {
  const { workspace, runId } = await seedWorkspaceWithPipeline('List WS Runs');
  await checkRows([
    { name: 'GET /api/runs?workspaceId= lists workspace-store pipelines; bad/unknown id -> 404', run: async () => {
      const r = await get(`/api/runs?workspaceId=${encodeURIComponent(workspace.id)}`);
      assert.equal(r.status, 200);
      const j = await r.json();
      assert.ok(Array.isArray(j.pipelines));
      assert.ok(j.pipelines.some((p) => p.id === runId), 'lists the seeded workspace pipeline');

      // Malformed / unknown workspaceId -> 404.
      assert.equal((await get('/api/runs?workspaceId=not-a-ws-id')).status, 404);
      assert.equal((await get('/api/runs?workspaceId=wks-nope-00000000')).status, 404);
    } },
    { name: 'GET /api/runs?workspaceId= includes live workspace runs filtered by workspaceId', run: async () => {
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
    } },
  ]);
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

test('DELETE /api/runs/:id?workspaceId= removes the pipeline dir + shared files; malformed workspaceId -> 404', async () => {
  await checkRows([
    { name: 'DELETE /api/runs/:id?workspaceId= removes the workspace pipeline dir + shared files', run: async () => {
      const { workspace, wsRoot, runId, pdir } = await seedWorkspaceWithPipeline('Delete WS Run');
      const r = await del(`/api/runs/${runId}?workspaceId=${encodeURIComponent(workspace.id)}`);
      assert.equal(r.status, 200);
      assert.equal(existsSync(pdir), false, 'pipeline dir removed');
      assert.equal(existsSync(join(wsRoot, 'plans', '04-06-26-ws-feature.md')), false, 'shared plan removed');
      assert.equal(existsSync(join(wsRoot, 'reviews', '04-06-26-ws-feature-impl-review.md')), false, 'shared review removed');
    } },
    { name: 'DELETE /api/runs/:id?workspaceId= with a malformed workspaceId -> 404', run: async () => {
      const r = await del('/api/runs/ww?workspaceId=not-a-ws-id');
      assert.equal(r.status, 404);
    } },
  ]);
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

test('GET /api/runs and DELETE /api/runs/:id 400 without projectDir/workspaceId', async () => {
  await checkRows([
    { name: 'regression: GET /api/runs?projectDir= still 400s without projectDir/workspaceId', run: async () => {
      const r = await get('/api/runs');
      assert.equal(r.status, 400);
    } },
    { name: 'regression: DELETE /api/runs/:id still 400s without any key', run: async () => {
      const r = await del('/api/runs/whatever');
      assert.equal(r.status, 400);
    } },
  ]);
});
