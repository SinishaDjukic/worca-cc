// test/wsmap-p4-joins.test.mjs — the P4 detectors end to end: extract → catalog → join over a small
// workspace (no survey, no usage: static facts only). A provider's route / topic / table and its
// consumer's call normalise to the same norm, so the edge exists; a third-party host never resolves
// to a member by its first DNS label.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { makeWorkspace } from './helpers/wsmap-fixtures.mjs';
import { extractWorkspace } from '../src/core/workspace-map/extract.mjs';
import { buildCatalog } from '../src/core/workspace-map/catalog.mjs';
import { joinMap } from '../src/core/workspace-map/join.mjs';

const SPEC = {
  'users-svc': {
    'package.json': '{ "name": "users-svc" }\n',
    'src/routes.js': "const router = express.Router();\nrouter.get('/users/:id', auth, getUser);\napp.post('/users', createUser);\nrouter.get('/users/:id/orders', listOrders);\n",
  },
  web: {
    'package.json': '{ "name": "web" }\n',
    'src/api.js': [
      'export const user = (id) => fetch(`/users/${id}`);',
      "export const create = (body) => axios.post('/users', body);",
      "export const order = (id) => fetch('/orders/' + id);",
      "export const orders = (id) => axios.get(API + '/users/' + id + '/orders');",
      'export const payment = (id) => fetch(`/api/payments/${id}`);',
      "export const charge = () => fetch('https://api.stripe.com/v1/charges', { method: 'POST' });",
      "export const portal = () => fetch('https://billing.stripe.com/p/session');",
      'export const report = (id) => fetch(`/reports/${id}`);',
    ].join('\n') + '\n',
  },
  'orders-api': {
    'pom.xml': '<project><groupId>acme</groupId><artifactId>orders-api</artifactId></project>\n',
    'src/main/java/OrdersController.java': [
      '@RestController',
      '@RequestMapping("/orders")',
      'public class OrdersController {',
      '  record CreateOrder(String sku) {}',
      '  @GetMapping("/{id}")',
      '  public Order get(@PathVariable String id) { return null; }',
      '  void placed() { kafkaTemplate.send("order.placed", key, value); }',
      '}',
    ].join('\n') + '\n',
  },
  billing: {
    'Billing.csproj': '<Project><PropertyGroup><AssemblyName>Billing</AssemblyName></PropertyGroup></Project>\n',
    'Controllers/PaymentsController.cs': '[ApiController]\n[Route("api/[controller]")]\npublic class PaymentsController : ControllerBase\n{\n    [HttpGet("{id}")]\n    public IActionResult Get(int id) => Ok();\n}\n',
    'db/migration/V1__init.sql': 'CREATE TABLE invoices (id bigint);\n',
    'src/main/java/OrderListener.java': 'class OrderListener { @KafkaListener(topics = "order.placed") void on(String m) {} }\n',
  },
  reports: { 'app/queries.py': 'SQL = "SELECT * FROM invoices WHERE id = %s"\n' },
  api: {
    'package.json': '{ "name": "api" }\n',
    'src/server.js': "app.get('/health', (req, res) => res.send('ok'));\n",
    // a third-party call whose path a member also serves (users-svc: GET /users/:id)
    'src/github.js': 'export const profile = (name) => fetch(`https://api.github.com/users/${name}`);\n',
  },
};

let ws;
let map;
before(async () => {
  ws = await makeWorkspace(SPEC);
  const extract = await extractWorkspace({ name: 'Joins', members: ws.members });
  const catalog = await buildCatalog({ extract, survey: null });
  map = await joinMap({ catalog, usage: null });
});
after(() => ws.cleanup());

