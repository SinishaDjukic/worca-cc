// test/ask-design-mode.test.mjs — a chat with a design is a plain chat (docs/design.md "In the chat"): its design points
// at it (designs.thread_id), and no thread carries a 'design' mode any more.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { useTempHome } from './helpers/temp-home.mjs';

useTempHome(after);
const store = await import('../src/core/ask/store.mjs');
const { getDb } = await import('../src/core/db.mjs');
const { createDesign, updateDesign } = await import('../src/core/design/store.mjs');
const { isSurfaceMode, turnHelperFlags } = await import('../src/core/ask/thread-modes.mjs');

const withDesign = (title) => {
  const t = store.createThread({ title });
  const d = createDesign({ kind: 'web', title }, { by: null });
  updateDesign(d.id, { threadId: t.id });
  return { thread: t, design: d };
};

test('a thread made with the old design mode is a plain chat; an unknown mode is a plain chat', () => {
  assert.equal('mode' in store.createThread({ mode: 'design', title: 'ShipRadar' }), false);
  assert.equal('mode' in store.createThread({ mode: 'bogus' }), false);
  assert.equal(isSurfaceMode('design'), false);
  assert.equal(isSurfaceMode('composer') && !isSurfaceMode(null), true);
});

test('the Chat lists: a chat with a design is a plain chat everywhere (the extension too) and names its design; a composer chat is in none', () => {
  const plain = store.createThread({ title: 'needle plain' });
  const comp = store.createThread({ mode: 'composer', title: 'needle comp' });
  const { thread: des, design } = withDesign('needle design');
  const ids = (rows) => rows.map((t) => t.id);
  for (const listed of [plain.id, des.id]) {
    assert.ok(ids(store.listThreads({})).includes(listed));
    assert.ok(ids(store.listThreads({ mode: 'plain' })).includes(listed), 'the browser extension');
    assert.ok(ids(store.listThreads({ query: 'needle' })).includes(listed));
    assert.ok(ids(store.listThreadsPage({ show: 'all', limit: 50 }).threads).includes(listed));
  }
  for (const list of [store.listThreads({}), store.listThreads({ mode: 'plain' }), store.listThreadsPage({ show: 'all', limit: 50 }).threads]) {
    assert.equal(ids(list).includes(comp.id), false);
  }
  assert.equal(store.listThreads({}).find((t) => t.id === des.id).designId, design.id, 'the row names its design (the Design mark)');
  assert.equal('designId' in store.listThreads({}).find((t) => t.id === plain.id), false);
  assert.ok(ids(store.listThreads({ mode: 'composer' })).includes(comp.id));
  assert.equal(store.countThreads({}), store.listThreads({ limit: 200 }).length);
});

test('turnHelperFlags: only an event turn or a later message skips the title; only an event turn skips the suggestion', () => {
  const on = { synthetic: false, userSeq: 1, titleWasAuto: true };
  assert.deepEqual(turnHelperFlags(on), { firstTurn: true, suggest: true });
  assert.deepEqual(turnHelperFlags({ ...on, synthetic: true }), { firstTurn: false, suggest: false });
  assert.deepEqual(turnHelperFlags({ ...on, userSeq: 2 }), { firstTurn: false, suggest: true }, 'only the first message titles');
  assert.deepEqual(turnHelperFlags({ ...on, titleWasAuto: false }), { firstTurn: false, suggest: true }, 'a title the person or the design gave stays');
});

test('the boot sweep of empty threads keeps a chat with a design (its design points at it)', () => {   // last: it sweeps the file's threads
  const { thread: des } = withDesign('idle');
  const plain = store.createThread({ title: 'idle plain' });
  store.sweepEmptyThreads({ olderThanMs: 0, now: Date.now() + 1000 });
  assert.ok(store.getThread(des.id));
  assert.equal(store.getThread(plain.id), null);
});
