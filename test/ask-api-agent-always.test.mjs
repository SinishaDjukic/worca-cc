// test/ask-api-agent-always.test.mjs — worca Chat R5: an Ask chat is always in agent mode where the host allows commands
// (askCommandsEnabled); neither the thread's stored agentMode nor a message's own agentMode turns it off. Boot =
// test/ask-api-mcp.test.mjs (WORCA_MOCK; the turn is read back from _testing.askJobs). No paths, no processes:
// the same on Mac, Linux and Windows.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';

useTempHome(after);

let homeDir, prevHome, srv, base, mod;
const JSONH = { 'Content-Type': 'application/json' };
const MODEL = { model: 'claude-opus-5-5', effort: 'high' };
const post = (p, body) => fetch(`${base}${p}`, { method: 'POST', headers: JSONH, body: JSON.stringify(body) });
const patch = (p, body) => fetch(`${base}${p}`, { method: 'PATCH', headers: JSONH, body: JSON.stringify(body) });
const idle = async () => {
  for (let i = 0; i < 500 && [...mod._testing.askJobs.values()].some((j) => j.status === 'running'); i++) await new Promise((r) => setTimeout(r, 10));
};
const turnOf = async (threadId) => {
  for (let i = 0; i < 500 && !mod._testing.askJobs.get(threadId)?.turn; i++) await new Promise((r) => setTimeout(r, 10));
  return mod._testing.askJobs.get(threadId).turn;
};

before(async () => {
  homeDir = await mkdtemp(join(tmpdir(), 'worca-cc-askagent-'));
  prevHome = process.env.WORCA_HOME;
  process.env.WORCA_HOME = homeDir;
  process.env.WORCA_MOCK = '1';
  process.env.WORCA_FLAGS = 'toolPanel';   // the tab tools test below (tools/test.mjs drops WORCA_FLAGS)
  mod = await import('../ui/server.mjs');
  srv = mod.server;
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
});

after(async () => {
  for (const [, job] of mod._testing.askJobs) { try { job.turn?.stop?.(); } catch { /* reap */ } }
  if (srv) await Promise.race([
    new Promise((r) => { srv.close(r); srv.closeAllConnections?.(); }),
    new Promise((r) => { const t = setTimeout(r, 500); t.unref?.(); }),
  ]);
  if (prevHome === undefined) delete process.env.WORCA_HOME; else process.env.WORCA_HOME = prevHome;
  delete process.env.WORCA_MOCK;
  delete process.env.WORCA_FLAGS;
  await rm(homeDir, { recursive: true, force: true });
});

