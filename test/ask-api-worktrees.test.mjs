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
import { WebSocket } from 'ws';
import { useTempHome } from './helpers/temp-home.mjs';

useTempHome(after);

let homeDir, repoDir, srv, base, wsBase, prevHome, projectKey, threadId, wt;

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
  wsBase = `ws://127.0.0.1:${srv.address().port}/ws`;
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

function openWs() {
  const ws = new WebSocket(wsBase, { headers: { host: '127.0.0.1', origin: 'http://127.0.0.1' } });
  const msgs = [];
  ws.on('message', (d) => { try { msgs.push(JSON.parse(String(d))); } catch { /* ignore */ } });
  const opened = new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
  return { ws, msgs, opened };
}
function waitFor(pred, timeoutMs = 8000) {
  return new Promise((res, rej) => {
    const t0 = Date.now();
    (function tick() {
      const v = pred();
      if (v) return res(v);
      if (Date.now() - t0 > timeoutMs) return rej(new Error('waitFor timed out'));
      setTimeout(tick, 15);
    })();
  });
}
const wtFrames = (msgs, id) => msgs.filter((m) => m.type === 'ask-worktrees' && m.threadId === id);

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

test('DELETE worktree endpoint: 400 shape, 404 unknown, 200 removes disk + row and broadcasts ask-worktrees', async () => {
  const { ws, msgs, opened } = openWs();
  await opened;
  assert.equal((await fetch(`${base}/api/ask/threads/${threadId}/worktrees/bogus!`, { method: 'DELETE' })).status, 400);
  assert.equal((await fetch(`${base}/api/ask/threads/${threadId}/worktrees/wt_ffffffff`, { method: 'DELETE' })).status, 404);
  // Unknown THREAD → 404, and the BODY must say so: without asserting it, this case
  // is satisfied by the worktree-not-found branch too. Pins that the thread is
  // checked FIRST.
  const unknownThread = await fetch(`${base}/api/ask/threads/ask_ffffffff/worktrees/${wt.worktreeId}`, { method: 'DELETE' });
  assert.equal(unknownThread.status, 404);
  assert.equal((await unknownThread.json()).error, 'thread not found');
  assert.equal(wtFrames(msgs, threadId).length, 0, 'the refused deletes broadcast nothing');
  const r = await fetch(`${base}/api/ask/threads/${threadId}/worktrees/${wt.worktreeId}`, { method: 'DELETE' });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).ok, true);
  assert.ok(!existsSync(wt.path));
  const snap = await (await fetch(`${base}/api/ask/threads/${threadId}`)).json();
  assert.deepEqual(snap.worktrees, []);
  // Live count: the route broadcasts the thread's (now empty) envelope out-of-turn — seq-less, threadId-tagged.
  const frame = await waitFor(() => wtFrames(msgs, threadId)[0]);
  assert.deepEqual(frame, { type: 'ask-worktrees', threadId, worktrees: [] });
  assert.equal(wtFrames(msgs, threadId).length, 1, 'exactly one frame for one delete');
  ws.close();
});

test('emitAskWorktrees: the 6-key envelope for a live thread (same builder as the GET), nothing for a dead one', async () => {
  const mod = await import('../ui/server.mjs');
  const { openAskWorktree } = await import('../src/core/ask/worktrees.mjs');
  const { thread } = await (await fetch(`${base}/api/ask/threads`, { method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body: '{}' })).json();
  const w = await openAskWorktree({ threadId: thread.id, projectKey, ref: 'main' });
  const { ws, msgs, opened } = openWs();
  await opened;
  assert.equal(mod._testing.emitAskWorktrees(thread.id), true);
  const frame = await waitFor(() => wtFrames(msgs, thread.id)[0]);
  assert.equal(frame.worktrees.length, 1);
  assert.deepEqual(Object.keys(frame.worktrees[0]).sort(), ['commit', 'createdAt', 'path', 'projectKey', 'ref', 'worktreeId']);
  assert.equal(frame.worktrees[0].worktreeId, w.worktreeId);
  assert.equal(typeof frame.seq, 'undefined', 'out-of-turn: no seq, no messageId');
  assert.equal(typeof frame.messageId, 'undefined');
  const snap = await (await fetch(`${base}/api/ask/threads/${thread.id}`)).json();
  assert.deepEqual(snap.worktrees, frame.worktrees, 'the GET snapshot and the frame share ONE envelope builder');
  assert.deepEqual(mod._testing.askWorktreesEnvelope(thread.id), frame.worktrees);
  assert.equal(mod._testing.emitAskWorktrees('ask_ffffffff'), false, 'unknown thread: no frame');
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(msgs.filter((m) => m.type === 'ask-worktrees').length, 1);
  ws.close();
  assert.equal((await fetch(`${base}/api/ask/threads/${thread.id}`, { method: 'DELETE' })).status, 200);   // git stays clean for the next test
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

// Review of PR #376: DELETE captured the job BEFORE `await askRemoveThreadWorktrees`
// (real git spawns) and never re-checked, and POST /messages had no "deleting"
// guard — a turn started in that window survived the delete as a live job.
test('a message POST racing DELETE never starts a turn; nothing survives the delete', async () => {
  const http = await import('node:http');
  const JSONH = { 'Content-Type': 'application/json' };
  const raw = (method, p, b) => new Promise((resolve, reject) => {
    const data = b ? JSON.stringify(b) : '';
    const req = http.request(`${base}${p}`, { method, agent: false, headers: { ...JSONH, 'Content-Length': Buffer.byteLength(data) } }, (r) => {
      let s = ''; r.on('data', (c) => { s += c; }); r.on('end', () => resolve({ status: r.statusCode, text: s }));
    });
    req.on('error', reject); req.end(data);
  });
  const { thread } = await (await fetch(`${base}/api/ask/threads`, { method: 'POST', headers: JSONH, body: '{}' })).json();
  const { openAskWorktree } = await import('../src/core/ask/worktrees.mjs');
  await openAskWorktree({ threadId: thread.id, projectKey, ref: 'main' });   // gives DELETE a real await (git worktree remove)
  const mod = await import('../ui/server.mjs');
  const del = raw('DELETE', `/api/ask/threads/${thread.id}`);
  await new Promise((r) => setTimeout(r, 5));                                 // DELETE is now inside its git await
  const msg = await raw('POST', `/api/ask/threads/${thread.id}/messages`, { text: 'hi', model: 'claude-opus-5', effort: 'high' });
  assert.ok(msg.status === 409 || msg.status === 404, `POST during delete must be refused, got ${msg.status} ${msg.text}`);
  assert.equal((await del).status, 200);
  assert.equal(mod._testing.askJobs.has(thread.id), false, 'no live job survives the delete');
  assert.equal((await fetch(`${base}/api/ask/threads/${thread.id}`)).status, 404);
  assert.ok(!existsSync(join(homeDir, 'ask', thread.id)), 'thread dir gone');
});
