import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { makeWorkspace, runDetector, keysOf, assertEvidence } from './helpers/wsmap-fixtures.mjs';
import { extractWorkspace } from '../src/core/workspace-map/extract.mjs';
import { buildCatalog } from '../src/core/workspace-map/catalog.mjs';
import { joinMap } from '../src/core/workspace-map/join.mjs';
import { DETECTORS } from '../src/core/workspace-map/detectors/index.mjs';
import detector, { configPairs } from '../src/core/workspace-map/detectors/config-env.mjs';
import deployCompose from '../src/core/workspace-map/detectors/deploy-compose.mjs';
import deployK8s from '../src/core/workspace-map/detectors/deploy-k8s.mjs';

const DOTENV = `# local dev
export BILLING_URL=http://billing:8080/api/v1
DATABASE_URL="postgres://app:s3cret@db:5432/shop"
REDIS_HOST=cache # inline comment
ORDERS_URL=\${ORDERS_URL}
KAFKA_TOPIC_ORDERS=orders.created
SQS_QUEUE_URL=https://sqs.eu-west-1.amazonaws.com/123456789012/invoice-jobs
PORT=3000
FEATURE_X=true
LEDGER_URL=http://localhost:7000/ledger/v1
QUEUE_PASSWORD=Zq8vN3pLx2
`;
const APP_YML = `spring:
  application:
    name: billing
  datasource:
    url: jdbc:postgresql://pg:5432/billing
  kafka:
    template:
      default-topic: invoices
  cloud:
    stream:
      bindings:
        invoicePaid-out-0:
          destination: invoice.paid
        orderPlaced-in-0:
          destination: order.placed,order.amended
        audit:
          destination: audit
ledger:
  base-url: \${LEDGER_URL:http://ledger:7000}
---
spring:
  config:
    activate:
      on-profile: prod
ledger:
  base-url: https://ledger.acme.internal/v2
`;
const APPSETTINGS = `{
  // .NET allows comments
  "ConnectionStrings": {
    "Default": "Host=pg;Port=5432;Database=Orders;Username=app;Password=x"
  },
  "Services": { "CatalogUrl": "http://catalog/api", },
}
`;

let ws;
before(async () => {
  ws = await makeWorkspace({
    web: {
      '.env': DOTENV.replace(/\n/g, '\r\n'), 'src/main/resources/application.properties': 'spring.application.name=web\npayments.endpoint=https://payments.acme.internal:8443/charge\n',
      'test/.env.test': 'API_URL=http://billing:8080\n',
      'legacy.env': 'LEGACY_URL=http://legacy:9000/v1\r\r\n', // a doubled CR: every line keeps a trailing \r
      'dev.env': 'BILLING_API_URL=http://localhost:8081/api\nLEDGER_API_URL=http://localhost:8082/api\nORDERS_URL=http://orders:8080/api\nORDERS_ALT_URL=http://orders:9090/api\n',
    },
    billing: { 'src/main/resources/application.yml': APP_YML, 'config/k8s.yaml': 'apiVersion: v1\nkind: ConfigMap\ndata:\n  X: http://nope:1\n', 'src/test/resources/application.yml': 'spring:\n  application:\n    name: test-app\n' },
    cloud: {
      '.env': 'PASSWORD_RESET_TOPIC=user.password.reset\nPASSWORD_RESET_TOPIC_V2=user.password.reset.v2\nKAFKA_TOPIC_SIGNUPS=user.signups\nEVENTS_TOPIC_HMAC=Zq9hm4c\nORDERS_QUEUE_PASSPHRASE=Zq9pp\nQUEUE_PASSWORD_2=Zq9pw2\norders.queue.apikey.v2=Zq9ak\nQUEUE_HOST=rabbitmq\nSQS_QUEUE_REGION=eu-west-1\napp.kafka.topics.password-reset=auth.password-reset\nkafka.topics.session-expired=auth.session-expired\nKAFKA_TOPIC_SEED=Zq9sd\nQUEUE_PSK=Zq9psk\nAUTH_TOPIC=auth.logins\nAUTH_TOPIC_V2=auth.logins.v2\n',
      'gateway/src/main/resources/application.yml': 'spring:\n  application:\n    name: gateway\n  cloud:\n    gateway:\n      routes:\n        - id: customers\n          uri: lb://customers-service\n',
      'customers-service/src/main/resources/application.yml': 'spring:\n  application:\n    name: customers-service\n',
      'config-server/src/main/resources/shared/application.yml': 'eureka:\n  client:\n    serviceUrl:\n      defaultZone: http://registry:8761/eureka/\n',
      'src/main/resources/application.yml': 'eureka:\n  instance:\n    prefer-ip-address: true\n',
      'config/openapi.yaml': "openapi: 3.0.0\nservers:\n  - url: http://cloud:8080\npaths:\n  /x:\n    get:\n      responses:\n        '200': { description: ok, content: { application/json: { example: { self: 'http://orders:9000/orders/7' } } } }\n",
      'docs/.env.example': 'BILLING_URL=http://billing:8080/api\n',
      'appsettings.json': '{"Billing":"http:\\/\\/billing-api:8080","Pad":"x"}',
    },
    orders: { 'appsettings.Development.json': APPSETTINGS, 'appsettings.Production.json': `\uFEFF${APPSETTINGS.replace('Orders', 'OrdersProd')}`, 'config/broken.yaml': 'a: [1, 2\nb: {c\n', 'docker-compose.yml': 'services: {}\n' },
  });
});
after(() => ws.cleanup());
const member = (k) => ws.members.find((m) => m.key === k);

