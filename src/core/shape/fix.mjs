// src/core/shape/fix.mjs — D27: the shape-check failures that need no judgement fix themselves. Today: a cited repo
// path that does not exist and whose line has no (new) mark gets " (new)" right after it. Pure; the caller writes.
import { REPO_PATH_RE, groundKey } from '../../shared/shape/shape.mjs';
import { blankFences } from '../../shared/shape/perspectives.mjs';

const NEW_RE = /\(new\)/i;

/**
 * @param {string} markdown the plan
 * @param {Array<{path:string, line?:number, found:boolean, missing?:boolean}>|null} grounding checkPaths' marks
 * @returns {{markdown:string, fixed:Array<{check:string, detail:string}>}}
 */
export function markNewPaths(markdown, grounding) {
  const marks = Array.isArray(grounding) ? grounding : [];
  const missing = new Set(marks.filter((g) => g.missing && !g.found && g.line == null).map((g) => g.path));
  if (!missing.size) return { markdown, fixed: [] };
  // (new) marks the whole line, so a line that also cites a failure needing the person is left alone
  const unfixable = new Set(marks.filter((g) => !g.found && !g.missing).map(groundKey));
  const lines = String(markdown).split('\n');
  const open = blankFences(markdown).split('\n');      // same line count; fenced lines are ''
  const marked = new Set();
  const out = lines.map((line, i) => {
    if (open[i] !== line || NEW_RE.test(line)) return line;
    const cited = [...line.matchAll(new RegExp(REPO_PATH_RE.source, 'g'))];
    if (cited.some((m) => unfixable.has(groundKey({ path: m[1], line: m[2] ? Number(m[2]) : undefined })))) return line;
    return line.replace(new RegExp(REPO_PATH_RE.source, 'g'), (m, path, ln) => {
      if (ln || !missing.has(path)) return m;
      marked.add(path);
      return `${m} (new)`;
    });
  });
  if (!marked.size) return { markdown, fixed: [] };
  return { markdown: out.join('\n'), fixed: [...marked].map((path) => ({ check: 'paths', detail: `marked ${path} (new)` })) };
}
