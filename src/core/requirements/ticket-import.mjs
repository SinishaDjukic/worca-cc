// src/core/requirements/ticket-import.mjs
// What Worca takes from a tracker ticket (plans/requirements-a61-design.md D5–D9, D14, §4): the description without a criteria
// section, the criteria, the comments as one Markdown file, the attachments with the reason one cannot come along, the default
// ticks within A8's caps, and the thread line. Pure: no I/O. Ticket text is data from the tracker: redacted here (D15) before the
// preview shows it and before anything is stored.
import { redactAskText } from '../ask/redact.mjs';
import { classifyExtension } from '../ask/attachment-kind.mjs';
import { LIMITS, clip } from './spec.mjs';
import { REQ_ATTACH_LIMITS, OFFICE_EXTENSIONS, displayName } from './attachments.mjs';
import { exportDate } from './ticket.mjs';

export const IMPORT_LIMITS = Object.freeze({ comments: 50, commentChars: 4000, page: 20 });
export const CAP_FILES = 'A feature takes up to 10 files; 10 are picked.';
export const CAP_BYTES = "Picked files are at 100 MB, a new feature's limit. Add more on the feature page.";

const oneLine = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();
// A cut must not leave half of a surrogate pair: drop a trailing lone high surrogate.
const wf = (s) => (/[\ud800-\udbff]$/.test(s) ? s.slice(0, -1) : s);
const sclip = (v, max) => wf(clip(v, max));
const extOf = (name) => { const i = String(name).lastIndexOf('.'); return i > 0 ? String(name).slice(i).toLowerCase() : ''; };

// D7: a heading, a bold line, or a line ending in ":" that reads "Acceptance criteria", "Acceptance criterion" or "AC"
const NAME_RE = /^(?:acceptance\s+criteri(?:a|on)|ac)$/i;
function headingName(line) {
  const s = line.trim();
  const m = /^#{1,6}\s+(.+?)\s*#*$/.exec(s) || /^\*\*(.+?)\*\*\s*:?$/.exec(s) || /^__(.+?)__\s*:?$/.exec(s) || /^([^:]+):$/.exec(s);
  if (!m) return null;
  const name = m[1].replace(/[:\s]+$/, '').trim();
  return NAME_RE.test(name) ? name : null;
}
const LIST_RE = /^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?(.*)$/;
const isHeading = (line) => /^\s*#{1,6}\s/.test(line);

/** D7: the first criteria section of a Markdown description: its items (a list, or the lines up to the next heading or blank
 *  line), at most LIMITS.items of LIMITS.item characters, and the description without the section. */
export function splitCriteria(markdown) {
  const lines = String(markdown ?? '').replace(/\r\n?/g, '\n').split('\n');
  const at = lines.findIndex((l) => headingName(l) !== null);
  if (at < 0) return { description: String(markdown ?? ''), items: [], heading: null };
  const heading = headingName(lines[at]);
  let i = at + 1;
  while (i < lines.length && !lines[i].trim()) i += 1;
  const raw = [];
  if (i < lines.length && LIST_RE.test(lines[i])) {
    for (; i < lines.length; i += 1) {
      const line = lines[i];
      if (!line.trim()) {
        let j = i + 1;
        while (j < lines.length && !lines[j].trim()) j += 1;
        if (j < lines.length && LIST_RE.test(lines[j])) { i = j - 1; continue; }   // a loose list: a blank line between items
        break;
      }
      if (isHeading(line)) break;
      const m = LIST_RE.exec(line);
      if (m) raw.push(m[1]);
      else if (raw.length) raw[raw.length - 1] += ` ${line.trim()}`;   // a continuation line
      else break;
    }
  } else {
    for (; i < lines.length && lines[i].trim() && !isHeading(lines[i]); i += 1) raw.push(lines[i]);
  }
  const all = raw.map((x) => sclip(x, LIMITS.item)).filter(Boolean);
  const items = all.slice(0, LIMITS.items);
  const over = all.slice(LIMITS.items).map((x) => `- ${x}`);   // past the cap: stays in the description, not dropped
  const description = [...lines.slice(0, at), ...over, ...lines.slice(i)].join('\n').replace(/\n{3,}/g, '\n\n').trim();
  return { description, items, heading };
}

