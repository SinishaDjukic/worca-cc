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
import { checkRows } from './helpers/rows.mjs';

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
// Mock turns started by earlier tests may still be running; the global cap (3) answers 429 until they end.
const idle = async () => {
  for (let i = 0; i < 500 && [...mod._testing.askJobs.values()].some((j) => j.status === 'running'); i++) await new Promise((r) => setTimeout(r, 10));
};

test('POST creates a thread; the list shows it with runLinks count, inFlight:false, and tracking from the follower map (never the link row)', async () => {
  await checkRows([
    { name: 'POST creates a thread; the list shows it with runLinks count and inFlight:false', run: async () => {
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
    } },
    { name: 'the list flags tracking from the follower map: undetached follower + live unsettled run, never the ask_run_links row', run: async () => {
      const store = await import('../src/core/ask/store.mjs');
      const { EventEmitter } = await import('node:events');
      const t = store.createThread();
      const entry = { id: 'uuid-TRACK', orch: new EventEmitter(), projectDir: '/tmp/x', title: 't', status: 'running', startedAt: new Date().toISOString(), events: [], pendingQuestion: null, pipelineId: 'aaaa1111' };
      const paused = { ...entry, id: 'uuid-PAUSED', pipelineId: 'bbbb2222', status: 'paused' };
      mod.runs.set(entry.id, entry);
      mod.runs.set(paused.id, paused);
      const follower = (runId, detached = false) => ({ runId, detached, detach() {} });
      const rowFor = async () => (await (await fetch(`${base}/api/ask/threads`)).json()).threads.find((x) => x.id === t.id);
      try {
        // no follower at all — even with a link row left `running` (the restart trap)
        store.linkRun(t.id, { runId: 'uuid-GONE', pipelineId: 'cccc3333', status: 'running' });
        let row = await rowFor();
        assert.equal(row.tracking, false, 'ask_run_links.status is not the truth');
        assert.equal(row.trackingRuns, 0);
        // an undetached follower on a live, unsettled entry
        mod._testing.askFollowers.set(t.id, new Set([follower('uuid-TRACK')]));
        row = await rowFor();
        assert.equal(row.tracking, true);
        assert.equal(row.trackingRuns, 1);
        assert.equal(row.inFlight, false, 'tracking is independent of the thinking flag');
        // two followers: one live, one on a paused entry, one detached, one whose entry is gone
        mod._testing.askFollowers.set(t.id, new Set([follower('uuid-TRACK'), follower('uuid-PAUSED'), follower('uuid-TRACK', true), follower('uuid-NOWHERE')]));
        row = await rowFor();
        assert.equal(row.tracking, true);
        assert.equal(row.trackingRuns, 1, 'only the live undetached follower counts');
        // paused / detached / missing alone → not tracking
        mod._testing.askFollowers.set(t.id, new Set([follower('uuid-PAUSED'), follower('uuid-TRACK', true), follower('uuid-NOWHERE')]));
        row = await rowFor();
        assert.equal(row.tracking, false);
        assert.equal(row.trackingRuns, 0);
        // the entry settles under the follower (done arrives before onDetached) → not tracking
        mod._testing.askFollowers.set(t.id, new Set([follower('uuid-TRACK')]));
        entry.status = 'done';
        row = await rowFor();
        assert.equal(row.tracking, false, 'a settled entry no longer counts even while its follower lingers');
      } finally {
        mod._testing.askFollowers.delete(t.id);
        mod.runs.delete(entry.id);
        mod.runs.delete(paused.id);
      }
    } },
  ]);
});

