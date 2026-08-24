// test/history-api.test.mjs
// Phase 3.7 — the server's /api/history + /api/history/:key/:id routes now read
// the DB (listAllPipelines / readPipelineByKey). Fixtures seed pipelines rows via the
// production writers (seedPipeline -> createPipeline + writeState) + store_meta
// (writeStoreMeta) instead of state.json / meta.json files. The response shapes are
// unchanged. Keys/ids are content-derived/minted (A15(3)) — assert on the RETURNED
// key/id (kept in module vars), not the legacy literal labels.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _testing as gitInfo } from '../src/core/git-info.mjs';
import { _resetForTests } from '../src/core/db.mjs';
import { writeStoreMeta } from '../src/core/artifacts.mjs';
import { writeClarify, writeReview } from '../src/core/artifacts.mjs';
import { seedPipeline, seedWorkspacePipeline } from './helpers/db-seed.mjs';

let homeDir, srv, base, prevHome, alphaKey, alphaId, alphaDir, proj;

// The server shares the git-info runner singleton; reset it (and the hasGh memo)
// before each test so a stub from one test never bleeds into the next.
beforeEach(() => gitInfo.reset());

before(async () => {
  homeDir = await mkdtemp(join(tmpdir(), 'worca-cc-histapi-'));
  prevHome = process.env.WORCA_HOME;
  process.env.WORCA_HOME = homeDir;
  _resetForTests(); // open the DB under this temp home
  // Seed via the production writer; pin the store_meta name to 'Alpha' so the
  // projectName assertion is deterministic (createPipeline's ensureMeta would derive
  // the temp-dir basename otherwise).
  proj = await mkdtemp(join(tmpdir(), 'worca-cc-histapi-proj-'));
  const seeded = await seedPipeline(proj, { title: 'Alpha run', status: 'done',
    startedAt: '2026-06-01T00:00:00Z', updatedAt: '2026-06-01T00:00:00Z' });
  alphaId = seeded.id; alphaKey = seeded.key; alphaDir = seeded.dir;
  writeStoreMeta(alphaKey, 'project', { key: alphaKey, name: 'Alpha', path: proj });
  const { app } = await import('../ui/server.mjs');
  srv = http.createServer(app);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
});

after(async () => {
  if (srv) await new Promise((r) => srv.close(r));
  _resetForTests();
  if (prevHome === undefined) delete process.env.WORCA_HOME; else process.env.WORCA_HOME = prevHome;
  await rm(homeDir, { recursive: true, force: true });
});

test('GET /api/history lists pipelines across the store', async () => {
  const r = await fetch(`${base}/api/history`);
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.pipelines.length, 1);
  assert.equal(j.pipelines[0].projectName, 'Alpha');
  assert.equal(j.pipelines[0].projectKey, alphaKey);
});

test('GET /api/history/:key/:id returns detail; unknown -> 404', async () => {
  const r = await fetch(`${base}/api/history/${alphaKey}/${alphaId}`);
  assert.equal(r.status, 200);
  assert.equal((await r.json()).state.title, 'Alpha run');
  assert.equal((await fetch(`${base}/api/history/${alphaKey}/nope`)).status, 404);
});

test('GET /api/history/:key/:id rejects a traversing/malformed key -> 404', async () => {
  for (const bad of ['..%2f..%2fevil', '..%2f..%2fetc', 'not-a-key', 'abc/def']) {
    const r = await fetch(`${base}/api/history/${bad}/x`);
    assert.equal(r.status, 404, `key ${bad} must be rejected`);
  }
});

test('GET /api/history is PR-light: rows carry no `pr` field and `gh pr list` never runs', async () => {
  // Seed a surviving-branch pipeline so the OLD withPr:true path WOULD have run gh.
  const branchProj = await mkdtemp(join(tmpdir(), 'worca-cc-histapi-branch-'));
  const { id: branchId } = await seedPipeline(branchProj, { title: 'Branchy', status: 'done',
    startedAt: '2026-06-03T00:00:00Z', updatedAt: '2026-06-03T00:00:00Z',
    branch: { source: 'main', feature: 'worca-cc/feat-x' } });
  let prListCalled = false;
  gitInfo.setRunner((cmd, args) => {
    if (cmd === 'gh' && args[0] === 'pr' && args[1] === 'list') prListCalled = true;
    if (cmd === 'gh' && args[0] === '--version') return Promise.resolve({ ok: true, stdout: 'gh 2.x', stderr: '', code: 0 });
    if (cmd === 'git' && args[0] === 'rev-parse') return Promise.resolve({ ok: true, stdout: 'ref\n', stderr: '', code: 0 });
    return Promise.resolve({ ok: true, stdout: '', stderr: '', code: 0 });
  });
  const r = await fetch(`${base}/api/history`);
  assert.equal(r.status, 200);
  const j = await r.json();
  const row = j.pipelines.find((p) => p.id === branchId);
  assert.ok(row, 'branch pipeline present in the skeleton');
  assert.equal('pr' in row, false, 'Phase-1 skeleton omits the live `pr` field');
  assert.equal(prListCalled, false, '`gh pr list` must not run on /api/history');
});

test('POST /api/history/pr returns 200 {ok:true} and leaks no gh work', async () => {
  // Stub gh OFF so the post-response enrichPipelinesPr walk short-circuits to one
  // terminal (empty) batch and never spawns a real gh into the next test.
  gitInfo.setRunner((cmd) => Promise.resolve(
    cmd === 'gh' ? { ok: false, stdout: '', stderr: '', code: 1 }
                 : { ok: true, stdout: '', stderr: '', code: 0 }));
  const r = await fetch(`${base}/api/history/pr`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: 7 }),
  });
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true });
});

