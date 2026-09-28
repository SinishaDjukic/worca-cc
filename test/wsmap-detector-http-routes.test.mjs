import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { makeWorkspace, runDetector, assertEvidence } from './helpers/wsmap-fixtures.mjs';
import detector from '../src/core/workspace-map/detectors/http-routes.mjs';

const FILES = {
  'src/express.js': `const router = express.Router();
router.get('/users/:id', auth, async (req, res) => res.json({}));
app.post("/users", createUser);
// app.get('/commented', h);
api.get('/not-a-route');                      // client call: no handler argument
app.get('env');                               // express settings getter
router.route('/books/:id').get(show).put(update);
fastify.route({ method: ['GET', 'HEAD'], url: '/health', handler });
app.delete(ROUTE_CONST, handler);
router.get('/files/:id(\\d+)/:rev?', h);
axios.get('/x', h);
`,
  'src/users.controller.ts': `@Controller('users')
export class UsersController {
  @Get(':id')
  findOne() {}
  @Post()
  create() {}
}
@Controller({ path: 'orders' })
export class OrdersController {
  @Delete(':id') remove() {}
}
`,
  'src/main/java/InvoiceController.java': `@RestController
@RequestMapping("/api/invoices")
public class InvoiceController {
    record Search(String q) {}
    @GetMapping("/{id}")
    public Invoice get(@PathVariable String id) { return null; }
    @PostMapping
    public Invoice create() { return null; }
    @RequestMapping(value = "/search", method = {RequestMethod.GET, RequestMethod.POST})
    public List<Invoice> search() { return null; }
    @GetMapping(path = {"/a", "/b"})
    public void ab() {}
    @DeleteMapping(Paths.BY_ID)
    public void del() {}
}
`,
  'src/main/java/Beans.java': `@RestController("usersApi")
@RequestMapping("/v1/users")
class UsersApi {
    @GetMapping("/{id}")
    User one() { return null; }
}
@Controller("/hello")
class HelloController {
    @Get("/x")
    String x() { return ""; }
}
`,
  'src/main/java/BillingClient.java': `@FeignClient(name = "billing")
public interface BillingClient {
    @GetMapping("/invoices/{id}")
    Invoice get(@PathVariable String id);
}
`,
  'src/main/java/Resource.java': `@Path("/ledger")
public class LedgerResource {
    @GET
    public List<Entry> all() { return null; }
    @GET
    @Path("{id}")
    public Entry one() { return null; }
}
interface Api { @GET("users/{id}") Call<User> user(); }
`,
  'Controllers/PaymentsController.cs': `[ApiController]
[Route("api/[controller]")]
public class PaymentsController : ControllerBase
{
    [HttpGet("{id}")]
    public IActionResult Get(int id) => Ok();
    [HttpPost]
    public IActionResult Create() => Ok();
    [HttpGet("~/health")]
    public IActionResult Health() => Ok();
}
`,
  'Program.cs': `var app = builder.Build();
app.MapGet("/status", () => "ok");
var api = app.MapGroup("/v2");
api.MapPost("/refunds", (Refund r) => r);
`,
  'app/main.py': `router = APIRouter(prefix="/items")
@app.get("/")
def root(): ...
@router.get("/{item_id}")
async def read(item_id: int): ...
bp = Blueprint("auth", __name__, url_prefix="/auth")
@bp.route("/login", methods=["GET", "POST"])
def login(): ...
@app.route('/plain')
def plain(): ...
`,
  'shop/urls.py': `urlpatterns = [
    path('products/<int:pk>/', views.detail),
    re_path(r'^archive/(?P<year>[0-9]{4})/$', views.archive),
    path('api/', include('api.urls')),
]
`,
  'config/routes.rb': `Rails.application.routes.draw do
  root 'home#index'
  resources :orders, only: [:index, :show] do
    resources :items, except: [:destroy]
    member do
      post :cancel
    end
  end
  namespace :admin do
    get '/stats', to: 'stats#show'
  end
  resource :profile, only: [:show]
end
`,
  'routes/web.php': `<?php
Route::get('/welcome', function () { return view('welcome'); });
Route::post('photos/{photo}/like', [PhotoController::class, 'like']);
Route::apiResource('photos', PhotoController::class)->only(['index', 'show']);
Route::resource('posts', PostController::class);
Route::get('/user/{name?}', fn () => 1);
`,
  // CRLF (Windows checkout): same keys, lines and evidence
  'server/main.go': `func main() {
    r := gin.Default()
    r.GET("/ping", ping)
    v1 := r.Group("/v1")
    v1.POST("/login", login)
    http.HandleFunc("/healthz", health)
    mux.HandleFunc("GET /items/{id}", getItem)
    rt.HandleFunc("/articles", list).Methods("GET", "POST")
    rt.HandleFunc("/users/{id:[0-9]+}", getUser).Methods("GET")
    resp, _ := http.Get("http://billing/x")
    cr.Route("/admin", func(r chi.Router) {
        r.Get("/users", listUsers)
    })
}
`.replace(/\n/g, '\r\n'),
  'src/main/kotlin/Routing.kt': `fun Application.module() {
    routing {
        get("/hello") { call.respondText("hi") }
        route("/api") {
            post("/orders") { }
        }
    }
}
`,
  'pages/api/users/[id].ts': 'export default function handler(req, res) { res.json({}) }\n',
  'pages/api/docs/[[...slug]].ts': 'export default function docs(req, res) {}\n',
  'src/app/lib/reroute.ts': 'export async function GET() {}\n',
  'src/app/(shop)/products/[slug]/route.ts': 'export async function GET() {}\nexport const POST = async () => {};\n',
  'app/deps.py': "from fastapi import APIRouter, Depends\nfrom fastapi.security import HTTPBearer\nrouter = APIRouter(prefix=\"/orders\", tags=[\"orders\"], dependencies=[Depends(HTTPBearer())])\n@router.get(\"/{order_id}\")\ndef one(order_id: int): ...\n@router.post(\"\")\ndef create(): ...\n",
  'app/bp2.py': "bp = Blueprint(\"x\", __name__, template_folder=os.path.join(HERE, \"t\"), url_prefix=\"/x\")\n@bp.route(\"/y\")\ndef y(): ...\n",
  'src/hono.ts': "const api = new Hono<{ Bindings: Env }>();\napi.get<{ id: string }>('/d/:id', getD);\n",
  'src/plugin.ts': "const plugin: FastifyPluginAsync = async (api) => {\n  api.get<{ Params: P }>('/f/:id', { schema }, getF);\n};\n",
  'src/mixed.ts': "import { Router } from 'express';\nexport function mount(api: Router) {\n  api.get('/health', health);\n}\nexport async function loadOrders(api: AxiosInstance) {\n  return api.get<Order[]>('/orders', { params: { page: 1 } });\n}\n",
  'app/tags.py': "router = APIRouter(tags=[\"users (beta\"], openapi_prefix=\"/x\")\n@router.get(\"/{id}\")\ndef one(id): ...\nother = APIRouter(prefix=\"/other\")\n",
  'src/__tests__/routes.test.js': "app.get('/test-only', (req, res) => {});\napp.get(TEST_ROUTE, (req, res) => {});\n",
  'src/login.js': "api.post('/login', credentials);\napi.get('/users', { params });\n",
  'src/fastify.js': "import Fastify from 'fastify';\nconst fastify = Fastify();\nfastify.get('/items', { schema }, async (req, reply) => []);\n",
  'src/chain.js': "const router = express.Router()\nrouter.route('/a').get(h)\nrouter.route('/b').post(h)\n",
  'src/dup.js': "app.get('/dup', h);\napp.get('/dup', h2);\n",
  'src/bff.js': "import express from 'express';\nimport axios from 'axios';\nconst app = express();\nconst api = axios.create({ baseURL: 'http://billing:8080' });\napp.get('/me', async (req, res) => {\n  const inv = await api.get('/invoices', { params });\n  res.json(await api.post('/charges', payload));\n});\n",
  'Controllers/OrdersController.cs': `[ApiController]
[Route("api/orders")]
public class OrdersController : ControllerBase
{
    [HttpGet]
    [Route("{id:int}")]
    public IActionResult Get(int id) => Ok();
    [Route("search")]
    [HttpGet]
    public IActionResult Search() => Ok();
}
[ApiVersion("2.0")]
[Route("api/v{version:apiVersion}/[controller]")]
public class ProductsController : ControllerBase
{
    [HttpGet("{id}")]
    public IActionResult One(int id) => Ok();
}
[Route("[controller]/[action]")]
public class HomeController : Controller
{
    [HttpGet]
    public IActionResult About() => View();
}
`,
  'src/main/java/ArrayController.java': `@RestController
@RequestMapping("/api")
public class ArrayController {
    @RequestMapping(value = {"/users/{id}"}, method = RequestMethod.GET)
    public User one() { return null; }
    @GetMapping({"/orders/{id}", "/o/{id}"})
    public Order order() { return null; }
    @GetMapping(value = Paths.BY_ID)
    public User byConst() { return null; }
}
@RestController
@RequestMapping(ApiPaths.USERS)
class ConstPrefixController {
    @GetMapping("/search")
    public List<User> search() { return null; }
}
`,
  'src/versioned.controller.ts': "@Controller({ version: '1' })\nexport class HealthController {\n  @Get('health')\n  health() {}\n}\n",
  'app/items.py': 'router: APIRouter = APIRouter(prefix="/items")\n@router.get("")\ndef list_items(): ...\n@router.post("", status_code=201)\ndef create(): ...\n',
  'engine/config/routes.rb': 'Rails.application.routes.draw do\n  resources :users, only: %i[index show create]\nend\n',
  'src/main/kotlin/Users.kt': 'fun Route.users() {\n    route("/users") {\n        get { call.respond(all()) }\n        get("{id}") { }\n        post { }\n    }\n}\n',
  'server/more.go': 'func routes() {\n    r.With(paginate).Get("/articles", listArticles)\n    s := r.PathPrefix("/products").Subrouter()\n    s.HandleFunc("/{key}", productHandler)\n}\n',
  'src/typed.ts': "import Fastify from 'fastify';\nconst fastify = Fastify();\nfastify.get<{ Params: { id: string } }>('/users/:id', async (req) => ({}));\n",
  'src/main/java/BookController.java': '@Controller("/books")\npublic class BookController {\n    @Get(uri = "/{id}", produces = MediaType.APPLICATION_JSON)\n    public Book show(Long id) { return null; }\n    @Get("/list{?args*}")\n    public List<Book> list(ListingArguments args) { return null; }\n}\n',
  'src/main/java/ConstArrayController.java': '@RestController\n@RequestMapping("/api/users")\npublic class ConstArrayController {\n    @GetMapping({Paths.BY_ID})\n    public User one() { return null; }\n    @GetMapping("/by-name/" + NAME)\n    public User byName() { return null; }\n}\n@RestController\n@RequestMapping({ApiPaths.ORDERS})\nclass ConstArrayPrefix {\n    @GetMapping("/search")\n    public List<Order> search() { return null; }\n}\n',
  'Controllers/AccountController.cs': '[Route("api/[controller]/[action]")]\npublic class AccountController : Controller\n{\n    [HttpGet]\n    public async Task<IActionResult> ListAsync() => Ok();\n    [HttpPost]\n    [ActionName("sign-in")]\n    public IActionResult Login() => Ok();\n}\n[ApiController]\n[Route("api/[controller]")]\npublic class ReportsController : ControllerBase\n{\n    [HttpGet("[action]/{id}")]\n    public IActionResult Details(int id) => Ok();\n}\n',
  'src/typed-bff.ts': "import express from 'express';\nconst app = express();\napp.get('/me', async (req, res) => {\n  const u = await api.get<User[]>('/users', config);\n  const o = await ordersApi.get<Order>('/orders/1', { params });\n  res.json(u);\n});\n",
  'src/main/kotlin/Docs.kt': 'fun Application.docs() {\n    routing {\n        route("/docs") {\n            get {\n                call.respondHtml { head { title { +"Docs" } } }\n            }\n            get("/{page}") {\n                call.respondHtml { head { } }\n            }\n        }\n    }\n}\n',
  'app/dotted.py': 'import fastapi\nrouter = fastapi.APIRouter(prefix="/things")\n@router.get("/{thing_id}")\ndef one(): ...\n',
  'Controllers/CommaController.cs': '[ApiController, Route("api/comma")]\npublic class CommaController : ControllerBase\n{\n    [HttpGet, Route("{id}")]\n    public IActionResult Get(int id) => Ok();\n    [HttpPost("search"), Authorize]\n    public IActionResult Search() => Ok();\n    public int Sum(int[,] m) => m[0, 1];\n}\n',
  'src/typed-router.ts': "import express, { Router } from 'express';\nconst api = express.Router();\napi.get<{ id: string }>('/users/:id', getUser);\nexport const booksApi = Router();\nbooksApi.post<{}, Book, NewBook>('/books', validate(schema), createBook);\n",
  'Controllers/ItemsController.cs': '[ApiController, Route("api/[controller]")]\npublic class ItemsController : ControllerBase\n{\n    [HttpGet("{id}")]\n    public IActionResult Get(int id) => Ok();\n}\n[Route("api/[controller]/[action]")]\npublic class ToolsController : Controller\n{\n    [HttpGet]\n    [ProducesResponseType<Item>(200)]\n    public IActionResult Ping() => Ok();\n    [HttpPost]\n    [ActionName(nameof(Login))]\n    public async Task<IActionResult> SignInAsync() => Ok();\n}\n',
  'src/main/kotlin/Pages.kt': 'fun Application.pages() {\n    routing {\n        route("/a") {\n            get(\n                "/b"\n            ) {\n                call.respondHtml { head { } }\n            }\n        }\n    }\n}\n',
  'app/routers.py': 'from fastapi import APIRouter, Depends, routing\nrouter = APIRouter(tags=["x"], dependencies=[Depends(auth)], prefix="/orders")\n@router.get("/{order_id}")\ndef one(): ...\nadmin = routing.APIRouter(prefix="/admin")\n@admin.get("/stats")\ndef stats(): ...\n',
  // implementation review cycle 1: a Koa prefix, gorilla http.Method*, multi-line TS generics, a typed axios instance in a BFF, an
  // object value named like the router; one step off each (a Koa router without a prefix, a nested type argument on
  // an express.Router())
  'src/fix1/koa-bare.js': "const Router = require('@koa/router');\nconst router = new Router();\nrouter.get('/items/:id', show);\n",
  'src/fix1/router-generic.ts': "import express from 'express';\nconst api = express.Router();\napi.get<Array<User>>('/users', getUsers);\n",
  'src/fix1/koa.js': "const Router = require('@koa/router');\nconst router = new Router({ prefix: '/users' });\nrouter.get('/', list);\nrouter.get('/:id', show);\nrouter.post('/', create);\nrouter.get('/:id/orders', listOrders);\n",
  'server/fix1/gorilla.go': 'package main\nfunc main() {\n\tr := mux.NewRouter()\n\tr.HandleFunc("/users", createUser).Methods(http.MethodPost)\n\tr.HandleFunc("/mixed", h).Methods("GET", http.MethodPost)\n\tr.HandleFunc("/var", h).Methods(allowed...)\n}\n',
  'src/fix1/fastify-typed.ts': "import Fastify from 'fastify';\nconst server = Fastify();\nserver.get<{\n  Querystring: IQuerystring,\n  Headers: IHeaders\n}>('/auth', async (request, reply) => { return 'ok'; });\nserver.get<{ Reply: Array<User> }>('/users', h);\n",
  'src/fix1/typed-bff.ts': "import express from 'express';\nimport axios, { AxiosInstance } from 'axios';\nconst app = express();\nconst usersApi: AxiosInstance = axios.create({ baseURL: 'http://users-svc:8080' });\napp.post('/signup', async (req, res) => { const r = await usersApi.post('/users', req.body); res.json(r.data); });\n",
  'src/fix1/version.ts': "import express from 'express';\nconst api = express.Router();\napi.get<{ id: string }>('/users/:id', getUser);\napi.get('/version', (req, res) => res.json({ name: 'users', api: API_VERSION }));\n",
  // implementation review cycle 2: a qualified switch label (`case Env.Prod:`) is no instance name
  'src/fix2/case-bff.ts': "import express from 'express';\nimport axios from 'axios';\nconst app = express();\nswitch (env) { case Env.Prod: api = axios.create({ baseURL: 'http://prod:1' }); break; }\napp.get('/me', async (req, res) => { res.json(await api.post('/charges', payload)); });\n",
  'src/fix2/case-bff-deep.ts': "import express from 'express';\nimport axios from 'axios';\nconst app = express();\nswitch (env) { case Stage.Env.PROD: api = axios.create({ baseURL: 'http://prod:1' }); break; }\napp.get('/me', async (req, res) => { res.json(await api.post('/charges', payload)); });\n",
};

