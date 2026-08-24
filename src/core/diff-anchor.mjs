// src/core/diff-anchor.mjs
// The ONE anchor resolver behind POST /api/history/:key/:id/comments and the
// add_diff_comment MCP tool. It imports the SAME parser the browser renders with:
// ui/public/diff-view.mjs is DOM-free by design (its own header says so, and
// test/diff-view.test.mjs already drives it under node:test), so validation and
// rendering can never disagree — including MAX_FILE_SECTION_CODE_UNITS, where a row
// past the cap fails validation here exactly as it fails to render there.
//
// This is the ONE place in src/ that reaches into ui/public. ui/server.mjs already
// imports ./public/hljs-loader.mjs, so the direction is established; concentrating
// it here keeps it legible. The module is NOT moved: ui/public is the only directory
// express.static serves, so relocating it under src/ would need a new static route
// plus edits to app.js, index.html and two test files, for nothing.
//
// isProtectedBasename comes from ask/tools.mjs, where it is defined and exported.
// That direction is safe: tools.mjs has ZERO imports, so this can never close a
// cycle.
import { splitPatchSections, patchIndex, sectionKey, parseFileSection, MAX_FILE_SECTION_CODE_UNITS } from '../../ui/public/diff-view.mjs';
import { isProtectedBasename } from './ask/tools.mjs';
import { GUARDRAIL_PRESETS } from './guardrails.mjs';

/** The floor, exactly as tool-deps.mjs chooses it: never the run's own set. */
export const SECURE_PROTECTED_PATHS = Object.freeze([...GUARDRAIL_PRESETS.secure.protectedPaths]);

/** A refusal the caller returns verbatim (HTTP 400 / AskToolError text). */
export class AnchorError extends Error {
  constructor(message) { super(message); this.name = 'AnchorError'; }
}

/**
 * The member projects a patch declares, in order. The test is byte-identical to
 * splitPatchSections' own rather than the stricter MEMBER_HEADER_RE in
 * ask/tools.mjs, so this can never disagree with the sections it is checked
 * against. Scanned from the raw text, not from the sections, so a member whose
 * patch contributed no section is still reported.
 */
