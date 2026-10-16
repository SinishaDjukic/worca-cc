// Base conflicts (#620): the pure models behind the History detail block, the runs list note and Ship it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { baseCheckModel, baseRowNote } from '../ui/public/base-check.mjs';

const NOW = Date.parse('2026-10-07T12:00:00Z');
const at = '2026-10-07T11:57:00Z';

test('labels and actions per status', () => {
  let m = baseCheckModel({ status: 'up-to-date', base: 'dev', at }, { now: NOW });
  assert.deepEqual([m.tone, m.label, m.when, m.canUpdate, m.canResolve], ['green', 'Up to date with dev', 'checked 3 min ago', false, false]);
  m = baseCheckModel({ status: 'clean', base: 'dev', behind: 3, at }, { now: NOW });
  assert.deepEqual([m.tone, m.label, m.canUpdate], ['blue', 'dev is 3 commits ahead, merges cleanly', true]);
  m = baseCheckModel({ status: 'conflicts', base: 'dev', fileCount: 2, files: ['a', 'b'], at }, { now: NOW });
  assert.deepEqual([m.tone, m.label, m.files, m.canResolve, m.canUpdate], ['red', 'Conflicts in 2 files', ['a', 'b'], true, false]);
  m = baseCheckModel({ status: 'conflicts', kind: 'markers', base: 'dev', fileCount: 1, files: ['a'], at }, { now: NOW });
  assert.equal(m.label, 'Conflict markers left in 1 file');
  m = baseCheckModel({ status: 'conflicts', base: 'dev', fileCount: 5, files: ['a', 'b'], at }, { now: NOW });
  assert.equal(m.more, 3);
  assert.equal(baseCheckModel(null).label, 'Not checked against the base yet');
  assert.match(baseCheckModel({ status: 'error', base: 'dev', error: 'boom', at }).label, /Could not check against dev: boom/);
  assert.match(baseCheckModel({ status: 'clean', base: 'dev', behind: 1, stale: true, at }, { now: NOW }).when, /offline/);
  assert.equal(baseCheckModel({ status: 'clean', base: 'dev', behind: 1, at }, { now: NOW }).label, 'dev is 1 commit ahead, merges cleanly');
  assert.equal(baseCheckModel({ status: 'no-branch', base: 'dev', at }).label, 'The branch is no longer in the repository');
});

test('row note: only what needs attention', () => {
  assert.equal(baseRowNote({ status: 'conflicts', base: 'dev' }), 'conflicts with dev');
  assert.equal(baseRowNote({ status: 'clean', base: 'dev' }), 'dev moved');
  assert.equal(baseRowNote({ status: 'up-to-date', base: 'dev' }), '');
  assert.equal(baseRowNote(null), '');
});
