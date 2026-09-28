import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { makeWorkspace, runDetector, keysOf, assertEvidence } from './helpers/wsmap-fixtures.mjs';
import detector from '../src/core/workspace-map/detectors/deploy-k8s.mjs';

const BILLING_K8S = `apiVersion: apps/v1
kind: Deployment
metadata:
  name: billing
spec:
  template:
    metadata:
      labels: { app: billing }
    spec:
      containers:
        - name: api
          image: registry.acme.io/acme/billing-api:2.1
          env:
            - name: LEDGER_URL
              value: http://ledger.default.svc.cluster.local:7000/v2
            - name: ORDERS_URL
              value: \${ORDERS_URL}
            - name: FROM_CM
              valueFrom: { configMapKeyRef: { name: billing-config, key: DB } }
---
apiVersion: v1
kind: Service
metadata:
  name: billing-svc
spec:
  selector: { app: billing }
---
apiVersion: v1
kind: ConfigMap
metadata:
  name: billing-config
data:
  DB: jdbc:postgresql://pg:5432/billing
---
apiVersion: v1
kind: ConfigMap
metadata:
  name: unused-config
data:
  X: http://nobody:1/x
---
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: public
spec:
  rules:
    - host: pay.acme.com
      http:
        paths:
          - path: /
            pathType: Prefix
            backend: { service: { name: billing-svc, port: { number: 80 } } }
`;
// A GitOps repo: manifests for OTHER members (images name them) and one foreign image.
const GITOPS = `apiVersion: v1
kind: List
items:
  - apiVersion: apps/v1
    kind: Deployment
    metadata: { name: web }
    spec:
      template:
        metadata: { labels: { app: web } }
        spec:
          containers:
            - image: ghcr.io/acme/web:1
              env:
                - { name: API_URL, value: "http://billing-svc/api" }
  - apiVersion: batch/v1
    kind: CronJob
    metadata: { name: nightly-report }
    spec:
      jobTemplate:
        spec:
          template:
            spec:
              containers:
                - image: ghcr.io/acme/gitops-report:1
                  env:
                    - { name: REPORT_URL, value: "http://reports:8080/run" }
`;
// Infrastructure next to an own service: an official image (redis:7) and a selector-less
// ExternalName Service name no member; a namespaced Deployment / Service also alias `<name>.<ns>`.
const OPS_K8S = `apiVersion: apps/v1
kind: StatefulSet
metadata: { name: redis }
spec:
  template:
    metadata: { labels: { app: redis } }
    spec:
      containers:
        - image: redis:7
          env:
            - { name: PEER_URL, value: "http://peer:8080/x" }
---
apiVersion: v1
kind: Service
metadata: { name: redis }
spec: { selector: { app: redis } }
---
apiVersion: v1
kind: Service
metadata: { name: postgres }
spec: { type: ExternalName, externalName: db.acme.com }
---
apiVersion: apps/v1
kind: Deployment
metadata: { name: ops-api, namespace: payments }
spec:
  template:
    metadata: { labels: { app: ops-api } }
    spec:
      containers:
        - image: ghcr.io/acme/ops-api:1
---
apiVersion: v1
kind: Service
metadata: { name: ops-svc, namespace: payments }
spec: { selector: { app: ops-api } }
`;

