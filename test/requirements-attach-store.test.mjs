// The attach store holds one composer's attached features: immutable
// snapshots, a hard cap of MAX_ATTACHED, and sessionStorage persistence.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAttachStore, MAX_ATTACHED } from '../ui/public/requirements-attach/store.mjs';

const fakeStorage = (seed = {}) => {
  const data = { ...seed };
  return {
    data,
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => { data[k] = String(v); },
  };
};
const items = (from, to) =>
  Array.from({ length: to - from + 1 }, (_, i) => ({ seq: from + i, title: `F${from + i}` }));
const KEY = 'worca-cc.attach.chat';

test('MAX_ATTACHED is 10', () => {
  assert.equal(MAX_ATTACHED, 10);
});

test('starts empty with an unset scope', () => {
  const s = createAttachStore({ storage: fakeStorage(), key: KEY });
  assert.deepEqual(s.get().items, []);
});

test('add de-duplicates by seq and returns ok', () => {
  const s = createAttachStore({ storage: fakeStorage(), key: KEY });
  assert.deepEqual(s.add([{ seq: 1, title: 'a' }, { seq: 2, title: 'b' }]), { ok: true });
  assert.deepEqual(s.add([{ seq: 2, title: 'dup' }, { seq: 3, title: 'c' }]), { ok: true });
  assert.deepEqual(s.get().items.map((i) => i.seq), [1, 2, 3]);
  assert.equal(s.get().items[1].title, 'b');
});

test('limit: the 11th distinct add is refused and the list is unchanged', () => {
  const s = createAttachStore({ storage: fakeStorage(), key: KEY });
  assert.deepEqual(s.add(items(1, 10)), { ok: true });
  const before = s.get();
  assert.deepEqual(s.add([{ seq: 11 }]), { ok: false, reason: 'limit' });
  assert.deepEqual(s.get(), before);
  // re-adding an existing seq at the cap is not a new item
  assert.deepEqual(s.add([{ seq: 5 }]), { ok: true });
  assert.equal(s.get().items.length, 10);
});

test('a batch that would pass the cap is refused whole', () => {
  const s = createAttachStore({ storage: fakeStorage(), key: KEY });
  s.add(items(1, 8));
  assert.deepEqual(s.add(items(9, 12)), { ok: false, reason: 'limit' });
  assert.equal(s.get().items.length, 8);
});

test('remove and clear', () => {
  const s = createAttachStore({ storage: fakeStorage(), key: KEY });
  s.add(items(1, 3));
  s.remove(2);
  assert.deepEqual(s.get().items.map((i) => i.seq), [1, 3]);
  s.clear();
  assert.deepEqual(s.get().items, []);
});

test('persists: a store on the same key restores items and scope', () => {
  const storage = fakeStorage();
  const a = createAttachStore({ storage, key: KEY });
  a.add(items(1, 2));
  const scope = { pinned: true, projectKey: 'p', workspaceId: null, label: 'P' };
  a.setScope(scope);
  const b = createAttachStore({ storage, key: KEY });
  assert.deepEqual(b.get().items.map((i) => i.seq), [1, 2]);
  assert.deepEqual(b.get().scope, scope);
  const other = createAttachStore({ storage, key: 'worca-cc.attach.newrun' });
  assert.deepEqual(other.get().items, []);
});

test('corrupt or wrong-shaped storage starts empty without throwing', () => {
  for (const raw of ['{not json', 'null', '42', '{"items":"x"}', '{"items":[null,{"x":1}]}']) {
    const s = createAttachStore({ storage: fakeStorage({ [KEY]: raw }), key: KEY });
    assert.deepEqual(s.get().items, [], raw);
  }
});

test('storage that throws does not break the store', () => {
  const bad = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('full'); } };
  const s = createAttachStore({ storage: bad, key: KEY });
  assert.deepEqual(s.add([{ seq: 1 }]), { ok: true });
  assert.equal(s.get().items.length, 1);
});

test('setStatuses merges a string or an object onto matching items only', () => {
  const s = createAttachStore({ storage: fakeStorage(), key: KEY });
  s.add(items(1, 2));
  s.setStatuses({ 1: 'stale', 2: { status: 'ready', ready: true, criteriaCount: 3 }, 9: 'ignored' });
  const [one, two] = s.get().items;
  assert.equal(one.status, 'stale');
  assert.deepEqual(
    { status: two.status, ready: two.ready, criteriaCount: two.criteriaCount, title: two.title },
    { status: 'ready', ready: true, criteriaCount: 3, title: 'F2' },
  );
  assert.equal(s.get().items.length, 2);
});

test('mutators never mutate inputs and produce new snapshots', () => {
  const s = createAttachStore({ storage: fakeStorage(), key: KEY });
  const input = [{ seq: 1, title: 'a' }];
  const frozen = Object.freeze(input.map((i) => Object.freeze({ ...i })));
  s.add(frozen);
  const snap1 = s.get();
  assert.notEqual(snap1.items[0], frozen[0]);
  s.setStatuses({ 1: 'ready' });
  const snap2 = s.get();
  assert.notEqual(snap2.items, snap1.items);
  assert.equal(snap1.items[0].status, undefined);
  assert.equal(frozen[0].status, undefined);
  assert.notEqual(snap2.items[0], snap1.items[0]);
  // mutating a returned snapshot does not change the store
  snap2.items.push({ seq: 99 });
  assert.equal(s.get().items.length, 1);
});

test('subscribe receives each new snapshot until unsubscribed', () => {
  const s = createAttachStore({ storage: fakeStorage(), key: KEY });
  const seen = [];
  const off = s.subscribe((snap) => seen.push(snap.items.map((i) => i.seq)));
  s.add(items(1, 2));
  s.remove(1);
  off();
  s.clear();
  assert.deepEqual(seen, [[1, 2], [2]]);
});

test('a refused add does not notify subscribers', () => {
  const s = createAttachStore({ storage: fakeStorage(), key: KEY });
  s.add(items(1, 10));
  let n = 0;
  s.subscribe(() => { n += 1; });
  s.add([{ seq: 11 }]);
  assert.equal(n, 0);
});
