// test/api-ask-directions.test.mjs — worca Chat P3 (R10): POST /api/ask/threads/:id/directions. The chat's "→ run" chip
// posts a direction to a run the thread follows through the in-process direction post, and the thread keeps it (a
// user row with a `direction` block + a system notice) so it survives a reload. A refusal persists nothing.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { useTempHome } from './helpers/temp-home.mjs';
import { seedPipeline } from './helpers/db-seed.mjs';
import { checkRows } from './helpers/rows.mjs';
import { _resetForTests as closeDbForTests } from '../src/core/db.mjs';
import { createThread, linkRun } from '../src/core/ask/store.mjs';

useTempHome(after);                       // WORCA_HOME is a temp dir from here on; db.mjs opens lazily
let mod, srv, base, wsBase;
const tmpDirs = [];
before(async () => {
  mod = await import('../ui/server.mjs');   // DYNAMIC: evaluated after useTempHome() ran
  srv = mod.server;
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
  wsBase = `ws://127.0.0.1:${srv.address().port}/ws`;
});
after(async () => {
  mod.runs.clear();
  if (srv) await Promise.race([new Promise((r) => { srv.close(r); srv.closeAllConnections?.(); }), new Promise((r) => { const t = setTimeout(r, 500); t.unref?.(); })]);
  closeDbForTests();
  for (const d of tmpDirs) await rm(d, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }).catch(() => {});
});
async function projectDir() { const d = await mkdtemp(join(tmpdir(), 'worca-cc-ask-dir-')); tmpDirs.push(d); return d; }
const post = (p, body) => fetch(`${base}${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const snapshot = async (id) => (await fetch(`${base}/api/ask/threads/${id}`)).json();
function openWs() {
  const ws = new WebSocket(wsBase, { headers: { host: '127.0.0.1', origin: 'http://127.0.0.1' } });
  const msgs = [];
  ws.on('message', (d) => { try { msgs.push(JSON.parse(String(d))); } catch { /* ignore */ } });
  const opened = new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
  return { ws, msgs, opened };
}
function waitFor(pred, timeoutMs = 3000) {
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

test('a direction to a followed run: 201, posted to the run, kept in the thread as a user row + a notice, broadcast to every tab', async () => {
  const { id: pid, dir } = await seedPipeline(await projectDir(), { title: 'Fix login', status: 'paused', steps: [] });
  const t = createThread();
  linkRun(t.id, { runId: pid, pipelineId: pid, status: 'paused' });
  const { ws, msgs, opened } = openWs();
  await opened;
  const res = await post(`/api/ask/threads/${t.id}/directions`, { runId: pid, text: '  Use the blue button  ' });
  assert.equal(res.status, 201);
  const body = await res.json();
  assert.match(body.id, /^d[a-z0-9]+$/);
  assert.match(await readFile(join(dir, 'directions.ndjson'), 'utf8'), /Use the blue button/, 'the run reads it on its next step');
  const snap = await snapshot(t.id);
  const user = snap.messages.find((m) => m.role === 'user');
  const notice = snap.messages.find((m) => m.role === 'system');
  assert.equal(user.text, `Direction to #${pid}: Use the blue button`, 'the label rides in the text (bubble + restored prompt)');
  assert.deepEqual(user.blocks, [{ kind: 'direction', id: body.id, runId: pid, pipelineId: pid, title: 'Fix login', label: `Direction to #${pid}` }]);
  assert.match(await readFile(join(dir, 'directions.ndjson'), 'utf8'), /"source":"chat"/, 'a chat direction is sourced `chat`');
  assert.equal(notice.text, 'Direction sent to “Fix login” · the next step reads it');
  assert.deepEqual(notice.blocks, [{ kind: 'notice', text: 'Direction sent to “Fix login” · the next step reads it' }]);
  assert.ok(user.seq < notice.seq, 'the bubble, then the note');
  assert.deepEqual([body.message.id, body.notice.id], [user.id, notice.id]);
  const frames = await waitFor(() => { const f = msgs.filter((m) => m.type === 'ask-message' && m.threadId === t.id); return f.length >= 2 ? f : null; });
  assert.deepEqual(frames.map((f) => f.message.id), [user.id, notice.id]);
  assert.equal(frames.some((f) => typeof f.seq === 'number'), false, 'out-of-turn frames: no top-level seq');
  ws.close();
});