let ws;
before(async () => {
  ws = await makeWorkspace({
    'billing-api': {
      'k8s/billing.yaml': BILLING_K8S.replace(/\n/g, '\r\n'),
      'charts/billing-api/Chart.yaml': 'apiVersion: v2\nname: billing-api\nversion: 0.1.0\n',
      'charts/billing-api/values.yaml': 'image:\n  repository: billing-api\nledger:\n  baseUrl: http://ledger:7000\n  timeout: 5\nredisHost: cache\nmetricsUrl: http://localhost:9090/metrics\n',
      'charts/billing-api/templates/deployment.yaml': 'apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: {{ include "x.fullname" . }}\n{{- if .Values.x }}\n',
      'serverless.yml': 'service: billing-fn\nprovider: { name: aws }\n',
      'openapi.yaml': 'openapi: 3.0.0\ninfo: { title: x, version: "1" }\npaths: {}\n',
    },
    web: { 'README.md': '# web\n' },
    ledger: { 'README.md': '# ledger\n' },
    gitops: { 'apps/list.yaml': GITOPS, 'broken.yaml': 'apiVersion: v1\nkind: Service\nmetadata: { name: [oops\n' },
    // Kustomize-style overlays: patch documents carry no image; one patches a workload of another member (and sorts before
    // its base), one deletes `web`.
    kust: {
      'k8s/base/app.yaml': 'apiVersion: apps/v1\nkind: Deployment\nmetadata: { name: kust-app }\nspec:\n  template:\n    spec:\n      containers:\n        - image: ghcr.io/acme/kust-app:1\n',
      'k8s/base/ledger.yaml': 'apiVersion: apps/v1\nkind: Deployment\nmetadata: { name: ledger-api }\nspec:\n  template:\n    spec:\n      containers:\n        - image: ghcr.io/acme/ledger:1\n',
      'k8s/overlays/prod/app-patch.yaml': 'apiVersion: apps/v1\nkind: Deployment\nmetadata: { name: kust-app }\nspec:\n  template:\n    spec:\n      containers:\n        - name: app\n          env:\n            - { name: REPORT_URL, value: "http://reports:8080/run" }\n',
      'deploy/overlays/prod/ledger-patch.yaml': 'apiVersion: apps/v1\nkind: Deployment\nmetadata: { name: ledger-api }\nspec:\n  template:\n    spec:\n      containers:\n        - name: api\n          env:\n            - { name: BILLING_URL, value: "http://billing:8080/x" }\n',
      // a patch of a workload no document of this member defines (its base lives elsewhere): nobody's, even named like no member
      'k8s/overlays/prod/worker-patch.yaml': 'apiVersion: apps/v1\nkind: Deployment\nmetadata: { name: batch-worker }\nspec:\n  template:\n    spec:\n      containers:\n        - name: w\n          env:\n            - { name: QUEUE_URL, value: "http://rabbit:15672/api" }\n',
      'k8s/overlays/prod/delete-web.yaml': 'apiVersion: apps/v1\nkind: Deployment\nmetadata: { name: web }\n$patch: delete\n',
      'docs/samples/demo.yaml': 'apiVersion: v1\nkind: Service\nmetadata: { name: api-service }\nspec: { selector: { app: demo } }\n',
    },
    ops: {
      'k8s/ops.yaml': OPS_K8S,
      'charts/ops/Chart.yaml': 'apiVersion: v2\nname: ops-chart\nversion: 0.1.0\n',
      'charts/ops/values.yaml': 'ingress:\n  hosts:\n    - host: billing.acme.internal\nledgerUrl: http://ledger:7000\n',
      'charts/ops/charts/postgresql/Chart.yaml': 'apiVersion: v2\nname: postgresql\nversion: 12.0.0\n',
      'testdata/sample.yaml': 'apiVersion: apps/v1\nkind: Deployment\nmetadata: { name: ledger }\nspec:\n  template:\n    spec:\n      containers:\n        - image: example/sample:1\n',
    },
  });
});
after(() => ws.cleanup());
const member = (k) => ws.members.find((m) => m.key === k);

test('deploy-k8s: workload, selected Service, whole Ingress host, chart and serverless names alias this member', async () => {
  const r = await runDetector(detector, member('billing-api'), ws.members);
  assert.deepEqual(r.aliases.map((a) => [a.value, a.source]).sort(), [
    ['billing', 'k8s'], ['billing-api', 'helm'], ['billing-fn', 'serverless'], ['billing-svc', 'k8s'], ['pay.acme.com', 'k8s-ingress'],
  ]);
  assert.ok(r.aliases.every((a) => a.member === 'billing-api'));
});

