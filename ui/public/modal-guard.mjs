// ui/public/modal-guard.mjs
// One rule for how every pop-up closes, so a stray click never throws away what someone typed.
//
//   kind 'form'     holds input or unsaved state (Add project, Ship it, a prompt, the schedule sheet).
//                   A backdrop click never closes it, changed or not. Escape closes it while untouched
//                   and asks "Discard changes?" (Keep editing / Discard) once it changed. Its Cancel
//                   (`cancel()`) closes at once and never asks: a deliberate choice.
//   kind 'decision' buttons only, nothing typed (Stop?, Remove?, a confirm, the sync chooser). A
//                   backdrop click or Escape is the safe "No": its `close`.
//   kind 'viewer'   read-only (artifact viewer, workflow preview, Claude setup status). A backdrop click
//                   or Escape closes it. 'decision' and 'viewer' behave alike; the kind records why.
//
// An outside click counts only when the press AND the release land on the backdrop itself: a text
// selection dragged out of a field (or a drag that pans a graph) ends with a `click` on the overlay,
// and that is not one. Only the pop-up on top answers — the one shown last that is still on screen —
// so Escape over a confirm, the folder browser or the "Discard changes?" question never reaches the
// dialog underneath. While `busy()` (a short submit is out: the Stop dialog's rule) Escape, a backdrop
// click and `cancel()` all do nothing; the dialog shows the answer, then closes or offers a retry.
//
// Every listener sits on the document, installed once per document — guarding a static dialog again on
// each open stacks nothing — and the state is per document: like feedback.mjs, this module stays cached
// while the app.js jsdom suites boot a fresh document per test.
import { controlSnapshot } from './feedback.mjs';
import { layoutDialog } from './dialog-layout.mjs';

export const DISCARD_MESSAGE = 'Your changes in this dialog will be lost.';

const routers = new WeakMap();   // Document -> { stack: entries (oldest first), down: the last press target }

function isShown(m) {
  if (!m.isConnected || m.hidden || m.classList.contains('hidden')) return false;
  return m.tagName !== 'DIALOG' || m.hasAttribute('open');
}

// What "changed" compares: every control's value, plus each toggle button's aria-pressed (time
// presets, weekdays, the export format) — those hold choices too.
function snapshot(m) {
  const pressed = [...m.querySelectorAll('button[aria-pressed]')].map((b) => b.getAttribute('aria-pressed'));
  return controlSnapshot(m) + JSON.stringify(pressed);
}

function topOf(r) {
  r.stack = r.stack.filter((x) => isShown(x.modal));   // hidden or removed by code: off the stack
  return r.stack.length ? r.stack[r.stack.length - 1] : null;
}

async function dismiss(entry, how) {
  const o = entry.opts;
  if (!o || o.busy()) return;
  if (o.kind === 'form') {
    if (how === 'outside') return;                             // never on a backdrop click
    if (o.isDirty()) {
      if (!(await askDiscard(entry.modal.ownerDocument, o.discardMessage))) return;   // Keep editing
      if (!isShown(entry.modal) || o.busy()) return;          // closed, or submitting, meanwhile
    }
  }
  o.close();
}

function routerFor(doc) {
  let r = routers.get(doc);
  if (r) return r;
  r = { stack: [], down: null };
  routers.set(doc, r);
  // Only a dialog the user touched can be dirty: values code fills in after it opened (a list that
  // loads, selects filled from a fetch) are never "changes". A touch is typing or picking (`input`,
  // `change`) or pressing one of its buttons (a toggle, "add a row", "Generate"), whose effect no
  // input event reports. A click on the backdrop, on the card's text or on a select that picks
  // nothing is not one.
  const touch = (target) => { for (const x of r.stack) if (x.modal.contains(target)) x.touched = true; };
  const edited = (e) => touch(e.target);
  doc.addEventListener('input', edited, true);
  doc.addEventListener('change', edited, true);
  doc.addEventListener('mousedown', (e) => { r.down = e.target; }, true);
  doc.addEventListener('click', (e) => {
    const button = e.target.closest?.('button');
    if (button) touch(button);
    const down = r.down;
    r.down = null;
    const top = topOf(r);
    if (top && e.target === top.modal && down === top.modal) void dismiss(top, 'outside');
  }, true);
  // Bubble phase: a field or widget that used Escape itself (preventDefault) keeps it, and the page's
  // capture-phase Escape arms have already stood down (dialogOpen) by the time this runs.
  doc.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || e.defaultPrevented || e.isComposing) return;
    const top = topOf(r);
    if (!top) return;
    e.preventDefault();                                        // a native <dialog> does not close itself too
    void dismiss(top, 'escape');
  });
  // A native <dialog>'s other close requests (a back gesture): same rules, never the browser's own close.
  doc.addEventListener('cancel', (e) => {
    const entry = r.stack.find((x) => x.modal === e.target);
    if (!entry) return;
    e.preventDefault();
    if (entry === topOf(r)) void dismiss(entry, 'escape');
  }, true);
  return r;
}

