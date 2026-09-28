// test/wsmap-http-client-shapes.test.mjs — M6: five code shapes that keyed a client call to the wrong member or route at
// `exact`, plus the detector half of the sixth. A parameter never inherits a same-named binding (a client object built
// on such a name has an unknown base: its calls are dynamic urls; a member keeps a value of its own); an absolute URL with a
// templated host takes no receiver or file base; PHP `.` and Ruby `#{…}` keep the whole path; a base serves its own client
// only (every definition counts, a WebClient base never serves RestTemplate, a .NET BaseAddress is its receiver's);
// Micronaut's relative @Client("/x") is a path prefix and a declared path with no literal segment is no route. Each row
// asserts the correct member and route, or no edge. (The catalog half of shape 6: wsmap-literal-less-http-joins.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import detector from '../src/core/workspace-map/detectors/http-clients.mjs';
import { makeWorkspace } from './helpers/wsmap-fixtures.mjs';
import { extractWorkspace } from '../src/core/workspace-map/extract.mjs';
import { buildCatalog } from '../src/core/workspace-map/catalog.mjs';
import { joinMap } from '../src/core/workspace-map/join.mjs';

/** The detector over in-memory files of ONE member, the way extract runs it: claims → detect → finish. */
function run(files) {
  const member = { key: 'm', name: 'm', dir: '/none', projectDir: '/none' };
  const ctx = { member, members: [member], files: Object.keys(files), state: {} };
  const out = { facts: [], unresolved: [] };
  for (const [rel, text] of Object.entries(files)) {
    if (!detector.claims(rel)) continue;
    const r = detector.detect({ rel, text }, ctx);
    out.facts.push(...(r?.facts || []));
    out.unresolved.push(...(r?.unresolved || []));
  }
  out.facts.push(...(detector.finish(ctx)?.facts || []));
  return out;
}
const rows = (out, file) => out.facts.filter((f) => f.file === file).map((f) => `${f.key} -> ${f.target ?? '-'}`);

/** extract → catalog → join over a fresh workspace (static facts only) → sorted 'from -> to norm (confidence)'. */
async function edges(spec) {
  const w = await makeWorkspace(spec);
  try {
    const extract = await extractWorkspace({ name: 'Shapes', members: w.members });
    const map = await joinMap({ catalog: await buildCatalog({ extract, survey: null }), usage: null });
    return map.edges.filter((e) => e.kind !== 'pkg').map((e) => `${e.from} -> ${e.to} ${e.norm} (${e.confidence})`).sort();
  } finally { await w.cleanup(); }
}
const express = (name, ...routes) => ({
  'package.json': `{ "name": "${name}" }\n`,
  'src/s.js': `const express = require('express'); const app = express();\n${routes.map((r) => `app.get('${r}', h);`).join('\n')}\n`,
});
const pom = (name) => `<project><groupId>a</groupId><artifactId>${name}</artifactId></project>\n`;

test('M6 shape 1: makeClient(baseUrl) never takes the module baseUrl — no users call lands on billing', async () => {
  const got = await edges({
    billing: express('billing', '/api/invoices/:id'),
    'users-svc': express('users-svc', '/api/users/:id'),
    web: { 'package.json': '{ "name": "web" }\n', 'src/clients.js': "const baseUrl = 'http://billing:8080/api';\nexport const invoice = (id) => fetch(`${baseUrl}/invoices/${id}`);\nexport function makeClient(baseUrl) {\n  return { user: (id) => fetch(`${baseUrl}/users/${id}`) };\n}\nexport const users = makeClient(process.env.USERS_URL);\n" },
  });
  assert.ok(!got.some((e) => e.includes('/users/')), JSON.stringify(got));
});

test('M6 shape 1: a bare name that is also a parameter (JS, TS, destructured, a constructor, Python, Go) is ambiguous; a default value is no parameter', () => {
  const out = run({
    'web/a.js': "export async function health() { const url = 'http://billing:8080/health'; return fetch(url); }\nexport async function get(url, id) { return fetch(`${url}/users/${id}`); }\n",
    'web/d.ts': "const baseUrl = 'http://billing:8080/api';\nexport const createClient = ({ baseUrl, token }: Opts) => ({ user: (id: string) => fetch(`${baseUrl}/users/${id}`) });\n",
    'web/g.ts': "const url = 'http://billing:8080/api';\nexport const one = async (url: string): Promise<User> => fetch(`${url}/users/me`);\n",
    'web/h.js': "const url = 'http://billing:8080/api';\nexport const all = (ids) => ids.map(url => fetch(`${url}/users`));\n",
    'web/e.js': "const baseUrl = 'http://billing:8080/api';\nexport class UsersClient {\n  constructor(baseUrl) { this.baseUrl = baseUrl; }\n  one(id) { return fetch(`${this.baseUrl}/users/${id}`); }\n}\n",
    'svc/c.py': "BASE_URL = 'http://billing:8080/api'\n\ndef invoices():\n    return requests.get(f'{BASE_URL}/invoices')\n\ndef user(BASE_URL, uid):\n    return requests.get(f'{BASE_URL}/users/{uid}')\n",
    'c.go': 'package c\nfunc a() { url := "http://billing:8080/api"; http.Get(url + "/invoices") }\nfunc b(url string, id string) { http.Get(url + "/users/" + id) }\n',
    'web/f.js': "const API = 'http://billing:8080/api';\nexport const inv = (id) => fetch(`${API}/invoices/${id}`);\nexport function page(n = API) { return n; }\n",
  });
  assert.deepEqual(out.facts.filter((f) => f.key.includes('/users') && f.target === 'billing:8080').map((f) => `${f.file} ${f.key}`), [], "no /users call is keyed under billing's host");
  assert.deepEqual(rows(out, 'web/e.js'), ['GET /users/${id} -> this.baseUrl'], 'this.baseUrl = baseUrl copies the parameter, never the module const');
  assert.deepEqual(rows(out, 'web/f.js'), ['GET /api/invoices/${id} -> billing:8080'], 'page(n = API): API is a default value, not a parameter');
});

test('M6 shape 2: an absolute URL with a templated host takes no receiver base — never billing — and an env-read base_url host keeps its member', async () => {
  assert.deepEqual(await edges({
    billing: { 'pyproject.toml': '[project]\nname = "billing"\n', 'app/main.py': "from fastapi import FastAPI\napp = FastAPI()\n@app.get('/invoices')\nasync def invoices(): ...\n" },
    users: { 'pyproject.toml': '[project]\nname = "users"\n', 'app/main.py': "from fastapi import FastAPI\napp = FastAPI()\n@app.get('/users/{uid}')\nasync def user(uid: int): ...\n" },
    caller: { 'pyproject.toml': '[project]\nname = "caller"\n', 'app/sync.py': "import httpx\n\nasync def sync(users_host, uid):\n    async with httpx.AsyncClient(base_url='http://billing:8080') as client:\n        await client.get('/invoices')\n        return await client.get(f'http://{users_host}/users/{uid}')\n" },
  }), ['caller -> billing http:GET /invoices (exact)', 'caller -> users http:GET /users/{} (exact)']);
  // the rejected `absolute: true` fix: baseOf reads `absolute` as an origin, so this base would lose ACCOUNTS_HOST and the
  // call (served by two members) its member
  assert.deepEqual(await edges({
    accounts: express('accounts', '/api/v1/users/me'),
    legacy: express('legacy', '/api/v1/users/me'),
    caller: { 'pyproject.toml': '[project]\nname = "caller"\n', 'app/me.py': "import os, httpx\nclient = httpx.Client(base_url=f\"http://{os.environ['ACCOUNTS_HOST']}:8000/api/v1\")\ndef me(): return client.get(\"/users/me\")\n" },
  }), ['caller -> accounts http:GET /api/v1/users/me (heuristic)']);
});

