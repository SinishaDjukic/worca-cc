// OptionList (docs/rail/components.md): answering Worca's question, or a choice inside a confirm. One row per answer, a
// radio dot, Worca's pick marked, your own answer under it (a SuggestionField). Never radio cards.
import { esc, attrs } from './html.mjs';

/**
 * @param {object} o
 * @param {string} o.label          what is asked (the group's name)
 * @param {string[]} o.options
 * @param {number} o.selected       the chosen row; -1 when your own answer is chosen
 * @param {number} [o.recommended]  the row Worca would pick
 * @param {string} [o.pickWord]     how the pick is marked
 * @param {string} [o.own]          markup under the rows: the SuggestionField for your own answer
 * @param {(i:number)=>object} [o.optAttrs]  on each row
 */
export function optionList({ label, options, selected, recommended = -1, pickWord = 'Worca’s pick', own = '', optAttrs = () => ({}) }) {
  const rows = options.map((o, i) => `<button type="button" class="sc-ans-opt" role="radio" aria-checked="${i === selected}" tabindex="${i === selected ? 0 : -1}"${attrs(optAttrs(i))}><span class="sc-ans-dot" aria-hidden="true"></span><span class="sc-ans-l">${esc(o)}</span>${i === recommended ? `<span class="sc-ans-hint">${esc(pickWord)}</span>` : ''}</button>`).join('');
  return `<div class="sc-ans-opts" role="radiogroup" aria-label="${esc(label)}">${rows}</div>${own}`;
}
