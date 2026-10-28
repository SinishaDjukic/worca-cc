// test/ui-modal-guard.test.mjs
// The one pop-up rule (ui/public/modal-guard.mjs) without booting app.js: a form never closes on a
// backdrop click, an outside click needs press AND release on the overlay, only the top pop-up takes
// Escape, a changed form asks "Discard changes?", busy blocks every way out, Cancel never asks.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { guardModal, dialogOpen, DISCARD_MESSAGE } from '../ui/public/modal-guard.mjs';
import { backdropClick, dragOut, pressEscape, discardPrompt, keepEditing, discardChanges } from './helpers/popups.mjs';
import { checkRows } from './helpers/rows.mjs';

const tick = () => new Promise((r) => setTimeout(r, 0));
const type = (win, input, v) => { input.value = v; input.dispatchEvent(new win.Event('input', { bubbles: true })); };
const isOpen = (m) => !m.classList.contains('hidden');

// One overlay (<div class="viewer-modal"> > .card > input + button) under the rules; `add` makes more.
function page(opts = {}) {
  const { window } = new JSDOM('<!doctype html><body></body>', { url: 'http://localhost/' });
  const doc = window.document;
  const add = (id) => {
    const m = doc.createElement('div');
    m.id = id;
    m.className = 'viewer-modal';
    m.innerHTML = '<div class="card"><input class="f" type="text"><button type="button" class="b">Go</button></div>';
    doc.body.append(m);
    return m;
  };
  const modal = add('m1');
  let closes = 0;
  const g = guardModal(modal, { close: () => { closes += 1; modal.classList.add('hidden'); }, ...opts }).opened();
  return { window, doc, modal, g, add, field: modal.querySelector('.f'), closes: () => closes };
}

test('a form never closes on a backdrop click; a decision or viewer closes only when press AND release land on the overlay', async () => {
  await checkRows([
    { name: 'form, untouched and typed: a backdrop click changes nothing and asks nothing', run: () => {
      const { window, doc, modal, field } = page({ kind: 'form' });
      backdropClick(window, modal);
      assert.ok(isOpen(modal));
      type(window, field, 'kept');
      backdropClick(window, modal);
      assert.ok(isOpen(modal));
      assert.equal(field.value, 'kept');
      assert.equal(discardPrompt(doc), null);
    } },
    ...['decision', 'viewer'].map((kind) => ({ name: `${kind}: press + release on the overlay closes it`, run: () => {
      const { window, modal } = page({ kind });
      backdropClick(window, modal);
      assert.equal(isOpen(modal), false);
    } })),
    { name: 'decision: a click inside the card, a selection dragged out, a release with no press — none closes it', run: () => {
      const { window, modal, field } = page({ kind: 'decision' });
      modal.querySelector('.b').click();
      dragOut(window, field, modal);
      modal.dispatchEvent(new window.Event('click', { bubbles: true }));
      assert.ok(isOpen(modal));
    } },
  ]);
});