test('M6 shape 2: a templated-host URL — a literal, a concatenation, a binding, a binding derived from one — is absolute: no receiver or file base', () => {
  const out = run({
    'web/a.ts': "const api = axios.create({ baseURL: 'http://billing:8080' });\nexport const inv = () => api.get('/invoices');\nexport const user = (host, id) => api.get(`http://${host}:8080/users/${id}`);\n",
    'src/main/java/C.java': 'class C {\n  private final WebClient billing = WebClient.create("http://billing:8080");\n  Mono<User> u(String host, long id) { return billing.get().uri("http://" + host + ":8080/users/" + id).retrieve().bodyToMono(User.class); }\n}\n',
    'svc/a.py': "async def f(host, uid):\n    async with httpx.AsyncClient(base_url='http://billing:8080') as client:\n        await client.get('/invoices')\n        return await client.get(f'http://{host}/users/{uid}')\n",
    'web/bind.ts': "const api = axios.create({ baseURL: 'http://billing:8080' });\nconst B = `http://${host}:8080/api`;\nexport const user = (id) => api.get(`${B}/users/${id}`);\n",
    'web/derived.ts': "const api = axios.create({ baseURL: 'http://billing:8080' });\nconst H = `http://${host}:8080`;\nconst B = `${H}/api`;\nexport const user = (id) => api.get(`${B}/users/${id}`);\n",
    'web/concat.ts': "const api = axios.create({ baseURL: 'http://billing:8080' });\nconst B = `http://${host}:8080` + '/api';\nexport const user = (id) => api.get(`${B}/users/${id}`);\n",
    'web/concat2.ts': "const api = axios.create({ baseURL: 'http://billing:8080' });\nconst H = `http://${host}:8080`;\nconst B = H + '/api';\nexport const user = (id) => api.get(`${B}/users/${id}`);\n",
    'svc/fhost.py': "import os, httpx\nclient = httpx.Client(base_url=f\"http://{os.environ['ACCOUNTS_HOST']}:8000/api/v1\")\ndef me(): return client.get(\"/users/me\")\n",
  });
  assert.deepEqual(rows(out, 'web/a.ts'), ['GET /invoices -> billing:8080', 'GET /users/${id} -> -']);
  assert.deepEqual(rows(out, 'src/main/java/C.java'), ['GET /users/{} -> -'], 'the WebClient file base never prefixes a concatenated absolute URL');
  assert.deepEqual(rows(out, 'svc/a.py'), ['GET /invoices -> billing:8080', 'GET /users/{uid} -> -']);
  assert.deepEqual(['web/bind.ts', 'web/derived.ts', 'web/concat.ts', 'web/concat2.ts'].map((f) => rows(out, f)), [['GET /api/users/${id} -> -'], ['GET /api/users/${id} -> -'], ['GET /api/users/${id} -> -'], ['GET /api/users/${id} -> -']]);
  assert.deepEqual(rows(out, 'svc/fhost.py'), ['GET /api/v1/users/me -> ACCOUNTS_HOST'], 'an env read in the host is a target, never an origin');
});

test('M6 shape 3: PHP `.` concatenation keeps the whole path — the item route on orders-svc, never the collection on reports', async () => {
  assert.deepEqual(await edges({
    'orders-svc': express('orders-svc', '/orders/:id'),
    reports: express('reports', '/orders'),
    shop: { 'composer.json': '{ "name": "acme/shop" }\n', 'app/Orders.php': "<?php\nclass Orders {\n  public function find($id) { return $this->client->get('/orders/' . $id); }\n}\n" },
  }), ['shop -> orders-svc http:GET /orders/{} (exact)']);
  const out = run({
    'app/C.php': "<?php\nclass C {\n  function a($id) { return $this->client->get('/orders/' . $id); }\n  function b($id) { return Http::get('http://users.internal:8080/users/' . $id . '/avatar'); }\n  function c($id) { return $this->client->get('/orders/' . $id . '/items'); }\n  function d($id) { return $this->client->get(\"/carts/{$id}\"); }\n  function e($id) { return Http::get(\"http://users:8080/users/\" . $id); }\n}\n",
    'svc/fmt.py': "def user(uid):\n    return requests.get('/users/{}'.format(uid))\n",
    'web/cfg.js': "export const user = (id) => fetch(settings.usersUrl + '/users/' + id);\n",
  });
  assert.deepEqual(rows(out, 'app/C.php'), ['GET /orders/{} -> -', 'GET /users/{}/avatar -> users.internal:8080', 'GET /orders/{}/items -> -', 'GET /carts/{id} -> -', 'GET /users/{} -> users:8080'], "a host's dots are no concatenation");
  assert.deepEqual(rows(out, 'svc/fmt.py'), ['GET /users/{} -> -'], "outside PHP a literal's `.format(…)` is no concatenation");
  assert.deepEqual(rows(out, 'web/cfg.js'), ['GET /users/{} -> settings.usersUrl'], 'outside PHP a `.` is a member access, never a concatenation');
});

test('M6 shape 4: Ruby #{id} is a path parameter, never a fragment — show, not index', async () => {
  assert.deepEqual(await edges({
    users: { Gemfile: "source 'https://rubygems.org'\n", 'config/routes.rb': 'Rails.application.routes.draw do\n  resources :users, only: [:index, :show]\nend\n' },
    web: { Gemfile: "source 'https://rubygems.org'\n", 'app/services/u.rb': 'class U\n  def get(id) = HTTParty.get("http://users:3000/users/#{id}")\nend\n' },
  }), ['web -> users http:GET /users/{} (exact)']);
  const out = run({ 'app/c.rb': 'class C\n  def a(id) = HTTParty.get("http://users:3000/users/#{id}")\n  def b(id) = conn.get("/orders/#{id}/items")\n  def c(id) = RestClient.get("#{BASE}/invoices/#{id}")\n  def d(id) = HTTParty.get("http://users:3000/users/#{id}/avatar?size=#{s}")\nend\n' });
  assert.deepEqual(rows(out, 'app/c.rb'), ['GET /users/{id} -> users:3000', 'GET /orders/{id}/items -> -', 'GET /invoices/{id} -> BASE', 'GET /users/{id}/avatar -> users:3000']);
});

test('M6 shape 5: a WebClient base never serves a RestTemplate call — the users call reaches users, not inventory', async () => {
  const java = 'package x;\n@Service\npublic class OrderService {\n  private final WebClient inventory = WebClient.create("http://inventory:8080");\n  private final RestTemplate restTemplate;\n  public User owner(Long id) { return restTemplate.getForObject("/users/{id}", User.class, id); }\n  public Mono<Stock> stock(String sku) { return inventory.get().uri("/stock/{sku}", sku).retrieve().bodyToMono(Stock.class); }\n}\n';
  assert.deepEqual(await edges({
    inventory: { 'pom.xml': pom('inventory'), 'src/main/java/S.java': '@RestController\npublic class S {\n  @GetMapping("/stock/{sku}") Stock s(@PathVariable String sku) { return null; }\n}\n' },
    users: { 'pom.xml': pom('users'), 'src/main/java/U.java': '@RestController\npublic class U {\n  @GetMapping("/users/{id}") User u(@PathVariable Long id) { return null; }\n}\n' },
    orders: { 'pom.xml': pom('orders'), 'src/main/java/x/OrderService.java': java },
  }), ['orders -> inventory http:GET /stock/{} (exact)', 'orders -> users http:GET /users/{} (exact)']);
});

