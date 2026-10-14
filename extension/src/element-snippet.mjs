// extension/src/element-snippet.mjs — what the area capture tells the agent about the page's DOM: the element under the
// selected rectangle, a CSS selector for it and a short outerHTML snippet. Runs in the content script; pure DOM (no
// window globals beyond `doc`), so jsdom tests it (test/extension-element-snippet.test.mjs). ALL of it is page data:
// it travels only inside page-capture.md (untrusted, D4).
export const SNIPPET_MAX = 2000;
export const SELECTOR_MAX = 300;
export const ATTR_VALUE_MAX = 200;
const DROP = 'script, style, noscript, template, iframe, object, embed';

/** CSS.escape where the page has it, else the spec's algorithm for identifiers (jsdom lacks CSS.escape). */
export function cssEscape(s, win = globalThis) {
  if (win && win.CSS && typeof win.CSS.escape === 'function') return win.CSS.escape(String(s));
  return String(s)
    .replace(/[^a-zA-Z0-9_\u00a0-\uffff-]/g, (c) => `\\${c}`)
    .replace(/^(-?)(\d)/, (m, dash, d) => `${dash}\\3${d} `);
}

/** A selector that matches `el` (unique when it can be): #id when the id is unique, else tag:nth-of-type steps up to
 *  the nearest uniquely-id'd ancestor or <body>. Capped at SELECTOR_MAX characters. */
export function cssSelector(el, { maxDepth = 8 } = {}) {
  const doc = el && el.ownerDocument;
  if (!doc || el.nodeType !== 1) return null;
  const win = doc.defaultView;
  const uniqueId = (n) => n.id && doc.querySelectorAll(`#${cssEscape(n.id, win)}`).length === 1;
  const steps = [];
  let n = el;
  for (let depth = 0; n && n.nodeType === 1 && depth < maxDepth; depth += 1) {
    if (uniqueId(n)) { steps.unshift(`#${cssEscape(n.id, win)}`); break; }
    const tag = n.localName;
    if (tag === 'body' || tag === 'html') { steps.unshift(tag); break; }
    const sibs = n.parentElement ? [...n.parentElement.children].filter((c) => c.localName === tag) : [];
    steps.unshift(sibs.length > 1 ? `${tag}:nth-of-type(${sibs.indexOf(n) + 1})` : tag);
    n = n.parentElement;
  }
  const sel = steps.join(' > ');
  return sel.length > SELECTOR_MAX ? sel.slice(sel.length - SELECTOR_MAX).replace(/^[^>]*>\s*/, '') : sel;
}

/** The deepest element that holds everything the rectangle covers: the common ancestor of the topmost elements at the
 *  centre and four inset points. `skip(n)` excludes our own overlay host. null when nothing is there. */
export function elementUnder(doc, rect, skip = () => false) {
  if (!doc || typeof doc.elementsFromPoint !== 'function' || !rect) return null;
  const inset = (v, len) => v + Math.min(len / 2, Math.max(2, len * 0.1));
  const pts = [
    [rect.x + rect.width / 2, rect.y + rect.height / 2],
    [inset(rect.x, rect.width), inset(rect.y, rect.height)],
    [rect.x + rect.width - (inset(rect.x, rect.width) - rect.x), inset(rect.y, rect.height)],
    [inset(rect.x, rect.width), rect.y + rect.height - (inset(rect.y, rect.height) - rect.y)],
    [rect.x + rect.width - (inset(rect.x, rect.width) - rect.x), rect.y + rect.height - (inset(rect.y, rect.height) - rect.y)],
  ];
  const hits = pts.map(([x, y]) => doc.elementsFromPoint(x, y).find((e) => !skip(e) && e !== doc.documentElement) || null).filter(Boolean);
  if (!hits.length) return null;
  let common = hits[0];
  while (common && !hits.every((h) => common.contains(h))) common = common.parentElement;
  return common && common !== doc.documentElement ? common : (doc.body || null);
}

/** outerHTML of `el` with scripts/styles/frames removed, on* handlers and password values dropped, long attribute values
 *  shortened, then clipped to `max` characters (… marks a cut). */
export function htmlSnippet(el, max = SNIPPET_MAX) {
  if (!el || el.nodeType !== 1) return '';
  const c = el.cloneNode(true);
  for (const d of c.querySelectorAll(DROP)) d.remove();
  for (const n of [c, ...c.querySelectorAll('*')]) {
    for (const a of [...n.attributes]) {
      if (/^on/i.test(a.name)) n.removeAttribute(a.name);
      else if (a.name === 'value' && n.localName === 'input' && String(n.getAttribute('type')).toLowerCase() === 'password') n.removeAttribute('value');
      else if (a.value.length > ATTR_VALUE_MAX) n.setAttribute(a.name, `${a.value.slice(0, ATTR_VALUE_MAX)}…`);
    }
  }
  const html = c.outerHTML.replace(/\s+\n/g, '\n');
  return html.length > max ? `${html.slice(0, max)}…` : html;
}