test('deploy-k8s: own workload env URLs, referenced ConfigMap values and Helm peer values are consumes', async () => {
  const r = await runDetector(detector, member('billing-api'), ws.members);
  assert.deepEqual(keysOf(r, 'service', 'consumes'), ['cache', 'ledger', 'ledger.default.svc.cluster.local']);
  assert.deepEqual(keysOf(r, 'http', 'consumes'), ['/metrics', '/v2']);
  const metrics = r.facts.find((f) => f.key === '/metrics');
  assert.deepEqual([metrics.target, metrics.confidence, metrics.line], ['metricsUrl', 'heuristic', 7], 'a localhost Helm value targets its key (P1 envStems)');
  assert.deepEqual(keysOf(r, 'db', 'consumes'), ['db:billing']);
  const ledger = r.facts.find((f) => f.key === '/v2');
  assert.deepEqual([ledger.file, ledger.line, ledger.detail], ['k8s/billing.yaml', 15, 'LEDGER_URL (billing)']);
  assert.equal(r.facts.find((f) => f.kind === 'db').detail, 'DB (configmap billing-config)');
  assert.ok(!r.facts.some((f) => f.key.startsWith('nobody')), 'an unreferenced ConfigMap is not attributed');
  assert.equal(r.facts.find((f) => f.key === 'cache').confidence, 'heuristic');
  assertEvidence(member('billing-api'), r);
});

test('deploy-k8s: placeholder env is unresolved; Helm templates are skipped, not errors', async () => {
  const r = await runDetector(detector, member('billing-api'), ws.members);
  assert.deepEqual(r.unresolved.map((u) => [u.raw, u.reason, u.line]), [['ORDERS_URL=${ORDERS_URL}', 'placeholder', 17]]);
});

test('deploy-k8s (GitOps List): an image naming another member aliases that member and attributes no consumes here', async () => {
  const r = await runDetector(detector, member('gitops'), ws.members);
  assert.deepEqual(r.aliases.map((a) => [a.value, a.member]).sort(), [['nightly-report', 'gitops'], ['web', 'web']]);
  assert.deepEqual(r.facts.map((f) => [f.kind, f.key]).sort(), [['http', '/run'], ['service', 'reports']], 'only the CronJob whose image matches no member is this member\'s');
  assertEvidence(member('gitops'), r);
});

test('deploy-k8s: infrastructure (official images, selector-less Services, vendored subcharts) and test-path samples alias nobody; a namespace adds <name>.<ns>', async () => {
  const r = await runDetector(detector, member('ops'), ws.members);
  assert.deepEqual(r.aliases.map((a) => [a.value, a.source]).sort(), [
    ['ops-api', 'deploy-self'], ['ops-api.payments', 'deploy-self'], ['ops-chart', 'deploy-self'], ['ops-svc', 'deploy-self'], ['ops-svc.payments', 'deploy-self'],
  ], 'no redis, postgres, postgresql or ledger (testdata/) alias; ops has no code, so its own names are deploy-self guesses (M7)');
  assert.deepEqual(keysOf(r, 'service', 'consumes'), ['ledger'], 'the chart\'s own ingress host is no consume; redis:7\'s env is nobody\'s');
  assertEvidence(member('ops'), r);
});

test('deploy-k8s: a patch document (no image) takes the subject of the workload it patches, else names nobody; samples are not read', async () => {
  const r = await runDetector(detector, member('kust'), ws.members);
  assert.deepEqual(r.aliases.map((a) => [a.value, a.member]).sort(), [['kust-app', 'kust'], ['ledger-api', 'ledger']], 'the delete patch never names this member `web`; docs/samples/ aliases nobody');
  assert.deepEqual(r.facts.map((f) => [f.kind, f.key, f.file]).sort(), [['http', '/run', 'k8s/overlays/prod/app-patch.yaml'], ['service', 'reports', 'k8s/overlays/prod/app-patch.yaml']],
    'a patch of this member\'s workload adds its consumes; a patch of ledger\'s adds none here');
  assert.equal(detector.claims('docs/samples/demo.yaml'), false);
  assertEvidence(member('kust'), r);
});