let ws;
let r;
before(async () => {
  ws = await makeWorkspace({ svc: FILES });
  r = await runDetector(detector, ws.members[0], ws.members);
});
after(() => ws.cleanup());
const keys = (file) => r.facts.filter((f) => f.file === file).map((f) => f.key);

test('http-routes: Express/Fastify — handler required, route chains, fastify route objects; clients and settings ignored', () => {
  assert.deepEqual(keys('src/express.js'), ['GET /users/:id', 'POST /users', 'GET /files/:id/:rev', 'GET /books/:id', 'PUT /books/:id', 'GET /health', 'HEAD /health']);
  assert.equal(r.facts.find((f) => f.key === 'GET /files/:id/:rev').norm, 'http:GET /files/{}/{}', 'param regexes and optional markers are dropped');
  assert.equal(r.facts.find((f) => f.key === 'GET /users/:id').norm, 'http:GET /users/{}');
  assert.ok(r.unresolved.some((u) => u.file === 'src/express.js' && u.raw.includes('ROUTE_CONST')));
});

test('http-routes: NestJS controller prefix joins method decorators per class', () => {
  assert.deepEqual(keys('src/users.controller.ts'), ['GET /users/:id', 'POST /users', 'DELETE /orders/:id']);
});

test('http-routes: Spring class @RequestMapping + method mappings; arrays; method=; Feign interfaces are skipped', () => {
  assert.deepEqual(keys('src/main/java/InvoiceController.java'), [
    'GET /api/invoices/{id}', 'POST /api/invoices', 'GET /api/invoices/search', 'POST /api/invoices/search', 'GET /api/invoices/a', 'GET /api/invoices/b',
  ]);
  assert.deepEqual(keys('src/main/java/BillingClient.java'), []);
  assert.deepEqual(keys('src/main/java/Beans.java'), ['GET /v1/users/{id}', 'GET /hello/x'], "Spring's @RestController(\"usersApi\") is a bean name; Micronaut's @Controller(\"/hello\") is a path");
  assert.ok(r.unresolved.some((u) => u.file === 'src/main/java/InvoiceController.java' && u.raw.includes('Paths.BY_ID')));
});

