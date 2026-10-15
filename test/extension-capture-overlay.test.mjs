// test/extension-capture-overlay.test.mjs — the area capture overlay's mount and its refusals. jsdom cannot make
// trusted events, so the drag itself is covered by e2e/extension/capture.spec.mjs; here: only trusted input counts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { startCapture } from '../extension/src/content/capture-overlay.mjs';

function rig() {
  const dom = new JSDOM('<!doctype html><html><body><p id="para">x</p></body></html>', { pretendToBeVisual: true });
  const calls = { done: [], cancel: 0 };
  const cancel = startCapture({ doc: dom.window.document, win: dom.window, css: '.wx-cap{}', open: true, onDone: (r) => calls.done.push(r), onCancel: () => { calls.cancel += 1; } });
  return { dom, doc: dom.window.document, calls, cancel };
}

test('mounts one host on <html> with the dimmed layer and the hint', () => {
  const { doc } = rig();
  const host = doc.querySelector('[data-worca-capture]');
  assert.ok(host);
  assert.equal(host.parentElement, doc.documentElement);
  assert.equal(host.style.getPropertyPriority('z-index'), 'important');
  assert.ok(host.shadowRoot.querySelector('.wx-cap'));
  assert.ok(host.shadowRoot.querySelector('.wx-cap-box').hidden);
  assert.match(host.shadowRoot.querySelector('.wx-cap-hint').textContent, /Esc to cancel/);
});

test('untrusted (page-script) events neither cancel nor start a capture', () => {
  const { dom, doc, calls } = rig();
  dom.window.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  const layer = doc.querySelector('[data-worca-capture]').shadowRoot.querySelector('.wx-cap');
  layer.dispatchEvent(new dom.window.MouseEvent('pointerdown', { bubbles: true, clientX: 1, clientY: 1 }));
  layer.dispatchEvent(new dom.window.MouseEvent('pointerup', { bubbles: true, clientX: 90, clientY: 90 }));
  assert.ok(doc.querySelector('[data-worca-capture]'));
  assert.deepEqual([calls.done.length, calls.cancel], [0, 0]);
});

test('cancel() removes the overlay once and reports it once', () => {
  const { doc, calls, cancel } = rig();
  cancel();
  cancel();
  assert.equal(doc.querySelector('[data-worca-capture]'), null);
  assert.equal(calls.cancel, 1);
});
