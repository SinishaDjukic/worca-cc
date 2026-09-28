// Annotation / decorator / attribute model for class-based HTTP frameworks (Spring,
// JAX-RS, Micronaut, NestJS, ASP.NET) and declarative clients (Feign, Retrofit, Refit,
// MicroProfile, Spring HTTP interfaces). One pass over comment-stripped code:
//   blocks  = runs of annotations separated only by whitespace, each with the declaration
//             that follows it: a class (name) or a member
//   classOf = the innermost class whose braces contain a position (the last `class X` before it
//             only when no body was found)
// Args are captured with bounded, deterministic repeats (one nesting level, ≤ 600 chars).
import { braceScopes, scopeSweeper } from './code.mjs';

const ARGS = String.raw`(?:[^()]|\([^()]{0,200}\)){0,600}`;
const JAVA_ANN_RE = new RegExp(String.raw`@([A-Za-z_][\w.]{0,100})(?:\s*\((${ARGS})\))?`, 'g');
// C# attribute lists: `[HttpGet]`, and comma-separated ones (`[ApiController, Route("api/x")]`,
// `[HttpGet("{id}"), Authorize]`): the first item, then up to 19 more read with a sticky regex.
// C# 11 generic attributes (`[ProducesResponseType<Item>(200)]`) carry a bounded type-argument list.
const CS_ITEM = String.raw`([A-Za-z_][\w.]{0,100})(?:<(?:[^<>()\n]|<[^<>()\n]{0,60}>){0,100}>)?(?:\s*\((${ARGS})\))?\s*`;
const CS_ATTR_RE = new RegExp(String.raw`\[\s*${CS_ITEM}(?=[\],])`, 'g');
const CS_NEXT_RE = new RegExp(String.raw`,\s*${CS_ITEM}(?=[\],])`, 'y');
const CLASS_RE = /\b(?:class|interface|object|record|struct)\s+([A-Za-z_]\w{0,100})/g;
const CLASS_AFTER_RE = /^\s*(?:(?:public|private|protected|internal|abstract|final|sealed|static|open|data|export|default|partial|inner|enum|annotation)\s+){0,6}(?:class|interface|object|record|struct)\s+([A-Za-z_]\w{0,100})/;

export function annotationModel(code, lang) {
  const re = lang === 'cs' ? CS_ATTR_RE : JAVA_ANN_RE;
  const anns = [];
  let covered = 0; // end of the last C# list: a `[` inside its later items (`Route("api/[controller]")`) is text
  for (const m of code.matchAll(re)) {
    if (m.index < covered) continue;
    const list = [[m[1], m[2]]];
    let end = m.index + m[0].length;
    if (lang === 'cs') {
      // every item of one `[…]` list spans the whole list, so the list is one run of annotations
      CS_NEXT_RE.lastIndex = end;
      for (let x; list.length < 20 && (x = CS_NEXT_RE.exec(code)); end = CS_NEXT_RE.lastIndex) list.push([x[1], x[2]]);
      if (code[end] !== ']') continue;
      end += 1;
      covered = end;
    }
    for (const [name, args] of list) anns.push({ name: name.split('.').pop(), args: args ?? null, start: m.index, end });
  }
  const blocks = [];
  for (const a of anns) {
    const prev = blocks[blocks.length - 1];
    if (prev && code.slice(prev.end, a.start).trim() === '') { prev.anns.push(a); prev.end = a.end; } else blocks.push({ anns: [a], start: a.start, end: a.end });
  }
  const classes = [...code.matchAll(CLASS_RE)].map((m) => ({ name: m[1], start: m.index, anns: [] }));
  // index of the last class starting before pos (strict) / at or before pos; binary search (classes are sorted)
  const lastBefore = (pos, strict) => {
    let lo = 0; let hi = classes.length - 1; let best = -1;
    while (lo <= hi) { const mid = (lo + hi) >> 1; if (strict ? classes[mid].start < pos : classes[mid].start <= pos) { best = mid; lo = mid + 1; } else hi = mid - 1; }
    return best;
  };
  for (const b of blocks) {
    const c = CLASS_AFTER_RE.exec(code.slice(b.end, b.end + 400));
    b.classDecl = c ? c[1] : null;
    if (c) {
      const at = b.end + c.index + c[0].length - c[1].length;
      const cls = classes[lastBefore(at, false)];
      if (cls && at - cls.start < 120 && cls.name === c[1]) cls.anns = b.anns;
    }
  }
  // classOf = the innermost class whose BODY contains pos (an inner class / record that closed
  // before pos is not the enclosing class); falls back to the last class before pos when no body
  // was found. Linear: one brace pass + a stack sweep; a lower pos restarts the sweep.
  const braces = braceScopes(code, lang);
  const spans = [];
  classes.forEach((k, idx) => {
    const limit = Math.min(idx + 1 < classes.length ? classes[idx + 1].start : code.length, k.start + 1000);
    const off = code.slice(k.start, limit).indexOf('{');
    const open = off === -1 ? -1 : k.start + off;
    if (open !== -1 && braces.has(open)) spans.push({ open, close: braces.get(open), path: k });
  });
  let sweep = scopeSweeper(spans);
  let lastPos = -1;
  const classOf = (pos) => {
    if (pos < lastPos) sweep = scopeSweeper(spans);
    lastPos = pos;
    const inside = sweep(pos);
    return inside.length ? inside[inside.length - 1] : classes[lastBefore(pos, true)] ?? null;
  };
  return { blocks, classes, classOf };
}