// ── M1.2 — detail endpoint surfaces clarify + reviews from the DB ────────────────
test('GET /api/history/:key/:id includes clarify Q&A and per-cycle reviews', async () => {
  // alphaId/alphaKey were seeded in `before` via the production writer; write its extras.
  await writeClarify(alphaId, {
    questions: { questions: [{ id: 'q1', question: 'Postgres or SQLite?', options: ['pg', 'sqlite', ''], allowFreeText: true }] },
  });
  await writeClarify(alphaId, {
    answers: { answers: [{ id: 'q1', question: 'Postgres or SQLite?', choice: 'sqlite' }] },
  });
  await writeReview(alphaId, 'impl', 1, {
    issues: [{ severity: 'major', title: 'Missing null-check', detail: 'guard the input', location: 'src/x.mjs:10' }],
    summary: 'one blocking issue',
  });
  await writeReview(alphaId, 'impl', 2, { issues: [], summary: 'resolved' });

  const r = await fetch(`${base}/api/history/${alphaKey}/${alphaId}`);
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.clarify.questions[0].question, 'Postgres or SQLite?');
  assert.equal(j.clarify.answers[0].choice, 'sqlite');
  assert.deepEqual(j.reviews.map((x) => [x.kind, x.cycle]), [['impl', 1], ['impl', 2]]);
  assert.equal(j.reviews[0].issues[0].severity, 'major');
  assert.equal(j.reviews[0].issues[0].location, 'src/x.mjs:10');
});

// ── Task 2 — inline diff-patch routes ────────────────────────────────────────────
test('GET /api/history/:key/:id/diff serves the persisted patch inline', async () => {
  const patch = 'diff --git a/x.js b/x.js\n--- a/x.js\n+++ b/x.js\n@@ -1 +1 @@\n-a\n+b\n';
  await writeFile(join(alphaDir, 'diff-patch.patch'), patch);
  const r = await fetch(`${base}/api/history/${alphaKey}/${alphaId}/diff`);
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /text\/x-diff/); // express appends "; charset=utf-8"
  assert.equal(r.headers.get('content-disposition'), null);    // inline, not attachment
  assert.equal(await r.text(), patch);

  // A zero-length patch is a real (rare) outcome — diffPatch() returns '' when git
  // fails and persistDiffPatch writes it verbatim. readRunArtifactText answers ''
  // (which is != null), so this must be 200 + empty body, NOT 404: an empty patch
  // is not a missing artifact.
  await writeFile(join(alphaDir, 'diff-patch.patch'), '');
  const empty = await fetch(`${base}/api/history/${alphaKey}/${alphaId}/diff`);
  assert.equal(empty.status, 200);
  assert.equal(await empty.text(), '');
});

// The route is status-agnostic and always was; this pins that, because the
// orchestrator now persists the artifact on the stopped/error paths too and the
// Diff tab for those runs depends on the route serving it.
test('GET /api/history/:key/:id/diff serves the patch for a STOPPED run', async () => {
  const stoppedProj = await mkdtemp(join(tmpdir(), 'worca-cc-histapi-stopped-'));
  const seeded = await seedPipeline(stoppedProj, { title: 'Halted', status: 'stopped',
    startedAt: '2026-06-04T00:00:00Z', updatedAt: '2026-06-04T00:00:00Z' });

  // Absent artifact first: a stopped run with no patch must still 404, not 200-empty.
  assert.equal((await fetch(`${base}/api/history/${seeded.key}/${seeded.id}/diff`)).status, 404);

  const patch = 'diff --git a/p.js b/p.js\n--- a/p.js\n+++ b/p.js\n@@ -1 +1 @@\n-a\n+partial\n';
  await writeFile(join(seeded.dir, 'diff-patch.patch'), patch);
  const r = await fetch(`${base}/api/history/${seeded.key}/${seeded.id}/diff`);
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /text\/x-diff/);
  assert.equal(await r.text(), patch);
});

test('GET /api/history/:key/:id/diff -> 404 when absent / malformed key', async () => {
  assert.equal((await fetch(`${base}/api/history/${alphaKey}/no-such-id/diff`)).status, 404);
  assert.equal((await fetch(`${base}/api/history/..%2fevil/x/diff`)).status, 404);
});

test('workspace /diff route: key validation + concatenated patch round-trip', async () => {
  assert.equal((await fetch(`${base}/api/workspaces/..%2fevil/runs/x/diff`)).status, 404);

  // seedWorkspacePipeline(primaryDir, workspaceKey, state, projects) -> { id, dir }
  // (no `key` in the return, unlike seedPipeline's { id, dir, key }).
  const wk = 'wks-team-a-00000001';
  const seeded = await seedWorkspacePipeline(
    proj, wk, { title: 'ws run', status: 'done' },
    [{ projectKey: alphaKey, projectDir: proj, projectName: 'alpha' }],
  );
  // Byte-for-byte the shape the workspace-marker parsing consumes
  // (orchestrator.mjs:3443 joins members as `# <projectKey>\n<patch>` with '\n\n').
  const patch = `# ${alphaKey}\ndiff --git a/a.js b/a.js\n--- a/a.js\n+++ b/a.js\n@@ -1 +1 @@\n-x\n+y\n`;
  await writeFile(join(seeded.dir, 'diff-patch.patch'), patch);
  const r = await fetch(`${base}/api/workspaces/${wk}/runs/${seeded.id}/diff`);
  assert.equal(r.status, 200);
  assert.equal(await r.text(), patch);
});
