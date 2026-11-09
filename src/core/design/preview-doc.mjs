// src/core/design/preview-doc.mjs
// The preview docs of a Design (P3, SPEC C-7). The first part holds the three pure pieces the gate uses on every
// token-verified response: the `{B}` source (`previewBase`), C-7's exact CSP strings (`previewCsp`) and its six
// response headers (`previewHeaders`). The second part builds the docs themselves at serve time, in memory only:
// the bridge `<script>` (M10), the build doc's second strip pass, and `renderPreviewDoc` on P1's assembler.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { Parser } from 'htmlparser2';
import { assembleDesign, BRIDGE_MARKER, readConfined } from './assemble.mjs';
import { HTML_MAX_DEPTH } from './html-scan.mjs';
import { validatePlan } from './plan.mjs';

/** A DNS name or IPv4 address with an optional port. Anything else could inject a CSP directive (L3.3). */
const NAMED_HOST_RE = /^[A-Za-z0-9.-]+(:\d{1,5})?$/;
/** A bracketed IPv6 literal with an optional port. A CSP host-source has no IPv6 form, so it gets no `{B}` (L3.12). */
const IPV6_HOST_RE = /^\[[0-9A-Fa-f:.]+\](:\d{1,5})?$/;
const PROTOS = new Set(['http', 'https']);

/**
 * Works out `{B}` = `<proto>://<host>/design-preview/<token>/` for the CSP.
 * `hostGuard` parses the Host with `new URL`, so `localhost/;script-src *` passes it: the Host is checked again here,
 * and every Host that is neither a plain name nor a bracketed IPv6 literal (including `''` and a non-string) is refused.
 * The proto is the first comma-separated value of `forwardedProto`, trimmed and lowercased, when it is exactly `http`
 * or `https`; otherwise `protocol` when it is one of those; otherwise `http`. `X-Forwarded-Proto` is read for `{B}`
 * only (L3.10): a spoofed value can break only the sender's own CSP.
 * @param {{ host?: unknown, forwardedProto?: unknown, protocol?: unknown, token: string }} req
 *   `token` has already passed the grant check, so it is base64url.
 * @returns {{ ok: false } | { ok: true, base: string | null }} `base: null` for an IPv6 Host.
 */
export function previewBase({ host, forwardedProto, protocol, token }) {
  if (typeof host !== 'string') return { ok: false };
  if (IPV6_HOST_RE.test(host)) return { ok: true, base: null };
  if (!NAMED_HOST_RE.test(host)) return { ok: false };
  const forwarded = typeof forwardedProto === 'string' ? forwardedProto.split(',')[0].trim().toLowerCase() : '';
  const proto = PROTOS.has(forwarded) ? forwarded : PROTOS.has(protocol) ? protocol : 'http';
  return { ok: true, base: `${proto}://${host}/design-preview/${token}/` };
}

/** One directive: its name and the sources that are present, so a missing `{B}` leaves no gap. */
const directive = (name, ...sources) => [name, ...sources.filter(Boolean)].join(' ');

/**
 * C-7's CSP, byte for byte. The build doc admits only the nonced bridge; the run doc admits inline scripts and
 * scripts under `{B}`, and must carry no nonce, which would disable `'unsafe-inline'`. With `base: null` (IPv6) every
 * `{B}` source is left out and the run doc's `connect-src` is `'none'`. No other directive is added.
 * @param {{ mode: 'build' | 'run', base: string | null, nonce: string }} opts `nonce` is the gate's base64url nonce;
 *   any mode other than `run` gets the build policy.
 * @returns {string}
 */
export function previewCsp({ mode, base, nonce }) {
  const run = mode === 'run';
  const b = base || '';
  return [
    'sandbox allow-scripts',
    "default-src 'none'",
    run ? directive('script-src', "'unsafe-inline'", b) : `script-src 'nonce-${nonce}'`,
    directive('style-src', "'unsafe-inline'", b),
    directive('img-src', b, 'data:', 'blob:'),
    directive('font-src', b, 'data:'),
    directive('media-src', b, 'data:', 'blob:'),
    `connect-src ${run && b ? b : "'none'"}`,
    "frame-src 'none'",
    "object-src 'none'",
    "form-action 'none'",
    "base-uri 'none'",
  ].join('; ');
}

