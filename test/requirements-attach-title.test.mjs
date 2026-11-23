// test/requirements-attach-title.test.mjs — suggested run title for attached features.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { suggestTitle } from '../ui/public/requirements-attach/title.mjs';

test('no items gives an empty title', () => {
  assert.equal(suggestTitle([]), '');
});

test('one item gives its title', () => {
  assert.equal(suggestTitle([{ title: 'Login' }]), 'Login');
});

test('several items give the first title plus a count of the rest', () => {
  assert.equal(
    suggestTitle([{ title: 'Login' }, { title: 'Logout' }, { title: 'Reset' }]),
    'Login + 2 more',
  );
});

test('a missing title falls back to the id, never "undefined"', () => {
  assert.equal(suggestTitle([{ id: 'FEAT-4', title: '' }, { title: 'B' }]), 'FEAT-4 + 1 more');
  assert.equal(suggestTitle([{ seq: 9 }]), 'FEAT-9');
});
