// test/wsmap-alias-tiers.test.mjs — spec §6.3 step 3 (M7): an alias several members claim names the member
// whose claim is strongest — identity (the member's key and name) > deploy service / host names > manifest
// names and origin-remote names > survey aliases — and is ambiguous only among its strongest claimants.
// Members are keyed as a scan keys them: key = projectKey(dir) (`<slug>-<8hex>`), name = the checkout's
// basename. An npm scope tail (`billing` of `@acme/billing`) is a guess like a survey alias: the two tie.
// A fixture whose key equals its dir name passes even when an SDK's package tail knocks out the
// member's name: the key claim alone would hide the bug.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdir, rename, rm } from 'node:fs/promises';
import { basename, join } from 'node:path';

import { extractWorkspace, failedExtract, surveyBrief } from '../src/core/workspace-map/extract.mjs';
import { buildCatalog } from '../src/core/workspace-map/catalog.mjs';
import { joinMap } from '../src/core/workspace-map/join.mjs';
import { PROJECT_KEY_RE, projectKey } from '../src/core/store.mjs';
import { makeWorkspace } from './helpers/wsmap-fixtures.mjs';

const J = (o) => JSON.stringify(o, null, 2) + '\n';
const byStr = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/** The members as a scan run sees them: key = projectKey(dir), name = basename(dir), sorted by key. */
function scanMembers(members) {
  return members.map((m) => ({ key: projectKey(m.dir), name: basename(m.dir), dir: m.dir, projectDir: m.dir }))
    .sort((a, b) => byStr(a.key, b.key));
}

/** extract → catalog → join over production-shaped members. → { K: name → key, N: key → name, extract, catalog, map, edges } */
async function scan(members, survey = null) {
  const ms = scanMembers(members);
  for (const m of ms) assert.match(m.key, PROJECT_KEY_RE);
  assert.ok(ms.every((m) => m.key !== m.name), 'production-shaped keys: never the dir name');
  const K = Object.fromEntries(ms.map((m) => [m.name, m.key]));
  const N = Object.fromEntries(ms.map((m) => [m.key, m.name]));
  const extract = await extractWorkspace({ name: 'W', members: ms });
  const catalog = await buildCatalog({ extract, survey: survey ? survey(K) : null });
  const map = await joinMap({ catalog, usage: null });
  const edges = map.edges.map((e) => `${N[e.from]} -> ${N[e.to]} ${e.norm} ${e.confidence}`).sort();
  return { K, N, extract, catalog, map, edges };
}

const aliasSources = (extract, key, value) => extract.members[key].aliases.filter((a) => a.value === value);

test('an SDK publishing @acme/billing never takes `billing` from the member named billing: its host-named calls stay exact and on billing', async () => {
  const ws = await makeWorkspace({
    billing: { 'go.mod': 'module github.com/acme/billing\n', 'main.go': 'package main\n' },
    'billing-sdk': { 'package.json': J({ name: '@acme/billing' }), 'index.js': 'module.exports = {};\n' },
    users: { 'package.json': J({ name: 'users' }), 'src/routes.ts': "import express from 'express';\nconst router = express.Router();\nrouter.get('/health', h);\n" },
    web: { 'package.json': J({ name: 'web' }), 'src/a.ts': "export const ping = () => fetch('http://billing:8080/health');\nexport const g = (id) => fetch('http://billing:8080/api/invoices/' + id);\n" },
  });
  try {
    const { K, catalog, edges } = await scan(ws.members);
    assert.equal(catalog.aliasIndex.billing, K.billing, 'the member named billing owns `billing`');
    assert.equal(Object.hasOwn(catalog.ambiguousAliases, 'billing'), false, JSON.stringify(catalog.ambiguousAliases));
    assert.ok(catalog.members[K['billing-sdk']].aliases.includes('@acme/billing'));
    assert.equal(catalog.members[K['billing-sdk']].aliases.includes('billing'), false, 'a weaker claimant never lists the alias');
    assert.deepEqual(edges.filter((e) => e.startsWith('web ->')), [
      'web -> billing http:GET /api/invoices/{} exact',
      'web -> billing http:GET /health exact',
    ], 'GET /health lands on billing, never on users (who also serves /health)');
  } finally {
    await ws.cleanup();
  }
});

test('a manifest name of another member (pyproject name, pom artifactId) never outranks a member\'s own name', async () => {
  for (const [label, files] of [
    ['pyproject name = "billing"', { 'pyproject.toml': '[project]\nname = "billing"\nversion = "1"\n', 'worker.py': 'x = 1\n' }],
    ['pom artifactId billing', { 'pom.xml': '<project><groupId>com.acme</groupId><artifactId>billing</artifactId></project>\n' }],
  ]) {
    const ws = await makeWorkspace({ billing: { 'go.mod': 'module github.com/acme/billing\n', 'main.go': 'package main\n' }, 'billing-worker': files });
    try {
      const { K, catalog } = await scan(ws.members);
      assert.equal(catalog.aliasIndex.billing, K.billing, label);
      assert.deepEqual(catalog.ambiguousAliases, {}, label);
    } finally {
      await ws.cleanup();
    }
  }
});

