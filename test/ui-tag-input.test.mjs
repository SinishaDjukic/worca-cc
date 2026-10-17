// test/ui-tag-input.test.mjs — the run-tag chip field (#718): suggestions, commit, refusal, removal, dirty.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { checkRows } from './helpers/rows.mjs';
import { createTagInput, suggestionsFor, tagChip, createDimensionSlots, createDimensionEditor } from '../ui/public/tag-input.mjs';

const VOCAB = {
  keys: [{ key: 'client', count: 3, plain: false, valued: true }, { key: 'spike', count: 1, plain: true, valued: false }],
  values: { client: [{ value: 'acme', count: 2 }, { value: 'globex', count: 1 }] },
};

function field(opts) {
  const { window } = new JSDOM('<!doctype html><div id="h"></div>');
  const doc = window.document;
  const t = createTagInput(doc, opts);
  doc.getElementById('h').appendChild(t.el);
  const input = t.el.querySelector('.tag-input-text');
  const type = (text, key = 'Enter') => {
    input.value = text;
    input.dispatchEvent(new window.Event('input'));
    const e = new window.KeyboardEvent('keydown', { key, cancelable: true });
    input.dispatchEvent(e);
    return e;
  };
  const chips = () => [...t.el.querySelectorAll('.tag-chip')].map((c) => c.firstChild.textContent);
  return { t, doc, input, type, chips, hint: () => t.el.querySelector('.tag-input-hint').textContent };
}

test('suggestionsFor: keys before the colon, that key\'s values after it', () => checkRows([
  { name: 'key prefix', run: () => assert.deepEqual(suggestionsFor('cli', VOCAB), ['client:']) },
  { name: 'value prefix', run: () => assert.deepEqual(suggestionsFor('client:a', VOCAB), ['client:acme']) },
  { name: 'case and spaces', run: () => assert.deepEqual(suggestionsFor('Client: G', VOCAB), ['client:globex']) },
  { name: 'plain key', run: () => assert.deepEqual(suggestionsFor('sp', VOCAB), ['spike']) },
  { name: 'no vocabulary', run: () => assert.deepEqual(suggestionsFor('x', null), []) },
]));

test('Enter commits a normalised chip and never submits; Tab commits only valid text', () => {
  const f = field();
  const seen = [];
  f.t.onChange((tags) => seen.push(tags));
  const e = f.type('Client: Acme');
  assert.equal(e.defaultPrevented, true);
  assert.deepEqual(f.t.get(), ['client:acme']);
  assert.deepEqual(f.chips(), ['client:acme']);
  assert.equal(f.input.value, '');
  assert.deepEqual(seen, [['client:acme']]);
  assert.equal(f.t.dirty(), true);
  assert.equal(f.type('spike', 'Tab').defaultPrevented, true);
  assert.deepEqual(f.t.get(), ['client:acme', 'spike']);
  assert.equal(f.type('client:', 'Tab').defaultPrevented, false, 'an invalid entry never traps focus');
});

test('an invalid entry stays in the field with aria-invalid and the normaliser\'s message', () => {
  const f = field();
  f.type('client:');
  assert.equal(f.input.getAttribute('aria-invalid'), 'true');
  assert.equal(f.hint(), '"client:" needs a value after the colon');
  assert.equal(f.input.value, 'client:');
  assert.deepEqual(f.t.get(), []);
  f.input.dispatchEvent(new f.doc.defaultView.Event('input'));
  assert.equal(f.input.hasAttribute('aria-invalid'), false, 'typing clears the error');
});

test('× and Backspace on an empty input remove chips', () => {
  const f = field({ value: ['client:acme', 'spike', 'team:web'] });
  assert.equal(f.t.dirty(), false);
  f.t.el.querySelector('.tag-x[aria-label="Remove spike"]').click();
  assert.deepEqual(f.t.get(), ['client:acme', 'team:web']);
  assert.equal(f.t.dirty(), true);
  f.type('', 'Backspace');
  assert.deepEqual(f.t.get(), ['client:acme']);
});

