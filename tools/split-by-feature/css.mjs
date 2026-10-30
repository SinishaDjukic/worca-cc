// tools/split-by-feature/css.mjs
// Cuts ui/public/style.css into per-feature parts at its section markers (#919). Parts concatenate to the
// original bytes; order is source order (the cascade depends on it, style.css:2261).
// scanLines is its own scanner: test/helpers/css-rules.mjs and tools/extension-css.mjs cutPiece do not
// handle strings and keep no per-line depth, and a cut must land only on a depth-0 line.
import { featureForCss } from './plan.mjs';

const ONE_LINE = /^\/\* *[-=#]{3,} *(.+?) *[-=#]*\s*(?:\*\/)?\s*$/;
const BANNER = /^\/\* *={10,}\s*$/;

/** Line start offsets and brace depth at the start of each line (comments and strings skipped). */
export function scanLines(css) {
  const lines = [{ start: 0, depth: 0 }]; let depth = 0;
  let inComment = false; let quote = null;
  for (let i = 0; i < css.length; i++) {
    const c = css[i];
    if (inComment) { if (c === '*' && css[i + 1] === '/') { inComment = false; i++; } }
    else if (quote) { if (c === '\\') i++; else if (c === quote) quote = null; }
    else if (c === '/' && css[i + 1] === '*') { inComment = true; i++; }
    else if (c === '"' || c === "'") quote = c;
    else if (c === '{') depth++;
    else if (c === '}') depth--;
    if (c === '\n') lines.push({ start: i + 1, depth: inComment ? -1 : depth });
  }
  return lines;
}

/** [{ title, line, start }] for every depth-0 marker line. */
export function sections(css) {
  const lines = scanLines(css); const text = css.split('\n'); const out = [];
  for (let n = 0; n < text.length; n++) {
    if (lines[n].depth !== 0) continue;
    const m = ONE_LINE.exec(text[n]); let title = m && m[1].replace(/[-=#*\/\s]+$/, '').trim();
    if (!title && BANNER.test(text[n])) title = (text[n + 1] || '').replace(/^\s*\*?\s*/, '').trim();
    if (title) out.push({ title, line: n + 1, start: lines[n].start });
  }
  return out;
}

export const lineCount = (t) => t.split('\n').length - (t.endsWith('\n') ? 1 : 0);

/** Parts: [{ feature, file, text, line }] in source order; problems for unmapped/ambiguous titles and over-cap rules. */
export function splitCss(css, map, cap = 1000) {
  const secs = sections(css); const problems = [];
  const lineAt = (off) => css.slice(0, off).split('\n').length;
  const runs = [{ feature: 'shell', start: 0, end: secs.length ? secs[0].start : css.length }];
  secs.forEach((s, k) => {
    const f = map ? featureForCss(map, s.title) : 'shell';
    if (!f || f.startsWith('ambiguous:')) problems.push(`${f ? 'ambiguous' : 'unmapped'} CSS section: "${s.title}"${f ? ' → ' + f.slice(10) : ''} (ui/public/style.css:${s.line})`);
    const end = k + 1 < secs.length ? secs[k + 1].start : css.length;
    const last = runs[runs.length - 1];
    if (last.feature === (f || 'shell') && lineCount(css.slice(last.start, end)) <= cap) last.end = end;
    else runs.push({ feature: f || 'shell', start: s.start, end });
  });
  const parts = []; const n = new Map();
  for (const r of runs) for (const piece of chunk(css.slice(r.start, r.end), cap)) {
    const k = (n.get(r.feature) || 0) + 1; n.set(r.feature, k);
    const start = r.start + piece.offset;
    if (lineCount(piece.text) > cap) problems.push(`over cap: one rule of ${lineCount(piece.text)} lines cannot be cut (ui/public/style.css:${lineAt(start)})`);
    parts.push({ feature: r.feature, file: `${r.feature}/${r.feature}${k > 1 ? '-' + k : ''}.css`, text: piece.text, line: lineAt(start) });
  }
  return { parts, problems };
}

/** Split text over `cap` lines at depth-0 blank lines; a single rule over the cap stays whole (reported by the caller). */
export function chunk(text, cap) {
  if (lineCount(text) <= cap) return [{ text, offset: 0 }];
  const lines = scanLines(text); const raw = text.split('\n'); const out = []; let from = 0; let fromLine = 0; let lastCut = -1;
  for (let n = 1; n < raw.length; n++) {
    if (lines[n].depth === 0 && raw[n - 1].trim() === '') lastCut = n;
    if (n - fromLine >= cap && lastCut > fromLine) {
      out.push({ text: text.slice(from, lines[lastCut].start), offset: from });
      from = lines[lastCut].start; fromLine = lastCut; lastCut = -1;
    }
  }
  out.push({ text: text.slice(from), offset: from });
  return out;
}
