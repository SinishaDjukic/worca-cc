// test/ask-api-mcp.test.mjs — MCP registry §9 end to end over WORCA_MOCK: POST /api/ask/mcp-preview, the message
// route (the turn carries the resolve, the prompt its section), the per-chat choices, a card-event turn.
// Seeds the registry through the store API (src/core/mcp/store.mjs) — never by writing its files.
// Boot idiom: test/ask-api-memory-mount.test.mjs (temp home BEFORE the dynamic import).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { withGw } from './helpers/with-env.mjs';
import { checkRows } from './helpers/rows.mjs';

useTempHome(after);

let homeDir, prevHome, srv, base, mod;
const JSONH = { 'Content-Type': 'application/json' };
const MODEL = { model: 'claude-opus-5-5', effort: 'high' };
const post = (p, body) => fetch(`${base}${p}`, { method: 'POST', headers: JSONH, body: JSON.stringify(body) });
const patch = (p, body) => fetch(`${base}${p}`, { method: 'PATCH', headers: JSONH, body: JSON.stringify(body) });
const preview = (body) => post('/api/ask/mcp-preview', { context: { view: 'new', pinned: false }, model: MODEL.model, ...body });
const idle = async () => {
  for (let i = 0; i < 500 && [...mod._testing.askJobs.values()].some((j) => j.status === 'running'); i++) await new Promise((r) => setTimeout(r, 10));
};
const turnOf = async (threadId) => {
  for (let i = 0; i < 500 && !mod._testing.askJobs.get(threadId)?.turn; i++) await new Promise((r) => setTimeout(r, 10));
  return mod._testing.askJobs.get(threadId).turn;
};

before(async () => {
  homeDir = await mkdtemp(join(tmpdir(), 'worca-cc-askmcp-'));
  prevHome = process.env.WORCA_HOME;
  process.env.WORCA_HOME = homeDir;
  process.env.WORCA_MOCK = '1';
  mod = await import('../ui/server.mjs');
  srv = mod.server;
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
  // General: one manual http server with no fields (every Ask turn gets it, spec D12) and one whose required
  // token is not set (skipped `missing:token`, §5.7).
  const { addManualServer, putMember } = await import('../src/core/mcp/store.mjs');
  const def = await addManualServer('docs', { type: 'http', url: 'https://docs.example.com/mcp', fields: [], description: 'Team docs' });
  await putMember('general', 'manual:docs', { enabled: true, values: {} }, { def });
  const tickets = await addManualServer('tickets', { type: 'http', url: 'https://tickets.example.com/mcp', fields: [{ key: 'token', label: 'API token', secret: true, required: true }] });
  await putMember('general', 'manual:tickets', { enabled: true, values: {} }, { def: tickets });
});

after(async () => {
  for (const [, job] of mod._testing.askJobs) { try { job.turn?.stop?.(); } catch { /* reap */ } }
  if (srv) await Promise.race([
    new Promise((r) => { srv.close(r); srv.closeAllConnections?.(); }),
    new Promise((r) => { const t = setTimeout(r, 500); t.unref?.(); }),
  ]);
  if (prevHome === undefined) delete process.env.WORCA_HOME; else process.env.WORCA_HOME = prevHome;
  delete process.env.WORCA_MOCK;
  await rm(homeDir, { recursive: true, force: true });
});

test('POST /api/ask/mcp-preview validates every field before resolving', async () => {
  for (const [body, status] of [
    [{ context: 'x' }, 400], [{ context: { projectKey: 'Bad Key' } }, 400], [{ threadId: '../x' }, 400], [{ threadId: 'ask_ffffffff' }, 404],
    [{ mcpOff: { sets: ['Bad Id'] } }, 400], [{ model: 5 }, 400], [{ model: 'm'.repeat(201) }, 400],
  ]) assert.equal((await preview(body)).status, status, JSON.stringify(body));
});

