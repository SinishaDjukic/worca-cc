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
import { checkRows } from './helpers/rows.mjs';

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

test('thread DELETE and bulk DELETE remove remaining worktrees git-properly (and the bulk route counts them)', async () => {
  await checkRows([
    { name: 'thread DELETE removes remaining worktrees git-properly', run: async () => {
      const { openAskWorktree } = await import('../src/core/ask/worktrees.mjs');
      const w2 = await openAskWorktree({ threadId, projectKey, ref: 'main' });
      const r = await fetch(`${base}/api/ask/threads/${threadId}`, { method: 'DELETE' });
      assert.equal(r.status, 200);
      assert.ok(!existsSync(w2.path));
      const porcelain = String(spawnSync('git', ['worktree', 'list', '--porcelain'], { cwd: repoDir }).stdout);
      assert.ok(!porcelain.includes('/wt/'), 'no stale registration in the source repo');
    } },
    { name: 'bulk DELETE /api/ask/threads removes every chat\'s worktrees git-properly and counts them', run: async () => {
      const JSONH = { 'Content-Type': 'application/json' };
      const { openAskWorktree } = await import('../src/core/ask/worktrees.mjs');
      const store = await import('../src/core/ask/store.mjs');
      const t1 = (await (await fetch(`${base}/api/ask/threads`, { method: 'POST', headers: JSONH, body: '{}' })).json()).thread;
      const t2 = (await (await fetch(`${base}/api/ask/threads`, { method: 'POST', headers: JSONH, body: '{}' })).json()).thread;
      const w1 = await openAskWorktree({ threadId: t1.id, projectKey, ref: 'main' });
      const w2 = await openAskWorktree({ threadId: t2.id, projectKey, ref: 'main' });
      const w3 = await openAskWorktree({ threadId: t2.id, projectKey, ref: 'main' });
      const hist = await (await fetch(`${base}/api/ask/history`)).json();
      assert.equal(hist.threads, store.countThreads());
      assert.equal(hist.worktrees, 3);
      const r = await fetch(`${base}/api/ask/threads`, { method: 'DELETE' });
      assert.equal(r.status, 200);
      const j = await r.json();
      assert.equal(j.ok, true);
      assert.equal(j.removed.threads, hist.threads);
      assert.equal(j.removed.worktrees, 3);
      assert.deepEqual(j.failed, []);
      for (const w of [w1, w2, w3]) assert.ok(!existsSync(w.path), `${w.path} gone`);
      const porcelain = String(spawnSync('git', ['worktree', 'list', '--porcelain'], { cwd: repoDir }).stdout);
      assert.ok(!porcelain.includes('/wt/'), 'no stale registration in the source repo');
      assert.equal(store.countThreads(), 0);
      assert.equal(store.countWorktrees(), 0);
    } },
  ]);
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
  const msg = await raw('POST', `/api/ask/threads/${thread.id}/messages`, { text: 'hi', model: 'claude-opus-5-5', effort: 'high' });
  assert.ok(msg.status === 409 || msg.status === 404, `POST during delete must be refused, got ${msg.status} ${msg.text}`);
  assert.equal((await del).status, 200);
  assert.equal(mod._testing.askJobs.has(thread.id), false, 'no live job survives the delete');
  assert.equal((await fetch(`${base}/api/ask/threads/${thread.id}`)).status, 404);
  assert.ok(!existsSync(join(homeDir, 'ask', thread.id)), 'thread dir gone');
});

