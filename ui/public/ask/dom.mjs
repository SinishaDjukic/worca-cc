// ui/public/ask/dom.mjs
// The DOM primitives every ask-form widget module shares. This file imports
// nothing and touches no global: the target `document` always arrives as `doc`
// (the ui/public/script-forms.mjs convention), and every function returns
// DETACHED nodes. No colour literal ever appears here — style.css owns colour.

/** `<tag class=cls>text</tag>`. `text` goes through textContent, always. */
export function h(doc, tag, cls, text) {
  const n = doc.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = String(text);
  return n;
}

/** Set attributes from a map; null/undefined/false are skipped, true becomes ''. */
export function attrs(node, map) {
  for (const [k, v] of Object.entries(map || {})) {
    if (v == null || v === false) continue;
    node.setAttribute(k, v === true ? '' : String(v));
  }
  return node;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

/** A stroked 24-grid glyph, `aria-hidden` (the control beside it carries the name). */
export function icon(doc, d, size = 16) {
  const svg = doc.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  const path = doc.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', d);
  svg.appendChild(path);
  return svg;
}

export const ICON_UP = 'M6 15l6-6 6 6';
export const ICON_DOWN = 'M6 9l6 6 6-6';
export const ICON_CHECK = 'M5 13l4 4L19 7';
export const ICON_INFO = 'M12 8v5M12 16.5h.01M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z';

/** The closed tone vocabulary a form may name — `callout.tone`, a `tones` map on
 *  `select` / `review-list`, a column's `tones` — is the four status families the
 *  stylesheet already tokens. Anything else is no tone: `data-tone` is set only
 *  for one of these, so an agent can never name a class the stylesheet lacks. */
export const TONES = Object.freeze(['info', 'ok', 'warn', 'bad']);
export const toneOf = (v) => (TONES.includes(v) ? v : '');

/** Human bytes. Mirrors the shape the Artifacts list uses: B / KB / MB. */
export function fmtBytes(n) {
  const b = Number(n) || 0;
  if (b >= 1048576) return `${(b / 1048576).toFixed(1)} MB`;
  if (b >= 1024) return `${Math.round(b / 1024)} KB`;
  return `${b} B`;
}

/** A row's OWN scalar property, or undefined. Every read of agent-named row keys
 *  (`titleKey`, `captionKey`, `fileKey`, a column `key`, a `labels` map …) goes
 *  through here: gate 1 admits `"constructor"` as a key name, and a plain `r[k]`
 *  would print `function Object() { [native code] }`. Objects never become text. */
export function own(o, k) {
  if (!o || typeof o !== 'object' || k == null || !Object.hasOwn(o, k)) return undefined;
  const v = o[k];
  return v == null || typeof v === 'object' || typeof v === 'function' ? undefined : v;
}

/** The uppercased extension of a file name, or 'FILE'. */
export function extOf(name) {
  const s = String(name == null ? '' : name);
  const dot = s.lastIndexOf('.');
  return dot > 0 && dot < s.length - 1 ? s.slice(dot + 1).toUpperCase() : 'FILE';
}

/**
 * Is `path` (a DECLARED bind path, e.g. `data.report`) a `type:'file'` field, and
 * what does it point at? X16: the envelope's `fileRefs` answers this exactly — the
 * renderer never guesses from the string, so a document body whose whole text is
 * `README.md` stays a document body and a file field stays a file whatever it holds.
 * The snapshot entry is then found by REL through ctx.fileFor — never by position:
 * P2 writes `files[i]` for `fileRefs[i]`, but a preview (P5) ships `fileRefs` with
 * `files: []`, and nothing here may depend on the two arrays lining up.
 *   → `{ rel, entry }`       a file with a snapshot: render it
 *   → `{ rel, entry: null }` a file with no snapshot: draw the .af-nofile tile (X14)
 *   → `null`                 not a file field: the bound value IS the content
 */
export function fileRefAt(path, ctx) {
  if (typeof path !== 'string' || path === '') return null;
  const refs = Array.isArray(ctx.ask && ctx.ask.fileRefs) ? ctx.ask.fileRefs : [];
  const ref = refs.find((r) => r && r.path === path);
  if (!ref) return null;
  return { rel: ref.rel, entry: ctx.fileFor(ref.rel) };
}

/** `fileRefAt` for an item's own `bind`. */
export function fileRefOfBind(item, ctx) {
  return fileRefAt(item.bind, ctx);
}

/**
 * X14 — the ONE placeholder every file widget falls back to: the file has no
 * snapshot (P5 renders a declaration's `example`, `files: []`, `fileUrl` → null) or
 * the manifest simply lacks the rel the agent named. No broken <img>, no <iframe>,
 * no loadText. The name goes through textContent, like every other agent string.
 * `.af-nofile` is the pinned class name; P5 reuses it.
 */
export function noFileTile(ctx, rel, kind = '') {
  const box = h(ctx.doc, 'div', 'af-nofile');
  box.appendChild(h(ctx.doc, 'span', 'af-file-badge', kind || extOf(rel)));
  box.appendChild(h(ctx.doc, 'span', 'af-file-name', String(rel == null ? '' : rel)));
  return box;
}

/** True when this file can actually be addressed on the wire. */
export const servable = (ctx, entry) => Boolean(entry) && ctx.fileUrl(entry.index) != null;
