// src/core/workflow-tests/try-guard-shell.mjs — the try guard's shell reader (plans/workflow-tests-part3a-plan.md D56):
// a shell line read into commands the way a shell would, closely enough for try-guard-decision.mjs to see through the
// usual ways around a word list (quotes, $'…', $( ) / <( ) / backticks, heredocs, here-strings, pipes), and the small word
// helpers it shares with the decision and the hook (try-guard.mjs). Pure, with no imports at all: the
// hook runs on every Bash call of every try. Split out of try-guard.mjs (file split), which re-exports its public names.
const SPLIT = new Set([';', '&', '|', '(', ')']);
/** Inside double quotes a backslash escapes only these (bash); elsewhere it stays, as in "C:\Program Files". */
const DQ_ESCAPES = new Set(['$', '`', '"', '\\', '\n']);

/** The command inside $( ), <( ) or backticks that starts at text[0] (its opening), and where it ends; null unterminated. */
export function enclosed(text, i) {
  if (text[i] === '`') {
    const e = text.indexOf('`', i + 1);
    return e < 0 ? null : { inner: text.slice(i + 1, e), end: e + 1 };
  }
  let depth = 0;
  let q = null;
  for (let j = i + 1; j < text.length; j += 1) {
    const c = text[j];
    if (q) { if (c === q) q = null; else if (c === '\\' && q === '"') j += 1; continue; }
    if (c === "'" || c === '"') { q = c; continue; }
    if (c === '\\') { j += 1; continue; }
    if (c === '(') depth += 1;
    else if (c === ')') { depth -= 1; if (depth === 0) return { inner: text.slice(i + 2, j), end: j + 1 }; }
  }
  return null;
}

/** The $( ) and backtick commands in a text (an unquoted heredoc's body runs them). */
function substitutions(text) {
  const out = [];
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === '\\') { i += 1; continue; }
    if ((text[i] === '$' && text[i + 1] === '(') || text[i] === '`') {
      const e = enclosed(text, i);
      if (!e) { if (text[i] === '`') break; out.push(text.slice(i + 2)); break; }
      if (!(text[i] === '$' && e.inner.startsWith('('))) out.push(e.inner);   // $(( )) is arithmetic
      i = e.end - 1;
    }
  }
  return out;
}

export const ANSI_C = { a: '\x07', b: '\b', e: '\x1b', E: '\x1b', f: '\f', n: '\n', r: '\r', t: '\t', v: '\v', '\\': '\\', "'": "'", '"': '"', '?': '?' };
/** bash's $'…': the text between the quotes (from i, just after the opening quote) and where it ends. */
function ansiC(s, i) {
  let out = '';
  while (i < s.length && s[i] !== "'") {
    if (s[i] !== '\\' || i + 1 >= s.length) { out += s[i]; i += 1; continue; }
    const c = s[i + 1];
    let m;
    if (ANSI_C[c] != null) { out += ANSI_C[c]; i += 2; }
    else if ((m = /^x([0-9a-fA-F]{1,2})/.exec(s.slice(i + 1)))) { out += String.fromCharCode(parseInt(m[1], 16)); i += 1 + m[0].length; }
    else if ((m = /^u([0-9a-fA-F]{1,4})/.exec(s.slice(i + 1))) || (m = /^U([0-9a-fA-F]{1,8})/.exec(s.slice(i + 1)))) {
      try { out += String.fromCodePoint(parseInt(m[1], 16)); } catch { /* out of range: nothing */ }
      i += 1 + m[0].length;
    } else if ((m = /^[0-7]{1,3}/.exec(s.slice(i + 1)))) { out += String.fromCharCode(parseInt(m[0], 8) & 0xff); i += 1 + m[0].length; }
    else if (c === 'c' && i + 2 < s.length) { out += String.fromCharCode(s.charCodeAt(i + 2) & 0x1f); i += 3; }
    else { out += `\\${c}`; i += 2; }
  }
  return { text: out, end: i + 1 };
}