test('POST with a title stores it trimmed (over-long 400); GET one: 400 on shape, 404 unknown, snapshot envelope on hit', async () => {
  await checkRows([
    { name: 'POST with a title stores the trimmed title; over-long is a 400', run: async () => {
      const r = await post('/api/ask/threads', { title: '  My chat  ' });
      assert.equal(r.status, 201);
      assert.equal((await r.json()).thread.title, 'My chat');
      const bad = await post('/api/ask/threads', { title: 'x'.repeat(121) });
      assert.equal(bad.status, 400);
    } },
    { name: 'GET one: 400 on shape, 404 on unknown, snapshot envelope on hit', run: async () => {
      assert.equal((await fetch(`${base}/api/ask/threads/nope`)).status, 400);
      assert.equal((await fetch(`${base}/api/ask/threads/ask_ffffffff`)).status, 404);
      const { thread } = await (await post('/api/ask/threads', {})).json();
      const snap = await (await fetch(`${base}/api/ask/threads/${thread.id}`)).json();
      assert.deepEqual(Object.keys(snap).sort(), ['attachments', 'inFlight', 'messages', 'runLinks', 'thread', 'worktrees']);
      assert.deepEqual(snap.messages, []);
      assert.equal(snap.inFlight, null);
    } },
  ]);
});

test('PATCH title: renames within 120 chars; empty, unknown and a PATCH naming none of title/scope/model are rejected', async () => {
  await checkRows([
    { name: 'PATCH renames within 120 chars; empty and unknown rejected', run: async () => {
      const { thread } = await (await post('/api/ask/threads', {})).json();
      assert.equal((await patch(`/api/ask/threads/${thread.id}`, { title: '' })).status, 400);
      assert.equal((await patch(`/api/ask/threads/${thread.id}`, { title: 'y'.repeat(121) })).status, 400);
      assert.equal((await patch('/api/ask/threads/ask_ffffffff', { title: 'x' })).status, 404);
      const ok = await patch(`/api/ask/threads/${thread.id}`, { title: 'Renamed' });
      assert.equal(ok.status, 200);
      assert.equal((await ok.json()).thread.title, 'Renamed');
    } },
    { name: 'PATCH naming none of title/scope/model still earns the title error', run: async () => {
      const { thread } = await (await post('/api/ask/threads', {})).json();
      const r = await patch(`/api/ask/threads/${thread.id}`, {});
      assert.equal(r.status, 400);
      assert.equal((await r.json()).error, 'title must be a non-empty string of at most 120 characters');
    } },
  ]);
});

test('#397 scope: PATCH pins/clears, a message inherits the pin per field, and both drop projectSource with the target keys', async () => {
  await checkRows([
    { name: '#397 PATCH scope: pin project/workspace, Auto clears the target, invalid shapes rejected', run: async () => {
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
    } },
    { name: '#397: a message whose context lacks `pinned` inherits the thread pin, per field', run: async () => {
      const { thread } = await (await post('/api/ask/threads', {})).json();
      await patch(`/api/ask/threads/${thread.id}`, { scope: { pinned: true, projectKey: 'demo-00000001' } });
      // a pre-selector tab: page context only — the pin must survive AND merge per field
      const r = await post(`/api/ask/threads/${thread.id}/messages`, {
        text: 'hi', model: 'claude-opus-5-5', effort: 'high',
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
        text: 'hi', model: 'claude-opus-5-5', effort: 'high',
        context: { view: 'new', pinned: false },
      });
      assert.equal(r2.status, 202);
      const snap2 = await (await fetch(`${base}/api/ask/threads/${t2.id}`)).json();
      assert.equal(snap2.thread.context.pinned, false);
      assert.equal(snap2.thread.context.projectKey, undefined);
    } },
    { name: 'MCP registry §9.1: the inherited pin and the PATCH scope branch drop projectSource with the target keys', run: async () => {
      await idle();
      const { thread } = await (await post('/api/ask/threads', {})).json();
      let r = await post(`/api/ask/threads/${thread.id}/messages`, {
        text: 'hi', model: 'claude-opus-5-5', effort: 'high',
        context: { view: 'settings', projectDir: '/p/fallback', projectSource: 'fallback', pinned: false },
      });
      assert.equal(r.status, 202);
      const stored = (await (await fetch(`${base}/api/ask/threads/${thread.id}`)).json()).thread.context;
      assert.equal(stored.projectSource, 'fallback', 'Auto stores the tag (card-event turns reuse it)');
      r = await patch(`/api/ask/threads/${thread.id}`, { scope: { pinned: true, projectKey: 'demo-00000001' } });
      assert.deepEqual((await r.json()).thread.context, { view: 'settings', pinned: true, projectKey: 'demo-00000001' }, 'PATCH scope strips it');
      // a pre-selector tab (no `pinned`) inherits the pin: askApplyPin strips the tag too
      await idle();
      r = await post(`/api/ask/threads/${thread.id}/messages`, {
        text: 'again', model: 'claude-opus-5-5', effort: 'high',
        context: { view: 'settings', projectDir: '/p/fallback', projectSource: 'fallback' },
      });
      assert.equal(r.status, 202, await r.clone().text());
      const after = (await (await fetch(`${base}/api/ask/threads/${thread.id}`)).json()).thread.context;
      assert.equal(after.projectSource, undefined);
      assert.equal(after.projectKey, 'demo-00000001');
    } },
  ]);
});

