// Text link (docs/rail/components.md): a step inside a sentence, underlined, the text's colour.
import { attrs, esc } from './html.mjs';

/** @param {{label:string, attrs?:object}} o  `attrs` carries its hook (data-go, data-key) and title */
export const textLink = ({ label, attrs: a = {} }) => `<button type="button" class="dc-link"${attrs(a)}>${esc(label)}</button>`;

/** A document's name that opens it: its name in code, its hook and title in `attrs`. */
export const documentLink = ({ name, attrs: a = {} }) => `<button type="button" class="ov-art-name"${attrs(a)}><code>${esc(name)}</code></button>`;
