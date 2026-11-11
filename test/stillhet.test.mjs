import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stillhetAskOpen, railAnswerHook } from '../src/core/stillhet.mjs';
import { createFlags } from '../src/core/flags.mjs';
import { FLAGS } from '../src/shared/flags/registry.mjs';

test('stillhetAskOpen: only WORCA_STILLHET_ASK=1 opens the ask switch', () => {
  assert.equal(stillhetAskOpen({}), false);
  assert.equal(stillhetAskOpen({ WORCA_STILLHET_ASK: '1' }), true);
  assert.equal(stillhetAskOpen({ WORCA_STILLHET_ASK: 'true' }), false);
  assert.equal(stillhetAskOpen({ WORCA_STILLHET_ASK: '0' }), false);
});

test('railAnswerHook: stores the answer only for rail:true', async () => {
  const calls = [];
  const hook = railAnswerHook(async (p) => { calls.push(p); });
  await hook({ rail: false }); await hook({ rail: null }); await hook({ flagsDemo: true });
  assert.equal(calls.length, 0);
  await hook({ rail: true });
  assert.deepEqual(calls, [{ stillhetAsked: true }]);
});

test('railAnswerHook: a throwing setPrefs rejects, a catching caller is unaffected', async () => {
  const hook = railAnswerHook(async () => { throw new Error('disk'); });
  await assert.rejects(() => hook({ rail: true }), /disk/);
});

function svc(afterSet, order) {
  let stored = {};
  return createFlags({
    registry: FLAGS, env: () => '', read: () => stored,
    write: async (m) => { order.push('write'); stored = m; }, afterSet, warn: () => {},
  });
}

test('afterSet runs once after write and before changed; not for {} or refused patches', async () => {
  const order = [];
  const f = svc(async (p) => { order.push('after:' + JSON.stringify(p)); }, order);
  f.events.on('changed', () => order.push('changed'));
  await f.set({});
  assert.deepEqual(order, []);
  await assert.rejects(() => f.set({ nope: true }));
  assert.deepEqual(order, []);
  await f.set({ rail: true });
  assert.deepEqual(order, ['write', 'after:{"rail":true}', 'changed']);
});

test('a throwing afterSet still stores the flag, warns once and resolves', async (t) => {
  const warn = t.mock.method(console, 'warn', () => {});
  const f = svc(async () => { throw new Error('boom'); }, []);
  const out = await f.set({ rail: true });
  assert.equal(out.find((x) => x.key === 'rail').on, true);
  assert.equal(warn.mock.callCount(), 1);
  assert.match(String(warn.mock.calls[0].arguments[0]), /^\[worca\] Stillhet answer not stored: boom/);
});

test('revert safety: a registry without rail tolerates a stored rail', () => {
  const f = createFlags({ registry: FLAGS.filter((x) => x.key !== 'rail'), env: () => '', read: () => ({ rail: true }), warn: () => {} });
  assert.ok(Array.isArray(f.list()));
});
