// test/ask-model-card.test.mjs
// The model card end to end over WORCA_MOCK (docs/models.md "Ask Worca"): "add a local llama model"
// proposes a keyless llama.cpp entry the parent re-validates against the real catalog; declining
// changes nothing; applying writes it to settings.json through the same setter the Models view
// uses and the event turn answers; a removal card takes it out again. Sandboxes HOME
// (settings.json) + WORCA_HOME (DB).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _resetForTests as closeDbForTests } from '../src/core/db.mjs';

let srv, base, mod, homeDir, worcaHomeDir;
const prevEnv = {
  HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, WORCA_HOME: process.env.WORCA_HOME,
  WORCA_TEST_ALLOW_HOME_FALLBACK: process.env.WORCA_TEST_ALLOW_HOME_FALLBACK, WORCA_MOCK: process.env.WORCA_MOCK,
};
const JSONH = { 'Content-Type': 'application/json' };
const MODEL = { model: 'claude-opus-5', effort: 'high' };

before(async () => {
  homeDir = await mkdtemp(join(tmpdir(), 'worca-cc-askmodel-home-'));
  worcaHomeDir = await mkdtemp(join(tmpdir(), 'worca-cc-askmodel-whome-'));
  process.env.HOME = homeDir; process.env.USERPROFILE = homeDir; process.env.WORCA_HOME = worcaHomeDir;
  process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = '1';
  process.env.WORCA_MOCK = '1';
  closeDbForTests();
  mod = await import('../ui/server.mjs');
  srv = mod.server;
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
});

after(async () => {
  for (const [, job] of mod._testing.askJobs) { try { job.turn?.stop?.(); } catch { /* reap */ } }
  if (srv) {
    await Promise.race([
      new Promise((r) => { srv.close(r); srv.closeAllConnections?.(); }),
      new Promise((r) => { const t = setTimeout(r, 500); t.unref?.(); }),
    ]);
  }
  for (const [k, v] of Object.entries(prevEnv)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  closeDbForTests();
  const reap = (dir) => rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }).catch(() => {});
  await reap(homeDir);
  await reap(worcaHomeDir);
});

const post = (p, body) => fetch(`${base}${p}`, { method: 'POST', headers: JSONH, body: JSON.stringify(body) });
const newThread = async () => (await (await post('/api/ask/threads', {})).json()).thread;
const snapshot = async (id) => (await fetch(`${base}/api/ask/threads/${id}`)).json();
const blocksOf = async (id) => (await snapshot(id)).messages.flatMap((m) => m.blocks || []);
const WAIT_FOR_MS = process.platform === 'win32' ? 60000 : 10000;
function waitFor(pred, timeoutMs = WAIT_FOR_MS) {
  return new Promise((res, rej) => {
    const t0 = Date.now();
    (async function tick() {
      const v = await pred();
      if (v) return res(v);
      if (Date.now() - t0 > timeoutMs) return rej(new Error('waitFor timed out'));
      setTimeout(tick, 20);
    })();
  });
}
async function turn(threadId, text) {
  const before = (await blocksOf(threadId)).filter((b) => b.kind === 'card').length;
  const r = await post(`/api/ask/threads/${threadId}/messages`, { text, ...MODEL, context: {} });
  assert.equal(r.status, 202, 'turn accepted');
  const { assistantMessageId } = await r.json();
  await waitFor(async () => {
    const snap = await snapshot(threadId);
    const m = snap.messages.find((x) => x.id === assistantMessageId);
    return m && m.status !== 'streaming' && !snap.inFlight;
  });
  return (await blocksOf(threadId)).filter((b) => b.kind === 'card').slice(before);
}
async function actOnCard(threadId, cardId, state) {
  const r = await post(`/api/ask/threads/${threadId}/cards/${cardId}`, { state });
  const body = await r.json();
  await waitFor(() => !mod._testing.askJobs.get(threadId)?.turn || ['done', 'stopped', 'error'].includes(mod._testing.askJobs.get(threadId)?.turn?.status));
  await waitFor(async () => !(await snapshot(threadId)).inFlight);
  return { status: r.status, body };
}
const settingsModels = () => {
  const f = join(homeDir, '.worca-cc', 'settings.json');
  return existsSync(f) ? (JSON.parse(readFileSync(f, 'utf8')).models || []) : [];
};

