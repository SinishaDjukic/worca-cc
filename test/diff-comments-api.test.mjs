// test/diff-comments-api.test.mjs
// CRUD over both route families (the /api/history key regex forbids the slash in a
// workspace store key, so workspace runs need the twin), anchor validation, the
// no-patch gate, the counts endpoint, and the diff-comments-changed broadcast.
//
// Boot recipe: `mod.server`, NOT http.createServer(mod.app) — this suite opens a
// WebSocket and only the module's own server carries the path:'/ws' upgrade
// handler (test/ask-api-worktrees.test.mjs carries the same warning).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _resetForTests } from '../src/core/db.mjs';
import { writeStoreMeta } from '../src/core/artifacts.mjs';
import { seedPipeline, seedWorkspacePipeline } from './helpers/db-seed.mjs';

let home, prevHome, srv, base, mod, run, ws;

const PATCH = `diff --git a/src/a.js b/src/a.js
--- a/src/a.js
+++ b/src/a.js
@@ -1,3 +1,4 @@
 keep
-old
+new
+added
 line3
`;
const SECRET_PATCH = `diff --git a/.env b/.env
--- a/.env
+++ b/.env
@@ -1 +1 @@
-A=1
+A=2
`;

const j = async (path, init) => {
  const res = await fetch(base + path, init);
  let body = null;
  try { body = await res.json(); } catch { /* empty body */ }
  return { status: res.status, body };
};
const post = (path, obj) => j(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(obj) });
const patch = (path, obj) => j(path, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(obj) });
const del = (path) => j(path, { method: 'DELETE' });

before(async () => {
  home = await mkdtemp(join(tmpdir(), 'worca-cc-dcapi-'));
  prevHome = process.env.WORCA_HOME;
  process.env.WORCA_HOME = home;
  process.env.WORCA_MOCK = '1';
  _resetForTests();
  const projectDir = await mkdtemp(join(tmpdir(), 'worca-cc-dcapi-proj-'));
  const seeded = await seedPipeline(projectDir, { title: 'Run', status: 'done' });
  await writeFile(join(seeded.dir, 'diff-patch.patch'), PATCH + SECRET_PATCH, 'utf8');
  writeStoreMeta(seeded.key, 'project', { key: seeded.key, name: 'Alpha', path: projectDir });
  run = seeded;
  mod = await import('../ui/server.mjs');
  srv = mod.server;
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
});

after(async () => {
  try { ws?.close(); } catch { /* already closed */ }
  // BOUNDED close, the ask-api-worktrees.test.mjs recipe. server.close() does
  // NOT resolve while a socket is still attached, and this suite opens a real
  // WebSocket — `await new Promise((r) => srv.close(r))` on its own hangs the file
  // until the runner's timeout. Race it against an unref'd 500 ms timer and force
  // the sockets shut.
  if (srv) await Promise.race([
    new Promise((r) => { srv.close(r); srv.closeAllConnections?.(); }),
    new Promise((r) => { const t = setTimeout(r, 500); t.unref?.(); }),
  ]);
  mod?.runs?.clear();
  _resetForTests();
  if (prevHome === undefined) delete process.env.WORCA_HOME; else process.env.WORCA_HOME = prevHome;
  delete process.env.WORCA_MOCK;
  await rm(home, { recursive: true, force: true });
});

const url = (suffix = '') => `/api/history/${run.key}/${run.id}/comments${suffix}`;

test('POST -> GET: author user, line_text captured server-side, patchAvailable true', async () => {
  const created = await post(url(), { path: 'src/a.js', side: 'new', line: 3, body: 'needs a test' });
  assert.equal(created.status, 201);
  assert.match(created.body.comment.id, /^dc_[0-9a-f]{8}$/);
  assert.equal(created.body.comment.lineText, 'added');
  assert.equal(created.body.comment.author, 'user');
  const listed = await j(url());
  assert.equal(listed.status, 200);
  assert.equal(listed.body.patchAvailable, true);
  assert.deepEqual(listed.body.comments.map((c) => c.id), [created.body.comment.id]);
});

