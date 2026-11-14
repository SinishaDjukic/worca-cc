// src/core/design/deck-standalone.mjs
// Design P7 (C-7, L7.3, L7.13, L7.14): a deck's HTML export, one offline file built by the deck kit's own bundler.
// P1's inliner runs first, on a doc whose code is all sibling `<script src>` files (`scriptFiles`), so every asset form
// the kit misses (`srcset`, `poster`, `image href`, `style=`) is already embedded and the kit's regexes never see code.
// The page and its scripts go flat into a private temp folder, never under the design's folder, and the package's own
// `build-standalone.mjs` bundles them there: never a copy from `work/.kit/`, which a model may have written. It runs as
// a child (`process.execPath`, no shell, a scrubbed env), so the server's event loop never blocks on an export. The
// folder is always removed. This module never imports export.mjs, which maps its errors to the route's refusals.
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scrubbedEnv } from '../plugin-shim.mjs';
import { assembleDesign, eachStandaloneRef } from './assemble.mjs';
import { DesignError } from './ids.mjs';
import { isDeckKind } from './kinds.mjs';

/** The deck kit's bundler, from the package (L7.3). */
export const BUILD_STANDALONE = fileURLToPath(new URL('../../../assets/deck-kit/build-standalone.mjs', import.meta.url));