test('a deploy file\'s service name beats a package\'s name tail: http://billing reaches the service compose builds, not the SDK', async () => {
  const ws = await makeWorkspace({
    'billing-service': { 'go.mod': 'module github.com/acme/billing-service\n', 'main.go': 'package main\n' },
    'billing-sdk': { 'package.json': J({ name: '@acme/billing' }) },
    deploy: { 'docker-compose.yml': 'services:\n  billing:\n    build: ../billing-service\n  web:\n    build: ../web\n' },
    web: { 'package.json': J({ name: 'web' }), 'src/a.ts': "export const g = (id) => fetch('http://billing:8080/api/invoices/' + id);\n" },
  });
  try {
    const { K, extract, catalog, edges } = await scan(ws.members);
    assert.deepEqual(aliasSources(extract, K['billing-service'], 'billing'), [{ value: 'billing', source: 'compose' }]);
    assert.deepEqual(aliasSources(extract, K['billing-sdk'], 'billing'), [{ value: 'billing', source: 'npm-scope-tail' }]);
    assert.equal(catalog.aliasIndex.billing, K['billing-service']);
    assert.ok(edges.includes('web -> billing-service http:GET /api/invoices/{} exact'), edges.join('\n'));
  } finally {
    await ws.cleanup();
  }
});

test('extract keeps the strongest source of an alias a member emits twice: its own k8s Service `billing` beats its package name read first', async () => {
  const ws = await makeWorkspace({
    'billing-service': {
      'package.json': J({ name: 'billing' }), 'src/index.js': 'module.exports = {};\n',
      'k8s/service.yaml': 'apiVersion: v1\nkind: Service\nmetadata:\n  name: billing\nspec:\n  selector:\n    app: billing\n  ports:\n    - port: 8080\n',
    },
    'billing-sdk': { 'package.json': J({ name: '@acme/billing' }) },
    web: { 'package.json': J({ name: 'web' }), 'src/a.ts': "export const g = (id) => fetch('http://billing:8080/api/invoices/' + id);\n" },
  });
  try {
    const { K, extract, catalog, edges } = await scan(ws.members);
    assert.deepEqual(aliasSources(extract, K['billing-service'], 'billing'), [{ value: 'billing', source: 'k8s' }],
      'package.json named it first (detect), the k8s Service later (finish): the deploy source is kept');
    assert.equal(catalog.aliasIndex.billing, K['billing-service']);
    assert.ok(edges.includes('web -> billing-service http:GET /api/invoices/{} exact'), edges.join('\n'));
  } finally {
    await ws.cleanup();
  }
});

test('two members named billing (a fork beside the original) stay ambiguous between themselves: the name names neither, and a weaker SDK claim never joins them', async () => {
  const ws = await makeWorkspace({
    a: { 'go.mod': 'module github.com/acme/billing\n', 'main.go': 'package main\n' },
    b: { 'go.mod': 'module github.com/fork/billing\n', 'main.go': 'package main\n' },
    'billing-sdk': { 'package.json': J({ name: '@acme/billing' }) },
    web: { 'package.json': J({ name: 'web' }), 'src/a.ts': "export const g = (id) => fetch('http://billing:8080/api/invoices/' + id);\n" },
  });
  try {
    const moved = [];
    for (const m of ws.members) {
      if (m.name !== 'a' && m.name !== 'b') { moved.push(m); continue; }
      const org = join(ws.root, m.name === 'a' ? 'acme' : 'fork');
      await mkdir(org, { recursive: true });
      const dir = join(org, 'billing');
      await rename(m.dir, dir);
      moved.push({ ...m, dir, projectDir: dir });
    }
    const ms = scanMembers(moved);
    const billings = ms.filter((m) => m.name === 'billing').map((m) => m.key).sort(byStr);
    assert.equal(billings.length, 2);
    const { catalog, edges } = await scan(moved);
    assert.deepEqual(catalog.ambiguousAliases.billing, billings, 'the two members named billing, never the SDK');
    assert.equal(catalog.aliasIndex.billing, undefined);
    assert.deepEqual(edges, [], 'a call to http://billing reaches no member');
  } finally {
    await ws.cleanup();
  }
});

