// test/wsmap-graphql-client-copy.test.mjs
// A client repository keeps a copy of its server's GraphQL schema: Apollo Kotlin (src/main/graphql/schema.graphqls),
// Apollo iOS and Relay need one, graphql-codegen setups often commit one. Read as SDL, the copy "provides" every root
// field, so each GraphQL consume in the workspace has two owners and no host to break the tie: no GraphQL edge at all.
// An SDL file whose root fields the member's own (non-test) operations select is a client copy: it provides nothing
// and yields one unresolved item. Server evidence keeps its provides: a GraphQL server library imported by the member's
// own JS / TS / Python code, or a server's own file in its listing (gqlgen, graphql-ruby, Lighthouse). SDL written in
// code (Apollo typeDefs) is the member's own schema. With neither operations nor evidence, nothing changes. SDL in a
// JVM server's src/main/resources/ is never a copy, and a survey fact citing a copy is rejected: the survey brief lists
// the copy as unresolved, and an investigator that keys it would give every root field a second owner again.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeWorkspace, runDetector, keysOf } from './helpers/wsmap-fixtures.mjs';
import { extractWorkspace } from '../src/core/workspace-map/extract.mjs';
import { buildCatalog } from '../src/core/workspace-map/catalog.mjs';
import { joinMap } from '../src/core/workspace-map/join.mjs';
import detector from '../src/core/workspace-map/detectors/api-graphql.mjs';

const SCHEMA = 'type Query {\n  invoice(id: ID!): Invoice\n  invoices: [Invoice]\n}\ntype Mutation {\n  pay(id: ID!): Invoice\n}\ntype Invoice { id: ID! }\n';
const ROOTS = ['Mutation.pay', 'Query.invoice', 'Query.invoices'];
const COPY = 'client copy of a GraphQL schema';
// Apollo Kotlin: the operations and the schema copy side by side.
const ANDROID = {
  'build.gradle.kts': 'plugins { id("com.apollographql.apollo") }\n',
  'src/main/graphql/Invoices.graphql': 'query Invoices { invoices { id } }\n',
  'src/main/graphql/schema.graphqls': SCHEMA,
};

/** fixture workspace → the real extract (default registry) → catalog → join */
async function scan(spec) {
  const w = await makeWorkspace(spec);
  try {
    const extract = await extractWorkspace({ name: 'W', members: w.members });
    const catalog = await buildCatalog({ extract, survey: null });
    const map = await joinMap({ catalog, usage: null });
    return { extract, catalog, map };
  } finally { await w.cleanup(); }
}
const graphqlEdges = (map) => map.edges.filter((e) => e.kind === 'graphql').map((e) => `${e.from} -> ${e.to} ${e.norm} ${e.confidence}`).sort();
const graphqlOwners = (catalog) => catalog.entries.filter((e) => e.kind === 'graphql').map((e) => `${e.member} ${e.norm}`).sort();

/** api-graphql alone over each member of one fixture workspace (claims → detect → finish, as extract runs it). */
async function detectEach(spec) {
  const w = await makeWorkspace(spec);
  try {
    const out = {};
    for (const m of w.members) out[m.key] = await runDetector(detector, m, w.members);
    return out;
  } finally { await w.cleanup(); }
}
const reasons = (r) => r.unresolved.map((u) => u.reason);
/** each server shape keeps every root field and reports nothing; the client beside them loses its copy's provides */
function assertServers(r, labels) {
  for (const [key, label] of Object.entries(labels)) {
    assert.deepEqual(keysOf(r[key], 'graphql', 'provides'), ROOTS, label);
    assert.deepEqual(r[key].unresolved, [], label);
  }
  assert.deepEqual([keysOf(r.client, 'graphql', 'provides'), reasons(r.client)], [[], [COPY]], 'the client\'s copy');
}

test('Apollo Kotlin: the client\'s schema copy provides nothing — both GraphQL consumers reach the server, exact', async () => {
  const { extract, catalog, map } = await scan({
    api: { 'package.json': '{"name":"api","dependencies":{"apollo-server":"3"}}\n', 'schema.graphql': SCHEMA, 'src/index.js': 'module.exports = {};\n' },
    // plus a copy under a test path: no provides that count, and no unresolved item either
    android: { ...ANDROID, 'src/test/graphql/schema.graphqls': SCHEMA },
    web: { 'package.json': '{"name":"web"}\n', 'src/q.graphql': 'query Invoice { invoice(id: 1) { id } }\n' },
  });
  assert.deepEqual(graphqlEdges(map), ['android -> api graphql:Query.invoices exact', 'web -> api graphql:Query.invoice exact']);
  assert.deepEqual(graphqlOwners(catalog), ['api graphql:Mutation.pay', 'api graphql:Query.invoice', 'api graphql:Query.invoices'], 'only the server provides');
  assert.deepEqual(extract.members.android.unresolved.filter((u) => u.kind === 'graphql').map((u) => [u.raw, u.file, u.line, u.reason]),
    [['src/main/graphql/schema.graphqls', 'src/main/graphql/schema.graphqls', 1, COPY]]);
  assert.deepEqual(extract.members.api.unresolved.filter((u) => u.kind === 'graphql'), [], 'the server\'s own schema is no copy');
});

