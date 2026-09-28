// A tolerant XML element scanner for build manifests (pom.xml, *.csproj). Not a
// parser: it walks tags with a stack and reports every LEAF element's text with its
// element path and line. Comments, CDATA, <? ?> and <! > are skipped. Linear by
// construction: one forward pass with indexOf; an unterminated comment / CDATA / tag
// ends the scan (no regex ever re-scans the rest of the file from each '<'), and so
// does nesting deeper than MAX_DEPTH (paths are joined per element; unbounded depth
// would make that quadratic). Unbalanced input never throws; a stray close tag pops
// to its nearest match.
import { lineIndex } from './text.mjs';

const ATTR_RE = /(?<![\w.:-])([A-Za-z_][\w.:-]*)\s*=\s*("([^"]*)"|'([^']*)')/g;
const NAME_RE = /^<(\/?)([A-Za-z_][\w.:-]*)/;
const MAX_DEPTH = 64;

export function attrs(raw) {
  const out = {};
  for (const m of String(raw ?? '').matchAll(ATTR_RE)) out[m[1]] = m[3] ?? m[4] ?? '';
  return out;
}

function attrLines(raw, offset, lineOf) {
  const out = {};
  for (const m of String(raw ?? '').matchAll(ATTR_RE)) out[m[1]] = lineOf(offset + m.index);
  return out;
}

/** Index of the '>' closing the tag opened at `i`, skipping quoted attribute values; -1 if none. */
function tagEnd(t, i) {
  let q = null;
  for (let j = i + 1; j < t.length; j += 1) {
    const c = t[j];
    if (q) { if (c === q) q = null; } else if (c === '"' || c === "'") q = c; else if (c === '>') return j;
  }
  return -1;
}

/** → { leaves: [{ path: 'project/dependencies/dependency/artifactId', name, text, line, parent }],
 *       elements: [{ path, name, attrs, attrLines, line }] }  (elements = every open/self-closing tag;
 *  leaf.parent = index into elements of the enclosing element, -1 at the root) */
export function scanXml(text) {
  const t = String(text ?? '');
  const lineOf = lineIndex(t);
  const stack = [];
  const leaves = [];
  const elements = [];
  let i = t.indexOf('<');
  while (i !== -1) {
    let end;
    if (t.startsWith('<!--', i)) { end = t.indexOf('-->', i + 4); if (end === -1) break; i = t.indexOf('<', end + 3); continue; }
    if (t.startsWith('<![CDATA[', i)) { end = t.indexOf(']]>', i + 9); if (end === -1) break; i = t.indexOf('<', end + 3); continue; }
    end = tagEnd(t, i);
    if (end === -1) break;
    const tag = t.slice(i, end + 1);
    const m = NAME_RE.exec(tag);
    if (m) {
      const [, close, name] = m;
      const rest = tag.slice(m[0].length, -1);
      if (close) {
        let k = stack.length - 1;
        while (k >= 0 && stack[k].name !== name) k -= 1;
        if (k >= 0) {
          const open = stack[k];
          if (k === stack.length - 1 && !open.hasChild) {
            const parent = k > 0 ? stack[k - 1].idx : -1;
            leaves.push({ path: stack.map((s) => s.name).join('/'), name, text: t.slice(open.end, i).trim(), line: open.line, parent });
          }
          stack.length = k;
        }
      } else {
        if (stack.length >= MAX_DEPTH) break;
        if (stack.length) stack[stack.length - 1].hasChild = true;
        const line = lineOf(i);
        const path = [...stack.map((s) => s.name), name].join('/');
        elements.push({ path, name, attrs: attrs(rest), attrLines: attrLines(rest, i + m[0].length, lineOf), line });
        if (!rest.trimEnd().endsWith('/')) stack.push({ name, idx: elements.length - 1, end: end + 1, line, hasChild: false });
      }
    }
    i = t.indexOf('<', end + 1);
  }
  return { leaves, elements };
}
