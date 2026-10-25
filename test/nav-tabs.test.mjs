// test/nav-tabs.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { wireTabs } from '../ui/public/nav/tabs.mjs';

function strip() {
  const { window } = new JSDOM(`<!doctype html><body><div class="tabs" role="tablist">
    <button role="tab" data-sec="overview" aria-selected="true">Summary</button>
    <button role="tab" data-sec="diff" aria-selected="false">Diff</button>
    <button role="tab" data-sec="agents" aria-selected="false" hidden>Agents</button>
    <button role="tab" data-sec="qa" aria-selected="false">Q&amp;A</button></div></body>`);
  return { window, list: window.document.querySelector('[role="tablist"]') };
}
const key = (w, list, k) => list.querySelector('[aria-selected="true"]').dispatchEvent(new w.KeyboardEvent('keydown', { key: k, bubbles: true }));
const tick = () => new Promise((r) => setTimeout(r, 0));   // MutationObserver

test('roving tabindex follows aria-selected; label set once', async () => {
  const { list } = strip();
  wireTabs(list, { label: 'Run sections', onSelect() {} });
  assert.equal(list.getAttribute('aria-label'), 'Run sections');
  assert.deepEqual([...list.children].map((t) => t.tabIndex), [0, -1, -1, -1]);
  list.children[1].setAttribute('aria-selected', 'true');
  list.children[0].setAttribute('aria-selected', 'false');
  await tick();
  assert.deepEqual([...list.children].map((t) => t.tabIndex), [-1, 0, -1, -1]);
});

test('arrows skip hidden tabs and wrap; Home and End; click selects', () => {
  const { window, list } = strip();
  const picked = [];
  wireTabs(list, { onSelect: (k) => picked.push(k), keyOf: (t) => t.dataset.sec });
  key(window, list, 'ArrowLeft');                         // from Summary wraps to the last shown tab
  key(window, list, 'End');
  key(window, list, 'Home');
  list.children[1].click();
  list.children[2].click();                               // hidden: ignored
  assert.deepEqual(picked, ['qa', 'qa', 'overview', 'diff']);
  assert.equal(window.document.activeElement, list.children[0]);   // Home moved focus; a jsdom click does not
});

test('isShown decides what the keys skip (a level-hidden tab without [hidden])', () => {
  const { window, list } = strip();
  list.children[2].hidden = false;
  list.children[2].dataset.minLevel = 'expert';
  const picked = [];
  wireTabs(list, { onSelect: (k) => picked.push(k), keyOf: (t) => t.dataset.sec, isShown: (t) => !t.hidden && t.dataset.minLevel !== 'expert' });
  key(window, list, 'ArrowLeft');
  assert.deepEqual(picked, ['qa']);
});

test('Home and End skip a level-hidden first or last tab', () => {
  const { window, list } = strip();
  list.children[2].hidden = false;                       // Agents: shown by markup, last but one
  list.children[3].dataset.minLevel = 'expert';          // Q&A: the last tab, hidden by the level only
  const isShown = (t) => !t.hidden && t.dataset.minLevel !== 'expert';
  const picked = [];
  wireTabs(list, { onSelect: (k) => picked.push(k), keyOf: (t) => t.dataset.sec, isShown });
  key(window, list, 'End');                              // from Summary: the last SHOWN tab is Agents
  assert.deepEqual(picked, ['agents']);
  list.children[0].setAttribute('aria-selected', 'false');
  list.children[2].setAttribute('aria-selected', 'true');
  list.children[0].dataset.minLevel = 'expert';          // now the first tab is level-hidden too
  key(window, list, 'Home');                             // from Agents: the first SHOWN tab is Diff
  assert.deepEqual(picked, ['agents', 'diff']);
});

test('the selected tab is scrolled into view when the selection moves', async () => {
  const { window, list } = strip();
  const seen = [];
  window.HTMLElement.prototype.scrollIntoView = function (o) { seen.push([this.dataset.sec, o && o.inline]); };
  wireTabs(list, { onSelect() {} });
  list.children[3].setAttribute('aria-selected', 'true');
  list.children[0].setAttribute('aria-selected', 'false');
  await tick();
  assert.deepEqual(seen.at(-1), ['qa', 'nearest']);
});

test('a strip that grows after the selection (a live badge) keeps the selected tab in view, sideways only', async () => {
  const { window, list } = strip();
  const rect = (left, right) => ({ left, right, top: 0, bottom: 32, width: right - left, height: 32 });
  list.getBoundingClientRect = () => rect(16, 359);
  const qa = list.children[3];
  let right = 340;
  qa.getBoundingClientRect = () => rect(right - 54, right - list.scrollLeft);
  let calls = 0;
  window.HTMLElement.prototype.scrollIntoView = function () { calls += 1; };
  list.children[0].setAttribute('aria-selected', 'false');
  qa.setAttribute('aria-selected', 'true');
  wireTabs(list, { onSelect() {} });
  await tick();
  const scrolled = calls;
  right = 387;                                          // a badge widened a tab before it: Q&A slid past the edge
  list.children[1].append(window.document.createElement('span'));
  await tick();
  assert.equal(list.scrollLeft, 28, 'scrolled sideways by the overflow');
  assert.equal(calls, scrolled, 'no scrollIntoView for the same selection (it would scroll the page too)');
});

test('wiring twice returns the same controller; destroy stops the observer', async () => {
  const { list } = strip();
  const a = wireTabs(list, { onSelect() {} });
  assert.equal(wireTabs(list, { onSelect() {} }), a);
  a.destroy();
  list.children[1].setAttribute('aria-selected', 'true');
  list.children[0].setAttribute('aria-selected', 'false');
  await tick();
  assert.equal(list.children[1].tabIndex, -1);          // no sync after destroy
});