test('joins: provider and consumer keys meet — route params, concatenation, an inner record, [controller], topics, tables', () => {
  const edges = map.edges.filter((e) => e.kind !== 'pkg');
  assert.deepEqual(edges.map((e) => `${e.from} -> ${e.to} ${e.norm}`).sort(), [
    'billing -> orders-api topic:order.placed',
    'reports -> billing table:invoices',
    'web -> billing http:GET /api/payments/{}',
    'web -> orders-api http:GET /orders/{}',
    'web -> users-svc http:GET /users/{}',
    'web -> users-svc http:GET /users/{}/orders',
    'web -> users-svc http:POST /users',
  ]);
  // A consume keyed from a literal path is exact. `API + …` names its base only heuristically, so that
  // one edge's confidence is the join's call (never more confident than its consume fact).
  for (const e of edges.filter((x) => x.norm !== 'http:GET /users/{}/orders')) assert.equal(e.confidence, 'exact', `${e.from} -> ${e.to} ${e.norm}`);
});

test('joins: no route collapses onto its class prefix or steals a peer\'s edge (Micronaut uri=, constant arrays, [action] of an Async method, a typed call in a BFF)', async () => {
  const w = await makeWorkspace({
    books: { 'pom.xml': '<project><groupId>a</groupId><artifactId>books</artifactId></project>\n', 'src/main/java/BookController.java': '@Controller("/books")\npublic class BookController {\n  @Get(uri = "/{id}")\n  public Book show(Long id) { return null; }\n}\n' },
    catalog: { 'package.json': '{ "name": "catalog" }\n', 'src/s.js': "app.get('/books', (req, res) => res.json([]));\napp.get('/api/users', (req, res) => res.json([]));\n" },
    users: { 'pom.xml': '<project><groupId>a</groupId><artifactId>users</artifactId></project>\n', 'src/main/java/UserController.java': '@RestController\n@RequestMapping("/api/users")\npublic class UserController {\n  @GetMapping({Paths.BY_ID})\n  public User one() { return null; }\n}\n' },
    home: { 'Home.csproj': '<Project><PropertyGroup><AssemblyName>Home</AssemblyName></PropertyGroup></Project>\n', 'Controllers/HomeController.cs': '[Route("api/[controller]/[action]")]\npublic class HomeController : Controller\n{\n    [HttpGet]\n    public async Task<IActionResult> ListAsync() => Ok();\n}\n' },
    people: { 'package.json': '{ "name": "people" }\n', 'src/s.js': "app.get('/people', (req, res) => res.json([]));\n" },
    bff: { 'package.json': '{ "name": "bff" }\n', 'src/server.ts': "import express from 'express';\nconst app = express();\napp.get('/me', async (req, res) => {\n  res.json(await api.get<Person[]>('/people', config));\n});\n" },
    accounts: { 'package.json': '{ "name": "accounts" }\n', 'src/routes.ts': "import express from 'express';\nconst api = express.Router();\napi.get<{ id: string }>('/accounts/:id', getAccount);\n" },
    web: { 'package.json': '{ "name": "web" }\n', 'src/api.js': "fetch('/books/' + id);\nfetch('/books');\nfetch('/api/users');\nfetch('/api/home/list');\nfetch('/people');\nfetch('/accounts/' + id);\n" },
  });
  try {
    const extract = await extractWorkspace({ name: 'Prefix', members: w.members });
    const m = await joinMap({ catalog: await buildCatalog({ extract, survey: null }), usage: null });
    assert.deepEqual(m.edges.filter((e) => e.kind !== 'pkg').map((e) => `${e.from} -> ${e.to} ${e.norm}`).sort(), [
      'bff -> people http:GET /people', 'web -> accounts http:GET /accounts/{}', 'web -> books http:GET /books/{}', 'web -> catalog http:GET /api/users', 'web -> catalog http:GET /books',
      'web -> home http:GET /api/home/list', 'web -> people http:GET /people',
    ]);
  } finally { await w.cleanup(); }
});

