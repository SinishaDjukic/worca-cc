// test/ask-api-scope.test.mjs — P4 chat scope on the server (CONTRACT §4). Harness = ask-api-threads.test.mjs's.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';

import { useTempHome } from './helpers/temp-home.mjs';
import { checkRows } from './helpers/rows.mjs';
import { scopeRefusalText, noProjectRunText, scopeEventPrompt } from '../src/core/ask/scope.mjs';

useTempHome(after);

let homeDir, srv, base, wsBase, mod, prevHome;
const JSONH = { 'Content-Type': 'application/json' };

before(async () => {
  homeDir = await mkdtemp(join(tmpdir(), 'worca-cc-askscope-'));
  prevHome = process.env.WORCA_HOME;
  process.env.WORCA_HOME = homeDir;
  process.env.WORCA_MOCK = '1';
  mod = await import('../ui/server.mjs');
  store = await import('../src/core/ask/store.mjs');
  const { addProject } = await import('../src/core/projects.mjs');
  androidDir = await mkdtemp(join(tmpdir(), 'worca-cc-askscope-android-'));
  iosDir = await mkdtemp(join(tmpdir(), 'worca-cc-askscope-ios-'));
  android = (await addProject({ name: 'Havn Android', path: androidDir })).find((p) => p.name === 'Havn Android');
  ios = (await addProject({ name: 'Havn IOS', path: iosDir })).find((p) => p.name === 'Havn IOS');
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
  for (const d of [androidDir, iosDir]) if (d) await rm(d, { recursive: true, force: true });
});

const post = (p, body) => fetch(`${base}${p}`, { method: 'POST', headers: JSONH, body: JSON.stringify(body) });
const patch = (p, body) => fetch(`${base}${p}`, { method: 'PATCH', headers: JSONH, body: JSON.stringify(body) });
const del = (p) => fetch(`${base}${p}`, { method: 'DELETE' });
// Mock turns started by earlier tests may still be running; the global cap (3) answers 429 until they end.
const idle = async () => {
  for (let i = 0; i < 500 && [...mod._testing.askJobs.values()].some((j) => j.status === 'running'); i++) await new Promise((r) => setTimeout(r, 10));
};

let store, android, ios, androidDir, iosDir;   // set in before(), after the dynamic server import (same module instances); after() removes the two dirs
const MODEL = { model: 'claude-opus-5-5', effort: 'high' };
const ROOM = 'The room photo on the booking screen is tiny on tablets. Make it bigger.';
function openWs() {
  const frames = [];
  const ws = new WebSocket(wsBase, { headers: { host: '127.0.0.1', origin: 'http://127.0.0.1' } });
  ws.on('message', (d) => { try { frames.push(JSON.parse(String(d))); } catch { /* binary */ } });
  return { ws, frames, opened: new Promise((r) => ws.once('open', r)) };
}
const waitFor = async (fn, ms = 5000) => { const t0 = Date.now(); while (!fn()) { if (Date.now() - t0 > ms) throw new Error('timed out'); await new Promise((r) => setTimeout(r, 10)); } };
function threadWithHistory(context) {
  const t = store.createThread();
  store.updateThread(t.id, { context });
  store.appendMessage(t.id, { role: 'user', text: ROOM });
  return t;
}
const CARD = 'card_0000ab01';
const CARD_BLOCK = () => ({ kind: 'card', id: CARD, state: 'proposed', card: { type: 'scope-switch', reason: 'Both Havn apps have a booking screen.', summary: 'Havn Android / Havn IOS',
  candidates: [{ projectKey: android.key, name: 'Havn Android', path: android.path, vcs: 'none' }, { projectKey: ios.key, name: 'Havn IOS', path: ios.path, vcs: 'none' }] } });
function cardThread(extra = []) {
  const t = threadWithHistory({ pinned: false });
  store.appendMessage(t.id, { role: 'assistant', text: '', status: 'done', blocks: [CARD_BLOCK(), ...extra] });
  return t;
}
const answer = (t, body, cardId = CARD) => post(`/api/ask/threads/${t.id}/cards/${cardId}`, body);

