// Dialog (docs/design-system.md › Worca Rail › Which component; Modals › Dialog anatomy): a step that needs fields
// first. The app's one anatomy: a .viewer-modal card with .dlg and three parts, the head (title, Close), the body (the
// only scroller), the foot (a status line, then Cancel and the step naming what happens). It fades in (Motion) and
// closes at once. A yes or no is a ConfirmStrip, never a Dialog.
import { attrs, esc } from './html.mjs';
import { button } from './button.mjs';

/**
 * @param {object} o
 * @param {string} o.title
 * @param {string} o.body              markup: the framing sentence, Fields
 * @param {string} o.yes               the step's label, naming what happens ("Create PR")
 * @param {string} [o.status]          the foot's status line (a problem, what will happen)
 * @param {boolean} [o.busy]           the step is working: its label says so and it is disabled
 * @param {string} [o.busyLabel]       ("Creating…")
 * @param {string} [o.close]           the Close icon's SVG
 * @param {string} [o.id]              the title's id
 * @param {object} [o.attrs]           on the card
 */
export function dialog({ title, body, yes, status = '', busy = false, busyLabel = '', close = '', id = 'dlg-t', attrs: a = {} }) {
  const head = `<div class="dlg-head"><h2 class="dlg-title"${attrs({ id })}>${esc(title)}</h2>${close ? button({ label: 'Close', kind: 'quiet', iconOnly: true, icon: close, attrs: { 'data-dialog': 'close', 'data-key': 'dialog:close' } }) : ''}</div>`;
  const foot = `<div class="dlg-foot"><span class="dlg-status" role="status">${status}</span><span class="dlg-acts">${button({ label: 'Cancel', kind: 'quiet', attrs: { 'data-dialog': 'cancel', 'data-key': 'dialog:cancel' } })}${button({ label: busy ? busyLabel || yes : yes, kind: 'primary', attrs: { 'data-dialog': 'yes', 'data-key': 'dialog:yes', 'data-motion': 'swap', disabled: busy } })}</span></div>`;
  return `<div class="viewer-modal" role="dialog" aria-modal="true"${attrs({ 'aria-labelledby': id, 'data-motion': 'in' })}><div class="card dlg rl-dialog"${attrs(a)}>${head}<div class="dlg-body">${body}</div>${foot}</div></div>`;
}