// A Java `{...}` array: its strings may hold braces (`{"/users/{id}"}`), so strings are skipped whole.
const ARRAY = String.raw`\{(?:"[^"\n]{0,300}"|'[^'\n]{0,300}'|[^{}"']){0,600}\}`;
/** Path strings of an annotation's args: value= / path= / url= (single or array) or the leading
 *  string / array. No path-like argument → ['']. Micronaut's `uri =` / `uris =` and C#'s
 *  `template:` are path keys too; an RFC 6570 query expression (`/list{?max,offset}`) is no path. */
export function annPaths(args, keys = ['value', 'path', 'uri', 'uris', 'template']) {
  if (args == null) return [''];
  const strs = (s) => [...s.matchAll(/"([^"\n]{0,300})"|'([^'\n]{0,300})'/g)].map((m) => (m[1] ?? m[2]).replace(/\{[?&][^{}]{0,200}\}/g, ''));
  // An array of constants (`{Paths.BY_ID}`, `[Paths.BY_ID]`) or a concatenation (`"/users/" + ID`) is a
  // non-literal path (null) — never [] / the bare string, which would key the route as the class prefix.
  const lits = (s, from) => {
    const out = strs(s);
    if (/^\s*\+/.test(args.slice(from)) || s.replace(/"[^"\n]{0,300}"|'[^'\n]{0,300}'/g, '""').includes('+')) return null; // `{"/a/" + ID}` too
    if (out.length) return out;
    return /[A-Za-z_]/.test(s.replace(/^\s*arrayOf\(/, '')) ? null : [''];
  };
  const named = new RegExp(String.raw`\b(?:${keys.join('|')})\s*[=:]\s*(${ARRAY}|\[[^\]]{0,600}\]|arrayOf\([^)]{0,600}\)|"[^"\n]{0,300}"|'[^'\n]{0,300}')`).exec(args);
  if (named) return lits(named[1], named.index + named[0].length);
  // A path key holding a constant (`value = Paths.BY_ID`, NestJS `{ path: USERS }`) is a non-literal path.
  const bare = args.replace(/"[^"\n]{0,300}"|'[^'\n]{0,300}'/g, '""');
  if (new RegExp(String.raw`\b(?:${keys.join('|')})\s*[=:]`).test(bare)) return null;
  const lead = new RegExp(String.raw`^\s*(${ARRAY}|\[[^\]]{0,600}\]|arrayOf\([^)]{0,600}\)|"[^"\n]{0,300}"|'[^'\n]{0,300}')`).exec(args);
  // ...and a JS options object without one (`{ version: '1' }`, `{ host: 'x' }`) names no path.
  if (lead && /^\s*\{/.test(lead[1]) && /[A-Za-z_]\w*\s*:/.test(bare)) return [''];
  if (lead) return lits(lead[1], lead[0].length);
  if (/^\s*[A-Za-z_]\w*\s*[=:]/.test(args) || args.trim() === '' || /^\s*\{\s*\}/.test(args)) return [''];
  return null; // a non-literal path (constant) → caller reports unresolved
}

/** A named argument's literal (e.g. name = "billing") or null. */
export function annArg(args, key) {
  if (args == null) return null;
  const m = new RegExp(String.raw`\b${key}\s*[=:]\s*(?:"([^"\n]{0,300})"|'([^'\n]{0,300})')`).exec(args);
  return m ? m[1] ?? m[2] : null;
}
