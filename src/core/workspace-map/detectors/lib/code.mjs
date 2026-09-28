// Source-code helpers for the P4 detectors (http-routes, http-clients, messaging, db):
// language by extension, comment blanking, a linear string-literal lexer, first-argument
// parsing at a call site, URL-expression analysis and brace scopes. Pure; never throws.
// Every scanner is a single forward pass (indexOf / char loop): no regex here re-scans
// the rest of a file from each opener, so a 1 MiB minified bundle stays linear.
import { blankComments, onePerKey, cleanUnresolved, isMinified, authorityEnd, notPort } from './text.mjs';
import { envStems, hostName } from '../../../../shared/workspace-map/keys.mjs';

export const CODE_RE = /\.(js|jsx|mjs|cjs|ts|tsx|vue|svelte|py|java|kt|kts|scala|groovy|go|cs|rb|php|rs)$/i;
const LANG = { js: 'js', jsx: 'js', mjs: 'js', cjs: 'js', ts: 'js', tsx: 'js', vue: 'js', svelte: 'js', py: 'py',
  java: 'java', groovy: 'java', scala: 'java', kt: 'kotlin', kts: 'kotlin', go: 'go', cs: 'cs', rb: 'rb', php: 'php', rs: 'rust' };
/** Minified bundles and build output committed to git: never scanned by the code detectors
 *  (their fetch/axios calls belong to third-party libraries). */
export const isGenerated = (rel) => /\.min\.(?:js|mjs|cjs)$|[.-]bundle\.(?:js|mjs)$|\.chunk\.(?:js|mjs)$|(^|\/)(?:static\/js|public\/vendor|assets\/vendor)\//i.test(rel);
export const isSource = (rel) => CODE_RE.test(rel) && !isGenerated(rel);
export const langOf = (rel) => LANG[(/\.([A-Za-z]+)$/.exec(rel)?.[1] || '').toLowerCase()] || null;
// Output hygiene shared with P3 (lib/text.mjs), under the names the index gives P4 — one implementation:
//   isMinified     a JS-family file whose first 4 KiB holds a line over 1 000 chars is minified / bundled
//                  output (its fetch/axios calls belong to third-party code); never other languages.
//   firstPerKey    one fact per (file, dir, key, target host), the first: a seed file with 10 000 INSERTs
//                  into one table must not spend the member's fact cap, while two peers reached by one
//                  path (http://billing:8080/health, http://ledger:8082/health) stay two consumes (P1 C28).
//   fileUnresolved none from a test path, one per (file, trimmed raw), ≤ 50 per detector per member.
export { isMinified };
export const firstPerKey = onePerKey;
export const fileUnresolved = cleanUnresolved;

/** Comments blanked (strings kept, offsets and lines unchanged). The four code detectors run on
 *  the same `text` one after another, so the last result is memoised (single slot, by identity). */
const STRIP_MEMO = { text: null, lang: null, code: null };
export function stripComments(text, lang) {
  if (STRIP_MEMO.text === text && STRIP_MEMO.lang === lang) return STRIP_MEMO.code;
  const code = stripRaw(text, lang);
  STRIP_MEMO.text = text; STRIP_MEMO.lang = lang; STRIP_MEMO.code = code;
  return code;
}
function stripRaw(text, lang) {
  if (lang === 'py' || lang === 'rb') return blankComments(text, { slash: false, hash: true, quotes: '"\'' });
  if (lang === 'php') return blankComments(text, { slash: true, hash: true, quotes: '"\'' });
  return blankComments(text, { slash: true, quotes: lang === 'js' || lang === 'go' ? '"\'`' : '"\'' });
}

/** Every string literal: { value, start (offset of the first content char), end, quote, prefix }.
 *  JS '…' "…" `…`; Python [rbuf]{0,2}'…' "…" '''…''' """…"""; Java/Kotlin/C# "…" """…""",
 *  C# @"…" $"…"; Go "…" `…`. Comments must already be blanked (stripComments). */
export function literals(code, lang) {
  const out = [];
  const t = String(code ?? '');
  const n = t.length;
  const triple = lang === 'py' || lang === 'java' || lang === 'kotlin' || lang === 'cs';
  const multiBacktick = lang === 'js' || lang === 'go';
  let i = 0;
  while (i < n) {
    const c = t[i];
    if (c !== '"' && c !== "'" && c !== '`') { i += 1; continue; }
    let p = i;
    while (p > 0 && /[rRbBuUfF$@]/.test(t[p - 1]) && i - p < 3) p -= 1;
    const prefix = t.slice(p, i);
    if (triple && t.startsWith(c.repeat(3), i) && c !== '`') {
      const end = t.indexOf(c.repeat(3), i + 3);
      const e = end === -1 ? n : end;
      out.push({ value: t.slice(i + 3, e), start: i + 3, end: e, quote: c.repeat(3), prefix });
      i = e + 3;
      continue;
    }
    if (c === '`' && !multiBacktick) { i += 1; continue; }
    const verbatim = lang === 'cs' && prefix.includes('@');
    let j = i + 1;
    while (j < n && t[j] !== c) {
      if (t[j] === '\\' && !verbatim && lang !== 'go' || (t[j] === '\\' && lang === 'go' && c !== '`')) { j += 2; continue; }
      if (t[j] === '\n' && c !== '`' && !verbatim) break;
      j += 1;
    }
    if (j >= n || t[j] !== c) { i = j + 1; continue; } // unterminated on this line
    out.push({ value: t.slice(i + 1, j), start: i + 1, end: j, quote: c, prefix });
    i = j + 1;
  }
  return out;
}