test('joins: one file calling two peers on the same path keeps both edges (per-file dedupe keys on the target host)', async () => {
  const peers = await makeWorkspace({
    billing: { 'package.json': '{ "name": "billing" }\n', 'src/s.js': "app.get('/health', (req, res) => res.send('ok'));\n" },
    ledger: { 'package.json': '{ "name": "ledger" }\n', 'src/s.js': "app.get('/health', (req, res) => res.send('ok'));\n" },
    bff: { 'package.json': '{ "name": "bff" }\n', 'src/a.js': "fetch('http://billing:8080/health');\nfetch('http://ledger:8082/health');\n" },
  });
  try {
    const extract = await extractWorkspace({ name: 'Peers', members: peers.members });
    const m = await joinMap({ catalog: await buildCatalog({ extract, survey: null }), usage: null });
    assert.deepEqual(m.edges.filter((e) => e.kind !== 'pkg').map((e) => `${e.from} -> ${e.to} ${e.norm}`).sort(), ['bff -> billing http:GET /health', 'bff -> ledger http:GET /health']);
  } finally { await peers.cleanup(); }
});

test('joins: two services sharing a template prefix constant never meet on it; an unmanaged Django reader is no owner of the database it reads', async () => {
  const w = await makeWorkspace({
    orders: {
      'package.json': '{ "name": "orders" }\n',
      'src/pub.js': "const env = 'prod';\nconst TOPIC_PREFIX = 'acme.';\nconst SQS_BASE = 'https://sqs.eu-west-1.amazonaws.com/123456789012';\nexport const emit = (m) => producer.send({ topic: `${env}.orders`, messages: [m] });\nexport const emit2 = (m) => producer.send({ topic: TOPIC_PREFIX + 'orders', messages: [m] });\nexport const q = (b) => sqs.send(new SendMessageCommand({ QueueUrl: SQS_BASE + '/order-jobs', MessageBody: b }));\nexport const dlq = (b) => sqs.send(new SendMessageCommand({ QueueUrl: ORDERS_QUEUE_URL + '-dlq', MessageBody: b }));\n",
      'db/migration/V1__init.sql': 'CREATE TABLE orders (id bigint);\n',
      '.env': 'DATABASE_URL=postgres://app:x@pg:5432/orders\n',
    },
    payments: { 'package.json': '{ "name": "payments" }\n', 'src/sub.js': "const env = 'prod';\nconst TOPIC_PREFIX = 'acme.';\nconst SQS_BASE = 'https://sqs.eu-west-1.amazonaws.com/123456789012';\nawait consumer.subscribe({ topics: [`${env}.payments`] });\nawait consumer.subscribe({ topic: TOPIC_PREFIX + 'payments' });\nawait sqs.send(new ReceiveMessageCommand({ QueueUrl: SQS_BASE + '/payment-jobs' }));\nawait sqs.send(new ReceiveMessageCommand({ QueueUrl: PAYMENTS_QUEUE_URL + '-dlq' }));\n" },
    reports: {
      'pyproject.toml': '[project]\nname = "reports"\n',
      'reports/migrations/__init__.py': '',
      'reports/migrations/0001_initial.py': "from django.db import migrations\n\n\nclass Migration(migrations.Migration):\n    operations = [\n        migrations.CreateModel(name='Order', fields=[], options={'db_table': 'orders', 'managed': False}),\n    ]\n",
      '.env': 'DATABASE_URL=postgres://ro:x@pg:5432/orders\n',
    },
  });
  try {
    const extract = await extractWorkspace({ name: 'Shared', members: w.members });
    const m = await joinMap({ catalog: await buildCatalog({ extract, survey: null }), usage: null });
    assert.deepEqual(m.edges.filter((e) => e.kind !== 'pkg').map((e) => `${e.from} -> ${e.to} ${e.norm}`).sort(), ['reports -> orders db:orders', 'reports -> orders table:orders']);
  } finally { await w.cleanup(); }
});

