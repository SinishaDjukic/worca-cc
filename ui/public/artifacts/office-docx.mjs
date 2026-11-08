// ui/public/artifacts/office-docx.mjs — .docx for the simplified Office preview: docx-preview's page layout, rendered inline in
// the stage but never trusted. docx-preview renders into an INERT document (its element factory `h`), so nothing it makes
// can fetch or apply; its body HTML then goes through DOMPurify (Ask's config, extended; only this render's blob: URLs
// survive in src/href/url()), and its CSS through scopeDocxCss (plain rules, allow-listed selectors under `.olp-docx`).
// docx-preview never sees a compressed archive: every part is read through the capped reader and repacked STORED, after
// the image references were budgeted (docx-preview makes one blob per reference).
import { PURIFY_BASE } from '../ask-markdown.mjs';
import { attr, parseXml, sniffImageType } from './office-xml.mjs';
import { OfficeLiteError } from './office-zip.mjs';

/** docx-preview's options, pinned (plan D7). `h` is added per render. */
export const DOCX_OPTIONS = Object.freeze({
  className: 'docx', inWrapper: true, breakPages: true,
  ignoreFonts: true,            // no @font-face: document fonts are global and could restyle the app
  renderAltChunks: false,       // altChunk is a same-origin srcdoc iframe of raw document HTML
  renderComments: false, renderChanges: false, experimental: false, useBase64URL: false, debug: false,
  trimXmlDeclaration: true, hideWrapperOnPrint: false,
  renderHeaders: true, renderFooters: true, renderFootnotes: true, renderEndnotes: true,
});

const without = (list, drop) => list.filter((x) => !drop.includes(x));
const DOCX_TAGS = Object.freeze([...new Set([...without(PURIFY_BASE.ALLOWED_TAGS, ['input']),
  'div', 'span', 'section', 'article', 'header', 'footer', 'img', 'sup', 'sub', 'wbr', 'colgroup', 'col', 'tbody',
  'svg', 'g', 'rect', 'ellipse', 'line', 'polyline', 'polygon', 'path', 'image'])]);
const DOCX_ATTR = Object.freeze([...new Set([...without(PURIFY_BASE.ALLOWED_ATTR, ['type', 'checked', 'disabled']),
  'style', 'src', 'alt', 'width', 'height', 'colspan', 'rowspan', 'span', 'viewBox', 'd', 'x', 'y', 'x1', 'y1', 'x2', 'y2',
  'cx', 'cy', 'rx', 'ry', 'r', 'points', 'fill', 'stroke', 'stroke-width', 'transform', 'preserveAspectRatio', 'href'])]);

/** The sanitiser config for docx-preview's body HTML. Every allowed attribute that carries no URL is URI-safe: DOMPurify
 *  tests every other attribute VALUE against ALLOWED_URI_REGEXP, which would strip colspan, width, viewBox, d… The hook
 *  checks those values itself (fill/stroke can hold a url()). No data-* or aria-*: app.js has global handlers keyed on
 *  data attributes. */
export const DOCX_PURIFY_CONFIG = Object.freeze({
  ALLOWED_TAGS: DOCX_TAGS,
  ALLOWED_ATTR: DOCX_ATTR,
  ALLOW_DATA_ATTR: false,
  ALLOW_ARIA_ATTR: false,
  ADD_URI_SAFE_ATTR: Object.freeze(without(DOCX_ATTR, ['src', 'href', 'xlink:href'])),
  ALLOWED_URI_REGEXP: /^blob:/i,
  FORBID_TAGS: Object.freeze(['style', 'link', 'meta', 'base', 'iframe', 'frame', 'object', 'embed', 'form', 'input', 'button',
    'textarea', 'select', 'foreignObject', 'use', 'script', 'template', 'math']),
  FORBID_ATTR: Object.freeze(['id', 'name', 'srcset', 'action', 'formaction']),
});

