import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { makeWorkspace, runDetector, keysOf, assertEvidence } from './helpers/wsmap-fixtures.mjs';
import detector from '../src/core/workspace-map/detectors/api-openapi.mjs';

const OAS3 = `openapi: 3.0.3
info: { title: Billing, version: "1" }
servers:
  - url: https://api.acme.com/billing/v1
paths:
  /invoices:
    get:
      operationId: listInvoices
    post: {}
  "/invoices/{id}":
    parameters: []
    get: {}
    x-internal: true
  /health: {}
components: {}
`;
const SWAGGER_JSON = `{
  "swagger": "2.0",
  "host": "ledger.acme.internal",
  "basePath": "/api",
  "paths": {
    "/entries": { "get": {}, "put": {} }
  }
}
`;
// web keeps a copy of billing's spec for client generation: servers point at billing.
const CLIENT_COPY = `openapi: "3.1.0"
servers:
  - url: http://billing:8080
paths:
  /invoices/{id}:
    get: {}
`;

let ws;
before(async () => {
  ws = await makeWorkspace({
    billing: { 'api/openapi.yaml': OAS3.replace(/\n/g, '\r\n'), 'package.json': '{"openapi": "3.0.0"}', 'docs/notes.yaml': 'title: not a spec\n' },
    ledger: { 'swagger.json': SWAGGER_JSON },
    web: {
      'clients/billing.yaml': CLIENT_COPY, 'test/fixtures/spec.yaml': 'openapi: 3.0.0\npaths:\n  /mock:\n    get: {}\n',
      // Nested: the file layer skips a third_party/ folder at the member root before any detector runs (M8).
      'clients/third_party/stripe/openapi.yaml': 'openapi: 3.0.0\nservers:\n  - url: https://api.stripe.com\npaths:\n  /v1/charges:\n    post: {}\n',
    },
    broken: { 'openapi.yaml': 'openapi: 3.0.0\npaths:\n  /a:\n    get: [\n' },
    // billing-api's own spec lists the in-cluster name `billing` and its public host; a member named `billing` exists.
    'billing-api': { 'api/openapi.yaml': 'openapi: 3.0.0\nservers:\n  - url: http://billing:8080\n  - url: https://billing.acme.com/v1\npaths:\n  /payments:\n    get: {}\n' },
    // payments' own API is published under the billing domain; `billing` is another member.
    payments: { 'openapi.yaml': 'openapi: 3.0.0\nservers:\n  - url: https://billing.acme.com/payments/v1\npaths:\n  /refunds:\n    post: {}\n' },
    mini: { 'openapi.json': '{"openapi":"3.0.0","paths":{"/a":{"get":{}}}}', 'api/spec/openapi.yaml': 'openapi: 3.0.0\npaths:\n  /b:\n    get: {}\n' },
  });
});
after(() => ws.cleanup());
const member = (k) => ws.members.find((m) => m.key === k);

test('api-openapi (OAS3, CRLF): paths × methods provide http; prefix + operationId in detail; non-methods skipped', async () => {
  const r = await runDetector(detector, member('billing'), ws.members);
  assert.deepEqual(keysOf(r, 'http', 'provides'), ['GET /invoices', 'GET /invoices/{id}', 'POST /invoices']);
  const list = r.facts.find((f) => f.key === 'GET /invoices');
  assert.deepEqual([list.line, list.match, list.detail, list.norm], [6, '/invoices', 'OpenAPI, prefix /billing/v1, operationId listInvoices', 'http:GET /invoices']);
  assert.equal(r.facts.find((f) => f.key === 'GET /invoices/{id}').norm, 'http:GET /invoices/{}');
  assertEvidence(member('billing'), r);
});

test('api-openapi (Swagger 2 JSON): basePath prefix recorded; own host → provides', async () => {
  const r = await runDetector(detector, member('ledger'), ws.members);
  assert.deepEqual(keysOf(r, 'http', 'provides'), ['GET /entries', 'PUT /entries']);
  assert.equal(r.facts[0].detail, 'Swagger, prefix /api');
  assert.equal(r.facts[0].line, 6);
});

test('api-openapi: a spec whose server names another member is consumed, target = that host', async () => {
  const r = await runDetector(detector, member('web'), ws.members);
  const c = r.facts.filter((f) => f.file === 'clients/billing.yaml');
  assert.deepEqual(c.map((f) => [f.dir, f.key, f.target]), [['consumes', 'GET /invoices/{id}', 'billing:8080']]);
  assert.equal(r.facts.find((f) => f.file === 'test/fixtures/spec.yaml').test, true);
  assert.ok(!r.facts.some((f) => f.file.includes('third_party/')), 'a vendored third-party spec is not this member\'s API');
  assert.deepEqual(r.unresolved.map((u) => [u.file, u.reason]), [['clients/third_party/stripe/openapi.yaml', 'third-party spec (vendored)']]);
});

test('api-openapi: a member\'s own spec stays provides — its in-cluster name is one of its own name words, a public host names a member only whole (P1 host rule)', async () => {
  const r = await runDetector(detector, member('billing-api'), ws.members);
  assert.deepEqual(r.facts.map((f) => [f.dir, f.key, f.target]), [['provides', 'GET /payments', undefined]]);
  const p = await runDetector(detector, member('payments'), ws.members);
  assert.deepEqual(p.facts.map((f) => [f.dir, f.key]), [['provides', 'POST /refunds']], 'billing.acme.com is not the member `billing` (a public host names a member only whole)');
});

test('api-openapi: a minified JSON spec passes the gate; a contract under spec/ is not a test file', async () => {
  const r = await runDetector(detector, member('mini'), ws.members);
  assert.deepEqual(keysOf(r, 'http', 'provides'), ['GET /a', 'GET /b']);
  assert.equal(r.facts.find((f) => f.key === 'GET /b').test, false, 'api/spec/openapi.yaml is what the member serves');
});

test('api-openapi: non-spec YAML/JSON ignored; manifests skipped; malformed spec → unresolved, never throws', async () => {
  assert.equal(detector.claims('package.json'), false);
  assert.equal(detector.claims('pnpm-lock.yaml'), false);
  const r = await runDetector(detector, member('broken'), ws.members);
  assert.ok(r.unresolved[0].reason.startsWith('parse error'));
});
