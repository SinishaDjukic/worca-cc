// test/shape-fix.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { markNewPaths } from '../src/core/shape/fix.mjs';

const G = [{ path: 'src/gone.mjs', found: false, missing: true }, { path: 'src/a.mjs', found: true }];

test('a missing path is marked right after the path, every unmarked occurrence', () => {
  const md = '## Code layout\n- `src/gone.mjs`: tags.\n- uses `src/a.mjs` and `src/gone.mjs`\n';
  const r = markNewPaths(md, G);
  assert.equal(r.markdown, '## Code layout\n- `src/gone.mjs` (new): tags.\n- uses `src/a.mjs` and `src/gone.mjs` (new)\n');
  assert.deepEqual(r.fixed, [{ check: 'paths', detail: 'marked src/gone.mjs (new)' }]);
});

test('lines already marked (new) and fenced code are left alone; nothing missing is a no-op', () => {
  const md = '- `src/gone.mjs` (new)\n```\n`src/gone.mjs`\n```\n';
  assert.deepEqual(markNewPaths(md, G), { markdown: md, fixed: [] });
  assert.deepEqual(markNewPaths('- `src/a.mjs`\n', [{ path: 'src/a.mjs', found: true }]).fixed, []);
  assert.deepEqual(markNewPaths('- `src/gone.mjs:3`\n', [{ path: 'src/gone.mjs', line: 3, found: false }]).fixed, []);
});

test('a line that also cites an unfixable failure (a :line past the end) is not marked', () => {
  const g = [...G, { path: 'src/a.mjs', line: 99, found: false }];
  const md = '- `src/gone.mjs` reads `src/a.mjs:99`\n- `src/gone.mjs` again\n';
  const r = markNewPaths(md, g);
  assert.equal(r.markdown, '- `src/gone.mjs` reads `src/a.mjs:99`\n- `src/gone.mjs` (new) again\n');
  assert.deepEqual(r.fixed, [{ check: 'paths', detail: 'marked src/gone.mjs (new)' }]);
});
