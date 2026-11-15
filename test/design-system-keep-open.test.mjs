// test/design-system-keep-open.test.mjs — watchKeepOpen (docs/rail/components.md `comp.keep-open`): an open menu, inline
// field or dialog marked data-keep keeps its value, caret, selection and focus across any redraw of its page; a route
// change never carries its text; a closed control is forgotten.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { watchKeepOpen, listController, listEditor, morph } from '../ui/public/design-system/components/index.mjs';

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
  f.blur(); await tick();   // a real blur is its own task, before a later redraw
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

test('a side panel opened on the same route (#place/item/…) or another way in (@…) still carries the text', async () => {
  const { doc, win, c } = page('#chat/ask_1');
  draw(c);
  type(win, doc.getElementById('f'), 'abc');
  win.location.hash = '#chat/ask_1/run/run-a/logs';
  draw(c); await tick();
  assert.equal(doc.getElementById('f').value, 'abc', 'the side panel is the same route');
  win.location.hash = '#chat/ask_1@side';
  draw(c); await tick();
  assert.equal(doc.getElementById('f').value, 'abc', 'a way in after @ is the same item');
  win.location.hash = '#chat/ask_2/run/run-a';
  draw(c); await tick();
  assert.equal(doc.getElementById('f').value, '', 'another item is another route');
});

test('F-a4-02: what the page means wins: a field the page clears in place, or draws with a new value, is not given the old text back', async () => {
  const { doc, win, c } = page();
  draw(c);
  const f = doc.getElementById('f');
  type(win, f, 'bugfix');
  f.value = '';   // the page added the label and clears the field for the next one
  draw(c); await tick();
  assert.equal(doc.getElementById('f').value, '');
  assert.equal(doc.activeElement, doc.getElementById('f'), 'the field keeps the focus for the next one');
  type(win, doc.getElementById('f'), 'abc');
  c.innerHTML = '<input id="f" data-keep="k1" value="Billing API">'; await tick();
  assert.equal(doc.getElementById('f').value, 'Billing API', 'a value the page set wins');
});

test('F-a4-02: morph gives a kept field the page\'s new value when the drawn value changed, and keeps the typed text when it did not', async () => {
  const { doc, win, c } = page();
  const html = (v) => `<div class="m"><input id="k" data-keep="k" value="${v}"></div>`;
  morph(c, html(''));
  const k = doc.getElementById('k');
  type(win, k, 'abc');
  morph(c, html('')); await tick();
  assert.equal(k.value, 'abc');
  morph(c, html('Billing API')); await tick();
  assert.equal(doc.getElementById('k').value, 'Billing API');
});

test('F-b23-01: Chrome\'s removal blur (focusout while the old field is still attached, then its removal) keeps the focus on the new field', async () => {
  const { doc, win, c } = page();
  draw(c);
  const f = doc.getElementById('f');
  type(win, f, 'abc');
  f.setSelectionRange(1, 1);
  f.dispatchEvent(new win.FocusEvent('focusout', { bubbles: true }));   // Chrome blurs the node first, while it is connected
  assert.ok(f.isConnected);
  draw(c); await tick();
  const g = doc.getElementById('f');
  assert.equal(g.value, 'abc');
  assert.deepEqual([g.selectionStart, g.selectionEnd], [1, 1]);
  assert.equal(doc.activeElement, g, 'the next keystroke lands in the field');
});

test('F-b23-01: a real blur still lets the field go: blurred, or a click elsewhere, then a later redraw does not take the focus back', async () => {
  const { doc, win, c } = page();
  draw(c);
  type(win, doc.getElementById('f'), 'abc');
  doc.getElementById('f').blur(); await tick();
  draw(c); await tick();
  assert.notEqual(doc.activeElement, doc.getElementById('f'));
  assert.equal(doc.getElementById('f').value, 'abc');
  type(win, doc.getElementById('f'), 'abcd');
  doc.getElementById('b').focus(); await tick();
  draw(c); await tick();
  assert.notEqual(doc.activeElement, doc.getElementById('f'));
});

test('F-b23-02: a list\'s popover (Add to group, #list-pop-q) closes with its text on a route change, and stays on a side panel', async () => {
  const dom = new JSDOM('<!doctype html><body><div id="r"></div></body>', { url: 'http://x/#chat/ask_1', pretendToBeVisual: true });
  const d = dom.window.document, root = d.getElementById('r'), w = dom.window;
  const ctl = listController({ root, spec: { noun: `pop-${Math.random()}`, label: 'x', can: () => [], bulk: () => [], act: () => {}, word: () => false, say: () => {}, active: () => true, open: () => {}, view: () => ({ state: 'ready', parts: [], sections: [{ id: 's', title: 'S', rows: [{ key: 'k', title: 'T' }] }] }) } });
  const open = () => { ctl.picker({ label: 'Add to group', placeholder: 'Find or create a group', anchor: '#r', sections: () => [], pick: () => {} }); const q = d.getElementById('list-pop-q'); q.value = 'abc'; q.dispatchEvent(new w.Event('input', { bubbles: true })); };
  const hop = async (h) => { w.location.hash = h; await new Promise((r) => w.setTimeout(r, 0)); ctl.paint(); };
  open();
  await hop('#chat/ask_1/run/run-a');
  assert.ok(d.getElementById('list-pop-q'), 'the chat\'s own side panel is the same route');
  await hop('#chat/ask_1');
  open();
  await hop('#workflows'); await hop('#chat/ask_1');
  assert.equal(d.getElementById('list-pop-q'), null, 'away and back: the popover is closed');
});