test('deploy-k8s: malformed manifest → unresolved parse error, never throws', async () => {
  const r = await runDetector(detector, member('gitops'), ws.members);
  assert.ok(r.unresolved.some((u) => u.file === 'broken.yaml' && u.reason.startsWith('yaml parse error')));
});

const dep = (name, image, env = '', labels = `{ app: ${name} }`) => `apiVersion: apps/v1\nkind: Deployment\nmetadata: { name: ${name} }\nspec:\n  template:\n    metadata: { labels: ${labels} }\n    spec:\n      containers:\n        - image: ${image}\n${env}`;
const svc = (name, app) => `apiVersion: v1\nkind: Service\nmetadata: { name: ${name} }\nspec: { selector: { app: ${app} } }\n`;

test('deploy-k8s: a workload named like another member is that member\'s; a gateway host, a sidecar patch, a nested serverless.yml and an umbrella chart\'s values-<member>.yaml name nobody here', async () => {
  const w = await makeWorkspace({
    cart: { 'README.md': '# cart\n' },
    ledger: { 'charts/ledger/Chart.yaml': 'apiVersion: v2\nname: ledger\nversion: 0.1.0\n', 'charts/ledger/values-prod.yaml': 'metricsUrl: http://metrics:9090/p\n' },
    orders: { 'README.md': '# orders\n' },
    prod: { 'README.md': '# prod\n' },
    gitops: {
      'apps/cart.yaml': `${dep('cart', 'ghcr.io/acme/cart-svc:1.0', '          env:\n            - { name: LEDGER_URL, value: "http://ledger:7000/x" }\n')}---\n${svc('cart', 'cart')}`,
      'apps/a-ledger-sidecar.yaml': dep('ledger-api', 'envoyproxy/envoy:v1.30'),
      'apps/ledger.yaml': `${dep('ledger-api', 'ghcr.io/acme/ledger:3')}---\n${svc('ledger-api', 'ledger-api')}`,
      'apps/orders-svc.yaml': svc('orders', 'nothing'),
      'apps/ingress.yaml': 'apiVersion: networking.k8s.io/v1\nkind: Ingress\nmetadata: { name: gw }\nspec:\n  rules:\n    - host: api.acme.com\n      http:\n        paths:\n          - { path: /cart, backend: { service: { name: cart } } }\n          - { path: /ledger, backend: { service: { name: ledger-api } } }\n',
      'apps/ops.yaml': dep('ops', 'ghcr.io/acme/ops-tool:1', '          env:\n            - { name: METRICS_URL, value: "http://metrics:9090/m" }\n'),
      'functions/api/serverless.yml': 'service: api\nprovider: { name: aws }\n',
      'charts/platform/Chart.yaml': 'apiVersion: v2\nname: platform\nversion: 0.1.0\n',
      'charts/platform/values.yaml': 'metricsUrl: http://metrics2:9090\n',
      'charts/platform/values-orders.yaml': 'ledgerUrl: http://ledger:7000\n',
    },
  });
  try {
    const gitops = w.members.find((m) => m.key === 'gitops');
    const r = await runDetector(detector, gitops, w.members);
    assert.deepEqual(r.aliases.map((a) => [a.value, a.member]).sort(), [['cart', 'cart'], ['ledger-api', 'ledger'], ['ops', 'gitops'], ['platform', 'gitops']],
      'no api.acme.com (two subjects), no `api` (a nested serverless.yml), no `orders` (a Service named like another member); the sidecar patch is ledger\'s');
    assert.deepEqual(r.facts.map((f) => [f.kind, f.key]).sort(), [['http', '/m'], ['service', 'metrics'], ['service', 'metrics2']],
      'cart\'s env is cart\'s; values-orders.yaml configures orders');
    assertEvidence(gitops, r);
    const ledger = await runDetector(detector, w.members.find((m) => m.key === 'ledger'), w.members);
    assert.deepEqual(keysOf(ledger, 'service', 'consumes'), ['metrics'], 'a member\'s own chart keeps values-prod.yaml although a member is named `prod`');
  } finally { await w.cleanup(); }
});

