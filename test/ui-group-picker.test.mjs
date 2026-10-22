// test/ui-group-picker.test.mjs — ⋯ → Add to group… (runs redesign §3.3): the picker's dots, filter, pick and create
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { openGroupPicker } from '../ui/public/group-picker.mjs';

const GROUPS = [
  { id: 'feat_1', title: 'Run tags', model: { state: 'needs-you', word: 'Needs you', dot: 'amber', pulse: false, symbol: 'question', count: { text: '1/3' } } },
  { id: 'grp_2', title: 'Billing', model: { state: 'failed', word: 'Failed', dot: 'red', pulse: false, symbol: 'alert', count: { text: '0/2' } } },
  { id: 'grp_3', title: 'Docs', model: { state: 'ready', word: 'Ready', dot: 'green', pulse: false, symbol: null, count: { text: '2/2' } } },
];

test('the picker draws Needs you / Failed with the ? / ! symbol, filters by name, adds or creates', () => {
  const { window } = new JSDOM('<!doctype html><body><button id="a">more</button></body>', { pretendToBeVisual: true });
  const doc = window.document;
  const picked = [];
  const open = () => openGroupPicker({ doc, anchor: doc.getElementById('a'), groups: GROUPS,
    onPick: (g) => picked.push(g.id), onCreate: (t) => picked.push(`new:${t}`) });
  let p = open();
  assert.deepEqual([...p.el.querySelectorAll('.gp-row .status-dot')].map((d) => [d.dataset.state, !!d.querySelector('svg.status-sym'), d.getAttribute('aria-label')]),
    [['needs-you', true, 'Needs you'], ['failed', true, 'Failed'], ['ready', false, null]]);
  const q = p.el.querySelector('input.gp-search');
  q.value = 'bil';
  q.dispatchEvent(new window.Event('input'));
  assert.deepEqual([...p.el.querySelectorAll('.gp-row:not([hidden])')].map((r) => r.dataset.groupId), ['grp_2']);
  p.el.querySelector('.gp-row[data-group-id="grp_2"]').click();
  assert.equal(doc.querySelector('.group-picker'), null, 'a pick closes it');
  p = open();
  p.el.querySelector('.gp-new').click();
  const name = p.el.querySelector('input.gp-name');
  name.value = 'Q4 work';
  name.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  assert.deepEqual(picked, ['grp_2', 'new:Q4 work']);
});
