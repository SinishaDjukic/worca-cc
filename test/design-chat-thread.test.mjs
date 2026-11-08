// test/design-chat-thread.test.mjs
// Design P5 Task 2: a design owns one titled chat thread (mode 'design'). POST /api/design makes it with no title
// call, POST /api/ask/threads {mode:'design', designId} recreates it once Settings › Delete all chat history removed
// it, DELETE /api/design/:id removes it, and a design's total is its builds plus its chat. One in-process server on
// the mock engine (test/helpers/design-chat-boot.mjs).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { bootDesignChat } from './helpers/design-chat-boot.mjs';

const { call, mod } = await bootDesignChat(after);
// After the boot, so these open the boot's WORCA_HOME.
const { designIdForThread } = await import('../src/core/design/chat-thread.mjs');
const { getDesign } = await import('../src/core/design/store.mjs');
const { getDb } = await import('../src/core/db.mjs');
test('POST /api/design makes a titled design thread', async () => {
  const r = await call('POST', '/api/design', { kind: 'web', title: 'ShipRadar' });
  assert.equal(r.status, 201);
  const t = (await call('GET', `/api/ask/threads/${r.body.threadId}`)).body.thread;
  assert.deepEqual([t.mode, t.title, t.context.pinned], ['design', 'ShipRadar', false]);
  assert.equal(designIdForThread(t.id), r.body.design.id);
});
test('a design with no title still gets a titled thread (no title call can fire)', async () => {
  const r = await call('POST', '/api/design', { kind: 'web' });
  const t = (await call('GET', `/api/ask/threads/${r.body.threadId}`)).body.thread;
  assert.equal(typeof t.title, 'string'); assert.ok(t.title.length > 0);
});
test('POST /api/ask/threads mode design: only for a design whose chat is gone', async () => {
  assert.equal((await call('POST', '/api/ask/threads', { mode: 'design' })).status, 404);
  const d = (await call('POST', '/api/design', { kind: 'web', title: 'A' })).body;
  const again = await call('POST', '/api/ask/threads', { mode: 'design', designId: d.design.id });
  assert.deepEqual([again.status, again.body.threadId], [409, d.threadId]);
  await call('DELETE', '/api/ask/threads');                         // Settings › Delete all chat history
  assert.equal((await call('GET', `/api/design/${d.design.id}`)).status, 200, 'the design survives');
  const made = await call('POST', '/api/ask/threads', { mode: 'design', designId: d.design.id });
  assert.equal(made.status, 201);
  assert.deepEqual([made.body.thread.mode, made.body.thread.title], ['design', 'A']);
  assert.equal(getDesign(d.design.id).threadId, made.body.thread.id);
});
test('DELETE /api/design/:id removes its thread', async () => {
  const d = (await call('POST', '/api/design', { kind: 'web', title: 'B' })).body;
  await call('DELETE', `/api/design/${d.design.id}`);
  assert.equal((await call('GET', `/api/ask/threads/${d.threadId}`)).status, 404);
});
test('a design total is builds plus chat', async () => {
  const d = (await call('POST', '/api/design', { kind: 'web', title: 'C' })).body;
  getDb().prepare('INSERT INTO design_cost_ledger (design_id, amount_usd, ts) VALUES (?, 4.2, ?)').run(d.design.id, Date.now());
  getDb().prepare('UPDATE ask_threads SET totals = ? WHERE id = ?').run(JSON.stringify({ costUsd: 0.5 }), d.threadId);
  const row = (await call('GET', '/api/design')).body.find((x) => x.id === d.design.id);
  assert.equal(row.costUsd, 4.7);
  assert.equal((await call('GET', `/api/design/${d.design.id}`)).body.design.costUsd, 4.7);
});

// Guards the rows above leave open (mutation check).
const { createDesignThread } = await import('../src/core/design/chat-thread.mjs');
const deleteChat = async (threadId) => assert.equal((await call('DELETE', `/api/ask/threads/${threadId}`)).status, 200);

test('a design in a project gets its thread scoped to that project', () => {
  const t = createDesignThread({ design: { title: 'P', projectKey: 'shop-00000001' }, by: 'local' });
  assert.deepEqual([t.mode, t.title, t.context], ['design', 'P', { pinned: true, projectKey: 'shop-00000001' }]);
});
test('a design whose chat is gone counts no chat spend', async () => {
  const d = (await call('POST', '/api/design', { kind: 'web', title: 'E' })).body;
  getDb().prepare('INSERT INTO design_cost_ledger (design_id, amount_usd, ts) VALUES (?, 1.25, ?)').run(d.design.id, Date.now());
  await deleteChat(d.threadId);
  assert.equal((await call('GET', '/api/design')).body.find((x) => x.id === d.design.id).costUsd, 1.25);
  assert.equal((await call('GET', `/api/design/${d.design.id}`)).body.design.costUsd, 1.25);
});
test('POST /api/ask/threads mode design: 404 while the design flag is off', async () => {
  const d = (await call('POST', '/api/design', { kind: 'web', title: 'F' })).body;
  await deleteChat(d.threadId);
  const prev = process.env.WORCA_FLAGS;
  delete process.env.WORCA_FLAGS;
  try {
    const off = await call('POST', '/api/ask/threads', { mode: 'design', designId: d.design.id });
    assert.deepEqual([off.status, off.body], [404, { error: 'not found' }]);
  } finally { process.env.WORCA_FLAGS = prev; }
  assert.equal((await call('POST', '/api/ask/threads', { mode: 'design', designId: d.design.id })).status, 201);
});
test('POST /api/ask/threads mode design: another person\'s design reads 404', async () => {
  const prev = { header: process.env.WORCA_IDENTITY_HEADER, proxies: process.env.WORCA_IDENTITY_TRUSTED_PROXIES };
  process.env.WORCA_IDENTITY_HEADER = 'x-test-user';
  process.env.WORCA_IDENTITY_TRUSTED_PROXIES = '127.0.0.1,::1';
  try {
    const alice = { 'x-test-user': 'alice@example.com' };
    const bob = { 'x-test-user': 'bob@example.com' };
    const c = await call('POST', '/api/design', { kind: 'web', title: 'G' }, alice);
    assert.equal(c.status, 201);
    assert.equal(c.body.design.createdBy, 'alice@example.com');
    assert.equal((await call('DELETE', `/api/ask/threads/${c.body.threadId}`, undefined, alice)).status, 200);
    const asBob = await call('POST', '/api/ask/threads', { mode: 'design', designId: c.body.design.id }, bob);
    assert.deepEqual([asBob.status, asBob.body], [404, { error: 'design not found' }]);
    assert.equal((await call('POST', '/api/ask/threads', { mode: 'design', designId: c.body.design.id }, alice)).status, 201);
  } finally {
    for (const [k, v] of [['WORCA_IDENTITY_HEADER', prev.header], ['WORCA_IDENTITY_TRUSTED_PROXIES', prev.proxies]]) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  }
});
