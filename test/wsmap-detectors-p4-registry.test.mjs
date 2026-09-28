import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DETECTORS, detectorById } from '../src/core/workspace-map/detectors/index.mjs';

const P4 = ['db', 'http-clients', 'http-routes', 'messaging'];

test('registry: the P4 block follows the P3 block, alphabetical, each detector frozen', () => {
  const ids = DETECTORS.map((d) => d.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.deepEqual(ids.slice(-4), P4);
  for (const id of P4) {
    const d = detectorById(id);
    assert.ok(Object.isFrozen(d) && typeof d.claims === 'function' && typeof d.detect === 'function', id);
  }
  assert.ok(detectorById('http-routes').claims('config/routes.rb'));
  assert.ok(detectorById('db').claims('db/migration/V1__init.sql') && detectorById('db').claims('prisma/schema.prisma') && detectorById('db').claims('.env'));
  assert.ok(!detectorById('messaging').claims('README.md'));
});

// ReDoS guard: pathological inputs per language (1 MiB, the per-file read cap; a few rows are 2 or 4 MiB so
// that their naive forms are clearly over the bound) must finish in < 2 s per detector (unloaded the
// slowest case takes ~0.2 s; the bound leaves room for `npm test`'s parallel files — the naive forms
// take 5 s to hours).
// Every regex in the P4 tables is a bounded token run with no nested unbounded quantifier and never
// `\s*` on both sides of an optional token; multi-line constructs (strings, comments, call bodies,
// brace scopes, SQL comments, Prisma bodies, Rails blocks) are scanned with indexOf / char loops in
// bounded windows, and nesting is capped. Remove a bound (e.g. `[^)]{0,400}?` → `[^)]*?`, the Rails
// depth cap, blankSqlComments' single forward pass) and this fails.
const MB = 1024 * 1024;
const fill = (unit, n = MB) => unit.repeat(Math.ceil(n / unit.length)).slice(0, n);
// JS-family inputs start with 4 KiB of short lines: a > 1 000-char line inside the first 4 KiB marks
// a JS file as minified (isMinified) and the detectors would skip it — these cases must be scanned.
const js = (s) => `${'// ok\n'.repeat(700)}${s}`.slice(0, MB);
const INPUTS = [
  ['a.js', js(fill("app.get('/a', axios.get(`${x}/y`, fetch(\"/z\", { method: 'POST', url: '"))],
  ['a.js', js(fill('@Controller(@Get(@Entity({ name: `'))],
  ['a.js', js(fill('/*').slice(0, MB / 2) + fill('`${'))],
  ['a.py', fill('@app.route("/a", methods=["GET", requests.get(f"{B}/x", KafkaConsumer(\'t\', ')],
  ['a.py', fill('"""SELECT * FROM a JOIN b ON ') + fill("'")],
  ['A.java', fill('@RequestMapping(value = {"/a", @GetMapping(path = {"/b", @KafkaListener(topics = {"')],
  ['A.java', fill('restTemplate.getForObject(base + "/x" + new ProducerRecord<>(') ],
  ['a.go', fill('r.GET("/a", h) http.NewRequest("GET", fmt.Sprintf("%s/x", c.R().SetBody(x).Post(')],
  ['A.cs', fill('[HttpGet("x")] [Route("[controller]")] _httpClient.GetFromJsonAsync<Shipment>($"{b}/x", ')],
  ['config/routes.rb', fill('resources :a do ')],
  ['a.sql', fill('CREATE TABLE IF NOT EXISTS "a"."b" (SELECT * FROM (SELECT x FROM ') + fill("'")],
  ['a.sql', fill('/* -- ') ],
  ['schema.prisma', fill('model A { @@map("')],
  ['a.php', fill("Route::resource('a', Route::get('/b', $client->get('")],
  ['a.kt', fill('routing { route("/a") { get("/b") { ')],
  ['a.js', js(fill('await producer.send({ topic: x, '))],
  ['a.py', fill('channel.basic_publish(exchange=')],
  ['a.kt', `routing {\n${fill('route("/a") { get("/b") { } ').slice(0, MB / 2)}${'} '.repeat(MB / 4)}`],
  ['a.go', fill('r.Route("/a", func(r chi.Router) { r.Get("/b", h) }) ')],
  // multi-line, whitespace-run and nesting shapes (each one was quadratic, or ran out of memory, in v1)
  ['config/routes.rb', fill('resources :a do\n')],
  ['a.js', js(`a.get${' '.repeat(MB)}`)],
  // a client call with a non-literal URL makes http-clients build its same-file base bindings
  ['a.js', js(`fetch(base + '/x');\nabc${'\n'.repeat(MB)}`)],
  ['a.py', `requests.get(BASE + "/x")\nabc${' '.repeat(MB - 30)}`],
  ['a.py', `requests.get(BASE + "/x")\nx:${' '.repeat(MB - 40)}`],
  ['a.js', js(`fetch(base + '/x');\nx:${' '.repeat(MB)}`)],
  ['A.java', `new ProducerRecord${' '.repeat(MB - 18)}`],
  ['db/migrate/1_x.rb', `create_table${' '.repeat(MB - 12)}`],
  ['a.rb', `client.get${' '.repeat(MB - 10)}`],
  ['schema.prisma', fill('model A {\n')],
  ['schema.prisma', '\n'.repeat(MB)],
  ['a.sql', fill('--\n', 2 * MB)],
  ['a.sql', fill('/**/')],
  ['a.go', fill('r.Route("/a", func ', 4 * MB)],
  ['A.java', fill('class A { @GET void a(){} } ')],
  ['A.kt', fill('class A { @GET fun a(){} } ')],
  ['A.cs', fill('class A { [Get("/x")] void a(){} } ')],
  ['a.py', fill(`requests.get("http://${'a'.repeat(3980)} b")\n`)],
  ['A.java', `@RegisterRestClient\npublic interface X {\n${Array.from({ length: 30000 }, (_, i) => `@Path("/p${i}")\n@GET String a${i}();\n`).join('')}}`.slice(0, MB)],
  ['shop/urls.py', `urlpatterns = [\n${fill(`re_path(r'^${'(?P<a>'.repeat(600)}', v),\n`)}`],
  ['db/changelog.yaml', `createTable:${' '.repeat(MB - 20)}`],
  ['A.java', fill(`.baseUrl(${' '.repeat(990)}\n`)],
  ['A.java', fill('@GET class A {} ', 2 * MB)], // annotation blocks without class bodies: the class lookup must stay a binary search
  // refine cycle 1: the constructs its fixes added (nested generics, Java arrays, chi With, list topics, route handlers, %i[], Ktor blocks)
  ['a.ts', js(fill('this.http.get<A<B<C '))],
  ['A.cs', fill('_httpClient.GetFromJsonAsync<List<Dictionary<string, ')],
  ['A.java', fill('@GetMapping(value = {"/a/{id}", ')],
  ['a.go', fill('r.With(mw(x), ')],
  ['A.java', fill('consumer.subscribe(Arrays.asList("a", ')],
  ['a.js', js(fill('await consumer.subscribe({ topics: [A, B.C, "d"] }); '))],
  ['a.php', fill("$app->get('/x', $router->get('/y', ")],
  ['config/routes.rb', fill('resources :a, only: %i[index ')],
  ['a.kt', `routing {\n${fill('route("/a") { get { ')}`],
  ['a.py', fill('router: APIRouter = APIRouter(prefix="')],
  ['a.js', js(`const u = \`\${B}/x\`;\n${fill('a = `${b}/')}`)],
  ['app/models.py', fill("class Meta:\n    db_table = 't'\n")],
  ['src/a.js', js(fill('`-- c\nSELECT * FROM t `'))],
  // refine cycle 2: C# attribute lists, Ktor handler scopes, the quote-aware SQL comment blanker, concatenated annotation paths, typed calls, binding clashes
  ['A.cs', fill('[HttpGet, Route("x"), ')],
  ['a.kt', `routing {\n${fill('route("/a") { get { head { ')}`],
  ['a.sql', fill("--'")],
  ['a.sql', fill("'--")],
  ['A.java', fill('@GetMapping("/a" + ')],
  ['a.ts', js(fill("app.get('/me', async () => api.get<A<B>>('/x', c)); "))],
  ['a.ts', js(`fetch(base + '/x');\n${fill('const url = `${API}/users`;\n')}`)], // a call makes http-clients build the bindings (v5: the v4 row had none)
  // refine cycle 3: bases derived by concatenation (lastIndexOf + anchored regexes)
  ['a.js', js(`fetch(base + '/x');\n${fill("A = process.env.X + '/a' + ")}`)],
  ['a.py', `requests.get(BASE + "/x")\n${fill(`B = os.environ["X"] + "/${' '.repeat(250)}\n`)}`],
  ['a.js', js(`fetch(base + '/x');\n${fill("if (API == process.env.X) API = `${process.env.Y ?? 'http://a'}/b`;\n")}`)],
  ['a.py', fill('async with httpx.AsyncClient(base_url=f"{')],
  ['a.ts', js(fill("const api = express.Router(); api.get<{ a: string }>('/x', h); "))],
  ['A.cs', fill('[ApiController, Route("api/[controller]"), ProducesResponseType<List<Item>>(200), ')],
  ['a.kt', `routing {\n${fill('route("/a") { get(Regex("/x")) { head { ')}`],
  ['app/routers.py', fill('api = APIRouter(dependencies=[Depends(a)], ')],
  ['a.js', js(fill("await producer.send({ topic: PREFIX + 'a', messages }); QueueUrl: SQS + '/q', "))],
  ['app/migrations/0001_initial.py', `class Migration(migrations.Migration):\n    operations = [\n${fill("migrations.CreateModel(name='A', fields=[('a', models.TextField()), ")}`],
  // v6: scoped httpx receivers (one pass over the lines), balanced keyword reads, nearest receiver bases, list elements,
  // state_operations spans, proxy models, balanced APIRouter arguments, router-type conflicts, typed C# properties
  ['a.py', fill('async with httpx.AsyncClient(\n    timeout=1, base_url="http://a/x"\n) as c:\n    c.get("/y")\n')],
  ['a.py', `with httpx.Client(base_url="http://a") as c:\n${'    c.get("/y")\n'.repeat(MB / 16)}`],
  ['a.py', fill('with httpx.Client(base_url=')],
  ['a.py', fill('with httpx.Client(base_url="http://a") as c: c.get("/y"); ')], // thousands of scoped bases on one line
  ['a.py', `with httpx.Client(base_url="http://a") as c: c.get("/y"); ${fill("'a' ", 2 * MB)}`], // one scoped base, 512 K one-line strings (2 MiB): the string spans stay O(literal)
  ['a.js', js(fill("api = axios.create({ baseURL: 'http://a:1' }); api = axios.create({ baseURL: 'http://b:2' }); api.get('/x'); "))],
  ['a.py', fill("c.subscribe([P + 'a', ")],
  ['app/migrations/0002_x.py', fill('state_operations=[migrations.AddField(')],
  ['app/migrations/0002_y.py', fill("migrations.CreateModel(name='A', options={'proxy': True}, ")],
  ['app/routers.py', fill('router = APIRouter(dependencies=[Depends(A(B(')],
  ['a.ts', js(fill('function f(api: Router, api: Api, r: X) { api.get<T>("/x", h); } '))],
  ['A.cs', fill('private string BaseUrl => _configuration["X"]; ')],
  ['a.js', js(fill("const A = 'a', B = 'b', "))], // constants: the paren-context walk is bounded (≤ 300 chars back)
  ['a.py', `def f(\n${fill("    topic = 'x',\n")}`],
  ['app/routers.py', fill('router = APIRouter(tags=["(')],
  // implementation review cycle 2: the switch-label lookbehind skips a qualified label
  ['a.js', js(fill('case a.b.c.d.e: api = axios.create({}); '))],
  ['a.py', fill('with httpx.Client(base_url="http://a") as c:\n    q = """\nx\n"""\n    c.get("/y")\n')],
  ['a.ts', js(fill('(api: Router, api: X, { api: Y }, private api: Z) '))],
  // implementation review cycle 1: a base chained onto itself (R4-10's replace grew its prefix per line: 7 s), one Python local
  // name in thousands of functions (R4-12's per-use scan of the locals: 3 s), messaging constants on one line and
  // under class headers and self./cls. attributes, Koa groups, nested TS generics, typed and labelled client
  // instances, object values next to a router
  ['a.js', js(`fetch(API + '/x');\n${fill("API = API + '/api/v1';\n")}`)],
  ['a.py', `requests.get(API + "/x")\n${fill('API = f"{API}/api/v1"\n')}`],
  ['a.py', fill("def f():\n    topic = 'orders'\n", MB / 2) + fill('KafkaConsumer(topic)\n', MB / 2)],
  ['a.py', `producer.send(topic)\n${fill(' a = "b",')}`],
  ['a.py', `producer.send(Topics.a)\nclass Topics:\n${fill('    a = "b"\n    self.c = "d"\n')}`],
  ['a.js', js(fill("const router = new Router({ prefix: '/a', "))],
  ['a.ts', js(`app.get<${fill('<{ a: Array<b', MB / 2)}${fill('x', MB / 2)}`)],
  ['a.ts', js(fill('case p: api = axios.create({ baseURL: x }); default: api: T = ky.create({}); '))],
  ['a.ts', js(`const api = express.Router();\n${fill('f({ api: Api, api: API_X, (api: ApiClient<T> ')}`)],
  // a lone \r keeps a whole 1 MiB config line in one line: P3 (round 2) matches its value with [^]*, not .*
  ['src/main/resources/application.properties', `spring.datasource.url=${' '.repeat(MB - 40)}x\rx\ry`],
];

test('registry: pathological inputs (1–4 MiB: lines, whitespace runs, nesting) finish in < 2 s per detector and never throw', () => {
  const dir = join(tmpdir(), 'wsmap-redos-p4');
  const member = { key: 'm', name: 'm', dir, projectDir: dir };
  for (const id of P4) {
    const d = detectorById(id);
    for (const [i, [rel, text]] of INPUTS.entries()) {
      if (!d.claims(rel)) continue;
      const ctx = { member, members: [member], files: [rel], state: {} };
      const t0 = performance.now();
      assert.doesNotThrow(() => { d.detect({ rel, text }, ctx); if (d.finish) d.finish(ctx); }, `${id} INPUTS[${i}] ${rel}`);
      const ms = performance.now() - t0;
      const head = text.slice(text.startsWith('// ok\n') ? 4200 : 0).slice(0, 30); // past the JS padding
      assert.ok(ms < 2000, `${id} took ${ms.toFixed(0)} ms on INPUTS[${i}] ${rel} (${(text.length / MB).toFixed(1)} MiB: ${head}…)`);
    }
  }
});
