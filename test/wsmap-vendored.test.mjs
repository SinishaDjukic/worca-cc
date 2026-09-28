// test/wsmap-vendored.test.mjs — D12 (M8): vendored copies are never extracted. The file layer skips
// `bower_components/` and `jspm_packages/` at any depth (like `node_modules/`, `vendor/`) and the
// third-party folders `third_party/`, `third-party/`, `thirdparty/`, `3rdparty/`, `3rd_party/`,
// `3rd-party/` and `external/` at the member root only — `src/**/external/` or `com/**/vendors/` is a
// service's own code; a vendored `.proto` there stays listed (a client keys its gRPC calls with its peer's
// contract), and so do the gRPC code generated from one and the member's own Pants / Bazel / Buck dependency
// lists. Manifest detectors never claim a sample app's manifest: under a sample folder (docs/, examples/,
// samples/, quickstarts/, tutorials/) at the member root, or in a folder of its own below one; a package that IS
// such a folder below the root (Turborepo's apps/docs) is real. Code and API specs there are still read.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { SKIP_DIRS, listMemberFiles } from '../src/core/workspace-map/files.mjs';
import { extractWorkspace } from '../src/core/workspace-map/extract.mjs';
import { buildCatalog } from '../src/core/workspace-map/catalog.mjs';
import { joinMap } from '../src/core/workspace-map/join.mjs';
import { DETECTORS, detectorById } from '../src/core/workspace-map/detectors/index.mjs';
import { makeWorkspace } from './helpers/wsmap-fixtures.mjs';
import { makeRepos } from './helpers/wsmap-p1-repos.mjs';

const J = (o) => JSON.stringify(o, null, 2) + '\n';
const ctl = (pkg, base, cls) => `package ${pkg};\n@RestController\n@RequestMapping("${base}")\npublic class ${cls} {\n  @GetMapping("/{id}")\n  public Object get(@PathVariable String id) { return null; }\n}\n`;

async function scan(spec) {
  const ws = await makeWorkspace(spec);
  try {
    const extract = await extractWorkspace({ name: 'W', members: ws.members });
    const catalog = await buildCatalog({ extract, survey: null });
    const map = await joinMap({ catalog, usage: null });
    return { extract, catalog, map, edges: map.edges.map((e) => `${e.from} -> ${e.to} ${e.norm} ${e.confidence}`) };
  } finally {
    await ws.cleanup();
  }
}

test('vendored copies at the member root are not extracted — (a) a third_party manifest provides nothing, (b) a vendored copy never takes a package from its member — while code in a nested external/ or vendors/ package keeps its edges', async () => {
  const { extract, catalog, edges } = await scan({
    billing: {
      'package.json': J({ name: '@acme/billing' }),
      'pom.xml': '<project><groupId>com.acme</groupId><artifactId>billing</artifactId></project>\n',
      'src/main/java/com/acme/billing/InvoiceController.java': ctl('com.acme.billing', '/invoices', 'InvoiceController'),
    },
    tools: { 'package.json': J({ name: 'tools', version: '1.0.0' }), 'third_party/left-pad/package.json': J({ name: 'left-pad', version: '1.3.0' }) },
    sdk: { 'package.json': J({ name: '@acme/sdk' }), 'external/vendored-billing/package.json': J({ name: '@acme/billing', version: '0.9.0' }) },
    orders: {
      'pom.xml': '<project><groupId>com.acme</groupId><artifactId>orders</artifactId></project>\n',
      'src/main/java/com/acme/orders/external/BillingClient.java': 'package com.acme.orders.external;\npublic class BillingClient {\n  Object get(String id) { return restTemplate.getForObject("http://billing:8080/invoices/{id}", Object.class, id); }\n}\n',
    },
    market: {
      'pom.xml': '<project><groupId>com.shop</groupId><artifactId>market</artifactId></project>\n',
      'src/main/java/com/shop/vendors/VendorController.java': ctl('com.shop.vendors', '/vendors', 'VendorController'),
    },
    web: {
      'package.json': J({ name: 'web', dependencies: { 'left-pad': '^1.3.0', '@acme/billing': '^1.0.0' } }),
      'src/a.ts': "export const v = (id) => fetch('http://market:8080/vendors/' + id);\n",
    },
  });
  // (a)
  assert.deepEqual(extract.members.tools.provides.map((f) => f.norm), ['pkg:npm:tools']);
  assert.ok(!edges.some((e) => e.startsWith('web -> tools')), edges.join('\n'));
  // (b)
  assert.deepEqual(extract.members.sdk.provides.map((f) => f.norm), ['pkg:npm:@acme/sdk']);
  assert.deepEqual(catalog.entries.filter((e) => e.norm === 'pkg:npm:@acme/billing').map((e) => e.member), ['billing']);
  assert.ok(edges.includes('web -> billing pkg:npm:@acme/billing exact'), edges.join('\n'));
  // nested external/ and vendors/ packages are code of their own
  assert.ok(edges.includes('orders -> billing http:GET /invoices/{} exact'), edges.join('\n'));
  assert.ok(extract.members.market.provides.some((f) => f.norm === 'http:GET /vendors/{}'));
  assert.ok(edges.includes('web -> market http:GET /vendors/{} exact'), edges.join('\n'));
});

