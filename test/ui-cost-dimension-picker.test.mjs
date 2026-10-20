// test/ui-cost-dimension-picker.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { openDimensionPicker } from '../ui/public/cost-dimension-picker.mjs';

function setup() {
  const dom = new JSDOM('<!doctype html><body><button id="a">Client</button></body>');
  const doc = dom.window.document;
  const options = Array.from({ length: 120 }, (_, i) => ({ id: `tag:key-${i}`, label: `key-${i}`, group: 'other', hint: '<1%' }));
  return { doc, options, anchor: doc.getElementById('a') };
}
const rows = (doc) => [...doc.querySelectorAll('.cr-pick-row')].map((b) => b.textContent.replace('<1%', ''));

test('the dimension picker filters 120 keys by typed text', () => {
  const { doc, options, anchor } = setup();
  openDimensionPicker({ doc, anchor, options, title: 'Allocate by', onPick: () => {} });
  assert.equal(doc.querySelectorAll('.cr-pick-row').length, 120);
  assert.equal(doc.querySelector('.cr-pick-group').textContent, 'Other cost tags');
  const search = doc.querySelector('.cr-pick-search');
  search.value = 'key-11';
  search.dispatchEvent(new doc.defaultView.Event('input'));
  assert.deepEqual(rows(doc), ['key-11', ...Array.from({ length: 10 }, (_, i) => `key-11${i}`)]);
  search.value = 'nope';
  search.dispatchEvent(new doc.defaultView.Event('input'));
  assert.equal(doc.querySelectorAll('.cr-pick-row').length, 0);
  assert.equal(doc.querySelector('.cr-pick-empty').hidden, false);
});

test('Enter picks the first match; Esc closes and refocuses the anchor', () => {
  const { doc, options, anchor } = setup();
  let picked = null;
  openDimensionPicker({ doc, anchor, options, title: 'Allocate by', onPick: (id) => { picked = id; } });
  const search = doc.querySelector('.cr-pick-search');
  search.value = 'key-42';
  search.dispatchEvent(new doc.defaultView.Event('input'));
  search.dispatchEvent(new doc.defaultView.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  assert.equal(picked, 'tag:key-42');
  assert.equal(doc.querySelector('.cr-picker'), null);
  openDimensionPicker({ doc, anchor, options, title: 'Allocate by', onPick: () => {} });
  doc.querySelector('.cr-pick-search').dispatchEvent(new doc.defaultView.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal(doc.querySelector('.cr-picker'), null);
  assert.equal(doc.activeElement, anchor);
});

test('the then by picker leads with None, which reports an empty id', () => {
  const { doc, options, anchor } = setup();
  let picked;
  openDimensionPicker({ doc, anchor, options, title: 'Then by', noneLabel: 'None', onPick: (id) => { picked = id; } });
  doc.querySelector('.cr-pick-row').click();
  assert.equal(picked, '');
});

test('a press outside closes the picker and refocuses the anchor', () => {
  const { doc, options, anchor } = setup();
  openDimensionPicker({ doc, anchor, options, title: 'Allocate by', onPick: () => {} });
  doc.body.dispatchEvent(new doc.defaultView.Event('pointerdown', { bubbles: true }));
  assert.equal(doc.querySelector('.cr-picker'), null);
  assert.equal(doc.activeElement, anchor);
  // The browser's default mousedown action would blur the anchor again (jsdom has none): it must be prevented.
  const down = new doc.defaultView.MouseEvent('mousedown', { bubbles: true, cancelable: true });
  doc.body.dispatchEvent(down);
  assert.equal(down.defaultPrevented, true);
  const later = new doc.defaultView.MouseEvent('mousedown', { bubbles: true, cancelable: true });
  doc.body.dispatchEvent(later);
  assert.equal(later.defaultPrevented, false, 'only the closing press is held');
});

test('a press outside on a focusable control lets that control take the focus', () => {
  const { doc, options, anchor } = setup();
  const other = doc.createElement('input');
  doc.body.append(other);
  openDimensionPicker({ doc, anchor, options, title: 'Allocate by', onPick: () => {} });
  other.dispatchEvent(new doc.defaultView.Event('pointerdown', { bubbles: true }));
  const down = new doc.defaultView.MouseEvent('mousedown', { bubbles: true, cancelable: true });
  other.dispatchEvent(down);
  assert.equal(doc.querySelector('.cr-picker'), null);
  assert.equal(down.defaultPrevented, false);
});