test('a live run goes through its orchestrator; the link may name the run by its live id', async () => {
  const { id: pid } = await seedPipeline(await projectDir(), { title: 'Live run', status: 'running', steps: [] });
  const got = [];
  const orch = Object.assign(new EventEmitter(), { direct: async (text, source) => { got.push([text, source]); return { id: 'dlive0001', ts: new Date().toISOString(), source, text }; } });
  mod.runs.set('uuid-LIVE-0001', { id: 'uuid-LIVE-0001', orch, pipelineId: pid, kind: 'run', status: 'running', title: 'Live run', projectDir: '/tmp/x',
    startedAt: new Date().toISOString(), events: [], pendingQuestion: null });
  try {
    const t = createThread();
    linkRun(t.id, { runId: 'uuid-LIVE-0001', status: 'running' });
    const res = await post(`/api/ask/threads/${t.id}/directions`, { runId: 'uuid-LIVE-0001', text: 'Go' });
    assert.equal(res.status, 201);
    assert.equal((await res.json()).id, 'dlive0001');
    assert.deepEqual(got, [['Go', 'chat']]);
    const user = (await snapshot(t.id)).messages.find((m) => m.role === 'user');
    assert.equal(user.blocks[0].pipelineId, pid, 'the pipeline id resolved through the live entry');
  } finally {
    mod.runs.delete('uuid-LIVE-0001');
  }
});

test('refusals persist nothing: bad input 400, an unknown thread or a run the chat does not follow 404, a finished or unstarted run 409', async () => {
  const { id: done } = await seedPipeline(await projectDir(), { title: 'Done', status: 'done', steps: [] });
  const { id: other } = await seedPipeline(await projectDir(), { title: 'Other', status: 'paused', steps: [] });
  const t = createThread();
  linkRun(t.id, { runId: done, pipelineId: done, status: 'done' });
  linkRun(t.id, { runId: 'uuid-PENDING-0001', status: 'starting' });
  const call = async (path, body) => { const r = await post(path, body); return { status: r.status, body: await r.json() }; };
  const at = `/api/ask/threads/${t.id}/directions`;
  await checkRows([
    { name: '400s', run: async () => {
      assert.deepEqual(await call('/api/ask/threads/nope/directions', { runId: done, text: 'x' }), { status: 400, body: { error: 'invalid thread id' } });
      assert.deepEqual(await call(at, { text: 'x' }), { status: 400, body: { error: 'runId is required' } });
      assert.deepEqual(await call(at, { runId: done }), { status: 400, body: { error: 'text is required' } });
      assert.deepEqual(await call(at, { runId: done, text: '   ' }), { status: 400, body: { error: 'text is required' } });
      assert.deepEqual(await call(at, { runId: done, text: 7 }), { status: 400, body: { error: 'text must be a string' } });
      assert.deepEqual(await call(at, { runId: done, text: 'x'.repeat(4001) }), { status: 400, body: { error: 'text must be at most 4000 characters' } });
    } },
    { name: '404s', run: async () => {
      assert.deepEqual(await call('/api/ask/threads/ask_00000000/directions', { runId: done, text: 'x' }), { status: 404, body: { error: 'thread not found' } });
      assert.deepEqual(await call(at, { runId: other, text: 'x' }), { status: 404, body: { error: 'this chat does not follow that run' } });
    } },
    { name: '409s', run: async () => {
      const finished = await call(at, { runId: done, text: 'x' });
      assert.equal(finished.status, 409);
      assert.equal(finished.body.code, 'RUN_FINISHED');
      assert.match(finished.body.error, /never be read/);
      assert.deepEqual(await call(at, { runId: 'uuid-PENDING-0001', text: 'x' }), { status: 409, body: { error: 'the run has not started yet', code: 'NOT_STARTED' } });
    } },
    { name: 'nothing was appended', run: async () => {
      assert.deepEqual((await snapshot(t.id)).messages, []);
    } },
  ]);
});

