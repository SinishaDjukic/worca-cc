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
  assert.match(bodyAfter('.hd-diff-body.hint{'), /display:block/);
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
});

function hex(value) {
  const match = css.match(new RegExp(`${value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*:\\s*(#[0-9A-Fa-f]{6})`));
  assert.ok(match, `missing color ${value}`);
  return match[1];
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
  for (const fgName of foregrounds) {
    for (const bgName of backgrounds) {
      const ratio = contrast(hex(fgName), hex(bgName));
      assert.ok(ratio >= 4.5, `${fgName} on ${bgName}: ${ratio.toFixed(2)}:1`);
    }
  }
  for (const count of ['--hd-count-add', '--hd-count-del']) {
    const ratio = contrast(hex(count), hex('--field'));
    assert.ok(ratio >= 4.5, `${count} on --field: ${ratio.toFixed(2)}:1`);
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
