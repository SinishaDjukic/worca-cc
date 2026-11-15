// Prose (panel.rendered-prose): Worca's finished words with their formatting, drawn by dev's own markdown renderer and
// sanitiser (ui/public/ask-markdown.mjs: marked + DOMPurify, its allow-lists, plain text on failure or past its limit).
// No highlighting: a code block is a plain monospace block. Tables take the Rail Table's classes, and a box that scrolls
// (a code block, a table) is reachable by Tab. The renderer, its load and its cache are kept per document, so one
// window's never reaches another's. `prose()` loads nothing; `loadProse()` loads once, then the page redraws.
import { esc, attrs } from './html.mjs';
import { createMarkdownRenderer } from '../../ask-markdown.mjs';

const PLAIN_LIMIT = 200_000;
const CACHE_MAX = 2000;
const states = new WeakMap();

// the modules: a test's hook first (as ui/public/app.js does), else the generated bundle's window.RailMarkdown
const defaultLoad = (doc) => () => {
  const w = doc.defaultView;
  const hook = w?.__worcaTestHooks?.askMarkdown;
  if (typeof hook === 'function') return hook();
  if (w?.RailMarkdown) return Promise.resolve(w.RailMarkdown);
  return Promise.reject(new Error('the markdown modules are not loaded'));
};

function stateOf(doc, load) {
  let st = states.get(doc);
  if (!st) {
    st = { renderer: createMarkdownRenderer({ doc, load: load ?? defaultLoad(doc) }), pending: null, cache: new Map() };
    states.set(doc, st);
  }
  return st;
}

/** Loads this document's renderer once; resolves true when it is ready, false when it failed (never rejects). */
export function loadProse({ doc = globalThis.document, load } = {}) {
  if (!doc) return Promise.resolve(false);
  const st = stateOf(doc, load), r = st.renderer;
  if (r.isReady()) return Promise.resolve(true);
  if (r.isFailed()) return Promise.resolve(false);
  if (!st.pending) {
    st.pending = r.ensure().then((ok) => !!ok, () => false).then((ok) => { st.pending = null; return ok; });
  }
  return st.pending;
}

const plainWords = (t) => esc(t).replace(/\r\n?|\n/g, '<br>');
function plainBody(text, refs, chip) {
  const parts = refs && chip ? refs(text) : null;
  if (!parts) return plainWords(text);
  return parts.map((p) => (p.ref ? chip(p) ?? plainWords(p.text) : plainWords(p.text))).join('');
}
function plain(text, refs, chip, a) {
  let body;
  try { body = plainBody(text, refs, chip); } catch { body = plainWords(text); }
  return `<div class="prose is-plain"${attrs(a)}>${body}</div>`;
}

// the sanitised fragment of `text`, before any chip: parsed once per text (paint() redraws every turn on each frame)
function mdOf(st, text) {
  if (st.cache.has(text)) { const hit = st.cache.get(text); st.cache.delete(text); st.cache.set(text, hit); return hit; }   // LRU: a hit is fresh
  const out = st.renderer.render(text);
  if (out.kind !== 'md') return null;
  if (st.cache.size >= CACHE_MAX) st.cache.delete(st.cache.keys().next().value);
  st.cache.set(text, out.frag);
  return out.frag;
}

const htmlNodes = (doc, html) => { const t = doc.createElement('template'); t.innerHTML = html; return t.content; };
const skipped = (node, sel) => !!node.parentElement?.closest(sel);
// the only attributes a reply keeps: a model could otherwise plant the host's own hooks (data-live, data-ref-url, aria-*)
const KEEP = new Set(['href', 'class', 'type', 'checked', 'disabled', 'align', 'target', 'rel']);

function postPass(doc, root, refs, chip) {
  // before any chip goes in, so a chip's own data-ref-* hooks survive
  for (const n of root.querySelectorAll('*')) for (const { name } of [...n.attributes]) if (!KEEP.has(name)) n.removeAttribute(name);
  // what the sanitiser stripped leaves no trace: a link without its href is its words, an emptied paragraph goes
  for (const a of [...root.querySelectorAll('a:not([href])')]) a.replaceWith(...a.childNodes);
  for (const p of [...root.querySelectorAll('p')]) if (!p.children.length && !p.textContent.trim()) p.remove();
  for (const table of [...root.querySelectorAll('table')]) {
    table.setAttribute('class', 'rt');
    for (const c of table.querySelectorAll('th, td')) c.setAttribute('class', 'rt-c');
    const wrap = doc.createElement('div');
    wrap.setAttribute('class', 'rt-wrap'); wrap.setAttribute('tabindex', '0'); wrap.setAttribute('aria-label', 'Table');
    table.replaceWith(wrap); wrap.appendChild(table);
  }
  for (const pre of root.querySelectorAll('pre')) { pre.setAttribute('tabindex', '0'); pre.setAttribute('aria-label', 'Code'); }
  if (!refs || !chip) return;
  // the text nodes are taken before any link becomes a chip, so a chip's own words are never chipped again
  const walker = doc.createTreeWalker(root, 4 /* NodeFilter.SHOW_TEXT */);
  const texts = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) if (!skipped(n, 'pre, code, a')) texts.push(n);
  for (const a of [...root.querySelectorAll('a[href]')]) {
    if (a.closest('pre, code')) continue;
    const href = a.getAttribute('href'), parts = refs(href);
    if (!parts || parts.length !== 1 || !parts[0].ref || parts[0].text !== href) continue;
    const html = chip({ text: a.textContent, ref: parts[0].ref });
    if (typeof html === 'string') a.replaceWith(htmlNodes(doc, html));
  }
  for (const node of texts) {
    const parts = refs(node.data);
    if (!parts) continue;
    const frag = doc.createDocumentFragment();
    for (const p of parts) {
      const html = p.ref ? chip(p) : null;
      frag.appendChild(typeof html === 'string' ? htmlNodes(doc, html) : doc.createTextNode(p.text));
    }
    node.replaceWith(frag);
  }
}

/**
 * Worca's finished words as rendered prose: `<div class="prose">` with dev's sanitised blocks once this document's
 * renderer is loaded (`loadProse`), else `<div class="prose is-plain">` with the words escaped and their line breaks.
 * `refs(text)` gives words and ref parts (or null) and `chip(part)` a part's chip HTML (or null to keep it as it is);
 * text in code and links is never chipped. Never throws.
 */
export function prose({ text, doc = globalThis.document, refs = null, chip = null, attrs: a = {} } = {}) {
  if (typeof text !== 'string' || !text.trim()) return '';
  try {
    const st = doc ? states.get(doc) : null;
    if (!st || !st.renderer.isReady() || text.length > PLAIN_LIMIT) return plain(text, refs, chip, a);
    const frag = mdOf(st, text);
    if (!frag) return plain(text, refs, chip, a);
    const box = doc.createElement('div');
    box.appendChild(frag.cloneNode(true));
    postPass(doc, box, refs, chip);
    return `<div class="prose"${attrs(a)}>${box.innerHTML}</div>`;
  } catch {
    return plain(text, refs, chip, a);
  }
}