// ── Settings › Chat › Checkouts: GET /api/ask/worktrees, POST …/free-idle, DELETE /api/ask/worktrees/:wtId ──
const DAY = 24 * 60 * 60_000;
const postJson = (path, body) => fetch(`${base}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) });
const delJson = (path, body, headers = {}) => fetch(`${base}${path}`, { method: 'DELETE', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body ?? {}) });

/** A chat holding one checkout of `main`, optionally owned by `createdBy`, aged `days` (the .git pointer's mtime too). */
async function seedCheckout({ days = 30, createdBy = null, title = 'holder' } = {}) {
  const { openAskWorktree } = await import('../src/core/ask/worktrees.mjs');
  const { createThread } = await import('../src/core/ask/store.mjs');
  const { prepare } = await import('../src/core/db.mjs');
  const { utimesSync } = await import('node:fs');
  const t = createThread({ title, createdBy });
  const w = await openAskWorktree({ threadId: t.id, projectKey, ref: 'main' });
  const at = Date.now() - days * DAY;
  prepare('UPDATE ask_worktrees SET created_at = ?, updated_at = ? WHERE id = ?').run(new Date(at).toISOString(), new Date(at).toISOString(), w.worktreeId);
  prepare('UPDATE ask_threads SET updated_at = ? WHERE id = ?').run(new Date(at).toISOString(), t.id);
  utimesSync(join(w.path, '.git'), at / 1000, at / 1000);
  return { t, w };
}
async function dropAllCheckouts() {
  const { prepare } = await import('../src/core/db.mjs');
  const { removeAskWorktree } = await import('../src/core/ask/worktrees.mjs');
  for (const r of prepare('SELECT thread_id, id FROM ask_worktrees').all()) await removeAskWorktree({ threadId: r.thread_id, wtId: r.id }).catch(() => {});
}

test('GET /api/ask/worktrees: capacity, used, idleDays and one verdict per checkout, never the folder path', async () => {
  const safe = await seedCheckout({ title: 'old and clean' });
  const dirty = await seedCheckout({ title: 'old and dirty' });
  await writeFile(join(dirty.w.path, 'wip.txt'), 'wip\n');
  const recent = await seedCheckout({ days: 0, title: 'fresh' });
  try {
    const r = await fetch(`${base}/api/ask/worktrees`);
    assert.equal(r.status, 200);
    const body = await r.json();
    assert.equal(body.capacity, 15);
    assert.equal(body.used, 3);
    assert.equal(body.idleDays, 7);
    const by = Object.fromEntries(body.items.map((i) => [i.title, i]));
    assert.equal(by['old and clean'].safe, true);
    assert.equal(by['old and dirty'].safe, false);
    assert.equal(by['old and dirty'].dirty, true);
    assert.deepEqual(by['old and dirty'].lost.dirtyFiles, ['wip.txt']);
    assert.equal(by['fresh'].recent, true);
    assert.equal(by['fresh'].loss, 'none');
    for (const i of body.items) {
      assert.equal(i.inUse, false);
      assert.equal(i.canDiscard, true);
      assert.equal(i.own, true);
      assert.equal(i.projectKey, projectKey);
      assert.equal(i.ref, 'main');
      assert.ok(i.worktreeId && i.threadId && i.createdAt && i.lastTouchedAt);
      assert.equal('path' in i, false);
    }
    assert.ok(body.items.indexOf(by['old and clean']) < body.items.indexOf(by['fresh']), 'oldest first');
    void safe; void recent;
  } finally { await dropAllCheckouts(); }
});

test('POST free-idle removes the safe checkout, keeps the dirty one, keeps the chat, broadcasts, and refuses a concurrent call', async () => {
  const { getThread } = await import('../src/core/ask/store.mjs');
  const safe = await seedCheckout({ title: 'safe one' });
  const dirty = await seedCheckout({ title: 'dirty one' });
  await writeFile(join(dirty.w.path, 'wip.txt'), 'wip\n');
  const { ws, msgs, opened } = openWs();
  await opened;
  try {
    const both = await Promise.all([postJson('/api/ask/worktrees/free-idle'), postJson('/api/ask/worktrees/free-idle')]);
    assert.deepEqual(both.map((x) => x.status).sort(), [200, 409]);
    assert.equal((await both.find((x) => x.status === 409).json()).code, 'CLEANUP_RUNNING');
    const body = await both.find((x) => x.status === 200).json();
    assert.deepEqual(body, { ok: true, freed: [safe.w.worktreeId], dropped: [], kept: 1, failed: 0 });
    assert.equal(existsSync(safe.w.path), false);
    assert.ok(existsSync(join(dirty.w.path, 'wip.txt')));
    assert.ok(getThread(safe.t.id), 'the chat survives');
    const frame = await waitFor(() => wtFrames(msgs, safe.t.id)[0]);
    assert.deepEqual(frame.worktrees, []);
    // the guard is released: a third call goes through
    assert.equal((await postJson('/api/ask/worktrees/free-idle')).status, 200);
  } finally { ws.close(); await dropAllCheckouts(); }
});

test('DELETE /api/ask/worktrees/:wtId: 400 shape, 404 unknown, a confirm bound to the fingerprint, then the chat can open a fresh checkout', async () => {
  const { getThread } = await import('../src/core/ask/store.mjs');
  const { openAskWorktree } = await import('../src/core/ask/worktrees.mjs');
  const c = await seedCheckout({ title: 'discard me' });
  await writeFile(join(c.w.path, 'wip.txt'), 'wip\n');
  try {
    assert.equal((await delJson('/api/ask/worktrees/bogus!')).status, 400);
    assert.equal((await delJson('/api/ask/worktrees/wt_ffffffff')).status, 404);
    const need = await delJson(`/api/ask/worktrees/${c.w.worktreeId}`);
    assert.equal(need.status, 409);
    const nb = await need.json();
    assert.equal(nb.code, 'CHECKOUT_NEEDS_CONFIRM');
    assert.deepEqual(nb.lost.dirtyFiles, ['wip.txt']);
    const stale = await delJson(`/api/ask/worktrees/${c.w.worktreeId}`, { discard: true, confirmFingerprint: 'stale' });
    assert.equal(stale.status, 409);
    assert.equal((await stale.json()).code, 'CHECKOUT_NEEDS_CONFIRM');
    assert.ok(existsSync(join(c.w.path, 'wip.txt')));
    const ok = await delJson(`/api/ask/worktrees/${c.w.worktreeId}`, { discard: true, confirmFingerprint: nb.lost.fingerprint });
    assert.equal(ok.status, 200);
    const okb = await ok.json();
    assert.equal(okb.ok, true);
    assert.deepEqual(okb.discarded.dirtyFiles, ['wip.txt']);
    assert.equal(existsSync(c.w.path), false);
    assert.ok(getThread(c.t.id), 'the chat survives');
    assert.ok(await openAskWorktree({ threadId: c.t.id, projectKey, ref: 'main' }), 'and can open a fresh checkout');
    // the model-facing thread-scoped delete is unchanged
    assert.equal((await fetch(`${base}/api/ask/threads/${c.t.id}/worktrees/wt_ffffffff`, { method: 'DELETE' })).status, 404);
  } finally { await dropAllCheckouts(); }
});

test('DELETE: a live turn or a live terminal in the checkout is 409 CHECKOUT_BUSY even with discard; a sibling dir with a shared prefix does not block', async () => {
  const mod = await import('../ui/server.mjs');
  const c = await seedCheckout({ title: 'busy' });
  const url = `/api/ask/worktrees/${c.w.worktreeId}`;
  try {
    mod._testing.askJobs.set(c.t.id, { status: 'running' });
    let r = await delJson(url, { discard: true, confirmFingerprint: 'x' });
    assert.equal(r.status, 409);
    assert.equal((await r.json()).code, 'CHECKOUT_BUSY');
    assert.ok(existsSync(c.w.path));
    mod._testing.askJobs.delete(c.t.id);

    const sessions = mod._testing.terminals.sessions;
    sessions.set('fake-term', { snap: { id: 'fake-term', status: 'running', cwd: join(c.w.path, 'src', 'deep') } });
    r = await delJson(url, { discard: true, confirmFingerprint: 'x' });
    assert.equal(r.status, 409);
    assert.equal((await r.json()).code, 'CHECKOUT_BUSY');
    assert.ok(existsSync(c.w.path));
    // a terminal in `<checkout>0`, a sibling sharing the prefix, is not in the checkout
    sessions.set('fake-term', { snap: { id: 'fake-term', status: 'running', cwd: `${c.w.path}0` } });
    r = await delJson(url, {});
    assert.equal(r.status, 200);
    assert.equal(existsSync(c.w.path), false);
  } finally {
    mod._testing.askJobs.delete(c.t.id);
    mod._testing.terminals.sessions.delete('fake-term');
    await dropAllCheckouts();
  }
});

test('two viewers: anyone removes a safe checkout, only the owner discards one with work, an ownerless chat is open to all', async () => {
  const prev = process.env.WORCA_IDENTITY_HEADER;
  const prevProxies = process.env.WORCA_IDENTITY_TRUSTED_PROXIES;
  process.env.WORCA_IDENTITY_HEADER = 'x-test-user';
  process.env.WORCA_IDENTITY_TRUSTED_PROXIES = '127.0.0.1,::1';
  const A = { 'x-test-user': 'ada@example.com' };
  const B = { 'x-test-user': 'bob@example.com' };
  try {
    const safe = await seedCheckout({ createdBy: 'ada@example.com', title: 'ada safe' });
    const dirty = await seedCheckout({ createdBy: 'ada@example.com', title: 'ada dirty' });
    const legacy = await seedCheckout({ createdBy: null, title: 'legacy dirty' });
    for (const c of [dirty, legacy]) await writeFile(join(c.w.path, 'wip.txt'), 'wip\n');

    const list = await (await fetch(`${base}/api/ask/worktrees`, { headers: B })).json();
    const by = Object.fromEntries(list.items.map((i) => [i.title, i]));
    assert.equal(by['ada dirty'].createdBy, 'ada@example.com');
    assert.equal(by['ada dirty'].canDiscard, false);
    assert.equal(by['ada dirty'].own, false);
    assert.equal(by['legacy dirty'].canDiscard, true);
    // B never sees what A's checkout holds: the chip flags stay, the file names and commit subjects do not
    assert.equal(by['ada dirty'].dirty, true);
    assert.deepEqual(by['ada dirty'].lost, { dirtyFiles: [], commits: [], truncated: false, fingerprint: '' });
    assert.deepEqual(by['legacy dirty'].lost.dirtyFiles, ['wip.txt']);

    // B: a safe checkout of A's goes; the chat stays
    assert.equal((await delJson(`/api/ask/worktrees/${safe.w.worktreeId}`, {}, B)).status, 200);
    // B: A's dirty checkout is refused with 403, even with a discard and a real fingerprint
    const real = (await (await delJson(`/api/ask/worktrees/${dirty.w.worktreeId}`, {}, A)).json()).lost.fingerprint;
    const refused = await delJson(`/api/ask/worktrees/${dirty.w.worktreeId}`, { discard: true, confirmFingerprint: real }, B);
    assert.equal(refused.status, 403);
    assert.equal((await refused.json()).code, 'CHECKOUT_NOT_OWNER');
    assert.ok(existsSync(join(dirty.w.path, 'wip.txt')));
    // A: discards their own, after the confirm
    const need = await delJson(`/api/ask/worktrees/${dirty.w.worktreeId}`, {}, A);
    assert.equal(need.status, 409);
    const lost = (await need.json()).lost;
    assert.equal((await delJson(`/api/ask/worktrees/${dirty.w.worktreeId}`, { discard: true, confirmFingerprint: lost.fingerprint }, A)).status, 200);
    // an ownerless legacy chat's dirty checkout: anyone may, with the confirm
    const lneed = await (await delJson(`/api/ask/worktrees/${legacy.w.worktreeId}`, {}, B)).json();
    assert.equal((await delJson(`/api/ask/worktrees/${legacy.w.worktreeId}`, { discard: true, confirmFingerprint: lneed.lost.fingerprint }, B)).status, 200);
  } finally {
    if (prev === undefined) delete process.env.WORCA_IDENTITY_HEADER; else process.env.WORCA_IDENTITY_HEADER = prev;
    if (prevProxies === undefined) delete process.env.WORCA_IDENTITY_TRUSTED_PROXIES; else process.env.WORCA_IDENTITY_TRUSTED_PROXIES = prevProxies;
    await dropAllCheckouts();
  }
});

test('a chat whose checkout is being removed refuses a new turn (409 CHECKOUT_REMOVING) until the claim is released', async () => {
  const mod = await import('../ui/server.mjs');
  const c = await seedCheckout({ title: 'being removed' });
  const send = () => postJson(`/api/ask/threads/${c.t.id}/messages`, { text: 'hi', model: 'claude-opus-5-5', effort: 'high' });
  try {
    mod._testing.askCheckoutClaim.claim(c.t.id);
    const r = await send();
    assert.equal(r.status, 409);
    assert.equal((await r.json()).code, 'CHECKOUT_REMOVING');
    // the claim also reads as live use to every other remover
    const del = await delJson(`/api/ask/worktrees/${c.w.worktreeId}`, {});
    assert.equal(del.status, 409);
    assert.equal((await del.json()).code, 'CHECKOUT_BUSY');
    assert.ok(existsSync(c.w.path));
    mod._testing.askCheckoutClaim.release(c.t.id);
    assert.notEqual((await send()).status, 409, 'released: the turn starts');
  } finally {
    mod._testing.askCheckoutClaim.release(c.t.id);
    await dropAllCheckouts();
  }
});
