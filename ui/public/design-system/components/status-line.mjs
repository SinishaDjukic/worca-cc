// StatusLine (docs/rail/components.md): the rail mark, the state word, the action slot (its
// one next step, alternatives behind ▾, then ⋯), and a detail line under the word.
import { attrs, esc } from './html.mjs';

/**
 * The rail mark of a state: a dot in the state's tone, or a symbol for a state that needs you.
 * @param {object} o
 * @param {string} [o.tone]  the dot's class: 'is-green' | 'is-peach' (running) | 'is-amber' | 'is-red' | 'is-grey' …
 * @param {'q'|'!'} [o.sym]  'q' asks you something (amber ?), '!' is a problem (red !)
 * @param {string} [o.glyph] the symbol's SVG paths, when `sym` is set
 */
export function statusDot({ tone = '', sym, glyph = '' } = {}) {
  if (sym) {
    return `<span class="status-dot ${sym === 'q' ? 'is-amber' : 'is-red'} has-sym" aria-hidden="true"><svg class="status-sym" width="12" height="12" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="12" fill="currentColor" stroke="none"></circle><g fill="none" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">${glyph}</g></svg></span>`;
  }
  return `<span class="status-dot ${tone}" aria-hidden="true"></span>`;
}

/**
 * @param {object} o
 * @param {string} o.dot      statusDot markup
 * @param {string} o.word     the state word ("Ready to merge")
 * @param {string} [o.action] the action slot's markup: splitButton or button, then the ⋯
 * @param {string} [o.detail] the line under the word (up to two lines, then its tooltip)
 */
export function statusLine({ dot, word, action = '', detail = '' }) {
  return `<div class="rc-zone"><span class="rc-rail" data-motion="change">${dot}</span><span class="rc-main rc-word" data-motion="change">${esc(word)}</span>${action}${detail ? `<span class="rc-detail"${attrs({ title: detail })}>${esc(detail)}</span>` : ''}</div>`;
}
