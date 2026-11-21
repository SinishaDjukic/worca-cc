// test/feature-pull-modal.test.mjs — the document modal adapter (feature-pull/modal.mjs): the wrapper the run-setup
// overlay's CSS expects, a form guard (backdrop never closes), Escape unless busy, a focus trap, focus restored to the
// trigger, and onClose exactly once per close path. jsdom only.

import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { useDomRelease } from './helpers/jsdom-release.mjs';
import { createDocumentModal } from '../ui/public/feature-pull/modal.mjs';

const trackDom = useDomRelease(afterEach);

function rig() {
  const dom = trackDom(new JSDOM('<!doctype html><html><body><button id="t">Pull</button></body></html>', { url: 'http://localhost/' }));
  const { document, KeyboardEvent, MouseEvent } = dom.window;
  const modal = createDocumentModal({ document });
  const card = document.createElement('div');
  card.className = 'card req-dialog';
  const cancel = document.createElement('button');
  cancel.textContent = 'Cancel';
  const start = document.createElement('button');
  start.textContent = 'Start';
  card.append(cancel, start);
  const trigger = document.getElementById('t');
  trigger.focus();
  let closed = 0;
  let busy = false;
  const openIt = () => modal.open(card, { trigger, first: cancel, canClose: () => !busy, onClose: () => { closed++; } });
  const wrap = () => document.querySelector('.viewer-modal.req-dlg-wrap');
  const escape = () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  const tab = (shiftKey = false) => {
    const ev = new KeyboardEvent('keydown', { key: 'Tab', shiftKey, bubbles: true, cancelable: true });
    document.activeElement.dispatchEvent(ev);
    return ev;
  };
  const backdropClick = () => {
    const w = wrap();
    w.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    w.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  };
  return { document, modal, card, cancel, start, trigger, openIt, wrap, escape, tab, backdropClick, setBusy: (v) => { busy = v; }, closed: () => closed };
}

const settle = () => new Promise((r) => setImmediate(r));

test('open puts the card in a .viewer-modal.req-dlg-wrap and focuses `first`', () => {
  const r = rig();
  r.openIt();
  assert.ok(r.wrap(), 'wrapper present');
  assert.equal(r.wrap().parentNode, r.document.body);
  assert.equal(r.card.parentNode, r.wrap());
  assert.equal(r.document.activeElement, r.cancel);
});

test('a backdrop click never closes it', async () => {
  const r = rig();
  r.openIt();
  r.backdropClick();
  await settle();
  assert.ok(r.wrap());
  assert.equal(r.closed(), 0);
});

test('Escape closes it, restores focus to the trigger, and fires onClose once', async () => {
  const r = rig();
  r.openIt();
  r.escape();
  await settle();
  assert.equal(r.wrap(), null);
  assert.equal(r.document.activeElement, r.trigger);
  assert.equal(r.closed(), 1);
});

test('Escape does nothing while busy, and closes once the submit is done', async () => {
  const r = rig();
  r.openIt();
  r.setBusy(true);
  r.escape();
  await settle();
  assert.ok(r.wrap());
  assert.equal(r.closed(), 0);
  r.setBusy(false);
  r.escape();
  await settle();
  assert.equal(r.wrap(), null);
  assert.equal(r.closed(), 1);
});

test('programmatic close fires onClose once, and a second close is a no-op', () => {
  const r = rig();
  r.openIt();
  r.modal.close(true);
  r.modal.close(true);
  assert.equal(r.wrap(), null);
  assert.equal(r.closed(), 1);
  assert.equal(r.document.activeElement, r.trigger);
});

test('close(false) leaves focus alone but still fires onClose', () => {
  const r = rig();
  r.openIt();
  r.modal.close(false);
  assert.equal(r.wrap(), null);
  assert.notEqual(r.document.activeElement, r.trigger);
  assert.equal(r.closed(), 1);
});

test('a cancel that calls close(true) from inside the card fires onClose once', () => {
  const r = rig();
  r.openIt();
  r.cancel.addEventListener('click', () => r.modal.close(true));
  r.cancel.click();
  assert.equal(r.closed(), 1);
  assert.equal(r.wrap(), null);
});

test('Tab wraps from the last control to the first, Shift+Tab the other way', () => {
  const r = rig();
  r.openIt();
  r.start.focus();
  assert.equal(r.tab().defaultPrevented, true);
  assert.equal(r.document.activeElement, r.cancel);
  assert.equal(r.tab(true).defaultPrevented, true);
  assert.equal(r.document.activeElement, r.start);
});

test('reopening closes the earlier one first (onClose of the old fires once)', () => {
  const r = rig();
  r.openIt();
  r.openIt();
  assert.equal(r.document.querySelectorAll('.viewer-modal.req-dlg-wrap').length, 1);
  assert.equal(r.closed(), 1);
});
