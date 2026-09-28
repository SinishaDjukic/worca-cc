// test/wsmap-yaml-file-budget.test.mjs
// A crafted YAML file of many small documents, each with alias fan-out, gave every document its own node budget:
// 128 KiB ran extract out of memory. loadYaml now spends ONE budget per file (MAX_NODES, or the file's length when
// larger, so alias-free YAML is never cut) and says so in `cut` — never in `errors`, whose first entry callers
// report as is. Each YAML detector reports a cut file the way it reports a parse error: one unresolved item.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as yaml from '../src/core/workspace-map/detectors/lib/yaml.mjs';
import { detectorById } from '../src/core/workspace-map/detectors/index.mjs';

// One small document whose aliases fan out to 10^6 leaves (6 levels of 10).
const BOMB = [
  'a: &a [x,x,x,x,x,x,x,x,x,x]',
  'b: &b [*a,*a,*a,*a,*a,*a,*a,*a,*a,*a]',
  'c: &c [*b,*b,*b,*b,*b,*b,*b,*b,*b,*b]',
  'd: &d [*c,*c,*c,*c,*c,*c,*c,*c,*c,*c]',
  'e: &e [*d,*d,*d,*d,*d,*d,*d,*d,*d,*d]',
  'f: [*e,*e,*e,*e,*e,*e,*e,*e,*e,*e]',
  '',
].join('\n');
const { loadYaml } = yaml;
const yamlProblem = (...args) => yaml.yamlProblem?.(...args);
const docs = (n, head = () => '') => Array.from({ length: n }, (_, i) => head(i) + BOMB).join('---\n');
const member = { key: 'm', name: 'm', dir: '/w/m', projectDir: '/w/m' };
/** values a `js` tree holds (containers and scalars) */
const size = (v) => (Array.isArray(v) ? 1 + v.reduce((n, x) => n + size(x), 0)
  : v && typeof v === 'object' ? 1 + Object.values(v).reduce((n, x) => n + size(x), 0) : v == null ? 0 : 1);

test('lib/yaml: the documents of a file share one node budget — 16 alias-bomb documents hold no more than one; the cut is reported apart from errors', () => {
  const one = loadYaml(BOMB);
  const single = size(one.docs[0].js);
  assert.equal(one.cut, true, 'one bomb document already exceeds the budget');
  const many = loadYaml(docs(16));
  assert.equal(many.docs.length, 16);
  const total = many.docs.reduce((n, d) => n + size(d.js), 0);
  assert.ok(total <= single, `16 documents hold ${total} values; one budget holds ${single} (a budget per document: 16×)`);
  assert.equal(many.cut, true);
  assert.deepEqual(many.errors, [], 'a cut is no parse error');
  assert.equal(yamlProblem(many), 'yaml too large');
});

test('lib/yaml: alias-free YAML is never cut — 210 001 nodes in one spec-sized document, three ordinary manifests', () => {
  const flat = loadYaml(`[${'1,'.repeat(210000)}1]\n`, { maxBytes: 1024 * 1024 }); // 410 KiB, no alias
  assert.equal(flat.cut, false);
  assert.equal(size(flat.docs[0].js), 210002, 'every item read');
  assert.equal(yamlProblem(flat), null);
  const k8s = loadYaml(['apiVersion: v1\nkind: Service\nmetadata: {name: a}\n', 'apiVersion: apps/v1\nkind: Deployment\nmetadata: {name: b}\n', 'apiVersion: v1\nkind: ConfigMap\nmetadata: {name: c}\ndata: {U: "http://b:1/x"}\n'].join('---\n'));
  assert.deepEqual([k8s.cut, k8s.docs.map((d) => d.js?.metadata?.name)], [false, ['a', 'b', 'c']]);
});

test('lib/yaml: a parse error is still what a file reports first, even when the budget cut it too', () => {
  const y = loadYaml(`${BOMB}---\nx: [1\n`);
  assert.equal(y.cut, true);
  assert.ok(y.errors.length > 0);
  assert.equal(yamlProblem(y), y.errors[0]);
  assert.notEqual(yamlProblem(y), 'yaml too large');
});

test('lib/yaml: nodeAt, keyLine and entries spend the walk budget they are given; yamlProblem reports a spent walk', () => {
  const y = loadYaml('a: {b: 1, c: 2}\n');
  const { doc, root } = y.docs[0];
  assert.equal(yaml.nodeAt(doc, root, ['a', 'c'])?.value, 2, 'a fresh budget when none is given');
  assert.equal(yaml.nodeAt(doc, root, ['a', 'c'], { n: 0 }), null, 'a spent budget finds nothing');
  assert.equal(yaml.keyLine(y, doc, root, ['a', 'c']), 1);
  assert.equal(yaml.keyLine(y, doc, root, ['a', 'c'], { n: 3 }), 1, 'three visits reach the key: `a`, then `b` and `c`');
  assert.equal(yaml.keyLine(y, doc, root, ['a', 'c'], { n: 2 }), 0, 'two do not: the path and the key share one budget');
  assert.equal(yaml.fileBudget('x'.repeat(300000)).n, 300000, 'the file length when larger than MAX_NODES');
  const walk = yaml.fileBudget('a: {b: 1, c: 2}\n');
  const n = walk.n;
  assert.deepEqual(yaml.entries(doc, root, walk).map((e) => e.key), ['a']);
  assert.equal(walk.n, n - 1, 'entries charged the budget it was given');
  assert.equal(yamlProblem(y, walk), null);
  assert.equal(yamlProblem(y, { n: -1 }), 'yaml too large', 'a spent walk is reported like a cut');
});