test('a surveyed client never gives its schema copy back its provides: a survey fact citing the copy is rejected, the server stays the one owner', async () => {
  const w = await makeWorkspace({
    api: { 'package.json': '{"name":"api","dependencies":{"apollo-server":"3"}}\n', 'schema.graphql': SCHEMA, 'src/index.js': 'module.exports = {};\n' },
    android: ANDROID,
    web: { 'package.json': '{"name":"web"}\n', 'src/q.graphql': 'query Invoice { invoice(id: 1) { id } }\n' },
  });
  try {
    const extract = await extractWorkspace({ name: 'W', members: w.members });
    // What an investigator asked to "key" the unresolved copy would report: the copy's root fields, cited on their lines.
    const copied = (key, line, match) => ({ kind: 'graphql', key, file: 'src/main/graphql/schema.graphqls', line, match });
    const survey = { version: 1, members: { android: { status: 'investigated', role: 'Android app', aliases: [], consumes: [],
      provides: [copied('Query.invoices', 3, 'invoices: [Invoice]'), copied('Mutation.pay', 6, 'pay(id: ID!): Invoice')] } } };
    const catalog = await buildCatalog({ extract, survey });
    const map = await joinMap({ catalog, usage: null });
    assert.deepEqual(graphqlOwners(catalog), ['api graphql:Mutation.pay', 'api graphql:Query.invoice', 'api graphql:Query.invoices']);
    assert.deepEqual(graphqlEdges(map), ['android -> api graphql:Query.invoices exact', 'web -> api graphql:Query.invoice exact']);
    assert.deepEqual(catalog.rejected.filter((r) => r.member === 'android').map((r) => [r.source, r.reason, r.fact.key]),
      [['survey', COPY, 'Query.invoices'], ['survey', COPY, 'Mutation.pay']]);
  } finally { await w.cleanup(); }
});

test('a survey fact citing the copy in another letter case never re-keys it (a case-insensitive checkout: macOS, Windows)', async () => {
  const w = await makeWorkspace({
    api: { 'package.json': '{"name":"api","dependencies":{"apollo-server":"3"}}\n', 'schema.graphql': SCHEMA, 'src/index.js': 'module.exports = {};\n' },
    android: ANDROID,
  });
  try {
    const extract = await extractWorkspace({ name: 'W', members: w.members });
    // macOS and Windows verify the file in any letter case; on Linux these paths are missing files, rejected anyway.
    for (const file of ['src/main/GraphQL/schema.graphqls', 'SRC/main/graphql/Schema.graphqls']) {
      const survey = { version: 1, members: { android: { status: 'investigated', role: 'Android app', aliases: [], consumes: [],
        provides: [{ kind: 'graphql', key: 'Mutation.pay', file, line: 6, match: 'pay(id: ID!): Invoice' }] } } };
      const catalog = await buildCatalog({ extract, survey });
      assert.deepEqual(catalog.entries.filter((e) => e.norm === 'graphql:Mutation.pay').map((e) => e.member), ['api'], file);
    }
  } finally { await w.cleanup(); }
});

test('a usage use or relation citing a client\'s schema copy makes no edge: the copy is no evidence the client calls a field', async () => {
  const w = await makeWorkspace({
    api: { 'package.json': '{"name":"api","dependencies":{"apollo-server":"3"}}\n', 'schema.graphql': SCHEMA, 'src/index.js': 'module.exports = {};\n' },
    android: ANDROID,
  });
  try {
    const extract = await extractWorkspace({ name: 'W', members: w.members });
    const catalog = await buildCatalog({ extract, survey: null });
    const id = (n) => catalog.entries.find((e) => e.norm === `graphql:${n}`).id;
    const copy = 'src/main/graphql/schema.graphqls';
    // What an investigator "resolving" the usage brief's unresolved copy writes: root fields, cited on the copy's lines.
    const usage = { version: 1, members: {
      android: { status: 'investigated', rejected: [], uses: [{ entry: id('Mutation.pay'), file: copy, line: 6, match: 'pay(id: ID!): Invoice' }],
        other: [{ to: 'api', kind: 'graphql', key: 'Query.invoice', file: copy, line: 2, match: 'invoice(id: ID!): Invoice' }] },
      api: { status: 'investigated', uses: [], rejected: [], other: [] },
    } };
    const map = await joinMap({ catalog, usage });
    assert.deepEqual(map.edges.filter((e) => e.from === 'android').map((e) => `${e.from} -> ${e.to} ${e.norm} ${e.confidence}`), ['android -> api graphql:Query.invoices exact']);
    assert.equal(map.stats.factsRejected, 2);
  } finally { await w.cleanup(); }
});

