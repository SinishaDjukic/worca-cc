import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { openPicker, openPickerOf } from '../ui/public/models/open-picker.mjs';

const doms = [];
afterEach(() => { for (const d of doms.splice(0)) d.window.close(); });
const flush = () => new Promise((r) => setTimeout(r, 0));
function rig() {
  const dom = new JSDOM('<!doctype html><body><button id="a" type="button">A</button><button id="b" type="button">B</button><input id="out"></body>');
  doms.push(dom);
  const win = dom.window; const doc = win.document; const places = [];
  const open = (anchor = doc.getElementById('a'), o = {}) => {
    const root = doc.createElement('div'); root.className = 'menu';
    const item = doc.createElement('button'); item.type = 'button'; item.textContent = 'x'; root.append(item);
    return { h: openPicker({ doc, win, anchor, root, place: () => places.push(anchor.id), ...o }), root, item };
  };
  const key = (t, k) => { const e = new win.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }); t.dispatchEvent(e); return e; };
  return { win, doc, a: doc.getElementById('a'), b: doc.getElementById('b'), out: doc.getElementById('out'), places, open, key };
}

test('one open picker per document: on <body>, the anchor expanded; the same anchor again only closes it; another anchor moves it', () => {
  const r = rig();
  const first = r.open();
  assert.deepEqual([first.root.parentNode, r.a.getAttribute('aria-expanded'), r.places, openPickerOf(r.doc).anchor], [r.doc.body, 'true', ['a'], r.a]);
  const again = r.open();
  assert.deepEqual([again.h, first.root.isConnected, r.a.getAttribute('aria-expanded'), openPickerOf(r.doc)], [null, false, 'false', null]);
  r.open(); const other = r.open(r.b);
  assert.deepEqual([r.doc.querySelectorAll('.menu').length, r.a.getAttribute('aria-expanded'), r.b.getAttribute('aria-expanded')], [1, 'false', 'true']);
  openPickerOf(r.doc).close();
  assert.equal(other.root.isConnected, false);
});
test('Escape is taken on the window before the document: it closes, focuses the anchor, and a capture listener the page added first never hears it', () => {
  const r = rig();
  let heard = 0;
  r.doc.addEventListener('keydown', (e) => { if (e.key === 'Escape') heard += 1; }, true);   // app.js's run-page arms, added at load
  const { root, item } = r.open();
  item.focus();
  const e = r.key(item, 'Escape');
  assert.deepEqual([root.isConnected, r.doc.activeElement === r.a, e.defaultPrevented, heard], [false, true, true, 0]);
  r.key(r.doc.body, 'Escape');
  assert.equal(heard, 1, 'closed: Escape is the page\'s again');
});
test('pick(report) removes it and focuses the anchor before it reports', () => {
  const r = rig(); const { h, root } = r.open(); let at = null;
  h.pick(() => { at = { open: root.isConnected, focus: r.doc.activeElement === r.a }; });
  assert.deepEqual(at, { open: false, focus: true });
});
test('a press outside or focus leaving closes it without moving the focus; a press inside or on the anchor keeps it', () => {
  const r = rig(); const PE = r.win.PointerEvent || r.win.MouseEvent;
  const { root, item } = r.open();
  item.dispatchEvent(new PE('pointerdown', { bubbles: true }));
  r.a.dispatchEvent(new PE('pointerdown', { bubbles: true }));
  assert.equal(root.isConnected, true);
  r.out.dispatchEvent(new PE('pointerdown', { bubbles: true }));
  assert.equal(root.isConnected, false);
  const second = r.open(); r.out.focus();
  assert.deepEqual([second.root.isConnected, r.doc.activeElement === r.out, r.a.getAttribute('aria-expanded')], [false, true, 'false']);
});
test('placed again on a page scroll and a resize, never on a scroll inside it', () => {
  const r = rig(); const { root } = r.open();
  r.doc.dispatchEvent(new r.win.Event('scroll'));
  root.dispatchEvent(new r.win.Event('scroll'));
  r.win.dispatchEvent(new r.win.Event('resize'));
  assert.deepEqual(r.places, ['a', 'a', 'a']);
});
test('its anchor leaving the document closes it; the focus inside goes to refocus(), focus elsewhere stays', async () => {
  const r = rig(); const next = r.doc.createElement('button');
  const { root, item } = r.open(r.a, { refocus: () => next });
  item.focus();
  r.a.replaceWith(next);
  await flush();
  assert.deepEqual([root.isConnected, openPickerOf(r.doc), r.doc.activeElement === next], [false, null, true]);
  const r2 = rig(); const two = r2.open(r2.a, { refocus: () => r2.b });
  r2.a.focus(); r2.a.remove();
  await flush();
  assert.deepEqual([two.root.isConnected, r2.doc.activeElement === r2.b], [false, false]);
});
test('pick(report) on a picker already closed reports nothing', () => {
  const r = rig();
  const { h } = r.open();
  h.close();
  let reported = 0;
  h.pick(() => { reported += 1; });
  assert.equal(reported, 0);
});