/** D6: the description the form keeps, up to the last paragraph break before LIMITS.description characters. */
export function clipDescription(text) {
  const s = String(text ?? '');
  if (s.length <= LIMITS.description) return { text: s, clipped: false };
  const cut = s.lastIndexOf('\n\n', LIMITS.description);
  return { text: wf(cut > 0 ? s.slice(0, cut) : s.slice(0, LIMITS.description)).trimEnd(), clipped: true };
}

const MARK = /<redacted(?:-jwt)?>/g;
const marks = (s) => (String(s).match(MARK) || []).length;
/** D15: redactAskText, and how many things it hid (the preview says so). */
export function redactCounted(text) {
  const s = String(text ?? '');
  const out = redactAskText(s);
  return { text: out, hidden: Math.max(0, marks(out) - marks(s)) };
}

export const commentsFileName = (key) => `${key} comments.md`;
export const descriptionFileName = (key) => `${key} description.md`;

/** §4: the picked comments as one text file, in the ticket's order: "**<author>** · <d Mon yyyy>" and the body. */
const commentBlock = (c) => {
  const date = exportDate(c.created);
  return `**${oneLine(c.author) || 'Someone'}**${date ? ` · ${date}` : ''}\n${String(c.body ?? '').trim()}`;
};
export function commentsMarkdown(key, comments = []) {
  const blocks = comments.map(commentBlock);
  return `# Comments on ${key}\n\n${blocks.join('\n\n')}\n`;
}

const READS = 'Worca reads text, images and PDF.';
/** D9: why an attachment is not offered, said for a file not added yet; null when A8 can take it. */
export function importReason(name, cls, bytes) {
  if (!cls) return OFFICE_EXTENSIONS.includes(extOf(name)) ? `Not offered: ${READS} Save it as PDF to attach it here.` : `Not offered: ${READS}`;
  if (Number(bytes) > REQ_ATTACH_LIMITS.fileBytes) return 'Not offered: it is over 25 MB.';
  if (!(Number(bytes) > 0)) return 'Not offered: it is empty.';
  return null;
}

/** D14: the one thread line an import writes (its `export` turn `imported`). The caller escapes it with asData. */
export function importThreadLine({ tracker, key, criteria = [], comments = 0 } = {}) {
  const ids = Array.isArray(criteria) ? criteria : [];
  const crit = !ids.length ? 'It had no acceptance criteria'
    : ids.length === 1 ? `Its acceptance criterion is ${ids[0]}` : `Its acceptance criteria are ${ids[0]} to ${ids.at(-1)}`;
  const files = Number(comments) > 0 ? `; its comments are in “${commentsFileName(key)}”` : '';
  return `The product owner started this feature from ${tracker} ticket ${key}. ${crit}${files}.`;
}

const named = (v) => (v && (v.id != null || v.name) ? { id: v.id == null ? null : String(v.id), name: oneLine(v.name) } : null);
const text1 = (v) => (v == null ? null : oneLine(v));
// Only the contract's documented keys go on; whatever else a tracker sends stays behind.
function pickMeta(m) {
  const o = m && typeof m === 'object' ? m : {};
  return { project: text1(o.project), projectName: text1(o.projectName), type: named(o.type), status: text1(o.status), priority: named(o.priority) };
}