/** One string literal whose opening quote is at `q` → { value, start, end } | null (unterminated
 *  on its line, or longer than 4000 chars). Reads only that literal: O(its length). */
export function readLiteral(code, q, lang, prefix = '') {
  const c = code[q];
  if (c !== '"' && c !== "'" && c !== '`') return null;
  const triple = (lang === 'py' || lang === 'java' || lang === 'kotlin' || lang === 'cs') && c !== '`' && code.startsWith(c.repeat(3), q);
  if (triple) {
    const end = code.indexOf(c.repeat(3), q + 3);
    return end === -1 || end - q > 4000 ? null : { value: code.slice(q + 3, end), start: q + 3, end };
  }
  const verbatim = lang === 'cs' && prefix.includes('@');
  const raw = lang === 'go' && c === '`';
  const multi = c === '`' || verbatim;
  let j = q + 1;
  while (j < code.length && j - q <= 4000) {
    const ch = code[j];
    if (ch === c) return { value: code.slice(q + 1, j), start: q + 1, end: j };
    if (ch === '\\' && !verbatim && !raw) { j += 2; continue; }
    if (ch === '\n' && !multi) return null;
    j += 1;
  }
  return null;
}

/** The first argument at `pos` (just after '('): a string literal (optionally f/$/@/r-prefixed)
 *  or an expression up to the first depth-0 ',' or ')' (≤ 400 chars).
 *  → { kind: 'literal', value, start, template } | { kind: 'expr', text, start } | null */
export function argAt(code, pos, lang) {
  let i = pos;
  while (i < code.length && i - pos < 200 && /\s/.test(code[i])) i += 1;
  let k = i;
  while (k < code.length && k - i < 2 && /[rRbBuUfF$@]/.test(code[k])) k += 1;
  const q = code[k];
  if (q === '"' || q === "'" || q === '`') {
    const prefix = code.slice(i, k);
    const l = readLiteral(code, k, lang, prefix);
    if (!l) return null;
    // "/users/" + id is a concatenation, not a literal: read the whole argument as an expression (PHP: '/users/' . $id).
    if (!(lang === 'php' ? /^\s*[+.]/ : /^\s*\+/).test(code.slice(l.end + 1, l.end + 40))) return { kind: 'literal', value: l.value, start: l.start, template: q === '`' || /[fF$]/.test(prefix) };
  }
  let depth = 0;
  let j = i;
  for (; j < code.length && j - i < 400; j += 1) {
    const c = code[j];
    if (c === '(' || c === '[' || c === '{') depth += 1;
    else if (c === ')' || c === ']' || c === '}') { if (depth === 0) break; depth -= 1; } else if (c === ',' && depth === 0) break;
  }
  const text = code.slice(i, j).trim();
  return text ? { kind: 'expr', text, start: i } : null;
}

/** The literal strings inside a bracket list text: '["a", "b"]' / '{"a","b"}' / "'a'" → ['a','b']. */
export function stringsIn(s) {
  return [...String(s ?? '').matchAll(/"([^"\n]{0,300})"|'([^'\n]{0,300})'|`([^`\n]{0,300})`/g)].map((m) => m[1] ?? m[2] ?? m[3]);
}

