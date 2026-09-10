import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const css = readFileSync(fileURLToPath(new URL('../ui/public/style.css', import.meta.url)), 'utf8');

function bodyAfter(selector) {
  const start = css.indexOf(selector);
  assert.notEqual(start, -1, `missing selector ${selector}`);
  const open = selector.endsWith('{')
    ? start + selector.length - 1
    : css.indexOf('{', start + selector.length);
  const close = css.indexOf('}', open + 1);
  return css.slice(open + 1, close).replace(/\s+/g, ' ');
}

test('diff source grid has two sticky gutters and one widest-code track', () => {
  const body = bodyAfter('.hd-diff-body{');
  assert.match(body, /grid-template-columns:var\(--hd-gutter-width\) var\(--hd-gutter-width\) minmax\(max-content,1fr\)/);
  assert.match(body, /overflow:auto/);
  assert.match(body, /max-height:860px/);
  assert.match(bodyAfter('.hd-diff-rows{'), /max-height:860px/);
  assert.match(bodyAfter('.hd-dl-row{'), /display:contents/);
  assert.doesNotMatch(bodyAfter('.hd-dl-code{'), /display:contents/);
  assert.match(bodyAfter('.hd-dl-code{'), /min-width:100%/);
  assert.match(bodyAfter('.hd-dl-code{'), /white-space:pre/);
  assert.match(bodyAfter('.hd-dl-hunk,.hd-diff-note{'), /grid-column:1\/-1/);
  assert.match(bodyAfter('.hd-dl-more{'), /grid-column:1\/-1/, 'show-more spans all three tracks');
  assert.match(bodyAfter('.hd-diff-body.hint{'), /display:block/);
  assert.match(bodyAfter('.hd-diff-body.hint .hd-diff-note{'), /padding-inline:0/,
    'placeholder note is not padded twice inside the block body');
  assert.match(bodyAfter('.hd-dl-row.hd-dl-add > *{'), /background:var\(--green-bg\)/);
  assert.match(bodyAfter('.hd-dl-row.hd-dl-del > *{'), /background:var\(--red-bg\)/);
});

test('gutters are opaque, sticky, non-selectable, and correctly offset', () => {
  const gutter = bodyAfter('.hd-dl-n{');
  assert.match(gutter, /position:sticky/);
  assert.match(gutter, /z-index:2/);
  assert.match(gutter, /background:var\(--panel\)/);
  assert.match(gutter, /user-select:none/);
  assert.match(bodyAfter('.hd-dl-n-old{'), /left:0/);
  assert.match(bodyAfter('.hd-dl-n-new{'), /left:var\(--hd-gutter-width\)/);
});

test('tree native controls hide groups explicitly and preserve visible focus', () => {
  assert.match(bodyAfter('.hd-tree-group[hidden]{'), /display:none/);
  const buttons = bodyAfter('.hd-tree-dir,.hd-tree-file{');
  for (const declaration of [
    /width:100%/, /border:0/, /padding-block:9px/, /padding-inline-end:12px/,
    /display:flex/, /align-items:center/, /gap:8px/, /cursor:pointer/,
  ]) assert.match(buttons, declaration);
  assert.match(bodyAfter('.hd-tree-dir:hover,.hd-tree-file:hover,.hd-tree-file.active{'),
    /background:var\(--field\)/);
  assert.match(bodyAfter('.hd-tree-dir:focus-visible,.hd-tree-file:focus-visible{'),
    /outline:2px solid var\(--ink\)/);
  const leaf = bodyAfter('.hd-tree-file .hd-diff-path{');
  assert.match(leaf, /direction:ltr/);
  assert.match(leaf, /text-overflow:ellipsis/);
  assert.match(leaf, /font-size:12px/);
  assert.match(leaf, /color:var\(--ink\)/);
  assert.match(bodyAfter('.hd-tree-file .hd-diff-path::before{'), /content:none/);
  const deleted = bodyAfter('.hd-tree-file.deleted .hd-diff-path{');
  assert.match(deleted, /opacity:1/);
  assert.doesNotMatch(deleted, /opacity:\.(?:[0-9]+)/);
  assert.match(deleted, /text-decoration:none/);
  assert.doesNotMatch(deleted, /line-through/);
  const dirLabel = bodyAfter('.hd-tree-dir-label{');
  assert.match(dirLabel, /font-size:12px/);
  assert.match(dirLabel, /color:var\(--ink\)/);
  assert.match(bodyAfter('.hd-tree-file.add .hd-tree-status{'), /color:var\(--green-ink\)/);
  assert.match(bodyAfter('.hd-tree-file.del .hd-tree-status{'), /color:var\(--red-ink\)/);
  assert.match(bodyAfter('.hd-tree-dir[aria-expanded="true"] .hd-tree-chevron{'), /rotate\(90deg\)/);
  const panePath = bodyAfter('.hd-diff-pane-head .hd-diff-path{');
  assert.match(panePath, /margin:0/);
  assert.match(panePath, /font-size:12px/);
  assert.match(panePath, /font-weight:400/, 'the h3 must not keep the UA bold');
});

