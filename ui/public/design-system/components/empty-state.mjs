// EmptyState (docs/design-system.md › Worca Rail › EmptyState): what is not here and why, then the one way on. The
// error form is a part that could not be drawn: it says so in its own place, and the rest of the page keeps working.
import { esc } from './html.mjs';

/**
 * @param {object} o
 * @param {string} o.title       "Could not show the changes"
 * @param {string} [o.text]      why, or what still works
 * @param {string} [o.actions]   the buttons' markup
 * @param {boolean} [o.error]
 */
export function emptyState({ title, text = '', actions = '', error = false }) {
  return `<div class="empty-line${error ? ' is-err' : ''}"${error ? ' role="alert"' : ''}><span class="el-t">${esc(title)}</span>${text ? `<span>${esc(text)}</span>` : ''}${actions ? `<span class="el-acts">${actions}</span>` : ''}</div>`;
}
