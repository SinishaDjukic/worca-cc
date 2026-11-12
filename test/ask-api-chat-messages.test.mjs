// test/ask-api-chat-messages.test.mjs — cross-chat messaging slice 1, the server half: the loopback bridge route
// (POST /api/ask/chat-messages), the wake through the real chatMessageStartEvent → startScopeEventTurn → startAskTurn
// path (job.cause, the read-only toolset), the queue count, the D20 gates and the relay deps. In-process, WORCA_MOCK=1.
// Every response body is consumed: an unread body keeps a keep-alive socket open and srv.close() hangs.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import { spawnSync } from 'node:child_process';
import { _resetForTests } from '../src/core/db.mjs';

const ENV_KEYS = ['WORCA_HOME', 'HOME', 'USERPROFILE', 'WORCA_TERMINAL_PTY', 'SHELL', 'WORCA_MOCK', 'WORCA_AGENT_USER', 'WORCA_AGENT_HOME',
  'WORCA_IDENTITY_HEADER', 'WORCA_IDENTITY_TRUSTED_PROXIES', 'WORCA_BROKER_URL', 'WORCA_TEST_ALLOW_HOME_FALLBACK'];
const prev = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
let homeDir, repo, key, srv, base, mod, store, settings, mock;
const JSONH = { 'content-type': 'application/json' };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(pred, ms = 15000) {
  const t0 = Date.now();
  for (;;) {
    const v = await pred();
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error('timed out');
    await sleep(10);
  }
}
const running = (id) => mod._testing.askJobs.get(id)?.status === 'running';
const idle = async (...ids) => { for (const id of ids) await waitFor(() => !running(id)); };
const idleAll = async () => waitFor(() => ![...mod._testing.askJobs.values()].some((j) => j.status === 'running'));
const setCross = (on) => settings.setChatPrefs({ crossChat: on });
function chat({ createdBy = null, projectKey = null, title = null } = {}) {
  const t = store.createThread(createdBy ? { createdBy } : {});
  store.updateThread(t.id, { ...(title ? { title } : {}), ...(projectKey ? { context: { pinned: true, projectKey } } : {}) });
  return store.getThread(t.id);
}
const blocksOf = (id, dir) => store.listMessages(id).flatMap((m) => m.blocks || []).filter((b) => b && b.kind === 'chat-message' && (!dir || b.direction === dir));
async function post(token, body) {
  const r = await fetch(`${base}/api/ask/chat-messages`, { method: 'POST', headers: { ...JSONH, ...(token ? { 'x-worca-ask-message': token } : {}) }, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json() };
}
/** One gate per held turn, in the order the turns reach their first frame; release(i) lets that one go. */
function holdTurns() {
  const gates = [];
  mock._testing.holdFrame = (_f, i) => {
    if (i !== 0) return null;
    let release; const p = new Promise((r) => { release = r; });
    gates.push(release);
    return p;
  };
  return { count: () => gates.length, release: (i) => gates[i](), dispose: () => { for (const g of gates) g(); mock._testing.holdFrame = null; } };
}

before(async () => {
  homeDir = await mkdtemp(join(tmpdir(), 'worca-cc-askcxm-home-'));
  Object.assign(process.env, { WORCA_HOME: homeDir, HOME: homeDir, USERPROFILE: homeDir, WORCA_TERMINAL_PTY: '0', SHELL: '/bin/bash', WORCA_MOCK: '1',
    WORCA_TEST_ALLOW_HOME_FALLBACK: '1' });   // the model catalog (a Codex chat's model) under node:test
  for (const k of ['WORCA_AGENT_USER', 'WORCA_AGENT_HOME', 'WORCA_IDENTITY_HEADER', 'WORCA_IDENTITY_TRUSTED_PROXIES', 'WORCA_BROKER_URL']) delete process.env[k];
  _resetForTests();
  repo = await realpath(await mkdtemp(join(tmpdir(), 'askcxm-repo-')));
  const git = (...a) => spawnSync('git', a, { cwd: repo, encoding: 'utf8' });
  git('init', '-q', '-b', 'main'); git('config', 'user.email', 't@t'); git('config', 'user.name', 't'); git('commit', '-q', '--allow-empty', '-m', 'init');
  const { addProject } = await import('../src/core/projects.mjs');
  const { projectKey } = await import('../src/core/store.mjs');
  await addProject({ name: basename(repo), path: repo });
  key = projectKey(repo);
  store = await import('../src/core/ask/store.mjs');
  settings = await import('../src/core/settings.mjs');
  mock = await import('../src/core/engines/mock.mjs');
  mod = await import('../ui/server.mjs');
  srv = mod.server;
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
});

after(async () => {
  mock._testing.holdFrame = null;
  await idleAll().catch(() => {});
  mod._testing.askCommands.dispose();
  await Promise.race([
    new Promise((r) => { srv.close(r); srv.closeAllConnections?.(); }),
    new Promise((r) => { const t = setTimeout(r, 500); t.unref?.(); }),
  ]);
  _resetForTests();
  for (const k of ENV_KEYS) { if (prev[k] === undefined) delete process.env[k]; else process.env[k] = prev[k]; }
  await rm(repo, { recursive: true, force: true });
  await rm(homeDir, { recursive: true, force: true, maxRetries: 3 });
});

test('Q0 a fresh home: Messages between chats is ON with nothing stored, the bridge mints, send_to_chat is listed, a turn gets the section', async () => {
  const { readFileSync, writeFileSync, existsSync } = await import('node:fs');
  const file = join(homeDir, '.worca-cc', 'settings.json');
  if (existsSync(file)) {
    const s = JSON.parse(readFileSync(file, 'utf8'));
    if (s.chat && 'crossChat' in s.chat) { delete s.chat.crossChat; writeFileSync(file, JSON.stringify(s)); }
  }
  assert.equal(settings.readSettings().chat?.crossChat, undefined, 'nothing stored');
  assert.equal(settings.chatPrefs().crossChat, true);
  const a = chat();
  const br = mod._testing.askChatMessageBridge({ threadId: a.id });
  assert.ok(br, 'the classic-mode bridge is minted (the turn then carries WORCA_ASK_MESSAGES)');
  br.dispose();
  const { createAskTools } = await import('../src/core/ask/tools.mjs');
  const { ASK_LIMITS } = await import('../src/core/ask/limits.mjs');
  const names = createAskTools({ limits: ASK_LIMITS, chatMessages: mod._testing.askChatMessageExtraDeps(a.id).chatMessages }).list().map((d) => d.name);
  assert.ok(names.includes('send_to_chat'), 'relay mode lists send_to_chat');
  const hold = holdTurns();
  try {
    const r = await fetch(`${base}/api/ask/threads/${a.id}/messages`, { method: 'POST', headers: JSONH,
      body: JSON.stringify({ text: 'MOCK_SLOW hello', model: 'claude-opus-5-5', effort: 'high', context: {} }) });
    assert.equal(r.status, 202, await r.text());
    const job = await waitFor(() => mod._testing.askJobs.get(a.id)?.turn && mod._testing.askJobs.get(a.id));
    await waitFor(() => hold.count() >= 1);
    assert.match(job.turn.systemPrompt, /## Messages between chats/);
    assert.ok(job.turn.messageBridge, 'the turn holds a message bridge, so its spawn env carries WORCA_ASK_MESSAGES');
  } finally { hold.dispose(); }
  await idle(a.id);
});

test('Q17 the bridge is minted only with the setting on', async () => {
  const a = chat();
  await setCross(false);
  assert.equal(mod._testing.askChatMessageBridge({ threadId: a.id }), null);
  await setCross(true);
  const b = mod._testing.askChatMessageBridge({ threadId: a.id });
  assert.match(b.url, /^http:\/\/127\.0\.0\.1:\d+\/api\/ask\/chat-messages$/);
  assert.equal(typeof b.token, 'string');
  assert.equal(mod.askChatMessageBridges.get(b.token), a.id);
  b.dispose();
  assert.equal(mod.askChatMessageBridges.has(b.token), false);
});

test('Q11 the route: 403 without a token, with a disposed token, with the setting off; 200 on; the body never names the sender', async () => {
  await setCross(true);
  const a = chat({ title: 'Alpha' }); const b = chat({ title: 'Beta' }); const c = chat();
  assert.equal((await post(null, { input: { chatId: b.id, text: 'x' } })).status, 403);
  const gone = mod._testing.askChatMessageBridge({ threadId: a.id });
  gone.dispose();
  const r0 = await post(gone.token, { input: { chatId: b.id, text: 'x' } });
  assert.deepEqual([r0.status, r0.body.error], [403, 'chat messages: unknown or finished turn']);
  const br = mod._testing.askChatMessageBridge({ threadId: a.id });
  try {
    await setCross(false);
    const off = await post(br.token, { input: { chatId: b.id, text: 'x' } });
    assert.deepEqual([off.status, off.body.code], [403, 'CHAT_MESSAGES_OFF']);
    assert.equal(blocksOf(b.id).length, 0);
    await setCross(true);
    const ok = await post(br.token, { input: { chatId: b.id, text: 'hello' }, fromThreadId: c.id });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.equal(ok.body.result.ok, true);
    assert.equal(blocksOf(b.id, 'in')[0].from.chatId, a.id, 'a body field never changes the sender');
    assert.equal(blocksOf(a.id, 'out').length, 1);
    assert.equal(blocksOf(c.id).length, 0);
    const bad = await post(br.token, { input: { chatId: 'ask_zz', text: 'x' } });
    assert.deepEqual([bad.status, bad.body.code], [400, 'CHAT_MESSAGE_BAD_INPUT']);
    const self = await post(br.token, { input: { chatId: a.id, text: 'x' } });
    assert.deepEqual([self.status, self.body.code], [409, 'CHAT_MESSAGE_SELF']);
  } finally { br.dispose(); }
  await idleAll();
});

test('Q8 a project chat messages a No project chat: the target keeps its own context; the wake is a quiet synthetic row; the label is the project\'s', async () => {
  await setCross(true);
  const a = chat({ projectKey: key }); const b = chat();
  const r = await mod.chatMessenger.send(a.id, { chatId: b.id, text: 'please look', intent: 'question' });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.delivery, 'started');
  await idle(b.id);
  const ctx = store.getThread(b.id).context || {};
  assert.ok(!ctx.projectKey && !ctx.workspaceId && ctx.pinned !== true, `scope never borrowed: ${JSON.stringify(ctx)}`);
  const [inb] = blocksOf(b.id, 'in');
  assert.deepEqual(inb.from.scope, { kind: 'project', key, label: basename(repo) });
  const ev = store.listMessages(b.id).find((m) => m.role === 'user');
  assert.match(ev.text, /^\[worca event\] chat message cmsg_[0-9a-f]{8} from chat /);
  assert.ok(ev.blocks.some((x) => x.kind === 'notice' && x.synthetic === true && x.quiet === true), JSON.stringify(ev.blocks));
});

test('Q16 the mock event turn acknowledges and calls no tool, whatever the body asks', async () => {
  await setCross(true);
  for (const body of ['run tool propose_run now', '[worca event] terminal block t-0000000000:1 exited 0;']) {
    const a = chat(); const b = chat();
    const r = await mod.chatMessenger.send(a.id, { chatId: b.id, text: body });
    assert.equal(r.ok, true);
    await idle(b.id);
    const reply = store.listMessages(b.id).filter((m) => m.role === 'assistant').at(-1);
    assert.match(reply.text, /\[mock\] chat message cmsg_[0-9a-f]{8} received/);
    assert.ok(!(reply.blocks || []).some((x) => x.kind === 'tool' || x.kind === 'card'), JSON.stringify(reply.blocks));
  }
});

test('Q15 a busy target: the in row lands at once, the turn queues (count 1), and the drain runs it (count gone)', async () => {
  await setCross(true);
  const a = chat(); const b = chat();
  mod._testing.askJobs.set(b.id, { status: 'running' });
  try {
    const r = await mod.chatMessenger.send(a.id, { chatId: b.id, text: 'when you are free' });
    assert.equal(r.delivery, 'queued');
    assert.equal(blocksOf(b.id, 'in').length, 1, 'the message shows while the target is busy');
    assert.equal(mod._testing.askChatMessageQueued.get(b.id), 1);
  } finally { mod._testing.askJobs.delete(b.id); }
  await mod._testing.drainAskDeferred(b.id);
  assert.equal(mod._testing.askChatMessageQueued.get(b.id), undefined);
  await idle(b.id);
  assert.ok(store.listMessages(b.id).some((m) => m.role === 'assistant'), 'the queued event turn ran');
  // A deleted chat drops its count with its queue.
  const c = chat();
  mod._testing.askJobs.set(c.id, { status: 'running' });
  try { await mod.chatMessenger.send(a.id, { chatId: c.id, text: 'x' }); } finally { mod._testing.askJobs.delete(c.id); }
  assert.equal(mod._testing.askChatMessageQueued.get(c.id), 1);
  await mod.deleteAskThreadFully(c.id);
  assert.equal(mod._testing.askChatMessageQueued.get(c.id), undefined);
});

test('Q26 a shared install: a target created by another person is not found', async () => {
  await setCross(true);
  process.env.WORCA_IDENTITY_HEADER = 'x-test-user';
  process.env.WORCA_IDENTITY_TRUSTED_PROXIES = '127.0.0.1,::1';
  try {
    const a = chat({ createdBy: 'ann@example.com' }); const b = chat({ createdBy: 'bob@example.com' });
    const br = mod._testing.askChatMessageBridge({ threadId: a.id });
    try {
      const r = await fetch(`${base}/api/ask/chat-messages`, { method: 'POST', headers: { ...JSONH, 'x-worca-ask-message': br.token, 'x-test-user': 'ann@example.com' },
        body: JSON.stringify({ input: { chatId: b.id, text: 'x' } }) });
      const body = await r.json();
      assert.deepEqual([r.status, body.code], [404, 'CHAT_MESSAGE_NOT_FOUND'], JSON.stringify(body));
      assert.equal(blocksOf(b.id).length, 0);
    } finally { br.dispose(); }
  } finally { delete process.env.WORCA_IDENTITY_HEADER; delete process.env.WORCA_IDENTITY_TRUSTED_PROXIES; }
});

test('Q27 a target locked to another engine under the credential broker: delivered, not woken, the failure notice posted', async () => {
  await setCross(true);
  const a = chat();
  const b = store.createThread();
  store.updateThread(b.id, { model: 'gpt-5.5', effort: 'low', engine: 'codex' });
  store.appendMessage(b.id, { role: 'assistant', text: 'hello', status: 'done', model: 'gpt-5.5', effort: 'low', engine: 'codex' });
  process.env.WORCA_BROKER_URL = 'http://127.0.0.1:9';
  try {
    const before = store.listMessages(b.id).filter((m) => m.role === 'assistant').length;
    const r = await mod.chatMessenger.send(a.id, { chatId: b.id, text: 'x' });
    assert.equal(r.ok, true);
    assert.equal(r.delivery, 'failed', JSON.stringify(r));
    // Under the broker a Codex chat has no event model either, so the wake refuses at the pick (or at the D20 gate).
    assert.match(r.error, /no model available|This chat runs on Codex/);
    assert.equal(running(b.id), false);
    assert.equal(store.listMessages(b.id).filter((m) => m.role === 'assistant').length, before, 'no reply started');
    assert.ok(store.listMessages(b.id).some((m) => m.role === 'system' && /Chat could not reply to an event/.test(m.text)));
    assert.equal(blocksOf(b.id, 'in').length, 1, 'the message itself stays');
  } finally { delete process.env.WORCA_BROKER_URL; }
});

test('Q29 + Q37 the real cause plumbing: the woken turn carries job.cause and the read-only toolset; sends from it inherit; hop 7 is refused', async () => {
  await setCross(true);
  // Web access on, so the event turn's `web: null` is the reduction and not just the default.
  await settings.setAskWeb({ enabled: true, anyHost: false, allowedDomains: ['example.com'] });
  const hold = holdTurns();
  const chats = Array.from({ length: 8 }, () => chat());
  // D22: an event turn never resolves the third-party MCP copies or the skills from sets; the next user turn does.
  const resolvers = mod._testing.askTurnResolvers;
  const real = { ...resolvers };
  const resolved = [];
  resolvers.mcp = async (o, ...rest) => { resolved.push(['mcp', o.threadId]); return real.mcp(o, ...rest); };
  resolvers.skills = async (o, ...rest) => { resolved.push(['skills', o.threadId]); return real.skills(o, ...rest); };
  try {
    const first = await mod.chatMessenger.send(chats[0].id, { chatId: chats[1].id, text: 'MOCK_SLOW hop one' });
    assert.equal(first.delivery, 'started', JSON.stringify(first));
    const job = await waitFor(() => mod._testing.askJobs.get(chats[1].id)?.turn && mod._testing.askJobs.get(chats[1].id));
    await waitFor(() => hold.count() >= 1);
    assert.deepEqual(job.cause, { kind: 'chat-message', conversationId: first.conversationId, hop: 1 });
    assert.equal(job.turn.toolset, 'chat-message');
    // D22 at the server (Q37).
    assert.equal(job.turn.agentMode, false);
    assert.equal(job.turn.web, null);
    assert.equal(job.turn.mcp, null);
    assert.doesNotMatch(job.turn.systemPrompt, /## Commands \(agent mode\)/);
    assert.match(job.turn.systemPrompt, /## Messages between chats/);
    // A send from inside the held event turn inherits the conversation and the hop (relay deps, in-process).
    const deps = mod._testing.askChatMessageExtraDeps(chats[1].id);
    const second = await deps.chatMessages.send({ chatId: chats[2].id, text: 'MOCK_SLOW hop two' });
    assert.equal(second.hop, 2);
    assert.equal(second.conversationId, first.conversationId);
    // Walk the chain on to hop 6, each turn held, at most two at once (turnsGlobal is 3).
    for (let i = 2; i <= 5; i++) {
      await waitFor(() => mod._testing.askJobs.get(chats[i].id)?.turn);
      hold.release(i - 2);
      await idle(chats[i - 1].id);
      const r = await mod._testing.askChatMessageExtraDeps(chats[i].id).chatMessages.send({ chatId: chats[i + 1].id, text: `MOCK_SLOW hop ${i + 1}` });
      assert.equal(r.hop, i + 1, JSON.stringify(r));
      assert.equal(r.conversationId, first.conversationId);
    }
    await waitFor(() => mod._testing.askJobs.get(chats[6].id)?.turn);
    assert.equal(mod._testing.askJobs.get(chats[6].id).cause.hop, 6);
    const n = store.listMessages(chats[7].id).length;
    const refused = await mod._testing.askChatMessageExtraDeps(chats[6].id).chatMessages.send({ chatId: chats[7].id, text: 'one more' });
    assert.equal(refused.code, 'CHAT_MESSAGE_HOP_LIMIT');
    assert.equal(store.listMessages(chats[7].id).length, n, 'nothing written');
    assert.equal(running(chats[7].id), false, 'no turn started');
    assert.deepEqual(resolved, [], 'no event turn resolved MCP copies or skills');
  } finally { hold.dispose(); }
  await idleAll();
  // The reduction is per turn: the next ordinary user turn in the woken chat has its full toolset back.
  const r = await fetch(`${base}/api/ask/threads/${chats[1].id}/messages`, { method: 'POST', headers: JSONH,
    body: JSON.stringify({ text: 'MOCK_SLOW hello', model: 'claude-opus-5-5', effort: 'high', context: {} }) });
  assert.equal(r.status, 202, await r.clone().text());
  await r.json();
  const userJob = await waitFor(() => mod._testing.askJobs.get(chats[1].id)?.turn && mod._testing.askJobs.get(chats[1].id));
  assert.equal(userJob.cause, null);
  assert.equal(userJob.turn.toolset, null);
  assert.equal(userJob.turn.agentMode, true);
  assert.equal(userJob.turn.web?.enabled, true, 'web access is back for the user turn');
  await idleAll();
  Object.assign(resolvers, real);
  assert.deepEqual(resolved, [['mcp', chats[1].id], ['skills', chats[1].id]], 'the user turn resolves both');
  await settings.setAskWeb(null);
});

test('Q30 the relay deps: {} with the setting off; on, send writes both rows from this chat; the toolset adds askMode', async () => {
  const a = chat(); const b = chat();
  await setCross(false);
  assert.deepEqual(mod._testing.askChatMessageExtraDeps(a.id), {});
  assert.deepEqual(mod._testing.askChatMessageExtraDeps(a.id, { toolset: 'chat-message' }), { askMode: 'chat-message' });
  await setCross(true);
  const deps = mod._testing.askChatMessageExtraDeps(a.id);
  assert.equal(deps.askMode, undefined);
  const r = await deps.chatMessages.send({ chatId: b.id, text: 'relay' });
  assert.equal(r.ok, true);
  assert.equal(blocksOf(b.id, 'in')[0].from.chatId, a.id);
  assert.equal(blocksOf(a.id, 'out').length, 1);
  assert.equal(mod._testing.askChatMessageExtraDeps(a.id, { toolset: 'chat-message' }).askMode, 'chat-message');
  await idleAll();
});

test('D20 the wake gate: startScopeEventTurn runs `gate` before the turn; chatMessageGate refuses a Codex chat under the broker', async () => {
  const t = chat();
  const seen = [];
  const r = await mod._testing.startScopeEventTurn(t.id, { scope: null, text: '[worca event] chat message cmsg_00000001 from chat ask_00000001 x', notice: 'n',
    gate: async (thread, mv) => { seen.push([thread.id, typeof mv.model]); return { status: 409, error: 'gate says no' }; } });
  assert.deepEqual(seen, [[t.id, 'string']]);
  assert.equal(r.error, 'gate says no');
  assert.equal(running(t.id), false);
  assert.ok(!store.listMessages(t.id).some((m) => m.role === 'assistant'), 'no turn started');
  const codex = store.createThread();
  store.updateThread(codex.id, { model: 'gpt-5.5', effort: 'low', engine: 'codex' });
  store.appendMessage(codex.id, { role: 'assistant', text: 'hello', status: 'done', model: 'gpt-5.5', effort: 'low', engine: 'codex' });
  process.env.WORCA_BROKER_URL = 'http://127.0.0.1:9';
  try {
    const refused = await mod._testing.chatMessageGate(store.getThread(codex.id), { model: 'gpt-5.5', effort: 'low' });
    assert.equal(refused.code, 'engine-broker');
    assert.equal(await mod._testing.chatMessageGate(store.getThread(t.id), { model: 'claude-opus-5-5', effort: 'high' }), null, 'a Claude chat in mock mode passes');
  } finally { delete process.env.WORCA_BROKER_URL; }
});

test('D20 a slot taken while the gate awaits: the wake queues (delivery queued, count 1), never fails; the drain starts it', async () => {
  await setCross(true);
  const a = chat(); const b = chat();
  const realGate = mod._testing.chatMessageGateDeps.credentialGate;
  // The credential half awaits a tick; meanwhile a typed message reserves the target's slot.
  mod._testing.chatMessageGateDeps.credentialGate = async () => {
    await new Promise((r) => setImmediate(r));
    mod._testing.askJobs.set(b.id, { status: 'running' });
    return null;
  };
  let r;
  try { r = await mod.chatMessenger.send(a.id, { chatId: b.id, text: 'MOCK_SLOW raced' }); }
  finally { mod._testing.chatMessageGateDeps.credentialGate = realGate; }
  try {
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.delivery, 'queued', JSON.stringify(r));
    assert.equal(mod._testing.askChatMessageQueued.get(b.id), 1);
    assert.equal(mod.askDeferred.get(b.id)?.length, 1);
    assert.ok(!store.listMessages(b.id).some((m) => m.role === 'system' && /could not reply/.test(m.text)), 'no failure notice');
  } finally { mod._testing.askJobs.delete(b.id); }
  await mod._testing.drainAskDeferred(b.id);
  await waitFor(() => store.listMessages(b.id).some((m) => m.role === 'assistant'));
  assert.equal(mod._testing.askChatMessageQueued.get(b.id), undefined);
  await idleAll();
});

test('D20 the credential gate: chatMessageGate asks it with the target owner\'s actor and the event model, and returns its refusal', async () => {
  const t = chat({ createdBy: 'ann@example.com' });
  const local = chat();
  const realGate = mod._testing.chatMessageGateDeps.credentialGate;
  const seen = [];
  mod._testing.chatMessageGateDeps.credentialGate = async (req, model) => {
    seen.push([req.worcaUser?.email, model]);
    return { status: 409, error: 'no key', code: 'credential-missing' };
  };
  try {
    const refused = await mod._testing.chatMessageGate(store.getThread(t.id), { model: 'claude-opus-5-5', effort: 'high' });
    assert.equal(refused.code, 'credential-missing');
    await mod._testing.chatMessageGate(store.getThread(local.id), { model: 'claude-opus-5-5', effort: 'high' });
    assert.deepEqual(seen, [['ann@example.com', 'claude-opus-5-5'], ['local', 'claude-opus-5-5']]);
  } finally { mod._testing.chatMessageGateDeps.credentialGate = realGate; }
  // The production gate is askCredentialGate itself.
  assert.equal(realGate, mod.askCredentialGate);
});

test('Q11 the route\'s loopback gate: a non-loopback Host or a peer off this box is refused before any send', async () => {
  await setCross(true);
  const a = chat(); const b = chat();
  const { register } = await import('../ui/routes/chat/chat-messages.mjs');
  let handler = null;
  register({ post: (path, h) => { if (path === '/api/ask/chat-messages') handler = h; } });
  assert.equal(typeof handler, 'function');
  const br = mod._testing.askChatMessageBridge({ threadId: a.id });
  const call = async (socket, host) => {
    const out = {};
    const res = { status(c) { out.status = c; return this; }, json(b) { out.body = b; return this; } };
    await handler({ socket, headers: { host, 'x-worca-ask-message': br.token }, body: { input: { chatId: b.id, text: 'x' } } }, res);
    return out;
  };
  try {
    const evil = await call({ remoteAddress: '127.0.0.1' }, 'evil.example');
    assert.deepEqual([evil.status, evil.body.error], [403, 'chat messages: loopback callers only']);
    const far = await call({ remoteAddress: '203.0.113.9' }, '127.0.0.1');
    assert.deepEqual([far.status, far.body.error], [403, 'chat messages: loopback callers only']);
    assert.equal(blocksOf(b.id).length, 0, 'nothing delivered');
    const ok = await call({ remoteAddress: '127.0.0.1' }, '127.0.0.1');
    assert.equal(ok.status ?? 200, 200, JSON.stringify(ok));
    assert.equal(blocksOf(b.id, 'in').length, 1, 'the same call from loopback delivers');
  } finally { br.dispose(); }
  await idleAll();
});

test('D20 a queued wake whose gate meets a taken slot at drain time goes back in the queue and keeps its count', async () => {
  await setCross(true);
  const a = chat(); const b = chat();
  mod._testing.askJobs.set(b.id, { status: 'running' });
  let r;
  try { r = await mod.chatMessenger.send(a.id, { chatId: b.id, text: 'MOCK_SLOW later' }); } finally { mod._testing.askJobs.delete(b.id); }
  assert.equal(r.delivery, 'queued');
  assert.equal(mod._testing.askChatMessageQueued.get(b.id), 1);
  const realGate = mod._testing.chatMessageGateDeps.credentialGate;
  mod._testing.chatMessageGateDeps.credentialGate = async () => {
    await new Promise((res) => setImmediate(res));
    mod._testing.askJobs.set(b.id, { status: 'running' });
    return null;
  };
  try { await mod._testing.drainAskDeferred(b.id); }
  finally { mod._testing.chatMessageGateDeps.credentialGate = realGate; mod._testing.askJobs.delete(b.id); }
  assert.equal(mod._testing.askChatMessageQueued.get(b.id), 1, 'still waiting, still counted');
  assert.equal(mod.askDeferred.get(b.id)?.length, 1);
  assert.ok(!store.listMessages(b.id).some((m) => m.role === 'system' && /could not reply/.test(m.text)), 'no failure notice');
  await mod._testing.drainAskDeferred(b.id);
  await waitFor(() => store.listMessages(b.id).some((m) => m.role === 'assistant'));
  assert.equal(mod._testing.askChatMessageQueued.get(b.id), undefined);
  await idleAll();
});

test('D20 the queue cap holds while gates await: concurrent sends to an idle target reserve their slot at send time', async () => {
  await setCross(true);
  const b = chat();
  const senders = Array.from({ length: 5 }, () => chat());
  const realGate = mod._testing.chatMessageGateDeps.credentialGate;
  // A broker round-trip: every wake's gate is still pending while the other sends run their cap check.
  mod._testing.chatMessageGateDeps.credentialGate = async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r)); return null; };
  let rs;
  try { rs = await Promise.all(senders.map((s, i) => mod.chatMessenger.send(s.id, { chatId: b.id, text: 'MOCK_SLOW probe ' + i }))); }
  finally { mod._testing.chatMessageGateDeps.credentialGate = realGate; }
  const refused = rs.filter((r) => r.code === 'CHAT_MESSAGE_TARGET_BUSY');
  const accepted = rs.filter((r) => r.ok);
  assert.equal(accepted.length, 3, JSON.stringify(rs));
  assert.equal(refused.length, 2, JSON.stringify(rs));
  assert.deepEqual(accepted.map((r) => r.delivery).sort(), ['queued', 'queued', 'started']);
  assert.equal(mod._testing.askChatMessageQueued.get(b.id), 2, 'the started wake released its slot');
  assert.equal(mod.askDeferred.get(b.id)?.length, 2);
  await waitFor(() => !mod._testing.askChatMessageQueued.has(b.id));
  await idleAll();
});