test('a survey alias counts only for a member whose needs list aliases, and never over a member\'s own name', async () => {
  const ws = await makeWorkspace({
    billing: { 'go.mod': 'module github.com/acme/billing\n', 'main.go': 'package main\n' },
    legacy: { 'app.cob': 'IDENTIFICATION DIVISION.\n' },
    web: { 'package.json': J({ name: 'web' }), 'src/a.ts': "export const g = (id) => fetch('http://billing:8080/api/invoices/' + id);\n" },
  });
  try {
    const survey = (K) => ({ version: 1, members: {
      [K.legacy]: { status: 'investigated', role: 'Mainframe ledger', aliases: ['billing', 'ledger', '__proto__'], provides: [], consumes: [] },
      [K.web]: { status: 'investigated', role: 'Storefront', aliases: ['ledger', 'storefront'], provides: [], consumes: [] },
    } });
    const { K, extract, catalog, edges } = await scan(ws.members, survey);
    assert.ok(extract.members[K.legacy].needs.includes('aliases'), 'legacy: nothing scanned, so its needs list aliases');
    assert.equal(extract.members[K.web].needs.includes('aliases'), false, 'web: code mapped it, its needs do not list aliases');
    assert.equal(catalog.aliasIndex.ledger, K.legacy, 'web\'s survey alias is not a claim: `ledger` names legacy alone');
    assert.equal(catalog.aliasIndex.storefront, undefined);
    assert.equal(catalog.members[K.web].aliases.includes('storefront'), false);
    assert.equal(catalog.aliasIndex.billing, K.billing, 'the member named billing beats a survey guess');
    assert.equal(catalog.members[K.legacy].aliases.includes('billing'), false);
    assert.equal(Object.getPrototypeOf(catalog.ambiguousAliases), Object.prototype, 'an alias __proto__ never becomes a prototype');
    assert.equal(Object.hasOwn(catalog.aliasIndex, '__proto__'), false);
    assert.ok(edges.includes('web -> billing http:GET /api/invoices/{} exact'), edges.join('\n'));
  } finally {
    await ws.cleanup();
  }
});

test('extraction failed: every member\'s key and name still claim first — a survey alias never takes a member\'s name', async () => {
  const ws = await makeWorkspace({ billing: { 'main.go': 'package main\n' }, legacy: { 'app.cob': 'IDENTIFICATION DIVISION.\n' } });
  try {
    const ms = scanMembers(ws.members);
    const K = Object.fromEntries(ms.map((m) => [m.name, m.key]));
    const extract = failedExtract({ name: 'W', members: ms, error: 'extraction did not finish' });
    assert.deepEqual(Object.values(extract.members).map((m) => m.aliases), [[], []], 'a failed extract carries no alias at all');
    const survey = { version: 1, members: {
      // billing reports its own name too: a weaker claim of a member never lowers its stronger one.
      [K.billing]: { status: 'investigated', role: '', aliases: ['billing'], provides: [], consumes: [] },
      [K.legacy]: { status: 'investigated', role: '', aliases: ['billing', 'ledger'], provides: [], consumes: [] },
    } };
    const catalog = await buildCatalog({ extract, survey });
    assert.equal(catalog.aliasIndex.billing, K.billing);
    assert.equal(catalog.aliasIndex.ledger, K.legacy);
    assert.equal(catalog.aliasIndex[K.billing], K.billing);
    assert.deepEqual(catalog.ambiguousAliases, {});
  } finally {
    await ws.cleanup();
  }
});

test('every alias source a built-in detector emits has its tier; an unknown source is a manifest-tier claim', async () => {
  const { ALIAS_TIERS, aliasTier, GUESS_SOURCES } = await import('../src/core/workspace-map/alias-tiers.mjs');
  assert.deepEqual([...GUESS_SOURCES], ['deploy-self', 'npm-scope-tail', 'survey'], 'the guesses that tie with a manifest-tier claim');
  assert.deepEqual({ ...ALIAS_TIERS }, {
    identity: 0,
    compose: 1, k8s: 1, 'k8s-ingress': 1, helm: 1, serverless: 1, spring: 1,
    'package.json': 2, pyproject: 2, maven: 2, gradle: 2, cargo: 2, 'go.mod': 2, 'git-remote': 2,
    survey: 3, 'npm-scope-tail': 3, 'deploy-self': 3,
  });
  assert.ok(Object.isFrozen(ALIAS_TIERS));
  for (const [source, tier] of Object.entries(ALIAS_TIERS)) assert.equal(aliasTier(source), tier, source);
  for (const odd of ['plugin-detector', 'constructor', '__proto__', '', undefined, null, 7]) assert.equal(aliasTier(odd), 2, String(odd));
});

test('the scanner body and the survey brief say what an alias is: a name other members use to reach this member, never a service it deploys', () => {
  const body = readFileSync(new URL('../agents/worca-cc-workspace-scanner.md', import.meta.url), 'utf8');
  assert.ok(body.includes('`aliases`: the names OTHER projects use to reach THIS project'), 'the investigator brief defines an alias');
  assert.ok(body.includes('Never the name of a service it deploys, runs or calls'), 'the investigator brief excludes deployed services');
  const brief = surveyBrief({ workspace: { name: 'W' }, members: {
    a: { key: 'a', name: 'a', dir: '/a', needs: ['role', 'aliases', 'provides', 'consumes'], stack: [], aliases: [], provides: [], consumes: [], unresolved: [] },
  } }, { extractPath: '/p/extract.json', checkerCmd: 'CHECK' });
  assert.ok(brief.includes('- aliases (only for a member whose Needs lists aliases) = the names OTHER members use to reach this member'), brief);
  assert.ok(brief.includes('Never the name of a service it deploys, runs or calls.'), brief);
});

