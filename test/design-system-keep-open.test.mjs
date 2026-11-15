// test/design-system-keep-open.test.mjs — watchKeepOpen (docs/rail/components.md `comp.keep-open`): an open menu, inline
// field or dialog marked data-keep keeps its value, caret, selection and focus across any redraw of its page; a route
// change never carries its text; a closed control is forgotten.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { watchKeepOpen, listEditor, morph } from '../ui/public/design-system/components/index.mjs';

const page = (hash = '#projects') => {
  const dom = new JSDOM('<!doctype html><div id="c"></div>', { url: 'http://x/' + hash, pretendToBeVisual: true });
  const doc = dom.window.document;
  watchKeepOpen(doc);
  return { dom, doc, win: dom.window, c: doc.getElementById('c') };
};
const tick = () => new Promise((r) => setTimeout(r, 0));
const draw = (c, inner = '') => { c.innerHTML = `<p>head</p><input id="f" data-keep="k1" value=""><button id="b">Go</button>${inner}`; };
const type = (win, el, text) => { el.focus(); el.value = text; el.dispatchEvent(new win.Event('input', { bubbles: true })); };

test('V3-07 / V-TW-16: a marked field carries value, caret, selection and focus when its container innerHTML is rewritten', async () => {
  const { doc, win, c } = page();
  draw(c);
  const f = doc.getElementById('f');
  type(win, f, 'abcdef');
  f.setSelectionRange(1, 3, 'backward');
  draw(c); await tick();
  const g = doc.getElementById('f');
  assert.notEqual(g, f);
  assert.equal(g.value, 'abcdef');
  assert.deepEqual([g.selectionStart, g.selectionEnd, g.selectionDirection], [1, 3, 'backward']);
  assert.equal(doc.activeElement, g);
});

test('an unfocused typed field keeps its text', async () => {
  const { doc, win, c } = page();
  draw(c);
  const f = doc.getElementById('f');
  type(win, f, 'abc');
  f.blur();
  draw(c); await tick();
  assert.equal(doc.getElementById('f').value, 'abc');
  assert.notEqual(doc.activeElement, doc.getElementById('f'));
});

test('focus moved to a button: the text is kept and the focus stays on the button', async () => {
  const { doc, win, c } = page();
  c.innerHTML = '<input id="f" data-keep="k1"><div id="r"></div>';
  type(win, doc.getElementById('f'), 'abc');
  const r = doc.getElementById('r');
  r.innerHTML = '<button id="b">Go</button>';
  doc.getElementById('b').focus();
  c.innerHTML = '<input id="f" data-keep="k1"><div id="r"><button id="b2">Go</button></div>';
  await tick();
  assert.equal(doc.getElementById('f').value, 'abc');
  assert.notEqual(doc.activeElement, doc.getElementById('f'));
});

test('a key gone after a draw is forgotten: a later field with that key starts empty', async () => {
  const { doc, win, c } = page();
  draw(c);
  type(win, doc.getElementById('f'), 'abc');
  c.innerHTML = '<p>closed</p>'; await tick();
  draw(c); await tick();
  assert.equal(doc.getElementById('f').value, '');
});

test('a hash change between typing and the redraw carries nothing', async () => {
  const { doc, win, c } = page('#projects');
  draw(c);
  type(win, doc.getElementById('f'), 'abc');
  win.location.hash = '#chat';
  draw(c); await tick();
  assert.equal(doc.getElementById('f').value, '');
  win.location.hash = '#projects';
  draw(c); await tick();
  assert.equal(doc.getElementById('f').value, '', 'forgotten, not carried back');
});

test('a node that stays (no removal) is left alone, and its selection is not reset', async () => {
  const { doc, win, c } = page();
  draw(c);
  const f = doc.getElementById('f');
  type(win, f, 'abcdef');
  f.setSelectionRange(2, 4);
  doc.querySelector('p').textContent = 'head 2';
  c.append(doc.createElement('span')); await tick();
  assert.equal(doc.getElementById('f'), f);
  assert.deepEqual([f.selectionStart, f.selectionEnd], [2, 4]);
  assert.equal(f.value, 'abcdef');
});

test('install is idempotent: two calls give one carry', async () => {
  const { doc, win, c } = page();
  watchKeepOpen(doc);
  let sets = 0;
  draw(c);
  type(win, doc.getElementById('f'), 'abc');
  draw(c);
  const g = doc.getElementById('f');
  const d = Object.getOwnPropertyDescriptor(win.HTMLInputElement.prototype, 'value');
  Object.defineProperty(g, 'value', { configurable: true, get() { return d.get.call(this); }, set(v) { sets++; d.set.call(this, v); } });
  await tick();
  assert.equal(g.value, 'abc');
  assert.equal(sets, 1);
});

test('listEditor: its input carries data-key and data-keep equal to inputId', () => {
  const html = listEditor({ label: 'Move to group', inputId: 'group-input', placeholder: 'Find or create', sections: [] });
  const doc = new JSDOM(`<!doctype html>${html}`).window.document;
  const i = doc.querySelector('input');
  assert.equal(i.getAttribute('data-key'), 'group-input');
  assert.equal(i.getAttribute('data-keep'), 'group-input');
});

test('a page that refocuses the rebuilt field itself, before the watcher runs, still gets the caret and selection back', async () => {
  const { doc, win, c } = page();
  draw(c);
  const f = doc.getElementById('f');
  type(win, f, 'abcdef');
  f.setSelectionRange(1, 2);
  draw(c);
  const g = doc.getElementById('f');
  g.value = 'abcdef'; g.focus();   // the page's own keeper: the text, its caret at the end
  await tick();
  assert.deepEqual([g.selectionStart, g.selectionEnd], [1, 2]);
  assert.equal(doc.activeElement, g);
});

test('F-a4-10: morph keeps a kept field\'s node and leaves its typed value and caret alone; an unmarked field still takes the new value', async () => {
  const { doc, win, c } = page();
  const html = (v) => `<div class="m"><input id="k" data-keep="k" value="${v}"><input id="u" value="${v}"></div>`;
  morph(c, html(''));
  const k = doc.getElementById('k'), u = doc.getElementById('u');
  type(win, k, 'abc'); k.setSelectionRange(1, 1);
  u.value = 'typed';
  morph(c, html('')); await tick();
  assert.equal(doc.getElementById('k'), k);
  assert.equal(k.value, 'abc');
  assert.deepEqual([k.selectionStart, k.selectionEnd], [1, 1]);
  assert.equal(doc.getElementById('u').value, '', 'morph still draws an unmarked field as a fresh innerHTML would');
});
