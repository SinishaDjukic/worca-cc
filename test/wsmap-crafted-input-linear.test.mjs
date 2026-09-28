// test/wsmap-crafted-input-linear.test.mjs
// Crafted repository files stalled extract, whose detectors are synchronous (nothing pre-empts one): a go.mod
// `replace` line of many `=>` (each one a split point of both tokens), a Rails routes line with a long blank run
// after `do` or `scope` or a run of `only: [` / `except: [` / `via: [` (each scanned to the end of the line), a
// kafkajs call name made of `kafka` runs (two unbounded `\w*`), an annotation path the annotation does not hold
// verbatim (Micronaut's RFC 6570 `{?x}` stripped), searched to the end of the file once per annotation, and YAML
// merges of aliases that cost no visit, and a compose file whose services all re-read one long aliased value. The first row of each construct is sized so the quadratic form takes ≥ 5×
// its bound and the linear one ≥ 5× less (most rows ≥ 10×); the rows after it hold the construct at 1 MiB, the
// per-file read cap (2 s). Every row is timed in CPU time (process.cpuUsage): a loaded machine (the full suite, CI)
// cannot inflate it the way it inflates wall time.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectorById } from '../src/core/workspace-map/detectors/index.mjs';

const KB = 1024;
const MB = 1024 * KB;
const fill = (unit, n) => unit.repeat(Math.ceil(n / unit.length)).slice(0, n);
const js = (s) => `${'// ok\n'.repeat(700)}${s}`; // short first lines: no bundle, so the file is read
const member = { key: 'm', name: 'm', dir: '/w/m', projectDir: '/w/m' };

function run(id, rel, text, members = [member]) {
  const d = detectorById(id);
  assert.ok(d.claims(rel), `${id} claims ${rel}`);
  const ctx = { member, members, files: [rel], state: {} };
  const c0 = process.cpuUsage();
  const r = d.detect({ rel, text }, ctx);
  const f = d.finish ? d.finish(ctx) : undefined;
  const c = process.cpuUsage(c0);
  return { ms: (c.user + c.system) / 1000, facts: [...(r?.facts || []), ...(f?.facts || [])] };
}
/** [label, detector id, rel, text, bound ms of CPU], in order: a row over its bound fails the test at once. */
function linear(rows) {
  for (const [label, id, rel, text, bound] of rows) {
    const { ms } = run(id, rel, text);
    assert.ok(ms < bound, `${label} (${(text.length / KB).toFixed(0)} KiB): ${ms.toFixed(0)} ms CPU, bound ${bound} ms`);
  }
}

test('pkg-go: a replace line of many `=>` is read in linear time; every replace form still parses', () => {
  linear([
    ['replace a with a run of =>', 'pkg-go', 'go.mod', `module m\nreplace a${'=>'.repeat(48 * KB)} x y\n`, 300],
    ['replace a with a run of =>', 'pkg-go', 'go.mod', `module m\nreplace a${'=>'.repeat(MB / 2 - 16)} x y\n`, 2000],
    ['replace block: a v1 with a run of =>', 'pkg-go', 'go.mod', `module m\nreplace (\n a v1${'=>'.repeat(MB / 2 - 32)} x\n)\n`, 2000],
    ['replace a => b with a run of =>', 'pkg-go', 'go.mod', `module m\nreplace a => b${'=>'.repeat(MB / 2 - 32)} v1 y\n`, 2000],
  ]);
  const lib = { key: 'lib', name: 'lib', dir: '/w/lib', projectDir: '/w/lib' };
  const text = [
    'module example.com/m', '', 'require (',
    '\tgithub.com/acme/a v1.2.3', '\tgithub.com/acme/b v0.0.0-20240101000000-abcdef123456', '\tgithub.com/acme/c v2.0.0+incompatible', '\tgithub.com/acme/d v1.0.0', ')', '',
    'replace github.com/acme/a => github.com/fork/a v1.2.4',
    'replace github.com/acme/b v0.0.0-20240101000000-abcdef123456 => ../lib',
    'replace (', '\tgithub.com/acme/c v2.0.0+incompatible => ../lib', '\t"github.com/acme/d" => "../lib"', '\tgithub.com/acme/e v1.0.0 => github.com/fork/e v1.0.1', ')', '',
  ].join('\n');
  const { facts } = run('pkg-go', 'go.mod', text, [member, lib]);
  assert.deepEqual(facts.filter((f) => f.dir === 'consumes').map((f) => [f.key, f.target ?? null]), [
    ['go:github.com/acme/a', null], ['go:github.com/acme/b', 'lib'], ['go:github.com/acme/c', 'lib'], ['go:github.com/acme/d', 'lib'],
  ]);
});

