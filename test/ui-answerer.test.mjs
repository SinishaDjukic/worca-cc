// test/ui-answerer.test.mjs — the client's answerer profile (ui/public/answerer.mjs): one fetch for any number of
// callers, `{ lead: null }` on a failure, and a save the cache follows. No DOM.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { loadAnswerer, saveAnswerer, _resetAnswerer } from '../ui/public/answerer.mjs';

beforeEach(() => _resetAnswerer());
const reply = (status, body) => ({ ok: status < 400, status, json: async () => body });

test('loadAnswerer makes one fetch for two calls', async () => {
  let n = 0;
  const f = async () => { n += 1; return reply(200, { lead: 'qa' }); };
  const [a, b] = await Promise.all([loadAnswerer(f), loadAnswerer(f)]);
  assert.deepEqual([a, b, n], [{ lead: 'qa' }, { lead: 'qa' }, 1]);
});

test('a 500 or a network error resolves { lead: null }', async () => {
  assert.deepEqual(await loadAnswerer(async () => reply(500, { error: 'x' })), { lead: null });
  _resetAnswerer();
  assert.deepEqual(await loadAnswerer(async () => { throw new Error('offline'); }), { lead: null });
});

test('saveAnswerer PUTs the lead and the cache follows; a refusal rejects with the server message', async () => {
  const calls = [];
  const f = async (url, init) => { calls.push([url, init?.method || 'GET', init?.body || null]); return reply(200, { lead: 'ux' }); };
  assert.deepEqual(await saveAnswerer('ux', f), { lead: 'ux' });
  assert.deepEqual(await loadAnswerer(f), { lead: 'ux' });
  assert.deepEqual(calls, [['/api/answerer', 'PUT', '{"lead":"ux"}']], 'no GET after a save');
  await assert.rejects(saveAnswerer('boss', async () => reply(400, { error: { code: 'BAD_LEAD', message: 'Pick one of: product' } })), /Pick one of: product/);
});
