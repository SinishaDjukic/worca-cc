import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { makeWorkspace, runDetector, keysOf, assertEvidence } from './helpers/wsmap-fixtures.mjs';
import detector from '../src/core/workspace-map/detectors/api-asyncapi.mjs';

const V2 = `asyncapi: 2.6.0
info: { title: Billing events, version: "1" }
channels:
  invoice/paid:
    subscribe:
      operationId: onInvoicePaid
      message: { name: InvoicePaid }
  order.placed:
    publish:
      message: { name: OrderPlaced }
`;
const V3 = `{
  "asyncapi": "3.0.0",
  "channels": {
    "paid": { "address": "invoice.paid.v3" },
    "refund": {}
  },
  "operations": {
    "sendPaid": { "action": "send", "channel": { "$ref": "#/channels/paid" } },
    "onRefund": { "action": "receive", "channel": { "$ref": "#/channels/refund" } },
    "ghost": { "action": "receive", "channel": { "$ref": "#/channels/missing" } }
  }
}
`;

let ws;
before(async () => {
  ws = await makeWorkspace({
    billing: { 'asyncapi.yaml': V2.replace(/\n/g, '\r\n'), 'docs/events.json': V3, 'notes.yaml': 'asyncapi_version_note: nope\n' },
    broken: { 'asyncapi.yml': 'asyncapi: 2.0.0\nchannels:\n  a: [\n' },
    mini: { 'events.json': '{"asyncapi":"2.6.0","channels":{"orders.shipped":{"subscribe":{}}}}' },
  });
});
after(() => ws.cleanup());
const member = (k) => ws.members.find((m) => m.key === k);

test('api-asyncapi 2.x (CRLF): subscribe = the app produces → provides; publish = the app consumes → consumes', async () => {
  const r = await runDetector(detector, member('billing'), ws.members);
  const v2 = r.facts.filter((f) => f.file === 'asyncapi.yaml');
  assert.deepEqual(v2.map((f) => [f.dir, f.key, f.line, f.detail]), [
    ['provides', 'invoice/paid', 4, 'AsyncAPI 2 subscribe onInvoicePaid'],
    ['consumes', 'order.placed', 8, 'AsyncAPI 2 publish'],
  ]);
  assertEvidence(member('billing'), r);
});

test('api-asyncapi 3.x (JSON): send → provides at the channel address; receive → consumes (channel key when no address); dangling $ref unresolved', async () => {
  const r = await runDetector(detector, member('billing'), ws.members);
  const v3 = r.facts.filter((f) => f.file === 'docs/events.json');
  assert.deepEqual(v3.map((f) => [f.dir, f.key, f.line]), [['provides', 'invoice.paid.v3', 4], ['consumes', 'refund', 5]]);
  assert.deepEqual(r.unresolved.map((u) => [u.raw, u.reason]), [['operations.ghost', 'unresolved channel $ref']]);
  assert.deepEqual(keysOf(r, 'topic', 'provides'), ['invoice.paid.v3', 'invoice/paid']);
});

test('api-asyncapi: a minified JSON document passes the gate', async () => {
  const r = await runDetector(detector, member('mini'), ws.members);
  assert.deepEqual(keysOf(r, 'topic', 'provides'), ['orders.shipped']);
});

test('api-asyncapi: malformed document or $ref → unresolved, never throws', async () => {
  const r = await runDetector(detector, member('broken'), ws.members);
  assert.ok(r.unresolved[0].reason.startsWith('parse error'));
  const odd = detector.detect({ rel: 'a.yaml', text: 'asyncapi: 3.0.0\nchannels: { a: {} }\noperations:\n  o: { action: send, channel: { $ref: "#/channels/100%" } }\n' }, {});
  assert.deepEqual(odd.unresolved.map((u) => u.reason), ['unresolved channel $ref'], 'a malformed %-escape is not a throw');
});
