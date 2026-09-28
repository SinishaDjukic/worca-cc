import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { makeWorkspace, runDetector, assertEvidence } from './helpers/wsmap-fixtures.mjs';
import detector from '../src/core/workspace-map/detectors/http-clients.mjs';

const FILES = {
  'web/api.ts': `const BILLING = process.env.BILLING_URL;
const api = axios.create({ baseURL: 'http://gateway:8000/api' });
export const getUser = (id) => fetch(\`/api/users/\${id}\`);
export const pay = () => fetch('http://billing:8080/v1/pay', { method: 'POST', body });
export const inv = (id) => fetch(\`\${BILLING}/invoices/\${id}\`);
export const env = () => axios.get(process.env.LEDGER_URL + '/entries');
export const list = () => api.get('/orders');
export const typed = () => this.http.get<User[]>('/api/team');
export const obj = () => axios({ method: 'delete', url: '/api/cart' });
export const dyn = (u) => fetch(u);
export const dyn2 = (u) => fetch(u);                // same raw text: reported once
export const login = (c) => api.post('/login', c);  // axios instance + payload: a call, not a route
api.get('/served', async (c) => c.json({}));      // a Hono route on a client-looking receiver, not a call
const cfg = settings.get('theme');                  // not an HTTP client
const v = await redisClient.get(key);               // a generic SDK client: no dynamic-url report
const g = got(field);                               // a bare got() / request() may be any local helper
`,
  'svc/client.py': `import os, requests, httpx
BASE_URL = os.environ["ORDERS_URL"]
def a(i): return requests.get(f"{BASE_URL}/orders/{i}")
def b(): return requests.post("http://billing:8080/invoices", json={})
def c(): return requests.request("PATCH", "/api/items")
client = httpx.Client(base_url="http://catalog:9000")
def d(): return client.get("/products")
def e(): return os.environ.get("X")
`,
  'java/InvoiceService.java': `public class InvoiceService {
    @Value("\${billing.url}")
    private String billingUrl;
    Invoice one(String id) { return restTemplate.getForObject(billingUrl + "/invoices/{id}", Invoice.class, id); }
    void pay() { restTemplate.exchange("http://payments/charge", HttpMethod.POST, entity, Void.class); }
    Mono<X> x() { return webClient.get().uri("/ledger/{id}", 1).retrieve().bodyToMono(X.class); }
    Request r = new Request.Builder().url("http://audit:7000/events").post(body).build();
}
`,
  'java/BillingClient.java': `@FeignClient(name = "billing", path = "/api")
public interface BillingClient {
    @GetMapping("/invoices/{id}")
    Invoice get(@PathVariable("id") String id);
    @RequestLine("POST /refunds")
    void refund();
}
`,
  'java/UserApi.java': `public interface UserApi {
    @GET("users/{id}")
    Call<User> user(@Path("id") String id);
}
`,
  'java/RetrofitConfig.java': 'Retrofit r = new Retrofit.Builder().baseUrl("http://users-svc:8081/").build();\n',
  // CRLF (Windows checkout): same keys, lines and evidence
  'go/client.go': `func f() {
    base := os.Getenv("INVENTORY_URL")
    resp, _ := http.Get(base + "/stock")
    req, _ := http.NewRequestWithContext(ctx, http.MethodPut, "http://inventory/stock/1", nil)
    r2, _ := http.NewRequest("DELETE", fmt.Sprintf("%s/stock/%d", base, id), nil)
    c.R().SetBody(x).Post("http://notify:9000/send")
}
`.replace(/\n/g, '\r\n'),
  'dotnet/Svc.cs': `public class Svc {
    public Svc(HttpClient http) { http.BaseAddress = new Uri("http://shipping:5000"); }
    Task<Shipment> Get(int id) => _httpClient.GetFromJsonAsync<Shipment>($"/shipments/{id}");
    Task Post() => _httpClient.PostAsJsonAsync("/shipments", x);
    var req = new HttpRequestMessage(HttpMethod.Delete, "http://shipping:5000/shipments/1");
}
public interface IRates { [Get("/rates/{code}")] Task<Rate> Rate(string code); }
`,
  'test/client.test.ts': "fetch('http://billing:8080/v1/test');\nfetch(u2);\n",
  'web/more.js': "window.fetch('/api/win');\nfetch(`http://127.0.0.1:${PORT}/json/list`);\nfetch(`/api/config${qs}`);\nfetch('/odata/$metadata');\naxios.get('http://orders:8080/orders/' + id);\n",
  'web/login.js': "api.post('/login', credentials);\n",
  'web/dup.js': "fetch('/api/dup');\nfetch('/api/dup');\n",
  'src/bff.js': "import express from 'express';\nimport axios from 'axios';\nconst app = express();\nconst api = axios.create({ baseURL: 'http://billing:8080' });\napp.get('/me', async (req, res) => {\n  const inv = await api.get('/invoices', { params });\n  res.json(await api.post('/charges', payload));\n});\n",
  'web/app.js': `var a=${'x'.repeat(1200)};fetch('http://tracker.example/collect');\n`,
  'svc/long.py': `# ${'x'.repeat(1200)}\nrequests.get("http://billing:8080/long")\n`,
  'public/vendor/lib.min.js': "!function(){fetch('http://tracker.example/collect')}();\n",
  'mobile/Api.kt': 'suspend fun inv(id: String) = client.get("$baseUrl/invoices/$id")\n',
  'svc/kw.py': 'def f(): return requests.get(url=f"{BASE}/kw", timeout=3)\n',
  'svc/Client.rb': 'HTTParty.get("#{BILLING_URL}/invoices")\n',
  'web/peers.js': "fetch('http://billing:8080/health');\nfetch('http://ledger:8082/health');\nfetch('http://billing/health');\n",
  'web/prefix.ts': [
    "const API = 'http://gateway:8000/api/v1';",
    'const GW = process.env.GW_URL;',
    'export const a = () => fetch(`${API}/users`);',
    'export class UsersService {',
    '  private usersUrl = `${environment.apiUrl}/users`;',
    '  remove(id) { return this.http.delete(`${this.usersUrl}/${id}`); }',
    '}',
    'export const c = (path) => fetch(`${GW}/${path}`);',
    'export const d = (res, id) => axios.get(`/${res}/${id}`);',
    "export const e = () => this.http.get<Page<User>>('/api/pages');",
  ].join('\n') + '\n',
  'web/vite.js': "const billing = axios.create({ baseURL: import.meta.env.VITE_BILLING_URL });\nexport const inv = () => billing.get('/invoices');\n",
  'svc/routes.py': 'from fastapi import APIRouter\napi = APIRouter(prefix="/v1")\n@api.get("/users/{user_id}")\nasync def read(user_id: int): ...\n',
  'svc/env_base.py': 'import httpx\nledger = httpx.Client(base_url=settings.LEDGER_URL)\ndef f(): return ledger.get("/entries")\n',
  'php/routes.php': "<?php\n$app->get('/hello/{name}', function ($req, $res, $args) { return $res; });\n$router->get('/users', 'UserController@index');\n$resp = $this->client->get(\"/orders/{$id}\");\n",
  'java/StoreClient.java': '@FeignClient("stores")\npublic interface StoreClient {\n    @RequestMapping(method = RequestMethod.GET, value = "/stores")\n    List<Store> getStores();\n}\n',
  'java/BookClient.java': '@Client("books")\npublic interface BookClient {\n    @Get(uri = "/books/{id}")\n    Book show(Long id);\n    @Get("/books{?max}")\n    List<Book> list(Integer max);\n}\n',
  'src/typed-bff.ts': "import express from 'express';\nconst app = express();\napp.get('/me', async (req, res) => {\n  res.json(await api.get<User[]>('/users', config));\n});\n",
  'dotnet/Rel.cs': 'public class CatalogClient {\n    Task<List<Item>> All() => _httpClient.GetFromJsonAsync<List<Item>>("api/items");\n    Task<Item> One(int id) => _httpClient.GetFromJsonAsync<Item>($"api/items/{id}");\n    Task Del() => _httpClient.DeleteAsync("api/items/latest");\n    Task<string> Cached() => _redisClient.GetAsync("user:1");\n}\n',
  'web/envbase.js': [
    'const API = `${process.env.ACCOUNTS_URL}/api/v1`;',
    'export const user = (id) => fetch(`${API}/users/${id}`);',
    'const accounts = axios.create({ baseURL: `${import.meta.env.VITE_ACCOUNTS_URL}/api/v1` });',
    "export const me = () => accounts.get('/users/me');",
  ].join('\n') + '\n',
  'svc/fbase.py': 'import httpx\nbilling = httpx.Client(base_url=f"{settings.BILLING_URL}/api")\ndef f(): return billing.get("/invoices")\n',
  'web/reuse.js': [
    'export async function removeUser(id) {',
    '  const url = `${API}/users`;',
    '  return axios.delete(`${url}/${id}`);',
    '}',
    'export async function getOrder(id) {',
    '  const url = `${API}/orders`;',
    '  return axios.get(`${url}/${id}`);',
    '}',
  ].join('\n') + '\n',
  'web/join.js': "const API = 'http://gateway:8000/api/v1';\nexport const a = () => fetch(new URL('/health', API));\n",
  'svc/join.py': 'from urllib.parse import urljoin\nAPI = "http://gateway:8000/api/v1"\ndef f(): return requests.get(urljoin(API, "/status"))\n',
  'dotnet/NotHttp.cs': 'public class Repo {\n    Task<Client> C() => _clientRepository.GetAsync("default");\n    Task<string> S() => _clientSecretStore.GetAsync("db-password");\n    Task<Item> H() => Http.GetFromJsonAsync<Item>("api/items/first");\n}\n',
  'web/catbase.js': "const API = process.env.ACCOUNTS_URL + '/api/v1';\nexport const user = (id) => fetch(`${API}/users/${id}`);\nconst billing = axios.create({ baseURL: process.env.VITE_BILLING_URL + '/api' });\nexport const inv = () => billing.get('/invoices');\n",
  'svc/catbase.py': 'import os, requests\nBASE_URL = os.environ["ORDERS_URL"] + "/api/v1"\ndef a(i): return requests.get(f"{BASE_URL}/orders/{i}")\n',
  'java/InvClient.java': '@FeignClient(name = "inventory", url = "${inventory.url}")\npublic interface InvClient {\n    @GetMapping("/api/stock/{sku}")\n    Stock stock(@PathVariable("sku") String sku);\n}\n',
  'java/GithubClient.java': '@Client("https://api.github.com")\npublic interface GithubClient {\n    @Get("/repos/{owner}")\n    List<Repo> repos(String owner);\n}\n',
  'src/typed-router.ts': "import express, { Router } from 'express';\nconst api = express.Router();\napi.get<{ id: string }>('/users/:id', getUser);\n",
  'web/reuse2.js': 'export function a() {\n  const url = `${API}/users`;\n  return axios.get(`${url}/recent`);\n}\nexport function b() {\n  const url = `${API}/orders`;\n  return axios.get(`${url}/recent`);\n}\n',
  'web/relbase.js': "const api = axios.create({ baseURL: '/api/v1' });\nexport const me = () => api.get('/users/me');\n",
  'svc/perfn.py': 'import os, httpx\nBILLING_URL = os.environ["BILLING_URL"]\nUSERS_URL = os.environ["USERS_URL"]\n\n\nasync def get_invoice(i):\n    async with httpx.AsyncClient(base_url=BILLING_URL) as client:\n        return await client.get(f"/invoices/{i}")\n\n\nasync def get_user(i):\n    async with httpx.AsyncClient(base_url=USERS_URL) as client:\n        return await client.get(f"/users/{i}")\n',
  'web/perfn.js': "export function billing() { const api = axios.create({ baseURL: 'http://billing:8080/api' }); return api.get('/invoices'); }\nexport function users() { const api = axios.create({ baseURL: 'http://users:8081/v1' }); return api.get('/users'); }\n",
  'web/hoisted.js': "export const list = () => api.get('/orders');\nconst api = axios.create({ baseURL: 'http://orders:9000/api' });\n",
  'svc/black.py': "import os, httpx\nasync def f():\n    async with httpx.AsyncClient(\n        base_url=\"http://billing:8080/api\", timeout=30.0\n    ) as client:\n        return await client.get(\"/invoices\")\n\nasync def g():\n    async with httpx.AsyncClient(timeout=10, transport=httpx.AsyncHTTPTransport(retries=3), base_url=os.environ.get(\"ORDERS_URL\", \"http://x\")) as c:\n        return await c.get(\"/orders\")\n\ndef h(client):\n    return client.get(\"/health\")\n",
  'svc/modwith.py': "import httpx\nclient = httpx.Client(base_url=\"http://orders:8080/api\")\ndef f():\n    with httpx.Client(base_url=\"http://billing:8080/api\") as client:\n        return client.get(\"/invoices\")\ndef g():\n    return client.get(\"/orders\")\n",
  'web/ngbase.ts': "export class S {\n  private apiUrl = environment.apiUrl + '/api/v1';\n  one(id) { return this.http.get(`${this.apiUrl}/users/${id}`); }\n}\n",
  'web/reuse3.js': "export function a() {\n  const url = API + '/users';\n  return axios.get(`${url}/recent`);\n}\nexport function b() {\n  const url = API + '/orders';\n  return axios.get(`${url}/recent`);\n}\n",
  'dotnet/Prop.cs': "public class OrdersClient {\n  private readonly HttpClient _httpClient;\n  private string BaseUrl => _configuration[\"Orders:BaseUrl\"];\n  public Task<Order> Get(string id) => _httpClient.GetFromJsonAsync<Order>($\"{BaseUrl}/api/orders/{id}\");\n}\n",
  'java/ValueFirst.java': "public class OrdersClient {\n  private final String baseUrl;\n  public OrdersClient(@Value(\"${orders.url}\") String ordersUrl) { this.baseUrl = ordersUrl + \"/api/v1\"; }\n  Order one(String id) { return restTemplate.getForObject(baseUrl + \"/orders/\" + id, Order.class); }\n}\n",
  'web/tplhost.js': "const API = `http://${process.env.ACCOUNTS_HOST}:3000` + '/api/v1';\nexport const me = () => fetch(`${API}/users/me`);\n",
  'svc/fhost.py': "import os, httpx\nclient = httpx.Client(base_url=f\"http://{os.environ['ACCOUNTS_HOST']}:8000/api/v1\")\ndef me(): return client.get(\"/users/me\")\n",
  'web/tenant.js': "const API = `https://api.acme.com/${process.env.TENANT}/v1`;\nexport const u = (id) => fetch(`${API}/users/${id}`);\n",
  'web/override.js': "let API = process.env.X;\nAPI = API + '/api/v1';\nexport const u = () => fetch(`${API}/users`);\n",
  'web/b.service.ts': "export class BService {\n  private baseUrl = environment.apiUrl;\n  list() { const baseUrl = `${this.baseUrl}/reports`; return this.http.get(`${baseUrl}/daily`); }\n  one(id) { return this.http.get(`${this.baseUrl}/orders/${id}`); }\n}\n",
  'src/mixed.ts': "import { Router } from 'express';\nexport function mount(api: Router) {\n  api.get('/health', health);\n}\nexport async function loadOrders(api: AxiosInstance) {\n  return api.get<Order[]>('/orders', { params: { page: 1 } });\n}\n",
  'web/tplbase.js': "const api = axios.create({ baseURL: `http://${host}:${port}/api/v1` });\nexport const list = () => api.get('/orders');\n",
  'svc/tplbase.py': "import httpx\nclient = httpx.Client(base_url=f\"http://{ORDERS_HOST}:8000/api/v1\")\ndef f(): return client.get(\"/orders\")\n",
  'svc/debug.py': "import os, requests\nBASE = \"http://localhost:8000\" if DEBUG else os.environ[\"ORDERS_URL\"]\ndef f():\n    return requests.get(f\"{BASE}/orders\")\n",
  'web/relprefix.js': "const API_PREFIX = '/api/v1';\nconst USERS = API_PREFIX + '/users';\nexport const getUser = (id) => fetch(`${USERS}/${id}`);\n",
  'svc/sqlblock.py': "import httpx\nwith httpx.Client(base_url=\"http://orders:8000\") as client:\n    q = \"\"\"\nselect 1\n\"\"\"\n    client.get(\"/orders\")\n",
  'svc/typed.py': "import httpx\nclass C:\n    def __init__(self):\n        self.client: httpx.AsyncClient = httpx.AsyncClient(base_url=\"http://billing:8080/api\")\n    async def f(self):\n        return await self.client.get(\"/invoices\")\n",
  'web/typed.ts': "const api: AxiosInstance = axios.create({ baseURL: 'http://gw:8000/api' });\nexport const f = () => api.get('/orders');\n",
  'web/alias.ts': "export class S {\n  constructor() { const baseUrl = process.env.ORDERS_URL; this.baseUrl = baseUrl; }\n  one() { return this.http.get(`${this.baseUrl}/orders`); }\n}\n",
  'svc/withbase.py': 'import httpx\nasync def f():\n    async with httpx.AsyncClient(base_url="http://billing:8080/api") as client:\n        return await client.get("/invoices")\n',
  'php/lumen.php': "<?php\n$router->get('/profile', ['as' => 'profile', 'uses' => 'UserController@showProfile']);\n$router->get('/admin', ['middleware' => 'auth', function () { return 1; }]);\n$r = $client->get('/users', ['query' => ['page' => 1]]);\n",
  // implementation review cycle 1: a typed axios instance in a BFF, per-function instances whose base is a config value, a with block
  // over a parameter base, a pydantic-settings base, a CRLF blank line inside a with block, NestJS HttpService, switch labels
  'src/fix1/typed-bff.ts': "import express from 'express';\nimport axios, { AxiosInstance } from 'axios';\nconst app = express();\nconst usersApi: AxiosInstance = axios.create({ baseURL: 'http://users-svc:8080' });\napp.post('/signup', async (req, res) => { const r = await usersApi.post('/users', req.body); res.json(r.data); });\n",
  'web/fix1/perfn.js': "export function billing() { const api = axios.create({ baseURL: 'http://billing:8080' }); return api.get('/invoices'); }\nexport function users(id) { const api = axios.create({ baseURL: config.usersUrl }); return api.get(`/users/${id}`); }\n",
  'svc/fix1/param.py': 'import httpx\nclient = httpx.Client(base_url="http://orders:8080")\ndef users(base_url):\n    with httpx.Client(base_url=base_url) as client:\n        return client.get("/users")\n',
  'svc/fix1/settings.py': 'import httpx\nfrom app.config import settings\nbilling = httpx.AsyncClient(base_url=settings.billing_url)\nasync def inv(i):\n    return await billing.get(f"/invoices/{i}")\n',
  'svc/fix1/caller.py': 'import os, httpx\nasync def a(i):\n    async with httpx.AsyncClient(base_url=os.environ["BILLING_URL"]) as client:\n\n        return await client.get(f"/invoices/{i}")\n'.replace(/\n/g, '\r\n'),
  'src/fix1/gateway.service.ts': "@Injectable()\nexport class GatewayService {\n  constructor(private readonly httpService: HttpService) {}\n  order(id: string) { return this.httpService.get(`http://orders:3000/api/orders/${id}`); }\n}\n",
  'web/fix1/switch.ts': "let api: any;\nswitch (env) {\n  case prod: api = axios.create({ baseURL: 'http://prod:1' }); break;\n  default: api = axios.create({ baseURL: 'http://dev:2' });\n}\nexport const f = () => api.get('/orders');\n",
  // one step off each: a non-client name whose base is a plain config name (read) beside one whose base is undefined
  // (still unknown); an injected cache service (no HTTP client); a nested type argument on a router (a route)
  'web/fix1/envbase.ts': "const orders = axios.create({ baseURL: environment.apiUrl });\nconst stub = axios.create({ baseURL: undefined });\nexport const list = () => orders.get('/orders');\nexport const none = () => stub.get('/stubs');\n",
  'src/fix1/cache.service.ts': "@Injectable()\nexport class CacheService {\n  constructor(private readonly cacheService: CacheStore) {}\n  k() { return this.cacheService.get('/k'); }\n}\n",
  'src/fix1/router-generic.ts': "import express from 'express';\nconst api = express.Router();\napi.get<Array<User>>('/users', getUsers);\n",
  // implementation review cycle 2: a qualified switch label (`case Env.Prod:`) is no instance name
  'src/fix2/case-bff.ts': "import express from 'express';\nimport axios from 'axios';\nconst app = express();\nswitch (env) { case Env.Prod: api = axios.create({ baseURL: 'http://prod:1' }); break; }\napp.get('/me', async (req, res) => { res.json(await api.post('/charges', payload)); });\n",
  'src/fix2/case-bff-deep.ts': "import express from 'express';\nimport axios from 'axios';\nconst app = express();\nswitch (env) { case Stage.Env.PROD: api = axios.create({ baseURL: 'http://prod:1' }); break; }\napp.get('/me', async (req, res) => { res.json(await api.post('/charges', payload)); });\n",
  // … and a base P1 reads as a public dotted host (same origin, a lowercase config path) names no target
  'web/fix2/origin.js': "const api = axios.create({ baseURL: window.location.origin });\nconst cfg = axios.create({ baseURL: config.api });\nexport const user = (id) => api.get(`/users/${id}`);\nexport const team = (id) => cfg.get(`/teams/${id}`);\n",
  // one step off: a URL built from an origin is absolute (axios ignores the instance's baseURL for it), an internal-suffix name
  // names its member, a relative-path constant is still prefixed by the instance's base, a templated baseURL keeps its path
  'web/fix2/abs-tpl.js': "const api = axios.create({ baseURL: 'http://billing:8080' });\nexport const f = (id) => api.get(`${window.location.origin}/users/${id}`);\n",
  'web/fix2/abs-bind.js': "const api = axios.create({ baseURL: 'http://billing:8080' });\nconst B = `${window.location.origin}/api`;\nexport const f = (id) => api.get(`${B}/users/${id}`);\n",
  'web/fix2/abs-concat.js': "const api = axios.create({ baseURL: 'http://billing:8080' });\nconst B = config.api + '/api';\nexport const f = (id) => api.get(`${B}/users/${id}`);\nexport const g = (id) => api.get(config.api + '/teams/' + id);\n",
  'web/fix2/internal.js': "const api = axios.create({ baseURL: 'http://billing:8080' });\nconst B = `${billing.internal}/api`;\nexport const f = (id) => api.get(`${B}/invoices/${id}`);\n",
  'web/fix2/rel-bind.js': "const api = axios.create({ baseURL: 'http://billing:8080' });\nconst B = '/api';\nexport const f = (id) => api.get(`${B}/invoices/${id}`);\n",
  'web/fix2/tpl-base.js': "const api = axios.create({ baseURL: `${window.location.origin}/api` });\nexport const f = (id) => api.get(`/users/${id}`);\n",
  // implementation review cycle 3: a config KEY P1 reads as a public host (`billing.api`, `services.billing`) names no target
  // either — Feign falls back to its service name; a positional Micronaut URL is no service id; the key's URL is absolute
  'java/fix3/FeignKey.java': '@FeignClient(name = "billing", url = "${billing.api}")\npublic interface BillingClient {\n    @GetMapping("/invoices/{id}")\n    Invoice one(@PathVariable String id);\n}\n',
  'java/fix3/FeignTplHost.java': '@FeignClient(name = "billing", url = "http://${BILLING_HOST}:8080")\npublic interface BillingClient {\n    @GetMapping("/invoices/{id}")\n    Invoice one(@PathVariable String id);\n}\n',
  // … and a same-name templated-host binding never erases the key's `absolute` (the instance / file base would prefix it)
  'src/fix3/collide.ts': "const api = axios.create({ baseURL: 'http://users:8081' });\nexport class BillingService {\n  get(id) { const base = this.configService.get('billing.api'); return api.get(`${base}/invoices/${id}`); }\n  local() { const base = `http://localhost:${this.port}`; return base; }\n}\n",
  'kt/fix3/Collide.kt': '@Service\nclass BillingClient {\n  @Value("\\${billing.api}") lateinit var base: String\n  private val webClient = WebClient.create("http://users:8081")\n  fun get(id: String) = restTemplate.getForObject(base + "/invoices/{id}", Invoice::class.java, id)\n}\nclass LocalClient(val port: Int) {\n  private val base = "http://localhost:${port}"\n}\n',
  'java/fix3/MicronautKey.java': '@Client("${billing.api}")\npublic interface BillingClient {\n    @Get("/invoices/{id}")\n    Invoice one(String id);\n}\n',
  'java/fix3/ValueFile.java': 'public class Invoices {\n    @Value("${services.billing}")\n    private String base;\n    WebClient users = WebClient.create("http://users-svc:8081");\n    Invoice one(String id) { return restTemplate.getForObject(base + "/invoices/{id}", Invoice.class, id); }\n}\n',
  'src/fix3/billing.service.ts': "const api = axios.create({ baseURL: 'http://users:8081' });\nconst B = this.configService.get('billing.api');\nconst cfg = axios.create({ baseURL: this.configService.get('app.billing-service') });\nexport const a = (id) => this.http.get(`${this.configService.get('billing.api')}/invoices/${id}`);\nexport const b = (id) => api.get(`${this.configService.get('services.billing')}/receipts/${id}`);\nexport const c = (id) => api.get(`${B}/refunds/${id}`);\nexport const d = (id) => cfg.get(`/credits/${id}`);\n",
};

