// ConfirmStrip (docs/rail/components.md): the one place a page asks before a step that
// changes what others see or cannot be taken back. The question, then the step and Cancel. While the step works its
// button says so and is disabled; a failure keeps the strip, says what failed and why, and offers Try again.
import { button } from './button.mjs';
import { attrs, esc } from './html.mjs';

/**
 * @param {object} o
 * @param {string} o.text          the question ("Merge #959 into dev?")
 * @param {string} o.yes           the step's label ("Merge")
 * @param {boolean} [o.danger]     the step cannot be taken back: the danger button
 * @param {string} [o.busy]        the working label ("Merging…"): disables the step
 * @param {{title:string, detail:string, extra?:string}} [o.err]  what failed; `extra` is markup after the detail
 * @param {string} [o.id]          the text's id, which labels the strip
 * @param {{label:string, href:string}} [o.link]  one text link after the sentence, opening outside the app (https: only)
 * @param {string} [o.noBusy]      the quiet side's working label ("Saving…"): disables both buttons
 * @param {boolean} [o.back]       Esc takes the strip back without an answer (data-esc="back")
 * @param {object} [o.attrs]       hooks on the strip (data-*)
 */
export function confirmStrip({ text, yes, no = 'Cancel', danger = false, busy = '', err = null, id = 'rc-strip-t', link = null, noBusy = '', back = false, attrs: a = {} }) {
  const t = err
    ? `<span class="rc-confirm-t is-err"${attrs({ id, role: 'alert' })}>${esc(err.title)}<span class="rc-confirm-why">${esc(err.detail)}${err.extra ? ' ' + err.extra : ''}</span></span>`
    : `<span class="rc-confirm-t"${attrs({ id })}>${esc(text)}${linkHtml(link)}</span>`;
  const working = back && !!(busy || noBusy);
  const root = attrs({ 'aria-labelledby': id, 'data-motion': 'open', 'data-esc': back ? 'back' : null, 'aria-busy': working ? 'true' : null, ...a });
  return `<div class="rc-confirm" role="alertdialog"${root}>${t}${confirmActions({ yes: busy || (err ? 'Try again' : yes), no: noBusy || no, danger, busy: !!busy, noBusy: !!noBusy })}</div>`;
}

/** The one text link a strip may carry after its sentence; a non-https: address renders none. */
function linkHtml(link) {
  if (!link || !/^https:\/\//i.test(link.href || '')) return '';
  return ` <a class="dc-link"${attrs({ href: link.href, target: '_blank', rel: 'noopener noreferrer' })}>${esc(link.label)}</a>`;
}

/** The strip's two buttons, shared with a strip that holds a short form. */
export function confirmActions({ yes, no = 'Cancel', danger = false, busy = false, noBusy = false, kind }) {
  return `<span class="rc-confirm-acts">${button({ label: yes, kind: kind || (danger ? 'danger' : 'primary'), attrs: { 'data-confirm': 'yes', 'data-key': 'confirm:yes', 'data-motion': 'swap', disabled: busy || noBusy } })}${button({ label: no, kind: 'quiet', attrs: { 'data-confirm': 'no', 'data-key': 'confirm:no', disabled: noBusy } })}</span>`;
}

/**
 * A strip that holds a short form: the sentence, then its fields and confirmActions.
 * @param {object} o
 * @param {string} o.form     what the form is (data-form)
 * @param {string} o.text
 * @param {string} o.body     markup: the fields, then confirmActions
 * @param {string} [o.id]
 */
export function confirmForm({ form, text, body, id = 'rc-strip-t' }) {
  return `<form class="rc-confirm is-form" role="dialog"${attrs({ 'data-motion': 'open', 'aria-labelledby': id, 'data-form': form })}><span class="rc-confirm-t"${attrs({ id })}>${esc(text)}</span>${body}</form>`;
}