test('P4 the cards: line names a scope-switch card by its summary', async () => {
  const t = cardThread();
  const { cards } = await mod._testing.resolveAskContext(t.id, {}, []);
  assert.deepEqual((cards || []).filter((c) => c.id === CARD), [{ id: 'card_0000ab01', type: 'scope-switch', state: 'proposed', summary: 'Havn Android / Havn IOS' }]);
});

test('P4 No project: a new chat starts in it; pinned:false strips every page target (the run context still rides); a context without `pinned` names its scope by key, never by projectDir', async () => {
  await checkRows([
    { name: 'a new chat is stored as {pinned:false} (U5)', run: async () => {
      const { thread } = await (await post('/api/ask/threads', {})).json();
      assert.deepEqual(thread.context, { pinned: false });
    } },
    { name: 'pinned:false: no project, workspace, projectDir or fallback tag is stored or resolved; the run panel context stays', run: async () => {
      await idle();
      const { thread } = await (await post('/api/ask/threads', {})).json();
      const r = await post(`/api/ask/threads/${thread.id}/messages`, { text: 'hi', ...MODEL, context: {
        view: 'chat', pinned: false, projectKey: android.key, workspaceId: 'wks-havn-0000abcd', projectDir: android.path,
        projectSource: 'fallback', pipelineId: '4e1f2a9b', runPage: 'diff', diffPath: 'src/a.js' } });
      assert.equal(r.status, 202, await r.clone().text());
      const stored = store.getThread(thread.id).context;
      assert.deepEqual(stored, { view: 'chat', pinned: false, pipelineId: '4e1f2a9b', runPage: 'diff', diffPath: 'src/a.js' });
      const header = await mod._testing.resolveAskContext(thread.id, { ...stored, projectKey: android.key }, []);
      assert.equal(header.project, undefined, 'a pinned:false context never names a project, even with a stray key');
      assert.equal(header.workspace, undefined);
      assert.equal(header.noProject, true);
      assert.equal(header.pinned, undefined);
    } },
    { name: 'no `pinned` (an API caller, a pre-#397 tab): the stored scope wins, else the projectKey it names; a projectDir alone is No project', run: async () => {
      await idle();
      const t1 = (await (await post('/api/ask/threads', {})).json()).thread;
      await post(`/api/ask/threads/${t1.id}/messages`, { text: 'hi', ...MODEL, context: { view: 'new', projectKey: android.key } });
      assert.deepEqual(store.getThread(t1.id).context, { view: 'new', pinned: true, projectKey: android.key });
      await idle();
      await post(`/api/ask/threads/${t1.id}/messages`, { text: 'again', ...MODEL, context: { view: 'history', projectKey: ios.key } });
      assert.equal(store.getThread(t1.id).context.projectKey, android.key, 'the stored scope beats a stale tab');
      await idle();
      const t2 = (await (await post('/api/ask/threads', {})).json()).thread;
      await post(`/api/ask/threads/${t2.id}/messages`, { text: 'hi', ...MODEL, context: { view: 'new', projectDir: android.path } });
      assert.deepEqual(store.getThread(t2.id).context, { view: 'new', pinned: false });
      const legacy = await mod._testing.resolveAskContext(t2.id, { view: 'new', projectKey: android.key }, []);
      assert.deepEqual([legacy.project, legacy.pinned], [{ name: 'Havn Android', key: android.key }, true]);
      const wsCtx = await mod._testing.resolveAskContext(t2.id, { view: 'new', pinned: true, workspaceId: 'wks-havn-0000abcd' }, []);
      assert.deepEqual([wsCtx.pinned, wsCtx.noProject], [true, undefined], 'a workspace scope is not No project');
    } },
    { name: 'S16: in No project a run named only by pipelineId still resolves ("this run") across every store', run: async () => {
      const { getDb } = await import('../src/core/db.mjs');
      getDb().prepare("INSERT INTO pipelines (id, project_key, target, title, status) VALUES ('5e6f7099', ?, 'project', 'Fix login', 'done')").run(android.key);
      const t = store.createThread();
      const header = await mod._testing.resolveAskContext(t.id, { view: 'chat', pinned: false, pipelineId: '5e6f7099' }, []);
      assert.deepEqual([header.run?.id, header.run?.title, header.project, header.noProject], ['5e6f7099', 'Fix login', undefined, true]);
    } },
  ]);
});

