// test/ui-input-mode.test.mjs — html[data-input]: only keys that move or act on focus turn the ring on (run 4, D5).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { keyInputMode, installInputMode } from '../ui/public/input-mode.mjs';

const dom = () => new JSDOM('<!doctype html><body><button id="b">Go</button><textarea id="t"></textarea><div id="ce" contenteditable="true"></div></body>');
const key = (doc, target, init) => target.dispatchEvent(new doc.defaultView.KeyboardEvent('keydown', { bubbles: true, ...init }));

test('keyInputMode: navigation keys mean keyboard; typing, modifiers and shortcuts do not', () => {
  const { window: w } = dom();
  const b = w.document.getElementById('b');
  const t = w.document.getElementById('t');
  const ev = (target, init) => ({ target, metaKey: false, ctrlKey: false, altKey: false, ...init });
  for (const k of ['Tab', 'ArrowDown', 'Enter', ' ', 'Escape', 'Home', 'F6']) assert.equal(keyInputMode(ev(b, { key: k })), 'keyboard', k);
  for (const k of ['a', 'Shift', 'Alt', 'Meta', 'Control', 'Backspace']) assert.equal(keyInputMode(ev(b, { key: k })), null, k);
  assert.equal(keyInputMode(ev(b, { key: 'Tab', metaKey: true })), null, 'a shortcut');
  assert.equal(keyInputMode(ev(b, { key: 'ArrowDown', altKey: true })), null, 'Alt+arrow');
  for (const k of ['Enter', ' ', 'ArrowLeft', 'a']) assert.equal(keyInputMode(ev(t, { key: k })), null, `typing ${JSON.stringify(k)} in a field`);
  for (const k of ['Tab', 'Escape']) assert.equal(keyInputMode(ev(t, { key: k })), 'keyboard', `${k} out of a field`);
  assert.equal(keyInputMode(ev(w.document.getElementById('ce'), { key: 'Enter' })), null, 'contenteditable is a field');
});

test('installInputMode: starts at pointer, typing keeps it, Tab flips it, a pointer press restores it', () => {
  const { window: w } = dom();
  const doc = w.document;
  installInputMode(doc);
  assert.equal(doc.documentElement.dataset.input, 'pointer');
  key(doc, doc.getElementById('t'), { key: 'Enter' });
  key(doc, doc.body, { key: 'Shift' });
  assert.equal(doc.documentElement.dataset.input, 'pointer', 'Enter in a field and Shift alone are not keyboard use');
  key(doc, doc.getElementById('b'), { key: 'Tab' });
  assert.equal(doc.documentElement.dataset.input, 'keyboard');
  doc.dispatchEvent(new w.Event('pointerdown', { bubbles: true }));
  assert.equal(doc.documentElement.dataset.input, 'pointer');
});