const RETROFIT_API = 'public interface UserApi {\n    @GET("users/{id}")\n    Call<User> user(@Path("id") String id);\n}\n';
let ws;
let ws2;
let r;
before(async () => {
  ws = await makeWorkspace({ app: FILES });
  r = await runDetector(detector, ws.members[0], ws.members);
  ws2 = await makeWorkspace({
    many: { 'src/many.js': `${Array.from({ length: 60 }, (_, i) => `fetch(u${i});`).join('\n')}\n` },
    twobases: {
      'java/UserApi.java': RETROFIT_API,
      'java/A.java': 'Retrofit a = new Retrofit.Builder().baseUrl("http://users-svc:8081/").build();\n',
      'java/B.java': 'Retrofit b = new Retrofit.Builder().baseUrl("http://orders-svc:8082/").build();\n',
    },
    // two builders whose config keys both name no host: still two bases, never one whose prefix every interface takes
    twokeys: {
      'java/RetrofitConfig.java': '@Configuration\npublic class RetrofitConfig {\n  @Value("${billing.api}") private String billingBase;\n  @Value("${users.api}") private String usersBase;\n  @Bean Retrofit billing() { return new Retrofit.Builder().baseUrl(billingBase).build(); }\n  @Bean Retrofit users() { return new Retrofit.Builder().baseUrl(usersBase + "/api/").build(); }\n}\n',
      'java/BillingApi.java': 'public interface BillingApi {\n    @GET("invoices/{id}")\n    Call<Invoice> get(@Path("id") String id);\n}\n',
    },
  });
});
after(async () => { await ws.cleanup(); await ws2.cleanup(); });
const rows = (file) => r.facts.filter((f) => f.file === file).map((f) => `${f.key} -> ${f.target ?? '-'}`);