test('M6 shape 5: every base definition counts — an unresolvable sibling (WebClient, Retrofit) leaves no single base to lend; a test builder counts for none', () => {
  const web = run({ 'src/main/java/x/Clients.java': 'package x;\n@Component\npublic class Clients {\n  private final WebClient inventory = WebClient.create("http://inventory:8080");\n  private final WebClient users;\n  Clients(Props props) { this.users = WebClient.builder().baseUrl(props.getUsersUrl()).build(); }\n  Mono<User> owner(Long id) { return users.get().uri("/users/{id}", id).retrieve().bodyToMono(User.class); }\n}\n' });
  assert.deepEqual(rows(web, 'src/main/java/x/Clients.java'), ['GET /users/{id} -> -'], "never inventory's base");
  const retro = run({
    'src/main/java/Net.java': 'class Net {\n  Retrofit users = new Retrofit.Builder().baseUrl("http://users:8080/").addConverterFactory(g).build();\n  Retrofit billing = new Retrofit.Builder().baseUrl(config.getBillingUrl()).addConverterFactory(g).build();\n}\n',
    'src/main/java/UsersApi.java': 'public interface UsersApi {\n  @GET("users/{id}") Call<User> get(@Path("id") long id);\n}\n',
    'src/main/java/BillingApi.java': 'public interface BillingApi {\n  @GET("invoices/{id}") Call<Invoice> get(@Path("id") long id);\n}\n',
  });
  assert.deepEqual([rows(retro, 'src/main/java/UsersApi.java'), rows(retro, 'src/main/java/BillingApi.java')], [['GET /users/{id} -> -'], ['GET /invoices/{id} -> -']], 'two builders: no interface takes users\'s base');
  const tested = run({
    'src/main/java/Net.java': 'class Net {\n  Retrofit users = new Retrofit.Builder().baseUrl("http://users:8080/").build();\n}\n',
    'src/test/java/UsersApiTest.java': 'class UsersApiTest {\n  MockWebServer server = new MockWebServer();\n  Retrofit mock = new Retrofit.Builder().baseUrl(server.url("/")).build();\n  Retrofit local = new Retrofit.Builder().baseUrl("http://localhost:8080/").build();\n}\n',
    'src/main/java/UsersApi.java': 'public interface UsersApi {\n  @GET("users/{id}") Call<User> get(@Path("id") long id);\n}\n',
  });
  assert.deepEqual(rows(tested, 'src/main/java/UsersApi.java'), ['GET /users/{id} -> users:8080'], 'a MockWebServer or localhost builder in a test serves no interface');
  // …nor one in another Gradle test source set (`src/integrationTest/`, Android's `src/sharedTest/`), which isTestPath does not name
  for (const set of ['integrationTest', 'sharedTest']) {
    const it = run({
      'src/main/java/Net.java': 'class Net {\n  Retrofit users = new Retrofit.Builder().baseUrl("http://users:8080/").build();\n}\n',
      [`src/${set}/java/UsersApiIT.java`]: 'class UsersApiIT {\n  MockWebServer server = new MockWebServer();\n  Retrofit mock = new Retrofit.Builder().baseUrl(server.url("/")).build();\n}\n',
      'src/main/java/UsersApi.java': 'public interface UsersApi {\n  @GET("users/{id}") Call<User> get(@Path("id") long id);\n}\n',
    });
    assert.deepEqual(rows(it, 'src/main/java/UsersApi.java'), ['GET /users/{id} -> users:8080'], `a MockWebServer builder in src/${set}/`);
  }
});

// a multi-line initializer on an auto-property, and a `using` local — the same in a CRLF (Windows) checkout
const ORDERS_CS = 'public class Orders {\n  public HttpClient Client { get; } = new HttpClient\n  {\n    Timeout = TimeSpan.FromSeconds(5),\n    BaseAddress = new Uri("http://orders:8080/"),\n  };\n  public Task<Order> One(int id) => Client.GetFromJsonAsync<Order>($"api/orders/{id}");\n  public async Task<string> Ping() { using var client = new HttpClient() { BaseAddress = new Uri("http://ping:9000/") }; return await client.GetStringAsync("health/live"); }\n}\n';

test('M6 shape 5: a .NET BaseAddress belongs to the HttpClient it is set on; one set on an injected parameter is the class\'s own client', () => {
  const out = run({
    'Checkout.cs': 'public class Checkout {\n  private readonly HttpClient _billingClient = new HttpClient { BaseAddress = new Uri("http://billing:8080/") };\n  private readonly HttpClient _httpClient; // IHttpClientFactory "users": its BaseAddress is set in Program.cs\n  public Task<User> Owner(int id) => _httpClient.GetFromJsonAsync<User>($"api/users/{id}");\n  public Task<Invoice> Inv(int id) => _billingClient.GetFromJsonAsync<Invoice>($"api/invoices/{id}");\n}\n',
    'Catalog.cs': 'public class CatalogService {\n  private readonly HttpClient _httpClient;\n  public CatalogService(HttpClient httpClient) {\n    httpClient.BaseAddress = new Uri("http://catalog:5000/");\n    _httpClient = httpClient;\n  }\n  public Task<Item> One(int id) => _httpClient.GetFromJsonAsync<Item>($"api/items/{id}");\n}\n',
    'Orders.cs': ORDERS_CS,
    'OrdersCrlf.cs': ORDERS_CS.replace(/\n/g, '\r\n'),
    'Gh.cs': 'public class GitHubService {\n  private readonly HttpClient _httpClient;\n  public GitHubService(HttpClient httpClient) {\n    _httpClient = httpClient;\n    _httpClient.BaseAddress = new Uri("http://github-proxy:8080/");\n  }\n  public Task<Repo> Repo(string n) => _httpClient.GetFromJsonAsync<Repo>($"repos/{n}");\n}\n',
    'Nested.cs': 'public class Nested {\n  private readonly HttpClient _catalogClient = new HttpClient(new SocketsHttpHandler()) { BaseAddress = new Uri("http://catalog-api:8080/") };\n  public Task<Item> One(int id) => _catalogClient.GetFromJsonAsync<Item>($"api/items/{id}");\n}\n',
    'Mix.cs': 'public class Mix {\n  private readonly HttpClient _ledgerClient = new() { BaseAddress = new Uri(config["Ledger:Url"]) };\n  public Mix(HttpClient http) { http.BaseAddress = new Uri("http://shipping:5000"); _httpClient = http; }\n  Task<Shipment> Get(int id) => _httpClient.GetFromJsonAsync<Shipment>($"api/shipments/{id}");\n  Task<Entry> Led(int id) => _ledgerClient.GetFromJsonAsync<Entry>($"api/entries/{id}");\n}\n',
  });
  assert.deepEqual(rows(out, 'Checkout.cs'), ['GET /api/users/{id} -> -', 'GET /api/invoices/{id} -> billing:8080'], "the injected _httpClient never takes _billingClient's base");
  assert.deepEqual(rows(out, 'Catalog.cs'), ['GET /api/items/{id} -> catalog:5000'], 'the typed-client idiom: the base set on the injected parameter');
  assert.deepEqual(rows(out, 'Gh.cs'), ['GET /repos/{n} -> github-proxy:8080'], 'the typed-client idiom: the base set on the field');
  assert.deepEqual(rows(out, 'Nested.cs'), ['GET /api/items/{id} -> catalog-api:8080'], 'a handler constructed inside the client\'s parentheses');
  assert.deepEqual([rows(out, 'Orders.cs'), rows(out, 'OrdersCrlf.cs')], [['GET /api/orders/{id} -> orders:8080', 'GET /health/live -> ping:9000'], ['GET /api/orders/{id} -> orders:8080', 'GET /health/live -> ping:9000']], 'an auto-property initializer and a using local, LF and CRLF');
  assert.deepEqual(rows(out, 'Mix.cs'), ['GET /api/shipments/{id} -> shipping:5000', 'GET /api/entries/{id} -> Ledger:Url']);
  // two receivers, each with its own BaseAddress: a file-wide base would serve neither
  const two = run({ 'Two.cs': 'public class Two {\n  private readonly HttpClient _ordersHttp = new();\n  private readonly HttpClient _usersHttp = new();\n  public Two() {\n    _ordersHttp.BaseAddress = new Uri("http://orders:8080/");\n    _usersHttp.BaseAddress = new Uri("http://users:8080/");\n  }\n  public Task<string> O(int id) => _ordersHttp.GetStringAsync($"api/orders/{id}");\n  public Task<string> U(int id) => _usersHttp.GetStringAsync($"api/users/{id}");\n}\n' });
  assert.deepEqual(rows(two, 'Two.cs'), ['GET /api/orders/{id} -> orders:8080', 'GET /api/users/{id} -> users:8080'], 'each receiver its own BaseAddress');
});

