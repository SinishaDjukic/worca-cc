// tools/split-by-feature/html.mjs
// Cuts ui/public/index.html into per-feature text slices at its block starts (#919). The slices concatenate to
// the original bytes; a part is a text slice, not a standalone document.
import { featureForHtml } from './plan.mjs';
import { lineCount } from './css.mjs';

// A line that starts a markup block and must be claimed by the map: a `<!-- ===` marker at the view indent, or a
// modal, template or dialog at the body indent. Settings' `<!-- ===== TAB:` markers sit deeper and stay inside it.
const BLOCK_START = [/^ {0,8}<!-- =+ /, /^ {0,4}<div class="viewer-modal"/, /^ {0,4}<(template|dialog)\b/];

/** Parts: [{ feature, file, text, line }] in source order; problems for unclaimed block starts and over-cap blocks. */
export function splitHtml(html, map, cap = 1000) {
  const lines = html.split('\n'); const problems = [];
  const starts = [];                                     // { line (0-based), feature }
  let offset = 0; const offsets = [];
  for (const l of lines) { offsets.push(offset); offset += l.length + 1; }
  lines.forEach((l, n) => {
    const t = l.trim();
    const f = t ? featureForHtml(map, t) : null;
    if (f) starts.push({ line: n, feature: f });
    else if (BLOCK_START.some((re) => re.test(l))) problems.push(`unmapped markup block: ${t.slice(0, 80)} (ui/public/index.html:${n + 1})`);
  });
  const runs = [{ feature: 'shell', start: 0, line: 0 }];
  for (const s of starts) {
    const last = runs[runs.length - 1];
    if (s.line === last.line) { last.feature = s.feature; continue; }
    runs.push({ feature: s.feature, start: offsets[s.line], line: s.line });
  }
  runs.forEach((r, k) => { r.end = k + 1 < runs.length ? runs[k + 1].start : html.length; });
  // Consecutive blocks of one feature merge while the merged slice stays within the cap.
  const merged = [];
  for (const r of runs) {
    const last = merged[merged.length - 1];
    if (last && last.feature === r.feature && lineCount(html.slice(last.start, r.end)) <= cap) last.end = r.end;
    else merged.push({ ...r });
  }
  const parts = []; const n = new Map();
  for (const r of merged) {
    const text = html.slice(r.start, r.end);
    if (!text) continue;
    if (lineCount(text) > cap) problems.push(`over cap: markup block of ${lineCount(text)} lines (ui/public/index.html:${r.line + 1})`);
    const k = (n.get(r.feature) || 0) + 1; n.set(r.feature, k);
    parts.push({ feature: r.feature, file: `${r.feature}/${r.feature}${k > 1 ? '-' + k : ''}.html`, text, line: r.line + 1 });
  }
  return { parts, problems };
}