test('http-clients (JS): fetch / axios / Angular generics / axios.create baseURL / env bases / object form; routes and non-clients skipped', () => {
  assert.deepEqual(rows('web/api.ts').sort(), [
    'DELETE /api/cart -> -', 'GET /api/orders -> gateway:8000', 'GET /api/team -> -', 'GET /api/users/${id} -> -',
    'GET /entries -> LEDGER_URL', 'GET /invoices/${id} -> BILLING_URL', 'POST /api/login -> gateway:8000', 'POST /v1/pay -> billing:8080',
  ]);
  assert.equal(r.facts.find((f) => f.key === 'GET /invoices/${id}').norm, 'http:GET /invoices/{}');
  assert.ok(r.unresolved.some((u) => u.file === 'web/api.ts' && u.reason === 'dynamic url' && u.raw.includes('fetch(u')));
  assert.deepEqual(rows('src/bff.js').sort(), ['GET /invoices -> billing:8080', 'POST /charges -> billing:8080'], 'an axios instance of a server file is still a client');
  assert.deepEqual(rows('web/login.js'), ['POST /login -> -'], 'an api instance created elsewhere, with a payload, is a client call');
  assert.deepEqual(rows('web/dup.js'), ['GET /api/dup -> -'], 'one fact per (dir, key) per file');
});

