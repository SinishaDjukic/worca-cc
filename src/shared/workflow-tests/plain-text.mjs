// src/shared/workflow-tests/plain-text.mjs — board 59 D: a result's excerpt as plain text. Markdown marks go (bold and emphasis, a leading
// #, a list marker, a > quote mark, backticks, code fences and rules, a link's address); line breaks stay. Display only: what is stored,
// and the proof search, use the text as it is. Pure and browser-safe.

/** One line's inline marks: a link or an image keeps its words, code its text, bold and emphasis their words. */
const inline = (s) => s
  .replace(/!\[([^\]]*)\]\([^)\s]*(?:\s+"[^"]*")?\)/g, '$1')
  .replace(/\[([^\]]+)\]\([^)\s]*(?:\s+"[^"]*")?\)/g, '$1')
  .replace(/`+/g, '')
  .replace(/\*\*(?=\S)(.+?)(?<=\S)\*\*/g, '$1')
  .replace(/(^|[^\w])__(?=\S)(.+?)(?<=\S)__(?!\w)/g, '$1$2')
  .replace(/(^|[^\w*])\*(?=[^\s*])([^*\n]*?[^\s*])?\*(?![\w*])/g, (m, pre, mid) => (mid === undefined ? m : `${pre}${mid}`))
  .replace(/(^|[^\w])_(?=[^\s_])([^_\n]*?[^\s_])?_(?!\w)/g, (m, pre, mid) => (mid === undefined ? m : `${pre}${mid}`))
  .replace(/\*\*/g, '');   // a bold mark an excerpt's cut left alone

/** `text` without its markdown marks, its line breaks kept; '' for anything not a string. */
export function plainText(text) {
  if (typeof text !== 'string') return '';
  const out = [];
  for (let line of text.split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(line)) continue;                 // a code fence: its code stays
    if (/^\s*([-*_])(?:\s*\1){2,}\s*$/.test(line)) continue;   // a rule
    // Review M7: a ">", "-", "*" or "+" before a number is what the line says ("> 500", "- 5%"), and a list number has 1 to 3 digits
    // ("2024. Revenue grew" keeps its year): only marks before words go.
    line = line.replace(/^(\s*)(?:>(?:\s*(?=>)|\s(?=[^\d\s])))+/, '$1')
      .replace(/^(\s*)#{1,6}\s+/, '$1')
      .replace(/^(\s*)(?:[-*+]\s+(?=[^\d\s])|\d{1,3}[.)]\s+)/, '$1');
    out.push(inline(line));
  }
  return out.join('\n');
}
