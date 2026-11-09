// test/ui-design-activity.test.mjs — the Design builds the top bar's Activity lists (ui/public/design/activity.mjs):
// hello's list replaces them, a design-build frame moves one, a terminal status removes it, and a build started
// elsewhere shows "Design" until its title loads.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDesignActivity } from '../ui/public/design/activity.mjs';

test('hello, then frames; only a change reports true; terminal rows leave', () => {
  const a = createDesignActivity({ loadTitle: async () => 'x', onChange() {} });
  a.hello([{ designId: 'd1', buildId: 'b1', title: 'One', status: 'building', waiting: 0 }]);
  assert.deepEqual(a.items(), [{ designId: 'd1', title: 'One', status: 'building', waiting: 0 }]);
  assert.equal(a.frame({ type: 'design-build', designId: 'd1', status: 'building', waiting: 0, stats: {} }), false);
  assert.equal(a.frame({ type: 'design-build', designId: 'd1', status: 'building', waiting: 1, stats: {} }), true);
  assert.equal(a.items()[0].waiting, 1);
  assert.equal(a.frame({ type: 'design-delta', designId: 'd1' }), false);
  for (const status of ['done', 'stopped', 'error', 'interrupted']) {
    a.hello([{ designId: 'd1', title: 'One', status: 'building', waiting: 0 }]);
    assert.equal(a.frame({ type: 'design-build', designId: 'd1', status, waiting: 0, stats: {} }), true, status);
    assert.deepEqual(a.items(), [], status);
  }
  a.hello(undefined); assert.deepEqual(a.items(), [], 'an older server: no list on hello');
});
test('a paused build stays listed (it needs you); a hello replaces the list, so a build that ended offline leaves', () => {
  const a = createDesignActivity({ loadTitle: async () => 'x', onChange() {} });
  a.hello([{ designId: 'd1', title: 'One', status: 'building', waiting: 0 }]);
  assert.equal(a.frame({ type: 'design-build', designId: 'd1', status: 'paused', waiting: 0, stats: {} }), true);
  assert.deepEqual(a.items(), [{ designId: 'd1', title: 'One', status: 'paused', waiting: 0 }]);
  a.hello([{ designId: 'd1', title: 'One', status: 'building', waiting: 0 }, { designId: 'd2', title: 'Two', status: 'planning', waiting: 1 }]);
  a.hello([{ designId: 'd2', title: 'Two', status: 'planning', waiting: 1 }]);
  assert.deepEqual(a.items(), [{ designId: 'd2', title: 'Two', status: 'planning', waiting: 1 }]);
});
test('a build started elsewhere: a plain title first, the real one when it loads', async () => {
  let changed = 0; const a = createDesignActivity({ loadTitle: async () => 'Real', onChange: () => { changed += 1; } });
  a.frame({ type: 'design-build', designId: 'd9', status: 'planning', waiting: 0, stats: {} });
  assert.equal(a.items()[0].title, 'Design');
  await new Promise(setImmediate);
  assert.equal(a.items()[0].title, 'Real'); assert.equal(changed, 1);
});
test('title loads: a failure keeps "Design", a late title never brings a row back, an unknown terminal frame loads nothing', async () => {
  let calls = 0; let changed = 0; let release;
  const a = createDesignActivity({ loadTitle: (id) => { calls += 1; return id === 'dx' ? Promise.reject(new Error('offline')) : new Promise((r) => { release = r; }); }, onChange: () => { changed += 1; } });
  a.frame({ type: 'design-build', designId: 'dx', status: 'building', waiting: 0, stats: {} }); await new Promise(setImmediate);
  assert.equal(a.items()[0].title, 'Design');
  a.frame({ type: 'design-build', designId: 'dy', status: 'building', waiting: 0, stats: {} });
  a.frame({ type: 'design-build', designId: 'dy', status: 'done', waiting: 0, stats: {} });
  release('Late'); await new Promise(setImmediate);
  assert.deepEqual(a.items().map((r) => r.designId), ['dx']); assert.equal(changed, 0);
  a.frame({ type: 'design-build', designId: 'dz', status: 'stopped', waiting: 0, stats: {} });
  assert.equal(calls, 2);
});
test('a load that resolves no title keeps "Design" and reports nothing', async () => {
  let changed = 0; const a = createDesignActivity({ loadTitle: async () => undefined, onChange: () => { changed += 1; } });
  a.frame({ type: 'design-build', designId: 'dq', status: 'building', waiting: 0, stats: {} }); await new Promise(setImmediate);
  assert.deepEqual([a.items()[0].title, changed], ['Design', 0]);
});
test('a title is asked once per design and never for one hello named; a later build keeps it; malformed entries are skipped', async () => {
  const calls = []; const a = createDesignActivity({ loadTitle: async (id) => { calls.push(id); return id === 'dr' ? 'Real' : undefined; }, onChange() {} });
  a.hello([null, { title: 'no id' }, { designId: 'dh', title: 'Named', status: 'building', waiting: 0 }]);
  const build = (designId, status, waiting = 0) => a.frame({ type: 'design-build', designId, status, waiting, stats: {} });
  assert.equal(a.frame({ type: 'design-build', status: 'building', waiting: 0, stats: {} }), false, 'no designId');
  build('dh', 'done'); build('dh', 'planning');
  build('dr', 'planning'); build('dn', 'planning'); await new Promise(setImmediate);
  build('dr', 'done'); build('dn', 'done');
  build('dr', 'building', 1); build('dn', 'building'); await new Promise(setImmediate);
  assert.deepEqual(calls, ['dr', 'dn']);
  assert.deepEqual(a.items().map((r) => [r.designId, r.title, r.waiting]), [['dh', 'Named', 0], ['dr', 'Real', 1], ['dn', 'Design', 0]]);
});
