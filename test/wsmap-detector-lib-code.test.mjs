import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { langOf, stripComments, literals, readLiteral, argAt, stringsIn, envKeyOf, baseBindings, urlOf, braceScopes, scopeSweeper, joinPath, isRouteCall, isServerFile, clientInstances, routerInstances, isMinified, firstPerKey, fileUnresolved, bindingOf, envTail, concatBase, hostShapedName, INTERNAL_HOST_SUFFIXES } from '../src/core/workspace-map/detectors/lib/code.mjs';
import { annotationModel, annPaths, annArg } from '../src/core/workspace-map/detectors/lib/annotations.mjs';

test('code: language by extension; comments blanked per language with strings kept', () => {
  assert.deepEqual(['a.ts', 'b.PY', 'c.kt', 'd.go', 'e.cs', 'f.rb', 'g.txt'].map(langOf), ['js', 'py', 'kotlin', 'go', 'cs', 'rb', null]);
  const js = "fetch('http://x/y') // fetch('/no')\n/* app.get('/no') */ a";
  const out = stripComments(js, 'js');
  assert.ok(out.includes("'http://x/y'") && !out.includes('/no') && out.length === js.length);
  assert.ok(!stripComments("x = 1  # requests.get('/no')\n", 'py').includes('/no'));
});

test('code: literals — JS template, Python f/triple/raw, C# verbatim, Go raw; offsets point at the content', () => {
  const js = "a('x'); b(`multi\nline ${y}`); c(\"q\\\"q\")";
  assert.deepEqual(literals(js, 'js').map((l) => l.value), ['x', 'multi\nline ${y}', 'q\\"q']);
  const py = 'q = """SELECT *\nFROM t"""\nu = f"{BASE}/a"\n';
  const lits = literals(py, 'py');
  assert.deepEqual(lits.map((l) => [l.value, l.prefix]), [['SELECT *\nFROM t', ''], ['{BASE}/a', 'f']]);
  assert.equal(py.slice(lits[0].start, lits[0].start + 6), 'SELECT');
  assert.deepEqual(literals('var p = @"C:\\x\\y";', 'cs').map((l) => l.value), ['C:\\x\\y']);
  assert.deepEqual(literals('s := `raw\\n`', 'go').map((l) => l.value), ['raw\\n']);
  assert.equal(readLiteral("'unterminated\nnext'", 0, 'js'), null);
});

test('code: argAt reads a literal (with prefix) or a bounded expression', () => {
  assert.deepEqual(argAt("get( '/a', h)", 4, 'js'), { kind: 'literal', value: '/a', start: 6, template: false });
  assert.equal(argAt('get(f"{B}/x")', 4, 'py').template, true);
  assert.deepEqual(argAt('get(base + "/x", h)', 4, 'js'), { kind: 'expr', text: 'base + "/x"', start: 4 });
  assert.equal(argAt('get()', 4, 'js'), null);
  assert.deepEqual(stringsIn('{"a", \'b\', `c`}'), ['a', 'b', 'c']);
});

