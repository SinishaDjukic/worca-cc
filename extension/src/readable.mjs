// extension/src/readable.mjs — a small, dependency-free "reader view" of a page for page-text.md. The DOM is read,
// never changed (it works on a clone). What CSS hides is not detected; the text is untrusted DATA either way.
import { PAGE_TEXT_MAX } from './page-context.mjs';

const DROP = 'script,style,noscript,template,svg,canvas,iframe,object,embed,nav,footer,aside,form,button,select,input,textarea,[hidden],[aria-hidden="true"],[role="navigation"],[role="banner"],[role="contentinfo"]';
const FENCE_OPEN = '\u0001';    // sentinels around <pre> text; walk() strips both from page text first
const FENCE_CLOSE = '\u0002';
const BLOCK = new Set(['P', 'DIV', 'SECTION', 'ARTICLE', 'MAIN', 'HEADER', 'BLOCKQUOTE', 'PRE', 'TABLE', 'TR', 'UL', 'OL', 'DL', 'DT', 'DD', 'FIGURE', 'FIGCAPTION', 'BR', 'HR']);

function walk(node, out) {
  for (const n of node.childNodes) {
    if (n.nodeType === 3) { out.push(n.nodeValue.replace(/[\u0001\u0002]/g, '').replace(/\s+/g, ' ')); continue; }
    if (n.nodeType !== 1) continue;
    const tag = n.tagName;
    const h = /^H([1-6])$/.exec(tag);
    if (h) { out.push(`\n\n${'#'.repeat(Number(h[1]))} `); walk(n, out); out.push('\n\n'); continue; }
    if (tag === 'LI') { out.push('\n- '); walk(n, out); out.push('\n'); continue; }
    if (tag === 'TD' || tag === 'TH') { walk(n, out); out.push(' | '); continue; }
    // v8: keep code samples' line breaks. A fenced block, protected from the per-line normalisation below.
    if (tag === 'PRE') { out.push(`\n\n${FENCE_OPEN}${n.textContent.replace(/[\u0001\u0002]/g, '').replace(/\n+$/, '')}${FENCE_CLOSE}\n\n`); continue; }
    const block = BLOCK.has(tag);
    if (block) out.push('\n\n');
    walk(n, out);
    if (block) out.push('\n\n');
  }
}

export function extractReadable(doc, { max = PAGE_TEXT_MAX } = {}) {
  // v8: priority order, not document order. A teaser <article> placed before <main> must not win.
  const root = doc.querySelector('main') || doc.querySelector('[role="main"]') || doc.querySelector('article') || doc.body;
  if (!root) return { text: '', truncated: false };
  const clone = root.cloneNode(true);
  for (const n of [...clone.querySelectorAll(DROP)]) n.remove();
  const out = [];
  walk(clone, out);
  // Normalise prose line by line, but leave the <pre> fences (FENCE_OPEN … FENCE_CLOSE) byte for byte.
  const parts = out.join('').split(/(\u0001[\s\S]*?\u0002)/);
  let text = parts.map((p) => p.startsWith(FENCE_OPEN)
    ? '```\n' + p.slice(1, -1) + '\n```'
    : p.split('\n').map((l) => l.replace(/[ \t]+/g, ' ').trim()).join('\n')).join('')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/(?<=^- [^\n]*)\n\n(?=- )/gm, '\n')   // every item gap, not every other one (lookbehind consumes nothing)
    .trim();
  const truncated = text.length > max;
  if (truncated) text = `${text.slice(0, max)}\n\n[… truncated]`;
  return { text, truncated };
}