/**
 * C-7's six headers, set on every token-verified response (doc and file alike).
 * @param {{ csp: string }} opts
 * @returns {Record<string, string>}
 */
export function previewHeaders({ csp }) {
  return {
    'Content-Security-Policy': csp,
    'Access-Control-Allow-Origin': '*',
    'Cross-Origin-Resource-Policy': 'cross-origin',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Cache-Control': 'no-store',
  };
}

/** The bridge (C-6): a classic script, read as text and never imported. */
const BRIDGE_URL = new URL('./preview/bridge.js', import.meta.url);
/** morphdom's UMD build, the build doc's one dependency, inlined before the bridge (L3.8). */
const MORPHDOM_ID = 'morphdom/dist/morphdom-umd.min.js';
/** A CSP nonce-source value (base64 or base64url): anything else could break out of the `nonce` attribute. */
const NONCE_RE = /^[A-Za-z0-9+/_-]+={0,2}$/;

// Both files are read at the first doc and kept: a missing one throws there, which the gate turns into a 500, and
// never at server boot.
let bridgeText = null;
let morphdomText = null;
const bridgeScript = () => (bridgeText ??= safeInlineScript(readFileSync(BRIDGE_URL, 'utf8')));
/**
 * The `document` morphdom is given (`morphdomScript`): the members it reads off `document` (`createElement`,
 * `createElementNS` and `createRange` when it loads and when it makes a node, the `body` getter when it parses a string),
 * taken from the real document's prototype chain and called on it. Document's named properties override its built-ins,
 * and shell markup before an explicit `<head>` is in the doc before the bridge script runs: `<img name="createElement">`
 * there would make morphdom's first read throw, which stops the whole script, on every reload.
 */
const MORPHDOM_DOCUMENT = `(function (doc) {
  function real(name) {
    for (var p = Object.getPrototypeOf(doc); p; p = Object.getPrototypeOf(p)) {
      var desc = Object.getOwnPropertyDescriptor(p, name);
      if (desc) return desc.get || desc.value;
    }
  }
  var createElement = real('createElement');
  var createElementNS = real('createElementNS');
  var createRange = real('createRange');
  var body = real('body');
  return {
    createElement: function (name) { return createElement.call(doc, name); },
    createElementNS: function (ns, name) { return createElementNS.call(doc, ns, name); },
    createRange: function () { return createRange.call(doc); },
    get body() { return body.call(doc); },
  };
})(document)`;
/**
 * morphdom's UMD inside a function whose `module`, `exports`, `define` and `document` are its own parameters, called with
 * the window as `this`: the first three undefined, `document` the real document's own members (`MORPHDOM_DOCUMENT`).
 * Unwrapped, the UMD reads those names as globals, which window named properties supply: a shell
 * `<html id="exports"><head id="module">` (parsed before the bridge) steers it into its CommonJS branch, and
 * `window.morphdom` is never set.
 */
const morphdomScript = () => (morphdomText ??= safeInlineScript(
  `(function (module, exports, define, document) {\n${readFileSync(createRequire(import.meta.url).resolve(MORPHDOM_ID), 'utf8')}\n}).call(window, undefined, undefined, undefined, ${MORPHDOM_DOCUMENT});`));

/**
 * Makes script text safe inside one `<script>` element: every `</script` (any case, kept) becomes `<\/script`, so it
 * cannot close its own element, and every `<!--` becomes `<\!--`, so it cannot start the tokenizer's escaped state.
 * Both mean the same in JS strings, template literals, comments and regexes without the `u` or `v` flag (where `\!`
 * is a syntax error).
 * @param {string} js
 * @returns {string}
 */
