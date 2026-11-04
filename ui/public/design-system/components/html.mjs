// The two helpers every component shares: escape text, and write attributes from an object. A component returns an
// HTML string, so it works in a page that renders with innerHTML (the prototype, most app views) and in tests without
// a DOM; a page that builds elements takes it through `toElement`.

/** Escapes text for an HTML body or an attribute value. */
export const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * Writes attributes in the order given: `true` writes the bare name, `false`, `null` and `undefined` write nothing,
 * anything else is escaped. `{ 'data-key': 'x', disabled: true }` → ` data-key="x" disabled`.
 */
export function attrs(o = {}) {
  return Object.entries(o).map(([k, v]) => (v === true ? ` ${k}` : v === false || v == null ? '' : ` ${k}="${esc(v)}"`)).join('');
}

/** Joins class names, dropping empty ones. */
export const cls = (...xs) => xs.flat().filter(Boolean).join(' ');

/** The first element of `html`, for a page that builds elements (`doc` is injected for jsdom). */
export function toElement(doc, html) {
  const t = doc.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}