test('deploy-k8s: a member\'s own workload named like another member stays its own unless an image names the workload or the member has no code (tooling is none); a deploy repo\'s host of an ExternalName or undefined Service names nobody; an own chart keeps values-<member>.yaml', async () => {
  const env = (k, v) => `          env:\n            - { name: ${k}, value: "${v}" }\n`;
  const ext = (name) => `apiVersion: v1\nkind: Service\nmetadata: { name: ${name} }\nspec: { type: ExternalName, externalName: billing.prod.example.org }\n`;
  const ing = (host, paths) => `apiVersion: networking.k8s.io/v1\nkind: Ingress\nmetadata: { name: gw }\nspec:\n  rules:\n    - host: ${host}\n      http:\n        paths:\n${paths.map(([p, b]) => `          - { path: ${p}, backend: { service: { name: ${b} } } }\n`).join('')}`;
  const w = await makeWorkspace({
    web: { 'README.md': '# web\n' },
    billing: { 'README.md': '# billing\n' },
    frontend: { 'README.md': '# frontend\n' },
    // a Django repo: its `web` Deployment runs its own image; its host also routes /docs to an ExternalName; its chart is `orders-chart`
    orders: {
      'manage.py': 'x\n',
      'k8s/web.yaml': `${dep('web', 'registry.acme.io/acme/orders-django:1', env('PAYMENTS_URL', 'http://payments:8080/api/charge'))}---\n${svc('orders-web', 'web')}---\n${ext('docs-site')}---\n${ing('shop.acme.com', [['/', 'orders-web'], ['/docs', 'docs-site']])}---\n${ing('ext.acme.com', [['/', 'docs-site']])}`,
      'helm/Chart.yaml': 'apiVersion: v2\nname: orders-chart\nversion: 0.1.0\n',
      'helm/values-web.yaml': 'cacheUrl: http://cache:6379\n',
    },
    // a platform monorepo with code deploying billing (its image names it)
    platform: { 'main.go': 'package main\n', 'k8s/billing.yaml': dep('billing', 'acme/billing-service:1.2', env('LEDGER_URL', 'http://ledger:7000/x')) },
    // a GitOps repo whose only code is tooling: frontend runs an image named otherwise; two hosts reach no workload of its own
    gitops: {
      'internal/tools/tools.go': 'package tools\n',
      'apps/frontend.yaml': dep('frontend', 'acme/storefront:2', env('LEDGER_URL', 'http://ledger:7000/y')),
      'apps/ingress.yaml': `${ext('billing-ext')}---\n${ing('api.acme.com', [['/billing', 'billing-ext']])}---\n${ing('pay.acme.com', [['/', 'payments-svc']])}`,
    },
  });
  try {
    const at = (k) => runDetector(detector, w.members.find((m) => m.key === k), w.members);
    const orders = await at('orders');
    assert.deepEqual(orders.facts.map((f) => [f.kind, f.key]).sort(), [['http', '/api/charge'], ['service', 'cache'], ['service', 'payments']], 'its own workload\'s env and its own chart\'s values-web.yaml');
    assert.deepEqual(orders.aliases.map((a) => [a.value, a.member]).sort(), [['orders-chart', 'orders'], ['orders-web', 'orders'], ['shop.acme.com', 'orders']], 'no `web` alias; the /docs ExternalName does not cost its host, and a host of an ExternalName alone names nobody');
    assertEvidence(w.members.find((m) => m.key === 'orders'), orders);
    const platform = await at('platform');
    assert.deepEqual([platform.facts, platform.aliases.map((a) => [a.value, a.member])], [[], [['billing', 'billing']]], 'an image naming the workload: billing\'s');
    const gitops = await at('gitops');
    assert.deepEqual([gitops.facts, gitops.aliases.map((a) => [a.value, a.member])], [[], [['frontend', 'frontend']]], 'code-less (tooling only): frontend\'s; no host aliases the deploy repo');
  } finally { await w.cleanup(); }
});

