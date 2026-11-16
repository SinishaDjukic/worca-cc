// CopyButton (docs/stillhet/components.md): a quiet 28px icon button that copies text. A tick for 1.2s, Copied in its tooltip
// and the live region; its width never changes. Its kind says what it copies: plain text, markdown as written, or code
// without its prompt. The caller passes that source; the button never rewrites it. `copyFrom(btn)` writes the clipboard
// and says Copied, or Could not copy; a page that copies another way calls `copied(el)` after it copies.
import { attrs, cls } from './html.mjs';
import { icon } from './icons.mjs';

export const COPIED_MS = 1200;

const KINDS = { text: 'Copy', markdown: 'Copy as markdown', code: 'Copy code' };
const timers = new WeakMap();

/**
 * @param {object} o
 * @param {string} o.text    what it copies, exactly as it will land on the clipboard
 * @param {'text'|'markdown'|'code'} [o.kind]  what kind of text it is; names the default label
 * @param {string} [o.label] what it is ("Copy branch name"); the kind's word when not given
 * @param {string} [o.cls]
 * @param {object} [o.attrs]
 */
export function copyButton({ text, kind = 'text', label, cls: c = '', attrs: a = {} }) {
  if (!(kind in KINDS)) throw new Error(`copyButton: unknown kind "${kind}"`);
  const name = label ?? KINDS[kind];
  return `<button type="button" class="${cls('btn btn-sm btn-quiet btn-icon stillhet-copy', c)}"${attrs({ title: name, 'aria-label': name, 'data-copy': text, 'data-copy-kind': kind, ...a })}>${icon('copy', 14)}<span class="stillhet-copy-tick">${icon('check', 14)}</span><span class="sr-only" role="status"></span></button>`;
}

// The tooltip's words: in data-tip-text while the tooltip watcher holds the title (its hide puts that back), else the title.
function say(el, word, { wait = setTimeout, clear = clearTimeout, tick = false } = {}) {
  const label = el.getAttribute('aria-label') || 'Copy';
  const tip = (w) => { if (el.dataset.tipText !== undefined) el.dataset.tipText = w; else el.title = w; };
  if (timers.has(el)) clear(timers.get(el));
  el.classList.toggle('is-copied', tick);
  tip(word);
  const live = el.querySelector('[role="status"]'); if (live) live.textContent = word;
  timers.set(el, wait(() => { timers.delete(el); el.classList.remove('is-copied'); tip(label); if (live) live.textContent = ''; }, COPIED_MS));
}

/** Shows the tick, then goes back. A second call within the moment restarts it. `wait`/`clear` are injectable timers. */
export function copied(el, { wait = setTimeout, clear = clearTimeout } = {}) {
  say(el, 'Copied', { wait, clear, tick: true });
}

/** Says Could not copy for the moment, then goes back. No look of its own. */
function copyFailed(el, { wait = setTimeout, clear = clearTimeout } = {}) {
  say(el, 'Could not copy', { wait, clear });
}

/**
 * Writes `text` (else the button's data-copy) to the clipboard, then says Copied or Could not copy. Resolves to whether it
 * copied; never rejects, never moves focus, never disables. A page may add its own reaction on `false`.
 * @param {HTMLElement} btn
 * @param {object} [o]
 * @param {string} [o.text]
 * @param {{ writeText: (t: string) => Promise<void> }} [o.clipboard]  the button's window clipboard when not given
 */
export async function copyFrom(btn, { text, clipboard, wait, clear } = {}) {
  const timing = { ...(wait ? { wait } : {}), ...(clear ? { clear } : {}) };
  const payload = text ?? btn.dataset.copy;
  const board = clipboard === undefined ? btn.ownerDocument?.defaultView?.navigator?.clipboard : clipboard;
  try {
    if (!payload || typeof board?.writeText !== 'function') throw new Error('nothing to copy');
    await board.writeText(payload);
  } catch {
    copyFailed(btn, timing);
    return false;
  }
  copied(btn, timing);
  return true;
}