test('http-routes: JAX-RS @Path class + @GET/@Path methods; Retrofit @GET("…") is not a route', () => {
  assert.deepEqual(keys('src/main/java/Resource.java'), ['GET /ledger', 'GET /ledger/{id}']);
});

test('http-routes: ASP.NET attribute routes ([controller] token, ~/ absolute) and minimal APIs with MapGroup', () => {
  assert.deepEqual(keys('Controllers/PaymentsController.cs'), ['GET /api/payments/{id}', 'POST /api/payments', 'GET /health']);
  assert.deepEqual(keys('Program.cs'), ['GET /status', 'POST /v2/refunds']);
});

test('http-routes: FastAPI (APIRouter prefix) and Flask (Blueprint url_prefix, methods=[…]); Django urls', () => {
  assert.deepEqual(keys('app/main.py'), ['GET /', 'GET /items/{item_id}', 'GET /auth/login', 'POST /auth/login', 'GET /plain']);
  assert.deepEqual(keys('shop/urls.py'), ['* /products/<int:pk>', '* /archive/{year}']);
  assert.equal(r.facts.find((f) => f.key === '* /products/<int:pk>').norm, 'http:* /products/{}');
});

test('http-routes: Rails routes — root, resources (only/except), nesting, member, namespace, singular resource', () => {
  assert.deepEqual(keys('config/routes.rb'), [
    'GET /', 'GET /orders', 'GET /orders/:id',
    'GET /orders/:order_id/items', 'GET /orders/:order_id/items/new', 'POST /orders/:order_id/items', 'GET /orders/:order_id/items/:id',
    'GET /orders/:order_id/items/:id/edit', 'PATCH /orders/:order_id/items/:id', 'PUT /orders/:order_id/items/:id',
    'POST /orders/:id/cancel', 'GET /admin/stats', 'GET /profile',
  ]);
});

