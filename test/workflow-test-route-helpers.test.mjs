// test/workflow-test-route-helpers.test.mjs — the route helpers Part 2 (routes.mjs) and Part 4 (criteria-routes.mjs) share
// (fix round 3, item A): one copy, each file keeping its own status codes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STATUS_BASE, statusWith, num, handleWith, routeOn, wid, exampleOf } from '../src/core/workflow-tests/route-helpers.mjs';

const fakeRes = () => {
  const res = { code: 200, body: null };
  res.status = (c) => { res.code = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
};
const thrown = (code, extra = {}) => async () => { throw Object.assign(new Error('bad'), { code, ...extra }); };

test('STATUS_BASE holds the codes both parts answer; each part adds its own and nothing changes meaning', () => {
  assert.deepEqual({ ...STATUS_BASE }, { BAD_REQUEST: 400, NOT_VERSIONABLE: 400, NOT_FOUND: 404, BUSY: 409, NOT_READY: 422 });
  const two = statusWith({ NO_DISK: 422 });
  assert.equal(two.NO_DISK, 422);
  assert.equal(two.FAILED, undefined);
  assert.ok(Object.isFrozen(two));
  assert.ok(Object.isFrozen(STATUS_BASE));
});

test('num: a whole number of 1 or more, else a 400 error naming what', () => {
  assert.equal(num('7', 'example'), 7);
  for (const bad of ['0', '-1', '1.5', 'x', undefined]) {
    assert.throws(() => num(bad, 'example'), (e) => e.code === 'BAD_REQUEST' && /example must be a whole number/.test(e.message));
  }
});

test("handleWith: the error's code picks the status (else 500); `errors` reaches the response", async () => {
  const handle = handleWith(statusWith({ FAILED: 500 }));
  let res = fakeRes();
  await handle(thrown('BAD_REQUEST', { errors: ['a', 'b'] }))({}, res);
  assert.deepEqual([res.code, res.body], [400, { error: 'bad', errors: ['a', 'b'] }]);
  res = fakeRes();
  await handle(thrown('NO_DISK'))({}, res);
  assert.equal(res.code, 500, 'a code this part does not name answers 500');
  res = fakeRes();
  await handle(async () => { throw 'plain'; })({}, res);   // eslint-disable-line no-throw-literal
  assert.deepEqual([res.code, res.body], [500, { error: 'plain' }]);
  res = fakeRes();
  await handle(async (_q, r) => r.json({ ok: true }))({}, res);
  assert.deepEqual([res.code, res.body], [200, { ok: true }]);
});

test('routeOn registers through the gate and the handler; wid and exampleOf read the request', async () => {
  const seen = [];
  const app = { post: (path, gate, fn) => seen.push({ path, gate, fn }) };
  const gate = () => {};
  const route = routeOn(app, gate, handleWith(STATUS_BASE));
  route('POST', '/x', async () => { throw Object.assign(new Error('gone'), { code: 'NOT_FOUND' }); });
  assert.equal(seen.length, 1);
  assert.equal(seen[0].path, '/x');
  assert.equal(seen[0].gate, gate);
  const res = fakeRes();
  await seen[0].fn({}, res);
  assert.equal(res.code, 404);
  assert.equal(wid({ params: { id: 42 } }), '42');
  assert.equal(wid({ params: {} }), '');
  assert.throws(() => exampleOf({ params: { id: 'wf', ex: 'zero' } }), (e) => e.code === 'BAD_REQUEST');
});