test('P4 switchThreadScope: the stored scope, a "Switched to <name>" divider row, the ask-scope frame; refused while a reply runs; the PATCH and a send that changes the scope use it', async () => {
  await checkRows([
    { name: 'a switch keeps the page fields, replaces the target, appends the divider and broadcasts ask-scope', run: async () => {
      await idle();
      const t = threadWithHistory({ view: 'chat', pipelineId: '4e1f2a9b', pinned: false });
      const w = openWs(); await w.opened;
      try {
        assert.deepEqual(await mod._testing.switchThreadScope(t.id, { pinned: true, projectKey: android.key }), { scope: { pinned: true, projectKey: android.key }, label: 'Havn Android' });
        assert.deepEqual(store.getThread(t.id).context, { view: 'chat', pipelineId: '4e1f2a9b', pinned: true, projectKey: android.key });
        const row = store.listMessages(t.id).at(-1);
        assert.deepEqual([row.role, row.text], ['system', 'Switched to Havn Android']);
        assert.deepEqual(row.blocks, [{ kind: 'divider', text: 'Switched to Havn Android', scope: { pinned: true, projectKey: android.key } }]);
        await waitFor(() => w.frames.some((f) => f.type === 'ask-scope' && f.threadId === t.id));
        assert.deepEqual(w.frames.find((f) => f.type === 'ask-scope' && f.threadId === t.id), { type: 'ask-scope', threadId: t.id, scope: { pinned: true, projectKey: android.key }, label: 'Havn Android' });
        assert.ok(w.frames.some((f) => f.type === 'ask-message' && f.message.id === row.id), 'the divider row reaches every tab');
        assert.deepEqual(await mod._testing.switchThreadScope(t.id, { pinned: false }), { scope: { pinned: false }, label: 'No project' });
        assert.equal(store.listMessages(t.id).at(-1).text, 'Switched to No project');
        const n = store.listMessages(t.id).length;
        await mod._testing.switchThreadScope(t.id, { pinned: true, projectKey: ios.key }, { divider: false });
        assert.equal(store.listMessages(t.id).length, n, 'divider:false adds no row');
        await waitFor(() => w.frames.some((f) => f.type === 'ask-scope' && f.threadId === t.id && f.label === 'Havn IOS'));   // the frame goes out without a divider too
        assert.deepEqual(store.getThread(t.id).context, { view: 'chat', pipelineId: '4e1f2a9b', pinned: true, projectKey: ios.key });
        await assert.rejects(mod._testing.switchThreadScope(t.id, { pinned: true }), { code: 'BAD_SCOPE' });
      } finally { w.ws.close(); }
    } },
    { name: 'while a reply runs: switchThreadScope throws TURN_IN_FLIGHT and the PATCH answers 409; nothing is written', run: async () => {
      await idle();
      const t = threadWithHistory({ pinned: false });
      mod._testing.askJobs.set(t.id, { status: 'running', messageId: 'askm_0000beef', events: [], seq: 0 });
      try {
        await assert.rejects(mod._testing.switchThreadScope(t.id, { pinned: true, projectKey: android.key }),
          { code: 'TURN_IN_FLIGHT', message: 'wait for this reply to finish before changing the chat scope' });
        const r = await patch(`/api/ask/threads/${t.id}`, { scope: { pinned: true, projectKey: android.key } });
        assert.equal(r.status, 409);
        assert.deepEqual(await r.json(), { error: 'wait for this reply to finish before changing the chat scope', code: 'TURN_IN_FLIGHT' });
        assert.deepEqual(store.getThread(t.id).context, { pinned: false });
        assert.equal(store.listMessages(t.id).length, 1);
      } finally { mod._testing.askJobs.delete(t.id); }
    } },
    { name: 'the PATCH: a changed scope on a chat with messages gets the divider; the same scope or an empty chat does not', run: async () => {
      await idle();
      const t = threadWithHistory({ pinned: false });
      assert.equal((await patch(`/api/ask/threads/${t.id}`, { scope: { pinned: true, projectKey: android.key } })).status, 200);
      assert.deepEqual(store.listMessages(t.id).map((m) => m.text), [ROOM, 'Switched to Havn Android']);
      await patch(`/api/ask/threads/${t.id}`, { scope: { pinned: true, projectKey: android.key } });
      assert.equal(store.listMessages(t.id).length, 2, 'the same scope adds nothing');
      const { thread: empty } = await (await post('/api/ask/threads', {})).json();
      await patch(`/api/ask/threads/${empty.id}`, { scope: { pinned: true, projectKey: android.key } });
      assert.equal(store.listMessages(empty.id).length, 0, 'an empty chat gets no row (it stays sweepable)');
    } },
    { name: 'S17: a scope set any other way closes the chat\'s open switch cards (state closed, no choice); No project leaves them open', run: async () => {
      await idle();
      const t = threadWithHistory({ pinned: false });
      const open = (id) => ({ kind: 'card', id, state: 'proposed', card: { type: 'scope-switch', reason: 'r', summary: 'Havn IOS', candidates: [{ projectKey: ios.key, name: 'Havn IOS', path: ios.path, vcs: 'none' }] } });
      store.appendMessage(t.id, { role: 'assistant', text: '', status: 'done', blocks: [open('card_0000ab04')] });
      await mod._testing.switchThreadScope(t.id, { pinned: false });
      assert.equal(store.findCard(t.id, 'card_0000ab04').block.state, 'proposed', 'No project keeps the question open');
      await patch(`/api/ask/threads/${t.id}`, { scope: { pinned: true, projectKey: android.key } });
      const b = store.findCard(t.id, 'card_0000ab04').block;
      assert.deepEqual([b.state, b.card.choice], ['closed', undefined]);
    } },
    { name: 'a send whose scope differs from the stored one puts the divider BEFORE its user row; the same scope or an empty chat adds none, and an empty chat still sends ask-scope', run: async () => {
      await idle();
      const t = threadWithHistory({ pinned: false });
      const r = await post(`/api/ask/threads/${t.id}/messages`, { text: 'next', ...MODEL, context: { view: 'chat', pinned: true, projectKey: android.key } });
      assert.equal(r.status, 202, await r.clone().text());
      await idle();
      assert.deepEqual(store.listMessages(t.id).slice(1, 3).map((m) => [m.role, m.text]), [['system', 'Switched to Havn Android'], ['user', 'next']]);
      assert.equal((await post(`/api/ask/threads/${t.id}/messages`, { text: 'again', ...MODEL, context: { view: 'chat', pinned: true, projectKey: android.key } })).status, 202);
      await idle();
      assert.deepEqual(store.listMessages(t.id).slice(4).map((m) => m.role), ['user', 'assistant'], 'the same scope adds no divider');
      const bad = await post(`/api/ask/threads/${t.id}/messages`, { text: 'x', ...MODEL, context: { view: 'chat', pinned: true, projectKey: ios.key }, attachments: [{ name: 'a.exe', dataBase64: 'AA==' }] });
      assert.equal(bad.status, 400);
      assert.deepEqual([store.getThread(t.id).context.projectKey, store.listMessages(t.id).length], [android.key, 6], 'a refused send switches nothing and leaves no row');
      const { thread: fresh } = await (await post('/api/ask/threads', {})).json();
      const w = openWs(); await w.opened;
      try {
        assert.equal((await post(`/api/ask/threads/${fresh.id}/messages`, { text: 'first', ...MODEL, context: { view: 'chat', pinned: true, projectKey: android.key } })).status, 202);
        await idle();
        assert.deepEqual(store.listMessages(fresh.id).map((m) => m.role), ['user', 'assistant'], 'an empty chat gets no divider');
        assert.equal(store.getThread(fresh.id).context.projectKey, android.key);
        await waitFor(() => w.frames.some((f) => f.type === 'ask-scope' && f.threadId === fresh.id && f.label === 'Havn Android'));   // every tab's pill follows
      } finally { w.ws.close(); }
    } },
  ]);
});