test('http-routes: Laravel routes and resource / apiResource expansions', () => {
  assert.deepEqual(keys('routes/web.php').sort(), [
    'DELETE /posts/{id}', 'GET /photos', 'GET /photos/{id}', 'GET /posts', 'GET /posts/create', 'GET /posts/{id}', 'GET /posts/{id}/edit',
    'GET /user/{name}', 'GET /welcome', 'PATCH /posts/{id}', 'POST /photos/{photo}/like', 'POST /posts', 'PUT /posts/{id}',
  ]);
  assert.equal(r.facts.find((f) => f.key === 'GET /user/{name}').norm, 'http:GET /user/{}', 'an optional parameter {name?}');
});

test('http-routes: Go gin groups, net/http (1.22 patterns, .Methods), chi r.Route scopes; http.Get is a client', () => {
  assert.deepEqual(keys('server/main.go').sort(), ['* /healthz', 'GET /admin/users', 'GET /articles', 'GET /items/{id}', 'GET /ping', 'GET /users/{id}', 'POST /articles', 'POST /v1/login']);
  assert.equal(r.facts.find((f) => f.key === 'GET /users/{id}').norm, 'http:GET /users/{}', 'a constrained parameter {id:[0-9]+}');
});

test('http-routes: Ktor routing with route() scopes; Next.js pages/api and app route handlers', () => {
  assert.deepEqual(keys('src/main/kotlin/Routing.kt'), ['GET /hello', 'POST /api/orders']);
  assert.deepEqual(keys('pages/api/users/[id].ts'), ['* /api/users/[id]']);
  assert.equal(r.facts.find((f) => f.file === 'pages/api/users/[id].ts').norm, 'http:* /api/users/{}');
  assert.deepEqual(keys('src/app/(shop)/products/[slug]/route.ts'), ['GET /products/[slug]', 'POST /products/[slug]']);
  assert.deepEqual(keys('pages/api/docs/[[...slug]].ts'), ['* /api/docs/[...slug]'], 'an optional catch-all is read as a catch-all');
  assert.equal(r.facts.find((f) => f.file === 'pages/api/docs/[[...slug]].ts').norm, 'http:* /api/docs/{}');
  assert.deepEqual(keys('src/app/lib/reroute.ts'), [], 'only a file named route.ts is a route handler');
});