test('config-env (.env, CRLF): URLs → service + http, DB URL → db, bare host key → heuristic service', async () => {
  const r = await runDetector(detector, member('web'), ws.members);
  const env = r.facts.filter((f) => f.file === '.env');
  assert.deepEqual(env.filter((f) => f.kind === 'service').map((f) => [f.key, f.target, f.confidence]).sort(), [['billing', 'billing:8080', 'exact'], ['cache', 'cache', 'heuristic']]);
  assert.deepEqual(env.filter((f) => f.kind === 'http').map((f) => [f.key, f.target, f.line, f.detail]), [['/api/v1', 'billing:8080', 2, 'BILLING_URL'], ['/ledger/v1', 'LEDGER_URL', 10, 'LEDGER_URL']]);
  assert.equal(env.find((f) => f.key === '/ledger/v1').confidence, 'heuristic', 'no usable host: the key names the peer (P1 envStems)');
  const db = env.find((f) => f.kind === 'db');
  // Raw detector output: the match cites the URL as written; P1's extract redacts it centrally.
  assert.deepEqual([db.key, db.target, db.match], ['db:shop', 'db:5432', 'postgres://app:s3cret@db:5432/shop']);
  assert.ok(!db.key.includes('s3cret') && !db.target.includes('s3cret'), 'keys and targets never carry credentials');
  assertEvidence(member('web'), r);
});

test('config-env (.env): topic keys, SQS queue URLs; placeholders unresolved; plain values ignored', async () => {
  const r = await runDetector(detector, member('web'), ws.members);
  assert.deepEqual(r.facts.filter((f) => f.kind === 'topic').map((f) => [f.key, f.dir, f.confidence]), [['orders.created', 'consumes', 'heuristic'], ['invoice-jobs', 'consumes', 'exact']]);
  assert.deepEqual(r.unresolved.map((u) => [u.raw, u.reason, u.line]), [['ORDERS_URL=${ORDERS_URL}', 'placeholder', 5]]);
  assert.ok(!r.facts.some((f) => f.key.includes('Zq8vN3pLx2') || f.match.includes('Zq8vN3pLx2')), 'a value under a secret-named key (QUEUE_PASSWORD) is never a topic');
  assert.deepEqual(r.facts.filter((f) => f.file === 'legacy.env').map((f) => [f.kind, f.key]), [['service', 'legacy'], ['http', '/v1']], 'a \\r\\r\\n file keeps its pairs');
});

test('config-env: two local-dev peers behind one path keep a fact each (one per file, dir, key and target host)', async () => {
  const r = await runDetector(detector, member('web'), ws.members);
  assert.deepEqual(r.facts.filter((f) => f.file === 'dev.env').map((f) => [f.kind, f.key, f.target, f.line]), [
    ['http', '/api', 'BILLING_API_URL', 1], ['http', '/api', 'LEDGER_API_URL', 2], ['service', 'orders', 'orders:8080', 3], ['http', '/api', 'orders:8080', 3],
  ], 'ORDERS_ALT_URL (orders:9090) repeats a host already cited: no second fact');
});

