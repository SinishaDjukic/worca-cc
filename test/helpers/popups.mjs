// test/helpers/popups.mjs
// Drive the shared pop-up rules (ui/public/modal-guard.mjs) the way a person does.
//   backdropClick(win, modal)   press AND release on the overlay itself — a real outside click
//   dragOut(win, from, modal)   press inside the card, release on the overlay (a selection dragged out)
//   pressEscape(win, target?)   Escape (cancelable, like a real key press), at the document by default
//   discardPrompt(doc)          the open "Discard changes?" dialog, or null
//   keepEditing(doc) / discardChanges(doc)   answer it
export function backdropClick(win, modal) {
  modal.dispatchEvent(new win.MouseEvent('mousedown', { bubbles: true, cancelable: true }));
  modal.dispatchEvent(new win.MouseEvent('click', { bubbles: true, cancelable: true }));
}
export function dragOut(win, from, modal) {
  from.dispatchEvent(new win.MouseEvent('mousedown', { bubbles: true, cancelable: true }));
  modal.dispatchEvent(new win.MouseEvent('click', { bubbles: true, cancelable: true }));
}
export function pressEscape(win, target = win.document) {
  target.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
}
export const discardPrompt = (doc) => doc.querySelector('dialog.discard-modal[open]');
export function keepEditing(doc) { discardPrompt(doc).querySelector('.discard-keep').click(); }
export function discardChanges(doc) { discardPrompt(doc).querySelector('.discard-go').click(); }