test('http-routes: an axios-style api.post(url, payload) is a client call; Fastify option objects; chains end at the statement', () => {
  assert.deepEqual(keys('src/login.js'), [], 'no server in this file: `api` with a payload argument is an axios instance');
  assert.deepEqual(keys('src/fastify.js'), ['GET /items']);
  assert.deepEqual(keys('src/chain.js'), ['GET /a', 'POST /b'], 'no semicolons: the next line starts a new statement');
  assert.deepEqual(keys('src/bff.js'), ['GET /me'], 'an axios instance created in this file is never a router, even in a server file');
  assert.deepEqual(keys('src/dup.js'), ['GET /dup'], 'one fact per (dir, key) per file');
});

test('http-routes: method-level [Route] / [action] / apiVersion (ASP.NET), Java arrays holding {id}, constant paths unresolved, empty paths under a prefix, %i[] only:, Ktor verb blocks, chi With / gorilla PathPrefix / Fastify generics', () => {
  assert.deepEqual(keys('Controllers/OrdersController.cs').sort(), ['GET /api/orders/search', 'GET /api/orders/{id}', 'GET /api/v2/products/{id}', 'GET /home/about']);
  assert.deepEqual(keys('src/main/java/ArrayController.java'), ['GET /api/users/{id}', 'GET /api/orders/{id}', 'GET /api/o/{id}'], 'a constant path or prefix is never keyed as the bare method path');
  assert.ok(r.unresolved.some((u) => u.file === 'src/main/java/ArrayController.java' && u.raw.includes('Paths.BY_ID')));
  assert.ok(r.unresolved.some((u) => u.file === 'src/main/java/ArrayController.java' && u.raw.includes('ApiPaths.USERS')));
  assert.deepEqual(keys('src/versioned.controller.ts'), ['GET /health'], 'a NestJS options object without a path names no prefix');
  assert.deepEqual(keys('app/items.py'), ['GET /items', 'POST /items']);
  assert.deepEqual(keys('engine/config/routes.rb'), ['GET /users', 'POST /users', 'GET /users/:id']);
  assert.deepEqual(keys('src/main/kotlin/Users.kt').sort(), ['GET /users', 'GET /users/{id}', 'POST /users']);
  assert.deepEqual(keys('server/more.go').sort(), ['* /products/{key}', 'GET /articles']);
  assert.deepEqual(keys('src/typed.ts'), ['GET /users/:id']);
});