test('http-routes: a Rails routes line with a long blank run after `do` is read in linear time', () => {
  linear([
    ['do + blanks', 'http-routes', 'config/routes.rb', `get 'x' do${' '.repeat(128 * KB)}x\n`, 300],
    ['do + blanks', 'http-routes', 'config/routes.rb', `get 'x' do${' '.repeat(MB - 16)}x\n`, 2000],
    ['do |a (no closing |)', 'http-routes', 'config/routes.rb', `get 'x' do |${'a'.repeat(MB - 16)}\n`, 2000],
  ]);
});

test('http-routes: a Rails `scope` line with a long blank run is read in linear time; scopes and blocks still nest', () => {
  linear([
    ['scope + blanks', 'http-routes', 'config/routes.rb', `scope${' '.repeat(128 * KB)}x\n`, 300],
    ['scope + blanks', 'http-routes', 'config/routes.rb', `scope${' '.repeat(MB - 16)}x\n`, 2000],
    ['scope x with a run of path:', 'http-routes', 'config/routes.rb', `scope x, ${fill('path: ', MB - 16)}\n`, 2000],
  ]);
  const routes = [
    'Rails.application.routes.draw do',
    "  scope '/admin' do", "    get 'stats', to: 'stats#show'", "    constraints subdomain: 'api' do |c|", "      get 'inner', to: 'inner#show'", '    end', "    get 'after', to: 'after#show'", '  end',
    "  scope module: 'v2', path: '/v2' do", '    resources :orders, only: [:index]', '  end',
    "  scope path: '/v3', as: 'v3' do", "    get 'ping', to: 'ping#show'", '  end',
    'end', '',
  ].join('\n');
  const { facts } = run('http-routes', 'config/routes.rb', routes);
  assert.deepEqual(facts.map((f) => `${f.key} @${f.line}`), ['GET /admin/stats @3', 'GET /admin/inner @5', 'GET /admin/after @7', 'GET /v2/orders @10', 'GET /v3/ping @13']);
});

test('messaging: a kafkajs call name made of `kafka` runs is read in linear time', () => {
  linear([
    ['a word of kafka runs', 'messaging', 'a.js', js(`send();\nx = a${fill('kafka', 128 * KB)};\n`), 200],
    ['a word of kafka runs', 'messaging', 'a.js', js(`send();\nx = a${fill('kafka', MB - 4300)};\n`), 2000],
    ['a word of Consumer runs', 'messaging', 'a.js', js(`subscribe();\nx = a${fill('Consumer', MB - 4300)};\n`), 2000],
  ]);
});

// 1 MiB: 2 000 annotations whose path (`/a/b`, once `{?x}` is stripped) is not in their text, then text full of near misses.
const micronaut = (client) => {
  const head = client ? '@Client("http://x")\npublic interface A {\n' : '@Controller("/c")\npublic class A {\n';
  const body = head + (client ? '@Get("/a{?x}/b") String f();\n' : '@Get("/a{?x}/b") void f() {}\n').repeat(2000);
  return `${body}String s = "${fill('/a/c', MB - body.length - 16)}";\n}\n`;
};

test('http-routes: a route path its annotation does not hold verbatim is searched in the annotation only', () => {
  linear([['Micronaut @Get("/a{?x}/b") ×2000', 'http-routes', 'A.java', micronaut(false), 1000]]);
});

