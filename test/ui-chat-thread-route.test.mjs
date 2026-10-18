// test/ui-chat-thread-route.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createThreadRouteAddon } from '../ui/public/chat/thread-route.mjs';

const ctx = (answer, runLinks = [{ runId: 'r1', pipelineId: 'aaaa0001' }], on = true) => {
  const calls = [];
  return { calls, threadId: () => 't1', thread: () => ({ runLinks }), shapeOn: () => on,
    fetch: async (url, o) => { calls.push([url, JSON.parse(o.body)]); return { ok: true, status: 200, json: async () => answer }; } };
};
const mount = (c) => createThreadRouteAddon().mount(null, c);

test('an answered step takes the send and makes no card', async () => {
  const c = ctx({ action: 'answered', stepId: 'plan-1' });
  assert.equal(await mount(c).beforeSend('shorter please'), true);
  assert.deepEqual(c.calls[0], ['/api/ask/threads/t1/reply', { text: 'shorter please' }]);
});
test('route and changes take the send; chat falls through to Ask', async () => {
  assert.equal(await mount(ctx({ action: 'route' })).beforeSend('an idea'), true);
  assert.equal(await mount(ctx({ action: 'changes' })).beforeSend('one more'), true);
  assert.equal(await mount(ctx({ action: 'chat' })).beforeSend('hi'), false);
});
test('a thread that follows no run, or the gate off, never calls the server', async () => {
  const c = ctx({ action: 'route' }, []);
  assert.equal(await mount(c).beforeSend('hi'), false);
  const off = ctx({ action: 'route' }, undefined, false);
  assert.equal(await mount(off).beforeSend('hi'), false);
  assert.equal(c.calls.length + off.calls.length, 0);
});
test('a failed call falls through to Ask (the message is never lost)', async () => {
  const c = ctx(null); c.fetch = async () => ({ ok: false, status: 500, json: async () => ({ error: 'x' }) });
  assert.equal(await mount(c).beforeSend('hi'), false);
});