test('D20 a wake that fails (its gate throws) gives back the slot it reserved', async () => {
  await setCross(true);
  const a = chat(); const b = chat();
  const realGate = mod._testing.chatMessageGateDeps.credentialGate;
  mod._testing.chatMessageGateDeps.credentialGate = async () => { throw new Error('broker down'); };
  let r;
  try { r = await mod.chatMessenger.send(a.id, { chatId: b.id, text: 'gate throws' }); }
  finally { mod._testing.chatMessageGateDeps.credentialGate = realGate; }
  assert.equal(r.delivery, 'failed', JSON.stringify(r));
  assert.equal(r.error, 'broker down');
  assert.equal(mod._testing.askChatMessageQueued.has(b.id), false, 'no slot left reserved');
  await idleAll();
});

// ---- list_chats over the bridge (op:'list') and the relay deps ---------------------------------------------------------
// The file keeps one database: every fixture title carries a unique tag, and order/count asserts pass `query: tag`.
const listTag = () => `zq${store.newAskId('x').slice(4)}`;
async function postList(token, input, extra = {}) {
  const r = await fetch(`${base}/api/ask/chat-messages`, { method: 'POST', headers: { ...JSONH, ...(token ? { 'x-worca-ask-message': token } : {}), ...extra },
    body: JSON.stringify({ op: 'list', input }) });
  return { status: r.status, body: await r.json() };
}
async function setUpdated(id, iso) {
  const { getDb } = await import('../src/core/db.mjs');
  getDb().prepare('UPDATE ask_threads SET updated_at = ? WHERE id = ?').run(iso, id);
}

