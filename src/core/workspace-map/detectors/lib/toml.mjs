// TOML loading for the detectors (pyproject.toml, Cargo.toml, libs.versions.toml).
// smol-toml gives values, not positions, so lines are recovered by scanning the
// source: section headers, then `key =` lines inside a section. Never throws.
import { parse } from 'smol-toml';

const firstLine = (s) => String(s ?? '').split(/\r?\n/)[0];

/** → { data: object|null, error: string|null } */
export function loadToml(text) {
  try { return { data: parse(String(text ?? '').replace(/^\uFEFF/, '')), error: null }; } catch (e) { return { data: null, error: firstLine(e?.message || e) }; }
}

// One pass per line: no two adjacent quantifiers over the same characters (the capture is trimmed
// in code), and a header name longer than 200 chars is not a header.
const HEADER_RE = /^[ \t]*\[{1,2}([^\]\n]{1,200})\]{1,2}[ \t]*(?:#.*)?$/;

/** Split a dotted header / key into segments, honouring "quoted" and 'quoted' parts. */
export function splitDotted(s) {
  const t = String(s ?? '');
  const out = [];
  const ws = (c) => c === ' ' || c === '\t';
  let i = 0;
  while (i < t.length) {
    while (i < t.length && ws(t[i])) i += 1;
    if (i >= t.length) break;
    let part;
    if (t[i] === '"' || t[i] === "'") {
      const j = t.indexOf(t[i], i + 1);
      part = t.slice(i + 1, j === -1 ? t.length : j);
      i = j === -1 ? t.length : j + 1;
    } else {
      let j = i;
      while (j < t.length && t[j] !== '.' && !ws(t[j]) && t[j] !== '"' && t[j] !== "'") j += 1;
      part = t.slice(i, j);
      i = j;
    }
    out.push(part);
    while (i < t.length && ws(t[i])) i += 1;
    if (t[i] !== '.') break;
    i += 1;
  }
  return out;
}

/** → [{ name: string[], start: headerIdx (-1 for the root table), end: exclusive idx }] */
export function tomlSections(lines) {
  const out = [{ name: [], start: -1, end: lines.length }];
  lines.forEach((line, i) => {
    const m = HEADER_RE.exec(line);
    if (!m) return;
    out[out.length - 1].end = i;
    out.push({ name: splitDotted(m[1].trim()), start: i, end: lines.length });
  });
  return out;
}

// `key =` / `"key" =` / `key.sub =` at a line start. Built once per section (keyLine is called
// once per dependency; rescanning the section per call is quadratic on a 1 MiB manifest).
const KEY_AT_RE = /^[ \t]*(?:"([^"\n]{0,200})"|'([^'\n]{0,200})'|([A-Za-z0-9_-]{1,200}))[ \t]*[=.]/;
function keyIndex(lines, s) {
  if (s.keys) return s.keys;
  s.keys = new Map();
  for (let i = s.start + 1; i < s.end; i += 1) {
    const m = KEY_AT_RE.exec(lines[i]);
    const k = m && (m[1] ?? m[2] ?? m[3]);
    if (k != null && !s.keys.has(k)) s.keys.set(k, i + 1);
  }
  return s.keys;
}
function byName(sections) {
  if (!sections.byName) {
    sections.byName = new Map();
    for (const s of sections) {
      const n = s.name.join('\u0000');
      if (!sections.byName.has(n)) sections.byName.set(n, []);
      sections.byName.get(n).push(s);
    }
  }
  return sections.byName;
}

/** 1-based line where `key` is defined in the first section whose name equals `section`
 *  (as `key =` / `"key" =` / `key.sub =`, or as its own `[section.key]` header). 0 when absent. */
export function keyLine(lines, sections, section, key) {
  const index = byName(sections);
  const header = index.get([...section, key].join('\u0000'))?.[0];
  let best = header ? header.start + 1 : 0;
  for (const s of index.get(section.join('\u0000')) || []) {
    const line = keyIndex(lines, s).get(key);
    if (line) { if (!best || line < best) best = line; break; }
  }
  return best;
}

/** 1-based line of the first line inside `section` containing `needle`; 0 when absent. */
export function lineInSection(lines, sections, section, needle, from = 0) {
  if (!needle) return 0;
  const list = byName(sections).get(section.join('\u0000')) || [];
  for (const s of list) {
    const lo = Math.max(s.start + 1, from - 1);
    for (let i = lo; i < s.end; i += 1) if (lines[i].includes(needle)) return i + 1;
    for (let i = s.start + 1; i < Math.min(lo, s.end); i += 1) if (lines[i].includes(needle)) return i + 1;
  }
  return 0;
}
