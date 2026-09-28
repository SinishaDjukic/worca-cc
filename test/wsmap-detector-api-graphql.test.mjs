import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { makeWorkspace, runDetector, keysOf, assertEvidence } from './helpers/wsmap-fixtures.mjs';
import detector from '../src/core/workspace-map/detectors/api-graphql.mjs';

const SDL = `"""
type Query { fake: Int }   <- inside a description, not a type
"""
type Query {
  "Find one invoice"
  invoice(id: ID!, filter: InvoiceFilter = { status: OPEN }): Invoice @deprecated(reason: "use invoiceById")
  invoices(
    first: Int
  ): [Invoice!]!
  # removed: legacyInvoices: [Invoice]
}

type Invoice { id: ID! total: Float }

extend type Mutation {
  payInvoice(id: ID!): Invoice
}
`;
const RENAMED = `schema { query: RootQuery }\ntype RootQuery {\n  ledger: [Entry]\n}\ntype Query {\n  notARoot: Int\n}\n`;
const OPS = `query GetInvoice($id: ID!) {
  inv: invoice(id: $id) { id total }
  ... RootFields
  ... on Query { invoices { id } }
}

mutation Pay {
  payInvoice(id: 1) {
    id
  }
}

fragment RootFields on Query { invoices { id } }
`;
const TS_CLIENT = "import { gql } from '@apollo/client';\nconst Q = gql`\n  query Invoices {\n    invoices(first: 10) { id }\n  }\n`;\nconst M = graphql(`mutation { payInvoice(id: 2) { id } }`);\n";
const TS_SERVER = "export const typeDefs = gql`\n  type Query {\n    orders: [Order]\n  }\n  type Order { id: ID }\n`;\n";
const PY_CLIENT = 'from gql import gql\nQ = gql("""\n    subscription OnPaid {\n        invoicePaid { id }\n    }\n""")\n';

let ws;
before(async () => {
  ws = await makeWorkspace({
    billing: { 'schema/billing.graphqls': SDL.replace(/\n/g, '\r\n'), 'schema/renamed.graphql': RENAMED },
    web: {
      'src/queries.graphql': OPS, 'src/api.ts': TS_CLIENT, 'src/__tests__/q.test.ts': 'const T = gql`{ invoice(id: 1) { id } }`;\n',
      'src/payments.graphql': 'query Payments {\n  payments {\n    id\n    type\n    amount\n  }\n}\n',
      'src/events.ts': 'export const E = gql`query { events { type id } }`;\n',
      'src/orders.graphql': 'query Orders($f: OrderFilter = { status: OPEN }) {\n  orders(filter: $f) { id }\n}\n\nquery Cached @cached(opts: { ttl: 60 }) {\n  carts { id }\n}\n',
      'public/app.js': `var a=${'1+'.repeat(800)}1;const Q=gql\`query { vendorSecret { id } }\`;\n`,
    },
    orders: { 'src/schema.ts': TS_SERVER, 'jobs/listen.py': PY_CLIENT },
  });
});
after(() => ws.cleanup());
const member = (k) => ws.members.find((m) => m.key === k);

test('api-graphql SDL (CRLF): root fields provided; args, directives, descriptions and comments ignored; extend type counts', async () => {
  const r = await runDetector(detector, member('billing'), ws.members);
  assert.deepEqual(keysOf(r, 'graphql', 'provides'), ['Mutation.payInvoice', 'Query.invoice', 'Query.invoices', 'Query.ledger']);
  assert.equal(r.facts.find((f) => f.key === 'Query.invoice').line, 6);
  assert.equal(r.facts.find((f) => f.key === 'Query.ledger').file, 'schema/renamed.graphql', 'schema { query: RootQuery } renames the root; the plain Query type is then not a root');
  assertEvidence(member('billing'), r);
});

test('api-graphql operations: root fields consumed per operation kind; aliases resolved; fragments are not roots', async () => {
  const r = await runDetector(detector, member('web'), ws.members);
  const doc = r.facts.filter((f) => f.file === 'src/queries.graphql');
  assert.deepEqual(doc.map((f) => [f.key, f.detail, f.line]), [['Query.invoice', 'query GetInvoice', 2], ['Mutation.payInvoice', 'mutation Pay', 8]]);
  assertEvidence(member('web'), r);
});

test('api-graphql code templates: gql`…` and graphql(`…`) operations consume; typeDefs SDL provides; Python gql("""…""")', async () => {
  const web = await runDetector(detector, member('web'), ws.members);
  assert.deepEqual(web.facts.filter((f) => f.file === 'src/api.ts').map((f) => [f.key, f.line]), [['Query.invoices', 4], ['Mutation.payInvoice', 7]]);
  const orders = await runDetector(detector, member('orders'), ws.members);
  assert.deepEqual(keysOf(orders, 'graphql', 'provides'), ['Query.orders']);
  assert.deepEqual(keysOf(orders, 'graphql', 'consumes'), ['Subscription.invoicePaid']);
  assertEvidence(member('orders'), orders);
});

test('api-graphql: a selected field named `type` is no SDL; variable defaults and directive arguments may hold braces; a minified bundle is skipped', async () => {
  const r = await runDetector(detector, member('web'), ws.members);
  const at = (file) => r.facts.filter((f) => f.file === file).map((f) => [f.key, f.detail, f.line]);
  assert.deepEqual(at('src/payments.graphql'), [['Query.payments', 'query Payments', 2]]);
  assert.deepEqual(at('src/events.ts'), [['Query.events', 'query', 1]]);
  assert.deepEqual(at('src/orders.graphql'), [['Query.orders', 'query Orders', 2], ['Query.carts', 'query Cached', 6]]);
  assert.deepEqual(at('public/app.js'), [], 'a JS file whose first 4 KiB holds a line over 1 000 chars is a bundle');
});

test('api-graphql: test files still emit (marked test); an unterminated template never throws', async () => {
  const r = await runDetector(detector, member('web'), ws.members);
  assert.equal(r.facts.find((f) => f.file === 'src/__tests__/q.test.ts').test, true);
  assert.deepEqual(detector.detect({ rel: 'a.ts', text: 'const q = gql`query { a ' }, {}), { facts: [] });
});