export function safeInlineScript(js) {
  return String(js ?? '').replace(/<\/(script)/gi, (_, name) => `<\\/${name}`).replace(/<!--/g, () => '<\\!--');
}

/**
 * The bridge as one complete `<script data-worca-bridge>` element (M10): the `bridge` option of P1's assembler. The
 * build doc's carries the response's nonce, then morphdom (wrapped, `morphdomScript`), a newline and the bridge. The
 * run doc's carries the bridge only: a nonce would disable the run CSP's `'unsafe-inline'`, and the run doc merges
 * nothing.
 * @param {{ mode: 'build' | 'run', nonce?: string }} opts `nonce` (build only) is the gate's base64url nonce.
 * @returns {string}
 */
export function bridgeScriptTag({ mode, nonce } = {}) {
  if (mode === 'run') return `<script ${BRIDGE_MARKER}>${bridgeScript()}</script>`;
  if (mode !== 'build') throw new TypeError(`bridgeScriptTag: mode must be "build" or "run", not ${String(mode)}`);
  if (typeof nonce !== 'string' || !NONCE_RE.test(nonce)) throw new TypeError('bridgeScriptTag: the build doc needs a base64 nonce');
  return `<script ${BRIDGE_MARKER} nonce="${nonce}">${morphdomScript()}\n${bridgeScript()}</script>`;
}

/**
 * Elements the build doc drops whole, through their close tag: they run code or load another document (L3.5), and
 * `noscript`, which the frame never shows (`allow-scripts` turns scripting on) and which a browser reads as raw text
 * where htmlparser2 reads markup.
 */
const DROP_WHOLE = new Set(['script', 'iframe', 'frame', 'frameset', 'object', 'embed', 'applet', 'noscript']);
/** SVG animations, dropped whole when they animate a link's `href`: the browser follows the animated value. */
const ANIMATIONS = new Set(['set', 'animate']);
/**
 * The most elements the build doc may hold open: a shell and a section each at P1's bound. htmlparser2 keeps its open
 * elements in an array that every tag shifts or searches, so each tag costs the depth; P1 bounds each piece, but a
 * raw-text element left open in one section can swallow the next one's `<!--`, and the joined doc then nests without
 * bound.
 */
const BUILD_MAX_DEPTH = 2 * HTML_MAX_DEPTH;
/** Attributes whose URL a `javascript:` or `vbscript:` value turns into code: the bridge's `URL_ATTRS` (Task 6). */
const URL_ATTRS = new Set(['href', 'xlink:href', 'src', 'action', 'formaction', 'data']);
/** The URL parser trims code points 0 to 32 and drops tabs and newlines inside a scheme: all go before the test. */
const URL_JUNK_RE = /[\x00-\x20]/g;
const SCRIPT_URL_RE = /^(?:javascript|vbscript):/i;
/** One code unit `String.prototype.trim` strips: `\s` is the same set (WhiteSpace and LineTerminator). */
const JS_SPACE_RE = /\s/;