test('PATCH model/effort: persisted and returned by GET; validated like a send; no title needed', async () => {
  const { thread } = await (await post('/api/ask/threads', { title: 'Picked' })).json();
  const url = `/api/ask/threads/${thread.id}`;
  // the Ask panel's picker, moved while this chat is open: no title in the body, no title error
  let r = await patch(url, { model: 'claude-haiku-4-5', effort: 'medium' });
  assert.equal(r.status, 200);
  const patched = (await r.json()).thread;
  assert.equal(patched.model, 'claude-haiku-4-5');
  assert.equal(patched.effort, 'medium');
  assert.equal(patched.title, 'Picked', 'a model-only PATCH leaves the title alone');
  const got = (await (await fetch(`${base}${url}`)).json()).thread;
  assert.equal(got.model, 'claude-haiku-4-5');
  assert.equal(got.effort, 'medium');
  // the same validateModelEffort the message POST uses, with its error
  r = await patch(url, { model: 'no-such-model', effort: 'high' });
  assert.equal(r.status, 400);
  assert.equal((await r.json()).error, 'unknown model "no-such-model"');
  r = await patch(url, { model: 'claude-haiku-4-5', effort: 'max' });
  assert.equal(r.status, 400);
  assert.equal((await r.json()).error, 'effort "max" is not available for model "claude-haiku-4-5"');
  // the pair travels together
  r = await patch(url, { model: 'claude-opus-5-5' });
  assert.equal(r.status, 400);
  assert.equal((await r.json()).error, 'effort is required');
  r = await patch(url, { effort: 'high' });
  assert.equal(r.status, 400);
  assert.equal((await r.json()).error, 'model is required');
  const after = (await (await fetch(`${base}${url}`)).json()).thread;
  assert.deepEqual([after.model, after.effort], ['claude-haiku-4-5', 'medium'], 'a refused PATCH writes nothing');
  // composes with title and scope
  r = await patch(url, { title: 'Both', model: 'claude-opus-5-5', effort: 'max', scope: { pinned: true, projectKey: 'demo-00000001' } });
  assert.equal(r.status, 200);
  const both = (await r.json()).thread;
  assert.deepEqual([both.title, both.model, both.effort, both.context.projectKey], ['Both', 'claude-opus-5-5', 'max', 'demo-00000001']);
  // a bad model fails the whole PATCH — the valid title beside it is not written
  r = await patch(url, { title: 'Lost', model: 'no-such-model', effort: 'high' });
  assert.equal(r.status, 400);
  assert.equal((await (await fetch(`${base}${url}`)).json()).thread.title, 'Both');
  // unknown thread stays 404
  assert.equal((await patch('/api/ask/threads/ask_ffffffff', { model: 'claude-opus-5-5', effort: 'high' })).status, 404);
});