// Folder names differ in more than case: on a case-insensitive file system (macOS, Windows) `thirdparty/` and
// `ThirdParty/` would be one folder. Root `external/` (lower case) is test 1's (b).
const LISTED = {
  'package.json': '{}\n',
  'third_party/a/x.js': 'x\n', 'third-party/b/x.js': 'x\n', 'ThirdParty/c/x.js': 'x\n',
  '3rdparty/d/x.js': 'x\n', '3rd_party/e/x.js': 'x\n', '3rd-party/f/x.js': 'x\n', 'External/g/x.js': 'x\n',
  'bower_components/h/x.js': 'x\n', 'web/jspm_packages/i/x.js': 'x\n', 'deep/a/b/bower_components/j/x.js': 'x\n',
  'src/third_party/m.js': 'x\n', 'src/external/n.js': 'x\n', 'pkg/external/o.go': 'x\n', 'com/shop/vendors/p.java': 'x\n', 'external.md': 'x\n',
  'third_party/acme/billing.proto': 'x\n', // a vendored contract stays: api-proto keys a client's calls with it
  'third_party/acme/billing_grpc.pb.go': 'x\n', 'External/acme/billing_pb2_grpc.py': 'x\n', // …and the gRPC code generated from it
  'third_party/acme/billing_pb2.py': 'x\n', // messages only: no service, skipped
  // …every generated shape api-proto reads a service from: connect-go, grpc-java / grpc-kotlin / grpc-dotnet, grpc-js, grpclib, grpc-web (JS and TS)
  'third_party/acme/billingv1connect/billing.connect.go': 'x\n', '3rd_party/acme/BillingGrpc.java': 'x\n', 'third-party/acme/billing_grpc_pb.js': 'x\n',
  // …and the member's own Python dependencies (Pants, Bazel)
  '3rdparty/python/requirements.txt': 'x\n', 'third_party/requirements_lock.txt': 'x\n', '3rdparty/python/dev-requirements.in': 'x\n',
  '3rdparty/python/requirements/base.txt': 'x\n', '3rdparty/python/requirements/dev.in': 'x\n', '3rdparty/python/pyproject.toml': 'x\n', // Pants: a requirements/ folder, poetry_requirements
  'third_party/cargo/Cargo.toml': 'x\n', 'third-party/Cargo.toml': 'x\n', 'third_party/rust/Cargo.toml': 'x\n', // cargo-raze, reindeer, crate_universe: the member's own crate list
  'third_party/serde/Cargo.toml': 'x\n', '3rdparty/python/attrs/pyproject.toml': 'x\n', // a vendored crate / library: skipped
  'third_party/acme/BillingGrpcKt.kt': 'x\n', 'External/acme/BillingGrpc.cs': 'x\n', // grpc-kotlin, grpc-dotnet
  'ThirdParty/acme/billing_grpc.py': 'x\n', '3rdparty/acme/billing_grpc_web_pb.js': 'x\n', '3rd-party/acme/BillingServiceClientPb.ts': 'x\n',
};
const KEPT = [
  '3rd-party/acme/BillingServiceClientPb.ts', '3rd_party/acme/BillingGrpc.java', '3rdparty/acme/billing_grpc_web_pb.js', '3rdparty/python/dev-requirements.in', '3rdparty/python/pyproject.toml', '3rdparty/python/requirements.txt', '3rdparty/python/requirements/base.txt', '3rdparty/python/requirements/dev.in', 'External/acme/BillingGrpc.cs', 'External/acme/billing_pb2_grpc.py', 'ThirdParty/acme/billing_grpc.py', 'com/shop/vendors/p.java', 'external.md', 'package.json', 'pkg/external/o.go', 'src/external/n.js', 'src/third_party/m.js', 'third-party/Cargo.toml', 'third-party/acme/billing_grpc_pb.js', 'third_party/acme/BillingGrpcKt.kt', 'third_party/acme/billing.proto', 'third_party/acme/billing_grpc.pb.go', 'third_party/acme/billingv1connect/billing.connect.go', 'third_party/cargo/Cargo.toml', 'third_party/requirements_lock.txt', 'third_party/rust/Cargo.toml',
];