test('config-env (.properties): spring.application.name alias; endpoint URL consumes', async () => {
  const r = await runDetector(detector, member('web'), ws.members);
  assert.deepEqual(r.aliases.map((a) => [a.value, a.source]), [['web', 'spring']]);
  assert.deepEqual(r.facts.filter((f) => f.file.endsWith('application.properties')).map((f) => [f.kind, f.key]), [['service', 'payments.acme.internal'], ['http', '/charge']]);
});

test('config-env: test-path env files still emit facts, marked test', async () => {
  const r = await runDetector(detector, member('web'), ws.members);
  const t = r.facts.filter((f) => f.file === 'test/.env.test');
  assert.ok(t.length === 1 && t[0].test === true);
});

test('config-env (Spring yml, multi-doc): alias, datasource db, Kafka default topic, Cloud Stream bindings by direction', async () => {
  const r = await runDetector(detector, member('billing'), ws.members);
  assert.deepEqual(r.aliases.map((a) => a.value), ['billing']);
  assert.deepEqual(keysOf(r, 'db', 'consumes'), ['db:billing']);
  assert.deepEqual(keysOf(r, 'topic', 'provides'), ['invoice.paid', 'invoices']);
  assert.deepEqual(keysOf(r, 'topic', 'consumes'), ['order.amended', 'order.placed']);
  assert.deepEqual(r.unresolved.map((u) => [u.raw, u.reason]), [['audit=audit', 'binding direction unknown']]);
  assert.deepEqual(keysOf(r, 'service', 'consumes'), ['ledger', 'ledger.acme.internal'], 'a ${VAR:default} default and the prod profile both count');
  assert.equal(r.facts.find((f) => f.key === 'invoice.paid').line, 13);
  assert.ok(!r.facts.some((f) => f.file === 'config/k8s.yaml'), 'Kubernetes manifests belong to deploy-k8s');
  assertEvidence(member('billing'), r);
});

test('config-env (appsettings JSON with comments + trailing commas): ADO.NET connection string → db; URL → service/http', async () => {
  const r = await runDetector(detector, member('orders'), ws.members);
  const json = r.facts.filter((f) => f.file === 'appsettings.Development.json');
  assert.deepEqual(json.map((f) => [f.kind, f.key, f.line]), [['db', 'db:Orders', 4], ['service', 'catalog', 6], ['http', '/api', 6]]);
  assert.equal(json[0].match, 'Database=Orders');
  assert.deepEqual(r.facts.filter((f) => f.file === 'appsettings.Production.json').map((f) => f.key), ['db:OrdersProd', 'catalog', '/api'], 'a BOM-prefixed file (Visual Studio) parses');
  assertEvidence(member('orders'), r);
});

test('config-env: a credential word anywhere in a key keeps its value out of topic keys; an attribute key names no topic', async () => {
  const r = await runDetector(detector, member('cloud'), ws.members);
  assert.deepEqual(r.facts.filter((f) => f.kind === 'topic').map((f) => f.key).sort(), ['auth.logins', 'auth.logins.v2', 'auth.password-reset', 'auth.session-expired', 'user.password.reset', 'user.password.reset.v2', 'user.signups'], 'an event about a credential (password-reset) is a topic');
  assert.ok(!r.facts.some((f) => /Zq9/.test(`${f.key} ${f.match} ${f.target ?? ''}`)), 'no value under …_HMAC, …_PASSPHRASE, …_PASSWORD_2, apikey.v2, …_SEED or …_PSK becomes a key');
  assert.deepEqual(r.facts.filter((f) => f.file === '.env').map((f) => [f.kind, f.key, f.confidence]).sort(), [['service', 'rabbitmq', 'heuristic'], ['topic', 'auth.logins', 'heuristic'], ['topic', 'auth.logins.v2', 'heuristic'], ['topic', 'auth.password-reset', 'heuristic'], ['topic', 'auth.session-expired', 'heuristic'], ['topic', 'user.password.reset', 'heuristic'], ['topic', 'user.password.reset.v2', 'heuristic'], ['topic', 'user.signups', 'heuristic']], 'QUEUE_HOST names a host');
});