test('an Ask chat is in agent mode whenever the host allows commands: a stored and a sent agentMode:false are ignored', async () => {
  assert.equal(mod._testing.askCommandsEnabled(), true, 'a local test server allows commands (test/ask-api-commands.test.mjs pins it)');
  await idle();
  const { thread } = await (await post('/api/ask/threads', {})).json();
  assert.equal((await patch(`/api/ask/threads/${thread.id}`, { agentMode: false })).status, 200, 'the column is kept: the PATCH still validates and stores');
  const r = await post(`/api/ask/threads/${thread.id}/messages`, { text: 'hi', ...MODEL, agentMode: false, context: { view: 'chat', pinned: false } });
  assert.equal(r.status, 202, await r.text());
  const turn = await turnOf(thread.id);
  assert.equal(turn.agentMode, true, 'agent mode is the host\'s answer, not the chat\'s switch');
  assert.match(turn.systemPrompt, /## Commands \(agent mode\)/);
  await idle();
});

test('the Workflows chat (composer mode) is never in agent mode, even where the host allows commands', async () => {
  await idle();
  const { thread } = await (await post('/api/ask/threads', { mode: 'composer' })).json();
  assert.equal(thread.mode, 'composer');
  const composer = { sessionId: 'cs_ab12cd34', docToken: 'd_ab12cd34', graph: { name: 'x', nodes: [], wires: [] }, selection: null, drafts: [] };
  const r = await post(`/api/ask/threads/${thread.id}/messages`, { text: 'Build a workflow', ...MODEL, context: {}, composer });
  assert.equal(r.status, 202, await r.text());
  const turn = await turnOf(thread.id);
  assert.equal(turn.agentMode, false);
  assert.doesNotMatch(turn.systemPrompt, /## Commands \(agent mode\)/);
  await idle();
});

// ── The tool panel's tab tools (issue 1064 slice 3): on in an Ask chat, off in the Workflows chat and under agent isolation ──
const putTabs = (threadId, tabs) => fetch(`${base}/api/tools/tabs?scope=chat&threadId=${threadId}`, { method: 'PUT', headers: JSONH, body: JSON.stringify({ tabs }) });
const tabsChat = async (body = {}) => {
  const { thread } = await (await post('/api/ask/threads', body)).json();
  const r = await putTabs(thread.id, [{ id: 'tab_aa1064', kind: 'files' }]);
  assert.equal(r.status, 200); await r.json();
  return thread;
};
// Under agent isolation a caller on this box needs the instance token (G1) to reach any route at all.
const uiTok = () => ({ 'x-worca-ui-token': mod._testing.uiToken() });
const bridgeCall = (token) => fetch(`${base}/api/ask/tabs`, { method: 'POST', headers: { ...JSONH, ...uiTok(), 'x-worca-ask-tabs': token }, body: JSON.stringify({ op: 'open', input: { kind: 'files' } }) });

test('tab tools: an Ask chat\'s turn has the prompt section and the tool tabs line', async () => {
  await idle();
  const thread = await tabsChat();
  const r = await post(`/api/ask/threads/${thread.id}/messages`, { text: 'hi', ...MODEL, context: { view: 'chat', pinned: false } });
  assert.equal(r.status, 202, await r.text());
  const turn = await turnOf(thread.id);
  assert.match(turn.systemPrompt, /## Tool panel tabs/);
  assert.match(turn.prompt, /tool tabs: tab_aa1064 files/);
  await idle();
});

test('tab tools: the Workflows chat (composer mode) has neither the section nor the tool tabs line', async () => {
  await idle();
  const thread = await tabsChat({ mode: 'composer' });
  const composer = { sessionId: 'cs_ab12cd35', docToken: 'd_ab12cd35', graph: { name: 'x', nodes: [], wires: [] }, selection: null, drafts: [] };
  const r = await post(`/api/ask/threads/${thread.id}/messages`, { text: 'Build a workflow', ...MODEL, context: {}, composer });
  assert.equal(r.status, 202, await r.text());
  const turn = await turnOf(thread.id);
  assert.doesNotMatch(turn.systemPrompt, /## Tool panel tabs/);
  assert.doesNotMatch(turn.prompt, /tool tabs:/);
  await idle();
});

test('tab tools under agent isolation: no bridge, the route refuses a live token, and a turn has neither the section nor the line', async () => {
  await idle();
  const thread = await tabsChat();
  const live = mod._testing.askTabBridge({ threadId: thread.id });
  process.env.WORCA_AGENT_USER = 'worca-agent'; process.env.WORCA_AGENT_HOME = '/home/worca-agent';
  try {
    assert.equal(mod._testing.askTabBridge({ threadId: thread.id }), null);
    const refused = await bridgeCall(live.token);
    assert.equal(refused.status, 403);
    assert.match((await refused.json()).error, /agent isolation/);
    const r = await fetch(`${base}/api/ask/threads/${thread.id}/messages`, { method: 'POST', headers: { ...JSONH, ...uiTok() },
      body: JSON.stringify({ text: 'hi', ...MODEL, context: { view: 'chat', pinned: false } }) });
    assert.equal(r.status, 202, await r.text());
    const turn = await turnOf(thread.id);
    assert.doesNotMatch(turn.systemPrompt, /## Tool panel tabs/);
    assert.doesNotMatch(turn.prompt, /tool tabs:/);
    await idle();
  } finally { delete process.env.WORCA_AGENT_USER; delete process.env.WORCA_AGENT_HOME; live.dispose(); }
});
