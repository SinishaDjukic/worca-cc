// test/ask-design-mode.test.mjs
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { useTempHome } from './helpers/temp-home.mjs';

useTempHome(after);
const store = await import('../src/core/ask/store.mjs');
const { isSurfaceMode, turnHelperFlags } = await import('../src/core/ask/thread-modes.mjs');

test('a design thread keeps its mode and title; an unknown mode is a plain chat', () => {
  const t = store.createThread({ mode: 'design', title: 'ShipRadar' });
  assert.deepEqual([t.mode, t.title], ['design', 'ShipRadar']);
  assert.equal('mode' in store.createThread({ mode: 'bogus' }), false);
});

test('listWhere is "not in": design and composer threads are in no Chat list, page, count or search', () => {
  const plain = store.createThread({ title: 'needle plain' });
  const comp = store.createThread({ mode: 'composer', title: 'needle comp' });
  const des = store.createThread({ mode: 'design', title: 'needle design' });
  const ids = (rows) => rows.map((t) => t.id);
  assert.ok(ids(store.listThreads({})).includes(plain.id));
  for (const other of [comp.id, des.id]) {
    assert.equal(ids(store.listThreads({})).includes(other), false);
    assert.equal(ids(store.listThreads({ query: 'needle' })).includes(other), false);
    assert.equal(ids(store.listThreadsPage({ show: 'all', limit: 50 }).threads).includes(other), false);
  }
  assert.ok(ids(store.listThreads({ mode: 'design' })).includes(des.id));
  assert.equal(ids(store.listThreads({ mode: 'design' })).includes(comp.id), false);
  assert.ok(ids(store.listThreads({ mode: 'composer' })).includes(comp.id));
  assert.equal(store.countThreads({}), store.listThreads({ limit: 200 }).length);
  assert.ok(store.listThreadIds().includes(des.id), 'Delete all still reaches it');
});

test('turnHelperFlags: a design turn never titles and never suggests; others unchanged', () => {
  const on = { synthetic: false, userSeq: 1, titleWasAuto: true };
  assert.deepEqual(turnHelperFlags({ ...on, mode: 'design' }), { firstTurn: false, suggest: false });
  assert.deepEqual(turnHelperFlags({ ...on, mode: null }), { firstTurn: true, suggest: true });
  assert.deepEqual(turnHelperFlags({ ...on, mode: 'composer' }), { firstTurn: true, suggest: true });
  assert.deepEqual(turnHelperFlags({ ...on, mode: null, synthetic: true }), { firstTurn: false, suggest: false });
  assert.deepEqual(turnHelperFlags({ ...on, mode: null, userSeq: 2 }), { firstTurn: false, suggest: true }, 'only the first message titles');
  assert.deepEqual(turnHelperFlags({ ...on, mode: null, titleWasAuto: false }), { firstTurn: false, suggest: true }, 'a title the person set stays');
  assert.equal(isSurfaceMode('design') && isSurfaceMode('composer') && !isSurfaceMode(null), true);
});

test('the boot sweep of empty threads keeps a design thread (its design points at it)', () => {   // last: it sweeps the file's threads
  const des = store.createThread({ mode: 'design', title: 'idle' });
  const plain = store.createThread({ title: 'idle plain' });
  store.sweepEmptyThreads({ olderThanMs: 0, now: Date.now() + 1000 });
  assert.ok(store.getThread(des.id));
  assert.equal(store.getThread(plain.id), null);
});
