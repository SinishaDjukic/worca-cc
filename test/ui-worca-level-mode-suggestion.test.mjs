// test/ui-worca-level-mode-suggestion.test.mjs — the interface-mode suggestion banner (R-po-15): it is shown only when the
// suggested mode is above the current one, and the mode changes ONLY inside onAccept (I-10): dismiss never touches data-level.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { useDomRelease } from './helpers/jsdom-release.mjs';
import { paintModeSuggestion, BANNER_ID } from '../ui/public/worca-level/mode-suggestion.mjs';

const trackDom = useDomRelease(afterEach);

function page(level = 'simple') {
  const dom = new JSDOM('<!doctype html><html data-level="' + level + '"><body><main class="main"><div id="mode-suggest-host"></div></main></body></html>');
  trackDom(dom.window);
  return dom.window.document;
}
const viewOf = (levelName, modeSuggestion) => ({ level: { index: 3, name: levelName }, modeSuggestion });

function paint(doc, view, over = {}) {
  const calls = [];
  paintModeSuggestion(doc, view, {
    currentMode: doc.documentElement.dataset.level,
    onAccept: (mode) => calls.push(['accept', mode]),
    onDismiss: (mode) => calls.push(['dismiss', mode]),
    ...over,
  });
  return calls;
}

test('Hooked shows the Advanced suggestion; dismiss hides it and does not change data-level', () => {
  const doc = page('simple');
  const calls = paint(doc, viewOf('Hooked', 'advanced'));
  const banner = doc.getElementById(BANNER_ID);
  assert.ok(banner);
  assert.equal(banner.getAttribute('role'), 'status');
  assert.match(banner.textContent, /You're Hooked\. Advanced mode shows Marketplace, Workspaces and Schedules in the sidebar\./);
  const x = banner.querySelector('button[aria-label="Dismiss"]');
  assert.equal(x.querySelector('path').getAttribute('d'), 'M6 6l12 12M18 6L6 18');
  x.click();
  assert.deepEqual(calls, [['dismiss', 'advanced']]);
  assert.equal(doc.getElementById(BANNER_ID), null, 'dismiss hides the banner');
  assert.equal(doc.documentElement.dataset.level, 'simple', 'and never changes the mode');
});

test('accept calls onAccept with the mode; the banner itself does not switch the mode', () => {
  const doc = page('simple');
  const calls = paint(doc, viewOf('Hooked', 'advanced'));
  const accept = [...doc.querySelectorAll('#mode-suggest-banner button')].find((b) => b.textContent === 'Try Advanced mode');
  assert.ok(accept);
  accept.click();
  assert.deepEqual(calls, [['accept', 'advanced']]);
  assert.equal(doc.documentElement.dataset.level, 'simple', 'only onAccept (the level controller) changes it');
  assert.equal(doc.getElementById(BANNER_ID), null);
});

test('WorcaHolic suggests Expert', () => {
  const doc = page('advanced');
  const calls = paint(doc, viewOf('WorcaHolic', 'expert'));
  const banner = doc.getElementById(BANNER_ID);
  assert.match(banner.textContent, /You're WorcaHolic\. Expert mode/);
  [...banner.querySelectorAll('button')].find((b) => b.textContent === 'Try Expert mode').click();
  assert.deepEqual(calls, [['accept', 'expert']]);
});

test('already in the suggested mode (or above), or no suggestion: nothing (R-po-15)', () => {
  for (const [mode, suggestion] of [['expert', 'expert'], ['expert', 'advanced'], ['advanced', 'advanced'], ['simple', null]]) {
    const doc = page(mode);
    paint(doc, viewOf('Hooked', suggestion));
    assert.equal(doc.getElementById(BANNER_ID), null, `${mode} / ${suggestion}`);
  }
});

test('a repaint replaces the banner, and one that is no longer due removes it', () => {
  const doc = page('simple');
  paint(doc, viewOf('Hooked', 'advanced'));
  paint(doc, viewOf('Hooked', 'advanced'));
  assert.equal(doc.querySelectorAll('#' + BANNER_ID).length, 1);
  paint(doc, viewOf('Hooked', null));
  assert.equal(doc.getElementById(BANNER_ID), null);
});

test('a malformed view shows nothing and does not throw', () => {
  const doc = page('simple');
  for (const view of [null, undefined, {}, { modeSuggestion: 'council' }, { level: null, modeSuggestion: 'advanced' }]) {
    paint(doc, view);
    assert.equal(doc.getElementById(BANNER_ID), null);
  }
});
