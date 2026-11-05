// test/ui-answerer.test.mjs — the client's answerer profile (ui/public/answerer.mjs): one fetch for any number of
// callers, `{ lead: null }` on a failure, and a save the cache follows. No DOM.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { loadAnswerer, saveAnswerer, _resetAnswerer, LEAD_LABELS, leadLabel } from '../ui/public/answerer.mjs';
import { ANSWERER_LEAD_KEYS } from '../src/shared/answerer.mjs';

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

test('leadLabel: one word per lead key; an unknown key falls back to the perspective label, then the key', () => {
  assert.deepEqual(ANSWERER_LEAD_KEYS.map(leadLabel), ['Product', 'Engineering', 'Design', 'QA', 'Security', 'DevOps']);
  assert.deepEqual(Object.keys(LEAD_LABELS), [...ANSWERER_LEAD_KEYS]);
  assert.equal(leadLabel('release'), 'Release');
  assert.equal(leadLabel('nobody'), 'nobody');
});

test('loadAnswerer times out to { lead: null } and the next call fetches again', async () => {
  _resetAnswerer({ timeoutMs: 20 });
  let n = 0;
  const f = () => { n += 1; return new Promise(() => {}); };
  assert.deepEqual(await loadAnswerer(f), { lead: null });
  assert.deepEqual(await loadAnswerer(f), { lead: null });
  assert.equal(n, 2);
});

test('a failed profile is not cached; a late answer after the timeout is ignored', async () => {
  let n = 0;
  const f = async () => { n += 1; return n === 1 ? reply(500, {}) : reply(200, { lead: 'qa' }); };
  assert.deepEqual(await loadAnswerer(f), { lead: null });
  assert.deepEqual(await loadAnswerer(f), { lead: 'qa' });
  _resetAnswerer({ timeoutMs: 20 });
  let answer;
  const late = new Promise((r) => { answer = r; });
  const p = loadAnswerer(() => late);
  assert.deepEqual(await p, { lead: null });
  answer(reply(200, { lead: 'ux' }));
  await new Promise((r) => setTimeout(r, 10));
  assert.deepEqual(await p, { lead: null });
});