test('an npm scope tail never outranks the survey alias of a member no code maps: http://billing never lands on the SDK', async () => {
  const ws = await makeWorkspace({
    'ledger-core': { 'src/ledger.cob': 'IDENTIFICATION DIVISION.\n' },
    'billing-client': { 'package.json': J({ name: '@acme/billing' }), 'index.js': 'module.exports = {};\n' },
    web: { 'package.json': J({ name: 'web' }), 'src/a.ts': "export const g = (id) => fetch('http://billing:8080/api/invoices/' + id);\n" },
  });
  try {
    const survey = (K) => ({ version: 1, members: { [K['ledger-core']]: { status: 'investigated', role: 'Ledger', aliases: ['billing'], provides: [], consumes: [] } } });
    const { K, extract, catalog, edges } = await scan(ws.members, survey);
    assert.ok(extract.members[K['ledger-core']].needs.includes('aliases'), 'precondition: no code maps ledger-core');
    assert.notEqual(catalog.aliasIndex.billing, K['billing-client'], 'a derived scope tail never owns `billing` over the survey');
    assert.ok(catalog.members[K['billing-client']].aliases.includes('@acme/billing'), 'the full package name stays the SDK\'s');
    assert.ok(!edges.some((e) => e.startsWith('web -> billing-client')), edges.join('\n'));
  } finally {
    await ws.cleanup();
  }
});

test('one member\'s extract failed (checkout unreadable): its name still claims at the identity tier, over another member\'s package name', async () => {
  const ws = await makeWorkspace({
    billing: { 'main.go': 'package main\n' },
    'billing-worker': { 'pyproject.toml': '[project]\nname = "billing"\nversion = "1"\n', 'worker.py': 'x = 1\n' },
  });
  try {
    const ms = scanMembers(ws.members);
    const K = Object.fromEntries(ms.map((m) => [m.name, m.key]));
    await rm(ms.find((m) => m.name === 'billing').dir, { recursive: true, force: true });   // its checkout is unreadable now
    const extract = await extractWorkspace({ name: 'W', members: ms });
    assert.deepEqual([extract.members[K.billing].aliases, extract.members[K.billing].errors], [[], ['checkout unreadable']], 'precondition');
    const catalog = await buildCatalog({ extract, survey: null });
    assert.equal(catalog.aliasIndex.billing, K.billing, JSON.stringify(catalog.ambiguousAliases));
  } finally {
    await ws.cleanup();
  }
});

test('a code-less deploy repo\'s own name for a workload no member builds never outranks a service\'s package name: http://billing reaches the service', async () => {
  const K8S = 'apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: billing\nspec:\n  selector:\n    matchLabels:\n      app: billing\n  template:\n    metadata:\n      labels:\n        app: billing\n    spec:\n      containers:\n        - name: app\n          image: registry.acme.io/acme/invoicing-svc:1.2\n---\napiVersion: v1\nkind: Service\nmetadata:\n  name: billing\nspec:\n  selector:\n    app: billing\n  ports:\n    - port: 8080\n';
  const ws = await makeWorkspace({
    // a kustomize patch (no image) that sorts before its base takes the base's guess (op 3.15)
    deploy: { 'deploy/overlays/prod/billing-patch.yaml': 'apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: billing\nspec:\n  template:\n    spec:\n      containers:\n        - name: app\n          env:\n            - { name: LOG_LEVEL, value: "debug" }\n', 'k8s/billing.yaml': K8S },
    'payments-api': { 'package.json': J({ name: 'billing', dependencies: { express: '^4' } }), 'src/app.js': "const app = require('express')();\napp.get('/invoices/:id', (req, res) => res.json({}));\n" },
    web: { 'package.json': J({ name: 'web' }), 'src/a.js': "export const inv = (id) => fetch('http://billing:8080/invoices/' + id);\n" },
  });
  try {
    const { K, extract, catalog, edges } = await scan(ws.members);
    assert.deepEqual(aliasSources(extract, K.deploy, 'billing'), [{ value: 'billing', source: 'deploy-self' }], 'the image names no member: a guess');
    assert.deepEqual(catalog.ambiguousAliases.billing, [K.deploy, K['payments-api']].sort(byStr), 'a guess and a package name tie, as at 15486564');
    assert.deepEqual(edges.filter((e) => e.startsWith('web ->')), ['web -> payments-api http:GET /invoices/{} exact'], 'the path finds the service');
  } finally {
    await ws.cleanup();
  }
});