test('M6 shape 6: Micronaut\'s relative @Client("/pets") is a path prefix — pet-store\'s GET /pets/{}, never a root router\'s GET /{}', async () => {
  assert.deepEqual(await edges({
    'pet-store': { 'pom.xml': pom('pet-store'), 'src/main/java/PetController.java': '@Controller("/pets")\npublic class PetController {\n  @Get("/{name}") Pet byName(String name) { return null; }\n}\n' },
    'users-svc': { 'package.json': '{ "name": "users-svc" }\n', 'src/users.js': "const express = require('express');\nconst router = express.Router();\nrouter.get('/:id', getUser);\nmodule.exports = router;\n" },
    'pet-client': { 'pom.xml': pom('pet-client'), 'src/main/java/PetClient.java': '@Client("/pets")\npublic interface PetClient {\n  @Get("/{name}")\n  Pet get(String name);\n}\n' },
  }), ['pet-client -> pet-store http:GET /pets/{} (exact)']);
});

test('M6 shape 6: a declared client path with no literal segment is no route unless a literal host or a service names the provider', () => {
  const out = run({
    'src/main/java/PetClient.java': '@Client("/pets")\npublic interface PetClient {\n  @Get("/{name}")\n  Pet get(String name);\n}\n',
    'src/main/java/Pets2.java': '@Client(id = "pets", path = "/pets")\npublic interface Pets2 {\n  @Get("/{name}") Pet get(String name);\n}\n',
    'src/main/java/GitHub.java': 'public interface GitHub {\n  @RequestLine("GET /{owner}")\n  List<Repo> repos(@Param("owner") String owner);\n}\n',
    'src/main/java/StoreClient.java': '@FeignClient(name = "stores")\npublic interface StoreClient {\n  @GetMapping("/{storeId}")\n  Store get(@PathVariable("storeId") Long storeId);\n}\n',
    'src/main/java/ItemsApi.java': 'public interface ItemsApi {\n  @GET("{id}") Call<Item> get(@Path("id") long id);\n}\n',
  });
  assert.deepEqual(rows(out, 'src/main/java/PetClient.java'), ['GET /pets/{name} -> -'], 'a relative @Client value is a prefix, never a service id');
  assert.deepEqual(rows(out, 'src/main/java/Pets2.java'), ['GET /pets/{name} -> pets']);
  assert.deepEqual(rows(out, 'src/main/java/GitHub.java'), [], '@RequestLine("GET /{owner}") names no host: no route');
  assert.deepEqual(rows(out, 'src/main/java/StoreClient.java'), ['GET /{storeId} -> stores'], 'a service id names the provider: kept, the catalog decides');
  assert.deepEqual(rows(out, 'src/main/java/ItemsApi.java'), [], 'a Retrofit path with no literal segment and no base: no route');
});

// Program.cs registers named clients through lambdas, then minimal-API endpoints call `CreateClient(…)` locals of the
// same name: the lambda parameter's BaseAddress is no base of a receiver outside its lambda (the nearest one above a
// call is some other registration).
const program = (p) => [
  'var builder = WebApplication.CreateBuilder(args);',
  `builder.Services.AddHttpClient("basket", ${p} => ${p}.BaseAddress = new Uri("http://basket-api/"));`,
  `builder.Services.AddHttpClient("catalog", (sp, ${p}) =>`,
  '{',
  `    ${p}.Timeout = TimeSpan.FromSeconds(5);`,
  `    ${p}.BaseAddress = new Uri("http://catalog-api/");`,
  '});',
  'var app = builder.Build();',
  `app.MapGet("/bff/basket", async (IHttpClientFactory f) => { var ${p} = f.CreateClient("basket"); return await ${p}.GetStringAsync("api/basket/items"); });`,
  `app.MapGet("/bff/orders", async (IHttpClientFactory f) => { var ${p} = f.CreateClient("orders"); return await ${p}.GetStringAsync("api/orders"); });`,
  'app.Run();',
  '',
].join('\n');

test('M6 shape 5: a BaseAddress set on a lambda parameter (`AddHttpClient("x", client => …)`) is no base of a same-named receiver outside the lambda', () => {
  const one = 'builder.Services.AddHttpClient("catalog", client => client.BaseAddress = new Uri("http://catalog-api/"));\napp.MapGet("/items", async (IHttpClientFactory f) => { var client = f.CreateClient("catalog"); return await client.GetStringAsync("api/items"); });\n';
  const named = 'builder.Services.AddHttpClient("catalog", c => c.BaseAddress = new Uri("http://catalog-api/"));\napp.MapGet("/items", async (IHttpClientFactory f) => { var client = f.CreateClient("catalog"); return await client.GetStringAsync("/api/items"); });\n';
  // the only registration is `basket`, the endpoint creates `catalog`: a variable named like the lambda parameter
  const other = 'builder.Services.AddHttpClient("basket", client => client.BaseAddress = new Uri("http://basket-api/"));\napp.MapGet("/items", async (IHttpClientFactory f) => { var client = f.CreateClient("catalog"); return await client.GetStringAsync("api/catalog/items"); });\n';
  const out = run({ 'Program.cs': program('client'), 'Gateway/Program.cs': program('http'), 'One/Program.cs': one, 'Other/Program.cs': other, 'Named/Program.cs': named });
  assert.deepEqual(rows(out, 'Program.cs'), [], 'two registrations: a generic `client` takes neither base (no fact), never the nearest lambda above');
  assert.deepEqual(rows(out, 'Gateway/Program.cs'), ['GET /api/basket/items -> -', 'GET /api/orders -> -']);
  assert.deepEqual(rows(out, 'Other/Program.cs'), [], 'a lambda base never serves a receiver by its variable name: `basket` for a `catalog` call is a false exact edge');
  assert.deepEqual(rows(out, 'One/Program.cs'), [], 'not even when the names agree: a generic `client` takes no file base, as at 15486564');
  assert.deepEqual(rows(out, 'Named/Program.cs'), ['GET /api/items -> catalog-api'], 'a lambda parameter named otherwise (`c`): the file\'s one registration is its base');
  // a receiver op 3.27 sees no declaration of — a field of a base class — never takes a lambda base by its variable name
  const inherited = run({ 'Derived/Program.cs': 'builder.Services.AddHttpClient("basket", client => client.BaseAddress = new Uri("http://basket-api/"));\npublic class CatalogProxy : ProxyBase {\n  public CatalogProxy(IHttpClientFactory f) { client = f.CreateClient("catalog"); }\n  public Task<string> Items() => client.GetStringAsync("api/catalog/items");\n}\n' });
  assert.deepEqual(rows(inherited, 'Derived/Program.cs'), [], 'the basket registration never serves the catalog client by its variable name');
});

test('M6 shape 1: a C# nullable expression-bodied property (`string? BaseUrl => …`) is no parameter', () => {
  const out = run({
    'Billing.cs': 'public class Billing {\n  private string? BaseUrl => _configuration["Billing:Url"];\n  public Task<Invoice?> Get(int id) => _http.GetFromJsonAsync<Invoice>($"{BaseUrl}/api/invoices/{id}");\n}\n',
    'web/t.js': "const url = 'http://billing:8080/api';\nexport const f = cond ? url => fetch(url) : null;\nexport const g = (id) => fetch(`${url}/users/${id}`);\n",
  });
  assert.deepEqual(rows(out, 'Billing.cs'), ['GET /api/invoices/{id} -> Billing:Url']);
  assert.deepEqual(rows(out, 'web/t.js'), [], 'a ternary arrow parameter still shadows the const');
});