test('model card: propose → decline changes nothing; propose → apply adds the model; remove takes it out', async () => {
  const t = await newThread();
  let cards = await turn(t.id, 'add a local llama model for my llama.cpp server');
  assert.equal(cards.length, 1);
  let c = cards[0];
  assert.equal(c.state, 'proposed');
  assert.equal(c.card.type, 'model');
  assert.equal(c.card.kind, 'add_model');
  assert.equal(c.card.summary, 'Add model Local llama');
  assert.deepEqual(c.card.warnings, [], 'keyless, with a 64k window: nothing will stop it');
  assert.ok(c.card.rows.some((r) => r.field === 'Base URL' && r.after === 'http://127.0.0.1:8080/v1'));

  let res = await actOnCard(t.id, c.id, 'declined');
  assert.equal(res.status, 200);
  assert.equal(res.body.block.state, 'declined');
  assert.deepEqual(settingsModels(), [], 'decline wrote nothing');
  let snap = await snapshot(t.id);
  assert.ok(snap.messages.some((m) => (m.blocks || []).some((b) => b.kind === 'notice' && b.text === 'Declined — Add model Local llama')));

  cards = await turn(t.id, 'add a local llama model for my llama.cpp server');
  c = cards[0];
  res = await actOnCard(t.id, c.id, 'applied');
  assert.equal(res.status, 200);
  assert.equal(res.body.block.state, 'applied');
  assert.equal(res.body.block.card.result.detail, 'local-llama is in the catalog');
  const stored = settingsModels().find((m) => m.id === 'local-llama');
  assert.equal(stored.upstream.baseUrl, 'http://127.0.0.1:8080/v1');
  assert.deepEqual(stored.upstream.capabilities, { maxPromptTokens: 65536, maxOutputTokens: 8192 });
  assert.equal((await post(`/api/ask/threads/${t.id}/cards/${c.id}`, { state: 'applied' })).status, 409, 'applying twice is refused');
  snap = await snapshot(t.id);
  assert.ok(snap.messages.some((m) => m.role === 'assistant' && /Applied\./.test(m.text || '')), 'the event turn confirmed');
  // The catalog serves it as a ready bridged model (a local OpenAI-compatible endpoint needs no key).
  const cat = await (await fetch(`${base}/api/models`)).json();
  const row = cat.models.find((m) => m.id === 'local-llama');
  assert.equal(row.bridged, 'openai');
  assert.equal(row.needsSignIn, false);

  // Proposing the same id again is refused by the parent's re-validation: no card, a notice.
  cards = await turn(t.id, 'add a local llama model for my llama.cpp server');
  assert.equal(cards.length, 0);
  snap = await snapshot(t.id);
  assert.ok(snap.messages.some((m) => (m.blocks || []).some((b) => b.kind === 'notice' && /^Model change rejected: a model with id "local-llama" already exists/.test(b.text))));

  cards = await turn(t.id, 'please remove model local-llama');
  c = cards[0];
  assert.equal(c.card.kind, 'remove_model');
  res = await actOnCard(t.id, c.id, 'applied');
  assert.equal(res.body.block.state, 'applied');
  assert.equal(res.body.block.card.result.detail, 'local-llama removed');
  assert.deepEqual(settingsModels(), []);
});

test('model card: a bad verb is a 400, and an unknown card a 404', async () => {
  const t = await newThread();
  const [c] = await turn(t.id, 'add a local llama model');
  assert.equal((await post(`/api/ask/threads/${t.id}/cards/${c.id}`, { state: 'saved' })).status, 400);
  assert.equal((await post(`/api/ask/threads/${t.id}/cards/card_00000000`, { state: 'applied' })).status, 404);
  await actOnCard(t.id, c.id, 'declined');
});