test('mcpOff: PATCH stores/returns/clears it and bumps updated_at; the first message stores it; bad shapes 400 before any write', async () => {
  await checkRows([
    { name: 'PATCH mcpOff (MCP registry §9.4): stored, returned by GET, bumps updated_at, no title needed; null clears; bad shapes 400', run: async () => {
      const { thread } = await (await post('/api/ask/threads', { title: 'Kept' })).json();
      const url = `/api/ask/threads/${thread.id}`;
      const before = (await (await fetch(`${base}${url}`)).json()).thread;
      await new Promise((r) => setTimeout(r, 5));
      const mcpOff = { sets: ['billing'], members: ['shop|manual:postgres-ro'] };
      let r = await patch(url, { mcpOff });
      assert.equal(r.status, 200, 'a { mcpOff }-only PATCH is not answered with the title error');
      const got = (await (await fetch(`${base}${url}`)).json()).thread;
      assert.deepEqual(got.mcpOff, mcpOff);
      assert.equal(got.title, 'Kept');
      assert.ok(got.updatedAt > before.updatedAt, 'bumps updated_at like scope');
      r = await patch(url, { mcpOff: { members: ['billing'] } });
      assert.equal(r.status, 400);
      assert.match((await r.json()).error, /mcpOff\.members/);
      assert.deepEqual((await (await fetch(`${base}${url}`)).json()).thread.mcpOff, mcpOff, 'a refused PATCH writes nothing');
      r = await patch(url, { mcpOff: null });
      assert.equal(r.status, 200);
      assert.equal((await r.json()).thread.mcpOff, null);
    } },
    { name: 'the first message stores mcpOff on the thread (choices made before a thread existed); a bad one is a 400 before any write', run: async () => {
      await idle();
      const { thread } = await (await post('/api/ask/threads', {})).json();
      const bad = await post(`/api/ask/threads/${thread.id}/messages`, { text: 'hi', model: 'claude-opus-5-5', effort: 'high', mcpOff: { sets: ['Bad Id'] } });
      assert.equal(bad.status, 400);
      assert.equal((await (await fetch(`${base}/api/ask/threads/${thread.id}`)).json()).messages.length, 0, 'nothing written');
      const r = await post(`/api/ask/threads/${thread.id}/messages`, { text: 'hi', model: 'claude-opus-5-5', effort: 'high', mcpOff: { sets: ['general'] } });
      assert.equal(r.status, 202);
      assert.deepEqual((await (await fetch(`${base}/api/ask/threads/${thread.id}`)).json()).thread.mcpOff, { sets: ['general'], members: [] });
    } },
  ]);
});

