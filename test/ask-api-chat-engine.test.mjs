// test/ask-api-chat-engine.test.mjs — the engine lock over HTTP (cascading-settings-design.md D12).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';

useTempHome(after);
let sandboxHome, srv, base, store;
const prevEnv = {};
const send = async (method, p, b) => { const r = await fetch(`${base}${p}`, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b ?? {}) }); return { status: r.status, body: await r.json() }; };

before(async () => {
  sandboxHome = await mkdtemp(join(tmpdir(), 'worca-ask-lock-home-'));
  for (const k of ['HOME', 'USERPROFILE', 'WORCA_TEST_ALLOW_HOME_FALLBACK', 'WORCA_MOCK']) prevEnv[k] = process.env[k];
  process.env.HOME = sandboxHome; process.env.USERPROFILE = sandboxHome;
  process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = '1';
  process.env.WORCA_MOCK = '1';
  srv = (await import('../ui/server.mjs')).server;
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
  store.updateThread(t.id, { model: 'gpt-5.5', effort: 'low' });
  store.appendMessage(t.id, { role: 'user', text: 'hi' });
  store.appendMessage(t.id, { role: 'assistant', text: 'hello', status: 'done', model: 'gpt-5.5', effort: 'low' });
  return t.id;
}

test('a Claude model in a Codex chat is refused on POST and PATCH; the thread is unchanged', async () => {
  const id = codexChat();
  const post = await send('POST', `/api/ask/threads/${id}/messages`, { text: 'again', model: 'claude-opus-5-5', effort: 'high' });
  assert.equal(post.status, 400);
  assert.equal(post.body.error, 'this chat runs on Codex; start a new chat to use Claude');
  const patch = await send('PATCH', `/api/ask/threads/${id}`, { model: 'claude-opus-5-5', effort: 'high' });
  assert.equal(patch.status, 400);
  assert.equal(patch.body.error, 'this chat runs on Codex; start a new chat to use Claude');
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