test('code: env keys and same-file base bindings', () => {
  assert.equal(envKeyOf('process.env.BILLING_URL'), 'BILLING_URL');
  assert.equal(envKeyOf("os.environ.get('X_URL')"), 'X_URL');
  assert.equal(envKeyOf('System.getenv("Y")'), 'Y');
  assert.equal(envKeyOf('config["Billing:Url"]'), 'Billing:Url');
  assert.equal(envKeyOf('_configuration["Billing:Url"]'), 'Billing:Url', '.NET injected IConfiguration field');
  assert.equal(envKeyOf("this.configService.get<string>('BILLING_URL')"), 'BILLING_URL', 'NestJS ConfigService');
  const b = baseBindings('const API = process.env.API_URL;\nBASE = "http://ledger:7000/v1"\n@Value("${billing.url}")\nprivate String billingUrl;\n');
  assert.deepEqual(Object.fromEntries(b), {
    API: { target: 'API_URL', confidence: 'heuristic' }, BASE: { target: 'ledger:7000', confidence: 'exact', prefix: '/v1' }, billingUrl: { target: 'billing.url', confidence: 'heuristic' },
  });
  assert.deepEqual(baseBindings('@Value("\\${ledger.url}")\nlateinit var ledgerUrl: String\n').get('ledgerUrl'), { target: 'ledger.url', confidence: 'heuristic' }, 'Kotlin escapes $ in annotations');
  assert.deepEqual(baseBindings('const API: string | undefined = process.env.API_URL;\n').get('API'), { target: 'API_URL', confidence: 'heuristic' }, 'a TypeScript union type annotation');
  assert.deepEqual(baseBindings('const usersUrl = `${environment.apiUrl}/users`;\n').get('usersUrl'), { target: 'environment.apiUrl', confidence: 'heuristic', prefix: '/users' }, 'a base derived from another base keeps its path');
  assert.equal(urlOf({ kind: 'literal', value: '${BASE}/users', template: true }, baseBindings('BASE = "http://ledger:7000/v1"\n'), 'js').path, '/v1/users', 'a literal base URL\'s path prefixes the call');
  assert.deepEqual(baseBindings('const API = `${process.env.ACCOUNTS_URL}/api/v1`;\n').get('API'), { target: 'ACCOUNTS_URL', confidence: 'heuristic', prefix: '/api/v1' }, 'an env read inside a derived base keeps its path');
  assert.equal(baseBindings('function a() { const url = `${API}/users`; }\nfunction b() { const url = `${API}/orders`; }\n').has('url'), false, 'a name bound to two different bases is ambiguous');
  assert.deepEqual(baseBindings('a() { const base = process.env.X_URL; }\nb() { const base = process.env.X_URL; }\n').get('base'), { target: 'X_URL', confidence: 'heuristic' }, 'the same base twice is one binding');
  assert.equal(urlOf({ kind: 'expr', text: "new URL('/health', API)" }, baseBindings('API = "http://gw:8000/api/v1"\n'), 'js').path, '/health', 'new URL / urljoin resolve a leading / from the host');
  assert.deepEqual(baseBindings("const API = process.env.ACCOUNTS_URL + '/api/v1';\n").get('API'), { target: 'ACCOUNTS_URL', confidence: 'heuristic', prefix: '/api/v1' }, 'a derived base written as a concatenation keeps its path');
  assert.deepEqual(baseBindings('base := os.Getenv("INVENTORY_URL") + "/api"\n').get('base'), { target: 'INVENTORY_URL', confidence: 'heuristic', prefix: '/api' });
  assert.deepEqual(baseBindings("const GW = 'http://gw:8000' + '/api/v1';\n").get('GW'), { target: 'gw:8000', confidence: 'exact', prefix: '/api/v1' });
  assert.equal(baseBindings("const url = BASE + '/users/' + id;\n").has('url'), false, 'a per-call URL (three pieces) is no base');
  assert.deepEqual(baseBindings("const API = `${process.env.X_URL ?? 'http://localhost:3000'}/api/v1`;\n").get('API'), { target: 'X_URL', confidence: 'heuristic', prefix: '/api/v1' }, 'a fallback inside the placeholder');
  assert.deepEqual(baseBindings('const API = `http://${process.env.HOST}:3000/api/v1`;\n').get('API'), { target: 'HOST', confidence: 'heuristic', prefix: '/api/v1' }, 'an env host inside a template keeps the path');
  assert.deepEqual(baseBindings("let API = 'http://localhost:3000/api';\nif (prod) API = 'https://api.acme.com/api';\n").get('API'), { target: 'API', confidence: 'heuristic', prefix: '/api' }, 'two hosts behind one path: the path is known');
  assert.deepEqual(baseBindings('if (API == process.env.OTHER_URL) x();\nconst API = "http://gw:8000/api";\n').get('API'), { target: 'gw:8000', confidence: 'exact', prefix: '/api' }, '== is no assignment');
  const twice = baseBindings('a() { const url = `${API}/users`; }\nb() { const url = `${API}/orders`; }\n');
  assert.deepEqual(urlOf({ kind: 'literal', value: '${url}/recent', template: true }, twice, 'js'), { dynamic: true, raw: '${url}/recent' }, 'a use of an ambiguous name is dynamic, never GET /recent');
});