test('Relay and graphql-codegen: a root schema.graphql or a src/__generated__/ copy provides nothing; a server with only SDL and no server hint keeps its provides', async () => {
  const ops = 'query GetInvoice($id: ID!) {\n  invoice(id: $id) { id }\n}\nmutation Pay { pay(id: 1) { id } }\n';
  const { catalog, map } = await scan({
    relay: { 'package.json': '{"name":"relay","dependencies":{"react-relay":"16"}}\n', 'schema.graphql': SCHEMA, 'src/queries.graphql': ops },
    codegen: {
      'package.json': '{"name":"codegen","dependencies":{"@apollo/client":"3"}}\n', 'src/__generated__/schema.graphql': SCHEMA,
      'src/app.ts': "import { gql } from '@apollo/client';\nexport const Q = gql`query Invoices { invoices { id } }`;\n",
    },
    billing: { 'package.json': '{"name":"billing"}\n', 'schema.graphql': SCHEMA, 'src/index.js': 'module.exports = {};\n' },
  });
  assert.deepEqual(graphqlEdges(map), [
    'codegen -> billing graphql:Query.invoices exact',
    'relay -> billing graphql:Mutation.pay exact',
    'relay -> billing graphql:Query.invoice exact',
  ]);
  assert.deepEqual(graphqlOwners(catalog), ['billing graphql:Mutation.pay', 'billing graphql:Query.invoice', 'billing graphql:Query.invoices']);
});

test('server evidence: a GraphQL server library imported by the member\'s own code keeps the provides of a schema its own operations query', async () => {
  const r = await detectEach({
    client: ANDROID,
    esm: {
      'schema.graphql': SCHEMA, 'src/server.ts': "import { ApolloServer } from '@apollo/server';\nimport { startStandaloneServer } from '@apollo/server/standalone';\n",
      'src/jobs/warm.ts': "import gql from 'graphql-tag';\nexport const WARM = gql`query Warm { invoices { id } }`;\n",
    },
    cjs: { 'schema.graphql': SCHEMA, 'server.js': "const { createYoga } = require('graphql-yoga');\n", 'scripts/smoke.js': "const Q = gql`query { invoice(id: 1) { id } }`;\n" },
    // the server import below a docstring and a stdlib import, as real modules open: SERVER_PY_RE reads every line (/m)
    py: { 'schema.graphql': SCHEMA, 'app/main.py': '"""Shop API."""\nimport os\n\nimport strawberry\nfrom strawberry.fastapi import GraphQLRouter\n', 'app/warm.py': 'from gql import gql\nQ = gql("""\n  query Warm { invoices { id } }\n""")\n' },
  });
  assertServers(r, { esm: 'ES import (@apollo/server)', cjs: 'CommonJS require (graphql-yoga)', py: 'Python (strawberry)' });
});

test('Spring GraphQL / DGS: a schema in src/main/resources/graphql/ is the server\'s own beside a docs or an in-repo frontend operation; every consumer reaches it, exact', async () => {
  const pom = '<project>\n  <groupId>com.acme</groupId>\n  <artifactId>shop</artifactId>\n  <dependencies>\n    <dependency><groupId>org.springframework.boot</groupId><artifactId>spring-boot-starter-graphql</artifactId></dependency>\n  </dependencies>\n</project>\n';
  const web = { 'package.json': '{"name":"web"}\n', 'src/q.graphql': 'query Invoice { invoice(id: 1) { id } }\n' };
  for (const [label, own] of [
    ['a docs operation', { 'docs/examples/invoices.graphql': 'query Invoices { invoices { id } }\n' }],
    ['an in-repo frontend operation', { 'frontend/src/queries.graphql': 'query Invoices { invoices { id } }\n' }],
  ]) {
    const { extract, map } = await scan({
      shop: { 'pom.xml': pom, 'src/main/resources/graphql/schema.graphqls': SCHEMA, 'src/main/java/com/acme/shop/InvoiceController.java': 'package com.acme.shop;\n@Controller\nclass InvoiceController {}\n', ...own },
      android: ANDROID,
      web,
    });
    assert.deepEqual(graphqlEdges(map), ['android -> shop graphql:Query.invoices exact', 'web -> shop graphql:Query.invoice exact'], label);
    assert.deepEqual(extract.members.shop.unresolved.filter((u) => u.kind === 'graphql'), [], `${label}: no copy`);
    assert.deepEqual(extract.members.android.unresolved.filter((u) => u.kind === 'graphql').map((u) => u.reason), [COPY], `${label}: Apollo Kotlin's copy stays a copy`);
  }
});

