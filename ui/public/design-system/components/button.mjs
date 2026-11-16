// Button (docs/rail/components.md): one look per role, never a size or colour of its own.
// `kind` is the role: '' (secondary), 'primary' (the one main step of a state), 'quiet' (a step among many), 'danger'
// (only inside the confirm of a step that cannot be taken back). An icon-only button names itself in `label`, which
// becomes its aria-label; its tooltip is `title` (the label when not given). While its action is out it is busy: a spinner
// inside over the hidden label, the same width, disabled and aria-busy (`busy: true` drawn, `busy(el, p)` live).
import { attrs, cls, esc } from './html.mjs';

const KIND = { primary: 'btn-primary', quiet: 'btn-quiet', danger: 'btn-danger', '': '' };
// The busy state: the classic action-feedback hooks (its ring, ws-spin and the still ring under reduced motion) plus
// rail-busy, the library's overlay (action-feedback.css), so the button never widens.
const BUSY_CLS = ['is-busy', 'rail-busy'];
const BUSY_ATTRS = { 'data-fb-state': 'busy', 'aria-busy': 'true' };
const SPIN = '<span class="btn-spin" aria-hidden="true"></span>';

/**
 * @param {object} o
 * @param {string} o.label        the words, or the name of an icon-only button
 * @param {string} [o.kind]       '' | 'primary' | 'quiet' | 'danger'
 * @param {string} [o.icon]       an icon's SVG markup, before the words
 * @param {boolean} [o.iconOnly]  a square icon button: `label` goes to aria-label
 * @param {string} [o.title]      the tooltip
 * @param {string|number} [o.count]  how many it applies to, after the words (a bulk action's count)
 * @param {string} [o.cls]        the page's hook class (never a look)
 * @param {object} [o.attrs]      data-*, aria-* and disabled, written as given
 * @param {boolean} [o.busy]      its action is out: the spinner, disabled, aria-busy (as `busy(el, p)` makes it)
 */
export function button({ label, kind = '', icon = '', iconOnly = false, title, count, cls: extra = '', attrs: a = {}, busy: isBusy = false }) {
  if (!(kind in KIND)) throw new Error(`button: unknown kind "${kind}"`);
  const tip = title ?? (iconOnly ? label : undefined);
  const name = iconOnly ? { 'aria-label': label } : {};
  const on = isBusy ? { ...BUSY_ATTRS, disabled: true } : {};
  return `<button type="button" class="${cls('btn btn-sm', KIND[kind], iconOnly && 'btn-icon', extra, isBusy && BUSY_CLS)}"${attrs({ ...name, title: tip, ...a, ...on })}>${isBusy ? SPIN : ''}${icon}${iconOnly ? '' : esc(label)}${count === undefined ? '' : ` <span class="runs-bulk-c">${esc(count)}</span>`}</button>`;
}

/**
 * Busy while `p` is out: the same state `button({ busy: true })` draws. When it settles the button is back at rest,
 * keeps the disabled it had, and takes the focus back if it had it. Settles like `p`; a removed button is left alone.
 * @param {HTMLButtonElement} el
 * @param {Promise|any} p
 */
export function busy(el, p) {
  if (!el || el.classList.contains('rail-busy')) return Promise.resolve(p);
  const had = el.ownerDocument.activeElement === el, wasDisabled = el.disabled;
  el.classList.add(...BUSY_CLS);
  for (const [k, v] of Object.entries(BUSY_ATTRS)) el.setAttribute(k, v);
  el.disabled = true;
  el.insertAdjacentHTML('afterbegin', SPIN);
  const spin = el.firstElementChild;
  return Promise.resolve(p).finally(() => {
    if (!el.isConnected) return;
    spin.remove();
    el.classList.remove(...BUSY_CLS);
    for (const k of Object.keys(BUSY_ATTRS)) el.removeAttribute(k);
    el.disabled = wasDisabled;
    if (had) el.focus();
  });
}

/**
 * A main step with its alternatives behind ▾ (StatusLine's action slot, a section's own action). The ▾ opens
 * `menuHtml` (a CompactMenu, given when open) and takes the main button's kind, so the pair reads as one control.
 *
 * @param {object} o
 * @param {object} o.main         Button options for the main step
 * @param {string} o.moreLabel    the ▾'s name ("More actions")
 * @param {string} o.chevron      the ▾ icon's SVG markup
 * @param {boolean} [o.open]      whether its menu is open
 * @param {string} [o.menuHtml]   the open menu
 * @param {object} [o.moreAttrs]  the ▾'s data-* hooks
 * @param {string} [o.cls]        the wrapper's hook classes
 */
export function splitButton({ main, moreLabel, chevron, open = false, menuHtml = '', moreAttrs = {}, cls: extra = '' }) {
  const more = moreLabel ? button({ label: moreLabel, kind: main.kind, icon: chevron, iconOnly: true, title: false,
    attrs: { 'aria-haspopup': 'menu', 'aria-expanded': String(open), ...moreAttrs } }) + (open ? menuHtml : '') : '';
  return `<div class="${cls('btn-split', extra)}">${button(main)}${more}</div>`;
}