test('code: urlOf — literal URL, literal path, template/f-string/concat/printf bases, dynamic', () => {
  const b = new Map([['API', { target: 'API_URL', confidence: 'heuristic' }]]);
  assert.deepEqual(urlOf({ kind: 'literal', value: 'http://billing:8080/api/x?y=1' }), { path: '/api/x', target: 'billing:8080', confidence: 'exact', needle: 'http://billing:8080/api/x?y=1' });
  assert.deepEqual(urlOf({ kind: 'literal', value: '/users/1#top' }), { path: '/users/1', target: null, confidence: 'exact', needle: '/users/1#top' });
  assert.equal(urlOf({ kind: 'literal', value: '${API}/users', template: true }, b).target, 'API_URL');
  assert.equal(urlOf({ kind: 'literal', value: '{os.environ["X"]}/a', template: true }).target, 'X');
  assert.equal(urlOf({ kind: 'expr', text: 'process.env.LEDGER + "/entries"' }).target, 'LEDGER');
  assert.equal(urlOf({ kind: 'expr', text: 'fmt.Sprintf("%s/stock/%d", base, id)' }).path, '/stock/%d');
  assert.deepEqual(urlOf({ kind: 'expr', text: 'url' }), { dynamic: true, raw: 'url' });
  assert.equal(urlOf({ kind: 'literal', value: 'users/1' }), null);
  assert.deepEqual(urlOf({ kind: 'literal', value: '$baseUrl/invoices/$id' }, undefined, 'kotlin'), { path: '/invoices/{id}', target: 'baseUrl', confidence: 'heuristic', needle: '$baseUrl/invoices/$id' });
  assert.equal(urlOf({ kind: 'literal', value: '/odata/$metadata' }, undefined, 'js').path, '/odata/$metadata', 'a $ in a JS path is literal text');
  assert.equal(urlOf({ kind: 'literal', value: '#{BASE}/a/#{id}' }).path, '/a/{id}');
  assert.equal(urlOf({ kind: 'literal', value: '/orders/{$id}' }, undefined, 'php').path, '/orders/{id}', 'PHP complex interpolation');
  // concatenation: literal pieces kept, every other piece → {} (a leading non-literal names the base)
  assert.deepEqual(urlOf(argAt("f('/orders/' + id)", 2, 'js')), { path: '/orders/{}', target: null, confidence: 'exact', needle: "'/orders/' + id" });
  assert.equal(urlOf({ kind: 'expr', text: "API + '/users/' + id + '/orders'" }).path, '/users/{}/orders');
  assert.deepEqual(urlOf(argAt("f('http://orders:8080/orders/' + id)", 2, 'js')), { path: '/orders/{}', target: 'orders:8080', confidence: 'exact', needle: "'http://orders:8080/orders/' + id" }, 'an absolute URL built by concatenation');
  // a templated host keeps its literal path (no target); a ${…} glued to the last segment is a query suffix
  assert.deepEqual(urlOf({ kind: 'literal', value: 'http://127.0.0.1:${PORT}/json/list', template: true }, undefined, 'js'), { path: '/json/list', target: null, confidence: 'exact', needle: 'http://127.0.0.1:${PORT}/json/list', tplHost: true });
  assert.deepEqual(urlOf({ kind: 'literal', value: 'http://${host}', template: true }), { dynamic: true, raw: 'http://${host}' });
  assert.equal(urlOf({ kind: 'literal', value: '/api/config${qs}', template: true }, undefined, 'js').path, '/api/config');
  assert.equal(urlOf({ kind: 'literal', value: '/api/users/${id}', template: true }, undefined, 'js').path, '/api/users/${id}');
});

