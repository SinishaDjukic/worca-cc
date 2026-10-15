// test/ui-tag-input.test.mjs — the run-tag chip field (#718): suggestions, commit, refusal, removal, dirty.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { checkRows } from './helpers/rows.mjs';
import { createTagInput, suggestionsFor, tagChip } from '../ui/public/tag-input.mjs';

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