test('config-env: specs, served config and samples are not read; a nested module names the member only multi-word; lb:// routes; an escaped value cites its key', async () => {
  const r = await runDetector(detector, member('cloud'), ws.members);
  assert.deepEqual(r.aliases.map((a) => a.value), ['customers-service'], 'gateway/…: a nested module\'s single-word name would claim every gateway.* host');
  assert.deepEqual(r.facts.filter((f) => f.kind === 'service').map((f) => [f.key, f.file]).sort(), [['billing-api', 'appsettings.json'], ['customers-service', 'gateway/src/main/resources/application.yml'], ['rabbitmq', '.env']]);
  assert.equal(r.facts.find((f) => f.key === 'billing-api').match, 'Billing', 'a JSON-escaped value is not on its line: the key as written is cited');
  assert.equal(detector.claims('docs/.env.example'), false);
  assert.equal(detector.claims('config-server/src/main/resources/shared/application.yml'), false);
  assert.equal(detector.claims('svc/src/main/resources/config/application.yml'), true);
  assert.ok(!r.facts.some((f) => f.file === 'config/openapi.yaml' || f.file === 'src/main/resources/application.yml'), 'a spec under config/ and `prefer-ip-address: true` give nothing');
  assertEvidence(member('cloud'), r);
});

test('config-env: malformed config YAML → unresolved parse error; compose files are not claimed', async () => {
  const r = await runDetector(detector, member('orders'), ws.members);
  assert.ok(r.unresolved.some((u) => u.file === 'config/broken.yaml' && u.reason.startsWith('parse error')));
  assert.equal(detector.claims('docker-compose.yml'), false);
  assert.equal(detector.claims('config/docker-compose.yml'), false);
  assert.equal(detector.claims('config/docker-compose-dev.yml'), false);
});

test('config-env: a counter or `pw` glued to a credential word keeps the value out of topic keys; an event word after it names a topic; Kafka brokers are services', async () => {
  const w = await makeWorkspace({ app: { 'app.js': 'x\n', '.env': 'ORDERS_QUEUE_API_KEY2=Zq9ApiKey2xK2mP7vL4\nRABBITMQ_QUEUE_PW=Zq9PwxK2mP7vL4\nevents.topic.hmac2=Zq9hmac2xyz\nKAFKA_TOPIC_SESSION_STARTED=session.started\nKAFKA_BOOTSTRAP_SERVERS=kafka-1:9092,kafka-2:9092\nspring.cloud.stream.kafka.binder.brokers=kafka-3:9092\n' } });
  try {
    const r = await runDetector(detector, w.members[0], w.members);
    assert.deepEqual(keysOf(r, 'topic', 'consumes'), ['session.started']);
    assert.deepEqual(keysOf(r, 'service', 'consumes'), ['kafka-1', 'kafka-2', 'kafka-3'], 'the whole key names a broker list (`…binder.brokers`)');
    assert.ok(!JSON.stringify(r).includes('Zq9'), 'no credential in any key or match');
    assertEvidence(w.members[0], r);
  } finally { await w.cleanup(); }
});

test('config-env: a code-less deploy repo\'s .env beside its compose file configures the stack, not its calls; a native config server\'s served files are not read', async () => {
  const env = 'CART_ADDR=cart:7070\nCART_URL=http://cart:7070/api\n';
  const w = await makeWorkspace({ deploy: { '.env': env, 'compose.yaml': 'services: {}\n' }, web: { 'app.js': 'x\n', '.env': env, 'compose.yaml': 'services: {}\n' } });
  try {
    const at = (k) => runDetector(detector, w.members.find((m) => m.key === k), w.members);
    assert.deepEqual((await at('deploy')).facts, [], 'the compose stack\'s interpolation file');
    assert.deepEqual((await at('web')).facts.map((f) => [f.kind, f.key]), [['service', 'cart'], ['http', '/api']], 'a member with code reads its .env');
  } finally { await w.cleanup(); }
  for (const rel of ['src/main/resources/config/auth-service.yml', 'config-server/src/main/resources/config/registry.yml']) assert.equal(detector.claims(rel), false, rel);
  for (const rel of ['src/main/resources/config/application-prod.yml', 'src/main/resources/application.yml', 'src/main/resources/bootstrap.properties', 'config/app.yml']) assert.equal(detector.claims(rel), true, rel);
});