test('M6 shape 1: `self.base_url = base_url` copies the parameter — never a same-named Python module binding', () => {
  const out = run({ 'svc/e.py': "base_url = 'http://billing:8080/api'\n\nclass UsersClient:\n    def __init__(self, base_url):\n        self.base_url = base_url\n\n    def one(self, uid):\n        return requests.get(f'{self.base_url}/users/{uid}')\n" });
  assert.deepEqual(rows(out, 'svc/e.py'), ['GET /users/{uid} -> self.base_url']);
});

test("M6 shape 1: a parameter's own default is its base (`constructor(baseUrl = …)`, `base_url: str = \"http://…\"`), as at 15486564; beside a same-named binding it stays ambiguous", () => {
  const out = run({
    'web/b.js': "export class BillingClient {\n  constructor(baseUrl = 'http://billing:8080') {\n    this.baseUrl = baseUrl;\n  }\n  one(id) { return fetch(`${this.baseUrl}/api/invoices/${id}`); }\n}\n",
    'web/o.ts': "export class BillingClient {\n  private baseUrl: string;\n  constructor({ baseUrl = process.env.BILLING_URL, token }: Opts = {}) {\n    this.baseUrl = baseUrl;\n  }\n  one(id: string) { return fetch(`${this.baseUrl}/api/invoices/${id}`); }\n}\n",
    'svc/b.py': "class BillingClient:\n    def __init__(self, base_url: str = \"http://billing:8000\"):\n        self.base_url = base_url\n\n    def one(self, uid):\n        return requests.get(f\"{self.base_url}/api/invoices/{uid}\")\n",
    'svc/f.py': "def get_invoice(invoice_id, base_url=\"http://billing:8000\"):\n    return requests.get(f\"{base_url}/api/invoices/{invoice_id}\")\n",
    'web/t.ts': "export async function getUser(id: string, baseUrl: string = 'http://users:8080'): Promise<User> {\n  return (await fetch(`${baseUrl}/api/users/${id}`)).json();\n}\n",
    'web/m.js': "const baseUrl = 'http://users:8080';\nexport function makeClient(baseUrl = process.env.BILLING_URL) { return { one: (id) => fetch(`${baseUrl}/api/invoices/${id}`) }; }\n",
  });
  assert.deepEqual(rows(out, 'web/b.js'), ['GET /api/invoices/${id} -> billing:8080'], 'a constructor default, copied into this.baseUrl');
  assert.deepEqual(rows(out, 'web/o.ts'), ['GET /api/invoices/${id} -> BILLING_URL'], 'a destructured default');
  assert.deepEqual(rows(out, 'svc/b.py'), ['GET /api/invoices/{uid} -> billing:8000'], 'a typed Python default, copied into self.base_url');
  assert.deepEqual([rows(out, 'svc/f.py'), rows(out, 'web/t.ts')], [['GET /api/invoices/{invoice_id} -> billing:8000'], ['GET /api/users/${id} -> users:8080']], 'a function parameter with a default: that default');
  assert.deepEqual(rows(out, 'web/m.js'), [], 'a module binding and a default of one name: ambiguous, never users (a dynamic url)');
});

test("M6 shape 1: a call after a 'function' string (`typeof cb === 'function' ? cb(baseUrl)`) is no parameter list", () => {
  const out = run({ 'web/cb.js': "const baseUrl = process.env.USERS_URL;\nexport function init(cb) { return typeof cb === 'function' ? cb(baseUrl) : baseUrl; }\nexport const getUser = (id) => fetch(`${baseUrl}/users/${id}`);\n" });
  assert.deepEqual(rows(out, 'web/cb.js'), ['GET /users/${id} -> USERS_URL']);
});

test('M6 shape 5: a BaseAddress no receiver row reads is the file\'s base, as at 15486564; one base set twice is one', () => {
  const out = run({
    'Anon.cs': 'public class Startup {\n  public void ConfigureServices(IServiceCollection services) { services.AddSingleton(new HttpClient { BaseAddress = new Uri("http://billing:8080/") }); }\n}\npublic class Billing {\n  private readonly HttpClient _httpClient;\n  public Billing(HttpClient httpClient) { _httpClient = httpClient; }\n  public Task<string> Inv(int id) => _httpClient.GetStringAsync($"api/invoices/{id}");\n}\n',
    'Handler.cs': 'public class Svc {\n  private readonly HttpClient _httpClient = new HttpClient(new SocketsHttpHandler\n  {\n    PooledConnectionLifetime = TimeSpan.FromMinutes(2)\n  })\n  {\n    BaseAddress = new Uri("http://billing:8080/")\n  };\n  public Task<string> Get(int id) => _httpClient.GetStringAsync($"api/invoices/{id}");\n}\n',
    'Headers.cs': 'public class Gh {\n  private readonly HttpClient _httpClient = new HttpClient\n  {\n    DefaultRequestHeaders = { { "User-Agent", "x" } },\n    BaseAddress = new Uri("http://github-proxy:8080/"),\n  };\n  public Task<Repo> Repo(string n) => _httpClient.GetFromJsonAsync<Repo>($"repos/{n}");\n}\n',
    'Helper.cs': 'public class CatalogService {\n  private readonly HttpClient _httpClient;\n  public CatalogService(HttpClient httpClient) { Configure(httpClient); _httpClient = httpClient; }\n  private static void Configure(HttpClient client) => client.BaseAddress = new Uri("http://catalog:5000/");\n  public Task<Item?> GetItem(int id) => _httpClient.GetFromJsonAsync<Item>($"api/v1/items/{id}");\n}\n',
  });
  assert.deepEqual(rows(out, 'Anon.cs'), ['GET /api/invoices/{id} -> billing:8080'], 'an anonymous initializer');
  assert.deepEqual(rows(out, 'Handler.cs'), ['GET /api/invoices/{id} -> billing:8080'], 'a multi-line handler inside new HttpClient(…)');
  assert.deepEqual(rows(out, 'Headers.cs'), ['GET /repos/{n} -> github-proxy:8080'], 'nested braces in the initializer');
  assert.deepEqual(rows(out, 'Helper.cs'), ['GET /api/v1/items/{id} -> catalog:5000'], 'an injected parameter that is also an expression-bodied method\'s: one base');
});

const sync = (p) => `public class Sync {\n  public async Task<string> Invoices() {\n    using var ${p} = new HttpClient { BaseAddress = new Uri("http://billing:8080/") };\n    return await ${p}.GetStringAsync("api/invoices");\n  }\n  public async Task<string> Users(IHttpClientFactory factory) {\n    var ${p} = factory.CreateClient("users");\n    return await ${p}.GetStringAsync("api/users");\n  }\n  public Task<string> Orders(HttpClient ${p}, int id) => ${p}.GetStringAsync($"api/orders/{id}");\n}\n`;

test('M6 shape 5: a .NET local never lends its BaseAddress to a same-named local or parameter of another method', () => {
  const out = run({ 'client/Sync.cs': sync('client'), 'http/Sync.cs': sync('http') });
  assert.deepEqual(rows(out, 'client/Sync.cs'), ['GET /api/invoices -> billing:8080']);
  assert.deepEqual(rows(out, 'http/Sync.cs'), ['GET /api/invoices -> billing:8080', 'GET /api/users -> -', 'GET /api/orders/{id} -> -']);
});

