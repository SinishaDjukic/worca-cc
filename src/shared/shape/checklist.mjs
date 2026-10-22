// Perspective checklists inside a plan (spec D5/D7): `### Checklist` blocks of `- [ ] R-<prefix>-<n> statement` items.
// Read by the shape check now, and by the reviewer header and PR writer in slice 3. Browser-safe.
import { PERSPECTIVES, splitSections } from './perspectives.mjs';

export const CHECKLIST_ID_RE = /^R-([a-z]+)-([1-9]\d*)$/;
const ITEM_RE = /^[ \t]*[-*+][ \t]+\[[ xX]\][ \t]+(\S+)(?:[ \t]+(.*?))?[ \t]*$/;
const CHECKLIST_HEAD_RE = /^###[ \t]+checklist[ \t]*$/i;
const ANY_HEAD_RE = /^#{1,3}[ \t]/;
const PERSPECTIVE_BY_PREFIX = new Map(PERSPECTIVES.filter((p) => p.checklist).map((p) => [p.checklist, p.key]));

/**
 * Every item under a `### Checklist` heading (fenced code ignored).
 * @returns {{items:Array<{id:string, perspective:string, text:string, section:string|null}>,
 *            malformed:Array<{text:string, section:string|null, why:string}>}}
 */
export function scanChecklists(body) {
  const items = [];
  const malformed = [];
  const seen = new Set();
  for (const s of splitSections(body)) {
    let inList = false;
    for (const line of s.text.split('\n')) {
      if (CHECKLIST_HEAD_RE.test(line)) { inList = true; continue; }
      if (ANY_HEAD_RE.test(line)) { inList = false; continue; }
      if (!inList || !line.trim()) continue;
      const m = ITEM_RE.exec(line);
      if (!m) { malformed.push({ text: line.trim(), section: s.key, why: 'not a "- [ ] R-<perspective>-<n> statement" item' }); continue; }
      const id = /^R-/.test(m[1]) ? m[1] : null;
      const idm = id ? CHECKLIST_ID_RE.exec(id) : null;
      const perspective = idm ? PERSPECTIVE_BY_PREFIX.get(idm[1]) : null;
      if (!idm || !perspective) { malformed.push({ text: line.trim(), section: s.key, why: `bad id ${m[1]}` }); continue; }
      if (!m[2]) { malformed.push({ text: line.trim(), section: s.key, why: `${id} has no statement` }); continue; }
      if (seen.has(id)) { malformed.push({ text: line.trim(), section: s.key, why: `duplicate id ${id}` }); continue; }
      seen.add(id);
      items.push({ id, perspective, text: m[2], section: s.key });
    }
  }
  return { items, malformed };
}

/** `[{ id, perspective, text }]`. */
export function extractChecklist(markdown) {
  return scanChecklists(markdown).items.map(({ id, perspective, text }) => ({ id, perspective, text }));
}