test('joins: a base derived by concatenation keeps its path — the call reaches the member serving it, not a peer serving the bare path', async () => {
  const w = await makeWorkspace({
    accounts: { 'package.json': '{ "name": "accounts" }\n', 'src/s.js': "const router = express.Router();\nrouter.get('/api/v1/users/:id', getUser);\n" },
    legacy: { 'package.json': '{ "name": "legacy" }\n', 'src/s.js': "const router = express.Router();\nrouter.get('/users/:id', getUser);\n" },
    web: { 'package.json': '{ "name": "web" }\n', 'src/api.js': "const API = process.env.ACCOUNTS_URL + '/api/v1';\nexport const user = (id) => fetch(`${API}/users/${id}`);\n" },
  });
  try {
    const extract = await extractWorkspace({ name: 'Concat', members: w.members });
    const m = await joinMap({ catalog: await buildCatalog({ extract, survey: null }), usage: null });
    assert.deepEqual(m.edges.filter((e) => e.kind !== 'pkg').map((e) => `${e.from} -> ${e.to} ${e.norm}`).sort(), ['web -> accounts http:GET /api/v1/users/{}']);
  } finally { await w.cleanup(); }
});

test('joins: a client opened per function reaches its own member — never the base of the file\'s last client', async () => {
  const w = await makeWorkspace({
    billing: { 'package.json': '{ "name": "billing" }\n', 'src/s.js': "const router = express.Router();\nrouter.get('/invoices/:id', getInvoice);\nrouter.get('/users/:id', getPayer);\n" },
    users: { 'package.json': '{ "name": "users" }\n', 'src/s.js': "const router = express.Router();\nrouter.get('/users/:id', getUser);\nrouter.get('/invoices/:id', getUserInvoice);\n" },
    caller: {
      'pyproject.toml': '[project]\nname = "caller"\n',
      'app/clients.py': 'import os, httpx\nBILLING_URL = os.environ["BILLING_URL"]\nUSERS_URL = os.environ["USERS_URL"]\n\n\nasync def get_invoice(i):\n    async with httpx.AsyncClient(base_url=BILLING_URL) as client:\n        return await client.get(f"/invoices/{i}")\n\n\nasync def get_user(i):\n    async with httpx.AsyncClient(base_url=USERS_URL) as client:\n        return await client.get(f"/users/{i}")\n',
      '.env': 'BILLING_URL=http://billing:8080\nUSERS_URL=http://users:8081\n',
    },
  });
  try {
    const extract = await extractWorkspace({ name: 'PerFunction', members: w.members });
    const m = await joinMap({ catalog: await buildCatalog({ extract, survey: null }), usage: null });
    assert.deepEqual(m.edges.filter((e) => e.norm.startsWith('http:')).map((e) => `${e.from} -> ${e.to} ${e.norm}`).sort(), ['caller -> billing http:GET /invoices/{}', 'caller -> users http:GET /users/{}']);
  } finally { await w.cleanup(); }
});

test('joins: Spring convertAndSend reaches its listener; a concatenated list element is never an exact topic; an Angular base built by concatenation keeps its path', async () => {
  const w = await makeWorkspace({
    shop: { 'pom.xml': "<project><groupId>acme</groupId><artifactId>shop</artifactId></project>\n", 'src/main/java/OrderService.java': "import org.springframework.amqp.rabbit.core.RabbitTemplate;\n@Service\npublic class OrderService {\n    public void placeOrder(Order order) { rabbitTemplate.convertAndSend(\"notifications\", order); }\n}\n" },
    mailer: { 'pom.xml': "<project><groupId>acme</groupId><artifactId>mailer</artifactId></project>\n", 'src/main/java/Mailer.java': "class Mailer {\n    @RabbitListener(queues = \"notifications\")\n    void on(String m) {}\n}\n" },
    billing: { 'package.json': "{ \"name\": \"billing\" }\n", 'src/sub.js': "const TOPIC_PREFIX = 'acme.';\nawait consumer.subscribe({ topics: [TOPIC_PREFIX + 'orders'] });\n" },
    legacy: { 'package.json': "{ \"name\": \"legacy\" }\n", 'src/s.js': "await producer.send({ topic: 'orders', messages });\nconst router = express.Router();\nrouter.get('/users/:id', getUser);\n" },
    accounts: { 'package.json': "{ \"name\": \"accounts\" }\n", 'src/s.js': "const router = express.Router();\nrouter.get('/api/v1/users/:id', getUser);\n" },
    ng: { 'package.json': "{ \"name\": \"ng\" }\n", 'src/app/users.service.ts': "export class UsersService {\n  private apiUrl = environment.apiUrl + '/api/v1';\n  one(id: string) { return this.http.get<User>(`${this.apiUrl}/users/${id}`); }\n}\n" },
  });
  try {
    const extract = await extractWorkspace({ name: 'Siblings', members: w.members });
    const m = await joinMap({ catalog: await buildCatalog({ extract, survey: null }), usage: null });
    const edges = m.edges.filter((e) => e.kind !== 'pkg');
    // billing may still meet legacy through the literal-search net (heuristic, D13) — never through a topic fact
    assert.deepEqual(edges.filter((e) => e.confidence === 'exact').map((e) => `${e.from} -> ${e.to} ${e.norm}`).sort(), ['mailer -> shop topic:notifications']);
    assert.deepEqual(edges.filter((e) => e.from === 'ng').map((e) => `${e.from} -> ${e.to} ${e.norm}`), ['ng -> accounts http:GET /api/v1/users/{}']);
  } finally { await w.cleanup(); }
});

