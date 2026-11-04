// test/ui-group-add.test.mjs — Add to group's shared pieces (ui/public/group-add.mjs): recent groups and the toast.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readRecentGroups, noteRecentGroup, addedNotice } from '../ui/public/group-add.mjs';

const mem = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)) }; };

test('recent groups: newest first, deduped, per list, at most 8; a throwing storage reads []', () => {
  const s = mem();
  for (const id of ['a', 'b', 'c', 'a']) noteRecentGroup(s, 'runs', id);
  assert.deepEqual(readRecentGroups(s, 'runs'), ['a', 'c', 'b']);
  assert.deepEqual(readRecentGroups(s, 'chats'), []);
  for (let i = 0; i < 12; i++) noteRecentGroup(s, 'runs', `g${i}`);
  assert.equal(readRecentGroups(s, 'runs').length, 8);
  const bad = { getItem() { throw new Error('SecurityError'); }, setItem() { throw new Error('SecurityError'); } };
  assert.deepEqual(readRecentGroups(bad, 'runs'), []);
  noteRecentGroup(bad, 'runs', 'x');   // never throws
});

test('the toast: the group in the title, the item or the count, the skip note, Undo only with a token', () => {
  const n = addedNotice({ group: 'Auth rework', titles: ['Fix login redirect loop'], noun: 'run', undo: () => {} });
  assert.deepEqual([n.tone, n.title, n.detail, n.action.label], ['ok', 'Added to Auth rework', 'Fix login redirect loop', 'Undo']);
  const m = addedNotice({ group: 'Billing', titles: ['a', 'b'], noun: 'run', skipped: 1, skipWhy: 'part of a Shaper feature' });
  assert.equal(m.detail, '2 runs · Skipped 1: part of a Shaper feature');
  assert.equal(m.action, null);
});