test('a code-less deploy repo\'s own name never lets another member\'s package name own it: a client library named billing never takes http://billing from the service', async () => {
  const K8S = 'apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: billing\nspec:\n  selector:\n    matchLabels:\n      app: billing\n  template:\n    metadata:\n      labels:\n        app: billing\n    spec:\n      containers:\n        - name: app\n          image: 123456789.dkr.ecr.us-east-1.amazonaws.com/billing:abc123\n---\napiVersion: v1\nkind: Service\nmetadata:\n  name: billing\nspec:\n  selector:\n    app: billing\n  ports:\n    - port: 8080\n';
  const ws = await makeWorkspace({
    'billing-client': { 'pyproject.toml': '[project]\nname = "billing"\nversion = "1"\n', 'billing/__init__.py': 'x = 1\n' },
    'billing-service': { 'package.json': J({ name: 'billing-service', dependencies: { express: '^4' } }), 'src/app.js': "const app = require('express')();\napp.get('/invoices/:id', (req, res) => res.json({}));\n" },
    infra: { 'apps/billing/deployment.yaml': K8S },
    web: { 'package.json': J({ name: 'web' }), 'src/a.js': "export const inv = (id) => fetch('http://billing:8080/invoices/' + id);\n" },
  });
  try {
    const { K, extract, catalog, edges } = await scan(ws.members);
    assert.deepEqual(aliasSources(extract, K.infra, 'billing'), [{ value: 'billing', source: 'deploy-self' }], 'precondition: the ECR image `billing` names no member');
    assert.deepEqual(catalog.ambiguousAliases.billing, [K['billing-client'], K.infra].sort(byStr), 'a package name never owns a name a deploy repo runs a service under');
    assert.deepEqual(edges.filter((e) => e.startsWith('web ->')), ['web -> billing-service http:GET /invoices/{} exact'], 'the path finds the service, as at 15486564');
  } finally {
    await ws.cleanup();
  }
});

test('an npm scope tail and another member\'s package name tie, as at 15486564: a library named billing never takes http://billing from the service published as @acme/billing', async () => {
  const ws = await makeWorkspace({
    'svc-billing': { 'package.json': J({ name: '@acme/billing', dependencies: { express: '^4' } }), 'src/app.js': "const app = require('express')();\napp.get('/invoices/:id', (req, res) => res.json({}));\n" },
    'billing-lib': { 'pyproject.toml': '[project]\nname = "billing"\nversion = "1"\n', 'billing/__init__.py': 'x = 1\n' },
    web: { 'package.json': J({ name: 'web' }), 'src/a.js': "export const inv = (id) => fetch('http://billing:8080/invoices/' + id);\n" },
  });
  try {
    const { K, catalog, edges } = await scan(ws.members);
    assert.deepEqual(catalog.ambiguousAliases.billing, [K['billing-lib'], K['svc-billing']].sort(byStr), 'a scope tail and a package name tie');
    assert.deepEqual(edges.filter((e) => e.startsWith('web ->')), ['web -> svc-billing http:GET /invoices/{} exact'], 'the path finds the service');
  } finally {
    await ws.cleanup();
  }
});

test('a service repo\'s local-dev stub of a peer never takes the peer\'s host: http://billing reaches the service, as at 15486564', async () => {
  const K8S = (name, image) => `apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: ${name}\nspec:\n  selector:\n    matchLabels:\n      app: ${name}\n  template:\n    metadata:\n      labels:\n        app: ${name}\n    spec:\n      containers:\n        - name: app\n          image: ${image}\n---\napiVersion: v1\nkind: Service\nmetadata:\n  name: ${name}\nspec:\n  selector:\n    app: ${name}\n  ports:\n    - port: 8080\n`;
  const ws = await makeWorkspace({
    'billing-service': { 'package.json': J({ name: 'billing', dependencies: { express: '^4' } }), 'src/app.js': "const app = require('express')();\napp.get('/invoices/:id', (req, res) => res.json({}));\n" },
    orders: {
      'package.json': J({ name: 'orders', dependencies: { express: '^4' } }),
      'src/app.js': "const app = require('express')();\napp.get('/orders/:id', (req, res) => res.json({}));\nexport const inv = (id) => fetch('http://billing:8080/invoices/' + id);\n",
      // Tilt / Skaffold dev stack: its own API, and a WireMock answering as `billing`
      'k8s/dev/orders-api.yaml': K8S('orders-api', 'ghcr.io/acme/orders-api:dev'),
      'k8s/dev/billing.yaml': K8S('billing', 'wiremock/wiremock:3.3.1'),
    },
    web: { 'package.json': J({ name: 'web' }), 'src/a.js': "export const inv = (id) => fetch('http://billing:8080/invoices/' + id);\n" },
  });
  try {
    const { K, extract, catalog, edges } = await scan(ws.members);
    assert.deepEqual(aliasSources(extract, K.orders, 'billing'), [{ value: 'billing', source: 'deploy-self' }], 'no image of the stub names orders: a guess');
    assert.deepEqual(aliasSources(extract, K.orders, 'orders-api'), [{ value: 'orders-api', source: 'k8s' }], 'an image naming orders keeps its own workload a deploy name');
    assert.deepEqual(catalog.ambiguousAliases.billing, [K['billing-service'], K.orders].sort(byStr), 'a stub and a package name tie, as at 15486564');
    assert.deepEqual(edges.filter((e) => e.includes('/invoices/')), [
      'orders -> billing-service http:GET /invoices/{} exact',
      'web -> billing-service http:GET /invoices/{} exact',
    ], 'the path finds the service; the stub never takes its calls');
  } finally {
    await ws.cleanup();
  }
});