test('the preview equals the turn\'s resolution: General\'s copy in both, the prompt section present, no secret or env in the preview', async () => {
  const p = await (await preview({})).json();
  assert.deepEqual(Object.keys(p).sort(), ['copies', 'newer', 'sets', 'skills', 'skipped', 'skippedTools', 'started'], 'P4\'s preview fields, minus message/deviations, plus the skills block (skills registry §4.4)');
  assert.equal(p.newer, false);
  assert.deepEqual(p.skippedTools, []);
  assert.deepEqual(p.copies.map((c) => c.name), ['docs']);
  assert.equal(p.started, 1);
  assert.deepEqual(p.skipped.map((s) => [s.copy, s.reason, s.why]), [['tickets', 'missing:token', 'API token not set']]);
  await idle();
  const { thread } = await (await post('/api/ask/threads', {})).json();
  const r = await post(`/api/ask/threads/${thread.id}/messages`, { text: 'hi', ...MODEL, context: { view: 'new', pinned: false } });
  assert.equal(r.status, 202, await r.text());
  const turn = await turnOf(thread.id);
  assert.deepEqual(turn.mcp.copies, p.copies, 'the same targets in play and resolver as the preview');
  assert.deepEqual(turn.mcp.skipped.map((s) => s.reason), p.skipped.map((s) => s.reason));
  assert.match(turn.systemPrompt, /\n## MCP servers\n/);
  assert.match(turn.systemPrompt, /\n- docs — Team docs · set General\n/);
  assert.equal(typeof turn.deps.mcpJoinNotice, 'function', 'the turn-end notice is wired');
});

test('mcpOff precedence: a PATCH applies from the next turn and the preview; a body mcpOff overrides the stored one and decides that very turn', async () => {
  await checkRows([
    { name: 'per-chat choices: a { mcpOff } PATCH applies from the next turn and the preview (threadId); a body mcpOff overrides the stored one', run: async () => {
      await idle();
      const { thread } = await (await post('/api/ask/threads', {})).json();
      assert.equal((await patch(`/api/ask/threads/${thread.id}`, { mcpOff: { sets: ['general'] } })).status, 200);
      const off = await (await preview({ threadId: thread.id })).json();
      assert.equal(off.started, 0);
      assert.deepEqual(off.skipped.map((s) => [s.copy, s.reason]), [['docs', 'chat-off'], ['tickets', 'chat-off']]);
      assert.equal((await (await preview({ threadId: thread.id, mcpOff: null })).json()).started, 1, 'a thread-less choice set overrides');
      const r = await post(`/api/ask/threads/${thread.id}/messages`, { text: 'hi', ...MODEL, context: { view: 'new', pinned: false } });
      assert.equal(r.status, 202);
      const turn = await turnOf(thread.id);
      assert.equal(turn.mcp, null, 'no copies this turn');
      assert.ok(!turn.systemPrompt.includes('## MCP servers'), 'the prompt is byte-identical to a chat without servers');
    } },
    { name: 'a message body mcpOff decides that very turn, over the stored choices (the thread row is read before the write)', run: async () => {
      await idle();
      const { thread } = await (await post('/api/ask/threads', {})).json();
      assert.equal((await patch(`/api/ask/threads/${thread.id}`, { mcpOff: { sets: ['general'] } })).status, 200);
      const r = await post(`/api/ask/threads/${thread.id}/messages`, { text: 'hi', ...MODEL, context: { view: 'new', pinned: false }, mcpOff: null });
      assert.equal(r.status, 202, await r.text());
      const turn = await turnOf(thread.id);
      assert.deepEqual(turn.mcp && turn.mcp.copies.map((c) => c.name), ['docs'], 'the body choices (all on), not the stored ones (General off)');
    } },
  ]);
});

test('the composer model sets the §5.6 tool-name limit: a translated model skips the never-tested copy', async () => {
  // withGw (P4): HOME sandboxed to a global model catalog holding the bridge-translated `gw-gpt` (limit 64).
  const p = await withGw(async () => (await preview({ model: 'gw-gpt' })).json());
  assert.equal(p.started, 0);
  assert.deepEqual(p.skipped.map((s) => [s.copy, s.reason]), [['docs', 'untested'], ['tickets', 'missing:token']]);
  assert.equal((await (await preview({})).json()).started, 1, 'a first-party model keeps the 128 limit');
});

test('server wiring: a card-event turn recomputes from stored context/choices; the thread\'s open worktrees feed the join notice and the preview', async () => {
  await checkRows([
    { name: 'a card-event turn recomputes from the stored context and choices', run: async () => {
      await idle();
      const { appendMessage } = await import('../src/core/ask/store.mjs');
      const { thread } = await (await post('/api/ask/threads', {})).json();
      appendMessage(thread.id, { role: 'user', text: 'hi' });
      appendMessage(thread.id, { role: 'assistant', text: 'ok', status: 'done', blocks: [{ kind: 'card', id: 'card_0000abcd', state: 'proposed', card: { type: 'model', summary: 'Add a model' } }] });
      assert.equal((await patch(`/api/ask/threads/${thread.id}`, { mcpOff: { members: ['general|manual:docs'] } })).status, 200);
      const r = await post(`/api/ask/threads/${thread.id}/cards/card_0000abcd`, { state: 'declined' });
      assert.equal(r.status, 200, await r.text());
      const turn = await turnOf(thread.id);
      assert.equal(turn.mcp, null, 'the stored choice switched the only copy off');
      assert.equal((await patch(`/api/ask/threads/${thread.id}`, { mcpOff: null })).status, 200);
      await idle();
      appendMessage(thread.id, { role: 'assistant', text: 'ok', status: 'done', blocks: [{ kind: 'card', id: 'card_0000abce', state: 'proposed', card: { type: 'model', summary: 'Another' } }] });
      assert.equal((await post(`/api/ask/threads/${thread.id}/cards/card_0000abce`, { state: 'declined' })).status, 200);
      for (let i = 0; i < 500 && mod._testing.askJobs.get(thread.id)?.turn === turn; i++) await new Promise((res) => setTimeout(res, 10));
      assert.deepEqual(mod._testing.askJobs.get(thread.id).turn.mcp.copies.map((c) => c.name), ['docs'], 'recomputed, not the first turn\'s result');
    } },
    { name: 'the server wiring reads the thread\'s open worktrees: the turn-end join notice and the preview (threadId)', run: async () => {
      await idle();
      const { addProject } = await import('../src/core/projects.mjs');
      const { gitDir } = await import('./helpers/git-dir.mjs');
      const shop = (await addProject({ name: 'shop', path: gitDir('askmcp-shop') })).find((p) => p.name === 'shop');
      const { addManualServer, createSet, putMember, setProjectAssignment } = await import('../src/core/mcp/store.mjs');
      const def = await addManualServer('tracker', { type: 'http', url: 'https://tracker.example.com/mcp', fields: [] });
      const set = await createSet('Shop');
      await putMember(set.id, 'manual:tracker', { enabled: true, values: {} }, { def });
      await setProjectAssignment(shop.key, { sets: [set.id], includeGeneral: true });
      const { thread } = await (await post('/api/ask/threads', {})).json();
      const r = await post(`/api/ask/threads/${thread.id}/messages`, { text: 'hi', ...MODEL, context: { view: 'settings', pinned: false } });
      assert.equal(r.status, 202, await r.text());
      const turn = await turnOf(thread.id);
      assert.ok(!turn.mcp.copies.some((c) => c.name === 'tracker_shop'), 'precondition: shop is not in play at turn start');
      // the model opens a worktree on shop during the turn (open_worktree → openAskWorktree)
      const { openAskWorktree } = await import('../src/core/ask/worktrees.mjs');
      await openAskWorktree({ threadId: thread.id, projectKey: shop.key, ref: 'HEAD' });
      assert.equal(await turn.deps.mcpJoinNotice(), "shop's MCP servers (tracker_shop) join from the next message");
      assert.equal((await patch(`/api/ask/threads/${thread.id}`, { mcpOff: { sets: [set.id] } })).status, 200);
      assert.equal(await turn.deps.mcpJoinNotice(), null, 'the stored choices at turn end: a set switched off in this chat joins nothing');
      assert.equal((await patch(`/api/ask/threads/${thread.id}`, { mcpOff: null })).status, 200);
      const p = await (await preview({ threadId: thread.id })).json();
      assert.ok(p.copies.some((c) => c.name === 'tracker_shop'), 'the preview adds the thread\'s open worktrees');
    } },
  ]);
});

// ---- the MCP server card (docs/mcp-servers.md "Chat"): the cards route over the real registry ---------------------
const snap = async (id) => (await fetch(`${base}/api/ask/threads/${id}`)).json();
async function waitFor(pred, ms = 10000) {
  const t0 = Date.now();
  for (;;) {
    const v = await pred();
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, 25));
  }
}
/** A proposed `mcp` card made by the real validator (the server shares WORCA_HOME), seeded as in ask-actions-card. */
async function seedMcpCard(card) {
  await idle();
  const { appendMessage } = await import('../src/core/ask/store.mjs');
  const { thread } = await (await post('/api/ask/threads', {})).json();
  appendMessage(thread.id, { role: 'user', text: 'hi' });
  const cardId = `card_${Math.random().toString(16).slice(2, 10).padEnd(8, '0')}`;
  appendMessage(thread.id, { role: 'assistant', text: 'ok', status: 'done', blocks: [{ kind: 'card', id: cardId, state: 'proposed', card }] });
  return { threadId: thread.id, cardId };
}
const mcpCard = async (input) => {
  const { validateMcpChange } = await import('../src/core/ask/mcp-deps.mjs');
  const r = await validateMcpChange(input);
  assert.equal(r.ok, true, JSON.stringify(r));
  return r.card;
};
const eventOf = (threadId) => waitFor(async () => (await snap(threadId)).messages.find((m) => m.role === 'user' && /^\[worca event\] mcp card /.test(m.text || '')));
const noticeOf = (threadId) => waitFor(async () => {
  const n = (await snap(threadId)).messages.filter((m) => m.role === 'user' && (m.blocks || []).some((b) => b.kind === 'notice' && b.synthetic)).map((m) => m.blocks[0].text);
  return n.length ? n : null;
});
const serversFile = async () => {
  const { mcpDir } = await import('../src/core/mcp/store.mjs');
  return join(mcpDir(), 'servers.json');
};
const setsHold = async (id) => {
  const { readFileSync } = await import('node:fs');
  const { mcpDir } = await import('../src/core/mcp/store.mjs');
  return Object.values(JSON.parse(readFileSync(join(mcpDir(), 'sets.json'), 'utf8')).sets || {}).some((s) => s.members.some((m) => m.server === id));
};
const GH_ADD = { kind: 'add', name: 'github', type: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-github'], env: { GITHUB_TOKEN: { secret: true } } };

test('mcp card: Apply adds the definition only and posts the event; Decline writes nothing; a second apply is 409; a bad state 400', async () => {
  const { readFileSync } = await import('node:fs');
  const a = await seedMcpCard(await mcpCard(GH_ADD));
  assert.equal((await post(`/api/ask/threads/${a.threadId}/cards/${a.cardId}`, { state: 'started' })).status, 400);
  const r = await post(`/api/ask/threads/${a.threadId}/cards/${a.cardId}`, { state: 'applied' });
  assert.equal(r.status, 200, await r.clone().text());
  const j = await r.json();
  assert.equal(j.block.state, 'applied', JSON.stringify(j.block));
  assert.match(j.block.card.result.detail, /Added github/);
  assert.ok(JSON.parse(readFileSync(await serversFile(), 'utf8')).manual.github);
  assert.equal(await setsHold('manual:github'), false, 'applying adds the server to no set');
  assert.match((await eventOf(a.threadId)).text, /^\[worca event\] mcp card \S+ applied; "Add MCP server github \(stdio\)"/);
  assert.ok((await noticeOf(a.threadId))[0].startsWith('Applied — '));
  assert.equal((await post(`/api/ask/threads/${a.threadId}/cards/${a.cardId}`, { state: 'applied' })).status, 409, 'applied once');
  await idle();

  const d = await seedMcpCard(await mcpCard({ ...GH_ADD, name: 'other' }));
  const before = readFileSync(await serversFile());
  const dr = await post(`/api/ask/threads/${d.threadId}/cards/${d.cardId}`, { state: 'declined' });
  assert.equal(dr.status, 200);
  assert.equal((await dr.json()).block.state, 'declined');
  assert.ok(readFileSync(await serversFile()).equals(before), 'declining leaves servers.json byte-identical');
  assert.equal((await eventOf(d.threadId)).text, `[worca event] mcp card ${d.cardId} declined; "Add MCP server other (stdio)"`);
  await idle();
});

test('mcp card: Apply while the chat replies is a 409 `turn in flight` that writes nothing and keeps the card proposed', async () => {
  const { readFileSync } = await import('node:fs');
  const s = await seedMcpCard(await mcpCard({ ...GH_ADD, name: 'busyx' }));
  mod._testing.askJobs.set(s.threadId, { status: 'running' });
  try {
    const r = await post(`/api/ask/threads/${s.threadId}/cards/${s.cardId}`, { state: 'applied' });
    assert.equal(r.status, 409);
    assert.equal((await r.json()).error, 'turn in flight');
  } finally { mod._testing.askJobs.delete(s.threadId); }
  assert.equal(JSON.parse(readFileSync(await serversFile(), 'utf8')).manual.busyx, undefined, 'nothing saved');
  const block = (await snap(s.threadId)).messages.flatMap((m) => m.blocks || []).find((b) => b.id === s.cardId);
  assert.equal(block.state, 'proposed');
  const ok = await post(`/api/ask/threads/${s.threadId}/cards/${s.cardId}`, { state: 'applied' });
  assert.equal((await ok.json()).block.state, 'applied', 'applies once the reply has landed');
  await idle();
});

test('mcp card: a stale edit card fails with the store\'s error and the event says so', async () => {
  const { addManualServer, editManualServer, readMcpStore } = await import('../src/core/mcp/store.mjs');
  await addManualServer('gh', { type: 'stdio', command: 'npx', args: ['-y'], env: {}, fields: [] });
  const card = await mcpCard({ kind: 'edit', name: 'gh', type: 'stdio', command: 'npx', args: ['-y', '--read-only'] });
  const stored = (await readMcpStore()).manual.gh;
  await editManualServer('gh', { ...stored, description: 'changed in Settings' });
  const s = await seedMcpCard(card);
  const r = await post(`/api/ask/threads/${s.threadId}/cards/${s.cardId}`, { state: 'applied' });
  assert.equal(r.status, 200, await r.clone().text());
  const j = await r.json();
  assert.equal(j.block.state, 'failed', JSON.stringify(j.block));
  assert.match((await eventOf(s.threadId)).text, /mcp card \S+ failed: gh changed since this card was made/);
  assert.equal((await readMcpStore()).manual.gh.description, 'changed in Settings');
  await idle();
});

// The UI token marks a person (agentMayBeCaller is false with it), so an agent caller meets the global G1 gate first;
// the route's own agentMayBeCaller line is the second layer behind it, as on the actions card.
test('mcp card: an agent caller cannot apply, and with the UI token (a person) the same request applies', async () => {
  const s = await seedMcpCard(await mcpCard({ ...GH_ADD, name: 'agentx' }));
  const homeOs = await mkdtemp(join(tmpdir(), 'worca-cc-askmcp-agent-'));
  process.env.WORCA_AGENT_USER = 'worca-agent';
  process.env.WORCA_AGENT_HOME = join(homeOs, 'agent');
  try {
    const r = await post(`/api/ask/threads/${s.threadId}/cards/${s.cardId}`, { state: 'applied' });
    assert.deepEqual([r.status, (await r.json()).code], [403, 'AGENT_CALLER_BLOCKED']);
    const still = (await (await fetch(`${base}/api/ask/threads/${s.threadId}`, { headers: { 'x-worca-ui-token': mod._testing.uiToken() } })).json())
      .messages.flatMap((m) => m.blocks || []).find((b) => b.id === s.cardId);
    assert.equal(still.state, 'proposed');
    const { readMcpStore } = await import('../src/core/mcp/store.mjs');
    assert.equal((await readMcpStore()).manual.agentx, undefined);
    const ok = await fetch(`${base}/api/ask/threads/${s.threadId}/cards/${s.cardId}`, { method: 'POST',
      headers: { ...JSONH, 'x-worca-ui-token': mod._testing.uiToken() }, body: JSON.stringify({ state: 'applied' }) });
    assert.equal(ok.status, 200);
    assert.equal((await ok.json()).block.state, 'applied');
  } finally {
    delete process.env.WORCA_AGENT_USER; delete process.env.WORCA_AGENT_HOME;
    await rm(homeOs, { recursive: true, force: true });
  }
  await idle();
});