test('http-clients (Python): requests / f-string env base / requests.request / httpx base_url; dict.get ignored', () => {
  assert.deepEqual(rows('svc/client.py').sort(), ['GET /orders/{i} -> ORDERS_URL', 'GET /products -> catalog:9000', 'PATCH /api/items -> -', 'POST /invoices -> billing:8080']);
});

test('http-clients (Java): RestTemplate with @Value base, exchange HttpMethod, WebClient uri, OkHttp builder method', () => {
  assert.deepEqual(rows('java/InvoiceService.java').sort(), ['GET /invoices/{id} -> billing.url', 'GET /ledger/{id} -> -', 'POST /charge -> payments', 'POST /events -> audit:7000']);
});

test('http-clients: Feign (name + path prefix, Spring mapping and @RequestLine); Retrofit gets the member\'s single baseUrl', () => {
  assert.deepEqual(rows('java/BillingClient.java'), ['GET /api/invoices/{id} -> billing', 'POST /api/refunds -> billing']);
  assert.deepEqual(rows('java/UserApi.java'), ['GET /users/{id} -> users-svc:8081']);
});

test('http-clients (Go): http.Get with env base var, NewRequest methods, Sprintf base, resty', () => {
  assert.deepEqual(rows('go/client.go').sort(), ['DELETE /stock/%d -> INVENTORY_URL', 'GET /stock -> INVENTORY_URL', 'POST /send -> notify:9000', 'PUT /stock/1 -> inventory']);
});

