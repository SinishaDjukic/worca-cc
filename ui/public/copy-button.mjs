// The one copy button (docs/design-system.md › Copy button), as the run head's branch name does it:
// `.btn.btn-sm.btn-quiet.copy-btn`, a copy glyph that turns into a green tick and a green "Copied" for COPIED_MS.
// When the copied text is the label (a branch name, a worktree path), the label is that text in mono; otherwise the button
// is an icon square and its name lives in title and aria-label. A miss (a failed write, nothing to copy) shows an × and
// the reason in red for the same window.
import { icon, iconSvg } from './icons.mjs';

export const COPIED_MS = 1200;

/** The three glyphs, in the order the CSS swaps them (`.copied` → tick, `.copy-miss` → ×). */
export function copyIcons(doc, size = 14) {
  return [icon(doc, 'copy', size, 'ic ico-copy'), icon(doc, 'check', size, 'ic ico-check'), icon(doc, 'x', size, 'ic ico-x')];
}

/** The same glyphs as markup, for a button written as an HTML string. */
export function copyIconsHtml(size = 14) {
  const span = (name, cls) => `<span class="ic ${cls}" aria-hidden="true" style="width:${size}px;height:${size}px">${iconSvg(name, size)}</span>`;
  return span('copy', 'ico-copy') + span('check', 'ico-check') + span('x', 'ico-x');
}

/**
 * A copy button. `name` is what it does ("Copy branch name"): its aria-label, and its title unless `title` is given.
 * `label` (optional) is the visible text, the copied value itself; without one the button is a square icon.
 * `action: true` is the labelled-action exception (design-system.md › Copy button): a secondary button among other
 * labelled actions that shows `name` after the glyph, and "Copied" in its place while the tick shows.
 */
export function copyButton(doc, { name, label = null, title = name, cls = '', action = false }) {
  const b = doc.createElement('button');
  b.type = 'button';
  const look = action ? 'btn btn-sm copy-btn copy-btn-action' : `btn btn-sm btn-quiet copy-btn ${label == null ? 'btn-icon' : 'mono'}`;
  b.className = `${look}${cls ? ` ${cls}` : ''}`;
  b.title = title;
  b.setAttribute('aria-label', name);
  if (label != null) {
    const t = doc.createElement('span');
    t.className = 'copy-btn-text';
    t.textContent = label;
    b.append(t);
  }
  b.append(...copyIcons(doc));
  if (action) {
    const t = doc.createElement('span');
    t.className = 'copy-btn-words';
    t.textContent = name;
    b.append(t);
  }
  return b;
}

/** Writes `text`; the hidden-textarea fallback covers an insecure context or a refused permission. */
export async function writeClipboard(win, text) {
  try {
    if (win.navigator.clipboard?.writeText) { await win.navigator.clipboard.writeText(text); return true; }
  } catch { /* fall through to the textarea */ }
  return legacyCopy(win.document, text);
}

function legacyCopy(doc, text) {
  try {
    const ta = doc.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    doc.body.appendChild(ta);
    ta.select();
    const ok = doc.execCommand('copy');
    doc.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

/** The caption after the glyph ("Copied", or why not); made on the first flash, so static markup needs none. */
function captionOf(btn) {
  let msg = btn.querySelector(':scope > .copy-btn-msg');
  if (!msg) {
    msg = btn.ownerDocument.createElement('span');
    msg.className = 'copy-btn-msg';
    btn.append(msg);
  }
  return msg;
}

/**
 * Says `text` to screen readers through one polite, visually hidden status region (#copy-live). The button's own
 * caption is not read out: its aria-label names it. Emptied first, so the same words twice are announced twice.
 */
export function announceCopy(doc, text) {
  let r = doc.getElementById('copy-live');
  if (!r) {
    r = doc.createElement('div');
    r.id = 'copy-live';
    r.className = 'sr-only';
    r.setAttribute('role', 'status');
    r.setAttribute('aria-live', 'polite');
    doc.body.append(r);
  }
  r.textContent = '';
  r.textContent = text;
}

/**
 * Shows the outcome on `btn` for COPIED_MS: the tick and "Copied", or the × and `miss`, as glyph, caption and title.
 * The resting title is read once and kept in `data-copy-title`, so a click during the window can never make a flash
 * the button's title.
 */
export function flashCopy(btn, ok, miss = 'Copy failed') {
  if (btn.dataset.copyTitle === undefined) btn.dataset.copyTitle = btn.title;
  const say = ok ? 'Copied' : miss;
  captionOf(btn).textContent = say;
  btn.classList.toggle('copied', ok);
  btn.classList.toggle('copy-miss', !ok);
  btn.title = say;
  announceCopy(btn.ownerDocument, say);
  const win = btn.ownerDocument.defaultView;
  win.clearTimeout(btn._copyTimer);
  btn._copyTimer = win.setTimeout(() => {
    btn.classList.remove('copied', 'copy-miss');
    btn.title = btn.dataset.copyTitle;
  }, COPIED_MS);
}

/** Copies `text` and flashes `btn`; empty text copies nothing and says so. `failed` may name the way out ("Copy
 *  failed: select the code"). Resolves to whether it landed. */
export async function copyFromButton(btn, text, { empty = 'Nothing to copy', failed = 'Copy failed' } = {}) {
  if (!text) { flashCopy(btn, false, empty); return false; }
  const ok = await writeClipboard(btn.ownerDocument.defaultView, text);
  flashCopy(btn, ok, failed);
  return ok;
}
