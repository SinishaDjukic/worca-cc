import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DETECTORS, detectorById } from '../src/core/workspace-map/detectors/index.mjs';

const P3 = ['api-asyncapi', 'api-graphql', 'api-openapi', 'api-proto', 'config-env', 'deploy-compose', 'deploy-k8s',
  'git-submodules', 'pkg-cargo', 'pkg-dotnet', 'pkg-go', 'pkg-gradle', 'pkg-maven', 'pkg-python'];

test('registry: every P3 detector is registered once, frozen, with claims/detect (and finish when present)', () => {
  const ids = DETECTORS.map((d) => d.id);
  assert.equal(new Set(ids).size, ids.length, 'ids are unique');
  for (const id of P3) {
    const d = detectorById(id);
    assert.ok(d, id);
    assert.equal(ids.filter((x) => x === id).length, 1, id);
    assert.ok(Object.isFrozen(d), `${id} frozen`);
    assert.equal(typeof d.claims, 'function');
    assert.equal(typeof d.detect, 'function');
    if ('finish' in d) assert.equal(typeof d.finish, 'function');
  }
  const block = ids.filter((id) => P3.includes(id));
  assert.deepEqual(block, [...P3], 'the P3 block is alphabetical');
});

test('registry: claims are path-only and total (no throw on odd paths)', () => {
  for (const d of DETECTORS.filter((x) => P3.includes(x.id))) {
    for (const rel of ['', 'a', 'x/y/z.unknown', 'deep/'.repeat(50) + 'pom.xml', 'weird name (1).yaml']) assert.doesNotThrow(() => d.claims(rel), d.id);
  }
  const claimers = (rel) => DETECTORS.filter((d) => P3.includes(d.id) && d.claims(rel)).map((d) => d.id).sort();
  assert.deepEqual(claimers('pom.xml'), ['pkg-maven']);
  assert.deepEqual(claimers('svc/go.mod'), ['pkg-go']);
  assert.deepEqual(claimers('docker-compose.yml'), ['api-asyncapi', 'api-openapi', 'deploy-compose']);
  assert.deepEqual(claimers('ops/docker-compose-dev.yml'), ['api-asyncapi', 'api-openapi', 'deploy-compose']);
  assert.deepEqual(claimers('.env.local'), ['config-env']);
  assert.deepEqual(claimers('api/billing.proto'), ['api-proto']);
  assert.deepEqual(claimers('schema.graphqls'), ['api-graphql']);
});