test('POST: anchor validation refuses a bad path/side/line with a 400 that says why', async () => {
  for (const [body, re] of [
    [{ path: 'ghost.js', side: 'new', line: 1, body: 'x' }, /not a file of this run's diff/],
    [{ path: 'src/a.js', side: 'sideways', line: 1, body: 'x' }, /side must be/],
    [{ path: 'src/a.js', side: 'new', line: 99, body: 'x' }, /no new-side line 99/],
    [{ path: 'src/a.js', side: 'old', line: 4, body: 'x' }, /no old-side line 4/],
    [{ path: 'src/a.js', side: 'new', line: 1, body: '' }, /body is required/],
    [{ path: 'src/a.js', side: 'new', line: 1, body: 'x'.repeat(4001) }, /exceeds 4000/],
    [{ path: '.env', side: 'new', line: 1, body: 'x' }, /protected path/],
    [{ path: 'src/a.js', side: 'new', line: 1, body: 'x', project: 'p-00000001' }, /single project/],
  ]) {
    const r = await post(url(), body);
    assert.equal(r.status, 400, JSON.stringify(body));
    assert.match(r.body.error, re, JSON.stringify(body));
  }
});

test('PATCH toggles, DELETE removes, unknown ids 404, malformed ids 400, bad body 400', async () => {
  const c = (await post(url(), { path: 'src/a.js', side: 'old', line: 2, body: 'why' })).body.comment;
  assert.equal((await patch(url(`/${c.id}`), { resolved: true })).body.comment.resolved, true);
  assert.equal((await patch(url(`/${c.id}`), { resolved: false })).body.comment.resolvedAt, null);
  assert.equal((await patch(url(`/${c.id}`), { resolved: 'yes' })).status, 400);
  assert.equal((await patch(url('/dc_00000000'), { resolved: true })).status, 404);
  assert.equal((await patch(url('/nope'), { resolved: true })).status, 400);
  assert.equal((await del(url(`/${c.id}`))).status, 200);
  assert.equal((await del(url(`/${c.id}`))).status, 404);
});

test("a comment of another run is never reachable through this run's URL", async () => {
  const otherDir = await mkdtemp(join(tmpdir(), 'worca-cc-dcapi-other-'));
  const other = await seedPipeline(otherDir, { title: 'Other', status: 'done' });
  await writeFile(join(other.dir, 'diff-patch.patch'), PATCH, 'utf8');
  const mine = (await post(`/api/history/${other.key}/${other.id}/comments`,
    { path: 'src/a.js', side: 'new', line: 1, body: 'elsewhere' })).body.comment;
  assert.equal((await del(url(`/${mine.id}`))).status, 404, 'scoped by (storeKey, pipelineId)');
  assert.equal((await patch(url(`/${mine.id}`), { resolved: true })).status, 404);
});

test('GET /api/diff-comments/counts is keyed "<storeKey>/<pipelineId>"', async () => {
  const c = (await post(url(), { path: 'src/a.js', side: 'new', line: 1, body: 'counted' })).body.comment;
  const r = await j('/api/diff-comments/counts');
  assert.equal(r.status, 200);
  assert.ok(r.body.counts[`${run.key}/${run.id}`] >= 1);
  await patch(url(`/${c.id}`), { resolved: true });
  const after2 = await j('/api/diff-comments/counts');
  assert.ok((after2.body.counts[`${run.key}/${run.id}`] ?? 0) < r.body.counts[`${run.key}/${run.id}`],
    'resolving lowers the count');
});

test('workspace runs go through the twin route (the history :key regex forbids the slash)', async () => {
  const wsDir = await mkdtemp(join(tmpdir(), 'worca-cc-dcapi-ws-'));
  const members = [{ projectKey: 'team-00000001', projectDir: wsDir, projectName: 'team' }];
  const seeded = await seedWorkspacePipeline(wsDir, 'wks-team-0000abcd',
    { title: 'WS run', status: 'done', workspaceName: 'Team' }, members);
  await writeFile(join(seeded.dir, 'diff-patch.patch'), `# team-00000001\n${PATCH}`, 'utf8');
  const wsUrl = `/api/workspaces/wks-team-0000abcd/runs/${seeded.id}/comments`;
  assert.match((await post(wsUrl, { path: 'src/a.js', side: 'new', line: 2, body: 'x' })).body.error,
    /workspace run/, 'the member project is required and never inferred');
  const ok = await post(wsUrl, { project: 'team-00000001', path: 'src/a.js', side: 'new', line: 2, body: 'x' });
  assert.equal(ok.status, 201);
  assert.equal(ok.body.comment.projectKey, 'team-00000001');
  assert.equal((await j(wsUrl)).body.comments.length, 1);
  assert.equal((await j(`/api/history/workspaces%2Fwks-team-0000abcd/${seeded.id}/comments`)).status, 404,
    'the slashed key can never reach the project route family');
});

test('a run with no patch: creation refused with 409, list still answers', async () => {
  // The archive path deletes comments outright (D1), so this covers the OTHER way a
  // run can be uncommentable: the artifact is simply not there.
  const dir = await mkdtemp(join(tmpdir(), 'worca-cc-dcapi-nopatch-'));
  const gone = await seedPipeline(dir, { title: 'Gone', status: 'done' });
  const goneUrl = `/api/history/${gone.key}/${gone.id}/comments`;
  const r = await post(goneUrl, { path: 'src/a.js', side: 'new', line: 1, body: 'x' });
  assert.equal(r.status, 409);
  assert.match(r.body.error, /no stored diff/);
  const listed = await j(goneUrl);
  assert.equal(listed.status, 200);
  assert.deepEqual(listed.body, { comments: [], patchAvailable: false, protectedPaths: [] });
});

test('GET reports the sections the protected-path floor will refuse', async () => {
  const listed = await j(url());
  assert.equal(listed.status, 200);
  assert.deepEqual(listed.body.protectedPaths, ['.env'],
    'SECTION KEYS, not globs — the secure preset never crosses the wire');
  // …and the floor really does refuse it, so the browser and the server agree.
  assert.match((await post(url(), { path: '.env', side: 'new', line: 1, body: 'x' })).body.error,
    /protected path/);
});

test('an unknown run 404s on every verb', async () => {
  const ghost = `/api/history/${run.key}/00000000/comments`;
  assert.equal((await j(ghost)).status, 404);
  assert.equal((await post(ghost, { path: 'src/a.js', side: 'new', line: 1, body: 'x' })).status, 404);
  assert.equal((await del(`${ghost}/dc_00000000`)).status, 404);
});

test('every mutation broadcasts diff-comments-changed with ids only', async () => {
  ws = new WebSocket(`ws://127.0.0.1:${srv.address().port}/ws`);
  const frames = [];
  ws.on('message', (d) => { try { frames.push(JSON.parse(String(d))); } catch { /* ignore */ } });
  await new Promise((r) => ws.on('open', r));
  const c = (await post(url(), { path: 'src/a.js', side: 'new', line: 4, body: 'poke' })).body.comment;
  await patch(url(`/${c.id}`), { resolved: true });
  await del(url(`/${c.id}`));
  const pokes = () => frames.filter((f) => f.type === 'diff-comments-changed');
  const deadline = Date.now() + 2000;
  while (pokes().length < 3 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 20));
  assert.equal(pokes().length, 3);
  assert.deepEqual(pokes()[0], { type: 'diff-comments-changed', storeKey: run.key, pipelineId: run.id });
});

test('emitDiffCommentsChanged resolves an id to its store key and pokes; an unknown id pokes nothing', async () => {
  // The MCP child's write lands in another process; this is the parent-side half of
  // that path (the reducer half is pinned in test/ask-events.test.mjs).
  const sock = new WebSocket(`ws://127.0.0.1:${srv.address().port}/ws`);
  const seen = [];
  sock.on('message', (d) => { try { seen.push(JSON.parse(String(d))); } catch { /* ignore */ } });
  await new Promise((r) => sock.on('open', r));
  assert.equal(mod._testing.emitDiffCommentsChanged('00000000'), false, 'unknown id: no row, no frame');
  assert.equal(mod._testing.emitDiffCommentsChanged(run.id), true);
  const pokes = () => seen.filter((f) => f.type === 'diff-comments-changed');
  const deadline = Date.now() + 2000;
  while (!pokes().length && Date.now() < deadline) await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(pokes(), [{ type: 'diff-comments-changed', storeKey: run.key, pipelineId: run.id }]);
  sock.close();
});