test('A1 list_chats over the bridge: the calling chat is excluded, rows newest first carry id/title/scope/lastActivityAt/archived/snippet, a long first message is clipped to 120', async () => {
  await setCross(true);
  const tag = listTag();
  const a = chat({ title: `${tag} caller` });
  const b = chat({ title: `${tag} long` });
  const c = chat({ title: `${tag} project`, projectKey: key });
  store.appendMessage(b.id, { role: 'user', text: `begin ${'y'.repeat(5000)}` });
  await setUpdated(a.id, '2026-03-09T00:00:00.000Z');
  await setUpdated(b.id, '2026-03-02T00:00:00.000Z');
  await setUpdated(c.id, '2026-03-03T00:00:00.000Z');
  const br = mod._testing.askChatMessageBridge({ threadId: a.id });
  try {
    const { status, body } = await postList(br.token, { query: tag });
    assert.equal(status, 200, JSON.stringify(body));
    const r = body.result;
    assert.equal(r.ok, true);
    assert.deepEqual(r.chats.map((x) => x.id), [c.id, b.id], 'newest first, the caller left out');
    for (const row of r.chats) assert.deepEqual(Object.keys(row), ['id', 'title', 'scope', 'lastActivityAt', 'archived', 'snippet']);
    assert.deepEqual(r.chats[0].scope, { kind: 'project', key });
    assert.deepEqual(r.chats[1].scope, { kind: 'none', key: null });
    assert.equal(r.chats[0].lastActivityAt, '2026-03-03T00:00:00.000Z');
    assert.equal(r.chats[1].title, `${tag} long`);
    assert.ok(r.chats[1].snippet.length <= 120 && r.chats[1].snippet.endsWith('…') && r.chats[1].snippet.startsWith('begin y'), r.chats[1].snippet);
    assert.equal(r.chats[0].snippet, '');
    assert.deepEqual([r.total, r.offset, r.limit, r.nextOffset], [2, 0, 20, null]);
    const all = await postList(br.token, {});
    assert.ok(!all.body.result.chats.some((x) => x.id === a.id), 'unfiltered: still not the caller');
  } finally { br.dispose(); }
});

