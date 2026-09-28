// http-clients: outbound HTTP calls → consumes http '<METHOD> <path>' with target = the host
// (literal URL), the base-URL binding (axios.create baseURL, httpx base_url, Faraday url,
// WebClient/Retrofit baseUrl, .NET BaseAddress) or the env/config key the base comes from
// (process.env.X, os.environ["X"], os.Getenv("X"), @Value("${x}"), config["X"] …).
// Two mechanisms, each a table:
//   CALLS        call sites whose URL argument is analysed by lib/code urlOf (literal URL,
//                literal path, `${BASE}/p`, f"{BASE}/p", BASE + "/p", Sprintf("%s/p", BASE))
//   ANNOTATIONS  declarative clients: Feign (@FeignClient + Spring mappings / @RequestLine),
//                Spring HTTP interfaces (@HttpExchange/@GetExchange…), MicroProfile
//                (@RegisterRestClient + JAX-RS), Micronaut (@Client + @Get…), Retrofit
//                (@GET("…") in an interface), Refit ([Get("…")] in a C# interface)
// A URL that is fully dynamic (a bare variable, a call) → unresolved (reason 'dynamic url'),
// capped at 50 per member.
import { splitLines, fact, lineIndex } from './lib/text.mjs';
import { isSource, isMinified, langOf, stripComments, literals, argAt, urlOf, baseBindings, authOf, bindingOf, concatBase, envKeyOf, envTail, joinPath, firstPerKey, fileUnresolved, isRouteCall, isServerFile, clientInstances, routerInstances, hostShapedName } from './lib/code.mjs';
import { annotationModel, annPaths, annArg } from './lib/annotations.mjs';
import { isTestPath } from '../files.mjs';
import { normPath, cutQuery, cutCode } from '../../../shared/workspace-map/keys.mjs';
import { redactSecrets } from '../../../shared/workspace-map/redact.mjs';

