// test/ui-group-picker.test.mjs — Add to group… (shared picker): order, keyboard, Create row, Recent, focus back
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { openGroupPicker } from '../ui/public/group-picker.mjs';

const GROUPS = [
  { id: 'feat_1', title: 'Run tags', model: { state: 'needs-you', word: 'Needs you', dot: 'amber', pulse: false, symbol: 'question', count: { text: '1/3' } } },
  { id: 'grp_2', title: 'Billing', model: { state: 'failed', word: 'Failed', dot: 'red', pulse: false, symbol: 'alert', count: { text: '0/2' } } },
  { id: 'grp_3', title: 'Docs', model: { state: 'ready', word: 'Ready', dot: 'green', pulse: false, symbol: null, count: { text: '2/2' } } },
];

const setup = (opts = {}) => {
  const { window } = new JSDOM('<!doctype html><body><button id="a">more</button></body>', { pretendToBeVisual: true });
  window.Element.prototype.scrollIntoView = function () {};
  const doc = window.document;
  const anchor = doc.getElementById('a');
  const seen = [];
  const p = openGroupPicker({ doc, anchor, groups: GROUPS, recent: opts.recent || [],
    onPick: (g) => seen.push(`pick:${g.id}`), onCreate: (t) => seen.push(`create:${t}`), onNew: () => seen.push('new') });
  const q = p.el.querySelector('input.gp-search');
  const key = (k) => q.dispatchEvent(new window.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
  const type = (v) => { q.value = v; q.dispatchEvent(new window.Event('input', { bubbles: true })); };
  const active = () => p.el.querySelector('.gp-row.is-active');
  return { window, doc, anchor, p, q, key, type, active, seen };
};

test('the picker draws Needs you / Failed with the ? / ! symbol, filters by name and picks on click', () => {
  const { p, doc, type, seen } = setup();
  assert.deepEqual([...p.el.querySelectorAll('.gp-row .status-dot')].map((d) => [d.dataset.state, !!d.querySelector('svg.status-sym'), d.getAttribute('aria-label')]),
    [['needs-you', true, 'Needs you'], ['failed', true, 'Failed'], ['ready', false, null]]);
  type('bil');
  assert.deepEqual([...p.el.querySelectorAll('.gp-row[data-group-id]:not([hidden])')].map((r) => r.dataset.groupId), ['grp_2']);
  p.el.querySelector('.gp-row[data-group-id="grp_2"]').click();
  assert.equal(doc.querySelector('.group-picker'), null, 'a pick closes it');
  assert.deepEqual(seen, ['pick:grp_2']);
});

test('New group… leads; nothing is highlighted on open, so Enter does nothing; ↓ / ↑ move and wrap', () => {
  const { p, q, key, active, seen } = setup();
  const opts = [...p.el.querySelectorAll('[role="option"]:not([hidden])')];
  assert.ok(opts[0].classList.contains('gp-new'));
  assert.equal(q.getAttribute('role'), 'combobox');
  assert.equal(active(), null);
  key('Enter');
  assert.deepEqual(seen, [], 'a stray Enter adds nothing');
  key('ArrowDown');
  assert.ok(active().classList.contains('gp-new'));
  assert.equal(q.getAttribute('aria-activedescendant'), active().id);
  key('ArrowUp');
  assert.equal(active().dataset.groupId, 'grp_3', 'wraps to the last group');
  key('Enter');
  assert.deepEqual(seen, ['pick:grp_3']);
});

test('typing highlights the first match and offers Create; an exact name in any case offers no Create', () => {
  const { p, type, active, key, seen } = setup();
  type('bil');
  assert.equal(active().dataset.groupId, 'grp_2');
  assert.equal(p.el.querySelector('.gp-new').hidden, true);
  assert.equal(p.el.querySelector('.gp-create').textContent, 'Create “bil”');
  assert.match(p.el.querySelector('.gp-foot').textContent, /add to Billing/);
  type('release notes');
  assert.ok(active().classList.contains('gp-create'), 'no match: the Create row is highlighted');
  type('  BILLING ');
  assert.equal(p.el.querySelector('.gp-create').hidden, true);
  type('release  notes ');
  key('Enter');
  assert.deepEqual(seen, ['create:release notes'], 'trimmed, one space');
  assert.equal(p.el.isConnected, false);
});

test('Recent leads with the last used groups; All groups holds the rest, once', () => {
  const { p } = setup({ recent: ['grp_3', 'gone', 'feat_1'] });
  const heads = [...p.el.querySelectorAll('.gp-head')].map((h) => h.textContent);
  assert.deepEqual(heads, ['Recent', 'All groups']);
  const [rec, all] = [...p.el.querySelectorAll('.gp-sec')].map((s) => [...s.querySelectorAll('[data-group-id]')].map((r) => r.dataset.groupId));
  assert.deepEqual(rec, ['grp_3', 'feat_1']);
  assert.deepEqual(all, ['grp_2']);
});

test('Esc closes and hands the focus back to the opener (a function re-queries a rebuilt one); New group… calls onNew', () => {
  const { doc, anchor, key, p } = setup();
  key('Escape');
  assert.equal(p.el.isConnected, false);
  assert.equal(doc.activeElement, anchor);
  const s = setup();
  s.p.el.querySelector('.gp-new').click();
  assert.deepEqual(s.seen, ['new']);
});
