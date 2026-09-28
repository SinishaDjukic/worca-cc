import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { makeWorkspace, runDetector, assertEvidence } from './helpers/wsmap-fixtures.mjs';
import detector from '../src/core/workspace-map/detectors/deploy-compose.mjs';

// The web repo runs its own service plus images of its peers for local dev.
const WEB_COMPOSE = `x-common-env: &common
  LOG_LEVEL: info
  AUTH_URL: http://auth:9000/oauth/token

services:
  web:
    build: .
    container_name: web-app
    environment:
      <<: *common
      BILLING_URL: http://billing:8080/api/v1
      DATABASE_URL: postgres://app:secret@db:5432/shop
      ORDERS_URL: \${ORDERS_URL}
      LEDGER_URL: http://localhost:7000/ledger/v1
    depends_on:
      - billing
      - db
    links:
      - "cache:redis"
  billing:
    image: ghcr.io/acme/billing-api:1.4
    networks:
      default:
        aliases: [billing-svc]
  db:
    image: postgres:16
`;
// A deploy repo orchestrating everything: build contexts point into sibling members.
const DEPLOY_COMPOSE = `services:
  billing:
    build:
      context: ../../../billing-api
      dockerfile: Dockerfile
    environment:
      - LEDGER_URL=http://ledger:7000
  web:
    build: ../../../web
    depends_on:
      billing:
        condition: service_healthy
  worker:
    build: \${WORKER_CONTEXT}
`;

let ws;
before(async () => {
  ws = await makeWorkspace({
    web: { 'docker-compose.yml': WEB_COMPOSE, 'e2e/compose.test.yaml': 'services:\n  web:\n    build: ..\n    environment:\n      API: http://billing:8080\n  billing:\n    build: ./stubs/billing\n' },
    'billing-api': { 'Dockerfile': 'FROM scratch\n' },
    deploy: { 'stacks/dev/compose.yaml': DEPLOY_COMPOSE.replace(/\n/g, '\r\n') },
    // A service repo's dev stack: its own service, a local database image and a stub of a peer, built from sub-directories.
    stubbed: {
      'docker-compose.yml': 'services:\n  app:\n    build: .\n    depends_on: [db, billing]\n  db:\n    build: ./docker/db\n  billing:\n    build: ./stubs/billing\n  ledger-mock:\n    build:\n      context: ./mocks/ledger-mock\n',
      'docs/compose.yml': 'services:\n  demo:\n    build: ..\n    depends_on: [billing]\n',
    },
    broken: { 'docker-compose.yml': 'services:\n  api:\n    build: .\n    environment: [A=http://x:1\n  bad: : :\n' },
    big: {
      'docker-compose.yml': `services:\n  api:\n    build: .\n    labels:\n${'      x: y\n'.repeat(30000)}`,
      'docker-compose.override.yml': 'services:\n  api:\n    build: .\n    environment:\n      A: http://first:1\n    environment:\n      B: http://second:2\n',
    },
  });
});
after(() => ws.cleanup());
const member = (k) => ws.members.find((m) => m.key === k);

test('deploy-compose: build: . → aliases for this member (name, container_name); image repo → alias for that member', async () => {
  const r = await runDetector(detector, member('web'), ws.members);
  const own = [...new Set(r.aliases.filter((a) => a.member === 'web').map((a) => a.value))].sort();
  assert.deepEqual(own, ['web', 'web-app']);
  const billing = r.aliases.filter((a) => a.member === 'billing-api').map((a) => a.value).sort();
  assert.deepEqual(billing, ['billing', 'billing-svc']);
  assert.ok(!r.aliases.some((a) => a.value === 'db'), 'postgres:16 matches no member → no alias');
});

test('deploy-compose: own service consumes depends_on, links, env URLs (merge keys expanded)', async () => {
  const r = await runDetector(detector, member('web'), ws.members);
  const prod = r.facts.filter((f) => f.file === 'docker-compose.yml');
  assert.deepEqual(prod.filter((f) => f.kind === 'service').map((f) => f.key).sort(), ['auth', 'billing', 'cache', 'db'], 'one fact per (dir, key) per file');
  assert.deepEqual(prod.filter((f) => f.kind === 'http').map((f) => [f.key, f.target]).sort(), [['/api/v1', 'billing:8080'], ['/ledger/v1', 'LEDGER_URL'], ['/oauth/token', 'auth:9000']]);
  assert.equal(prod.find((f) => f.key === '/ledger/v1').confidence, 'heuristic', 'no usable host: the variable names the peer (P1 envStems)');
  assert.deepEqual(prod.filter((f) => f.kind === 'db').map((f) => [f.key, f.target]), [['db:shop', 'db:5432']]);
  const billingUrl = prod.find((f) => f.kind === 'http' && f.key === '/api/v1');
  assert.deepEqual([billingUrl.line, billingUrl.detail], [11, 'BILLING_URL (web)']);
  assert.equal(prod.find((f) => f.key === '/oauth/token').line, 3, 'a merged value cites its anchor line');
  assertEvidence(member('web'), r);
});

