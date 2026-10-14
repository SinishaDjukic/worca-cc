// test/extension-element-snippet.test.mjs — what the area capture tells the agent about the DOM under the rectangle.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { cssSelector, htmlSnippet, elementUnder, cssEscape, SNIPPET_MAX, SELECTOR_MAX } from '../extension/src/element-snippet.mjs';

const dom = (body) => new JSDOM(`<!doctype html><html><body>${body}</body></html>`).window.document;

test('a unique id is the selector', () => {
  const doc = dom('<main><p id="para">x</p></main>');
  assert.equal(cssSelector(doc.getElementById('para')), '#para');
});

test('id-less siblings get nth-of-type steps up to <body>', () => {
  const doc = dom('<main><section><p>a</p></section><section><p>b</p></section></main>');
  const p = doc.querySelectorAll('section')[1].querySelector('p');
  const sel = cssSelector(p);
  assert.equal(sel, 'body > main > section:nth-of-type(2) > p');
  assert.equal(doc.querySelector(sel), p);
});

test('a duplicate id is not trusted: nth-of-type steps instead', () => {
  const doc = dom('<div id="dup"><span>a</span></div><div id="dup"><span>b</span></div>');
  const span = doc.querySelectorAll('span')[1];
  const sel = cssSelector(span);
  assert.ok(!sel.includes('#dup'), sel);
  assert.equal(doc.querySelector(sel), span);
});

test('the selector stays within SELECTOR_MAX for a deep tree', () => {
  const doc = dom(`${'<div>'.repeat(60)}<b>deep</b>${'</div>'.repeat(60)}`);
  const sel = cssSelector(doc.querySelector('b'), { maxDepth: 80 });
  assert.ok(sel.length <= SELECTOR_MAX, String(sel.length));
  assert.ok(sel.endsWith('b'));
});

test('cssEscape escapes what an identifier cannot hold', () => {
  assert.equal(cssEscape('a b', {}), 'a\\ b');
  assert.equal(cssEscape('1x', {}), '\\31 x');
});

test('htmlSnippet drops scripts and handlers, hides password values, shortens long attributes, clips', () => {
  const doc = dom(`<div id="w" onclick="steal()"><script>evil()</script><input type="password" value="hunter2"><span data-x="${'y'.repeat(5000)}">ok</span></div>`);
  const s = htmlSnippet(doc.getElementById('w'));
  assert.ok(!s.includes('<script'));
  assert.ok(!s.includes('onclick'));
  assert.ok(!s.includes('hunter2'));
  assert.ok(!s.includes('y'.repeat(300)));
  assert.match(s, /data-x="y+…"/);
  assert.equal(doc.getElementById('w').getAttribute('onclick'), 'steal()');   // the page's own DOM is untouched
  const big = dom(`<p id="b">${'z'.repeat(SNIPPET_MAX * 2)}</p>`);
  const clipped = htmlSnippet(big.getElementById('b'));
  assert.equal(clipped.length, SNIPPET_MAX + 1);
  assert.ok(clipped.endsWith('…'));
});

test('elementUnder: the common ancestor of the sampled points, skipping our own host', () => {
  const doc = dom('<main id="m"><p id="a">a</p><p id="b">b</p></main><div id="host"></div>');
  const host = doc.getElementById('host');
  const a = doc.getElementById('a');
  const b = doc.getElementById('b');
  doc.elementsFromPoint = (x) => [host, x < 50 ? a : b, doc.getElementById('m'), doc.body, doc.documentElement];
  assert.equal(elementUnder(doc, { x: 0, y: 0, width: 100, height: 40 }, (n) => n === host), doc.getElementById('m'));
  assert.equal(elementUnder(doc, { x: 0, y: 0, width: 40, height: 40 }, (n) => n === host), a);
  assert.equal(elementUnder(doc, { x: 0, y: 0, width: 40, height: 40 }), host);
  doc.elementsFromPoint = () => [doc.documentElement];
  assert.equal(elementUnder(doc, { x: 0, y: 0, width: 40, height: 40 }), null);
});
