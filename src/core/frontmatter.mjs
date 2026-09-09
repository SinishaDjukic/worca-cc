// The ONE reader of an agent .md's leading YAML frontmatter. Four private copies
// existed (agent-registry's description reader, workflows.mjs' and plugin-store's
// tools readers, workflow-export's fence matcher); the three READERS now share
// this. Deliberately NOT a YAML parser: subagent frontmatter is `key: value`
// single-line scalars (name / description / tools / model) — block scalars
// degrade to '' (the indicator is never stored), unknown keys ride `fields`.
import { openSync, readSync, closeSync } from 'node:fs';

/** Bytes read from the HEAD of an agent file. Every shipped frontmatter is < 2 KB;
 *  a fence that does not close inside the window reads as "no frontmatter" — the
 *  body (a 4–8 KB prompt) is never read by a frontmatter consumer. */
export const FRONTMATTER_HEAD_BYTES = 8192;

/** Leading fence: optional BOM, `---`, newline (LF or CRLF), inner YAML, newline,
 *  `---`, then end of line or end of text. m[1] = the inner YAML. */
export const FRONTMATTER_RE = /^\uFEFF?---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;

const KEY_LINE_RE = /^([A-Za-z][A-Za-z0-9_-]*)[ \t]*:[ \t]*(.*)$/;
const BLOCK_SCALAR_RE = /^[>|][+-]?$/;

function scalar(raw) {
  const v = raw.trim();
  if (BLOCK_SCALAR_RE.test(v)) return '';                                   // folded/literal indicator, not the text
  if (v.length >= 2 && ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))) {
    return v.slice(1, -1).trim();
  }
  return v;
}

/**
 * @param {unknown} text the file text (or its head)
 * @returns {{name:string, description:string, tools:string[], model:string, fields:Record<string,string>}|null}
 *   null when the text carries no leading fence (or the fence never closes).
 */
export function parseFrontmatter(text) {
  if (typeof text !== 'string') return null;
  const m = FRONTMATTER_RE.exec(text);
  if (!m) return null;
  const fields = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = KEY_LINE_RE.exec(line);
    if (!kv || Object.hasOwn(fields, kv[1])) continue;                      // continuation lines / repeats are skipped
    fields[kv[1]] = scalar(kv[2]);
  }
  const tools = (fields.tools || '').split(',').map((s) => s.trim()).filter(Boolean);
  return { name: fields.name || '', description: fields.description || '', tools, model: fields.model || '', fields };
}

/** Everything after the fence; the whole text when there is none. */
export function stripFrontmatter(text) {
  const s = typeof text === 'string' ? text : '';
  const m = FRONTMATTER_RE.exec(s);
  return m ? s.slice(m[0].length) : s;
}

/**
 * Read + parse the frontmatter of a file, touching at most `maxBytes` of its
 * head. Synchronous (the registry loader is synchronous). Missing file,
 * unreadable file, no fence ⇒ null — never throws.
 * @param {string} path
 * @param {number} [maxBytes]
 */
export function readFrontmatterSync(path, maxBytes = FRONTMATTER_HEAD_BYTES) {
  let fd = null;
  try {
    fd = openSync(path, 'r');
    const buf = Buffer.alloc(maxBytes);
    const n = readSync(fd, buf, 0, maxBytes, 0);
    return parseFrontmatter(buf.subarray(0, n).toString('utf8'));
  } catch {
    return null;
  } finally {
    if (fd !== null) { try { closeSync(fd); } catch { /* ignore */ } }
  }
}