test('code: braces with strings blanked; the scope sweeper is linear and nests', () => {
  const code = 'route("/a") { get("/{b}") { } route("/c") { x } }';
  const braces = braceScopes(code, 'kotlin');
  assert.equal(braces.size, 3, 'the "{b}" inside a string is not a brace');
  const scopes = [{ open: 12, close: code.length - 1, path: '/a' }, { open: code.indexOf('{ x'), close: code.indexOf('} }'), path: '/c' }];
  const sweep = scopeSweeper(scopes);
  assert.deepEqual(sweep(20), ['/a']);
  assert.deepEqual(sweep(code.indexOf('x }')), ['/a', '/c']);
  assert.deepEqual(sweep(code.length), []);
  const siblings = 'route("/a") { x } route("/b") { y }';
  const sweep2 = scopeSweeper([{ open: siblings.indexOf('{'), close: siblings.indexOf('}'), path: '/a' }, { open: siblings.lastIndexOf('{'), close: siblings.lastIndexOf('}'), path: '/b' }]);
  assert.deepEqual(sweep2(siblings.indexOf('y')), ['/b'], 'a closed sibling scope is not an ancestor');
  assert.equal(joinPath('/api/', '', 'users/', ':id'), '/api/users/:id');
  assert.equal(joinPath(), '/');
});

test('annotations: blocks, class declarations, class-level annotations, args', () => {
  const java = `@RestController
@RequestMapping("/api")
public class A {
  @GetMapping("/{id}") @ResponseBody
  public X get() {}
}
class B { @PostMapping void p() {} }`;
  const m = annotationModel(java, 'java');
  assert.deepEqual(m.blocks.map((b) => [b.anns.map((a) => a.name).join('+'), b.classDecl]), [['RestController+RequestMapping', 'A'], ['GetMapping+ResponseBody', null], ['PostMapping', null]]);
  assert.equal(m.classOf(java.indexOf('@GetMapping')).name, 'A');
  assert.deepEqual(m.classOf(java.indexOf('@PostMapping')).anns, []);
  const inner = '@RestController\n@RequestMapping("/api")\npublic class C {\n  record Dto(String x) {}\n  static class Page {}\n  @GetMapping("/x") void x() {}\n}\n';
  assert.equal(annotationModel(inner, 'java').classOf(inner.indexOf('@GetMapping')).name, 'C', 'an inner record / class that closed is not the enclosing class');
  const cs = '[Route("api/[controller]")]\npublic class PaymentsController { [HttpGet("{id}")] public X Get() {} }';
  assert.equal(annotationModel(cs, 'cs').classes[0].anns[0].name, 'Route');
  assert.deepEqual(annPaths('value = {"/a", "/b"}, method = RequestMethod.GET'), ['/a', '/b']);
  assert.deepEqual(annPaths('"/x"'), ['/x']);
  assert.deepEqual(annPaths(null), ['']);
  assert.deepEqual(annPaths('produces = "json"'), ['']);
  assert.equal(annPaths('Paths.BY_ID'), null, 'a constant path is reported by the caller');
  assert.equal(annArg('name = "billing", url = "${x}"', 'name'), 'billing');
  assert.deepEqual(annPaths('value = {"/users/{id}", "/u/{id}"}, method = RequestMethod.GET'), ['/users/{id}', '/u/{id}'], 'a brace inside an array string');
  assert.equal(annPaths('value = Paths.BY_ID'), null, 'a constant under a path key');
  assert.deepEqual(annPaths("{ version: '1' }"), [''], 'a NestJS options object without a path');
});

test('annotations: Micronaut uri / uris, C# template:, constant arrays and concatenations, RFC 6570 query expressions', () => {
  assert.deepEqual(annPaths('uri = "/{id}", produces = MediaType.TEXT_PLAIN'), ['/{id}'], "Micronaut's documented attribute");
  assert.deepEqual(annPaths('uris = {"/{id}", "/by-id/{id}"}'), ['/{id}', '/by-id/{id}']);
  assert.deepEqual(annPaths('template: "{id}"'), ['{id}'], 'a C# named argument');
  assert.equal(annPaths('{Paths.BY_ID}'), null, 'an array of constants is a non-literal path, never the bare prefix');
  assert.equal(annPaths('value = [Paths.BY_ID]'), null);
  assert.deepEqual(annPaths('{"/a", Paths.B}'), ['/a'], 'a mixed array keeps its literals');
  assert.deepEqual(annPaths('{}'), [''], 'an empty array is the class path');
  assert.equal(annPaths('{"/a/" + ID, "/b"}'), null, 'a concatenation inside an array');
  assert.equal(annPaths('"/users/" + ID'), null, 'a concatenation is a non-literal path');
  assert.equal(annPaths('value = "/users/" + ID'), null);
  assert.deepEqual(annPaths('"/list{?args*}"'), ['/list'], 'an RFC 6570 query expression is not part of the path');
  assert.deepEqual(annPaths('"{?max,offset}"'), ['']);
});