/** The HTML parser compares names ASCII-case-insensitively. */
const asciiLower = (s) => s.replace(/[A-Z]/g, (c) => c.toLowerCase());
const escapeAttr = (v) => v.replace(/&/g, '&amp;').replace(/"/g, '&quot;');

/** Where the run of space (`JS_SPACE_RE`) that ends at `to` starts: `to` itself when `s[to - 1]` is no space. */
function spaceBefore(s, to) {
  let i = to;
  while (i > 0 && JS_SPACE_RE.test(s[i - 1])) i -= 1;
  return i;
}

/**
 * Whether `s[from, to)` names `href` as an `attributeName` value does (the bridge's rule): trimmed as `trim` trims and
 * lower-cased, it is `href` or ends in `:href` (`xlink:href` or any other prefix). Only the value's ends are read (its
 * last four characters, the one before them, its leading space), never all of it: the escape pass meets values that run
 * to the end of the text, once per opener inside them.
 * @param {string} s
 * @param {number} from
 * @param {number} to
 * @param {(to: number) => number} [end] `spaceBefore(s, to)`, which the escape pass keeps per `to`
 */
function namesHref(s, from, to, end = (at) => spaceBefore(s, at)) {
  if (to - from < 4) return false;
  const last = end(to);
  if (last - from < 4 || asciiLower(s.slice(last - 4, last)) !== 'href') return false;
  if (last - 4 === from || s[last - 5] === ':') return true;
  let i = from;
  while (i < last - 4 && JS_SPACE_RE.test(s[i])) i += 1;
  return i === last - 4;
}

/**
 * An `attributeName` that makes a `set` or `animate` animate `href` (the bridge's rule). A value still holding `&` (one
 * the HTML tokenizer has not decoded yet) counts too.
 * @param {string} key the attribute name, lower-cased
 * @param {string} value
 */
const animatesHref = (key, value) => key === 'attributename' && (value.includes('&') || namesHref(value, 0, value.length));
/**
 * A declarative shadow root the bridge's click guard cannot see into: the composed path at the window leaves out a
 * closed root. So `shadowroot` (the old name) goes, and `shadowrootmode` unless it is `open`. The length is compared
 * first, so a long value costs nothing.
 * @param {string} key the attribute name, lower-cased
 * @param {string} value
 */
const closedShadow = (key, value) => key === 'shadowroot' || (key === 'shadowrootmode' && (value.length !== 4 || asciiLower(value) !== 'open'));

/**
 * An `on*` handler, a URL attribute holding a script URL, or `form`: the bridge's `strip` rule (Task 6). `form` joins a
 * control to a form anywhere in the doc, whose named controls then override what morphdom walks while the bridge merges
 * a section; without it a control joins only its ancestor form. On a `template`, also an attribute opening a closed
 * shadow root.
 * @param {[string, string]} attr
 * @param {string} tagName lower-case
 */
function hostileAttr([name, value], tagName) {
  const key = asciiLower(name);
  return key.startsWith('on') || key === 'form' || (URL_ATTRS.has(key) && SCRIPT_URL_RE.test(value.replace(URL_JUNK_RE, '')))
    || (tagName === 'template' && closedShadow(key, value));
}

/** The value of the first attribute named `key` (lower-case), or undefined: the HTML parser keeps the first. */
function firstAttr(attrs, key) {
  return attrs.find(([name]) => asciiLower(name) === key)?.[1];
}

/**
 * A start tag rebuilt without its hostile attributes. The tag name is copied as written; each kept attribute keeps
 * its source name (`viewBox`) and its first occurrence only, and a value is written double-quoted with `&` and `"`
 * escaped (htmlparser2 has decoded it). A source `/>` stays `/>`.
 * @param {string} text
 * @param {{ start: number, nameEnd: number, attrsEnd: number, attrs: Array<[string, string, string|null|undefined]> }} tag
 * @param {number} end past the tag's `>`
 * @param {string} tagName lower-case
 */
function rebuildTag(text, tag, end, tagName) {
  const seen = new Set();
  let out = text.slice(tag.start, tag.nameEnd);
  for (const [name, value, quote] of tag.attrs) {
    const key = asciiLower(name);
    if (seen.has(key)) continue;
    seen.add(key);
    if (hostileAttr([name, value], tagName)) continue;
    out += quote === undefined ? ` ${name}` : ` ${name}="${escapeAttr(value)}"`;
  }
  const selfClosing = end - 2 >= tag.attrsEnd && text[end - 2] === '/';
  return out + (selfClosing ? '/>' : '>');
}

/**
 * An opener the escape pass looks at: one of these names, then what ends a tag name (or the end of the text). The last
 * seven are the controls a `form` attribute joins to a form.
 */
const HIDDEN_OPEN_RE = /<(noscript|base|meta|set|animate|template|button|fieldset|input|object|output|select|textarea)(?=[\t\n\f\r />]|$)/gi;
const HTTP_EQUIV = 1;
const CLOSED_SHADOW = 2;
const HREF_ANIMATION = 4;
const FORM_OWNER = 8;
/** What the escape pass decides on, by opener: `noscript` and `base` always go, the rest by their attributes. */
const HIDDEN_NEEDS = { meta: HTTP_EQUIV, template: CLOSED_SHADOW, set: HREF_ANIMATION, animate: HREF_ANIMATION, button: FORM_OWNER,
  fieldset: FORM_OWNER, input: FORM_OWNER, object: FORM_OWNER, output: FORM_OWNER, select: FORM_OWNER, textarea: FORM_OWNER };
const isTagSpace = (c) => c === 9 || c === 10 || c === 12 || c === 13 || c === 32;

/**
 * The escape pass's reads of a value `s[from, to)`, none of which grows with the value's length: `amp(from, to)`, whether it
 * holds a `&` (a binary search over every `&` of `s`, listed at the first call), and `end(to)`, `spaceBefore(s, to)`, kept
 * per `to` (values end at shared places: every unquoted one an opener starts inside another runs to the same end).
 * @param {string} s
 * @returns {{ amp: (from: number, to: number) => boolean, end: (to: number) => number }}
 */
function valueReads(s) {
  let amps = null;
  const ends = new Map();
  return {
    amp(from, to) {
      if (amps === null) {
        amps = [];
        for (let i = s.indexOf('&'); i !== -1; i = s.indexOf('&', i + 1)) amps.push(i);
      }
      let lo = 0;
      let hi = amps.length;
      while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if (amps[mid] < from) lo = mid + 1;
        else hi = mid;
      }
      return lo < amps.length && amps[lo] < to;
    },
    end(to) {
      let at = ends.get(to);
      if (at === undefined) {
        at = spaceBefore(s, to);
        ends.set(to, at);
      }
      return at;
    },
  };
}