test('config-env: a deploy repo\'s tooling (internal/tools/tools.go, scripts/) is no code — its .env beside the compose file stays the stack\'s', async () => {
  const env = 'CART_ADDR=cart:7070\nEMAIL_ADDR=http://email:6060\n';
  const w = await makeWorkspace({
    deploy: { '.env': env, 'compose.yaml': 'services: {}\n', 'internal/tools/tools.go': 'package tools\n', 'internal/tools/sanitycheck.py': 'x\n', 'scripts/render.py': 'x\n' },
    web: { 'src/app.py': 'x\n', '.env': env, 'compose.yaml': 'services: {}\n' },
  });
  try {
    const at = (k) => runDetector(detector, w.members.find((m) => m.key === k), w.members);
    assert.deepEqual((await at('deploy')).facts, [], 'opentelemetry-demo\'s root: tooling only');
    assert.deepEqual((await at('web')).facts.map((f) => [f.kind, f.key]).sort(), [['service', 'cart'], ['service', 'email']], 'a member with code reads its .env');
  } finally { await w.cleanup(); }
});

test('config-env: an event word after a credential word names a topic only when the value names that event too (a per-queue credential suffixed by the queue\'s name holds a secret)', async () => {
  const w = await makeWorkspace({ app: { 'app.js': 'x\n', '.env': 'RABBITMQ_QUEUE_PASSWORD_EMAILS=Zq9aK2mP7vL4\nSERVICEBUS_TOPIC_SAS_KEY_ALERTS=Zq9bK2mP7vL4\nQUEUE_TOKEN_NOTIFICATIONS=Zq9cK2mP7vL4\nKAFKA_TOPIC_API_KEY_USAGE=Zq9dK2mP7vL4\nKAFKA_TOPIC_SESSION_STARTED=session.started\nKAFKA_TOPIC_API_KEY_CREATED=apikeys.created\ntopics.session-started=analytics.session_start\n' } });
  try {
    const r = await runDetector(detector, w.members[0], w.members);
    assert.deepEqual(keysOf(r, 'topic', 'consumes'), ['analytics.session_start', 'apikeys.created', 'session.started']);
    assert.ok(!JSON.stringify(r).includes('Zq9'), 'no credential in any key or match');
    assertEvidence(w.members[0], r);
  } finally { await w.cleanup(); }
});

test('config-env: a .env beside compose is read for code the extension list must know (Haskell), for a member that builds its own image (a gateway), never for a deploy repo whose only code is CI tooling', async () => {
  const env = 'CART_ADDR=cart:7070\nCART_URL=http://cart:7070/api\n';
  const compose = 'services: {}\n';
  const w = await makeWorkspace({
    servant: { 'app/Main.hs': 'main = pure ()\n', '.env': env, 'compose.yaml': compose },
    gateway: { Dockerfile: 'FROM nginx:1.27\n', 'nginx.conf.template': 'upstream cart { server ${CART_ADDR}; }\n', '.env': env, 'compose.yaml': compose },
    deploy: { '.github/scripts/notify.js': 'x\n', 'hack/gen.go': 'package main\n', '.env': env, 'compose.yaml': compose },
  });
  try {
    const at = async (k) => (await runDetector(detector, w.members.find((m) => m.key === k), w.members)).facts.map((f) => [f.kind, f.key]);
    assert.deepEqual(await at('servant'), [['service', 'cart'], ['http', '/api']], 'a Haskell service reads its .env');
    assert.deepEqual(await at('gateway'), [['service', 'cart'], ['http', '/api']], 'a Dockerfile beside the .env: the stack runs this member');
    assert.deepEqual(await at('deploy'), [], 'CI scripts and hack/ are no code the member runs');
  } finally { await w.cleanup(); }
});