test('http-routes: Micronaut uri= / query templates; constant arrays and concatenations never collapse onto the prefix; [action] is the action name; typed client calls; a verb block inside a handler; fastapi.APIRouter', () => {
  assert.deepEqual(keys('src/main/java/BookController.java'), ['GET /books/{id}', 'GET /books/list']);
  assert.deepEqual(keys('src/main/java/ConstArrayController.java'), [], 'a constant array or a concatenation is unresolved, never the bare class prefix');
  const un = r.unresolved.filter((u) => u.file === 'src/main/java/ConstArrayController.java').map((u) => u.raw);
  assert.ok(['Paths.BY_ID', '"/by-name/" + NAME', 'ApiPaths.ORDERS'].every((x) => un.some((u) => u.includes(x))), JSON.stringify(un));
  assert.deepEqual(keys('Controllers/AccountController.cs'), ['GET /api/account/list', 'POST /api/account/sign-in', 'GET /api/reports/details/{id}'], 'ASP.NET Core trims Async; [ActionName] wins; a method template holds tokens too');
  assert.deepEqual(keys('src/typed-bff.ts'), ['GET /me'], 'a typed call on an api / *Api receiver is a client call, even in a server file');
  assert.deepEqual(keys('src/main/kotlin/Docs.kt').sort(), ['GET /docs', 'GET /docs/{page}'], 'kotlinx.html head { } inside a handler is no route');
  assert.deepEqual(keys('app/dotted.py'), ['GET /things/{thing_id}']);
  assert.deepEqual(keys('Controllers/CommaController.cs'), ['GET /api/comma/{id}', 'POST /api/comma/search'], 'comma-separated C# attribute lists keep the class prefix and the method template');
});

