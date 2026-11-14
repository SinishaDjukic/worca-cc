// src/core/design/look-source.mjs
// The `Look source:` line a document's lead writes first in brand.md: which source set the document's look (the
// brief, the project, a skill, or worca's own), and why. The plan gate and the lint rule both read it here. Pure.

export const LOOK_SOURCES = Object.freeze(['brief', 'project', 'skill', 'worca']);

/** The line as the prompts and the refusals quote it. */
export const LOOK_LINE = 'Look source: <brief|project|skill|worca> — <why>';

const MAX_READ = 64 * 1024;
const MAX_WHY = 300;
// The label, with light markdown tolerated around it: a list bullet or a heading mark first, bold or italics around.
const LABEL = /^\s*(?:[-*+]\s+|#{1,6}\s+)?(?:\*\*|__|\*|_)?look source(?:\*\*|__|\*|_)?\s*:(?:\*\*|__|\*|_)?(.*)$/i;
// The source word (markdown marks around it dropped), then what follows it.
const WORD = /^\s*[*_`]*([^\s*_`:—–-]*)[*_`]*(.*)$/;
// The dash or colon that leads the why.
const WHY = /^\s*[—–:-]\s*(.*)$/;

/**
 * Reads brand.md's `Look source:` line. Only the first 64 KiB is read; the why is trimmed and capped at 300 chars.
 * `project` is refused when the lead had no Project line (`hasProject: false`): the one precedence fact worca knows.
 * @param {unknown} text brand.md's text, or anything else when it was not written
 * @param {{ hasProject?: boolean }} [opts]
 * @returns {{ ok: true, source: string, why: string } | { ok: false, errors: string[] }}
 */
export function readLookSource(text, { hasProject = true } = {}) {
  const refuse = (error) => ({ ok: false, errors: [error] });
  if (typeof text !== 'string') return refuse(`brand.md was not written: its first line is "${LOOK_LINE}"`);
  const lines = [];
  for (const line of text.slice(0, MAX_READ).split(/\r?\n/)) {
    const m = LABEL.exec(line);
    if (m) lines.push(m[1]);
  }
  if (lines.length === 0) return refuse(`brand.md has no "Look source:" line: write "${LOOK_LINE}" as its first line`);
  if (lines.length > 1) return refuse(`brand.md has ${lines.length} "Look source:" lines: keep one`);
  const [, word, rest] = WORD.exec(lines[0]);
  const source = word.toLowerCase();
  if (!LOOK_SOURCES.includes(source)) {
    return refuse(`brand.md: Look source must be brief, project, skill or worca, found ${JSON.stringify(word)}`);
  }
  const why = WHY.exec(rest)?.[1].trim().slice(0, MAX_WHY).trim() ?? '';
  if (why === '') return refuse('brand.md: the Look source line says why after the dash');
  if (source === 'project' && !hasProject) {
    return refuse('brand.md: Look source is project, but your task has no Project line: name the brief, a skill or worca');
  }
  return { ok: true, source, why };
}