test('http-clients (.NET): HttpClient with BaseAddress, HttpRequestMessage, Refit interface', () => {
  assert.deepEqual(rows('dotnet/Svc.cs').sort(), ['DELETE /shipments/1 -> shipping:5000', 'GET /rates/{code} -> -', 'GET /shipments/{id} -> shipping:5000', 'POST /shipments -> shipping:5000']);
});

test('http-clients: minified bundles are never scanned (by path, and JS-family files by a > 1 000-char line)', () => {
  for (const rel of ['public/vendor/lib.min.js', 'web/app.bundle.js', 'static/js/main.js', 'web/x.chunk.js', 'assets/vendor/a.js']) assert.equal(detector.claims(rel), false, rel);
  assert.deepEqual(rows('web/app.js'), [], 'a minified JS file is skipped whatever its name');
  assert.deepEqual(rows('svc/long.py'), ['GET /long -> billing:8080'], 'a long line never skips a non-JS file');
});

test('http-clients: window.fetch, a templated host keeps its path, a glued ${…} query suffix is dropped, a $ in a JS path is text', () => {
  assert.deepEqual(rows('web/more.js').sort(), ['GET /api/config -> -', 'GET /api/win -> -', 'GET /json/list -> -', 'GET /odata/$metadata -> -', 'GET /orders/{} -> orders:8080']);
});

