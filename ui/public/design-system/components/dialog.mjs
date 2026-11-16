// Dialog (docs/stillhet/components.md; Modals › Dialog anatomy): a step that needs fields
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
 * @param {string} [o.scrimCls]        the scrim's hook class
 * @param {string} [o.steps]           a stepped setup: the Stepper's markup, at the dialog's head
 * @param {boolean} [o.back]           a stepped setup past its first step: Back in the foot
 * @param {boolean} [o.view]           a view that only shows: no Cancel, `yes` closes it
 * @param {object} [o.attrs]           on the card
 */
export function dialog({ title, body, yes, status = '', busy = false, busyLabel = '', close = '', id = 'dlg-t', hooks = {}, cls = '', scrimCls = '', steps = '', back = false, view = false, attrs: a = {} }) {
  const head = `<div class="dlg-head"><h2 class="dlg-title"${attrs({ id })}>${esc(title)}</h2>${close ? button({ label: 'Close', kind: 'quiet', iconOnly: true, title: false, icon: close, attrs: { 'data-dialog': 'close', 'data-key': 'dialog:close', ...(hooks.close || {}) } }) : ''}</div>`;
  const foot = `<div class="dlg-foot"><span class="dlg-status" role="status">${status}</span><span class="dlg-acts">${view ? '' : button({ label: 'Cancel', kind: 'quiet', attrs: { 'data-dialog': 'cancel', 'data-key': 'dialog:cancel', ...(hooks.cancel || {}) } })}${back ? button({ label: 'Back', attrs: { 'data-dialog': 'back', 'data-key': 'dialog:back', ...(hooks.back || {}) } }) : ''}${button({ label: busy ? busyLabel || yes : yes, kind: 'primary', attrs: { 'data-dialog': 'yes', 'data-key': 'dialog:yes', 'data-motion': 'swap', disabled: busy, ...(hooks.yes || {}) } })}</span></div>`;
  return `<div class="viewer-modal${scrimCls ? ' ' + scrimCls : ''}" role="dialog" aria-modal="true"${attrs({ 'aria-labelledby': id, 'data-motion': 'in' })}><div class="card dlg rl-dialog${cls ? ' ' + cls : ''}"${attrs(a)}>${head}${steps ? `<div class="dlg-steps">${steps}</div>` : ''}<div class="dlg-body">${body}</div>${foot}</div></div>`;
}

/**
 * A dialog whose card is the page's own anatomy (New run: a sentence, then the start): the same scrim, no head or foot.
 * @param {object} o
 * @param {string} o.label     aria-label
 * @param {string} o.body      markup
 * @param {string} [o.cls]     the card's class
 * @param {string} [o.scrimCls] the scrim's hook class
 */
export function dialogFrame({ label, body, cls = '', scrimCls = '' }) {
  return `<div class="viewer-modal${scrimCls ? ' ' + scrimCls : ''}"><div class="card${cls ? ' ' + cls : ''}" role="dialog" aria-modal="true"${attrs({ 'aria-label': label })}>${body}</div></div>`;
}

// ---- One Dialog, one behaviour (docs/stillhet/panels.md): the library lifts every dialog a page draws, wherever the page
// drew it. The scrim covers the whole window (the bar and the top bar too), the card is centred in the window, the focus
// moves in and stays in, Esc closes, and the focus goes back to what opened it. No page needs a host of its own.
const lifted = new WeakSet();
const CAN_FOCUS = ['button:not([disabled])', 'a[href]', 'input:not([disabled]):not([type="hidden"])', 'select:not([disabled])', 'textarea:not([disabled])', '[tabindex]'].map((x) => x + ':not([tabindex="-1"])').join(', ');   // a radio group is one stop: its chosen answer
const FIRST = '[autofocus], .dlg-body input:not([type="checkbox"]):not([type="radio"]):not([disabled]), .dlg-body textarea:not([disabled]), .dlg-body [role="radio"][aria-checked="true"], .dlg-body [role="radio"]';

/** The dialogs that show in a document, the top one last. */
export const openDialogs = (doc) => [...doc.querySelectorAll('.viewer-modal')].filter((m) => !m.hidden && (m.matches('[role="dialog"]') || m.querySelector('[role="dialog"]')));

/** What takes the focus inside `root`, in Tab order. */
export const focusables = (root) => [...root.querySelectorAll(CAN_FOCUS)].filter((el) => !el.hidden && el.getAttribute('aria-hidden') !== 'true' && !el.closest('[hidden]'));

/**
 * Where Tab goes inside a dialog: the next control, the first after the last, the last before the first (Shift).
 * @param {Element[]} list  the dialog's controls, in order
 * @param {Element|null} from  the one that has the focus
 * @param {boolean} back  Shift+Tab
 * @returns {Element|null}
 */
export function trapNext(list, from, back) {
  if (!list.length) return null;
  const i = list.indexOf(from);
  if (i < 0) return back ? list[list.length - 1] : list[0];
  return list[(i + (back ? -1 : 1) + list.length) % list.length];
}

/**
 * Lifts every dialog in a document, now and whenever one is drawn.
 * @param {Document} doc
 * @param {object} [o]
 * @param {(el: Element|null) => void} [o.opened]  told what had the focus when the first dialog opened
 * @param {() => void} [o.closed]                  told when the last one closed
 */
export function watchDialogs(doc, { opened = () => {}, closed = () => {} } = {}) {
  if (lifted.has(doc)) return;
  lifted.add(doc);
  const win = doc.defaultView;
  let up = false;
  const lift = (m) => {
    if (m.dataset.lifted !== undefined) return;
    m.dataset.lifted = '';
    // the top layer: over every page, bar and panel, whatever box the page drew it in; the window is its box
    Object.assign(m.style, { position: 'fixed', inset: '0', width: 'auto', height: 'auto', maxWidth: 'none', maxHeight: 'none', margin: '0', border: '0', overflow: 'visible', color: 'inherit' });
    if (typeof m.showPopover === 'function') { m.setAttribute('popover', 'manual'); try { m.showPopover(); } catch { /* not attached yet: it stays where it was drawn */ } }
  };
  const check = () => {
    const all = openDialogs(doc), top = all[all.length - 1];
    if (!top) { if (up) { up = false; closed(); } return; }
    if (!up) { up = true; opened(doc.activeElement && doc.activeElement !== doc.body ? doc.activeElement : null); }
    all.forEach(lift);
    if (top.contains(doc.activeElement)) return;
    (top.querySelector(FIRST) || focusables(top)[0])?.focus?.({ preventScroll: true });
  };
  check();
  if (win.MutationObserver && doc.body) new win.MutationObserver(check).observe(doc.body, { subtree: true, childList: true });
  // Tab stays inside the top dialog
  win.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab') return;
    const top = openDialogs(doc).pop(); if (!top) return;
    const to = trapNext(focusables(top), doc.activeElement, e.shiftKey);
    e.preventDefault();
    to?.focus();
  }, true);
  // Esc closes it, when the page's own layer did not answer the key (a dialog with something typed keeps it)
  doc.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || e.defaultPrevented) return;
    const top = openDialogs(doc).pop(); if (!top || top.matches('.keys-modal')) return;
    const out = top.querySelector('[data-dialog="close"], [data-dialog="cancel"]:not([hidden])');
    if (!out) return;
    e.preventDefault();
    out.click();
  });
}