test('graphql-java-kickstart: a schema directly in src/main/resources/ is the server\'s own beside its in-repo frontend\'s operations', async () => {
  const r = await detectEach({
    client: ANDROID,
    kickstart: {
      'pom.xml': '<project><groupId>com.acme</groupId><artifactId>shop</artifactId></project>\n',
      'src/main/resources/schema.graphqls': SCHEMA,
      'frontend/src/queries.graphql': 'query Invoices { invoices { id } }\n',
    },
    // a multi-module build: the server module's resources sit below the member root
    modules: { 'pom.xml': '<project><modules><module>shop-api</module></modules></project>\n', 'shop-api/src/main/resources/graphql/schema.graphqls': SCHEMA, 'frontend/src/queries.graphql': 'query Invoices { invoices { id } }\n' },
  });
  assertServers(r, { kickstart: 'src/main/resources/schema.graphqls', modules: 'a multi-module build: shop-api/src/main/resources/' });
});

test('a root docs/, examples/ or samples/ folder documents the API: its operations never make a schema a copy; an Apollo Kotlin package folder named example is no such folder', async () => {
  const r = await detectEach({
    client: ANDROID,
    docs: { 'schema.graphql': SCHEMA, 'docs/queries.graphql': 'query Invoices { invoices { id } }\n' },
    examples: { 'graph/schema.graphqls': SCHEMA, 'examples/client.ts': 'export const Q = gql`query { invoice(id: 1) { id } }`;\n' },
    samples: { 'schema.graphql': SCHEMA, 'Samples/pay.graphql': 'mutation Pay { pay(id: 1) { id } }\n' },
    // Apollo Kotlin mirrors packages: operations and the copy under src/main/graphql/com/example/
    kotlin: {
      'build.gradle.kts': 'plugins { id("com.apollographql.apollo") }\n',
      'src/main/graphql/com/example/Invoices.graphql': 'query Invoices { invoices { id } }\n',
      'src/main/graphql/com/example/schema.graphqls': SCHEMA,
    },
  });
  assertServers(r, { docs: 'docs/', examples: 'examples/', samples: 'Samples/' });
  assert.deepEqual([keysOf(r.kotlin, 'graphql', 'provides'), reasons(r.kotlin)], [[], [COPY]], 'com/example/ is a package, not a docs folder');
});

test('server evidence: a server\'s own file in the listing (gqlgen, graphql-ruby, Lighthouse / Laravel) keeps the provides of a schema its in-repo frontend queries', async () => {
  const front = 'query Invoices { invoices { id } }\n';
  const r = await detectEach({
    client: ANDROID,
    gqlgen: { 'gqlgen.yml': 'schema:\n  - graph/*.graphqls\n', 'graph/schema.graphqls': SCHEMA, 'server.go': 'package main\n', 'web/src/queries.graphql': front },
    ruby: { 'app/graphql/shop_schema.rb': 'class ShopSchema < GraphQL::Schema\nend\n', 'schema.graphql': SCHEMA, 'app/javascript/queries.graphql': front },
    lighthouse: { 'config/lighthouse.php': '<?php\nreturn [];\n', 'graphql/schema.graphql': SCHEMA, 'resources/js/queries.graphql': front },
    laravel: { 'app/GraphQL/Queries/Invoices.php': '<?php\nnamespace App\\GraphQL\\Queries;\n', 'graphql/schema.graphql': SCHEMA, 'resources/js/queries.graphql': front },
    // server files below the member root (a monorepo's service folders)
    nested: { 'services/api/gqlgen.yml': 'schema:\n  - graph/*.graphqls\n', 'services/api/graph/schema.graphqls': SCHEMA, 'backend/app/graphql/shop_schema.rb': 'class ShopSchema < GraphQL::Schema\nend\n', 'web/src/queries.graphql': front },
  });
  assertServers(r, { gqlgen: 'gqlgen.yml', ruby: 'graphql-ruby schema class', lighthouse: 'Lighthouse config', laravel: 'Laravel app/GraphQL class', nested: 'server files below the member root' });
});

test('a server\'s test operations do not make its schema a copy; SDL written in code (typeDefs) always provides', async () => {
  const r = await detectEach({
    client: ANDROID,
    tested: { 'schema.graphql': SCHEMA, 'src/__tests__/api.test.ts': 'const Q = gql`query { invoices { id } }`;\n', 'src/index.js': 'module.exports = {};\n' },
    typedefs: {
      'src/schema.ts': `import gql from 'graphql-tag';\nexport const typeDefs = gql\`\n${SCHEMA}\`;\n`,
      'src/client.ts': "import gql from 'graphql-tag';\nexport const Q = gql`query { invoices { id } }`;\n",
    },
  });
  assertServers(r, { tested: 'operations only in tests', typedefs: 'typeDefs beside its own operations' });
});