test('http-clients: unresolved hygiene — none from test files or generic SDK clients or bare got(); one per raw text; ≤ 50 per member', async () => {
  assert.ok(!r.unresolved.some((u) => u.file === 'test/client.test.ts'));
  assert.ok(!r.unresolved.some((u) => /redisClient|got\(/.test(u.raw)), JSON.stringify(r.unresolved));
  assert.equal(r.unresolved.filter((u) => u.file === 'web/api.ts' && u.raw.startsWith('fetch(u)')).length, 1);
  const many = await runDetector(detector, ws2.members.find((m) => m.key === 'many'), ws2.members);
  assert.equal(many.unresolved.length, 50);
});

test('http-clients: a Retrofit interface gets the member\'s base only when there is exactly one', async () => {
  const two = await runDetector(detector, ws2.members.find((m) => m.key === 'twobases'), ws2.members);
  assert.deepEqual(two.facts.map((f) => `${f.key} -> ${f.target ?? '-'}`), ['GET /users/{id} -> -']);
  const keys = await runDetector(detector, ws2.members.find((m) => m.key === 'twokeys'), ws2.members);
  assert.deepEqual(keys.facts.map((f) => `${f.key} -> ${f.target ?? '-'}`), ['GET /invoices/{id} -> -'], 'two builders with no target are still two bases: no /api prefix');
});

test('http-clients: Kotlin "$base/x", Ruby "#{BASE}/x" templates and Python url= keyword arguments', () => {
  assert.deepEqual(rows('mobile/Api.kt'), ['GET /invoices/{id} -> baseUrl']);
  assert.deepEqual(rows('svc/Client.rb'), ['GET /invoices -> BILLING_URL']);
  assert.deepEqual(rows('svc/kw.py'), ['GET /kw -> BASE']);
});

test('http-clients: two peers reached by one path stay two consumes (one per target host)', () => {
  assert.deepEqual(rows('web/peers.js'), ['GET /health -> billing:8080', 'GET /health -> ledger:8082'], 'billing and billing:8080 are one host');
});

test('http-clients: base paths prefix calls, a path with no literal segment is unresolved, nested generics, .NET relative URIs, env bases, PHP {$id}; route declarations are not calls', () => {
  assert.deepEqual(rows('web/prefix.ts').sort(), ['DELETE /users/${id} -> environment.apiUrl', 'GET /api/pages -> -', 'GET /api/v1/users -> gateway:8000']);
  const dyn = r.unresolved.filter((u) => u.file === 'web/prefix.ts').map((u) => u.raw);
  assert.ok(dyn.some((x) => x.includes('${GW}/${path}')) && dyn.some((x) => x.includes('/${res}/${id}')), JSON.stringify(dyn));
  assert.deepEqual(rows('web/vite.js'), ['GET /invoices -> VITE_BILLING_URL']);
  assert.deepEqual(rows('svc/env_base.py'), ['GET /entries -> LEDGER_URL']);
  assert.deepEqual(rows('svc/routes.py'), [], 'a FastAPI @api.get decorator is a route');
  assert.deepEqual(rows('php/routes.php'), ['GET /orders/{id} -> -'], 'Slim / Lumen route declarations are routes');
  assert.equal(r.facts.find((f) => f.file === 'php/routes.php').norm, 'http:GET /orders/{}');
  assert.deepEqual(rows('java/StoreClient.java'), ['GET /stores -> stores'], "Feign's positional value is the client name");
  assert.deepEqual(rows('dotnet/Rel.cs').sort(), ['DELETE /api/items/latest -> -', 'GET /api/items -> -', 'GET /api/items/{id} -> -']);
});

test('http-clients: env-derived bases keep their path, a reused local base is ambiguous, new URL / urljoin resolve from the host, .NET relative URIs need an HTTP receiver, Lumen route arrays are routes', () => {
  assert.deepEqual(rows('web/envbase.js').sort(), ['GET /api/v1/users/${id} -> ACCOUNTS_URL', 'GET /api/v1/users/me -> VITE_ACCOUNTS_URL']);
  assert.deepEqual(rows('svc/fbase.py'), ['GET /api/invoices -> BILLING_URL']);
  assert.deepEqual(rows('web/reuse.js'), [], 'url is bound to /users and to /orders: never the last one for both');
  assert.equal(r.unresolved.filter((u) => u.file === 'web/reuse.js').length, 2);
  assert.deepEqual(rows('web/join.js'), ['GET /health -> gateway:8000']);
  assert.deepEqual(rows('svc/join.py'), ['GET /status -> gateway:8000']);
  assert.deepEqual(rows('dotnet/NotHttp.cs'), ['GET /api/items/first -> -']);
  assert.deepEqual(rows('php/lumen.php'), ['GET /users -> -']);
});

test('http-clients: Micronaut uri= and query templates; a typed api call in a server file is a client call', () => {
  assert.deepEqual(rows('java/BookClient.java'), ['GET /books/{id} -> books', 'GET /books -> books']);
  assert.deepEqual(rows('src/typed-bff.ts'), ['GET /users -> -']);
});

test('http-clients: a fully literal root call is neither a fact nor a dynamic url; a templated root under a base stays unresolved', async () => {
  const w = await makeWorkspace({ lg: { 'locustfile.py': 'def index(l):\n    l.client.get("/")\n', 'web/root.ts': "export const a = () => axios.get('/?page=2');\nconst GW = process.env.GW_URL;\nexport const b = () => fetch(`${GW}/`);\nexport const c = (p) => fetch(`/?page=${p}`);\nexport const d = (q) => client.get('/?q=' + q);\n" } });
  try {
    const out = await runDetector(detector, w.members[0], w.members);
    assert.deepEqual(out.facts.map((f) => f.key), []);
    assert.deepEqual(out.unresolved.map((u) => `${u.file} ${u.reason}`), ['web/root.ts dynamic url']);
  } finally { await w.cleanup(); }
});

test('http-clients: a base derived by concatenation keeps its path; a client URL naming a config key is heuristic, a positional URL is a host', () => {
  assert.deepEqual(rows('web/catbase.js').sort(), ['GET /api/invoices -> VITE_BILLING_URL', 'GET /api/v1/users/${id} -> ACCOUNTS_URL']);
  assert.deepEqual(rows('svc/catbase.py'), ['GET /api/v1/orders/{i} -> ORDERS_URL']);
  const conf = (file) => r.facts.filter((f) => f.file === file).map((f) => `${f.key} -> ${f.target} ${f.confidence}`);
  assert.deepEqual(conf('java/InvClient.java'), ['GET /api/stock/{sku} -> inventory.url heuristic'], 'url = "${inventory.url}" names a config key');
  assert.deepEqual(conf('java/GithubClient.java'), ['GET /repos/{owner} -> api.github.com exact'], 'a positional @Client URL is a host, not a service id');
  assert.deepEqual(rows('src/typed-router.ts'), [], 'a typed call on a router the file creates is a route');
  assert.deepEqual(rows('web/reuse2.js'), [], 'a use of an ambiguous name is never GET /recent');
  assert.equal(r.unresolved.filter((u) => u.file === 'web/reuse2.js').length, 1, 'one raw text, reported once');
  assert.deepEqual(rows('web/relbase.js'), ['GET /api/v1/users/me -> -'], 'a relative axios base prefixes the call');
  assert.deepEqual(rows('svc/withbase.py'), ['GET /api/invoices -> billing:8080'], 'async with httpx.AsyncClient(base_url=…) as client');
});

test('http-clients: a client created per function takes the nearest base above the call, never the file\'s last one', () => {
  assert.deepEqual(rows('svc/perfn.py'), ['GET /invoices/{i} -> BILLING_URL', 'GET /users/{i} -> USERS_URL'], 'async with httpx.AsyncClient(base_url=…) as client, once per function');
  assert.deepEqual(rows('web/perfn.js'), ['GET /api/invoices -> billing:8080', 'GET /v1/users -> users:8081']);
  assert.deepEqual(rows('web/hoisted.js'), ['GET /api/orders -> orders:9000'], 'one base, defined below its use, still applies');
  assert.deepEqual(rows('svc/black.py'), ['GET /api/invoices -> billing:8080', 'GET /orders -> ORDERS_URL', 'GET /health -> -'], 'black line breaks, base_url after other keywords; a parameter named client outside every block has no base');
  assert.deepEqual(rows('svc/modwith.py'), ['GET /api/invoices -> billing:8080', 'GET /api/orders -> orders:8080'], 'a with block never lends its base to the module client');
});

test('http-clients: v6 bases — a concatenation names an unknown base, a templated host is no host, typed C# properties, @Value first, self-derived reassignments, locals never answer this.x, a name typed as a client elsewhere', () => {
  assert.deepEqual(rows('web/ngbase.ts'), ['GET /api/v1/users/${id} -> environment.apiUrl'], "environment.apiUrl + '/api/v1' keeps its path");
  assert.deepEqual(rows('web/reuse3.js'), [], 'a use of a name concatenated from two bases is never GET /recent');
  assert.deepEqual(rows('dotnet/Prop.cs'), ['GET /api/orders/{id} -> Orders:BaseUrl']);
  assert.deepEqual(rows('java/ValueFirst.java'), ['GET /api/v1/orders/{} -> orders.url']);
  assert.deepEqual(rows('web/tplhost.js'), ['GET /api/v1/users/me -> ACCOUNTS_HOST']);
  assert.deepEqual(rows('svc/fhost.py'), ['GET /api/v1/users/me -> ACCOUNTS_HOST'], 'never the exact target {os.environ[');
  assert.deepEqual(rows('web/tenant.js'), ['GET /${process.env.TENANT}/v1/users/${id} -> api.acme.com']);
  assert.deepEqual(rows('web/override.js'), ['GET /api/v1/users -> X']);
  assert.deepEqual(rows('web/b.service.ts').sort(), ['GET /orders/${id} -> this.baseUrl', 'GET /reports/daily -> this.baseUrl'], 'the local baseUrl never prefixes this.baseUrl');
  assert.deepEqual(rows('src/mixed.ts'), ['GET /orders -> -'], 'api: AxiosInstance: the typed call is a client call');
  assert.deepEqual([rows('web/tplbase.js'), rows('svc/tplbase.py')], [['GET /api/v1/orders -> -'], ['GET /api/v1/orders -> -']], 'a templated-host base keeps its path, with no target');
  assert.deepEqual(rows('svc/debug.py'), ['GET /orders -> ORDERS_URL'], 'the literal is a fallback, the env read the base');
  assert.deepEqual(rows('web/relprefix.js'), ['GET /api/v1/users/${id} -> -'], "API_PREFIX + '/users' keeps /api/v1");
  assert.deepEqual(rows('svc/sqlblock.py'), ['GET /orders -> orders:8000'], 'a column-0 line inside a """ string does not end the with block');
  assert.deepEqual([rows('svc/typed.py'), rows('web/typed.ts')], [['GET /api/invoices -> billing:8080'], ['GET /api/orders -> gw:8000']], 'a type-annotated client');
  assert.deepEqual(rows('web/alias.ts'), ['GET /orders -> ORDERS_URL'], 'this.baseUrl = baseUrl');
});

test('http-clients: review-fix receivers — a typed axios instance, a config-valued base per function, a with block over a parameter, pydantic settings, CRLF blank lines, NestJS HttpService, switch labels', () => {
  assert.deepEqual(rows('src/fix1/typed-bff.ts'), ['POST /users -> users-svc:8080'], 'usersApi: AxiosInstance is a client in a server file');
  assert.deepEqual(rows('web/fix1/perfn.js'), ['GET /invoices -> billing:8080', 'GET /users/${id} -> config.usersUrl'], "never the other function's host");
  assert.deepEqual(rows('svc/fix1/param.py'), ['GET /users -> base_url'], 'the with block holds its own base, never the module client');
  assert.deepEqual(rows('svc/fix1/settings.py'), ['GET /invoices/{i} -> settings.billing_url']);
  assert.deepEqual(rows('svc/fix1/caller.py'), ['GET /invoices/{i} -> BILLING_URL'], 'a CRLF blank line never ends a with block');
  assert.deepEqual(rows('src/fix1/gateway.service.ts'), ['GET /api/orders/${id} -> orders:3000'], '@nestjs/axios HttpService');
  assert.deepEqual(rows('web/fix1/switch.ts'), ['GET /orders -> dev:2'], 'case / default labels are no instance names; the nearest definition above the call');
  assert.deepEqual(rows('web/fix1/envbase.ts'), ['GET /orders -> environment.apiUrl'], 'a plain config name is a base; undefined is none');
  assert.deepEqual(rows('src/fix1/cache.service.ts'), [], 'cacheService is no HTTP client');
  assert.deepEqual(rows('src/fix1/router-generic.ts'), [], 'api.get<Array<User>>(path, handler) on an express.Router() is a route');
});

test('http-clients: implementation review cycle 2 — a qualified switch label is no instance name; a base P1 reads as a public host names no target', () => {
  assert.deepEqual([rows('src/fix2/case-bff.ts'), rows('src/fix2/case-bff-deep.ts')], [['POST /charges -> prod:1'], ['POST /charges -> prod:1']], 'case Env.Prod: / case Stage.Env.PROD: bind api, never the enum member');
  assert.deepEqual(rows('web/fix2/origin.js'), ['GET /users/${id} -> -', 'GET /teams/${id} -> -'], 'window.location.origin / config.api: the receiver is known, the host is not');
  assert.deepEqual([rows('web/fix2/abs-tpl.js'), rows('web/fix2/abs-bind.js'), rows('web/fix2/abs-concat.js')], [['GET /users/${id} -> -'], ['GET /api/users/${id} -> -'], ['GET /api/users/${id} -> -', 'GET /teams/{} -> -']], 'an origin-built URL is absolute: never under the instance base');
  assert.deepEqual([rows('web/fix2/internal.js'), rows('web/fix2/rel-bind.js'), rows('web/fix2/tpl-base.js')], [['GET /api/invoices/${id} -> billing.internal'], ['GET /api/invoices/${id} -> billing:8080'], ['GET /api/users/${id} -> -']], 'an internal name keeps its target; a relative constant takes the base; a templated origin base keeps its path');
});

test('http-clients: implementation review cycle 3 — a config key P1 reads as a public host names no target; Feign falls back to its name; no receiver or file base prefixes the key\'s URL', () => {
  assert.deepEqual(rows('java/fix3/FeignKey.java'), ['GET /invoices/{id} -> billing'], 'url = "${billing.api}": the service name names the member');
  assert.deepEqual(rows('java/fix3/FeignTplHost.java'), ['GET /invoices/{id} -> billing']);
  // the url names the host, not the name: a url that names none leaves the name a guess, like every config-key target (P4-2)
  assert.deepEqual(['java/fix3/FeignKey.java', 'java/fix3/FeignTplHost.java'].map((file) => r.facts.find((f) => f.file === file).confidence), ['heuristic', 'heuristic']);
  assert.deepEqual([rows('src/fix3/collide.ts'), rows('kt/fix3/Collide.kt')], [['GET /invoices/${id} -> base'], ['GET /invoices/{id} -> base']], 'never the instance base / WebClient base http://users:8081');
  assert.deepEqual(rows('java/fix3/MicronautKey.java'), ['GET /invoices/{id} -> -'], 'a positional URL is no service id');
  assert.deepEqual(rows('java/fix3/ValueFile.java'), ['GET /invoices/{id} -> -'], 'the WebClient file base never prefixes the key\'s URL');
  assert.deepEqual(rows('src/fix3/billing.service.ts'), ['GET /invoices/${id} -> -', 'GET /receipts/${id} -> -', 'GET /refunds/${id} -> -', 'GET /credits/${id} -> -'], 'configService.get(k): never the instance base http://users:8081');
});

test('http-clients: test files still emit (marked test); every fact cites its line', () => {
  assert.equal(r.facts.find((f) => f.file === 'test/client.test.ts').test, true);
  assertEvidence(ws.members[0], r);
});