// ReDoS guard: pathological inputs up to the per-file read cap (1 MiB; plain YAML just under the
// 256 KiB YAML_MAX_BYTES, so it is really parsed), several per detector. Each row targets one
// construct whose naive form is super-linear: adjacent quantifiers over overlapping classes
// (`\s*\(?\s*`, `\s*=?\s*`, `\s+#`, `(.+?)\s*$`, `/\/+$/`), a line-level `.*$` after a whitespace
// run (a lone \r ends `.` but not the line), `^\s*` under /m re-scanning newline runs, a regex that
// may start inside a long name run (XML attributes), a block closed by re-scanning the rest of the
// file from every opener (GraphQL types and `schema`, proto services), a lookup per entry (TOML key
// lines, pyproject specs, compose services, ConfigMap keys) and one evidence search per fact over a
// one-line (minified) file. The naive forms take 5 s to hours on these rows; the detectors take
// ≤ 0.2 s a row. Rows marked SLOW run the `yaml` package over a large document (its own linear
// worst case, ~2 s a row on a loaded runner): 15 s. Every other row: 2 s.
const MB = 1024 * 1024;
const YAML_KB = 250 * 1024;
const body = (head, unit, tail = '', size = MB) => head + unit.repeat(Math.max(0, Math.floor((size - head.length - tail.length) / unit.length))) + tail;
const rows = (head, n, f, size = MB) => { let s = head; for (let i = 0; s.length < size - 64 && i < n; i += 1) s += f(i); return s; };
const pad = (i) => String(i).padStart(6, '0'); // distinct needles, each found only at its own place on the line
const SLOW = true;
const CASES = [
  ['api-asyncapi', 'asyncapi.yaml', body('asyncapi: 2.6.0\nchannels:\n', '- <<: *b\n', '', YAML_KB), SLOW],
  ['api-asyncapi', 'asyncapi.yaml', body('', '\n', '!')], // gate: ^\s* over a newline run
  ['api-graphql', 'schema.graphql', body('', 'query q { a(b: { ')],
  ['api-graphql', 'schema.graphql', body('', 'type Query {\n')], // a block per unclosed opener
  ['api-graphql', 'a.ts', body('graphql', ' ', '!')], // the template opener
  ['api-graphql', 'schema.graphql', body('', 'schema {')], // a schema block re-scanned from every `schema`
  ['api-graphql', 'schema.graphql', body('', 'schema @a(')], // … and every unclosed directive argument list
  ['api-graphql', 'schema.graphql', body('type ', 'a', '!')], // (\w+)[^{]{0,500}? backtracking per name char
  ['api-graphql', 'q.graphql', body('query', ' ', `${'!'.repeat(400)}{`)], // an operation header per space
  ['api-graphql', 'schema.graphql', `type Query { ${Array.from({ length: 70000 }, (_, i) => `f${pad(i)}: Int`).join(' ')} }`], // an evidence search per fact on one line
  ['api-openapi', 'openapi.yaml', body('openapi: 3.0.0\n', '- <<: *b\n', '', YAML_KB), SLOW],
  ['api-openapi', 'openapi.yaml', body('', '\n', '!')],
  ['api-openapi', 'openapi.json', `{"openapi":"3.0.0","paths":{${Array.from({ length: 40000 }, (_, i) => `"/p${pad(i)}":{"get":{}}`).join(',')}}}`, SLOW], // a minified spec
  ['api-proto', 'svc.go', body('', 'RegisterXServer UnimplementedYServer NewZClient aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa ')],
  ['api-proto', 'a.proto', body('', 'service S {\n')],
  ['api-proto', 'b_grpc.pb.go', body('// Code generated by protoc-gen-go-grpc. DO NOT EDIT.\n', `"/${'a.'.repeat(150)}`)], // full method names in generated code
  ['api-proto', 'svc.go', body('Client\n', '\n')], // Go imports: `[ \t]` only (a `\s` under /m rescans a blank-line run from every line)
  ['api-proto', 'svc.go', body('', `func (${'a'.repeat(30)} xStub `)], // the declaration check per hint reads only the tail before it
  ['api-proto', 'svc.go', body('', `${'a'.repeat(234)} xStub `)], // a hint's qualifier: a char scan back, never a regex anchored at the end of a slice
  ['api-proto', 'B.java', body('@io.grpc.stub.annotations.GrpcGenerated\nString SERVICE_NAME = "a.B";\n', 'generateFullMethodName(SERVICE_NAME, "M")\n')], // grpc-java definitions
  ['api-proto', 'Svc.java', body('', '.addService(a.')], // grpc-tools static / ts-proto servers: addService(x.XService, impl)
  ['api-proto', 'svc.go', body('', 'RegisterAHandler ')], // grpc-gateway / connect-go Register…Handler
  ['api-proto', 'svc.go', body('', `pb.RegisterAHandler( ${'a'.repeat(60)} `)], // the gateway row's context-argument lookahead is bounded
  ['api-proto', 'Svc.java', body('x = 1; ', '/\\/')], // comment blanking: a backslash outside a string escapes one character
  ['config-env', '.env', body('A=http://', '${a:')],
  ['config-env', '.env', body('A=http://', 'a:${b:-c/')], // templates in a host (notPort)
  ['config-env', '.env', body('KAFKA_BROKERS=', 'kafka:9092,')], // a broker list: one host per item
  ['config-env', '.env', body('A=', 'https://api.acme.com/a1b2c3d4e5f6g7h8i9j0k ')], // key-shaped path segments on a public host
  ['config-env', 'config/a.yaml', body('', '\n', '!')], // the OpenAPI / AsyncAPI gate before the YAML parse
  ['config-env', 'appsettings.json', `{"a":{${Array.from({ length: 30000 }, (_, i) => `"k${i}":"http:\\/\\/h${pad(i)}:1\\/x"`).join(',')}}}`, SLOW], // escaped values: every needle misses, the key is cited
  ['config-env', '.env', body('A=a', ' ', 'b')], // dotenv inline-comment strip
  ['config-env', '.env', body('A=', 'jdbc:sqlserver://h,')], // databaseName lookup per URL
  ['config-env', '.env', body('A=', `http://a/${'}'.repeat(2030)} `)], // unbalanced '}' trim
  ['config-env', '.env', body('A=', ' ', 'y\rz')], // a lone \r ends `.` but not the line: `\s*=\s*(.*)$`
  ['config-env', 'application.properties', body('a=', ' ', 'y\rz')], // `\s*[=:\s]\s*(.*)$`
  ['config-env', 'appsettings.json', `{"a":{${Array.from({ length: 35000 }, (_, i) => `"k${i}":"http://h${pad(i)}:1/x"`).join(',')}}}`, SLOW], // one-line JSON: an evidence search per fact
  ['config-env', '.env', body('A=', 'http://b:8080/x,y')], // a URL cut inside a userinfo: the text after the cut is scanned once, bounded
  ['config-env', '.env', body('A=http://b:', '$(', ')')], // a Kubernetes $(VAR) inside URL_RE
  ['config-env', '.env', body('A=jdbc:mysql://h/d?user=u&password=', 'a,')], // the credential-parameter check per URL match
  ['config-env', 'appsettings.json', `{"topic_${'pw_'.repeat(340000)}reset": "password-reset"}`], // a key of credential words: one right-to-left pass
  ['config-env', 'config/app.yml', `a: &v "${'aB'.repeat(124)}"\nb: &l [${Array(1000).fill('*v').join(', ')}]\ntopic_${'sent_'.repeat(99)}x: [${Array(150).fill('*l').join(', ')}]\n`], // aliases re-visit one scalar 150 000 times: the walk budget (lib/yaml walkScalars)
  ['config-env', 'config/app.json', JSON.stringify({ ['k'.repeat(400000)]: Object.fromEntries(Array.from({ length: 20000 }, (_, i) => [`q${i}`, 'v'])) })], // a 400 KB key over 20 000 leaves: gigabytes of flattened keys (out of memory) without the 512-char key bound
  ['config-env', '.env', body('A_URL=jdbc:sqlserver://${H}', `;${'a'.repeat(40)}pass${'b'.repeat(40)}`)], // unresolvedValue: a credential property per `;`, bounded
  ['deploy-compose', 'docker-compose.yml', body('services: ', '[{', '', YAML_KB), SLOW],
  ['deploy-compose', 'docker-compose.yml', rows('services:\n', 1e6, (i) => `  s${i}: {}\n`, YAML_KB)], // per-service lookups
  ['deploy-k8s', 'k8s.yaml', body('apiVersion: v1\nkind: List\nitems: ', '- ', '', YAML_KB)],
  ['deploy-k8s', 'k8s.yaml', body('', '\n', '!')],
  ['deploy-k8s', 'k8s.yaml', rows('apiVersion: v1\nkind: Pod\nmetadata: {name: p}\nspec:\n  containers:\n    - image: x\n      envFrom: [{configMapRef: {name: c}}]\n---\napiVersion: v1\nkind: ConfigMap\nmetadata: {name: c}\ndata:\n', 1e6, (i) => `  K${i}: http://h${i}:1/x\n`, YAML_KB)],
  ['git-submodules', '.gitmodules', body('', '[submodule "a"] url = ')],
  ['git-submodules', '.gitmodules', body('[submodule "a"]\n url = a', ' ', 'b')],
  ['git-submodules', '.gitmodules', body('[submodule "a"]\n url = ', '/', 'x')],
  ['pkg-cargo', 'Cargo.toml', body('[package]\nname = "', 'a')],
  ['pkg-cargo', 'Cargo.toml', body('[package]\nname = "a"\ndescription = """\n[', ' ', 'x\n"""\n')], // TOML header regex
  ['pkg-cargo', 'Cargo.toml', rows('[package]\nname = "a"\n[dependencies]\n', 1e6, (i) => `d${i} = "1"\n`)], // key line per dependency
  ['pkg-dotnet', 'a.csproj', body('', '<PackageReference Include="x"><!--')],
  ['pkg-dotnet', 'a.csproj', body('<Project ', 'x', '>')], // attribute scan
  ['pkg-dotnet', 'a.csproj', `<Project>${Array.from({ length: 26000 }, (_, i) => `<PackageReference Include="p${pad(i)}"/>`).join('')}</Project>`], // one line, 26 000 facts
  ['pkg-go', 'go.mod', body('require (\n', 'a v1 replace a => ')],
  ['pkg-gradle', 'build.gradle', body('', "testImplementationImplementation(project('")],
  ['pkg-gradle', 'build.gradle', body('implementation', ' ', 'x')],
  ['pkg-gradle', 'build.gradle', body('group', ' ', 'x')],
  ['pkg-gradle', 'gradle/libs.versions.toml', rows('[libraries]\n', 1e6, (i) => `l${i} = "g:a${i}:1"\n`)],
  ['pkg-gradle', 'settings.gradle', body('', 'include(\n')], // a parenthesised include list per line
  ['pkg-gradle', 'build.gradle', body("implementation 'a:b:1'", ", 'c:d:1'")], // a 1 MiB varargs list
  ['pkg-maven', 'pom.xml', body('<project>', '<dependency><groupId>')],
  ['pkg-maven', 'pom.xml', body('<project ', 'x', '>')],
  ['pkg-maven', 'pom.xml', body('<project><groupId>', '${', '</groupId><artifactId>a</artifactId></project>')], // property substitution runs
  ['pkg-python', 'requirements.txt', body('', '-e ../a[ @ file:')],
  ['pkg-python', 'requirements.txt', body('a', ' ', 'b')],
  ['pkg-python', 'requirements.txt', body('../a', '/', '!')], // leaves the member, so the trailing-separator trim runs
  ['pkg-python', 'requirements.txt', body('-e ', ' ', 'y\rz')], // `\s+(.+)$` and a lone \r
  ['pkg-python', 'requirements.txt', body('a', ' #', '\rz')], // the comment strip is `[^]*$`
  ['pkg-python', 'pyproject.toml', `${rows('[project]\nname = "a"\ndependencies = [\n', 1e6, (i) => `  "d${i}",\n`, MB - 4)}]\n`],
  ['pkg-python', 'pyproject.toml', `${rows('[project]\nname = "a"\ndependencies = [\n', 1e6, (i) => `  "d\\u0030${i}",\n`, MB - 4)}]\n`], // specs not written verbatim (TOML escapes)
];