test('set() replaces the chips and resets dirty unless told otherwise', () => {
  const f = field();
  f.type('spike');
  f.t.set(['Team: Web']);
  assert.deepEqual(f.t.get(), ['team:web']);
  assert.equal(f.t.dirty(), false);
  f.t.set(['client:acme'], { dirty: true });
  assert.equal(f.t.dirty(), true);
});

test('the 21st tag is refused', () => {
  const f = field({ value: Array.from({ length: 20 }, (_, i) => `k${i}`) });
  f.type('one-more');
  assert.equal(f.t.get().length, 20);
  assert.equal(f.hint(), 'At most 20 tags per run');
  assert.equal(f.input.value, 'one-more');
});

test('focus loads the vocabulary once and fills the datalist; tagChip is a plain chip', async () => {
  let calls = 0;
  const f = field({ suggest: async () => { calls++; return VOCAB; } });
  f.input.dispatchEvent(new f.doc.defaultView.Event('focus'));
  await new Promise((r) => setTimeout(r, 0));
  f.input.value = 'client:';
  f.input.dispatchEvent(new f.doc.defaultView.Event('input'));
  const list = f.doc.getElementById(f.input.getAttribute('list'));
  assert.deepEqual([...list.querySelectorAll('option')].map((o) => o.value), ['client:acme', 'client:globex']);
  f.input.dispatchEvent(new f.doc.defaultView.Event('focus'));
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(calls, 1);
  const c = tagChip(f.doc, 'spike');
  assert.equal(c.className, 'tag-chip');
  assert.equal(c.textContent, 'spike');
});

const DIMS = [{ key: 'cc', label: 'Cost centre', values: ['4410', '4420'], required: true }, { key: 'client', label: 'Client', values: [], required: false }];
function slots(dims, opts) {
  const { window } = new JSDOM('<!doctype html><div id="h"></div>');
  const s = createDimensionSlots(window.document, dims, opts);
  window.document.getElementById('h').appendChild(s.el);
  return { s, window, doc: window.document };
}

test('dimension slots: a select of the allowed values, a text input without values; get/set/missing', () => {
  const { s, window, doc } = slots(DIMS);
  const els = [...doc.querySelectorAll('.tag-dim-slot')];
  assert.deepEqual(els.map((e) => e.querySelector('.tag-dim-label').textContent), ['Cost centre', 'Client']);
  assert.equal(els[0].querySelector('.tag-dim-req').textContent, 'required');
  const sel = els[0].querySelector('.tag-dim-input');
  assert.equal(sel.tagName, 'SELECT');
  assert.equal(sel.getAttribute('aria-label'), 'Cost centre');
  assert.deepEqual([...sel.querySelectorAll('option')].map((o) => o.value), ['', '4410', '4420']);
  assert.equal(doc.querySelector('datalist'), null, 'a select replaces the datalist');
  assert.equal(els[1].querySelector('.tag-dim-input').tagName, 'INPUT');
  assert.deepEqual(s.missing().map((d) => d.key), ['cc']);
  assert.equal(s.dirty(), false);
  sel.value = '4410'; sel.dispatchEvent(new window.Event('change'));
  assert.deepEqual(s.get(), ['cc:4410']);
  assert.deepEqual(s.missing(), []);
  assert.equal(s.dirty(), true);
  s.set(['client:acme', 'spike']);
  assert.deepEqual(s.get(), ['client:acme']);
  assert.equal(s.dirty(), false);
  s.set(['cc:9999']);
  assert.equal(sel.value, '', 'an off-list value leaves the select blank');
});

test('dimension slots: an invalid value is flagged and not returned; set() clears the hint', () => {
  const { s, window, doc } = slots(DIMS);
  const input = doc.querySelector('.tag-dim-slot[data-key="client"] .tag-dim-input');
  input.value = 'x'.repeat(65); input.dispatchEvent(new window.Event('input'));
  assert.equal(input.getAttribute('aria-invalid'), 'true');
  assert.notEqual(doc.querySelector('.tag-dim-slot[data-key="client"] .tag-dim-hint').textContent, '');
  assert.deepEqual(s.get(), []);
  s.set([]);
  assert.equal(doc.querySelector('.tag-dim-slot[data-key="client"] .tag-dim-hint').textContent, '');
});

test('no dimensions → an empty, hidden slot row', () => {
  const { s, doc } = slots([]);
  assert.equal(s.el.hidden, true);
  assert.equal(doc.querySelectorAll('.tag-dim-slot').length, 0);
});