test('P4 run_command: a project folder only inside the chat scope; a runId is never gated', async () => {
  const t = store.createThread();
  store.updateThread(t.id, { context: { pinned: false } });
  await assert.rejects(mod._testing.askCommandTarget(t.id, { projectKey: android.key }), { message: scopeRefusalText(null, { projectKey: android.key }) });
  await assert.rejects(mod._testing.askCommandTarget(t.id, {}), { message: scopeRefusalText(null) });
  store.updateThread(t.id, { context: { pinned: true, projectKey: android.key } });
  assert.equal((await mod._testing.askCommandTarget(t.id, {})).cwd, android.path);
  assert.equal((await mod._testing.askCommandTarget(t.id, { projectKey: android.key })).projectKey, android.key);
  await assert.rejects(mod._testing.askCommandTarget(t.id, { projectKey: ios.key }), { message: scopeRefusalText({ projectKey: android.key }, { projectKey: ios.key }) });
  await assert.rejects(mod._testing.askCommandTarget(t.id, { runId: 'ffffffff' }), { message: 'run not found' }, 'a run is addressed by id, never by the scope');
});

test('S35: a No-project run has no folder for run_command and no branch for open_worktree — one refusal names its artifacts', async () => {
  const { getDb } = await import('../src/core/db.mjs');
  const { NO_PROJECT_KEY } = await import('../src/core/store.mjs');
  const { openAskWorktree } = await import('../src/core/ask/worktrees.mjs');
  getDb().prepare("INSERT INTO pipelines (id, project_key, target, title, status, branch) VALUES ('5e6f70aa', ?, 'project', 'Q3 deck', 'done', '{\"workMode\":\"none\",\"runRootMode\":\"detached\"}')").run(NO_PROJECT_KEY);
  const t = store.createThread();
  store.updateThread(t.id, { context: { pinned: true, projectKey: android.key } });
  const TEXT = 'run 5e6f70aa has no project and no branch — its files are its run artifacts: read them with list_run_artifacts and read_run_artifact';
  assert.equal(noProjectRunText('5e6f70aa'), TEXT);
  await assert.rejects(mod._testing.askCommandTarget(t.id, { runId: '5e6f70aa' }), { message: TEXT });
  await assert.rejects(openAskWorktree({ threadId: t.id, runId: '5e6f70aa' }), { message: TEXT });
});