test('listMemberFiles (git ls-files): third-party folders are skipped at the member root only; bower_components and jspm_packages at any depth', async () => {
  assert.ok(SKIP_DIRS.includes('bower_components') && SKIP_DIRS.includes('jspm_packages'));
  const ws = await makeWorkspace({ m: LISTED });
  try {
    const r = await listMemberFiles(ws.members[0].dir);
    assert.equal(r.via, 'git');
    assert.deepEqual(r.files, KEPT);
  } finally {
    await ws.cleanup();
  }
});

test('listMemberFiles (fs walk, no git): the same folders are skipped', async () => {
  const ws = await makeRepos({ m: LISTED }, { git: false });
  try {
    const r = await listMemberFiles(ws.members[0].dir);
    assert.equal(r.via, 'walk');
    assert.deepEqual(r.files, KEPT);
  } finally {
    await ws.cleanup();
  }
});

test('manifest detectors never claim a manifest under a sample folder; code and API specs there are still read', async () => {
  const manifests = {
    'pkg-npm': ['package.json'],
    'pkg-python': ['pyproject.toml', 'requirements.txt'],
    'pkg-maven': ['pom.xml'],
    'pkg-gradle': ['build.gradle', 'settings.gradle.kts', 'gradle/libs.versions.toml'],
    'pkg-cargo': ['Cargo.toml'],
    'pkg-go': ['go.mod'],
    'pkg-dotnet': ['Api.csproj', 'packages.config', 'Directory.Build.props'],
  };
  for (const [id, files] of Object.entries(manifests)) {
    const d = detectorById(id);
    for (const f of files) {
      assert.equal(d.claims(f), true, `${id} ${f}`);
      assert.equal(d.claims(`services/api/${f}`), true, `${id} services/api/${f}`);
      for (const dir of ['docs', 'doc', 'examples', 'example/demo-app', 'samples/web', 'sdk/quickstarts/app', 'tutorials/step-1', 'packages/sdk/examples/demo', 'Samples/Web']) {
        assert.equal(d.claims(`${dir}/${f}`), false, `${id} ${dir}/${f}`);
      }
      // a package that IS a docs folder below the root (Turborepo's apps/docs, a monorepo's services/docs) is real
      if (!f.includes('/')) for (const dir of ['apps/docs', 'services/docs', 'libs/docs/data-access']) assert.equal(d.claims(`${dir}/${f}`), true, `${id} ${dir}/${f}`);
    }
  }
  const claimers = (rel) => DETECTORS.filter((d) => d.claims(rel)).map((d) => d.id).sort();
  assert.ok(claimers('src/main/java/com/example/demo/DemoController.java').includes('http-routes'), 'code in a com/example package');
  assert.ok(claimers('docs/swagger.yaml').includes('api-openapi'), 'a spec under docs/ (swaggo)');

  // A sample copy named like a real package never gives the package a second owner.
  const { catalog, edges } = await scan({
    billing: { 'package.json': J({ name: '@acme/billing' }) },
    sdk: { 'package.json': J({ name: '@acme/sdk' }), 'examples/billing-mock/package.json': J({ name: '@acme/billing', private: true }) },
    web: { 'package.json': J({ name: 'web', dependencies: { '@acme/billing': '^1.0.0' } }) },
  });
  assert.deepEqual(catalog.entries.filter((e) => e.norm === 'pkg:npm:@acme/billing').map((e) => e.member), ['billing']);
  assert.ok(edges.includes('web -> billing pkg:npm:@acme/billing exact'), edges.join('\n'));
});

test('a Gradle build\'s included sample subproject (`:examples:billing`, a projectDir under samples/) never gives a package a second owner', async () => {
  // pkg-gradle derives a subproject's package from the ROOT settings file's `include`, so the claims rule never sees it
  const { extract, catalog, edges } = await scan({
    billing: { 'pom.xml': '<project><groupId>com.acme</groupId><artifactId>billing</artifactId></project>\n' },
    sdk: {
      'settings.gradle': "rootProject.name = 'sdk'\ninclude ':core'\ninclude ':examples:billing'\ninclude 'orders-demo'\nproject(':orders-demo').projectDir = file('samples/orders')\n",
      'build.gradle': "group = 'com.acme'\n",
      'core/build.gradle': "plugins { id 'java-library' }\n",
      'examples/billing/build.gradle': "plugins { id 'application' }\n",
      'samples/orders/build.gradle': "plugins { id 'application' }\n",
    },
    web: { 'pom.xml': '<project><groupId>com.acme</groupId><artifactId>web</artifactId><dependencies><dependency><groupId>com.acme</groupId><artifactId>billing</artifactId></dependency></dependencies></project>\n' },
  });
  assert.deepEqual(extract.members.sdk.provides.map((f) => f.norm).sort(), ['pkg:maven:com.acme:core', 'pkg:maven:com.acme:sdk']);
  assert.deepEqual(catalog.entries.filter((e) => e.norm === 'pkg:maven:com.acme:billing').map((e) => e.member), ['billing']);
  assert.ok(edges.includes('web -> billing pkg:maven:com.acme:billing exact'), edges.join('\n'));
});