// the MS docs console sample ("Call a Web API from a .NET client") with the client renamed: a static field declared with no
// base, its BaseAddress set in RunAsync — below the methods that call it
const docs = (n) => `class Program\n{\n    static HttpClient ${n} = new HttpClient();\n    static async Task<Uri> CreateProductAsync(Product product)\n    {\n        HttpResponseMessage response = await ${n}.PostAsJsonAsync("api/products", product);\n        return response.Headers.Location;\n    }\n    static void Main() => RunAsync().GetAwaiter().GetResult();\n    static async Task RunAsync()\n    {\n        ${n}.BaseAddress = new Uri("http://orders:8080/");\n        var url = await CreateProductAsync(new Product());\n    }\n}\n`;
// two typed clients in one file share the conventional field name; only one sets a BaseAddress on it (a third BaseAddress
// in the file made 15486564's file base ambiguous: the users call joined users by norm)
const billingCls = 'public class BillingClient\n{\n    private readonly HttpClient _httpClient;\n    public BillingClient(HttpClient httpClient) { _httpClient = httpClient; _httpClient.BaseAddress = new Uri("http://billing:8080/"); }\n    public Task<Invoice?> Get(int id) => _httpClient.GetFromJsonAsync<Invoice>($"api/invoices/{id}");\n}\n';
const usersCls = 'public class UsersClient\n{\n    private readonly HttpClient _httpClient;\n    private static readonly HttpClient _legacyHttp = new HttpClient { BaseAddress = new Uri("http://legacy:8080/") };\n    public UsersClient(HttpClient httpClient) { _httpClient = httpClient; }\n    public Task<User?> Get(int id) => _httpClient.GetFromJsonAsync<User>($"api/users/{id}");\n}\n';

test('M6 shape 5: a .NET field is the client its own assignment configures, wherever that sits, and never another class\'s same-named field', () => {
  const out = run({
    'a/Program.cs': docs('_httpClient'), 'b/Program.cs': docs('client'),
    'Late.cs': 'public class Svc\n{\n    private readonly HttpClient _httpClient;\n    public Task<string> Get(int id) => _httpClient.GetStringAsync($"api/orders/{id}");\n    public Svc() { _httpClient = new HttpClient { BaseAddress = new Uri("http://orders:8080/") }; }\n}\n',
    'Local.cs': 'public class Svc\n{\n    public async Task<string> Users(IHttpClientFactory f)\n    {\n        var http = f.CreateClient("users");\n        return await http.GetStringAsync("api/users");\n    }\n    public void Init() { http.BaseAddress = new Uri("http://billing:8080/"); }\n    private HttpClient http;\n}\n',
    'Init.cs': 'public class Svc\n{\n    private static HttpClient _http = new HttpClient();\n    public Task<string> Users() => _http.GetStringAsync("api/users");\n    public async Task<string> Invoices()\n    {\n        using var _http = new HttpClient { BaseAddress = new Uri("http://billing:8080/") };\n        return await _http.GetStringAsync("api/invoices");\n    }\n}\n',
    'c/Clients.cs': billingCls + usersCls, 'd/Clients.cs': usersCls + billingCls,
    // a BaseAddress read from an options object is no base, as at 15486564: the call joins by its norm, never as a heuristic target
    'Opts.cs': 'public class Opts\n{\n    private readonly HttpClient _httpClient;\n    public Opts(HttpClient h, IOptions<Api> options) { _httpClient = h; _httpClient.BaseAddress = new Uri(options.Value.BaseUrl); }\n    public Task<string> Users() => _httpClient.GetStringAsync("api/users");\n}\n',
  });
  assert.deepEqual([rows(out, 'a/Program.cs'), rows(out, 'b/Program.cs')], [['POST /api/products -> orders:8080'], ['POST /api/products -> orders:8080']], 'the field takes the BaseAddress set below its callers (a generic `client` through its receiver base)');
  assert.deepEqual(rows(out, 'Late.cs'), ['GET /api/orders/{id} -> orders:8080'], 'a constructor below the methods builds the field\'s client');
  assert.deepEqual(rows(out, 'Local.cs'), ['GET /api/users -> -'], 'a method LOCAL never takes the base another method sets');
  assert.deepEqual(rows(out, 'Init.cs'), ['GET /api/users -> -', 'GET /api/invoices -> billing:8080'], "another method's local initializer is another client");
  assert.deepEqual(rows(out, 'Opts.cs'), ['GET /api/users -> -'], 'an options-object BaseAddress names no target');
  assert.deepEqual([rows(out, 'c/Clients.cs'), rows(out, 'd/Clients.cs')], [['GET /api/invoices/{id} -> billing:8080', 'GET /api/users/{id} -> -'], ['GET /api/users/{id} -> -', 'GET /api/invoices/{id} -> billing:8080']], "billing's BaseAddress never serves UsersClient's _httpClient, below or above it");
  // the MS docs sample ("Make HTTP requests with the HttpClient class"): the file's one client, handed to static helpers
  // (a helper's parameter of the same name too); a second client source in the file serves nobody
  const shared = (p, extra = '') => `using HttpClient sharedClient = new()\n{\n    BaseAddress = new Uri("http://orders:8080"),\n};\nawait GetAsync(sharedClient);\n${extra}static async Task GetAsync(HttpClient ${p})\n{\n    using HttpResponseMessage response = await ${p}.GetAsync("/api/orders/3");\n}\n`;
  const one = run({ 'a/Program.cs': shared('httpClient'), 'b/Program.cs': shared('sharedClient'), 'c/Program.cs': shared('httpClient', 'var users = factory.CreateClient("users");\n'), 'd/Program.cs': shared('httpClient', 'app.MapGet("/x", (HttpClient http) => http.GetStringAsync("/x"));\n') });
  assert.deepEqual(['a', 'b', 'c', 'd'].map((d) => rows(one, `${d}/Program.cs`).filter((r) => r.includes('orders'))), [['GET /api/orders/3 -> orders:8080'], ['GET /api/orders/3 -> orders:8080'], ['GET /api/orders/3 -> -'], ['GET /api/orders/3 -> -']], "a file's one HttpClient serves the static helpers it is handed to; a second source serves nobody");
  const two = run({
    // a field declared with no initializer and created in the constructor is ONE client (its declaration is no second source)
    'Probe.cs': 'public class HealthProbe\n{\n    private readonly HttpClient _httpClient;\n    public HealthProbe(IHttpClientFactory factory)\n    {\n        _httpClient = factory.CreateClient();\n        _httpClient.BaseAddress = new Uri("http://orders:8080/");\n    }\n    public Task<bool> CheckAsync() => PingAsync(_httpClient);\n    private static async Task<bool> PingAsync(HttpClient http) => (await http.GetAsync("health/ready")).IsSuccessStatusCode;\n}\n',
    // one client given two different BaseAddresses (a staging switch): neither is its base
    'Staging.cs': 'using HttpClient sharedClient = new();\nif (args.Length > 0) sharedClient.BaseAddress = new Uri("http://orders-staging:8080");\nelse sharedClient.BaseAddress = new Uri("http://orders:8080");\nawait GetAsync(sharedClient);\nstatic async Task GetAsync(HttpClient httpClient)\n{\n    using HttpResponseMessage response = await httpClient.GetAsync("/api/orders/3");\n}\n',
  });
  assert.deepEqual([rows(two, 'Probe.cs'), rows(two, 'Staging.cs')], [['GET /health/ready -> orders:8080'], ['GET /api/orders/3 -> -']], 'a field created in its constructor is one source; two BaseAddresses on one client lend neither');
});

