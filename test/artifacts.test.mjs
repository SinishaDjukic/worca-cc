// test/artifacts.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { reviewPath } from '../src/core/artifacts.mjs';

test('reviewPath defaults to impl-review and accepts a kind suffix', () => {
  assert.match(reviewPath('/p', 'feat', '03-06-26'), /\/reviews\/03-06-26-feat-impl-review\.md$/);
  assert.match(reviewPath('/p', 'feat', '03-06-26', 'plan-review'), /\/reviews\/03-06-26-feat-plan-review\.md$/);
});