test('a vendored copy of a peer service\'s .proto at the member root is still read: the client keeps its exact gRPC edge', async () => {
  const PROTO = 'syntax = "proto3";\npackage acme.billing.v1;\noption go_package = "github.com/acme/billing/gen/billingv1";\nservice Billing {\n  rpc GetInvoice (GetInvoiceRequest) returns (Invoice);\n}\nmessage GetInvoiceRequest { string id = 1; }\nmessage Invoice { string id = 1; }\n';
  const { edges } = await scan({
    billing: {
      'go.mod': 'module github.com/acme/billing\n\ngo 1.22\n',
      'proto/acme/billing/v1/billing.proto': PROTO,
      'cmd/server/main.go': 'package main\n\nimport billingv1 "github.com/acme/billing/gen/billingv1"\n\nfunc main() {\n\tbillingv1.RegisterBillingServer(s, &srv{})\n}\n',
    },
    web: {
      'go.mod': 'module github.com/acme/web\n\ngo 1.22\n',
      'third_party/acme/billing/v1/billing.proto': PROTO,
      'internal/billing/client.go': 'package billing\n\nimport billingv1 "github.com/acme/billing/gen/billingv1"\n\nfunc New(conn *grpc.ClientConn) billingv1.BillingClient {\n\treturn billingv1.NewBillingClient(conn)\n}\n',
    },
  });
  assert.ok(edges.includes('web -> billing grpc:acme.billing.v1.Billing/GetInvoice exact'), edges.join('\n'));
});

test('vendored gRPC code generated from a peer service\'s .proto (no .proto) at the member root is still read: the client keeps its exact gRPC edge', async () => {
  const { edges } = await scan({
    billing: {
      'go.mod': 'module github.com/acme/billing\n\ngo 1.22\n',
      'proto/acme/billing/v1/billing.proto': 'syntax = "proto3";\npackage acme.billing.v1;\noption go_package = "github.com/acme/billing/gen/billingv1";\nservice Billing {\n  rpc GetInvoice (GetInvoiceRequest) returns (Invoice);\n}\nmessage GetInvoiceRequest { string id = 1; }\nmessage Invoice { string id = 1; }\n',
      'cmd/server/main.go': 'package main\n\nimport billingv1 "github.com/acme/billing/gen/billingv1"\n\nfunc main() {\n\tbillingv1.RegisterBillingServer(s, &srv{})\n}\n',
    },
    web: {
      'go.mod': 'module github.com/acme/web\n\ngo 1.22\n',
      'third_party/billingv1/billing_grpc.pb.go': '// Code generated by protoc-gen-go-grpc. DO NOT EDIT.\n\npackage billingv1\n\nconst (\n\tBilling_GetInvoice_FullMethodName = "/acme.billing.v1.Billing/GetInvoice"\n)\n\nfunc NewBillingClient(cc grpc.ClientConnInterface) BillingClient { return nil }\n',
      'internal/billing/client.go': 'package billing\n\nimport billingv1 "github.com/acme/web/third_party/billingv1"\n\nfunc New(conn *grpc.ClientConn) billingv1.BillingClient {\n\treturn billingv1.NewBillingClient(conn)\n}\n',
    },
  });
  assert.ok(edges.includes('web -> billing grpc:acme.billing.v1.Billing/GetInvoice exact'), edges.join('\n'));
});

test('Turborepo\'s apps/docs is a real package: its dependency on another member and a dependency on it keep their edges', async () => {
  const { edges } = await scan({
    tokens: { 'package.json': J({ name: '@acme/tokens', version: '1.0.0' }) },
    site: {
      'package.json': J({ name: 'site-root', private: true, workspaces: ['apps/*'] }),
      'apps/docs/package.json': J({ name: '@acme/docs', dependencies: { '@acme/tokens': '^1.0.0' } }),
      'apps/web/package.json': J({ name: '@acme/web', dependencies: { react: '^18' } }),
    },
    consumer: { 'package.json': J({ name: 'consumer', dependencies: { '@acme/docs': '^1.0.0' } }) },
  });
  assert.ok(edges.includes('site -> tokens pkg:npm:@acme/tokens exact'), edges.join('\n'));
  assert.ok(edges.includes('consumer -> site pkg:npm:@acme/docs exact'), edges.join('\n'));
});
