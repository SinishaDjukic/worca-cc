// DraftBar (docs/rail/philosophy.md › rail.drafts): what you change by hand is a draft until you save it. The bar says so
// on the thing: a draft, how many changes, that tasks still run the saved one (or that nothing can run it yet), and its
// two answers: Discard, quiet, and Save, filled.
import { esc } from './html.mjs';
import { button } from './button.mjs';

/**
 * @param {object} o
 * @param {number} o.changes        how many changes the draft holds
 * @param {boolean} [o.fresh]       never saved: nothing can run it yet
 * @param {string} [o.save]         Save's word
 * @param {object} [o.hooks]        { save, discard }: attributes on each button
 */
export function draftBar({ changes, fresh = false, save = 'Save', hooks = {} }) {
  const said = fresh ? 'never saved · nothing can run it yet' : `${changes} ${changes === 1 ? 'change' : 'changes'} · tasks still run the saved one`;
  return `<div class="draft-bar" role="status"><b>Draft</b><span>${esc(said)}</span><span class="draft-sp"></span>${button({ label: 'Discard', kind: 'quiet', attrs: hooks.discard || {} })}${button({ label: save, kind: 'primary', attrs: hooks.save || {} })}</div>`;
}
