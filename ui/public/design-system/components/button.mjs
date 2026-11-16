// Button (docs/stillhet/components.md): one look per role, never a size or colour of its own.
// `kind` is the role: '' (secondary), 'primary' (the one main step of a state), 'quiet' (a step among many), 'danger'
// (only inside the confirm of a step that cannot be taken back). An icon-only button names itself in `label`, which
// becomes its aria-label; its tooltip is `title` (the label when not given). While its action is out it is busy and says
// what it is doing: the stage line's breathing knot before a present-tense label ("Creating PR…"), its width steady,
// disabled and aria-busy, the label said politely (`busy: { label }` drawn, `busy(el, { label, until })` live).
import { attrs, cls, esc } from './html.mjs';

const KIND = { primary: 'btn-primary', quiet: 'btn-quiet', danger: 'btn-danger', '': '' };
// The busy state (comp.button-busy, stillhet.css .stillhet-busy): the knot breathes as look.stage-line's now step (sl-breath).
const BUSY_CLS = 'stillhet-busy';
const busyText = (label, word) => label || `${word}…`;
const busyInner = (text, iconOnly, say = text) => `<span class="btn-knot" aria-hidden="true"></span>${iconOnly ? '' : `<span class="btn-busy-t" aria-hidden="true">${esc(text)}</span>`}<span class="sr-only" role="status">${esc(say)}</span>`;

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
 * @param {boolean|{label?: string}} [o.busy]  its action is out: the knot and the present-tense label (the label + "…"
 *   when not given), disabled, aria-busy (as `busy(el, { label })` makes it)
 */
export function button({ label, kind = '', icon = '', iconOnly = false, title, count, cls: extra = '', attrs: a = {}, busy: isBusy = false }) {
  if (!(kind in KIND)) throw new Error(`button: unknown kind "${kind}"`);
  const tip = title ?? (iconOnly ? label : undefined);
  const name = iconOnly ? { 'aria-label': label } : {};
  if (isBusy) {
    const text = busyText(isBusy.label, label);
    return `<button type="button" class="${cls('btn btn-sm', KIND[kind], iconOnly && 'btn-icon', extra, BUSY_CLS)}"${attrs({ ...name, title: tip, ...a, 'aria-busy': 'true', disabled: true })}>${busyInner(text, iconOnly)}</button>`;
  }
  return `<button type="button" class="${cls('btn btn-sm', KIND[kind], iconOnly && 'btn-icon', extra)}"${attrs({ ...name, title: tip, ...a })}>${icon}${iconOnly ? '' : esc(label)}${count === undefined ? '' : ` <span class="runs-bulk-c">${esc(count)}</span>`}</button>`;
}

/**
 * Busy while `until` is out: the same state `button({ busy: { label } })` draws. `label` says what it is doing in the
 * present tense ("Creating PR…"); without one it is the button's own words + "…". The button takes the width its busy
 * words need (never narrower than at rest) and holds it until it settles, cannot be pressed again, and says the label
 * politely. When `until` settles it is back at rest with its own words, keeps the
 * disabled it had (or the one the page set while it was busy), and takes the focus back if it had it and the person
 * has not moved it elsewhere. Settles like `until`; a removed button is left alone.
 * @param {HTMLButtonElement} el
 * @param {object} [o]
 * @param {string} [o.label]  the present-tense words
 * @param {Promise|any} [o.until]  the action; the button is back at rest when it settles
 */
export function busy(el, { label, until } = {}) {
  if (!el || el.classList.contains(BUSY_CLS)) return Promise.resolve(until);
  const doc = el.ownerDocument, win = doc.defaultView, had = doc.activeElement === el, wasDisabled = el.disabled;
  const iconOnly = el.classList.contains('btn-icon');
  const text = busyText(label, (iconOnly ? el.getAttribute('aria-label') : el.textContent)?.trim() || '');
  const style = el.getAttribute('style'), w = el.getBoundingClientRect().width;
  const rest = doc.createDocumentFragment();
  while (el.firstChild) rest.append(el.firstChild);
  if (w) el.style.minWidth = `${w}px`;   // never narrower than at rest: shorter busy words never make it shrink
  el.classList.add(BUSY_CLS);
  el.setAttribute('aria-busy', 'true');
  el.disabled = true;
  el.innerHTML = busyInner(text, iconOnly, '');
  const live = el.querySelector('[role="status"]');
  win.setTimeout(() => { if (el.contains(live)) live.textContent = text; }, 0);   // filled after it is in the page, so it is said
  // a disabled the page sets (or clears) while busy is the newer state: it wins over the one the button had
  let pageSet = false;
  const watch = new win.MutationObserver(() => { pageSet = true; });
  watch.observe(el, { attributes: true, attributeFilter: ['disabled'] });
  return Promise.resolve(until).finally(() => {
    if (watch.takeRecords().length) pageSet = true;
    watch.disconnect();
    if (!el.isConnected) return;
    el.replaceChildren(rest);
    el.classList.remove(BUSY_CLS);
    el.removeAttribute('aria-busy');
    if (style === null) el.removeAttribute('style'); else el.setAttribute('style', style);
    if (!pageSet) el.disabled = wasDisabled;
    const now = doc.activeElement;
    if (had && (!now || now === doc.body || now === el)) el.focus();
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