test('A2 list_chats paging and archived: limit/offset/nextOffset; an archived chat appears only with includeArchived', async () => {
  await setCross(true);
  const tag = listTag();
  const a = chat({ title: 'pager' });
  const [x, y, z, old] = [1, 2, 3, 4].map((i) => chat({ title: `${tag} n${i}` }));
  await setUpdated(x.id, '2026-04-04T00:00:00.000Z');
  await setUpdated(y.id, '2026-04-03T00:00:00.000Z');
  await setUpdated(z.id, '2026-04-02T00:00:00.000Z');
  store.setArchived(old.id, true);
  await setUpdated(old.id, '2026-04-05T00:00:00.000Z');
  const br = mod._testing.askChatMessageBridge({ threadId: a.id });
  try {
    const p1 = (await postList(br.token, { query: tag, limit: 2 })).body.result;
    assert.deepEqual([p1.chats.map((c) => c.id), p1.total, p1.nextOffset], [[x.id, y.id], 3, 2]);
    const p2 = (await postList(br.token, { query: tag, limit: 2, offset: p1.nextOffset })).body.result;
    assert.deepEqual([p2.chats.map((c) => c.id), p2.offset, p2.nextOffset], [[z.id], 2, null]);
    const arch = (await postList(br.token, { query: tag, includeArchived: true })).body.result;
    assert.deepEqual(arch.chats.map((c) => [c.id, c.archived]), [[old.id, true], [x.id, false], [y.id, false], [z.id, false]]);
    const bad = await postList(br.token, { limit: 99 });
    assert.deepEqual([bad.status, bad.body.code, bad.body.error], [400, 'CHAT_MESSAGE_BAD_INPUT', 'limit must be a whole number from 1 to 50.']);
  } finally { br.dispose(); }
});

