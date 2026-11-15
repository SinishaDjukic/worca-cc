// CopyButton (docs/rail/components.md): a quiet 28px icon button that copies text. A tick for 1.2s, Copied in its tooltip
// and the live region; its width never changes. A page calls `copied(el)` after it copies.
import { attrs, cls } from './html.mjs';
import { icon } from './icons.mjs';

export const COPIED_MS = 1200;

/**
 * @param {object} o
 * @param {string} o.text    what it copies
 * @param {string} [o.label] what it is ("Copy branch name")
 * @param {string} [o.cls]
 * @param {object} [o.attrs]
 */
export function copyButton({ text, label = 'Copy', cls: c = '', attrs: a = {} }) {
  return `<button type="button" class="${cls('btn btn-sm btn-quiet btn-icon rail-copy', c)}"${attrs({ title: label, 'aria-label': label, 'data-copy': text, ...a })}>${icon('copy', 14)}<span class="rail-copy-tick">${icon('check', 14)}</span><span class="sr-only" role="status"></span></button>`;
}

/** Shows the tick, then goes back. `doc` timers are the page's own window. */
export function copied(el, { wait = setTimeout } = {}) {
  const label = el.getAttribute('aria-label') || 'Copy';
  el.classList.add('is-copied'); el.title = 'Copied';
  const live = el.querySelector('[role="status"]'); if (live) live.textContent = 'Copied';
  wait(() => { el.classList.remove('is-copied'); el.title = label; if (live) live.textContent = ''; }, COPIED_MS);
}