function editor(value = []) {
  const { window } = new JSDOM('<!doctype html><div id="h"></div>');
  const ed = createDimensionEditor(window.document, { value });
  window.document.getElementById('h').appendChild(ed.el);
  return { ed, window, doc: window.document };
}
const typeValue = (window, row, v, key = 'Enter') => {
  const vin = row.querySelector('.tag-value-input');
  vin.value = v; vin.dispatchEvent(new window.KeyboardEvent('keydown', { key, bubbles: true }));
};

test('dimension editor (Settings › Tags): a table; empty has no rows; add, key from label, values, Default, Mandatory, remove', () => {
  const { ed, window } = editor();
  assert.deepEqual([...ed.el.querySelectorAll('thead th')].map((th) => th.textContent), ['Tag', 'Values', 'Default', 'Mandatory', '']);
  assert.equal(ed.el.querySelectorAll('.tag-dim-row').length, 0);
  ed.el.querySelector('.tag-dim-add').click();
  const row = ed.el.querySelector('.tag-dim-row');
  const label = row.querySelector('.tag-dim-label-input');
  label.value = 'Cost centre'; label.dispatchEvent(new window.Event('input', { bubbles: true }));
  assert.equal(row.querySelector('.tag-dim-key').value, 'cost-centre');
  assert.equal(row.querySelector('.tag-dim-default').tagName, 'INPUT', 'no values: Default is free text');
  typeValue(window, row, '4410');
  typeValue(window, row, '4420, 4430', ',');
  assert.equal(row.querySelector('.tag-value-mirror').value, '4410\n4420\n4430');
  row.querySelector('.tag-x[aria-label="Remove 4430"]').click();
  assert.equal(row.querySelector('.tag-value-mirror').value, '4410\n4420');
  const def = row.querySelector('.tag-dim-default');
  assert.equal(def.tagName, 'SELECT');
  assert.deepEqual([...def.options].map((o) => o.value), ['', '4410', '4420']);
  def.value = '4420'; def.dispatchEvent(new window.Event('change', { bubbles: true }));
  typeValue(window, row, '4440');
  assert.equal(row.querySelector('.tag-dim-default').value, '4420', 'Default keeps its value while it is still listed');
  row.querySelector('.tag-x[aria-label="Remove 4420"]').click();
  assert.equal(row.querySelector('.tag-dim-default').value, '', 'a removed value leaves Default blank');
  row.querySelector('.tag-dim-required').checked = true;
  const key = row.querySelector('.tag-dim-key');
  key.value = 'cc'; key.dispatchEvent(new window.Event('input', { bubbles: true }));
  label.value = 'Cost center'; label.dispatchEvent(new window.Event('input', { bubbles: true }));
  assert.equal(key.value, 'cc', 'an edited key no longer follows the label');
  assert.deepEqual(ed.get(), [{ key: 'cc', label: 'Cost center', values: ['4410', '4440'], required: true }]);
  row.querySelector('.tag-dim-remove').click();
  assert.deepEqual(ed.get(), []);
});

test('dimension editor: set() paints rows with their Default; setLocked disables everything and hides add/remove', () => {
  const { ed } = editor([{ key: 'cc', label: 'Cost centre', values: ['4410', '4420'], required: true, default: '4420' }]);
  const row = ed.el.querySelector('.tag-dim-row');
  assert.equal(row.querySelector('.tag-dim-key').value, 'cc');
  assert.equal(row.querySelector('.tag-dim-default').value, '4420');
  assert.deepEqual(ed.get(), [{ key: 'cc', label: 'Cost centre', values: ['4410', '4420'], required: true, default: '4420' }]);
  ed.setLocked(true);
  assert.ok([...ed.el.querySelectorAll('.tag-dim-row input, .tag-dim-row select')].every((i) => i.disabled));
  assert.ok([...ed.el.querySelectorAll('.tag-x')].every((b) => b.disabled));
  assert.ok([...ed.el.querySelectorAll('.tag-dim-remove')].every((b) => b.hidden));
  assert.equal(ed.el.querySelector('.tag-dim-add').hidden, true);
});
