// src/core/requirements/ticket.mjs
// The tool-neutral ticket (plans/requirements-a6-design.md D4, D6, D8, §4): what Worca sends a tracker, built from the spec;
// each tracker plugin maps it to its own format. The changes since the last export, the comment that lists them, and the
// preview hash. Pure: no I/O; dates are the server's local time with English month abbreviations.
import { createHash } from 'node:crypto';
import { changedSince } from './ready.mjs';
import { renderTicketMarkdown, criterionLine } from './markdown.mjs';

export const EXPORT_LIMITS = Object.freeze({ labels: 10, label: 255 });
/** The ticket's sections in board 27's order, with their names (the again dialog and the comment use them too). */
const TICKET_SECTIONS = Object.freeze([['actors', 'Actors'], ['flow', 'Main flow'], ['rules', 'Business rules'], ['edgeCases', 'Edge cases'],
  ['outOfScope', 'Out of scope']]);
const SECTION_NAME = Object.fromEntries(TICKET_SECTIONS);
const MON = Object.freeze(['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']);

/** The label Worca always adds and never lets go (D6, D10): how it finds the ticket again. */
export const exportLabel = (f) => `worca-${f.id}`;

/** D6: labels as the preview shows and the tracker receives them. */
export function normalizeLabels(list, fixed = null) {
  const out = [];
  for (const raw of Array.isArray(list) ? list : []) {
    if (typeof raw !== 'string') continue;
    const l = raw.trim().replace(/\s+/g, '-').slice(0, EXPORT_LIMITS.label);
    if (!l || l === fixed || out.includes(l)) continue;
    out.push(l);
  }
  const room = fixed ? EXPORT_LIMITS.labels - 1 : EXPORT_LIMITS.labels;
  return [...out.slice(0, room), ...(fixed ? [fixed] : [])];
}

/** "26 Oct 2026" (or "26 Oct"), the server's local date (D8); '' without a date. */
export function exportDate(iso, { year = true } = {}) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getDate()} ${MON[d.getMonth()]}${year ? ` ${d.getFullYear()}` : ''}`;
}

/** "26 Oct, 10:42" for the History card (D17). */
export function exportTime(iso) {
  const day = exportDate(iso, { year: false });
  if (!day) return '';
  const d = new Date(iso);
  return `${day}, ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** The neutral ticket (D4, §4). `criteria` is the setup's target; with a field the description leaves its criteria out. */
export function buildTicket(f, { project, issueType, labels = [], priority = null, criteria = { target: 'description' }, reason = null, exportedOn,
  mentionedFiles = [], ownKey = null } = {}) {
  const toField = !!(criteria && criteria.target === 'field' && criteria.field);
  return {
    project, issueType, title: f.title,
    description: renderTicketMarkdown(f, { reason, exportedOn, criteriaInDescription: !toField, mentionedFiles, ownKey }),
    labels: normalizeLabels(labels, exportLabel(f)),
    priority: priority || null,
    criteria: toField ? { target: 'field', field: criteria.field, items: f.spec.criteria.map((c) => criterionLine(c, ownKey)) } : { target: 'description' },
  };
}

const confirmedOf = (spec) => ((spec && spec.assumptions) || []).filter((a) => a && a.status === 'confirmed');

/** D8: what changed since the last export, reduced to what a ticket shows. Criteria first, then the goal and its measure,
 *  then the sections in the ticket's order (a section's changed lines are its removed and added lines paired in order),
 *  then the assumptions that entered or left `confirmed`. Open questions are not in a ticket and never count. */