test('no server evidence: a server library imported only by a test or by a mock server, or a server file under a test path, leaves a client\'s copy a copy', async () => {
  const relay = { 'package.json': '{"name":"web"}\n', 'schema.graphql': SCHEMA, 'src/queries.graphql': 'query Invoices { invoices { id } }\n' };
  const r = await detectEach({
    tested: { ...relay, 'src/__tests__/server.test.ts': "import { ApolloServer } from '@apollo/server';\n" },
    mocked: { ...relay, 'src/mocks/server.ts': "import { createYoga } from 'graphql-yoga';\n" },
    fixture: { ...relay, 'test/fixtures/gqlgen.yml': 'schema: []\n' },
    pascal: { ...relay, 'src/testing/MockServer.ts': "import { createYoga } from 'graphql-yoga';\n" },
  });
  for (const [key, label] of [['tested', 'a test'], ['mocked', 'a mock server'], ['fixture', 'a test fixture'], ['pascal', 'a PascalCase mock server']]) {
    assert.deepEqual([keysOf(r[key], 'graphql', 'provides'), reasons(r[key])], [[], [COPY]], label);
  }
});

test('no server evidence: Yoga\'s client packages (@graphql-yoga/apollo-link, @graphql-yoga/urql-exchange) leave a client\'s copy a copy; its server packages stay evidence', async () => {
  const relay = { 'package.json': '{"name":"web"}\n', 'schema.graphql': SCHEMA, 'src/queries.graphql': 'query Invoices { invoices { id } }\n' };
  const r = await detectEach({
    link: { ...relay, 'src/apollo.ts': "import { YogaLink } from '@graphql-yoga/apollo-link';\n" },
    urql: { ...relay, 'src/urql.ts': "import { yogaExchange } from '@graphql-yoga/urql-exchange';\n" },
    node: { ...relay, 'src/server.ts': "import { createServer } from '@graphql-yoga/node';\n" },
  });
  for (const [key, label] of [['link', 'an Apollo link'], ['urql', 'an urql exchange']]) {
    assert.deepEqual([keysOf(r[key], 'graphql', 'provides'), reasons(r[key])], [[], [COPY]], label);
  }
  assert.deepEqual([keysOf(r.node, 'graphql', 'provides'), reasons(r.node)], [ROOTS, []], 'a Yoga server package');
});

test('the server-evidence scans stay linear on 1 MiB adversarial code and paths (2 s a row)', () => {
  const MB = 1024 * 1024;
  const js = (s) => `${'// ok\n'.repeat(700)}${s}`.slice(0, MB); // short first lines: no bundle, so the file is read
  const fill = (unit) => unit.repeat(Math.ceil(MB / unit.length)).slice(0, MB);
  const member = { key: 'm', name: 'm', dir: '/w/m', projectDir: '/w/m' };
  for (const [rel, text] of [
    ['a.ts', js(`import${' '.repeat(MB)}`)],
    ['a.ts', js(`require${' '.repeat(MB / 2)}(${' '.repeat(MB / 2)}`)],
    ['a.ts', js(fill("from '@apollo/server-a-a-a-a"))],
    ['a.ts', js(fill("import('apollo-server/a/b/c/d/e/f/g/"))],
    ['a.py', `from${' '.repeat(MB - 4)}`],
    ['a.py', fill('\n \t \t')],
    ['a.py', fill('import strawberr')],
  ]) {
    const ctx = { member, members: [member], files: [rel, 'schema.graphql'], state: {} };
    const t0 = performance.now();
    detector.detect({ rel, text }, ctx);
    if (detector.finish) detector.finish(ctx);
    const ms = performance.now() - t0;
    assert.ok(ms < 2000, `${rel} ${JSON.stringify(text.slice(4200, 4230))}: ${ms.toFixed(0)} ms`);
  }
  // and the listing's server files, over paths of near misses (a schema to decide makes finish() read them)
  const files = [`${'app/GraphQL/'.repeat(87000)}x.rb`, `${'app/graphql/'.repeat(87000)}schema.r`, `${'x.gqlgen.y/'.repeat(95000)}`, 'schema.graphql'];
  const ctx = { member, members: [member], files, state: {} };
  const t0 = performance.now();
  detector.detect({ rel: 'schema.graphql', text: SCHEMA }, ctx);
  if (detector.finish) detector.finish(ctx);
  assert.ok(performance.now() - t0 < 2000, `listing: ${(performance.now() - t0).toFixed(0)} ms`);
});