/**
 * The escape-pass flags of one attribute, whose raw value (the tokenizer decodes it later) is `s[from, to)`: the rules of
 * `closedShadow` and `animatesHref`, with work independent of the value's length. A `shadowrootmode` value's first five
 * characters decide (a longer one is not `open`).
 * @param {string} name
 * @param {string} s
 * @param {number} from
 * @param {number} to
 * @param {ReturnType<typeof valueReads>} reads
 */
function attrFlags(name, s, from, to, reads) {
  const key = asciiLower(name);
  if (key === 'http-equiv') return HTTP_EQUIV;
  if (key === 'form') return FORM_OWNER;
  if (closedShadow(key, s.slice(from, Math.min(to, from + 5)))) return CLOSED_SHADOW;
  return key === 'attributename' && (reads.amp(from, to) || namesHref(s, from, to, reads.end)) ? HREF_ANIMATION : 0;
}

/**
 * Where an unquoted attribute value ends, for one escape pass over `s`: `(floor, j)` is the first tag space or `>` at or
 * after `j`, or `s.length`. Every character is scanned once: `stops` holds each such position from where the current
 * run of walks began up to `seen`, in order, so a value starting inside a run another walk crossed is a binary search.
 * `floor` is the start of the walk asking; walks start in order and never look behind their start, so one starting at
 * or past `seen` drops what is behind it.
 * @param {string} s
 * @returns {(floor: number, j: number) => number}
 */
function valueEnds(s) {
  const STOP_RE = /[\t\n\f\r >]/g;
  let stops = [];
  let seen = 0;
  return (floor, j) => {
    if (floor >= seen) {
      stops = [];
      seen = floor;
    }
    let lo = 0;
    let hi = stops.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (stops[mid] < j) lo = mid + 1;
      else hi = mid;
    }
    if (lo < stops.length) return stops[lo];
    STOP_RE.lastIndex = seen;
    for (let m; (m = STOP_RE.exec(s)) !== null;) {
      stops.push(m.index);
      seen = m.index + 1;
      if (m.index >= j) return m.index;
    }
    seen = s.length;
    return s.length;
  };
}

