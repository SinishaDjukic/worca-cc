// test/ui-runs-resize.test.mjs — QA 2: the Runs list's resize handle (ui/public/runs-resize.mjs).
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { useDomRelease } from './helpers/jsdom-release.mjs';
import { LIST_W_KEY, MIN_W, MAX_W, DEFAULT_W, KEY_STEP, clampListWidth, defaultListWidth, mountRunsResize } from '../ui/public/runs-resize.mjs';

const trackDom = useDomRelease(afterEach);
const memStorage = (seed = {}) => { const m = new Map(Object.entries(seed)); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), m }; };
function setup({ innerWidth = 1440, shellWidth = 1200, seed } = {}) {
  const dom = trackDom(new JSDOM('<!doctype html><body><div class="runs-shell" data-layout="split"><div class="runs-list-pane"></div><div class="runs-pane"></div></div></body>'));
  const win = dom.window;
  Object.defineProperty(win, 'innerWidth', { configurable: true, value: innerWidth });
  const shell = win.document.querySelector('.runs-shell');
  Object.defineProperty(shell, 'clientWidth', { configurable: true, value: shellWidth });
  const storage = memStorage(seed);
  const api = mountRunsResize(shell, { storage, win });
  return { win, shell, storage, api, handle: shell.querySelector('.runs-resize') };
}
const key = (win, el, k) => el.dispatchEvent(new win.KeyboardEvent('keydown', { key: k, bubbles: true }));

test('bounds: 280 px to the smaller of 50% of the window and 640 px', () => {
  assert.deepEqual([MIN_W, MAX_W, KEY_STEP], [280, 640, 16]);
  assert.equal(clampListWidth(100, 1440), 280);
  assert.equal(clampListWidth(900, 1440), 640);
  assert.equal(clampListWidth(900, 1000), 500);
  assert.equal(clampListWidth(400, 500), 280, 'the minimum wins on a tiny window');
  assert.equal(DEFAULT_W, 340);
  assert.equal(defaultListWidth(1200), 340);
  assert.equal(defaultListWidth(2000), 340);
  assert.equal(defaultListWidth(600), 300, 'half a narrow shell');
  assert.equal(defaultListWidth(500), 280, 'never under the minimum');
  assert.equal(defaultListWidth(0), 280);
});

test('the handle is a focusable vertical separator with its value', () => {
  const { handle } = setup();
  assert.equal(handle.getAttribute('role'), 'separator');
  assert.equal(handle.getAttribute('aria-orientation'), 'vertical');
  assert.equal(handle.tabIndex, 0);
  assert.equal(handle.getAttribute('aria-label'), 'Resize the runs list');
  assert.equal(handle.getAttribute('aria-valuemin'), '280');
  assert.equal(handle.getAttribute('aria-valuemax'), '640');
  assert.equal(handle.getAttribute('aria-valuenow'), '340', 'the default: 340 px');
});

test('←/→ step 16 px within the bounds and persist; Home resets', () => {
  const { win, shell, handle, storage } = setup();
  key(win, handle, 'ArrowRight');
  assert.equal(handle.getAttribute('aria-valuenow'), '356');
  assert.equal(shell.style.getPropertyValue('--runs-list-w'), '356px');
  assert.equal(storage.getItem(LIST_W_KEY), '356');
  for (let i = 0; i < 40; i++) key(win, handle, 'ArrowRight');
  assert.equal(handle.getAttribute('aria-valuenow'), '640');
  for (let i = 0; i < 40; i++) key(win, handle, 'ArrowLeft');
  assert.equal(handle.getAttribute('aria-valuenow'), '280');
  key(win, handle, 'Home');
  assert.equal(shell.style.getPropertyValue('--runs-list-w'), '');
  assert.equal(storage.getItem(LIST_W_KEY), null);
  assert.equal(handle.getAttribute('aria-valuenow'), '340');
});

const ptr = (win, el, type, clientX) => el.dispatchEvent(new win.PointerEvent(type, { clientX, button: 0, bubbles: true }));