test('code: one route/client rule for both HTTP detectors; JS-family minified files; per-file fact and unresolved hygiene', () => {
  // `api` names both Express routers and axios instances: a payload argument is a client call unless the file sets up a server
  assert.equal(isRouteCall('api', ', credentials)', false), false);
  assert.equal(isRouteCall('api', ', async (req, res) => {})', false), true);
  assert.equal(isRouteCall('api', ', listUsers)', true), true);
  assert.equal(isRouteCall('app', ', { schema }, handler)', false), true, 'Fastify options object');
  assert.equal(isRouteCall('axios', ', async () => {})', true), false, 'a client receiver is never a router');
  const clients = clientInstances("const api = axios.create({ baseURL: 'http://billing:8080' });\nconst gh = ky.create({});\n");
  assert.deepEqual([...clients].sort(), ['api', 'gh']);
  assert.equal(isRouteCall('api', ', payload)', true, clients), false, 'an axios instance this file creates is not a router, even in a server file');
  assert.equal(isRouteCall('api', ', getUser)', true, clientInstances(''), true, routerInstances('const api = express.Router();\n')), true, 'a typed call on a router this file creates is a route');
  assert.deepEqual([...routerInstances('export const booksApi = Router();\nconst app = new Hono();\nexport default async function (api: FastifyInstance) {}\n')].sort(), ['api', 'app', 'booksApi']);
  assert.equal(isServerFile("import express from 'express';\n"), true);
  assert.equal(isServerFile("import axios from 'axios';\n"), false);
  // minified: only JS-family files, only a > 1 000-char line inside the first 4 KiB
  assert.equal(isMinified('web/app.js', `var a=${'x'.repeat(1200)};\n`), true);
  assert.equal(isMinified('web/app.ts', `${'// ok\n'.repeat(800)}${'x'.repeat(5000)}`), false, 'past the first 4 KiB');
  for (const rel of ['a.py', 'A.java', 'a.sql', 'a.go', 'A.cs', 'a.rb', 'a.php', 'A.kt']) assert.equal(isMinified(rel, 'x'.repeat(5000)), false, rel);
  // one fact per (dir, key) per file
  assert.deepEqual(firstPerKey([{ dir: 'consumes', key: 'k', line: 1 }, { dir: 'consumes', key: 'k', line: 2 }, { dir: 'provides', key: 'k', line: 3 }]).map((f) => f.line), [1, 3]);
  const peer = (target, line) => ({ file: 'a.js', dir: 'consumes', key: 'GET /health', target, line });
  assert.deepEqual(firstPerKey([peer('billing:8080', 1), peer('ledger:8082', 2), peer('billing', 3)]).map((f) => f.line), [1, 2], 'the target host is part of the identity; its port is not');
  // unresolved: none from test paths, one per raw text per file, ≤ 50 per detector per member
  assert.deepEqual(fileUnresolved({}, 'test/a.test.js', [{ raw: 'fetch(u)' }]), []);
  assert.equal(fileUnresolved({}, 'src/a.js', [{ raw: 'fetch(u)' }, { raw: 'fetch(u)' }]).length, 1);
  const st = {};
  assert.equal(fileUnresolved(st, 'src/a.js', Array.from({ length: 40 }, (_, i) => ({ raw: `a${i}` }))).length, 40);
  assert.equal(fileUnresolved(st, 'src/b.js', Array.from({ length: 40 }, (_, i) => ({ raw: `b${i}` }))).length, 10, 'the cap spans files');
});