/**
 * A shell line read into commands: `segments` are the words of each command (split at ; & | ( ) and newlines outside
 * quotes, quotes removed, $'…' decoded, `# comments` dropped); `heredocs` are the bodies of `<<WORD` / `<<-WORD` heredocs,
 * which are not commands; `meta[i]` says how segment i gets its input: `piped` (a `|` or `|&` from segment i - 1, also
 * across a newline after the `|`), `here` (its `<<<` here-strings) and `procs` (the commands of its `<( )`, whose output
 * it reads as a file named /dev/fd/63). A $( ), <( ) or backtick stays in its word as written (`$(which git)`) and its
 * command is added to `segments` (it runs), as are the $( ) and backticks of an unquoted heredoc's body. A heredoc whose
 * end word never comes was no heredoc (`$((1<<2))`): its lines stay commands.
 * @returns {{segments: string[][], heredocs: {body: string, quoted: boolean}[], meta: {piped: boolean, here: string[], procs: string[]}[]}}
 */
export function parseShell(command) {
  const segments = [];
  const meta = [];
  const heredocs = [];
  let words = [];
  let cur = '';
  let has = false;
  let quote = null;
  let pending = [];
  let piped = false;
  let hereNext = false;
  let here = [];
  let procs = [];
  const subs = [];
  const endWord = () => {
    if (has) { if (hereNext) { here.push(cur); hereNext = false; } else words.push(cur); }
    cur = ''; has = false;
  };
  const endSeg = () => {
    endWord();
    hereNext = false;
    if (words.length) { segments.push(words); meta.push({ piped, here, procs }); piped = false; here = []; procs = []; }
    words = [];
  };
  const merge = (r) => { segments.push(...r.segments); meta.push(...r.meta); heredocs.push(...r.heredocs); };
  const s = String(command ?? '');
  const n = s.length;
  let i = 0;
  while (i < n) {
    const ch = s[i];
    if (quote) {
      // "…$(git push)…" and "…`git push`…" run inside double quotes too. Fix 6: the whole span is stepped over, so a
      // double quote inside it ("$(echo "git push")") does not end the outer string.
      if (quote === '"' && ((ch === '$' && s[i + 1] === '(') || ch === '`')) {
        const e = enclosed(s, i);
        if (e) {
          if (!(ch === '$' && e.inner.startsWith('('))) subs.push(e.inner);
          cur += s.slice(i, e.end);
          i = e.end;
          continue;
        }
      }
      if (ch === quote) quote = null;
      else if (ch === '\\' && quote === '"' && i + 1 < n && DQ_ESCAPES.has(s[i + 1])) cur += s[++i];
      else cur += ch;
      i += 1;
      continue;
    }
    if (ch === '$' && s[i + 1] === "'") { const a = ansiC(s, i + 2); cur += a.text; has = true; i = a.end; continue; }
    if (ch === '$' && s[i + 1] === '"') { i += 1; continue; }   // $"…" is "…"
    if (ch === "'" || ch === '"') { quote = ch; has = true; i += 1; continue; }
    if (ch === '\\' && i + 1 < n) { if (s[i + 1] !== '\n') { cur += s[i + 1]; has = true; } i += 2; continue; }
    if (ch === '#' && !has) { while (i < n && s[i] !== '\n') i += 1; continue; }
    // $( ), backticks and <( ) >( ): their command runs; the word keeps them as written.
    if ((ch === '$' && s[i + 1] === '(') || ch === '`' || ((ch === '<' || ch === '>') && s[i + 1] === '(')) {
      const e = enclosed(s, ch === '`' ? i : i);
      if (e) {
        const arith = ch === '$' && e.inner.startsWith('(');
        if (!arith) subs.push(e.inner);
        if (ch === '<' || ch === '>') { if (ch === '<') procs.push(e.inner); endWord(); cur = '/dev/fd/63'; }
        else cur += s.slice(i, e.end);
        has = true;
        i = e.end;
        continue;
      }
      if (ch === '`') { cur += ch; has = true; i += 1; continue; }   // PowerShell's escape, or an unclosed one
    }
    if (ch === '<' && s[i + 1] === '<' && s[i + 2] === '<') { endWord(); hereNext = true; i += 3; continue; }
    if (ch === '<' && s[i + 1] === '<') {
      endWord();
      let j = i + 2;
      const strip = s[j] === '-';
      if (strip) j += 1;
      while (j < n && (s[j] === ' ' || s[j] === '\t')) j += 1;
      let delim = '';
      let quoted = false;
      while (j < n && !/[\s;&|()<>`]/.test(s[j])) {
        const c = s[j];
        if (c === "'" || c === '"') {
          quoted = true;
          const e = s.indexOf(c, j + 1);
          const stop = e < 0 ? n : e;
          delim += s.slice(j + 1, stop);
          j = stop + 1;
          continue;
        }
        if (c === '\\') { quoted = true; if (j + 1 < n) delim += s[j + 1]; j += 2; continue; }
        delim += c;
        j += 1;
      }
      if (delim) pending.push({ delim, strip, quoted });
      i = j;
      continue;
    }
    if (ch === '\n' || ch === '\r') {
      endSeg();
      i += 1;
      if (ch === '\r' && s[i] === '\n') i += 1;
      for (const h of pending) {
        const lines = [];
        let ended = false;
        while (i < n) {
          let e = s.indexOf('\n', i);
          if (e < 0) e = n;
          const line = s.slice(i, e).replace(/\r$/, '');
          i = e + 1;
          if ((h.strip ? line.replace(/^\t+/, '') : line) === h.delim) { ended = true; break; }
          lines.push(line);
        }
        const body = lines.join('\n');
        if (ended) heredocs.push({ body, quoted: h.quoted });
        else merge(parseShell(body));
      }
      pending = [];
      continue;
    }
    // 2>&1, >&2, &>file: a redirection, not a background &.
    if (ch === '&' && (s[i - 1] === '>' || s[i - 1] === '<' || s[i + 1] === '>')) { cur += ch; has = true; i += 1; continue; }
    if (ch === '|') {
      endSeg();
      if (s[i + 1] === '|') { piped = false; i += 2; continue; }   // ||
      piped = true;
      i += s[i + 1] === '&' ? 2 : 1;   // | and |&
      continue;
    }
    if (SPLIT.has(ch)) {
      endSeg();
      if (ch !== '(') piped = false;
      i += 1;
      continue;
    }
    if (/\s/.test(ch)) { endWord(); i += 1; continue; }
    cur += ch;
    has = true;
    i += 1;
  }
  endSeg();
  for (const inner of subs) merge(parseShell(inner));
  for (const h of heredocs.slice()) if (!h.quoted) for (const inner of substitutions(h.body)) merge(parseShell(inner));
  return { segments, heredocs, meta };
}

/** The words of each command in a shell line (parseShell's segments). */
export const shellSegments = (command) => parseShell(command).segments;

/** A command word's program name: no folder, no .exe/.cmd/.bat/.ps1, no @version (`npx npm@10 publish`). */
export const bin = (w) => String(w).split(/[\\/]/).pop().toLowerCase().replace(/(?<=.)@[^@]*$/, '').replace(/\.(exe|cmd|bat|ps1)$/, '');
export const nonOptions = (args) => args.filter((a) => !String(a).startsWith('-'));
/** "pr create", "issue comment", "repos pr", …: a forge CLI's first two words. */
export const cliTool = (args) => nonOptions(args).slice(0, 2).join(' ');
/** A word as a POSIX shell would need it quoted to stay one word. */
export const shQuote = (w) => (/^[A-Za-z0-9_@%+=:,./\\-]+$/.test(w) ? w : `'${String(w).replaceAll("'", "'\\''")}'`);
/** PowerShell's backtick escapes removed (`n and `t become whitespace), as PowerShell reads them. */
export const stripPsEscapes = (text) => String(text ?? '').replace(/`([\s\S])/g, (_m, c) => ({ n: '\n', t: '\t', r: '\r', 0: '', a: '', b: '', f: '', v: '', e: '' }[c] ?? c));
