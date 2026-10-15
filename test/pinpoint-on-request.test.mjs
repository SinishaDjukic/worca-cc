// test/pinpoint-on-request.test.mjs — Pinpoint's `auto` option and openAtSelection() (the browser extension's
// "Pinpoint on request": a selection shows nothing until the keyboard command, unless the user turned it back on).
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createPinpoint } from '../ui/public/pinpoint.mjs';

const RECT = { left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600, x: 0, y: 0 };
const LINE = { left: 100, right: 220, width: 120, top: 300, bottom: 320, height: 20 };

function page() {
  const dom = new JSDOM('<!doctype html><body><main><p id="p">The token bucket refills at ten requests per second.</p></main><div id="layer"></div></body>', { pretendToBeVisual: true });
  const { document: doc } = dom.window;
  // jsdom lays nothing out (same stubs as pinpoint-ui.test.mjs): every box is the viewport, every range one line.
  dom.window.Element.prototype.getBoundingClientRect = () => RECT;
  dom.window.Range.prototype.getClientRects = () => [LINE];
  dom.window.Range.prototype.getBoundingClientRect = () => LINE;
  const select = () => { const r = doc.createRange(); r.selectNodeContents(doc.getElementById('p')); const s = dom.window.getSelection(); s.removeAllRanges(); s.addRange(r); };
  return { dom, doc, select };
}
const surface = (doc) => ({ kind: 'web', unit: () => doc.body, container: () => doc.documentElement, layer: () => doc.getElementById('layer'), source: () => 'fixture.test', draft() {} });

test('auto:false — a selection + pointerup opens nothing; openAtSelection() opens the bar', () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  const { dom, doc, select } = page();
  const pp = createPinpoint({ doc, win: dom.window, auto: false });
  pp.addSurface(doc.body, surface(doc));
  select();
  doc.dispatchEvent(new dom.window.MouseEvent('pointerup', { bubbles: true }));
  mock.timers.tick(200);
  assert.equal(doc.querySelector('.pp-bar'), null);
  assert.equal(pp.openAtSelection(), true);
  assert.ok(doc.querySelector('.pp-bar'));
  pp.destroy(); mock.timers.reset();
});

test('openAtSelection() without a selection → false, nothing shown; setAuto(true) restores open-on-select', () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  const { dom, doc, select } = page();
  const pp = createPinpoint({ doc, win: dom.window, auto: false });
  pp.addSurface(doc.body, surface(doc));
  assert.equal(pp.openAtSelection(), false);
  assert.equal(doc.querySelector('.pp-bar'), null);
  pp.setAuto(true);
  select();
  doc.dispatchEvent(new dom.window.MouseEvent('pointerup', { bubbles: true }));
  mock.timers.tick(200);
  assert.ok(doc.querySelector('.pp-bar'));
  pp.destroy(); mock.timers.reset();
});

test('default auto stays on (worca\'s own pages unchanged)', () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  const { dom, doc, select } = page();
  const pp = createPinpoint({ doc, win: dom.window });
  pp.addSurface(doc.body, surface(doc));
  select();
  doc.dispatchEvent(new dom.window.MouseEvent('pointerup', { bubbles: true }));
  mock.timers.tick(200);
  assert.ok(doc.querySelector('.pp-bar'));
  pp.setAuto(false);
  pp.close();
  select();
  doc.dispatchEvent(new dom.window.MouseEvent('pointerup', { bubbles: true }));
  mock.timers.tick(200);
  assert.equal(doc.querySelector('.pp-bar'), null);
  pp.destroy(); mock.timers.reset();
});
