// api-graphql: GraphQL SDL and operations.
//   provides  every field of the root types (Query / Mutation / Subscription, or the names a
//             `schema { query: … }` block declares; `extend type` included) → key
//             '<Root>.<field>' with the canonical root name, from .graphql/.graphqls/.gql files
//             and from SDL inside gql`…` / graphql`…` templates in code (Apollo typeDefs)
//   consumes  every ROOT field an operation selects (query → Query.<field>, mutation →
//             Mutation.<field>, subscription → Subscription.<field>; aliases resolved to the
//             field name) from operation documents and gql`…` / graphql(`…`) / gql("""…""")
// A document is SDL when a definition keyword stands at depth 0 (a selected field named `type` is
// not SDL). Code-first schemas (resolver decorators) are not read here; a minified JS bundle is skipped.
// A client keeps a copy of its server's schema (Apollo Kotlin / iOS, Relay, graphql-codegen): an SDL FILE whose
// root fields the member's own (non-test) operations select provides nothing and yields one unresolved item,
// 'client copy of a GraphQL schema' — unless the member shows server evidence, or the file sits in a JVM server's
// resources (Spring GraphQL, DGS, graphql-java-kickstart). Operations under a root docs/ examples/ samples/ folder
// document the API: never the member's own. SDL in code (typeDefs) provides.
import { splitLines, fact, lineIndex, isMinified, onePerKey, cleanUnresolved } from './lib/text.mjs';
import { isTestPath } from '../files.mjs';
import { LIMITS } from '../../../shared/workspace-map/limits.mjs';