const settle = async (id) => {             // the mock turn must finish before the next POST (409 'turn in flight')
  for (let i = 0; i < 200; i++) {
    const s = await (await fetch(`${base}/api/ask/threads/${id}`)).json();
    if (!s.inFlight) return s;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error('mock turn never settled');
};

test('chips over the API: page chips accumulate/dedupe across turns and PATCH; a linked run becomes a chat chip', async () => {
  await checkRows([
    { name: 'context chips: accumulate across turns, dedupe, survive scope PATCH, ride list + GET + 202', run: async () => {
      await idle();
      const { thread } = await (await post('/api/ask/threads', {})).json();
      assert.deepEqual(thread.contexts, [], 'a fresh chat has no chips');
      const send = (context) => post(`/api/ask/threads/${thread.id}/messages`, { text: 'hi', model: 'claude-opus-5-5', effort: 'high', context });

      let r = await send({ view: 'settings' });
      assert.equal(r.status, 202);
      assert.deepEqual((await r.json()).contexts, [{ kind: 'page', id: 'settings', label: 'Settings' }]);
      await settle(thread.id);

      r = await send({ view: 'team-metrics' });
      assert.deepEqual((await r.json()).contexts.map((c) => c.id), ['settings', 'team-metrics']);
      await settle(thread.id);

      // a scope PATCH rewrites `context` but never the chips
      await patch(`/api/ask/threads/${thread.id}`, { scope: { pinned: true, projectKey: 'demo-00000001' } });
      r = await send({ view: 'settings', pinned: false });         // settings again: deduped, origin stays first
      assert.deepEqual((await r.json()).contexts.map((c) => c.id), ['settings', 'team-metrics']);
      await settle(thread.id);

      r = await send({ view: 'history' });                          // a list view adds nothing
      assert.deepEqual((await r.json()).contexts.map((c) => c.id), ['settings', 'team-metrics']);
      const snap = await settle(thread.id);
      assert.deepEqual(snap.thread.contexts.map((c) => c.id), ['settings', 'team-metrics']);
      const list = await (await fetch(`${base}/api/ask/threads?limit=50`)).json();
      assert.deepEqual(list.threads.find((t) => t.id === thread.id).contexts.map((c) => c.id), ['settings', 'team-metrics']);
    } },
    { name: 'conversation chips: a run the answer links to becomes a chat chip, on the thread and the ask-done frame', run: async () => {
      await idle();
      const { addProject } = await import('../src/core/projects.mjs');
      const { getDb } = await import('../src/core/db.mjs');
      const projDir = await mkdtemp(join(tmpdir(), 'worca-cc-askchips-'));
      const project = (await addProject({ name: 'chips-demo', path: projDir })).find((p) => p.name === 'chips-demo');
      getDb().prepare("INSERT INTO pipelines (id, project_key, target, title, status) VALUES ('5e6f7081', ?, 'project', 'Fix login', 'done')").run(project.key);
      const msgs = [];
      const ws = new WebSocket(wsBase, { headers: { host: '127.0.0.1', origin: 'http://127.0.0.1' } });
      ws.on('message', (d) => { try { msgs.push(JSON.parse(String(d))); } catch { /* ignore */ } });
      await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
      try {
        const { thread } = await (await post('/api/ask/threads', {})).json();
        // the mock answers with the first line of the user's text, so the answer carries these links
        const r = await post(`/api/ask/threads/${thread.id}/messages`, {
          text: `see #history/${project.key}/5e6f7081 and #history/${project.key}/0000dead`, model: 'claude-opus-5-5', effort: 'high', context: { view: 'settings' },
        });
        assert.equal(r.status, 202);
        const snap = await settle(thread.id);
        const chip = { kind: 'run', id: '5e6f7081', label: 'Fix login', home: project.key, source: 'chat' };
        assert.deepEqual(snap.thread.contexts, [
          { kind: 'page', id: 'settings', label: 'Settings' },
          chip,
        ], 'the page chip first, then the resolved run; the unknown run is dropped');
        const done = msgs.find((m) => m.type === 'ask-done' && m.threadId === thread.id);
        assert.ok(done, 'saw the ask-done frame');
        assert.deepEqual(done.contexts, snap.thread.contexts, 'the frame carries the list so the panel repaints');
      } finally {
        ws.close();
        await rm(projDir, { recursive: true, force: true });
      }
    } },
  ]);
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

test('list: ?limit clamps the page; total counts every saved chat', async () => {
  await checkRows([
    { name: '?limit clamps the list', run: async () => {
      for (let i = 0; i < 3; i += 1) await post('/api/ask/threads', {});
      const j = await (await fetch(`${base}/api/ask/threads?limit=2`)).json();
      assert.equal(j.threads.length, 2);
    } },
    { name: 'the list carries total = every saved chat, not the capped page', run: async () => {
      const store = await import('../src/core/ask/store.mjs');
      const j = await (await fetch(`${base}/api/ask/threads?limit=1`)).json();
      assert.equal(j.threads.length, 1);
      assert.equal(j.total, store.countThreads());
      assert.ok(j.total > 1, 'earlier tests left more than one thread behind');
    } },
  ]);
});

test('list: ?q searches titles and message text server-side; matches is uncapped; total stays every chat', async () => {
  const store = await import('../src/core/ask/store.mjs');
  const mk = async (title) => (await (await post('/api/ask/threads', { title })).json()).thread;
  const hit1 = await mk('Zebra rollout notes');
  const hit2 = await mk('zebra ROLLOUT follow-up');
  await mk('Something else');
  store.appendMessage(hit1.id, { role: 'user', text: 'what about 50%_off?' });
  await checkRows([
    { name: 'title match, case-insensitive; total is every chat; matches counts hits', run: async () => {
      const j = await (await fetch(`${base}/api/ask/threads?limit=50&q=${encodeURIComponent('zebra rollout')}`)).json();
      // appendMessage bumped hit1's updated_at, so compare as a set, not by order.
      assert.deepEqual(j.threads.map((t) => t.id).sort(), [hit1.id, hit2.id].sort());
      assert.equal(j.matches, 2);
      assert.equal(j.total, store.countThreads());
    } },
    { name: 'limit caps rows but not matches', run: async () => {
      const j = await (await fetch(`${base}/api/ask/threads?limit=1&q=zebra`)).json();
      assert.equal(j.threads.length, 1);
      assert.equal(j.matches, 2);
    } },
    { name: 'message text matches; % and _ are literal', run: async () => {
      const j = await (await fetch(`${base}/api/ask/threads?q=${encodeURIComponent('50%_off')}`)).json();
      assert.deepEqual(j.threads.map((t) => t.id), [hit1.id]);
      const none = await (await fetch(`${base}/api/ask/threads?q=${encodeURIComponent('50%xoff')}`)).json();
      assert.equal(none.matches, 0);
      assert.deepEqual(none.threads, []);
    } },
    { name: 'blank or repeated q is no search: no matches key', run: async () => {
      const blank = await (await fetch(`${base}/api/ask/threads?q=%20%20`)).json();
      assert.equal('matches' in blank, false);
      const arr = await (await fetch(`${base}/api/ask/threads?q=a&q=b`)).json();
      assert.equal('matches' in arr, false);
      assert.equal(arr.total, store.countThreads());
    } },
  ]);
});

test('GET /api/ask/history counts threads, worktrees, attachments and in-flight jobs', async () => {
  const store = await import('../src/core/ask/store.mjs');
  const thread = store.createThread();
  const msg = store.appendMessage(thread.id, { role: 'user', text: 'x' });
  store.addAttachment(thread.id, msg.id, { name: 'n.md', text: 'hello' });
  // An earlier test's mock turn may still be settling — wait for the table to go quiet
  // so the fake job below is the ONLY running one.
  await new Promise((res, rej) => {
    const t0 = Date.now();
    (function tick() {
      if ([...mod._testing.askJobs.values()].every((j) => j.status !== 'running')) return res();
      if (Date.now() - t0 > 4000) return rej(new Error('a mock turn never settled'));
      setTimeout(tick, 15);
    })();
  });
  mod._testing.askJobs.set(thread.id, { turn: { stop: () => {} }, status: 'running', graceTimer: null });
  try {
    const r = await fetch(`${base}/api/ask/history`);
    assert.equal(r.status, 200);
    const j = await r.json();
    assert.deepEqual(Object.keys(j).sort(), ['attachments', 'inFlight', 'threads', 'worktrees']);
    assert.equal(j.threads, store.countThreads());
    assert.equal(j.worktrees, store.countWorktrees());
    assert.equal(j.attachments, store.countAttachments());
    assert.ok(j.attachments >= 1);
    assert.equal(j.inFlight, 1, 'the fake running job is the only one in flight');
  } finally {
    mod._testing.askJobs.delete(thread.id);
  }
});

test('DELETE /api/ask/threads (bulk) removes every chat, stops jobs, clears askDeleting and broadcasts ask-history-cleared', async () => {
  const store = await import('../src/core/ask/store.mjs');
  const msgs = [];
  const ws = new WebSocket(wsBase, { headers: { host: '127.0.0.1', origin: 'http://127.0.0.1' } });
  ws.on('message', (d) => { try { msgs.push(JSON.parse(String(d))); } catch { /* ignore */ } });
  await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
  const a = store.createThread();
  const b = store.createThread();
  const m = store.appendMessage(a.id, { role: 'user', text: 'x' });
  store.addAttachment(a.id, m.id, { name: 'n.md', text: 'hello' });
  const dir = store.attachmentsDir(a.id);
  assert.ok(existsSync(dir));
  const stops = [];
  const graceTimer = setTimeout(() => {}, 60_000);
  mod._testing.askJobs.set(b.id, { turn: { stop: () => stops.push(b.id) }, status: 'running', graceTimer });
  const total = store.countThreads();
  assert.ok(total >= 2);
  const r = await del('/api/ask/threads');
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.ok, true);
  assert.deepEqual(j.failed, []);
  assert.equal(j.removed.threads, total);
  assert.equal(j.removed.worktrees, 0);
  assert.equal(store.countThreads(), 0);
  assert.equal(store.countAttachments(), 0);
  assert.ok(!existsSync(dir), 'attachment dir gone');
  assert.ok(stops.length >= 1, 'the running job was stopped');
  assert.equal(mod._testing.askJobs.has(b.id), false, 'the job entry was dropped');
  assert.equal(mod._testing.askDeleting.size, 0, 'askDeleting is empty again');
  await new Promise((res, rej) => {
    const t0 = Date.now();
    (function tick() {
      if (msgs.some((x) => x.type === 'ask-history-cleared')) return res();
      if (Date.now() - t0 > 4000) return rej(new Error('no ask-history-cleared frame'));
      setTimeout(tick, 15);
    })();
  });
  const frame = msgs.find((x) => x.type === 'ask-history-cleared');
  assert.deepEqual(frame, { type: 'ask-history-cleared' }, 'seq-less, threadId-less out-of-turn frame');
  ws.close();
  // An empty history is still a 200 with zero counts.
  const again = await (await del('/api/ask/threads')).json();
  assert.deepEqual(again, { ok: true, removed: { threads: 0, worktrees: 0 }, failed: [] });
  const hist = await (await fetch(`${base}/api/ask/history`)).json();
  assert.deepEqual(hist, { threads: 0, worktrees: 0, attachments: 0, inFlight: 0 });
});

test('attachment download: text/plain + nosniff + inline (an HTML attachment too, never text/html); wrong thread 404; bad shape 400', async () => {
  await checkRows([
    { name: 'attachment download: text/plain + nosniff + inline; wrong thread 404; bad shape 400', run: async () => {
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
    } },
    { name: 'attachment download: an HTML attachment (mime text/html) is served as text/plain + nosniff, never as text/html', run: async () => {
      const store = await import('../src/core/ask/store.mjs');
      const thread = store.createThread();
      const msg = store.appendMessage(thread.id, { role: 'user', text: 'x' });
      const html = '<html><body><script>alert(document.cookie)</script><p>x</p></body></html>';
      const att = store.addAttachment(thread.id, msg.id, { name: 'page.html', mime: 'text/html', text: html });
      assert.equal(att.mime, 'text/html', 'the row keeps its HTML label');
      const r = await fetch(`${base}/api/ask/threads/${thread.id}/attachments/${att.id}`);
      assert.equal(r.status, 200);
      assert.equal(r.headers.get('content-type'), 'text/plain; charset=utf-8', 'serving text/html from the worca origin would be an XSS hole');
      assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
      assert.equal(await r.text(), html);
    } },
  ]);
});

test('GET /api/ask/models and the hello ask array (unknown-thread subscribe is a no-op)', async () => {
  await checkRows([
    { name: 'GET /api/ask/models returns the chat catalog', run: async () => {
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
    } },
    { name: 'hello carries an ask array; a threadId subscribe for an unknown thread is a no-op', run: async () => {
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
    } },
  ]);
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

test('PATCH agentMode (#574): a boolean alone is not the title error; GET returns it; a non-boolean is 400; a message carries it', async () => {
  await idle();
  const { thread } = await (await post('/api/ask/threads', { title: 'Kept' })).json();
  const url = `/api/ask/threads/${thread.id}`;
  assert.equal((await (await fetch(`${base}${url}`)).json()).thread.agentMode, true, 'on by default');
  let r = await patch(url, { agentMode: false });
  assert.equal(r.status, 200, 'an { agentMode }-only PATCH is not answered with the title error');
  await r.json();
  const got = (await (await fetch(`${base}${url}`)).json()).thread;
  assert.equal(got.agentMode, false);
  assert.equal(got.title, 'Kept');
  r = await patch(url, { agentMode: 'no' });
  assert.equal(r.status, 400);
  await r.json();
  assert.equal((await (await fetch(`${base}${url}`)).json()).thread.agentMode, false, 'a refused PATCH writes nothing');
  r = await post(`${url}/messages`, { text: 'hi', model: 'claude-opus-5-5', effort: 'high', agentMode: 'yes' });
  assert.equal(r.status, 400);
  await r.json();
  r = await post(`${url}/messages`, { text: 'hi', model: 'claude-opus-5-5', effort: 'high', agentMode: true });
  assert.equal(r.status, 202);
  await r.json();
  assert.equal((await (await fetch(`${base}${url}`)).json()).thread.agentMode, true, 'the message stores it');
  await idle();
});
