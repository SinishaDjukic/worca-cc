// ArtifactView (docs/rail/panels.md › panel.task-depth): one artifact a task wrote, open in place under its list. Its
// name and where it came from, Previous and Next through the others, Open full and Download; what it holds below, read
// where it is.
import { attrs, esc } from './html.mjs';
import { icon } from './icons.mjs';
import { button } from './button.mjs';

/**
 * @param {object} o
 * @param {string} o.name        its file name: review-cycle-2.md
 * @param {string} [o.meta]      where it came from: Review · cycle 2
 * @param {string} o.body        what it holds (markup: text, an image, a table)
 * @param {number} [o.at]        its place among the others, from 0
 * @param {number} [o.of]        how many there are
 * @param {object} [o.hooks]     { prev, next, full, download }: attributes on each control
 * @param {object} [o.attrs]
 */
export function artifactView({ name, meta = '', body, at = 0, of = 1, hooks = {}, attrs: a = {} }) {
  const b = (label, k, h, ic, off) => button({ label, kind: 'quiet', iconOnly: !!ic, icon: ic ? icon(ic, 13) : undefined, attrs: { ...(h || {}), disabled: off ? true : null } });
  const step = of > 1 ? b('Previous', 'quiet', hooks.prev, 'chevL', at <= 0) + b('Next', 'quiet', hooks.next, 'chevR', at >= of - 1) : '';
  return `<section class="av"${attrs({ 'aria-label': name, ...a })}><div class="av-h"><b>${esc(name)}</b>${meta ? `<span>${esc(meta)}</span>` : ''}${of > 1 ? `<span class="av-n">${at + 1} of ${of}</span>` : ''}<span class="av-sp"></span>${step}${b('Open full', 'quiet', hooks.full)}${b('Download', 'quiet', hooks.download)}</div><div class="av-body">${body}</div></section>`;
}
