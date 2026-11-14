// ui/public/design/engine-gate-dialog.mjs — Design P8 Task 2 (L8.1, L8.3, L8.25): the one consent dialog the Library's
// start box opens when POST /api/design answers 409 `engine-gated` or `engine-refused`, before the design exists. It is
// the short form of the run gate's consent: a person, never a model, presses Allow unguarded. The title names the
// engine, the server's reasons and notes are plain lines, and the buttons go safe to committing: Cancel, Use Claude,
// Allow unguarded. Built as the Export dialog is (`.viewer-modal > .card`, layoutDialog, a 'decision' guard: Escape
// and a backdrop click are its Cancel). Every string reaches the page as text.

import { layoutDialog } from '../dialog-layout.mjs';
import { guardModal } from '../modal-guard.mjs';

let seq = 0;   // ids for the dialog titles on one page

/**
 * Open the dialog on `doc.body`. Title `Build on <label>?` when `overridable`, else `<label> cannot build designs`.
 * `Use Claude` shows only when `onClaude` is a function (the caller leaves it out when the refused engine is Claude
 * itself), `Allow unguarded` only when `overridable`. A button press closes the dialog, then calls its handler; Escape
 * and a backdrop click call `onCancel`. Cancel has the focus, so a stray Enter never consents. `close()` takes the
 * dialog away without calling any handler (the Library leaving), and does nothing the second time.
 * @param {{doc: Document, label: string, overridable: boolean, reasons?: string[], notes?: string[],
 *   onAllow?: () => void, onClaude?: () => void, onCancel?: () => void}} opts
 * @returns {{close: () => void}}
 */
export function openEngineGateDialog({ doc, label, overridable, reasons = [], notes = [], onAllow, onClaude, onCancel }) {
  const make = (tag, cls, text) => {
    const n = doc.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };
  const lines = (list) => (Array.isArray(list) ? list.filter((t) => typeof t === 'string' && t) : []);
  const name = String(label);

  const card = make('div', 'card dz-gate-card');
  const h = make('h2', null, overridable ? `Build on ${name}?` : `${name} cannot build designs`);
  h.id = `dz-gate-title-${++seq}`;
  card.append(h);
  for (const text of [...lines(reasons), ...lines(notes)]) card.append(make('p', 'confirm-message', text));
  const actions = make('div', 'confirm-actions');
  card.append(actions);
  layoutDialog(card, { head: [h], foot: [actions] });
  const modal = make('div', 'viewer-modal confirm-modal dz-gate-modal');
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-labelledby', h.id);
  modal.append(card);

  const opener = doc.activeElement;
  let open = true;
  let guard = null;
  function close() {
    if (!open) return;
    open = false;
    guard.release();
    modal.remove();
    if (opener && opener !== doc.body && opener.isConnected) opener.focus?.();
  }
  const choose = (handler) => () => {
    if (!open) return;
    close();
    if (typeof handler === 'function') handler();
  };
  const button = (cls, text, onClick) => {
    const b = make('button', cls, text);
    b.type = 'button';
    b.addEventListener('click', onClick);
    return b;
  };
  const cancel = button('btn', 'Cancel', choose(onCancel));
  actions.append(cancel);
  if (typeof onClaude === 'function') actions.append(button(overridable ? 'btn' : 'btn btn-primary', 'Use Claude', choose(onClaude)));
  if (overridable) actions.append(button('btn btn-primary', 'Allow unguarded', choose(onAllow)));

  guard = guardModal(modal, { kind: 'decision', close: choose(onCancel) });
  doc.body.append(modal);
  guard.opened();
  cancel.focus();
  return { close };
}