test('http-routes: a typed call on a router the file creates stays a route; C# lists holding [controller], generic attributes, nameof actions; multi-line Ktor handlers; FastAPI routers with nested calls', () => {
  assert.deepEqual(keys('src/typed-router.ts'), ['GET /users/:id', 'POST /books']);
  assert.deepEqual(keys('Controllers/ItemsController.cs'), ['GET /api/items/{id}', 'GET /api/tools/ping', 'POST /api/tools/login']);
  assert.deepEqual(keys('src/main/kotlin/Pages.kt'), ['GET /a/b'], 'the head { } inside a multi-line handler is no route');
  assert.deepEqual(keys('app/routers.py'), ['GET /orders/{order_id}', 'GET /admin/stats']);
});

test('http-routes: FastAPI / Flask groups keep their prefix whatever their arguments nest; more router spellings; a name typed as another client is no router', () => {
  assert.deepEqual(keys('app/deps.py'), ['GET /orders/{order_id}', 'POST /orders'], 'dependencies=[Depends(HTTPBearer())] nests two levels');
  assert.deepEqual(keys('app/bp2.py'), ['GET /x/y']);
  assert.deepEqual(keys('src/hono.ts'), ['GET /d/:id']);
  assert.deepEqual(keys('src/plugin.ts'), ['GET /f/:id']);
  assert.deepEqual(keys('src/mixed.ts'), ['GET /health'], 'api: AxiosInstance elsewhere in the file: the typed call is a client call');
  assert.ok(!r.unresolved.some((u) => u.file === 'src/mixed.ts'));
  assert.deepEqual(keys('app/tags.py'), ['GET /{id}'], 'a bracket inside a string and openapi_prefix= are no prefix');
});