test('a client copy of a schema no member serves (an outside API: GitHub) keeps its own operations off a member that also serves Query.node', async () => {
  const GH = 'type Query {\n  viewer: User!\n  node(id: ID!): Node\n  repository(owner: String!, name: String!): Repository\n  organization(login: String!): Org\n  search(query: String!): [Repository]\n}\ntype User { login: String! }\ninterface Node { id: ID! }\ntype Repository { name: String! }\ntype Org { login: String! }\n';
  // a Relay server: the invoice schema plus Query.node and Query.viewer
  const API = SCHEMA.replace('  invoices: [Invoice]\n', '  invoices: [Invoice]\n  node(id: ID!): Invoice\n  viewer: Invoice\n');
  const { extract, map } = await scan({
    api: { 'package.json': '{"name":"api"}\n', 'src/server.ts': "import { ApolloServer } from '@apollo/server';\n", 'schema.graphql': API },
    // a dashboard querying GitHub's GraphQL API with graphql-codegen, GitHub's schema committed
    dashboard: { 'package.json': '{"name":"dashboard"}\n', 'github.schema.graphql': GH, 'src/viewer.graphql': 'query Viewer { viewer { login } }\n', 'src/repo.graphql': 'query Repo($id: ID!) { node(id: $id) { id } }\n' },
    // Apollo Kotlin's copy of api's schema, one field out of date: still api's schema
    android: { ...ANDROID, 'src/main/graphql/schema.graphqls': SCHEMA.replace('  invoices: [Invoice]\n', '  invoices: [Invoice]\n  legacyInvoices: [Invoice]\n') },
  });
  assert.deepEqual(graphqlEdges(map), ['android -> api graphql:Query.invoices exact'], 'the copy of api\'s schema joins; the copy of GitHub\'s never does');
  assert.deepEqual(extract.members.dashboard.unresolved.filter((u) => u.kind === 'graphql').map((u) => u.reason), [COPY]);
});

test('a usage use or relation citing the copy in another letter case makes no edge either (a case-insensitive checkout: macOS, Windows)', async () => {
  const w = await makeWorkspace({
    api: { 'package.json': '{"name":"api","dependencies":{"apollo-server":"3"}}\n', 'schema.graphql': SCHEMA, 'src/index.js': 'module.exports = {};\n' },
    android: ANDROID,
  });
  try {
    const extract = await extractWorkspace({ name: 'W', members: w.members });
    const catalog = await buildCatalog({ extract, survey: null });
    const id = (n) => catalog.entries.find((e) => e.norm === `graphql:${n}`).id;
    // macOS and Windows verify the file in any letter case; on Linux these paths are missing files, rejected anyway.
    for (const file of ['src/main/GraphQL/schema.graphqls', 'SRC/main/graphql/Schema.graphqls']) {
      const usage = { version: 1, members: {
        android: { status: 'investigated', rejected: [], uses: [{ entry: id('Mutation.pay'), file, line: 6, match: 'pay(id: ID!): Invoice' }],
          other: [{ to: 'api', kind: 'graphql', key: 'Query.invoice', file, line: 2, match: 'invoice(id: ID!): Invoice' }] },
        api: { status: 'investigated', uses: [], rejected: [], other: [] },
      } };
      const map = await joinMap({ catalog, usage });
      assert.deepEqual(map.edges.filter((e) => e.from === 'android').map((e) => `${e.from} -> ${e.to} ${e.norm} ${e.confidence}`), ['android -> api graphql:Query.invoices exact'], file);
    }
  } finally { await w.cleanup(); }
});

test('Hasura: the actions SDL (metadata/actions.graphql) is the server\'s own beside its in-repo frontend\'s operations', async () => {
  const r = await detectEach({
    client: ANDROID,
    hasura: { 'hasura/config.yaml': 'version: 3\n', 'hasura/metadata/actions.graphql': SCHEMA, 'frontend/src/queries.graphql': 'query Invoices { invoices { id } }\n' },
  });
  assertServers(r, { hasura: 'hasura/metadata/actions.graphql' });
});

test('a crafted 1 MiB schema of 137 000 root fields never throws in finish(), never costs the member its other schema, and holds at most the fact cap', () => {
  const MB = 1024 * 1024;
  let body = '';
  for (let i = 0; body.length < MB - 40; i += 1) body += `f${i.toString(36)}:A\n`;
  const member = { key: 'm', name: 'm', dir: '/w/m', projectDir: '/w/m' };
  const ctx = { member, members: [member], files: ['schema.graphql', 'zz/huge.graphql'], state: {} };
  detector.detect({ rel: 'schema.graphql', text: SCHEMA }, ctx);
  detector.detect({ rel: 'zz/huge.graphql', text: `type Query {\n${body}}\n`.slice(0, MB) }, ctx);
  const r = detector.finish(ctx);
  assert.deepEqual(r.facts.filter((f) => f.file === 'schema.graphql').map((f) => f.key).sort(), ROOTS);
  assert.ok(r.facts.length <= 5000, `${r.facts.length} facts`);
});

test('crafted operation files never grow the member\'s operation set without bound (the copy verdict keeps at most 50 000 root fields)', () => {
  const MB = 1024 * 1024;
  const member = { key: 'm', name: 'm', dir: '/w/m', projectDir: '/w/m' };
  const ctx = { member, members: [member], files: [], state: {} };
  for (const p of ['a', 'b']) {
    let body = '';
    for (let i = 0; body.length < MB - 40; i += 1) body += `${p}${i.toString(36)}\n`;
    detector.detect({ rel: `src/${p}.graphql`, text: `query {\n${body}}\n` }, ctx);
  }
  assert.ok(ctx.state.ops.size <= 50000, `${ctx.state.ops.size} root fields held`);
});

