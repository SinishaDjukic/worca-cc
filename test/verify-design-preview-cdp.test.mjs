// test/verify-design-preview-cdp.test.mjs: the Design preview real-browser proof (tools/verify-design-preview-cdp.mjs)
// keeps every check of plan Task 13, its scratch WORCA_HOME, a frame that never gets same-origin, and its npm script.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('verify:design-preview keeps its checks', () => {
  const src = readFileSync(new URL('../tools/verify-design-preview-cdp.mjs', import.meta.url), 'utf8');
  for (const needle of ['build doc: no hostile payload fired', 'raw file under build CSP: no hostile payload fired', 'meta refresh did not navigate', 'frame origin is null',
    'font loaded with Origin: null', 'applied rect matches the element', 'at most 8 applies a second', 'a nested slot was replaced where it stood', 'rects reported all 40',
    '12 live of 40 held the limit', 'settle ran and added no attribute', 'video kept playing across a morph', 'run doc: model script ran', 'run doc: /api refused',
    'picked the clicked element', 'a shell naming Document members still boots and merges', 'form= controls neither hang a merge nor reach another section',
    'WORCA_HOME']) assert.ok(src.includes(needle), needle);
  assert.ok(!src.includes('allow-same-origin'));
  assert.match(JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).scripts['verify:design-preview'], /tools\/verify-design-preview-cdp\.mjs/);
});