/**
 * The flags of the attributes of a start tag whose name ends at `j`, read as the HTML tokenizer reads them from there:
 * a name runs to a space, `/`, `>` or `=` (its first character may be `=`); a value is quoted, or runs to a space or
 * `>`; a `/` between attributes is skipped; the tag ends at a `>` outside any value, or at the end of the text.
 * Linear over every opener of a text: `memo` maps each position where the walk looks for an attribute (before and
 * after the space and `/` it skips there) to the flags from there to its tag's end, and the walks of openers inside one
 * long tag meet there: every unquoted value an opener starts inside another ends where that one's does, before the
 * same run of space. `valueEnd` (from `valueEnds`) finds the end of an unquoted value, which openers inside it would
 * each walk to again, and `reads` (from `valueReads`) reads that value without walking it.
 * @param {string} s
 * @param {number} j
 * @param {Map<number, number>} memo
 * @param {(floor: number, j: number) => number} valueEnd
 * @param {ReturnType<typeof valueReads>} reads
 * @returns {number}
 */
function tagFlags(s, j, memo, valueEnd, reads) {
  const n = s.length;
  const floor = j;
  /** `[position, flags of the attribute read from there, or 0]` for every position memoised below, in walk order. */
  const path = [];
  let flags = 0;
  for (;;) {
    let known = memo.get(j);
    if (known === undefined) {
      path.push([j, 0]);
      while (j < n && (isTagSpace(s.charCodeAt(j)) || s.charCodeAt(j) === 47)) j += 1;
      if (j >= n || s.charCodeAt(j) === 62) break;
      known = memo.get(j);
    }
    if (known !== undefined) {
      flags = known;
      break;
    }
    const start = j;
    for (j += 1; j < n; j += 1) {
      const c = s.charCodeAt(j);
      if (isTagSpace(c) || c === 47 || c === 62 || c === 61) break;
    }
    const name = s.slice(start, j);
    while (j < n && isTagSpace(s.charCodeAt(j))) j += 1;
    let from = j;
    let to = j;
    if (s.charCodeAt(j) === 61) {
      j += 1;
      while (j < n && isTagSpace(s.charCodeAt(j))) j += 1;
      const q = s.charCodeAt(j);
      if (q === 34 || q === 39) {
        const close = s.indexOf(s[j], j + 1);
        from = j + 1;
        to = close === -1 ? n : close;
        j = to + 1;
      } else {
        from = j;
        j = valueEnd(floor, j);
        to = j;
      }
    }
    path.push([start, attrFlags(name, s, from, to, reads)]);
  }
  for (let i = path.length - 1; i >= 0; i -= 1) {
    flags |= path[i][1];
    memo.set(path[i][0], flags);
  }
  return flags;
}

/**
 * The build doc's last pass, with no context at all (as P1's `escapeActive`): htmlparser2 never reads `<noscript>` as
 * raw text, which a browser with scripting on does, and it ignores the MathML and SVG integration points, so markup it
 * reads as text or an attribute value can still build an element. Outside the `keep` ranges (the bridge), every
 * `<noscript` and `<base` opener, every `<meta` with `http-equiv`, every `<set`/`<animate` of `href`, every
 * `<template` opening a closed shadow root and every form control (`button`, `fieldset`, `input`, `object`, `output`,
 * `select`, `textarea`) with a `form` attribute becomes `&lt;…`: text where a browser would have built the element, and
 * the same `<` inside an attribute value or escapable text.
 * @param {string} html
 * @param {Array<[number, number]>} keep sorted `[start, end)` ranges of `html` left as they are
 * @returns {string}
 */
function escapeHidden(html, keep) {
  const memo = new Map();
  const valueEnd = valueEnds(html);
  const reads = valueReads(html);
  let k = 0;
  return html.replace(HIDDEN_OPEN_RE, (open, name, at) => {
    while (k < keep.length && keep[k][1] <= at) k += 1;
    if (k < keep.length && keep[k][0] <= at) return open;
    const needs = HIDDEN_NEEDS[asciiLower(name)];
    return needs === undefined || tagFlags(html, at + open.length, memo, valueEnd, reads) & needs ? `&lt;${name}` : open;
  });
}