/** How much of the bundler's stderr is kept: enough for its last line. */
const STDERR_KEEP_BYTES = 2048;
const RM = Object.freeze({ recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
const INPUT = 'deck.html';
const OUTPUT = 'deck.standalone.html';

const bundleError = (reason) => new DesignError('IO', `Could not bundle the deck: ${reason}`);

// The kit bundler's own matchers (assets/deck-kit/build-standalone.mjs): its remote test (:39), its stylesheet rel test
// (:281), and the matches of its style blocks (:325) and their url()s (:239), its link tags (:272), the preconnect links
// it removes once the fonts are fetched (:366) and its comments (:178), each read by a linear scan below that returns
// exactly what the bundler's regex returns (review cycle 3: those regexes backtrack, and this runs on the server's event
// loop over text the model wrote). Its media (:389), script (:196) and link href (:288) matchers take the
// first `\ssrc`/`\shref` of a lazily matched tag, wherever it sits, even inside another attribute's value, and read its
// value quoted first, else bare: VALUE is that reading. ATTR and HREF_AT find every place such a value can start and
// are read at every match, overlapping ones too: a bare value ends at whitespace and a quoted one at the next quote, so
// that stays linear. ATTR_ALSO (after `/`, a quote or `:`, which the bundler never reads) is read without overlap, as
// a run like `/src=/src=…` with no whitespace would make overlapping reads quadratic.
const bundlerRemote = (u) => /^(https?:)?\/\//.test(u) || /^data:/i.test(u);
const STYLESHEET = /rel=["']?stylesheet/i;
const ATTR = /\s(?:src|href|poster|srcset)\s*=\s*/gi;
const ATTR_ALSO = /[/"':](?:src|href|poster|srcset)\s*=\s*/gi;
const HREF_AT = /\shref\s*=\s*/gi;
const VALUE = /["']([^"']+)["']|[^\s>]+/y;
/** Passes after which a page that still changes is refused: one or two settle any real page. */
const SAFE_PASSES = 4;

/**
 * The matches of an `open` followed by each of `steps` in turn, as a lazy regex finds them (`<!--[\s\S]*?-->`), in one
 * linear scan: a match runs from an `open` to the first of each step after it, and once a step is found nowhere after,
 * no later `open` can match either. Every regex is global; `open` and each step must not backtrack. `{ index, end, at }`,
 * `at` the end of `open` and then where each step starts.
 * @param {string} text
 * @param {RegExp} open
 * @param {...RegExp} steps
 */
function spans(text, open, ...steps) {
  const out = [];
  open.lastIndex = 0;
  for (let m; (m = open.exec(text)) !== null;) {
    const at = [open.lastIndex];
    let end = open.lastIndex;
    for (const step of steps) {
      step.lastIndex = end;
      const s = step.exec(text);
      if (!s) return out;
      at.push(s.index);
      end = step.lastIndex;
    }
    out.push({ index: m.index, end, at });
    open.lastIndex = end;
  }
  return out;
}
/** `<style\b[^>]*>[\s\S]*?<\/style>` (gi): the CSS runs from `at[1] + 1` to `at[2]`. */
const styleBlocks = (text) => spans(text, /<style\b/gi, />/g, /<\/style>/gi);
/** `<link\b[^>]*>` (gi) */
const linkTags = (text) => spans(text, /<link\b/gi, />/g);
/** `<link rel="preconnect"[^>]*>\s*` (g) */
const preconnectLinks = (text) => spans(text, /<link rel="preconnect"/g, />\s*/g);
/** `<!--[\s\S]*?-->` (g) */
const htmlComments = (text) => spans(text, /<!--/g, /-->/g);

const WS = /\s*/y;
const CSS_SPECIAL = /['")]/g;
const isQuote = (ch) => ch === '"' || ch === "'";

/**
 * Every url() of `css` exactly as `/url\(\s*['"]?([^'")]+)['"]?\s*\)/g` matches it, `{ index, at, value, end }` (`at`
 * where the value starts), without the regex's backtracking: its `\s*` and its value both take whitespace, so it tries
 * every split from every `url(`. From the first non-space `q` after `url(`, the value is the run up to the next quote or
 * `)`; a match needs that stop to be a `)`, or a quote then spaces and a `)`. A quote at `q` opens the value after it.
 * When that fails, the regex's last resort is a value of the one space before `q` (`url( )` holds ' '). Each `url(` costs
 * only the text up to its value's stop, and the stops are looked up once.
 * @param {string} css
 */
function cssUrls(css) {
  const out = [];
  const skipSpace = (x) => { WS.lastIndex = x; WS.exec(css); return WS.lastIndex; };
  let from = 1, next = 0;   // no quote or `)` in [from, next), and `next` holds one or is the end
  const stopAt = (x) => {
    if (x < from || x > next) {
      CSS_SPECIAL.lastIndex = x;
      const m = CSS_SPECIAL.exec(css);
      from = x;
      next = m ? m.index : css.length;
    }
    return next;
  };
  const closes = new Map();
  /** Where the match ends when the value stops at `x`: after `)`, or after a quote, spaces and `)`; else -1. */
  const endAt = (x) => {
    if (css[x] === ')') return x + 1;
    if (!isQuote(css[x])) return -1;
    if (!closes.has(x)) { const r = skipSpace(x + 1); closes.set(x, css[r] === ')' ? r + 1 : -1); }
    return closes.get(x);
  };
  for (let i = css.indexOf('url('); i >= 0;) {
    const p = i + 4;
    const q = skipSpace(p);
    let at = -1, stop = -1, end = -1;
    if (isQuote(css[q])) {
      const d = stopAt(q + 1);
      if (d > q + 1 && (end = endAt(d)) >= 0) [at, stop] = [q + 1, d];
      else if (q > p && (end = endAt(q)) >= 0) [at, stop] = [q - 1, q];
    } else {
      const c = stopAt(q);
      if (c > q || q > p) { end = endAt(c); [at, stop] = [c > q ? q : q - 1, c]; }
    }
    if (end >= 0) {
      out.push({ index: i, at, value: css.slice(at, stop), end });
      i = css.indexOf('url(', end);
    } else i = css.indexOf('url(', i + 1);
  }
  return out;
}

/**
 * Each value that starts where `at` matches in `text`, read as the bundler reads it: `{ start, end, value }`. With
 * `overlap`, a match inside an earlier value is read too; without, the scan goes on after the value.
 */
function valuesAt(text, at, { offset = 0, overlap = true } = {}) {
  const out = [];
  at.lastIndex = 0;
  for (let m; (m = at.exec(text)) !== null;) {
    VALUE.lastIndex = m.index + m[0].length;
    const v = VALUE.exec(text);
    if (v) out.push({ start: offset + VALUE.lastIndex - v[0].length, end: offset + VALUE.lastIndex, value: v[1] ?? v[0] });
    at.lastIndex = overlap || !v ? m.index + 1 : VALUE.lastIndex;
  }
  return out;
}

/**
 * Every edit the page still needs before the bundler may read it, as `{ start, end, to }`. The bundler reshapes the page
 * between its passes, so the edits leave it nothing to reshape: a local url() in a style block becomes `#` (so nothing
 * is embedded there and no later tag moves), a stylesheet link's local href becomes `#` (so no file of ours is read as
 * CSS), and a preconnect link goes (so its removal joins no text). Then no value anywhere may hold a backslash unless it
 * is a remote. A quoted value the bundler reads bare instead (its script matcher backtracks) starts with its quote, so
 * it stays inside the folder.
 * @param {string} page
 */
function unsafeEdits(page) {
  const edits = [];
  for (const m of preconnectLinks(page)) edits.push({ start: m.index, end: m.end, to: '' });
  for (const b of styleBlocks(page)) {
    // The CSS between the open tag and `</style>`: the bundler's lowercased `lastIndexOf` can take a few characters of
    // `</style>` too (an `İ` lowercases to two), which hold no quote or `)`, so it finds the same url()s.
    const open = b.at[1] + 1;
    for (const u of cssUrls(page.slice(open, b.at[2]))) {
      if (bundlerRemote(u.value) || u.value.startsWith('#')) continue;
      edits.push({ start: open + u.at, end: open + u.at + u.value.length, to: '#' });
    }
  }
  for (const t of linkTags(page)) {
    const tag = page.slice(t.index, t.end);
    if (!STYLESHEET.test(tag)) continue;
    for (const h of valuesAt(tag, HREF_AT, { offset: t.index })) if (!bundlerRemote(h.value) && !h.value.startsWith('#')) edits.push({ ...h, to: '"#"' });
  }
  const values = [...valuesAt(page, ATTR), ...valuesAt(page, ATTR_ALSO, { overlap: false })];
  for (const v of values) if (v.value.includes('\\') && !bundlerRemote(v.value)) edits.push({ ...v, to: '"#"' });
  return edits;
}

/** `text` with the edits that do not overlap an earlier one; the rest wait for the next pass. */
function applyEdits(text, edits) {
  let out = '';
  let at = 0;
  for (const e of edits.sort((a, b) => a.start - b.start || a.end - b.end)) {
    if (e.start < at) continue;
    out += text.slice(at, e.start) + e.to;
    at = e.end;
  }
  return out + text.slice(at);
}

/**
 * The page the bundler gets, with nothing in it that sends the bundler to the disk outside its own folder (review C1).
 * The bundler resolves every local reference with `realpathSync` before its confinement check, and on Windows a
 * `\\host\share` value is an SMB connection, with the user's credentials, to a host the model chose. P1 never embeds
 * such a value (`classifyRef` calls it `escaped`), and that problem stays reported. The edits run until a pass finds
 * none, by the same matchers: a page that still needs one after `SAFE_PASSES` is refused, never bundled.
 * @param {string} html
 * @returns {string}
 * @throws {DesignError} `IO` for a page the passes could not settle
 */
function bundlerSafe(html) {
  let page = html;
  for (let pass = 0; pass < SAFE_PASSES; pass++) {
    const edits = unsafeEdits(page);
    if (!edits.length) return page;
    page = applyEdits(page, edits);
  }
  throw bundleError('a reference in the page could not be made safe');
}

/** The bundler embeds the first link whose href starts with this, once its fetch succeeds (build-standalone.mjs:345). */
const FONT_CSS = 'https://fonts.googleapis.com/css2';

/**
 * The remotes of `problems` the export no longer loads (review cycle 4). Only two kinds can go: a preconnect link
 * `bundlerSafe` removes, and the Google Fonts link the bundler embeds. A ref P1 reads in one of them is gone when the
 * output, read as P1 reads a page, holds it nowhere, so a ref P1 also met elsewhere (an `@import` of the same fonts, an
 * `<img>` with an entity in its URL) stays. Every other remote stays whatever the output says: the passes can reshape a
 * value without unloading it. One walk of the removed links and one of the output, never a search per problem; an
 * output the walk cannot read whole (too deep, or longer than HTML_MAX_SCAN_LENGTH) loses nothing.
 * @param {string} raw P1's page
 * @param {{ ref: string, why: string }[]} problems P1's problems
 * @param {string} html the bundler's output
 * @returns {Set<string>}
 */
function lostRemotes(raw, problems, html) {
  const lost = new Set();
  eachStandaloneRef(preconnectLinks(raw).map((m) => raw.slice(m.index, m.end)).join(''), (ref) => lost.add(ref));
  for (const { ref, why } of problems) if (why === 'remote' && ref.startsWith(FONT_CSS)) lost.add(ref);
  if (!lost.size) return lost;
  return eachStandaloneRef(html, (ref) => lost.delete(ref)) ? lost : new Set();
}

/** How often `text` holds `part`. */
const countOf = (text, part) => text.split(part).length - 1;

/** The page's HTML comments, as the bundler finds them (build-standalone.mjs:178): a tag in one is never inlined. */
const commentsOf = (html) => htmlComments(html).map((c) => html.slice(c.index, c.end)).join('\n');

function abortError() {
  const e = new Error('the export was stopped');
  e.name = 'AbortError';
  return e;
}

/** The last non-empty line of the bundler's stderr, without its `[build] ` tag and a leading `✗ `. */
function lastLine(stderr) {
  const line = stderr.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).at(-1) ?? '';
  return line.replace(/^\[build\]\s*/, '').replace(/^✗\s*/, '');
}

/**
 * Runs the bundler on `<tmp>/deck.html` into `<tmp>/deck.standalone.html`. Settles once: on `error` alone, or on
 * `close`. An abort kills the child and rejects with an `AbortError`; any other failure is `bundleError`.
 */
function runBundler({ tmp, timeoutMs, signal, spawnImpl }) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let child = null;
    let tail = Buffer.alloc(0);
    const settle = (err) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener('abort', onAbort);
      if (err) reject(err);
      else resolve(tail.toString('utf8'));
    };
    function onAbort() {
      if (typeof child?.kill === 'function') {
        try { child.kill('SIGKILL'); } catch { /* already gone */ }
      }
      settle(abortError());
    }
    try {
      child = spawnImpl(process.execPath, [BUILD_STANDALONE, join(tmp, INPUT), '--out', join(tmp, OUTPUT)], {
        cwd: tmp,
        env: scrubbedEnv(),
        stdio: ['ignore', 'ignore', 'pipe'],
        windowsHide: true,
        timeout: timeoutMs,
        killSignal: 'SIGKILL',
        signal: signal ?? undefined, // spawn refuses null
      });
    } catch (e) {
      settle(signal?.aborted ? abortError() : bundleError(e?.message ?? String(e)));
      return;
    }
    child.stderr?.on('data', (chunk) => {
      tail = Buffer.concat([tail, Buffer.from(chunk)]);
      if (tail.length > STDERR_KEEP_BYTES) tail = tail.subarray(tail.length - STDERR_KEEP_BYTES);
    });
    child.on('error', (e) => settle(signal?.aborted ? abortError() : bundleError(e?.message ?? String(e))));
    child.on('close', (code, sig) => {
      if (signal?.aborted) settle(abortError());
      else if (sig) settle(bundleError('timed out'));
      else if (code !== 0) settle(bundleError(lastLine(tail.toString('utf8')) || `exit ${code}`));
      else settle(null);
    });
    if (signal?.aborted) onAbort();
    else signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * A deck's standalone page through the deck kit's bundler (C-7). `assembleDesign` with `scriptFiles` first, so a
 * missing kit file is its `IO` error (with `kitFile`) before anything is spawned; then the page (`bundlerSafe`) and
 * its scripts in a temp folder of their own under `tmpRoot`, the bundler run there, and its output checked: more
 * `<script src="<name>"></script>` tags of ours than the page's comments hold means the kit left that script out.
 * `problems` drops only a remote the export lost whole and no longer loads (`lostRemotes`), so a font link the kit
 * embedded leaves the list and one it could not fetch stays. The temp folder is always removed.
 * @param {{ workDir: string, plan: { kind?: string, sections?: { id: string }[] }, timeoutMs?: number,
 *   signal?: AbortSignal|null, spawnImpl?: typeof spawn, tmpRoot?: string }} opts
 *   `tmpRoot` is for tests: other files make temp folders in the same tmpdir at the same time
 * @returns {Promise<{ html: string, mode: 'standalone', sections: { id: string, state: string }[],
 *   problems: { ref: string, why: string }[] }>}
 * @throws {DesignError} `BAD_REQUEST` for a kind that is not a deck; `IO` from the assembler (a missing kit file),
 *   for a page `bundlerSafe` could not settle, or for a bundle that failed; an `AbortError` when `signal` aborts
 */
export async function assembleDeckStandalone({
  workDir, plan, timeoutMs = 120000, signal = null, spawnImpl = spawn, tmpRoot = tmpdir(),
} = {}) {
  if (!isDeckKind(plan?.kind)) throw new DesignError('BAD_REQUEST', 'only a deck is bundled by the deck kit');
  const r = assembleDesign({ workDir, plan, mode: 'standalone', scriptFiles: true });
  if (signal?.aborted) throw abortError();
  const page = bundlerSafe(r.html);
  const tmp = await mkdtemp(join(tmpRoot, 'worca-deck-'));
  try {
    await writeFile(join(tmp, INPUT), page);
    for (const { name, text } of r.scripts) await writeFile(join(tmp, name), text);
    await runBundler({ tmp, timeoutMs, signal, spawnImpl });
    let html;
    try {
      html = await readFile(join(tmp, OUTPUT), 'utf8');
    } catch {
      throw bundleError('no output');
    }
    // A tag inside a comment stays as written (the bundler skips it), so only more of them than the comments hold
    // means a live one was left out.
    const commented = commentsOf(page);
    const tagOf = (name) => `<script src="${name}"></script>`;
    if (r.scripts.some(({ name }) => countOf(html, tagOf(name)) > countOf(commented, tagOf(name)))) throw bundleError('a script was left out.');
    // Only a remote can leave the list (`lostRemotes`). Every other problem is real whatever the output says (P1's ref
    // is often not raw output text: `index.html`, entities, quotes).
    const lost = lostRemotes(r.html, r.problems, html);
    const problems = r.problems.filter(({ ref, why }) => why !== 'remote' || !lost.has(ref));
    return { html, mode: 'standalone', sections: r.sections, problems };
  } finally {
    await rm(tmp, RM);
  }
}

/** For tests: the linear scans, each pinned to the bundler's regex. */
export const _testing = Object.freeze({ cssUrls, styleBlocks, linkTags, preconnectLinks, htmlComments });