test('code: v6 bindings — a concatenation names an unknown base, a templated host is no host, a literal host wins over an env read in its path, typed C# properties, @Value first, self-derived reassignments, locals never answer this.x', () => {
  assert.deepEqual(baseBindings("export class S {\n  private apiUrl = environment.apiUrl + '/api/v1';\n}\n").get('apiUrl'), { target: 'environment.apiUrl', confidence: 'heuristic', prefix: '/api/v1' }, 'the Angular idiom');
  assert.deepEqual(baseBindings("const API = `http://${process.env.HOST}:3000` + '/api/v1';\n").get('API'), { target: 'HOST', confidence: 'heuristic', prefix: '/api/v1' }, 'a placeholder host is an env base, never a literal host');
  assert.deepEqual(baseBindings('const base = `http://127.0.0.1:${port}`;\n').get('base'), { target: null, confidence: 'heuristic', prefix: '', tplHost: true }, 'a templated host with no env read has no target (P4-2)');
  assert.deepEqual(baseBindings("const API = `http://${host}:3000` + '/api/v1';\n").get('API'), { target: null, confidence: 'heuristic', prefix: '/api/v1', tplHost: true }, 'the concatenation form of a templated host keeps its path');
  assert.deepEqual(baseBindings('const API = `https://api.acme.com/${process.env.TENANT}/v1`;\n').get('API'), { target: 'api.acme.com', confidence: 'exact', prefix: '/${process.env.TENANT}/v1' }, 'an env read in the path is not the host');
  assert.deepEqual(baseBindings('private string BaseUrl => _configuration["Orders:BaseUrl"];\n').get('BaseUrl'), { target: 'Orders:BaseUrl', confidence: 'heuristic' }, 'a typed C# expression-bodied property');
  const arrow = baseBindings("const API = process.env.API_URL;\n[1].forEach(API => process.env.OTHER_URL);\n");
  assert.deepEqual([arrow.get('API'), arrow.ambiguous.has('API'), arrow.members.has('API')], [undefined, true, false], 'a JS arrow parameter is no assignment (never OTHER_URL); it shadows the const, so a bare API is ambiguous (M6)');
  assert.deepEqual([envTail('`http://${process.env.HOST}:3000/api/`'), envTail('`/api/${process.env.VERSION}/v1`')], ['/api', ''], 'the placeholder must sit in the host');
  assert.deepEqual(baseBindings('public OrdersClient(@Value("${orders.url}") String ordersUrl) { this.baseUrl = ordersUrl + "/api/v1"; }\n').get('baseUrl'), { target: 'orders.url', confidence: 'heuristic', prefix: '/api/v1' }, '@Value is read before the assignment deriving from it');
  const self = baseBindings("let API = process.env.X;\nAPI = API + '/api/v1';\n");
  assert.deepEqual([self.get('API'), self.ambiguous.has('API')], [{ target: 'X', confidence: 'heuristic', prefix: '/api/v1' }, false], 'a reassignment derived from the name itself replaces it');
  const shadow = baseBindings('export class B {\n  private baseUrl = process.env.API_URL;\n  list() { const baseUrl = `${this.baseUrl}/reports`; }\n}\n');
  assert.deepEqual(bindingOf(shadow, 'this.baseUrl'), { target: 'API_URL', confidence: 'heuristic' }, 'this.baseUrl is the field, never the local that shadows it');
  assert.equal(shadow.ambiguous.has('baseUrl'), true);
  assert.equal(urlOf({ kind: 'literal', value: '${this.baseUrl}/orders', template: true }, shadow, 'js').path, '/orders');
  assert.deepEqual([...routerInstances('function a(api: Router) {}\nfunction b(api: AxiosInstance) {}\n')], [], 'a name also typed as another class is not known to be a router');
  assert.deepEqual([...routerInstances('function r(api: Router) {}\ninterface Ctx { api: ApiClient }\n')], ['api'], 'an interface member is no parameter or declaration');
  assert.deepEqual([...routerInstances('constructor(private userApi: Application) {}\n')], [], 'a bare Application is not express.Application');
  const rel = baseBindings("const API_PREFIX = '/api/v1';\nconst USERS = API_PREFIX + '/users';\n");
  assert.deepEqual([rel.get('API_PREFIX'), rel.get('USERS')], [{ target: null, confidence: 'exact', prefix: '/api/v1' }, { target: null, confidence: 'heuristic', prefix: '/api/v1/users' }], 'a relative-path constant is a base without a host');
  assert.deepEqual(baseBindings('BASE = "http://localhost:8000" if DEBUG else os.environ["ORDERS_URL"]\n').get('BASE'), { target: 'ORDERS_URL', confidence: 'heuristic' }, 'an env read outside the literal wins');
  assert.deepEqual(baseBindings('const API = `https://api.acme.com/v1?key=${process.env.KEY}`;\n').get('API'), { target: 'api.acme.com', confidence: 'exact', prefix: '/v1' }, 'an env read in the query is inside the literal');
  assert.deepEqual(bindingOf(baseBindings('constructor() { const baseUrl = process.env.ORDERS_URL; this.baseUrl = baseUrl; }\n'), 'this.baseUrl'), { target: 'ORDERS_URL', confidence: 'heuristic' }, 'a member assigned a bound local takes its base');
  assert.deepEqual([...routerInstances("const a = new Hono<{ Bindings: Env }>();\nconst b = new KoaRouter();\nfunction c(r: express.Router) {}\nconst p: FastifyPluginAsync = async (api) => {};\n")].sort(), ['a', 'api', 'b', 'r']);
});

