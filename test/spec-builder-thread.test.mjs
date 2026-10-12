import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSpecThreadClient } from '../ui/public/spec-builder-thread.mjs';

const res = (status, json) => ({ ok: status >= 200 && status < 300, status, json: async () => json });

function stub(routes) {
  const calls = [];
  const fetch = async (url, init = {}) => {
    calls.push({ url, init, body: init.body ? JSON.parse(init.body) : undefined });
    const h = routes[`${init.method || 'GET'} ${url}`];
    if (!h) throw new Error(`unexpected ${init.method || 'GET'} ${url}`);
    return typeof h === 'function' ? h() : h;
  };
  return { fetch, calls };
}

const MODELS = res(200, { default: { model: 'm1', effort: 'high' } });

test('create posts the title capped at 120 and returns the thread id', async () => {
  const { fetch, calls } = stub({ 'POST /api/ask/threads': res(201, { thread: { id: 't1' } }) });
  const c = createSpecThreadClient({ fetch, sendWs: () => {} });
  assert.equal(await c.create('x'.repeat(300)), 't1');
  assert.equal(calls[0].body.title.length, 120);
});

test('send pins the thread to the project, fetches models once, resolves to { userMessageId }', async () => {
  const { fetch, calls } = stub({
    'GET /api/ask/models': MODELS,
    'POST /api/ask/threads/t1/messages': res(202, { userMessageId: 'u1' }),
  });
  const c = createSpecThreadClient({ fetch, sendWs: () => {} });
  assert.deepEqual(await c.send('t1', 'hello', 'proj'), { userMessageId: 'u1' });
  await c.send('t1', 'again', 'proj');
  const posts = calls.filter((x) => x.init.method === 'POST');
  assert.equal(posts[0].body.context.pinned, true);
  assert.equal(posts[0].body.context.projectKey, 'proj');
  assert.equal(posts[0].body.model, 'm1');
  assert.equal(posts[0].body.effort, 'high');
  assert.equal(calls.filter((x) => x.url === '/api/ask/models').length, 1);
});

test('send resolves userMessageId null when the 202 carries none', async () => {
  const { fetch } = stub({ 'GET /api/ask/models': MODELS, 'POST /api/ask/threads/t1/messages': res(202, {}) });
  const c = createSpecThreadClient({ fetch, sendWs: () => {} });
  assert.deepEqual(await c.send('t1', 'hi', 'p'), { userMessageId: null });
});

test('send rejects readably when /api/ask/models has no default', async () => {
  const { fetch } = stub({ 'GET /api/ask/models': res(200, { default: null }) });
  const c = createSpecThreadClient({ fetch, sendWs: () => {} });
  await assert.rejects(c.send('t1', 'hi', 'p'), /Ask Worca has no model to draft with/);
});

test('send 409 rejects with the server message and status', async () => {
  const { fetch } = stub({ 'GET /api/ask/models': MODELS, 'POST /api/ask/threads/t1/messages': res(409, { error: 'turn in flight' }) });
  const c = createSpecThreadClient({ fetch, sendWs: () => {} });
  await assert.rejects(c.send('t1', 'hi', 'p'), (e) => e.message === 'turn in flight' && e.status === 409);
});

test('send 404 rejects with status 404', async () => {
  const { fetch } = stub({ 'GET /api/ask/models': MODELS, 'POST /api/ask/threads/t1/messages': res(404, { error: 'thread not found' }) });
  const c = createSpecThreadClient({ fetch, sendWs: () => {} });
  await assert.rejects(c.send('t1', 'hi', 'p'), (e) => e.status === 404);
});

test('load returns null on 404, the snapshot otherwise', async () => {
  const { fetch } = stub({ 'GET /api/ask/threads/gone': res(404, {}), 'GET /api/ask/threads/t1': res(200, { thread: { id: 't1' } }) });
  const c = createSpecThreadClient({ fetch, sendWs: () => {} });
  assert.equal(await c.load('gone'), null);
  assert.deepEqual(await c.load('t1'), { thread: { id: 't1' } });
});

test('subscribe sends the subscribe frame through sendWs', () => {
  const sent = [];
  const c = createSpecThreadClient({ fetch: async () => res(200, {}), sendWs: (m) => sent.push(m) });
  c.subscribe('t1');
  assert.deepEqual(sent, [{ type: 'subscribe', threadId: 't1' }]);
});
