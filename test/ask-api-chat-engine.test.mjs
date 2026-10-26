// test/ask-api-chat-engine.test.mjs — the engine lock over HTTP (cascading-settings-design.md D12).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';

useTempHome(after);
let sandboxHome, srv, base, store, mod;
const prevEnv = {};
const send = async (method, p, b) => { const r = await fetch(`${base}${p}`, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b ?? {}) }); return { status: r.status, body: await r.json() }; };

before(async () => {
  sandboxHome = await mkdtemp(join(tmpdir(), 'worca-ask-lock-home-'));
  for (const k of ['HOME', 'USERPROFILE', 'WORCA_TEST_ALLOW_HOME_FALLBACK', 'WORCA_MOCK']) prevEnv[k] = process.env[k];
  process.env.HOME = sandboxHome; process.env.USERPROFILE = sandboxHome;
  process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = '1';
  process.env.WORCA_MOCK = '1';
  mod = await import('../ui/server.mjs'); srv = mod.server;
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
  store = await import('../src/core/ask/store.mjs');
});
after(async () => {
  if (srv) await Promise.race([new Promise((r) => { srv.close(r); srv.closeAllConnections?.(); }), new Promise((r) => { const t = setTimeout(r, 500); t.unref?.(); })]);
  for (const k of Object.keys(prevEnv)) { if (prevEnv[k] === undefined) delete process.env[k]; else process.env[k] = prevEnv[k]; }
  await rm(sandboxHome, { recursive: true, force: true });
});

function codexChat() {
  const t = store.createThread();
  store.updateThread(t.id, { model: 'gpt-5.5', effort: 'low', engine: 'codex' });
  store.appendMessage(t.id, { role: 'user', text: 'hi' });
  store.appendMessage(t.id, { role: 'assistant', text: 'hello', status: 'done', model: 'gpt-5.5', effort: 'low', engine: 'codex' });
  return t.id;
}

test('a Claude model in a Codex chat is still refused on POST and PATCH: switching is its own route (#943)', async () => {
  const id = codexChat();
  const post = await send('POST', `/api/ask/threads/${id}/messages`, { text: 'again', model: 'claude-opus-5-5', effort: 'high' });
  assert.equal(post.status, 400);
  assert.equal(post.body.error, 'this chat runs on Codex; switch it to Claude from the Chat model picker first');
  const patch = await send('PATCH', `/api/ask/threads/${id}`, { model: 'claude-opus-5-5', effort: 'high' });
  assert.equal(patch.status, 400);
  assert.equal(patch.body.error, 'this chat runs on Codex; switch it to Claude from the Chat model picker first');
  assert.equal(store.getThread(id).model, 'gpt-5.5');
});

