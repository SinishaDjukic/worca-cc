// test/css-rules.test.mjs — the shared stylesheet walker (test/helpers/css-rules.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cssRules } from './helpers/css-rules.mjs';

test('cssRules walks @media, skips @keyframes and comments, and keeps real line numbers', () => {
  const r = cssRules('/* a{b} */\n.a{color:red;}\n@media (max-height:640px){\n.b{x:1;}\n}\n@keyframes k{from{opacity:0}to{opacity:1}}\n');
  assert.deepEqual(r.map((x) => [x.sel, x.body, x.line, x.media]),
    [['.a', 'color:red;', 2, ''], ['.b', 'x:1;', 4, '@media (max-height:640px)']]);
});