test('config-env: a Spring Cloud Config store (application.yml beside files named like other members) is no configuration of this member; a spring.application.name of another member never aliases this one', async () => {
  const pom = (a) => `<project><groupId>com.acme</groupId><artifactId>${a}</artifactId></project>\n`;
  const w = await makeWorkspace({
    'config-repo': {
      'config/application.yml': 'eureka:\n  client:\n    serviceUrl:\n      defaultZone: http://registry:8761/eureka/\n',
      'config/billing-service.yml': 'spring:\n  datasource:\n    url: jdbc:postgresql://billing-db:5432/billing\n',
      'config/order-service.yml': 'billing:\n  url: http://billing-service:8080/invoices\n',
      'copy/config/billing-service.yml': 'spring:\n  application:\n    name: billing-service\n', // no store (one member named): read, but no alias
      'solo/application.yml': 'audit:\n  url: http://audit-log:9000/x\n', 'solo/billing-service.yml': 'x: 1\n', // one member named: no store
      'shop/application.yml': 'cache:\n  url: http://redis:6379\n', 'shop/redis.yml': 'x: 1\n', 'shop/kafka.yml': 'x: 1\n', // single-word names: no store
    },
    'billing-service': { 'pom.xml': pom('billing-service'), 'src/main/resources/application.yml': 'spring:\n  application:\n    name: billing-service\n', 'src/main/java/B.java': 'class B {}\n' },
    'order-service': { 'pom.xml': pom('order-service'), 'src/main/resources/application.yml': 'billing:\n  url: http://billing-service:8080/invoices\n', 'src/main/java/O.java': 'class O {}\n' },
    registry: { 'pom.xml': pom('registry') }, redis: { 'README.md': '# redis\n' }, kafka: { 'README.md': '# kafka\n' },
  });
  try {
    const r = await runDetector(detector, w.members.find((m) => m.key === 'config-repo'), w.members);
    assert.deepEqual(r.facts.map((f) => [f.file, f.key]), [['shop/application.yml', 'redis'], ['solo/application.yml', 'audit-log'], ['solo/application.yml', '/x']], 'the store under config/ gives nothing; shop/ and solo/ keep their calls');
    assert.deepEqual(r.aliases, [], 'copy/config/billing-service.yml names another member');
    const extract = await extractWorkspace({ name: 'W', members: w.members, detectors: [...DETECTORS.slice(0, 2), detector] }); // P1's block + this detector
    const catalog = await buildCatalog({ extract, survey: null });
    const map = await joinMap({ catalog, usage: null });
    assert.deepEqual(catalog.ambiguousAliases, {});
    assert.deepEqual(map.edges.filter((e) => e.from === 'order-service' && e.to === 'billing-service').map((e) => [e.kind, e.confidence]).sort(), [['http', 'exact'], ['service', 'exact']]);
    assert.ok(!map.edges.some((e) => e.from === 'config-repo' && e.to !== 'redis'), JSON.stringify(map.edges.map((e) => [e.from, e.to, e.kind])));
  } finally { await w.cleanup(); }
});

test('config-env: MicroProfile Config and a classpath .env are read; a sample copy is not', () => {
  for (const rel of ['src/main/resources/META-INF/microprofile-config.properties', 'svc/src/main/resources/META-INF/microprofile-config.properties', 'src/main/resources/.env']) assert.equal(detector.claims(rel), true, rel);
  for (const rel of ['docs/src/main/resources/META-INF/microprofile-config.properties', 'src/main/resources/META-INF/services/x.properties', 'src/main/resources/shared/.env', 'src/main/resources/config/auth-service.yml']) assert.equal(detector.claims(rel), false, rel);
});

test('config-env, deploy-compose, deploy-k8s: an unresolved placeholder never quotes a userinfo (unresolvedValue — P1 cannot redact one holding /)', () => {
  const env = detector.detect({ rel: '.env', text: 'DATABASE_URL=postgres://app:pa/Zq9f3c@${DB_HOST}/${DB_NAME}\n' },
    { member: { key: 'web', name: 'web', dir: '/w', projectDir: '/w' }, members: [], files: ['.env', 'main.go'], state: {} });
  assert.equal(env.unresolved.length, 1);
  assert.ok(!JSON.stringify(env).includes('Zq9f3c'), 'the placeholder item never quotes the password');
  const web = { key: 'web', name: 'web', dir: '/w', projectDir: '/w' };
  const ctx = () => ({ member: web, members: [web], files: ['docker-compose.yml', 'k8s/web.yaml', 'main.go'], state: {} });
  const compose = deployCompose.detect({ rel: 'docker-compose.yml', text: 'services:\n  web:\n    build: .\n    environment:\n      DATABASE_URL: "postgres://app:pa/Zq9f3d@${DB_HOST}/${DB_NAME}"\n' }, ctx());
  const kc = ctx();
  deployK8s.detect({ rel: 'k8s/web.yaml', text: 'apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: web\nspec:\n  template:\n    spec:\n      containers:\n        - image: acme/web:1\n          env:\n            - name: DATABASE_URL\n              value: "postgres://app:pa/Zq9f3e@${DB_HOST}/${DB_NAME}"\n' }, kc);
  const k8s = deployK8s.finish(kc);
  assert.deepEqual([compose.unresolved.length, k8s.unresolved.length], [1, 1]);
  assert.ok(!JSON.stringify([compose, k8s]).includes('Zq9f3'), 'compose and Kubernetes placeholder items never quote the password');
});

