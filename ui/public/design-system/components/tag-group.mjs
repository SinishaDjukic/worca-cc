// TagGroup and ListEditor (docs/rail/components.md): labels and cost tags on one line, one button opens one editor. What
// does not fit folds into +N; a page measures after each render with fitTags. No colour; removing is in the editor.
import { esc, attrs, cls } from './html.mjs';
import { icon } from './icons.mjs';

const XS = '<svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" aria-hidden="true"><path d="M7 7l10 10M17 7 7 17"></path></svg>';

/**
 * @param {object} o
 * @param {{kind:'label'|'tag', text:string}[]} o.items
 * @param {boolean} [o.open]
 * @param {string} [o.editor]  the ListEditor's markup, drawn while open
 */
export function tagGroup({ items, open = false, editor = '' }) {
  const list = items.map((c) => c.text).join(', ');
  return `<span class="rc-pop rc-tagpop"><span class="rc-tags${open ? ' is-open' : ''}" data-tagzone title="${items.length ? `${esc(list)} · L to edit` : 'Add a label or cost tag · L'}"><button type="button" class="rc-tags-mark" data-menu="tags" data-key="menu:tags" aria-haspopup="dialog" aria-expanded="${open}" aria-label="${items.length ? `Edit labels and cost tags: ${esc(list)}` : 'Add a label or cost tag'}">${icon('tag', 13)}</button>${items.map((c) => `<span class="rc-tag is-${c.kind}">${esc(c.text)}<button type="button" class="rc-tag-x" data-untag="${c.kind}|${esc(c.text)}" data-key="untag:${c.kind}:${esc(c.text)}" aria-label="Remove ${esc(c.text)}">${XS}</button></span>`).join('')}<span class="rc-tag-more" hidden></span></span>${open ? editor : ''}</span>`;
}

/** Fits a drawn TagGroup on its line: shows what fits, folds the rest into +N (after each render, never on hover). */
export function fitTags(doc) {
  const g = doc.querySelector('.rc-tags'); if (!g) return;
  const tags = [...g.querySelectorAll('.rc-tag')]; const more = g.querySelector('.rc-tag-more');
  tags.forEach((t) => { t.hidden = false; }); more.hidden = true;
  const line = g.closest('.rc-facts'); const br = line.querySelector('.rc-mid-a');
  const keep = Math.min(240, line.clientWidth * 0.34);   // a branch keeps about a third of the line, at most 240px
  const lastRight = () => { const vis = [...g.children].filter((x) => !x.hidden && x.getBoundingClientRect().width); return vis.length ? vis[vis.length - 1].getBoundingClientRect().right : 0; };
  const over = () => lastRight() > line.getBoundingClientRect().right + 1 || (br && br.scrollWidth > br.clientWidth + 1 && br.clientWidth < keep);
  let hide = 0;
  while (over() && hide < tags.length) { hide++; tags[tags.length - hide].hidden = true; more.hidden = false; more.textContent = `+${hide}`; }
}

/**
 * ListEditor: a field (find or create), then checked lists with how many use each.
 * @param {object} o
 * @param {string} o.label
 * @param {string} o.inputId
 * @param {string} o.placeholder
 * @param {{title:string, kind:string, many:boolean, rows:{text:string, n:number|string, on:boolean}[]}[]} o.sections
 * @param {string} [o.hint]
 */
export function listEditor({ label, inputId, placeholder, sections, hint = '' }) {
  const rows = ({ kind, many, rows: r }) => r.map(({ text, n, on }) => `<button type="button" class="menu-item" role="${many ? 'menuitemcheckbox' : 'menuitemradio'}" aria-checked="${!!on}" data-listtoggle="${esc(kind)}|${esc(text)}" data-key="lst:${esc(kind)}:${esc(text)}"><span class="mi-l">${esc(text)}</span><span class="mi-hint">${esc(n)}</span></button>`).join('');
  return `<div class="${cls('menu', 'rc-list-ed')}" role="dialog" data-motion="in" aria-label="${esc(label)}"><input class="input input-sm"${attrs({ id: inputId, type: 'text', placeholder, 'aria-label': placeholder, 'data-key': inputId })}>${sections.map((sec, i) => `${i ? '<div class="menu-sep" role="separator"></div>' : ''}<p class="menu-h">${esc(sec.title)}</p>${rows(sec)}`).join('')}${hint ? `<p class="menu-help">${esc(hint)}</p>` : ''}</div>`;
}
