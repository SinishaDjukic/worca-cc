// src/core/design/assemble.mjs
// The Design assembler (SPEC C-7): shell.html plus each section's files into one page. Deterministic and
// offline. Only the shell is parsed for markers and slots; section text is copied verbatim, so a marker or
// slot written inside a section is never expanded.
import { randomBytes } from 'node:crypto';
import { closeSync, constants as fsc, cpSync, fstatSync, lstatSync, mkdirSync, openSync, readdirSync, readFileSync, readSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { Parser } from 'htmlparser2';
import { DesignError } from './ids.mjs';
import {
  boundedParser, classifyRef, divergenceWatch, escapeActive, HTML_MAX_DEPTH, HTML_MAX_SCAN_LENGTH, reservedTextCount, RESOURCE_ATTRS, scanCss, scanCssUrls, scanHtml, scanShellSlots,
  srcsetUrls, stripActive,
} from './html-scan.mjs';

/** The attribute that marks the bridge `<script>` (C-7, M10). `dist` and `standalone` never carry it. */
export const BRIDGE_MARKER = 'data-worca-bridge';
/** Inlining limits (L1.17): a bigger file, or one that would take the embedded total past the cap, is a `too-large` problem. */
export const STANDALONE_MAX_FILE_BYTES = 25 * 1024 * 1024;
export const STANDALONE_MAX_TOTAL_BYTES = 100 * 1024 * 1024;
/** No OS opens a longer path: PATH_MAX is 4096 bytes on Linux, the closing NUL included, and 1024 on macOS. */
const PATH_MAX_BYTES = 4096;
/** What build mode shows while shell.html is missing or invalid. */
export const DEFAULT_SHELL = '<!doctype html><html><head><meta charset="utf-8"><!--worca:head--></head><body><!--worca:sections--><!--worca:foot--></body></html>';

const MODES = Object.freeze(['build', 'run', 'dist', 'standalone']);
const MARKERS = Object.freeze({ head: 'worca:head', sections: 'worca:sections', foot: 'worca:foot' });
const SLOT_ATTR = 'data-worca-slot';
const NOT_SPACE = /[^ \t\n\f\r]/;
const HTML_SPACE = /[ \t\n\f\r]/;
const RM = Object.freeze({ recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
/** `mimeFor`'s table from assets/deck-kit/build-standalone.mjs (importing that file runs its main()), plus js, css and vtt. */
const MIME = Object.freeze({
  woff2: 'font/woff2', woff: 'font/woff', ttf: 'font/ttf', otf: 'font/otf',
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif',
  webp: 'image/webp', avif: 'image/avif', svg: 'image/svg+xml',
  mp3: 'audio/mpeg', m4a: 'audio/mp4', wav: 'audio/wav', ogg: 'audio/ogg',
  mp4: 'video/mp4', webm: 'video/webm',
  js: 'text/javascript', css: 'text/css', vtt: 'text/vtt',
});

function mimeFor(url) {
  const ext = (url.split('?')[0].split('#')[0].split('.').pop() || '').toLowerCase();
  return Object.hasOwn(MIME, ext) ? MIME[ext] : 'application/octet-stream';
}

/** True when `p` is strictly below `root`; both already real paths. */
function inside(root, p) {
  const rel = relative(root, p);
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

/**
 * A regular file's text when its real path is inside the real `workDir`, BOM stripped; otherwise null.
 * work/ is agent-writable while a build runs, so the file is opened without following a link at its name and
 * without blocking on a FIFO, and checked again once open.
 * @param {string} workDir
 * @param {string} rel
 * @returns {string|null}
 */
export function readConfined(workDir, rel) {
  try {
    const real = realpathSync(resolve(workDir, rel));
    if (!inside(realpathSync(workDir), real) || !lstatSync(real).isFile()) return null;
    const fd = openSync(real, fsc.O_RDONLY | (fsc.O_NOFOLLOW ?? 0) | (fsc.O_NONBLOCK ?? 0));
    try {
      if (!fstatSync(fd).isFile()) return null;
      const text = readFileSync(fd, 'utf8');
      return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
    } finally {
      closeSync(fd);
    }
  } catch {
    return null;
  }
}

/** Why part of an HTML file was not read as a browser reads it (scanHtml's and shellMap's `unread`). */
const UNREAD = Object.freeze({
  depth: `nests elements more than ${HTML_MAX_DEPTH} deep, so what follows that point cannot be read`,
  size: `is longer than ${HTML_MAX_SCAN_LENGTH / (1024 * 1024)} MiB, so what follows that point cannot be read`,
  cdata: 'holds a <![CDATA[, which a browser ends at its first > outside svg and math, and lint cannot tell where a browser leaves those, so the markup after it cannot be read',
  rawtext: 'has markup inside a raw-text element (script, style, title, textarea, noscript and the like) that a browser can read as markup: after an svg, math, select, frameset or template, inside a noscript, or after <!-- <script in a script. So the markup after it cannot be read: take that markup out, or move the script or style into its own file',
  control: 'holds a U+000F or U+001C control character, which the lint parser can read as / or < in an end tag, so the markup after it cannot be read: take it out',
  endtag: 'has a quote inside an end tag (</p a="…">), where a browser and the lint parser end the tag at different >s, so the markup after it cannot be read: end tags carry no attributes',
  unclosed: 'ends inside a tag, comment or raw-text element, or leaves an svg, math, select, frameset or template open, or has an element inside one closed by another element\'s end tag, so a browser reads what follows it in the page differently: close every element explicitly, and end the file between tags',
});

/**
 * Markers, slots and the first `head` open tag of a shell, all found by the parser: marker text inside a
 * raw-text body or another comment is not a marker. `unread` as in scanHtml (without `unclosed`: nothing follows a
 * shell): such a shell is never assembled as is. `misplaced` names each marker and slot that sits where a browser
 * may read the text filled in there in another context than lint read it (divergenceWatch `inRegion`). `joined`
 * names each one right after a bare `<`: the parser reads that `<` as text, while in the page a browser starts a tag
 * with what fills it, or, when the fill is empty (no CSS, no script, a section with no html), with the shell after it.
 * @param {string} shell
 * @returns {{ markers: Record<'head'|'sections'|'foot', { start: number, end: number }[]>, head: { end: number }|null, slots: ReturnType<typeof scanShellSlots>, misplaced: string[], joined: string[], unread: null|'cdata'|'control'|'endtag'|'rawtext'|'depth'|'size' }}
 */
function shellMap(shell) {
  const markers = { head: [], sections: [], foot: [] };
  const misplaced = [];
  const joined = [];
  let head = null;
  const watch = divergenceWatch(shell);
  const { parser, read } = boundedParser(shell, {
    oncomment(data) {
      const end = parser.endIndex + 1;
      for (const [name, inner] of Object.entries(MARKERS)) {
        const raw = `<!--${inner}-->`;
        if (data !== inner || !shell.startsWith(raw, end - raw.length)) continue;
        markers[name].push({ start: end - raw.length, end });
        if (watch.inRegion()) misplaced.push(raw);
        if (shell[end - raw.length - 1] === '<') joined.push(raw);
      }
    },
    onopentag(name, attribs) {
      if (Object.hasOwn(attribs, SLOT_ATTR) && watch.inRegion()) misplaced.push(`slot ${JSON.stringify(attribs[SLOT_ATTR])}`);
      watch.open(name, parser.endIndex + 1);
      if (name === 'head' && !head) head = { end: parser.endIndex + 1 };
    },
    onclosetag(name, isImplied) {
      watch.close(name, isImplied, parser.endIndex + 1);
    },
  });
  const stopped = read().unread;
  const slots = scanShellSlots(shell);
  for (const slot of slots) if (shell[slot.start - 1] === '<') joined.push(`slot ${JSON.stringify(slot.id)}`);
  return { markers, head, slots, misplaced, joined, unread: watch.unread() ?? stopped };
}

/**
 * Why a mapped shell cannot be assembled: a shell not read to its end first, then markers (head, foot, sections),
 * then each malformed slot.
 * @param {ReturnType<typeof shellMap>} map
 * @param {string[]} planIds
 * @param {boolean} needHead a bridge goes in right after the first `head` open tag
 * @returns {({ marker: 'shell'|'head'|'foot'|'sections', message: string }|{ slot: object, message: string })[]}
 */
function shellFaults({ markers, head, slots, misplaced, joined, unread }, planIds, needHead) {
  const faults = [];
  if (unread) faults.push({ marker: 'shell', message: `the shell ${UNREAD[unread]}` });
  if (misplaced.length) {
    faults.push({ marker: 'shell', message: `the shell puts ${listing(misplaced)} inside an svg, math, select, frameset or template, or after an element inside one that another element's end tag closed, where a browser reads what fills it in another context: put it outside them, and close every element inside them explicitly` });
  }
  if (joined.length) {
    faults.push({ marker: 'shell', message: `the shell has a bare < right before ${listing(joined)}, which a browser reads as the start of a tag with what fills it, or with the shell text after it when the fill is empty: take the < out, or write it as &lt;` });
  }
  const once = (name) => `<!--${MARKERS[name]}--> must appear exactly once, found ${markers[name].length}`;
  const firstAt = [...markers.head, ...markers.sections, ...markers.foot, ...slots.filter((s) => s.ok)].reduce((at, x) => Math.min(at, x.start), Infinity);
  if (markers.head.length !== 1) faults.push({ marker: 'head', message: once('head') });
  else if (needHead && !(head && head.end <= firstAt)) {
    faults.push({ marker: 'head', message: 'a <head> open tag must come before every marker and slot' });
  }
  if (markers.foot.length !== 1) faults.push({ marker: 'foot', message: once('foot') });
  const slotted = new Set(slots.filter((s) => s.ok).map((s) => s.id));
  const homeless = planIds.filter((id) => !slotted.has(id));
  if (markers.sections.length > 1) {
    faults.push({ marker: 'sections', message: `<!--worca:sections--> may appear once, found ${markers.sections.length}` });
  } else if (markers.sections.length === 0 && homeless.length) {
    faults.push({ marker: 'sections', message: `<!--worca:sections--> is missing, and sections ${homeless.join(', ')} have no slot` });
  }
  for (const slot of slots) {
    if (!slot.ok) faults.push({ slot, message: `slot ${JSON.stringify(slot.id)} must be an empty <div data-worca-slot="…"></div>` });
  }
  return faults;
}

/**
 * True when `bridge`, parsed alone, is exactly one complete top-level `<script>` element whose open tag
 * carries BRIDGE_MARKER, with only whitespace around it (M10). A substring test would pass `<div data-worca-bridge>`.
 * "Around it" is the raw text outside the last top-level element's span, so another element, a comment or a stray
 * end tag there fails too.
 * @param {unknown} bridge
 * @returns {boolean}
 */
function isBridge(bridge) {
  if (typeof bridge !== 'string') return false;
  let depth = 0;
  let script = false;
  let marked = false;
  let start = -1;
  let end = -1;
  const parser = new Parser({
    onopentagname(name) {
      if (depth === 0) {
        script = name === 'script';
        start = bridge.lastIndexOf('<', parser.endIndex - 1);
      }
      depth += 1;
    },
    onopentag(name, attribs) {
      if (depth === 1 && Object.hasOwn(attribs, BRIDGE_MARKER)) marked = true;
    },
    onclosetag(name, isImplied) {
      depth -= 1;
      if (depth !== 0 || isImplied) return;
      const gt = bridge.indexOf('>', parser.endIndex);
      end = gt === -1 ? bridge.length : gt + 1;
    },
  });
  parser.end(bridge);
  const blank = (s) => !NOT_SPACE.test(s);
  return script && marked && end > start && blank(bridge.slice(0, start)) && blank(bridge.slice(end));
}

/** Ids `.crew.json` lists as `done`. A file that does not parse, or is not an array, reads as none (Review Focus 4). */
function doneSections(workDir) {
  let crew;
  try {
    crew = JSON.parse(readConfined(workDir, '.crew.json') ?? '[]');
  } catch {
    return new Set();
  }
  if (!Array.isArray(crew)) return new Set();
  return new Set(crew.filter((e) => e && typeof e === 'object' && e.status === 'done' && typeof e.id === 'string').map((e) => e.id));
}

/**
 * The one include-or-placeholder rule, for a slot and the marker alike. Build shows a section once
 * `.crew.json` says `done` and its file reads (L1.11), without its active elements; the other modes take
 * the file text as written.
 */
function fillSection(workDir, id, build, done) {
  const html = readConfined(workDir, `sections/${id}/index.html`);
  if (build) {
    return done.has(id) && html !== null
      ? { id, state: 'included', fill: stripActive(html) }
      : { id, state: 'slot', fill: `<div data-worca-slot="${id}"></div>` };
  }
  return html === null ? { id, state: 'missing', fill: '' } : { id, state: 'included', fill: html };
}

const escapeStyle = (css) => css.replace(/<\/(style)/gi, (_, word) => `<\\/${word}`);
const escapeScript = (js) => js.replace(/<\/(script)/gi, (_, word) => `<\\/${word}`).replace(/<!--/g, () => '<\\!--');

/** `<!--worca:head-->`: tokens, global, then each included section's style.css in plan order. */
function headText(workDir, included, tagged) {
  const sheets = [['tokens', 'tokens.css'], ['global', 'global.css'], ...included.map(({ id }) => [id, `sections/${id}/style.css`])];
  return sheets.flatMap(([name, rel]) => {
    const css = readConfined(workDir, rel);
    if (css === null) return [];
    return [`${tagged ? `<style data-worca-css="${name}">` : '<style>'}${escapeStyle(css)}</style>`];
  }).join('\n');
}

/** `<!--worca:foot-->`: global.js, then one element per included section's script.js, so one error stays local (L1.13). */
function footText(workDir, included) {
  const scripts = [];
  const global = readConfined(workDir, 'global.js');
  if (global !== null) scripts.push(escapeScript(global));
  for (const { id } of included) {
    const js = readConfined(workDir, `sections/${id}/script.js`);
    if (js !== null) scripts.push(`(function(root){\n${escapeScript(js)}\n})(document.querySelector('[data-section="${id}"]'));`);
  }
  return scripts.map((js) => `<script>${js}</script>`).join('\n');
}

/** Applies non-overlapping `{ start, end, text }` edits to `text` in one pass. */
function splice(text, edits) {
  let out = '';
  let at = 0;
  for (const edit of [...edits].sort((a, b) => a.start - b.start)) {
    out += text.slice(at, edit.start) + edit.text;
    at = edit.end;
  }
  return out + text.slice(at);
}

/** The bridge goes in last, right after the first `head` open tag the parser finds in the finished text. */
function insertBridge(html, bridge) {
  let at = -1;
  const parser = new Parser({
    onopentag(name) {
      if (name !== 'head' || at >= 0) return;
      at = parser.endIndex + 1;
      parser.pause();
    },
  });
  parser.write(html);
  if (at < 0) throw new DesignError('BAD_SHELL', 'the page has no <head> for the bridge');
  return html.slice(0, at) + bridge + html.slice(at);
}

/**
 * The real path of `p`, a resolved path below the real folder `root`: the real path of the deepest part of `p` that
 * exists, with the missing rest appended as written (`realpathish` in assets/deck-kit/build-standalone.mjs), so a
 * missing file behind a link out of work/ is still outside. When a part of `p` resolves, every shorter part does
 * too, so the deepest one is found by bisection, its folder tried first: a few realpaths per reference. Walking up
 * one part at a time took a realpath per part, which is quadratic in the reference's length.
 */
function realpathish(root, p) {
  const real = (end) => {
    try {
      return realpathSync(p.slice(0, end));
    } catch {
      return null;
    }
  };
  const whole = real(p.length);
  if (whole !== null) return whole;
  if (!p.startsWith(root + sep)) return p; // Outside as written: the caller calls it escaped.
  // ends[k] is where the part k folders below root ends; ends[0] is root itself, which is real.
  const ends = [root.length];
  for (let i = root.length + 1; i < p.length; i += 1) if (p[i] === sep) ends.push(i);
  let lo = 0;
  let hi = ends.length;
  let found = root;
  for (let mid = hi - 1; mid > lo; mid = (lo + hi) >>> 1) {
    const got = real(ends[mid]);
    if (got === null) hi = mid;
    else [lo, found] = [mid, got];
  }
  return join(found, p.slice(ends[lo] + 1));
}

/**
 * Turns a `local` rel into a `data:` URI, or says why it cannot: `escaped` when its real path leaves the real
 * workDir, `missing` when it is absent, unreadable or not a regular file (a dangling link included), or its path is
 * PATH_MAX_BYTES or longer, `too-large` past either byte limit. Each rel is read once. Every call is one copy written into the page, so the total counts
 * the file's bytes once per call: a file referenced again and again cannot take the page past the total.
 * @param {string} workDir
 * @returns {(rel: string) => { uri: string }|{ why: 'escaped'|'missing'|'too-large' }}
 */
function embedder(workDir) {
  let root = null;
  try {
    root = realpathSync(workDir);
  } catch {
    // No work/ yet: nothing in it can be embedded.
  }
  const cache = new Map();
  let total = 0;
  const load = (rel) => {
    if (root === null) return { why: 'missing' };
    const abs = resolve(root, rel);
    // A browser cannot open it either; and node's realpath costs a pass over the whole path per link it follows.
    if (Buffer.byteLength(abs) >= PATH_MAX_BYTES) return { why: 'missing' };
    const real = realpathish(root, abs);
    if (!inside(root, real)) return { why: 'escaped' };
    let fd;
    try {
      fd = openSync(real, fsc.O_RDONLY | (fsc.O_NOFOLLOW ?? 0) | (fsc.O_NONBLOCK ?? 0));
    } catch {
      return { why: 'missing' };
    }
    try {
      const st = fstatSync(fd);
      if (!st.isFile()) return { why: 'missing' };
      if (st.size > STANDALONE_MAX_FILE_BYTES || total + st.size > STANDALONE_MAX_TOTAL_BYTES) return { why: 'too-large' };
      // At most the size just checked: a file still growing under a running build cannot pass the limits.
      const bytes = Buffer.alloc(st.size);
      let got = 0;
      while (got < bytes.length) {
        const n = readSync(fd, bytes, got, bytes.length - got, null);
        if (n === 0) break;
        got += n;
      }
      return { uri: `data:${mimeFor(rel)};base64,${bytes.subarray(0, got).toString('base64')}`, bytes: got };
    } catch {
      return { why: 'missing' };
    } finally {
      closeSync(fd);
    }
  };
  return (rel) => {
    if (!cache.has(rel)) cache.set(rel, load(rel));
    const got = cache.get(rel);
    if (got.uri === undefined) return got;
    if (total + got.bytes > STANDALONE_MAX_TOTAL_BYTES) return { why: 'too-large' };
    total += got.bytes;
    return { uri: got.uri };
  };
}

/** A piece of raw attribute text decoded the way the parser decodes an attribute value. */
function decodeAttr(raw) {
  if (!raw.includes('&')) return raw;
  let value = raw;
  const parser = new Parser({ onattribute(name, decoded) { value = decoded; } });
  parser.end(`<x a="${raw.replace(/"/g, '&quot;')}">`);
  return value;
}

/**
 * Embeds every local reference of a finished page as `data:` (standalone, or `inline: true`). It reads only
 * references, in resource attributes, `srcset` candidates, `style=` values and `<style>` bodies, never slots or
 * markers, and edits the raw markup by span, so separators, quotes, descriptors and every other byte stay as
 * written. A reference it cannot embed stays as it is and is reported once per `{ ref, why }`. A page nested deeper
 * than HTML_MAX_DEPTH, or longer than HTML_MAX_SCAN_LENGTH, is read up to that point: what follows stays as written,
 * reported once as `{ ref: 'index.html', why: 'too-large' }`.
 * @param {string} html
 * @param {string} workDir
 * @returns {{ html: string, problems: { ref: string, why: 'missing'|'escaped'|'remote'|'too-large' }[] }}
 */
function inlineRefs(html, workDir) {
  const embed = embedder(workDir);
  const problems = [];
  const reported = new Set();
  const report = (ref, why) => {
    const key = JSON.stringify([ref, why]);
    if (reported.has(key)) return;
    reported.add(key);
    problems.push({ ref, why });
  };
  const edits = [];
  const replace = (value, start, end) => {
    const ref = classifyRef(value);
    if (ref.type === 'skip') return;
    const got = ref.type === 'local' ? embed(ref.rel) : { why: ref.type };
    if (got.uri === undefined) report(String(value).trim(), got.why);
    else edits.push({ start, end, text: got.uri });
  };
  const replaceEach = (offset, urls, decode) => {
    for (const u of urls) replace(decode ? decodeAttr(u.value) : u.value, offset + u.start, offset + u.end);
  };

  let tag = '';
  let style = null;
  const { parser, read } = boundedParser(html, {
    onopentagname(name) {
      tag = name;
    },
    onattribute(name, value, quote) {
      if (quote === undefined || (name !== 'style' && !RESOURCE_ATTRS.get(tag)?.includes(name))) return;
      const raw = html.slice(parser.startIndex, parser.endIndex);
      let at = raw.indexOf('=') + 1;
      if (at === 0) return;
      while (at < raw.length && HTML_SPACE.test(raw[at])) at += 1;
      if (quote === '"' || quote === "'") at += 1;
      const start = parser.startIndex + at;
      const end = quote ? parser.endIndex - 1 : parser.endIndex;
      if (end < start) return;
      if (name === 'style') replaceEach(start, scanCssUrls(html.slice(start, end)), true);
      else if (name === 'srcset') replaceEach(start, srcsetUrls(html.slice(start, end)), true);
      else replace(value, start, end);
    },
    onopentag(name) {
      if (name === 'style') style = { start: parser.endIndex + 1, end: parser.endIndex + 1 };
    },
    ontext() {
      // A style body is raw text, so its text events are the body; a self-closed <svg><style/> has none.
      if (style) style.end = parser.endIndex + 1;
    },
    onclosetag(name) {
      if (name !== 'style' || !style) return;
      replaceEach(style.start, scanCssUrls(html.slice(style.start, style.end)), false);
      style = null;
    },
  });
  if (read().unread) report('index.html', 'too-large');
  return { html: splice(html, edits), problems };
}

/** The shell to fill and its map. Only build falls back to DEFAULT_SHELL; the other modes throw BAD_SHELL. */
function pickShell(workDir, mode, planIds, needHead) {
  const build = mode === 'build';
  const raw = readConfined(workDir, 'shell.html');
  if (raw === null && !build) throw new DesignError('BAD_SHELL', 'shell.html is missing');
  if (raw !== null) {
    const shell = build ? stripActive(raw) : raw;
    const map = shellMap(shell);
    const faults = shellFaults(map, planIds, needHead);
    if (!faults.length) return { shell, map };
    if (!build) throw new DesignError('BAD_SHELL', `shell.html: ${faults.map((f) => f.message).join('; ')}`);
  }
  return { shell: DEFAULT_SHELL, map: shellMap(DEFAULT_SHELL) };
}

/** Copies one asset folder into the dist temp, skipping dot names and links; an absent folder is skipped. */
function copyAssets(workDir, rel, tmp) {
  const from = join(workDir, rel);
  let st;
  try {
    st = lstatSync(from);
  } catch (err) {
    if (err.code === 'ENOENT' || err.code === 'ENOTDIR') return;
    throw err;
  }
  if (!st.isDirectory() || !inside(realpathSync(workDir), realpathSync(from))) return;
  const to = join(tmp, rel);
  mkdirSync(dirname(to), { recursive: true });
  cpSync(from, to, {
    recursive: true,
    filter: (src) => {
      if (basename(src).startsWith('.')) return false;
      const entry = lstatSync(src);
      return entry.isFile() || entry.isDirectory();
    },
  });
}

/** Every non-folder entry below `dir`, POSIX-relative: what the folder really holds. */
function listFiles(dir, base = '') {
  return readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const rel = base ? `${base}/${d.name}` : d.name;
    return d.isDirectory() ? listFiles(join(dir, d.name), rel) : [rel];
  });
}

/** Builds `dist.tmp-<8 hex>` beside work/, then swaps it in for dist/. */
function writeDist(workDir, html, ids) {
  const parent = dirname(workDir);
  const distDir = join(parent, 'dist');
  const tmp = join(parent, `dist.tmp-${randomBytes(4).toString('hex')}`);
  let files;
  try {
    mkdirSync(tmp);
    writeFileSync(join(tmp, 'index.html'), html);
    for (const rel of ['assets', ...ids.map((id) => `sections/${id}/assets`)]) copyAssets(workDir, rel, tmp);
    files = listFiles(tmp).sort();
    rmSync(distDir, RM);
    renameSync(tmp, distDir);
  } catch (err) {
    try {
      rmSync(tmp, RM);
    } catch {
      // The write failure below is the one worth reporting.
    }
    throw new DesignError('IO', `could not write dist: ${err.message}`);
  }
  return { distDir, files };
}

/**
 * Assembles a design's work/ folder into one page (SPEC C-7). Any kind assembles by these rules (L1.16).
 * - `build`: finished sections per `.crew.json`, slots for the rest, no model JS; falls back to DEFAULT_SHELL.
 * - `run`: every section, inline JS, optional bridge.
 * - `dist`: the run page without a bridge, written with the assets to `dist/` beside work/.
 * - `standalone`: the dist page with every local reference embedded as `data:`, nothing written.
 * `inline: true` embeds the same way in any mode, before the bridge goes in. Whatever standalone or inline could not
 * embed (L1.17) is listed in `problems`, once each, and left as written; the other modes return `problems: []`.
 * @param {{ workDir: string, plan: { sections?: { id: string }[] }|null, mode: 'build'|'run'|'dist'|'standalone', bridge?: string|null, inline?: boolean }} opts
 * @returns {{ html: string, mode: string, sections: { id: string, state: 'included'|'slot'|'missing' }[], problems: { ref: string, why: 'missing'|'escaped'|'remote'|'too-large' }[], distDir?: string, files?: string[] }}
 */
export function assembleDesign({ workDir, plan, mode, bridge = null, inline = false } = {}) {
  if (!MODES.includes(mode)) throw new DesignError('BAD_REQUEST', `unknown assembly mode ${JSON.stringify(String(mode))}`);
  const build = mode === 'build';
  const live = build || mode === 'run';
  if (bridge !== null) {
    if (!live) throw new DesignError('BAD_REQUEST', `${mode} never carries the bridge`);
    if (!isBridge(bridge)) throw new DesignError('BAD_REQUEST', `the bridge must be one <script ${BRIDGE_MARKER}> element`);
  }
  // The sections lintDesign judges, no others: a section lint never read must not reach the page.
  const ids = Array.isArray(plan?.sections) ? plan.sections.filter((s) => typeof s?.id === 'string').map((s) => s.id) : [];
  const { shell, map } = pickShell(workDir, mode, ids, bridge !== null);
  const done = build ? doneSections(workDir) : new Set();
  const parts = ids.map((id) => fillSection(workDir, id, build, done));
  const included = parts.filter((p) => p.state === 'included');
  const fills = new Map(parts.map((p) => [p.id, p.fill]));

  const edits = [];
  const slotted = new Set();
  for (const slot of plan ? map.slots : []) {
    if (fills.has(slot.id)) {
      edits.push({ start: slot.start, end: slot.end, text: slotted.has(slot.id) ? '' : fills.get(slot.id) });
      slotted.add(slot.id);
    } else if (!build) {
      edits.push({ start: slot.start, end: slot.end, text: '' });
    }
  }
  const fillMarker = (name, text) => { for (const at of map.markers[name]) edits.push({ ...at, text }); };
  fillMarker('head', headText(workDir, included, live));
  fillMarker('sections', parts.filter((p) => !slotted.has(p.id) && p.fill).map((p) => p.fill).join('\n'));
  fillMarker('foot', build ? '' : footText(workDir, included));
  let html = splice(shell, edits);
  // Each piece was stripped alone, so text that is a tag only where two pieces meet (a fill ending `<scr`, the shell
  // going on `ipt>`) is escaped here: build carries no model JS at all. Escaping alone, unbounded, because the joined
  // page can nest deeper than each piece, where a second bounded strip would drop the rest. The bridge goes in after.
  if (build) html = escapeActive(html);
  let problems = [];
  if (mode === 'standalone' || inline === true) ({ html, problems } = inlineRefs(html, workDir));
  if (bridge !== null) html = insertBridge(html, bridge);

  const result = { html, mode, sections: parts.map(({ id, state }) => ({ id, state })), problems };
  if (mode === 'dist') Object.assign(result, writeDist(workDir, html, ids));
  return result;
}

/** Each plan part's file in a section folder, in judging order. Nothing else in the folder is judged. */
const PART_FILES = Object.freeze([['html', 'index.html'], ['css', 'style.css'], ['js', 'script.js']]);
const DECK_KINDS = new Set(['presentation', 'pitch']);
const SHELL_FILE = 'shell.html';
/** Global stylesheets: URL checks only, no scope, keyframes or vh rules. */
const GLOBAL_CSS = Object.freeze(['tokens.css', 'global.css']);
const LINT_MAX_FINDINGS = 200;

const finding = (rule, severity, section, file, message) => ({ rule, severity, section, file, message });
const listing = (names) => (names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`);
const reservedMessage = ({ tag, name }) => `<${tag} ${name}>: worca reserves data-worca-* attributes`;

/**
 * The raw-text backstop for `reserved-attr` (M10): every `data-worca-` in a file's text that is not in an attribute
 * name lint parsed, as one finding, or null. A browser can read text htmlparser2 did not as markup, so this holds
 * whatever their parsers differ on; a mention in text or a comment is refused too.
 */
function unparsedReserved(text, parsed, section, file) {
  const extra = reservedTextCount(text) - parsed;
  if (extra <= 0) return null;
  return finding('reserved-attr', 'error', section, file,
    `${file} holds "data-worca-" ${extra} more time${extra === 1 ? '' : 's'} than in attributes lint could read: worca reserves data-worca-* attributes, and a browser can read such text as one, so take it out`);
}

/** Pushes onto `out` a finding per reference that escapes work/, and per one that loads from another site unless it only navigates (L1.15). */
function refFindings(refs, section, file, out = []) {
  for (const { value, nav } of refs) {
    const { type } = classifyRef(value);
    const shown = JSON.stringify(String(value).trim());
    if (type === 'escaped') out.push(finding('escapes-work', 'error', section, file, `${shown} points outside the design's work folder`));
    else if (type === 'remote' && !nav) out.push(finding('external-url', 'error', section, file, `${shown} loads from another site: put the file in assets/ and point at it there`));
  }
  return out;
}

/** Why a section's index.html lacks the one root its kind needs (C-2), or null: the first fault only. A file the
 *  scan could not read as a browser does (`unread`) cannot be shown to have it, so that comes first. */
function rootFault({ roots, strayText, unread }, id, kind) {
  if (unread) return UNREAD[unread];
  if (roots.length !== 1) return `must hold exactly one root element, found ${roots.length}`;
  if (strayText) return 'has text outside its root element';
  const [{ name, attrs }] = roots;
  if (name === 'html' || name === 'head' || name === 'body') return `has <${name}> as its root, which a section cannot be`;
  if (attrs['data-section'] !== id) return `needs data-section="${id}" on its root element`;
  if (DECK_KINDS.has(kind) && !(name === 'section' && Object.hasOwn(attrs, 'data-label'))) return 'needs a <section data-label="…"> root: one slide';
  if (kind === 'video' && !(name === 'div' && Object.hasOwn(attrs, 'data-scene'))) return 'needs a <div data-scene> root: one scene';
  return null;
}

/** One section's own findings, in rule order, and the ids its index.html holds. */
function lintSection(workDir, { id, parts }, kind) {
  const planned = Array.isArray(parts) ? parts : [];
  const findings = [];
  const text = {};
  for (const [part, name] of PART_FILES) {
    const file = `sections/${id}/${name}`;
    text[part] = readConfined(workDir, file);
    if (planned.includes(part) && text[part] === null) {
      findings.push(finding('missing-part', 'error', id, file, `the plan gives ${id} a ${part} part, but ${file} is missing`));
    } else if (!planned.includes(part) && text[part] !== null) {
      findings.push(finding('unplanned-part', 'warn', id, file, `${file} is not one of ${id}'s planned parts, but it is still assembled`));
    }
  }
  let ids = [];
  if (text.html !== null) {
    const file = `sections/${id}/index.html`;
    const html = scanHtml(text.html);
    ids = html.ids;
    const fault = rootFault(html, id, kind);
    if (fault) findings.push(finding('section-root', 'error', id, file, `${file} ${fault}`));
    for (const attr of html.reserved) findings.push(finding('reserved-attr', 'error', id, file, reservedMessage(attr)));
    const unparsed = unparsedReserved(text.html, html.reserved.length, id, file);
    if (unparsed) findings.push(unparsed);
    refFindings(html.refs, id, file, findings);
  }
  if (text.css !== null) {
    const file = `sections/${id}/style.css`;
    const css = scanCss(text.css);
    const literal = id.replace(/[.*+?^${}()|[\]\\]/g, (c) => `\\${c}`);
    const scope = new RegExp(`^\\[data-section=(["']?)${literal}\\1\\]`);
    for (const selector of css.selectors) {
      if (!scope.test(selector.trim())) findings.push(finding('css-scope', 'error', id, file, `selector ${JSON.stringify(selector.trim())} must start with [data-section="${id}"]`));
    }
    for (const name of css.keyframes) {
      if (name !== id && !name.startsWith(`${id}-`)) findings.push(finding('keyframes-prefix', 'error', id, file, `@keyframes ${JSON.stringify(name)} must be named ${id} or start with ${id}-`));
    }
    refFindings(css.urls.map((value) => ({ value, nav: false })), id, file, findings);
    if (kind === 'web' && css.vh) {
      findings.push(finding('section-vh', 'warn', id, file, `${file} uses a vh unit, which changes as the stage zooms: give heights in px or clamp() without vh`));
    }
  }
  return { findings, ids };
}

/** The shell's findings, markers, slots, reserved attributes, then URLs, and the ids it holds. A missing shell reads as ''. */
function lintShell(workDir, planIds) {
  const shell = readConfined(workDir, SHELL_FILE) ?? '';
  const map = shellMap(shell);
  const faults = shellFaults(map, planIds, true);
  const findings = [];
  const add = (rule, severity, section, message) => findings.push(finding(rule, severity, section, SHELL_FILE, message));
  for (const fault of faults) if (fault.marker) add('shell-marker', 'error', null, fault.message);
  const malformed = new Map(faults.filter((fault) => fault.slot).map((fault) => [fault.slot, fault.message]));
  const known = new Set(planIds);
  const seen = new Set();
  for (const slot of map.slots) {
    const section = slot.id || null;
    const shown = JSON.stringify(slot.id);
    if (!slot.ok) {
      add('shell-slot-malformed', 'error', section, malformed.get(slot) ?? `slot ${shown} is malformed`);
      continue;
    }
    if (!known.has(slot.id)) add('shell-slot-unknown', 'error', section, `slot ${shown} is not a section in the plan`);
    if (seen.has(slot.id)) add('shell-slot-duplicate', 'error', section, `slot ${shown} appears more than once, and only the first is filled`);
    seen.add(slot.id);
    if (slot.extraAttrs) {
      add('shell-slot-attrs', 'warn', section, `slot ${shown} has other attributes, which go when the section fills it: lay it out from its parent or [data-section="${slot.id}"] in global.css`);
    }
  }
  const html = scanHtml(shell);
  for (const attr of html.reserved) if (attr.name !== 'data-worca-slot') add('reserved-attr', 'error', null, reservedMessage(attr));
  const unparsed = unparsedReserved(shell, html.reserved.length, null, SHELL_FILE);
  if (unparsed) findings.push(unparsed);
  refFindings(html.refs, null, SHELL_FILE, findings);
  return { findings, ids: html.ids };
}

/**
 * Lints a design's work/ folder against its plan: section roots per kind, CSS scope, references, reserved
 * attributes, the shell's markers and slots. Never throws. Findings follow plan order, then tokens.css and
 * global.css, the shell last; a `duplicate-id` goes last in its first holder's group. `ok` means no error. At most
 * 200 findings are listed, then one `truncated` warn; `counts` counts every finding, the `truncated` line aside.
 * @param {{ workDir: string, plan: { kind?: string, sections?: { id: string, parts?: string[] }[] }|null }} opts
 * @returns {{ ok: boolean, findings: { rule: string, severity: 'error'|'warn', section: string|null, file: string|null, message: string }[], counts: { error: number, warn: number } }}
 */
export function lintDesign({ workDir, plan } = {}) {
  const kind = plan?.kind;
  const sections = Array.isArray(plan?.sections) ? plan.sections.filter((s) => typeof s?.id === 'string') : [];
  const planIds = sections.map((s) => s.id);
  const groups = sections.map((s) => ({ name: s.id, section: s.id, file: `sections/${s.id}/index.html`, ...lintSection(workDir, s, kind) }));
  const globals = GLOBAL_CSS.flatMap((file) => {
    const css = readConfined(workDir, file);
    return css === null ? [] : refFindings(scanCss(css).urls.map((value) => ({ value, nav: false })), null, file);
  });
  const shell = { name: SHELL_FILE, section: null, file: SHELL_FILE, ...lintShell(workDir, planIds) };

  const holders = new Map();
  for (const group of [...groups, shell]) {
    for (const value of group.ids) {
      if (value === '') continue;
      if (!holders.has(value)) holders.set(value, []);
      holders.get(value).push(group);
    }
  }
  for (const [value, list] of holders) {
    if (list.length < 2) continue;
    const names = [...new Set(list.map((g) => g.name))];
    const times = list.length > names.length ? ` ${list.length} times,` : '';
    list[0].findings.push(finding('duplicate-id', 'error', list[0].section, list[0].file, `id ${JSON.stringify(value)} is used${times} by ${listing(names)}`));
  }

  const all = [...groups.flatMap((g) => g.findings), ...globals, ...shell.findings];
  const counts = { error: 0, warn: 0 };
  for (const f of all) counts[f.severity] += 1;
  const findings = all.length > LINT_MAX_FINDINGS
    ? [...all.slice(0, LINT_MAX_FINDINGS), finding('truncated', 'warn', null, null, `${all.length - LINT_MAX_FINDINGS} more findings are not listed`)]
    : all;
  return { ok: counts.error === 0, findings, counts };
}