test('A3 list_chats query: a title hit and a first-message hit, a later-message hit is not listed', async () => {
  await setCross(true);
  const tag = listTag();
  const word = `${tag}Gizmo`;
  const a = chat({ title: 'asker' });
  const byTitle = chat({ title: `About the ${word} release` });
  const byFirst = chat({ title: 'Plain title' });
  store.appendMessage(byFirst.id, { role: 'user', text: `the ${word} broke` });
  const byLater = chat({ title: 'Other title' });
  store.appendMessage(byLater.id, { role: 'user', text: 'hello' });
  store.appendMessage(byLater.id, { role: 'user', text: `and the ${word}` });
  const br = mod._testing.askChatMessageBridge({ threadId: a.id });
  try {
    const r = (await postList(br.token, { query: word.toLowerCase() })).body.result;
    assert.deepEqual(r.chats.map((c) => c.id).sort(), [byTitle.id, byFirst.id].sort());
    assert.equal(r.chats.find((c) => c.id === byFirst.id).snippet, `the ${word} broke`);
  } finally { br.dispose(); }
});

test('A4 list_chats changes nothing: the caller\'s and targets\' updatedAt and message counts are unchanged across scopes', async () => {
  await setCross(true);
  const tag = listTag();
  const a = chat({ title: `${tag} caller`, projectKey: key });
  const none = chat({ title: `${tag} none` });
  const other = store.createThread();
  store.updateThread(other.id, { title: `${tag} other`, context: { pinned: true, projectKey: 'other-0000beef' } });
  for (const t of [a, none, other]) store.appendMessage(t.id, { role: 'user', text: 'first' });
  const snap = () => [a, none, other].map((t) => [store.getThread(t.id).updatedAt, store.listMessages(t.id).length, JSON.stringify(store.getThread(t.id).context)]);
  const before = snap();
  const br = mod._testing.askChatMessageBridge({ threadId: a.id });
  try {
    const r = (await postList(br.token, { query: tag })).body.result;
    assert.deepEqual(r.chats.map((c) => c.scope.kind).sort(), ['none', 'project']);
    assert.deepEqual(r.chats.find((c) => c.id === other.id).scope, { kind: 'project', key: 'other-0000beef' });
    const rel = (await mod._testing.askChatMessageExtraDeps(a.id).chatMessages.list({ query: tag }));
    assert.equal(rel.total, 2);
  } finally { br.dispose(); }
  assert.deepEqual(snap(), before);
  assert.equal(running(a.id) || running(none.id) || running(other.id), false, 'no turn started');
});