/**
 * Put `modal` (the overlay element itself, or a native <dialog>) under the rules; returns its handle.
 *   opened(more)  call every time it is shown, AFTER the open filled it in: it goes on top, and its
 *                 "unchanged" baseline is taken now. `more` overrides `base` for this open only.
 *   cancel()      its own Cancel / Close / Hide: closes at once, never asks — unless busy()
 *   markClean()   the current state becomes the baseline (after a save, or a fresh load of its content)
 *   changed()     touched since opened()/markClean() AND a control or a pressed toggle differs
 *   touched       read-only: the user typed, picked or pressed a button in it since opened()/markClean()
 *   release()     off the stack while still on screen (an unbind)
 * Options: kind ('form' | 'decision' | 'viewer', default 'form'); close() — hides or tears it down
 * (required); isDirty() — default changed(); busy() — default "a withButton() inside is busy";
 * discardMessage — the question's sentence.
 */
export function guardModal(modal, base = {}) {
  const r = routerFor(modal.ownerDocument);
  const entry = {
    modal, opts: null, touched: false, baseline: '',
    opened(more = {}) {
      entry.opts = {
        kind: 'form',
        close: () => {},
        isDirty: () => entry.changed(),
        busy: () => !!modal.querySelector('[data-fb-state="busy"]'),
        discardMessage: DISCARD_MESSAGE,
        ...base,
        ...more,
      };
      entry.markClean();
      r.stack = r.stack.filter((x) => x.modal !== modal);
      r.stack.push(entry);
      return entry;
    },
    cancel() { if (entry.opts && !entry.opts.busy()) entry.opts.close(); },
    markClean() { entry.touched = false; entry.baseline = snapshot(modal); },
    changed() { return entry.touched && snapshot(modal) !== entry.baseline; },
    release() { r.stack = r.stack.filter((x) => x !== entry); },
  };
  return entry;
}

/** "Discard changes?" — Keep editing (focused; also Escape or a backdrop click) or Discard. Resolves
 *  true to discard. A native <dialog> shown with showModal(), so it sits in the top layer above every
 *  pop-up, the composer's own <dialog> included; jsdom has no showModal and gets the `open` attribute. */
export function askDiscard(doc, message = DISCARD_MESSAGE) {
  return new Promise((resolve) => {
    const make = (tag, cls, text) => {
      const n = doc.createElement(tag);
      if (cls) n.className = cls;
      if (text) n.textContent = text;
      return n;
    };
    const dlg = make('dialog', 'viewer-modal confirm-modal discard-modal');
    dlg.setAttribute('role', 'alertdialog');
    dlg.setAttribute('aria-modal', 'true');
    dlg.setAttribute('aria-labelledby', 'discard-title');
    dlg.setAttribute('aria-describedby', 'discard-message');
    const title = make('h2', 'danger', 'Discard changes?');
    title.id = 'discard-title';
    const head = make('div', 'card-head');
    head.append(title);
    const msg = make('p', 'confirm-message', message);
    msg.id = 'discard-message';
    const keep = make('button', 'btn discard-keep', 'Keep editing');
    keep.type = 'button';
    const go = make('button', 'btn btn-danger discard-go', 'Discard');
    go.type = 'button';
    const actions = make('div', 'confirm-actions');
    actions.append(keep, go);
    const card = make('div', 'card');
    card.append(head, msg, actions);
    layoutDialog(card, { head: [head], foot: [actions] });
    dlg.append(card);
    const back = doc.activeElement;
    let settled = false;
    const finish = (discard) => {
      if (settled) return;
      settled = true;
      try { dlg.close?.(); } catch { /* not open */ }
      dlg.remove();
      if (!discard && back && back.isConnected && typeof back.focus === 'function') back.focus();
      resolve(discard);
    };
    keep.addEventListener('click', () => finish(false));
    go.addEventListener('click', () => finish(true));
    doc.body.append(dlg);
    if (typeof dlg.showModal === 'function') {
      try { dlg.showModal(); } catch { dlg.setAttribute('open', ''); }
    } else dlg.setAttribute('open', '');
    guardModal(dlg, { kind: 'decision', close: () => finish(false) }).opened();
    keep.focus();
  });
}

/** A pop-up is on screen (an open .viewer-modal or <dialog>): the page's own Escape arms stand down. */
export function dialogOpen(doc = globalThis.document) {
  return !!doc.querySelector('.viewer-modal:not(.hidden), dialog[open]');
}
