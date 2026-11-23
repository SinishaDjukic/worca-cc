// test/ask-feature-run-card.test.mjs — POST /api/ask/threads/:threadId/feature-runs: a tracked run card titled with its
// feature lands in a chat thread, once, and only for a run that started from that feature.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let home; let srv; let base; let prev; let mod;
before(async () => {
  home = await mkdtemp(join(tmpdir(), 'worca-feat-run-card-'));
  prev = {};
  for (const k of ['HOME', 'USERPROFILE', 'WORCA_HOME', 'WORCA_FLAGS', 'WORCA_MOCK', 'WORCA_TEST_ALLOW_HOME_FALLBACK']) prev[k] = process.env[k];
  process.env.HOME = home; process.env.USERPROFILE = home; process.env.WORCA_HOME = join(home, 'worca-home');
  process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = '1';
  process.env.WORCA_MOCK = '1';
  process.env.WORCA_FLAGS = 'requirements';
  (await import('../src/core/db.mjs'))._resetForTests();
  mod = await import('../ui/server.mjs');
  srv = mod.server;
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
});
after(async () => {
  mod.runs.clear();
  srv?.closeAllConnections?.();
  if (srv) await Promise.race([new Promise((r) => srv.close(r)), new Promise((r) => setTimeout(r, 500))]);
  for (const k of Object.keys(prev)) { if (prev[k] === undefined) delete process.env[k]; else process.env[k] = prev[k]; }
  (await import('../src/core/db.mjs'))._resetForTests();
  await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

const post = async (threadId, body, headers = {}) => {
  const r = await fetch(`${base}/api/ask/threads/${threadId}/feature-runs`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  return { status: r.status, json: await r.json().catch(() => null) };
};
let n = 0;
/** A feature with one start row (the run), plus an empty chat thread. */
async function seed() {
  const req = await import('../src/core/requirements/store.mjs');
  const ask = await import('../src/core/ask/store.mjs');
  n += 1;
  const feature = req.createFeature({ scopeType: 'project', scopeKey: `shop-${String(n).padStart(8, '0')}`, title: `Cancel order ${n}`, description: 'Before it ships' });
  const runId = `run-${n}-aaaa`;
  const start = req.createStart({ featureSeq: feature.seq, version: 1, runId, spec: feature.spec, title: feature.title, ready: true });
  const thread = ask.createThread({ title: 't' });
  return { ask, feature, runId, start, thread };
}

test('a valid (thread, seq, run) mints one tracked card and one link, with the feature in the card', async () => {
  const { ask, feature, runId, thread } = await seed();
  const r = await post(thread.id, { seq: feature.seq, runId });
  assert.equal(r.status, 201);
  assert.match(r.json.cardId, /^card_[0-9a-f]{8}$/);
  const links = ask.listRunLinks(thread.id);
  assert.equal(links.length, 1);
  assert.equal(links[0].runId, runId);
  assert.equal(links[0].cardId, r.json.cardId);
  const msgs = ask.listMessages(thread.id);
  assert.equal(msgs.length, 1);
  const block = msgs[0].blocks[0];
  assert.equal(block.id, r.json.cardId);
  assert.equal(block.state, 'tracked');
  assert.equal(block.card.type, 'progress');
  assert.equal(block.card.runId, runId);
  assert.equal(block.card.projectKey, feature.scopeKey);
  assert.deepEqual(block.card.feature, { seq: feature.seq, id: feature.id, title: feature.title });
  assert.equal(block.card.title, feature.title);
});

test('a second call answers 200 with the same card id and writes nothing new', async () => {
  const { ask, feature, runId, thread } = await seed();
  const first = await post(thread.id, { seq: feature.seq, runId });
  const again = await post(thread.id, { seq: feature.seq, runId });
  assert.equal(again.status, 200);
  assert.equal(again.json.cardId, first.json.cardId);
  assert.equal(ask.listRunLinks(thread.id).length, 1);
  assert.equal(ask.listMessages(thread.id).length, 1);
});

test('a live run gets a follower attached to the new card', async () => {
  const { feature, runId, thread } = await seed();
  mod.runs.set(runId, { id: runId, kind: 'run', orch: new EventEmitter(), projectDir: '/tmp/x', title: 't', status: 'running', startedAt: new Date().toISOString(), events: [], pendingQuestion: null });
  const r = await post(thread.id, { seq: feature.seq, runId });
  assert.equal(r.status, 201);
  const link = (await import('../src/core/ask/store.mjs')).listRunLinks(thread.id)[0];
  assert.equal(link.status, 'running');
  assert.ok(mod.askFollowers.size > 0, 'a follower is registered for the live run');
});

test('404: an unknown thread, a run of another feature, an unknown run, an unknown seq', async () => {
  const a = await seed();
  const b = await seed();
  assert.equal((await post('ask_00000000', { seq: a.feature.seq, runId: a.runId })).status, 404);
  assert.equal((await post(a.thread.id, { seq: a.feature.seq, runId: b.runId })).status, 404, 'b\'s run is not a run of a');
  assert.equal((await post(a.thread.id, { seq: a.feature.seq, runId: 'no-such-run' })).status, 404);
  assert.equal((await post(a.thread.id, { seq: 99999, runId: a.runId })).status, 404);
  assert.equal(a.ask.listRunLinks(a.thread.id).length, 0, 'nothing was minted');
  assert.equal(a.ask.listMessages(a.thread.id).length, 0);
});

test('404: a thread that belongs to another signed-in person; nothing is linked or written, and the owner is served', async () => {
  const { ask, feature, runId } = await seed();
  const mine = ask.createThread({ title: 'bobs', createdBy: 'bob@example.com' });
  const prevHeader = process.env.WORCA_IDENTITY_HEADER; const prevProxies = process.env.WORCA_IDENTITY_TRUSTED_PROXIES;
  process.env.WORCA_IDENTITY_HEADER = 'x-test-user';
  process.env.WORCA_IDENTITY_TRUSTED_PROXIES = '127.0.0.1,::1';
  try {
    const foreign = await post(mine.id, { seq: feature.seq, runId }, { 'x-test-user': 'ada@example.com' });
    assert.equal(foreign.status, 404);
    assert.deepEqual(foreign.json, { error: 'thread not found' });
    assert.equal(ask.listRunLinks(mine.id).length, 0, 'no link');
    assert.equal(ask.listMessages(mine.id).length, 0, 'no message');
    assert.equal((await post(mine.id, { seq: feature.seq, runId }, { 'x-test-user': 'bob@example.com' })).status, 201);
  } finally {
    if (prevHeader === undefined) delete process.env.WORCA_IDENTITY_HEADER; else process.env.WORCA_IDENTITY_HEADER = prevHeader;
    if (prevProxies === undefined) delete process.env.WORCA_IDENTITY_TRUSTED_PROXIES; else process.env.WORCA_IDENTITY_TRUSTED_PROXIES = prevProxies;
  }
});

test('400: a bad seq or runId, and a malformed thread id', async () => {
  const { feature, runId, thread } = await seed();
  for (const body of [{ runId }, { seq: 0, runId }, { seq: -1, runId }, { seq: 1.5, runId }, { seq: String(feature.seq), runId }, { seq: feature.seq }, { seq: feature.seq, runId: '' }, { seq: feature.seq, runId: 7 }]) {
    assert.equal((await post(thread.id, body)).status, 400, JSON.stringify(body));
  }
  assert.equal((await post('not-a-thread', { seq: feature.seq, runId })).status, 400);
});

test('the requirements flag off answers 404 before anything else', async () => {
  const { ask, feature, runId, thread } = await seed();
  delete process.env.WORCA_FLAGS;
  try {
    const r = await post(thread.id, { seq: feature.seq, runId });
    assert.equal(r.status, 404);
    assert.deepEqual(r.json, { error: 'not found' });
  } finally { process.env.WORCA_FLAGS = 'requirements'; }
  assert.equal(ask.listRunLinks(thread.id).length, 0);
});
