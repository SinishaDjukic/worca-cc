// src/core/workspace-map/verify.mjs
// Evidence or it does not exist (spec D4): re-read the cited file and look for the literal
// `match` on or near the cited line; if it is elsewhere in the file the line is re-anchored; if
// it is nowhere the fact is dropped with a reason. Paths never escape the member root — not even
// through a symlinked directory.

import { stat } from 'node:fs/promises';
import { relative, resolve, sep } from 'node:path';

import { LIMITS } from '../../shared/workspace-map/limits.mjs';
import { redactLines, redactSecrets } from '../../shared/workspace-map/redact.mjs';
import { resolveInside, readAbsText } from './files.mjs';

/** → { lines(absPath, root?): Promise<string[]|null> } — an LRU of split, REDACTED files (the
 *  lines as the map may see them: redactLines, so a PEM body is '***'), so a brief that cites one
 *  file forty times reads it once. `root`: the member dir the file's real path must stay inside
 *  (verifyFact always passes it). */
export function createFileCache({ maxEntries = 256 } = {}) {
  const cache = new Map();
  return {
    lines(absPath, root = null) {
      // Keyed by (root, file): one file may lie inside one member and outside another (nested members).
      const key = `${root ?? ''}\0${absPath}`;
      if (cache.has(key)) {
        const hit = cache.get(key);
        cache.delete(key);
        cache.set(key, hit);
        return hit;
      }
      const p = readAbsText(absPath, { root }).then((text) => (text === null ? null : redactLines(text.split(/\r?\n/))));
      cache.set(key, p);
      if (cache.size > maxEntries) cache.delete(cache.keys().next().value);
      return p;
    },
  };
}

const squash = (s) => String(s).replace(/\s+/g, ' ').trim();

function findLine(lines, needle, from, to, fold) {
  const n = fold ? needle.toLowerCase() : needle;
  for (let i = from; i <= to; i += 1) {
    const hay = squash(lines[i - 1] ?? '');
    if ((fold ? hay.toLowerCase() : hay).includes(n)) return i;
  }
  return 0;
}

const REDACTED_FIELDS = Object.freeze(['key', 'match', 'detail', 'target', 'label']);

/** fact: {file, line, match, ...}. The REDACTED match is searched in the REDACTED lines, so a raw
 *  and a redacted citation both verify. Whitespace-collapsed substring search of `match` in lines
 *  [line-W, line+W] (W = EVIDENCE_WINDOW, nearest hit wins); on miss, the whole file →
 *  re-anchors `line` (first hit); on miss, case-insensitive whole-file search → re-anchors.
 *  Returns the fact with the (possibly corrected) line, `lineCorrected: true|false`, `file` as
 *  the member-relative POSIX path (`./src//a.ts` → `src/a.ts`), and key / match / detail /
 *  target / label redacted. A match of nothing but redaction marks (`***`) is an empty match.
 *  reasons: 'bad path' | 'missing file' | 'unreadable' | 'bad line' | 'empty match' | 'match not found' */
export async function verifyFact(memberDir, fact, { cache } = {}) {
  const c = cache || createFileCache();
  const abs = resolveInside(memberDir, fact?.file);
  if (!abs) return { ok: false, reason: 'bad path' };
  if (!Number.isInteger(fact.line) || fact.line < 1) return { ok: false, reason: 'bad line' };
  const needle = typeof fact.match === 'string' ? squash(redactSecrets(fact.match)) : '';
  // A citation of nothing but redaction marks ('***') would verify on any line that held a secret.
  if (!needle || !needle.replace(/\*{3}/g, '').trim()) return { ok: false, reason: 'empty match' };
  const lines = await c.lines(abs, memberDir);
  if (!lines) {
    const exists = await stat(abs).then(() => true, () => false);
    return { ok: false, reason: exists ? 'unreadable' : 'missing file' };
  }
  const W = LIMITS.EVIDENCE_WINDOW;
  let hit = 0;
  for (let d = 0; d <= W && !hit; d += 1) {
    for (const i of d === 0 ? [fact.line] : [fact.line - d, fact.line + d]) {
      if (i >= 1 && i <= lines.length && findLine(lines, needle, i, i, false)) { hit = i; break; }
    }
  }
  if (!hit) hit = findLine(lines, needle, 1, lines.length, false);
  if (!hit) hit = findLine(lines, needle, 1, lines.length, true);
  if (!hit) return { ok: false, reason: 'match not found' };
  const file = relative(resolve(memberDir), abs).split(sep).join('/');
  const out = { ...fact, file, line: hit, lineCorrected: hit !== fact.line };
  for (const k of REDACTED_FIELDS) if (typeof out[k] === 'string') out[k] = redactSecrets(out[k]);
  return { ok: true, fact: out };
}