test('http-clients: a client path its annotation does not hold verbatim is searched in the annotation only', () => {
  linear([['Micronaut @Get("/a{?x}/b") ×2000', 'http-clients', 'A.java', micronaut(true), 1000]]);
});

/** [label, detector id, rel, text, bound ms], timed in CPU time (process.cpuUsage): load cannot inflate a row. The
 *  detector must also report the cut (the file's node budget ran out). */
function linearCpu(rows) {
  for (const [label, id, rel, text, bound] of rows) {
    const d = detectorById(id);
    assert.ok(d.claims(rel), `${id} claims ${rel}`);
    const ctx = { member, members: [member], files: [rel], state: {} };
    const c0 = process.cpuUsage();
    const r = d.detect({ rel, text }, ctx);
    const c = process.cpuUsage(c0);
    const ms = (c.user + c.system) / 1000;
    assert.ok(ms < bound, `${label} (${(text.length / KB).toFixed(0)} KiB): ${ms.toFixed(0)} ms CPU, bound ${bound} ms`);
    assert.equal(r?.unresolved?.[0]?.reason, 'parse error: yaml too large', `${label}: the cut is reported`);
  }
}
// A map merging a 200-key map 500 times (100 000 entries a walk) and `n` paths, channels or operations that each alias it:
// a walk with a fresh budget per call costs 100 000 entries each (~22 s CPU for 4 000); one budget per file stops at
// MAX_NODES (≤ 0.15 s).
const merged = (head, section, line, n) => `${head}x-a: &a {${Array.from({ length: 200 }, (_, i) => `k${i.toString(36)}: 0`).join(', ')}}\n`
  + `x-b: &b {<<: [${Array(500).fill('*a').join(', ')}]}\n${section}${Array.from({ length: n }, (_, i) => line(i.toString(36))).join('')}`;

test('api-openapi: paths and operations that all alias one map are walked on one budget per file (CPU time)', () => {
  linearCpu([
    ['every path aliases one map', 'api-openapi', 'api/openapi.yaml', merged('openapi: 3.0.0\n', 'paths:\n', (k) => `  /${k}: *b\n`, 4000), 1800],
    ['every operation aliases one map', 'api-openapi', 'api/openapi.yaml', merged('openapi: 3.0.0\n', 'paths:\n', (k) => `  /${k}: {get: *b}\n`, 4000), 1800],
  ]);
});

test('api-asyncapi: channels and operations that all alias one map are walked on one budget per file (CPU time)', () => {
  linearCpu([
    ['AsyncAPI 2: every channel aliases one map', 'api-asyncapi', 'api/asyncapi.yaml', merged('asyncapi: 2.6.0\n', 'channels:\n', (k) => `  c${k}: *b\n`, 4000), 1800],
    ['AsyncAPI 2: every operation aliases one map', 'api-asyncapi', 'api/asyncapi.yaml', merged('asyncapi: 2.6.0\n', 'channels:\n', (k) => `  c${k}: {subscribe: *b}\n`, 4000), 1800],
    ['AsyncAPI 3: every channel aliases one map', 'api-asyncapi', 'api/asyncapi.yaml', merged('asyncapi: 3.0.0\n', 'channels:\n', (k) => `  c${k}: *b\n`, 4000), 1800],
    ['AsyncAPI 3: every operation aliases one map', 'api-asyncapi', 'api/asyncapi.yaml', merged('asyncapi: 3.0.0\n', 'operations:\n', (k) => `  o${k}: *b\n`, 4000), 1800],
  ]);
});