test('M6 shape 5: the .NET declaration scan stays in C# and reads every field modifier and a nullable parameter', () => {
  const out = run({
    'web/api.js': "var api;\nexport function getUsers() { return api.get('/users'); }\nexport function init() { api = axios.create({ baseURL: 'http://users:8080' }); }\n",
    'Priv.cs': 'public class Svc\n{\n    private HttpClient _http;\n    public Task<string> Get() => _http.GetStringAsync("api/orders");\n    public Svc(HttpClient h) { _http = h; _http.BaseAddress = new Uri("http://orders:8080/"); }\n}\n',
    'NulParam.cs': 'public class Svc\n{\n    private static readonly HttpClient http = new HttpClient { BaseAddress = new Uri("http://orders:8080/") };\n    public Task<string> Users(HttpClient? http) => http.GetStringAsync("api/users");\n}\n',
    'NoMod.cs': 'public class Svc\n{\n    HttpClient _http;\n    public Task<string> Get() => _http.GetStringAsync("api/orders");\n    public Svc(HttpClient h) { _http = h; _http.BaseAddress = new Uri("http://orders:8080/"); }\n}\n',
    'web/late.js': "export function init() { api = axios.create({ baseURL: 'http://users:8080' }); }\nvar api;\nexport function getUsers() { return api.get('/users'); }\n",
    'PrivNew.cs': 'public class Svc\n{\n    private HttpClient _http = new HttpClient();\n    public Task<string> Get() => _http.GetStringAsync("api/orders");\n    public Svc(HttpClient h) { _http.BaseAddress = new Uri("http://orders:8080/"); }\n}\n',
  });
  assert.deepEqual(rows(out, 'web/api.js'), ['GET /users -> users:8080'], 'a JS `var api;` is no C# declaration: the one axios base still serves a hoisted function');
  assert.deepEqual(rows(out, 'Priv.cs'), ['GET /api/orders -> orders:8080'], 'a `private` field takes the BaseAddress set below its callers');
  assert.deepEqual(rows(out, 'NulParam.cs'), ['GET /api/users -> -'], 'an `HttpClient? http` parameter is a declaration: it never takes the field\'s base');
  assert.deepEqual(rows(out, 'web/late.js'), ['GET /users -> users:8080'], 'a JS `var api;` below the assignment is no C# declaration either: it never ends the axios base');
  assert.deepEqual(rows(out, 'PrivNew.cs'), ['GET /api/orders -> orders:8080'], 'a `private` field with an initializer takes the BaseAddress set below it');
  assert.deepEqual(rows(out, 'NoMod.cs'), ['GET /api/orders -> orders:8080'], 'a field with no modifier (`HttpClient _http;`, private by default) takes the BaseAddress set below its callers');
});

test('M6 shape 5: typed clients sharing an inherited `Http` member: another subclass\'s BaseAddress never serves one that sets none', () => {
  const sub = (n, host) => `public class ${n}Client : ApiClient\n{\n    public ${n}Client(HttpClient http) : base(http) { ${host ? `Http.BaseAddress = new Uri("http://${host}/");` : ''} }\n    public Task<string> Get(int id) => Http.GetStringAsync($"api/${n.toLowerCase()}/{id}");\n}\n`;
  const api = 'public abstract class ApiClient\n{\n    protected HttpClient Http { get; }\n    protected ApiClient(HttpClient http) { Http = http; }\n}\n';
  const out = run({ 'Clients.cs': api + sub('Billing', 'billing:8080') + sub('Orders', 'orders:8080') + sub('Users', null) });
  assert.deepEqual(rows(out, 'Clients.cs'), ['GET /api/billing/{id} -> -', 'GET /api/orders/{id} -> -', 'GET /api/users/{id} -> -'], 'no declaration in the file: the name has no one base, so no call takes the nearest one above (users is never orders)');
});

// ReDoS guard for the scans M6 adds (the index v2 rule: linear on 1 MiB adversarial input; the bound of
// wsmap-detectors-p4-registry, in CPU time so a loaded machine never fails it: every row takes < 100 ms). A call with
// a non-literal URL makes http-clients build the file's bindings, which reads every parameter list. `func` + a run of
// spaces was quadratic (minutes) with `[ \t]*` on both sides of an optional name.
test('M6: the parameter and .NET BaseAddress scans stay linear on 1 MiB adversarial input (< 2 s of CPU)', () => {
  const MB = 1024 * 1024;
  const fill = (unit, n = MB) => unit.repeat(Math.ceil(n / unit.length)).slice(0, n);
  const js = (s) => `${'// ok\n'.repeat(700)}${s}`.slice(0, MB); // 4 KiB of short lines: never read as minified
  const INPUTS = [
    ['a.go', `http.Get(base + "/x")\nfunc${' '.repeat(MB - 30)}`],
    ['a.go', `http.Get(base + "/x")\n${fill('func (r *T) ')}`],
    ['a.py', `requests.get(BASE + "/x")\ndef${' '.repeat(MB - 40)}`],
    ['a.js', js(`fetch(base + '/x');\n${fill(`(${'a'.repeat(298)})`)}`)],
    ['a.ts', js(`fetch(base + '/x');\n${fill(`(a): ${'T'.repeat(99)} `)}`)],
    ['a.js', js(`fetch(base + '/x');\n${fill(', async a ')}`)],
    ['a.js', js(`fetch(base + '/x');\nconstructor${' '.repeat(MB)}`)],
    ['A.cs', fill('x = new HttpClient { ')],
    ['A.cs', fill(`x = new HttpClient {${' '.repeat(399)}\n`)],
    ['A.cs', fill('x.BaseAddress = new Uri(')],
    ['A.cs', `_c.GetAsync("a");\nx = new${' '.repeat(MB - 30)}`],
    ['A.cs', fill('_c.GetAsync("a"); HttpClient a, ')],
    ['A.cs', `_c.GetAsync("a");\nx.BaseAddress = new Uri("http://a");\n${fill('var x = ')}`],
    ['A.cs', `_c.GetAsync("a");\n${fill('BaseAddress = new Uri(')}`],
    ['a.rb', fill('conn.get("/a/#{')],
    ['A.cs', `h.BaseAddress = new Uri("http://a");\nx${' '.repeat(128 * 1024)}`], // lambdaParams: a name, then a run of blanks and no `=>`
    ['A.cs', `static F(${fill('HttpClient a,static F(', MB - 10)}`], // staticParam: every parameter a static helper's, on one line
  ];
  const member = { key: 'm', name: 'm', dir: '/none', projectDir: '/none' };
  for (const [i, [rel, text]] of INPUTS.entries()) {
    const ctx = { member, members: [member], files: [rel], state: {} };
    const c0 = process.cpuUsage();
    assert.doesNotThrow(() => { detector.detect({ rel, text }, ctx); detector.finish(ctx); }, `INPUTS[${i}] ${rel}`);
    const { user, system } = process.cpuUsage(c0);
    const ms = (user + system) / 1000;
    assert.ok(ms < 2000, `http-clients took ${ms.toFixed(0)} ms of CPU on INPUTS[${i}] ${rel} (${JSON.stringify(text.slice(text.startsWith('// ok') ? 4200 : 0).slice(0, 30))}…)`);
  }
});