export function exportChanges(before, after) {
  const strip = (s) => ({ ...(s || {}), openQuestions: [], assumptions: [] });
  const raw = changedSince(strip(before), strip(after));
  const out = raw.filter((c) => c.kind === 'criterion');
  out.push(...raw.filter((c) => c.kind === 'goal'));
  for (const [section] of TICKET_SECTIONS) {
    const c = raw.find((x) => x.kind === 'section' && x.section === section);
    if (!c) continue;
    const n = Math.min(c.added.length, c.removed.length);
    out.push({ kind: 'section', section, pairs: c.removed.slice(0, n).map((old, i) => [old, c.added[i]]), added: c.added.slice(n), removed: c.removed.slice(n) });
  }
  const was = new Map(confirmedOf(before).map((a) => [a.id, a]));
  const now = new Map(confirmedOf(after).map((a) => [a.id, a]));
  for (const [id, a] of now) if (!was.has(id)) out.push({ kind: 'assumption', id, change: 'confirmed', text: a.text });
  for (const [id, a] of was) if (!now.has(id)) out.push({ kind: 'assumption', id, change: 'unconfirmed', text: a.text });
  return out;
}

const lines = (n) => `${n} line${n === 1 ? '' : 's'}`;
const goalName = (field) => (field === 'measure' ? 'Measure' : 'Goal');

/** The again dialog's lines (board 28): one per criterion and assumption, one per goal field and section. */
export function changeSummary(changes) {
  const out = [];
  for (const c of changes || []) {
    if (c.kind === 'criterion') {
      const text = c.change === 'removed' ? c.before : c.after;
      out.push({ line: `${{ added: 'Added', edited: 'Changed', removed: 'Removed' }[c.change]} ${c.id} ${text}`, id: c.id });
    } else if (c.kind === 'goal') {
      const what = !c.before ? 'added' : !c.after ? 'removed' : 'changed';
      out.push({ line: `${goalName(c.field)}: 1 line ${what}`, id: null });
    } else if (c.kind === 'section') {
      const parts = [];
      if (c.pairs.length) parts.push(`${lines(c.pairs.length)} changed`);
      if (c.added.length) parts.push(`${lines(c.added.length)} added`);
      if (c.removed.length) parts.push(`${lines(c.removed.length)} removed`);
      out.push({ line: `${SECTION_NAME[c.section]}: ${parts.join(', ')}`, id: null });
    } else if (c.kind === 'assumption') {
      out.push(c.change === 'confirmed' ? { line: `Confirmed ${c.id} ${c.text}`, id: c.id } : { line: `${c.id} is no longer confirmed`, id: c.id });
    }
  }
  return out;
}

/** The comment of Add a comment (design §4, board 28): the head, an Export anyway reason, one paragraph per change, the footer.
 *  A6.1 D11: 'since the import' until the first export of an imported link. */
export function renderExportComment(f, changes, { since, reason = null, after = 'export' } = {}) {
  const out = [`Updated in Worca since the ${after === 'import' ? 'import' : 'last export'} (${since})`];
  if (reason) out.push(`Exported before Ready: ${reason}`);
  for (const c of changes || []) {
    if (c.kind === 'criterion') {
      if (c.change === 'added') out.push(`Added ${c.id} ${c.after}`);
      else if (c.change === 'edited') out.push(`Changed ${c.id}: “${c.after}” was “${c.before}”`);
      else out.push(`Removed ${c.id} ${c.before}`);
    } else if (c.kind === 'goal') {
      const name = goalName(c.field);
      if (!c.before) out.push(`${name}: added “${c.after}”`);
      else if (!c.after) out.push(`${name}: removed “${c.before}”`);
      else out.push(`${name}: “${c.after}” was “${c.before}”`);
    } else if (c.kind === 'section') {
      const name = SECTION_NAME[c.section];
      for (const [old, now] of c.pairs) out.push(`${name}: “${now}” was “${old}”`);
      for (const l of c.added) out.push(`${name}: added “${l}”`);
      for (const l of c.removed) out.push(`${name}: removed “${l}”`);
    } else if (c.kind === 'assumption') {
      out.push(c.change === 'confirmed' ? `Confirmed ${c.id} ${c.text}` : `${c.id} is no longer confirmed`);
    }
  }
  out.push(`From Worca ${f.id}`);
  return `${out.join('\n\n')}\n`;
}

const canonical = (v) => (Array.isArray(v) ? v.map(canonical)
  : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canonical(v[k])])) : v);

/** D6: the preview's hash, of the canonical JSON of exactly what will be sent. */
export const ticketHash = (value) => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