test('joins: review fixes — a typed axios BFF, a Koa prefix and gorilla http.MethodPost reach their members; Spring\'s exchange, never its routing key, is the exact topic; f-string queue names never meet', async () => {
  const w = await makeWorkspace({
    'users-svc': { 'package.json': '{ "name": "users-svc" }\n', 'src/routes.js': "const Router = require('@koa/router');\nconst router = new Router({ prefix: '/users' });\nrouter.post('/', createUser);\nrouter.get('/:id', getUser);\n" },
    bff: { 'package.json': '{ "name": "bff" }\n', 'src/server.ts': "import express from 'express';\nimport axios, { AxiosInstance } from 'axios';\nconst app = express();\nconst usersApi: AxiosInstance = axios.create({ baseURL: process.env.USERS_URL });\napp.post('/signup', async (req, res) => { res.json((await usersApi.post('/users', req.body)).data); });\n" },
    stock: { 'go.mod': 'module github.com/acme/stock\n\ngo 1.22\n', 'main.go': 'package main\nfunc main() {\n\tr := mux.NewRouter()\n\tr.HandleFunc("/stock/{sku}", reserve).Methods(http.MethodPost)\n}\n' },
    web: { 'package.json': '{ "name": "web" }\n', 'src/api.js': "export const signup = (b) => fetch('/signup', { method: 'POST', body: b });\nexport const user = (id) => fetch(`/users/${id}`);\nexport const reserve = (sku) => fetch(`/stock/${sku}`, { method: 'POST' });\n" },
    shop: { 'pom.xml': '<project><groupId>acme</groupId><artifactId>shop</artifactId></project>\n', 'src/main/java/Orders.java': 'class Orders {\n    static final String EXCHANGE = "shop.orders";\n    void placed(Order o) { rabbitTemplate.convertAndSend(EXCHANGE, "order.created", o); }\n}\n' },
    mailer: { 'pom.xml': '<project><groupId>acme</groupId><artifactId>mailer</artifactId></project>\n', 'src/main/java/Mails.java': 'class Mails {\n    @RabbitListener(bindings = @QueueBinding(value = @Queue("mails"), exchange = @Exchange("shop.orders"), key = "order.created"))\n    void on(String m) {}\n}\n' },
    analytics: { 'pom.xml': '<project><groupId>acme</groupId><artifactId>analytics</artifactId></project>\n', 'src/main/java/Stats.java': 'class Stats {\n    @KafkaListener(topics = "order.created")\n    void on(String m) {}\n}\n' },
    ledger: { 'pyproject.toml': '[project]\nname = "ledger"\n', 'app/q.py': 'def send(queue_name, body):\n    sqs.send_message(QueueUrl=f"https://sqs.{REGION}.amazonaws.com/{ACCOUNT}/{queue_name}", MessageBody=body)\n' },
    notifier: { 'pyproject.toml': '[project]\nname = "notifier"\n', 'app/q.py': 'def poll(queue_name):\n    return sqs.receive_message(QueueUrl=f"https://sqs.{REGION}.amazonaws.com/{ACCOUNT}/{queue_name}")\n' },
  });
  try {
    const extract = await extractWorkspace({ name: 'CycleFive', members: w.members });
    const m = await joinMap({ catalog: await buildCatalog({ extract, survey: null }), usage: null });
    const edges = m.edges.filter((e) => e.kind !== 'pkg');
    assert.deepEqual(edges.filter((e) => e.norm.startsWith('http:')).map((e) => `${e.from} -> ${e.to} ${e.norm}`).sort(), [
      'bff -> users-svc http:POST /users', 'web -> bff http:POST /signup', 'web -> stock http:POST /stock/{}', 'web -> users-svc http:GET /users/{}',
    ]);
    assert.ok(edges.some((e) => e.from === 'mailer' && e.to === 'shop' && e.norm === 'topic:shop.orders'), 'the exchange constant');
    assert.ok(!edges.some((e) => e.from === 'analytics' && e.confidence === 'exact'), 'a Kafka listener never meets a Rabbit routing key exactly');
    assert.ok(!edges.some((e) => /queue_name/.test(e.norm)), 'an f-string placeholder is no queue name');
  } finally { await w.cleanup(); }
});

