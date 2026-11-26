// src/shared/shape/outline-note.mjs — the Planner's outline-change note as data: the title the stop's question line
// uses, the body blocks (paragraphs, inline code and lists; everything else stays literal text) and what shows while
// the note is folded. Pure and browser-safe: run-stops.mjs reads the title, ui/public/shape/note-body.mjs draws.

export const NOTE_TITLE_MAX = 120;
export const NOTE_FOLD_LINES = 6;
export const NOTE_FOLD_ROWS = 4;
export const NOTE_LINE_CHARS = 90;   // about one line of --fs-body text at the card's normal width

const LIST_RE = /^\s*([-*]|\d+[.)])\s+(.*)$/;
const HEADING_RE = /^\s*#{1,6}(?:\s+|$)/;
const FENCE_RE = /^\s*```/;

const linesOf = (text) => (typeof text === 'string' ? text.replace(/^\uFEFF/, '').split(/\r?\n/) : []);
const firstFilled = (lines) => lines.findIndex((l) => l.trim());

function titleOf(line) {
  if (line === undefined || LIST_RE.test(line)) return null;
  const t = line.replace(/^[#\s]+/, '').replace(/^(?:slice|run)\s+\d+\s*[:·—–-]\s*/i, '').replace(/`/g, '').trim();
  return t && t.length <= NOTE_TITLE_MAX ? t : null;
}

/** The note's reason in one line, case kept; null when the first line is a list line, empty or too long. */
export function noteTitle(text) {
  const lines = linesOf(text);
  return titleOf(lines[firstFilled(lines)]);
}

/** A title as the end of a question: an ordinary capitalised first word goes lowercase, and the sentence ends. */
export function noteClause(title) {
  const clause = /^[A-Z][a-z]*(?=[\s,.;:!?]|$)/.test(title) ? title[0].toLowerCase() + title.slice(1) : title;
  const ended = clause.replace(/:$/, '.');
  return /[.!?]$/.test(ended) ? ended : `${ended}.`;
}

/** One source line as text and inline code parts: `x` within the line; an unmatched backtick stays text. */
function inlineParts(line) {
  if (FENCE_RE.test(line)) return [{ text: line, code: false }];
  return line.split(/`([^`]+)`/).map((text, i) => ({ text, code: i % 2 === 1 })).filter((p) => p.text);
}

/** Appends a soft-broken line to `parts` with one space, merging neighbouring text parts. */
function joinLine(parts, line) {
  const next = inlineParts(line.trim());
  if (parts.length) next.unshift({ text: ' ', code: false });
  for (const p of next) {
    const last = parts.at(-1);
    if (last && !last.code && !p.code) last.text += p.text; else parts.push({ ...p });
  }
}

/** A list row that is one word (a path, a hash, a name): its bare value, else null. */
function loneName(parts) {
  const value = parts.map((p) => p.text).join('').replace(/`/g, '').trim();
  return value && !/\s/.test(value) ? value : null;
}

/** The note as blocks: `{kind:'p', parts}` and `{kind:'list', ordered, items:[{n, parts, lone}]}`. `dropTitle` leaves
 *  out the title line, only when the note has a title. */
export function noteBlocks(text, { dropTitle = false } = {}) {
  const lines = linesOf(text);
  const at = firstFilled(lines);
  const skip = dropTitle && titleOf(lines[at]) !== null ? at : -1;
  const blocks = [];
  let para = null; let list = null; let item = null;
  const closeList = () => {
    if (list) for (const it of list.items) it.lone = loneName(it.parts);
    list = null; item = null;
  };
  lines.forEach((line, i) => {
    if (i === skip) return;
    if (!line.trim()) { para = null; item = null; return; }   // a blank line keeps a list open for its next row
    const row = line.match(LIST_RE);
    if (row) {
      para = null;
      const ordered = /^\d/.test(row[1]);
      if (list && list.ordered !== ordered) closeList();
      if (!list) { list = { kind: 'list', ordered, items: [] }; blocks.push(list); }
      item = { n: ordered ? row[1] : null, parts: [], lone: null };
      list.items.push(item);
      joinLine(item.parts, row[2]);
      return;
    }
    if (item && /^\s/.test(line)) { joinLine(item.parts, line); return; }
    closeList();
    if (HEADING_RE.test(line)) {
      para = null;
      const heading = { kind: 'p', parts: [] };
      joinLine(heading.parts, line.replace(HEADING_RE, ''));
      if (heading.parts.length) blocks.push(heading);
      return;
    }
    if (!para) { para = { kind: 'p', parts: [] }; blocks.push(para); }
    joinLine(para.parts, line);
  });
  closeList();
  return blocks;
}

const paraLines = (b) => Math.max(1, Math.ceil(b.parts.reduce((n, p) => n + p.text.length, 0) / NOTE_LINE_CHARS));

/** What shows while folded: up to six lines of text in note order, plus a list reached within them (four rows and
 *  "+N more"). `shown[].index` points into `blocks`; `cut` says something is hidden, clamped or cut. */
export function foldNote(blocks) {
  const shown = [];
  let used = 0;
  for (const [index, block] of blocks.entries()) {
    const later = index < blocks.length - 1;
    if (block.kind === 'list') {
      const rows = Math.min(NOTE_FOLD_ROWS, block.items.length);
      const more = block.items.length - rows;
      shown.push({ index, rows, more });
      return { shown, cut: more > 0 || later };
    }
    if (used >= NOTE_FOLD_LINES) return { shown, cut: true };
    const lines = paraLines(block);
    if (used + lines > NOTE_FOLD_LINES) {
      shown.push({ index, clamp: NOTE_FOLD_LINES - used });
      return { shown, cut: true };
    }
    shown.push({ index });
    used += lines;
  }
  return { shown, cut: false };
}
