// test/requirements-attach-scope-guard.test.mjs — guard person-initiated scope changes while features are attached.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { guardScopeChange } from '../ui/public/requirements-attach/scope-guard.mjs';

function harness(items, answer) {
  const calls = [];
  const store = {
    get: () => {
      calls.push('get');
      return { items };
    },
    clear: () => {
      calls.push('clear');
      items = [];
    },
  };
  return {
    calls,
    args: {
      store,
      apply: () => calls.push('apply'),
      revert: () => calls.push('revert'),
      ask: async () => {
        calls.push('ask');
        return answer;
      },
    },
  };
}

test('empty store: applies once without asking', async () => {
  const h = harness([], 'cancel');
  assert.equal(await guardScopeChange(h.args), 'applied');
  assert.deepEqual(h.calls.filter((c) => c !== 'get'), ['apply']);
});

test('cancel: reverts, never applies, store unchanged', async () => {
  const h = harness([{ seq: 1 }], 'cancel');
  assert.equal(await guardScopeChange(h.args), 'cancelled');
  assert.deepEqual(h.calls.filter((c) => c !== 'get'), ['ask', 'revert']);
  assert.deepEqual(h.args.store.get().items, [{ seq: 1 }]);
});

test('remove: clears the store before apply runs', async () => {
  const h = harness([{ seq: 1 }], 'remove');
  assert.equal(await guardScopeChange(h.args), 'applied');
  assert.deepEqual(h.calls.filter((c) => c !== 'get'), ['ask', 'clear', 'apply']);
});

test('store is never mutated before ask resolves', async () => {
  let release;
  const h = harness([{ seq: 1 }], 'remove');
  h.args.ask = () =>
    new Promise((resolve) => {
      h.calls.push('ask');
      release = resolve;
    });
  const pending = guardScopeChange(h.args);
  await Promise.resolve();
  assert.ok(!h.calls.includes('clear'));
  assert.ok(!h.calls.includes('apply'));
  release('remove');
  assert.equal(await pending, 'applied');
});

test('any answer other than remove is treated as cancel', async () => {
  const h = harness([{ seq: 1 }], undefined);
  assert.equal(await guardScopeChange(h.args), 'cancelled');
  assert.ok(h.calls.includes('revert'));
  assert.ok(!h.calls.includes('clear'));
});

test('skip: a change that cannot move the features applies without asking and keeps them', async () => {
  const h = harness([{ seq: 1 }], 'remove');
  assert.equal(await guardScopeChange({ ...h.args, skip: () => true }), 'applied');
  assert.ok(!h.calls.includes('ask'));
  assert.ok(!h.calls.includes('clear'));
  assert.ok(h.calls.includes('apply'));
});