const URL_RE = /url\(\s*(['"]?)(.*?)\1\s*\)/gi;
const URL_TAKING_FN = /(?:^|[^A-Za-z0-9_-])(?:-webkit-)?(?:image-set|image|cross-fade|element|src)\s*\(/i;
const EMPTY = new Set();

/** Every url( argument is a blob: URL of this render, and no other function takes a URL string. */
function urlsOk(value, blobSet) {
  if (URL_TAKING_FN.test(value)) return false;
  const all = value.match(/url\(/gi) || [];
  const found = [...value.matchAll(URL_RE)];
  if (all.length !== found.length) return false;
  return found.every((m) => m[2].startsWith('blob:') && blobSet.has(m[2]));
}

const STYLE_BAD = /\\|expression\s*\(|@import|</i;
const TEXT_ATTRS = new Set(['alt', 'title']);    // plain text, never parsed as CSS
/** docx-preview's own class tokens: `docx…` (its className prefix) and the fixed table-look classes. A document can put
 *  any other token in a style id (escapeClassName collapses only spaces and dots), e.g. one of the app's own classes. */
const DOCX_CLASS = /^docx[-_A-Za-z0-9]*$/;
const TABLE_CLASSES = new Set(['first-row', 'last-row', 'first-col', 'last-col', 'odd-row', 'even-row', 'odd-col', 'even-col',
  'ne-cell', 'nw-cell', 'se-cell', 'sw-cell', 'no-hband', 'no-vband']);
let currentBlobs = null;               // the blob set of the sanitize() call in progress (synchronous)

function onAttribute(node, data) {
  const name = data.attrName;
  const value = String(data.attrValue ?? '');
  const tag = String(node.nodeName || '').toLowerCase();
  const blobs = currentBlobs || EMPTY;
  if (name === 'href' && tag === 'a') { data.keepAttr = false; return; }   // javascript:, https, '' or an app #route
  if (name === 'src' || name === 'href' || name === 'xlink:href') {
    if (!blobs.has(value)) data.keepAttr = false;                           // src="null" would be a relative GET
    return;
  }
  if (name === 'class') {
    const keep = value.split(/[\t\n\f\r ]+/).filter((c) => DOCX_CLASS.test(c) || TABLE_CLASSES.has(c));
    if (keep.length) data.attrValue = keep.join(' ');
    else data.keepAttr = false;
    return;
  }
  if (TEXT_ATTRS.has(name)) return;
  // style, and every presentation attribute (fill, stroke…): no escape, no other URL than this render's blobs.
  if (STYLE_BAD.test(value) || !urlsOk(value, blobs)) data.keepAttr = false;
}

const purifiers = new WeakMap();

/** One DOMPurify instance per window (never Ask's), with the attribute hook added once. */
export function docxPurifier(createDOMPurify, win) {
  if (purifiers.has(win)) return purifiers.get(win);
  const purify = createDOMPurify(win);
  purify.addHook('uponSanitizeAttribute', onAttribute);
  const api = {
    sanitize(html, blobSet) {
      currentBlobs = blobSet;
      try {
        return purify.sanitize(html, { ...DOCX_PURIFY_CONFIG, RETURN_DOM_FRAGMENT: true });
      } finally {
        currentBlobs = null;
      }
    },
  };
  purifiers.set(win, api);
  return api;
}

const SELECTOR_OK = /^[A-Za-z0-9_\-\s.#>+~*:,()[\]="']+$/;
const PROP_OK = /^-?[a-z][a-z0-9-]*$/;
const CUSTOM_PROP_OK = /^--[A-Za-z0-9_-]+$/;
const VALUE_BAD = /[{};<>@]/;

/** Split a selector list at top-level commas (not inside (), [] or quotes). */
function splitSelectors(text) {
  const out = [];
  let depth = 0;
  let quote = null;
  let cur = '';
  for (const ch of String(text)) {
    if (quote) { if (ch === quote) quote = null; cur += ch; continue; }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '(' || ch === '[') depth += 1;
    else if (ch === ')' || ch === ']') depth -= 1;
    else if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  out.push(cur.trim());
  return out;
}

/** Backslashes only inside quoted strings, and each one starts a CSS hex escape (`"\9"`, `"\a0"`, `"\2022"`). Outside a
 *  string a hex escape can spell a function name (`u\72l(`), so it is refused there. */
function escapesOk(value) {
  let quote = null;
  for (let i = 0; i < value.length; i++) {
    const ch = value[i];
    if (quote) {
      if (ch === '\\') { if (!/[0-9A-Fa-f]/.test(value[i + 1] || '')) return false; continue; }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '\\') return false;
  }
  return quote === null;
}

function scopedOk(text, scope, CSSStyleSheetCtor) {
  if (text === '') return true;
  try {
    const sheet = new CSSStyleSheetCtor();
    sheet.replaceSync(text);
    for (const rule of sheet.cssRules) {
      if (rule.type !== 1) return false;
      if (!splitSelectors(rule.selectorText).every((s) => s.startsWith(`${scope} `))) return false;
    }
    return true;
  } catch {
    return false;
  }
}

/** docx-preview's <style> text → plain rules under `scope`, or '' (plan D6.3). `emit` exists so a test can force a bad
 *  output through the self-check. */
export function scopeDocxCss(cssText, { scope = '.olp-docx', CSSStyleSheet: CSSStyleSheetCtor, blobSet = EMPTY, emit = (rules) => rules.join('\n') } = {}) {
  let sheet;
  try {
    sheet = new CSSStyleSheetCtor();
    sheet.replaceSync(String(cssText));
  } catch {
    return '';
  }
  const rules = [];
  for (const rule of sheet.cssRules) {
    if (rule.type !== 1) continue;
    const sels = splitSelectors(rule.selectorText);
    if (!sels.length || sels.some((s) => s === '' || !SELECTOR_OK.test(s))) continue;
    const decls = [];
    for (let i = 0; i < rule.style.length; i++) {
      const prop = rule.style[i];
      if (!PROP_OK.test(prop) && !CUSTOM_PROP_OK.test(prop)) continue;
      const value = String(rule.style.getPropertyValue(prop)).trim();
      if (value === '' || VALUE_BAD.test(value) || /[\r\n]/.test(value) || !escapesOk(value) || !urlsOk(value, blobSet)) continue;
      decls.push(`${prop}: ${value}${rule.style.getPropertyPriority(prop) ? ' !important' : ''}`);
    }
    if (!decls.length) continue;
    rules.push(`${sels.map((s) => `${scope} ${s}`).join(', ')} { ${decls.join('; ')} }`);
  }
  if (!rules.length) return '';
  const out = emit(rules);
  return scopedOk(out, scope, CSSStyleSheetCtor) ? out : '';
}

/** docx-preview's own element factory, over `inertDoc`: strings → text nodes, `#fragment`, `#comment`, `ns`, className,
 *  style (string or object), other props as DOM properties, Nodes passed through. */
export function inertFactory(inertDoc) {
  const isNode = (x) => x != null && typeof x === 'object' && typeof x.nodeType === 'number' && typeof x.cloneNode === 'function';
  const h = (elem) => {
    if (typeof elem === 'string' || elem instanceof String) return inertDoc.createTextNode(String(elem));
    if (isNode(elem)) return elem;
    const { ns, tagName, className, style, children, ...props } = elem;
    if (tagName === '#fragment') {
      const frag = inertDoc.createDocumentFragment();
      if (children) children.forEach((c) => frag.appendChild(h(c)));
      return frag;
    }
    if (tagName === '#comment') return inertDoc.createComment(children ? String(children[0]) : '');
    const el = ns ? inertDoc.createElementNS(ns, tagName) : inertDoc.createElement(tagName);
    if (className) el.setAttribute('class', className);
    if (style) {
      if (typeof style === 'string') el.setAttribute('style', style);
      else Object.assign(el.style, style);
    }
    for (const [k, v] of Object.entries(props)) if (v !== undefined) el[k] = v;
    if (children) children.forEach((c) => el.appendChild(h(c)));
    return el;
  };
  return h;
}

const REL_LOCALS = new Set(['embed', 'id', 'link']);
const RELS_PATH = /^(.*\/)?_rels\/([^/]*)\.rels$/;

/** docx-preview's resolvePath: a relationship target against its part's folder, through a URL (so `media\\a.png`,
 *  `//docx/…` and `http://docx/…` all land on a package path). */
export function docxResolve(target, folder) {
  const prefix = 'http://docx/';
  try {
    return new URL(target, prefix + folder).toString().substring(prefix.length);
  } catch {
    return `${folder}${target}`;
  }
}

/** docx-preview's normalizePath: its loader strips ONE leading `/` before it looks a path up. */
const docxPath = (p) => (p.startsWith('/') ? p.slice(1) : p);

/** The package paths docx-preview can load → the entry each one reads. Its loader tries the path, then the path with every
 *  `/` turned into `\\`, so an entry named with backslashes is found under the slash form too. */
export function docxPaths(names) {
  const view = new Map();
  for (const n of names) if (!n.includes('\\')) view.set(n, n);
  for (const n of names) {
    if (!n.includes('\\') || n.includes('/')) continue;
    const p = n.replace(/\\/g, '/');
    if (!view.has(p)) view.set(p, n);
  }
  return view;
}

/** The bytes docx-preview would allocate for image references: per reference (r:embed / r:id / r:link on any element)
 *  to ANY relationship of that part (docx-preview reads neither Type nor TargetMode), the declared size of the entry the
 *  target resolves to, the way docx-preview resolves it. Past limits.maxTotal → EXPANDS (plan D8). A part with
 *  relationships whose name is not .xml/.rels was never decoded or DTD-checked → UNREADABLE. `names`: every entry. */
export function imageRefBudget(xmlTexts, sizeOf, DOMParserCtor, limits, names = [...xmlTexts.keys()]) {
  const view = docxPaths(names);
  let sum = 0;
  for (const [relsPath, relsEntry] of view) {
    const m = RELS_PATH.exec(relsPath);
    if (!m || !m[2] || !xmlTexts.has(relsEntry)) continue;     // _rels/.rels names no references
    const folder = m[1] || '';
    const source = view.get(folder + m[2]);
    if (source == null) continue;
    if (!xmlTexts.has(source)) throw new OfficeLiteError('UNREADABLE', 'part');
    const targets = new Map();
    for (const r of [...parseXml(xmlTexts.get(relsEntry), DOMParserCtor).documentElement.childNodes].filter((n) => n.nodeType === 1)) {
      const id = attr(r, 'Id');
      if (targets.has(id)) continue;                            // docx-preview takes the first relationship with an id
      const p = docxPath(docxResolve(attr(r, 'Target'), folder));
      targets.set(id, Number(sizeOf(view.get(p) ?? p)) || 0);
    }
    if (!targets.size) continue;
    for (const el of parseXml(xmlTexts.get(source), DOMParserCtor).getElementsByTagName('*')) {
      for (const a of el.attributes) {
        if (!REL_LOCALS.has(a.localName) || !targets.has(a.value)) continue;
        sum += targets.get(a.value);
        if (sum > limits.maxTotal) throw new OfficeLiteError('EXPANDS', sum);
      }
    }
  }
  return sum;
}

const CT_NS = 'http://schemas.openxmlformats.org/package/2006/content-types';
const xmlAttr = (v) => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

/** The [Content_Types].xml docx-preview gets: two Overrides per path it can load, because it compares the RAW resolved
 *  path while its loader strips one leading `/` (so `/word/media/a.png` loads `word/media/a.png`): the `/`-prefixed name
 *  first (it wins over an entry whose own name starts with `/`, which the loader never reads for that path), then the
 *  plain one. Typed PNG/JPEG/GIF only when the bytes are that image, else application/octet-stream; no Defaults.
 *  docx-preview gives each picture blob this type, and a blob typed text/html or image/svg+xml would run script in the
 *  app's origin when opened in a tab (an untyped one is left to the browser's sniffing). */
export function docxContentTypes(parts) {
  const view = [...docxPaths([...parts.keys()])];
  const row = (name, entry) => `<Override PartName="${xmlAttr(name)}" ContentType="${sniffImageType(parts.get(entry)) || 'application/octet-stream'}"/>`;
  const rows = [...view.map(([path, entry]) => row(`/${path}`, entry)), ...view.map(([path, entry]) => row(path, entry))];
  return `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="${CT_NS}">${rows.join('')}</Types>`;
}

const BLOB_RE = /blob:[^\s"'()<>]+/g;

function collectBlobs(node, into) {
  const scan = (text) => { for (const m of String(text).match(BLOB_RE) || []) into.add(m); };
  if (node.nodeType !== 1) return;
  if (node.nodeName.toLowerCase() === 'style') scan(node.textContent);
  for (const el of [node, ...node.querySelectorAll('*')]) {
    for (const a of el.attributes) scan(a.value);
    if (el !== node && el.nodeName.toLowerCase() === 'style') scan(el.textContent);
  }
}

/** A capped .docx → {node: div.olp-docx (detached, in the live document), blobUrls}. */
export async function renderDocx({ zip, docx, createDOMPurify, win, limits }) {
  const { bytes: stored, xmlTexts } = await zip.restore({ prepare: (parts) => new Map([['[Content_Types].xml', docxContentTypes(parts)]]) });
  imageRefBudget(xmlTexts, (n) => zip.size(n), win.DOMParser, limits, zip.names());
  const parsed = await docx.parseAsync(stored, DOCX_OPTIONS);
  const inertDoc = win.document.implementation.createHTMLDocument('');
  const nodes = await docx.renderDocument(parsed, { ...DOCX_OPTIONS, h: inertFactory(inertDoc) });
  const blobSet = new Set();
  for (const n of nodes) collectBlobs(n, blobSet);
  try {
    const purifier = docxPurifier(createDOMPurify, win);
    const doc = win.document;
    const root = doc.createElement('div');
    root.className = 'olp-docx';
    const css = [];
    for (const n of nodes) {
      if (n.nodeType !== 1) continue;                                  // #comment and stray text
      if (n.nodeName.toLowerCase() === 'style') {
        const scoped = scopeDocxCss(n.textContent, { CSSStyleSheet: win.CSSStyleSheet, blobSet });
        if (scoped) css.push(scoped);
        continue;
      }
      const box = inertDoc.createElement('div');
      box.appendChild(n);
      root.appendChild(purifier.sanitize(box.innerHTML, blobSet));
    }
    if (css.length) {
      const style = doc.createElement('style');
      style.textContent = css.join('\n');
      root.prepend(style);
    }
    return { node: root, blobUrls: [...blobSet] };
  } catch (err) {
    for (const u of blobSet) { try { win.URL.revokeObjectURL(u); } catch { /* already gone */ } }   // I3: nothing left behind
    throw err;
  }
}
