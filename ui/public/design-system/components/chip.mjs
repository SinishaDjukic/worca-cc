// Chip (docs/rail/components.md): a short fact (a stage, a source, a slot to set up). It never acts.
import { esc, attrs, cls } from './html.mjs';

/** @param {{text:string, title?:string, cls?:string, attrs?:object}} o */
export function chip({ text, title = '', cls: c = '', attrs: a = {} }) {
  return `<span class="${cls('kind-chip', c)}"${attrs({ title: title || null, ...a })}>${esc(text)}</span>`;
}