function hex(value, arm = 'light') {
  const esc = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = css.match(new RegExp(`${esc}\\s*:\\s*(?:light-dark\\(\\s*(#[0-9A-Fa-f]{6})\\s*,\\s*(#[0-9A-Fa-f]{6})\\s*\\)|(#[0-9A-Fa-f]{6}))`));
  assert.ok(match, `missing color ${value}`);
  return arm === 'dark' ? (match[2] || match[3]) : (match[1] || match[3]);
}

function rgb(value) {
  return [1, 3, 5].map((index) => Number.parseInt(value.slice(index, index + 2), 16) / 255);
}

function luminance(value) {
  const channels = rgb(value).map((channel) => (
    channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  ));
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrast(foreground, background) {
  const a = luminance(foreground);
  const b = luminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

test('small diff text palette clears 4.5:1 on every possible row background', () => {
  const foregrounds = [
    '--ink-2', '--hd-syntax-comment', '--hd-syntax-keyword', '--hd-syntax-type',
    '--hd-syntax-string', '--hd-syntax-literal', '--hd-syntax-title',
  ];
  const backgrounds = ['--panel', '--green-bg', '--red-bg'];
  for (const arm of ['light', 'dark']) {
    for (const fgName of foregrounds) {
      for (const bgName of backgrounds) {
        const ratio = contrast(hex(fgName, arm), hex(bgName, arm));
        assert.ok(ratio >= 4.5, `${fgName} on ${bgName} (${arm}): ${ratio.toFixed(2)}:1`);
      }
    }
    for (const count of ['--hd-count-add', '--hd-count-del']) {
      const ratio = contrast(hex(count, arm), hex('--field', arm));
      assert.ok(ratio >= 4.5, `${count} on --field (${arm}): ${ratio.toFixed(2)}:1`);
    }
  }
});

test('syntax selectors use only measured foreground variables and never token backgrounds', () => {
  const syntaxBlockStart = css.indexOf('.hd-diff-pane :is(.hljs-comment');
  const syntaxBlockEnd = css.indexOf('.hd-diff-empty', syntaxBlockStart);
  const block = css.slice(syntaxBlockStart, syntaxBlockEnd);
  const colors = [...block.matchAll(/color:var\((--[^)]+)\)/g)].map((match) => match[1]);
  const allowed = new Set([
    '--hd-syntax-comment', '--hd-syntax-keyword', '--hd-syntax-type',
    '--hd-syntax-string', '--hd-syntax-literal', '--hd-syntax-title', '--ink-2',
  ]);
  assert.ok(colors.length >= 7);
  assert.ok(colors.every((color) => allowed.has(color)), colors.join(', '));
  assert.doesNotMatch(block, /background(?:-color)?\s*:/);

  const diffStart = css.indexOf('/* ---------- History detail: Diff tab ---------- */');
  const diffEnd = css.indexOf('/* ---------- History detail: Overview tab ---------- */');
  assert.doesNotMatch(css.slice(diffStart, diffEnd), /color:var\(--ink-3\)/);
});

test('comment threads: surface cards, the sidebar rail recipe, quiet buttons, a ringed composer, tokens only', () => {
  const card = bodyAfter('.hd-cmt-card{');
  assert.match(card, /background:var\(--surface\)/);
  assert.match(card, /border:1px solid var\(--line\)/);
  assert.match(card, /border-radius:14px/);
  assert.match(card, /box-shadow:var\(--shadow-soft\)/);
  assert.match(bodyAfter('.hd-cmt-thread{'), /max-width:720px/);
  // The rail is .nav-child's connector, card-sized: same stroke, token and radius.
  const elbow = bodyAfter('.hd-cmt-replies>.hd-cmt-reply-row::before{');
  assert.match(elbow, /border-left:1\.5px solid var\(--line-2\)/);
  assert.match(elbow, /border-bottom:1\.5px solid var\(--line-2\)/);
  assert.match(elbow, /border-bottom-left-radius:7px/);
  assert.match(bodyAfter('.hd-cmt-replies>.hd-cmt-reply-row:not(:last-child)::after{'), /width:1\.5px/);
  assert.match(bodyAfter('.hd-cmt-thread.collapsed .hd-cmt-replies{'), /display:none/);
  const mark = bodyAfter('.hd-cmt-mark{');
  assert.match(mark, /worca-mark-mask\.png/);
  assert.match(mark, /background:var\(--ink\)/, 'black on light, white on dark — never a coloured disc');
  assert.match(bodyAfter('.hd-cmt-body{'), /font:400 13px\/1\.5 var\(--sans\)/);
  assert.match(bodyAfter('.hd-cmt-body.ask-md{'), /white-space:normal/, 'marked emits newlines between blocks; pre-wrap would double-space them');
  const btn = bodyAfter('.hd-cmt-btn{');
  assert.match(btn, /height:26px/);
  assert.match(btn, /border-radius:8px/);
  assert.match(btn, /color:var\(--ink-2\)/);
  assert.match(bodyAfter('.hd-cmt-btn:hover{'), /background:var\(--field\)/);
  assert.match(bodyAfter('.hd-cmt-delete:hover{'), /color:var\(--red-ink\)/);
  const reply = bodyAfter('.hd-cmt-btn.hd-cmt-reply{');
  assert.match(reply, /border:1px solid var\(--line-2\)/);
  assert.match(reply, /border-radius:999px/);
  const save = bodyAfter('.hd-cmt-save{');
  assert.match(save, /background:var\(--ink\)/);
  assert.match(save, /border-radius:999px/);
  const focus = bodyAfter('.hd-cmt-composer:focus-within{');
  assert.match(focus, /box-shadow:0 0 0 3px var\(--selection\)/);
  assert.match(focus, /border-color:var\(--ink\)/);
  assert.match(bodyAfter('.hd-cmt-tab[aria-selected="true"]{'), /box-shadow:var\(--knob-shadow\)/);
  assert.match(bodyAfter('.hd-cmt-preview:empty::before{'), /Nothing to preview yet/);
  assert.match(bodyAfter('.hd-cmt-tag{'), /background:var\(--green-bg\)/);
  assert.doesNotMatch(bodyAfter('.hd-cmt-thread.resolved .hd-cmt-body{'), /opacity/, 'resolved dims the text, never the card');
  // The whole block is token-only, --ink-3-free, and guards its own animation.
  const start = css.indexOf('/* ---------- History detail: diff comments ---------- */');
  const end = css.indexOf('/* ---------- end diff comments ---------- */', start);
  assert.ok(start > 0 && end > start);
  const block = css.slice(start, end);
  assert.doesNotMatch(block, /#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\(/i);
  assert.doesNotMatch(block, /--ink-3/);
  assert.match(block, /@media \(prefers-reduced-motion: reduce\)\{\.hd-cmt-thread\{animation:none;\}\}/);
  assert.equal(css.indexOf('.hd-cmt-body{'), css.indexOf('.hd-cmt-body{', start), 'the base body rule is the first .hd-cmt-body{ in the file — bodyAfter depends on it');
});
