// src/core/design/html-scan.mjs
// Parser-based HTML scans shared by the Design assembler and lint (SPEC C-7). htmlparser2 in its default HTML
// mode: tag and attribute names come back lower-cased, and script and style bodies are raw text, so markup
// written inside one, or inside a comment, is never read as an element. Where htmlparser2's reading of a file can
// differ from a browser's, divergenceWatch says so, and every consumer fails closed.
import { posix } from 'node:path';
import { Parser } from 'htmlparser2';

const ACTIVE = new Set(['script', 'iframe', 'object', 'embed']);
/** An active open tag left after the cut: a browser can parse markup differently from htmlparser2 (a CDATA section
 *  outside SVG, `noscript` with scripts on, an HTML tag inside `svg`), so such a leftover is turned into text. */
const ACTIVE_OPEN = /<(?=(?:script|iframe|object|embed)(?:[\s/>]|$))/gi;
const SLOT_ATTR = 'data-worca-slot';
/** Anything but HTML whitespace (space, tab, LF, FF, CR); a decoded `&nbsp;` counts as content. */
const NOT_SPACE = /[^ \t\n\f\r]/;
const SKIP_SCHEME = /^(?:data|blob|about|mailto|tel):/i;
const REMOTE = /^(?:https?:|\/\/)/i;
const ANY_SCHEME = /^[a-z][a-z0-9+.-]*:/i;
const DRIVE = /^[a-z]:/i;
/** A URL parser drops every ASCII tab and newline, so `jav&#9;ascript:` is still a scheme. */
const URL_DROPPED = /[\t\n\r]/g;
const CSS_SPACE = /[ \t\n\r\f]/;
const HTML_SPACE = /[ \t\n\f\r]/;
const ESCAPED = Object.freeze({ type: 'escaped' });
/** The attributes that load a resource, per element (Task 11). `a`, `area` and `form` navigate, so they are never inlined. */
export const RESOURCE_ATTRS = new Map([
  ['img', ['src', 'srcset']], ['source', ['src', 'srcset']], ['video', ['src', 'poster']], ['audio', ['src']],
  ['track', ['src']], ['script', ['src']], ['embed', ['src']], ['input', ['src']], ['object', ['data']],
  ['link', ['href']], ['image', ['href', 'xlink:href']], ['use', ['href', 'xlink:href']],
]);
/**
 * What lint reads as loaded by the page: RESOURCE_ATTRS plus `iframe[src]`, which is a document, so never inlined,
 * `base[href]`, which moves every relative reference of the page, and an svg `script`'s `href` and `xlink:href`.
 * `img` and `image` read the same four: htmlparser2 names an svg `image` `img` inside an integration point, and a
 * browser names an `image` that left svg `img`, so either name can be either element.
 */
const IMAGE_ATTRS = ['src', 'srcset', 'href', 'xlink:href'];
const LOADED_ATTRS = new Map([...RESOURCE_ATTRS, ['img', IMAGE_ATTRS], ['image', IMAGE_ATTRS], ['iframe', ['src']], ['base', ['href']], ['script', ['src', 'href', 'xlink:href']]]);
/** The attribute that navigates, per element: lint flags these only when they escape work/ (L1.15). */
const NAV_ATTRS = new Map([['a', 'href'], ['area', 'href'], ['form', 'action']]);
const RESERVED_PREFIX = 'data-worca-';
/** At-rules whose block holds style rules that lint judges; every other at-rule body is skipped. */
const CSS_GROUP_RULES = new Set(['media', 'supports', 'container', 'layer']);
const CSS_KEYFRAMES = /^(?:-[a-z]+-)?keyframes$/;
/**
 * A viewport-height length (`vh`, `svh`, `lvh`, `dvh`), matched on text with comments, strings and URLs blanked.
 * The plan's `(?:\d+\.?\d*|\.\d+)` with `\d+(?:\.\d*)?` for its first branch: the same matches, and linear on a
 * long run of digits, where `\d+\d*` splits the run every way before failing.
 */