test('a library\'s package name never outranks the survey alias of a member no code maps: http://ledger never lands on the client library', async () => {
  const ws = await makeWorkspace({
    'ledger-core': { 'src/ledger.cob': 'IDENTIFICATION DIVISION.\n' },
    'ledger-py': { 'pyproject.toml': '[project]\nname = "ledger"\nversion = "1"\n', 'ledger/__init__.py': 'x = 1\n' },
    web: { 'package.json': J({ name: 'web' }), 'src/a.ts': "export const g = (id) => fetch('http://ledger:8080/api/entries/' + id);\n" },
  });
  try {
    const survey = (K) => ({ version: 1, members: { [K['ledger-core']]: { status: 'investigated', role: 'Ledger', aliases: ['ledger'], provides: [], consumes: [] } } });
    const { K, extract, catalog, edges } = await scan(ws.members, survey);
    assert.ok(extract.members[K['ledger-core']].needs.includes('aliases'), 'precondition: no code maps ledger-core');
    assert.deepEqual(catalog.ambiguousAliases.ledger, [K['ledger-core'], K['ledger-py']].sort(byStr), 'a survey alias and a package name tie, as at 15486564');
    assert.ok(!edges.some((e) => e.startsWith('web -> ledger-py')), edges.join('\n'));
  } finally {
    await ws.cleanup();
  }
});

test('a service repo\'s dev-stack stub built from a sub-directory never takes the peer\'s host: http://billing-api reaches the service, as at 15486564', async () => {
  const ws = await makeWorkspace({
    'billing-service': { 'package.json': J({ name: 'billing-api', dependencies: { express: '^4' } }), 'src/app.js': "const app = require('express')();\napp.get('/invoices/:id', (req, res) => res.json({}));\n" },
    orders: {
      'package.json': J({ name: 'orders', dependencies: { express: '^4' } }),
      'src/app.js': "const app = require('express')();\napp.get('/orders/:id', (req, res) => res.json({}));\nexport const inv = (id) => fetch('http://billing-api:8080/invoices/' + id);\n",
      'docker-compose.yml': 'services:\n  orders:\n    build: .\n  billing-api:\n    build: ./stubs/wiremock\n',
      'stubs/wiremock/Dockerfile': 'FROM wiremock/wiremock:3\n',
    },
    web: { 'package.json': J({ name: 'web' }), 'src/a.js': "export const inv = (id) => fetch('http://billing-api:8080/invoices/' + id);\n" },
  });
  try {
    const { K, extract, catalog, edges } = await scan(ws.members);
    assert.deepEqual(aliasSources(extract, K.orders, 'billing-api'), [{ value: 'billing-api', source: 'deploy-self' }], 'a sub-directory build is an auxiliary container: a guess');
    assert.deepEqual(catalog.ambiguousAliases['billing-api'], [K['billing-service'], K.orders].sort(byStr), 'a stub and a package name tie, as at 15486564');
    assert.deepEqual(edges.filter((e) => e.includes('/invoices/')), [
      'orders -> billing-service http:GET /invoices/{} exact',
      'web -> billing-service http:GET /invoices/{} exact',
    ], 'the path finds the service; the stub never takes its calls');
  } finally {
    await ws.cleanup();
  }
});

test('a chart a service repo names like no member is a guess unless it bears the repo\'s own name: a peer\'s mock chart never takes the peer\'s host', async () => {
  const ws = await makeWorkspace({
    'billing-service': { 'package.json': J({ name: 'billing-api', dependencies: { express: '^4' } }), 'src/app.js': "const app = require('express')();\napp.get('/invoices/:id', (req, res) => res.json({}));\n" },
    orders: {
      'package.json': J({ name: 'orders', dependencies: { express: '^4' } }),
      'src/app.js': "const app = require('express')();\napp.get('/orders/:id', (req, res) => res.json({}));\n",
      'deploy/chart/Chart.yaml': 'apiVersion: v2\nname: orders-chart\nversion: 0.1.0\n',
      'dev/charts/billing-api/Chart.yaml': 'apiVersion: v2\nname: billing-api\nversion: 0.1.0\n',
    },
    web: { 'package.json': J({ name: 'web' }), 'src/a.js': "export const inv = (id) => fetch('http://billing-api:8080/invoices/' + id);\n" },
  });
  try {
    const { K, extract, edges } = await scan(ws.members);
    assert.deepEqual(aliasSources(extract, K.orders, 'orders-chart'), [{ value: 'orders-chart', source: 'helm' }], 'its own chart');
    assert.deepEqual(aliasSources(extract, K.orders, 'billing-api'), [{ value: 'billing-api', source: 'deploy-self' }], 'a peer\'s mock chart: a guess');
    assert.deepEqual(edges.filter((e) => e.startsWith('web ->')), ['web -> billing-service http:GET /invoices/{} exact']);
  } finally {
    await ws.cleanup();
  }
});

