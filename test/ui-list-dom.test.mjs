// test/ui-list-dom.test.mjs — the shared roving Tab stop and selection bar paint (issue #948 slice 2, ui/public/list-dom.mjs).
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { useDomRelease } from './helpers/jsdom-release.mjs';
import { createListRove, paintBulkBar, navKey, landOn, paintLanded, collapsedSectionOf, LANDED_MS } from '../ui/public/list-dom.mjs';

const trackDom = useDomRelease(afterEach);
function list(html) {
  const dom = trackDom(new JSDOM(`<!doctype html><body><div id="l">${html}</div></body>`));
  return dom.window.document.getElementById('l');
}
const ROWS = '<div class="runs-item" data-row-key="a"><a class="runs-row" href="#a" data-row-key="a">A</a><button class="runs-more"></button></div>'
  + '<button class="runs-sec-head" data-section-key="older" aria-expanded="false">Older</button>'
  + '<div class="runs-item" data-row-key="b"><a class="runs-row selected" href="#b" data-row-key="b">B</a></div>'
  + '<div hidden><a class="runs-row" href="#c" data-row-key="c">C</a></div>';

test('rove: one Tab stop, hidden stops included at -1, inner controls at -1; falls back to the open row', () => {
  const host = list(ROWS);
  const state = { focusKey: null };
  const r = createListRove({ host, state });
  const want = r.rove();
  assert.equal(want.dataset.rowKey, 'b', 'the open row when nothing was focused');
  assert.deepEqual([...host.querySelectorAll('a.runs-row, button.runs-sec-head')].map((n) => n.tabIndex), [-1, -1, 0, -1]);
  assert.equal(host.querySelector('.runs-more').tabIndex, -1);
  state.focusKey = 'sec:older';
  assert.equal(r.rove().dataset.sectionKey, 'older');
});

test('focusin records the key; move clamps and skips hidden stops; around names next then previous', () => {
  const host = list(ROWS);
  const state = { focusKey: null };
  const r = createListRove({ host, state });
  const [a, head, b] = r.items();
  assert.equal(r.items().length, 3, 'the hidden row is not a stop');
  a.focus();
  assert.equal(state.focusKey, 'row:a');
  r.move(a, 1);
  assert.equal(host.ownerDocument.activeElement, head);
  r.move(b, 1);
  assert.equal(host.ownerDocument.activeElement, b, 'clamped at the end');
  assert.deepEqual(r.around(head), ['row:b', 'row:a']);
  assert.deepEqual(r.around(head, { self: true }), ['sec:older', 'row:b', 'row:a']);
  assert.equal(r.find(['row:gone', 'row:b']), b);
  assert.equal(navKey(a), 'row:a');
});

test('paintBulkBar: label, counts, disabled at 0, title set and removed, optional word', () => {
  const host = list('<div class="runs-bulk"><span class="runs-bulk-n"></span>'
    + '<button data-bulk="archive"><span class="runs-bulk-w">Archive</span> <span class="runs-bulk-c">0</span></button>'
    + '<button data-bulk="label">Label</button></div>');
  const bar = host.querySelector('.runs-bulk');
  paintBulkBar(bar, { label: '2 selected', actions: { archive: { count: 1, title: 'Skipped 1 busy chat: X.', word: 'Archive' } } });
  const b = bar.querySelector('[data-bulk="archive"]');
  assert.equal(bar.querySelector('.runs-bulk-n').textContent, '2 selected');
  assert.equal(b.querySelector('.runs-bulk-c').textContent, '1');
  assert.equal(b.disabled, false);
  assert.equal(b.title, 'Skipped 1 busy chat: X.');
  paintBulkBar(bar, { label: '1 selected', actions: { archive: { count: 0, title: '', word: 'Restore' } } });
  assert.equal(b.disabled, true);
  assert.equal(b.hasAttribute('title'), false);
  assert.equal(b.querySelector('.runs-bulk-w').textContent, 'Restore');
  assert.equal(bar.querySelector('[data-bulk="label"]').disabled, false, 'buttons not named are left alone');
});

test('landOn (Add to group): the moved row takes the Tab stop, the focus and .is-landed, kept across a repaint until its time is up', () => {
  const host = list(ROWS);
  const state = { focusKey: null };
  const rove = createListRove({ host, state });
  const timers = [];
  const win = { setTimeout: (fn, ms) => timers.push([fn, ms]) };
  const a = host.querySelector('a.runs-row[data-row-key="a"]');
  assert.equal(landOn({ host, rove, state, node: a, win, now: 1000 }), a);
  assert.equal(host.ownerDocument.activeElement, a);
  assert.equal(state.focusKey, 'row:a');
  assert.equal(a.tabIndex, 0);
  assert.ok(a.classList.contains('is-landed'));
  assert.deepEqual(timers.map((t) => t[1]), [LANDED_MS]);
  host.innerHTML = ROWS;   // a repaint rebuilds the rows
  paintLanded(host, state, 1500);
  assert.ok(host.querySelector('a.runs-row[data-row-key="a"]').classList.contains('is-landed'), 'the rebuilt row keeps the fill');
  assert.equal(host.querySelectorAll('.is-landed').length, 1);
  paintLanded(host, state, 1000 + LANDED_MS);
  assert.equal(host.querySelectorAll('.is-landed').length, 0, 'gone once the time is up');
  assert.equal(state.landed, null);
});

test('landOn with no moved row focuses the fallback (the opener); collapsedSectionOf names a folded section only', () => {
  const host = list(`${ROWS}<button id="opener">⋯</button>`);
  const state = { focusKey: null };
  const rove = createListRove({ host, state });
  const opener = host.querySelector('#opener');
  assert.equal(landOn({ host, rove, state, node: null, fallback: () => opener, win: { setTimeout() {} } }), null);
  assert.equal(host.ownerDocument.activeElement, opener);
  assert.equal(host.querySelectorAll('.is-landed').length, 0);
  assert.equal(collapsedSectionOf({ sections: [{ id: 'project:k', collapsed: true, rows: [{ key: 'chain:g1' }] }] }, 'chain:g1'), 'project:k');
  assert.equal(collapsedSectionOf({ sections: [{ id: 'project:k', collapsed: false, rows: [{ key: 'chain:g1' }] }] }, 'chain:g1'), null);
  assert.equal(collapsedSectionOf(null, 'chain:g1'), null);
});