test('A5 list op: 403 without a token / with a disposed token / with the setting off; unknown op 400; relay deps carry list exactly when they carry send', async () => {
  await setCross(true);
  const a = chat({ title: 'gates' }); const b = chat({ title: 'gates target' });
  const br = mod._testing.askChatMessageBridge({ threadId: a.id });
  try {
    const none = await postList(null, {});
    assert.equal(none.status, 403);
    const unknownOp = await post(br.token, { op: 'delete', input: {} });
    assert.deepEqual([unknownOp.status, unknownOp.body], [400, { error: 'chat messages: unknown op', code: 'CHAT_MESSAGE_BAD_INPUT' }]);
    assert.equal(blocksOf(b.id).length, 0, 'an unknown op sends nothing');
    const send = await post(br.token, { op: 'send', input: { chatId: b.id, text: 'explicit send' } });
    assert.equal(send.status, 200, JSON.stringify(send.body));
    assert.equal(blocksOf(b.id, 'in').length, 1, "op:'send' is a send");
    await setCross(false);
    const off = await postList(br.token, {});
    assert.deepEqual([off.status, off.body.code], [403, 'CHAT_MESSAGES_OFF']);
  } finally { await setCross(true); br.dispose(); }
  const gone = await postList(br.token, {});
  assert.equal(gone.status, 403, 'a disposed token');
  await setCross(false);
  try {
    assert.equal(mod._testing.askChatMessageExtraDeps(a.id).chatMessages, undefined, 'off: neither send nor list');
  } finally { await setCross(true); }
  const deps = mod._testing.askChatMessageExtraDeps(a.id).chatMessages;
  assert.deepEqual(Object.keys(deps).sort(), ['list', 'send']);
  const r = await deps.list({ query: 'gates target' });
  assert.deepEqual(r.chats.map((c) => c.id), [b.id], 'list answers for this chat');
  await idleAll();
});

test('A6 list_chats on a shared install lists only the caller\'s own chats', async () => {
  await setCross(true);
  const tag = listTag();
  process.env.WORCA_IDENTITY_HEADER = 'x-test-user';
  process.env.WORCA_IDENTITY_TRUSTED_PROXIES = '127.0.0.1,::1';
  try {
    const a = chat({ createdBy: 'ann@example.com', title: `${tag} ann one` });
    const a2 = chat({ createdBy: 'ann@example.com', title: `${tag} ann two` });
    chat({ createdBy: 'bob@example.com', title: `${tag} bob` });
    chat({ title: `${tag} nobody` });
    const br = mod._testing.askChatMessageBridge({ threadId: a.id });
    try {
      const { status, body } = await postList(br.token, { query: tag }, { 'x-test-user': 'ann@example.com' });
      assert.equal(status, 200, JSON.stringify(body));
      assert.deepEqual(body.result.chats.map((c) => c.id), [a2.id]);
      assert.equal(body.result.total, 1);
    } finally { br.dispose(); }
  } finally { delete process.env.WORCA_IDENTITY_HEADER; delete process.env.WORCA_IDENTITY_TRUSTED_PROXIES; }
});
