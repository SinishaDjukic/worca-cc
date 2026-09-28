// test/api-attribution-actions.test.mjs — attribution step 1 through the real server, with a
// trusted identity header standing in for a shared deployment's sign-in (identity.mjs):
// who paused / stopped / resumed a run, comment authors, "Run now" credits the clicker, Ask
// thread ownership, and per-person notification read state. Mock runs, no network.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { gitDir } from './helpers/git-dir.mjs';

useTempHome(after);

const H = 'X-Forwarded-Email';
const as = (who) => (who ? { [H]: who } : {});
let homeDir, prevHome, srv, base, runs, readPipeline;
const req = async (method, p, body, who) => {
  const r = await fetch(`${base}${p}`, { method, headers: { 'Content-Type': 'application/json', ...as(who) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  let j = null; try { j = await r.json(); } catch { /* empty */ }
  return { status: r.status, body: j };
};
async function until(fn, ms = 30000, what = 'condition') {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, 50)); }
  throw new Error(`timed out waiting for ${what}`);
}

before(async () => {
  homeDir = await mkdtemp(join(tmpdir(), 'worca-cc-attrib-act-'));
  prevHome = process.env.WORCA_HOME;
  process.env.WORCA_HOME = homeDir;
  process.env.WORCA_MOCK = '1';
  process.env.WORCA_IDENTITY_HEADER = H;
  const mod = await import('../ui/server.mjs');
  ({ runs } = mod);
  ({ readPipeline } = await import('../src/core/artifacts.mjs'));
  srv = http.createServer(mod.app);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
});
after(async () => {
  for (const e of runs.values()) { try { e.orch?.stop?.(); } catch { /* over */ } }
  if (srv) await new Promise((r) => srv.close(r));
  delete process.env.WORCA_MOCK;
  delete process.env.WORCA_IDENTITY_HEADER;
  if (prevHome === undefined) delete process.env.WORCA_HOME; else process.env.WORCA_HOME = prevHome;
  await rm(homeDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

test('pause, resume and stop record who did it; a paused run remembers after a reload; the starter survives a resume', async () => {
  const dir = gitDir('attrib-act');
  const { addProject } = await import('../src/core/projects.mjs');
  await addProject({ name: `attrib-act-${Date.now()}`, path: dir });   // resume maps the row back through the registry
  const start = await req('POST', '/api/run', { projectDir: dir, prompt: 'x', mock: true }, 'ada@example.com');
  assert.equal(start.status, 200, JSON.stringify(start.body));
  const runId = start.body.runId;
  const e = await until(() => { const x = runs.get(runId); return x?.orch?.state?.id && x.status === 'running' ? x : null; }, 30000, 'a running run');
  const pipelineId = e.orch.state.id;

  assert.equal((await req('POST', '/api/pause', { runId }, 'grace@example.com')).status, 200);
  assert.deepEqual({ kind: e.lastAction.kind, by: e.lastAction.by }, { kind: 'pause', by: 'grace@example.com' });
  await until(() => runs.get(runId)?.status === 'paused', 30000, 'paused');
  assert.equal(e.orch.state.lastAction.by, 'grace@example.com', 'on the run state (every state event carries it)');
  const snap = (await readPipeline(dir, pipelineId)).state;
  assert.equal(snap.lastAction.kind, 'pause');
  assert.equal(snap.lastAction.by, 'grace@example.com', 'persisted with the resume point');

  const res = await req('POST', '/api/resume', { pipelineId }, 'linus@example.com');
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const e2 = runs.get(res.body.runId);
  assert.equal(e2.startedBy, 'ada@example.com', 'a resumed run keeps its starter');
  assert.deepEqual({ kind: e2.lastAction.kind, by: e2.lastAction.by }, { kind: 'resume', by: 'linus@example.com' });
  await until(() => e2.orch?.state?.lastAction?.kind === 'resume', 30000, 'resume recorded on the state');

  await until(() => ['running', 'paused'].includes(runs.get(res.body.runId)?.status), 30000, 'the resumed run');
  assert.equal((await req('POST', '/api/stop', { runId: res.body.runId }, 'ada@example.com')).status, 200);
  assert.deepEqual({ kind: e2.lastAction.kind, by: e2.lastAction.by }, { kind: 'stop', by: 'ada@example.com' });
  const hello = (await import('../ui/server.mjs'))._testing.summarizeRuns().find((r) => r.runId === res.body.runId);
  assert.equal(hello.lastAction.by, 'ada@example.com', 'the hello snapshot carries it');
});

test('"Run now" credits whoever clicked it; the timer firing would credit the scheduler', async () => {
  const dir = gitDir('attrib-runnow');
  const when = new Date(Date.now() + 3 * 3600_000).toISOString();
  const sch = await req('POST', '/api/run', { projectDir: dir, prompt: 'later', mock: true, humanInLoop: false, scheduledFor: when }, 'ada@example.com');
  assert.equal(sch.status, 202, JSON.stringify(sch.body));
  const ticketId = sch.body.runId || sch.body.ticket?.id || sch.body.item?.id;
  assert.ok(ticketId, JSON.stringify(sch.body));
  const now = await req('POST', `/api/schedules/${ticketId}/run-now`, {}, 'grace@example.com');
  assert.equal(now.status, 200, JSON.stringify(now.body));
  const entry = await until(() => [...runs.values()].find((r) => r.ticketId === ticketId), 30000, 'the fired run');
  assert.equal(entry.startedBy, 'grace@example.com');
  try { entry.orch.stop(); } catch { /* over */ }
});

test('Ask threads: owned by their creator; others get 404; "delete all" deletes only your own', async () => {
  const a = (await req('POST', '/api/ask/threads', { title: 'Ada’s' }, 'ada@example.com')).body.thread;
  const g = (await req('POST', '/api/ask/threads', { title: 'Grace’s' }, 'grace@example.com')).body.thread;
  assert.equal(a.createdBy, 'ada@example.com');
  const listA = (await req('GET', '/api/ask/threads', null, 'ada@example.com')).body;
  assert.deepEqual(listA.threads.map((t) => t.id).filter((id) => id === a.id || id === g.id), [a.id]);
  assert.equal((await req('GET', `/api/ask/threads/${g.id}`, null, 'ada@example.com')).status, 404);
  assert.equal((await req('PATCH', `/api/ask/threads/${g.id}`, { title: 'mine now' }, 'ada@example.com')).status, 404);
  assert.equal((await req('DELETE', `/api/ask/threads/${g.id}`, null, 'ada@example.com')).status, 404);
  assert.equal((await req('GET', `/api/ask/threads/${g.id}`, null, 'grace@example.com')).status, 200);
  const cleared = (await req('DELETE', '/api/ask/threads', null, 'ada@example.com')).body;
  assert.equal(cleared.removed.threads, 1);
  assert.equal((await req('GET', `/api/ask/threads/${g.id}`, null, 'grace@example.com')).status, 200, 'Grace keeps hers');
  // No sign-in (local / operator): one person, everything visible as before.
  assert.equal((await req('GET', `/api/ask/threads/${g.id}`)).status, 200);
});

test('notifications: read state is per person on a shared deployment, global without a sign-in', async () => {
  const { addNotification } = await import('../src/core/notifications.mjs');
  const n = addNotification({ kind: 'failed', message: 'it failed', scheduleId: 'sch_00000001' });
  const unread = async (who) => (await req('GET', '/api/notifications', null, who)).body.unread;
  const before = await unread('ada@example.com');
  assert.ok(before >= 1);
  assert.equal((await req('POST', `/api/notifications/${n.id}/read`, {}, 'ada@example.com')).status, 200);
  assert.equal(await unread('ada@example.com'), before - 1, 'read for Ada');
  assert.equal(await unread('grace@example.com'), before, 'still unread for Grace');
  const list = (await req('GET', '/api/notifications', null, 'grace@example.com')).body.notifications;
  assert.equal(list.find((x) => x.id === n.id).unread, true);
  await req('POST', '/api/notifications/read-all', {}, 'grace@example.com');
  assert.equal(await unread('grace@example.com'), 0);
  assert.ok(await unread() >= 1, 'the global (local) state was never touched');
});

test('diff comments record their author; replies too; Ask stays nameless', async () => {
  const { addDiffComment, addDiffCommentReply } = await import('../src/core/diff-comments.mjs');
  const { seedPipelineRow } = await import('./helpers/db-seed.mjs');
  seedPipelineRow({ id: 'abcd0001', projectKey: 'k-00000001', startedAt: new Date().toISOString() });
  const PATCH = 'diff --git a/a.js b/a.js\n--- a/a.js\n+++ b/a.js\n@@ -1,2 +1,2 @@\n keep\n-old\n+new\n';
  const c = addDiffComment({ storeKey: 'k-00000001', pipelineId: 'abcd0001', patchText: PATCH, path: 'a.js', side: 'new', line: 2, body: 'why?', author: 'user', authorName: 'ada@example.com' });
  assert.equal(c.authorName, 'ada@example.com');
  const r = addDiffCommentReply({ parentId: c.id, body: 'because', author: 'user', authorName: 'grace@example.com' });
  assert.equal(r.authorName, 'grace@example.com');
  const askC = addDiffComment({ storeKey: 'k-00000001', pipelineId: 'abcd0001', patchText: PATCH, path: 'a.js', side: 'new', line: 2, body: 'note', author: 'ask', authorName: 'ada@example.com' });
  assert.equal(askC.authorName, null, 'an Ask comment is Worca\'s, never a person\'s');
  const bad = addDiffComment({ storeKey: 'k-00000001', pipelineId: 'abcd0001', patchText: PATCH, path: 'a.js', side: 'new', line: 2, body: 'x', author: 'user', authorName: 'a\nb' });
  assert.equal(bad.authorName, null);
});