test('Escape: an untouched form closes; a changed one asks — Keep editing keeps it and the text, Discard closes it', async () => {
  await checkRows([
    { name: 'untouched closes at once', run: () => {
      const { window, doc, modal } = page();
      pressEscape(window);
      assert.equal(isOpen(modal), false);
      assert.equal(discardPrompt(doc), null);
    } },
    { name: 'changed: the question opens over it; Keep editing keeps the dialog, the text and the focus', run: async () => {
      const { window, doc, modal, field } = page();
      field.focus();
      type(window, field, 'draft');
      pressEscape(window, field);
      const q = discardPrompt(doc);
      assert.ok(q, 'asks first');
      assert.equal(q.querySelector('h2').textContent, 'Discard changes?');
      assert.equal(q.querySelector('.confirm-message').textContent, DISCARD_MESSAGE);
      assert.equal(doc.activeElement, q.querySelector('.discard-keep'), 'Keep editing is the default');
      keepEditing(doc);
      await tick();
      assert.equal(discardPrompt(doc), null);
      assert.ok(isOpen(modal));
      assert.equal(field.value, 'draft');
      assert.equal(doc.activeElement, field, 'focus goes back to the field');
    } },
    { name: 'changed: Discard closes it', run: async () => {
      const { window, doc, modal, field, closes } = page();
      type(window, field, 'draft');
      pressEscape(window);
      discardChanges(doc);
      await tick();
      assert.equal(isOpen(modal), false);
      assert.equal(closes(), 1);
    } },
    { name: 'Escape or a backdrop click on the question itself means Keep editing', run: async () => {
      const { window, doc, modal, field } = page();
      type(window, field, 'draft');
      pressEscape(window);
      pressEscape(window);
      await tick();
      assert.equal(discardPrompt(doc), null);
      assert.ok(isOpen(modal));
      pressEscape(window);
      backdropClick(window, discardPrompt(doc));
      await tick();
      assert.equal(discardPrompt(doc), null);
      assert.ok(isOpen(modal));
    } },
    { name: 'typed then reverted, a value filled by code, and markClean() are not changes', run: () => {
      const a = page();
      type(a.window, a.field, 'x'); type(a.window, a.field, '');
      pressEscape(a.window);
      assert.equal(isOpen(a.modal), false, 'reverted');
      const b = page();
      b.field.value = 'loaded later';                     // no user event: code filled it
      pressEscape(b.window);
      assert.equal(isOpen(b.modal), false, 'filled by code');
      const c = page();
      type(c.window, c.field, 'saved');
      c.g.markClean();
      pressEscape(c.window);
      assert.equal(isOpen(c.modal), false, 'markClean');
    } },
    ...[
      ['a backdrop click', (p) => backdropClick(p.window, p.modal)],
      ['a click on the card', (p) => p.modal.querySelector('.card').click()],
      ['a click on a select that picks nothing', (p) => p.select.click()],
    ].map(([what, act]) => ({ name: `${what} is not a touch: what code filled in after opened() asks nothing`, run: () => {
      const p = page();
      p.modal.querySelector('.card').insertAdjacentHTML('beforeend', '<select><option>a</option><option>b</option></select>');
      p.select = p.modal.querySelector('select');
      p.field.value = 'loaded later';                      // code filled both after opened(): a fetch landed
      act(p);
      pressEscape(p.window);
      assert.equal(discardPrompt(p.doc), null);
      assert.equal(isOpen(p.modal), false);
    } })),
    { name: 'a pick on a select, and a button that adds a field, are changes', run: () => {
      const a = page();
      a.modal.querySelector('.card').insertAdjacentHTML('beforeend', '<select><option>a</option><option>b</option></select>');
      a.g.markClean();                                     // the select is part of the starting state
      const sel = a.modal.querySelector('select');
      sel.value = 'b';
      sel.dispatchEvent(new a.window.Event('change', { bubbles: true }));
      pressEscape(a.window);
      assert.ok(discardPrompt(a.doc), 'a pick asks');
      const b = page();
      b.modal.querySelector('.b').addEventListener('click', () => b.modal.querySelector('.card').append(b.doc.createElement('input')));
      b.modal.querySelector('.b').click();                 // e.g. "Add a row": no input event, the structure changed
      pressEscape(b.window);
      assert.ok(discardPrompt(b.doc), 'a row added by a button asks');
    } },
    { name: 'a pressed toggle (aria-pressed) is a change', run: () => {
      const { window, doc, modal, g } = page();
      const t = doc.createElement('button');
      t.type = 'button';
      t.setAttribute('aria-pressed', 'false');
      modal.querySelector('.card').append(t);
      g.markClean();                                       // the toggle is part of the starting state
      modal.querySelector('.b').click();                  // the user presses a button inside: touched
      pressEscape(window);
      assert.equal(isOpen(modal), false, 'touched but nothing differs: closes');
      modal.classList.remove('hidden');
      g.opened();
      t.click();                                           // the user presses the toggle …
      t.setAttribute('aria-pressed', 'true');              // … and its handler flips it
      pressEscape(window);
      assert.ok(discardPrompt(doc), 'a pressed toggle asks');
    } },
  ]);
});

