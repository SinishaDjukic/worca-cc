// Thread CRUD + models + attachment download + hello.ask + boot sweeps.
// Boot = the agentgen-api recipe (temp home BEFORE the dynamic import; listen
// on the MODULE server so /ws upgrades work).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';

import { useTempHome } from './helpers/temp-home.mjs';

useTempHome(after);

let homeDir, srv, base, wsBase, mod, prevHome;
const JSONH = { 'Content-Type': 'application/json' };

before(async () => {
  homeDir = await mkdtemp(join(tmpdir(), 'worca-cc-askthreads-'));
  prevHome = process.env.WORCA_HOME;
  process.env.WORCA_HOME = homeDir;
  process.env.WORCA_MOCK = '1';
  mod = await import('../ui/server.mjs');
  srv = mod.server;
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const port = srv.address().port;
  base = `http://127.0.0.1:${port}`;
  wsBase = `ws://127.0.0.1:${port}/ws`;
});

after(async () => {
  if (srv) {
    // A RED WS test never reaches ws.close(), and an upgraded socket is NOT
    // destroyed by closeAllConnections() — server.close()'s callback then never
    // fires and the file hangs in teardown. Bound the wait so the failures
    // actually print (pair the red run with --test-force-exit).
    await Promise.race([
      new Promise((r) => { srv.close(r); srv.closeAllConnections?.(); }),
      new Promise((r) => { const t = setTimeout(r, 500); t.unref?.(); }),
    ]);
  }
  if (prevHome === undefined) delete process.env.WORCA_HOME; else process.env.WORCA_HOME = prevHome;
  delete process.env.WORCA_MOCK;
  await rm(homeDir, { recursive: true, force: true });
});

const post = (p, body) => fetch(`${base}${p}`, { method: 'POST', headers: JSONH, body: JSON.stringify(body) });
const patch = (p, body) => fetch(`${base}${p}`, { method: 'PATCH', headers: JSONH, body: JSON.stringify(body) });
const del = (p) => fetch(`${base}${p}`, { method: 'DELETE' });

test('POST creates a thread; the list shows it with runLinks count and inFlight:false', async () => {
  const r = await post('/api/ask/threads', {});
  assert.equal(r.status, 201);
  const { thread } = await r.json();
  assert.match(thread.id, /^ask_[0-9a-f]{8}$/);
  assert.equal(thread.title, null);
  const list = await (await fetch(`${base}/api/ask/threads`)).json();
  const row = list.threads.find((t) => t.id === thread.id);
  assert.ok(row);
  assert.equal(row.runLinks, 0);
  assert.equal(row.inFlight, false);
});

test('POST with a title stores the trimmed title; over-long is a 400', async () => {
  const r = await post('/api/ask/threads', { title: '  My chat  ' });
  assert.equal(r.status, 201);
  assert.equal((await r.json()).thread.title, 'My chat');
  const bad = await post('/api/ask/threads', { title: 'x'.repeat(121) });
  assert.equal(bad.status, 400);
});

test('GET one: 400 on shape, 404 on unknown, snapshot envelope on hit', async () => {
  assert.equal((await fetch(`${base}/api/ask/threads/nope`)).status, 400);
  assert.equal((await fetch(`${base}/api/ask/threads/ask_ffffffff`)).status, 404);
  const { thread } = await (await post('/api/ask/threads', {})).json();
  const snap = await (await fetch(`${base}/api/ask/threads/${thread.id}`)).json();
  assert.deepEqual(Object.keys(snap).sort(), ['attachments', 'inFlight', 'messages', 'runLinks', 'thread', 'worktrees']);
  assert.deepEqual(snap.messages, []);
  assert.equal(snap.inFlight, null);
});

test('PATCH renames within 120 chars; empty and unknown rejected', async () => {
  const { thread } = await (await post('/api/ask/threads', {})).json();
  assert.equal((await patch(`/api/ask/threads/${thread.id}`, { title: '' })).status, 400);
  assert.equal((await patch(`/api/ask/threads/${thread.id}`, { title: 'y'.repeat(121) })).status, 400);
  assert.equal((await patch('/api/ask/threads/ask_ffffffff', { title: 'x' })).status, 404);
  const ok = await patch(`/api/ask/threads/${thread.id}`, { title: 'Renamed' });
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).thread.title, 'Renamed');
});