// a client object whose base is a name a parameter elsewhere in the file shadows: the object's base is unknown, so its
// relative calls are dynamic urls — never the bare path, which another member serving the unprefixed route would take
const shadowedBases = {
  'a factory taking the same name': ['src/api.ts', "import axios from 'axios';\n\nconst baseURL = 'http://billing:8080/api';\n\nexport const api = axios.create({\n  baseURL: baseURL,\n  headers: { 'Content-Type': 'application/json' },\n});\n\nexport const createServerApi = (baseURL: string, token: string) =>\n  axios.create({ baseURL, headers: { Authorization: `Bearer ${token}` } });\n\nexport const getInvoice = (id: string) => api.get(`/invoices/${id}`);\n"],
  'a setter': ['src/api.js', "import axios from 'axios';\nconst baseUrl = 'http://billing:8080/api';\nexport const api = axios.create({ baseURL: baseUrl });\nexport function setBaseUrl(baseUrl) { api.defaults.baseURL = baseUrl; }\nexport const getInvoice = (id) => api.get(`/invoices/${id}`);\n"],
  'an interface member\'s function type': ['src/api.ts', "import axios from 'axios';\n\nexport interface ApiOptions {\n  onBaseUrlChange?: (baseUrl: string) => void;\n}\n\nconst baseUrl = 'http://billing:8080/api';\nexport const api = axios.create({ baseURL: baseUrl });\n\nexport const getInvoice = (id: string) => api.get(`/invoices/${id}`);\n"],
  'an array callback': ['src/api.js', "import axios from 'axios';\nconst baseUrl = 'http://billing:8080/api';\nexport const api = axios.create({ baseURL: baseUrl });\nexport const mirrors = ['http://a', 'http://b'].map((baseUrl) => axios.create({ baseURL: baseUrl }));\nexport const getInvoice = (id) => api.get(`/invoices/${id}`);\n"],
  'a base derived by concatenation': ['src/api.js', "import axios from 'axios';\nconst baseUrl = 'http://billing:8080';\nexport const api = axios.create({ baseURL: baseUrl + '/api' });\nexport const ping = (baseUrl) => fetch(baseUrl);\nexport const getInvoice = (id) => api.get(`/invoices/${id}`);\n"],
  'a template base': ['src/api.js', "import axios from 'axios';\nconst baseUrl = 'http://billing:8080';\nexport const api = axios.create({ baseURL: `${baseUrl}/api` });\nexport const ping = (baseUrl) => fetch(baseUrl);\nexport const getInvoice = (id) => api.get(`/invoices/${id}`);\n"],
  'a Python client beside a function parameter': ['svc/api.py', "import httpx\n\nBASE_URL = 'http://billing:8080/api'\nclient = httpx.Client(base_url=BASE_URL)\n\ndef healthcheck(BASE_URL):\n    return httpx.get(f'{BASE_URL}/health')\n\ndef get_invoice(invoice_id):\n    return client.get(f'/invoices/{invoice_id}')\n"],
};

test('M6 shape 1: a client object whose base names a parameter-shadowed binding keys no bare path: its relative calls are dynamic urls', () => {
  for (const [label, [file, text]] of Object.entries(shadowedBases)) {
    const out = run({ [file]: text });
    assert.deepEqual(rows(out, file).filter((r) => r.includes('/invoices')), [], `${label}: no bare /invoices key`);
    assert.ok(out.unresolved.some((u) => u.file === file && u.reason === 'dynamic url' && u.raw.includes('invoices')), `${label}: ${JSON.stringify(out.unresolved)}`);
  }
  // …a path with no leading slash too: nothing but the client's base would key it
  const bare = run({ 'src/b.js': "import axios from 'axios';\nconst baseUrl = 'http://billing:8080/api';\nexport const api = axios.create({ baseURL: baseUrl });\nexport function setBaseUrl(baseUrl) { api.defaults.baseURL = baseUrl; }\nexport const all = () => api.get('invoices');\n" });
  assert.deepEqual(rows(bare, 'src/b.js'), []);
  assert.ok(bare.unresolved.some((u) => u.reason === 'dynamic url' && u.raw.includes('invoices')), JSON.stringify(bare.unresolved));
});

test('M6 shape 1 end to end: a client object on a parameter-shadowed base never joins the member serving the unprefixed route', async () => {
  for (const [label, [file, text]] of Object.entries(shadowedBases)) {
    const got = await edges({
      billing: express('billing', '/api/invoices/:id'),
      legacy: express('legacy', '/invoices/:id'),
      web: { 'package.json': '{ "name": "web" }\n', [file]: text },
    });
    assert.deepEqual(got.filter((e) => e.includes('legacy')), [], `${label}: ${JSON.stringify(got)}`);
  }
});

// a member's own value (a class field, a class attribute, a constructor default) is its client's default base: an optional
// constructor parameter or a setter that may replace it never erases it (as at 15486564); a module-level Python binding
// still never serves `self.base_url = base_url`
const ownFields = {
  'a TS class field and an optional constructor parameter': ['src/billing.ts', "export class BillingClient {\n  baseUrl = 'http://billing:8080/api';\n  constructor(baseUrl?: string) {\n    if (baseUrl) this.baseUrl = baseUrl;\n  }\n  invoice(id: string) {\n    return fetch(`${this.baseUrl}/invoices/${id}`);\n  }\n}\n", 'GET /api/invoices/${id} -> billing:8080'],
  'an Angular service field and an arrow setter': ['src/app/billing.service.ts', "@Injectable({ providedIn: 'root' })\nexport class BillingService {\n  private baseUrl = 'http://billing:8080/api';\n  constructor(private http: HttpClient) {}\n  getInvoice(id: string) {\n    return this.http.get<Invoice>(`${this.baseUrl}/invoices/${id}`);\n  }\n  setBaseUrl = (baseUrl: string) => {\n    this.baseUrl = baseUrl;\n  };\n}\n", 'GET /api/invoices/${id} -> billing:8080'],
  'a constructor default and an optional override': ['src/billing.js', "export class BillingClient {\n  constructor(baseUrl) {\n    this.baseUrl = 'http://billing:8080/api';\n    if (baseUrl) this.baseUrl = baseUrl;\n  }\n  invoice(id) {\n    return fetch(`${this.baseUrl}/invoices/${id}`);\n  }\n}\n", 'GET /api/invoices/${id} -> billing:8080'],
  'a Python __init__ default and an optional override': ['svc/billing.py', 'import requests\n\nclass BillingClient:\n    def __init__(self, base_url=None):\n        self.base_url = "http://billing:8080/api"\n        if base_url:\n            self.base_url = base_url\n\n    def invoice(self, invoice_id):\n        return requests.get(f"{self.base_url}/invoices/{invoice_id}")\n', 'GET /api/invoices/{invoice_id} -> billing:8080'],
  'a Python class attribute and an __init__ override': ['svc/billing.py', 'import requests\n\nclass BillingClient:\n    base_url = "http://billing:8080/api"\n\n    def __init__(self, base_url=None):\n        if base_url:\n            self.base_url = base_url\n\n    def invoice(self, invoice_id):\n        return requests.get(f"{self.base_url}/invoices/{invoice_id}")\n', 'GET /api/invoices/{invoice_id} -> billing:8080'],
};

test('M6 shape 1: a member\'s own value (a class field, a class attribute, a constructor default) stays the base of `this.x` / `self.x`, whatever parameter may replace it', async () => {
  for (const [label, [file, text, row]] of Object.entries(ownFields)) {
    assert.deepEqual(rows(run({ [file]: text }), file), [row], label);
    const got = await edges({
      billing: express('billing', '/api/invoices/:id'),
      legacy: express('legacy', '/invoices/:id'),
      web: { 'package.json': '{ "name": "web" }\n', [file]: text },
    });
    assert.deepEqual(got, ['web -> billing http:GET /api/invoices/{} (exact)'], label);
  }
});

test('M6 shape 1: a parameter\'s default copied into `this.x` / `self.x` is no value of the member\'s own: a sibling class copying a plain parameter never takes it', () => {
  const out = run({
    'svc/clients.py': 'import requests\n\n\nclass BillingClient:\n    def __init__(self, base_url: str = "http://billing:8000"):\n        self.base_url = base_url\n\n    def invoice(self, invoice_id):\n        return requests.get(f"{self.base_url}/invoices/{invoice_id}")\n\n\nclass UsersClient:\n    def __init__(self, base_url):\n        self.base_url = base_url\n\n    def user(self, uid):\n        return requests.get(f"{self.base_url}/users/{uid}")\n',
    'src/clients.js': "export class BillingClient {\n  constructor(baseUrl = 'http://billing:8080') {\n    this.baseUrl = baseUrl;\n  }\n\n  invoice(id) {\n    return fetch(`${this.baseUrl}/invoices/${id}`);\n  }\n}\n\nexport class UsersClient {\n  constructor(baseUrl) {\n    this.baseUrl = baseUrl;\n  }\n\n  user(id) {\n    return fetch(`${this.baseUrl}/users/${id}`);\n  }\n}\n",
  });
  assert.deepEqual(out.facts.filter((f) => f.key.includes('/users') && /^billing/.test(f.target ?? '')).map((f) => `${f.file} ${f.key}`), [], 'no users call is keyed under billing');
});