test('http-routes: a Rails line of `only: [` / `except: [` / `via: [` runs is read in linear time; the lists still read', () => {
  linear([
    ['resources + a run of only: [', 'http-routes', 'config/routes.rb', `resources :x ${fill('only: [', 256 * KB)}\n`, 400],
    ['resources + a run of except: [', 'http-routes', 'config/routes.rb', `resources :x ${fill('except: [', 256 * KB)}\n`, 400],
    ['match + a run of via: [', 'http-routes', 'config/routes.rb', `match 'x' ${fill('via: [', 256 * KB)}\n`, 400],
    ['resources + a run of only: [', 'http-routes', 'config/routes.rb', `resources :x ${fill('only: [', MB - 16)}\n`, 2000],
  ]);
  const routes = "Rails.application.routes.draw do\n  resources :orders, only: [:index, :show]\n  resources :users, except: [:destroy, :update]\n  match 'ping', via: [:get, :post], to: 'ping#show'\nend\n";
  assert.deepEqual(run('http-routes', 'config/routes.rb', routes).facts.map((f) => f.key),
    ['GET /orders', 'GET /orders/:id', 'GET /users', 'GET /users/new', 'POST /users', 'GET /users/:id', 'GET /users/:id/edit', 'GET /ping', 'POST /ping']);
});

test('YAML merge sources each cost a visit: thousands of aliased merges of an empty map stay linear and report the cut (CPU time)', () => {
  const bomb = (head) => `${head}x-e: &e {}\nx-f: &f {<<: [${Array(8000).fill('*e').join(', ')}]}\nx-g: [${Array(8000).fill('*f').join(', ')}]\n`;
  for (const [id, rel, head, reason] of [
    ['deploy-compose', 'docker-compose.yml', 'services: {}\n', 'yaml parse error: yaml too large'],
    ['api-openapi', 'api/openapi.yaml', 'openapi: 3.0.0\n', 'parse error: yaml too large'],
    ['config-env', 'config/app.yml', '', 'parse error: yaml too large'],
  ]) {
    const d = detectorById(id);
    const ctx = { member, members: [member], files: [rel], state: {} };
    const c0 = process.cpuUsage();
    const r = d.detect({ rel, text: bomb(head) }, ctx);
    const c = process.cpuUsage(c0);
    const ms = (c.user + c.system) / 1000;
    assert.ok(ms < 500, `${id} (${(bomb(head).length / KB).toFixed(0)} KiB): ${ms.toFixed(0)} ms CPU, bound 500 ms`);
    assert.equal(r?.unresolved?.[0]?.reason, reason, `${id}: the cut is reported`);
  }
});

test('deploy-compose: one long build context aliased by every service is read in linear time (CPU time)', () => {
  const svcs = (size) => { let s = `x-b: &b "./${'a'.repeat(size / 2)}"\nservices:\n`; for (let k = 0; s.length < size - 32; k += 1) s += `  s${k.toString(36)}: {build: *b}\n`; return s; };
  linear([
    ['every service builds from one long aliased context', 'deploy-compose', 'docker-compose.yml', svcs(250 * KB), 1000],
  ]);
});

// Each per-service or per-workload value cap (4 096 characters), pinned by what it drops, deterministically (no timing).
const peer = { key: 'peer', name: 'peer', dir: '/w/peer', projectDir: '/w/peer' };
const LONG_VALUE = 'a'.repeat(4097);
const short = (v) => (v.length > 64 ? 'LONG' : v);

test('deploy-compose: a build context, dockerfile, image, alias name, depends_on, links or environment name over 4 096 characters is not read', () => {
  const compose = (svc) => {
    const ctx = { member, members: [member, peer], files: ['docker-compose.yml', 'src/app.js'], state: {} };
    const r = detectorById('deploy-compose').detect({ rel: 'docker-compose.yml', text: `services:\n${svc}` }, ctx);
    return { aliases: r.aliases.map((a) => [short(a.value), a.member ?? null]), facts: r.facts.map((f) => short(f.key)) };
  };
  for (const [label, svc, want] of [
    ['context', `  web-app:\n    build: "./${LONG_VALUE}"\n`, { aliases: [], facts: [] }],
    ['dockerfile', `  peer:\n    build: {context: ., dockerfile: "./src/peer/${LONG_VALUE}/Dockerfile"}\n`, { aliases: [], facts: [] }],
    ['image', `  web:\n    image: "ghcr.io/${LONG_VALUE}/peer:1"\n`, { aliases: [], facts: [] }],
    ['alias name', `  web:\n    build: .\n    container_name: "${LONG_VALUE}"\n`, { aliases: [['web', null]], facts: [] }],
    ['depends_on', `  web:\n    build: .\n    depends_on: ["${LONG_VALUE}"]\n`, { aliases: [['web', null]], facts: [] }],
    ['links', `  web:\n    build: .\n    links: ["${LONG_VALUE}:x"]\n`, { aliases: [['web', null]], facts: [] }],
    ['env name (map)', `  web:\n    build: .\n    environment: {"${LONG_VALUE}_URL": "http://peer:8080/v1"}\n`, { aliases: [['web', null]], facts: [] }],
    ['env name (list)', `  web:\n    build: .\n    environment: ["${LONG_VALUE}_URL=http://peer:8080/v1"]\n`, { aliases: [['web', null]], facts: [] }],
  ]) assert.deepEqual(compose(svc), want, label);
  // at 4 096 characters every value is still read: ghcr.io/ + 4 081 + /peer:1
  assert.deepEqual(compose(`  web:\n    image: "ghcr.io/${'a'.repeat(4096 - 15)}/peer:1"\n`).aliases, [['web', 'peer']], 'an image of 4 096 characters');
});

