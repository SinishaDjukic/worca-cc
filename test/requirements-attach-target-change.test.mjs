// test/requirements-attach-target-change.test.mjs — New run's project choice as one guarded change: Cancel leaves the target,
// the select and the features untouched; Remove applies the change and drops the features.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createProjectChange } from '../ui/public/requirements-attach/target-change.mjs';
import { createAttachStore } from '../ui/public/requirements-attach/store.mjs';

function rig({ runTarget = 'project', applied = '/p/one', answer = 'cancel', features = true } = {}) {
  const page = { runTarget, select: applied, applied, reapplied: 0, asked: 0, calls: [] };
  const store = createAttachStore({ storage: null, key: 'nr' });
  if (features) store.add([{ seq: 1, id: 'FEAT-1', title: 'One' }]);
  const change = createProjectChange({
    store,
    getRunTarget: () => page.runTarget,
    setRunTarget: (t) => { page.calls.push(`target:${t}`); page.runTarget = t; },
    getApplied: () => page.applied,
    setSelect: (path) => { page.calls.push(`select:${path}`); page.select = path; },
    reapply: () => { page.reapplied += 1; page.applied = page.select; },
    ask: async () => { page.asked += 1; return answer; },
  });
  return { page, store, change };
}

test('Cancel from the Workspace target changes nothing: not the target, not the select, not the features', async () => {
  const { page, store, change } = rig({ runTarget: 'workspace', answer: 'cancel' });
  assert.equal(await change('/p/two'), 'cancelled');
  assert.equal(page.runTarget, 'workspace', 'the target segment is not lifted to Project');
  assert.equal(page.select, '/p/one');
  assert.equal(page.reapplied, 0);
  assert.equal(store.get().items.length, 1);
  assert.deepEqual(page.calls.filter((c) => c.startsWith('target:')), []);
});

test('Cancel restores the last APPLIED project, whatever the select shows', async () => {
  const { page, store, change } = rig({ applied: '/p/one', answer: 'cancel' });
  page.select = '/p/zzz';   // code set the select without applying it
  assert.equal(await change('/p/two'), 'cancelled');
  assert.equal(page.select, '/p/one');
  assert.equal(store.get().items.length, 1);
});

test('Remove lifts the target, sets the project, reapplies and drops the features', async () => {
  const { page, store, change } = rig({ runTarget: 'workspace', answer: 'remove' });
  assert.equal(await change('/p/two'), 'applied');
  assert.deepEqual(page.calls, ['target:project', 'select:/p/two']);
  assert.equal(page.reapplied, 1);
  assert.equal(store.get().items.length, 0);
});

test('no features: applied at once, without a question', async () => {
  const { page, change } = rig({ features: false, runTarget: 'none' });
  assert.equal(await change('/p/two'), 'applied');
  assert.equal(page.asked, 0);
  assert.equal(page.runTarget, 'project');
});

test('the same project on the Project target is no change: no question, the features stay', async () => {
  const { page, store, change } = rig({ applied: '/p/one' });
  assert.equal(await change('/p/one'), 'applied');
  assert.equal(page.asked, 0);
  assert.equal(store.get().items.length, 1);
});