const CSS_VH = /(?<![\w#.])(?:\d+(?:\.\d*)?|\.\d+)[sld]?vh\b/i;
/**
 * The bounds of every scan of a file an agent writes (as in ../ask/html-text.mjs): these run on the server thread.
 * htmlparser2's own tag stack costs O(depth) per tag, so a deeper nest would cost quadratic CPU, and the length keeps
 * the linear rest (about 0.1 s of CPU per MiB at worst) short. A scan stops at the first element nested deeper, or at
 * the length, and every caller fails closed.
 */
export const HTML_MAX_DEPTH = 512;
export const HTML_MAX_SCAN_LENGTH = 8 * 1024 * 1024;
const CDATA_OPEN = '<![CDATA[';
/** The elements a browser reads as raw text, RCDATA or plaintext in HTML content (`noscript` while scripts run). */
const RAW_TEXT = new Set(['script', 'style', 'title', 'textarea', 'xmp', 'iframe', 'noembed', 'noframes', 'noscript', 'plaintext']);
/**
 * Inside or after one of these, htmlparser2's tree builder can leave a browser's, and with it whether a raw-text start
 * tag makes its body text: svg and math (no breakout tags, integration points matched by name in any namespace,
 * self-closed ones never closed, end tags that pop past them where a browser ignores them), and select, frameset and
 * template (its column-group mode), whose parser modes ignore such a start tag, so a browser reads its body as markup.
 */
const DIVERGES = new Set(['svg', 'math', 'select', 'frameset', 'template']);
/** Elements htmlparser2 and a browser both close at the next one of their kind, inside a select or anywhere else. */
const SELF_ENDING = new Set(['option', 'optgroup']);
/** What may follow `</name` in a browser's end of raw text (htmlparser2's isEndOfTagSection: whitespace, `/`, `>`). */
const RAW_END = /[\t\n\f\r />]/;
/** htmlparser2 matches a raw-text end tag on `c | 0x20`, so it reads U+001C as `<` and U+000F as `/`. */
const CONTROL = /[\x0F\x1C]/;
/** Written after a file's text: htmlparser2 reads it as this comment, at that place, only when the file ends between tokens. */
const END_PROBE = '<!--worca-end-->';
const RESERVED_TEXT = /data-worca-/gi;

/**
 * True when an end tag holds a quote before its first `>`: htmlparser2 ends every end tag there, while a browser reads
 * an end tag's attributes as a start tag's, so a quoted value holding `>` ends it later. Linear: each `>` and quote
 * is found once.
 */
function quotedEndTag(text) {
  const tags = /<\/[A-Za-z]/g;
  let gt = -2;
  const next = { '"': -2, "'": -2 };
  const after = (ch, at) => { if (next[ch] !== -1 && next[ch] < at) next[ch] = text.indexOf(ch, at); return next[ch] === -1 ? Infinity : next[ch]; };
  for (let m = tags.exec(text); m; m = tags.exec(text)) {
    const at = m.index + 2;
    if (gt < at) gt = text.indexOf('>', at);
    if (gt === -1) return false;
    if (Math.min(after('"', at), after("'", at)) < gt) return true;
    tags.lastIndex = gt + 1;
  }
  return false;
}

/**
 * Watches one parse of `text` for markup htmlparser2 and a browser can read differently, so that text one of them
 * reads as markup the other reads as text, and lint could miss a live element. The caller passes every open tag the
 * parser reports to `open(name, end)` and every close to `close(name, isImplied, end)`, `end` just past the parser's
 * `endIndex`. `unread()` is then the first such place, or null:
 * - `'cdata'`: any `<![CDATA[`. htmlparser2 ends one at `]]>`, a browser outside svg and math at its first `>`, and
 *   htmlparser2 cannot tell where a browser leaves them.
 * - `'control'`: a U+000F or U+001C (CONTROL). `'endtag'`: a quote inside an end tag (quotedEndTag).
 * - `'rawtext'`: a raw-text element (RAW_TEXT) where a browser and htmlparser2 can disagree on whether its body is
 *   text: anywhere after a DIVERGES element, and every `noscript` (htmlparser2 reads it as markup), unless the body's
 *   first `<` starts its own end tag (a `plaintext` never ends); or a `script` whose body has `<!--` and then `<script`
 *   before its end, where a browser's escaped script runs past the end htmlparser2 takes.
 * `inRegion()` is true while a browser may read the current place in another context than htmlparser2 does: inside a
 * DIVERGES element, or after htmlparser2 closed an element inside one without its own end tag (its view of the open
 * elements can then differ from a browser's). `endProbe()` gives what to write after the file's text before ending
 * the parse, and `comment(data, end)` takes each comment; `ended()` is then whether the file ended between tokens,
 * with no DIVERGES element left open and nothing closed that way, so text after it reads the same in both. A trailing
 * `<` never is: the probe's own `<` turns it into text, so the probe still reads as a comment in place, while in the
 * page a browser starts a tag with what follows it (`<` and the shell's `script src=…>`).
 * Each check reads only up to the body's own end, so the cost stays linear in `text`.
 * @param {string} text
 * @returns {{ open: (name: string, end: number) => void, close: (name: string, isImplied: boolean, end: number) => void, inRegion: () => boolean, endProbe: () => string, comment: (data: string, end: number) => void, ended: () => boolean, unread: () => null|'cdata'|'control'|'endtag'|'rawtext' }}
 */
export function divergenceWatch(text) {
  let found = null;
  if (text.includes(CDATA_OPEN)) found = 'cdata';
  else if (CONTROL.test(text)) found = 'control';
  else if (quotedEndTag(text)) found = 'endtag';
  let diverged = false;
  let regions = 0;
  let unsure = false;
  let probed = false;
  let reachedEnd = false;
  const open = [];
  const closesAt = (at, name) => name !== 'plaintext' && text.startsWith('</', at) && text.slice(at + 2, at + 2 + name.length).toLowerCase() === name && RAW_END.test(text[at + 2 + name.length] ?? '');
  const escapes = /<!--|<\/script[\t\n\f\r />]/gi;
  const nested = /<script[\t\n\f\r />]|<\/script[\t\n\f\r />]/gi;
  const first = (re, at) => { re.lastIndex = at; return re.exec(text); };
  const safe = (name, end) => {
    if (diverged || name === 'noscript') {
      const lt = text.indexOf('<', end);
      return lt !== -1 && closesAt(lt, name);
    }
    if (name !== 'script') return true;
    const comment = first(escapes, end);
    if (!comment || comment[0] !== '<!--') return true;
    const tag = first(nested, comment.index + 4);
    return !tag || tag[0][1] === '/';
  };
  return {
    open(name, end) {
      if (probed) return;
      if (found === null && RAW_TEXT.has(name) && !safe(name, end)) found = 'rawtext';
      if (DIVERGES.has(name)) { diverged = true; regions += 1; }
      open.push(end);
    },
    close(name, isImplied, end) {
      if (probed) return;
      // A self-closed or void element closes at its own open tag's end: no other element's end tag is involved.
      const own = open.pop() === end;
      if (isImplied && !own && regions > 0 && !SELF_ENDING.has(name)) unsure = true;
      if (DIVERGES.has(name)) regions -= 1;
    },
    inRegion: () => regions > 0 || unsure,
    endProbe() {
      if (regions > 0) unsure = true;
      probed = true;
      return END_PROBE;
    },
    comment(data, end) {
      if (probed && data === END_PROBE.slice(4, -3) && end === text.length + END_PROBE.length) reachedEnd = true;
    },
    ended: () => reachedEnd && !unsure && !text.endsWith('<'),
    unread: () => found,
  };
}

/** How often `data-worca-` appears in `html`, in any case: text a browser could read as a reserved attribute name. */
export function reservedTextCount(html) {
  const text = String(html ?? '');
  RESERVED_TEXT.lastIndex = 0;
  let n = 0;
  while (RESERVED_TEXT.exec(text)) n += 1;
  return n;
}

/**
 * An htmlparser2 Parser over `text`, bounded: it reads at most HTML_MAX_SCAN_LENGTH characters, and at the first open
 * tag nested deeper than HTML_MAX_DEPTH it pauses; from there on no handler runs. `read(beforeEnd)` parses, and only
 * when it read all of `text` calls `beforeEnd`, then `parser.end()`. It returns where reading stopped (`text.length`,
 * the `<` of the tag nested too deep, or the length bound) and why the rest is unread (null when nothing is).
 * @param {string} text
 * @param {object} handlers as for `new Parser`
 * @returns {{ parser: Parser, read: (beforeEnd?: () => void) => { stop: number, unread: null|'depth'|'size' } }}
 */
export function boundedParser(text, handlers) {
  let depth = 0;
  let cut = -1;
  const live = {};
  for (const [name, fn] of Object.entries(handlers)) live[name] = (...args) => (cut < 0 ? fn(...args) : undefined);
  const parser = new Parser({
    ...live,
    onopentagname(name) {
      if (cut >= 0) return;
      if (depth >= HTML_MAX_DEPTH) {
        cut = text.lastIndexOf('<', parser.endIndex - 1);
        parser.pause();
        return;
      }
      depth += 1;
      handlers.onopentagname?.(name);
    },
    onclosetag(name, isImplied) {
      if (cut >= 0) return;
      depth -= 1;
      handlers.onclosetag?.(name, isImplied);
    },
  });
  const read = (beforeEnd) => {
    const long = text.length > HTML_MAX_SCAN_LENGTH;
    parser.write(long ? text.slice(0, HTML_MAX_SCAN_LENGTH) : text);
    if (cut >= 0) return { stop: cut, unread: 'depth' };
    if (long) {
      cut = HTML_MAX_SCAN_LENGTH;
      return { stop: cut, unread: 'size' };
    }
    beforeEnd?.();
    parser.end();
    return { stop: text.length, unread: null };
  };
  return { parser, read };
}

/**
 * `value` without its leading and trailing C0 controls and spaces, which a URL parser strips first and String#trim
 * keeps (`&#1;https://…`). By index: a regex `[\x00-\x20]+$` retries every interior run of them, quadratic CPU.
 * @param {string} value
 * @returns {string}
 */
function urlEdgesStripped(value) {
  let start = 0;
  let end = value.length;
  while (start < end && value.charCodeAt(start) <= 0x20) start += 1;
  while (end > start && value.charCodeAt(end - 1) <= 0x20) end -= 1;
  return value.slice(start, end);
}

/**
 * What a reference in a design file points at. `local.rel` is POSIX, relative to work/, decoded and normalised,
 * and never climbs out of it or into a dot folder (`.kit`, `.asks`); everything else that could reach outside
 * work/ is `escaped`. Data, blob, about, mailto and tel URLs and bare fragments need nothing, so they are `skip`.
 * @param {unknown} ref
 * @returns {{ type: 'skip' }|{ type: 'remote' }|{ type: 'escaped' }|{ type: 'local', rel: string }}
 */
export function classifyRef(ref) {
  const value = urlEdgesStripped(String(ref ?? '')).replace(URL_DROPPED, '').trim();
  if (value === '' || value.startsWith('#') || SKIP_SCHEME.test(value)) return { type: 'skip' };
  if (REMOTE.test(value)) return { type: 'remote' };
  if (ANY_SCHEME.test(value) || value.startsWith('/') || value.startsWith('\\') || value.includes('\0')) return ESCAPED;
  let rel;
  try {
    rel = decodeURIComponent(value.split(/[?#]/, 1)[0]);
  } catch {
    return ESCAPED;
  }
  rel = posix.normalize(rel.replace(/\\/g, '/'));
  if (rel.includes('\0') || rel.startsWith('/') || DRIVE.test(rel) || rel.startsWith('..')) return ESCAPED;
  if (rel.split('/').some((segment) => segment.startsWith('.'))) return ESCAPED;
  return { type: 'local', rel };
}

/** A CSS string starting at `text[at]` (a quote): its content span, or null when a newline or the end comes first. */
function cssString(text, at) {
  const quote = text[at];
  for (let i = at + 1; i < text.length; i += 1) {
    if (text[i] === '\\') i += 1;
    else if (text[i] === quote) return { start: at + 1, end: i, next: i + 1 };
    else if (text[i] === '\n') return { start: at + 1, end: -1, next: i };
  }
  return { start: at + 1, end: -1, next: text.length };
}

const cssIdentChar = (ch) => ch !== undefined && (/[A-Za-z0-9_-]/.test(ch) || ch.charCodeAt(0) >= 0x80);
const skipCssSpace = (text, at) => { let i = at; while (i < text.length && CSS_SPACE.test(text[i])) i += 1; return i; };

/**
 * Every `url(…)` target and every `@import "…"` string in a stylesheet, in order. `[start, end)` spans only the
 * URL, quotes excluded, so a caller can replace it and keep the quotes. Comments, and strings anywhere but
 * inside `url()` or right after `@import`, are skipped. Values are the raw text: no CSS escape is decoded.
 * @param {string} css
 * @returns {{ value: string, start: number, end: number }[]}
 */
export function scanCssUrls(css) {
  const text = String(css ?? '');
  const out = [];
  const push = (start, end) => out.push({ value: text.slice(start, end), start, end });
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '/' && text[i + 1] === '*') {
      const close = text.indexOf('*/', i + 2);
      i = close === -1 ? text.length : close + 2;
    } else if (ch === '"' || ch === "'") {
      i = cssString(text, i).next;
    } else if (ch === '\\') {
      i += 2;
    } else if (/^url\(/i.test(text.slice(i, i + 4)) && !cssIdentChar(text[i - 1])) {
      const at = skipCssSpace(text, i + 4);
      if (text[at] === '"' || text[at] === "'") {
        const str = cssString(text, at);
        if (str.end >= 0) push(str.start, str.end);
        i = str.next;
        continue;
      }
      let end = at;
      while (end < text.length && !CSS_SPACE.test(text[end]) && !'()"\''.includes(text[end])) end += text[end] === '\\' ? 2 : 1;
      end = Math.min(end, text.length);
      const after = skipCssSpace(text, end);
      if (after >= text.length || text[after] === ')') push(at, end);
      i = after;
    } else if (/^@import/i.test(text.slice(i, i + 7)) && !cssIdentChar(text[i + 7])) {
      const at = skipCssSpace(text, i + 7);
      if (text[at] === '"' || text[at] === "'") {
        const str = cssString(text, at);
        if (str.end >= 0) push(str.start, str.end);
        i = str.next;
      } else {
        i = at;
      }
    } else {
      i += 1;
    }
  }
  return out;
}

/**
 * Each candidate URL of a raw `srcset` value: a run of non-space (trailing commas cut), descriptors to the next comma.
 * @param {string} raw
 * @returns {{ value: string, start: number, end: number }[]}
 */
export function srcsetUrls(raw) {
  const out = [];
  let i = 0;
  while (i < raw.length) {
    while (i < raw.length && (HTML_SPACE.test(raw[i]) || raw[i] === ',')) i += 1;
    const start = i;
    while (i < raw.length && !HTML_SPACE.test(raw[i])) i += 1;
    let end = i;
    if (raw[end - 1] === ',') {
      while (end > start && raw[end - 1] === ',') end -= 1;
    } else {
      while (i < raw.length && raw[i] !== ',') i += 1;
    }
    if (end > start) out.push({ value: raw.slice(start, end), start, end });
  }
  return out;
}

/**
 * One step from `text[at]`, token by token as a browser reads CSS: past a whole comment, a string (one broken by a
 * newline ends there), an unquoted `url(…)` (where `/*`, quotes and braces are plain text) or an escape, else one
 * character. -1 when a comment or an unquoted `url(` never closes; a string left open runs to the end.
 */
function cssStep(text, at) {
  const ch = text[at];
  if (ch === '/' && text[at + 1] === '*') {
    const close = text.indexOf('*/', at + 2);
    return close === -1 ? -1 : close + 2;
  }
  if (ch === '"' || ch === "'") return cssString(text, at).next;
  if (ch === '\\') return Math.min(at + 2, text.length);
  if ((ch === 'u' || ch === 'U') && /^url\(/i.test(text.slice(at, at + 4)) && !cssIdentChar(text[at - 1])) {
    const open = skipCssSpace(text, at + 4);
    if (text[open] !== '"' && text[open] !== "'") {
      for (let i = open; i < text.length; i += 1) {
        if (text[i] === '\\') i += 1;
        else if (text[i] === ')') return i + 1;
      }
      return -1;
    }
  }
  return at + 1;
}

/**
 * Reads a rule prelude from `at` to the first `{` outside `()`, `[]`, strings and comments, or, when `atRule`,
 * a `;` there; a `}` there ends it too when `nested`. Comments are dropped from `text`.
 * @returns {{ text: string, stop: '{'|';'|'}'|'', next: number }} `stop` '' when the text ends or a token never does
 */
function cssPrelude(css, at, atRule, nested) {
  let out = '';
  let depth = 0;
  let i = at;
  while (i < css.length) {
    const ch = css[i];
    if (depth === 0 && (ch === '{' || (atRule && ch === ';') || (nested && ch === '}'))) return { text: out, stop: ch, next: i };
    if (ch === '(' || ch === '[') depth += 1;
    else if ((ch === ')' || ch === ']') && depth > 0) depth -= 1;
    const next = cssStep(css, i);
    if (next === -1) return { text: out, stop: '', next: css.length };
    if (!(ch === '/' && css[i + 1] === '*')) out += css.slice(i, next);
    i = next;
  }
  return { text: out, stop: '', next: css.length };
}

/** The index just past the `}` closing the block whose body starts at `at`, or -1 when it never closes. */
function cssBlockEnd(css, at) {
  let depth = 1;
  let i = at;
  while (i < css.length) {
    const ch = css[i];
    if (ch === '{') depth += 1;
    else if (ch === '}' && (depth -= 1) === 0) return i + 1;
    i = cssStep(css, i);
    if (i === -1) return -1;
  }
  return -1;
}

/** A selector list split on commas outside `()`, `[]` and strings, each trimmed; empty pieces dropped. */
function splitSelectors(prelude) {
  const out = [];
  let depth = 0;
  let start = 0;
  let i = 0;
  while (i < prelude.length) {
    const ch = prelude[i];
    if (ch === '(' || ch === '[') depth += 1;
    else if ((ch === ')' || ch === ']') && depth > 0) depth -= 1;
    else if (ch === ',' && depth === 0) {
      out.push(prelude.slice(start, i));
      start = i + 1;
    }
    i = ch === '"' || ch === "'" ? cssString(prelude, i).next : ch === '\\' ? i + 2 : i + 1;
  }
  out.push(prelude.slice(start));
  return out.map((s) => s.trim()).filter(Boolean);
}

/** `css` with every comment, string, `url()` and escape turned into spaces, so a length is only ever a real one. */
function blankCss(css) {
  const chars = css.split('');
  const wipe = (from, to) => { for (let k = from; k < to; k += 1) if (chars[k] !== '\n') chars[k] = ' '; };
  let i = 0;
  while (i < css.length) {
    const next = cssStep(css, i);
    if (next === -1) { wipe(i, css.length); break; }
    if (next > i + 1) wipe(i, next);
    i = next;
  }
  return chars.join('');
}

/**
 * What lint needs from a stylesheet, by a hand scanner aware of comments, strings and `url()` that never throws:
 * an unterminated comment, string, `url(` or block ends the scan.
 * - `selectors`: each style rule's selectors, at the top level and inside `@media`, `@supports`, `@container` and
 *   `@layer` blocks, split on commas outside `()`, `[]` and strings. Style rule bodies are skipped, so nested rules
 *   are not listed; so are `@font-face` and every other at-rule body.
 * - `keyframes`: each `@keyframes` (or vendor `@-webkit-keyframes`) name, unquoted.
 * - `urls`: every `url()` value and each `@import` target once, over the whole text (`scanCssUrls`).
 * - `vh`: a viewport-height length anywhere outside comments, strings and URLs.
 * @param {string} css
 * @returns {{ selectors: string[], keyframes: string[], urls: string[], vh: boolean }}
 */
export function scanCss(css) {
  const text = String(css ?? '');
  const selectors = [];
  const keyframes = [];
  let nested = 0;
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (CSS_SPACE.test(ch)) { i += 1; continue; }
    if (ch === '}') { if (nested > 0) nested -= 1; i += 1; continue; }
    if (ch === '/' && text[i + 1] === '*') { i = cssStep(text, i); if (i === -1) break; continue; }
    if (ch === '@') {
      let n = i + 1;
      while (cssIdentChar(text[n])) n += 1;
      const name = text.slice(i + 1, n).toLowerCase();
      const pre = cssPrelude(text, n, true, nested > 0);
      if (pre.stop === '') break;
      if (pre.stop !== '{') { i = pre.next + (pre.stop === ';' ? 1 : 0); continue; }
      if (CSS_GROUP_RULES.has(name)) { nested += 1; i = pre.next + 1; continue; }
      if (CSS_KEYFRAMES.test(name)) {
        const label = pre.text.trim();
        keyframes.push(/^(["']).*\1$/s.test(label) ? label.slice(1, -1) : label);
      }
      i = cssBlockEnd(text, pre.next + 1);
      if (i === -1) break;
      continue;
    }
    const pre = cssPrelude(text, i, false, nested > 0);
    if (pre.stop === '}') { i = pre.next; continue; }
    if (pre.stop === '') break;
    for (const selector of splitSelectors(pre.text)) selectors.push(selector);
    i = cssBlockEnd(text, pre.next + 1);
    if (i === -1) break;
  }
  return { selectors, keyframes, urls: scanCssUrls(text).map((u) => u.value), vh: CSS_VH.test(blankCss(text)) };
}

/**
 * Walks `text` and reports element spans. `onopen(name, start)` returns a frame (any object) or null;
 * `onclose(frame, end, isImplied)` gets it back with the element's exclusive end: just past its own close
 * tag, where the tag that implied its close starts, or the end of the text. Offsets come from the markup
 * itself, because htmlparser2's `startIndex` points at the `>` of a preceding `</x >`.
 * It is bounded (boundedParser): where it stops reading, every frame still open closes, implied.
 * @param {string} text
 * @param {{ onopen: (name: string, start: number) => object|null, onclose: (frame: object, end: number, isImplied: boolean) => void }} cbs
 * @param {object} [extra] more htmlparser2 handlers; `onopentagname` runs before the frame is opened
 * @returns {number} where the walk stopped: `text.length` when it read all of it
 */
function walkElements(text, { onopen, onclose }, extra = {}) {
  const stack = [];
  let atEof = false;
  const { parser, read } = boundedParser(text, {
    ...extra,
    onopentagname(name) {
      extra.onopentagname?.(name);
      const start = text.lastIndexOf('<', parser.endIndex - 1);
      stack.push({ name, parserStart: parser.startIndex, frame: onopen(name, start) });
    },
    onclosetag(name, isImplied) {
      // A void tag left unfinished at the end of the text never closes itself: it ends there.
      let i = stack.length - 1;
      while (i >= 0 && stack[i].name !== name) i -= 1;
      if (i < 0) return;
      const [el, ...unfinished] = stack.splice(i);
      for (const u of unfinished) if (u.frame) onclose(u.frame, text.length, true);
      if (!el.frame) return;
      let end;
      if (atEof) end = text.length;
      else if (isImplied && parser.startIndex !== el.parserStart) end = text.lastIndexOf('<', parser.endIndex - 1);
      else { const gt = text.indexOf('>', parser.endIndex); end = gt === -1 ? text.length : gt + 1; }
      onclose(el.frame, end, isImplied);
    },
  });
  const { stop } = read(() => { atEof = true; });
  for (const el of stack) if (el.frame) onclose(el.frame, stop, true);
  return stop;
}

/**
 * Removes every `script`, `iframe`, `object` and `embed` element, open tag to end, for build mode.
 * An unclosed `object` ends where its parent closes, and that close tag stays. Any such open tag the parser did
 * not see as one is escaped to text. What a bounded scan leaves unread (past HTML_MAX_DEPTH or HTML_MAX_SCAN_LENGTH)
 * is dropped, from there to the end.
 * @param {string} html
 * @returns {string}
 */
export function stripActive(html) {
  const text = String(html ?? '');
  const spans = [];
  const stop = walkElements(text, {
    onopen: (name, start) => (ACTIVE.has(name) ? { start } : null),
    onclose: (frame, end) => { spans.push([frame.start, end]); },
  });
  spans.sort((a, b) => a[0] - b[0] || b[1] - a[1]);
  let out = '';
  let at = 0;
  for (const [start, end] of spans) {
    if (end <= at) continue;
    out += text.slice(at, Math.max(at, start));
    at = end;
  }
  return escapeActive(out + text.slice(at, Math.max(at, stop)));
}

/**
 * Turns every `script`, `iframe`, `object` and `embed` open tag in `html` into text, whatever a parser makes of the
 * rest: unbounded and linear, for text whose pieces stripActive has already stripped (build's spliced page).
 * @param {string} html
 * @returns {string}
 */
export function escapeActive(html) {
  return String(html ?? '').replace(ACTIVE_OPEN, () => '&lt;');
}

/**
 * Every element carrying `data-worca-slot`, in document order. `[start, end)` spans the whole element.
 * `ok`: a `div` with a non-empty id, closed by its own `</div>`, holding only whitespace text.
 * @param {string} html
 * @returns {{ id: string, start: number, end: number, ok: boolean, extraAttrs: boolean }[]}
 */
export function scanShellSlots(html) {
  const text = String(html ?? '');
  const entries = [];
  let pending = null;
  // A slot is clean when no content event came between its open tag and its close: one counter, compared at the
  // close, so each event costs O(1) however many slots are open.
  let events = 0;
  const dirty = () => { events += 1; };
  walkElements(text, {
    onopen: (name, start) => {
      pending = { name, start, slot: null };
      return pending;
    },
    onclose: (frame, end, isImplied) => {
      const { slot } = frame;
      if (!slot) return;
      slot.entry.end = end;
      slot.entry.ok = frame.name === 'div' && slot.entry.id !== '' && !isImplied && events === slot.events;
    },
  }, {
    onopentagname: () => dirty(),
    onopentag(name, attribs) {
      if (!pending || !Object.hasOwn(attribs, SLOT_ATTR)) return;
      const entry = { id: attribs[SLOT_ATTR], start: pending.start, end: text.length, ok: false,
        extraAttrs: Object.keys(attribs).some((key) => key !== SLOT_ATTR) };
      entries.push(entry);
      pending.slot = { entry, events };
    },
    ontext(data) { if (NOT_SPACE.test(data)) dirty(); },
    oncomment: () => dirty(),
    onprocessinginstruction: () => dirty(),
  });
  return entries;
}

/**
 * What lint needs from an HTML file, read through the parser's open tags only: an element the parser drops
 * (a second `<form>` inside an open one, as a browser does) has no attributes here.
 * - `roots`: the depth-0 elements, `attrs` holding their lower-cased attribute names and decoded values.
 * - `strayText`: the depth-0 text when any of it is not HTML whitespace, else ''.
 * - `ids`: every `id` attribute, in document order.
 * - `refs`: every reference the page loads (LOADED_ATTRS, each `srcset` candidate, and each
 *   `url()` in a `style=` value or a `<style>` body) as `nav: false`, and each `a[href]`, `area[href]` and
 *   `form[action]` as `nav: true`, in document order.
 * - `reserved`: every attribute whose name starts `data-worca-`.
 * - `unread`: why part of the file, or what follows it in the page, is not read as a browser reads it, else null:
 *   `'cdata'`, `'control'`, `'endtag'` or `'rawtext'` where htmlparser2 and a browser can read it differently
 *   (divergenceWatch), `'depth'` or `'size'` where the bounded scan stopped (boundedParser), and `'unclosed'` when it
 *   does not end between tokens with every svg, math, select, frameset and template closed by its own end tag
 *   (divergenceWatch `ended`), so the next section or the rest of the shell would be read in another context.
 *   The other fields cover only what htmlparser2 read.
 * @param {string} html
 * @returns {{ roots: { name: string, attrs: Record<string, string> }[], strayText: string, ids: string[], refs: { value: string, nav: boolean }[], reserved: { tag: string, name: string, value: string }[], unread: null|'cdata'|'control'|'endtag'|'rawtext'|'depth'|'size'|'unclosed' }}
 */
export function scanHtml(html) {
  const text = String(html ?? '');
  const roots = [];
  const stray = [];
  const ids = [];
  const refs = [];
  const reserved = [];
  const loaded = (value) => refs.push({ value, nav: false });
  let depth = 0;
  let openedAt = -1;
  let style = null;
  let probing = false;
  const watch = divergenceWatch(text);
  const { parser, read } = boundedParser(text, {
    oncomment(data) {
      watch.comment(data, parser.endIndex + 1);
    },
    onopentagname() {
      openedAt = depth;
      depth += 1;
    },
    onopentag(name, attribs) {
      if (probing) return;
      watch.open(name, parser.endIndex + 1);
      if (openedAt === 0) roots.push({ name, attrs: { ...attribs } });
      openedAt = -1;
      for (const [attr, value] of Object.entries(attribs)) {
        if (attr === 'id') ids.push(value);
        if (attr.startsWith(RESERVED_PREFIX)) reserved.push({ tag: name, name: attr, value });
        if (attr === 'style') for (const u of scanCssUrls(value)) loaded(u.value);
        else if (NAV_ATTRS.get(name) === attr) refs.push({ value, nav: true });
        else if (attr === 'srcset' && LOADED_ATTRS.get(name)?.includes(attr)) for (const u of srcsetUrls(value)) loaded(u.value);
        else if (LOADED_ATTRS.get(name)?.includes(attr)) loaded(value);
      }
      if (name === 'style') style = [];
    },
    ontext(data) {
      // The probe flushes the text the file ends on (a trailing `<` or `&amp`): that text is still the file's own.
      if (probing && parser.endIndex >= text.length) return;
      if (style) style.push(data);
      else if (depth === 0) stray.push(data);
    },
    onclosetag(name, isImplied) {
      watch.close(name, isImplied, parser.endIndex + 1);
      depth = Math.max(0, depth - 1);
      if (probing || name !== 'style' || !style) return;
      for (const u of scanCssUrls(style.join(''))) loaded(u.value);
      style = null;
    },
  });
  // The probe goes in after the text, so it reads only how the file ends; the fields above ignore it.
  const stopped = read(() => { probing = true; parser.write(watch.endProbe()); }).unread;
  const strayText = stray.join('');
  const unread = watch.unread() ?? stopped ?? (watch.ended() ? null : 'unclosed');
  return { roots, strayText: NOT_SPACE.test(strayText) ? strayText : '', ids, refs, reserved, unread };
}
