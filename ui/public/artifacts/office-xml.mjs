// ui/public/artifacts/office-xml.mjs — the XML helpers the simplified Office preview's readers share. XML is parsed only with
// the page's DOMParser, and any text holding a DTD is refused first (OOXML and ODF never carry one), which removes the
// internal-entity expansion vector. Elements and attributes match by localName, so Strict OOXML namespaces work too.
import { OfficeLiteError } from './office-zip.mjs';

const DTD_RE = /<!DOCTYPE|<!ENTITY/i;

/** Throws UNREADABLE when the text holds a DOCTYPE or an ENTITY declaration. */
export function assertNoDtd(text) {
  if (DTD_RE.test(String(text))) throw new OfficeLiteError('UNREADABLE', 'dtd');
}

/** text → an XML Document, through `DOMParserCtor` (the stage window's). A DTD or a parse error is UNREADABLE. */
export function parseXml(text, DOMParserCtor) {
  assertNoDtd(text);
  const doc = new DOMParserCtor().parseFromString(String(text), 'application/xml');
  if (!doc || !doc.documentElement || doc.getElementsByTagName('parsererror').length) throw new OfficeLiteError('UNREADABLE', 'xml');
  return doc;
}

const elementsOf = (el) => (el ? [...el.childNodes].filter((n) => n.nodeType === 1) : []);

/** The child elements of `el` named `local` (any namespace), in order. */
export function kids(el, local) {
  return elementsOf(el).filter((c) => c.localName === local);
}

/** The first child element of `el` named `local`, or null. */
export function kid(el, local) {
  return elementsOf(el).find((c) => c.localName === local) || null;
}

/** Every descendant element of `el` named `local`, in document order. */
export function descendants(el, local) {
  return el ? [...el.getElementsByTagNameNS('*', local)] : [];
}

/** The value of the attribute whose localName is `local`, or null. */
export function attr(el, local) {
  if (!el || !el.attributes) return null;
  for (const a of el.attributes) if (a.localName === local) return a.value;
  return null;
}

/** The r:id of an element: the attribute named id that has a namespace (sheet and sldId also carry a plain id). */
export function relId(el) {
  for (const a of el && el.attributes ? el.attributes : []) if (a.localName === 'id' && a.namespaceURI) return a.value;
  return null;
}

/** A relationship target relative to the part that names it → the package path ('../' and a leading '/' handled). */
export function resolvePart(fromPart, target) {
  const t = String(target || '');
  const base = t.startsWith('/') ? [] : String(fromPart || '').split('/').slice(0, -1);
  const out = base[0] === '_rels' && base.length === 1 ? [] : base;
  for (const seg of t.replace(/^\/+/, '').split('/')) {
    if (seg === '..') out.pop();
    else if (seg !== '.' && seg !== '') out.push(seg);
  }
  return out.join('/');
}

/** The relationships of a part (`<dir>/_rels/<base>.rels`) → Map<id, {target, type, external}>; empty when there are none. */
export async function relsOf(zip, partPath, DOMParserCtor) {
  const p = String(partPath || '');
  const cut = p.lastIndexOf('/');
  const relsPath = `${p.slice(0, cut + 1)}_rels/${p.slice(cut + 1)}.rels`;
  const out = new Map();
  if (!zip.has(relsPath)) return out;
  const doc = await zip.xml(relsPath, DOMParserCtor);
  for (const r of descendants(doc.documentElement, 'Relationship')) {
    const id = attr(r, 'Id');
    if (id == null) continue;
    out.set(id, { target: attr(r, 'Target') || '', type: attr(r, 'Type') || '', external: attr(r, 'TargetMode') === 'External' });
  }
  return out;
}

const ODF_SKIP = new Set(['note', 'annotation', 'tracked-changes', 'frame']);

/** An ODF text element's text: `text:s` → c spaces (default 1), `text:tab` → tab, `text:line-break` → newline; notes,
 *  annotations, tracked changes and frames are skipped. */
export function odfText(el) {
  let s = '';
  for (const n of el ? el.childNodes : []) {
    if (n.nodeType === 3 || n.nodeType === 4) { s += n.data; continue; }
    if (n.nodeType !== 1) continue;
    const name = n.localName;
    if (name === 's') s += ' '.repeat(Math.max(1, Math.min(1000, Number.parseInt(attr(n, 'c'), 10) || 1)));
    else if (name === 'tab') s += '\t';
    else if (name === 'line-break') s += '\n';
    else if (!ODF_SKIP.has(name)) s += odfText(n);
  }
  return s;
}

/** The image type by magic bytes: PNG, JPEG or GIF only (WMF/EMF and anything else → null). */
export function sniffImageType(bytes) {
  const b = bytes || [];
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return 'image/png';
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length >= 6 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38 && (b[4] === 0x37 || b[4] === 0x39) && b[5] === 0x61) return 'image/gif';
  return null;
}