test('deploy-compose: a peer-looking placeholder env value is unresolved', async () => {
  const r = await runDetector(detector, member('web'), ws.members);
  assert.deepEqual(r.unresolved.map((u) => [u.raw, u.reason, u.line]), [['ORDERS_URL=${ORDERS_URL}', 'placeholder', 13]]);
});

test('deploy-compose: test-path compose files still emit facts (marked test) but never alias — a stub never claims a peer\'s name', async () => {
  const r = await runDetector(detector, member('web'), ws.members);
  const t = r.facts.filter((f) => f.file === 'e2e/compose.test.yaml');
  assert.ok(t.length > 0 && t.every((f) => f.test === true));
  assert.ok(!r.aliases.some((a) => a.value === 'billing' && a.member === 'web'), 'the e2e stub `billing` (build: ./stubs/billing) aliases nobody');
});

test('deploy-compose (deploy repo, CRLF): aliases go to the members the contexts point into; no consumes are attributed to deploy', async () => {
  const r = await runDetector(detector, member('deploy'), ws.members);
  assert.deepEqual(r.aliases.map((a) => [a.value, a.member]).sort(), [['billing', 'billing-api'], ['web', 'web']]);
  assert.deepEqual(r.facts, []);
  assert.deepEqual(r.unresolved.map((u) => [u.raw, u.reason]), [['build: ${WORKER_CONTEXT}', 'compose variable in build context']]);
});

test('deploy-compose: a service built from a sub-directory (a local db image, a stub of a peer) aliases the member only with a multi-word name; samples are not read', async () => {
  const r = await runDetector(detector, member('stubbed'), ws.members);
  assert.deepEqual(r.aliases.map((a) => a.value).sort(), ['app', 'ledger-mock'], '`db` and the stub `billing` would name this member for every peer that calls its own db or the real billing');
  assert.deepEqual(r.facts.map((f) => [f.file, f.key]).sort(), [['docker-compose.yml', 'billing'], ['docker-compose.yml', 'db']], 'its own consumes still count; docs/compose.yml is a sample');
  assert.equal(detector.claims('docs/compose.yml'), false);
});

test('deploy-compose: plain YAML over 256 KiB is refused (unresolved), other compose files still read', async () => {
  const r = await runDetector(detector, member('big'), ws.members);
  assert.deepEqual(r.unresolved.map((u) => [u.file, u.reason]), [['docker-compose.yml', 'yaml parse error: yaml too large']]);
  assert.ok(r.facts.length > 0);
});

test('deploy-compose: a duplicated key (hand-merged file) → the last one wins, no error', async () => {
  const r = await runDetector(detector, member('big'), ws.members);
  assert.deepEqual(r.facts.filter((f) => f.file === 'docker-compose.override.yml').map((f) => f.key), ['second']);
});

test('deploy-compose: malformed YAML → partial result + unresolved, never throws; compose file-name variants are claimed', async () => {
  const r = await runDetector(detector, member('broken'), ws.members);
  assert.equal(r.unresolved[0].reason.startsWith('yaml parse error'), true);
  for (const rel of ['docker-compose-dev.yml', 'ops/compose-prod.yaml', 'docker-compose.override.yml', 'compose.yaml']) assert.equal(detector.claims(rel), true, rel);
  for (const rel of ['composer.yaml', 'my-compose.yml', 'docker-compose.yml.bak']) assert.equal(detector.claims(rel), false, rel);
});

test('deploy-compose: a service named like another member is that member\'s (a deploy repo building every service from ./); no alias names a member other than its subject; a test stack gives nothing', async () => {
  const w = await makeWorkspace({
    cart: { 'README.md': '# cart\n' },
    billing: { 'README.md': '# billing\n' },
    'billing-api': { 'README.md': '# billing-api\n' },
    // billing-api's own stack names its service `billing` (a `billing` member exists): still billing-api's, never aliased `billing`.
    'billing-api': { 'compose.yaml': 'services:\n  billing:\n    build: .\n    image: ghcr.io/acme/billing-api:dev\n    environment:\n      - LEDGER_URL=http://ledger:7000/x\n' },
    deploy: {
      'compose.yaml': 'services:\n  cart:\n    build:\n      context: ./\n      dockerfile: src/cart/Dockerfile\n    environment:\n      - LEDGER_URL=http://ledger:7000/api\n  billing:\n    image: ghcr.io/acme/billing-api:1\n  proxy:\n    build: .\n    depends_on: [cart]\n',
      'compose.e2e.yaml': 'services:\n  runner:\n    build: .\n    depends_on: [cart, billing]\n',
    },
  });
  try {
    const deploy = w.members.find((m) => m.key === 'deploy');
    const r = await runDetector(detector, deploy, w.members);
    assert.deepEqual(r.aliases.map((a) => [a.value, a.member]).sort(), [['cart', 'cart'], ['proxy', 'deploy']],
      'cart → the member cart; `billing` (image billing-api) never names billing-api while a `billing` member exists; no e2e runner');
    assert.deepEqual(r.facts.map((f) => [f.kind, f.key, f.file]), [['service', 'cart', 'compose.yaml']], 'only proxy is deploy\'s own: cart\'s env is cart\'s, the e2e runner makes no call');
    assertEvidence(deploy, r);
    const own = await runDetector(detector, w.members.find((m) => m.key === 'billing-api'), w.members);
    assert.deepEqual([own.aliases, own.facts.map((f) => [f.kind, f.key])], [[], [['service', 'ledger'], ['http', '/x']]], 'an image naming this member keeps the service this member\'s');
  } finally { await w.cleanup(); }
});

