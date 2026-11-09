// Text link (docs/rail/components.md): a step inside a sentence, underlined, the text's colour.
import { attrs, esc } from './html.mjs';

/** @param {{label:string, attrs?:object}} o  `attrs` carries its hook (data-go, data-key) and title */
export const textLink = ({ label, attrs: a = {} }) => `<button type="button" class="dc-link"${attrs(a)}>${esc(label)}</button>`;

/** A document's name that opens it: its name in code, its hook and title in `attrs`. */
export const documentLink = ({ name, attrs: a = {} }) => `<button type="button" class="ov-art-name"${attrs(a)}><code>${esc(name)}</code></button>`;

/**
 * OutLink (comp.out-link): a link that leaves Worca says where it goes and opens in a new tab.
 * @param {{label:string, href:string, attrs?:object}} o  `href` must be https
 * @throws {Error} for any other scheme
 */
export function outLink({ label, href, attrs: a = {} }) {
  let ok = false;
  try { ok = new URL(href).protocol === 'https:'; } catch { /* not a URL */ }
  if (!ok) throw new Error('outLink: https only');
  return `<a class="dc-out"${attrs({ ...a, href, target: '_blank', rel: 'noopener noreferrer' })}>${esc(label)}</a>`;
}