test('a service repo\'s dev-stack stub built per service from its root never takes the peer\'s host: http://billing reaches the service, as at 15486564', async () => {
  const ws = await makeWorkspace({
    'billing-service': { 'package.json': J({ name: 'billing', dependencies: { express: '^4' } }), 'src/app.js': "const app = require('express')();\napp.get('/invoices/:id', (req, res) => res.json({}));\n" },
    orders: {
      'package.json': J({ name: 'orders', dependencies: { express: '^4' } }),
      'src/app.js': "const app = require('express')();\napp.get('/orders/:id', (req, res) => res.json({}));\nexport const inv = (id) => fetch('http://billing:8080/invoices/' + id);\n",
      // its own API built from the root, and a WireMock answering as `billing`, built from the root with its own dockerfile
      'docker-compose.yml': 'services:\n  orders-api:\n    build: .\n  billing:\n    build:\n      context: .\n      dockerfile: stubs/billing.Dockerfile\n',
      'stubs/billing.Dockerfile': 'FROM wiremock/wiremock:3\n',
    },
    web: { 'package.json': J({ name: 'web' }), 'src/a.js': "export const inv = (id) => fetch('http://billing:8080/invoices/' + id);\n" },
  });
  try {
    const { K, extract, catalog, edges } = await scan(ws.members);
    assert.deepEqual(aliasSources(extract, K.orders, 'billing'), [{ value: 'billing', source: 'deploy-self' }], 'a per-service build of the root is an auxiliary container: a guess');
    assert.deepEqual(aliasSources(extract, K.orders, 'orders-api'), [{ value: 'orders-api', source: 'compose' }], 'a build of the root with its own Dockerfile stays a deploy name');
    assert.deepEqual(catalog.ambiguousAliases.billing, [K['billing-service'], K.orders].sort(byStr), 'a stub and a package name tie, as at 15486564');
    assert.deepEqual(edges.filter((e) => e.includes('/invoices/')), [
      'orders -> billing-service http:GET /invoices/{} exact',
      'web -> billing-service http:GET /invoices/{} exact',
    ], 'the path finds the service; the stub never takes its calls');
  } finally {
    await ws.cleanup();
  }
});

test('a monorepo\'s own service named like a peer\'s deploy name keeps the monorepo\'s calls to it: no edge to the peer, as at 15486564', async () => {
  const K8S = (name, image) => `apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: ${name}\nspec:\n  selector:\n    matchLabels:\n      app: ${name}\n  template:\n    metadata:\n      labels:\n        app: ${name}\n    spec:\n      containers:\n        - name: app\n          image: ${image}\n`;
  for (const [label, deploy] of [
    // the Turborepo with-docker layout: every app built from the root with its own Dockerfile (op 3.20's per-service clause)
    ['compose, per service from the root', { 'docker-compose.yml': 'services:\n  api:\n    build:\n      context: .\n      dockerfile: apps/api/Dockerfile\n  web:\n    build:\n      context: .\n      dockerfile: apps/web/Dockerfile\n    depends_on:\n      - api\n' }],
    // its own manifests run images named after the app, not the repository (op 3.14's code-member clause)
    ['k8s, an image named after the app', { 'k8s/api.yaml': K8S('api', 'ghcr.io/acme/api:1.4.0') }],
  ]) {
    const ws = await makeWorkspace({
      backend: {
        'package.json': J({ name: 'backend', dependencies: { express: '^4' } }),
        'src/server.js': "const app = require('express')();\napp.get('/users/:id', (req, res) => res.json({}));\n",
        'docker-compose.yml': 'services:\n  api:\n    build: .\n',
      },
      admin: {
        'package.json': J({ name: 'admin', private: true, workspaces: ['apps/*'] }),
        'apps/api/package.json': J({ name: '@admin/api', dependencies: { express: '^4' } }),
        'apps/api/src/server.js': "const app = require('express')();\napp.get('/products/:id', (req, res) => res.json({}));\n",
        'apps/web/src/api.js': "export const product = (id) => fetch('http://api:3001/products/' + id);\n",
        ...deploy,
      },
    });
    try {
      const { K, extract, catalog, edges } = await scan(ws.members);
      assert.deepEqual(aliasSources(extract, K.admin, 'api'), [{ value: 'api', source: 'deploy-self' }], `${label}: precondition`);
      assert.deepEqual(aliasSources(extract, K.backend, 'api'), [{ value: 'api', source: 'compose' }], `${label}: precondition`);
      assert.deepEqual(catalog.ambiguousAliases.api, [K.admin, K.backend].sort(byStr), `${label}: a member's own default deploy name ties with a peer's deploy name`);
      assert.deepEqual(edges, [], `${label}: admin's calls to its own api never land on backend`);
    } finally {
      await ws.cleanup();
    }
  }
});

