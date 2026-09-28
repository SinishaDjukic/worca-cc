// test/ui-ask-form-renderer.test.mjs — the ask form ENGINE (ask-forms design §6):
// seeded defaults, `when` visibility without a remount, collection through P1's
// collectAnswer, error slots, progress, readonly, dispose, and two independent
// mounts of the same ask (the card + the detail both hold one).
// Pure jsdom, no fetch: every host capability is injected.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { renderAskForm } from '../ui/public/ask/form-renderer.mjs';
import { h, fmtBytes, extOf } from '../ui/public/ask/dom.mjs';

const doc = new JSDOM('<!doctype html><body></body>').window.document;

const ASK = {
  id: 'questions-x:n_impl:1-r1', askId: 'questions-x_n_impl_1-r1',   // X1: two distinct ids
  kind: 'form', form: 'review', version: 1, title: 'Review', surface: 'any',
  data: { summary: 'Two directions.' },
  layout: [
    { widget: 'select', field: 'verdict', label: 'Verdict' },
    { widget: 'textarea', field: 'notes', label: 'What should change?', when: { verdict: 'changes' } },
    { widget: 'text', field: 'who', label: 'Reviewer' },
  ],
  answerSchema: {
    type: 'object', required: ['verdict', 'who'],
    properties: {
      verdict: { type: 'string', enum: ['approve', 'changes'], default: 'approve' },
      notes: { type: 'string', maxLength: 4000 },
      who: { type: 'string', minLength: 2 },
    },
  },
  files: [],
};

// Task 2 ships text + textarea only; `select` renders nothing yet, so the layout
// above exercises `when` through a value set directly on the engine.
const mount = (ask, opts = {}) => renderAskForm(ask, { doc, ...opts });

test('dom helpers: h sets class and text, fmtBytes and extOf', () => {
  const n = h(doc, 'div', 'af-x', 'hi');
  assert.equal(n.tagName, 'DIV');
  assert.equal(n.className, 'af-x');
  assert.equal(n.textContent, 'hi');
  assert.equal(fmtBytes(0), '0 B');
  assert.equal(fmtBytes(2048), '2 KB');
  assert.equal(fmtBytes(1572864), '1.5 MB');
  assert.equal(extOf('a/b/c.PNG'), 'PNG');
  assert.equal(extOf('noext'), 'FILE');
});

test('defaults seed the values; a text field renders a labelled, id-linked input', () => {
  const f = mount(ASK);
  assert.deepEqual(f.snapshot(), { verdict: 'approve' }, 'only the declared default is seeded');
  const input = f.el.querySelector('input[type="text"]');
  assert.ok(input);
  const label = f.el.querySelector(`label[for="${input.id}"]`);
  assert.ok(label, 'the label points at the control');
  assert.match(label.textContent, /Reviewer/);
  assert.ok(label.querySelector('.af-req'), 'a required field carries the marker');
  assert.equal(input.getAttribute('aria-required'), 'true');
  assert.equal(f.el.querySelectorAll('.af-help').length, 0, 'no host prose');
});

test('typing writes the value, fires onChange, and never remounts the node', () => {
  const seen = [];
  const f = mount(ASK, { onChange: (r) => seen.push(r) });
  const input = f.el.querySelector('input[type="text"]');
  input.value = 'dp';
  input.dispatchEvent(new doc.defaultView.Event('input'));
  assert.equal(f.snapshot().who, 'dp');
  assert.ok(seen.length >= 1, 'onChange ran');
  assert.equal(f.el.querySelector('input[type="text"]'), input, 'the same node is still mounted');
});

test('`when` hides and shows WITHOUT remounting, so half-typed text survives', () => {
  const f = mount(ASK);
  const ta = f.el.querySelector('textarea');
  assert.equal(ta.closest('.af-fld').hidden, true, 'hidden while verdict=approve');
  ta.value = 'half typed';
  f.setValue('verdict', 'changes');
  assert.equal(ta.closest('.af-fld').hidden, false);
  assert.equal(f.el.querySelector('textarea'), ta, 'the SAME textarea node');
  assert.equal(ta.value, 'half typed', 'the typed text survived the visibility flip');
  f.setValue('verdict', 'approve');
  assert.equal(ta.closest('.af-fld').hidden, true);
});

test('collect returns P1 values + errors; progress counts visible required fields', () => {
  const f = mount(ASK);
  assert.deepEqual(f.progress(), { done: 1, total: 2 }, 'verdict is defaulted, who is not');
  const bad = f.collect();
  assert.ok(bad.errors.some((e) => e.path === 'who' && e.code === 'required'));
  f.setValue('who', 'dp');
  assert.deepEqual(f.progress(), { done: 2, total: 2 });
  const ok = f.collect();
  assert.deepEqual(ok.errors, []);
  assert.deepEqual(ok.values, { verdict: 'approve', who: 'dp' });
  assert.ok(!('notes' in ok.values), 'a `when`-hidden field is dropped from the answer');
});

test('setErrors marks the field, announces through role=alert, and clears on the next edit', () => {
  const f = mount(ASK);
  f.setErrors([{ path: 'who', code: 'minLength', message: 'At least 2 characters.' }]);
  // `notes` precedes `who` in the layout, so a bare `.af-err` would be the WRONG slot.
  const slot = f.el.querySelector('[data-field="who"] .af-err');
  assert.equal(slot.getAttribute('role'), 'alert');
  assert.equal(slot.hidden, false);
  assert.equal(slot.textContent, 'At least 2 characters.');
  assert.ok(slot.closest('.af-fld').classList.contains('af-bad'));
  const input = f.el.querySelector('input[type="text"]');
  input.value = 'dp';
  input.dispatchEvent(new doc.defaultView.Event('input'));
  assert.equal(slot.hidden, true, 'editing the field clears its error');
  assert.ok(!slot.closest('.af-fld').classList.contains('af-bad'));
  f.setErrors([{ path: 'who', code: 'required', message: 'Required.' }]);
  f.setErrors([]);
  assert.ok([...f.el.querySelectorAll('.af-err')].every((s) => s.hidden), 'an empty list clears every slot');
});

test('readonly disables every control and refuses writes', () => {
  const f = mount(ASK, { readonly: true, values: { verdict: 'changes', notes: 'n', who: 'dp' } });
  assert.ok(f.el.classList.contains('af-readonly'));
  for (const n of f.el.querySelectorAll('input, textarea')) assert.equal(n.disabled, true);
  const input = f.el.querySelector('input[type="text"]');
  assert.equal(input.value, 'dp', 'the stored value is shown');
  f.setValue('who', 'someone else');
  assert.equal(f.snapshot().who, 'dp', 'readonly refuses the write');
});

test('two mounts of the same ask keep independent state (card + detail)', () => {
  const card = mount(ASK);
  const detail = mount(ASK);
  card.setValue('who', 'card');
  detail.setValue('who', 'detail');
  assert.equal(card.snapshot().who, 'card');
  assert.equal(detail.snapshot().who, 'detail');
  assert.notEqual(card.el.querySelector('input[type="text"]').id,
    detail.el.querySelector('input[type="text"]').id, 'ids never collide across mounts');
});

test('dispose runs owned disposers once and latches', () => {
  let ran = 0;
  const f = mount(ASK);
  f.own(() => { ran += 1; });
  f.dispose();
  f.dispose();
  assert.equal(ran, 1);
  f.setValue('who', 'late');
  assert.equal(f.snapshot().who, undefined, 'a disposed form accepts no writes');
});