/** deploy-k8s over one manifest of member m (beside a member peer): aliases and fact keys (a long value as LONG), and CPU time. */
function k8s(text) {
  const d = detectorById('deploy-k8s');
  const ctx = { member, members: [member, peer], files: ['deploy/app.yaml', 'src/app.js'], state: {} };
  const c0 = process.cpuUsage();
  d.detect({ rel: 'deploy/app.yaml', text }, ctx);
  const f = d.finish(ctx);
  const c = process.cpuUsage(c0);
  return { ms: (c.user + c.system) / 1000, aliases: f.aliases.map((a) => [short(a.value), a.member ?? null]), facts: f.facts.map((x) => short(x.key)) };
}
const deployment = (name, image, env = '') => `apiVersion: apps/v1\nkind: Deployment\nmetadata: {name: "${name}"}\nspec: {template: {spec: {containers: [{name: c, image: "${image}"${env}}]}}}\n`;

test('deploy-k8s: a workload name, image, Ingress host, Service name or env name over 4 096 characters is not read', () => {
  for (const [label, text, want] of [
    ['workload name', deployment(LONG_VALUE, 'ghcr.io/acme/m:1'), []],
    ['image', deployment('web', `ghcr.io/${LONG_VALUE}/peer:1`), []], // an image-less document: nobody's
    ['ingress host', deployment('web', 'ghcr.io/acme/m:1') + `---\napiVersion: networking.k8s.io/v1\nkind: Ingress\nmetadata: {name: ing}\nspec: {rules: [{host: "${LONG_VALUE}.example.com", http: {paths: [{backend: {service: {name: web}}}]}}]}\n`, [['web', null]]],
    ['service name', `apiVersion: v1\nkind: Service\nmetadata: {name: "${LONG_VALUE}"}\nspec: {selector: {app: web}}\n`, []],
  ]) assert.deepEqual(k8s(text).aliases, want, label);
  assert.deepEqual(k8s(deployment('web', 'ghcr.io/acme/m:1', `, env: [{name: "${LONG_VALUE}_URL", value: "http://peer:8080/v1"}]`)).facts, [], 'env name');
  assert.deepEqual(k8s(deployment('web', `ghcr.io/${'a'.repeat(4096 - 15)}/peer:1`)).aliases, [['web', 'peer']], 'an image of 4 096 characters is read');
});

test('deploy-k8s: one long image aliased by every item of a List is read in linear time (CPU time)', () => {
  let text = `apiVersion: v1\nkind: List\nx-d: &d {apiVersion: apps/v1, kind: Deployment, metadata: {name: web}, spec: {template: {spec: {containers: [{name: c, image: "ghcr.io/acme/${'a'.repeat(64 * KB)}:1"}]}}}}\nitems:\n`;
  while (text.length < 125 * KB) text += '  - *d\n';
  const { ms } = k8s(text);
  assert.ok(ms < 1000, `${ms.toFixed(0)} ms CPU, bound 1000 ms`);
});