test('deploy-k8s: an image whose repository names THIS member keeps its workload here (orders-web beside a `web` member); a backend defined elsewhere and named like another member, a code-less member\'s Service that selects nothing here and repository config files (commitlint.config.js, .eslintrc.js) give this member no host', async () => {
  const env = (k, v) => `          env:\n            - { name: ${k}, value: "${v}" }\n`;
  const ing = (host, paths) => `apiVersion: networking.k8s.io/v1\nkind: Ingress\nmetadata: { name: gw }\nspec:\n  rules:\n    - host: ${host}\n      http:\n        paths:\n${paths.map(([p, b]) => `          - { path: ${p}, backend: { service: { name: ${b} } } }\n`).join('')}`;
  const pairs = (r) => r.aliases.map((a) => [a.value, a.member]).sort();
  const w = await makeWorkspace({
    web: { 'src/index.js': 'x\n' },
    billing: { 'main.go': 'package main\n' },
    frontend: { 'src/index.js': 'x\n' },
    // a Django repo: its `web` Deployment runs `orders-web` — an image named after this member AND the workload
    orders: { 'manage.py': 'x\n', 'k8s/web.yaml': `${dep('web', 'ghcr.io/acme/orders-web:1.4', env('PAYMENTS_URL', 'http://payments:8080/api/charge'))}---\n${svc('web', 'web')}---\n${ing('orders.acme.com', [['/', 'web']])}---\n${ing('api.acme.com', [['/orders', 'web'], ['/v1', 'billing']])}` },
    // a GitOps repo holding a Service (and its host) whose Deployment lives elsewhere
    gitops: { 'apps/billing.yaml': `${svc('billing-svc', 'billing')}---\n${ing('pay.acme.com', [['/', 'billing-svc']])}` },
    // a GitOps repo whose only JS files configure the repository
    gitops2: { 'commitlint.config.js': 'module.exports = {};\n', '.eslintrc.js': 'module.exports = {};\n', 'apps/fe.yaml': `${dep('frontend', 'acme/storefront:2', env('LEDGER_URL', 'http://ledger:7000/y'))}---\n${ing('shop.acme.com', [['/', 'payments-svc']])}` },
  });
  try {
    const at = (k) => runDetector(detector, w.members.find((m) => m.key === k), w.members);
    const orders = await at('orders');
    assert.deepEqual(orders.facts.map((f) => [f.kind, f.key]).sort(), [['http', '/api/charge'], ['service', 'payments']], 'its own image (orders-web): its env is its calls');
    assert.deepEqual(pairs(orders), [['orders.acme.com', 'orders']], 'api.acme.com also routes /v1 to billing (defined elsewhere): nobody; `web` never aliases it');
    const gitops = await at('gitops');
    assert.deepEqual([gitops.facts, pairs(gitops)], [[], []], 'a Service selecting no workload of a code-less repo, and its host, name nobody');
    const gitops2 = await at('gitops2');
    assert.deepEqual([gitops2.facts, pairs(gitops2)], [[], [['frontend', 'frontend']]], 'repository config files are no code: frontend\'s workload, no host for the deploy repo');
  } finally { await w.cleanup(); }
});