const pomOf = (a) => `<project><groupId>com.acme</groupId><artifactId>${a}</artifactId></project>\n`;
const javaSvc = (a) => ({ 'pom.xml': pomOf(a), 'src/main/java/A.java': 'class A {}\n' });
const chainOf = async (members) => {
  const extract = await extractWorkspace({ name: 'W', members, detectors: [...DETECTORS.slice(0, 2), detector] });
  const catalog = await buildCatalog({ extract, survey: null });
  return joinMap({ catalog, usage: null });
};
const edgePairs = (map) => [...new Set(map.edges.map((e) => `${e.from}->${e.to}`))].sort();

test('config-env: a random password under …_PASSWORD_SMS never names the sms topic (a two-letter `Sm` in it is no `sms`), nor does one built from the queue\'s name (`emails2024`); changed / change and rotated / rotation name one event; a key of 100 000 credential words is one pass', async () => {
  const w = await makeWorkspace({ app: { 'app.js': 'x\n', '.env': 'RABBITMQ_QUEUE_PASSWORD_SMS=x7Qk2SmZp4Rt9WvB3nLc8YhD\nQUEUE_JWT_SMS=eyJhbGciOiJIUzI1NiJ9.smT_4ljyMbkAWw8SRS3k42\nKAFKA_TOPIC_PASSWORD_CHANGED=user.password.change\nKAFKA_TOPIC_KEYS_ROTATED=jwks.rotation\nRABBITMQ_QUEUE_PASSWORD_EMAILS=emails2024\nQUEUE_TOKEN_AUDIT=Auditsecrets\n' } });
  try {
    const r = await runDetector(detector, w.members[0], w.members);
    assert.deepEqual(r.facts.filter((f) => f.kind === 'topic').map((f) => f.key).sort(), ['jwks.rotation', 'user.password.change']);
    for (const secret of ['x7Qk2SmZp4', 'emails2024', 'Auditsecrets']) assert.ok(!JSON.stringify(r).includes(secret), `${secret}: no credential in any key or match (a password built from the queue's name is no event word)`);
  } finally { await w.cleanup(); }
  const key = `topic_${'pw_'.repeat(100000)}reset`; // one JSON key of 300 KB (a scan of every word's tail: ~25 s)
  const t0 = performance.now();
  detector.detect({ rel: 'appsettings.json', text: `{"${key}": "password-reset"}` }, { member: { key: 'm', projectDir: '/m' }, members: [], files: ['appsettings.json'], state: {} });
  assert.ok(performance.now() - t0 < 2000, `took ${(performance.now() - t0).toFixed(0)} ms`);
});

test('config-env: a config store of single-word services is skipped; Rails\' config/ (application.rb beside config_for files) and a Boot module\'s resources root with peer specs stay the member\'s', async () => {
  const w = await makeWorkspace({
    'config-repo': {
      'application.yml': 'eureka:\n  client:\n    serviceUrl:\n      defaultZone: http://registry:8761/eureka/\n',
      'orders.yml': 'x: 1\n', 'payments.yml': 'x: 1\n', 'gateway.yml': 'x: 1\n',
    },
    web: {
      ...javaSvc('web'),
      'src/main/resources/application.yml': 'spring:\n  application:\n    name: web-bff\nledger:\n  url: http://ledger:7000/api\n',
      'src/main/resources/billing-service.yaml': 'openapi: 3.0.0\npaths: {}\n', 'src/main/resources/order-service.yaml': 'openapi: 3.0.0\npaths: {}\n',
      'config/application.yml': 'audit:\n  url: http://audit:9000/v1\n', 'config/billing-service-api.yaml': 'openapi: 3.0.0\npaths: {}\n', 'config/order-service-client.yml': 'x: 1\n',
    },
    rails: { 'Gemfile': 'gem "rails"\n', 'app/models/a.rb': 'class A; end\n', 'config/application.rb': 'module X; end\n', 'config/application.yml': 'LEDGER_URL: http://ledger:7000/api\n', 'config/orders.yml': 'production:\n  url: http://orders:8080/v1\n', 'config/payments.yml': 'x: 1\n', 'config/billing-service.yml': 'x: 1\n' },
    orders: { ...javaSvc('orders'), 'src/main/resources/application.yml': 'bff:\n  url: http://web-bff:8080/api/x\npayments:\n  url: http://payments:8080/api/charges\n' },
    payments: javaSvc('payments'), gateway: javaSvc('gateway'), 'billing-service': javaSvc('billing-service'), 'order-service': javaSvc('order-service'), audit: javaSvc('audit'), ledger: javaSvc('ledger'), registry: javaSvc('registry'),
  });
  try {
    const p = edgePairs(await chainOf(w.members));
    assert.ok(!p.includes('config-repo->registry'), `the store's shared application.yml is no call of config-repo: ${p}`);
    for (const e of ['orders->payments', 'orders->web', 'web->ledger', 'web->audit', 'rails->ledger', 'rails->orders']) assert.ok(p.includes(e), `${e} missing: ${p}`);
  } finally { await w.cleanup(); }
});