// Env / config reads → the key name. One row per language form.
const ENV_RES = [
  /process\.env\.([A-Za-z_]\w*)/, /process\.env\[\s*['"]([^'"]+)['"]\s*\]/, /import\.meta\.env\.([A-Za-z_]\w*)/,
  /os\.environ(?:\.get)?\s*[[(]\s*['"]([^'"]+)['"]/, /os\.getenv\(\s*['"]([^'"]+)['"]/, /os\.Getenv\(\s*"([^"]+)"/,
  /System\.getenv\(\s*"([^"]+)"/, /Environment\.GetEnvironmentVariable\(\s*"([^"]+)"/, /ENV(?:\.fetch\(|\[)\s*['"]([^'"]+)['"]/,
  /\b_?[cC]onfig(?:uration)?\s*\[\s*"([^"]+)"\s*\]/, /getenv\(\s*['"]([^'"]+)['"]/, /settings\.([A-Z][A-Z0-9_]+)/,
  /\bconfigService\.get(?:<[^>]{0,40}>)?\(\s*['"]([^'"]+)['"]/,
];
export function envKeyOf(expr) {
  for (const re of ENV_RES) { const m = re.exec(expr); if (m) return m[1]; }
  return null;
}

// M2: a URL's authority ends where authorityEnd says (a password may hold '?' or '#'); `query`: a query follows it
// …and a "host" holding a ':' no port follows is a password's head (`svc:ab#cd#ef@billing`: authorityEnd stops at the first
// '#'): the host is the one after the last '@', as the redactor's USERINFO reads the userinfo
export const authOf = (u) => {
  const a = u.replace(/^https?:\/\//, '');
  const end = authorityEnd(a);
  const host = (end === -1 ? a : a.slice(0, end)).replace(/^.*@/, '');
  const at = a.lastIndexOf('@');
  if (end === -1 || at < end || !notPort(host)) return { host, query: end !== -1 };
  const r = a.slice(at + 1);
  const q = r.search(/[?#]/);
  return { host: q === -1 ? r : r.slice(0, q), query: q !== -1 };
};
const hostOf = (u) => authOf(u).host;
/** The binding a name refers to. A bare name reads every binding; a qualified one (`this.baseUrl`,
 *  `environment.apiUrl`) reads its last segment among the bindings that are NOT JS locals — a local
 *  `const baseUrl = \`${this.baseUrl}/reports\`` is not the field it shadows. */
export function bindingOf(bindings, name) {
  const n = String(name ?? '');
  if (!n.includes('.')) return bindings.get(n);
  return bindings.get(n) || (bindings.members ?? bindings).get(n.split('.').pop());
}
/** A name `baseBindings` dropped because it is bound to two different bases in one file (same scoping). */
const ambiguousIn = (bindings, name) => (name.includes('.')
  ? !!(bindings.membersAmbiguous ?? bindings.ambiguous)?.has(name.split('.').pop())
  : !!bindings.ambiguous?.has(name));
const PLACEHOLDER_HOST = /[{$%]/;
/** The catalog's internal host suffixes (P1 X6): a name ending in one names a member through its first label.
 *  Kept equal to src/core/workspace-map/catalog.mjs by a parity test; this module never imports the catalog. */
export const INTERNAL_HOST_SUFFIXES = Object.freeze(['.internal', '.local', '.localhost', '.lan', '.svc', '.cluster.local', '.consul', '.docker', '.home.arpa']);
/** A property path P1's catalog reads as a public dotted host (`window.location.origin`, `config.api`: a dotted DNS
 *  name, no upper-case letter, no `_`, no config-key stem, no internal suffix): it names no host, so a base read from
 *  it gives no target — and it is an origin, so a URL built from it is absolute (`absolute: true`): no receiver or
 *  file base prefixes it. */
export const hostShapedName = (e) => e.includes('.') && !/[A-Z_]/.test(e) && !envStems(e).length && !!hostName(e)
  && !INTERNAL_HOST_SUFFIXES.some((s) => e.endsWith(s));

/** `X + '/path'` where X is a literal base URL, a same-file binding or an env read → { target, confidence,
 *  prefix } | { ambiguous: true } (X is an ambiguous name) | null: a base derived by concatenation keeps its
 *  path, like the template form (`process.env.X + '/api/v1'`, os.environ["X"] + "/api", os.Getenv("X") + "/api",
 *  'http://gw' + '/api'). Two pieces only; the path piece is found with lastIndexOf and anchored regexes (linear). */
export function concatBase(expr, bindings) {
  const e = String(expr ?? '');
  const plus = e.lastIndexOf('+');
  if (plus <= 0) return null;
  const tail = /^\s*[fr]?(["'`])(\/[^"'`\s?#$]{0,200})\1\s*$/.exec(e.slice(plus + 1));
  const head = e.slice(0, plus).trim();
  if (!tail || !head || head.includes('+')) return null;
  const lit0 = /^[fr$@]?(["'`])(https?:\/\/[^"'`\s/]+)([^"'`\s?#]*)\1$/.exec(head);
  const lit = lit0 && !PLACEHOLDER_HOST.test(lit0[2]) ? lit0 : null; // `http://${process.env.HOST}:3000` + '/api' is an env base
  if (!lit && ambiguousIn(bindings, head)) return { ambiguous: true };
  const inner = lit ? null : bindingOf(bindings, head);
  // an imported / config base (`environment.apiUrl + '/api/v1'`) is named by its expression, like `${x}/path` —
  // unless P1 would read that expression as a public host (`config.api + '/x'`): then the path is kept, no target
  const named = /^[A-Za-z_$][\w$.]{0,120}$/.test(head) ? head : null;
  const env = lit || inner ? null : envKeyOf(head);
  const origin = !lit && !inner && !!(env || named) && hostShapedName(env || named);
  const target = lit ? hostOf(lit[2]) : inner ? inner.target : origin ? null : env || named;
  if (!target && !inner) return lit0 || origin ? { target: null, confidence: 'heuristic', prefix: joinPath(lit0 ? lit0[3] : '', tail[2]).replace(/^\/$/, ''), ...(origin ? { absolute: true } : {}), ...(lit0 ? { tplHost: true } : {}) } : null;
  return { target, confidence: lit ? 'exact' : 'heuristic', prefix: joinPath(lit ? lit[3] : inner?.prefix || '', tail[2]).replace(/^\/$/, ''), ...(inner?.absolute ? { absolute: true } : {}), ...(inner?.tplHost ? { tplHost: true } : {}) };
}

/** The literal path after the ONE placeholder of a template whose host is an env read →
 *  '/api/v1' | '': `http://${process.env.HOST}:3000/api/v1`, f"http://{os.environ['HOST']}:8000/api". */
export function envTail(expr) {
  const s = String(expr ?? '').trim();
  if ((s.match(/\{/g) || []).length !== 1 || !/^[fr$@]?["'`](?:\$?\{|(?:[A-Za-z]+:)?\/\/[^/"'`]*\{)/.test(s)) return '';
  const m = /\}[^"'`/\s{}]{0,40}(\/[^"'`\s?#${}]{0,200})["'`]$/.exec(s);
  return m ? m[1].replace(/\/+$/, '') : '';
}

// Parameter lists: JS `function f(…)`, `constructor(…)`, `(…) =>` (a TS return type too) and `x =>`; Python and Ruby
// `def f(…)`; Go `func f(…)` / `func (r *T) f(…)`. Every gap is a bounded run: `func` then `[ \t]*` on both sides of an
// optional name was quadratic on a run of spaces.
// A `function` right after a quote is a string (`typeof cb === 'function' ? cb(url)`), and a `?` right after a word,
// `]` or `>` is a C# nullable type (`string? BaseUrl =>`): neither opens a parameter list.
const PARAMS_RE = /(?<!['"`])\b(?:function\b[^(\n]{0,80}|constructor[ \t]{0,8}|def[ \t]{1,8}\w{1,80}[ \t]{0,8}|func\b(?:[ \t]{0,8}\([^()]{0,100}\))?[ \t]{0,8}(?:\w{1,80}[ \t]{0,8})?)\(([^()]{0,300})\)|\(([^()]{0,300})\)(?:[ \t]{0,8}:[^=;(){}\n]{1,100})?[ \t]{0,8}=>|(?:[(,=:]|(?<![\w\]>])\?|\breturn\b)[ \t]{0,8}(?:async[ \t]{1,8})?([A-Za-z_$][\w$]{0,60})[ \t]{0,8}=>/g;
/** Every name a parameter list in the file declares: the first identifier of each item, a destructured one
 *  (`{ baseUrl, token }`) too; a default value (`page = API`) is no parameter. `names.defaults`: the offsets of the
 *  names whose item carries a default (`constructor(baseUrl = process.env.X)`, `base_url: str = "http://…"`). */
function paramNames(code) {
  const names = new Set();
  names.defaults = new Set();
  for (const m of code.matchAll(PARAMS_RE)) {
    // where the list starts: group 1 ends right before the match's closing ')', group 2 starts right after its '('
    let at = m[1] != null ? m.index + m[0].length - 1 - m[1].length : m[2] != null ? m.index + 1 : -1;
    for (const piece of (m[1] ?? m[2] ?? m[3] ?? '').split(',')) {
      const n = /^([\s{[]*)([A-Za-z_$][\w$]{0,60})/.exec(piece);
      if (n) { names.add(n[2]); if (at !== -1 && piece.includes('=')) names.defaults.add(at + n[1].length); }
      if (at !== -1) at += piece.length + 1;
    }
  }
  return names;
}

/** Per-file base-URL bindings: NAME = <literal URL | env read | derived base | @Value("${key}")>.
 *  → Map name → { target, confidence, prefix? } (target: host[:port] of a literal URL, or the env/config key),
 *  plus `map.ambiguous`: the names bound to two different bases (urlOf reads their uses as dynamic). */
export function baseBindings(code) {
  const map = new Map();
  // A name bound to two different bases in one file (`const url = `${API}/users`` in one function,
  // `${API}/orders` in the next) is ambiguous: dropped, never the last one's base for every use — and a use
  // of it is a dynamic url (urlOf), never a path under the bare name (`${url}/recent` → GET /recent).
  const clash = new Set();
  map.ambiguous = clash;
  // the same rules again over the bindings that are not JS locals: what a qualified name (`this.x`) reads
  const members = new Map();
  const membersClash = new Set();
  map.members = members;
  map.membersAmbiguous = membersClash;
  const put1 = (m, c, name, v) => {
    if (c.has(name)) return;
    const prev = m.get(name);
    // compared field by field: `prefix: ''` and no prefix are one base; an absolute one (a key or origin) and a templated host are two
    if (!prev || (prev.target === v.target && prev.confidence === v.confidence && (prev.prefix || '') === (v.prefix || '') && !!prev.absolute === !!v.absolute)) { m.set(name, v); return; }
    // two hosts behind one path (`let API = 'http://localhost:3000/api'` … `API = 'https://api.acme.com/api'`): the path is known
    if ((prev.prefix || '') === (v.prefix || '')) { m.set(name, { target: name, confidence: 'heuristic', ...(v.prefix ? { prefix: v.prefix } : {}) }); return; }
    m.delete(name); c.add(name);
  };
  const drop = (name, local = false) => { map.delete(name); clash.add(name); if (!local) { members.delete(name); membersClash.add(name); } };
  // a prefix longer than any one right-hand side is built only by chaining (`A = A + '/x'` 10 000 times, `A2 = A1 + '/x'` …):
  // dropped, so every derivation costs O(rhs), never O(file) — the chain was quadratic (7 s per MiB)
  const tooLong = (v) => (v.prefix || '').length > 500;
  // a bare name that is also a parameter somewhere in the file (`makeClient(baseUrl)` beside a module `baseUrl`) is
  // ambiguous: that function reads its argument, never the other binding — so every bare use is a dynamic url, a
  // base derived from it clashes too, and `this.baseUrl = baseUrl` copies nothing. Qualified reads (`this.x`) keep theirs.
  const params = paramNames(code);
  // …except the parameter's own default (`constructor(baseUrl = process.env.X)`, `def __init__(self, base_url: str =
  // "http://…")`): the value it holds unless a caller passes another, as at 15486564 (any other binding still clashes)
  let dflt = false;
  // the names a member is given a value of its own (a class field, a Python class attribute, a constructor's `this.x = '…'`:
  // assigned off column 0, never a parameter's default or a copy of a parameter): `this.x = param` / `self.x = param` may
  // replace it but never erases it, as at 15486564
  const ownMembers = new Set();
  let own = true;
  const put = (name, v, local = false) => {
    if (tooLong(v)) { drop(name, local); return; }
    if (params.has(name) && !dflt) { map.delete(name); clash.add(name); } else put1(map, clash, name, v);
    if (!local) { put1(members, membersClash, name, v); if (own) ownMembers.add(name); }
  };
  // a reassignment derived from the name itself (`API = API + '/api/v1'`) replaces the base, never clashes with it
  const replace = (name, v, local) => { if (tooLong(v)) { drop(name, local); return; } if (!clash.has(name)) map.set(name, v); if (!local && !membersClash.has(name)) members.set(name, v); };
  // @Value("${key}") fields and constructor parameters first: an assignment may derive from them
  for (const m of code.matchAll(/@Value\(\s*"\\?\$\{([^}:"]{1,200})(?::[^}"]{0,200})?\}"\s*\)\s*(?:(?:private|protected|public|final|lateinit|var|val)\s+){0,3}(?:[\w<>?]{1,60}\s+)?([A-Za-z_]\w{0,60})/g)) {
    put(m[2], hostShapedName(m[1]) ? { target: null, confidence: 'heuristic', absolute: true } : { target: m[1], confidence: 'heuristic' });
  }
  // An optional type annotation `: T` / `: A | B` — type tokens hold no space and the gaps between
  // them are bounded, so a run of spaces after `x:` never backtracks quadratically. `==`, `===` and `=>`
  // are no assignments — except a typed C# expression-bodied property (`string BaseUrl => _configuration["X"];`).
  const ASSIGN_RE = /\b([A-Za-z_$][\w$]{0,60})(?:\s*:[ \t]{0,4}[\w<>?,.[\]|]{1,40}(?:[ \t]{1,4}[\w<>?,.[\]|]{1,40}){0,4})?\s*:?=(?!=)\s*([^;\n]{1,300})/g;
  for (const m of code.matchAll(ASSIGN_RE)) {
    const name = m[1];
    dflt = params.defaults.has(m.index);
    own = !dflt && m.index > 0 && code[m.index - 1] !== '\n'; // column 0: a module-level binding (a Python module name)
    const before = code.slice(Math.max(0, m.index - 12), m.index);
    let rhs = m[2];
    if (rhs[0] === '>') {
      if (!/\b(?:string|String|Uri)\??[ \t]+$/.test(before)) continue; // a JS arrow parameter
      rhs = rhs.slice(1);
    }
    const local = /\b(?:const|let|var)[ \t]+$/.test(before);
    // `${environment.apiUrl}/users`, `${process.env.API_URL}/api/v1`, f"{BASE}/users": a base with a path, derived
    // from an earlier binding or an env read — tested before the env read, which would keep the key and drop the path
    const tpl = /^\s*(?:`\$\{|[fF]["']\{)\s*([^}\s]{1,120})\s*\}(\/[^"'`\s?#$]*)["'`]/.exec(rhs);
    if (tpl) {
      const x = tpl[1];
      if (ambiguousIn(map, x)) { drop(name, local); continue; }
      const inner = bindingOf(map, x);
      const env = inner ? null : envKeyOf(x);
      const origin = !inner && hostShapedName(env || x);
      const v = { target: inner ? inner.target : origin ? null : env || x, confidence: 'heuristic', prefix: joinPath(inner?.prefix || '', tpl[2]).replace(/^\/$/, ''), ...(origin || inner?.absolute ? { absolute: true } : {}), ...(inner?.tplHost ? { tplHost: true } : {}) };
      if (x === name) replace(name, v, local); else put(name, v, local);
      continue;
    }
    // the same derived base written as a concatenation: `process.env.X + '/api/v1'`, os.Getenv("X") + "/api"
    const cat = concatBase(rhs, map);
    if (cat?.ambiguous) { drop(name, local); continue; }
    if (cat) { if (rhs.slice(0, rhs.lastIndexOf('+')).trim() === name) replace(name, cat, local); else put(name, cat, local); continue; }
    // a literal URL with a literal host before an env read: `https://api.acme.com/${process.env.TENANT}/v1` is acme's
    const url0 = /^\s*(?:new\s+Uri\(\s*)?[fr$@]?["'`](https?:\/\/[^"'`\s/]+)([^"'`\s?#]*)/.exec(rhs);
    const url = url0 && authOf(url0[1]).query ? [url0[0], url0[1], ''] : url0;
    const templatedHost = !!url && PLACEHOLDER_HOST.test(url[1].slice(url[1].indexOf('//') + 2));
    const env = envKeyOf(rhs);
    // … but `"http://localhost:8000" if DEBUG else os.environ["X"]` is an env base: the env read is outside the literal
    const open = url ? rhs.search(/["'`]/) : -1;
    const inLit = open === -1 ? '' : rhs.slice(open, rhs.indexOf(rhs[open], open + 1) + 1 || rhs.length); // the whole literal, query too
    if (url && !templatedHost && (!env || envKeyOf(inLit))) { put(name, { target: hostOf(url[1]), confidence: 'exact', prefix: url[2].replace(/\/+$/, '') }, local); continue; }
    if (env) { const prefix = envTail(rhs); put(name, { target: hostShapedName(env) ? null : env, confidence: 'heuristic', ...(prefix ? { prefix } : {}), ...(hostShapedName(env) ? { absolute: true } : {}) }, local); continue; }
    // a templated host with no env read (`http://127.0.0.1:${port}`): the path is known, the host is not — no target (P4-2);
    // `tplHost`: a URL built from it is absolute, so no receiver or file base prefixes it (never `absolute`: baseOf reads that as an origin)
    if (templatedHost) { put(name, { target: null, confidence: 'heuristic', prefix: url[2].replace(/\/+$/, ''), tplHost: true }, local); continue; }
    // a relative-path constant (`API_PREFIX = '/api/v1'`): the page's host, a known path — so `API_PREFIX + '/users'` keeps it
    const relPath = /^\s*[fr]?(["'`])(\/[^"'`\s?#$\\{}]{0,200})\1\s*$/.exec(rhs);
    if (relPath) { put(name, { target: null, confidence: 'exact', prefix: relPath[2].replace(/\/+$/, '') }, local); continue; }
    // `this.baseUrl = baseUrl`: a member assigned a bound local takes its base (qualified lookups skip locals)
    const alias = /^\s*([A-Za-z_$][\w$]{0,60})\s*$/.exec(rhs);
    // `self.base_url = base_url`: a member assigned a PARAMETER holds the argument, never a same-named module binding
    // (a Python module-level name is not a JS local, so it reached `members`) — a value of the member's own stays
    if (alias && params.has(alias[1]) && !map.has(alias[1])) { if (!local && !ownMembers.has(name)) members.delete(name); continue; }
    own = false;
    if (alias && map.has(alias[1])) put(name, map.get(alias[1]), local);
  }
  return map;
}

/** Ruby `#{id}` and — in Kotlin / Groovy / Java / PHP only — `$id` placeholders inside a path →
 *  `{id}` (normPath already understands `${id}`, `{id}`, `:id`, `<id>`, `%s`). A `$` in a JS path
 *  is literal text (OData `/$metadata`). A trailing `${…}` glued to a non-`/` character is a query
 *  suffix (`/api/config${qs}`), not a path segment: dropped. */
const DOLLAR_VARS = new Set(['kotlin', 'java', 'php']);
function tplPath(p, lang) {
  const s = p.replace(/([^/])\$\{[^}]{0,200}\}$/, '$1').replace(/#\{([^}]{0,120})\}/g, '{$1}');
  return DOLLAR_VARS.has(lang) ? s.replace(/\{\$([A-Za-z_]\w{0,60})[^}]{0,120}\}/g, '{$1}').replace(/\$([A-Za-z_]\w{0,60})/g, '{$1}') : s;
}

/** URL analysis of a call argument; `lang` (langOf) scopes the `$id` path placeholders.
 *  → { path, target, confidence, needle } | { dynamic: true, raw } | null (not a URL/path) */
export function urlOf(arg, bindings = new Map(), lang = null) {
  if (!arg) return null;
  const r = urlOfRaw(arg, bindings, lang);
  return r && r.path ? { ...r, path: tplPath(r.path, lang) } : r;
}

/** The pieces of a concatenation: `+`, and in PHP `.` too — split outside quotes only, so a host's dots stay
 *  (`'http://users.internal/users/' . $id`). One pass over a ≤ 400-char argument. */
function concatPieces(e, lang) {
  if (lang !== 'php') return e.split(/\s*\+\s*/);
  const out = [];
  let q = null;
  let from = 0;
  for (let i = 0; i < e.length; i += 1) {
    const c = e[i];
    if (q) { if (c === q) q = null; } else if (c === '"' || c === "'") { q = c; } else if (c === '.' || c === '+') { out.push(e.slice(from, i).trim()); from = i + 1; }
  }
  out.push(e.slice(from).trim());
  return out;
}
/** Ruby's `#{id}` is a path parameter, not a fragment: rewritten before the query / fragment is cut. */
const rubyVars = (s) => s.replace(/#\{([^}]{0,120})\}/g, '{$1}');

function urlOfRaw(arg, bindings, lang = null) {
  // `root`: `new URL('/x', B)` / `urljoin(B, '/x')` resolve a leading '/' from the host (RFC 3986): B's path is dropped.
  const fromBase = (base, rest, needle, root = false) => {
    if (ambiguousIn(bindings, base)) return { dynamic: true, raw: needle }; // bound to two bases: never a path under the bare name
    const b = bindingOf(bindings, base);
    const env = envKeyOf(base);
    const origin = !b && hostShapedName(env || base);
    const target = b ? b.target : origin ? null : env || base;
    const path = rest.startsWith('/') ? (b?.prefix && !root ? joinPath(b.prefix, rest) : rest) : null;
    if (!path) return { dynamic: true, raw: needle };
    return { path, target, confidence: b?.confidence === 'exact' ? 'exact' : 'heuristic', needle, ...(origin || b?.absolute ? { absolute: true } : {}), ...(b?.tplHost ? { tplHost: true } : {}) };
  };
  if (arg.kind === 'literal') {
    const v = arg.value.trim();
    // M2: the authority ends where authorityEnd says: a URL password may hold '?' or '#' (`http://svc:pa?ss@host/x`).
    const abs0 = /^(https?):\/\/(\S+)$/.exec(v);
    let cut = abs0 ? authorityEnd(abs0[2]) : -1;
    // …and a "host" holding a ':' no port follows is a password's head (`svc:ab#cd#ef@billing/x`: authorityEnd stopped at
    // its first '#'): the authority runs past the last '@' before the path, as authOf reads a base URL
    if (cut > 0 && notPort(abs0[2].slice(0, cut).replace(/^.*@/, ''))) {
      const r = abs0[2];
      const at1 = r.indexOf('@', cut);
      const slash = at1 === -1 ? -1 : r.indexOf('/', at1);
      const at = at1 === -1 ? -1 : r.lastIndexOf('@', slash === -1 ? r.length : slash);
      // …never an '@' behind a '/' (a path or a query after a non-numeric port: `host:PORT/x?cc=ops@acme.com`)
      if (at !== -1 && !r.slice(cut, at1).includes('/')) { const q = r.slice(at + 1).search(/[/?#]/); cut = q === -1 ? -1 : at + 1 + q; }
    }
    const abs = abs0 && cut !== 0 ? [abs0[0], abs0[1], cut === -1 ? abs0[2] : abs0[2].slice(0, cut), cut === -1 ? '' : abs0[2].slice(cut)] : null;
    if (abs) {
      const host = abs[2].replace(/^.*@/, '');
      const path = rubyVars(abs[3]).replace(/[?#].*$/, '');
      // `http://${host}:${port}/x`: the host is unknown but the path is literal — keep it, no target; `tplHost`: the
      // URL is absolute, so no receiver or file base prefixes it (never `absolute`: baseOf reads that as an origin)
      if (/[{$%]/.test(host)) return path && path !== '/' ? { path, target: null, confidence: 'exact', needle: v.slice(0, 200), tplHost: true } : { dynamic: true, raw: v };
      return { path: path || '/', target: host, confidence: 'exact', needle: v.slice(0, 200) };
    }
    if (v.startsWith('/')) return { path: rubyVars(v).replace(/[?#].*$/, ''), target: null, confidence: 'exact', needle: v.slice(0, 200) };
    // `${BASE}/x`, {BASE}/x (f-string / C# $""), %s/x (printf) — a leading placeholder names the base
    // `${BASE}/x` (JS, Kotlin), {BASE}/x (f-string, C# $""), #{BASE}/x (Ruby), $BASE/x (Kotlin, Groovy, PHP)
    const tpl = /^\$\{\s*([^}]{1,120}?)\s*\}(.*)$/.exec(v) || /^#\{\s*([^}]{1,120}?)\s*\}(.*)$/.exec(v)
      || /^\$([A-Za-z_]\w{0,60})(\/.*)$/.exec(v) || (arg.template ? /^\{\s*([^}]{1,120}?)\s*\}(.*)$/.exec(v) : null);
    if (tpl) return fromBase(tpl[1], tpl[2], v.slice(0, 200));
    return null;
  }
  const e = arg.text;
  // BASE + "/x/" + id + "/y" and "/x/" + id: literal pieces kept, every other piece → {}; a leading
  // non-literal piece names the base. Bounded: ≤ 12 pieces of a ≤ 400-char argument.
  const pieces = concatPieces(e, lang);
  if (pieces.length > 1 && pieces.length <= 12) {
    const lit = (p) => /^[fr]?(["'`])([^"'`]*)\1$/.exec(p);
    const head = lit(pieces[0]) ? null : pieces[0];
    const path = pieces.slice(head ? 1 : 0).map((p) => (lit(p) ? lit(p)[2] : '{}')).join('').replace(/(\{\})+/g, '{}');
    // "http://orders:8080/orders/" + id: an absolute URL built by concatenation keeps its host and path
    if (!head && /^https?:\/\//i.test(path)) {
      const u = urlOfRaw({ kind: 'literal', value: path }, bindings);
      return u && !u.dynamic ? { ...u, needle: e.slice(0, 200) } : { dynamic: true, raw: e.slice(0, 200) };
    }
    if (path.startsWith('/')) return head ? fromBase(head, path, e.slice(0, 200)) : { path, target: null, confidence: 'exact', needle: e.slice(0, 200) };
  }
  const concat = /^([A-Za-z_$][\w$.]*(?:\(\s*['"][^'"]*['"]\s*\))?(?:\s*\[\s*['"][^'"]+['"]\s*\])?)\s*\+\s*[fr]?(["'`])(\/[^"'`]*)\2/.exec(e);
  if (concat) return fromBase(concat[1], concat[3], e.slice(0, 200));
  const printf = /^(?:String\.format|fmt\.Sprintf|string\.Format)\(\s*"(%s|\{0\})(\/[^"]*)"\s*,\s*([A-Za-z_][\w.]*(?:\(\s*"[^"]*"\s*\))?)/.exec(e);
  if (printf) return fromBase(printf[3], printf[2], e.slice(0, 200));
  const join = /^(?:urljoin|new\s+URL)\(\s*(?:([A-Za-z_][\w.]*)\s*,\s*["'](\/[^"']*)["']|["'](\/[^"']*)["']\s*,\s*([A-Za-z_][\w.]*))/.exec(e);
  if (join) return fromBase(join[1] || join[4], join[2] || join[3], e.slice(0, 200), true);
  if (/^[A-Za-z_$][\w$.]*(\(.*\))?$/.test(e) || /[+`]/.test(e)) return { dynamic: true, raw: e.slice(0, 200) };
  return null;
}

/** Innermost-last list of the scopes containing each position, for positions visited in
 *  ascending order: scopes = [{ open, close, path }] (properly nested, from braceScopes). A
 *  stack sweep — linear in scopes + queries; depth capped at 32. */
export function scopeSweeper(scopes) {
  const sorted = [...scopes].sort((a, b) => a.open - b.open);
  const stack = [];
  let next = 0;
  return (pos) => {
    while (next < sorted.length && sorted[next].open < pos) {
      const s = sorted[next];
      next += 1;
      while (stack.length && stack[stack.length - 1].close < s.open) stack.pop();
      if (stack.length < 32) stack.push(s);
    }
    while (stack.length && stack[stack.length - 1].close < pos) stack.pop();
    return stack.map((s) => s.path);
  };
}

/** Matching braces of code whose strings AND comments are blanked: Map open → close offsets. */
export function braceScopes(code, lang) {
  const t = String(code ?? '');
  const lits = literals(t, lang);
  let blanked = '';
  let last = 0;
  for (const l of lits) { blanked += t.slice(last, l.start) + ' '.repeat(Math.max(0, l.end - l.start)); last = l.end; }
  blanked += t.slice(last);
  const map = new Map();
  const stack = [];
  for (let i = 0; i < blanked.length; i += 1) {
    if (blanked[i] === '{') stack.push(i);
    else if (blanked[i] === '}' && stack.length) map.set(stack.pop(), i);
  }
  return map;
}

// Route-vs-client call classification, shared by http-routes and http-clients so that one
// `x.get('/p', …)` call is never both a route and a client call.
const ROUTER_RECV = /^(app|router|server|fastify|hono|koa|api|route|routes|r|e|g|mux|v\d|\w*Router|\w*Routes|\w*App|\w*Api|\w*Group|group)$/;
const CLIENT_RECV = /^(http|https|axios|client|httpClient|request|superagent|got|ky|fetch|session|requests|httpx|resty|restTemplate|webClient)$/i;
const AMBIGUOUS_RECV = /^(api|\w*Api)$/; // router names that axios instances also use
// strict: a function / arrow / async / middleware array; loose: also a bare identifier, a call or an
// options object (Express named handlers, Fastify `get(path, { schema }, handler)`).
const HANDLER_STRICT = /^\s*,\s*(?:async\b|function\b|\([^)]{0,80}\)\s*=>|[A-Za-z_$][\w$]*\s*=>|\[)/;
const HANDLER_LOOSE = /^\s*,\s*(?:async\b|function\b|\(|\[|\{|[A-Za-z_$][\w$.]*\s*[,)]|[A-Za-z_$][\w$.]*\s*\()/;
const SERVER_FILE_RE = /\b(?:from\s+|require\(\s*)['"](?:express|koa|@koa\/router|koa-router|fastify|hono|@hono\/[\w-]+|restify|polka)['"]|\bexpress\.Router\s*\(|\bnew\s+(?:Hono|Koa|Router)\s*\(/;
export const isServerFile = (code) => SERVER_FILE_RE.test(code);
// a type-annotated instance (`const billingApi: AxiosInstance = axios.create(…)`) is read under its name, not its type's
// (`const api: any = …` too; a switch label is no name: `case prod: api = …`, `case Env.Prod: api = …` and
// `default: api = …` are `api`'s)
const CLIENT_INSTANCE_RE = /(?<!\bcase[ \t]{1,4}(?:[\w$]{1,60}\.){0,4})\b(?!default\b)([A-Za-z_$][\w$]{0,40})(?:[ \t]{0,4}:[ \t]{0,4}[\w$.[\]|]{1,80})?\s*=\s*(?:axios|ky|got)\.(?:create|extend)\s*\(/g;
/** Receivers this file creates as HTTP clients (`const api = axios.create(…)`): never routers. */
export const clientInstances = (code) => new Set([...String(code ?? '').matchAll(CLIENT_INSTANCE_RE)].map((m) => m[1]));
// Router types (`api: Router`, `api: express.Router`, `app: Express`, `api: FastifyInstance`) and constructors
// (`express.Router()`, `new Router()`, `new KoaRouter()`, `new Hono<{ Bindings: Env }>()`, `new OpenAPIHono()`), and
// a Fastify TS plugin's parameter (`const plugin: FastifyPluginAsync = async (api) => …`).
const ROUTER_TYPES = String.raw`(?:express\.)?(?:Router|IRouter|Express)|express\.Application|FastifyInstance|Hono|OpenAPIHono`;
const ROUTER_INSTANCE_RE = new RegExp(String.raw`\b([A-Za-z_$][\w$]{0,40})\s*=\s*(?:new\s+)?(?:express\.Router|Router|KoaRouter|Hono|OpenAPIHono|Koa|Fastify|fastify|express)(?:<[^<>()\n]{0,200}>)?\s*\(|\b([A-Za-z_$][\w$]{0,40})\s*:\s*(?:${ROUTER_TYPES})\b|\bFastifyPlugin(?:Async|Callback)?(?:<[^<>()\n]{0,200}>)?\s*=\s*(?:async\s+)?\(\s*([A-Za-z_$][\w$]{0,40})`, 'g');
// a name the file ALSO types as something else in a parameter or declaration (`api: Router` in one function,
// `api: AxiosInstance` in the next) is not known to be a router: dropped, so its calls follow the plain rule.
// A type is a class name (`AxiosInstance`, `ApiClient`); an object literal's value is not (`{ api: API_VERSION }`,
// `{ api: Api.name }`, `{ api: Api() }`): a constant, a member access or a call never drops a router.
const OTHER_TYPE_RE = new RegExp(String.raw`(?:[(,]|\b(?:const|let|var|private|public|protected|readonly))[ \t\n]{0,20}([A-Za-z_$][\w$]{0,40})\s*:\s*(?!(?:${ROUTER_TYPES})\b)I?[A-Z][a-z][\w$]{0,60}(?![\w$.(])`, 'g');
/** Receivers this file creates as routers (`const api = express.Router()`, `new Hono()`, a Fastify plugin's
 *  `(api: FastifyInstance)`): never clients, so a typed call on one stays a route (`api.get<P>('/users/:id', getUser)`). */
export function routerInstances(code) {
  const s = String(code ?? '');
  const names = new Set([...s.matchAll(ROUTER_INSTANCE_RE)].map((m) => m[1] ?? m[2] ?? m[3]));
  if (names.size) for (const m of s.matchAll(OTHER_TYPE_RE)) names.delete(m[1]);
  return names;
}
/** `recv.verb('/p' …)`: `after` = the text right after the path argument. An ambiguous receiver
 *  (`api`, `userApi`) needs a strict handler unless the file sets up a server — and always when the
 *  call is typed (`api.get<User[]>('/users', config)` is the typed-client idiom, even in a BFF's
 *  server file); a receiver the file creates with axios.create / ky.create / got.extend (`clients`)
 *  always needs a function handler, and one it creates as a router (`routers`) never does. */
export function isRouteCall(recv, after, serverFile, clients = null, typed = false, routers = null) {
  if (!ROUTER_RECV.test(recv ?? '') || CLIENT_RECV.test(recv ?? '')) return false;
  const loose = !(clients && clients.has(recv)) && (!!routers?.has(recv) || (serverFile && !typed) || !AMBIGUOUS_RECV.test(recv));
  return (loose ? HANDLER_LOOSE : HANDLER_STRICT).test(after);
}

/** Join URL path pieces: ('/api/', 'users', ':id') → '/api/users/:id'; '' pieces ignored. */
export function joinPath(...parts) {
  const segs = parts.filter((p) => typeof p === 'string' && p.length).map((p) => p.replace(/^\/+|\/+$/g, '')).filter(Boolean);
  return `/${segs.join('/')}`;
}