test('http-routes: a same-file Koa prefix, gorilla http.Method* methods, multi-line and nested TS generics; a typed axios instance and an object value never make or unmake a router', () => {
  assert.deepEqual(keys('src/fix1/koa.js'), ['GET /users', 'GET /users/:id', 'POST /users', 'GET /users/:id/orders'], "new Router({ prefix: '/users' })");
  assert.deepEqual(keys('src/fix1/koa-bare.js'), ['GET /items/:id'], 'new Router() holds no prefix');
  assert.deepEqual(keys('src/fix1/router-generic.ts'), ['GET /users'], 'api.get<Array<User>>(…) on an express.Router()');
  assert.deepEqual(keys('server/fix1/gorilla.go'), ['POST /users', 'GET /mixed', 'POST /mixed', '* /var'], '.Methods(http.MethodPost) is a method, never an empty list');
  assert.deepEqual(keys('src/fix1/fastify-typed.ts'), ['GET /auth', 'GET /users'], 'a type argument spanning lines or nesting');
  assert.deepEqual(keys('src/fix1/typed-bff.ts'), ['POST /signup'], 'usersApi: AxiosInstance = axios.create(…) is a client, even in a server file');
  assert.deepEqual(keys('src/fix1/version.ts'), ['GET /users/:id', 'GET /version'], '{ api: API_VERSION } is a value, not a type that unmakes the router');
});

test('http-routes: implementation review cycle 2 — an axios instance assigned under a qualified switch label is a client, never a router', () => {
  assert.deepEqual([keys('src/fix2/case-bff.ts'), keys('src/fix2/case-bff-deep.ts')], [['GET /me'], ['GET /me']], 'case Env.Prod: api = axios.create(…): api.post is a call, never a route');
});

test('http-routes: test files still emit (marked test) but report no unresolved; every fact cites its line', () => {
  assert.equal(r.facts.find((f) => f.file === 'src/__tests__/routes.test.js').test, true);
  assert.ok(!r.unresolved.some((u) => u.file === 'src/__tests__/routes.test.js'), 'test code never lowers coverage');
  assertEvidence(ws.members[0], r);
});
