// tools/split-by-feature/css.mjs
// Cuts ui/public/style.css into per-feature parts at its section markers (#919), one part per section, named by its
// heading (file-names.mjs). Parts concatenate to the original bytes; order is source order (the cascade depends on
// it, style.css:2261).
// scanLines is its own scanner: test/helpers/css-rules.mjs and tools/extension-css.mjs cutPiece do not
// handle strings and keep no per-line depth, and a cut must land only on a depth-0 line.
import { featureForCss } from './plan.mjs';
import { NAMING_DEFAULTS, NameError, checkName, cssTitle, uniqueNames } from './file-names.mjs';

const ONE_LINE = /^\/\* *(?:[-=#]{3,}|─{2,}) *(.+?) *[-=#─]*\s*(?:\*\/)?\s*$/;
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
    const m = ONE_LINE.exec(text[n]); let title = m && m[1].replace(/[-=#─*\/\s]+$/, '').trim();
    if (!title && BANNER.test(text[n])) title = (text[n + 1] || '').replace(/^\s*\*?\s*/, '').trim();
    if (title) out.push({ title, line: n + 1, start: lines[n].start });
  }
  return out;
}

export const lineCount = (t) => t.split('\n').length - (t.endsWith('\n') ? 1 : 0);

const CLASS_PREFIX = /^\.([a-z0-9]+)/;
/** Where an over-cap section is cut: the first depth-0 rule of its most common class prefix, with the blank and comment
 *  lines right above it. Returns { offset, prefix } or null when the section has no class rules. */
export function prefixCut(text) {
  const lines = scanLines(text); const raw = text.split('\n'); const count = new Map();
  raw.forEach((l, n) => { const m = lines[n].depth === 0 && CLASS_PREFIX.exec(l); if (m) count.set(m[1], (count.get(m[1]) ?? 0) + 1); });
  if (!count.size) return null;
  const prefix = [...count].reduce((a, b) => (b[1] > a[1] ? b : a))[0];
  let n = raw.findIndex((l, i) => lines[i].depth === 0 && CLASS_PREFIX.exec(l)?.[1] === prefix);
  while (n > 1 && (raw[n - 1].trim() === '' || lines[n - 1].depth === -1 || /^\s*\/\*/.test(raw[n - 1]))) n -= 1;
  return n > 0 ? { offset: lines[n].start, prefix } : null;
}

const COMMENT = /^\s*\/\*/;
/**
 * naming.cssBlocks inside one section: [{ start, end, block }] covering `text`, block null for the section's own rules.
 * A statement is a depth-0 rule or at-rule with the comment and blank lines right above it. A rule belongs to the first
 * block of this section whose selectors start it; an at-rule (@media, @keyframes) goes with the rule before it. Cuts
 * fall where the owner changes; parts.json keeps the byte order, so the served /style.css stays byte-identical.
 */
export function blockCuts(text, blocks) {
  const lines = scanLines(text); const raw = text.split('\n'); const out = [];
  let owner; let prevCode = null; let lead = -1;
  for (let n = 0; n < raw.length; n++) {
    const l = raw[n]; const t = l.trim();
    if (lines[n].depth === -1 || (lines[n].depth === 0 && COMMENT.test(l)) || (lines[n].depth === 0 && !t)) {
      if (lead < 0) lead = n;
      continue;
    }
    const starts = lines[n].depth === 0 && (prevCode === null || /[};]\s*(\/\*.*\*\/)?\s*$/.test(prevCode));
    if (starts) {
      const mine = t.startsWith('@') && owner !== undefined ? owner : blocks.find((b) => b.selectors.some((x) => t.startsWith(x))) ?? null;
      if (owner === undefined) out.push({ start: 0, block: mine });
      else if (mine !== owner) out.push({ start: lines[lead >= 0 ? lead : n].start, block: mine });
      owner = mine;
    }
    prevCode = l; lead = -1;
  }
  if (!out.length) out.push({ start: 0, block: null });
  out.forEach((c, k) => { c.end = k + 1 < out.length ? out[k + 1].start : text.length; });
  return out.filter((c) => c.end > c.start);
}

/**
 * Parts: [{ feature, file, text, line }] in source order; problems for unmapped/ambiguous titles and over-cap sections.
 * One unit per section; a unit under naming.minLines joins its same-feature neighbour (the previous one, else the next);
 * names are the shortest unique heading prefix per folder (D9). A unit over the cap is cut at its most common class
 * prefix when naming.cssPrefixes names it, else at blank lines with a problem (it needs a recorded raise).
 */
export function splitCss(css, map, cap = 1000) {
  const naming = { ...NAMING_DEFAULTS, ...map?.naming };
  const secs = sections(css); const problems = []; const text = css.split('\n');
  const lineAt = (off) => css.slice(0, off).split('\n').length;
  const units = [];
  if (!secs.length || secs[0].start > 0) units.push({ feature: 'shell', heading: null, firstComment: '', start: 0, end: secs.length ? secs[0].start : css.length });
  secs.forEach((s, k) => {
    const f = map ? featureForCss(map, s.title) : 'shell';
    if (!f || f.startsWith('ambiguous:')) problems.push(`${f ? 'ambiguous' : 'unmapped'} CSS section: "${s.title}"${f ? ' → ' + f.slice(10) : ''} (ui/public/style.css:${s.line})`);
    const under = text[s.line] ?? '';                       // the line right under the marker (s.line is 1-based)
    units.push({ feature: f && !f.startsWith('ambiguous:') ? f : 'shell', heading: s.title, firstComment: /^\s*\/\*/.test(under) ? under : '',
      start: s.start, end: k + 1 < secs.length ? secs[k + 1].start : css.length });
  });
  const len = (u) => lineCount(css.slice(u.start, u.end));
  const blocked = [];
  for (const u of units) {
    const mine = naming.cssBlocks.filter((b) => u.heading != null && new RegExp(b.section).test(u.heading));
    if (!mine.length) { blocked.push(u); continue; }
    blockCuts(css.slice(u.start, u.end), mine).forEach((c, k) => {
      const at = { start: u.start + c.start, end: u.start + c.end };
      if (c.block) blocked.push({ feature: c.block.feature, fixedName: c.block.name, ...at });
      else if (k === 0) blocked.push({ ...u, ...at });
      else throw new NameError(`cannot name the rules at ui/public/style.css:${lineAt(at.start)} in CSS section "${u.heading}": no naming.cssBlocks entry claims them`);
    });
  }
  const cut = [];
  for (const u of blocked) {
    if (len(u) <= cap) { cut.push(u); continue; }
    const c = prefixCut(css.slice(u.start, u.end)); const named = c && naming.cssPrefixes[c.prefix];
    if (named) { cut.push({ ...u, end: u.start + c.offset }, { feature: named.feature, fixedName: named.name, start: u.start + c.offset, end: u.end }); continue; }
    problems.push(`over cap: CSS section "${u.heading}" is ${len(u)} lines and naming.cssPrefixes names none of its class prefixes; it needs a recorded raise (ui/public/style.css:${lineAt(u.start)})`);
    chunk(css.slice(u.start, u.end), cap).forEach((piece, i) => cut.push(i === 0 ? { ...u, end: u.start + piece.offset + piece.text.length }
      : { feature: u.feature, fixedName: CLASS_PREFIX.exec(piece.text.trimStart())?.[1] ?? '', start: u.start + piece.offset, end: u.start + piece.offset + piece.text.length }));
  }
  const merged = [];
  for (const u of cut) {
    const last = merged[merged.length - 1];
    const small = (x) => len(x) < naming.minLines;
    if (last && last.feature === u.feature && !last.fixedName && !u.fixedName && (small(u) || small(last)) && lineCount(css.slice(last.start, u.end)) <= cap) {
      last.end = u.end;
      if (last.heading == null) Object.assign(last, { heading: u.heading, firstComment: u.firstComment });   // the text before the first marker
    } else merged.push({ ...u });
  }
  const folders = new Map();
  for (const u of merged) (folders.get(u.feature) ?? folders.set(u.feature, []).get(u.feature)).push(u);
  for (const us of folders.values()) {
    const free = us.filter((u) => !u.fixedName);
    const names = uniqueNames(free.map((u) => cssTitle(u.heading ?? '', u.firstComment, naming.stopwords)), naming.stopwords);
    free.forEach((u, i) => { u.name = names[i]; });
    for (const u of us) if (u.fixedName) u.name = u.fixedName;
  }
  const parts = merged.map((u) => {
    const name = naming.rename[`ui/public/${u.feature}/${u.name}.css`] ?? u.name;
    const file = `${u.feature}/${checkName(name, naming.generic, `ui/public/${u.feature}/${name}.css`)}.css`;
    const t = css.slice(u.start, u.end);
    if (lineCount(t) > cap && !problems.some((p) => p.endsWith(`(ui/public/style.css:${lineAt(u.start)})`))) problems.push(`over cap: one rule of ${lineCount(t)} lines cannot be cut (ui/public/style.css:${lineAt(u.start)})`);
    return { feature: u.feature, file, text: t, line: lineAt(u.start) };
  });
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