test('deploy-compose: a service built from the member root with its own Dockerfile is this member\'s whatever it is named; a per-service build (its path names the service, an interpolated dockerfile) is the member it is named like', async () => {
  const w = await makeWorkspace({
    web: { 'README.md': '# web\n' },
    api: { 'README.md': '# api\n' },
    'fraud-detection': { 'README.md': '# fraud-detection\n' },
    // a Django repo whose own services are named `web` and `api` while members `web` and `api` exist
    orders: { 'docker-compose.yml': 'services:\n  web:\n    build: .\n    environment:\n      PAYMENTS_URL: http://payments:8080/api/charge\n  api:\n    build:\n      context: .\n      dockerfile: docker/Dockerfile\n    depends_on: [db]\n' },
    // a deploy repo interpolating each service's dockerfile from its .env (opentelemetry-demo; the variable need not name the service)
    deploy: { 'compose.yaml': 'services:\n  fraud-detection:\n    build:\n      context: ./\n      dockerfile: ${FRAUD_DOCKERFILE}\n    environment:\n      - LEDGER_URL=http://ledger:7000/api\n', '.env': 'FRAUD_DOCKERFILE=./src/fraud-detection/Dockerfile\n' },
  });
  try {
    const orders = w.members.find((m) => m.key === 'orders');
    const r = await runDetector(detector, orders, w.members);
    assert.deepEqual(r.facts.map((f) => [f.kind, f.key]).sort(), [['http', '/api/charge'], ['service', 'db'], ['service', 'payments']], 'orders keeps its own services\' calls');
    assert.deepEqual(r.aliases, [], '`web` and `api` name other members: never an alias of orders');
    assertEvidence(orders, r);
    const deploy = await runDetector(detector, w.members.find((m) => m.key === 'deploy'), w.members);
    assert.deepEqual([deploy.aliases.map((a) => [a.value, a.member]), deploy.facts], [[['fraud-detection', 'fraud-detection']], []], 'an interpolated dockerfile is a per-service build: fraud-detection\'s');
  } finally { await w.cleanup(); }
});

test('deploy-compose: a generic interpolated dockerfile (${DOCKERFILE:-Dockerfile}) is this member\'s own build; ${FRAUD_DOCKERFILE} still names fraud-detection', async () => {
  const facts = (r) => r.facts.map((f) => [f.kind, f.key]).sort();
  const w = await makeWorkspace({
    web: { 'src/index.js': 'x\n' },
    'fraud-detection': { 'main.go': 'package main\n' },
    orders: { 'manage.py': 'x\n', 'docker-compose.yml': 'services:\n  web:\n    build: { context: ., dockerfile: "${DOCKERFILE:-Dockerfile}" }\n    environment:\n      LEDGER_URL: http://ledger:7000/v1\n' },
    deploy: { 'compose.yaml': 'services:\n  fraud-detection:\n    build: { context: ./, dockerfile: "${FRAUD_DOCKERFILE}" }\n    environment:\n      LEDGER_URL: http://ledger:7000/v1\n' },
  });
  try {
    const orders = await runDetector(detector, w.members.find((m) => m.key === 'orders'), w.members);
    assert.deepEqual(facts(orders), [['http', '/v1'], ['service', 'ledger']]);
    const deploy = await runDetector(detector, w.members.find((m) => m.key === 'deploy'), w.members);
    assert.deepEqual([deploy.facts, deploy.aliases.map((a) => [a.value, a.member])], [[], [['fraud-detection', 'fraud-detection']]]);
  } finally { await w.cleanup(); }
});

test('deploy-compose: an interpolated build context quotes its git URL from the host on (a basic-auth password holding / or a bare token user)', async () => {
  const w = await makeWorkspace({ web: { 'main.go': 'package main\n', 'docker-compose.yml': 'services:\n  web:\n    build: https://deploy:pa/Zq9c1x@git.acme.internal/acme/${REPO}.git#main\n  api:\n    build: https://Zq9c2token0123456789@git.acme.internal/acme/${REPO}.git\n' } });
  try {
    const r = await runDetector(detector, w.members[0], w.members);
    assert.deepEqual(r.unresolved.map((u) => u.raw), ['build: https://git.acme.internal/acme/${REPO}.git#main', 'build: https://git.acme.internal/acme/${REPO}.git']);
  } finally { await w.cleanup(); }
});