/**
 * The build doc's second strip pass (L3.4, L3.5, Contract issue 4), run after P1's `stripActive` and `escapeActive`:
 * - drops `script` (unless its `nonce` is exactly `nonce`), `iframe`, `frame`, `frameset`, `object`, `embed`,
 *   `applet` and `noscript` through their close tag, and a `set` or `animate` of `href` too (an SVG link follows it);
 * - drops the tag of `base` and of `meta[http-equiv]` (a refresh navigates with no script at all), and with `dropLinks`
 *   of every `link` (P6's server render: a preconnect or prefetch connects with no CSP directive to stop it);
 * - rebuilds a start tag holding an `on*` handler, a `javascript:`/`vbscript:` URL attribute, a `form` attribute or (on
 *   a `template`) a closed shadow root from its other attributes;
 * - copies everything else byte for byte by source offset, styles and comments included, so the board style and the
 *   sections marker pass untouched;
 * - then, outside the kept bridge, escapes what htmlparser2 read as text but a browser can build (`escapeHidden`).
 *
 * htmlparser2 is not a spec tokenizer: where a browser reads the markup differently from it, a handler or a script URL
 * can survive this pass, which the build doc's CSP blocks. What no CSP directive stops (a refresh, a link animation, a
 * closed shadow root) the escape pass catches with no context at all.
 *
 * Offsets follow P1's private `walkElements` (`html-scan.mjs`), never `parser.startIndex`, which after `</p >` points
 * at that `>`. An element that its own open tag closed (a void element, a self-closed child of `svg` or `math`) ends
 * where that tag ends, so `<EMBED src=x>mid` keeps `mid`. No length bound (L3.29): an `inline=1` doc can be far above
 * P1's 8 MiB scan limit, and a bounded walk would drop its tail. The depth is bounded instead (`BUILD_MAX_DEPTH`): a doc
 * that would hold more elements open fails closed, so every tag costs at most that bound.
 * @param {string} html
 * @param {{ nonce: string, dropLinks?: boolean }} opts the bridge's nonce; `dropLinks` (off for the preview)
 * @returns {string}
 * @throws {RangeError} when the doc nests elements more than `BUILD_MAX_DEPTH` deep (the gate answers 500)
 */
