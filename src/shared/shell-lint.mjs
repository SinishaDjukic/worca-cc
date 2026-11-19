// src/shared/shell-lint.mjs
// A conservative, POSIX-sh lint for the shell Command param. Pure and total: text in,
// warnings out, never throws, never runs anything. The rule is "when in doubt, no
// warning" — a warning only ever informs (the validator rule V33 is a warning, Save
// is gated on errors alone), but a false alarm still teaches authors to ignore it.
//
// One O(n) pass over a stack of frames (quotes, substitutions, braces, arithmetic).
// Keywords (if/fi, do/done, case/esac) count only in the top-level frame and only at
// command position; heredoc bodies, comments and quoted text are skipped, never read.

export const MAX_SHELL_WARNINGS = 20;
export const SHELL_LINT_CODES = Object.freeze([
  'quote-single', 'quote-double', 'backtick', 'quote-ansi', 'subst', 'heredoc',
  'if-open', 'fi-stray', 'do-open', 'done-stray', 'case-open', 'esac-stray']);

// A quote pairs with the next one of its kind, so a quote left open earlier shows up at the LAST one the shell
// reads: the message names both possibilities instead of pointing at the wrong line with certainty.
const MESSAGES = Object.freeze({
  'quote-single': () => "This single quote (') or an earlier one is never closed.",
  'quote-double': () => 'This double quote (") or an earlier one is never closed.',
  backtick: () => 'This backtick (`) or an earlier one is never closed.',
  'quote-ansi': () => 'This $\'…\' quote is never closed.',
  subst: () => 'This $( is never closed with ).',
  heredoc: (word) => `Heredoc <<${word} has no closing ${word} line.`,
  'if-open': () => "'if … then' has no closing 'fi'.",
  'fi-stray': () => "'fi' has no 'if' to close.",
  'do-open': () => "'do' has no closing 'done'.",
  'done-stray': () => "'done' has no 'do' to close.",
  'case-open': () => "'case' has no closing 'esac'.",
  'esac-stray': () => "'esac' has no 'case' to close.",
});

const BLANK = new Set([' ', '\t', '\r']);
// Ends a bare word. Quote-ish characters also end it, but glue it to what follows.
const WORD_BREAK = new Set([' ', '\t', '\r', '\n', ';', '&', '|', '(', ')', '<', '>', "'", '"', '`', '$', '\\']);
const GLUE = new Set(["'", '"', '`', '$', '\\']);
const CMD_WORDS = new Set(['then', 'do', 'else', 'elif', 'if', 'while', 'until', 'time']);
const KEYWORDS = new Set([...CMD_WORDS, 'case', 'fi', 'done', 'esac']);
const QUOTE_CODES = Object.freeze({ sq: 'quote-single', dq: 'quote-double', ansi: 'quote-ansi', bt: 'backtick' });
const CLOSES = Object.freeze({ fi: ['if', 'fi-stray'], done: ['do', 'done-stray'], esac: ['case', 'esac-stray'] });
const NORMAL = new Set(['top', 'subst', 'paren', 'bt']);
const isNameStart = (ch) => /[A-Za-z_]/.test(ch);
const isNameChar = (ch) => /[A-Za-z0-9_]/.test(ch);

