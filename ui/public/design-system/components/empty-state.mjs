// EmptyState (docs/rail/components.md): what is not here and why, then the one way on. The
// error form is a part that could not be drawn: it says so in its own place, and the rest of the page keeps working.
import { esc } from './html.mjs';
import { button } from './button.mjs';

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

/**
 * NotFound: an address that names nothing here says so, with its one way on; it never shows something else (nav.not-found).
 * @param {object} o
 * @param {string} o.what      what the address asked for ("project")
 * @param {string} [o.name]    the name in the address
 * @param {string} o.back      the place it leads to ("Projects")
 * @param {object} [o.attrs]   the way on's hooks
 */
export function notFound({ what, name = '', back, attrs = {} }) {
  return emptyState({ title: name ? `There is no ${what} called ${name}` : `There is no such ${what}`, text: 'It may have been removed, or the address is wrong.', actions: button({ label: `Go to ${back}`, kind: 'quiet', attrs }) });
}

/**
 * NotInStillhet: a place that is not in Stillhet yet says so, names where it lives today in words, and offers Back to
 * Chat; it never reads as empty ("No … yet") and holds no switch (nav.not-live).
 * @param {object} o
 * @param {string} o.place     the place's name ("Insights")
 * @param {string} [o.today]   where it lives with Stillhet off ("Statistics and Team metrics")
 * @param {object} [o.attrs]   Back to Chat's hooks
 */
export function notInStillhet({ place, today = '', attrs = {} }) {
  return emptyState({ title: `${place} is not in Stillhet yet`, text: today ? `With Stillhet off, it is ${today}.` : 'It has no Stillhet screen yet.', actions: button({ label: 'Back to Chat', kind: 'quiet', attrs }) });
}