export function stripBuildDoc(html, { nonce, dropLinks = false } = {}) {
  const text = String(html ?? '');
  const keepNonce = typeof nonce === 'string' && nonce !== '' ? nonce : null;
  /**
   * `[start, end, replacement, keep]` ranges of `text`. A range inside an earlier one is skipped. A kept bridge script
   * is one too, replaced by itself, with `keep` set so the escape pass leaves it alone.
   */
  const cuts = [];
  /**
   * Every open element, as `walkElements` keeps them; `drop` is its start for an element dropped whole, else -1, and
   * `keep` the start of the kept bridge script, else -1.
   */
  const stack = [];
  /** The start tag being read, from its name to its `>`. */
  let tag = null;
  let atEof = false;
  const parser = new Parser({
    onopentagname(name) {
      // A void or self-closed element is closed before the next open tag, so `stack` holds the open elements here.
      if (stack.length >= BUILD_MAX_DEPTH) throw new RangeError(`stripBuildDoc: the build doc nests elements more than ${BUILD_MAX_DEPTH} deep`);
      const start = text.lastIndexOf('<', parser.endIndex - 1);
      tag = { start, nameEnd: parser.endIndex, attrsEnd: parser.endIndex, attrs: [] };
      stack.push({ name, parserStart: parser.startIndex, drop: DROP_WHOLE.has(name) ? start : -1, keep: -1 });
    },
    onattribute(name, value, quote) {
      // No tag: a second `<form>`, which htmlparser2 skips as the HTML parser does (it makes no element).
      if (!tag) return;
      tag.attrs.push([name, value, quote]);
      tag.attrsEnd = parser.endIndex;
    },
    onopentag(name, attribs, isImplied) {
      const t = tag;
      tag = null;
      if (!t || isImplied) return;
      const end = parser.endIndex + 1;
      const el = stack[stack.length - 1];
      if (el.drop >= 0) {
        if (name === 'script' && keepNonce !== null && firstAttr(t.attrs, 'nonce') === keepNonce) {
          el.drop = -1;
          el.keep = t.start;
        }
        return;
      }
      if (ANIMATIONS.has(name) && t.attrs.some(([key, value]) => animatesHref(asciiLower(key), value))) el.drop = t.start;
      else if (name === 'base' || (dropLinks && name === 'link') || (name === 'meta' && firstAttr(t.attrs, 'http-equiv') !== undefined)) cuts.push([t.start, end, '']);
      else if (t.attrs.some((a) => hostileAttr(a, name))) cuts.push([t.start, end, rebuildTag(text, t, end, name)]);
    },
    onclosetag(name, isImplied) {
      let i = stack.length - 1;
      while (i >= 0 && stack[i].name !== name) i -= 1;
      if (i < 0) return;
      const [el, ...unfinished] = stack.splice(i);
      for (const u of unfinished) if (u.drop >= 0) cuts.push([u.drop, text.length, '']);
      if (el.drop < 0 && el.keep < 0) return;
      let end;
      if (atEof) end = text.length;
      else if (isImplied && parser.startIndex !== el.parserStart) end = text.lastIndexOf('<', parser.endIndex - 1);
      else {
        const gt = text.indexOf('>', parser.endIndex);
        end = gt === -1 ? text.length : gt + 1;
      }
      cuts.push(el.drop >= 0 ? [el.drop, end, ''] : [el.keep, end, text.slice(el.keep, end), true]);
    },
  }, { lowerCaseAttributeNames: false });
  parser.write(text);
  atEof = true;
  parser.end();
  cuts.sort((a, b) => a[0] - b[0] || b[1] - a[1]);
  let out = '';
  let at = 0;
  /** Where each kept bridge script lands in `out`. */
  const kept = [];
  for (const [start, end, put, keep] of cuts) {
    if (end <= at) continue;
    if (start >= at) {
      out += text.slice(at, start);
      if (keep) kept.push([out.length, out.length + put.length]);
      out += put;
    }
    at = end;
  }
  return escapeHidden(out + text.slice(at), kept);
}

/**
 * One preview doc, generated at serve time and written nowhere (C-7). The plan is read through P1's `readConfined`,
 * so a missing, half-written or linked-out `plan.json` is no plan (L3.17): the build doc is then P1's `plan: null` page
 * (tokens, global and the shell), and the run doc an empty page holding only the bridge, so the frame still sends
 * `ready`. A `BAD_SHELL` from the run doc reaches the gate's 500 (L3.18). Only the build doc takes the second strip
 * pass. The response's `Content-Type` names the charset, so a `<meta charset>` behind the bridge does not matter.
 * @param {{ workDir: string, kind: string, mode: 'build' | 'run', nonce: string, inline?: boolean,
 *   assemble?: typeof assembleDesign }} opts `assemble` is P1's `assembleDesign` unless a test passes its own
 * @returns {string}
 */
export function renderPreviewDoc({ workDir, kind, mode, nonce, inline = false, assemble = assembleDesign }) {
  const tag = bridgeScriptTag({ mode, nonce });
  const { ok, plan } = validatePlan(readConfined(workDir, 'plan.json'), { kind });
  if (!ok && mode === 'run') return `<!doctype html><html><head>${tag}</head><body></body></html>`;
  const { html } = assemble({ workDir, plan: ok ? plan : null, mode, bridge: tag, inline });
  return mode === 'build' ? stripBuildDoc(html, { nonce }) : html;
}
