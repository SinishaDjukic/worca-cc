// http-routes: HTTP routes a member SERVES → provides http '<METHOD> <path>'.
// Four mechanisms, each driven by a table so a new framework is one row:
//   CALLS        route-registration calls whose first argument is the path literal
//                (Express/Fastify/Koa/Hono, gin/echo/fiber/chi, net/http, ASP.NET minimal APIs,
//                Laravel, aiohttp, Ktor, Python decorators FastAPI/Flask/Quart/Sanic, Django)
//   ANNOTATIONS  class prefix + method annotation (Spring, JAX-RS, Micronaut, NestJS, ASP.NET)
//   RESOURCES    Rails config/routes.rb (`resources` = the 7 REST actions) and Laravel
//                Route::resource / apiResource
//   FILES        Next.js pages/api/** and app/**/route.(js|ts)
// Prefixes: group variables (gin/echo/fiber Group, ASP.NET MapGroup, FastAPI APIRouter(prefix),
// Flask Blueprint(url_prefix)), brace scopes (chi r.Route, Ktor route) and class annotations.
// Mount prefixes set in OTHER files (app.use('/api', r), include_router, include()) are not
// followed: consumers still match by path suffix.
// A route whose path is not a literal → unresolved (reason 'non-literal route path').
import { splitLines, fact, lineIndex } from './lib/text.mjs';
import { isSource, isMinified, langOf, stripComments, argAt, stringsIn, braceScopes, scopeSweeper, joinPath, firstPerKey, fileUnresolved, isRouteCall, isServerFile, clientInstances, routerInstances } from './lib/code.mjs';
import { annotationModel, annPaths } from './lib/annotations.mjs';