test('only the pop-up on top answers; a pop-up hidden by code drops off; re-opening puts it back on top', () => {
  const { window, doc, modal, add } = page({ kind: 'decision' });
  const second = add('m2');
  const g2 = guardModal(second, { kind: 'decision', close: () => second.classList.add('hidden') }).opened();
  pressEscape(window);
  assert.equal(isOpen(second), false, 'the top one closes');
  assert.ok(isOpen(modal), 'the one under it stays');
  second.classList.remove('hidden');
  g2.opened();
  second.classList.add('hidden');                          // hidden by code (a view change)
  backdropClick(window, modal);
  assert.equal(isOpen(modal), false, 'the lower one answers once the top one is gone');
  assert.equal(dialogOpen(doc), false);
});

test('busy blocks Escape, the backdrop and cancel(); cancel() closes a changed form without asking', async () => {
  let busy = true;
  const d = page({ kind: 'decision', busy: () => busy });
  pressEscape(d.window); backdropClick(d.window, d.modal); d.g.cancel();
  assert.ok(isOpen(d.modal), 'nothing closes while the request is out');
  busy = false;
  d.g.cancel();
  assert.equal(isOpen(d.modal), false);

  const f = page();                                        // default busy(): a withButton() inside is busy
  f.modal.querySelector('.b').dataset.fbState = 'busy';
  pressEscape(f.window);
  assert.ok(isOpen(f.modal));
  delete f.modal.querySelector('.b').dataset.fbState;
  type(f.window, f.field, 'draft');
  f.g.cancel();
  assert.equal(isOpen(f.modal), false, 'Cancel never asks');
  assert.equal(discardPrompt(f.doc), null);
});

test('release(), dialogOpen(), and an Escape a field already used (or an IME composition) is left alone', () => {
  const a = page({ kind: 'decision' });
  assert.equal(dialogOpen(a.doc), true);
  a.g.release();
  pressEscape(a.window);
  assert.ok(isOpen(a.modal), 'released: off the rules');

  const b = page({ kind: 'decision' });
  b.field.addEventListener('keydown', (e) => e.preventDefault());   // e.g. an autocomplete closing itself
  pressEscape(b.window, b.field);
  assert.ok(isOpen(b.modal), 'the field used that Escape');
  b.doc.dispatchEvent(new b.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true, isComposing: true }));
  assert.ok(isOpen(b.modal), 'an IME composition owns Escape');
  pressEscape(b.window);
  assert.equal(isOpen(b.modal), false, 'a plain Escape still closes it');
});

test('a native <dialog> form: its close request runs the same rules and a changed one is never closed silently', () => {
  const { window } = new JSDOM('<!doctype html><body></body>', { url: 'http://localhost/' });
  const doc = window.document;
  const dlg = doc.createElement('dialog');
  dlg.innerHTML = '<input class="f">';
  doc.body.append(dlg);
  dlg.setAttribute('open', '');
  guardModal(dlg, { kind: 'form', close: () => dlg.removeAttribute('open') }).opened();
  assert.equal(dialogOpen(doc), true);
  const f = dlg.querySelector('.f');
  type(window, f, 'name');
  const ev = new window.Event('cancel', { cancelable: true });
  dlg.dispatchEvent(ev);
  assert.equal(ev.defaultPrevented, true, 'the browser never closes it on its own');
  assert.ok(dlg.hasAttribute('open'));
  assert.ok(discardPrompt(doc), 'it asks');
});

test('Discard changes?: Keep editing is a plain small button, Discard the danger one', () => {
  const { window, doc, field } = page();
  field.focus();
  type(window, field, 'draft');
  pressEscape(window, field);
  const q = discardPrompt(doc);
  assert.equal(q.querySelector('.discard-keep').className, 'btn discard-keep');
  assert.equal(q.querySelector('.discard-go').className, 'btn btn-danger discard-go');
  assert.ok(doc.querySelector('dialog.discard-modal .card.dlg > .dlg-foot .discard-go'), 'the shared dialog anatomy');
});
