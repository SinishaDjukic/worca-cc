import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bootBridge, pureHelpers } from './helpers/design-bridge.mjs';
const { safePrefix, cutCss } = pureHelpers();
const PREFIX = [
  ['', ''], ['<div><h1>Ship', '<div><h1>Ship'],
  ['<div><h1 cla', '<div>'], ['<div title="a>b', ''], ["<img alt='a>b' src=x", ''],
  ['<a href="x">y</a', '<a href="x">y'], ['<p>a<', '<p>a'], ['<p>a</', '<p>a'],
  ['<p>a<!-- hid', '<p>a'], ['<p>a<!-', '<p>a'], ['<p>a<!-- ok --><b>', '<p>a<!-- ok --><b>'],
  ['<p>x &am', '<p>x '], ['<p>x &#12', '<p>x '], ['<p>3 &', '<p>3 '],
  ['<p>x &amp;', '<p>x &amp;'], ['<p>a & b', '<p>a & b'], ['<p>a < b', '<p>a < b'],
  ['<style>.a{color:red}', ''], ['<div><style>.a{}</style><p>', '<div><style>.a{}</style><p>'],
  ['<div><textarea><b>', '<div>'], ['<svg><path d="M0 0"/>', '<svg><path d="M0 0"/>'],
  ['<p>hi \ud83d', '<p>hi '], ['<p>hi 😀', '<p>hi 😀'],
];
test('safePrefix cuts only a trailing unfinished construct', () => {
  for (const [input, want] of PREFIX) assert.equal(safePrefix(input), want, input);
});
test('safePrefix is linear on a hostile tail', { timeout: 5000 }, () => {
  assert.equal(safePrefix('<'.repeat(1_000_000)), '<'.repeat(999_999));   // `<<` is text; only the lone trailing `<` goes
  assert.equal(safePrefix('<a '.repeat(300_000)), '');
});
const CSS = [
  ['', ''], ['.a{color:red}.b{col', '.a{color:red}'], ['.a{x:y', ''],
  ['@media (w){.a{x:y}', ''], ['@media (w){.a{x:y}}.b', '@media (w){.a{x:y}}'],
  ['.a{content:"}"}.b{', '.a{content:"}"}'], ['/* } */.a{x:y}/* }', '/* } */.a{x:y}'],
  ['@import url(a.css);', ''],
];
test('cutCss ends at the last depth-0 close', () => { for (const [i, w] of CSS) assert.equal(cutCss(i), w, i); });
test('css message: one style per file, tokens before global before sections', () => {
  const b = bootBridge();
  b.send('css', { file: 'hero', rev: 1, text: '.h{x:y}', final: false });
  b.send('css', { file: 'global', rev: 1, text: '.g{x:y}', final: false });
  b.send('css', { file: 'tokens', rev: 1, text: ':root{--a:1}', final: false });
  b.clock.tick(125);
  const order = [...b.doc.head.querySelectorAll('style[data-worca-css]')].map((s) => s.getAttribute('data-worca-css'));
  assert.deepEqual(order, ['tokens', 'global', 'hero']);
});
test('css message: cut while partial, whole when final, stale rev dropped, existing style reused', () => {
  const b = bootBridge({ html: '<!doctype html><html><head><style data-worca-css="hero">.old{}</style></head><body></body></html>' });
  const s = () => b.doc.querySelector('style[data-worca-css="hero"]');
  b.send('css', { file: 'hero', rev: 2, text: '.a{x:y}.b{', final: false });
  assert.equal(s().textContent, '.a{x:y}');
  assert.equal(b.doc.querySelectorAll('style[data-worca-css="hero"]').length, 1);
  b.send('css', { file: 'hero', rev: 1, text: '.stale{}', final: true });
  assert.equal(s().textContent, '.a{x:y}');
  b.clock.tick(125);
  b.send('css', { file: 'hero', rev: 3, text: '.a{x:y}@import "z";', final: true });
  b.clock.tick(0);
  assert.equal(s().textContent, '.a{x:y}@import "z";');
});
test('css with a bad file name is an err', () => {
  const b = bootBridge();
  b.send('css', { file: '../x', rev: 1, text: '', final: false });
  assert.equal(b.of('err')[0].code, 'bad-message');
});

// Rules beyond the plan's rows, each as the HTML tokenizer (parse5 in jsdom) or CSS tokenizer reads it.
const PREFIX_EDGE = [
  ['<p>a<!-- x > y', '<p>a'], ['<p>a<!-->b', '<p>a<!-->b'], ['<p>a<!--->b', '<p>a<!--->b'],
  ['<p>a<!-- x --!>b', '<p>a<!-- x --!>b'], ['<p>a<!--!>b', '<p>a'], ['<p>a<!---!>b', '<p>a'],
  ['<?xml v?><p>', '<?xml v?><p>'], ['<p>a<?x', '<p>a'], ['<p>3 </ b', '<p>3 '], ['<p>a</p title=">"', '<p>a'],
  ['<p b= "x>y', ''], ['<p "a>b', '<p "a>b'], ['<a="x>y', '<a="x>y'],
  ['<STYLE>a</Style >b', '<STYLE>a</Style >b'], ['<style>a</styles>b', ''], ['<style>a</style x', ''],
  ['<p>x &' + 'a'.repeat(40), '<p>x '], ['<p>x &' + 'a'.repeat(41), '<p>x &' + 'a'.repeat(41)],
];
test('safePrefix follows the tokenizer on comments, bogus comments, quotes, raw-text close tags and long references', () => {
  for (const [input, want] of PREFIX_EDGE) assert.equal(safePrefix(input), want, input);
});
const CSS_EDGE = [
  ['.a{content:"x\n}.b{x:y}', '.a{content:"x\n}.b{x:y}'], ['.a{x:\\}y}.b{', '.a{x:\\}y}'],
  ['.a{content:"\\"}"}.b{', '.a{content:"\\"}"}'], ['}.a{x:y}', '}.a{x:y}'], ['.a{x:y/* } */}.b{', '.a{x:y/* } */}'],
];
test('cutCss: a newline ends a bad string, escapes and comments hide a brace, a stray close is not a depth change', () => {
  for (const [i, w] of CSS_EDGE) assert.equal(cutCss(i), w, i);
});
test('css message: an equal rev is stale, and global goes after an existing tokens', () => {
  const b = bootBridge();
  b.send('css', { file: 'tokens', rev: 2, text: ':root{--a:1}', final: true });
  b.send('css', { file: 'tokens', rev: 2, text: ':root{--a:2}', final: true });
  b.send('css', { file: 'global', rev: 1, text: '.g{x:y}', final: true });
  const styles = [...b.doc.head.querySelectorAll('style[data-worca-css]')];
  assert.deepEqual(styles.map((s) => [s.getAttribute('data-worca-css'), s.textContent]), [['tokens', ':root{--a:1}'], ['global', '.g{x:y}']]);
});