/** D5–D9: a tracker's importTicket answer (§4) as the preview shows it and the create stores it. Redacted, clipped, capped. */
export function processTicket(raw, { tracker }) {
  let redacted = 0;
  const red = (s) => { const r = redactCounted(s); redacted += r.hidden; return r.text; };
  const key = String(raw.key);
  const fromField = raw.criteria && Array.isArray(raw.criteria.items) && raw.criteria.items.some((x) => oneLine(x));
  // Redact BEFORE splitting or clipping, so a secret cut by a line or a limit is still seen whole.
  const desc = red(String(raw.description ?? ''));
  let split;
  let items;
  if (fromField) {
    const kept = raw.criteria.items.map((x) => redactCounted(String(x ?? ''))).map((r) => ({ hidden: r.hidden, text: sclip(oneLine(r.text), LIMITS.item) }))
      .filter((r) => r.text).slice(0, LIMITS.items);
    redacted += kept.reduce((n, r) => n + r.hidden, 0);   // only the criteria that are kept
    split = { description: desc, heading: null };
    items = kept.map((r) => r.text);
  } else {
    split = splitCriteria(desc);
    items = split.items.map((x) => sclip(oneLine(x), LIMITS.item)).filter(Boolean);
  }
  const whole = split.description.trim();
  const clipped = clipDescription(whole);
  const fld = raw.criteria && raw.criteria.field;
  const field = fld && fld.id ? { id: String(fld.id), name: oneLine(fld.name) } : null;
  const criteria = fromField
    ? { from: 'field', name: (field && field.name) || null, field, items }
    : { from: items.length ? 'section' : null, name: items.length ? split.heading : null, field: null, items };
  const all = Array.isArray(raw.comments) ? raw.comments : [];
  const comments = all.slice(-IMPORT_LIMITS.comments).map((c) => {
    const body = sclip(red(String(c.body ?? '')), IMPORT_LIMITS.commentChars);
    const author = oneLine(c.author) || 'Someone';
    return { id: String(c.id), author, authorKind: c.authorKind === 'app' ? 'app' : 'person', created: c.created || null,
      when: exportDate(c.created, { year: false }), body,
      bytes: Buffer.byteLength(`${commentBlock({ author, created: c.created, body })}\n\n`, 'utf8') };
  });
  const restrictedComments = Math.max(0, Number(raw.restrictedComments) || 0);
  const total = raw.commentsTotal == null || raw.commentsTotal === '' ? NaN : Number(raw.commentsTotal);
  const commentsTotal = Math.max(Number.isFinite(total) ? total : 0, all.length + restrictedComments);
  const attachments = (Array.isArray(raw.attachments) ? raw.attachments : []).map((a) => {
    const name = displayName(a.name);
    const cls = classifyExtension(extOf(name));
    const bytes = Math.max(0, Number(a.bytes) || 0);
    return { id: String(a.id), name, kind: cls ? cls.kind : null, mime: cls ? cls.mime : '', bytes, refused: importReason(name, cls, bytes) };
  });
  const descriptionFile = clipped.clipped
    ? { name: descriptionFileName(key), text: whole, bytes: Buffer.byteLength(whole, 'utf8') } : null;
  return {
    key, url: raw.url || null, tracker, meta: pickMeta(raw.meta), title: sclip(oneLine(red(String(raw.title ?? ''))), LIMITS.title) || key,
    description: clipped.text, descriptionFile, clipped: clipped.clipped, redacted, criteria, comments, commentsTotal, restrictedComments,
    olderComments: Math.max(0, commentsTotal - restrictedComments - comments.length), attachments, fingerprint: raw.fingerprint || null,
  };
}

/** D5, D9: the default ticks. `form`: the files already on the New feature form ({ count, bytes }). */
export function pickDefaults(p, { count = 0, bytes = 0 } = {}) {
  const L = REQ_ATTACH_LIMITS;
  const comments = p.comments.map((c) => ({ ...c, picked: c.authorKind === 'person' }));
  const picked = comments.filter((c) => c.picked);
  let n = count + (picked.length ? 1 : 0) + (p.descriptionFile ? 1 : 0);
  let size = bytes + picked.reduce((s, c) => s + c.bytes, 0) + (p.descriptionFile ? p.descriptionFile.bytes : 0);
  const attachments = p.attachments.map((a) => {
    if (a.refused) return { ...a, picked: false, capped: null };
    if (n + 1 > L.files) return { ...a, picked: false, capped: 'files' };
    if (size + a.bytes > L.requestBytes) return { ...a, picked: false, capped: 'bytes' };
    n += 1;
    size += a.bytes;
    return { ...a, picked: true, capped: null };
  });
  return { ...p, criteria: { ...p.criteria, picked: p.criteria.items.map(() => true) }, comments, attachments };
}
