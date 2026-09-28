// test/wsmap-detectors-p3-e2e.test.mjs
// The P3 detectors through P1's real stages with the DEFAULT registry: extract → buildCatalog →
// joinMap, plus every brief and the description. Raw secrets in `.env`, compose and URLs never
// leave the checkout (P1 redacts centrally; detectors hand over raw text), and the facts join into
// cross-member edges — a localhost URL under `LEDGER_URL` names `ledger` through P1's envStems and,
// being a guess, yields a `heuristic` edge; a gRPC client meets its server; an OpenAPI route meets
// the URL a compose file calls. A value under a secret-named key never becomes a key, and a webhook
// URL whose path is the credential gives no http fact.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { makeWorkspace } from './helpers/wsmap-fixtures.mjs';
import { extractWorkspace, surveyBrief } from '../src/core/workspace-map/extract.mjs';
import { buildCatalog, usageBriefs } from '../src/core/workspace-map/catalog.mjs';
import { joinMap, synthBrief } from '../src/core/workspace-map/join.mjs';
import { renderWorkspaceDescription } from '../src/shared/workspace-map/render.mjs';

const pom = (artifact, deps = []) => ['<project>', '  <groupId>com.acme</groupId>', `  <artifactId>${artifact}</artifactId>`, '  <dependencies>',
  ...deps.map((a) => `    <dependency><groupId>com.acme</groupId><artifactId>${a}</artifactId></dependency>`), '  </dependencies>', '</project>', ''].join('\n');
const PROTO = 'syntax = "proto3";\npackage acme.billing.v1;\nservice Billing {\n  rpc GetInvoice(GetInvoiceRequest) returns (Invoice);\n}\n';
const SLACK = 'https://hooks.slack.com/services/T0AAAAAAA/B0BBBBBBB/abcdefghijklmnopqrstuvwx';
const TEAMS = 'https://acme.webhook.office.com/webhookb2/aaaaaaaa-1111-2222-3333-bbbbbbbbbbbb@cccccccc-4444-5555-6666-dddddddddddd/IncomingWebhook/0123456789abcdef0123456789abcdef/eeeeeeee-7777-8888-9999-ffffffffffff';
// A one-line appsettings.json whose Billing URL uses JSON's `\/` escape: that fact's needle is not on
// the line, so the detector cites the line's head — which must never end inside the Db password.
const LEAD = '{"Billing":"http:\\/\\/billing-api:8080","Pad":"';
const APPSETTINGS = `${LEAD}${'x'.repeat(190 - LEAD.length - '","Db":"postgres://app:'.length)}","Db":"postgres://app:Zq9e2es3cretXy@db:5432/shop"}`;
const ws = await makeWorkspace({
  'billing-api': {
    'pom.xml': pom('billing-api'), 'api/openapi.yaml': 'openapi: 3.0.0\npaths:\n  /invoices:\n    get: {}\n',
    'proto/billing.proto': PROTO, 'cmd/server.go': 'package main\nfunc main() { pb.RegisterBillingServer(s, &srv{}) }\n',
  },
  ledger: { 'README.md': '# ledger\n\nThe ledger service.\n' },
  web: {
    'pom.xml': pom('web', ['billing-api']),
    '.env': `DATABASE_URL=postgres://app:s3cr3t@db:5432/billing\nAPI_TOKEN=abc123\nLEDGER_URL=http://localhost:7000/ledger/v1\nQUEUE_PASSWORD=Zq8vN3pLx2\nSLACK_WEBHOOK_URL=${SLACK}\nTEAMS_WEBHOOK_URL=${TEAMS}\nEVENTS_TOPIC_HMAC=Zq9hm4c7x\nZAPIER_HOOK_URL=https://hooks.zapier.com/hooks/catch/123456/Zq9zap1er/\nDD_LOGS_URL=https://http-intake.logs.datadoghq.com/v1/input/Zq9dd0123456789abcdef0123456789\nBROKEN_DB_URL=postgres://app:ab/Zq9tail,x@db/shop\nORDERS_QUEUE_API_KEY2=Zq9ApiKey2xK2mP7vL4\n`,
    'proto/billing.proto': PROTO, 'client.go': 'package web\nfunc c() { pb.NewBillingClient(conn) }\n', 'appsettings.json': APPSETTINGS,
    'docker-compose.yml': 'services:\n  web:\n    build: .\n    environment:\n      BILLING_URL: http://svc:pa55w0rd@billing-api:8080/invoices\n      DB: "Server=pg;Database=shop;User Id=sa;Password=s3cr3t;"\n',
  },
  // A code-less deploy repo: it builds web from `./`, keeps the stack's .env and runs billing-api under an image named otherwise.
  deploy: {
    'compose.yaml': 'services:\n  web:\n    build:\n      context: ./\n      dockerfile: web/Dockerfile\n',
    '.env': 'LEDGER_URL=http://ledger:7000/v1\n',
    'k8s/billing.yaml': 'apiVersion: apps/v1\nkind: Deployment\nmetadata: { name: billing-api }\nspec:\n  template:\n    spec:\n      containers:\n        - image: ghcr.io/acme/billing-svc:1\n          env:\n            - { name: LEDGER_URL, value: "http://ledger:7000/x" }\n',
  },
});
after(() => ws.cleanup());