test('#397 PATCH scope: pin project/workspace, Auto clears the target, invalid shapes rejected', async () => {
  const { thread } = await (await post('/api/ask/threads', {})).json();
  // pin a project
  let r = await patch(`/api/ask/threads/${thread.id}`, { scope: { pinned: true, projectKey: 'demo-00000001' } });
  assert.equal(r.status, 200);
  assert.deepEqual((await r.json()).thread.context, { pinned: true, projectKey: 'demo-00000001' });
  // switch to a workspace: the old target key is REPLACED, never kept alongside
  r = await patch(`/api/ask/threads/${thread.id}`, { scope: { pinned: true, workspaceId: 'wks-team-0000abcd' } });
  assert.deepEqual((await r.json()).thread.context, { pinned: true, workspaceId: 'wks-team-0000abcd' });
  // Auto: pinned false and no target resurrected
  r = await patch(`/api/ask/threads/${thread.id}`, { scope: { pinned: false } });
  assert.deepEqual((await r.json()).thread.context, { pinned: false });
  // invalid shapes are 400
  for (const scope of [
    { pinned: true },                                                             // no target
    { pinned: true, projectKey: 'demo-00000001', workspaceId: 'wks-team-0000abcd' }, // both
    { pinned: true, projectKey: 'Bad Key' },                                      // bad key shape
    { pinned: 'yes', projectKey: 'demo-00000001' },                               // pinned not boolean
    'x', 5, ['a'],                                                                // not an object
  ]) {
    assert.equal((await patch(`/api/ask/threads/${thread.id}`, { scope })).status, 400, JSON.stringify(scope));
  }
  // title and scope compose; a scope-only PATCH leaves the title alone
  r = await patch(`/api/ask/threads/${thread.id}`, { title: 'Scoped', scope: { pinned: true, projectKey: 'demo-00000001' } });
  const both = (await r.json()).thread;
  assert.equal(both.title, 'Scoped');
  assert.equal(both.context.projectKey, 'demo-00000001');
  r = await patch(`/api/ask/threads/${thread.id}`, { scope: { pinned: false } });
  assert.equal((await r.json()).thread.title, 'Scoped');
  // unknown thread stays 404
  assert.equal((await patch('/api/ask/threads/ask_ffffffff', { scope: { pinned: false } })).status, 404);
});

test('#397: a message whose context lacks `pinned` inherits the thread pin, per field', async () => {
  const { thread } = await (await post('/api/ask/threads', {})).json();
  await patch(`/api/ask/threads/${thread.id}`, { scope: { pinned: true, projectKey: 'demo-00000001' } });
  // a pre-selector tab: page context only — the pin must survive AND merge per field
  const r = await post(`/api/ask/threads/${thread.id}/messages`, {
    text: 'hi', model: 'claude-opus-5', effort: 'high',
    context: { view: 'history', projectDir: '/p/elsewhere', pipelineId: '4e1f2a9b' },
  });
  assert.equal(r.status, 202);
  const snap = await (await fetch(`${base}/api/ask/threads/${thread.id}`)).json();
  assert.equal(snap.thread.context.pinned, true, 'the stale tab could not unpin the thread');
  assert.equal(snap.thread.context.projectKey, 'demo-00000001', 'the pin replaced the page target');
  assert.equal(snap.thread.context.projectDir, undefined);
  assert.equal(snap.thread.context.view, 'history', 'non-target fields still follow the page');
  assert.equal(snap.thread.context.pipelineId, '4e1f2a9b');

  // an explicit Auto (pinned:false) from a selector-aware client is authoritative
  const { thread: t2 } = await (await post('/api/ask/threads', {})).json();
  await patch(`/api/ask/threads/${t2.id}`, { scope: { pinned: true, projectKey: 'demo-00000001' } });
  const r2 = await post(`/api/ask/threads/${t2.id}/messages`, {
    text: 'hi', model: 'claude-opus-5', effort: 'high',
    context: { view: 'new', pinned: false },
  });
  assert.equal(r2.status, 202);
  const snap2 = await (await fetch(`${base}/api/ask/threads/${t2.id}`)).json();
  assert.equal(snap2.thread.context.pinned, false);
  assert.equal(snap2.thread.context.projectKey, undefined);
});