test('server evidence: a schema-first server whose code only its library names (graph-gophers, Hot Chocolate, graphql-php, async-graphql, Absinthe, graphql-java) keeps the provides of a schema its in-repo admin queries', async () => {
  const front = 'query Invoices { invoices { id } }\n';
  const r = await detectEach({
    client: ANDROID,
    gophers: { 'go.mod': 'module example.com/shop\n', 'schema/schema.graphql': SCHEMA, 'main.go': 'package main\n\nimport (\n\t"github.com/graph-gophers/graphql-go"\n\t"github.com/graph-gophers/graphql-go/relay"\n)\n', 'admin/src/queries.graphql': front },
    hotchoc: { 'src/Api/schema.graphql': SCHEMA, 'src/Api/Program.cs': 'builder.Services\n    .AddGraphQLServer()\n    .AddDocumentFromFile("./schema.graphql");\n', 'src/Admin/Queries/Invoices.graphql': front },
    php: { 'schema.graphql': SCHEMA, 'src/server.php': "<?php\nuse GraphQL\\Utils\\BuildSchema;\n$schema = BuildSchema::build(file_get_contents('schema.graphql'));\n", 'web/queries.graphql': front },
    rust: { 'schema.graphql': SCHEMA, 'src/main.rs': 'use async_graphql::{EmptySubscription, Schema};\n', 'web/queries.graphql': front },
    absinthe: { 'priv/schema.graphql': SCHEMA, 'lib/app_web/schema.ex': 'defmodule AppWeb.Schema do\n  use Absinthe.Schema\n  import_sdl path: "priv/schema.graphql"\nend\n', 'assets/js/queries.graphql': front },
    gqlnet: { 'schema.graphql': SCHEMA, 'Program.cs': 'using GraphQL;\n\nbuilder.Services.AddGraphQL(b => b\n    .AddSchema<ShopSchema>()\n    .AddSystemTextJson());\napp.UseGraphQL("/graphql");\n', 'ClientApp/src/queries.graphql': front },
    hc14: { 'src/Api/schema.graphqls': SCHEMA, 'src/Api/Program.cs': 'var builder = WebApplication.CreateBuilder(args);\nbuilder.AddGraphQL().AddTypes();\n', 'src/Web/src/queries.graphql': front },
    javaidl: { 'schema/schema.graphqls': SCHEMA, 'src/main/java/app/Wiring.java': 'package app;\n\nimport graphql.schema.idl.SchemaParser;\n', 'web/queries.graphql': front },
  });
  assertServers(r, { gophers: 'graph-gophers/graphql-go', hotchoc: 'Hot Chocolate', php: 'graphql-php', rust: 'async-graphql', absinthe: 'Absinthe', javaidl: 'graphql-java SchemaParser', gqlnet: 'GraphQL.NET 7+ AddGraphQL(', hc14: 'Hot Chocolate 14 builder.AddGraphQL()' });
});

test('no server evidence: a Go, .NET or Kotlin GraphQL CLIENT, or a server library only a test uses, leaves the copy a copy', async () => {
  const ops = 'query Invoices { invoices { id } }\n';
  const r = await detectEach({
    genqlient: { 'go.mod': 'module example.com/cli\n', 'schema.graphql': SCHEMA, 'genqlient.graphql': ops, 'client.go': 'package main\n\nimport "github.com/Khan/genqlient/graphql"\n' },
    shake: { 'schema.graphql': SCHEMA, 'Queries/Invoices.graphql': ops, 'Program.cs': 'using StrawberryShake;\nbuilder.Services.AddInvoicesClient().ConfigureHttpClient(c => c.BaseAddress = new Uri("http://api/graphql"));\n' },
    kotlin: { ...ANDROID, 'src/main/kotlin/Api.kt': 'import com.apollographql.apollo.ApolloClient\n' },
    // DGS's client package (`com.netflix.graphql.dgs.client`) is a client, beside a copy outside src/main/resources/
    dgsclient: { 'src/main/graphql/schema.graphqls': SCHEMA, 'src/main/graphql/Invoices.graphql': ops, 'src/main/kotlin/app/Bff.kt': 'package app\n\nimport com.netflix.graphql.dgs.client.WebClientGraphQLClient\n' },
    gqlclient: { 'schema.graphql': SCHEMA, 'Queries/Invoices.graphql': ops, 'Program.cs': 'using GraphQL.Client.Http;\nbuilder.Services.AddGraphQLHttpClient();\nvar c = new GraphQLHttpClient("http://api/graphql", new SystemTextJsonSerializer());\n' },
    tested: { 'schema.graphql': SCHEMA, 'web/queries.graphql': ops, 'tests/Api.Tests/ServerTests.cs': 'services.AddGraphQLServer();\n' },
    mocked: { 'go.mod': 'module example.com/web\n', 'schema.graphql': SCHEMA, 'web/queries.graphql': ops, 'internal/mocks/server.go': 'package mocks\n\nimport "github.com/graph-gophers/graphql-go"\n' },
  });
  for (const [key, label] of [['genqlient', 'genqlient'], ['shake', 'StrawberryShake'], ['kotlin', 'Apollo Kotlin'], ['gqlclient', 'GraphQL.Client'], ['dgsclient', 'the DGS client'], ['tested', 'a server library in a test only'], ['mocked', 'a Go mock server']]) {
    assert.deepEqual([keysOf(r[key], 'graphql', 'provides'), reasons(r[key])], [[], [COPY]], label);
  }
});