const UP = (s) => String(s).toUpperCase();
const verbOf = (name) => {
  const m = /^(get|post|put|patch|delete|head|options)/i.exec(name);
  return m ? UP(m[1]) : null;
};
// Receivers that are HTTP clients (never routers). `this.http.get`, `api.get`, `billingClient.post` …
// NestJS's documented HTTP module is injected as `httpService` (`this.httpService.get(url)`).
const CLIENT_RECEIVER = /^(axios|http|https|api|client|httpClient|request|superagent|got|ky|\$http|session|requests|httpx|\w*[Cc]lient|\w*Api|\w*Http|\w*[Hh]ttpService)$/;
// A generic SDK client (redisClient.get(key), s3_client, cacheClient) is not known to speak HTTP:
// its non-literal calls are not reported as unresolved (only keyable URLs become facts).
// A route handler after the path: a closure, an invokable / controller class, 'Ctrl@action' (Lumen), 'Ctrl:action' (Slim).
// Lumen's action array (`['as' => 'profile', 'uses' => 'C@m']`, `['middleware' => 'auth', function …]`) too: no Guzzle / Symfony option has those keys.
const PHP_HANDLER = /^\s*,\s*(?:function\b|fn\s*\(|static\s+(?:function|fn)\b|\[\s*[\\\w]+::class|[\\\w]+::class|['"][\\\w]+[@:]\w+['"]|\[\s*['"](?:as|uses|middleware)['"]\s*=>)/;
const genericClient = (recv) => !!recv && /client$/i.test(recv) && !/http|api|rest/i.test(recv);

// CALLS — [id, langs, regex (ends where the URL argument starts), method: fixed string | group
// index | 'options' (from `method:` in the call) | 'chain' (from the builder chain), receiverGroup]
const CALLS = [
  ['fetch', ['js'], /(?<![\w$.])(?:(?:window|globalThis|self)\.)?(?:fetch|\$fetch|ofetch|useFetch)\s*\(/g, 'options', null],
  ['js-client-verb', ['js'], /\b([A-Za-z_$][\w$]{0,40})\.(get|post|put|patch|delete|head|options)(?:\s*<(?:[^<>()\n]|<(?:[^<>()\n]|<[^<>()\n]{0,60}>){0,100}>){0,100}>)?\s*\(/g, 2, 1],
  ['js-client-call', ['js'], /(?<![\w$.])(axios|got|ky|superagent|request)\s*\(/g, 'options', 1],
  ['py-verb', ['py'], /\b([A-Za-z_]\w{0,40})\.(get|post|put|patch|delete|head|options)\s*\(/g, 2, 1],
  ['py-request', ['py'], /\b([A-Za-z_]\w{0,40})\.request\s*\(\s*['"](\w+)['"]\s*,/g, 2, 1],
  ['resttemplate', ['java', 'kotlin'], /\b(\w*[Rr]est[Tt]emplate|\w*[Rr]estOperations)\.(getForObject|getForEntity|postForObject|postForEntity|postForLocation|put|delete|patchForObject|exchange)\s*\(/g, 2, 1],
  ['webclient', ['java', 'kotlin'], /\.(get|post|put|patch|delete)\s*\(\s*\)\s*\.uri\s*\(/g, 1, null],
  ['okhttp', ['java', 'kotlin'], /Request\.Builder\s*\(\s*\)\s*\.url\s*\(/g, 'chain', null],
  ['java-httpclient', ['java', 'kotlin'], /HttpRequest\.newBuilder\s*\(\s*\)\s*\.uri\s*\(\s*URI\.create\s*\(/g, 'chain', null],
  ['ktor-client', ['kotlin'], /\b(client|httpClient|\w+Client)\.(get|post|put|patch|delete)\s*\((?=\s*["\w])/g, 2, 1],
  ['go-http', ['go'], /\bhttp\.(Get|Post|Head|PostForm)\s*\(/g, 1, null],
  ['go-client', ['go'], /\b(\w*[Cc]lient)\.(Get|Post|Head)\s*\(/g, 2, 1],
  ['go-newrequest', ['go'], /\bhttp\.NewRequest(?:WithContext)?\s*\(\s*(?:[A-Za-z_]\w*\s*,\s*)?(?:"(\w+)"|http\.Method(\w+))\s*,/g, 'go-method', null],
  ['go-resty', ['go'], /\.R\(\)(?:\.\w{1,40}\([^()\n]{0,200}\)){0,8}\.(Get|Post|Put|Patch|Delete)\s*\(/g, 1, null],
  ['dotnet', ['cs'], /\b([A-Za-z_]\w{0,40})\.(Get|Post|Put|Patch|Delete)(?:Async|StringAsync|StreamAsync|ByteArrayAsync|FromJsonAsync(?:<(?:[^<>\n]|<(?:[^<>\n]|<[^<>\n]{0,60}>){0,100}>){0,100}>)?|AsJsonAsync(?:<(?:[^<>\n]|<(?:[^<>\n]|<[^<>\n]{0,60}>){0,100}>){0,100}>)?)\s*\(/g, 2, 1],
  ['dotnet-request', ['cs'], /new\s+HttpRequestMessage\s*\(\s*HttpMethod\.(\w+)\s*,/g, 1, null],
  ['ruby', ['rb'], /\b(HTTParty|RestClient|Faraday|conn|connection|client|http)\.(get|post|put|patch|delete)(?:\s*\(\s*|\s+)(?=['"])/g, 2, 1],
  ['php', ['php'], /(?:->|\bHttp::)(get|post|put|patch|delete)(?:Async)?\s*\((?=\s*['"])/g, 1, null],
  ['php-request', ['php'], /->request\s*\(\s*['"](\w+)['"]\s*,/g, 1, null],
];
// every .NET BaseAddress assignment (15486564's file-base scan): one no receiver row reads is still the file's base
const DOTNET_BASE_ADDRESS = /\bBaseAddress\s*=\s*new\s+Uri\s*\([ \t]*([^)\s][^)\n]{0,199})\)/g;
const DOTNET_MEMBER_BASE = /\b([A-Za-z_]\w{0,40})\s*\.\s*BaseAddress\s*=\s*new\s+Uri\s*\([ \t]*([^)\s][^)\n]{0,199})\)/g;
// Receiver base URLs defined in the same file: [regex, receiverGroup, argGroup]. argGroup null: the regex ends at
// the call's '(' and the `base_url` keyword is read from the balanced argument list (any position, any line —
// black splits it; `transport=httpx.AsyncHTTPTransport(retries=3)` before it). receiverGroup null: the receiver
// is the `as NAME` after the call, and the base holds only inside that `with` block.
const RECEIVER_BASES = [
  [/(?<!\bcase[ \t]{1,4}(?:[\w$]{1,60}\.){0,4})\b(?!default\b)([A-Za-z_$][\w$]{0,40})(?:[ \t]{0,4}:[ \t]{0,4}[\w$.[\]|]{1,80})?\s*=\s*axios\.create\s*\(\s*\{[^}]{0,400}?\bbaseURL\s*:\s*((?:\$\{[^}\n]{0,120}\}|[^,}\n]){1,200})/g, 1, 2],
  [/\b([A-Za-z_]\w{0,40})(?:[ \t]{0,4}:[ \t]{0,4}[\w.[\]|]{1,80})?\s*=\s*httpx\.(?:Async)?Client\s*\(/g, 1, null],
  // the httpx docs' own form: `with httpx.Client(base_url=…) as client:` / `async with httpx.AsyncClient(…) as client:`
  [/\bwith\s+httpx\.(?:Async)?Client\s*\(/g, null, null],
  [/\b([A-Za-z_]\w{0,40})\s*=\s*Faraday\.new\s*\(\s*(?:url:\s*)?([^,)\n]{1,200})/g, 1, 2],
  // .NET: a BaseAddress belongs to the HttpClient it is set on — `_http.BaseAddress = new Uri(…)`, or an initializer
  // `_billing = new HttpClient(h) { …, BaseAddress = new Uri(…) }` (a field, a local, `Client { get; } = new() { … }`)
  [DOTNET_MEMBER_BASE, 1, 2],
  [/\b([A-Za-z_]\w{0,40})(?:\s{0,8}\{[^{}\n]{0,60}\})?\s{0,8}=\s{0,8}new\b(?:[ \t]{1,8}[\w.<>?]{1,60})?[ \t]{0,8}(?:\((?:[^()\n]|\([^()\n]{0,100}\)){0,200}\))?\s{0,40}\{[^{}]{0,400}?\bBaseAddress\s{0,8}=\s{0,8}new\s{1,8}Uri\s{0,8}\([ \t]*([^)\s][^)\n]{0,199})\)/g, 1, 2],
];
/** A keyword argument's value in an argument list, to its depth-0 comma (≤ 300 chars): `base_url=os.getenv("X", "d") + "/api"`. */
function kwValue(args, key) {
  const m = new RegExp(String.raw`(?:^|[\s(,])${key}\s*=(?!=)\s*`).exec(args);
  if (!m) return null;
  const from = m.index + m[0].length;
  let depth = 0;
  let q = null;
  let j = from;
  for (; j < args.length && j - from < 300; j += 1) {
    const c = args[j];
    if (q) { if (c === '\\') j += 1; else if (c === q) q = null; continue; }
    if (c === '"' || c === "'") { q = c; continue; }
    if (c === '(' || c === '[' || c === '{') depth += 1;
    else if (c === ')' || c === ']' || c === '}') { if (!depth) break; depth -= 1; } else if (c === ',' && !depth) break;
  }
  return args.slice(from, j).trim() || null;
}
/** Where each Python `with` block ends: the first non-blank line after the one holding its `as NAME:` that is
 *  indented no deeper than the `with` line itself (black puts the closing `) as client:` at that depth).
 *  `entries`: ascending [{ at: offset of `with`, from: offset of `as` }] → Map at → end. One pass over the lines. */
function blockEnds(code, entries) {
  const ends = new Map();
  const stack = [];
  const pending = [];
  // multi-line strings (a `"""…"""` SQL block at column 0): a line starting inside one is no statement
  const spans = literals(code, 'py').filter((l) => code.slice(l.start, l.end).includes('\n')); // O(literal) each
  let sp = 0;
  let k = 0;
  for (let ls = 0; ls <= code.length;) {
    const nl = code.indexOf('\n', ls);
    const le = nl === -1 ? code.length : nl;
    let i = ls;
    // a CRLF checkout's blank line is a lone '\r': blank, never a line at indent 0 that ends every block
    while (i < le && (code[i] === ' ' || code[i] === '\t' || code[i] === '\r')) i += 1;
    while (sp < spans.length && spans[sp].end < ls) sp += 1;
    const inString = sp < spans.length && spans[sp].start < ls && ls <= spans[sp].end;
    if (i < le && !inString) while (stack.length && stack[stack.length - 1].indent >= i - ls) ends.set(stack.pop().at, ls);
    for (; k < entries.length && entries[k].at < le; k += 1) pending.push({ ...entries[k], indent: i - ls });
    while (pending.length && pending[0].from < le) stack.push(pending.shift());
    if (nl === -1) break;
    ls = nl + 1;
  }
  for (const x of [...stack, ...pending]) ends.set(x.at, code.length);
  return ends;
}
// Default bases: [kind, regex]. 'webclient' bases apply to the WebClient / RestClient calls of the same file (never
// RestTemplate's) when the file defines exactly one — every definition counts, resolved or not; 'retrofit' / 'refit'
// bases apply member-wide to those interfaces when the member declares exactly one. (.NET BaseAddress: RECEIVER_BASES.)
const FILE_BASES = [
  ['retrofit', /Retrofit\.Builder\s*\(\s*\)(?:\s*\.\w{1,40}\([^()\n]{0,200}\)){0,6}\s*\.baseUrl\s*\([ \t]*([^)\s][^)\n]{0,199})\)/g],
  ['webclient', /\.baseUrl\s*\([ \t]*([^)\s][^)\n]{0,199})\)/g], ['webclient', /WebClient\.create\s*\([ \t]*([^)\s][^)\n]{0,199})\)/g],
  ['refit', /RestService\.For<[^>\n]{1,100}>\s*\([ \t]*([^)\s][^)\n]{0,199})\)/g],
];
const CLIENT_CLASS_ANN = new Set(['FeignClient', 'HttpExchange', 'RegisterRestClient', 'Client']);
const CLIENT_METHOD_ANN = {
  GetMapping: 'GET', PostMapping: 'POST', PutMapping: 'PUT', PatchMapping: 'PATCH', DeleteMapping: 'DELETE', RequestMapping: null,
  GetExchange: 'GET', PostExchange: 'POST', PutExchange: 'PUT', PatchExchange: 'PATCH', DeleteExchange: 'DELETE', HttpExchange: null,
  GET: 'GET', POST: 'POST', PUT: 'PUT', PATCH: 'PATCH', DELETE: 'DELETE', HEAD: 'HEAD', OPTIONS: 'OPTIONS',
  Get: 'GET', Post: 'POST', Put: 'PUT', Patch: 'PATCH', Delete: 'DELETE', Head: 'HEAD', Options: 'OPTIONS',
  RequestLine: 'line', HTTP: 'http',
};

/** A base expression (literal URL, env read, identifier) → { target, confidence, prefix? } | null.
 *  A literal base URL's path ('http://gw:8000/api') becomes the prefix of relative calls. */
function baseOf(expr, bindings) {
  const e = String(expr).trim();
  const lit0 = /^[fr$@]?["'`](https?:\/\/[^"'`/\s]+)([^"'`\s?#]*)/.exec(e);
  const lit = lit0 && !/[{$%]/.test(lit0[1].slice(lit0[1].indexOf('//') + 2)) ? lit0 : null;
  // M2: the authority ends where authorityEnd says — a password may hold '?' or '#' (`http://svc:pa?ss@billing`) —, so a
  // query right after the host (`'http://reports:8080?hmac=…'`) is neither the target nor a path prefix
  if (lit) { const { host, query } = authOf(lit[1]); return { target: host, confidence: 'exact', prefix: query ? '' : lit[2].replace(/\/+$/, '') }; }
  const conf = /^"\\?\$\{([^}:"]+)/.exec(e); // "${x}" (Kotlin writes "\${x}")
  if (conf) return { target: hostShapedName(conf[1]) ? null : conf[1], confidence: 'heuristic' };
  const cat = concatBase(e, bindings); // baseURL: process.env.X + '/api'
  if (cat?.ambiguous) return null;
  if (cat) return cat;
  const u = urlOf({ kind: 'literal', value: e.replace(/^[fr$@]?["'`]|["'`]$/g, ''), template: true }, bindings);
  // `${process.env.API_URL}/api/v1`; `${window.location.origin}/api` (an origin: no target, the path kept)
  if (u?.target || u?.absolute) return { target: u.target || null, confidence: 'heuristic', prefix: (u.path || '').replace(/\/+$/, '') };
  const b = bindingOf(bindings, e);
  if (b) return b;
  // a relative base (axios `baseURL: '/api/v1'`, the SPA dev-proxy idiom) prefixes every call; the host is the page's
  const rel = /^["'`](\/[^"'`\s?#$]*)["'`]$/.exec(e);
  if (rel) return { target: null, confidence: 'exact', prefix: rel[1].replace(/\/+$/, '') };
  const env = envKeyOf(e);
  const prefix = envTail(e); // `http://${process.env.HOST}:3000/api`
  if (env) return { target: hostShapedName(env) ? null : env, confidence: 'heuristic', ...(prefix ? { prefix } : {}) };
  // `http://${host}:${port}/api/v1` with no env read: the path is known, the host is not (P4-2)
  return lit0 ? { target: null, confidence: 'heuristic', prefix: lit0[2].replace(/\/+$/, '') } : null;
}

/** A receiver base no rule above resolves whose expression is a plain name (`baseURL: environment.apiUrl`,
 *  `base_url=settings.billing_url`, an imported `ORDERS_URL`): named by that expression, like
 *  `environment.apiUrl + '/api'` (concatBase), so the receiver is known and its calls are read. Never a name
 *  bound to two bases in the file, never `undefined` / `null` / `None`; a name P1 reads as a public host
 *  (`window.location.origin`, `config.api`) gives the receiver no target. */
function namedBase(expr, bindings) {
  const e = String(expr).trim();
  if (!/^[A-Za-z_$][\w$.]{0,120}$/.test(e) || /^(?:undefined|null|None)$/.test(e)) return null;
  const clash = e.includes('.') ? bindings.membersAmbiguous ?? bindings.ambiguous : bindings.ambiguous;
  return clash?.has(e.includes('.') ? e.split('.').pop() : e) ? null : { target: hostShapedName(e) ? null : e, confidence: 'heuristic' };
}

/** The base of a client whose base expression reads a name bound to two bases in the file (a parameter elsewhere shadows
 *  it: `createServerApi = (baseURL) => …` beside `axios.create({ baseURL: baseURL })`): unknown, never none — the
 *  client's relative calls are dynamic urls, never bare paths that join whichever member serves the unprefixed route. */
const AMBIGUOUS_BASE = Object.freeze({ ambiguous: true });
function ambiguousBase(expr, bindings) {
  const e = String(expr).trim();
  if (concatBase(e, bindings)?.ambiguous) return AMBIGUOUS_BASE;
  // the name itself, or the one placeholder a template base opens with (`${baseUrl}/v2`, f"{BASE_URL}/v2")
  const name = /^[A-Za-z_$][\w$.]{0,120}$/.test(e) ? e : /^[fr$@]?["'`]\$?\{\s*([A-Za-z_$][\w$.]{0,120})\s*\}/.exec(e)?.[1];
  if (!name) return null;
  const clash = name.includes('.') ? bindings.membersAmbiguous ?? bindings.ambiguous : bindings.ambiguous;
  return clash?.has(name.includes('.') ? name.split('.').pop() : name) ? AMBIGUOUS_BASE : null;
}

function emit(st, out, { rel, lines, line, method, path, target, confidence, needle, code, detail }) {
  const full = path.startsWith('/') ? path : `/${path}`;
  // The key and whatever is cited — the URL, the key's path, or the line `evidence` falls back to — stop before the
  // query (a parameter of any name may carry a credential; the norm drops it anyway) and before a '#' fragment.
  const p = cutQuery(full);
  // A code expression (`cfg?.api + '/x'`) is cut inside its string pieces only: its '?.' / '? :' / '??' stay cited.
  // …unless its quotes misread (a regex literal `/'/g`) left a query the key had: then cut as URL text
  const piece = code ? cutCode(needle) : null;
  const n = piece !== null && (piece !== needle || p === full) ? piece : cutQuery(needle);
  const f = fact({ kind: 'http', dir: 'consumes', key: `${method} ${p}`, rel, lines, line, needle: n, alt: p, detail, target: target || undefined, confidence });
  if (f.match !== n && f.match !== p) f.match = cutQuery(redactSecrets(f.match));
  out.push(f);
}
/** '/${id}', '/${resource}/${id}', or '/' under a base variable (which holds the resource path): no literal
 *  segment, so no route — unless a literal host names the provider. */
const keyable = (path, target, confidence) => (normPath(path) || '/').split('/').some((s) => s && s !== '{}') || (!!target && confidence === 'exact');
function dynamic(out, rel, line, raw) {
  // The call's text stops before a query string (`?name=`, `&name=`): its value may be a credential. A ternary's '?'
  // stays. Redacted first: a URL password may hold `?x=` / `&x=`, and a cut inside it hides the '@' redaction needs —
  // the 200-character cut too. A text that ends inside a URL's authority (the caller's cut, or this one, fell in a long
  // password or token: no '@' was left for redaction to find) drops that authority.
  const cut = redactSecrets(String(raw)).slice(0, 200);
  const open = /:\/\/[^\s/'"`]*$/.exec(cut);
  const text = open ? cut.slice(0, open.index + 3) : cut;
  const q = text.search(/[?&](?=[A-Za-z_$][\w.$[\]-]{0,63}=)/);
  out.push({ kind: 'http', raw: q > 0 ? text.slice(0, q) : text, file: rel, line, reason: 'dynamic url' });
}

/** The call's remaining args text (to the matching ')') and the chained text after it (≤ 400). */
function callSpan(code, from) {
  let depth = 0;
  let j = from;
  for (; j < code.length && j - from < 600; j += 1) {
    const c = code[j];
    if (c === '(' || c === '[' || c === '{') depth += 1;
    else if (c === ')' || c === ']' || c === '}') { if (depth === 0) break; depth -= 1; }
  }
  return { args: code.slice(from, j), after: code.slice(j + 1, j + 301) };
}

function calls(code, lang, rel, lines, lineOf, st, facts, unresolved) {
  let bindings = null; // same-file bases: built on first need only (most files never need them)
  const B = () => (bindings ??= baseBindings(code));
  // Receiver bases by name, each with the offset of its definition. One name often holds a different client
  // in each function (`async with httpx.AsyncClient(base_url=A) as client:` in one, `…(base_url=B) as client:`
  // in the next; `const api = axios.create(…)` per function): a call takes the nearest definition above it,
  // never the file's last one; with none above, a name bound to one base still takes it (a module-level
  // instance defined below its functions), a name bound to several takes none.
  // C# lambda parameters (`client =>`, `(sp, client) =>`): the last name before `=>` (bounded runs: linear)
  let lambdaSet = null;
  const lambdaParams = () => (lambdaSet ??= new Set([...code.matchAll(/\b([A-Za-z_]\w{0,40})[ \t]{0,8}\)?[ \t]{0,8}=>/g)].map((x) => x[1])));
  const lambdaBases = new Map();
  const claimed = new Set(); // end offsets of the .NET BaseAddress assignments a receiver row read
  const receivers = new Map();
  const scoped = []; // `with … as name:` entries, ended in one pass below
  for (const [re, rg, ag] of RECEIVER_BASES) {
    for (const m of code.matchAll(re)) {
      let name = rg ? m[rg] : null;
      let expr = ag ? m[ag] : null;
      let from = 0;
      if (!ag) {
        const { args, after } = callSpan(code, m.index + m[0].length);
        expr = kwValue(args, 'base_url');
        if (!rg) { const as = /^\s*as\s+([A-Za-z_]\w{0,40})/.exec(after); name = as?.[1] ?? null; from = m.index + m[0].length + args.length + 1; }
      }
      if (ag && /\bBaseAddress\b/.test(m[0])) claimed.add(m.index + m[0].length);
      // a .NET BaseAddress read from an options object (`new Uri(_options.BaseUrl)`) is no base, as at 15486564
      const b = name && expr ? baseOf(expr, B()) ?? (ag && /\bBaseAddress\b/.test(m[0]) ? null : namedBase(expr, B())) ?? ambiguousBase(expr, B()) : null;
      if (!b) continue;
      // `AddHttpClient("basket", client => client.BaseAddress = …)` configures a factory client: collected apart (below)
      if (re === DOTNET_MEMBER_BASE && lambdaParams().has(name)) { if (!lambdaBases.has(name)) lambdaBases.set(name, []); lambdaBases.get(name).push(b); continue; }
      if (!receivers.has(name)) receivers.set(name, { open: [], scoped: [] });
      if (rg) receivers.get(name).open.push({ at: m.index, b }); else scoped.push({ name, at: m.index, from, b });
    }
  }
  if (scoped.length) {
    scoped.sort((x, y) => x.at - y.at);
    const ends = blockEnds(code, scoped);
    for (const x of scoped) receivers.get(x.name).scoped.push({ at: x.at, end: ends.get(x.at) ?? code.length, b: x.b });
  }
  const sameBase = (x, y) => x.target === y.target && x.confidence === y.confidence && (x.prefix || '') === (y.prefix || '');
  // .NET: one name is often a local of several methods (`using var http = new HttpClient { BaseAddress = … }` in one,
  // `var http = factory.CreateClient("users")` or an `HttpClient http` parameter in the next): every declaration of a
  // receiver name counts, and one with no base of its own ends the one above it (one scan of the file)
  if (lang === 'cs' && receivers.size) {
    const defAt = new Set([...receivers.values()].flatMap((r) => r.open.map((d) => d.at)));
    const declAt = new Set();
    // `;` too: a field with no initializer (`private readonly HttpClient _httpClient;`) — two typed clients in one file
    // share that name, and one's BaseAddress must not serve the other's calls
    for (const m of code.matchAll(/\b(?:var|HttpClient\??)[ \t]{1,8}([A-Za-z_]\w{0,40})[ \t]{0,8}(?:=(?!=)|[,);])/g)) {
      const r = receivers.get(m[1]);
      const at = m.index + m[0].lastIndexOf(m[1]);
      declAt.add(at);
      // a field (a modifier before the type: `static HttpClient _http = new HttpClient();`, or a declaration with no
      // initializer, `HttpClient _http;`: C# fields are private by default) is no method local
      if (r && !defAt.has(at)) r.open.push({ at, b: null, field: m[0].endsWith(';') || /\b(?:private|protected|public|internal|static|readonly)[ \t]{1,8}$/.test(code.slice(Math.max(0, m.index - 20), m.index)) });
    }
    // …a field is the object the assignment right below it configures (`_http.BaseAddress = …`, `_http = new HttpClient
    // { BaseAddress = … }` — no declaration), wherever that sits: the MS docs sample sets it in RunAsync, below its callers
    for (const r of receivers.values()) {
      r.open.sort((x, y) => x.at - y.at);
      r.open.forEach((d, i) => { const n = r.open[i + 1]; if (d.field && n?.b && !declAt.has(n.at)) d.b = n.b; });
    }
    // …and a name no declaration in the file reads (a base class's `Http` property or field, set in each of several
    // subclasses: `Http.BaseAddress = …`) is one object per class: only the file's one base for that name serves it,
    // never the nearest one above (another class's)
    for (const r of receivers.values()) r.undeclared = !r.open.some((d) => declAt.has(d.at));
  }
  for (const r of receivers.values()) {
    r.open.sort((x, y) => x.at - y.at);
    r.scoped.sort((x, y) => x.at - y.at);
    r.one = r.open.length && r.open.every((d) => d.b && sameBase(d.b, r.open[0].b)) ? r.open[0].b : null;
  }
  // last entry of a sorted list starting before pos (binary search: linear in calls × log(definitions))
  const lastBefore = (list, pos) => {
    let lo = 0; let hi = list.length - 1; let hit = -1;
    while (lo <= hi) { const mid = (lo + hi) >> 1; if (list[mid].at < pos) { hit = mid; lo = mid + 1; } else hi = mid - 1; }
    return hit;
  };
  const recvBase = (recv, pos) => {
    const r = recv ? receivers.get(recv) : null;
    if (!r) return null;
    // inside a `with … as recv:` block: its base (the innermost of ≤ 32 enclosing blocks)
    for (let k = lastBefore(r.scoped, pos), n = 0; k >= 0 && n < 32; k -= 1, n += 1) if (r.scoped[k].end > pos) return r.scoped[k].b;
    if (r.one) return r.one;
    if (r.undeclared) return null;
    const k = lastBefore(r.open, pos);
    return k === -1 ? null : r.open[k].b;
  };
  // every definition counts, resolved or not: an unresolvable base (`props.getUsersUrl()`) never un-shadows a sibling
  const fileBases = { webclient: [], dotnet: [] };
  for (const [kind, re] of FILE_BASES) {
    for (const m of code.matchAll(re)) {
      const b = baseOf(m[1], B());
      if (fileBases[kind]) fileBases[kind].push(b);
      else if (!isTestPath(rel) && !/(?:^|\/)src\/(?:\w{1,40}T|t)est\w{0,40}\//.test(rel)) (st.memberBases ??= []).push({ ...(b ?? { target: null, confidence: 'heuristic' }), kind }); // a test's MockWebServer base serves no interface
    }
  }
  // .NET: a BaseAddress set on an injected HttpClient parameter (`public Svc(HttpClient http) { http.BaseAddress = … }`)
  // is the class's own client, whatever field keeps it: the base of every call whose receiver has none of its own
  if (lang === 'cs') {
    const injected = new Set([...code.matchAll(/\bHttpClient\??[ \t]{1,8}([A-Za-z_]\w{0,40})[ \t]{0,8}[,)]/g)].map((x) => x[1]));
    for (const m of injected.size ? code.matchAll(DOTNET_MEMBER_BASE) : []) if (injected.has(m[1])) fileBases.dotnet.push(baseOf(m[2], B()));
    // …and the lambda bases, when every registration of the file agrees (`AddHttpClient("catalog", c => c.BaseAddress = …)`
    // beside `var client = f.CreateClient("catalog")`: the file's one base, as at 15486564); two different ones serve nobody
    const lambda = [...lambdaBases.values()].flat();
    if (lambda.length && lambda.every((x) => sameBase(x, lambda[0]))) fileBases.dotnet.push(lambda[0]);
    // …and every BaseAddress no receiver row read (a multi-line handler, nested braces, an anonymous initializer)
    for (const m of code.matchAll(DOTNET_BASE_ADDRESS)) if (!claimed.has(m.index + m[0].length)) fileBases.dotnet.push(baseOf(m[1], B()));
    // …and a file that holds ONE HttpClient (the MS docs sample: `using HttpClient sharedClient = new() { BaseAddress = … }`
    // handed to `static async Task GetAsync(HttpClient httpClient)` helpers): its base serves every call with no base of
    // its own, as at 15486564. A second source (another creation, `CreateClient(`, an injected field, property or
    // non-static parameter) leaves each base to its own receiver. Look-backs are bounded (300 chars): linear.
    const staticParam = (i) => { const h = code.slice(Math.max(0, i - 300), i); const p = h.lastIndexOf('('); return p !== -1 && /\bstatic\b[^;{}()=]*$/.test(h.slice(0, p).split('\n').pop()); };
    // a field declared with no initializer and created by a plain assignment (`_http = new HttpClient()`, `_http =
    // factory.CreateClient()`) is one client: its declaration is no second source (a `var` / typed local is another object)
    const created = new Set([...code.matchAll(/(?<!\b(?:var|HttpClient\??)[ \t]{1,8})\b([A-Za-z_]\w{0,40})[ \t]{0,8}=[ \t]{0,8}(?:new[ \t]+HttpClient\b|new[ \t]{0,8}\(|[\w.]{1,80}\.CreateClient[ \t]*\()/g)].map((x) => x[1]));
    let sources = 0;
    for (const m of code.matchAll(/\bnew[ \t]+HttpClient\b|\bCreateClient[ \t]*\(|<HttpClient>|\bHttpClient\??[ \t]{1,8}([A-Za-z_]\w{0,40})[ \t]{0,8}(?:(;)|\{|=[ \t]{0,8}new[ \t]{0,8}[({]|([,)]))/g)) if (!(m[3] && staticParam(m.index)) && !(m[2] && created.has(m[1])) && (sources += 1) > 1) break;
    const own = sources === 1 ? [...receivers.values()].flatMap((r) => r.open.filter((d) => d.b).map((d) => d.b)) : [];
    if (own.length && own.every((x) => sameBase(x, own[0]))) fileBases.dotnet.push(own[0]);
  }
  // one base defined twice (an injected parameter that is also a lambda's) is still one base; decided once per kind
  const oneFileBase = Object.fromEntries(Object.entries(fileBases).map(([k, l]) => [k, l.length && l[0] && l.every((x) => x && sameBase(x, l[0])) ? l[0] : null]));
  const fileBaseFor = (id) => oneFileBase[id] ?? null;
  const serverFile = lang === 'js' && isServerFile(code);
  const clients = lang === 'js' ? clientInstances(code) : null;
  const routers = lang === 'js' ? routerInstances(code) : null;
  for (const [id, langs, re, methodSpec, recvGroup] of CALLS) {
    if (!langs.includes(lang)) continue;
    for (const m of code.matchAll(re)) {
      const recv = recvGroup ? m[recvGroup] : null;
      if ((id === 'js-client-verb' || id === 'py-verb') && !(CLIENT_RECEIVER.test(recv) || receivers.has(recv))) continue;
      if (id === 'dotnet' && !/client|http/i.test(recv)) continue;
      let start = m.index + m[0].length;
      const kw = /^\s*url\s*[=:]\s*/.exec(code.slice(start, start + 40)); // requests.get(url=f"…"), ky({ url: … }) is the object form
      if (kw && lang !== 'js') start += kw[0].length;
      const arg = argAt(code, start, lang);
      if (!arg) continue;
      const { args, after } = callSpan(code, start);
      if (id === 'py-verb' && code[m.index - 1] === '@') continue; // @api.get("/users/{id}"): a FastAPI route
      if (id === 'php' && arg.kind === 'literal' && PHP_HANDLER.test(code.slice(arg.start + arg.value.length + 1, arg.start + arg.value.length + 200))) continue; // Slim / Lumen route
      if (id === 'js-client-verb' && isRouteCall(recv, code.slice(arg.kind === 'literal' ? arg.start + arg.value.length + 1 : arg.start + arg.text.length, arg.start + 400), serverFile, clients, m[0].includes('<'), routers)) continue; // http-routes owns it
      let method = 'GET';
      if (typeof methodSpec === 'number') method = verbOf(m[methodSpec]) || UP(m[methodSpec]);
      else if (methodSpec === 'options') method = UP(/\bmethod\s*:\s*['"`](\w+)['"`]/.exec(args)?.[1] || 'GET');
      else if (methodSpec === 'chain') method = UP(/\.(post|put|patch|delete|head|POST|PUT|PATCH|DELETE|HEAD)\s*\(/.exec(after.split(/;|\.build\(\)/)[0])?.[1] || 'GET');
      else if (methodSpec === 'go-method') method = UP(m[1] || m[2] || 'GET');
      if (id === 'resttemplate') {
        const name = m[2];
        method = name === 'exchange' ? UP(/HttpMethod\.(\w+)/.exec(args)?.[1] || '*') : name.startsWith('get') ? 'GET' : name.startsWith('post') ? 'POST' : name.startsWith('patch') ? 'PATCH' : UP(name);
      }
      if (id === 'go-http' && m[1] === 'PostForm') method = 'POST';
      // axios({ url, method }) / request({ url }) object form
      if (arg.kind === 'expr' && /^\{/.test(arg.text)) {
        const obj = code.slice(arg.start, arg.start + 600);
        const u = /\burl\s*:\s*(['"`])([^'"`\n]{1,300})\1/.exec(obj);
        if (!u) continue;
        const mm = /\bmethod\s*:\s*['"`](\w+)['"`]/.exec(obj);
        const url = urlOf({ kind: 'literal', value: u[2], template: u[1] === '`' }, B(), lang);
        if (url && !url.dynamic) emit(st, facts, { rel, lines, line: lineOf(arg.start + u.index), method: UP(mm?.[1] || 'GET'), path: url.path, target: url.target, confidence: url.confidence, needle: u[2], detail: id });
        continue;
      }
      // .NET relative URI: only on an HttpClient-shaped receiver (`_httpClient`, `Http`, `_apiClient`) — never `_clientRepository`, `_clientStore`
      const relNet = lang === 'cs' && arg.kind === 'literal' && (!recv || /(?:http|client|api)$/i.test(recv)) && !genericClient(recv) && /^\w[\w~.-]*(?:[/?]\S*)?$/.test(arg.value);
      const url = urlOf(relNet ? { ...arg, value: `/${arg.value}` } : arg, arg.kind === 'literal' && !arg.template ? undefined : B(), lang);
      const line = lineOf(arg.start);
      if (!url) {
        const b = arg.kind === 'literal' && !/^https?:/.test(arg.value) ? recvBase(recv, m.index) : null;
        if (b?.ambiguous) dynamic(unresolved, rel, line, code.slice(m.index, Math.min(code.length, arg.start + 120)).split('\n')[0]);
        else if (b) {
          emit(st, facts, { rel, lines, line, method, path: joinPath(b.prefix || '', arg.value), target: b.target, confidence: b.confidence, needle: arg.value, detail: `${id} via ${recv}` });
        }
        continue;
      }
      if (url.dynamic) {
        // A bare `got(x)` / `request(x)` may be any local helper, and a generic SDK client any
        // protocol: only an HTTP-looking call with an unknown URL is reported.
        if (id !== 'js-client-call' && !genericClient(recv)) dynamic(unresolved, rel, line, code.slice(m.index, Math.min(code.length, arg.start + 120)).split('\n')[0]);
        continue;
      }
      let { target, confidence } = url;
      let path = url.path;
      // an absolute URL — built from an origin (`${window.location.origin}/x`) or with a templated host
      // (`http://${host}:8080/x`) — is never under a receiver or file base; a file base serves its own client kind only
      const base = url.absolute || url.tplHost ? null : !target && recvBase(recv, m.index) ? recvBase(recv, m.index)
        : !target && fileBaseFor(id) ? fileBaseFor(id) : null;
      // a client whose base is a parameter-shadowed name: unknown, so a dynamic url
      if (base?.ambiguous) { dynamic(unresolved, rel, line, code.slice(m.index, Math.min(code.length, arg.start + 120)).split('\n')[0]); continue; }
      if (base) { ({ target, confidence } = base); path = joinPath(base.prefix || '', path); }
      if (!keyable(path, target, confidence)) {
        // a root call without a base ('/', '/?page=2', `/?q=${q}`) has nothing to resolve: skipped, never 'dynamic url'
        if (!(!target && !base && normPath(path) === '/')) dynamic(unresolved, rel, line, code.slice(m.index, Math.min(code.length, arg.start + 120)).split('\n')[0]);
        continue;
      }
      emit(st, facts, { rel, lines, line, method, path, target, confidence, needle: arg.kind === 'literal' ? arg.value : url.needle, code: arg.kind !== 'literal', detail: id });
    }
  }
}

function annotations(code, lang, rel, lines, lineOf, st, facts) {
  if (!/@(FeignClient|HttpExchange|RegisterRestClient|Client|GET|POST|PUT|PATCH|DELETE|HTTP|RequestLine)\b|\[(Get|Post|Put|Patch|Delete)\s*\(/.test(code)) return;
  const model = annotationModel(code, lang);
  const ifaces = new Set([...code.matchAll(/\binterface\s+([A-Za-z_]\w{0,100})/g)].map((x) => x[1]));
  for (const b of model.blocks) {
    if (b.classDecl) continue;
    const cls = model.classOf(b.start);
    const clsAnns = cls?.anns || [];
    const marker = clsAnns.find((a) => CLIENT_CLASS_ANN.has(a.name));
    const inInterface = !!cls && ifaces.has(cls.name);
    for (const a of b.anns) {
      if (!(a.name in CLIENT_METHOD_ANN)) continue;
      const retrofit = /^[A-Z]+$/.test(a.name) && a.args != null && /["']/.test(a.args); // @GET("x")
      const refit = lang === 'cs' && /^(Get|Post|Put|Patch|Delete)$/.test(a.name) && inInterface;
      if (!marker && !retrofit && !refit && !(a.name === 'RequestLine' || a.name === 'HTTP')) continue;
      let method = CLIENT_METHOD_ANN[a.name];
      let paths;
      if (method === 'line') {
        const l = /^\s*"(\w+)\s+([^"\s]+)/.exec(a.args || '');
        if (!l) continue;
        method = l[1]; paths = [l[2]];
      } else if (method === 'http') {
        method = UP(annArg(a.args, 'method') || '*'); paths = [annArg(a.args, 'path') || ''];
      } else {
        if (method === null) method = UP(/RequestMethod\.(\w+)/.exec(a.args || '')?.[1] || annArg(a.args, 'method') || '*');
        const pathAnn = /^[A-Z]+$/.test(a.name) && !retrofit ? b.anns.find((x) => x.name === 'Path') : null;
        paths = pathAnn ? annPaths(pathAnn.args) : annPaths(a.args, ['value', 'path', 'url', 'uri', 'uris']);
      }
      if (!paths) continue;
      const prefixAnn = clsAnns.find((x) => x.name === 'RequestMapping' || x.name === 'Path' || x.name === 'HttpExchange');
      let prefix = (marker && annArg(marker.args, 'path')) || (prefixAnn && (annPaths(prefixAnn.args) || [''])[0]) || '';
      let target = null;
      let confidence = 'exact';
      if (marker) {
        const name = annArg(marker.args, 'name') || annArg(marker.args, 'value') || annArg(marker.args, 'configKey') || annArg(marker.args, 'id')
          || (marker.name === 'Client' || marker.name === 'FeignClient' ? (annPaths(marker.args) || [])[0] || null : null); // @FeignClient("stores")
        // Micronaut's relative `@Client("/pets")` calls the current server: a path prefix, never a service id
        const relative = marker.name === 'Client' && !!name && name.startsWith('/');
        if (relative) prefix = name;
        // `url = "${inventory.url}"` names a config key: heuristic, like every config-key target (P4-2);
        // Micronaut's positional `@Client("https://…")` / `@Client("${x.url}")` is a URL, not a service id
        const url = annArg(marker.args, 'url') || (name && /^(?:https?:\/\/|\\?\$\{)/.test(name) ? name : null);
        const fromUrl = url ? baseOf(`"${url}"`, new Map()) : null;
        const svc = url === name || relative ? null : name; // a positional URL is no service id
        target = fromUrl?.target || svc || null;
        confidence = fromUrl?.confidence || 'exact';
      }
      for (const p of paths) {
        const path = joinPath(prefix, p);
        // the path literal sits in its carrier (@Path when it came from there): search from that start
        const carrier = (/^[A-Z]+$/.test(a.name) && !retrofit && b.anns.find((x) => x.name === 'Path')) || a;
        const at = p ? code.slice(0, carrier.end).indexOf(p, carrier.start) : a.start;
        const line = lineOf(at >= 0 && at < carrier.end ? at : a.start);
        const f = { rel, lines, line, method: UP(method), path, target, confidence, needle: p || a.name, detail: `${marker ? marker.name : retrofit ? 'Retrofit' : refit ? 'Refit' : a.name} client` };
        if (!marker && (retrofit || refit)) (st.pendingBase ??= []).push({ ...f, baseKind: retrofit ? 'retrofit' : 'refit' }); else if (keyable(path, target, confidence)) emit(st, facts, f);
      }
    }
  }
}

function detect({ rel, text }, ctx) {
  const lang = langOf(rel);
  if (!lang || isMinified(rel, text)) return undefined;
  const st = ctx.state;
  const lines = splitLines(text);
  const lineOf = lineIndex(text);
  const code = stripComments(text, lang);
  const facts = [];
  const unresolved = [];
  calls(code, lang, rel, lines, lineOf, st, facts, unresolved);
  if (['java', 'kotlin', 'cs'].includes(lang)) annotations(code, lang, rel, lines, lineOf, st, facts);
  return { facts: firstPerKey(facts), unresolved: fileUnresolved(st, rel, unresolved) };
}

// Retrofit / Refit interfaces get their base from a builder elsewhere in the member: used when the
// member declares exactly one distinct base of that kind (bases with no target are told apart by their path;
// an unresolvable one — `.baseUrl(config.getBillingUrl())` — counts, so it never leaves a sibling "the" base).
function finish(ctx) {
  const st = ctx.state;
  const facts = [];
  for (const f of st.pendingBase || []) {
    const bases = [...new Map((st.memberBases || []).filter((b) => b.kind === f.baseKind).map((b) => [b.target ?? `|${b.prefix || ''}`, b])).values()];
    const b = bases.length === 1 ? bases[0] : null;
    const path = joinPath(b?.prefix || '', f.path);
    const target = b?.target || null;
    const confidence = b ? b.confidence : 'heuristic';
    if (keyable(path, target, confidence)) emit(st, facts, { ...f, path, target, confidence });
  }
  return { facts };
}

export default Object.freeze({ id: 'http-clients', claims: isSource, detect, finish });
