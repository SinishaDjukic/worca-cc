// test/readiness-baseline.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { conflictShare, fmtShare, deadCode, parityTimings, featureNames, movedByFeature, largestFiles, codeFiles } from '../tools/readiness/baseline.mjs';

test('deadCode counts a top-level name used nowhere else, not one used in another file or as a call', () => {
  const files = [
    { path: 'ui/server.mjs', text: 'function used() {}\nfunction orphan() {}\nexport const moved = 1;\nused();\nx.orphan2;\nconst orphan2 = 2;\n' },
    { path: 'ui/routes/chat/ask.mjs', text: "import { moved } from '../../server.mjs';\n" },
  ];
  assert.deepEqual(deadCode(files).map((d) => d.name), ['orphan', 'orphan2']);
});

test('conflictShare returns conflicted/total and a one-decimal percentage; 0 rows → 0%', () => {
  const rows = [{ dev: { conflict: true } }, { dev: { conflict: false } }, { dev: { conflict: false } }];
  assert.deepEqual(conflictShare(rows, 'dev'), { conflicted: 1, total: 3, pct: 33.3 });
  assert.equal(fmtShare(conflictShare([], 'dev')), '0/0 (0%)');
});

const FILES = new Map([['ui/routes/chat/ask.mjs', 'a\nb\n'], ['ui/routes/chat/ask-threads.mjs', 'c\n'], ['ui/public/chat/chat-shell.css', 'x\n'],
  ['ui/public/runs/runs.html', 'r\n'], ['ui/public/style.css', null], ['ui/routes/index.mjs', 'i\n'], ['ui/routes/chat/index.mjs', 'i\n'], ['docs/feature-files.md', '#\n']]);

test('featureNames lists each feature once (from its folder), sorted, without the route indexes, deletions or docs', () => {
  assert.deepEqual(featureNames(FILES), ['chat', 'runs']);
});

test('movedByFeature groups route files and parts per feature folder with line counts, skipping deletions and the indexes', () => {
  assert.deepEqual(movedByFeature(FILES, ['chat', 'settings']), [{ feature: 'chat', lines: 4, files: [
    { path: 'ui/public/chat/chat-shell.css', lines: 1 }, { path: 'ui/routes/chat/ask-threads.mjs', lines: 1 }, { path: 'ui/routes/chat/ask.mjs', lines: 2 }] }]);
});

test('codeFiles lists ui/routes recursively: the area files and the indexes', () => {
  const d = mkdtempSync(join(tmpdir(), 'rb-code-'));
  const put = (p, s) => { mkdirSync(join(d, p, '..'), { recursive: true }); writeFileSync(join(d, p), s); };
  put('ui/server.mjs', 's\n'); put('ui/routes/index.mjs', 'i\n'); put('ui/routes/chat/index.mjs', 'c\n'); put('ui/routes/chat/ask.mjs', 'a\n');
  assert.deepEqual(codeFiles(d).map((f) => f.path), ['ui/server.mjs', 'ui/routes/chat/ask.mjs', 'ui/routes/chat/index.mjs', 'ui/routes/index.mjs']);
});

test('parityTimings maps a/b medians to dev/migrated', () => {
  const t = (a, b) => ({ a, b, deltaPct: 1, gated: true, pass: true });
  assert.deepEqual(parityTimings({ timingGated: true, timings: { boot: t(1400, 1410), pages: { runs: t(300, 301) } } }).boot,
    { dev: 1400, migrated: 1410, deltaPct: 1, pass: true });
});

test('largestFiles ranks ui/ code files by lines and skips minified bundles, vendored files and other top dirs', () => {
  const d = mkdtempSync(join(tmpdir(), 'readiness-largest-'));
  const put = (p, n) => { mkdirSync(join(d, p, '..'), { recursive: true }); writeFileSync(join(d, p), 'x\n'.repeat(n)); };
  put('ui/server.mjs', 5); put('ui/public/a.css', 3); put('ui/public/c4/dagre.min.js', 50); put('ui/public/vendor/v.js', 40); put('src/big.mjs', 30);
  assert.deepEqual(largestFiles(d, 10), [{ path: 'ui/server.mjs', lines: 5 }, { path: 'ui/public/a.css', lines: 3 }]);
  assert.deepEqual(largestFiles(d, 1).map((f) => f.path), ['ui/server.mjs']);
});