export function patchMembers(text) {
  const out = [];
  for (const line of String(text ?? '').split('\n')) {
    if (!/^# \S/.test(line)) continue;
    const key = line.slice(2).trim();
    if (key && !out.includes(key)) out.push(key);
  }
  return out;
}

/** The section a (member, path) pair names in an ALREADY-PARSED index, or null. */
function pick(index, member, path) {
  return index.get(sectionKey(member || null, path)) || null;
}

/** The section a (member, path) pair names, or null. One parse per call. */
function findSection(text, member, path) {
  return pick(patchIndex(splitPatchSections(text)), member, path);
}

/**
 * A section whose path this parser could NOT read. git C-quotes any name holding
 * '"', '\\', a tab or a control byte — and, in patches persisted before
 * core.quotePath=false was pinned (git-info.mjs:127), any non-ASCII name — as
 * `"a/old\tsecret.pem"`. splitPatchSections keeps that literal, quotes and all
 * (its DESCOPED note, diff-view.mjs:187-191: graceful for RENDERING), so
 * isProtectedBasename tests the string `"a/old\tsecret.pem"` against `*.pem` and
 * answers FALSE. get_run_diff has no such hole — splitUnifiedDiff un-C-quotes
 * (ask/tools.mjs:23-41) — so this is the ONE place the two disagree, and it
 * disagrees in the unsafe direction.
 * It is reachable under an ordinary name: `rename from "old\tsecret.pem"` +
 * `rename to plain.txt` yields a section keyed on the plain, enumerable
 * `plain.txt` whose -/context rows are the .pem's content.
 * A leading '"' can never begin a real path — git quotes precisely because '"'
 * cannot appear raw — so this refuses nothing legitimate. It mirrors
 * get_run_diff's `!s.path` drop: unreadable ⇒ dropped, never emitted.
 */
const unreadablePath = (p) => typeof p === 'string' && p.startsWith('"');

/**
 * Resolve one anchor against the persisted patch.
 *
 * The member project is an EXPLICIT input and is never inferred — not even when
 * exactly one member holds the path: the UI always knows which section it rendered
 * (entry.project), and the model can call get_run_diff / list_diff_comments to find
 * out. Guessing would make the same {path, side, line} mean different things on
 * different runs.
 *
 * @param {string} patchText  the diff-patch.patch artifact
 * @param {{project?: string|null, path: string, side: 'old'|'new', line: number, protectedPaths?: string[]}} input
 * @returns {{project: string|null, path: string, oldPath: string|null, side: 'old'|'new', line: number, lineText: string}}
 * @throws {AnchorError}
 */
export function resolveAnchor(patchText, {
  project = null, path, side, line, protectedPaths = SECURE_PROTECTED_PATHS,
} = {}) {
  const text = String(patchText ?? '');
  const wantPath = typeof path === 'string' ? path.trim() : '';
  if (!wantPath) throw new AnchorError('path is required');
  if (side !== 'old' && side !== 'new') throw new AnchorError('side must be "old" (a removed line) or "new" (an added or context line)');
  // NOT Math.trunc(Number(line)): that accepted 3.9 as line 3 while the message
  // below promised an integer, silently anchoring a comment one row off. Number()
  // still coerces the '2' a JSON-RPC client may send; isSafeInteger keeps 1e21 out.
  const lineNo = Number(line);
  if (!Number.isSafeInteger(lineNo) || lineNo < 1) throw new AnchorError('line must be a positive integer');

  const members = patchMembers(text);
  const member = typeof project === 'string' ? project.trim() : '';
  if (members.length) {
    if (!member) throw new AnchorError(`this is a workspace run — name the member project (one of: ${members.join(', ')})`);
    if (!members.includes(member)) throw new AnchorError(`unknown member project "${member}" (members: ${members.join(', ')})`);
  } else if (member) {
    throw new AnchorError('this run has a single project — do not name a member project');
  }
  const scope = members.length ? member : null;

  // ONE parse for the whole call: the not-found branch below probes every member,
  // and findSection used to re-run splitPatchSections + patchIndex over the WHOLE
  // patch for each of them (M+1 full parses per miss).
  const index = patchIndex(splitPatchSections(text));
  const guarded = (p) => !!p && isProtectedBasename(p, protectedPaths);
  const blocked = (s) => unreadablePath(s.path) || unreadablePath(s.oldPath)
    || guarded(s.path) || guarded(s.oldPath);

  const section = pick(index, scope, wantPath);
  if (!section) {
    // Name the members that DO hold the path so the caller can retry without a
    // second round trip — but only members whose section this caller could
    // actually READ. An unfiltered hint is an existence oracle: it answered
    // "it is in: alpha-…" for a .env that get_run_diff never lists at all.
    const holders = members.filter((m) => {
      if (m === member) return false;
      const s = pick(index, m, wantPath);
      return !!s && !blocked(s);
    });
    throw new AnchorError(holders.length
      ? `"${wantPath}" is not in ${member}'s diff (it is in: ${holders.join(', ')})`
      : `"${wantPath}" is not a file of this run's diff`);
  }
  // Fail closed exactly as get_run_diff does: BOTH sides, because -M makes a
  // rename+edit ONE section under its NEW name while its -/context lines are the
  // OLD file's content. If the model may not read a file's diff, its lines must not
  // be smuggled into diff_comments as line_text either. splitPatchSections mirrors
  // one side onto the other, so both fields are always populated for a section that
  // reached patchIndex.
  if (unreadablePath(section.path) || unreadablePath(section.oldPath)) {
    throw new AnchorError(`"${wantPath}" has a git-quoted name this run's patch cannot resolve — it cannot be checked against the protected-path rules, so no comment is stored for it`);
  }
  if (guarded(section.path) || guarded(section.oldPath)) {
    throw new AnchorError(`"${wantPath}" is a protected path — comments are not stored for credential files`);
  }
  const parsed = parseFileSection(section.raw);
  if (parsed.binary || !parsed.hunks.length) throw new AnchorError(`"${wantPath}" has no textual diff to anchor to`);
  // `lastNo` rides along in the same pass so the refusal can tell "this file has
  // no such line" apart from "this resolver never read that far". get_run_diff
  // applies NO cap (ask/tools.mjs pages the whole body), so a model that just read
  // row 14,195 through it would otherwise be told the row does not exist.
  let lastNo = 0;
  for (const hunk of parsed.hunks) {
    for (const row of hunk.lines) {
      const no = side === 'old' ? row.oldNo : row.newNo;
      if (no === lineNo) {
        return { project: scope, path: wantPath, oldPath: section.oldPath ?? null, side, line: lineNo, lineText: row.text };
      }
      if (no != null && no > lastNo) lastNo = no;
    }
  }
  throw new AnchorError(parsed.truncated && lineNo > lastNo
    ? `"${wantPath}" has no ${side}-side line ${lineNo} in the first ${MAX_FILE_SECTION_CODE_UNITS} characters of its diff — that is as far as this file's section is read here (it stops at ${side}-side line ${lastNo}), so a line beyond the cap cannot be anchored even though get_run_diff can page to it`
    : `"${wantPath}" has no ${side}-side line ${lineNo} in this run's diff`);
}

/**
 * The `radius` rows either side of an anchor, rendered with their diff sign so the
 * model reads them the way get_run_diff serves them (parseFileSection strips the
 * sign into `kind`, so it is re-added here). Produced by the SAME parser as
 * everything else; `[]` whenever no readable section or no matching row exists
 * (archived run, binary, a row past the cap), which is the caller's signal to omit
 * context entirely rather than fake it.
 * NOT redacted here — the caller redacts, exactly once, at its own boundary.
 */
export function hunkContext(patchText, { project = null, path, side, line } = {}, radius = 3) {
  const text = String(patchText ?? '');
  const members = patchMembers(text);
  const section = findSection(text, members.length ? (project || '') : null, String(path ?? ''));
  if (!section) return [];
  const parsed = parseFileSection(section.raw);
  const lineNo = Math.trunc(Number(line));
  const sign = (kind) => (kind === 'add' ? '+' : kind === 'del' ? '-' : ' ');
  for (const hunk of parsed.hunks) {
    const at = hunk.lines.findIndex((r) => (side === 'old' ? r.oldNo : r.newNo) === lineNo);
    if (at < 0) continue;
    const from = Math.max(0, at - radius);
    const to = Math.min(hunk.lines.length, at + radius + 1);
    return hunk.lines.slice(from, to).map((r) => `${sign(r.kind)}${r.text}`);
  }
  return [];
}
