// test/ui-label-picker.test.mjs — the run label chip and picker (slice 1): create, indeterminate, filter mode, one at a time.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { openLabelPicker, labelChip, closeLabelPickerFor } from '../ui/public/label-picker.mjs';

const USED = [{ label: 'spike', count: 4 }, { label: 'hotfix', count: 2 }];
function open(opts = {}) {
  const { window } = new JSDOM('<!doctype html><button id="a">Label</button>');
  const doc = window.document;
  const calls = [];
  const p = openLabelPicker({ doc, anchor: doc.getElementById('a'), used: USED, onToggle: (l, on) => { calls.push([l, on]); }, ...opts });
  const type = (text) => { const q = p.el.querySelector('.lp-search'); q.value = text; q.dispatchEvent(new window.Event('input')); };
  const rows = () => [...p.el.querySelectorAll('.lp-row')].map((r) => r.dataset.label);
  return { window, doc, p, calls, type, rows };
}

test('an unknown word offers Create "word"; a known prefix shows the existing label and no create', () => {
  const f = open();
  f.type('hotfix-2');
  assert.equal(f.p.el.querySelector('.lp-create').textContent, 'Create "hotfix-2"');
  f.type('hot');
  assert.deepEqual(f.rows(), ['hotfix']);
  assert.equal(f.p.el.querySelector('.lp-create').textContent, 'Create "hot"');
  f.type('Hotfix');
  assert.equal(f.p.el.querySelector('.lp-create'), null);
  assert.deepEqual(f.rows(), ['hotfix']);
});

test('some = indeterminate; ticking it applies to all; Enter on a new word creates and applies it', () => {
  const f = open({ states: new Map([['hotfix', 'some']]) });
  const box = f.p.el.querySelector('.lp-row[data-label="hotfix"] .lp-check');
  assert.equal(box.indeterminate, true);
  box.checked = true;
  box.dispatchEvent(new f.window.Event('change'));
  assert.deepEqual(f.calls, [['hotfix', true]]);
  assert.equal(f.p.el.querySelector('.lp-row[data-label="hotfix"] .lp-check').indeterminate, false);
  f.type('needs demo');
  f.p.el.querySelector('.lp-search').dispatchEvent(new f.window.KeyboardEvent('keydown', { key: 'Enter', cancelable: true }));
  assert.deepEqual(f.calls.at(-1), ['needs demo', true]);
  assert.ok(f.p.el.querySelector('.lp-row[data-label="needs demo"] .lp-check').checked);
});

test('Enter on a known prefix picks the existing label, not Create; Create then comes after the rows', () => {
  const f = open();
  f.type('spi');
  const list = f.p.el.querySelector('.lp-list');
  assert.equal(list.firstElementChild.dataset.label, 'spike');
  assert.equal(list.lastElementChild.textContent, 'Create "spi"');
  f.p.el.querySelector('.lp-search').dispatchEvent(new f.window.KeyboardEvent('keydown', { key: 'Enter', cancelable: true }));
  assert.deepEqual(f.calls, [['spike', true]]);
  f.type('ike');   // a contains-only match is not a prefix: Create stays first and Enter creates
  assert.equal(list.firstElementChild.textContent, 'Create "ike"');
});

test('an anchor function follows a rebuilt button: Esc refocuses it and a press on it toggles the picker', () => {
  const { window } = new JSDOM('<!doctype html><div id="row"><button class="ed">Label</button></div>');
  const doc = window.document;
  const cur = () => doc.querySelector('#row .ed');
  const old = cur();
  openLabelPicker({ doc, anchor: cur, used: USED, onToggle: () => {} });
  const fresh = doc.createElement('button');
  fresh.className = 'ed';
  old.replaceWith(fresh);
  fresh.dispatchEvent(new window.Event('pointerdown', { bubbles: true }));
  assert.equal(doc.querySelectorAll('.label-picker').length, 1, 'a press on the rebuilt anchor is not an outside press');
  doc.querySelector('.label-picker').dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal(doc.activeElement, fresh);
  openLabelPicker({ doc, anchor: cur, used: USED, onToggle: () => {} });
  const again = doc.createElement('button');
  again.className = 'ed';
  fresh.replaceWith(again);
  assert.equal(closeLabelPickerFor(doc, again), true, 'the rebuilt button closes the open picker');
  assert.equal(doc.querySelector('.label-picker'), null);
});

test('filter mode never offers create; Esc closes; the chip dot carries the word\'s hue', () => {
  const f = open({ allowCreate: false });
  f.type('release');
  assert.equal(f.p.el.querySelector('.lp-create'), null);
  assert.equal(f.p.el.querySelector('.lp-empty').textContent, 'No labels match.');
  f.p.el.dispatchEvent(new f.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal(f.doc.querySelector('.label-picker'), null);
  const c = labelChip(f.doc, 'needs demo');
  assert.equal(c.querySelector('.label-dot').className, 'label-dot hue-violet');
  assert.equal(c.textContent, 'needs demo');
});

test('one picker at a time; the opening button toggles it; a press on its icon is not an outside press', () => {
  const { window } = new JSDOM('<!doctype html><button id="a"><svg id="ic"></svg>Label</button><button id="b">Label</button>');
  const doc = window.document;
  const a = doc.getElementById('a');
  const opts = { doc, used: USED, onToggle: () => {} };
  openLabelPicker({ ...opts, anchor: a });
  openLabelPicker({ ...opts, anchor: doc.getElementById('b') });
  assert.equal(doc.querySelectorAll('.label-picker').length, 1, 'opening a second picker closes the first');
  assert.equal(closeLabelPickerFor(doc, a), false, 'a is not the open picker\'s anchor');
  openLabelPicker({ ...opts, anchor: a });
  doc.getElementById('ic').dispatchEvent(new window.Event('pointerdown', { bubbles: true }));
  assert.equal(doc.querySelectorAll('.label-picker').length, 1, 'a press on the anchor\'s icon keeps it open');
  assert.equal(closeLabelPickerFor(doc, a), true);
  assert.equal(doc.querySelector('.label-picker'), null);
});
