// tools/split-by-feature/html.mjs
// Cuts ui/public/index.html into per-feature text slices at its block starts (#919), named by their view or dialog id
// (file-names.mjs). The slices concatenate to the original bytes; a part is a text slice, not a standalone document.
import { featureForHtml } from './plan.mjs';
import { lineCount } from './css.mjs';
import { NAMING_DEFAULTS, NameError, checkName, markupName } from './file-names.mjs';

// A line that starts a markup block and must be claimed by the map: a `<!-- ===` marker at the view indent, or a
// modal, template or dialog at the body indent. Settings' `<!-- ===== TAB:` markers sit deeper and stay inside it.
const BLOCK_START = [/^ {0,8}<!-- =+ /, /^ {0,4}<div class="viewer-modal"/, /^ {0,4}<(template|dialog)\b/];
// A second top-level view after a block start starts its own part, in the enclosing block's feature (D10).
const VIEW = /^ {0,8}<section class="view\b/;

/**
 * Parts: [{ feature, file, text, line }] in source order; problems for unclaimed block starts and over-cap blocks.
 * naming.views files a view under another feature; a block under naming.minLines joins a contiguous same-feature
 * neighbour (the previous one, else the next).
 */
export function splitHtml(html, map, cap = 1000) {
  const naming = { ...NAMING_DEFAULTS, ...map?.naming };
  const lines = html.split('\n'); const problems = [];
  const starts = [];                                     // { line (0-based), feature (null: the enclosing block's) }
  let offset = 0; const offsets = [];
  for (const l of lines) { offsets.push(offset); offset += l.length + 1; }
  let viewSeen = false;
  lines.forEach((l, n) => {
    const t = l.trim();
    const f = t ? featureForHtml(map, t) : null;
    if (f) { starts.push({ line: n, feature: f }); viewSeen = false; }
    else if (VIEW.test(l)) { if (viewSeen) starts.push({ line: n, feature: null }); viewSeen = true; }
    else if (BLOCK_START.some((re) => re.test(l))) problems.push(`unmapped markup block: ${t.slice(0, 80)} (ui/public/index.html:${n + 1})`);
  });
  const runs = [{ mapFeature: 'shell', start: 0, line: 0, opened: false }];
  for (const s of starts) {
    const last = runs[runs.length - 1];
    if (s.line === last.line) { last.mapFeature = s.feature ?? last.mapFeature; last.opened = true; continue; }
    runs.push({ mapFeature: s.feature ?? last.mapFeature, start: offsets[s.line], line: s.line, opened: true });
  }
  runs.forEach((r, k) => {
    r.end = k + 1 < runs.length ? runs[k + 1].start : html.length;
    r.name = r.opened ? markupName(html.slice(r.start, r.end), naming) : null;     // the text before the first block has none
    r.feature = (r.name && naming.views[r.name]) ?? r.mapFeature;
  });
  const merged = [];
  for (const r of runs) {
    if (r.start === r.end) continue;
    const last = merged[merged.length - 1];
    const small = (x) => lineCount(html.slice(x.start, x.end)) < naming.minLines;
    if (last && last.feature === r.feature && (small(r) || small(last)) && lineCount(html.slice(last.start, r.end)) <= cap) { last.end = r.end; last.name ??= r.name; }
    else merged.push({ ...r });
  }
  const parts = [];
  for (const r of merged) {
    const text = html.slice(r.start, r.end);
    if (lineCount(text) > cap) problems.push(`over cap: markup block of ${lineCount(text)} lines (ui/public/index.html:${r.line + 1})`);
    if (r.name == null) throw new NameError(`cannot name the markup before the first block (ui/public/index.html:${r.line + 1}): it does not join a named block; map it in feature-map.json naming`);
    const name = naming.rename[`ui/public/${r.feature}/${r.name}.html`] ?? r.name;
    parts.push({ feature: r.feature, file: `${r.feature}/${checkName(name, naming.generic, `ui/public/${r.feature}/${name}.html`)}.html`, text, line: r.line + 1 });
  }
  return { parts, problems };
}