test('deploy-k8s: Helm values stop at the walk budget — a values file of aliased URLs stays linear and reports yaml too large', () => {
  const map = `{${Array.from({ length: 1000 }, (_, i) => `u${i}_url: *v`).join(', ')}}`;
  const values = `a: &v "http://h/${'x'.repeat(10240)}"\nb: &l ${map}\nc: [${Array.from({ length: 150 }, () => '*l').join(', ')}]\n`;
  const member = { key: 'm', name: 'm', dir: '/m', projectDir: '/m' };
  const ctx = { member, members: [member], files: ['chart/Chart.yaml', 'chart/values.yaml'], state: {} };
  const t0 = performance.now();
  detector.detect({ rel: 'chart/Chart.yaml', text: 'apiVersion: v2\nname: chart\nversion: 0.1.0\n' }, ctx);
  const r = detector.detect({ rel: 'chart/values.yaml', text: values }, ctx);
  detector.finish(ctx);
  const ms = performance.now() - t0;
  assert.deepEqual(r?.unresolved?.map((u) => u.reason), ['yaml parse error: yaml too large']);
  assert.ok(ms < 2000, `took ${ms.toFixed(0)} ms (every aliased value classified: ~2 s for 25 KB)`);
  const two = `a: &v "http://h/${'x'.repeat(10240)}"\nb: [${Array.from({ length: 300 }, (_, i) => `{u${i}_url: *v}`).join(', ')}]\n`;
  const r2 = detector.detect({ rel: 'chart/values.yaml', text: `${two}---\n${two}` }, { ...ctx, state: {} });
  assert.deepEqual(r2?.unresolved?.map((u) => u.reason), ['yaml parse error: yaml too large'], 'one budget spans the documents of a file');
});

test('deploy-k8s: a product prefix several services\' images share (`yas-media`, `yas-product` in the `yas` repo) is no own name — those workloads are the services\', their gateway host names nobody; a lone `orders-web` stays its repo\'s', async () => {
  const env = (k, v) => `          env:\n            - { name: ${k}, value: "${v}" }\n`;
  const ing = (host, paths) => `apiVersion: networking.k8s.io/v1\nkind: Ingress\nmetadata: { name: gw }\nspec:\n  rules:\n    - host: ${host}\n      http:\n        paths:\n${paths.map(([p, b]) => `          - { path: ${p}, backend: { service: { name: ${b} } } }\n`).join('')}`;
  const pairs = (r) => r.aliases.map((a) => [a.value, a.member]).sort();
  const w = await makeWorkspace({
    media: { 'main.go': 'package main\n' },
    product: { 'main.go': 'package main\n' },
    web: { 'src/index.js': 'x\n' },
    // nashtech-garage/yas: the product repo (a shared library — code) deploys every service as ghcr.io/…/yas-<service>
    yas: {
      'common-library/src/main/java/com/yas/Util.java': 'class Util {}\n',
      'yaslocal.yaml': `${dep('media', 'ghcr.io/acme/yas-media:latest', env('SPRING_DATASOURCE_URL', 'jdbc:postgresql://postgres:5432/media'))}---\n${svc('media', 'media')}---\n${dep('product', 'ghcr.io/acme/yas-product:latest')}---\n${svc('product', 'product')}---\n${ing('api.yas.local', [['/media', 'media'], ['/product', 'product']])}`,
    },
    orders: { 'manage.py': 'x\n', 'k8s/web.yaml': `${dep('web', 'ghcr.io/acme/orders-web:1.4', env('PAYMENTS_URL', 'http://payments:8080/api/charge'))}---\n${svc('web', 'web')}---\n${ing('orders.acme.com', [['/', 'web']])}` },
  });
  try {
    const at = (k) => runDetector(detector, w.members.find((m) => m.key === k), w.members);
    const yas = await at('yas');
    assert.deepEqual(yas.facts, [], 'media\'s env is not the product repo\'s calls');
    assert.deepEqual(pairs(yas), [['media', 'media'], ['product', 'product']], 'the services\' workloads; api.yas.local routes to two of them: nobody (never the product repo)');
    const orders = await at('orders');
    assert.deepEqual(orders.facts.map((f) => [f.kind, f.key]).sort(), [['http', '/api/charge'], ['service', 'payments']], 'a lone own-named image (V7-02) stays here');
    assert.deepEqual(pairs(orders), [['orders.acme.com', 'orders']]);
  } finally { await w.cleanup(); }
});
