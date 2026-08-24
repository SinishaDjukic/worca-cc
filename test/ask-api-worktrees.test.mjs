// test/ask-api-worktrees.test.mjs
// P4/T7: worktrees over the HTTP surface — snapshot field, manual delete
// endpoint, thread-delete cascade leaving git clean. Boot recipe from
// ask-api-threads.test.mjs (temp home BEFORE the dynamic import).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';

useTempHome(after);

let homeDir, repoDir, srv, base, prevHome, projectKey, threadId, wt;

before(async () => {
  homeDir = await mkdtemp(join(tmpdir(), 'worca-cc-askwt-'));
  repoDir = await mkdtemp(join(tmpdir(), 'worca-cc-askwt-repo-'));
  const g = (args) => spawnSync('git', args, { cwd: repoDir });
  g(['init', '-q', '-b', 'main']);
  g(['config', 'user.email', 't@t']); g(['config', 'user.name', 't']);
  await writeFile(join(repoDir, 'README.md'), '# hi\n');
  g(['add', '-A']); g(['commit', '-qm', 'init']);
  prevHome = process.env.WORCA_HOME;
  process.env.WORCA_HOME = homeDir;
  process.env.WORCA_MOCK = '1';
  const mod = await import('../ui/server.mjs');
  srv = mod.server;
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
  const { addProject } = await import('../src/core/projects.mjs');
  // addProject returns the whole project ARRAY, not the row — pick the entry.
  projectKey = (await addProject({ name: 'askwt', path: repoDir })).find((x) => x.name === 'askwt').key;
});

after(async () => {
  if (srv) await Promise.race([
    new Promise((r) => { srv.close(r); srv.closeAllConnections?.(); }),
    new Promise((r) => { const t = setTimeout(r, 500); t.unref?.(); }),
  ]);
  if (prevHome === undefined) delete process.env.WORCA_HOME; else process.env.WORCA_HOME = prevHome;
  delete process.env.WORCA_MOCK;
  await rm(homeDir, { recursive: true, force: true });
  await rm(repoDir, { recursive: true, force: true });
});

test('snapshot carries worktrees; list rows carry the count', async () => {
  const { thread } = await (await fetch(`${base}/api/ask/threads`, { method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body: '{}' })).json();
  threadId = thread.id;
  const { openAskWorktree } = await import('../src/core/ask/worktrees.mjs');
  wt = await openAskWorktree({ threadId, projectKey, ref: 'main' });
  const snap = await (await fetch(`${base}/api/ask/threads/${threadId}`)).json();
  assert.deepEqual(Object.keys(snap).sort(), ['attachments', 'inFlight', 'messages', 'runLinks', 'thread', 'worktrees']);
  assert.equal(snap.worktrees.length, 1);
  assert.equal(snap.worktrees[0].worktreeId, wt.worktreeId);
  assert.equal(snap.worktrees[0].ref, 'main');
  // narrow envelope (same as list_worktrees) — NOT the full row (no threadId/projectDir/updatedAt):
  assert.deepEqual(Object.keys(snap.worktrees[0]).sort(), ['commit', 'createdAt', 'path', 'projectKey', 'ref', 'worktreeId']);
  const list = await (await fetch(`${base}/api/ask/threads`)).json();
  assert.equal(list.threads.find((t) => t.id === threadId).worktrees, 1);
});

test('DELETE worktree endpoint: 400 shape, 404 unknown, 200 removes disk + row', async () => {
  assert.equal((await fetch(`${base}/api/ask/threads/${threadId}/worktrees/bogus!`, { method: 'DELETE' })).status, 400);
  assert.equal((await fetch(`${base}/api/ask/threads/${threadId}/worktrees/wt_ffffffff`, { method: 'DELETE' })).status, 404);
  // Unknown THREAD → 404, and the BODY must say so: without asserting it, this case
  // is satisfied by the worktree-not-found branch too. Pins that the thread is
  // checked FIRST.
  const unknownThread = await fetch(`${base}/api/ask/threads/ask_ffffffff/worktrees/${wt.worktreeId}`, { method: 'DELETE' });
  assert.equal(unknownThread.status, 404);
  assert.equal((await unknownThread.json()).error, 'thread not found');
  const r = await fetch(`${base}/api/ask/threads/${threadId}/worktrees/${wt.worktreeId}`, { method: 'DELETE' });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).ok, true);
  assert.ok(!existsSync(wt.path));
  const snap = await (await fetch(`${base}/api/ask/threads/${threadId}`)).json();
  assert.deepEqual(snap.worktrees, []);
});

test('thread DELETE removes remaining worktrees git-properly', async () => {
  const { openAskWorktree } = await import('../src/core/ask/worktrees.mjs');
  const w2 = await openAskWorktree({ threadId, projectKey, ref: 'main' });
  const r = await fetch(`${base}/api/ask/threads/${threadId}`, { method: 'DELETE' });
  assert.equal(r.status, 200);
  assert.ok(!existsSync(w2.path));
  const porcelain = String(spawnSync('git', ['worktree', 'list', '--porcelain'], { cwd: repoDir }).stdout);
  assert.ok(!porcelain.includes('/wt/'), 'no stale registration in the source repo');
});