/** @returns {Array<{line:number, code:string, message:string}>} 1-based line, sorted by line then code, at most MAX_SHELL_WARNINGS */
export function lintShell(text) {
  if (typeof text !== 'string' || text === '') return [];
  const s = text.replace(/\r\n/g, '\n');
  const n = s.length;
  const lineOf = new Int32Array(n + 1);
  let ln = 1;
  for (let k = 0; k < n; k += 1) { lineOf[k] = ln; if (s[k] === '\n') ln += 1; }
  lineOf[n] = ln;

  const out = [];
  const report = (line, code, arg) => out.push({ line, code, message: MESSAGES[code](arg) });
  const stack = [{ kind: 'top', line: 1, depth: 0 }];
  const blocks = [];                 // open if / do / case: { kind, line, then, idx }
  const byKind = { if: [], do: [], case: [] };   // the same blocks per kind, so a closer finds its opener in O(1)
  const pending = [];                // heredocs queued for the next newline: { word, strip, line }
  const push = (kind, at, extra) => stack.push({ kind, line: lineOf[at], depth: 0, ...extra });
  const open = (kind, at) => {
    const b = { kind, line: lineOf[at], then: false, idx: blocks.length };
    blocks.push(b);
    byKind[kind].push(b);
  };
  const inCase = () => blocks.length > 0 && blocks[blocks.length - 1].kind === 'case';
  const reportOpen = (b) => {
    if (b.kind === 'if' && !b.then) return;
    report(b.line, `${b.kind}-open`);
  };
  let cmd = true;                    // command position (meaningful in the top frame only)
  let i = 0;
  let stopped = false;

  /** `$` at i in a normal, dq or brace frame: push the frame it opens, or consume a plain `$x`. */
  const dollar = (inQuotes) => {
    const nx = s[i + 1];
    if (nx === '(') {
      if (s[i + 2] === '(') { push('arith', i); i += 3; } else { push('subst', i); i += 2; }
    } else if (nx === '{') { push('brace', i); i += 2; }
    else if (nx === "'" && !inQuotes) { push('ansi', i); i += 2; }
    else if (nx !== undefined && isNameStart(nx)) { i += 2; while (i < n && isNameChar(s[i])) i += 1; }
    else if (nx !== undefined && /[0-9@*?!$#-]/.test(nx)) i += 2;
    else i += 1;
  };

  /** The delimiter word after `<<`, quotes and backslashes stripped. Returns null when there is none. */
  const heredocWord = (from) => {
    let j = from;
    let word = '';
    while (j < n && !BLANK.has(s[j]) && !'\n;&|()<>'.includes(s[j])) {
      const ch = s[j];
      if (ch === "'" || ch === '"') {
        const close = s.indexOf(ch, j + 1);
        if (close === -1 || s.slice(j + 1, close).includes('\n')) return null;
        word += s.slice(j + 1, close);
        j = close + 1;
      } else if (ch === '\\') { word += s[j + 1] ?? ''; j += 2; }
      else { word += ch; j += 1; }
    }
    return word === '' ? null : { word, end: j };
  };

  /** Skip every queued heredoc body, starting at the line after a newline. */
  const skipBodies = () => {
    for (const h of pending) {
      let found = false;
      while (i < n) {
        const nl = s.indexOf('\n', i);
        const end = nl === -1 ? n : nl;
        let body = s.slice(i, end);
        if (h.strip) body = body.replace(/^\t+/, '');
        i = nl === -1 ? n : nl + 1;
        if (body === h.word) { found = true; break; }
      }
      if (!found) { report(h.line, 'heredoc', h.word); stopped = true; break; }
    }
    pending.length = 0;
  };

  const closeBlock = (word, line) => {
    const [opener, stray] = CLOSES[word];
    const match = byKind[opener].pop();
    if (!match) { report(line, stray); return; }
    const popped = blocks.splice(match.idx);
    for (let m = 1; m < popped.length; m += 1) { byKind[popped[m].kind].pop(); reportOpen(popped[m]); }
  };

  while (i < n && !stopped) {
    const f = stack[stack.length - 1];
    const c = s[i];
    switch (f.kind) {
      case 'sq': {
        const close = s.indexOf("'", i);
        if (close === -1) i = n; else { stack.pop(); i = close + 1; }
        continue;
      }
      case 'ansi':
        if (c === '\\') i += 2;
        else { if (c === "'") stack.pop(); i += 1; }
        continue;
      case 'arith':
        if (c === '(') { f.depth += 1; i += 1; }
        else if (c === ')') {
          if (f.depth > 0) { f.depth -= 1; i += 1; }
          else { stack.pop(); i += s[i + 1] === ')' ? 2 : 1; }
        } else i += 1;
        continue;
      case 'dq':
        if (c === '\\') i += 2;
        else if (c === '"') { stack.pop(); i += 1; }
        else if (c === '$') dollar(true);
        else if (c === '`') { push('bt', i); i += 1; }
        else i += 1;
        continue;
      case 'brace':
        if (c === '\\') i += 2;
        else if (c === '}') { stack.pop(); i += 1; }
        else if (c === "'") { if (stack[stack.length - 2].kind !== 'dq') push('sq', i); i += 1; }
        else if (c === '"') { push('dq', i); i += 1; }
        else if (c === '`') { push('bt', i); i += 1; }
        else if (c === '$') dollar(false);
        else i += 1;
        continue;
      default:
    }

    // A normal frame: top, subst, paren or bt.
    const top = f.kind === 'top';
    if (c === '\n') {
      i += 1;
      if (pending.length) skipBodies();
      cmd = true;
    } else if (BLANK.has(c)) i += 1;
    else if (c === '\\') { if (s[i + 1] !== '\n') cmd = false; i += 2; }
    else if (c === "'") { push('sq', i); cmd = false; i += 1; }
    else if (c === '"') { push('dq', i); cmd = false; i += 1; }
    else if (c === '`') {
      if (f.kind === 'bt') { stack.pop(); i += 1; } else { push('bt', i); i += 1; }
      cmd = false;
    } else if (c === '$') { dollar(false); cmd = false; }
    else if (c === '#' && (i === 0 || WORD_BREAK.has(s[i - 1]) && !GLUE.has(s[i - 1]))) {
      const nl = s.indexOf('\n', i);
      i = nl === -1 ? n : nl;
    } else if (c === ';' || c === '&' || c === '|') { cmd = true; i += 1; }
    else if (c === '(') {
      if (top && s[i + 1] === '(' && (cmd || /(^|[\s;&|(])for\s*$/.test(s.slice(Math.max(0, i - 40), i)))) { push('arith', i); i += 2; } else { push('paren', i); i += 1; }
      cmd = true;
    } else if (c === ')') {
      if (f.kind === 'subst' || f.kind === 'paren') stack.pop();
      cmd = f.kind !== 'subst' && inCase();
      i += 1;
    } else if (c === '<') {
      if (s[i + 1] === '<' && s[i + 2] === '<') i += 3;
      else if (s[i + 1] === '<') {
        const strip = s[i + 2] === '-';
        let j = i + (strip ? 3 : 2);
        while (j < n && BLANK.has(s[j])) j += 1;
        const d = heredocWord(j);
        if (d) { pending.push({ word: d.word, strip, line: lineOf[i] }); i = d.end; } else i += 2;
      } else i += 1;
    } else if (c === '>') i += 1;
    else {
      let end = i;
      while (end < n && !WORD_BREAK.has(s[end])) end += 1;
      if (end === i) { i += 1; continue; }
      const word = s.slice(i, end);
      const glued = end < n && GLUE.has(s[end]);
      const keyword = top && cmd && !glued && s[end] !== ')' && KEYWORDS.has(word);
      if (keyword) {
        if (word === 'if' || word === 'do' || word === 'case') open(word, i);
        else if (word === 'then') {
          const innermost = byKind.if[byKind.if.length - 1];
          if (innermost) innermost.then = true;
        } else if (CLOSES[word]) closeBlock(word, lineOf[i]);
        cmd = CMD_WORDS.has(word);
      } else cmd = top && !glued && (word === '{' || (cmd && word === '!'));
      i = end;
    }
  }

  if (!stopped && pending.length) { report(pending[0].line, 'heredoc', pending[0].word); stopped = true; }
  if (!stopped) {
    const quote = stack.find((fr) => QUOTE_CODES[fr.kind]);
    if (quote) report(quote.line, QUOTE_CODES[quote.kind]);
    else {
      const subst = stack.find((fr) => fr.kind === 'subst');
      if (subst) report(subst.line, 'subst');
      for (const b of blocks) reportOpen(b);
    }
  }
  return out
    .sort((a, b) => a.line - b.line || (a.code < b.code ? -1 : a.code > b.code ? 1 : 0))
    .slice(0, MAX_SHELL_WARNINGS);
}
