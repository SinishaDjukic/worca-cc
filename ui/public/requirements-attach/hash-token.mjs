// Pure helpers for the `#query` token typed in a composer textarea. No DOM.

const WHITESPACE = /\s/;

/**
 * Find the `#query` token the caret sits in.
 * A token starts at a '#' at index 0 or right after whitespace; its query is
 * the text between '#' and the caret and contains no whitespace.
 * @returns {{start:number,end:number,query:string}|null}
 */
export function findHashToken(text, caret) {
  if (typeof text !== 'string' || !Number.isInteger(caret)) return null;
  if (caret < 1 || caret > text.length) return null;
  for (let i = caret - 1; i >= 0; i--) {
    const ch = text[i];
    if (WHITESPACE.test(ch)) return null;
    if (ch === '#') {
      if (i !== 0 && !WHITESPACE.test(text[i - 1])) return null;
      return { start: i, end: caret, query: text.slice(i + 1, caret) };
    }
  }
  return null;
}

/**
 * Remove only '#' + query (tok.start..tok.end); the caret lands at tok.start.
 * @returns {{text:string,caret:number}}
 */
export function stripToken(text, tok) {
  return {
    text: text.slice(0, tok.start) + text.slice(tok.end),
    caret: tok.start,
  };
}