test('DELETE removes rows and the attachment directory; unknown is 404', async () => {
  assert.equal((await del('/api/ask/threads/ask_ffffffff')).status, 404);
  const store = await import('../src/core/ask/store.mjs');
  const thread = store.createThread();
  const msg = store.appendMessage(thread.id, { role: 'user', text: 'x' });
  store.addAttachment(thread.id, msg.id, { name: 'n.md', text: 'hello' });
  const dir = store.attachmentsDir(thread.id);
  assert.ok(existsSync(dir));
  const r = await del(`/api/ask/threads/${thread.id}`);
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true });
  assert.equal((await fetch(`${base}/api/ask/threads/${thread.id}`)).status, 404);
  assert.ok(!existsSync(dir));
});

test('?limit clamps the list', async () => {
  for (let i = 0; i < 3; i += 1) await post('/api/ask/threads', {});
  const j = await (await fetch(`${base}/api/ask/threads?limit=2`)).json();
  assert.equal(j.threads.length, 2);
});

test('attachment download: text/plain + nosniff + inline; wrong thread 404; bad shape 400', async () => {
  const store = await import('../src/core/ask/store.mjs');
  const thread = store.createThread();
  const msg = store.appendMessage(thread.id, { role: 'user', text: 'x' });
  const att = store.addAttachment(thread.id, msg.id, { name: 'n.md', text: 'hello body' });
  const other = store.createThread();
  const r = await fetch(`${base}/api/ask/threads/${thread.id}/attachments/${att.id}`);
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type') || '', /text\/plain/i);
  assert.match(r.headers.get('content-type') || '', /utf-8/i);
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  assert.match(r.headers.get('content-disposition') || '', /inline/);
  assert.equal(await r.text(), 'hello body');
  assert.equal((await fetch(`${base}/api/ask/threads/${other.id}/attachments/${att.id}`)).status, 404);
  assert.equal((await fetch(`${base}/api/ask/threads/${thread.id}/attachments/zzz`)).status, 400);
});

test('GET /api/ask/models returns the chat catalog', async () => {
  const j = await (await fetch(`${base}/api/ask/models`)).json();
  assert.ok(Array.isArray(j.models) && j.models.length > 0);
  assert.ok(Array.isArray(j.efforts) && j.efforts.includes('high'));
  const entry = j.models.find((m) => /opus/i.test(m.id));
  assert.ok(entry, 'a predefined opus id is offered');
  assert.ok(Array.isArray(entry.efforts));
  // Plugin entries are now offered too; only legacy per-project ones are excluded.
  assert.ok(entry.custom === false || entry.custom === 'global' || entry.custom === 'plugin');
  assert.equal(typeof entry.hasEnv, 'boolean');
  assert.ok(!j.models.some((m) => m.custom === 'project'), 'the project-less chat never offers legacy project models');
  assert.ok(j.default && typeof j.default.model === 'string' && typeof j.default.effort === 'string',
    'the backend ships the D8 default');
  assert.ok(j.models.some((m) => m.id === j.default.model), 'the default is a model that exists');
});

test('hello carries an ask array; a threadId subscribe for an unknown thread is a no-op', async () => {
  const msgs = [];
  const ws = new WebSocket(wsBase, { headers: { host: '127.0.0.1', origin: 'http://127.0.0.1' } });
  ws.on('message', (d) => { try { msgs.push(JSON.parse(String(d))); } catch { /* ignore */ } });
  await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
  await new Promise((res, rej) => {
    const t0 = Date.now();
    (function tick() {
      if (msgs.some((m) => m.type === 'hello')) return res();
      if (Date.now() - t0 > 4000) return rej(new Error('no hello'));
      setTimeout(tick, 15);
    })();
  });
  const hello = msgs.find((m) => m.type === 'hello');
  assert.ok(Array.isArray(hello.ask));
  ws.send(JSON.stringify({ type: 'subscribe', threadId: 'ask_ffffffff' }));
  await new Promise((r) => setTimeout(r, 50));
  ws.close();
});

test('bootMaintenance sweeps streaming messages and reports the ask summary', async () => {
  const store = await import('../src/core/ask/store.mjs');
  const thread = store.createThread();
  store.appendMessage(thread.id, { role: 'user', text: 'q' });
  const asst = store.appendMessage(thread.id, { role: 'assistant', text: 'partial', status: 'streaming' });
  const summary = await mod.bootMaintenance();
  assert.equal(typeof summary.ask.interrupted, 'number');
  assert.ok(summary.ask.interrupted >= 1);
  assert.equal(typeof summary.ask.emptyThreads, 'number');
  const row = store.getMessage(asst.id);
  assert.equal(row.status, 'error');
  assert.ok(row.blocks.some((b) => b.kind === 'notice' && /interrupted by restart/.test(b.text)));
});