const DOC_EXT_RE = /\.(graphql|graphqls|gql)$/i;
const CODE_EXT_RE = /\.(js|jsx|ts|tsx|mjs|cjs|vue|svelte|py)$/i;
const ROOTS = { query: 'Query', mutation: 'Mutation', subscription: 'Subscription' };
const SDL_RE = /(^|[\s}])(?:extend\s+)?(?:type|schema|interface|input|enum|scalar|union|directive)\s+[@\w{]/;
// Server evidence: a GraphQL server library imported by the member's own JS / TS / Python code (never by a test or
// a mock server: MOCK_RE, api-proto's rule), or a file only a server has, for the servers whose code no detector
// here reads (gqlgen's config, a graphql-ruby schema class, Lighthouse's config, a Laravel app/GraphQL/ class).
// Yoga's client packages (`@graphql-yoga/apollo-link`, `@graphql-yoga/urql-exchange`) are no evidence.
// Bounded runs only: each scan is linear on 1 MiB.
const SERVER_JS_RE = /(?:\bfrom[ \t]{0,20}|\brequire[ \t]{0,20}\([ \t]{0,20}|\bimport[ \t]{0,20}(?:\([ \t]{0,20})?)['"](?:apollo-server(?:-[a-z]{1,20}){0,3}|@apollo\/(?:server|subgraph|gateway|federation)|graphql-yoga|@graphql-yoga\/(?!apollo-link\b|urql-exchange\b)[\w-]{1,40}|mercurius|express-graphql|koa-graphql|graphql-http\/lib\/use\/[\w-]{1,40}|@nestjs\/(?:graphql|apollo|mercurius)|type-graphql|@pothos\/core|nexus|graphql-compose|graphql-helix|@envelop\/core|@redwoodjs\/graphql-server|aws-cdk-lib\/aws-appsync|@aws-cdk\/aws-appsync(?:-alpha)?|postgraphile|@keystone-6\/core|@neo4j\/graphql|graphql-modules|@hono\/graphql-server)(?:\/[\w.@-]{1,100}){0,6}['"]/;
const SERVER_PY_RE = /^[ \t]{0,40}(?:from|import)[ \t]{1,20}(?:strawberry(?:_django)?|graphene(?:_django|_sqlalchemy|_mongo|_federation)?|ariadne|tartiflette|graphql_server|flask_graphql)\b/m;
const SERVER_FILE_RE = /(?:^|\/)(?:\.?gqlgen\.ya?ml|app\/graphql\/[^/]{0,200}schema\.rb|config\/lighthouse\.php|app\/GraphQL\/(?:[^/]{1,200}\/){0,20}[^/]{1,200}\.php)$/i;
const MOCK_RE = /(?:^|\/)[^/]{0,200}(?:mock|fake|stub)/i;
// …and the schema-first servers whose code no parser here reads: Go graph-gophers/graphql-go (MustParseSchema over an
// embedded schema.graphql), gqlgen's handler, graphql-go/handler; .NET Hot Chocolate / GraphQL.NET; PHP graphql-php;
// Rust async-graphql / juniper; Elixir Absinthe; graphql-java's SchemaParser, DGS. Evidence only: these files add no fact.
const SERVER_CODE_EXT_RE = /\.(go|cs|php|rs|ex|exs|java|kt)$/i;
const SERVER_OTHER_RE = /"github\.com\/(?:graph-gophers\/graphql-go|99designs\/gqlgen\/graphql\/handler|graphql-go\/handler)"|\bAddGraphQL(?:Server)?[ \t]{0,20}\(|\busing[ \t]{1,20}(?:HotChocolate|GraphQL\.Server)\b|\bGraphQL\\(?:Utils\\BuildSchema|Server\\StandardServer)\b|\buse[ \t]{1,20}(?:async_graphql(?:_\w{1,40})?|juniper)::|\buse[ \t]{1,20}Absinthe\.Schema\b|\bgraphql\.schema\.idl\.SchemaParser\b|\bcom\.netflix\.graphql\.dgs\b(?!\.client\b)/;
// Operations under a ROOT docs / examples / samples folder document the API; they are not the member's own client
// operations (the root only: isSamplePath also matches a Java package such as `src/main/java/com/example/`).
const DOCS_RE = /^(?:docs?|examples?|samples?)\//i;
// At most this many distinct root fields of the member's own operations are kept for the copy verdict.
const OPS_MAX = 50000;
// A JVM server's classpath resources: SDL there (Spring GraphQL's graphql/, DGS's schema/, graphql-java-kickstart's
// resources root) is the member's own schema, never a copy (Apollo Kotlin keeps its copy under src/main/graphql/).
// …and Hasura's actions SDL (`metadata/actions.graphql`): the custom mutations and queries the Hasura server itself serves.
const JVM_SERVER_SDL_RE = /(?:^|\/)src\/main\/resources\/|(?:^|\/)metadata\/actions\.graphql$/;

/** Blank "strings", """block strings""" and # comments (newlines kept, offsets stable). */
export function blankGraphql(text) {
  const t = String(text ?? '');
  let out = '';
  let i = 0;
  const sp = (s) => s.replace(/[^\r\n]/g, ' ');
  while (i < t.length) {
    if (t.startsWith('"""', i)) { const j = t.indexOf('"""', i + 3); const e = j === -1 ? t.length : j + 3; out += sp(t.slice(i, e)); i = e; continue; }
    if (t[i] === '"') { let j = i + 1; while (j < t.length && t[j] !== '"' && t[j] !== '\n') j += t[j] === '\\' ? 2 : 1; const e = Math.min(t.length, j + 1); out += sp(t.slice(i, e)); i = e; continue; }
    if (t[i] === '#') { const j = t.indexOf('\n', i); const e = j === -1 ? t.length : j; out += sp(t.slice(i, e)); i = e; continue; }
    out += t[i]; i += 1;
  }
  return out;
}

/** Index just past the brace matching the '{' at `open` (or text end). */
function closeOf(t, open) {
  let depth = 0;
  for (let i = open; i < t.length; i += 1) { if (t[i] === '{') depth += 1; else if (t[i] === '}') { depth -= 1; if (depth === 0) return i + 1; } }
  return t.length;
}

/** Keep only depth-0 characters of a block body: nested (...) and {...} contents blanked. */
function depth0(body) {
  let out = '';
  let paren = 0;
  let brace = 0;
  for (const c of body) {
    if (c === '(') { paren += 1; out += paren === 1 && brace === 0 ? c : ' '; continue; }
    if (c === ')') { out += paren === 1 && brace === 0 ? c : ' '; paren = Math.max(0, paren - 1); continue; }
    if (c === '{') { brace += 1; out += ' '; continue; }
    if (c === '}') { brace = Math.max(0, brace - 1); out += ' '; continue; }
    out += paren || brace ? (c === '\n' || c === '\r' ? c : ' ') : c;
  }
  return out;
}

/** The body of the first `schema @dir(…)* { … }` block, or null. One forward scan: directive
 *  arguments and the body close with indexOf, a `schema` token inside an already-scanned stretch
 *  is skipped, and an unclosed '(' ends the search — never a regex re-scanning the rest of the
 *  text from every `schema` (quadratic). */
function schemaBlock(t) {
  let scanned = 0;
  for (const m of t.matchAll(/\bschema\b/g)) {
    if (m.index < scanned) continue;
    let i = m.index + 6;
    const ws = () => { while (i < t.length && /\s/.test(t[i])) i += 1; };
    ws();
    while (t[i] === '@') {
      i += 1;
      while (i < t.length && /\w/.test(t[i])) i += 1;
      ws();
      if (t[i] === '(') { const c = t.indexOf(')', i); if (c === -1) return null; i = c + 1; }
      ws();
    }
    scanned = i;
    if (t[i] !== '{') continue;
    const close = t.indexOf('}', i);
    return close === -1 ? null : t.slice(i + 1, close);
  }
  return null;
}

/** After an operation keyword at `i`: optional name, one balanced `( … )` (variable defaults may
 *  hold braces), directives with balanced arguments → { name, open: the selection '{' | -1, end }.
 *  One forward scan; an unclosed '(' ends at the text end. */
function opHeader(t, i) {
  const n = t.length;
  const ws = () => { while (i < n && /\s/.test(t[i])) i += 1; };
  const balanced = () => { // t[i] === '(' → i just past its matching ')'; false when never closed
    for (let depth = 0; i < n; i += 1) {
      if (t[i] === '(') depth += 1;
      else if (t[i] === ')' && --depth === 0) { i += 1; return true; }
    }
    return false;
  };
  ws();
  const s = i;
  while (i < n && /\w/.test(t[i])) i += 1;
  const name = t.slice(s, i);
  ws();
  if (t[i] === '(' && !balanced()) return { name, open: -1, end: n };
  ws();
  while (t[i] === '@') {
    i += 1;
    while (i < n && /\w/.test(t[i])) i += 1;
    ws();
    if (t[i] === '(' && !balanced()) return { name, open: -1, end: n };
    ws();
  }
  return { name, open: t[i] === '{' ? i : -1, end: i };
}

/** SDL → [{ key: 'Query.invoice', field, offset }] (offset into t). A `schema { … }` block
 *  makes ONLY the types it names roots; without one, Query / Mutation / Subscription are. */
export function sdlFields(t) {
  const renamed = {};
  const schemaBody = schemaBlock(t);
  if (schemaBody !== null) for (const m of schemaBody.matchAll(/\b(query|mutation|subscription)\s*:\s*(\w+)/g)) renamed[m[2]] = ROOTS[m[1]];
  const custom = Object.keys(renamed).length > 0;
  const rootOf = (name) => (custom ? renamed[name] || null : Object.values(ROOTS).includes(name) ? name : null);
  const out = [];
  let lastEnd = 0;
  for (const m of t.matchAll(/\b(?:extend\s+)?type\s+(\w+)\b[^{]{0,500}?\{/g)) {
    const open = m.index + m[0].length - 1;
    if (open < lastEnd) continue; // inside the previous type's body
    const close = closeOf(t, open);
    lastEnd = close;
    const root = rootOf(m[1]);
    if (!root) continue;
    const body = depth0(t.slice(open + 1, close - 1));
    for (const f of body.matchAll(/(?<![@\w$.])([_A-Za-z]\w*)\s*[(:]/g)) out.push({ key: `${root}.${f[1]}`, field: f[1], offset: open + 1 + f.index });
  }
  return out;
}

/** Operation document → [{ key: 'Query.invoice', field, offset, op }] (offset into t).
 *  Only top-level operations: a '{' inside an earlier operation is never a new one, and an
 *  anonymous '{' counts only at the top level (preceded by nothing or a closing '}'). */
export function operationFields(t) {
  const out = [];
  if (!t.includes('{')) return out;
  // An operation keyword (its header read by opHeader) or a top-level anonymous '{'.
  const OP_RE = /(^|[\s}])(query|mutation|subscription)\b|(^|\n)[ \t]*\{/g;
  let lastEnd = 0;
  let scanned = 0; // a header stretch already read is never re-read from a later keyword
  for (const m of t.matchAll(OP_RE)) {
    let open;
    let name = '';
    if (m[2]) {
      const at = m.index + m[0].length;
      if (at < Math.max(lastEnd, scanned)) continue;
      const h = opHeader(t, at);
      scanned = Math.max(scanned, h.end);
      if (h.open === -1) { if (h.end >= t.length) break; continue; }
      open = h.open;
      name = h.name;
    } else {
      open = m.index + m[0].length - 1;
      if (open < Math.max(lastEnd, scanned)) continue;
      let k = m.index - 1;
      while (k >= 0 && /\s/.test(t[k])) k -= 1;
      if (k >= 0 && t[k] !== '}') continue;
    }
    const kind = m[2] || 'query';
    const end = closeOf(t, open);
    lastEnd = end;
    const body = depth0(t.slice(open + 1, end - 1)).replace(/\.\.\.\s*on\s+\w+/g, (s) => ' '.repeat(s.length)).replace(/\.\.\.\s*\w+/g, (s) => ' '.repeat(s.length));
    for (const f of body.matchAll(/(?<![@\w$.])([_A-Za-z]\w*)(?:\s*:\s*([_A-Za-z]\w*))?/g)) {
      const field = f[2] || f[1];
      const offset = open + 1 + f.index + (f[2] ? f[0].lastIndexOf(f[2]) : 0);
      out.push({ key: `${ROOTS[kind]}.${field}`, field, offset, op: `${kind}${name ? ` ${name}` : ''}` });
    }
  }
  return out;
}

/** gql`…`, graphql`…`, gql(`…`), graphql(`…`), gql("""…"""), gql('''…''') → [{ start, body }]. */
export function templates(text) {
  const out = [];
  const OPEN_RE = /\b(?:gql|graphql)(?:\s*\(\s*|[ \t]*)(`|"""|''')/g;
  for (const m of text.matchAll(OPEN_RE)) {
    const start = m.index + m[0].length;
    const close = text.indexOf(m[1], start);
    if (close === -1) break;
    out.push({ start, body: text.slice(start, close).replace(/\$\{[^}]{0,500}\}/g, (s) => ' '.repeat(s.length)) });
  }
  return out;
}

function fromDocument(t, rel, lines, lineOf, base, facts) {
  const clean = blankGraphql(t);
  if (SDL_RE.test(depth0(clean))) { // definitions stand at depth 0: a selected field named `type` is no SDL
    for (const f of sdlFields(clean)) facts.push(fact({ kind: 'graphql', dir: 'provides', key: f.key, rel, lines, line: lineOf(base + f.offset), needle: f.field, detail: 'GraphQL schema', confidence: 'exact' }));
    return;
  }
  for (const f of operationFields(clean)) facts.push(fact({ kind: 'graphql', dir: 'consumes', key: f.key, rel, lines, line: lineOf(base + f.offset), needle: f.field, detail: f.op, confidence: 'exact' }));
}

function detect({ rel, text }, ctx) {
  if (isMinified(rel, text)) return { facts: [] }; // a bundle's gql templates belong to third-party code
  const st = ctx && typeof ctx.state === 'object' && ctx.state ? ctx.state : {};
  st.sdl ??= [];
  st.ops ??= new Set();
  const own = !isTestPath(rel); // test code neither queries for the member nor serves
  const doc = DOC_EXT_RE.test(rel);
  if (own && !st.server && CODE_EXT_RE.test(rel) && !MOCK_RE.test(rel) && (/\.py$/i.test(rel) ? SERVER_PY_RE : SERVER_JS_RE).test(text)) st.server = true;
  // (read only in a member whose listing holds a schema file: evidence decides nothing else)
  if (SERVER_CODE_EXT_RE.test(rel)) {
    st.sdlListed ??= Array.isArray(ctx?.files) && ctx.files.some((f) => typeof f === 'string' && DOC_EXT_RE.test(f));
    if (st.sdlListed && own && !st.server && !MOCK_RE.test(rel) && SERVER_OTHER_RE.test(text)) st.server = true;
    return { facts: [] };
  }
  const lines = splitLines(text);
  const lineOf = lineIndex(text);
  const facts = [];
  if (doc) fromDocument(text, rel, lines, lineOf, 0, facts);
  else if (/gql|graphql/.test(text)) for (const tpl of templates(text)) fromDocument(tpl.body, rel, lines, lineOf, tpl.start, facts);
  // at most OPS_MAX root fields in all: crafted operation files never grow the member's state without bound
  if (own && !DOCS_RE.test(rel)) for (const f of facts) if (f.dir === 'consumes' && st.ops.size < OPS_MAX) st.ops.add(f.key);
  if (!doc) return { facts: onePerKey(facts) };
  // An SDL file waits for finish(): it may be a client's copy of its server's schema. At most the member's fact cap in
  // all (extract keeps no more): a crafted schema of 100 000 root fields per file is never held for every file.
  const sdl = onePerKey(facts.filter((f) => f.dir === 'provides')).slice(0, Math.max(0, LIMITS.MAX_FACTS_PER_MEMBER - (st.sdlFacts ?? 0)));
  if (sdl.length) { st.sdl.push({ file: rel, facts: sdl }); st.sdlFacts = (st.sdlFacts ?? 0) + sdl.length; }
  return { facts: onePerKey(facts.filter((f) => f.dir === 'consumes')) };
}

/** The SDL files, once every file was read: a schema whose root fields the member's own (non-test) operations
 *  select is a client's copy of its server's schema — no provides, one unresolved item — unless the member shows
 *  server evidence or the file sits in a JVM server's schema folder. Every other schema provides. */
function finish(ctx) {
  const st = ctx && typeof ctx.state === 'object' && ctx.state ? ctx.state : {};
  if (!st.sdl?.length) return undefined;
  const server = st.server === true
    || (Array.isArray(ctx.files) && ctx.files.some((f) => typeof f === 'string' && SERVER_FILE_RE.test(f) && !isTestPath(f)));
  const facts = [];
  const unresolved = [];
  for (const { file, facts: provides } of st.sdl) {
    if (!server && !JVM_SERVER_SDL_RE.test(file) && provides.some((f) => st.ops.has(f.key))) unresolved.push({ kind: 'graphql', raw: file, file, line: 1, reason: 'client copy of a GraphQL schema' });
    else for (const f of provides) facts.push(f); // never a spread: 100 000 arguments overflow the stack
  }
  return { facts: onePerKey(facts), unresolved: cleanUnresolved(st, null, unresolved) };
}

export default Object.freeze({
  id: 'api-graphql',
  claims: (rel) => DOC_EXT_RE.test(rel) || CODE_EXT_RE.test(rel) || SERVER_CODE_EXT_RE.test(rel),
  detect,
  finish,
});