test('config-env: a code-less deploy repo stays code-less with a root tool config, docs or a load test — its stack .env (and an env_file beside compose) call nobody', async () => {
  const w = await makeWorkspace({
    deploy: {
      'compose.yaml': 'services:\n  api:\n    image: ghcr.io/acme/api:1\n    env_file:\n      - backend.env\n',
      '.env': 'EMAIL_ADDR=http://email:6060\nQUOTE_ADDR=http://quote:8090\n', 'backend.env': 'LEDGER_URL=http://ledger:7000/api\n',
      'release.config.js': 'module.exports = {};\n', '.eslintrc.js': 'module.exports = {};\n', 'docs/conf.py': 'x = 1\n', 'load-test/locustfile.py': 'x = 1\n', 'package.json': '{}\n',
    },
    email: javaSvc('email'), quote: javaSvc('quote'), ledger: javaSvc('ledger'), api: javaSvc('api'),
  });
  try {
    const r = await runDetector(detector, w.members.find((m) => m.key === 'deploy'), w.members);
    assert.deepEqual(r.facts, [], JSON.stringify(r.facts.map((f) => [f.file, f.key])));
    const map = await chainOf(w.members);
    assert.ok(!map.edges.some((e) => e.from === 'deploy'), JSON.stringify(edgePairs(map)));
  } finally { await w.cleanup(); }
});

test('config-env: YAML aliases and a long parent key never multiply a file\'s pairs — a flattened key over 512 chars is skipped, one file yields at most 4 MiB of keys and values', () => {
  const ctx = () => ({ member: { key: 'm', projectDir: '/m' }, members: [], files: ['config/app.yml', 'app.js'], state: {} });
  const refs = (x, k) => `[${Array.from({ length: k }, () => x).join(', ')}]`;
  // one scalar visited 150 000 times through aliases: under a key of event words (~10 s), a 10 KB URL (~3 s)
  const aliased = `a: &v "${'aB'.repeat(124)}"\nb: &l ${refs('*v', 1000)}\ntopic_${'sent_'.repeat(99)}x: ${refs('*l', 150)}\n`;
  const url = `a: &v "http://h/${'x'.repeat(10240)}"\nb: &l ${refs('*v', 1000)}\nc: ${refs('*l', 150)}\n`;
  // two documents of 3 MB each: one budget spans the file
  const twoDocs = `a: &v "${'x'.repeat(10240)}"\nb: ${refs('*v', 300)}\n---\na: &v "${'x'.repeat(10240)}"\nb: ${refs('*v', 300)}\n`;
  for (const text of [aliased, url, twoDocs]) {
    const t0 = performance.now();
    const r = detector.detect({ rel: 'config/app.yml', text }, ctx());
    assert.ok(performance.now() - t0 < 2000, `took ${(performance.now() - t0).toFixed(0)} ms`);
    assert.deepEqual(r.unresolved.map((u) => u.reason), ['parse error: config too large']);
  }
  // a 64 KB JSON key over 2 000 leaves is 128 MB of flattened keys (a 400 KB key over 20 000 leaves ran out of memory)
  const leaves = Object.fromEntries(Array.from({ length: 2000 }, (_, i) => [`q${i}`, 'v']));
  const { pairs } = configPairs('config/app.json', JSON.stringify({ ['k'.repeat(65536)]: leaves, ledger: { url: 'http://ledger:7000/api' } }));
  assert.deepEqual(pairs.map((p) => p.key), ['ledger.url']);
});