test('the other-language server-evidence scan stays linear on 1 MiB adversarial code (2 s a row)', () => {
  const MB = 1024 * 1024;
  const fill = (unit) => unit.repeat(Math.ceil(MB / unit.length)).slice(0, MB);
  const member = { key: 'm', name: 'm', dir: '/w/m', projectDir: '/w/m' };
  for (const [rel, text] of [
    ['a.go', fill('"github.com/graph-gophers/graphql-g')],
    ['a.cs', fill('AddGraphQLServer\t')],
    ['a.cs', `using${' '.repeat(MB - 5)}`],
    ['a.php', fill('GraphQL\\Utils\\BuildSchem')],
    ['a.rs', fill('use async_graphql_')],
  ]) {
    const ctx = { member, members: [member], files: [rel, 'schema.graphql'], state: {} };
    const t0 = performance.now();
    detector.detect({ rel, text }, ctx);
    detector.finish(ctx);
    const ms = performance.now() - t0;
    assert.ok(ms < 2000, `${rel}: ${ms.toFixed(0)} ms`);
  }
});

test('a host naming a member still resolves a consume on an outside copy\'s field (C28 beats the outside-copy rule)', async () => {
  const GH = 'type Query {\n  viewer: User!\n  node(id: ID!): Node\n  repository(owner: String!, name: String!): Repository\n  organization(login: String!): Org\n  search(query: String!): [Repository]\n}\ntype User { login: String! }\ninterface Node { id: ID! }\n';
  const w = await makeWorkspace({
    api: { 'package.json': '{"name":"api"}\n', 'src/server.ts': "import { ApolloServer } from '@apollo/server';\n", 'schema.graphql': 'type Query {\n  viewer: User\n  invoices: [Invoice]\n}\n' },
    dashboard: { 'package.json': '{"name":"dashboard"}\n', 'github.schema.graphql': GH, 'src/viewer.graphql': 'query Viewer { viewer { login } }\n', 'src/me.ts': "export const ME = fetch('http://api:4000/graphql', { body: 'viewer' });\n" },
  });
  try {
    const extract = await extractWorkspace({ name: 'W', members: w.members });
    // the survey reports the api call with its host: a GraphQL consume of Query.viewer addressed to api
    const survey = { version: 1, members: { dashboard: { status: 'investigated', role: 'dashboard', aliases: [], provides: [],
      consumes: [{ kind: 'graphql', key: 'Query.viewer', target: 'api:4000', file: 'src/me.ts', line: 1, match: "fetch('http://api:4000/graphql'" }] } } };
    const catalog = await buildCatalog({ extract, survey });
    const map = await joinMap({ catalog, usage: null });
    assert.deepEqual(map.edges.filter((x) => x.kind === 'graphql').map((x) => `${x.from} -> ${x.to} ${x.norm}`), ['dashboard -> api graphql:Query.viewer']);
  } finally { await w.cleanup(); }
});

test('server evidence: PostGraphile (graphile/starter exports data/schema.graphql beside its client operations) and Keystone 6 (its generated schema.graphql beside a custom Admin UI page) keep their provides', async () => {
  const r = await detectEach({
    client: ANDROID,
    postgraphile: {
      'data/schema.graphql': SCHEMA,
      '@app/server/src/middleware/installPostGraphile.ts': 'import { postgraphile, makePluginHook } from "postgraphile";\n',
      '@app/client/src/graphql/Invoices.graphql': 'query Invoices { invoices { id } }\n',
    },
    keystone: {
      'schema.graphql': SCHEMA, 'keystone.ts': "import { config } from '@keystone-6/core';\n",
      'admin/pages/stats.tsx': "import { gql, useQuery } from '@keystone-6/core/admin-ui/apollo';\nconst Q = gql`query Stats { invoices { id } }`;\n",
    },
  });
  assertServers(r, { postgraphile: 'PostGraphile (graphile/starter)', keystone: 'Keystone 6 (a custom Admin UI page)' });
});