test('api-asyncapi reports a cut of its own walks: AsyncAPI 3 operations that alias one map spend its walk budget before the file\'s', () => {
  const id36 = (i) => i.toString(36);
  const text = `asyncapi: 3.0.0\nx-a: &a {${Array.from({ length: 100 }, (_, i) => `k${id36(i)}: 0`).join(', ')}}\nx-b: &b {<<: [${Array(10).fill('*a').join(', ')}]}\n`
    + `operations:\n${Array.from({ length: 140 }, (_, i) => `  o${id36(i)}: *b\n`).join('')}`;
  assert.equal(loadYaml(text, { maxBytes: 1024 * 1024 }).cut, false, 'the file itself reads within its budget');
  const ctx = { member, members: [member], files: ['api/asyncapi.yaml'], state: {} };
  const r = detectorById('api-asyncapi').detect({ rel: 'api/asyncapi.yaml', text }, ctx);
  assert.equal(r.unresolved[0].reason, 'parse error: yaml too large', 'two lookups per operation spend the walk budget: reported, first');
});

test('api-asyncapi: once its walk budget is spent, no later operation is reported as an unknown action', () => {
  const id36 = (i) => i.toString(36);
  // Every operation sends to one channel, through a merge-amplified map: the walk budget runs out part-way.
  const text = `asyncapi: 3.0.0\nchannels:\n  c0: {address: orders.created}\nx-a: &a {${Array.from({ length: 100 }, (_, i) => `k${id36(i)}: 0`).join(', ')}}\n`
    + `x-b: &b {<<: [${Array(10).fill('*a').join(', ')}], action: send, channel: {$ref: '#/channels/c0'}}\n`
    + `operations:\n${Array.from({ length: 140 }, (_, i) => `  o${id36(i)}: *b\n`).join('')}`;
  const ctx = { member, members: [member], files: ['api/asyncapi.yaml'], state: {} };
  const r = detectorById('api-asyncapi').detect({ rel: 'api/asyncapi.yaml', text }, ctx);
  assert.deepEqual(r.facts.map((f) => [f.dir, f.key]), [['provides', 'orders.created']], 'the operations read before the cut');
  assert.deepEqual(r.unresolved.map((u) => u.reason), ['parse error: yaml too large'], 'the cut, once');
});

test('the YAML detectors report a cut file as too large: one unresolved item each, the way they report a parse error', () => {
  for (const [id, rel, head, reason, files = [rel, 'app.js']] of [
    ['deploy-compose', 'docker-compose.yml', () => 'services: {}\n', 'yaml parse error: yaml too large'],
    ['deploy-k8s', 'deploy/app.yaml', (i) => `apiVersion: v1\nkind: ConfigMap\nmetadata: {name: c${i}}\n`, 'yaml parse error: yaml too large'],
    ['deploy-k8s', 'chart/values.yaml', () => '', 'yaml parse error: yaml too large', ['chart/Chart.yaml', 'chart/values.yaml', 'app.js']], // Helm values
    ['config-env', 'config/app.yml', () => '', 'parse error: yaml too large'],
    ['api-openapi', 'api/spec.yaml', (i) => (i === 0 ? 'openapi: 3.0.0\n' : ''), 'parse error: yaml too large'],
    ['api-asyncapi', 'api/async.yaml', (i) => (i === 0 ? 'asyncapi: 2.6.0\n' : ''), 'parse error: yaml too large'],
  ]) {
    const d = detectorById(id);
    assert.ok(d.claims(rel), `${id} claims ${rel}`);
    const ctx = { member, members: [member], files, state: {} };
    const r = d.detect({ rel, text: docs(12, head) }, ctx);
    if (d.finish) d.finish(ctx);
    assert.deepEqual((r?.unresolved || []).map((u) => [u.file, u.line, u.reason]), [[rel, 1, reason]], `${id} ${rel}`);
  }
});

// Ordinary large YAML is never cut. Plain YAML (compose, Kubernetes, Helm values) is read up to YAML_MAX_BYTES, spec files
// up to 1 MiB; alias-free YAML there, and the usual anchor idiom, stay far inside a file's budget.