test('joins: a same-origin or lowercase config base names no host — P1 would read it as a public one — so its calls still reach the member serving them', async () => {
  const w = await makeWorkspace({
    'users-svc': { 'package.json': '{ "name": "users-svc" }\n', 'src/routes.js': "const router = express.Router();\nrouter.get('/users/:id', h);\nrouter.get('/accounts/:id', h);\nrouter.get('/teams/:id', h);\nrouter.get('/groups/:id', h);\nrouter.get('/roles/:id', h);\nrouter.get('/members/:id', h);\n" },
    billing: { 'package.json': '{ "name": "billing" }\n', 'src/routes.js': "const router = express.Router();\nrouter.get('/invoices/:id', h);\n" },
    web: {
      'package.json': '{ "name": "web" }\n',
      'src/origin.js': 'const api = axios.create({ baseURL: window.location.origin });\nexport const user = (id) => api.get(`/users/${id}`);\n',
      'src/location.js': 'const api = axios.create({ baseURL: location.origin });\nexport const group = (id) => api.get(`/groups/${id}`);\n',
      'src/config.js': 'const api = axios.create({ baseURL: config.api });\nexport const role = (id) => api.get(`/roles/${id}`);\n',
      'src/tpl.js': 'export const account = (id) => fetch(`${window.location.origin}/accounts/${id}`);\n',
      'src/concat.js': "export const team = (id) => axios.get(config.api + '/teams/' + id);\n",
      // an origin-built URL through an instance whose base names billing is still the page's own origin (never billing, never exact);
      // an internal-suffix name (`billing.internal`) names its member
      'src/mixed.js': "const api = axios.create({ baseURL: 'http://billing:8080' });\nexport const member = (id) => api.get(`${window.location.origin}/members/${id}`);\nexport const invoice = (id) => fetch(`${billing.internal}/invoices/${id}`);\n",
    },
  });
  try {
    const extract = await extractWorkspace({ name: 'SameOrigin', members: w.members });
    const m = await joinMap({ catalog: await buildCatalog({ extract, survey: null }), usage: null });
    const edges = m.edges.filter((e) => e.kind !== 'pkg');
    assert.deepEqual(edges.map((e) => `${e.from} -> ${e.to} ${e.norm} (${e.confidence})`).sort(), [
      'web -> billing http:GET /invoices/{} (heuristic)',
      'web -> users-svc http:GET /accounts/{} (heuristic)', 'web -> users-svc http:GET /groups/{} (heuristic)', 'web -> users-svc http:GET /members/{} (heuristic)',
      'web -> users-svc http:GET /roles/{} (heuristic)', 'web -> users-svc http:GET /teams/{} (heuristic)', 'web -> users-svc http:GET /users/{} (heuristic)',
    ]);
  } finally { await w.cleanup(); }
});