test('code: implementation review cycle 1 — typed and labelled client instances, router types never read from values, a base chained onto itself stays bounded', () => {
  assert.deepEqual([...clientInstances('const usersApi: AxiosInstance = axios.create({});\nconst a: any = ky.create({});\nswitch (e) { case prod: b = got.extend({}); break; default: c = axios.create({}); }\n')].sort(), ['a', 'b', 'c', 'usersApi'], 'a type annotation is no name; a case / default label is no name');
  assert.deepEqual([...routerInstances("const api = express.Router();\nres.json({ name: 'users', api: API_VERSION });\nlog({ api: Api.name });\n")], ['api'], 'an object value (a constant, a member) is no type');
  assert.deepEqual([...routerInstances('const api = express.Router();\nexport function load(api: ApiClient) {}\n')], [], 'a class-shaped type still unmakes the router');
  const chain = (n) => baseBindings(`let API = process.env.X;\n${"API = API + '/segment';\n".repeat(n)}`);
  assert.equal(chain(60).get('API').prefix.length, 480);
  assert.equal(chain(70).get('API'), undefined, 'a prefix past 500 chars is only ever built by chaining: dropped, so the chain stays linear');
  assert.ok(chain(70).ambiguous.has('API'));
});

test('code: implementation review cycle 2 — a base P1 reads as a public host names no target; a qualified switch label is no instance name', () => {
  assert.deepEqual(['config.usersUrl', 'settings.billing_url', 'environment.apiUrl', 'API', 'window.location.origin', 'location.origin', 'config.api', 'config.api_url'].map(hostShapedName),
    [false, false, false, false, true, true, true, false], 'dotted, no upper-case letter, no _, no config-key stem: what the catalog reads as a public dotted host');
  assert.deepEqual(['billing.internal', 'users.svc.cluster.local', 'orders.docker', '$config.api'].map(hostShapedName), [false, false, false, false], 'an internal-suffix name names its member; a name that is no DNS name is never public');
  const catalogSuffixes = /const INTERNAL_SUFFIXES = Object\.freeze\((\[[^\]]*\])\)/.exec(readFileSync(new URL('../src/core/workspace-map/catalog.mjs', import.meta.url), 'utf8'));
  assert.deepEqual([...INTERNAL_HOST_SUFFIXES], JSON.parse(catalogSuffixes[1].replace(/'/g, '"')), "kept equal to the catalog's INTERNAL_SUFFIXES");
  assert.deepEqual(concatBase("config.api + '/teams'", new Map()), { target: null, confidence: 'heuristic', prefix: '/teams', absolute: true }, 'the head names no host: the path is kept, no target — and it is an origin, so no receiver base prefixes it');
  assert.deepEqual(concatBase("environment.apiUrl + '/api/v1'", new Map()), { target: 'environment.apiUrl', confidence: 'heuristic', prefix: '/api/v1' }, 'a config name still names its base');
  assert.deepEqual(urlOf({ kind: 'literal', value: '${window.location.origin}/accounts/${id}', template: true }, new Map(), 'js'), { path: '/accounts/${id}', target: null, confidence: 'heuristic', needle: '${window.location.origin}/accounts/${id}', absolute: true });
  assert.deepEqual(urlOf({ kind: 'expr', text: "config.api + '/teams/' + id" }, new Map(), 'js'), { path: '/teams/{}', target: null, confidence: 'heuristic', needle: "config.api + '/teams/' + id", absolute: true });
  const origin = baseBindings("const API = `${location.origin}/api/v1`;\nconst CAT = config.api + '/api';\nconst REL = '/api';\nconst USERS = `${API}/users`;\nconst V2 = API + '/v2';\n");
  assert.deepEqual([origin.get('API'), origin.get('CAT'), origin.get('REL'), origin.get('USERS'), origin.get('V2')], [
    { target: null, confidence: 'heuristic', prefix: '/api/v1', absolute: true }, { target: null, confidence: 'heuristic', prefix: '/api', absolute: true },
    { target: null, confidence: 'exact', prefix: '/api' }, { target: null, confidence: 'heuristic', prefix: '/api/v1/users', absolute: true },
    { target: null, confidence: 'heuristic', prefix: '/api/v1/v2', absolute: true },
  ], 'a base derived from an origin stays absolute; a relative-path constant does not');
  assert.equal(urlOf({ kind: 'literal', value: '${API}/users', template: true }, origin, 'js').absolute, true);
  assert.equal(urlOf({ kind: 'literal', value: '${REL}/users', template: true }, origin, 'js').absolute, undefined);
  assert.deepEqual([...clientInstances("switch (env) { case Env.Prod: api = axios.create({}); break; case Stage.Env.PROD: b = ky.create({}); }\n")].sort(), ['api', 'b'], 'a qualified label is no name either');
});

test('code: implementation review cycle 3 — a config KEY P1 reads as a public host names no target either, and its base is absolute', () => {
  assert.deepEqual(baseBindings('@Value("${services.billing}")\nprivate String base;\n').get('base'), { target: null, confidence: 'heuristic', absolute: true }, 'the key holds a whole URL: no target, never under a file base');
  const kept = baseBindings('@Value("${billing.url}")\nprivate String a;\n@Value("${billing.svc}")\nprivate String b;\n');
  assert.deepEqual([kept.get('a'), kept.get('b')], [{ target: 'billing.url', confidence: 'heuristic' }, { target: 'billing.svc', confidence: 'heuristic' }], 'a URL-tail key and an internal-suffix key keep their key');
  assert.deepEqual(urlOf({ kind: 'literal', value: "${this.configService.get('billing.api')}/x", template: true }, new Map(), 'js'), { path: '/x', target: null, confidence: 'heuristic', needle: "${this.configService.get('billing.api')}/x", absolute: true });
  assert.deepEqual(urlOf({ kind: 'literal', value: "${this.configService.get('billing.url')}/x", template: true }, new Map(), 'js').target, 'billing.url');
  assert.deepEqual(concatBase("this.configService.get('billing.api') + '/v1'", new Map()), { target: null, confidence: 'heuristic', prefix: '/v1', absolute: true });
  const nest = baseBindings("const B = this.configService.get('app.billing-service');\nconst T = `${this.configService.get('billing.gateway')}/api`;\nconst K = this.configService.get('BILLING_URL');\n");
  assert.deepEqual([nest.get('B'), nest.get('T'), nest.get('K')], [
    { target: null, confidence: 'heuristic', absolute: true }, { target: null, confidence: 'heuristic', prefix: '/api', absolute: true }, { target: 'BILLING_URL', confidence: 'heuristic' },
  ], 'the env branch and the template branch read the key like the expression');
  const tplFirst = "const base = `http://localhost:${port}`;\nconst base = this.configService.get('billing.api');\n";
  const keyFirst = "const base = this.configService.get('billing.api');\nconst base = `http://localhost:${port}`;\n";
  assert.deepEqual([baseBindings(keyFirst).get('base'), baseBindings(tplFirst).get('base')], [{ target: 'base', confidence: 'heuristic' }, { target: 'base', confidence: 'heuristic' }],
    'an absolute base and a templated host are two bases behind one path, never one base that lost `absolute`');
});