// Task 0 (a) was NOT CONFIRMED (plans/ask-on-codex-spike.md): this codex cannot be locked down, so the real catalog offers
// no Codex model and a fresh chat cannot pick one. (With a lockable codex both engines are listed: test/ask-chat-engine.test.mjs.)
test('GET /api/ask/models: per-engine defaults, Codex included; a fresh chat may pick either engine until its first reply', async () => {
  const cat = await (await fetch(`${base}/api/ask/models`)).json();
  assert.equal(cat.models.some((m) => m.engine === 'codex'), true);
  assert.equal(cat.askEngine, 'claude');
  assert.ok(cat.defaults.codex && cat.defaults.codex.model);
  assert.ok(cat.defaults.claude && cat.defaults.claude.model);
  const t = store.createThread();
  const r = await send('PATCH', `/api/ask/threads/${t.id}`, { model: 'gpt-5.5', effort: 'low' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const ok = await send('PATCH', `/api/ask/threads/${t.id}`, { model: 'claude-opus-5-5', effort: 'high' });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
});

test('an event turn in a Codex chat whose pick is no longer valid falls back to the Codex default only — never to Claude', async () => {
  const t = store.createThread();
  store.updateThread(t.id, { model: 'gpt-5.5', effort: 'max' });   // an effort this Codex model does not offer
  store.appendMessage(t.id, { role: 'user', text: 'hi' });
  store.appendMessage(t.id, { role: 'assistant', text: 'here', status: 'done', model: 'gpt-5.5', effort: 'low',
    blocks: [{ kind: 'card', id: 'card_00000901', state: 'proposed', card: { type: 'schedule', summary: 'Start now' } }] });
  const r = await send('POST', `/api/ask/threads/${t.id}/cards/card_00000901`, { state: 'declined' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.block.state, 'declined');
  const cat = await (await fetch(`${base}/api/ask/models`)).json();
  const started = store.getMessage(r.body.turn.assistantMessageId);
  assert.equal(started.model, cat.defaults.codex.model, 'the Codex default');
  assert.notEqual(started.model, cat.defaults.claude.model, 'never Claude');
  assert.equal(store.getThread(t.id).engine, 'codex', 'the turn stored its engine on the thread');
});

test('an event turn in a Codex chat whose model left the catalog stays on Codex and says so in the chat', async () => {
  const t = store.createThread();
  store.updateThread(t.id, { model: 'gpt-retired-9', effort: 'low', engine: 'codex' });   // no catalog knows this id
  store.appendMessage(t.id, { role: 'user', text: 'hi' });
  store.appendMessage(t.id, { role: 'assistant', text: 'here', status: 'done', model: 'gpt-retired-9', effort: 'low',
    blocks: [{ kind: 'card', id: 'card_00000902', state: 'proposed', card: { type: 'schedule', summary: 'Start now' } }] });
  const r = await send('POST', `/api/ask/threads/${t.id}/cards/card_00000902`, { state: 'declined' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const cat = await (await fetch(`${base}/api/ask/models`)).json();
  const started = store.getMessage(r.body.turn.assistantMessageId);
  assert.equal(started.model, cat.defaults.codex.model, 'the Codex default, not Claude');
  const notice = store.listMessages(t.id).find((m) => m.role === 'system' && /gpt-retired-9/.test(m.text));
  assert.ok(notice, 'a notice names the missing model');
  assert.match(notice.text, /Codex's default/);
  assert.equal(store.getThread(t.id).engine, 'codex');
});

test('GET a thread: the payload names the engine the chat is locked to, null before its first reply', async () => {
  const id = codexChat();
  assert.equal((await (await fetch(`${base}/api/ask/threads/${id}`)).json()).thread.engine, 'codex');
  const fresh = store.createThread();
  assert.equal((await (await fetch(`${base}/api/ask/threads/${fresh.id}`)).json()).thread.engine, null);
});

test('a Cursor catalog model is an unknown model to Ask: refused before anything is stored', async () => {
  await (await import('../src/core/settings.mjs')).addGlobalModel({ id: 'cursor-m', engine: 'cursor' });
  const t = store.createThread();
  const post = await send('POST', `/api/ask/threads/${t.id}/messages`, { text: 'hi', model: 'cursor-m', effort: 'high' });
  assert.equal(post.status, 400);
  assert.equal(post.body.error, 'unknown model "cursor-m"');
  assert.equal(store.getThread(t.id).model ?? null, null);
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** The thread's turn is over (askJobs no longer says running): never end a test with a turn alive. */
async function idle(id) {
  for (let i = 0; i < 500 && mod._testing.askJobs.get(id)?.status === 'running'; i++) await sleep(10);
  assert.notEqual(mod._testing.askJobs.get(id)?.status, 'running', 'the turn settled');
}
const SWITCH = (id, body) => send('POST', `/api/ask/threads/${id}/engine`, body);

test('POST …/engine dryRun previews the switch and writes nothing (#943)', async () => {
  const id = codexChat();
  const before = store.getThread(id);
  const r = await SWITCH(id, { engine: 'claude', model: 'claude-opus-5-5', effort: 'high', dryRun: true });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual([r.body.from, r.body.to, r.body.model, r.body.effort], ['codex', 'claude', 'claude-opus-5-5', 'high']);
  assert.deepEqual(r.body.transcript, { totalTurns: 1, droppedTurns: 0 });
  assert.deepEqual(r.body.changes.map((c) => c.key), ['tools']);
  assert.deepEqual(r.body.mcpLost, []);
  assert.deepEqual(r.body.attachments, []);
  assert.deepEqual(r.body.context, { from: 200_000, to: 1_000_000 }, 'gpt-5.5 counts as 200k, Opus 5.5 is a 1M model');
  assert.deepEqual(store.getThread(id), before);
  assert.equal(store.listMessages(id).length, 2);
});

test('POST …/engine dryRun names the PDFs and the MCP servers the destination cannot take (#943)', async (t) => {
  // General holds one remote server: Claude attaches it, Codex takes stdio servers only (unattachableMcp).
  const { addManualServer, putMember, deleteMember } = await import('../src/core/mcp/store.mjs');
  const def = await addManualServer('docs', { type: 'http', url: 'https://docs.example.com/mcp', fields: [] });
  await putMember('general', 'manual:docs', { enabled: true, values: {} }, { def });
  t.after(() => deleteMember('general', 'manual:docs'));
  const th = store.createThread();
  store.updateThread(th.id, { model: 'claude-opus-5-5', effort: 'high', engine: 'claude' });
  const user = store.appendMessage(th.id, { role: 'user', text: 'read these' });
  store.appendMessage(th.id, { role: 'assistant', text: 'read', status: 'done', model: 'claude-opus-5-5', effort: 'high', engine: 'claude' });
  const pdf = store.addAttachment(th.id, user.id, { name: 'spec.pdf', kind: 'binary', mime: 'application/pdf', data: Buffer.from('%PDF-1.4\n') });
  store.addAttachment(th.id, user.id, { name: 'notes.txt', text: 'plain text travels' });
  const r = await SWITCH(th.id, { engine: 'codex', model: 'gpt-5.5', effort: 'low', dryRun: true });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.attachments, [{ id: pdf.id, name: 'spec.pdf' }], 'the PDF only: Codex reads text');
  assert.deepEqual(r.body.mcpLost, ['docs'], 'the remote server Codex cannot start');
  assert.deepEqual(store.getThread(th.id).engine, 'claude');
});

test('POST …/engine switches in one step; the next turn starts a fresh session with the transcript and records its engine', async () => {
  const id = codexChat();
  store.updateThread(id, { sessionId: 'codex:thr-1' });
  const r = await SWITCH(id, { engine: 'claude', model: 'claude-opus-5-5', effort: 'high', dropTurns: 0 });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.engineSwitch, { engine: 'claude', model: 'claude-opus-5-5', effort: 'high' });
  const t = store.getThread(id);
  assert.equal(t.id, id);
  assert.deepEqual([t.engine, t.model, t.effort, t.sessionId], ['claude', 'claude-opus-5-5', 'high', null]);
  const rows = store.listMessages(id);
  assert.deepEqual(rows.slice(0, 2).map((m) => m.text), ['hi', 'hello'], 'earlier messages are untouched');
  const div = rows.at(-1);
  assert.deepEqual([div.role, div.text], ['system', 'Switched from Codex to Claude']);
  assert.deepEqual(div.blocks[0].engineSwitch, { from: 'codex', to: 'claude', model: 'claude-opus-5-5', effort: 'high', droppedTurns: 0 });
  assert.equal((await (await fetch(`${base}/api/ask/threads/${id}`)).json()).thread.engine, 'claude');
  const post = await send('POST', `/api/ask/threads/${id}/messages`, { text: 'and now?', model: 'claude-opus-5-5', effort: 'high' });
  assert.equal(post.status, 202, JSON.stringify(post.body));
  const job = mod._testing.askJobs.get(id);
  assert.equal(job.turn.resumeSessionId, null, 'never the other engine\'s session');
  assert.match(job.turn.prompt, /^Conversation so far in this chat\. You start a fresh Claude session/);
  assert.match(job.turn.prompt, /User: hi\n\nAssistant \(Codex, gpt-5\.5\): hello/);
  assert.match(job.turn.prompt, /and now\?$/);
  await idle(id);
  const reply = store.listMessages(id).filter((m) => m.role === 'assistant').at(-1);
  assert.deepEqual([reply.engine, reply.model, reply.effort], ['claude', 'claude-opus-5-5', 'high']);
});

test('refused, nothing changes: a running turn, a model the destination does not run, an unconfirmed drop; switching back is fresh again', async () => {
  const id = codexChat();
  mod._testing.askJobs.set(id, { status: 'running', messageId: null, events: [], seq: 0, graceTimer: null });
  try {
    const busy = await SWITCH(id, { engine: 'claude', model: 'claude-opus-5-5', effort: 'high' });
    assert.equal(busy.status, 409);
    assert.equal(busy.body.code, 'TURN_IN_FLIGHT');
    assert.equal((await SWITCH(id, { engine: 'claude', model: 'claude-opus-5-5', effort: 'high', dryRun: true })).body.code, 'TURN_IN_FLIGHT', 'no preview mid-reply either');
  } finally { mod._testing.askJobs.delete(id); }
  const wrong = await SWITCH(id, { engine: 'claude', model: 'gpt-5.5', effort: 'low' });
  assert.equal(wrong.status, 400);
  assert.equal(wrong.body.error, 'gpt-5.5 does not run on Claude: pick a model from its section');
  assert.equal((await SWITCH(id, { engine: 'codex', model: 'gpt-5.5', effort: 'low' })).status, 400, 'already there');
  for (const fill of ['x', 'y']) {
    store.appendMessage(id, { role: 'user', text: fill.repeat(250_000) });
    store.appendMessage(id, { role: 'assistant', text: 'ok', status: 'done', model: 'gpt-5.5', effort: 'low', engine: 'codex' });
  }
  const plan = await SWITCH(id, { engine: 'claude', model: 'claude-opus-5-5', effort: 'high', dryRun: true });
  assert.ok(plan.body.transcript.droppedTurns >= 1, JSON.stringify(plan.body.transcript));
  const unconfirmed = await SWITCH(id, { engine: 'claude', model: 'claude-opus-5-5', effort: 'high' });
  assert.equal(unconfirmed.status, 409);
  assert.equal(unconfirmed.body.code, 'confirm-dropped-turns');
  assert.equal(unconfirmed.body.droppedTurns, plan.body.transcript.droppedTurns);
  assert.equal(store.getThread(id).engine, 'codex', 'still on Codex');
  const ok = await SWITCH(id, { engine: 'claude', model: 'claude-opus-5-5', effort: 'high', dropTurns: plan.body.transcript.droppedTurns });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  store.updateThread(id, { sessionId: 'claude-session-1' });
  const backPlan = await SWITCH(id, { engine: 'codex', model: 'gpt-5.5', effort: 'low', dryRun: true });
  const back = await SWITCH(id, { engine: 'codex', model: 'gpt-5.5', effort: 'low', dropTurns: backPlan.body.transcript.droppedTurns });
  assert.equal(back.status, 200, JSON.stringify(back.body));
  assert.deepEqual([store.getThread(id).engine, store.getThread(id).sessionId], ['codex', null], 'a fresh Codex session, not the old one');
});

test('after a switch an event turn runs on the new engine', async () => {
  const id = codexChat();
  assert.equal((await SWITCH(id, { engine: 'claude', model: 'claude-opus-5-5', effort: 'high', dropTurns: 0 })).status, 200);
  store.appendMessage(id, { role: 'assistant', text: 'here', status: 'done', model: 'claude-opus-5-5', effort: 'high', engine: 'claude',
    blocks: [{ kind: 'card', id: 'card_00000903', state: 'proposed', card: { type: 'schedule', summary: 'Start now' } }] });
  const r = await send('POST', `/api/ask/threads/${id}/cards/card_00000903`, { state: 'declined' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const started = store.getMessage(r.body.turn.assistantMessageId);
  assert.deepEqual([started.engine, started.model], ['claude', 'claude-opus-5-5']);
  await idle(id);
});

test('a chat with no reply yet and a Workflows chat cannot switch', async () => {
  const fresh = store.createThread();
  assert.equal((await SWITCH(fresh.id, { engine: 'codex', model: 'gpt-5.5', effort: 'low' })).body.code, 'no-engine-yet');
  const comp = store.createThread({ mode: 'composer' });
  assert.equal((await SWITCH(comp.id, { engine: 'codex', model: 'gpt-5.5', effort: 'low' })).status, 400);
});

test('a destination its checks refuse is refused at the preview already, and nothing changes', async () => {
  const id = codexChat();
  assert.equal((await send('POST', '/api/settings', { askMaxBudgetUsd: 5 })).status, 200);   // a per-turn cost cap: an unpriced model cannot keep it
  try {
    const plan = await SWITCH(id, { engine: 'copilot', model: 'copilot/gpt-5.4', effort: 'high', dryRun: true });
    assert.equal(plan.status, 409, JSON.stringify(plan.body));
    assert.equal(plan.body.code, 'engine-refused');
    assert.match(plan.body.error, /^A per-turn cost cap is set, and worca has no price for copilot\/gpt-5\.4/);
    assert.equal((await SWITCH(id, { engine: 'copilot', model: 'copilot/gpt-5.4', effort: 'high', dropTurns: 0 })).body.code, 'engine-refused');
  } finally {
    assert.equal((await send('POST', '/api/settings', { askMaxBudgetUsd: null })).status, 200);
  }
  assert.deepEqual([store.getThread(id).engine, store.listMessages(id).length], ['codex', 2]);
});

test('the dropped count includes the switch\'s own row, as the first turn after it sees it', async () => {
  const id = codexChat();
  store.appendMessage(id, { role: 'user', text: 'x'.repeat(399_900) });
  store.appendMessage(id, { role: 'assistant', text: 'ok', status: 'done', model: 'gpt-5.5', effort: 'low', engine: 'codex' });
  // Opus 5.5's budget is 400 000 characters: the two turns take 399 985 with their separators, 400 024 with the
  // "System: Switched from Codex to Claude" row.
  const plan = await SWITCH(id, { engine: 'claude', model: 'claude-opus-5-5', effort: 'high', dryRun: true });
  assert.deepEqual(plan.body.transcript, { totalTurns: 2, droppedTurns: 1 });
});

test('a turn started from a snapshot read before a switch is refused: it never runs on the engine the chat left', async () => {
  const id = codexChat();
  const stale = store.getThread(id);
  assert.equal((await SWITCH(id, { engine: 'claude', model: 'claude-opus-5-5', effort: 'high', dropTurns: 0 })).status, 200);
  const n = store.listMessages(id).length;
  const r = await mod._testing.startAskTurn({ threadId: id, thread: stale, ctx: stale.context || {}, model: 'gpt-5.5', effort: 'low', text: 'late' });
  assert.deepEqual([r.ok, r.status, r.code], [false, 409, 'engine-changed']);
  assert.deepEqual([store.getThread(id).engine, store.listMessages(id).length], ['claude', n], 'nothing written');
  assert.equal(mod._testing.askJobs.has(id), false, 'no turn slot held');
});

test('a chat with no reply yet whose model moved meanwhile still starts: it has no engine to protect yet', async () => {
  const t = store.createThread();
  store.updateThread(t.id, { model: 'claude-opus-5-5', effort: 'high' });
  const stale = store.getThread(t.id);
  assert.equal((await send('PATCH', `/api/ask/threads/${t.id}`, { model: 'gpt-5.5', effort: 'low' })).status, 200);
  const r = await mod._testing.startAskTurn({ threadId: t.id, thread: stale, ctx: {}, model: 'gpt-5.5', effort: 'low', text: 'first' });
  assert.equal(r.ok, true, JSON.stringify(r));
  await idle(t.id);
});