test('joins: a config key P1 would read as a public host (`services.billing`, `billing.api`, `app.billing-service`) still reaches the member serving the call; Feign\'s service name is a guess, never a strict host', async () => {
  const w = await makeWorkspace({
    billing: { 'package.json': '{ "name": "billing" }\n', 'src/routes.js': "const router = express.Router();\nrouter.get('/invoices/:id', h);\n" },
    users: { 'package.json': '{ "name": "users" }\n', 'src/routes.js': "const router = express.Router();\nrouter.get('/users/:id', h);\n" },
    // a service name naming a member that does not serve the call never lands the call there
    crm: { 'pom.xml': '<project><groupId>acme</groupId><artifactId>crm</artifactId></project>\n', 'src/main/java/InvoiceClient.java': '@FeignClient(name = "users", url = "${billing.api}")\npublic interface InvoiceClient {\n    @GetMapping("/invoices/{id}")\n    Invoice one(@PathVariable String id);\n}\n' },
    shop: { 'pom.xml': '<project><groupId>acme</groupId><artifactId>shop</artifactId></project>\n', 'src/main/java/Invoices.java': 'public class Invoices {\n    @Value("${services.billing}")\n    private String base;\n    Invoice one(String id) { return restTemplate.getForObject(base + "/invoices/{id}", Invoice.class, id); }\n}\n' },
    portal: { 'pom.xml': '<project><groupId>acme</groupId><artifactId>portal</artifactId></project>\n', 'src/main/java/BillingClient.java': '@FeignClient(name = "billing", url = "${billing.api}")\npublic interface BillingClient {\n    @GetMapping("/invoices/{id}")\n    Invoice one(@PathVariable String id);\n}\n' },
    nest: { 'package.json': '{ "name": "nest" }\n', 'src/billing.service.ts': "export class BillingService {\n  one(id: string) { return this.http.get(`${this.configService.get('app.billing-service')}/invoices/${id}`); }\n}\n" },
  });
  try {
    const extract = await extractWorkspace({ name: 'ConfigKeys', members: w.members });
    const m = await joinMap({ catalog: await buildCatalog({ extract, survey: null }), usage: null });
    const edges = m.edges.filter((e) => e.kind !== 'pkg');
    assert.deepEqual(edges.map((e) => `${e.from} -> ${e.to} ${e.norm} (${e.confidence})`).sort(), [
      'crm -> billing http:GET /invoices/{} (heuristic)', 'nest -> billing http:GET /invoices/{} (heuristic)', 'portal -> billing http:GET /invoices/{} (heuristic)', 'shop -> billing http:GET /invoices/{} (heuristic)',
    ]);
  } finally { await w.cleanup(); }
});

test('joins: a third-party host never resolves to a member by its first DNS label (api.stripe.com is not member "api")', () => {
  assert.ok(!map.edges.some((e) => e.from === 'web' && e.to === 'api'), JSON.stringify(map.edges.map((e) => [e.from, e.to, e.norm])));
  assert.ok(!map.edges.some((e) => /\/v1\/charges|\/p\/session/.test(e.norm)));
});

test('joins: a templated call no member serves never lands on a one-segment route; a public host\'s call is never joined by its path', () => {
  // `/reports/{}` must not suffix-match `api`'s `GET /health` (a match needs one aligned static segment)
  assert.ok(!map.edges.some((e) => e.from === 'web' && e.to === 'api'), JSON.stringify(map.edges.map((e) => [e.from, e.to, e.norm])));
  // `https://api.github.com/users/{}` names no member: never norm- or path-joined to users-svc's GET /users/{}
  assert.ok(!map.edges.some((e) => e.from === 'api'), JSON.stringify(map.edges.map((e) => [e.from, e.to, e.norm])));
  assert.ok(!map.edges.some((e) => (e.evidence?.from || []).some((ev) => /api\.github\.com/.test(ev.match))));
});