test('deploy-k8s reads a rendered bundle of small documents at the plain-YAML cap whole: no cut, every Deployment, Service and ConfigMap', () => {
  const triple = (i) => [
    `apiVersion: apps/v1\nkind: Deployment\nmetadata: {name: app${i}, labels: {app: app${i}}}\nspec:\n  selector: {matchLabels: {app: app${i}}}\n  template:\n    metadata: {labels: {app: app${i}}}\n    spec:\n      containers:\n        - name: app\n          image: ghcr.io/acme/app${i}:1.0.${i}\n          env: [{name: PEER_URL, value: "http://peer${i}:8080/v1"}]\n          envFrom: [{configMapRef: {name: cfg${i}}}]\n`,
    `apiVersion: v1\nkind: Service\nmetadata: {name: svc${i}}\nspec: {selector: {app: app${i}}, ports: [{port: 80, targetPort: 8080}]}\n`,
    `apiVersion: v1\nkind: ConfigMap\nmetadata: {name: cfg${i}}\ndata: {UPSTREAM_URL: "http://up${i}:9000/api", LOG_LEVEL: info}\n`,
  ].map((d) => `---\n${d}`).join('');
  let text = '';
  let n = 0;
  while (text.length + triple(n).length <= yaml.YAML_MAX_BYTES - 1024) { text += triple(n); n += 1; }
  const y = loadYaml(text);
  assert.ok(y.docs.length >= 1000, `${y.docs.length} documents`);
  assert.equal(y.cut, false);
  const d = detectorById('deploy-k8s');
  const ctx = { member, members: [member], files: ['deploy/rendered.yaml', 'src/app.js'], state: {} };
  const r = d.detect({ rel: 'deploy/rendered.yaml', text }, ctx);
  const f = d.finish(ctx);
  assert.deepEqual([...(r?.unresolved || []), ...(f?.unresolved || [])], [], 'no yaml too large');
  const names = (p) => Array.from({ length: n }, (_, i) => `${p}${i}`);
  assert.deepEqual(f.aliases.map((a) => a.value).sort(), [...names('app'), ...names('svc')].sort(), 'every Deployment and Service');
  const hosts = new Set(f.facts.map((x) => x.target));
  assert.deepEqual([...hosts].sort(), [...names('peer').map((h) => `${h}:8080`), ...names('up').map((h) => `${h}:9000`)].sort(), 'every container env and ConfigMap URL');
});

test('deploy-compose reads the anchor idiom whole: one `x-common` anchor merged into 20 services, no cut, every service', () => {
  const svcs = Array.from({ length: 20 }, (_, i) => `  svc-${i}:\n    <<: *common\n    container_name: acme-svc-${i}\n`).join('');
  const text = `x-common: &common\n  build: .\n  restart: unless-stopped\n  depends_on: [db]\n  environment:\n    LOG_LEVEL: info\n    DB_URL: postgres://db:5432/app\nservices:\n  db:\n    image: postgres:16\n${svcs}`;
  assert.equal(loadYaml(text).cut, false);
  const ctx = { member, members: [member], files: ['docker-compose.yml', 'src/app.js'], state: {} };
  const r = detectorById('deploy-compose').detect({ rel: 'docker-compose.yml', text }, ctx);
  assert.deepEqual(r.unresolved, [], 'no yaml too large');
  // each service is this member's only through the merged `build: .`: a service the merge missed names nobody
  const names = Array.from({ length: 20 }, (_, i) => [`svc-${i}`, `acme-svc-${i}`]).flat();
  assert.deepEqual(r.aliases.map((a) => a.value).sort(), names.sort(), 'every service');
  assert.deepEqual(r.facts.map((x) => [x.kind, x.key]).sort(), [['db', 'db:app'], ['service', 'db']], 'the merged depends_on and environment');
});

test('api-openapi reads a dense spec at the 1 MiB read cap whole: over 200 000 nodes (a flat MAX_NODES budget cuts it), no cut, every operation', () => {
  const head = '{"openapi":"3.0.0","info":{"title":"acme","version":"1"},"paths":{';
  const op = (i) => `"/${i.toString(36)}":{"get":{},"put":{}}`;
  const ops = [];
  let len = head.length + 2;
  for (let i = 0; len + op(i).length + 1 <= 1024 * 1024; i += 1) { ops.push(op(i)); len += op(i).length + 1; }
  const text = `${head}${ops.join(',')}}}`;
  assert.ok(text.length <= 1024 * 1024 && ops.length * 6 > 200000, `${text.length} bytes, ${ops.length} paths`); // 6 nodes a path
  assert.equal(loadYaml(text, { json: true, maxBytes: 1024 * 1024 }).cut, false);
  const ctx = { member, members: [member], files: ['api/openapi.json'], state: {} };
  const r = detectorById('api-openapi').detect({ rel: 'api/openapi.json', text }, ctx);
  assert.deepEqual(r.unresolved, [], 'no yaml too large');
  assert.equal(r.facts.length, 2 * ops.length, 'every operation');
});
