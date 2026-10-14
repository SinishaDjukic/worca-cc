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

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
const escText = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\u00a0/g, '&nbsp;');
const escAttr = (t) => t.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/\u00a0/g, '&nbsp;');

/** outerHTML of `el` with scripts/styles/frames removed, on* handlers and every input's value dropped (passwords,
 *  hidden CSRF tokens, typed text), long attribute values shortened, then clipped to `max` characters (… marks a cut).
 *  Serialised straight from the page's DOM with a running budget: nothing is cloned, and the walk stops at the cut, so
 *  a capture over a huge subtree (a whole page) costs no more than a small one. */
export function htmlSnippet(el, max = SNIPPET_MAX) {
  if (!el || el.nodeType !== 1) return '';
  let out = '';
  const room = () => max + 1 - out.length;          // one character past the cap is enough to know it was cut
  const add = (t) => { out += t.length > room() ? t.slice(0, Math.max(0, room())) : t; return room() > 0; };
  const walk = (n, root) => {
    if (n.nodeType === 3) return add(escText(n.data.slice(0, room())));
    if (n.nodeType !== 1) return true;              // comments, processing instructions
    if (!root && n.matches(DROP)) return true;
    const tag = n.localName;
    let open = `<${tag}`;
    for (const at of n.attributes) {
      if (/^on/i.test(at.name) || (at.name === 'value' && tag === 'input')) continue;
      const v = at.value.length > ATTR_VALUE_MAX ? `${at.value.slice(0, ATTR_VALUE_MAX)}…` : at.value;
      open += ` ${at.name}="${escAttr(v)}"`;
      if (open.length > room()) break;
    }
    if (!add(`${open}>`)) return false;
    if (VOID.has(tag)) return true;
    for (const c of n.childNodes) if (!walk(c, false)) return false;
    return add(`</${tag}>`);
  };
  walk(el, true);
  const html = out.replace(/\s+\n/g, '\n');
  return html.length > max ? `${html.slice(0, max)}…` : html;
}