test('the chip\'s own shape: a run linked by its live UUID AND its pipeline id is reached by the PIPELINE id; 4000 characters is allowed; a thread being deleted refuses and keeps nothing', async () => {
  const { id: pid } = await seedPipeline(await projectDir(), { title: 'Live run 2', status: 'running', steps: [] });
  const got = [];
  const orch = Object.assign(new EventEmitter(), { direct: async (text, source) => { got.push([text, source]); return { id: 'dlive0002', ts: new Date().toISOString(), source, text }; } });
  mod.runs.set('uuid-LIVE-0002', { id: 'uuid-LIVE-0002', orch, pipelineId: pid, kind: 'run', status: 'running', title: 'Live run 2', projectDir: '/tmp/x',
    startedAt: new Date().toISOString(), events: [], pendingQuestion: null });
  try {
    const t = createThread();
    linkRun(t.id, { runId: 'uuid-LIVE-0002', pipelineId: pid, status: 'running' });   // track_run / a resumed link: live UUID + pipeline id
    const res = await post(`/api/ask/threads/${t.id}/directions`, { runId: pid, text: 'x'.repeat(4000) });   // what the chip sends
    assert.equal(res.status, 201);
    assert.equal(got.length, 1);
    const user = (await snapshot(t.id)).messages.find((m) => m.role === 'user');
    assert.deepEqual([user.blocks[0].runId, user.blocks[0].pipelineId], ['uuid-LIVE-0002', pid]);
    const t2 = createThread();
    linkRun(t2.id, { runId: 'uuid-LIVE-0002', pipelineId: pid, status: 'running' });
    mod._testing.askDeleting.add(t2.id);
    try {
      const r2 = await post(`/api/ask/threads/${t2.id}/directions`, { runId: pid, text: 'y' });
      assert.deepEqual([r2.status, (await r2.json()).error], [409, 'thread is being deleted']);
    } finally { mod._testing.askDeleting.delete(t2.id); }
    assert.equal(got.length, 1, 'nothing posted for the deleting thread');
    assert.deepEqual((await snapshot(t2.id)).messages, []);
  } finally {
    mod.runs.delete('uuid-LIVE-0002');
  }
});

test('a link the follower has not filled in yet (live UUID, no pipeline id) is reached by the pipeline id the chip sends', async () => {
  const { id: pid } = await seedPipeline(await projectDir(), { title: 'Fresh run', status: 'running', steps: [] });
  const got = [];
  const orch = Object.assign(new EventEmitter(), { direct: async (text, source) => { got.push([text, source]); return { id: 'dlive0003', ts: new Date().toISOString(), source, text }; } });
  mod.runs.set('uuid-LIVE-0003', { id: 'uuid-LIVE-0003', orch, pipelineId: pid, kind: 'run', status: 'running', title: 'Fresh run', projectDir: '/tmp/x',
    startedAt: new Date().toISOString(), events: [], pendingQuestion: null });
  try {
    const t = createThread();
    linkRun(t.id, { runId: 'uuid-LIVE-0003', status: 'running' });                     // a proposal launch: no pipeline id yet
    const res = await post(`/api/ask/threads/${t.id}/directions`, { runId: pid, text: 'Go' });
    assert.equal(res.status, 201);
    assert.deepEqual(got, [['Go', 'chat']]);
  } finally {
    mod.runs.delete('uuid-LIVE-0003');
  }
});

test('a thread write that fails after the run took the direction still answers 201 — a "Not sent" would make the user post it twice', async () => {
  const { deleteThread } = await import('../src/core/ask/store.mjs');
  const { id: pid } = await seedPipeline(await projectDir(), { title: 'Live run 4', status: 'running', steps: [] });
  let tid = null;
  const got = [];
  // the chat is deleted while the run takes the direction: the thread rows can no longer be written
  const orch = Object.assign(new EventEmitter(), { direct: async (text, source) => { got.push(text); deleteThread(tid); return { id: 'dlive0004', ts: new Date().toISOString(), source, text }; } });
  mod.runs.set('uuid-LIVE-0004', { id: 'uuid-LIVE-0004', orch, pipelineId: pid, kind: 'run', status: 'running', title: 'Live run 4', projectDir: '/tmp/x',
    startedAt: new Date().toISOString(), events: [], pendingQuestion: null });
  try {
    tid = createThread().id;
    linkRun(tid, { runId: 'uuid-LIVE-0004', pipelineId: pid, status: 'running' });
    const res = await post(`/api/ask/threads/${tid}/directions`, { runId: pid, text: 'Go' });
    assert.equal(res.status, 201);
    assert.deepEqual(await res.json(), { id: 'dlive0004', message: null, notice: null });
    assert.deepEqual(got, ['Go']);
  } finally {
    mod.runs.delete('uuid-LIVE-0004');
  }
});
