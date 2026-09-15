// ui/public/comment-thread.mjs — DOM-free grouping + the relative time label.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupCommentThreads, commentWhen } from '../ui/public/comment-thread.mjs';

const c = (id, parentId = null) => ({ id, parentId });

test('groupCommentThreads: roots in server order, replies nested in server order, strays kept', () => {
  const list = [c('dc_1'), c('dc_2'), c('dc_3', 'dc_1'), c('dc_4', 'dc_2'), c('dc_5', 'dc_1'), c('dc_9', 'dc_gone')];
  const threads = groupCommentThreads(list);
  assert.deepEqual(threads.map((t) => [t.root.id, t.replies.map((r) => r.id)]),
    [['dc_1', ['dc_3', 'dc_5']], ['dc_2', ['dc_4']], ['dc_9', []]],
    'a reply whose root is missing (deleted, or hidden) still shows — as its own thread, last');
  assert.deepEqual(groupCommentThreads([]), []);
  assert.deepEqual(groupCommentThreads(null), []);
  assert.deepEqual(groupCommentThreads([{ id: 'dc_1' }]).map((t) => t.root.id), ['dc_1'], 'a missing parentId is a root');
});

test('commentWhen: relative inside a week, "Mon D, YYYY" beyond, empty for garbage', () => {
  const now = Date.parse('2026-09-10T12:00:00Z');
  assert.equal(commentWhen('2026-09-10T11:59:40Z', now), 'just now');
  assert.equal(commentWhen('2026-09-10T11:56:00Z', now), '4m ago');
  assert.equal(commentWhen('2026-09-10T09:00:00Z', now), '3h ago');
  assert.equal(commentWhen('2026-09-08T12:00:00Z', now), '2d ago');
  assert.equal(commentWhen('2026-09-03T11:00:00Z', now), 'Sep 3, 2026', 'seven days is the cut-over');
  assert.equal(commentWhen('2026-08-26T10:00:00.000Z', now), 'Aug 26, 2026');
  assert.equal(commentWhen('2025-12-31T12:00:00Z', now), 'Dec 31, 2025', 'the year is always shown');
  assert.equal(commentWhen('2026-09-10T12:00:05Z', now), 'just now', 'a clock skewed into the future never goes negative');
  assert.equal(commentWhen('nope', now), '');
  assert.equal(commentWhen(undefined, now), '');
});