test('P3 end to end with the default registry: facts join into edges; no raw secret in extract, catalog, briefs, map or description', async () => {
  const extract = await extractWorkspace({ name: 'Shop', members: ws.members });
  const catalog = await buildCatalog({ extract, survey: null });
  const map = await joinMap({ catalog, usage: null });
  const briefs = usageBriefs(catalog, { catalogPath: '/p/catalog.json', checkerCmd: 'CHECK' });
  const text = renderWorkspaceDescription({ name: 'Shop', map, budget: 300 });
  const everything = [JSON.stringify(extract), surveyBrief(extract, { extractPath: '/p/extract.json', checkerCmd: 'CHECK' }), JSON.stringify(catalog),
    briefs.index, ...Object.values(briefs.files), JSON.stringify(map), synthBrief(map, { mapPath: '/p/map.json', checkerCmd: 'CHECK' }), text].join('\n');
  for (const secret of ['s3cr3t', 'pa55w0rd', 'abc123', 'Zq8vN3pLx2', 'abcdefghijklmnopqrstuvwx', '0123456789abcdef0123456789abcdef', 'Zq9e2es', 'Zq9hm4c7x', 'Zq9zap1er', 'Zq9dd0123456789abcdef0123456789', 'Zq9tail', 'Zq9ApiKey2xK2mP7vL4']) assert.ok(!everything.includes(secret), `${secret} leaked`);
  const edge = (from, to, kind) => map.edges.find((e) => e.from === from && e.to === to && e.kind === kind);
  assert.equal(edge('web', 'billing-api', 'pkg')?.confidence, 'exact', `pom dependency → pom artifact: ${JSON.stringify(map.edges.map((e) => [e.from, e.to, e.kind, e.confidence]))}`);
  assert.equal(edge('web', 'billing-api', 'service')?.confidence, 'exact', 'a compose URL host names the member');
  assert.equal(edge('web', 'ledger', 'http')?.confidence, 'heuristic', 'a localhost URL under LEDGER_URL names ledger (envStems) — a guess, never exact');
  assert.equal(edge('web', 'billing-api', 'grpc')?.confidence, 'exact', 'a gRPC client hint meets the server hint of the same .proto service');
  assert.equal(edge('web', 'billing-api', 'http')?.display, 'GET /invoices', 'the compose URL\'s path meets the OpenAPI route of the member its host names');
  assert.deepEqual(catalog.ambiguousAliases, {}, 'the deploy repo names `web` and `billing-api` for those members, never for itself');
  assert.ok(!map.edges.some((e) => e.from === 'deploy'), 'a deploy repo configures its peers; it calls none');
  assert.ok(extract.members.web.consumes.some((f) => f.kind === 'db' && f.match === 'postgres://***@db:5432/billing'), 'the db fact keeps its redacted, recognisable evidence');
});