test(`registry: 1 MiB pathological inputs stay linear (${CASES.length} rows: 2 s; 15 s for the rows marked SLOW) and never throw`, () => {
  const dir = join(tmpdir(), 'wsmap-redos');
  const member = { key: 'm', name: 'm', dir, projectDir: dir };
  assert.deepEqual([...new Set(CASES.map(([id]) => id))].sort(), [...P3].sort(), 'every P3 detector has a row');
  for (const [id, rel, text, slow] of CASES) {
    const d = detectorById(id);
    assert.ok(d.claims(rel), `${id} claims ${rel}`);
    assert.ok(text.length <= MB, `${id} ${rel}: ${text.length}`);
    const ctx = { member, members: [member], files: [rel], state: {} };
    const t0 = performance.now();
    assert.doesNotThrow(() => { d.detect({ rel, text }, ctx); if (d.finish) d.finish(ctx); }, id);
    const ms = performance.now() - t0;
    const budget = slow ? 15000 : 2000;
    assert.ok(ms < budget, `${id} ${rel} (${JSON.stringify(text.slice(0, 24))}…) took ${ms.toFixed(0)} ms (budget ${budget})`);
  }
});

test('registry: finish() lookups across files are indexed — api-proto hints per service (a .proto, generated code), deploy-k8s Services per workload (2 s each)', () => {
  const dir = join(tmpdir(), 'wsmap-redos');
  const member = { key: 'm', name: 'm', dir, projectDir: dir };
  // api-proto: a .proto with ~20 000 services and a source file with 170 000 stub-looking names.
  let proto = 'syntax = "proto3";\npackage p;\n';
  for (let i = 0; proto.length < 800 * 1024; i += 1) proto += `service S${i} { rpc M(A) returns (B); }\n`;
  const p = detectorById('api-proto');
  const pctx = { member, members: [member], files: ['a.proto', 'b.go'], state: {} };
  let t0 = performance.now();
  p.detect({ rel: 'a.proto', text: proto }, pctx);
  p.detect({ rel: 'b.go', text: 'aStub '.repeat(170000) }, pctx);
  p.finish(pctx);
  let ms = performance.now() - t0;
  assert.ok(ms < 2000, `api-proto took ${ms.toFixed(0)} ms (a hint scan per service: ~15 s)`);
  // deploy-k8s: 12 manifests of Deployments and Services; every selector shares three labels with
  // every workload and misses on the fourth (finish timed).
  const k = detectorById('deploy-k8s');
  const doc = (f, i) => `---\napiVersion: apps/v1\nkind: Deployment\nmetadata: {name: w${f}x${i}}\nspec: {template: {metadata: {labels: {app: web, tier: api, zone: eu, team: t${f}x${i}}}, spec: {containers: [{image: ghcr.io/acme/w:1}]}}}\n`
    + `---\napiVersion: v1\nkind: Service\nmetadata: {name: s${f}x${i}}\nspec: {selector: {app: web, tier: api, zone: eu, team: none${f}x${i}}}\n`;
  const files = Array.from({ length: 12 }, (_, f) => [`k8s/f${f}.yaml`, rows('', 1e6, (i) => doc(f, i), YAML_KB)]);
  const kctx = { member, members: [member], files: files.map(([rel]) => rel), state: {} };
  for (const [rel, text] of files) k.detect({ rel, text }, kctx);
  t0 = performance.now();
  k.finish(kctx);
  ms = performance.now() - t0;
  assert.ok(ms < 2000, `deploy-k8s finish took ${ms.toFixed(0)} ms (every Service against every workload: ~7 s)`);
  // api-proto: generated code defining ~25 000 services, a source file calling each of them.
  let gen = '// Code generated by protoc-gen-go-grpc. DO NOT EDIT.\n';
  let calls = '';
  for (let i = 0; gen.length < 900 * 1024; i += 1) { gen += `\tS${i}_M_FullMethodName = "/p.S${i}/M"\n`; calls += `NewS${i}Client(c)\n`; }
  const g = detectorById('api-proto');
  const gctx = { member, members: [member], files: ['calls.go', 'gen_grpc.pb.go'], state: {} };
  t0 = performance.now();
  g.detect({ rel: 'calls.go', text: calls }, gctx);
  g.detect({ rel: 'gen_grpc.pb.go', text: gen }, gctx);
  const out = g.finish(gctx);
  ms = performance.now() - t0;
  assert.ok(out.facts.length > 20000, `${out.facts.length} consumes`);
  assert.ok(ms < 2000, `api-proto (generated definitions) took ${ms.toFixed(0)} ms`);
});
