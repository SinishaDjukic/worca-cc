import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
// test/extension-css.test.mjs — needs nothing but style.css. Class coverage, shadow CSS and colour literals live in
// test/extension-css-coverage.test.mjs, which imports the sidebar sources.
import { SIDEBAR_PIECES, SHADOW_PIECES, cutPiece, tokenMap, sidebarCss } from '../tools/extension-css.mjs';

const style = readFileSync('ui/public/style.css', 'utf8');
test('every declared piece exists in style.css (a renamed marker or rule fails here, not in a browser)', () => {
  for (const p of [...SIDEBAR_PIECES, ...SHADOW_PIECES]) assert.ok(cutPiece(style, p).text.length > 20, p.name);
  assert.throws(() => cutPiece(style, { name: 'x', from: '/* nope */', to: ':root{' }), /marker not found/);
  assert.throws(() => cutPiece(style, { name: 'x', rule: '.no-such-rule{' }), /rule not found/);
});
test('the sidebar gets every :root token byte-for-byte, in source order, plus the rules the Ask look depends on', () => {
  const css = sidebarCss(style, '');
  assert.deepEqual(tokenMap(css), tokenMap(style));
  for (const sel of ['textarea{', '.extras-pills{', '.extra-pill{', '.extra-pill-name{', '--hd-syntax-keyword', '@keyframes wr-rise',
    '.ask-composer-box{', '.chat-page .ask-composer-box{', '.chat-convo{', '.ask-user-bubble{', '.ask-error-line{', '.ask-answer-plain{',
    '.ask-attachment-pill{', '.ask-send,.ask-stop{', '.ask-chip.ask-chip-quote', '.pp-bar', ':root[data-theme="dark"]']) {
    assert.ok(css.includes(sel), sel);
  }
  const at = (s) => css.indexOf(s);
  assert.ok(at('.ask-composer-box{') < at('.chat-page .ask-composer-box{'), 'Chat P1 overrides come after the Ask base rules');
});