test('P4 run_command in a workspace chat: a member project\'s folder only; another project or nothing named is refused', async () => {
  const { getDb } = await import('../src/core/db.mjs');
  const WS = 'wks-havn-0000abcd';
  getDb().prepare("INSERT INTO workspaces (id, name, description, created_at, updated_at) VALUES (?, 'Havn', '', '2026-10-18T00:00:00Z', '2026-10-18T00:00:00Z')").run(WS);
  getDb().prepare('INSERT INTO workspace_projects (workspace_id, project_key, ordinal) VALUES (?, ?, 0)').run(WS, android.path);
  const t = store.createThread();
  store.updateThread(t.id, { context: { pinned: true, workspaceId: WS } });
  assert.equal((await mod._testing.askCommandTarget(t.id, { projectKey: android.key })).cwd, android.path, 'a member of the chat workspace');
  await assert.rejects(mod._testing.askCommandTarget(t.id, { projectKey: ios.key }), { message: scopeRefusalText({ workspaceId: WS }, { projectKey: ios.key }) });
  await assert.rejects(mod._testing.askCommandTarget(t.id, {}), { message: "name a runId, or the projectKey of a member of this chat's workspace" });
});

test('P4 the scope card: a pick switches the chat and continues the same message; Continue without project continues it in No project; answered once; deferred while a reply runs', async () => {
  await checkRows([
    { name: 'a project pick switches the chat and continues the message: divider, quiet event row quoting the user, the answer — in the new scope', run: async () => {
      await idle();
      const t = cardThread();
      const w = openWs(); await w.opened;
      try {
        const r = await answer(t, { choice: android.key });
        assert.equal(r.status, 200, await r.clone().text());
        const body = await r.json();
        assert.deepEqual([body.block.state, body.block.card.choice], ['answered', android.key]);
        assert.match(body.turn.assistantMessageId, /^askm_[0-9a-f]{8}$/);
        await idle();
        const rows = store.listMessages(t.id);
        assert.deepEqual(rows.map((m) => m.role), ['user', 'assistant', 'system', 'user', 'assistant']);
        assert.deepEqual(rows[2].blocks, [{ kind: 'divider', text: 'Switched to Havn Android', scope: { pinned: true, projectKey: android.key } }]);
        assert.equal(rows[3].text, scopeEventPrompt({ cardId: CARD, state: 'switched', projectKey: android.key, name: 'Havn Android', userText: ROOM }));
        assert.deepEqual(rows[3].blocks, [{ kind: 'notice', synthetic: true, quiet: true, text: 'Switched to Havn Android' }]);
        assert.deepEqual(store.getThread(t.id).context, { pinned: true, projectKey: android.key });
        assert.ok(w.frames.some((f) => f.type === 'ask-scope' && f.threadId === t.id && f.label === 'Havn Android'));
        assert.equal((await answer(t, { choice: ios.key })).status, 409, 'a card answers once');
      } finally { w.ws.close(); }
    } },
    { name: 'Continue without project: the card is answered with choice none, no divider, the message continues in No project and the decline is on record', run: async () => {
      await idle();
      const t = cardThread();
      const body = await (await answer(t, { choice: 'none' })).json();
      assert.deepEqual([body.block.state, body.block.card.choice], ['answered', 'none']);
      await idle();
      const rows = store.listMessages(t.id);
      assert.deepEqual(rows.map((m) => m.role), ['user', 'assistant', 'user', 'assistant']);
      assert.equal(rows[2].text, scopeEventPrompt({ cardId: CARD, state: 'declined', keys: [android.key, ios.key], userText: ROOM }));
      assert.deepEqual(rows[2].blocks, [{ kind: 'notice', synthetic: true, quiet: true, text: 'Continued without project' }]);
      assert.deepEqual(store.getThread(t.id).context, { pinned: false });
    } },
    { name: 'a bad choice is 400, a project gone since is 409 PROJECT_GONE; the card stays proposed', run: async () => {
      await idle();
      const t = cardThread();
      for (const b of [{}, { choice: 'x-00000000' }, { choice: 7 }]) {
        const r = await answer(t, b);
        assert.equal(r.status, 400);
        assert.equal((await r.json()).error, 'choice must be one of the card\'s projects or "none"');
      }
      const ghost = { ...CARD_BLOCK(), id: 'card_0000ab02', card: { ...CARD_BLOCK().card, candidates: [{ projectKey: 'ghost-0000dead', name: 'Ghost', path: '/p/ghost', vcs: 'git' }] } };
      const g = cardThread([ghost]);
      const r = await answer(g, { choice: 'ghost-0000dead' }, 'card_0000ab02');
      assert.equal(r.status, 409);
      assert.deepEqual(await r.json(), { error: 'that project is no longer registered', code: 'PROJECT_GONE' });
      assert.equal(store.findCard(g.id, 'card_0000ab02').block.state, 'proposed');
      assert.equal((await (await answer(g, { choice: 'ghost-0000dead' }, 'card_0000ab02')).json()).code, 'PROJECT_GONE', 'the early return clears the busy mark');
      await mod._testing.switchThreadScope(g.id, { pinned: true, projectKey: ios.key }, { divider: false });
      const closed = await answer(g, { choice: android.key });
      assert.equal(closed.status, 409);
      assert.equal((await closed.json()).error, 'card is closed', 'a card the pill closed (S17) answers nothing');
    } },
    { name: 'a card answered while a reply runs is deferred: the flip stands, the switch and the event turn wait; an event queued behind it starts in the NEW scope', run: async () => {
      await idle();
      const t = cardThread([{ kind: 'card', id: 'card_0000ab03', state: 'proposed', card: { type: 'workspace', summary: 'Rename for the header' } }]);
      mod._testing.askJobs.set(t.id, { status: 'running', messageId: 'askm_0000beef', events: [], seq: 0 });
      let r;
      try {
        r = await (await answer(t, { choice: android.key })).json();
        assert.deepEqual([r.block.state, r.turn], ['answered', { deferred: true }]);
        assert.equal((await answer(t, { state: 'declined' }, 'card_0000ab03')).status, 200, 'a second card event queues behind it');
        assert.deepEqual(store.getThread(t.id).context, { pinned: false }, 'no switch under the running reply');
        assert.equal(store.listMessages(t.id).length, 2);
      } finally { mod._testing.askJobs.delete(t.id); }
      await mod._testing.drainAskDeferred(t.id);
      await waitFor(() => store.listMessages(t.id).filter((m) => m.role === 'assistant').length === 3 && ![...mod._testing.askJobs.values()].some((j) => j.status === 'running'));
      const rows = store.listMessages(t.id);
      assert.equal(rows[2].text, 'Switched to Havn Android');
      assert.ok(rows.some((m) => m.role === 'user' && m.text.startsWith('[worca event] workspace card card_0000ab03 declined')));
      assert.deepEqual(store.getThread(t.id).context, { pinned: true, projectKey: android.key }, 'the queued workspace event read the scope when it started');
    } },
    { name: 'C Note 5: a workflow-card or terminal event queued behind a scope pick starts in the NEW scope', run: async () => {
      for (const kind of ['workflow', 'terminal']) {
        await idle();
        const t = cardThread(kind === 'workflow' ? [{ kind: 'card', id: 'card_0000ab05', state: 'proposed', card: { type: 'workflow-build', name: 'Bigger photos' } }] : []);
        mod._testing.askJobs.set(t.id, { status: 'running', messageId: 'askm_0000beef', events: [], seq: 0 });
        try {
          assert.deepEqual((await (await answer(t, { choice: android.key })).json()).turn, { deferred: true });
          if (kind === 'workflow') assert.equal((await answer(t, { state: 'declined' }, 'card_0000ab05')).status, 200);
          else assert.deepEqual(await mod._testing.startTerminalEventTurn(t.id, { sessionId: 'ts_0000ab06', seq: 1, exitCode: 0, status: 'exited', command: 'echo hi' }), { deferred: true });
        } finally { mod._testing.askJobs.delete(t.id); }
        await mod._testing.drainAskDeferred(t.id);
        await waitFor(() => store.listMessages(t.id).filter((m) => m.role === 'assistant').length === 3 && ![...mod._testing.askJobs.values()].some((j) => j.status === 'running'));
        assert.deepEqual(store.getThread(t.id).context, { pinned: true, projectKey: android.key }, `the queued ${kind} event read the scope when it started`);
      }
    } },
    { name: 'the event quotes the newest TYPED message before the card: an event row between them, or a message typed after the card, never counts', run: async () => {
      await idle();
      const t = threadWithHistory({ pinned: false });
      store.appendMessage(t.id, { role: 'assistant', text: 'Done.', status: 'done' });
      store.appendMessage(t.id, { role: 'user', text: '[worca event] terminal block ts_0000ab07:1 exited 0; "echo hi"', blocks: [{ kind: 'notice', synthetic: true, text: 'Command finished (exit 0) — echo hi' }] });
      store.appendMessage(t.id, { role: 'assistant', text: '', status: 'done', blocks: [CARD_BLOCK()] });
      store.appendMessage(t.id, { role: 'user', text: 'typed after the card' });
      store.appendMessage(t.id, { role: 'assistant', text: 'ok', status: 'done' });
      assert.equal((await answer(t, { choice: 'none' })).status, 200);
      await idle();
      const ev = store.listMessages(t.id).find((m) => m.role === 'user' && m.text.startsWith('[worca event] scope card'));
      assert.equal(ev.text, scopeEventPrompt({ cardId: CARD, state: 'declined', keys: [android.key, ios.key], userText: ROOM }));
    } },
    { name: 'startScopeEventTurn (S40, P2): a scope the chat already has adds no divider; the event turn still starts', run: async () => {
      await idle();
      const t = threadWithHistory({ pinned: true, projectKey: android.key });
      const r = await mod._testing.startScopeEventTurn(t.id, { scope: { pinned: true, projectKey: android.key }, text: '[worca event] project card card_0000ab08 created', notice: 'Switched to Havn Android' });
      assert.match(r.assistantMessageId, /^askm_[0-9a-f]{8}$/);
      await idle();
      assert.deepEqual(store.listMessages(t.id).map((m) => m.role), ['user', 'user', 'assistant'], 'no divider row for the same scope');
    } },
    { name: 'no model can continue the message: the pick still switches the chat (CONTRACT §4) — at once, or after the running reply — and the chat says the reply failed', run: async () => {
      // A chat locked to Codex whose model left the catalog, with the credential broker on (it refuses Codex): askEventPick
      // finds no model. The env is set only around the answer: the model is picked when the card is answered.
      const noModel = async (t, body) => {
        store.updateThread(t.id, { engine: 'codex', model: 'gpt-retired-9', effort: 'low' });
        const prev = process.env.WORCA_BROKER_URL;
        process.env.WORCA_BROKER_URL = 'http://127.0.0.1:9';
        try { const r = await answer(t, body); assert.equal(r.status, 200); return await r.json(); }
        finally { if (prev === undefined) delete process.env.WORCA_BROKER_URL; else process.env.WORCA_BROKER_URL = prev; }
      };
      const FAILED = 'Chat could not reply to an event: no model available';
      await idle();
      const t = cardThread();
      const r = await noModel(t, { choice: android.key });
      assert.deepEqual([r.block.state, r.block.card.choice, r.turn], ['answered', android.key, { error: 'no model available', status: 503 }]);
      assert.deepEqual(store.getThread(t.id).context, { pinned: true, projectKey: android.key });
      assert.deepEqual(store.listMessages(t.id).slice(2).map((m) => [m.role, m.text]), [['system', 'Switched to Havn Android'], ['system', FAILED]]);
      const q = cardThread();
      mod._testing.askJobs.set(q.id, { status: 'running', messageId: 'askm_0000beef', events: [], seq: 0 });
      try {
        assert.deepEqual((await noModel(q, { choice: android.key })).turn, { deferred: true });
        assert.deepEqual(store.getThread(q.id).context, { pinned: false }, 'no switch under the running reply');
      } finally { mod._testing.askJobs.delete(q.id); }
      await mod._testing.drainAskDeferred(q.id);
      assert.deepEqual(store.getThread(q.id).context, { pinned: true, projectKey: android.key }, 'the queued pick switches once the reply ends');
      assert.deepEqual(store.listMessages(q.id).slice(2).map((m) => [m.role, m.text]), [['system', 'Switched to Havn Android'], ['system', FAILED]]);
    } },
  ]);
});