const VERB = { get: 'GET', post: 'POST', put: 'PUT', patch: 'PATCH', delete: 'DELETE', del: 'DELETE', options: 'OPTIONS', head: 'HEAD', all: '*', any: '*' };
const verb = (v) => VERB[String(v).toLowerCase()] ?? null;
// Express-style calls are classified by lib/code isRouteCall (shared with http-clients, so one call
// is never both a route and a client call). Client receivers never serve Go routes either.
const CLIENT_OBJ = /^(http|https|axios|client|httpClient|request|superagent|got|ky|fetch|session|requests|httpx|resty|restTemplate|webClient)$/i;
// Go rows: a handler follows the path — func(…), an identifier, or a call.
const HANDLER_AFTER = /^\s*,\s*(?:async\b|function\b|\(|\[|[A-Za-z_$][\w$.]*\s*[,)]|[A-Za-z_$][\w$.]*\s*\()/;

// CALLS table — [id, langs, regex, verbGroup|null, receiverGroup|null, needsHandler]
// The path argument starts right after the match (the regex ends with the opening paren).
const CALLS = [
  // a TS type argument list may nest twice and span lines (Fastify's docs: `server.get<{\n  Querystring: Q\n}>('/auth', …)`,
  // `app.get<{ Reply: Array<User> }>`); it never holds a paren, so it cannot run past the call
  ['express', ['js'], /\b([A-Za-z_$][\w$]{0,40})\.(get|post|put|patch|delete|del|options|head|all)(?:\s*<(?:[^<>()]|<(?:[^<>()]|<[^<>()]{0,60}>){0,100}>){0,200}>)?\s*\(/g, 2, 1, true],
  ['go-router', ['go'], /\b([A-Za-z_]\w{0,40})(?:\.With\((?:[^()\n]|\([^()\n]{0,100}\)){0,200}\))?\.(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD|Any|Get|Post|Put|Patch|Delete|Options|Head|All)\s*\(/g, 2, 1, true],
  ['net-http', ['go'], /\b([A-Za-z_]\w{0,40})\.(?:HandleFunc|Handle)\s*\(/g, null, 1, true],
  ['aspnet-minimal', ['cs'], /\b([A-Za-z_]\w{0,40})\.Map(Get|Post|Put|Patch|Delete)\s*\(/g, 2, 1, false],
  ['laravel', ['php'], /\bRoute::(get|post|put|patch|delete|options|any)\s*\(/g, 1, null, false],
  ['aiohttp', ['py'], /(?<![@\w.])(?:web|router|app\.router)\.(?:add_)?(get|post|put|patch|delete|head|options)\s*\(/g, 1, null, false],
  ['py-decorator', ['py'], /@([A-Za-z_]\w{0,40})\.(get|post|put|patch|delete|head|options|route|api_route|websocket)\s*\(/g, 2, 1, false],
  ['ktor', ['kotlin'], /(?<![\w.])(get|post|put|patch|delete|head|options)\s*\((?=\s*")/g, 1, null, false],
  ['django', ['py'], /(?<![\w.])(?:path|re_path|url)\s*\(/g, null, null, false],
];
// Group variables: [regex, varGroup, parentGroup|null, argsGroup, prefix(args) → string]. argsGroup null: the regex
// ends at the call's '(' and the arguments are read with callRest (balanced, ≤ 600 chars), so any nesting
// (`dependencies=[Depends(RateLimiter(times=2))]`, `template_folder=os.path.join(a, "t")`) keeps the prefix.
const GROUPS = [
  [/\b([A-Za-z_]\w{0,40})\s*:?=\s*([A-Za-z_]\w{0,40})\.(?:Group|MapGroup)\(\s*"([^"\n]{0,200})"/g, 1, 2, 3, (a) => a],
  [/\b([A-Za-z_]\w{0,40})(?:\s*:\s*[\w.]{1,60})?\s*=\s*(?:(?:fastapi|routing)\.){0,2}APIRouter\(/g, 1, null, null, (a) => stringsIn(/(?:^|[\s(,])prefix\s*=\s*(['"][^'"]*['"])/.exec(a)?.[1])[0] ?? ''],
  [/\b([A-Za-z_]\w{0,40})(?:\s*:\s*[\w.]{1,60})?\s*=\s*(?:flask\.)?Blueprint\(/g, 1, null, null, (a) => stringsIn(/url_prefix\s*=\s*(['"][^'"]*['"])/.exec(a)?.[1])[0] ?? ''],
  // gorilla/mux: s := r.PathPrefix("/products").Subrouter()
  [/\b([A-Za-z_]\w{0,40})\s*:?=\s*([A-Za-z_]\w{0,40})\.PathPrefix\(\s*"([^"\n]{0,200})"\s*\)\s*\.Subrouter\(\)/g, 1, 2, 3, (a) => a],
  // @koa/router: const router = new Router({ prefix: '/users' }) — the README's "Router prefixes"
  [/\b([A-Za-z_$][\w$]{0,40})(?:\s*:\s*[\w.]{1,60})?\s*=\s*new\s+(?:Router|KoaRouter)(?:<[^<>()\n]{0,200}>)?\s*\(/g, 1, null, null, (a) => /(?:^|[\s{,])prefix\s*:\s*(['"`])(\/[^'"`$\n]{0,200})\1/.exec(a)?.[2] ?? ''],
];
const GROUP_TOKENS = [['.Group(', '.MapGroup('], ['APIRouter('], ['Blueprint('], ['.PathPrefix('], ['new Router', 'new KoaRouter']]; // per GROUPS row
// Brace-scoped prefixes: [langs, regex whose group 1 is the path; the scope is the next '{']
const SCOPES = [
  [['go'], /\b[A-Za-z_]\w{0,40}\.Route\s*\(\s*"([^"\n]{0,200})"\s*,\s*func/g],
  [['kotlin'], /(?<![\w.])route\s*\(\s*"([^"\n]{0,200})"\s*\)\s*\{/g],
];
// ANNOTATIONS: method annotations → verb (null = from `method =` / `[AcceptVerbs]`), prefixes, client markers.
const METHOD_ANN = {
  GetMapping: 'GET', PostMapping: 'POST', PutMapping: 'PUT', PatchMapping: 'PATCH', DeleteMapping: 'DELETE', RequestMapping: null,
  Get: 'GET', Post: 'POST', Put: 'PUT', Patch: 'PATCH', Delete: 'DELETE', Options: 'OPTIONS', Head: 'HEAD', All: '*',
  GET: 'GET', POST: 'POST', PUT: 'PUT', PATCH: 'PATCH', DELETE: 'DELETE', OPTIONS: 'OPTIONS', HEAD: 'HEAD',
  HttpGet: 'GET', HttpPost: 'POST', HttpPut: 'PUT', HttpPatch: 'PATCH', HttpDelete: 'DELETE', HttpOptions: 'OPTIONS', HttpHead: 'HEAD',
};
const PREFIX_ANN = new Set(['RequestMapping', 'Controller', 'RestController', 'Path', 'Route', 'RoutePrefix']);
const PATH_ANN = new Set(['Path', 'Route']); // method-level path carriers used with a bare verb annotation
const CLIENT_ANN = new Set(['FeignClient', 'Client', 'RegisterRestClient', 'HttpExchange']);

// Express/Koa parameter patterns '/:id(\\d+)' and optional '/:id?' → '/:id'.
// Constrained / optional brace parameters (gorilla/mux and Spring `{id:[0-9]+}`, ASP.NET `{id:int}` /
// `{id?}`, Laravel `{name?}`) → `{id}` / `{name}`.
const cleanPath = (p) => p.replace(/(:\w+)\((?:[^()/]|\([^()/]*\)){0,100}\)/g, '$1').replace(/(:\w+)\?/g, '$1')
  .replace(/\{(\*{0,2}\w+)(?::[^{}/]{0,100}|\?)\}/g, '{$1}');

function add(out, st, rel, lines, line, method, path, needle, detail, confidence = 'exact') {
  out.push(fact({ kind: 'http', dir: 'provides', key: `${method} ${cleanPath(path)}`, rel, lines, line, needle, detail, confidence }));
}

function unresolvedRoute(out, rel, line, raw) {
  out.push({ kind: 'http', raw: String(raw).slice(0, 200), file: rel, line, reason: 'non-literal route path' });
}

/** The rest of the call's arguments after the path literal (to the matching ')') and the text
 *  right after the call on the same line (for chained `.Methods(…)`). Bounded to 600 chars. */
function callRest(code, from) {
  let depth = 0;
  let j = from;
  let q = null; // strings are skipped whole: `tags=["users (beta"]` holds no bracket
  for (; j < code.length && j - from < 600; j += 1) {
    const c = code[j];
    if (q) { if (c === '\\') j += 1; else if (c === q || c === '\n') q = null; continue; }
    if (c === '"' || c === "'" || c === '`') { q = c; continue; }
    if (c === '(' || c === '[' || c === '{') depth += 1;
    else if (c === ')' || c === ']' || c === '}') { if (depth === 0) break; depth -= 1; }
  }
  return { rest: code.slice(from, j), after: code.slice(j + 1, j + 201).split('\n')[0] };
}

function calls(code, lang, rel, lines, lineOf, st, facts, unresolved) {
  const groups = new Map();
  for (const [k, [re, v, parent, a, pre]] of GROUPS.entries()) {
    if (!GROUP_TOKENS[k].some((t) => code.includes(t))) continue; // each row is a full-file scan: only where its call occurs
    for (const m of code.matchAll(re)) groups.set(m[v], joinPath(parent ? groups.get(m[parent]) || '' : '', pre(a == null ? callRest(code, m.index + m[0].length).rest : m[a])));
  }
  const scopes = [];
  const braces = SCOPES.some(([langs]) => langs.includes(lang)) ? braceScopes(code, lang) : null;
  for (const [langs, re] of SCOPES) {
    if (!langs.includes(lang)) continue;
    for (const m of code.matchAll(re)) {
      const from = m.index + m[0].length - 1;
      const off = code.slice(from, from + 400).indexOf('{');
      const open = off === -1 ? -1 : from + off;
      if (open !== -1 && braces.has(open)) scopes.push({ open, close: braces.get(open), path: m[1] });
    }
  }
  // CALLS rows are scanned one regex at a time, each in ascending order: one sweeper per row.
  const ktorFile = /\brouting\b|\bRoute\./.test(code);
  const djangoFile = /\burlpatterns\b/.test(code) || /(^|\/)urls\.py$/.test(rel);
  const serverFile = lang === 'js' && isServerFile(code);
  const clients = lang === 'js' ? clientInstances(code) : null;
  const routers = lang === 'js' ? routerInstances(code) : null;
  for (const [id, langs, re, verbGroup, objGroup, needsHandler] of CALLS) {
    if (!langs.includes(lang) || (id === 'ktor' && !ktorFile) || (id === 'django' && !djangoFile)) continue;
    const sweep = scopeSweeper(scopes);
    for (const m of code.matchAll(re)) {
      const scopePath = sweep(m.index);
      const obj = objGroup ? m[objGroup] : null;
      const typed = id === 'express' && m[0].includes('<'); // `api.get<User[]>(…)`: the typed-client idiom (isRouteCall)
      if (id === 'go-router' && CLIENT_OBJ.test(obj)) continue;
      const arg = argAt(code, m.index + m[0].length, lang);
      const line = lineOf(m.index);
      if (!arg) continue;
      if (arg.kind !== 'literal') {
        if (needsHandler || id === 'laravel' || id === 'aspnet-minimal') {
          const after = code.slice(arg.start + arg.text.length, arg.start + arg.text.length + 200);
          if (!needsHandler || (id === 'express' ? isRouteCall(obj, after, serverFile, clients, typed, routers) : HANDLER_AFTER.test(after))) unresolvedRoute(unresolved, rel, line, code.slice(m.index, m.index + m[0].length + arg.text.length + 1));
        }
        continue;
      }
      let path = arg.value;
      const litEnd = arg.start + arg.value.length + 1;
      const afterLit = code.slice(litEnd, litEnd + 200);
      if (needsHandler && !(id === 'express' ? isRouteCall(obj, afterLit, serverFile, clients, typed, routers) : HANDLER_AFTER.test(afterLit))) continue;
      let methods = verbGroup ? [verb(m[verbGroup]) ?? '*'] : ['*'];
      const { rest: tail, after } = callRest(code, litEnd);
      if (id === 'net-http') {
        const pat = /^(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)\s+(\/.*)$/.exec(path);
        if (pat) { methods = [pat[1]]; path = pat[2]; } else {
          const mm = /^\s*\.Methods\(([^)]{0,200})\)/.exec(after);
          // `.Methods("GET")` and the gorilla README's `.Methods(http.MethodGet, http.MethodPut)`; else (`allowed...`) '*'
          const named = mm ? [...stringsIn(mm[1]), ...[...mm[1].matchAll(/\bhttp\.Method(\w+)/g)].map((x) => x[1])] : [];
          if (named.length) methods = named.map((x) => x.toUpperCase());
        }
      }
      if (id === 'py-decorator' && /^(route|api_route)$/.test(m[verbGroup])) {
        const mm = /methods\s*=\s*[[(]([^\])]{0,200})[\])]/.exec(tail);
        methods = mm ? stringsIn(mm[1]).map((x) => x.toUpperCase()) : [m[verbGroup] === 'route' ? 'GET' : '*'];
      }
      if (id === 'py-decorator' && m[verbGroup] === 'websocket') methods = ['GET'];
      if (id === 'django') {
        if (/\binclude\s*\(/.test(tail)) continue; // a prefix, not a route
        if (/^re_path|^url/.test(m[0].trim())) path = path.replace(/^\^/, '').replace(/\$$/, '').replace(/\(\?P<(\w+)>[^)]{0,200}\)/g, '{$1}');
      }
      // '' under a group prefix is the prefix itself (FastAPI @router.get(""), Flask bp.route(''), gin users.GET(""))
      const groupRoot = path === '' && !!obj && (groups.get(obj) || '/') !== '/';
      if (!path.startsWith('/') && !groupRoot && !['django', 'aspnet-minimal', 'laravel', 'ktor'].includes(id)) continue;
      const finalPath = joinPath(obj && groups.has(obj) ? groups.get(obj) : '', ...scopePath, path);
      for (const method of methods) add(facts, st, rel, lines, lineOf(arg.start), method, finalPath, arg.value, `${id} route`);
    }
  }
  // Ktor `route("/users") { get { … } post { … } }`: a verb block without a path serves its scope —
  // unless it sits inside another verb's handler (kotlinx.html `head { }` in `get { call.respondHtml { … } }`).
  if (lang === 'kotlin' && ktorFile && scopes.length) {
    const handlers = [];
    for (const h of code.matchAll(/(?<![\w.])(?:get|post|put|patch|delete|head|options)[ \t]{0,20}(?:\((?:[^()]|\([^()]{0,200}\)){0,400}\)\s{0,20})?\{/g)) {
      const open = h.index + h[0].length - 1;
      if (braces.has(open)) handlers.push({ open, close: braces.get(open), path: null });
    }
    const sweep = scopeSweeper([...scopes, ...handlers]);
    for (const m of code.matchAll(/(?<![\w.])(get|post|put|patch|delete|head|options)\s*\{/g)) {
      const chain = sweep(m.index);
      if (chain.length && chain[chain.length - 1] !== null) add(facts, st, rel, lines, lineOf(m.index), verb(m[1]), joinPath(...chain), m[1], 'ktor route');
    }
  }
  // Express router.route('/x').get(h).post(h) and Fastify fastify.route({ method, url })
  if (lang === 'js') {
    for (const m of code.matchAll(/\.route\s*\(/g)) {
      const arg = argAt(code, m.index + m[0].length, lang);
      if (arg?.kind === 'literal' && arg.value.startsWith('/')) {
        const end = arg.start + arg.value.length + 1;
        const chain = code.slice(end, end + 400).split(/;|\n(?!\s*\.)/)[0];
        const methods = [...chain.matchAll(/\)\s*\.(get|post|put|patch|delete|all)\s*\(/g)].map((x) => verb(x[1]));
        for (const method of methods.length ? methods : ['*']) add(facts, st, rel, lines, lineOf(arg.start), method, arg.value, arg.value, 'express route chain');
        continue;
      }
      const obj = code.slice(m.index + m[0].length, m.index + m[0].length + 600);
      if (!/^\s*\{/.test(obj)) continue;
      const url = /\burl\s*:\s*(['"`])(\/[^'"`\n]{0,300})\1/.exec(obj);
      if (!url) continue;
      const mm = /\bmethod\s*:\s*(\[[^\]]{0,200}\]|['"][A-Za-z]+['"])/.exec(obj);
      const methods = mm ? stringsIn(mm[1]).map((x) => x.toUpperCase()) : ['*'];
      const at = m.index + m[0].length + url.index + url[0].indexOf(url[2]);
      for (const method of methods) add(facts, st, rel, lines, lineOf(at), method, url[2], url[2], 'fastify route');
    }
  }
}

function annotations(code, lang, rel, lines, lineOf, st, facts, unresolved) {
  if (!/@(Get|Post|Put|Patch|Delete|Request)Mapping|@(GET|POST|PUT|PATCH|DELETE)\b|@(Get|Post|Put|Patch|Delete|Options|Head|All)\s*\(|\[Http(Get|Post|Put|Patch|Delete)|\[Route\(|@Path\(/.test(code)) return;
  const model = annotationModel(code, lang);
  for (const b of model.blocks) {
    if (b.classDecl) continue;
    const cls = model.classOf(b.start);
    const clsAnns = cls?.anns || [];
    if (clsAnns.some((a) => CLIENT_ANN.has(a.name))) continue; // declarative client: http-clients owns it
    const verbAnns = b.anns.filter((a) => a.name in METHOD_ANN);
    if (!verbAnns.length) continue;
    // Spring's @Controller("x") / @RestController("x") names a bean; only a value starting with '/'
    // (Micronaut's @Controller("/x")) is a path prefix on the JVM. NestJS @Controller('users') is a path.
    const beanName = (a) => (lang === 'java' || lang === 'kotlin') && /^(?:Rest)?Controller$/.test(a.name)
      && !(annPaths(a.args) || []).some((p) => p.startsWith('/'));
    const prefixAnn = clsAnns.find((a) => PREFIX_ANN.has(a.name) && a.args != null && !beanName(a));
    let prefixes = prefixAnn ? annPaths(prefixAnn.args) : [''];
    // A constant class prefix (@RequestMapping(ApiPaths.USERS), [Route(Routes.Users)]) → every route unresolved,
    // never the bare method path.
    if (prefixes == null) { unresolvedRoute(unresolved, rel, lineOf(prefixAnn.start), code.slice(prefixAnn.start, prefixAnn.end)); continue; }
    let tokens = (p) => p;
    if (lang === 'cs' && cls) {
      // [ApiVersion("1.0")] fills `v{version:apiVersion}`; without one the segment is a plain parameter.
      const vers = clsAnns.filter((a) => a.name === 'ApiVersion').map((a) => /^\s*"(\d+)/.exec(a.args || '')?.[1]).filter(Boolean);
      // [action] = the action name: [ActionName("x")], else the method name without the `Async` suffix
      // ASP.NET Core (≥ 3.0) trims by default. Tokens are replaced in class AND method templates.
      const named = b.anns.find((a) => a.name === 'ActionName');
      const action = ((named && ((annPaths(named.args) || [])[0] || /^\s*nameof\(\s*(?:[\w.]*\.)?(\w+)\s*\)/.exec(named.args || '')?.[1])) || (/([A-Za-z_]\w*)\s*(?:<[^>\n]{0,100}>)?\s*\(/.exec(code.slice(b.end, b.end + 300))?.[1] || '').replace(/Async$/, '')).toLowerCase();
      tokens = (p) => p.replace(/\[controller\]/gi, cls.name.replace(/Controller$/, '').toLowerCase()).replace(/\[action\]/gi, action);
      prefixes = prefixes.flatMap((p) => {
        const q = tokens(p);
        if (!/\{\w+:apiVersion\}/i.test(q)) return [q];
        return vers.length ? vers.map((v) => q.replace(/\{\w+:apiVersion\}/i, v)) : [q.replace(/[A-Za-z]*\{(\w+):apiVersion\}/i, '{$1}')];
      });
    }
    const pathAnn = b.anns.find((a) => PATH_ANN.has(a.name));
    for (const va of verbAnns) {
      let methods = [METHOD_ANN[va.name]];
      if (va.name === 'RequestMapping') {
        const ms = [...String(va.args ?? '').matchAll(/RequestMethod\.(\w+)/g)].map((x) => x[1]);
        methods = ms.length ? ms : ['*'];
      }
      const isBareVerb = /^[A-Z]+$/.test(va.name); // JAX-RS @GET: path from @Path in the block
      if (isBareVerb && va.args != null && /["']/.test(va.args)) continue; // Retrofit-style @GET("x") = a client
      // ASP.NET [HttpGet] (no template) + a method-level [Route("{id}")]: the template is the Route's.
      const vOwn = isBareVerb ? null : annPaths(va.args);
      const fromPathAnn = isBareVerb || (lang === 'cs' && !!pathAnn && vOwn?.length === 1 && vOwn[0] === '');
      const own = fromPathAnn ? (pathAnn ? annPaths(pathAnn.args) : ['']) : vOwn;
      const carrier = fromPathAnn ? pathAnn || va : va;
      if (own == null) { unresolvedRoute(unresolved, rel, lineOf(carrier.start), code.slice(carrier.start, carrier.end)); continue; }
      const lits = own.length ? own : [''];
      for (const pre of prefixes) {
        for (const p of lits) {
          const path = p.startsWith('~/') ? joinPath(tokens(p).slice(1)) : joinPath(pre, tokens(p));
          const needle = p || (prefixAnn && pre) || va.name;
          const at = p ? code.slice(0, carrier.end).indexOf(p, carrier.start) : carrier.start;
          const line = lineOf(at >= 0 && at < carrier.end ? at : carrier.start);
          for (const method of methods) add(facts, st, rel, lines, line, method.toUpperCase(), path, needle, `${va.name} (${lang})`);
        }
      }
    }
  }
}

// RESOURCES — Rails and Laravel REST resource expansions (documented route sets).
const RAILS_ACTIONS = [['index', 'GET', ''], ['new', 'GET', '/new'], ['create', 'POST', ''], ['show', 'GET', '/:id'], ['edit', 'GET', '/:id/edit'], ['update', 'PATCH', '/:id'], ['update', 'PUT', '/:id'], ['destroy', 'DELETE', '/:id']];
const RAILS_SINGULAR = [['new', 'GET', '/new'], ['create', 'POST', ''], ['show', 'GET', ''], ['edit', 'GET', '/edit'], ['update', 'PATCH', ''], ['update', 'PUT', ''], ['destroy', 'DELETE', '']];
const LARAVEL_ACTIONS = [['index', 'GET', ''], ['create', 'GET', '/create'], ['store', 'POST', ''], ['show', 'GET', '/{id}'], ['edit', 'GET', '/{id}/edit'], ['update', 'PUT', '/{id}'], ['update', 'PATCH', '/{id}'], ['destroy', 'DELETE', '/{id}']];
const symbols = (s) => [...String(s ?? '').matchAll(/:(\w+)|['"](\w+)['"]/g)].map((m) => m[1] ?? m[2]);

function railsRoutes(text, rel, lines, facts) {
  const stack = [];
  let overflow = 0; // blocks opened beyond RAILS_MAX_DEPTH: skipped, counted so 'end' stays balanced
  const prefix = () => joinPath(...stack.map((s) => s.path));
  lines.forEach((raw, i) => {
    // `only: %i[index show]` (RuboCop's default symbol-array style) → `only: [:index, :show]`
    const line = raw.replace(/#.*$/, '').replace(/%[iIwW][[(]([^\])]{0,300})[\])]/g, (_, w) => `[${w.split(/\s+/).filter(Boolean).map((x) => `:${x}`).join(', ')}]`);
    const opensBlock = /\bdo(?:\s*\|[^|]*\|)?\s*$/.test(line);
    if (overflow || (opensBlock && stack.length >= 16)) {
      if (opensBlock) overflow += 1; else if (/^\s*end\b/.test(line)) overflow -= 1;
      return;
    }
    const res = /^\s*(resources?)\s+:(\w+)(.*)$/.exec(line);
    const ns = /^\s*namespace\s+:(\w+)/.exec(line);
    const scope = /^\s*scope\s+(?:path:\s*)?['"]([^'"]+)['"]/.exec(line) || (/^\s*scope\s/.test(line) ? /\bpath:\s*['"]([^'"]+)['"]/.exec(line) : null);
    const verbLine = /^\s*(get|post|put|patch|delete|match)\s+(?:['"]([^'"]+)['"]|:(\w+))(.*)$/.exec(line);
    const root = /^\s*root\b/.exec(line);
    const top = stack[stack.length - 1];
    if (res) {
      const plural = res[1] === 'resources';
      const base = joinPath(prefix(), res[2]);
      const only = /only:\s*\[([^\]]{0,500})\]|only:\s*(:\w+)/.exec(res[3]); // bounded: a line of `only: [` runs stays linear
      const except = /except:\s*\[([^\]]{0,500})\]|except:\s*(:\w+)/.exec(res[3]);
      const keep = (a) => (only ? symbols(only[1] ?? only[2]).includes(a) : true) && !(except && symbols(except[1] ?? except[2]).includes(a));
      for (const [action, method, suffix] of plural ? RAILS_ACTIONS : RAILS_SINGULAR) {
        if (keep(action)) facts.push(fact({ kind: 'http', dir: 'provides', key: `${method} ${base}${suffix}`, rel, lines, line: i + 1, needle: `:${res[2]}`, detail: `rails ${res[1]} #${action}`, confidence: 'exact' }));
      }
      if (opensBlock) stack.push({ path: plural ? `${res[2]}/:${res[2].replace(/s$/, '')}_id` : res[2], member: `${res[2]}/:id`, collection: res[2], kind: 'resources' });
      return;
    }
    if (/^\s*member\s+do\b/.test(line) && top?.kind === 'resources') { stack.push({ path: '', swap: top, kind: 'member' }); top.path = top.member; return; }
    if (/^\s*collection\s+do\b/.test(line) && top?.kind === 'resources') { stack.push({ path: '', swap: top, kind: 'collection' }); top.saved = top.path; top.path = top.collection; return; }
    if (ns) { if (opensBlock) stack.push({ path: ns[1], kind: 'namespace' }); return; }
    if (scope) { if (opensBlock) stack.push({ path: scope[1], kind: 'scope' }); return; }
    if (verbLine) {
      const p = verbLine[2] ?? verbLine[3];
      const via = /via:\s*(\[[^\]]{0,500}\]|:\w+)/.exec(verbLine[4] || '');
      const methods = verbLine[1] === 'match' ? (via ? symbols(via[1]).map((x) => x.toUpperCase()) : ['*']) : [verbLine[1].toUpperCase()];
      for (const method of methods) facts.push(fact({ kind: 'http', dir: 'provides', key: `${method} ${joinPath(prefix(), p)}`, rel, lines, line: i + 1, needle: p, detail: 'rails route', confidence: 'exact' }));
      if (opensBlock) stack.push({ path: '', kind: 'other' });
      return;
    }
    if (root) { facts.push(fact({ kind: 'http', dir: 'provides', key: `GET ${prefix()}`, rel, lines, line: i + 1, needle: 'root', detail: 'rails root', confidence: 'exact' })); return; }
    if (opensBlock) { stack.push({ path: '', kind: 'other' }); return; }
    if (/^\s*end\b/.test(line) && stack.length) {
      const popped = stack.pop();
      if (popped.kind === 'member') popped.swap.path = `${popped.swap.collection}/:${popped.swap.collection.replace(/s$/, '')}_id`;
      if (popped.kind === 'collection') popped.swap.path = popped.swap.saved;
    }
  });
}

function laravelResources(code, rel, lines, lineOf, facts) {
  for (const m of code.matchAll(/\bRoute::(resource|apiResource)\s*\(\s*(['"])([^'"\n]{1,200})\2([^;]{0,400})/g)) {
    const base = joinPath(m[3]);
    const only = /->only\(\s*\[([^\]]*)\]/.exec(m[4]);
    const except = /->except\(\s*\[([^\]]*)\]/.exec(m[4]);
    for (const [action, method, suffix] of LARAVEL_ACTIONS) {
      if (m[1] === 'apiResource' && (action === 'create' || action === 'edit')) continue;
      if (only && !stringsIn(only[1]).includes(action)) continue;
      if (except && stringsIn(except[1]).includes(action)) continue;
      facts.push(fact({ kind: 'http', dir: 'provides', key: `${method} ${base}${suffix}`, rel, lines, line: lineOf(m.index), needle: m[3], detail: `laravel ${m[1]} ${action}`, confidence: 'exact' }));
    }
  }
}

// FILES — Next.js: pages/api/** (method from the handler, not statically known → '*') and
// app/**/route.(js|ts) (one fact per exported GET/POST/… function). Route groups '(x)' and
// parallel slots '@x' are not URL segments; [id] and [...slug] are parameters, and an optional
// catch-all [[...slug]] is read as [...slug]. Only a file named exactly route.(js|ts|mjs) is a handler.
const NEXT_PAGES = /^(?:src\/)?pages\/(api\/.*)\.(?:js|jsx|ts|tsx|mjs)$/;
const NEXT_APP = /^(?:src\/)?app\/((?:[^/]+\/)*)route\.(?:js|ts|mjs)$/;
function nextRoutes(rel, text, lines, lineOf, facts) {
  const seg = (p) => p.split('/').filter((s) => s && !/^\(.*\)$/.test(s) && !s.startsWith('@'))
    .map((s) => s.replace(/^\[\[(\.\.\.[^\]]+)\]\]$/, '[$1]')).join('/');
  const pages = NEXT_PAGES.exec(rel);
  if (pages) {
    const path = joinPath(seg(pages[1].replace(/(^|\/)index$/, '')));
    const def = /export\s+default\b/.exec(text);
    if (def) facts.push(fact({ kind: 'http', dir: 'provides', key: `* ${path}`, rel, lines, line: lineOf(def.index), needle: 'export default', detail: 'next pages/api', confidence: 'exact' }));
    return;
  }
  const app = NEXT_APP.exec(rel);
  if (!app) return;
  const path = joinPath(seg(app[1]));
  for (const m of text.matchAll(/export\s+(?:async\s+)?(?:function\s+|const\s+)(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/g)) {
    facts.push(fact({ kind: 'http', dir: 'provides', key: `${m[1]} ${path}`, rel, lines, line: lineOf(m.index), needle: m[1], detail: 'next app route', confidence: 'exact' }));
  }
}

function detect({ rel, text }, ctx) {
  const st = ctx.state;
  const rails = /(^|\/)config\/routes\.rb$/.test(rel);
  const lang = langOf(rel);
  if (!rails && (!lang || isMinified(rel, text))) return undefined;
  const lines = splitLines(text);
  const lineOf = lineIndex(text);
  const facts = [];
  const unresolved = [];
  if (rails) { railsRoutes(text, rel, lines, facts); return { facts: firstPerKey(facts) }; }
  if (lang === 'js' && (NEXT_PAGES.test(rel) || NEXT_APP.test(rel))) nextRoutes(rel, text, lines, lineOf, facts);
  const code = stripComments(text, lang);
  calls(code, lang, rel, lines, lineOf, st, facts, unresolved);
  if (lang === 'php') laravelResources(code, rel, lines, lineOf, facts);
  if (['java', 'kotlin', 'js', 'cs'].includes(lang)) annotations(code, lang, rel, lines, lineOf, st, facts, unresolved);
  return { facts: firstPerKey(facts), unresolved: fileUnresolved(st, rel, unresolved) };
}

export default Object.freeze({
  id: 'http-routes',
  claims: (rel) => isSource(rel) || /(^|\/)config\/routes\.rb$/.test(rel),
  detect,
});
