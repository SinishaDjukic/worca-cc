// Dialog (docs/rail/components.md; Modals › Dialog anatomy): a step that needs fields
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
 * @param {{close?:object, cancel?:object, yes?:object}} [o.hooks]  the page's attrs on each button (its handlers, keys)
 * @param {string} [o.cls]             the page's class on the card (what its body holds)
 * @param {string} [o.steps]           a stepped setup: the Stepper's markup, at the dialog's head
 * @param {boolean} [o.back]           a stepped setup past its first step: Back in the foot
 * @param {boolean} [o.view]           a view that only shows: no Cancel, `yes` closes it
 * @param {object} [o.attrs]           on the card
 */
export function dialog({ title, body, yes, status = '', busy = false, busyLabel = '', close = '', id = 'dlg-t', hooks = {}, cls = '', steps = '', back = false, view = false, attrs: a = {} }) {
  const head = `<div class="dlg-head"><h2 class="dlg-title"${attrs({ id })}>${esc(title)}</h2>${close ? button({ label: 'Close', kind: 'quiet', iconOnly: true, title: false, icon: close, attrs: { 'data-dialog': 'close', 'data-key': 'dialog:close', ...(hooks.close || {}) } }) : ''}</div>`;
  const foot = `<div class="dlg-foot"><span class="dlg-status" role="status">${status}</span><span class="dlg-acts">${view ? '' : button({ label: 'Cancel', kind: 'quiet', attrs: { 'data-dialog': 'cancel', 'data-key': 'dialog:cancel', ...(hooks.cancel || {}) } })}${back ? button({ label: 'Back', attrs: { 'data-dialog': 'back', 'data-key': 'dialog:back', ...(hooks.back || {}) } }) : ''}${button({ label: busy ? busyLabel || yes : yes, kind: 'primary', attrs: { 'data-dialog': 'yes', 'data-key': 'dialog:yes', 'data-motion': 'swap', disabled: busy, ...(hooks.yes || {}) } })}</span></div>`;
  return `<div class="viewer-modal" role="dialog" aria-modal="true"${attrs({ 'aria-labelledby': id, 'data-motion': 'in' })}><div class="card dlg rl-dialog${cls ? ' ' + cls : ''}"${attrs(a)}>${head}${steps ? `<div class="dlg-steps">${steps}</div>` : ''}<div class="dlg-body">${body}</div>${foot}</div></div>`;
}