test('a member that also names itself its own default deploy name at the manifest tier (or by a scope tail) still ties with a peer\'s deploy name: extract carries the self-guess through its dedupe', async () => {
  const K8S = (name, image) => `apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: ${name}\nspec:\n  selector:\n    matchLabels:\n      app: ${name}\n  template:\n    metadata:\n      labels:\n        app: ${name}\n    spec:\n      containers:\n        - name: app\n          image: ${image}\n---\napiVersion: v1\nkind: Service\nmetadata:\n  name: ${name}\nspec:\n  selector:\n    app: ${name}\n  ports:\n    - port: 8080\n`;
  // a Python service whose pyproject name equals its own k8s workload (an image that names no member: a guess), beside
  // a peer whose compose builds a `billing` from its root: at 15486564 the two tied and the path found the service
  const ws = await makeWorkspace({
    'billing-service': {
      'pyproject.toml': '[project]\nname = "billing"\nversion = "1"\ndependencies = ["flask"]\n',
      'app.py': "from flask import Flask\napp = Flask(__name__)\n@app.get('/invoices/<id>')\ndef inv(id):\n    return {}\n",
      'deploy/k8s/billing.yaml': K8S('billing', 'ghcr.io/acme/billing:1.2'),
    },
    'billing-v2': {
      'package.json': J({ name: 'billing-v2', dependencies: { express: '^4' } }),
      'src/app.js': "const app = require('express')();\napp.get('/v2/invoices/:id', (req, res) => res.json({}));\n",
      'docker-compose.yml': 'services:\n  billing:\n    build: .\n',
    },
    web: { 'package.json': J({ name: 'web' }), 'src/a.js': "export const inv = (id) => fetch('http://billing:8080/invoices/' + id);\n" },
  });
  try {
    const { K, extract, catalog, edges } = await scan(ws.members);
    assert.deepEqual(aliasSources(extract, K['billing-service'], 'billing'), [{ value: 'billing', source: 'pyproject', selfGuess: true }], 'the strongest source is kept, and the member\'s own deploy guess of the value with it');
    assert.deepEqual(catalog.ambiguousAliases.billing, [K['billing-service'], K['billing-v2']].sort(byStr), 'a member\'s own default deploy name ties with a peer\'s deploy name whatever else names it');
    assert.deepEqual(edges.filter((e) => e.includes('invoices')), ['web -> billing-service http:GET /invoices/{} exact'], 'the path finds the service; the peer never takes its calls');
  } finally {
    await ws.cleanup();
  }
  // the pinned monorepo layouts, once the monorepo also names itself `api` at the manifest tier (a root go.mod) or by a
  // scope tail (read in detect(), before deploy-k8s's finish() emits its guess: on equal tiers the first read is kept)
  const compose = { 'docker-compose.yml': 'services:\n  api:\n    build:\n      context: .\n      dockerfile: apps/api/Dockerfile\n  web:\n    build:\n      context: .\n      dockerfile: apps/web/Dockerfile\n    depends_on:\n      - api\n' };
  const k8s = { 'k8s/api.yaml': K8S('api', 'ghcr.io/acme/api:1.4.0') };
  const goMod = { 'go.mod': 'module github.com/acme/api\n' };
  for (const [label, deploy, root, kept] of [
    ['compose per service + a root go.mod', compose, goMod, 'go.mod'],
    ['k8s + a root go.mod', k8s, goMod, 'go.mod'],
    ['k8s + a root package named @acme/api', k8s, { 'package.json': J({ name: '@acme/api', private: true, workspaces: ['apps/*'] }) }, 'npm-scope-tail'],
  ]) {
    const w = await makeWorkspace({
      backend: {
        'package.json': J({ name: 'backend', dependencies: { express: '^4' } }),
        'src/server.js': "const app = require('express')();\napp.get('/users/:id', (req, res) => res.json({}));\n",
        'docker-compose.yml': 'services:\n  api:\n    build: .\n',
      },
      admin: {
        'package.json': J({ name: 'admin', private: true, workspaces: ['apps/*'] }),
        ...root,
        'apps/api/package.json': J({ name: '@admin/api', dependencies: { express: '^4' } }),
        'apps/api/src/server.js': "const app = require('express')();\napp.get('/products/:id', (req, res) => res.json({}));\n",
        'apps/web/src/api.js': "export const product = (id) => fetch('http://api:3001/products/' + id);\n",
        ...deploy,
      },
    });
    try {
      const { K, extract, catalog, edges } = await scan(w.members);
      assert.deepEqual(aliasSources(extract, K.admin, 'api'), [{ value: 'api', source: kept, selfGuess: true }], `${label}: precondition`);
      assert.deepEqual(catalog.ambiguousAliases.api, [K.admin, K.backend].sort(byStr), `${label}: the monorepo's own deploy name still ties with the peer's`);
      assert.deepEqual(edges, [], `${label}: admin's calls to its own api never land on backend`);
    } finally {
      await w.cleanup();
    }
  }
});