test('drag resizes live, persists on release; double-click resets', () => {
  const { win, shell, handle, storage } = setup();
  ptr(win, handle, 'pointerdown', 340);
  ptr(win, win.document, 'pointermove', 420);
  assert.equal(shell.style.getPropertyValue('--runs-list-w'), '420px');
  assert.ok(shell.classList.contains('is-resizing'));
  assert.equal(storage.getItem(LIST_W_KEY), null, 'not saved mid-drag');
  ptr(win, win.document, 'pointerup', 420);
  assert.equal(storage.getItem(LIST_W_KEY), '420');
  assert.ok(!shell.classList.contains('is-resizing'));
  handle.dispatchEvent(new win.MouseEvent('dblclick', { bubbles: true }));
  assert.equal(shell.style.getPropertyValue('--runs-list-w'), '');
  assert.equal(storage.getItem(LIST_W_KEY), null);
});

test('a cancelled pointer ends the drag: no listener left behind', () => {
  const { win, shell, handle, storage } = setup();
  ptr(win, handle, 'pointerdown', 340);
  ptr(win, win.document, 'pointermove', 352);
  ptr(win, win.document, 'pointercancel', 0);
  assert.ok(!shell.classList.contains('is-resizing'));
  assert.equal(storage.getItem(LIST_W_KEY), '352', 'keeps the width the drag reached');
  ptr(win, win.document, 'pointermove', 600);
  assert.equal(shell.style.getPropertyValue('--runs-list-w'), '352px', 'a later move does nothing');
});

test('with no stored width, keys start from the list\'s rendered width, not a width measured while hidden', () => {
  const { win, shell, handle } = setup({ shellWidth: 0 });      // mounted while the Runs view was hidden
  const pane = shell.querySelector('.runs-list-pane');
  pane.getBoundingClientRect = () => ({ width: 300, height: 600, top: 0, left: 0, right: 300, bottom: 600 });
  handle.dispatchEvent(new win.FocusEvent('focus'));
  assert.equal(handle.getAttribute('aria-valuenow'), '300', 'focus repaints the value');
  key(win, handle, 'ArrowRight');
  assert.equal(handle.getAttribute('aria-valuenow'), '316');
});

test('the stored width comes back clamped to the window, and re-clamps on resize', () => {
  const { win, shell, handle } = setup({ innerWidth: 1000, seed: { [LIST_W_KEY]: '600' } });
  assert.equal(shell.style.getPropertyValue('--runs-list-w'), '500px');
  assert.equal(handle.getAttribute('aria-valuemax'), '500');
  Object.defineProperty(win, 'innerWidth', { configurable: true, value: 1440 });
  win.dispatchEvent(new win.Event('resize'));
  assert.equal(shell.style.getPropertyValue('--runs-list-w'), '600px', 'the chosen width, once the window allows it');
});

test('a storage that throws never breaks the handle', () => {
  const dom = trackDom(new JSDOM('<!doctype html><body><div class="runs-shell"><div class="runs-list-pane"></div></div></body>'));
  const storage = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); }, removeItem() { throw new Error('denied'); } };
  const shell = dom.window.document.querySelector('.runs-shell');
  const api = mountRunsResize(shell, { storage, win: dom.window });
  key(dom.window, shell.querySelector('.runs-resize'), 'ArrowRight');
  assert.equal(api.width(), 296);
});

test('bundle QA 2: the CSS default is 340px inside 280px..min(50%, 640px)', () => {
  const css = readFileSync(new URL('../ui/public/style.css', import.meta.url), 'utf8');
  assert.match(css, /\.runs-shell\{[^}]*grid-template-columns:var\(--runs-list-w,clamp\(280px,340px,min\(50%,640px\)\)\) minmax\(0,1fr\);/);
});

test('bundle QA 2: a stored width wins over the 340px default, even a narrower one', () => {
  const { shell, handle } = setup({ seed: { [LIST_W_KEY]: '300' } });
  assert.equal(shell.style.getPropertyValue('--runs-list-w'), '300px');
  assert.equal(handle.getAttribute('aria-valuenow'), '300');
});
