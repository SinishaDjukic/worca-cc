import { test } from 'node:test';
import assert from 'node:assert/strict';
import { slug } from '../src/slug.mjs';

test('slug lower-cases and joins words with -', () => {
  assert.equal(slug('  Hello   World '), 'hello-world');
});
