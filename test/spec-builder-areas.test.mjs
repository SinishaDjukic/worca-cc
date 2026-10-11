import { test } from 'node:test';
import assert from 'node:assert/strict';
import { goalTokens, suggestAreas, MAX_AREAS } from '../src/core/spec-builder/areas.mjs';

test('goalTokens: lowercase words of 3+ letters, stop words and duplicates dropped', () => {
  assert.deepEqual(goalTokens('Add a Dark-mode toggle for the dark UI'), ['dark', 'mode', 'toggle']);
  assert.deepEqual(goalTokens(''), []);
});

test('suggestAreas: most token hits first, then by path; non-matching paths left out', () => {
  const files = ['src/theme.js', 'ui/dark-mode.css', 'ui/public/dark.js', 'README.md', 'docs/mode.md'];
  assert.deepEqual(suggestAreas(files, 'dark mode'), ['ui/dark-mode.css', 'docs/mode.md', 'ui/public/dark.js']);
});

test('suggestAreas: no useful words → the top-level directories, sorted; capped at MAX_AREAS', () => {
  assert.deepEqual(suggestAreas(['b/x.js', 'a/y.js', 'a/z.js', 'README.md'], 'add the'), ['a/', 'b/']);
  const many = Array.from({ length: 30 }, (_, i) => `src/file${String(i).padStart(2, '0')}.js`);
  assert.equal(suggestAreas(many, 'file').length, MAX_AREAS);
});
